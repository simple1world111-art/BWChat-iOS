# 后端实现 Prompt：群聊信息页 v2、邀请、公告、搜索与个人偏好

你是 BWChat 后端项目的资深工程师。请直接在现有仓库中检查群聊、消息、会话列表、JWT 鉴权、WebSocket、数据库迁移、功能开关和自动化测试实现，然后完成本 Prompt 的全部服务端工作。不要只给设计建议；请提交可运行代码、迁移、测试和接口文档。

必须保持旧客户端兼容，沿用项目现有 `/api/v1` 前缀、`{code,message,data}` 响应包络、JWT 身份、稳定错误码、时间格式、分页约定、幂等键、日志脱敏和事务工具。客户端请求中的用户 ID 绝不能替代 JWT 当前用户。

## 0. 实现前先检查和复用

先定位并复用以下现有实现，不得建立第二套不兼容协议：

1. `GET /api/v1/groups/{group_id}`、`GET /api/v1/groups/list`、`GET /api/v1/chat/conversations` 的查询和序列化。
2. 群主、管理员、普通成员的服务端权限判断，以及加人、移人、改群名、公开/私密、退群和解散群聊链路。
3. 群消息表、消息类型枚举、历史分页、单条消息上下文接口、WebSocket 群消息及系统消息实现。
4. [conversation-list-actions-backend-prompt.md](./conversation-list-actions-backend-prompt.md) 已定义的会话偏好接口：
   `PUT /api/v1/chat/conversations/{conversationType}/{targetID}/preferences`。置顶必须继续使用该接口和同一张偏好表。
5. [group-chat-notification-settings-backend-prompt.md](./group-chat-notification-settings-backend-prompt.md) 已定义的群免打扰接口、`group_notification_settings_v1` 开关、revision 与定向 WebSocket 语义。不要重定义免打扰协议。
6. 项目现有数据库迁移/回滚机制、幂等中间件、限流、审计日志、指标和测试夹具。

如果现有路径与本文建议略有不同，可以在保持 iOS 当前调用兼容的前提下复用，但最终必须列出精确路径和字段映射。

## 1. 业务目标和发布开关

实现以下能力：

- viewer-specific 群显示名：正式群名不变，当前账号可设置仅自己可见的群备注；会话列表和聊天页对该账号返回备注后的显示名。
- 群成员公开昵称：成员可设置自己的 `group_nickname`，显示优先级为群昵称、资料昵称、用户 ID。
- 群公告：所有当前成员可读；群主/管理员可编辑；每次编辑写入系统消息并保留审计。
- 7 天有效、可撤销的群二维码邀请，使用 HTTPS Universal Link。
- 全历史消息搜索和稳定消息定位。
- 当前账号所有设备同步的群历史清空水位，只影响本人。
- 群投诉，不默认上传聊天记录。
- 会话置顶、群免打扰、个人备注和“显示成员昵称”跨设备同步。

采用远程开关：

```text
group_info_v2                      总开关
group_invite_qr_v1                 邀请子开关
group_announcement_v1              公告子开关
group_message_search_v1            搜索子开关
group_viewer_settings_v1           个人设置和群昵称子开关
group_history_clear_v1              清空子开关
group_reporting_v1                  投诉子开关
group_notification_settings_v1      继续复用既有免打扰开关
conversation_preferences_v1         继续复用既有会话偏好开关
```

要求：

- 所有开关默认关闭；支持按用户稳定分桶/百分比灰度，同一账号所有设备得到相同结果。
- `group_info_v2=false` 时保持现有详情、消息、会话列表和 WebSocket 行为。
- 子开关关闭时对应写接口返回稳定的 feature-disabled 错误；旧字段和已有能力不受影响。
- 关闭开关是第一回滚手段，不删除新表数据。

## 2. 权限矩阵（必须在服务端执行）

| 操作 | 群主 | 管理员 | 普通成员 |
|---|---:|---:|---:|
| 查看群详情、成员、公告 | 允许 | 允许 | 允许 |
| 修改正式群名 | 允许 | 允许 | 禁止 |
| 修改公告 | 允许 | 允许 | 禁止 |
| 添加成员 | 允许 | 允许 | 禁止 |
| 移除普通成员 | 允许 | 允许 | 禁止 |
| 移除群主/管理员 | 本期禁止 | 本期禁止 | 禁止 |
| 修改公开/私密 | 允许 | 禁止 | 禁止 |
| 解散群聊 | 允许 | 禁止 | 禁止 |
| 创建公开群邀请 | 允许 | 允许 | 允许 |
| 创建私密群邀请 | 允许 | 允许 | 禁止 |
| 设置个人群备注/成员昵称显示 | 允许 | 允许 | 允许 |
| 修改本人群昵称 | 允许 | 允许 | 允许 |
| 搜索消息/清空本人历史/投诉/退出 | 允许 | 允许 | 允许 |

管理员不能任命管理员、转让群主或修改其他管理员角色；本期不要新增这些接口。非成员访问群详情、搜索、公告、个人设置和历史清空时，使用项目统一的“不存在或无权限”响应，避免泄露私密群信息。

## 3. 数据库迁移

表名可按项目规范调整，但语义和约束必须完整。

### 3.1 群公告与审计

```text
group_announcements
- group_id PK/FK
- title
- content
- updated_by_user_id
- revision BIGINT NOT NULL
- created_at
- updated_at

group_announcement_audits
- id
- group_id
- actor_user_id
- previous_title / previous_content
- new_title / new_content
- resulting_revision
- created_at
```

- `revision` 每次成功更新严格单调递增。
- 审计记录不可被普通业务接口修改。
- 公告正文和标题长度使用明确限制并统一校验。

### 3.2 Viewer 设置和群昵称

```text
group_viewer_settings
- user_id
- group_id
- remark
- show_member_nicknames BOOLEAN DEFAULT TRUE
- cleared_before_sequence BIGINT NULL
- revision BIGINT NOT NULL
- created_at
- updated_at
- UNIQUE(user_id, group_id)

group_members 增加：
- group_nickname NULL
- member_revision BIGINT NOT NULL DEFAULT 0
```

- `remark` 仅设置者可读；绝不出现在其他成员响应、日志或群事件中。
- `show_member_nicknames` 默认 `true`。
- 用户退出/被移除/群解散时按现有保留策略清理或归档 viewer 设置；无论选择哪种策略都要防止重新入群后泄露旧私密数据，并写测试。
- 群昵称可为空，长度、Unicode 规范化和敏感词规则复用资料昵称。

### 3.3 消息序列和个人清空水位

群消息增加：

```text
history_sequence BIGINT NOT NULL
UNIQUE(group_id, history_sequence)
```

- 每个群内单调递增；必须在消息写入事务中分配，不得由客户端提交。
- 为所有现有群消息确定性回填，顺序至少使用稳定的 `(created_at, message_id)`，迁移后建立非空和唯一约束。
- 新消息、历史列表、搜索结果、上下文接口、WebSocket 及补拉结果都返回 `history_sequence`。
- `group_viewer_settings.cleared_before_sequence` 是当前用户已清空的最大序列，单调不减。
- 所有历史读取、搜索和上下文查询必须自动追加 `history_sequence > cleared_before_sequence`；不能依赖客户端过滤。

### 3.4 邀请、投诉和会话偏好

```text
group_invites
- id (公开稳定 ID)
- group_id
- created_by_user_id
- token_hash UNIQUE
- expires_at
- revoked_at NULL
- accepted_count
- created_at

group_reports
- id
- reporter_user_id
- group_id
- reason ENUM(spam,fraud,harassment,inappropriate,other)
- detail NULL
- status / moderation fields（按现有审核系统）
- created_at
- dedupe_key / idempotency_key
```

- 数据库只保存邀请令牌的强哈希/HMAC 摘要，不保存可直接使用的明文令牌。
- 继续复用既有 `conversation_preferences`，不要为置顶建立第二张表。
- 建立群成员检查、搜索、过期邀请清理、用户设置和审计查询需要的索引。
- 提供向前迁移、可演练回滚和大表在线迁移方案；回滚不得删除群消息。

## 4. 群详情和列表响应

扩展以下响应，新增字段均为追加字段，旧客户端可忽略：

- `GET /api/v1/groups/{group_id}`
- `GET /api/v1/groups/list`
- `GET /api/v1/chat/conversations`

群详情 `data` 至少返回：

```json
{
  "group_id": 42,
  "name": "正式群名",
  "display_name": "当前用户备注或正式群名",
  "avatar_url": "https://...",
  "creator_id": "owner-1",
  "is_public": false,
  "members": [{
    "user_id": "member-1",
    "nickname": "资料昵称",
    "group_nickname": "群内昵称",
    "avatar_url": "https://...",
    "role": "owner|admin|member"
  }],
  "current_member": {
    "user_id": "viewer-1",
    "nickname": "资料昵称",
    "group_nickname": "群内昵称",
    "avatar_url": "https://...",
    "role": "member"
  },
  "viewer_settings": {
    "group_id": 42,
    "remark": "我的备注",
    "show_member_nicknames": true,
    "cleared_before_sequence": 1200,
    "revision": 8,
    "updated_at": "2026-07-31T10:00:00Z"
  },
  "announcement": {
    "id": "announcement-42",
    "group_id": 42,
    "title": "群规",
    "content": "请友善交流",
    "updated_by_id": "owner-1",
    "updated_by_nickname": "群主",
    "revision": 4,
    "updated_at": "2026-07-31T10:00:00Z"
  },
  "permissions": {
    "can_manage_members": false,
    "can_edit_group": false,
    "can_edit_announcement": false,
    "can_create_invite": false,
    "can_change_visibility": false,
    "can_dismiss_group": false
  },
  "notification_settings": {}
}
```

- `permissions` 必须由服务端依据当前 JWT 用户、当前群角色和公开状态计算，客户端不可指定。
- 无公告时 `announcement` 返回 `null`。
- `groups/list` 和 `chat/conversations` 对群条目返回 viewer-specific `display_name`（若旧字段 `name` 是 UI 唯一来源，可同时将 `name` 设置为 viewer display name，并额外返回 `canonical_name`）；文档中明确最终映射。
- 会话条目继续返回现有 `is_pinned`、`pinned_at`、`is_muted`；服务端排序继续遵守现有会话偏好协议。

## 5. Viewer 设置和本人群昵称

### 5.1 更新 viewer 设置

```http
PATCH /api/v1/groups/{group_id}/viewer-settings
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "remark": "我的群备注",
  "show_member_nicknames": false
}
```

- 字段均可选，但至少提供一个；空 PATCH 返回 400，未知字段返回 422。
- `remark=""` 表示清除备注。
- 使用事务/upsert，`revision` 每次实际状态变化后递增；无变化重试返回当前状态。
- 返回完整 `viewer_settings` 对象。
- 成功后向该用户的其他设备定向发送 `group_viewer_settings_updated`，不广播给群成员。

### 5.2 更新本人群昵称

```http
PATCH /api/v1/groups/{group_id}/members/me
Authorization: Bearer <jwt>
Content-Type: application/json

{"nickname":"群内昵称"}
```

- 空字符串表示清除群昵称。
- 只允许修改当前成员本人；成功返回完整 `GroupMember`。
- 更新 `member_revision` 后向群内在线成员广播 `group_member_updated`。

## 6. 群公告

```http
PUT /api/v1/groups/{group_id}/announcement
Authorization: Bearer <jwt>
Content-Type: application/json

{"title":"群规","content":"请友善交流"}
```

- 仅群主/管理员。
- 在同一事务中更新公告、写审计、递增 revision，并创建一条现有消息系统中的群系统消息。
- 幂等重试不能重复生成系统消息；使用 `Idempotency-Key` 或项目等价机制。
- 成功返回完整公告并广播 `group_announcement_updated`。

## 7. 群二维码邀请和 Universal Link

### 7.1 创建邀请

```http
POST /api/v1/groups/{group_id}/invites
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>
Content-Type: application/json

{"expires_in_days":7}
```

- 服务端固定有效期 7 天；若客户端传其他值，拒绝或规范化为 7，文档中明确。
- 公开群任意当前成员可创建；私密群仅群主/管理员。
- 生成至少 128 bit 随机熵的签名/随机令牌，仅返回一次明文。
- 返回 HTTPS Universal Link，示例 `https://chat.example.com/group-invites/<token>`；配置 Apple `apple-app-site-association`，路径必须与最终域名一致。

```json
{
  "invite_id":"invite-1",
  "group_id":42,
  "invite_url":"https://chat.example.com/group-invites/token",
  "expires_at":"2026-08-07T10:00:00Z",
  "created_at":"2026-07-31T10:00:00Z",
  "revoked_at":null
}
```

### 7.2 撤销

```http
DELETE /api/v1/groups/{group_id}/invites/{invite_id}
Authorization: Bearer <jwt>
```

- 创建者、群主或管理员可撤销；重复撤销幂等。
- iOS 当前接受成功 `204 No Content`；如必须返回 JSON，也要同时兼容 204 或与 iOS 协商更新。

### 7.3 预览与接受

```http
GET  /api/v1/group-invites/{token}
POST /api/v1/group-invites/{token}/accept
Authorization: Bearer <jwt>
```

预览返回：

```json
{
  "token":"可省略，不应写日志",
  "group_id":42,
  "group_name":"正式群名",
  "avatar_url":"https://...",
  "member_count":377,
  "inviter_nickname":"邀请人",
  "expires_at":"2026-08-07T10:00:00Z",
  "is_member":false,
  "can_join":true
}
```

接受返回 `{"group_id":42,"already_member":false}`。

- 验证签名/哈希、过期、撤销、群状态和当前账号。
- 已入群用户预览时 `is_member=true`，接受接口幂等返回 `already_member=true`，客户端直接打开群聊。
- 并发接受使用事务和成员唯一约束，绝不重复入群。
- 令牌不得出现在日志、监控标签、Referer、分析事件或错误堆栈中。
- 对创建、预览、接受和失败尝试分别限流；防止令牌枚举。

## 8. 全历史搜索与稳定定位

```http
GET /api/v1/groups/{group_id}/messages/search
Authorization: Bearer <jwt>

?q=关键词
&sender_id=user-1
&message_type=text
&from=2026-07-01T00:00:00Z
&to=2026-07-31T23:59:59Z
&cursor=opaque
&limit=30
```

- `q` 可为空，但关键词、发送者、类型、日期至少有一个条件；否则返回 400。
- `message_type` 只接受项目现有消息类型枚举；不要创建仅供搜索的新枚举。
- 日期为 UTC ISO-8601，明确含/不含边界。
- 游标必须不透明、稳定，排序使用 `(history_sequence DESC, message_id DESC)` 或等价稳定顺序；限制 `1...100`。
- 结果只能来自当前群且调用者当前可访问，并必须满足当前用户 `history_sequence > cleared_before_sequence`。
- 搜索正文时遵循现有加密/索引策略；不要把消息正文写入日志或指标标签。

响应：

```json
{
  "results": [{
    "message": {
      "id":9001,
      "group_id":42,
      "sender_id":"member-1",
      "msg_type":"text",
      "content":"命中的消息",
      "timestamp":"2026-07-31T10:00:00Z",
      "sender_nickname":"群昵称优先",
      "sender_avatar":"https://...",
      "history_sequence":8800
    },
    "locator":{"message_id":9001,"history_sequence":8800},
    "highlighted_text":"可选安全摘要"
  }],
  "next_cursor":"opaque-or-null",
  "has_more":true
}
```

现有消息上下文接口必须接受/使用稳定 `message_id`，返回目标前后消息并同样过滤清空水位。如果目标已在水位以下，返回稳定的 history-cleared/not-found 业务错误，不得把旧消息重新下发。

## 9. 清空当前账号的群历史

```http
DELETE /api/v1/groups/{group_id}/messages/history
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>
```

事务语义：

1. 验证当前群成员。
2. 读取该群事务提交点之前的最大 `history_sequence`。
3. 原子地将当前用户水位更新为 `max(existing, current_max)`，递增 viewer revision。
4. 不删除全局群消息，不影响其他成员，不退出群聊。
5. 后续新消息序列大于水位，继续正常显示。

响应：

```json
{
  "group_id":42,
  "cleared_before_sequence":8800,
  "cleared_at":"2026-07-31T10:00:00Z",
  "revision":12
}
```

- 接口幂等；相同键返回首次结果，重复无新消息时返回同一水位。
- 将 `group_history_cleared` 仅投递给当前用户的全部其他设备。
- 历史列表、补拉、重连、搜索、引用上下文和媒体索引都必须遵守水位，确保旧记录不会复现。

## 10. 投诉

```http
POST /api/v1/groups/{group_id}/reports
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>
Content-Type: application/json

{"reason":"spam|fraud|harassment|inappropriate|other","detail":"可选说明"}
```

- 当前群成员可提交；验证固定枚举和说明长度。
- 默认只保存群 ID、投诉人、分类、说明和审计元数据，不上传消息正文、附件或本地聊天记录。
- 若审核系统需要证据，必须另行设计用户明确选择并确认的上传流程，不得在本接口暗中采集。
- 使用幂等、单用户/单群限流和滥用检测；成功可返回空 `data`。

## 11. WebSocket 事件

所有事件包含顶层 `event_id`（全局唯一）、`type`、`data`；状态类 `data` 包含实体 ID、严格单调的 `revision` 和 `updated_at`。客户端会按实体 revision 丢弃乱序事件，服务端必须保证同一实体提交顺序与 revision 一致。

### `group_announcement_updated`

向群内当前在线成员广播完整公告对象。

### `group_member_updated`

向群内当前在线成员广播：

```json
{"group_id":42,"member":{...完整 GroupMember...},"revision":9,"updated_at":"..."}
```

### `group_viewer_settings_updated`

只向设置拥有者的其他设备发送完整 `viewer_settings`，绝不广播备注。

### `group_history_cleared`

只向执行清空的用户设备发送完整清空响应。

### `conversation_preferences_updated`

继续复用现有会话偏好实体：

```json
{
  "conversation_type":"group",
  "target_id":"42",
  "is_pinned":true,
  "is_hidden":false,
  "revision":15,
  "updated_at":"2026-07-31T10:00:00Z"
}
```

仅投递给偏好拥有者的其他设备。免打扰继续使用既有 `group_notification_settings_updated`。

事件要求：

- 使用事务 outbox 或现有可靠投递机制，避免数据库已提交但事件永久丢失。
- 重连后的 HTTP 快照是最终真相；事件重复可安全应用。
- 禁止在个人事件中携带其他用户的私密设置。

## 12. 幂等、并发、限流和安全

- 所有写接口采用项目现有 `Idempotency-Key` 规范；键按用户、方法、路径和请求体摘要隔离，过期策略写入文档。
- PATCH/PUT 使用事务、行锁或乐观锁保证 revision 单调；重复请求不生成重复系统消息、邀请、成员或投诉。
- 权限在事务内再次校验，避免管理员被降级/成员退出后的 TOCTOU。
- 输入统一做长度、类型、Unicode、控制字符和富文本安全校验。
- 日志只记录脱敏用户 ID、群 ID、invite ID、message ID、revision、结果和延迟；不记录 JWT、邀请令牌、备注、公告正文、搜索词、消息正文或投诉说明。
- 建议限流：设置更新、昵称/公告更新、邀请创建/接受、搜索、清空、投诉分别配置，并输出最终值。
- 对邀请枚举、搜索爬取、投诉轰炸建立安全指标和告警。

## 13. 监控、迁移和回滚

至少提供：

- 每个新增接口的请求量、成功率、4xx/5xx、P50/P95/P99 延迟。
- 邀请创建/预览/接受/过期/撤销、令牌校验失败和限流计数。
- 搜索查询量、无结果率、分页深度、超时和索引延迟。
- 清空请求、水位单调性冲突、被过滤消息数、清空后旧消息泄漏检测。
- 各 WebSocket 事件投递/重试/积压、revision 乱序和跨设备收敛时间。
- 公告审计、昵称更新、投诉分类与审核积压（敏感内容不得作指标标签）。

迁移步骤必须包括：影子字段/双写（如需要）、`history_sequence` 分批回填、校验、建立约束、开启读路径、灰度开关、回滚演练。回滚顺序：关闭子开关，再关闭 `group_info_v2`，停止新事件/新读路径；保留数据表和序列，不回滚或删除群消息。

## 14. 自动化测试和验收

至少覆盖：

1. 旧版/新版群详情响应兼容；无新记录时默认 viewer 设置安全。
2. 群主、管理员、普通成员和公开/私密群的完整权限矩阵；所有越权均由服务端拒绝。
3. 正式群名、个人备注、群昵称的显示优先级，以及备注绝不泄露给他人。
4. viewer PATCH 的部分更新、空请求、未知字段、并发、幂等和 revision 单调。
5. 公告更新、审计、系统消息、幂等重试和 WebSocket 广播。
6. 邀请随机性、哈希存储、固定 7 天、撤销/过期、公开/私密权限、重复接受和并发接受。
7. Universal Link 响应、已入群直接打开语义、无效令牌不泄露信息。
8. 搜索关键词、发送者、现有消息类型、日期、组合筛选、游标分页、稳定定位和非法参数。
9. 清空水位原子性、账号/群隔离、多设备同步；历史加载、搜索、上下文、补拉和重连后旧记录绝不复现。
10. 清空同时新消息到达的事务边界；新消息继续显示且不会被错误过滤。
11. 投诉枚举、说明限制、幂等、限流、跨用户隔离，以及请求不包含消息正文。
12. 会话置顶和免打扰继续遵循既有接口；多设备事件乱序后以最高 revision 收敛。
13. 所有功能开关关闭、逐步灰度、数据库回滚和事件 outbox 重试。
14. 日志脱敏测试：令牌、备注、搜索词、公告/消息正文、投诉说明均不能出现。

## 15. 最终交付格式

完成实现后请输出：

1. 修改/新增的迁移、模型、路由、服务、查询、WebSocket 和测试文件清单。
2. 最终权限矩阵和所有功能开关默认值。
3. 每个接口的真实 curl 请求及成功/失败响应样例。
4. `history_sequence` 回填验证数据、迁移耗时、锁影响和回滚步骤。
5. WebSocket 事件真实样例及定向/广播范围。
6. 自动化测试、静态检查、迁移测试命令与完整结果。
7. 监控面板、告警阈值、灰度步骤和回滚演练结果。
8. 与 iOS 当前字段/路径的任何差异及明确联调映射；不允许把未实现项留作模糊 TODO。
