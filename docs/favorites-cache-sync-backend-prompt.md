# 收藏缓存与多设备同步：后端实现 Prompt

> 说明：iOS 已完成账号隔离的本地加密缓存，现有接口不改也能工作。本 Prompt 用于补齐条件请求、稳定分页和多设备即时失效，属于推荐的后端一致性增强，不应阻塞客户端发布。

你是 BWChat 后端工程 Agent。请审计并增强“消息收藏”接口的缓存一致性与多设备同步能力。必须保持旧版客户端兼容；所有新增 Header、字段、事件均为向后兼容扩展，不得更改现有路由、必填参数或旧响应字段语义。

## 现有接口

```http
POST   /chat/favorites
GET    /chat/favorites?cursor=&limit=&query=&type=
GET    /chat/favorites/{favorite_id}
DELETE /chat/favorites/{favorite_id}
POST   /chat/favorites/{favorite_id}/forward
```

当前 iOS 已实现：

- `GET /chat/favorites` 的“全部”和每一种 `type` 结果按账号保存为 AES-GCM 加密 SQLite 快照；TTL 5 分钟，过期快照最多离线保留 90 天。
- 搜索词及搜索结果不落盘。
- 首次进入优先显示缓存；无缓存时才显示骨架加载；过期缓存保持可见并刷新。
- 下拉刷新强制请求网络。
- 分页结果与 `next_cursor` 一起持久化，可从缓存位置继续加载。
- `POST` 新增和 `DELETE` 删除成功后，客户端会清理当前账号全部收藏筛选缓存。
- `DELETE` 成功响应可以是现有 JSON Envelope，也可以是标准 `204 No Content`。

## 必须审计和实现的能力

### 1. 稳定 Cursor

- `cursor` 必须是不透明的服务端字符串，禁止要求客户端解析。
- 使用稳定的 Keyset/Snapshot 分页，例如 `(created_at, favorite_id)`，不要使用会因插入或删除产生漂移的 offset。
- 同一账号在翻页期间发生新增、删除时，不得漏项、重复或无限循环。
- `query`、`type`、账号身份必须绑定 Cursor；将某个筛选条件的 Cursor 用到另一个条件时返回明确的 `400 invalid_cursor`，不得静默返回错误数据。
- `next_cursor == null` 时必须同时返回 `has_more: false`。

### 2. 条件请求

为以下请求增加账号隔离的 ETag：

```http
GET /chat/favorites?limit=30&type=image
GET /chat/favorites/{favorite_id}
```

- ETag 必须基于“当前账号可见数据 + 标准化查询参数 + 收藏资源版本”，不能包含每次请求变化的生成时间或随机值。
- 收到匹配的 `If-None-Match` 时返回 `304` 和空 Body。
- 响应至少包含：

```http
Cache-Control: private, no-cache
Vary: Authorization, Accept-Language
ETag: W/"favorites-user-version-query-hash"
```

- 账号 A 的 ETag 绝不能让账号 B 命中；任何收藏响应不得进入公共共享缓存。
- 未携带 `If-None-Match` 的旧客户端继续获得现有 `200 + JSON` 响应。

### 3. 资源与集合版本

- 保证现有 `FavoriteItem.version` 为服务端单调递增版本；内容或元数据变化时必须递增。
- 收藏集合维护账号级 `sync_version`，新增、删除或修改收藏时在同一数据库事务内递增。
- 在列表响应中新增可选字段，不移除旧字段：

```json
{
  "items": [],
  "next_cursor": null,
  "has_more": false,
  "sync_version": 128,
  "server_time": "2026-07-27T21:30:00.123Z"
}
```

- `POST` 与 `DELETE` 成功响应返回最新 `sync_version`。如果 `DELETE` 继续使用 `204`，可通过 `X-Favorites-Sync-Version` Header 返回。
- 删除必须幂等：重复删除同一 `favorite_id` 返回成功，并且不能重复推进版本或产生重复事件。

### 4. 多设备实时失效

向当前账号的其他在线连接广播收藏事件；如果基础设施不能排除发起设备，可以向该账号全部连接广播，客户端按 `event_id` 和版本幂等处理。

新增：

```json
{
  "event": "favorite_created",
  "data": {
    "event_id": "evt_01...",
    "favorite_id": "fav_01...",
    "type": "image",
    "item_version": 1,
    "sync_version": 128,
    "occurred_at": "2026-07-27T21:30:00.123Z"
  }
}
```

删除：

```json
{
  "event": "favorite_deleted",
  "data": {
    "event_id": "evt_02...",
    "favorite_id": "fav_01...",
    "sync_version": 129,
    "occurred_at": "2026-07-27T21:31:00.123Z"
  }
}
```

- 事件只能发送给收藏所属账号。
- 同一 `event_id` 重放必须安全；乱序事件不能让较旧版本覆盖较新状态。
- WebSocket 断线期间允许客户端通过下一次列表刷新和 `sync_version` 恢复一致。

### 5. 可选增量同步

如果收藏规模较大，增加向后兼容的可选参数：

```http
GET /chat/favorites/changes?after_version=127&limit=200
```

响应：

```json
{
  "items": [],
  "deleted_ids": ["fav_01..."],
  "next_version": 129,
  "has_more": false,
  "server_time": "2026-07-27T21:31:00.123Z"
}
```

- tombstone 保留至少 90 天，或返回明确的 `full_resync_required: true`。
- 增量数据和 tombstone 必须使用同一账号级版本序列。
- 当前客户端尚不依赖该接口，因此不要移除或改变完整列表接口。

## 数据库与事务要求

- 收藏表至少应有：`favorite_id`、`owner_user_id`、`type`、`created_at`、`updated_at`、`version`、可选 `deleted_at`。
- 增加适合列表和版本同步的索引，例如：

```text
(owner_user_id, created_at DESC, favorite_id DESC)
(owner_user_id, type, created_at DESC, favorite_id DESC)
(owner_user_id, version)
```

- 新增/删除收藏、更新账号级 `sync_version`、写入 tombstone/事件 Outbox 必须在同一事务内完成。
- 搜索需复用账号权限过滤，严禁通过 `query`、Cursor、ETag 或错误信息推断其他账号的收藏内容。

## 必须提交的测试

1. 旧客户端不传新 Header/参数时，响应结构和行为保持兼容。
2. 同内容、同账号、同查询再次请求可命中 `304`；数据变化后返回 `200` 和新 ETag。
3. 不同账号、语言、type、query 的 ETag 和 Cursor 不可互用。
4. 分页期间并发新增/删除，不漏项、不重复，`has_more` 与 Cursor 一致。
5. 新增和删除事务正确推进 `sync_version`；重复删除幂等。
6. 多设备收到 `favorite_created`、`favorite_deleted`，重复和乱序事件可安全处理。
7. WebSocket 断线后通过完整刷新或增量接口恢复一致。
8. 未登录、越权 favorite_id、篡改 Cursor、跨账号 ETag 均返回正确错误且不泄露数据。

## 最终交付

- 实际路由与数据模型审计结果。
- 数据库迁移、索引与回滚方案。
- 接口、ETag、Cursor、版本和 WebSocket 事件实现。
- 自动化测试结果和真实请求/响应样例。
- 逐项标注“已存在 / 已调整 / 无需调整”；已满足的能力不要无意义重构。
