# 消息列表置顶与删除后端实现 Prompt

你是 BBchat 后端项目的资深工程师。请直接检查当前仓库中的会话列表、私聊、群聊、JWT 鉴权、统一响应包装、数据库迁移和自动化测试实现，并完成“会话置顶 / 从消息列表删除”的服务端持久化。不要新建独立服务，不要改变删除好友、退出群聊或删除历史消息的既有语义。

## 目标

- 用户在 iOS 消息列表左滑后可以置顶、取消置顶、从列表删除会话。
- 状态按当前登录用户隔离，并可跨设备同步。
- 所有写操作幂等；重复请求返回相同最终状态。
- “删除会话”只表示从当前用户的消息列表隐藏，不删除私聊/群聊消息、不解除好友关系、不退出群聊。
- 被隐藏会话收到新消息后应自动重新出现在消息列表。
- 继续沿用现有 `{code,message,data}`、JWT、错误码、日志脱敏和数据库规范。

## 先检查现有代码

实现前先定位并复用：

1. `GET /chat/conversations` 的查询、聚合及排序逻辑。
2. 私聊和群聊的稳定 ID、最新消息 ID/时间字段。
3. 用户鉴权、群成员权限和统一响应包装。
4. 当前数据库迁移框架、事务工具及软删除约定。
5. WebSocket 新私聊消息和 `new_group_message` 的写入链路。

不要用客户端传入的用户 ID 代替 JWT 用户身份。

## 数据模型

新增可回滚迁移和用户级会话偏好表，名称按项目规范调整，至少包含：

```text
conversation_preferences
- id
- user_id
- conversation_type: dm | group
- target_id: 私聊对方 user_id 或 group_id
- is_pinned
- pinned_at nullable
- hidden_before_message_id nullable
- hidden_at nullable
- created_at
- updated_at
```

约束：

- `(user_id, conversation_type, target_id)` 唯一。
- 为用户会话列表查询建立合适索引。
- `hidden_before_message_id` 优先保存服务端稳定消息 ID；如果当前消息没有统一 ID，才使用服务端规范化时间游标。

## 接口

### 更新会话偏好

```http
PUT /chat/conversations/{conversationType}/{targetID}/preferences
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "is_pinned": true,
  "is_hidden": false
}
```

- `conversationType` 只允许 `dm|group`。
- 字段均可选，但请求至少包含一个字段。
- `is_pinned=true` 时写入 `pinned_at`；取消置顶时清空。
- `is_hidden=true` 时记录当前最新消息 ID，并自动取消置顶。
- `is_hidden=false` 时清除隐藏游标。
- 群聊必须验证当前用户是有效成员。
- 私聊目标用户必须有效，并遵循当前会话访问规则。

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "conversation_type": "dm",
    "target_id": "user_123",
    "is_pinned": true,
    "is_hidden": false,
    "pinned_at": "2026-07-15T10:00:00Z"
  }
}
```

如果项目已有更合适的会话偏好接口，可以沿用，但必须提供等价语义和真实请求响应样例。

## 会话列表调整

扩展 `GET /chat/conversations` 每项的可选字段：

```json
{
  "is_pinned": true,
  "pinned_at": "2026-07-15T10:00:00Z"
}
```

查询规则：

1. 没有偏好记录时按未置顶、未隐藏处理。
2. 最新消息 ID 小于等于 `hidden_before_message_id` 的会话不返回。
3. 有更新消息时自动重新返回；可以在新消息事务中清除隐藏状态，也可以在查询时依据消息 ID 判断，但必须保持一致且可测试。
4. 置顶会话排在普通会话前；置顶区按 `pinned_at DESC`，普通区继续沿用当前最后消息排序。
5. 后台返回稳定的 `conversation_type` 和目标 ID，旧客户端忽略新增字段后仍可正常解码。

## 并发与安全

- 使用 upsert 和事务处理偏好更新。
- 多设备同时置顶/取消置顶时以最后一次成功写入为准。
- 重复隐藏同一会话不得删除历史消息或产生重复记录。
- 禁止用户修改其他用户的偏好。
- 不在日志中记录 JWT、消息正文或敏感会话内容。
- 对写接口沿用现有频率限制和审计日志。

## 自动化测试

至少覆盖：

- 私聊和群聊置顶、取消置顶。
- 置顶排序及多条置顶的稳定顺序。
- 隐藏会话后列表不返回，但历史消息仍可读取。
- 隐藏群聊不会退出群聊。
- 新消息到达后隐藏会话重新出现。
- 非群成员和非法目标 ID 被拒绝。
- 跨用户状态隔离、重复请求幂等、并发更新。
- 旧客户端所需字段和普通会话接口保持兼容。

## 最终交付

完成代码后输出：

1. 迁移文件和回滚方式。
2. 修改过的路由、服务、查询和消息写入文件。
3. 自动化测试命令及结果。
4. 供 iOS 联调的真实请求响应样例。
5. 如果接口路径与上述建议不同，明确最终路径和字段映射。
