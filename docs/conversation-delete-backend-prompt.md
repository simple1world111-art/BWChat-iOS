# 会话列表删除能力：后端实现 Prompt

请为 BWChat 后端实现“当前用户从自己的聊天列表删除一个会话”的完整能力。这里的删除是**按用户隐藏会话**，不是删除双方/群成员的历史消息，也不是退出群聊。

## 目标行为

1. 用户删除单聊或群聊后，该会话立即从当前用户的 `GET /chat/conversations` 结果中消失。
2. 删除只影响当前用户：
   - 单聊对方的会话和消息不能受影响；
   - 群聊其他成员不能受影响；
   - 删除群会话不等同于退出群聊。
3. 删除操作必须幂等，重复请求返回成功。
4. 删除时将该会话对当前用户的未读数清零，并返回最新全局未读总数。
5. 删除后如果收到或发送一条**比删除水位更新**的消息，会话自动重新出现在列表中，并以该新消息作为预览。
6. 当前用户的其他在线设备应收到 `conversation_deleted` 事件，以便同步移除列表项和角标。
7. 不要物理删除消息；如未来要支持“清空聊天记录”或“退出群聊”，请使用独立接口和权限模型。

## API 设计

实现：

```http
DELETE /chat/conversations/{conversation_type}/{conversation_id}
Authorization: Bearer <token>
```

- `conversation_type`：`dm` 或 `group`
- `conversation_id`：
  - `dm` 为对方的 `user_id`
  - `group` 为 `group_id`

成功响应：

```json
{
  "success": true,
  "data": {
    "conversation_type": "dm",
    "conversation_id": "user_123",
    "deleted_at": "2026-07-14T18:30:00.123Z",
    "hidden_before_message_id": 98765,
    "total_unread_count": 4
  }
}
```

不存在或已经删除的会话也返回 `200`；参数非法返回 `400`，未登录返回 `401`，无权访问目标群聊返回 `403`。

## 数据模型与查询语义

新增按用户保存的会话状态表，例如：

```text
user_conversation_state
- user_id
- conversation_type        // dm | group
- conversation_id
- hidden_before_message_id // 优先使用单调递增的消息 ID/序列号
- hidden_at
- unread_count
- updated_at
UNIQUE(user_id, conversation_type, conversation_id)
```

如果单聊与群聊的消息 ID 不是同一序列，可分别保存对应消息序列水位；只有无法获得可靠消息 ID 时才退化为服务端时间戳水位。

删除事务必须：

1. 校验当前用户与会话的关系；
2. 读取该会话当前最新消息的服务端消息 ID；
3. upsert `hidden_before_message_id`，水位只能前进不能后退；
4. 将当前用户该会话的未读数置 0；
5. 提交事务后向该用户其他连接广播删除事件。

`GET /chat/conversations` 必须按以下规则过滤：

- 没有隐藏状态：正常返回；
- `latest_message_id <= hidden_before_message_id`：不返回；
- `latest_message_id > hidden_before_message_id`：重新返回，并正确计算删除水位之后的预览和未读数。

不要用客户端传入的时间作为删除水位，也不要仅靠缓存删除列表项。会话列表查询、未读计数接口、WebSocket 推送必须使用同一份按用户状态。

## WebSocket 事件

向当前用户除发起请求设备外的连接广播：

```json
{
  "event": "conversation_deleted",
  "data": {
    "conversation_type": "dm",
    "conversation_id": "user_123",
    "deleted_at": "2026-07-14T18:30:00.123Z",
    "total_unread_count": 4
  }
}
```

如果现有事件层无法区分设备，也可以广播给全部设备；客户端应按会话身份幂等移除。

## 一致性要求

- 会话删除、会话列表、单聊未读、群聊未读、应用总角标必须最终一致，优先放在同一事务内更新。
- 列表缓存 key 必须包含 `user_id`，删除成功后主动失效对应用户的会话列表与未读缓存。
- 新消息写入后若越过隐藏水位，应主动恢复会话可见性并发送正常的新消息/会话更新事件。
- 不得因为删除会话而删除消息表记录、好友关系、群成员关系或对方的数据。

## 必须覆盖的测试

1. 单聊删除后当前用户列表消失，对方列表不变。
2. 群聊删除后当前用户列表消失，但仍是群成员，其他成员不变。
3. 同一请求重复执行，结果幂等且不报错。
4. 删除带未读消息的会话，单会话未读和总未读同时减少。
5. 删除后刷新、重新登录、换设备，仍保持隐藏。
6. 删除后收到新消息，会话重新出现且只统计删除水位之后的未读。
7. 删除后自己主动发出新消息，会话重新出现。
8. 删除请求与新消息并发时，以服务端消息序列确定结果，不丢失新消息。
9. 无权访问的群、非法类型、非法 ID、未登录请求返回正确状态码。
10. 多设备能通过 `conversation_deleted` 事件同步列表和总角标。

实现完成后，请提供数据库迁移、接口代码、会话列表查询改动、WebSocket 事件、自动化测试，以及一份接口请求/响应示例。不要改动现有消息发送协议，除非为了提供可靠的单调递增消息序列确有必要。
