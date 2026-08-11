# 后端调整 Prompt：聊天与朋友圈取消图片大小限制

请调整 BBchat 后端的私聊、群聊和朋友圈图片上传链路，实现“没有产品层图片大小限制”，同时保持现有客户端的即时发送体验和幂等语义。

## 当前客户端契约

- 用户可选择任意文件大小、任意分辨率的图片，不会因为源文件大或分辨率高而被客户端拒绝。
- 客户端选图后立即生成本地乐观消息/朋友圈并立刻开始处理、上传；UI 仍显示发送中/发布中，服务端确认后切换为成功。不得要求用户等待预上传结束后再点发送。
- 客户端会生成 JPEG 传输副本。最长边 1200px、约 2,000,000 bytes（缩略图约 140,000 bytes）都是网络优化目标，不是限制；优化后仍超过目标也会继续上传。
- 私聊图片：`POST /api/v1/chat/messages/image`；multipart 字段 `receiver_id`、`client_message_id`、`image`、`thumbnail`；header `Idempotency-Key: <client_message_id>`。
- 群聊图片：`POST /api/v1/groups/{group_id}/messages/image`；multipart 字段 `client_message_id`、`image`、`thumbnail`；header `Idempotency-Key: <client_message_id>`。
- 朋友圈：`POST /api/v1/moments/create`；multipart 字段 `content`、`client_request_id`、0～9 个重复的 `media`、可选 `unlock_price_gold_coins`；header `Idempotency-Key: <client_request_id>`。

## 必须完成的修改

1. 删除上述路由的 2MB 单图限制和 20/25MB multipart 总请求限制。不得仅根据图片字节数、`Content-Length` 或像素分辨率返回 413。
2. 排查并同步修改 CDN/WAF、负载均衡、Ingress/Nginx、API gateway、应用服务器 multipart parser、框架中间件和对象存储 SDK 的隐藏 body/part 限制。Nginx 可对媒体路由设置 `client_max_body_size 0`，其他组件使用等价配置。
3. 文件必须边读边写到对象存储或临时文件。禁止把完整 request body 或图片读进进程内存；禁止 `readAllBytes`、无界 `Buffer`、无界内存 multipart。设置流式 backpressure、合理超时和受控并发，避免大图导致 OOM。
4. 对象存储采用 multipart/resumable upload。网络中断允许续传或安全重试；同一认证用户、业务作用域和 `Idempotency-Key` 必须只产生一个最终实体。
5. 上传成功、对象存在且数据库事务提交后，才返回普通成功。图片写入失败、事务回滚或关联失败不得返回 2xx。
6. 私聊/群聊成功后，将权威消息广播给正确接收者/群成员，并确保历史接口可查；朋友圈成功后，正确失效作者页、world feed、following feed 缓存，并确保其他符合权限的用户可见。
7. 媒体 URL 必须让符合权限的接收者访问，不能返回发送设备本地 URI、仅发送者可访问的 URL 或过期签名。
8. 基础设施安全控制可以限制并发、用户/租户存储配额、临时磁盘占用和请求速率，但不要重新引入固定的单张图片大小产品限制。配额或存储故障应返回明确、可重试的错误码与 `request_id`，不能伪装成“图片太大”。

## 推荐的长期上传架构

如果当前 Web 框架无法可靠承载任意大小 multipart，请保留现有接口兼容性，同时增加直传：

1. `POST /api/v1/media/uploads` 创建上传会话，返回对象存储分片/可续传签名与 `upload_id`。
2. 客户端分片直传对象存储并完成校验。
3. 聊天或朋友圈创建接口提交 `upload_id`，服务端确认对象完整后原子创建消息/朋友圈和媒体关联。
4. 后台生成缩略图、做安全扫描或审核时，返回明确状态并支持重试；不能先返回普通 sent/published，再静默丢弃。

## 成功响应与幂等要求

- 聊天返回正数 `id`、正确的 `sender_id`、`receiver_id` 或 `group_id`、`msg_type: image`、非空服务端 `content` 和 `thumbnail_url`、原样 `client_message_id`。
- 朋友圈返回正数 `id`、正确 `author.user_id`、非空 `created_at`、与上传数量一致且 URL 非空的 `media[]`、原样 `client_request_id`。
- 相同幂等键重试返回同一已提交实体，不重复创建，不遗留孤儿媒体。

## 验收测试

- 私聊和群聊分别上传普通图、48MP 原图、优化后仍超过 2MB 的高细节图；不得因大小返回 413，接收端实时可见且刷新历史仍存在。
- 朋友圈分别发布单张大图和 9 张大图；本人、world 中符合条件的用户、关注者看到同一个 `moment.id`。
- 慢速网络、中途断网、客户端重试和同一幂等键并发重试均只产生一个最终实体。
- 监控上传期间应用进程内存，内存使用不应随整个文件大小线性增长；不得出现 OOM、全量 body buffering 或孤儿对象。
- 用发送者和接收者 token 分别访问媒体 URL，按权限返回 200。

请输出：根因、所有相关网关/应用/对象存储配置修改、代码 diff、数据库变更、自动化和端到端测试结果，以及去除 token 和隐私数据后的完整 request-id 链路日志。禁止针对 peter 用户做硬编码特判。
