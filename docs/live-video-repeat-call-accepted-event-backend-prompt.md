# 一对一直播同一用户连续第二次呼叫无响应——后端修复 Prompt

你是一名资深后端与实时音视频工程师。请直接在 BWChat 后端仓库中定位并修复“一对一直播同一对用户结束第一通后，第二次邀请对端已接受并进入视频，但主叫收不到有效 accepted 状态”的问题。请提交可运行代码、迁移（如需要）、自动化测试和接口/事件文档，不要只输出分析或伪代码。

## 现象

1. 用户 A 从一对一直播大厅邀请主播 B。
2. B 接受，双方成功视频，随后任一方结束。
3. B 的直播席位恢复为 `waiting`。
4. A 再次从大厅邀请同一个 B。
5. B 能接受并拿到 LiveKit token、进入视频画面，但 A 仍停留在 15 秒邀请读秒，未进入视频。

iOS 已增加前端竞态保护：当 `one_to_one_live.call_accepted` 比 invite HTTP 响应中的 `call_id` 更早到达时，会先缓存事件，待响应返回后按 `call_id` 对账并调用 join。因此后端仍必须保证第二轮 accepted 事件确实生成、路由和投递，不能依赖客户端猜测状态。

## 必须排查的根因

重点检查以下状态是否错误地按“用户对/slot”永久去重或沿用第一轮数据：

- accepted WebSocket 事件的幂等键、outbox 唯一键或消息去重键；
- `caller_user_id + host_user_id`、`slot_id`、`room_name` 是否被错误用作跨通话唯一键；
- 第一通结束后 `current_call_id`、guest、room、invite expiry 和 call 状态是否完整清理；
- WebSocket 用户连接表是否在第一通结束后被删除、消费或指向旧 connection；
- 第二次 accept 是否在事务提交前发布事件，导致订阅方读到旧状态或事件被回滚；
- LiveKit webhook、call_end 的迟到任务是否可能覆盖或抑制第二个新 call；
- 第二轮是否复用了第一轮 `call_id`、room 或 accepted event id。

## 强制修复要求

### 1. 每次邀请使用独立身份

- 每次 `POST /one-to-one-live/slots/{slot_id}/invite` 都创建新的全局唯一 `call_id`。
- 第二次邀请不得复用第一通的 `call_id`、room name、accepted event id、outbox id 或 RTC token。
- 所有 accept/reject/cancel/timeout/end 幂等与去重范围必须是当前 `call_id`，不能只按用户对或 `slot_id` 去重。

### 2. accept 原子提交并可靠通知

`POST /one-to-one-live/calls/{call_id}/accept` 必须在一个事务中用条件更新完成：

```text
call: pending -> accepted/in_call
slot: inviting(current_call_id = 本 call_id) -> in_call
```

只有本次状态转换成功时创建 accepted outbox 事件。事件必须在事务提交后可靠投递给 caller 当前所有有效 WebSocket 连接；重试允许重复投递，但客户端可按 `event_id/call_id` 幂等。

事件至少包含：

```json
{
  "type": "one_to_one_live.call_accepted",
  "data": {
    "event_id": "evt_unique_for_this_accept",
    "call_id": "call_second_unique",
    "slot_id": "slot_host",
    "caller_id": "u_caller",
    "host_id": "u_host",
    "host_username": "Host",
    "host_avatar_url": "https://...",
    "accepted_at": "2026-07-23T12:00:00Z"
  }
}
```

- `call_id`、`slot_id`、`caller_id`、`host_id` 必填且为字符串。
- 不得因为同一 caller/host 曾经成功通话就抑制第二次事件。
- WebSocket 暂时断线时不得静默丢弃；使用 transactional outbox、可确认消息或重连补发机制。

### 3. join 必须按本轮 call 幂等

`POST /one-to-one-live/calls/{call_id}/join`：

- 只允许本轮 caller 加入本轮 accepted/in_call call；
- 重复调用可重新签发短时 token，但仍绑定同一个新 room；
- 第一轮 call 的 ended 状态、token、participant 或 webhook 不得影响第二轮；
- 返回的 `call_id` 必须等于路径参数，且 room/token 属于第二轮。

### 4. 第一通结束后正确恢复 slot

普通挂断只能在条件匹配当前 call 时恢复：

```sql
UPDATE one_to_one_live_slots
SET status = 'waiting',
    current_call_id = NULL,
    current_guest_user_id = NULL,
    invite_expires_at = NULL,
    room_name = NULL
WHERE id = :slot_id
  AND current_call_id = :ended_call_id
  AND status IN ('inviting', 'in_call');
```

迟到的第一轮 call_end、timeout 或 LiveKit webhook 必须带第一轮 `call_id` 做 compare-and-set，绝不能清理、结束或抑制已经开始的第二轮。

### 5. 增加状态恢复接口

实现或确认存在：

`GET /one-to-one-live/calls/{call_id}`

仅允许本次 caller/host 查询，返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "call_id": "call_second_unique",
    "slot_id": "slot_host",
    "status": "pending|accepted|in_call|rejected|cancelled|expired|ended",
    "expires_at": "2026-07-23T12:00:15Z",
    "accepted_at": null
  }
}
```

此接口不返回 LiveKit token。客户端发现 `accepted/in_call` 后仍调用现有 join 接口取自己的 token。它用于 WebSocket 重连、事件丢失和前后台切换后的状态收敛。

## 必须完成的自动化测试

至少覆盖：

1. 同一 A/B、同一 slot：第一轮 invite → accept → caller join → end；slot 恢复 waiting。
2. 随后第二轮 invite 生成不同 `call_id` 和 room。
3. 第二轮 accept 成功产生新的 accepted outbox/event，事件收件人仍为 A。
4. 第二轮事件不会被第一轮的用户对、slot 或事件去重记录抑制。
5. A 使用第二轮 `call_id` join 成功并得到第二轮 room/token。
6. 第一轮迟到 call_end/webhook 在第二轮 inviting 或 in_call 时执行，不改变第二轮 slot/call。
7. accepted 事务回滚时不发送事件；事务提交后即使 WebSocket 暂时离线也能重试/补发。
8. 重复 accept、重复 outbox 投递和重复 join 都幂等。
9. 状态查询接口有严格的参与者鉴权，第三方返回 403/404。
10. 使用真实 WebSocket 集成测试验证同一连接连续收到两次不同 `call_id` 的 accepted 事件。

## 交付时必须说明

- 最终根因；
- 修改的状态机、唯一键/去重键和 outbox 投递逻辑；
- 第一轮与第二轮的关键日志（脱敏）；
- 所有新增/修改测试及结果；
- 是否需要迁移或清理历史错误状态；
- 与现有普通好友视频、Agent 顺序匹配、一对一直播计费链路的回归结果。
