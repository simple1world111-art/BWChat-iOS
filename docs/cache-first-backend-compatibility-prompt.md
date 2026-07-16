# BWChat 缓存协议后端兼容性审计与修改 Prompt

## 审计结论

iOS 已可在不依赖后端改造的情况下使用“本地快照优先 + TTL + 请求合并”减少重复请求，因此后端改造不是本次前端上线的硬阻塞项。不过，当前客户端代码能证明只有 App 配置和动态页面使用 `If-None-Match`/`ETag`/`304`；多数只读接口仍只能下载完整响应。消息和朋友圈具备部分 `after_id`/`before_id` 增量参数，游戏与短剧具备 Cursor，但没有统一的资源版本、删除 tombstone、钱包更新时间或远程抹除事件契约。

2026-07-12 对当前真实服务 `http://52.198.192.138/api/v1/app/config` 的匿名只读探测还确认了一个实际缺陷：第一次响应为 `200`，ETag 为 `d1c108…d3e2`；6 秒后携带完全相同的 `If-None-Match` 再请求，服务仍返回 `200`，ETag 变为 `4d9b8f…48cd`。响应中的 `generated_at` 也随每次请求变化，说明 ETag 把请求时刻或每次生成的响应字段纳入了哈希，导致内容配置未变化时也无法命中 `304`。该 Endpoint 需要后端修复。

以下 Prompt 可直接交给后端 Agent 执行。Agent 必须先检查真实路由和测试，不得因为本文列出建议就无条件重构已经兼容的接口。

---

你是 BWChat 后端工程 Agent。请针对已经完成本地优先缓存改造的 iOS 客户端，审计并补齐后端缓存与增量同步协议。要求保持所有旧版客户端可用；新增 Header、查询参数和响应字段均须向后兼容。

## iOS 已实现行为

- 所有账号数据使用 `account:<userID>` 隔离的加密 SQLite 快照；退出登录、Token 失效或刷新失败不删除，未登录状态不可读取，同账号重新登录立即恢复。
- 新鲜快照按 TTL 直接显示且不请求网络；过期快照继续显示并静默刷新；无快照时才显示首次加载动画。
- 相同账号、namespace、key 的并发请求会合并；网络错误不会把旧列表覆盖为空。
- 下拉刷新会强制请求，但刷新期间保留旧内容。
- 消息继续使用独立 SQLite；图片使用磁盘缓存；已观看视频使用账号隔离的长期 LRU 缓存。
- 默认 TTL：钱包余额 30 秒；通知/评论 1 分钟；会话、好友、群组、钱包历史、朋友圈 2 分钟；短剧 Feed/系列 5 分钟；公开资料、关注、群详情、游戏 10 分钟；礼物目录 1 小时。
- iOS 已支持 App 配置和动态页面的 `If-None-Match`、`ETag`、`304`，对应实现位于 `APIService.fetchAppRemoteConfig`、`APIService.fetchDynamicScreen`。

## 已确认的客户端证据

1. 通用 `get(path:)` 只解码 2xx 完整响应，未为普通只读 Endpoint 设置 `If-None-Match`；条件请求目前只用于配置相关专用方法。
   - 真实接口证据：`GET /app/config` 返回 `cache-control: no-cache, must-revalidate` 和 ETag，但携带刚取得的 ETag 再请求仍返回 `200`；`config_version` 保持 `2026.07.11.2`，仅 `generated_at`/ETag 改变。请让 ETag 基于稳定配置版本或排除每次请求生成的时间字段，并新增“配置不变时返回 304”的集成测试。
2. 完整列表 Endpoint 包括：
   - `GET /chat/conversations`
   - `GET /friends/list`、`GET /friends/requests`
   - `GET /groups/list`、`GET /groups/{groupID}`
   - `GET /profile/public/{userID}`
   - `GET /follows/following`、`GET /follows/followers`
   - `GET /wallet/balance`、`GET /wallet/transactions`、`GET /wallet/withdrawals`
   - `GET /wallet/gifts/catalog`
   - `GET /moments/notifications/list`、`GET /moments/detail/{momentID}`
3. 已有部分分页/增量能力：聊天消息和群消息使用 `after_id`；朋友圈 Feed 使用 `before_id`；游戏和短剧列表使用 Cursor。需验证 Cursor 在数据插入/删除后是否稳定。
4. WebSocket 当前事件包含 `new_message`、`new_group_message`、`friend_request`、`friend_accepted`、`contact_update`、`group_contact_update`、`group_removed`、`group_renamed` 等，但客户端解析代码未见统一 `resource_version`、`updated_at` 或删除 tombstone 版本。
5. 媒体客户端支持 MP4 后台下载和 HLS 离线包，但客户端代码无法证明所有媒体响应都稳定支持 `Range`、`Accept-Ranges`、准确 `Content-Length`、稳定媒体 ID 和足够长的离线鉴权。
6. 钱包模型能解析余额数值，但没有强制的 `version` 或 `server_updated_at`，无法可靠拒绝乱序 WebSocket/HTTP 响应。
7. 客户端目前没有可确认的账号注销、封禁或管理员远程抹除缓存事件契约。

## 后端改造要求

### A. 条件请求

- 为上述只读 GET Endpoint 生成基于“账号可见结果 + 查询参数 + 数据版本”的强或弱 `ETag`。
- 收到匹配的 `If-None-Match` 时返回 `304`、空 Body，并保留必要的 `Cache-Control: private` 与 `Vary: Authorization, Accept-Language`。
- 任何账号敏感响应不得被公共 CDN 跨账号复用。
- 礼物目录、公开配置等公共资源可使用独立公共缓存策略，但必须按语言、版本等实际维度设置 `Vary`。

### B. 增量同步与删除

- 对会话、好友、群组、关注/粉丝、通知、钱包记录、朋友圈、短剧评论提供稳定 Cursor，或提供 `updated_since`/`after_version`。
- 增量响应统一返回：`items`、`next_cursor`、`has_more`、`sync_version`、`server_time`、`deleted_ids`。
- 删除和撤回必须提供 tombstone；tombstone 保留时间不得短于客户端离线保留窗口，建议至少 90 天，或提供可检测的全量重同步下限版本。
- Cursor 必须为不透明字符串，并在并发插入、删除和排序变化时不漏项、不重复；不要要求客户端解析 Cursor。

### C. 资源版本和实时事件

- 所有可缓存资源返回单调递增 `resource_version` 或可比较的 `updated_at`。
- WebSocket/推送事件统一包含：`event_id`、`event_type`、`resource_type`、`resource_id`、`resource_version`、`occurred_at`、`deleted`；群资源还需 `group_id`，账号级事件需目标 `user_id`。
- 事件必须幂等；同一 `event_id` 重放不得造成重复记录。客户端可忽略版本小于等于本地版本的乱序事件。
- 无法提供完整增量载荷时，事件至少应包含可精确失效的资源 ID，禁止只发送“全部刷新”。

### D. 钱包

- `GET /wallet/balance` 返回 `version`、`server_updated_at`，每次影响余额的写操作在响应内返回同结构钱包快照。
- 交易和提现列表提供稳定 Cursor/版本及删除或状态变化同步；金额、币种、状态与版本更新必须位于同一数据库事务。
- 钱包响应必须使用 `Cache-Control: private, no-store` 也可以，但仍应支持 ETag/版本用于客户端条件校验；禁止任何共享缓存。

### E. MP4/HLS 与鉴权

- MP4 支持 `HEAD` 和字节范围：`Accept-Ranges: bytes`、正确 `Content-Length`、`206`、`Content-Range`，无效范围返回 `416`。
- 同一媒体版本必须具有稳定 `media_id`、`media_version` 和内容长度；内容变化必须改变 URL、ETag 或版本。
- HLS 主/子播放列表和分片支持离线下载；签名 URL/Token 的有效期必须覆盖一次合理的后台下载，或提供可续签的下载授权。
- 同源 API 媒体接受 Bearer Token；跨域 CDN 使用短期签名 URL，绝不能要求客户端向跨域附加 API Token。
- 未解锁短剧返回明确的 `403`/业务错误，解锁响应返回新的可缓存媒体授权和版本。

### F. 注销、封禁与远程抹除

- 账号永久注销、合规抹除或管理员远程抹除时，返回/推送 `account_cache_purge`，包含 `user_id`、`purge_version`、`reason`、签名或可验证来源。
- 普通 logout、访问 Token 过期、刷新 Token 失败不得发送 purge；它们只结束服务端会话。
- 封禁是否要求清除本地数据必须由明确策略字段表达，不得复用普通 `401`。

## 数据库与发布迁移

1. 为主要聚合资源增加版本表或可靠的 `updated_at`/序列号；所有相关写事务同步递增版本。
2. 为增量表补索引，例如 `(owner_user_id, version, id)`、`(resource_id, updated_at)`，并新增 tombstone 表或软删除字段。
3. 先只新增响应字段、Header 和可选参数，保持无参数旧请求响应结构不变。
4. 灰度启用 ETag 和增量接口，记录 200/304 比例、Cursor 错误、全量回退率和媒体 Range 失败率。
5. 新协议稳定后再让新客户端优先使用增量；不得提前移除旧接口。

## 必须提交的测试与验收证据

- 单元测试：ETag 随可见数据变化、匹配返回 304、账号/语言维度不串缓存。
- 集成测试：分页期间插入/删除数据不漏项；tombstone 能删除本地旧记录；重复/乱序事件幂等。
- 兼容测试：旧版客户端不传新 Header/参数时仍得到原结构与状态码。
- 钱包测试：写操作、余额版本和流水处于同一事务；旧响应不能覆盖新版本。
- 媒体测试：HEAD、0-N/尾部/开放区间 Range、416、断点续传、HLS 离线、签名过期续签、跨域无 Bearer Token。
- 安全测试：账号 A 的 ETag、Cursor、媒体授权和推送不可读取或影响账号 B。
- 抹除测试：logout/Token 过期不触发 purge；永久注销/远程抹除必定触发且可重放幂等。

最终交付：逐 Endpoint 兼容矩阵、实际请求/响应证据、代码与数据库迁移、自动化测试结果、灰度与回滚方案。若某项现有实现已经完全满足，保留证据并标记“无需改动”，不要进行无意义重构。
