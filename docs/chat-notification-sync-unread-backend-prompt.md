# BWChat 后端实现 Prompt：通知补同步、revision 与精确未读

```text
你是 BWChat 后端工程师。请实现“消息通知补同步、会话 revision 和精确未读状态”契约，并兼容现有 iOS 客户端已有接口。

目标：
1. iOS 从被杀、后台或 WebSocket 断线状态恢复后，可以可靠判断哪些会话发生变化。
2. 会话最后一条消息、单会话未读数、消息 Tab 总未读数和 APNs badge 来自同一服务端事实。
3. 已读必须精确到 through_message_id，不能把请求执行期间新到的消息一起清零。
4. APNs、WebSocket 和 HTTP snapshot 即使重复或乱序，客户端也能通过 event_id 和 revision 幂等合并。

一、扩展 GET /api/v1/chat/conversations

保持现有 data.conversations 兼容，并新增：

{
  "code": 0,
  "data": {
    "revision": 123456,
    "server_time": "ISO-8601",
    "total_unread_count": 7,
    "conversations": [
      {
        "type": "dm | group",
        "id": "peer-id 或 group-id",
        "group_id": 123,
        "name": "...",
        "avatar_url": "...",
        "last_message": "...",
        "last_message_type": "text",
        "last_message_time": "ISO-8601",
        "last_message_id": 987,
        "read_through_message_id": 950,
        "unread_count": 3,
        "revision": 123450
      }
    ]
  }
}

要求：
- revision 是当前用户消息域单调递增的整数或可比较游标。
- 新消息、撤回、删除、已读状态变化都提升会话 revision 和用户级 revision。
- unread_count、total_unread_count、APNs aps.badge 使用同一数据库事务提交后的统计口径。
- 响应返回 Cache-Control: no-store，不能被 CDN、代理或应用缓存为旧结果。
- last_message_id 可直接用于现有 after_id 增量消息接口。

二、扩展现有已读接口

POST /api/v1/chat/messages/{peer_id}/read
POST /api/v1/groups/{group_id}/messages/read

请求：

{
  "through_message_id": 987,
  "idempotency_key": "UUID"
}

响应：

{
  "code": 0,
  "data": {
    "conversation_type": "dm | group",
    "conversation_id": "...",
    "read_through_message_id": 987,
    "unread_count": 1,
    "total_unread_count": 5,
    "revision": 123460,
    "server_time": "ISO-8601"
  }
}

语义：
- 仅将 message_id <= through_message_id 且属于当前用户的消息标为已读。
- read_through_message_id 只能单调前进。
- 重复 idempotency_key 或 through_message_id 返回相同语义结果。
- 事务执行期间到达且 message_id 更大的消息继续未读。
- 完成后向该用户其他在线设备广播 conversation_read_state，字段与响应一致。

三、统一 APNs payload

私聊和群聊消息在 data 中包含以下字段；兼容期可同时保留旧顶层字段：

{
  "aps": {
    "alert": { "title": "...", "body": "..." },
    "sound": "default",
    "badge": 7,
    "mutable-content": 1,
    "content-available": 1
  },
  "data": {
    "push_type": "dm_message | group_message",
    "event_id": "全局唯一 UUID",
    "conversation_type": "dm | group",
    "conversation_id": "稳定会话 ID",
    "sender_id": "发送者 ID",
    "group_id": 123,
    "message_id": 987,
    "msg_type": "text | image | video | voice | sticker | gift | ...",
    "conversation_revision": 123450,
    "unread_count": 3,
    "total_unread_count": 7,
    "sent_at": "ISO-8601",
    "sender_name": "...",
    "sender_avatar": "...",
    "group_name": "...",
    "group_avatar": "...",
    "content_preview": "..."
  }
}

要求：
- DM conversation_id 对接收者为对方用户 ID；群聊为稳定 group ID。
- event_id 每个逻辑事件唯一；APNs 重试不得生成新 event_id。
- 同一事件的 APNs 与 WebSocket 携带相同 message_id、event_id 和 conversation_revision。
- aps.badge 是推送事务提交后的 total_unread_count。
- Notification Service Extension 超时或未运行时，原始 payload 仍有完整路由字段。

四、WebSocket

所有 new_message、new_group_message 增加 event_id、message_id、conversation_type、
conversation_id、conversation_revision、unread_count、total_unread_count。

新增：

{
  "type": "conversation_read_state",
  "data": {
    "conversation_type": "dm | group",
    "conversation_id": "...",
    "read_through_message_id": 987,
    "unread_count": 0,
    "total_unread_count": 4,
    "revision": 123470,
    "event_id": "UUID"
  }
}

五、一致性测试

- M1 已读事务期间到达 M2，M2 仍未读。
- 重复、乱序已读请求不会让 read_through_message_id 回退。
- 同一消息的 HTTP、WebSocket、APNs 返回相同 ID 和 revision。
- 单会话 unread_count 之和等于 total_unread_count，并与 APNs badge 一致。
- 私聊和群聊删除、撤回、退出群聊后的 revision 与列表状态正确。
- 多设备读取后其他设备收到 conversation_read_state。
- 所有接口保持旧客户端字段兼容。

请输出：
1. 数据库字段或迁移。
2. API、APNs、WebSocket 实现。
3. 并发与事务策略。
4. 自动化测试结果。
5. 最终接口示例和兼容性说明。
```
