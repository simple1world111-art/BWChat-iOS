# BWChat 第二批后端 Agent Prompt（与当前 iOS DTO 对齐）

你需要为 BWChat-iOS 已完成的第二批微信式聊天前端实现后端。先检查现有数据库、私聊/群聊消息、媒体授权、鉴权、WebSocket/outbox、第一批 `message.version + seq + recall tombstone`，只改本任务相关模块。不能用“前端本地假成功”代替接口。

## 已落地客户端契约

iOS 使用以下路径：

```http
POST   /chat/forwards
GET    /chat/forward-bundles/{bundle_id}
POST   /chat/favorites
GET    /chat/favorites?cursor=&limit=&query=&type=
GET    /chat/favorites/{favorite_id}
DELETE /chat/favorites/{favorite_id}
POST   /chat/favorites/{favorite_id}/forward
```

转发请求的实际 Codable JSON：

```json
{
  "client_operation_id": "00000000-0000-0000-0000-000000000007",
  "mode": "single | individual | merged",
  "sources": [
    {
      "conversation_type": "dm | group",
      "conversation_id": "对方userID或十进制groupID",
      "message_id": 987,
      "expected_version": 2
    }
  ],
  "targets": [
    {
      "conversation_type": "dm | group",
      "conversation_id": "目标ID"
    }
  ]
}
```

成功响应 `data`：

```json
{
  "client_operation_id": "uuid",
  "bundle_id": "可选；merged时必须返回",
  "created_messages": [
    {"conversation_type":"dm","conversation_id":"u007","message_id":123}
  ]
}
```

收藏创建的实际 JSON：

```json
{
  "client_operation_id": "uuid",
  "sources": [
    {
      "conversation_type": "dm | group",
      "conversation_id": "id",
      "message_id": 987,
      "expected_version": 2
    }
  ]
}
```

收藏详情转发使用：

```http
POST /chat/favorites/{favorite_id}/forward
```

```json
{
  "client_operation_id": "uuid",
  "targets": [{"conversation_type":"dm | group","conversation_id":"id"}]
}
```

服务端必须从收藏的不可变安全快照生成新消息，不能重新读取或暴露原 sources；响应复用 `ForwardOperationResult`。

收藏列表 `data`：

```json
{
  "items": [FavoriteItem],
  "next_cursor": "opaque-or-null",
  "has_more": false
}
```

`FavoriteItem`：

```json
{
  "favorite_id": "fav_...",
  "type": "text | image | video | voice | sticker | chat_record | unknown",
  "title": "显示标题",
  "summary": "安全摘要",
  "created_at": "ISO-8601",
  "version": 1,
  "items": [ForwardBundleItem]
}
```

合并详情 `GET /chat/forward-bundles/{bundle_id}` 的 `data`：

```json
{
  "bundle_id": "bundle_...",
  "title": "群聊的聊天记录",
  "created_at": "ISO-8601",
  "items": [
    {
      "ordinal": 0,
      "sender_name": "快照昵称",
      "sent_at": "ISO-8601",
      "message_type": "text | image | video | voice | sticker | unknown",
      "summary": "脱敏摘要",
      "asset_id": "可选稳定资源ID"
    }
  ]
}
```

所有响应继续使用项目现有 `{code,message,data}` envelope。UUID 按标准字符串返回；未知收藏类型返回 `unknown`，未知合并条目类型必须提供安全摘要，禁止直接返回结构化内部 JSON。

## 数据库迁移

在现有迁移框架中新增并提供可验证回滚说明：

1. `forward_operations`
   - `user_id, client_operation_id, request_hash, mode, status, result_json, created_at`
   - `UNIQUE(user_id, client_operation_id)`。
2. `forward_bundles`
   - `bundle_id, owner_user_id, title, item_count, version, created_at`。
3. `forward_bundle_items`
   - `bundle_id, ordinal, sender_display_name, sent_at, message_type, summary, asset_id`
   - `PRIMARY KEY(bundle_id, ordinal)`；不可保存可反查的源 conversation/message/user ID 到接收方可见快照。
4. `message_forward_bundle_links`
   - 只连接新消息与 bundle；接收方鉴权必须通过目标消息所属会话。
5. `favorites`
   - `favorite_id, owner_user_id, type, title, summary, version, deleted_at, created_at, updated_at`。
6. `favorite_items`
   - `favorite_id, ordinal, sender_display_name, sent_at, message_type, summary, asset_id, playable_voice_asset_id`。
7. `snapshot_media_refs`
   - 稳定 `asset_id`、用途、拥有者、生命周期、引用计数；绝不持久化或返回长期签名 URL。

迁移必须可在线执行；关闭功能时不删除 schema。回滚只能关闭写入口，已创建 bundle/favorite 继续可读。任何归属不确定的数据拒绝迁移，禁止猜 owner。

## 转发语义

- `sources` 1～99，`targets` 1～9；顺序严格按请求 sources。
- `single` 要求一个 source；`individual` 创建逐条独立消息；`merged` 每个目标创建一条聊天记录消息并引用不可变 bundle 快照。
- 逐条支持文字、图片、视频、表情、已有聊天记录卡片；禁止语音、支付、礼物、红包、转账、通话、系统、交易回执、撤回占位。
- 合并可包含语音，但只快照发送者显示名、时间、时长和 `[语音]`；不可播放/下载。已有聊天记录卡片不得再嵌套到 merged。
- 支付、礼物、红包、转账、系统、交易消息混入时整项失败，不静默跳过。
- 新消息不得继承 `reply_to`、mentions、mention_all、源会话跳转或原媒体 URL。
- 所有源与目标先鉴权；任一失败整批回滚。媒体必须按新消息/收藏重新签发短时授权。
- 比较 `expected_version`；源已撤回、失权或版本变化返回冲突，不从旧快照继续转发。

## 收藏语义

- 服务端为权威的账号级云快照；创建 sources 1～99。
- 1 条生成单条收藏；2～99 条生成一个 `chat_record` 收藏，不生成 N 条收藏。
- 单条语音可为收藏者保留可播放媒体引用；多条收藏中的语音只保留 `[语音]` 摘要。
- 原消息后来撤回、本机删除或源会话消失，收藏仍存在。
- DELETE 幂等软删除并递增版本；删除收藏绝不删除原消息。
- `query` 搜索标题/安全摘要；`type` 仅接受客户端枚举；游标稳定且不可猜测。

## 并发、幂等与错误

- `user_id + client_operation_id` 唯一；同 key 同 canonical body 返回原结果，同 key 不同 body 返回 `409 idempotency_conflict`。
- 消息、bundle/favorite、媒体引用、outbox 在同一事务提交。
- 锁定并校验消息当前 `version/status`；recall 是终态，转发/收藏不得让原正文复活。
- 客户端超时重试不得重复创建任何目标消息或收藏。
- 统一错误：`400 invalid_request`、`401 unauthenticated`、`403 conversation_access_denied`、`404 message_not_found`、`409 message_version_conflict`、`409 idempotency_conflict`、`422 action_not_supported_for_message_type`、`422 too_many_sources`、`422 too_many_targets`、`429 rate_limited`。

## WebSocket、增量同步与旧客户端

- outbox 发 `message.created`、`forward_bundle.created`、`favorite.created|deleted`，继续使用第一批账号级单调 `seq/event_id/occurred_at`。
- Favorite 事件包含完整最新实体或 tombstone 与 version；HTTP、WS、重连补拉幂等。
- 合并消息对新客户端提供 `bundle_id + item_count + 安全摘要`；旧客户端只收到同一消息 ID 的普通安全文本“聊天记录（N条）”，不得收到内部 JSON、源 ID 或媒体地址。
- 关闭创建开关后，读取接口和已有消息渲染保持可用。

## 功能开关、灰度与监控

实现并默认关闭：

```text
message_forward_single_v1
message_forward_multi_v1
message_forward_merged_create_v1
message_forward_merged_render_v1
message_favorite_v1
```

按内部账号 → 1% → 5% → 20% → 50% → 100%，每档至少 24 小时。指标至少包括幂等冲突率、重复消息率、整批回滚率、version 冲突、越权拒绝、bundle/favorite 读取失败、媒体授权失败、outbox 延迟与 seq 缺口。出现重复转发、顺序错误、越权读取、删除收藏复活或撤回正文泄漏立即关闭对应写开关。

## 必须交付的测试和文档

- OpenAPI（请求、响应、全部错误示例）。
- 数据库迁移测试、回滚/降级说明。
- 1/99 sources、1/9 targets、混合类型、严格顺序、全事务回滚测试。
- HTTP 成功但客户端超时后重试的幂等集成测试。
- 转发与撤回/version 并发、源失权、目标失权测试。
- 合并快照不泄露源 conversation/message/stable user ID/内部媒体 URL 的安全测试。
- 收藏跨设备创建/删除、离线补拉、删除后不复活测试。
- WebSocket 乱序、重复、断线补拉和旧客户端降级测试。
- 日志禁止记录消息正文、快照全文、token、签名 URL。

明确不做：收藏标签、笔记编辑、批量收藏管理、消息提醒、语音转文字、“更多”菜单、普通消息跨设备删除。
