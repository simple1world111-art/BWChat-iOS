# 后端实现 Prompt：群聊消息免打扰

你是 BWChat 后端工程师。请在现有群聊、会话、WebSocket、未读计数和 APNs 推送链路上实现“群聊消息免打扰”。必须保持旧客户端兼容，并以默认关闭的 `group_notification_settings_v1` 功能开关灰度发布。不要实现群公告或折叠聊天。

## 业务语义

- 设置按当前登录用户和群聊生效，不影响其他成员。
- 默认值：`muted=false`、`notify_mentions_me=true`、`notify_mentions_all=true`、`important_member_ids=[]`。
- 关闭再重新开启免打扰时，保留例外设置。
- 免打扰不影响消息接收和群会话自身的未读数，但免打扰会话的未读数不得计入“消息”Tab 红点或 App 图标角标。服务端应同时维护原始总未读数与排除免打扰会话后的 `badge_unread_count`。
- 群通话邀请、账号安全、风控及其他系统业务通知不受本设置影响。
- 正常 alert 的判定采用 OR 规则：`muted == false`，或消息直接 @ 当前用户且 `notify_mentions_me == true`，或消息是 @所有人且 `notify_mentions_all == true`，或发送者属于 `important_member_ids`。用户自己发送的消息不向自己推送。
- 免打扰且未命中例外的普通群消息不发横幅或声音；如需通过 APNs 校正图标角标，只能写入排除所有免打扰会话后的 `badge_unread_count`。命中例外时发送现有完整 alert，但图标角标仍使用 `badge_unread_count`。

## 数据库与一致性

新增群通知设置表，至少包含：

- `user_id`
- `group_id`
- `muted`
- `notify_mentions_me`
- `notify_mentions_all`
- `important_member_ids`（可用关联表或受约束的 JSON/数组）
- 单调递增的 `revision`
- `created_at`、`updated_at`

要求：

- 对 `(user_id, group_id)` 建唯一约束。
- PATCH 使用事务和行锁/乐观锁保证 `revision` 严格单调递增；响应必须返回提交后的完整状态。
- 重要成员 ID 去重，最多 4 个；必须都是该群当前有效成员，且不得包含设置者本人。
- 用户退出群、被移除或群解散时清理对应设置；重要成员退出时从所有相关设置中移除并递增受影响记录的 `revision`，随后向设置拥有者发送定向 WebSocket 更新。
- 接口重试应幂等。若项目已有幂等键规范，支持 `Idempotency-Key`；同一键、同一用户、同一路径和同一请求体返回同一结果。
- 数据库迁移要提供向前和回滚脚本；回滚不能影响消息、未读或群成员数据。

## HTTP API

### 查询

```http
GET /api/v1/groups/{group_id}/notification-settings
Authorization: Bearer <token>
```

### 部分更新

```http
PATCH /api/v1/groups/{group_id}/notification-settings
Authorization: Bearer <token>
Content-Type: application/json
```

请求体只允许出现以下字段，且只更新实际提供的字段：

```json
{
  "muted": true,
  "notify_mentions_me": true,
  "notify_mentions_all": true,
  "important_member_ids": ["user-1", "user-2"]
}
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "group_id": 42,
    "muted": true,
    "notify_mentions_me": true,
    "notify_mentions_all": true,
    "important_member_ids": ["user-1", "user-2"],
    "revision": 7,
    "updated_at": "2026-07-24T10:00:00Z"
  }
}
```

鉴权与错误：

- 两个接口都要求调用者是该群当前成员；否则不要泄露群或设置是否存在。
- 使用项目统一响应包络和错误码，同时补充可稳定识别的业务错误：非群成员、重要成员无效、超过 4 人、包含本人、非法字段/类型、revision 冲突（若采用客户端条件更新）。
- 空 PATCH 返回 400，未知字段返回 422；不要静默忽略拼写错误。

## 现有响应扩展

- `GET /api/v1/groups/{group_id}` 的 `data` 中加入完整 `notification_settings`，内容只属于当前登录用户。
- 会话列表与“我的群聊”列表的每个群条目加入当前用户的 `is_muted`。
- 新字段必须为追加字段；旧客户端缺少这些字段时仍能正常使用。

## @所有人消息协议

群文本发送接口正式支持：

```json
{
  "content": "@所有人 ...",
  "mentions": ["stable-user-id"],
  "mention_all": true
}
```

- `mention_all` 是独立布尔字段并持久化到消息记录、重试/幂等结果、WebSocket 和 APNs payload。
- 不得通过正文是否含“@所有人”判断；展示文本可以被编辑、翻译或包含同名普通文本。
- 只有群主或管理员可发送 `mention_all=true`。无权限时返回明确的 403 业务错误，不能降级成普通文本。
- `mentions` 继续仅保存稳定用户 ID；允许直接 @ 与 @所有人同时存在。

## WebSocket

设置成功后向同一用户的全部其他在线设备发送定向事件：

```json
{
  "type": "group_notification_settings_updated",
  "data": {
    "group_id": 42,
    "muted": true,
    "notify_mentions_me": true,
    "notify_mentions_all": false,
    "important_member_ids": ["user-1"],
    "revision": 8,
    "updated_at": "2026-07-24T10:02:00Z"
  }
}
```

- 客户端会按 `revision` 丢弃旧状态；服务端也必须保证同一设置记录的 revision 单调递增。
- 普通群消息的 WebSocket payload 与 APNs 自定义字段必须包含相同的 `message_id`、`group_id`、`sender_id`、`is_direct_mention`、`is_mention_all`、`notification_mode`、该会话 `unread_count`、原始 `total_unread_count` 和排除免打扰会话后的 `badge_unread_count`。
- `notification_mode` 仅使用 `alert` 或 `badge_only`。

## APNs

命中正常通知规则时，沿用现有完整通知（`aps.alert`、现有声音及必要扩展字段）。

免打扰普通消息必须发送 badge-only 的 alert push：

```json
{
  "aps": {
    "badge": 5
  },
  "message_id": 991,
  "group_id": 42,
  "sender_id": "user-9",
  "is_direct_mention": false,
  "is_mention_all": false,
  "notification_mode": "badge_only",
  "unread_count": 6,
  "total_unread_count": 23,
  "badge_unread_count": 5
}
```

- 不包含 `alert`、`sound`、`mutable-content`。
- `apns-push-type` 使用 `alert`，`apns-priority` 使用项目针对用户可见状态更新的既有规范；不要伪装为后台内容推送。
- `aps.badge` 必须等于事务提交后的最新 `badge_unread_count`，即所有非免打扰会话未读数之和；不能使用包含免打扰会话的 `total_unread_count`。当结果为 0 时必须明确下发 `0` 以清除旧角标。Apple 支持仅通过 `aps.badge` 更新 App 图标角标：https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
- badge-only 与 alert 两条链路必须共享同一消息 ID、未读事务结果和幂等去重键，防止双推或角标回退。

## 功能开关、监控与回滚

- `group_notification_settings_v1=false` 时：接口可以预上线，但列表不暴露开启态，消息通知完全沿用旧逻辑。
- 支持按用户/比例灰度；同一用户多设备必须得到一致分桶结果。
- 指标至少包含：GET/PATCH 成功率与延迟、设置分布、重要成员校验失败数、alert/badge-only 决策数、APNs 成功失败、WebSocket 设置同步数、revision 乱序/冲突数、未读与 badge 不一致数。
- 日志记录消息 ID、群 ID、接收用户的脱敏 ID、决策原因和 notification mode；不得记录消息正文、Token 或完整敏感标识。
- 回滚顺序：关闭功能开关恢复旧通知判定；保留设置表数据；必要时停止 WebSocket 设置事件和新字段输出。回滚不得停止消息接收或未读累计。

## 自动化测试与验收

请提交数据库迁移、服务实现、接口文档和完整自动化测试，至少覆盖：

1. 默认设置、部分 PATCH、空 PATCH、幂等重试、并发更新与 revision 单调性。
2. 非群成员鉴权；重要成员去重、本人排除、1–4 人、5 人拒绝、成员退出后的自动清理。
3. 群详情嵌入完整设置；会话/群列表 `is_muted`；旧客户端响应兼容。
4. 普通消息、直接 @、@所有人、两者同时存在、重要成员、自己发送消息的通知决策矩阵。
5. `mention_all` 权限、持久化、失败重试、WebSocket/APNs 一致性；确认绝不依赖正文判断。
6. 免打扰普通消息仍增加群会话未读和原始 `total_unread_count`，但不增加 `badge_unread_count`；badge-only payload 精确不含 `alert`、`sound`、`mutable-content`，且 `aps.badge == badge_unread_count`。
7. alert 与 badge-only APNs header、payload、消息 ID、未读计数和去重行为。
8. 多设备设置同步、乱序 revision 丢弃、离线重连后 GET 收敛。
9. 功能开关关闭、分批灰度、监控告警和回滚演练。

完成后请给出：迁移文件、核心代码与测试文件清单，接口示例，通知决策真值表，灰度/回滚操作步骤，以及三账号多设备联调所需的测试数据。
