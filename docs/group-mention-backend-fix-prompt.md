# 群聊 @ 成员列表服务端修复 Prompt

你是 BWChat 项目的资深后端工程师。请直接检查、修复并验证群详情与群文本消息发送接口，目标是彻底消除群聊选择成员或发送 `@某某` 消息时出现的服务端 5xx，并保证 @ 元数据、消息落库、实时广播与提醒可靠完成。

不要要求 iOS 改请求路径，不要新增 @ 功能才能使用的新接口；必须兼容已上线客户端。

## 一、已知客户端行为与故障

- iOS 使用 Bearer Token 请求：`GET /api/v1/groups/{group_id}`。
- iOS 发送带 @ 的文本消息时请求：`POST /api/v1/groups/{group_id}/messages/text`，JSON 中的 `mentions` 是被提及成员的稳定 `user_id` 字符串数组。
- 客户端会把 HTTP 500...599 统一展示为“服务器暂时不可用，请稍后重试”。
- iOS 已增加本地成员缓存、群聊页面成员复用、重复成员清洗和失败降级。因此短暂失败不会再直接阻塞 @，但服务端真实的 5xx 仍必须修复。
- 客户端会对幂等 GET 的部分瞬态网络错误或 5xx 做有限重试。服务端不得依赖重试掩盖异常，也不应因短时间重复 GET 产生锁冲突或 5xx。
- 当前 iOS 解码模型中的群详情和成员字段均为非可选值。任何必填字段返回 `null` 或缺失都会导致解码失败。
- 已确认普通群文本可以进入发送流程，而加入非空 `mentions` 后出现服务端不可用提示。必须重点排查 mentions 校验、消息表字段、关联表写入、未读/提醒 fan-out、WebSocket 序列化和推送任务；不得让客户端删除 `mentions` 后静默降级，因为那会丢失真正的 @ 通知语义。

## 二、必须保持的接口契约

### 请求

```http
GET /api/v1/groups/{group_id}
Authorization: Bearer <access_token>
Accept: application/json
```

### 成功响应

使用项目现有统一响应包装：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "group_id": 42,
    "name": "群聊名称",
    "avatar_url": "https://cdn.example.com/groups/42.png",
    "creator_id": "owner-user-id",
    "is_public": false,
    "members": [
      {
        "user_id": "stable-user-id",
        "nickname": "显示昵称",
        "avatar_url": "https://cdn.example.com/users/u1.png",
        "role": "owner"
      },
      {
        "user_id": "member-user-id",
        "nickname": "群成员",
        "avatar_url": "",
        "role": "member"
      }
    ]
  }
}
```

契约要求：

1. `group_id` 必须是整数，且与路径参数一致。
2. `name`、`avatar_url`、`creator_id`、`members` 不得缺失或为 `null`；无头像时返回空字符串。
3. 每个成员的 `user_id`、`nickname`、`avatar_url`、`role` 不得缺失或为 `null`。
4. 昵称为空时由服务端使用用户名、用户 ID 或统一的“未命名用户”规则生成非空展示名。
5. `role` 只返回项目已定义的稳定值，例如 `owner`、`admin`、`member`，不要返回大小写不一致或临时枚举值。
6. `members` 必须包含当前鉴权用户本人，以便客户端判断管理员的 `@所有人` 权限。
7. 同一 `user_id` 在 `members` 中只能出现一次。
8. 已退出群聊的用户不得返回；已注销、删除或无效的成员关联必须按项目规则清理或过滤，不能因脏数据让整个接口返回 500。
9. 允许返回客户端暂不识别的新增字段，但不能删除或重命名上述字段。

## 三、错误语义

不要把预期业务情况转换成 500：

- Token 缺失、无效或过期：HTTP 401，使用现有鉴权错误格式。
- 当前用户不是该群成员且无查看权限：HTTP 403。
- 群不存在：HTTP 404。
- 群已删除或不可恢复：按项目规范返回 404 或 410。
- 非法 `group_id`：HTTP 400 或 404，不得抛未捕获类型转换异常。
- 限流：HTTP 429，并按现有规范返回 `Retry-After`。
- 只有真正无法完成请求的内部异常才允许返回 500；响应必须带 `X-Request-ID` 或 `X-Correlation-ID`，日志中能用该 ID 定位完整异常。

所有错误均返回 JSON，不要让 nginx、网关或应用服务器返回 HTML 错误页。

## 四、带 @ 群文本发送接口（P0）

保持现有路径和字段，不要求 iOS 改协议：

```http
POST /api/v1/groups/{group_id}/messages/text
Authorization: Bearer <access_token>
Content-Type: application/json
```

普通带 @ 请求示例：

```json
{
  "content": "@小明 请看一下",
  "mentions": ["stable-user-id"],
  "client_message_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

回复消息时还可能包含：

```json
{
  "content": "@小明 我回复你了",
  "mentions": ["stable-user-id"],
  "reply_to_id": 123,
  "client_message_id": "550e8400-e29b-41d4-a716-446655440001"
}
```

要求：

1. `content` 为非空字符串；长度、敏感词等沿用现有群文本规则。
2. `mentions` 可省略；提供时必须是字符串数组。空数组应等价于省略，不得返回 500。
3. 服务端对 `mentions` 去重，拒绝空字符串，并校验每个 `user_id` 对应当前群的有效成员。
4. 提及不存在、已退群、已注销或无效用户时返回明确的 4xx/业务错误，例如 `GROUP_MENTION_MEMBER_INVALID`，不得因外键或空对象返回 500。
5. `client_message_id` 在“发送者 + 群”范围内必须幂等。客户端重试同一 ID 时返回第一次成功创建的消息，不得重复落库、重复增加未读或重复发送 @ 提醒。
6. 消息落库、mentions 元数据/关联表、群事件、未读计数和可靠 outbox 事件应在同一事务中完成；外部 WebSocket/APNs 推送通过事务性 outbox 异步投递，推送失败不得回滚已成功创建的消息或把接口变成 500。
7. 如果 mentions 存 JSON/数组列，确认数据库驱动、ORM 和迁移已正确支持字符串数组；如果存关联表，确认 `(message_id, mentioned_user_id)` 唯一约束与外键策略正确。
8. 不要把客户端可见文本中的 `@昵称` 当作授权依据；真正的提醒对象只以已校验的 `mentions` 用户 ID 为准。
9. 发送者不能通过伪造 `mentions` 向群外用户制造通知。
10. 成功响应中的 `data` 必须返回完整 `GroupMessage`，至少包含以下字段且类型稳定：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 1001,
    "group_id": 42,
    "sender_id": "sender-user-id",
    "msg_type": "text",
    "content": "@小明 请看一下",
    "timestamp": "2026-07-22T07:00:00.000Z",
    "sender_nickname": "发送者",
    "sender_avatar": "",
    "reply_to_id": null,
    "reply_to": null,
    "mentions": ["stable-user-id"],
    "client_message_id": "550e8400-e29b-41d4-a716-446655440000",
    "version": 1,
    "updated_at": null
  }
}
```

11. API 响应、WebSocket 广播、历史记录和消息上下文接口必须返回一致的 `mentions` 数组；不得在某条链路中变成对象数组、逗号字符串或 `null`（无 mentions 时允许 `null` 或空数组，带 mentions 时必须保留数组）。
12. 对每个被提及用户生成可靠的 mention/unread 提醒；发送者本人不生成自己的提醒。提醒消费必须以 `message_id + mentioned_user_id` 幂等。

## 五、重点排查与修复项

1. 从路由、鉴权、中间件、Group Service、Repository/ORM、序列化器到网关逐层复现 `GET /groups/{group_id}`。
2. 检查群成员联表中的孤儿记录、用户软删除、空昵称、空头像、空角色、重复成员、错误的 ID 类型以及 N+1 查询。
3. 使用一次受控查询批量读取群和有效成员；避免逐成员查询用户资料。
4. 对可为空的数据库字段在映射层显式 `COALESCE` 或提供领域默认值，不得把数据库 `NULL` 直接映射到必填 JSON 字段。
5. 群成员表增加或确认唯一约束：`UNIQUE(group_id, user_id)`；上线前处理已有重复数据。
6. 群成员表和用户表连接必须正确处理软删除。不能因为一个失效用户关联导致整个群详情序列化失败。
7. 当前用户的成员权限校验与详情查询应在一致的数据视图中完成，避免并发退群、踢人或删群时出现空对象解引用和 500。
8. 如果群规模较大，确认查询计划和必要索引，至少覆盖群主键、`group_members.group_id`、`group_members.user_id` 以及唯一组合索引。
9. 确认应用实例、数据库连接池、Redis/缓存和反向代理在突发重复 GET 下不会产生超时或连接耗尽。
10. 若存在服务端群详情缓存，成员增删、角色变更、退群、踢人、用户资料变更后必须正确失效；缓存中的旧结构或 `null` 数据不得继续返回。
11. 对群文本发送接口分别用“无 mentions / 单个 mentions / 多个 mentions / 重复 mentions / 无效 mentions”执行到完整落库和通知链路，定位首个抛出 5xx 的组件。
12. 检查消息表或 message_mentions 关联表的生产数据库迁移是否实际执行，避免代码已读取/写入 mentions、线上表结构却缺列或缺表。
13. 检查 WebSocket、未读计数和 APNs 任务是否错误地在同步请求内执行；任何通知基础设施故障都不应把已提交消息发送接口变成 500。

## 六、日志与可观测性

为该接口补充结构化日志和指标：

- `request_id`、路由、HTTP 状态、业务错误码、耗时。
- 脱敏后的 `group_id`、当前用户 ID、成员数量、数据库耗时、缓存命中状态。
- 5xx 必须记录异常类型和完整服务端堆栈。
- 不得记录 Bearer Token、刷新令牌或其他敏感凭证。
- 统计该接口的请求量、P50/P95/P99、401/403/404/429/5xx 数量，并为异常 5xx 比例配置告警。
- 群文本发送日志增加 `client_message_id`、mentions 数量、去重后数量、消息 ID、事务阶段和 outbox 事件 ID；不要记录完整消息正文或敏感用户资料。

## 七、必须补充的自动化测试

至少覆盖：

1. 普通成员、管理员和群主分别读取群详情成功，响应包含本人及正确角色。
2. 群不存在、无权限、Token 失效分别返回 404、403、401，且不是 500。
3. 群无头像、成员无头像、成员无昵称或历史空字段时仍返回可被 iOS 解码的非空字符串字段。
4. 存在已注销用户、软删除用户或孤儿成员关联时，接口按规则过滤/清理，不返回 500。
5. 数据库中存在历史重复成员时，迁移可清理，接口响应不重复；唯一约束能阻止再次产生重复数据。
6. 管理员角色准确返回 `admin`，群主角色准确返回 `owner`，普通成员返回 `member`。
7. 成员加入、退出、被踢、角色变化后，接口和服务端缓存立即反映最新结果。
8. 并发退群/踢人/删群与读取详情时，不出现未捕获异常或 500。
9. 连续和并发请求不会触发连接池耗尽、锁异常或明显的 N+1 性能退化。
10. 响应 JSON 与上述 iOS 契约做 schema/contract test，所有必填字段均存在且类型正确。
11. 不带 `mentions` 的普通群文本发送成功。
12. 单个及多个有效群成员 ID 的 `mentions` 发送成功，响应、历史记录和 WebSocket 中数组一致，被提及用户收到一次提醒。
13. 重复 ID、空数组、空字符串、群外用户、已退群用户、已注销用户分别得到确定结果；预期业务错误均为 4xx，不能出现 5xx。
14. 同一 `client_message_id` 并发或串行重试只生成一条消息、一次未读和一次 mention 提醒。
15. 模拟 WebSocket、Redis、APNs 或提醒消费者不可用：消息事务按设计成功或返回明确可重试状态，但不能在已落库后返回不确定的 500 并造成重复消息。
16. 生产同版本数据库 schema migration 测试确认 mentions 列/关联表、索引和约束真实存在。

## 八、验收方式

1. 使用至少三个测试账号：群主、管理员、普通成员，分别携带真实 Token 请求同一群详情。
2. 在加入成员、修改角色、退出/踢人后重复请求并核对成员列表。
3. 对原故障群 ID 使用日志中的 request ID 定位并说明真实根因。
4. 提供修复前后的接口响应、状态码、延迟和 5xx 指标对比。
5. 与 iOS 联调：首次进入群聊、无本地缓存时输入 `@`，成员列表必须成功加载；断网或服务短暂失败时客户端可使用缓存，服务恢复后可刷新。
6. 与 iOS 联调发送 `@某某 测试`，以同一个 `client_message_id` 串起 HTTP、数据库消息、mentions 记录、outbox、WebSocket 和被提及用户的未读/提醒；接口不得返回 5xx。

## 九、交付内容

完成后请输出：

- 真实根因及触发条件。
- 修改的路由、服务、数据访问层、序列化器、缓存和数据库迁移文件。
- 最终请求/响应示例与错误码表。
- 索引、查询计划和 N+1 检查结果。
- 自动化测试与并发测试结果。
- 部署步骤、数据清理步骤、回滚方案和监控告警配置。
