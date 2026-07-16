# BBchat 短剧后端改造 Prompt

请在现有 BBchat 后端中实现以下短剧能力。必须沿用项目当前的语言、框架、鉴权、中间件、错误响应和数据库迁移规范，不要另起独立服务。先阅读现有 `/short-drama/feed`、`/short-drama/mine`、剧集/分集上传、播放进度、钱包、交易流水、内容审核和媒体存储实现，再完成兼容迁移。

## 产品行为

- 公开短剧以“剧集”而不是散装视频返回；卡片需要海报、名称、简介、上传者和全部已发布分集摘要。
- `recommended` 返回可观看的已发布剧集；`watched` 仅返回当前用户至少播放过一集的剧集，按最近观看时间倒序。
- 点击剧集可从 `resume_episode_id + resume_position_seconds` 续播；点击分集可从该集 0 秒开始。
- 每一集可设置 `unlock_price_cat_food`，合法范围为整数 0～100；0 免费。付费解锁按“用户 + 分集”永久有效，作者本人免费。
- 创作者先保存剧集草稿，最多单批上传 20 集，最后显式提交审核。各分集独立审核和上架；修改已发布分集只让该集重新审核，不下架其他已发布分集。

## 数据模型与迁移

在现有表上补字段或增加等价表：

- `short_drama_series`：`id`、`creator_user_id`、`title`、`intro`、`cover_key/url`、`status(draft|processing|reviewing|published|rejected|failed)`、审核原因、时间戳。
- `short_drama_episodes`：`id`、`series_id`、`episode_number`、`title`、`intro`、封面与原视频/转码媒体键、时长、`unlock_price_cat_food`、独立发布状态、审核原因、时间戳；同一剧集的有效 `episode_number` 唯一。
- `short_drama_watch_progress`：`user_id`、`series_id`、`episode_id`、`position_seconds`、`duration_seconds`、`last_watched_at`；对 `user_id + episode_id` 唯一，并为用户最近观看排序建立索引。
- `short_drama_unlocks`：`user_id`、`episode_id`、`price_paid`、钱包交易 ID、`created_at`；对 `user_id + episode_id` 唯一。
- 如已有钱包流水，增加 `short_drama_unlock` 支出和创作者收益类型，保存 payer、creator、series、episode、gross amount、平台分成和幂等键。
- 迁移旧视频时按原 `drama_id/series_id` 聚合；缺失剧集的创建兼容剧集，保留旧 ID 和 URL。迁移必须可重入且不得重复扣款或重复创建分集。

## API

所有响应继续使用现有 `{code,message,data}` 包装、当前鉴权与 cursor 风格。

### `GET /short-drama/series?tab=recommended|watched&cursor=&limit=`

返回：

```json
{
  "series": [{
    "series_id": "s1",
    "title": "剧名",
    "intro": "简介",
    "cover_url": "https://...",
    "episode_count": 12,
    "status": "published",
    "creator": {
      "user_id": "u1",
      "username": "name",
      "nickname": "昵称",
      "avatar_url": "https://...",
      "followed_by_me": false,
      "follows_me": false,
      "is_friend": false
    },
    "resume_episode_id": "e3",
    "resume_position_seconds": 18.5,
    "last_watched_at": "2026-07-12T01:00:00Z",
    "episodes": [{
      "video_id": "e1",
      "series_id": "s1",
      "episode_number": 1,
      "title": "第1集",
      "intro": "",
      "cover_url": "https://...",
      "duration_seconds": 60,
      "unlock_price_cat_food": 10,
      "is_unlocked": false,
      "is_owned_by_current_user": false,
      "publish_status": "published"
    }]
  }],
  "has_more": true,
  "next_cursor": "opaque"
}
```

公开列表不得泄露锁定分集的原始播放地址。推荐排序可沿用现有推荐规则；看过列表 cursor 必须以 `last_watched_at + series_id` 稳定分页。

### `GET /short-drama/series/{seriesID}`

- 观众只能获得已发布剧集及已发布分集；作者在“我的短剧”上下文可获得所有状态和审核原因。
- 免费、已解锁或作者自己的分集返回 `play_url/hls_url/mp4_url`；其他分集不返回真实媒体地址，只返回安全封面和锁定信息。

### 创作接口

- 保留 `POST /short-drama/series`、`PATCH /short-drama/series/{seriesID}`、`POST /short-drama/series/{seriesID}/episodes`、`DELETE /short-drama/videos/{videoID}`。
- 创建和上传默认保存为草稿，不应因为文件上传完成就直接公开。
- 分集上传接收 `title`、`intro`、`episode_number`、`unlock_price_cat_food`、`video`、`cover`；价格后端再次校验 0～100，视频类型/大小/时长按现有安全策略校验。
- 新增 `PATCH /short-drama/videos/{videoID}`，接收上述元数据字段。只有作者或管理员可修改。已发布分集发生实质修改后状态改为 `reviewing`；未修改分集状态不变。
- 新增 `POST /short-drama/series/{seriesID}/submit`：校验剧名、海报和至少一个有效分集，把新增/修改分集提交审核，返回最新完整剧集。重复提交必须幂等。
- 删除分集需要验证作者权限；涉及已发布内容时使用现有软删除/媒体清理策略，不得留下可访问原文件。

### `POST /short-drama/videos/{videoID}/unlock`

- 在单个数据库事务内锁定余额记录，验证分集已发布、价格仍有效、非作者且尚未解锁。
- 余额不足返回稳定业务错误码 `insufficient_cat_food_balance`，不得扣成负数。
- 使用 `user_id + episode_id` 唯一约束保证并发双击和网络重试只扣一次；已解锁请求直接返回成功状态。
- 原子写入支出流水、创作者收益/平台分成流水和 unlock 记录，并返回解锁后带播放地址的分集及最新余额：

```json
{
  "video": { "video_id": "e1", "is_unlocked": true, "play_url": "..." },
  "wallet_balance": { "balance": 90 }
}
```

播放 URL 必须使用现有鉴权代理或短时签名 URL，不能把永久对象存储地址写入公开列表。

### `POST /short-drama/videos/{videoID}/progress`

- 保留现有入参 `position_seconds`、`duration_seconds`，upsert 当前用户分集进度并同步更新剧集最近观看时间。
- 限制负数、非有限值和异常超长值；接口应轻量、幂等，并支持客户端高频但节流后的调用。

## 权限、审核与兼容

- `/mine` 返回当前作者全部剧集与分集状态；其他写接口统一校验 ownership，管理员审核接口沿用现有 RBAC。
- 公开查询只返回 `published` 分集。剧集只要至少有一集已发布即可公开；新分集审核失败不能影响旧分集。
- 审核/转码失败要返回 `status_message`，允许作者修正后重提；状态转换必须记录审计日志。
- 旧 `/short-drama/feed` 保留至少一个客户端版本，继续返回扁平视频；数据来源改为新结构。新旧进度、点赞、收藏和评论必须指向同一 episode ID。
- 对列表、详情、解锁、提交审核、并发重复解锁、余额不足、作者免付费、逐集驳回重提、cursor 稳定性和旧数据迁移增加自动化测试。

完成后输出：迁移文件、模型/服务/路由改动、API 测试结果、旧接口兼容说明，以及供 iOS 联调的真实请求/响应样例。
