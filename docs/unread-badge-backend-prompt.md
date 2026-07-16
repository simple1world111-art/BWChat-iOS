# 未读消息与角标后端调整 Prompt

请审计并修复聊天系统的未读计数协议，目标是实现类似微信的稳定语义：每个会话独立计数，进入会话立即视为已读，当前正在查看的会话收到新消息不增加未读，消息 Tab 与 APNs 角标始终由各会话未读数求和得到。请保持现有接口向后兼容。

## 当前接口

- `GET /api/v1/chat/conversations`
- `GET /api/v1/groups/list`
- `POST /api/v1/chat/messages/{contact_id}/read`
- `POST /api/v1/groups/{group_id}/messages/read`
- WebSocket：`new_message`、`new_group_message`、`contact_update`、`group_contact_update`

## 必须保证的服务端语义

1. 未读数必须按 `(owner_user_id, conversation_type, conversation_id)` 保存，单聊与群聊使用同一套规则；发送者自己的消息绝不能增加自己的未读数。
2. 写入消息、增加接收方未读数、更新会话最后一条消息必须在同一数据库事务内完成。
3. `GET /chat/conversations` 必须返回所有真实发生过消息的会话，不能依赖好友列表缓存过滤。每个会话至少返回：
   - `type`: `dm` 或 `group`
   - `id`，群聊同时返回 `group_id`
   - `last_message_id`
   - `last_message_time`
   - `unread_count`（非负整数，精确值）
   - 建议返回单调递增的 `conversation_version` 或 `last_event_sequence`
4. `GET /groups/list` 中同一群的 `unread_count` 必须与 `/chat/conversations` 完全一致，不能各自查询不同口径的数据。
5. 两个已读接口必须幂等。建议接受可选参数 `read_through_message_id`；服务端只清除不晚于该消息的未读，不能把接口处理期间新到达的消息一起误清。响应建议返回：
   ```json
   {
     "conversation_id": "...",
     "read_through_message_id": 123,
     "unread_count": 0,
     "conversation_version": 456
   }
   ```
6. WebSocket 的真实消息事件必须有稳定且全局可去重的 `event_id`、`message_id`、`conversation_type`、`conversation_id`、`sender_id`、`timestamp`。重连重放允许，但相同 `event_id` 不得代表两次未读。
7. `contact_update` / `group_contact_update` 只能作为会话预览事件；如果携带 `unread_count`，必须同时携带对应的 `conversation_version`，客户端只允许用更高版本覆盖本地值。不要发送无版本的旧 `unread_count: 0`。
8. APNs 的 `aps.badge` 必须由服务端权威总数生成，并与同一时刻各会话 `unread_count`（以及产品定义中需要计入的朋友圈未读）之和一致。客户端回到前台后会以会话列表重新校准。
9. 多设备场景：任一设备标记已读后，向该用户所有在线设备广播 `conversation_read`，字段包含会话身份、`read_through_message_id`、剩余 `unread_count` 和版本号。

## 必测场景

- 单聊、群聊分别连续收到 1/2/100 条消息，计数准确且 `99+` 所需原始数不被截断。
- 当前停留在会话 A 时 A 来消息不增加未读，B 来消息正常增加。
- 客户端先收到 WebSocket，再收到较旧 HTTP 响应，未读不能回退。
- 点击会话清零的同时又到一条新消息，新消息必须保留为 1。
- `new_message` 与 `contact_update` 任意先后到达，同一条消息只计一次。
- WebSocket 重连重放同一事件，不重复增加。
- 群列表与统一会话列表中的同一群未读数一致。
- 好友接口失败或对方不是好友时，已有消息的会话仍出现在会话列表。
- 多设备一端已读，另一端及时清零；随后到达的新消息仍为 1。

请输出：根因、数据库/事务调整、接口字段变更、WebSocket 事件示例、迁移方案、自动化测试结果。不要只修改前端展示字段。
