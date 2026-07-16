# 聊天消息幂等与未读计数后端修复 Prompt

请完整检查并修复私聊、群聊的消息投递一致性和未读计数。目标是：同一次发送在 HTTP 回包、WebSocket 事件、历史消息接口中必须拥有同一个消息身份；未读数必须以当前登录用户为维度权威计算，读取后立即归零且不会被旧事件恢复。

## 1. 消息幂等

- 所有发送接口都接收 `client_message_id`，包括私聊和群聊的文字、表情包、图片、视频、语音、礼物。
- 建立唯一约束，建议私聊使用 `(sender_id, client_message_id)`，群聊使用 `(group_id, sender_id, client_message_id)`。
- 相同 `client_message_id` 的重试不得创建第二条消息，必须返回第一次创建的完整消息。
- HTTP 发送回包、`new_message` / `new_group_message` WebSocket 事件、历史消息接口必须返回相同的：
  - `id` 或 `message_id`
  - `client_message_id`
  - `sender_id`
  - `receiver_id` 或 `group_id`
  - `msg_type`
  - `content`
  - `timestamp`
- `timestamp` 统一使用带时区的 ISO-8601 UTC 格式，例如 `2026-07-14T11:00:00.123Z`。
- 不允许发送接口返回临时 ID、WebSocket 再返回另一个正式 ID。

## 2. 私聊未读

- 未读状态必须按“接收用户 + 会话”存储或可事务性计算。
- 创建私聊消息时，只增加接收方对应会话的未读数；发送方未读数不得增加。
- `GET /chat/conversations` 的 `unread_count` 必须是当前登录用户的权威值。
- `contact_update` 发给不同用户时，`unread_count` 必须按目标用户分别生成，不能把发送方的 0 发给接收方。
- `POST /chat/messages/{contact_id}/read` 必须在事务中：
  1. 将当前用户与该联系人会话中截至当前最新消息的未读记录标记为已读；
  2. 返回该会话 `unread_count: 0` 和当前用户 `total_unread_count`；
  3. 向当前用户的其他在线设备广播 `conversation_read`。

## 3. 群聊未读

- 群消息创建后，为除发送者外的群成员增加未读；正在服务端确认活跃阅读的用户可直接保持为 0。
- `GET /chat/conversations` 和 `GET /groups/list` 对同一群的 `unread_count` 必须一致。
- `group_contact_update` 的 `unread_count` 必须是事件接收用户自己的值。
- `POST /groups/{group_id}/messages/read` 必须事务性清零当前用户该群未读，并广播 `conversation_read` 到该用户其他设备。

## 4. 事件顺序与游标

- WebSocket 事件可能重发，但同一消息必须保持相同消息 ID，客户端可按 ID 幂等消费。
- 建议每个用户事件流增加单调递增的 `event_seq`，客户端可丢弃旧序号事件。
- 会话摘要更新与消息落库必须在同一事务提交后再广播，避免摘要先于消息可查询。

## 5. 建议增加的接口

增加 `GET /chat/unread-summary`，返回：

```json
{
  "total_unread_count": 5,
  "conversations": {
    "dm:user-123": 2,
    "group:42": 3
  },
  "version": 108
}
```

`version` 必须单调递增。登录完成、App 回到前台、WebSocket 重连后，客户端可用该接口进行权威校准。

## 6. 验收测试

- 同一 `client_message_id` 连续请求两次，数据库只能有一条消息。
- 同一次发送的 HTTP、WebSocket、历史接口消息 ID 完全一致。
- 覆盖私聊和群聊的文字、表情包、图片、视频、语音、礼物。
- 接收方连续收到 3 条消息时未读为 3，发送方为 0。
- 打开会话调用 read 接口后，会话未读和总未读立即正确减少。
- read 请求后再收到旧 `contact_update` / `group_contact_update`，未读不得恢复。
- 两台设备同时登录时，一台读消息，另一台通过 `conversation_read` 立即清除对应红点。
- WebSocket 断线重连、重复事件、乱序事件不会造成重复消息或重复累计未读。
