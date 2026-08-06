# 单聊/群聊清空记录与确认后删除会话：后端实现 Prompt

你是 BBchat 后端项目的资深工程师。请直接检查当前仓库中的私聊、群聊、会话列表、未读数、WebSocket、JWT 鉴权、数据库迁移、统一 `{code,message,data}` 响应和自动化测试，并完成“按当前用户清空聊天记录 + 从消息列表删除会话”的完整服务端能力。必须复用现有模块和事务工具，不新建独立服务，不删除对方或其他群成员的数据，不解除好友/关注关系，也不把删除群会话解释为退群。

## 一、客户端已经采用的交互与请求顺序

1. 单聊设置中的“清空聊天记录”：用户确认后调用 `DELETE /api/v1/chat/messages/{contactID}/history`。
2. 群聊设置中的“清空聊天记录”：用户确认后调用现有 `DELETE /api/v1/groups/{groupID}/messages/history`。
3. 消息列表左滑删除：客户端先展示“会同时清除相关聊天记录且不可恢复”的确认提示；只有用户确认后才执行：
   - 单聊先调用单聊清空接口；
   - 群聊先调用群聊清空接口；
   - 清空成功后，若远程配置 `conversation_preferences_v1` 已启用，再调用现有 `PUT /api/v1/chat/conversations/{type}/{targetID}/preferences`，提交 `{ "is_pinned": false, "is_hidden": true }`；
   - 最后客户端从本地列表移除卡片并清零该会话未读。
4. 智能体和互动剧房间暂时只从消息列表移除，不在本 Prompt 中物理或逻辑清空它们的领域历史。

请保持上述路径与字段兼容；如果现有后端已经有等价接口，可以增加兼容路由，但不能要求当前 iOS 改请求路径。

## 二、核心语义

- 清空记录只影响当前 JWT 用户在自己账号各设备上可见的历史。
- 单聊对方的消息历史不受影响；群聊其他成员的历史不受影响。
- 服务端不物理删除共享消息正文。应保存“当前用户已清空到哪个服务端消息水位”，并在历史、上下文、搜索、会话预览和转发来源查询中统一过滤。
- 清空操作幂等，水位只能单调前进，不能因重试或乱序请求回退。
- 清空后产生的新消息必须正常显示；旧消息不得因刷新、重新登录、换设备、分页、搜索或缓存回源再次出现。
- 从列表删除是在清空历史之上再设置当前用户的 `is_hidden=true`。新消息越过隐藏水位后，会话按现有策略重新出现。
- 清空或删除均不得解除好友/关注、拉黑对方、退出群聊、删除群成员或影响对方未读数。

## 三、数据模型

优先复用现有 viewer settings / conversation preferences 表。若单聊没有清空水位，请增加可回滚迁移，例如：

```text
direct_history_clear_state
- user_id
- contact_id
- cleared_before_message_id
- cleared_at
- revision
- created_at
- updated_at
UNIQUE(user_id, contact_id)
```

要求：

- `cleared_before_message_id` 必须来自服务端稳定、单调的消息 ID 或会话内 sequence，禁止使用客户端时间。
- upsert 时使用 `MAX(existing, incoming)` 或等价锁/条件更新保证水位不回退。
- 为 `(user_id, contact_id)` 及历史查询过滤建立索引。
- 群聊继续复用现有 `cleared_before_sequence` 语义；如果当前实现只写设置但历史/搜索没有统一过滤，必须补齐。
- 会话偏好表继续以 `(user_id, conversation_type, target_id)` 唯一，并保存 `is_hidden`、隐藏消息水位、`is_pinned`、revision。

## 四、单聊清空接口

实现并保持：

```http
DELETE /api/v1/chat/messages/{contactID}/history
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "conversation_id": "user_123",
    "cleared_before_message_id": 98765,
    "cleared_at": "2026-08-06T02:00:00.000Z",
    "revision": 12
  }
}
```

兼容要求：

- `contact_id` 可作为 `conversation_id` 的兼容别名，但正式响应优先输出 `conversation_id`。
- `cleared_before_id` 可作为旧字段兼容输入/输出，但正式响应输出 `cleared_before_message_id`。
- 没有历史时也返回 200，水位为当前可靠基线（可为 0），不能返回 404。
- contact 不存在返回项目统一 404；未登录 401；被禁止访问时使用现有稳定权限错误。

事务中必须：

1. 从 JWT 取得当前用户并校验 contact。
2. 锁定或可靠读取该会话当前最大服务端消息 ID。
3. 单调 upsert 当前用户的清空水位与 revision。
4. 将该会话对当前用户的未读数清零，并更新总未读。
5. 使当前用户会话预览不再引用已清空水位以内的消息；若水位后没有新消息，预览应为空。
6. 提交后仅向该用户其他连接发送同步事件。

## 五、群聊清空接口核对

现有 iOS 使用：

```http
DELETE /api/v1/groups/{groupID}/messages/history
Idempotency-Key: <uuid>
```

响应至少保持：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "group_id": 42,
    "cleared_before_sequence": 321,
    "cleared_at": "2026-08-06T02:00:00.000Z",
    "revision": 8
  }
}
```

请检查该接口是否真正对当前用户的所有设备生效，并确保群历史分页、消息上下文、聊天搜索、会话预览、未读统计全部应用同一 `cleared_before_sequence`。客户端现在会直接显示群清空入口，因此生产后端必须支持该接口；同时把远程配置中的 `group_history_clear_v1` 保持启用或移除无效门控。

## 六、从列表隐藏会话

继续支持：

```http
PUT /api/v1/chat/conversations/{conversationType}/{targetID}/preferences
Content-Type: application/json

{
  "is_pinned": false,
  "is_hidden": true
}
```

- `conversationType` 至少支持 `dm|group`。
- 操作按 JWT 用户隔离且幂等。
- 隐藏时记录可靠的最新消息水位并清零当前用户未读。
- `GET /chat/conversations`、总未读接口和 badge 使用同一状态。
- 清空已成功但隐藏请求因网络重试晚到时，最终结果仍必须收敛，不得恢复旧预览。
- 新消息 ID/sequence 高于清空和隐藏水位时，会话重新出现且只展示/统计新水位之后的内容。
- 后端就绪后启用 `conversation_preferences_v1`，使 iOS 发出该请求。

如果可以在不破坏兼容性的前提下提供一个原子“清空历史并隐藏会话”接口，可额外实现；但仍必须保留上述两个当前 iOS 已调用的接口。

## 七、读取链路必须统一过滤

至少审计并修复：

- `GET /chat/messages/{contactID}` 的首次加载、`before_id`、`after_id`。
- 单聊消息 context、搜索、转发来源、合并转发来源。
- 群历史分页、群消息 context、群聊天搜索、转发来源。
- `GET /chat/conversations` 的最后消息、时间、未读、排序与空预览。
- 推送预览和 WebSocket 会话摘要，不能再次泄露已清空内容。
- 服务端/Redis/CDN/API 缓存必须按用户隔离，并在清空事务提交后失效。

## 八、多设备事件

单聊清空后向当前用户的其他连接发送：

```json
{
  "event": "direct_history_cleared",
  "data": {
    "conversation_id": "user_123",
    "cleared_before_message_id": 98765,
    "cleared_at": "2026-08-06T02:00:00.000Z",
    "revision": 12,
    "total_unread_count": 3
  }
}
```

群聊沿用 `group_history_cleared`；隐藏沿用 `conversation_preferences_updated` 或现有等价事件。事件只发给设置拥有者，revision 必须单调，客户端可幂等重复应用。

## 九、并发和安全

- 清空与新消息并发时以服务端消息 ID/sequence 判定：事务前已存在的消息进入清空水位，事务后新消息高于水位并可见，不能误删新消息。
- 同一 Idempotency-Key 重试返回相同语义结果；不同 key 的重复清空也必须幂等且水位不回退。
- 不记录 JWT、消息正文、附件 URL 或敏感聊天内容到日志。
- 拉黑、账号状态、群成员权限继续走现有统一鉴权。
- 清空不删除共享附件对象；附件生命周期继续遵循引用计数/保留策略。

## 十、自动化测试

至少覆盖：

1. 单聊 A 清空后 A 的历史、context、搜索、预览为空，B 的历史完全不变。
2. 群成员 A 清空后仅 A 不再看到旧历史，其他成员不变，A 仍是群成员。
3. 空会话清空、重复清空、同一幂等 key 重试均 200。
4. 刷新、重新登录、换设备后旧消息不会回灌。
5. 清空后收到/发送新消息，只显示水位后的消息，会话和未读正确恢复。
6. 清空与新消息并发时不丢新消息，水位单调。
7. 左滑流程的“先清空、后隐藏”最终使会话从当前用户列表消失，对方/其他群成员不受影响。
8. 隐藏后新消息使会话重新出现，预览和未读仅计算新水位之后内容。
9. 单聊/群聊清空后总未读和 APNs badge 同步减少。
10. 多设备正确收到 `direct_history_cleared`、`group_history_cleared`、偏好更新事件，乱序旧 revision 被忽略。
11. 非法 contact/group、非群成员、越权用户、未登录请求返回稳定 JSON 错误。
12. 旧客户端忽略新增字段后，普通收发消息、好友/关注、群成员和退出群逻辑无回归。

## 十一、交付要求

完成后请输出：

1. 数据库迁移和回滚文件。
2. 修改的路由、服务、查询、缓存、WebSocket 和未读统计文件。
3. 最终水位与并发语义说明。
4. 单聊、群聊、隐藏会话的真实请求/响应样例。
5. 远程配置 `conversation_preferences_v1` 与 `group_history_clear_v1` 的最终启用状态。
6. 自动化测试命令及完整结果。
7. 明确说明没有删除对方/其他群成员记录、没有解除关系、没有退出群聊。
