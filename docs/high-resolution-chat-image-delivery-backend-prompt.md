# 高分辨率聊天图片投递可靠性后端修复 Prompt

## 已确认的线上复现证据（2026-08-03，必须优先处理）

这次故障已经定位到媒体可用性，不是 iOS 没有收到消息：

- 私聊消息 `id=2700`、`client_message_id=9366A275-4F51-42B0-AB08-424C95997583` 已由发送账号 `u004` 发给接收账号 `u008`。
- `GET /api/v1/chat/messages/u004?limit=10` 能返回该消息；接收端 SQLite 也已保存同一条 `msg_type=image` 记录，说明历史同步/WebSocket 消息链路已成功。
- 消息 `content` 为 `/api/v1/images/u004/20260803_c77c6bc2ccfe451dac0b4104e0e023b9.jpg`。
- 使用接收账号的有效 Bearer token 请求下列地址，均返回 Nginx HTML `404`（162 bytes），而不是图片：
  - `GET /api/v1/images/u004/20260803_c77c6bc2ccfe451dac0b4104e0e023b9.jpg`
  - `GET /api/v1/images/u004/20260803_c77c6bc2ccfe451dac0b4104e0e023b9.jpg?thumb=1`
  - `GET /api/v1/public/images/u004/20260803_c77c6bc2ccfe451dac0b4104e0e023b9.jpg`
- iOS 发送方在上传成功后会用本地文件填充缓存，因此发送方能看到图片不能证明服务端文件可下载；接收方没有该本地缓存，所以显示图片占位符。

请先围绕这条消息检查：上传进程写入的真实绝对路径/对象 key、文件是否仍存在、文件权限、Nginx/Ingress `location`/`alias` 映射、是否多实例各自使用容器本地盘、部署/重启是否清空上传目录，以及 API 返回的 URL 是否与下载路由一致。若原文件仍在临时目录或错误实例上，请迁移到持久化共享存储并修复该消息；若已丢失，请明确标记不可恢复，不能继续返回一条看似成功但永久 404 的消息。

请直接在当前 BWChat 后端仓库中检查并修复“高分辨率图片在发送方本机可见、接收方始终收不到”的问题，覆盖以下两个现有 multipart 接口：

- `POST /api/v1/chat/messages/image`
- `POST /api/v1/groups/{group_id}/messages/image`

iOS 已做防御性调整：聊天图片会转为 JPEG，最长边不超过 1200 px，目标文件不超过 2,000,000 bytes；文件型后台上传和历史 Outbox 重试也会再次执行该策略。后端仍必须独立保证上传、落库、对象存储和 WebSocket 投递的一致性，不能依赖客户端永远正确压缩。

## 一、先定位真实失败层

开始改代码前，请逐层检查并记录当前值与失败证据：

1. CDN/WAF、负载均衡、Nginx/Ingress、应用服务器、Web 框架 multipart parser、临时目录、对象存储 SDK 各自的请求体和文件大小限制。
2. 两个接口收到大图时的真实 HTTP 状态码、响应体、request ID、应用日志和反向代理日志；重点排查 `413`、`400`、`408`、`422`、`499`、`502`、超时、临时文件写满和进程 OOM。
3. 图片二进制是否先完整读入内存；高像素但低文件体积的图片是否在解码、EXIF 纠正、缩略图生成或内容审核阶段造成内存峰值。
4. 对象存储写入、消息记录创建、会话摘要、未读数和 WebSocket 广播的先后顺序。确认是否存在“消息先落库/先返回，文件实际未保存”或“文件已保存但消息未广播”的半成功状态。
5. `client_message_id` 是否同时出现在 multipart 字段、数据库消息、HTTP 响应、历史接口和 WebSocket 事件中，并具有发送者作用域的唯一约束。

最终报告必须说明实际根因和触发阈值，不能只写“可能是图片太大”。

## 二、统一并显式配置限制

新增或复用单一配置源，例如：

```text
CHAT_IMAGE_MAX_BYTES=5242880
CHAT_IMAGE_MAX_PIXELS=24000000
CHAT_IMAGE_ALLOWED_MIME=image/jpeg,image/png,image/heic
CHAT_IMAGE_UPLOAD_TIMEOUT_SECONDS=120
```

- 以上数值可根据现有产品策略调整，但反向代理、Web 框架、应用校验和对象存储必须一致。
- 网关的 multipart 总请求上限需要包含 boundary 和文本字段开销，应略高于 `CHAT_IMAGE_MAX_BYTES`，不要刚好设成相同值。
- 文件体积限制和解码像素限制必须分开：不能因为 JPEG 只有 2 MB 就允许任意超大像素的解压炸弹。
- 不信任扩展名或客户端 `Content-Type`；同时校验文件魔数、实际 MIME、可解码性、宽高和总像素。
- 超限必须返回 HTTP `413` 和稳定 JSON，而不是 HTML 网关页：

```json
{
  "code": "IMAGE_SIZE_EXCEEDED",
  "message": "图片文件过大",
  "data": {
    "max_bytes": 5242880,
    "received_bytes": 7340032
  }
}
```

像素超限、格式错误分别返回 `IMAGE_PIXELS_EXCEEDED`、`IMAGE_TYPE_NOT_ALLOWED`；不得返回 500。

## 三、保证消息只在媒体可用后提交

两个图片接口使用相同的服务层流程：

1. 流式接收 multipart 到受控临时文件或对象存储，不把完整文件和多个副本同时保存在进程内存。
2. 校验大小、魔数、图片元数据和安全策略。
3. 写入对象存储并确认对象可以读取，生成稳定的媒体 key/URL；缩略图可以异步生成，但原图读取必须已经可用。
4. 在数据库事务内按 `client_message_id` 幂等创建消息、更新会话摘要和接收方未读；私聊唯一约束建议为 `(sender_id, client_message_id)`，群聊建议为 `(group_id, sender_id, client_message_id)`。
5. 事务提交后通过 transactional outbox 或现有可靠事件机制发送 `new_message` / `new_group_message`。只有此时才向 HTTP 调用方返回成功。
6. 相同 `client_message_id` 重试时返回第一次创建的完整消息，不重复写消息、不重复累计未读、不重复广播。

“确认对象可以读取”必须使用最终返回给 iOS 的同一条 URL（或其底层同一对象 key）执行 read-after-write 校验，不能只检查 SDK 的上传调用没有抛错。若采用多实例部署，禁止把聊天媒体只写到某一实例的容器本地盘；必须使用共享持久卷或对象存储。Nginx/Ingress 必须显式覆盖并测试 `/api/v1/images/...`，如果产品决定改为 CDN/签名 URL，则 HTTP 响应、历史接口和 WebSocket 必须统一返回新的绝对 URL。

缩略图契约也必须明确二选一：

- 支持 `GET {content}?thumb=1`，成功时返回可解码的 `image/*`；缩略图尚未生成时允许回退返回原图，不得返回 HTML；或
- 不支持该参数，但必须保证原始 `content` URL 始终可读。iOS 已增加缩略图失败后回退原图的兼容逻辑。

禁止出现以下行为：

- 还没有成功存储图片就返回 2xx 或创建可见消息。
- 上传失败后仍让发送方历史接口看到一条“成功消息”。
- WebSocket 广播失败就静默丢弃且没有 outbox 重试。
- HTTP 响应、历史消息和 WebSocket 使用不同的消息 ID 或不同的图片 URL。

成功响应继续兼容 iOS 当前 `{code,message,data}` 包装，`data` 至少包含：

```json
{
  "id": 123,
  "client_message_id": "stable-uuid",
  "sender_id": "user-a",
  "receiver_id": "user-b",
  "group_id": null,
  "msg_type": "image",
  "content": "/media/chat/2026/08/xxx.jpg",
  "timestamp": "2026-08-02T12:34:56.789Z"
}
```

## 四、图片处理的内存与并发安全

- 上传接收和对象存储转发使用流式 I/O；记录测试前后的进程 RSS 峰值。
- 图片探测/缩略图生成使用支持像素上限的库，在完整解码前读取元数据并拒绝异常尺寸。
- 限制单用户及单实例并发解码数，避免多张 48 MP 图片同时触发内存峰值。
- 临时文件使用随机不可猜名称，上传完成或失败都清理；定时清理进程崩溃遗留文件。
- 保留 EXIF 方向时要么规范化像素方向，要么在输出元数据中保持一致；不得让接收端得到损坏图片。
- 日志只记录 request ID、用户 ID、`client_message_id`、字节数、像素、MIME、耗时和失败阶段，不记录 token、完整图片内容或敏感 EXIF。

## 五、验收测试

请补自动化测试并进行两账号真机/测试环境联调：

1. 私聊和群聊分别发送 12 MP、24 MP、48 MP 来源照片；当上传文件符合服务端字节/像素政策时，HTTP 成功、数据库一条、接收方收到一次 WebSocket 事件且能立即下载图片。
2. iOS 规格图片：JPEG、最长边 1200 px、文件小于等于 2,000,000 bytes，两个接口必须稳定成功。
3. 文件恰好等于上限时成功；超过 1 byte 时返回 JSON `413/IMAGE_SIZE_EXCEEDED`。
4. 高压缩但像素超限的图片返回 `IMAGE_PIXELS_EXCEEDED`，服务进程不 OOM。
5. 扩展名伪装、MIME 伪装、截断 JPEG、损坏 EXIF、空文件均返回明确 4xx，不创建消息。
6. 同一 `client_message_id` 串行和并发请求 20 次，只生成一条消息、一次未读增量和一次接收方事件。
7. 模拟对象存储超时、数据库失败、WebSocket 暂时不可用和客户端在上传完后断开；验证无半成功记录，事件可恢复重试，客户端重试可按同一 ID 对账。
8. 20 个并发 48 MP 来源文件时记录应用 RSS、临时磁盘占用、P95/P99 延迟；结果不得随完整解码副本数无界增长。
9. 验证 HTTP 响应、私聊/群聊历史、会话最后一条消息和 WebSocket 中的 `id`、`client_message_id`、`content` 完全一致。
10. 新增下载路由回归测试：上传接口返回 2xx 后，立即分别以发送方和接收方身份 GET `content`，必须返回 `200`、正确 `Content-Type: image/*`、非零 `Content-Length`，且图片可解码；再验证 `?thumb=1` 契约。
11. 在至少两个应用实例上验证：上传固定落到实例 A，下载固定落到实例 B；文件仍必须可读。滚动重启所有实例后再次下载历史图片，仍返回 200。
12. 扫描数据库中所有图片消息，统计 `content` 为 404/不可解码的悬空记录，输出数量和受影响时间范围；可恢复对象执行迁移修复，不可恢复对象给出明确的数据修复/用户重发方案。

## 六、交付要求

直接完成实现、迁移和测试，不要只给建议。最终提供：真实根因、各层修改前后限制值、代码/配置变更、数据库唯一索引、回滚方案、自动化测试结果，以及一组可复现的 `curl` 请求和两账号端到端日志。若仓库已有统一媒体上传会话，优先复用，不另建重复系统。
