# 后端任务 Prompt：修复消息未读数重复、回跳与多通道不一致

请排查并修复 BBChat 私聊、群聊的未读消息计数协议。当前客户端可能同时通过 WebSocket、APNs 和会话列表接口收到同一条消息；后端必须提供稳定的消息身份和权威绝对计数，保证同一逻辑消息在任何通道只计算一次。

## 目标行为

1. 用户原有未读数为 `N`，收到一条新消息后直接稳定显示 `N + 1`，禁止先显示 `N + 2` 再回到 `N + 1`。
2. 私聊和群聊使用完全相同的幂等规则。
3. WebSocket、APNs、会话列表接口中的同一条消息必须使用相同的 `message_id`、会话类型和会话 ID。
4. `unread_count`、`total_unread_count` 和 `aps.badge` 都是绝对值，不是增量值。
5. 标记已读接口必须幂等；重复请求不能让计数变成负数，也不能错误清除更新消息。

## 统一事件字段

每个私聊 `new_message`、群聊 `new_group_message`、会话预览更新和 APNs payload 至少包含：

```json
{
  "event_id": "message:dm:user-123:98765",
  "conversation_type": "dm",
  "conversation_id": "user-123",
  "message_id": 98765,
  "sender_id": "user-123",
  "unread_count": 4,
  "total_unread_count": 11,
  "conversation_revision": 268,
  "sent_at": "2026-07-23T10:00:00.000Z"
}
```

群聊示例：

```json
{
  "event_id": "message:group:42:98766",
  "conversation_type": "group",
  "conversation_id": "42",
  "group_id": 42,
  "message_id": 98766,
  "sender_id": "user-456",
  "unread_count": 3,
  "total_unread_count": 12,
  "conversation_revision": 1051,
  "sent_at": "2026-07-23T10:00:01.000Z"
}
```

字段要求：

- `message_id`：消息落库后的稳定 ID，WebSocket、APNs、HTTP 返回必须一致，禁止每个通道重新生成。
- `event_id`：建议固定为 `message:{conversation_type}:{conversation_id}:{message_id}`。
- `conversation_revision`：该用户该会话的单调递增版本号。新消息、已读状态变化时递增；旧版本事件不得覆盖新版本状态。
- `unread_count`：当前接收用户在该会话内的权威未读总数。
- `total_unread_count`：该用户所有私聊和群聊会话的权威未读总和。
- `aps.badge`：必须等于发送 APNs 时的 `total_unread_count`，不能使用 `+1` 语义。

## WebSocket 规则

1. 同一连接内一条消息只发送一次 `new_message` 或 `new_group_message`。
2. 如果还需要发送 `contact_update` / `group_contact_update`，它只能作为同一消息的快照事件：
   - 使用相同 `message_id`；
   - 携带相同或更高的 `conversation_revision`；
   - 携带相同的权威 `unread_count`；
   - 不能要求客户端再次执行 `+1`。
3. 重连补发时允许重复发送，但 `message_id` 和 `event_id` 必须保持不变。
4. 禁止先广播缺少 `message_id` 的临时事件，再广播正式消息事件。

## 会话列表接口

`GET /conversations` 每条会话必须返回：

```json
{
  "type": "group",
  "conversation_id": "42",
  "group_id": 42,
  "last_message_id": 98766,
  "unread_count": 3,
  "read_through_message_id": 98700,
  "revision": 1051
}
```

- 返回值必须来自与消息写入、已读更新一致的数据源。
- `last_message_id`、`unread_count`、`revision` 必须是同一个事务/一致性快照，不能混用旧缓存。
- 消息写入成功后，应更新或失效会话列表、未读计数和 APNs 任务所使用的 Redis/进程内缓存。

## 标记已读接口

私聊和群聊标记已读接口接受 `through_message_id`，并返回：

```json
{
  "conversation_type": "group",
  "conversation_id": "42",
  "read_through_message_id": 98766,
  "unread_count": 0,
  "total_unread_count": 9,
  "revision": 1052
}
```

要求：

- 使用 `max(existing_read_through_message_id, requested_through_message_id)`，重复调用结果一致。
- 仅清除 `message_id <= read_through_message_id` 的未读记录。
- 与新消息并发时，不得清除 `message_id > read_through_message_id` 的消息。
- 成功后广播 `conversation_read_state`，字段与接口响应一致。

## 必测场景

1. 未读为 0，收到一条私聊消息；WebSocket、APNs、会话列表依次到达，所有阶段都只能显示 1。
2. 未读为 0，同一条群消息先收到 APNs 后收到 WebSocket，计数仍为 1。
3. `new_message` 和 `contact_update` 顺序互换，计数不能变成 2。
4. WebSocket 重连后重复补发同一个 `message_id`，计数不增加。
5. 连续收到两条不同 `message_id`，计数从 0 稳定变成 1、2。
6. 已读请求与新消息并发，新消息 ID 大于 `through_message_id` 时最终未读必须为 1。
7. 两台设备同时在线，同一账号的每台设备最终得到一致的绝对未读数。

请提供：

- 修改的接口、WebSocket 和 APNs payload 示例；
- 未读计数事务或原子更新方案；
- Redis/任务缓存失效策略；
- 上述测试的自动化测试结果；
- 一段可按 `message_id`、用户 ID、会话 ID 串联 WebSocket、APNs、HTTP 快照的诊断日志。
