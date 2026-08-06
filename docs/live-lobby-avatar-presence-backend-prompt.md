# 直播大厅头像与在线状态后端实施 Prompt

你是本项目的后端工程 Agent。请在不破坏现有一对一直播、视频邀请、钱包计费和旧客户端兼容性的前提下，完成“直播专用头像 + 忙碌主播继续展示”的后端改造。请先阅读现有一对一直播的数据模型、REST 接口、WebSocket 事件、RTC/LiveKit 房间状态机、钱包流水和测试，再做增量修改；不要重写无关模块。

## 目标行为

1. 主播开启直播时可以选择一个仅用于本次直播席位的正方形头像；没有选择时，客户端继续使用用户个人头像。
2. 大厅返回所有未结束席位，而不仅是 `waiting`：
   - `waiting`：空闲，可发起邀请；
   - `inviting`：正在处理邀请，不可发起新邀请；
   - `connecting`：正在建立连接，不可发起新邀请；
   - `in_call`：正在通话，不可发起新邀请；
   - `ended`：已结束，不出现在大厅。
3. 大厅和 WebSocket 必须保留忙碌主播，使客户端能用黄点或红点展示，而不是把卡片删除。
4. 头像、状态和席位信息在 REST、WebSocket、当前席位查询及恢复流程中保持一致。

## 一、数据模型

为一对一直播席位增加可空字段：

- `live_avatar_asset_id`
- 与资源记录的归属关系、创建时间和清理状态

API 中返回：

```json
{
  "id": "slot-id",
  "status": "waiting",
  "character_setting": "本次直播的人物设定",
  "live_avatar_url": "https://cdn.example.com/...",
  "user": {
    "user_id": "user-id",
    "username": "username",
    "nickname": "nickname",
    "avatar_url": "https://cdn.example.com/profile-avatar.jpg",
    "gender": "female"
  }
}
```

要求：

- `live_avatar_url` 是席位级字段，不要覆盖 `user.avatar_url`。
- 未绑定直播头像时，`live_avatar_url` 返回 `null`、空字符串或省略均可；不要复制个人头像 URL 到该字段。
- 状态枚举至少支持 `waiting | inviting | connecting | in_call | ended`。
- 数据库迁移必须可回滚，新增字段允许为空，不影响历史记录。
- 服务端必须拒绝客户端直接提交任意 URL；创建席位时只能引用当前登录用户拥有的直播头像资源。

## 二、直播头像上传接口

新增：

```http
POST /one-to-one-live/assets/avatar
Content-Type: multipart/form-data
Authorization: Bearer ...
Idempotency-Key: <uuid>
```

multipart 字段名固定为：

```text
file
```

成功响应沿用项目统一响应包装，`data` 内容为：

```json
{
  "asset_id": "asset-id",
  "live_avatar_url": "https://cdn.example.com/live-avatar.jpg"
}
```

实现要求：

- 必须登录；资源记录绑定当前用户，并标记用途为一对一直播头像。
- 支持 JPEG/PNG 等项目允许的图片格式，校验 MIME、真实文件内容、像素尺寸和文件大小，拒绝伪造扩展名及解码失败文件。
- 客户端会上传正方形、最长边不超过 1024px、约 1MB 的 JPEG，但服务端仍需自行解码、移除元数据、重新编码并生成安全文件名。
- 建议限制原始上传不超过 5MB、像素总量不超过安全阈值；最终资源限制为 1024×1024 以内。
- URL 的访问控制、签名和 CDN 缓存策略应与现有用户头像保持一致。
- 同一用户使用相同 `Idempotency-Key` 重试时必须返回同一上传结果，不得生成重复资源。
- 幂等记录需要校验请求摘要，禁止同一 Key 携带不同文件。
- 未被席位引用的孤儿资源应在合理窗口（建议 24 小时）后清理；被席位引用的资源按直播记录保留策略延迟清理，避免历史/审计记录立刻失效。
- 上传失败不得创建半成品资源；对象存储成功、数据库写入失败等场景需要补偿清理。

## 三、创建席位

扩展现有接口：

```http
POST /one-to-one-live/slots
Idempotency-Key: <uuid>
Content-Type: application/json
```

请求体新增可选字段：

```json
{
  "character_setting": "人物设定",
  "live_avatar_asset_id": "asset-id"
}
```

要求：

- 字段缺失时保持现有创建流程，兼容旧客户端。
- 传入资源时验证：资源存在、归当前登录用户所有、用途正确、未被删除且可用。
- 禁止绑定其他用户资源，失败时返回明确的 4xx 业务错误。
- 创建接口的幂等语义需覆盖头像绑定：同一 Key 重试返回同一席位；同一 Key 的请求内容变化应拒绝。
- 若当前用户已有未结束席位，沿用现有幂等/冲突规则，不创建第二个活动席位。
- 创建成功的完整席位快照必须包含 `live_avatar_url` 和真实 `status`。

## 四、大厅和当前席位接口

扩展：

```http
GET /one-to-one-live/slots
```

要求：

- 返回 `waiting`、`inviting`、`connecting`、`in_call`，只排除 `ended`。
- 页面级返回能力标记：

```json
{
  "items": [],
  "live_avatar_upload_supported": true
}
```

- 后端上传、创建绑定、列表字段、WebSocket 和状态恢复全部上线且验证通过之前，标记必须保持 `false`；缺失该字段的旧后端会被客户端按 `false` 处理。
- 每个席位都返回 `live_avatar_url` 和真实状态。
- 当前席位查询、心跳响应、邀请/接受/加入/状态查询中凡是返回席位快照的地方，也必须返回相同字段。
- 列表采用确定性排序。建议 `waiting` 在前，其后为 `inviting`、`connecting/in_call`，组内使用稳定的 `created_at + id` 次序。客户端还会二次稳定分组排序。
- 分页时排序必须稳定，避免状态变化导致重复或永久漏项；如果现有 offset 分页无法满足，优先使用游标。
- 旧客户端仍可正常解码响应；未知字段不得影响旧客户端。

## 五、状态机与并发

状态转换至少覆盖：

```text
waiting -> inviting -> connecting -> in_call -> waiting
waiting -> inviting -> waiting
任意未结束状态 -> ended
```

要求：

- 一个席位同一时刻只允许一个有效邀请或通话。
- 从 `waiting` 抢占到 `inviting` 必须使用数据库条件更新、锁或等价原子机制；并发邀请只有一个成功，其余返回可识别的“主播忙碌”冲突。
- 邀请拒绝、取消或超时后恢复 `waiting`。
- 建连失败、通话正常结束、异常断开和服务端超时回收后，若主播仍选择挂在大厅，则恢复 `waiting`；主播主动退出则进入 `ended`。
- `connecting/in_call` 期间心跳不得误将席位过期或从大厅删除。
- `inviting` 超时、RTC 房间异常、进程重启后必须有可重复执行的恢复任务，避免席位永久卡在忙碌状态。
- 状态写入和 WebSocket 广播要有单调版本号或可靠的 `updated_at`，避免旧事件覆盖新状态。

## 六、WebSocket 契约

沿用现有事件名；对于 created/updated 类事件，发送完整 slot 快照：

```json
{
  "event": "one_to_one_live_slot_updated",
  "data": {
    "slot": {
      "id": "slot-id",
      "status": "in_call",
      "character_setting": "...",
      "live_avatar_url": "https://cdn.example.com/...",
      "user": {}
    },
    "version": 12,
    "updated_at": "2026-07-24T12:00:00Z"
  }
}
```

要求：

- `waiting -> inviting -> connecting -> in_call -> waiting` 每次变化都广播更新事件，不能用删除事件表达忙碌。
- 只有 `ended` 才广播结束/删除语义事件。
- 结束事件至少包含 `slot_id`、`user_id`、最终状态、版本或更新时间。
- 断线重连后的 REST 快照必须能完整恢复所有未结束席位；事件丢失不能造成忙碌卡片永久消失。
- 多实例部署时保证同一席位事件顺序，或提供版本让客户端丢弃旧事件。
- 不得在头像 URL 或事件载荷中泄露内部对象存储路径、用户隐私字段或上传元数据。

## 七、隐私与安全

- 直播头像仅对能访问直播大厅/席位详情的用户返回，遵循现有封禁、拉黑、注销、内容审核和地区可见性规则。
- 若用户或资源被审核下架，返回安全占位或清空 `live_avatar_url`，并及时广播新快照。
- 对头像上传执行与用户头像同等级别的鉴权、内容安全检查、限流和审计。
- 日志不得记录图片二进制、签名 URL 查询参数或完整鉴权头。
- 资源删除必须确认没有仍需展示或审计的席位引用。

## 八、错误码和兼容性

请定义并记录稳定错误码，至少覆盖：

- 不支持或未开启直播头像上传；
- 文件格式/尺寸/大小不合法；
- 上传幂等冲突；
- 资源不存在、已失效或不属于当前用户；
- 已有活动席位；
- 主播非空闲、并发邀请失败；
- 状态转换冲突。

兼容要求：

- 旧客户端未传 `live_avatar_asset_id` 时行为完全不变。
- 新字段全部采用向后兼容的可选响应字段。
- 旧客户端如果只展示 `waiting`，可以继续自行过滤忙碌席位。
- 不修改本次需求之外的音视频计费、Agent 自动匹配和钱包流水语义。

## 九、自动化测试

至少增加以下测试：

1. 上传横图/竖图/JPEG/PNG，服务端安全转码成功。
2. 非图片、超大文件、像素炸弹、损坏内容和伪造 MIME 被拒绝。
3. 同一幂等 Key 重试返回同一资源，不同内容复用 Key 被拒绝。
4. 用户 A 不能把用户 B 的资源绑定到自己的席位。
5. 不传资源创建席位成功并保持旧响应兼容。
6. 带资源创建席位后，大厅、当前席位和 WebSocket 都返回同一 `live_avatar_url`。
7. 大厅同时包含 `waiting/inviting/connecting/in_call`，不包含 `ended`。
8. 并发邀请只有一次从 `waiting` 转入 `inviting`。
9. 拒绝、超时、建连失败和挂断后正确恢复 `waiting`。
10. 忙碌期间心跳不会删除席位；主动结束会删除并广播 ended。
11. WebSocket 乱序或重复投递时，版本控制阻止状态回退。
12. 孤儿上传清理、被引用资源保留和对象存储补偿任务可重复执行。
13. 能力标记为 `false` 时旧流程可用；整套能力就绪后才返回 `true`。

## 十、发布顺序

按以下顺序灰度发布：

1. 数据库字段和资源表迁移，先写兼容读取逻辑。
2. 上线上传接口、资源归属校验、创建席位可选绑定和清理任务。
3. 上线所有 REST/当前席位/WebSocket 的头像与真实状态字段。
4. 验证大厅返回忙碌席位、状态恢复和旧客户端兼容性。
5. 完成监控与告警后，将 `live_avatar_upload_supported` 从 `false` 灰度切为 `true`。
6. 再发布或放量客户端直播头像入口。

上线监控至少包含：上传成功率与耗时、转码失败、孤儿资源数量、状态停留时长、邀请冲突率、忙碌状态恢复失败、WebSocket 事件延迟与乱序、列表中各状态席位数量。

## 交付要求

- 提供数据库迁移、接口实现、状态机修改、WebSocket 修改和自动化测试。
- 更新 OpenAPI/接口文档，给出新旧响应示例。
- 列出改动文件、测试命令与结果、灰度开关位置、回滚步骤。
- 明确说明幂等、并发、资源清理、隐私过滤和旧客户端兼容的实现方式。
- 不要只给方案；请完成代码实现并验证。
