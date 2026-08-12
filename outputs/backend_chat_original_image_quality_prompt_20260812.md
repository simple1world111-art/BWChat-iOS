# 后端排查与修复 Prompt：聊天大图必须返回原图，不能返回缩略图

请排查并修复 BBchat 私聊、群聊图片消息的“点击查看大图仍然模糊”问题。客户端已经按正确职责拆分：消息列表加载 `thumbnail_url`，全屏预览、左右滑动图库和保存到相册加载 `content`。后端必须保证这两个字段指向不同用途、可被会话参与者访问的媒体资源。

## 当前客户端上传与读取契约

- 私聊上传：`POST /api/v1/chat/messages/image`
  - multipart：`receiver_id`、`client_message_id`、`image`、`thumbnail`
  - header：`Idempotency-Key: <client_message_id>`
- 群聊上传：`POST /api/v1/groups/{group_id}/messages/image`
  - multipart：`client_message_id`、`image`、`thumbnail`
  - header：`Idempotency-Key: <client_message_id>`
- `image` 是供全屏预览/保存使用的较高清 JPEG；当前客户端最长边最高 1200px、目标约 2MB。
- `thumbnail` 是仅供消息列表快速展示的派生图；当前客户端最长边最高 360px、目标约 140KB。
- 上传成功响应、历史接口和 WebSocket 消息都必须保持：
  - `content`：原图/高清图 URL 或服务端路径；
  - `thumbnail_url`：缩略图 URL 或服务端路径；
  - `media_width`、`media_height`：原图方向与尺寸元数据（若接口已有这两个字段）。

## 必须排查的根因

1. 检查 multipart 解析和对象存储写入，确认 `image` 与 `thumbnail` 没有因为临时文件名、对象 key、变量名或 upsert key 相同而互相覆盖。
2. 检查数据库写入及所有响应 DTO/serializer，确认没有把 thumbnail object key 同时赋给 `content` 和 `thumbnail_url`，也没有颠倒两个字段。
3. 检查图片处理流水线，禁止对 `image` 再套用缩略图参数（例如最长边 360px、质量 0.58、140KB）。服务端若需要转码，原图变体应保留至少上传的有效像素，不得二次降成缩略图。
4. 检查 CDN、图片代理和 URL rewrite。请求 `content` 时不能被默认追加 thumbnail preset，也不能因为 cache key 未包含变体/路径而命中 `thumbnail_url` 的缓存内容。
5. 检查以下所有消息出口是否一致返回同一组原图/缩略图字段：
   - 图片上传成功响应；
   - 私聊历史与单条消息查询；
   - 群聊历史与单条消息查询；
   - 私聊 WebSocket 消息；
   - 群聊 WebSocket 消息；
   - 转发、回复引用或消息同步中返回完整消息实体的接口。
6. 用发送者、私聊接收者和至少一个群成员的 token 分别请求 `content` 与 `thumbnail_url`，确认均按会话权限返回真实图片 200，而不是登录页、错误 JSON、低清占位图或仅发送者可访问的临时 URL。
7. 检查历史数据：
   - 若对象存储中原图仍存在，只是数据库/DTO 指错 URL，迁移并回填 `content`；
   - 若原图曾被缩略图覆盖或删除，不能从 360px 缩略图恢复清晰度。请明确列出受影响消息范围，并制定重新上传/标记不可恢复方案。

## 成功响应契约

私聊图片应返回类似：

```json
{
  "code": 0,
  "data": {
    "id": 123,
    "sender_id": "sender_user_id",
    "receiver_id": "receiver_user_id",
    "msg_type": "image",
    "content": "/media/chat/original/message-123.jpg",
    "thumbnail_url": "/media/chat/thumbnail/message-123.jpg",
    "media_width": 1179,
    "media_height": 2556,
    "client_message_id": "same-client-id",
    "timestamp": "ISO-8601",
    "version": 1
  }
}
```

群聊结构相同，但使用正确的正数 `group_id`。不得只新增 `original_url` 而把 `content` 继续指向缩略图；现有客户端以 `content` 作为全屏原图字段。正常上传时 `content` 与 `thumbnail_url` 不应相同。

## 验收测试

1. 上传一张包含小号文字、分辨率不低于 1179×2556 的聊天截图，分别记录上传 multipart 中 `image` 和 `thumbnail` 的 SHA-256、字节数与解码尺寸。
2. 上传成功后立即下载响应中的 `content` 和 `thumbnail_url`，再次记录 SHA-256、字节数与解码尺寸：
   - `content` 必须对应 `image`/高清处理结果，长边不能被降到 360px；
   - `thumbnail_url` 应对应缩略图；
   - 两个 URL、对象 key 和实际内容不得错误复用。
3. 发送方和接收方分别刷新私聊历史，确认 `content` 一致且双方下载到同一个高清资源。
4. 在群聊中由一个成员发送，同群另外两个成员通过实时消息及刷新历史验证同一结果。
5. 让 CDN 缓存预热后交替请求原图、缩略图各 20 次，确认不会发生变体串缓存。
6. 相同 `Idempotency-Key` 重试必须返回同一消息及同一组媒体 URL，不得生成重复记录或丢失原图关联。

请输出：根因、涉及代码/配置/数据库迁移、修复 diff、历史数据影响范围、自动化测试结果，以及去除 token 和隐私数据后的端到端 request-id 日志。禁止通过把缩略图 URL 复制到 `content` 来规避 404；这会直接导致客户端全屏预览模糊。
