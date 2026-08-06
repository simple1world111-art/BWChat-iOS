# 一对一直播视频邀请弹窗可靠投递——后端实施 Prompt

你是一名资深后端与实时通信工程师。请直接在 BWChat 后端仓库中定位并修复“一对一直播的主播端偶发或持续收不到视频邀请弹窗”的问题。请提交可运行代码、数据库迁移（如需要）、自动化测试、WebSocket/REST 契约文档和联调日志字段，不要只给分析或伪代码。

## 目标与边界

- 用户从直播大厅点击详情页中的“确认视频”后，主播所有当前有效客户端必须在邀请有效期内收到邀请。
- 正式 WebSocket 事件只能使用 `one_to_one_live.call_invite`，不得把直播邀请伪装成普通好友通话 `call_invite`。
- iOS 已临时兼容旧 `call_invite + slot_id` 以及部分嵌套负载，但这只是灰度兼容，不是新的正式协议。
- 普通好友语音/视频通话、群通话、Agent 自动匹配和现有计费规则不得回归。

## 必须先排查并输出根因证据

请沿 `POST /one-to-one-live/slots/{slot_id}/invite` 的完整链路记录并核对：

1. 邀请事务是否真实创建了新的 `call_id`，slot 是否从 `waiting` 原子变为 `inviting`。
2. WebSocket 收件人是否为该 slot 的真实主播 `host_user_id`，不能误发给 caller、旧连接或上一次登录用户。
3. 事件是否在数据库事务提交前发送，导致消费者收到后查询不到邀请，或事务回滚但事件已丢失。
4. 事件是否因错误的用户对、slot、event type 或上一通 call 的去重键被抑制。
5. 主播多端登录、WebSocket 重连、App 前后台切换时，连接注册表是否仍指向有效 user identity。
6. 网关是否修改了事件名、把 `data` 二次 JSON 字符串化，或改成了 `payload/invitation/caller` 嵌套结构。
7. 事件发布失败时是否只写日志但仍向 caller 返回成功。

日志必须能用 `call_id`、`slot_id`、`caller_id`、`host_id`、`event_id` 串联“创建、提交、入 outbox、投递、确认/重试、终态”，且不得记录 token 或敏感凭据。

## 正式 WebSocket 契约

主播端邀请事件固定为：

```json
{
  "type": "one_to_one_live.call_invite",
  "data": {
    "event_id": "evt_live_invite_unique",
    "call_id": "call_live_unique",
    "slot_id": "slot_host",
    "caller_id": "u_caller",
    "caller_username": "Ming",
    "caller_avatar_url": "https://example.com/avatar.jpg",
    "character_setting": "调用方本次可展示的人物设定或空字符串",
    "call_type": "video",
    "billing_policy": {
      "currency": "cat_food",
      "free_seconds": 10,
      "unit_seconds": 60,
      "amount_per_unit": 100,
      "minimum_starting_balance": 100,
      "rounding": "started_unit"
    },
    "created_at": "2026-07-26T12:00:00Z",
    "expires_at": "2026-07-26T12:00:15Z"
  }
}
```

要求：

- `call_id`、`slot_id`、`caller_id`、`call_type`、`event_id`、`expires_at` 必填。
- 所有 ID 对外统一为字符串；`data` 必须是 JSON object，不能再套字符串。
- `call_type` 缺失的历史请求可在服务端落库时默认 `video`，但新事件必须明确回传服务端确认值。
- `billing_policy` 是本次 call 的不可变快照。
- `caller_username` 和头像按当前隐私规则过滤；缺失时返回空字符串，不得省略身份主键。
- 只向 host 投递 invite；accepted 只向 caller 投递；reject/cancel/expired 向双方按状态机需要投递。

## 事务、Outbox 与可靠投递

`POST /one-to-one-live/slots/{slot_id}/invite` 必须在同一事务/一致性边界内：

1. 锁定并验证 slot 为 `waiting`，校验非自呼叫、余额、媒体能力和并发邀请。
2. 创建全局唯一 `call_id`，保存 `call_type` 与计费快照。
3. 条件更新 slot 为 `inviting` 并绑定当前 `call_id`、guest 和 expiry。
4. 写入以 `event_id` 唯一、以 `call_id` 为业务幂等范围的 transactional outbox。
5. 事务提交后投递事件；投递失败必须重试，不能因为第一次 WebSocket 不在线而永久丢失。

HTTP 成功响应不得早于数据库提交。若业务采用“outbox 已持久化即返回成功”，必须保证消费者最终投递，并暴露可监控的积压与失败指标。

不得用 `caller_id + host_id` 或 `slot_id` 作为跨通话永久去重键；每次新邀请都必须产生新的 `call_id` 和 `event_id`。

## 重连和前后台恢复接口

新增或确认以下接口存在：

```http
GET /one-to-one-live/invitations/me/current
```

仅返回当前登录用户作为主播可处理的未过期邀请；没有时返回 `data: null`。有邀请时返回与 WebSocket `data` 相同的完整邀请快照，并增加 `status: pending`。

要求：

- 只能读取本人邀请，禁止越权枚举。
- 仅返回仍为 `pending` 且 `expires_at > now` 的邀请。
- 与 accept/reject/cancel/timeout 使用同一事实源和同一状态机。
- WebSocket 建连/重连成功后，服务端可以补发尚未确认的 invite；客户端也会调用该接口收敛状态。重复事件按 `event_id/call_id` 幂等。
- 若选择把待处理邀请嵌入 `GET /one-to-one-live/slots/me/current`，字段必须明确为 `pending_invitation` 且内容满足同一契约；请在联调文档中固定一种方案，不要同时维护两套含义不同的返回。

## 终态与并发要求

- accept/reject/cancel/expired 对同一 `call_id` 使用条件更新，只有一个终态成功。
- 第 15 秒超时任务必须按 `call_id` compare-and-set，迟到任务不能清理下一次邀请。
- 当主播已有普通通话、直播通话或另一条 pending 邀请时，返回稳定业务错误并正确恢复/保持 slot 状态。
- 邀请终态后，重连恢复接口立即不再返回该邀请。
- 重复投递 invite 不得创建第二条 call，也不得延长原 expiry。

## 自动化测试与验收

至少覆盖：

1. 首次视频邀请：HTTP 成功、事务提交、host 收到规范事件，字段完整。
2. host 在线但有多个有效 WebSocket 连接：按产品策略投递所有连接，任一端接受后其他端收到终态并关闭弹窗。
3. host 邀请时离线，随后在 15 秒内重连：通过补发或恢复接口取得同一 `call_id`。
4. outbox 消费者在提交前/后崩溃：不丢事件，重试仅重复同一 `event_id`。
5. 同一 caller/host/slot 连续两次通话：第二次使用全新 `call_id/event_id` 并正常弹窗。
6. 两个 caller 并发邀请同一 slot：只有一个成功，失败方收到稳定错误，host 只看到胜出的邀请。
7. `call_invite` 普通好友事件不被改成直播事件；直播事件不触发普通来电链路。
8. payload 必须为对象，ID 为字符串，`call_type=video`，计费快照在 invite/accept/join/status 中一致。
9. accept、reject、cancel、timeout 并发只有一个终态，恢复接口不返回终态邀请。
10. 越权访问恢复接口返回 403/404，响应不泄露 caller 或 host 信息。

交付时请附：根因、修改文件、迁移与回滚步骤、事件样例、接口 OpenAPI、测试命令和通过结果，以及按 `call_id` 检索的联调日志示例。
