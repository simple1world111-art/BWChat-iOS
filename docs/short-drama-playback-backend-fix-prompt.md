# BBchat 短剧具体播放页后端联调修复 Prompt

请在现有 BBchat 后端中修复“进入某一部短剧后的具体分集播放页”接口与媒体播放链路。必须沿用当前项目的语言、框架、鉴权、中间件、响应包装、媒体存储和数据库模型，不要新建独立服务。先检查当前实现与真实数据库数据，再修改并提供真实联调响应；不要只更新接口文档或返回 mock 数据。

## 已完成的 iOS 前端兼容

- iOS 会把剧集层级的 `creator`、`series_id`、剧名、简介和封面回填到缺失这些字段的分集。
- iOS 会解析 `play_url`、`hls_url`、`mp4_url`、`video_url`。
- 对与 API Base URL 同协议、同主机、同端口且位于 `/api/v1` 路径下的媒体 URL，播放器会携带当前 `Authorization: Bearer <access_token>`。
- 对外部 CDN、对象存储或 API 路径外的签名 URL，iOS 不会发送 Bearer Token，防止凭证泄漏。
- 付费且未解锁的分集允许没有播放地址；免费、已解锁或作者自己的分集必须返回可播放地址。

## 必须修复的接口契约

检查并修复：

- `GET /api/v1/short-drama/series?tab=recommended|watched&cursor=&limit=`
- `GET /api/v1/short-drama/series/{seriesID}`
- `POST /api/v1/short-drama/videos/{videoID}/unlock`
- 上述接口返回的 `play_url`、`hls_url`、`mp4_url` 所指向的媒体接口、HLS 清单和分片。

所有 JSON 继续使用现有 `{code,message,data}` 包装。

### 1. 作者信息必须稳定且对应正确

每个剧集必须返回真实上传者：

```json
"creator": {
  "user_id": "u1",
  "username": "login_name",
  "nickname": "显示昵称",
  "avatar_url": "/api/v1/avatars/u1.jpg",
  "followed_by_me": false,
  "follows_me": false,
  "is_friend": false
}
```

要求：

- `creator` 必须来自剧集/分集真实的 `creator_user_id` 关联用户，不得使用当前观看者、固定测试用户或列表循环中的错误用户。
- `username`、`nickname`、`avatar_url` 必须属于同一个 `user_id`。
- 剧集详情中的所有分集如果属于同一作者，可以只依赖剧集层级 `creator`；如分集也返回 `creator`，其身份必须与剧集作者一致，字段不得为空或互相串号。
- `avatar_url` 返回稳定的绝对 URL 或 `/api/v1/...` 路径，并确保带 Bearer Token 请求时能返回 `200` 和正确图片 MIME。
- 修复旧数据迁移中 creator 外键缺失或错绑的问题，并提供一次可重入的数据校验/修复脚本。

### 2. 剧集详情必须给可观看分集返回播放地址

`GET /short-drama/series/{seriesID}` 对每一集执行以下规则：

- `unlock_price_cat_food == 0`：必须返回真实可播放地址。
- 当前用户已经解锁：`is_unlocked=true`，必须返回真实可播放地址。
- 当前用户是作者：`is_owned_by_current_user=true`，必须返回真实可播放地址。
- 付费且未解锁：`is_unlocked=false`，可以将所有真实播放地址设为 `null` 或不返回，但必须保留封面、价格、集数和发布状态。
- 已发布且有观看权限的分集，不允许出现 `play_url/hls_url/mp4_url` 全部为空。
- `publish_status` 只公开 `published` 分集；草稿、审核中、失败或已删除分集不得混入观众播放列表。

建议详情响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "series_id": "s1",
    "title": "剧名",
    "intro": "简介",
    "cover_url": "/api/v1/short-drama/covers/s1.jpg",
    "status": "published",
    "creator": {
      "user_id": "u1",
      "username": "creator",
      "nickname": "创作者",
      "avatar_url": "/api/v1/avatars/u1.jpg",
      "followed_by_me": false,
      "follows_me": false,
      "is_friend": false
    },
    "episodes": [{
      "video_id": "e1",
      "series_id": "s1",
      "episode_number": 1,
      "title": "第1集",
      "intro": "",
      "cover_url": "/api/v1/short-drama/covers/e1.jpg",
      "duration_seconds": 60,
      "publish_status": "published",
      "unlock_price_cat_food": 0,
      "is_unlocked": true,
      "is_owned_by_current_user": false,
      "hls_url": "/api/v1/short-drama/media/e1/master.m3u8",
      "mp4_url": null,
      "play_url": "/api/v1/short-drama/media/e1/master.m3u8"
    }]
  }
}
```

### 3. 媒体 URL 必须真正支持 AVPlayer

优先方案：返回有效期足够的 HTTPS 短时签名 URL，并让 HLS 清单中的子清单、音视频分片、加密 Key 全部使用同一签名体系。签名有效期不得短于一次正常播放和预加载窗口，建议至少 15～30 分钟。

如果使用同源鉴权代理 `/api/v1/...`：

- 接受 `Authorization: Bearer <access_token>`。
- MP4 支持 `HEAD`、`GET` 和 `Range`，正确返回 `200/206`、`Accept-Ranges: bytes`、`Content-Range`、`Content-Length`。
- HLS master/media playlist、分片和加密 Key 都必须可用同一 Bearer Token 访问。
- MIME 正确：`.m3u8` 使用 `application/vnd.apple.mpegurl` 或 `application/x-mpegURL`；TS/fMP4 分片使用对应视频 MIME。
- 不要把受保护请求 `302` 到一个需要 Bearer Token 但位于不同域名的地址；iOS 不会向外域转发 Token。跨域目标必须是自带签名、无需 Bearer 的 URL。
- URL 中不能返回服务器文件系统路径、过期对象键、HTML 错误页或 JSON 错误响应。
- Nginx/应用层不得缓存某个用户的鉴权结果或签名响应给其他用户。

### 4. 解锁后必须立即返回可播放分集

`POST /short-drama/videos/{videoID}/unlock` 成功后：

- 在同一事务内完成幂等解锁与扣款。
- 返回 `is_unlocked=true` 的完整分集。
- 返回新生成且当前有效的播放地址，不能仍为空，也不能复用已经过期的签名 URL。
- 重复调用不得重复扣款，并仍返回可播放分集。

### 5. 缓存与签名

- 剧集列表可以不返回真实播放地址，但剧集详情和解锁成功响应必须按当前用户实时计算观看权限。
- 不得把“未解锁用户的无播放地址响应”错误缓存给已解锁用户或作者。
- 签名 URL 过期后，重新请求剧集详情应获得新 URL。
- 如果使用 CDN，确认 HLS master playlist 内的相对路径最终能访问到所有子资源。

## 必须增加的自动化测试

至少覆盖：

1. 剧集 creator 的 `user_id/username/nickname/avatar_url` 来自同一用户。
2. 分集未重复 creator 时，剧集层级 creator 完整存在。
3. 免费分集详情返回播放地址并可实际请求首字节。
4. 未解锁付费分集不泄露地址。
5. 已解锁用户和作者得到播放地址。
6. 解锁响应立即返回新播放地址，重复解锁不重复扣款。
7. 同源 HLS 的 master、子清单、首个分片携带 Bearer 后均返回 `200/206`。
8. MP4 Range 请求返回有效 `206` 与正确 `Content-Range`。
9. 签名 URL 未过期、过期后刷新详情能获得新 URL。
10. 不同用户之间不会串 creator、解锁状态或媒体 URL 缓存。

## 完成后请输出

- 根因说明：分别解释播放失败和作者头像串号的真实原因。
- 修改的模型、查询、序列化、路由、媒体代理/Nginx 配置和迁移脚本。
- 上述自动化测试结果。
- 使用真实测试账号得到的剧集列表、详情、解锁响应样例（Token 和签名参数脱敏）。
- 对一个免费分集执行的真实 `curl`/HTTP 证据：详情响应、HLS 清单或 MP4 Range 的状态码与关键响应头。
- 是否采用“短时签名 URL”或“同源 Bearer 鉴权代理”，以及 HLS 子资源如何鉴权。
