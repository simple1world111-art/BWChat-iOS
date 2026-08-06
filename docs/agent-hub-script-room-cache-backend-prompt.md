# BWChat 智能体主页与剧本聊天缓存协议后端 Prompt

## 使用说明

以下 Prompt 可直接交给后端工程 Agent。当前 iOS 改造不依赖后端即可上线：智能体主页使用账号隔离的持久快照，剧本聊天使用房间快照、消息 SQLite 和现有 `after_id` 增量接口。后端改造的目标是降低无效响应、保证跨设备一致性，并补齐消息修改、删除和生成中回合恢复能力。

---

你是 BWChat 后端工程 Agent。请审计并补齐“我的智能体主页”和“剧本聊天”的缓存一致性、增量同步及恢复协议。必须先检查真实路由、数据库模型、WebSocket 事件和自动化测试；若现有实现已经满足某项要求，请提供代码与测试证据并标记“无需修改”，不要无意义重构。

所有变更必须向后兼容。旧客户端不传新增 Header 或参数时，原响应结构、业务语义和主要状态码必须保持不变。

## 一、iOS 当前行为

### 1. 我的智能体主页

iOS 会并行读取以下资源：

- `GET /agents/runtime-config`
- `GET /agents/installed`
- `GET /agent-conversations`
- `GET /wallet/balance`

客户端已实现：

- 按 `account:<userID>` 隔离的加密 SQLite 快照；
- 快照包含运行配置、已安装智能体、最近会话和钱包余额；
- 新鲜缓存 5 分钟内直接使用，不重复请求；
- 过期缓存先展示，再静默刷新；
- 创建、编辑、安装、移除智能体，以及新建会话和余额变化后回写本地快照；
- 网络失败不能把已有缓存覆盖为空。

### 2. 剧本聊天

iOS 已实现：

- `ScriptRoom` 房间元数据按账号和 `room_id` 持久化，5 分钟内不重复获取；
- 消息继续存储在账号隔离的 `MessageStore`，按 `group_id` 索引；
- 从消息列表进入时优先使用房间快照；没有完整快照时，使用会话行的 `script_room_id`、`script_id`、`group_id`、标题和封面构造临时首屏，立即读取本地消息；
- 有本地消息时调用 `GET /groups/{group_id}/messages?after_id=<latest_id>&limit=100`，只合并新增消息；
- 没有本地消息时才获取最新 100 条；
- 创建房间、结束房间、提交回合、重试回合以及 WebSocket 新消息都会写入本地缓存；
- 缓存可用但网络失败时继续展示缓存，不切换为空白错误页。

## 二、后端审计与改造要求

### A. 智能体主页资源版本与条件请求

逐一审计四个 GET Endpoint：

1. 为账号可见响应提供稳定的 `ETag`，或在 Body 中提供单调递增的 `resource_version`/`revision` 与 `server_updated_at`。
2. 若支持 `ETag`：
   - ETag 必须基于账号可见数据版本和查询参数生成；
   - 不得把每次请求生成的当前时间、request ID 或随机值纳入 ETag；
   - 收到匹配的 `If-None-Match` 时返回 `304` 和空 Body；
   - 返回 `Cache-Control: private, no-cache`，并按真实鉴权方式设置 `Vary: Authorization`；
   - 禁止 CDN 或共享代理跨账号复用 `/agents/installed`、`/agent-conversations`、`/wallet/balance`。
3. 智能体安装、移除、创建、更新、发布版本和删除操作，必须在同一事务内更新对应资源版本。
4. 创建或更新智能体的响应必须返回完整、可直接替换列表项的 `AgentSummary`；移除成功后必须返回稳定成功结果，重复移除应幂等或返回可识别的稳定错误码。
5. 创建智能体会话、产生新消息或关闭会话后，`/agent-conversations` 的资源版本必须变化。
6. 钱包余额不得进入公共缓存。所有影响余额的写操作应返回最新余额、余额版本和 `server_updated_at`，避免旧 HTTP 响应覆盖新余额。
7. 如四个 Endpoint 的数据必须保持原子一致，可新增可选聚合接口：

```http
GET /agents/hub
```

```json
{
  "code": 0,
  "data": {
    "revision": 123,
    "server_updated_at": "2026-07-27T12:00:00Z",
    "runtime_config": {},
    "installed_agents": [],
    "conversations": [],
    "wallet": { "balance": 100 }
  }
}
```

聚合接口是可选优化，不得删除现有四个接口；若实现，需要保证同一数据库快照或明确的一致性边界，并提供账号私有 ETag。

### B. 剧本房间元数据

审计：

```http
GET /script-rooms/{room_id}
```

响应必须稳定包含：

- `room_id`
- `script_id`
- `group_id`
- `status`：`active|ended`
- `player_role_id`
- `assignments[]`：至少含 `role_id`、`actor_type`、可选 `user_id`
- `script_snapshot`：至少含 `title`、`synopsis`、`cover_url`、`roles[]`
- 建议新增 `revision` 和 `updated_at`

要求：

1. `group_id` 在房间生命周期内不可变化；若历史数据可能变化，必须提供迁移映射和兼容策略。
2. `script_snapshot` 是开房时快照，不能因原剧本后续编辑而无版本地改变。
3. 房间结束后 `status`、`revision`、`updated_at` 必须在同一事务提交。
4. Endpoint 建议支持 `ETag`/`If-None-Match`；ETag 必须随房间状态或快照变化，不随请求时间变化。
5. 房间只允许有权限的账号读取；账号 A 的 ETag 或缓存键不得推断或读取账号 B 的私人房间。

### C. 剧本消息增量协议

审计：

```http
GET /groups/{group_id}/messages?after_id={message_id}&limit={limit}
GET /groups/{group_id}/messages?before_id={message_id}&limit={limit}
```

必须明确并测试以下契约：

1. `after_id` 为严格大于，不得重复返回锚点消息；`before_id` 为严格小于。
2. 返回消息按 `id` 升序排列；如果现有正式协议采用其他顺序，必须在文档中明确且整个接口保持一致。
3. 消息 `id` 在同一 `group_id` 内单调递增、永久稳定；分页过程中不得漏项或无限重复。
4. `has_more` 表示当前查询方向仍有更多数据：使用 `after_id` 时表示仍有更新消息，使用 `before_id` 时表示仍有更旧消息。
5. `limit` 应有明确范围，建议 `1...100`；非法值使用项目统一参数错误。
6. 每条消息继续返回 `version`、`updated_at`、`client_message_id` 和 `script_context`。`script_context` 至少包含 `room_id`、`role_id`、`actor_type`、`turn_id`。
7. `client_message_id` 在用户、房间或服务端现有合理作用域内唯一；重复提交同一 `client_message_id` 必须返回同一用户消息/回合结果，不得重复扣费、重复生成或重复插入。

仅靠 `after_id` 无法同步已缓存消息的编辑、撤回或删除。若剧本消息允许这些变化，请在不破坏旧接口的前提下增加以下任一能力：

- 增量响应增加 `sync_version`、`updated_messages`、`deleted_message_ids`；或
- 新增 `after_version`/`sync_token` 同步接口。

建议响应：

```json
{
  "messages": [],
  "deleted_message_ids": [],
  "has_more": false,
  "next_sync_token": "opaque-token",
  "sync_version": 456,
  "server_time": "2026-07-27T12:00:00Z"
}
```

删除 tombstone 的保留时间必须覆盖合理离线窗口，建议不少于 90 天；否则必须提供“同步令牌过旧，需要全量重建”的稳定错误码和恢复方式。

### D. 生成中回合恢复

当前客户端能通过 WebSocket 接收 `script_turn_state`，但进程退出、断网或跨设备后，单靠本地缓存无法知道回合仍处于 `queued/generating/failed`。

请让房间详情返回可选 `active_turn`，或提供：

```http
GET /script-rooms/{room_id}/active-turn
```

建议字段：

```json
{
  "turn_id": "turn_1",
  "status": "queued|generating|completed|failed",
  "user_message_id": 1001,
  "ai_message_id": null,
  "error_code": null,
  "updated_at": "2026-07-27T12:00:00Z"
}
```

要求：

- 回合状态和对应消息写入必须具备明确事务顺序；
- `completed` 时最终 AI 消息必须可通过消息增量接口读取；
- `failed` 只返回安全业务错误码和用户可读信息，不泄漏模型供应商、Prompt、密钥或内部堆栈；
- WebSocket 重连后客户端能通过 HTTP 恢复权威状态；
- retry 必须验证原回合可重试并保持幂等。

### E. 会话列表与实时事件

`GET /chat/conversations` 中的剧本房间行必须持续返回：

- `conversation_kind=script_room`
- `script_room_id`
- `script_id`
- `group_id`
- 标题和封面
- `last_message_id`
- `last_message_time`
- 未读数和已读游标
- 建议增加 `script_room_status` 与会话 `revision`

WebSocket/推送应保证：

- 新剧本消息继续使用可被现有群消息消费者解析的事件；
- 事件含稳定 `event_id`、`group_id`、`message.id`、`message.version`、`room_id`；
- 重复或乱序事件幂等，低版本事件不能覆盖高版本消息；
- 房间结束、剧本删除或权限收回时发送可精确失效 `room_id` 的事件；
- 推送深链包含 `conversation_kind`、`script_room_id`、`script_id`、`group_id`。

## 三、数据库与索引

按真实数据库选择等价索引，至少验证：

- 群消息：`(group_id, id)`；
- 消息版本同步：`(group_id, updated_at, id)` 或 `(group_id, sync_version, id)`；
- 剧本房间：`room_id` 唯一索引，以及 owner/member 权限查询索引；
- 智能体安装关系：`(user_id, agent_id)` 唯一索引；
- 智能体会话：`(user_id, updated_at, id)`；
- 资源版本更新必须与业务写入处于同一事务。

禁止为了满足本文而重复创建已有等价索引。提交迁移前必须检查现有 schema 和线上数据规模。

## 四、自动化测试与验收

至少新增以下测试：

1. 智能体主页四个 Endpoint 的账号隔离；账号 A 的条件请求不能命中账号 B。
2. 数据未变化时相同 ETag 返回 `304`；真实数据变化后 ETag/revision 必须变化。
3. 动态时间、request ID 不导致 ETag 每次变化。
4. 安装、移除、更新智能体后列表版本变化，旧客户端仍能获取原结构。
5. 钱包写操作与余额版本原子一致，旧响应不能覆盖新余额。
6. 剧本房间详情完整返回并支持 active/ended 状态变化。
7. `after_id` 多页同步不重不漏，响应顺序和 `has_more` 语义符合契约。
8. `before_id` 历史翻页不重不漏；并发插入新消息不影响旧页边界。
9. 重复 `client_message_id` 不产生重复用户消息、AI 回合或扣费。
10. WebSocket 断线期间生成完成，重连后 HTTP 增量能取得最终 AI 消息。
11. 若允许修改/撤回/删除，离线客户端能通过版本同步和 tombstone 正确收敛。
12. 房间结束、权限收回、账号切换和恶意跨账号 room/group ID 均按权限规则失败且不泄漏数据。
13. 旧客户端不传新 Header、`after_version` 或 `sync_token` 时继续正常工作。

## 五、最终交付

完成后请输出：

1. 逐 Endpoint 的“现状、是否修改、兼容性”矩阵；
2. 路由、service/repository、数据库迁移与索引的具体文件；
3. ETag/revision、消息排序、`has_more`、幂等键和 tombstone 的最终契约；
4. 自动化测试命令、通过结果及关键请求/响应样例；
5. 灰度、监控和回滚方案；
6. 明确列出 iOS 是否还需新增字段解析或切换 Endpoint。

若只完成了审计而未实现缺失项，必须逐项标注阻塞原因，不得把建议描述成已完成事实。
