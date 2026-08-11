# 后端排查与修复 Prompt：peter 图片消息和朋友圈仅自己可见

请排查并修复 BBchat 后端的媒体消息持久化、接收端投递和朋友圈可见性问题。当前已知现象：`peter` 用户在私聊、群聊发送图片后，发送端能看到图片，但对方/群成员收不到；发布带图朋友圈后，peter 自己能看到，其他符合可见条件的用户看不到。

前端现已做以下处理，请按此契约核对后端：

- 用户可选择任意文件大小、任意分辨率的图片。客户端会立即开始处理和上传，并生成最长边不超过 1200px 的 JPEG 传输副本；2,000,000 bytes（缩略图 140,000 bytes）只是尽力达到的网络优化目标，不是上传限制。即使优化后仍超过目标，客户端也会继续上传，后端不得仅因图片超过 2MB 而拒绝。
- 私聊图片：`POST /api/v1/chat/messages/image`，multipart 字段为 `receiver_id`、`client_message_id`、`image`、`thumbnail`，同时发送 `Idempotency-Key: <client_message_id>`。
- 群聊图片：`POST /api/v1/groups/{group_id}/messages/image`，multipart 字段为 `client_message_id`、`image`、`thumbnail`，同时发送 `Idempotency-Key: <client_message_id>`。
- 朋友圈：`POST /api/v1/moments/create`，multipart 字段为 `content`、`client_request_id`、0～9 个重复的 `media`，可选 `unlock_price_gold_coins`，同时发送 `Idempotency-Key: <client_request_id>`。不得设置 2MB 单图限制或 20/25MB multipart 总请求限制。

请不要只检查 HTTP 是否返回 2xx。发送端会先展示本地乐观内容，因此“发送端看得到”不能证明后端已持久化、已广播或已进入公共 feed。

## 必须完成的排查

1. 使用 peter 的真实 access token，从 JWT/会话中记录并核对认证主体 `auth_user_id`、租户/环境、账号状态。认证主体必须与数据库中的 peter 用户主键一致。禁止从 multipart 或客户端补充字段推断发送者。
2. 分别用 peter 发送一条私聊图片、一条群聊图片和一条带图朋友圈。贯穿记录：`request_id`、`client_message_id/client_request_id`、认证用户 ID、接收者/群 ID、HTTP 状态、响应 code、服务端实体 ID、对象存储 key、数据库事务结果、广播结果。
3. 对每条 2xx 响应，立即在主库或读写一致的查询源中确认存在正数 ID 的实体，并确认媒体文件和缩略图已成功写入对象存储。不得在对象上传失败、数据库回滚、事务尚未提交时返回成功。
4. 私聊图片提交后，用接收者账号调用聊天历史接口，确认该消息可查；同时核对 WebSocket 是否发布到接收者实际订阅的 user/channel。即使实时广播失败，刷新历史也必须能查到已提交消息。
5. 群聊图片提交后，确认消息 `group_id` 正确、peter 在发送时具备成员资格，并对至少两个其他群成员验证历史可查和 WebSocket 实时事件。权限不满足时必须返回明确 4xx，不能返回 2xx 后静默丢弃或仅发送者可见。
6. 朋友圈提交后，确认记录的 `author_id` 是 peter、发布状态为可展示状态、媒体行已关联、没有落入 draft/pending/private-only/soft-delete/moderation-hold/shadow-ban/test-tenant 等过滤条件。分别用另一个符合条件的账号验证：
   - `GET /api/v1/moments/user/{peter_user_id}`
   - `GET /api/v1/moments/world`
   - `GET /api/v1/moments/feed`（先确保该账号满足关注/好友规则）
7. 检查 peter 是否存在异常账号标志、错误租户、大小写/空格不同的 user ID、旧账号映射、屏蔽关系、隐私设置或审核状态。任何限制发布可见性的规则都必须在创建响应中返回明确状态，不允许伪装成普通“发布成功”。
8. 检查读写分离和缓存：写入后是否读到错误从库、缓存 key 是否缺少用户/租户维度、是否只把新实体写进发送者缓存。修复后应主动失效相关用户页、world feed、following feed 和会话缓存。
9. 检查媒体 URL 的接收端访问权限。`content`、`thumbnail_url`、朋友圈 `media[].url` 必须是接收端可访问的服务端 URL/路径，不能返回发送设备本地路径、仅发送者有权访问的临时 URL或已过期签名。

## 必须移除图片大小硬限制

目标是“没有产品层图片大小限制”，不是把无限大的请求完整读入应用内存。请按以下要求实现：

1. 删除聊天图片和朋友圈图片的 `2MB` 单文件校验，以及 `20MB/25MB` multipart 总大小校验；不要根据 `Content-Length`、multipart part size 或解码后的像素数返回 413。
2. 网关、Ingress、CDN/WAF 和应用服务器不得保留比业务接口更小的隐藏 body 限制。Nginx 可对这些媒体路由使用 `client_max_body_size 0`；其他网关采用等价的“关闭请求体业务上限”配置，并确认超时配置支持慢网络上传。
3. multipart 文件必须流式读取并直接写入对象存储或临时文件，禁止 `readAllBytes`、`Buffer.concat`、将整个 multipart body/图片载入 JVM、Node、Go 或 Python 进程内存。限制并发、临时磁盘和总租户配额属于基础设施保护，但不能表现为固定的单图产品限制。
4. 对象存储使用 multipart/resumable upload；上传中断应可重试，同一个 `Idempotency-Key` 不得产生重复消息、重复朋友圈或孤儿媒体。
5. 如果现有框架无法可靠接收任意大小 multipart，请新增兼容的直传流程：
   - `POST /api/v1/media/uploads` 创建上传会话，返回对象存储 multipart/resumable 签名和 `upload_id`；
   - 客户端分片直传对象存储；
   - 服务端校验对象已完整落盘后，聊天/朋友圈创建接口通过 `upload_id` 原子关联媒体；
   - 在新客户端完成切换前，现有三个 multipart 接口必须继续可用，且不得恢复 2MB 限制。
6. 只校验真实图片类型和安全性，不要用扩展名代替 MIME/sniffing；像素解码、缩略图生成、审核任务放入有明确状态和重试机制的后台队列。原文件已经安全落盘时，缩略图暂时失败不能伪装成 2xx 成功后静默丢弃整条内容。
7. 若发生存储配额耗尽、磁盘不足或对象存储不可用，应返回明确、可重试的错误码和 `request_id`，不能把基础设施故障描述成“图片过大”，也不能返回 2xx。

## 成功响应契约

私聊图片必须在事务提交后返回：

```json
{
  "code": 0,
  "data": {
    "id": 123,
    "sender_id": "peter_user_id",
    "receiver_id": "receiver_user_id",
    "msg_type": "image",
    "content": "/server/media/full.jpg",
    "thumbnail_url": "/server/media/thumb.jpg",
    "client_message_id": "same-client-id",
    "timestamp": "ISO-8601",
    "version": 1
  }
}
```

群聊图片结构相同，但用正数 `group_id` 代替 `receiver_id`。朋友圈必须返回正数 `id`、正确的 `author.user_id`、非空 `created_at`、与上传数量一致且 URL 非空的 `media[]`，并原样回传 `client_request_id`。

`Idempotency-Key` 和 body 中的 client ID 必须按“认证用户 + 会话/群/朋友圈作用域”建立唯一约束；相同 key 重试应返回同一条已提交记录，不能重复创建。

## 广播顺序与失败策略

1. 对象存储成功。
2. 数据库事务提交成功。
3. 返回权威实体并发布 WebSocket/事件总线消息。
4. 广播失败要记录并可重试，但不能让已提交消息从历史接口消失。

禁止“先返回成功，再异步尝试持久化”的实现。若业务需要审核，响应必须显式返回 `status: pending_review`，客户端不能收到普通 published/sent 成功结构。

## 验收测试

- peter → 普通用户私聊：发送后接收者实时收到；重连/刷新历史仍存在；同一幂等键重试不重复。
- peter → 群聊：至少两个其他成员实时收到；刷新群历史仍存在。
- peter 发布公开朋友圈：本人、另一个符合 world 条件的用户、一个已关注 peter 的用户均在对应接口看到同一 `moment.id`。
- 用普通用户重复同样流程，确认修复不是 peter 特判。
- 分别选择 48MP 原图、优化后仍超过 2MB 的高细节图片，以及 9 张大图发布朋友圈；均不得因文件大小返回 413，并且接收者/其他用户可看到服务端确认的同一实体。
- 在慢速网络和上传中断条件下测试重试：界面可立即显示本地发送中/发布中状态；最终只能生成一个服务端实体；失败时状态可恢复、可重试，不能显示假成功。
- 媒体 URL 分别用发送者和接收者 token 请求，均按业务权限返回 200。

请输出：根因、涉及的代码/配置/数据库迁移、修复 diff、自动化测试结果，以及一组去除 token 和隐私数据后的端到端日志。不要用 peter 用户名写硬编码特判。
