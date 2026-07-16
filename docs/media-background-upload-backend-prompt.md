# 媒体后台上传与可靠发布：后端实现 Prompt

请直接在当前后端仓库中实现“图片/视频先在客户端本地展示，服务端后台可靠接收并最终提交业务记录”的能力，覆盖私聊、群聊、朋友圈和短剧。不要新建独立媒体微服务，也不要绑定新的云厂商；优先复用现有鉴权、对象存储、上传工具、消息表、朋友圈表、短剧表、任务队列、WebSocket 和 `{code,message,data}` 响应包装。

## 一、先检查现有实现

开始编码前先定位并总结：

1. 私聊和群聊图片/视频 multipart 接口、消息创建逻辑及 WebSocket 推送逻辑。
2. 消息是否已有 `client_message_id` 唯一约束，图片/视频接口是否也接收该字段。
3. 朋友圈创建接口是否把媒体上传和动态入库放在同一请求中。
4. 短剧系列、分集草稿、视频上传、转码及提交审核的现有状态机。
5. 当前对象存储是否支持预签名直传、分片/断点续传、上传完成回调及文件校验。
6. 当前任务队列、失败重试、鉴权、限流、内容审核、日志脱敏和过期文件清理机制。

必须基于检查结果复用现有基础设施；如已有同等能力，只补齐缺失字段与幂等约束。

## 二、目标行为

- iOS 选择媒体后立即生成本地记录，不等待上传完成即可退出当前页面。
- 后端把“上传二进制”和“提交消息/朋友圈/短剧业务记录”拆开。
- 同一个客户端任务反复请求、网络重试或队列重跑，最多生成一条业务记录。
- 客户端被挂起或重启后，可依据服务端上传任务状态续传或重新提交。
- 上传失败保留草稿，可重试或主动取消；过期草稿和孤儿文件可回收。
- 成功提交仍沿用现有消息 WebSocket 事件和数据模型，老客户端不受影响。

## 三、统一上传会话

新增或复用统一上传会话模型，至少包含：

```text
upload_id
owner_user_id
scene                 // direct_message | group_message | moment | short_drama_cover | short_drama_episode
client_request_id     // 客户端稳定 UUID
filename
mime_type
byte_size
sha256                // 可选但推荐
storage_key
status                 // created | uploading | uploaded | committed | failed | cancelled | expired
uploaded_bytes
expires_at
created_at / updated_at
```

唯一约束：`(owner_user_id, scene, client_request_id)`。所有状态推进必须使用事务或原子条件更新，不允许从终态回退。

接口建议（路径可按现有路由风格调整，但语义必须保留）：

### 1. 创建或恢复上传会话

`POST /media/uploads`

```json
{
  "scene": "group_message",
  "client_request_id": "0F77...",
  "filename": "video.mp4",
  "mime_type": "video/mp4",
  "byte_size": 18392012,
  "sha256": "optional"
}
```

相同 `client_request_id` 必须返回同一个 `upload_id`。响应返回当前状态，以及以下二者之一：

- 对象存储预签名直传地址、headers、有效期和分片信息；或
- 复用当前服务器的可续传上传地址及 offset。

### 2. 查询状态

`GET /media/uploads/{uploadID}`

返回 `status`、`uploaded_bytes`、`byte_size`、过期时间和可恢复上传所需信息。不得返回对象存储密钥、服务端凭证或内部绝对路径。

### 3. 完成上传

`POST /media/uploads/{uploadID}/complete`

服务端校验 ownership、文件大小、MIME、魔数、可选 SHA-256，并确认对象确实存在。接口必须幂等。

### 4. 取消上传

`DELETE /media/uploads/{uploadID}`

仅未提交的 owner 可取消。异步清理对象存储临时文件。

如果当前对象存储不支持直传，允许第一期继续走应用服务器，但必须支持文件流式落盘/转存，禁止把完整视频读入内存，并保留上述会话和幂等语义。

## 四、各业务的原子提交接口

### 私聊与群聊

扩展现有发送消息接口，使图片和视频与文本一样接收 `client_message_id`，并为发送者建立唯一约束。推荐统一请求：

```json
{
  "client_message_id": "稳定 UUID",
  "msg_type": "video",
  "upload_id": "upl_xxx",
  "receiver_id": "user_xxx",
  "reply_to_id": null
}
```

群聊改为传 `group_id`。提交事务中必须：校验 upload owner/scene/status、校验好友或群成员权限、创建或取得既有消息、把 upload 标为 `committed`。事务成功后再通过现有 `new_message` / `new_group_message` 推送。重复提交返回同一条消息，不再次推送。

旧 multipart 图片/视频接口暂时保留，内部可转调新流程，确保历史客户端兼容。

### 朋友圈

新增朋友圈草稿/提交语义，推荐：

- `POST /moments/drafts`：以 `client_request_id` 幂等创建草稿，保存正文、可见范围、付费配置。
- `PUT /moments/drafts/{draftID}/media`：按顺序绑定已完成的 `upload_id`。
- `POST /moments/drafts/{draftID}/publish`：事务中校验全部媒体并只创建一条朋友圈。
- `GET /moments/drafts/{draftID}`、`DELETE /moments/drafts/{draftID}`：恢复和取消。

发布接口重复调用返回同一 `moment`。异步审核可以事后隐藏，但不得因为媒体仍在上传就创建一个公开的残缺朋友圈。

### 短剧

复用现有系列和分集草稿，不再要求一次 multipart 同时上传整段视频：

- 系列和分集元数据先保存为 draft。
- 封面、分集视频分别绑定已完成的 `upload_id`。
- `POST /short-dramas/series/{seriesID}/episodes/{episodeID}/commit-media` 幂等绑定媒体。
- 所有分集媒体完成后，现有 submit 接口原子推进到 submitted/processing。
- 转码任务以 `episode_id + source_upload_id` 唯一，队列重跑不得生成重复转码任务。

## 五、状态通知

在现有 WebSocket 上新增向当前用户私发的兼容事件：

```json
{
  "event": "media_upload_state",
  "data": {
    "upload_id": "upl_xxx",
    "client_request_id": "0F77...",
    "scene": "moment",
    "status": "uploaded",
    "uploaded_bytes": 18392012,
    "byte_size": 18392012,
    "error_code": null,
    "message": null
  }
}
```

短剧继续发送现有处理/审核状态事件；如果没有则补充 `short_drama_processing_state`。事件中禁止出现预签名 URL、对象存储 key、内部路径、鉴权 token。

## 六、校验、安全与清理

- 所有接口验证 JWT、ownership、scene 与业务类型匹配、文件大小、扩展名、MIME 和文件魔数。
- 使用现有配置定义图片/视频最大体积、允许格式、单用户并发数及速率限制，客户端值不可信。
- 日志禁止记录二进制、预签名 URL、token 和完整用户隐私内容。
- 上传完成但 24 小时未提交的临时对象，以及过期/取消会话，由定时任务清理；清理任务幂等。
- 内容审核和病毒检测复用现有服务。检测失败要给稳定错误码，允许用户替换媒体。
- 数据库迁移必须可回滚；新增唯一索引前先处理历史重复数据。

## 七、错误码

至少提供稳定业务错误码：

```text
UPLOAD_NOT_FOUND
UPLOAD_EXPIRED
UPLOAD_INCOMPLETE
UPLOAD_OWNER_MISMATCH
UPLOAD_SCENE_MISMATCH
UPLOAD_TYPE_NOT_ALLOWED
UPLOAD_SIZE_EXCEEDED
UPLOAD_CHECKSUM_MISMATCH
MEDIA_COMMIT_CONFLICT
MEDIA_PROCESSING_FAILED
```

网络超时或 5xx 可重试；权限、格式和体积错误不可自动重试。响应继续使用项目现有 `{code,message,data}`。

## 八、验收与测试

必须提供自动化测试并输出真实联调样例：

1. 同一 `client_request_id` 并发创建只得到一个上传会话。
2. 同一 `client_message_id` 重复提交只得到一条私聊/群聊消息和一次 WebSocket 推送。
3. 朋友圈 publish、短剧 commit/submit 重复调用不重复创建记录或任务。
4. 断点续传、进程重启恢复、上传过期、取消、校验失败和对象不存在。
5. 非 owner、退群用户、错误 scene、超限文件均被拒绝。
6. 大视频流式处理不造成应用服务器内存随文件体积线性增长。
7. 老 multipart 接口和旧客户端解码保持可用。
8. 孤儿文件清理只删除未提交对象，不误删已发布业务资源。

最终交付：迁移文件、模型/路由/服务/队列改动、环境配置说明、回滚说明、自动化测试结果，以及供 iOS 使用的完整创建上传—上传/续传—complete—业务 commit 请求响应样例。
