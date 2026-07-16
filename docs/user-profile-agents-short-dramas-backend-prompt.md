# BBchat 用户主页智能体与短剧列表后端改造 Prompt

请在现有 BBchat 后端中，为“查看其他用户主页”补齐按用户查询公开智能体和已发布短剧的能力。必须沿用项目当前使用的语言、框架、鉴权中间件、数据库访问层、错误码、`{code,message,data}` 响应包装和 cursor 分页规范，不要创建独立服务，也不要破坏现有 iOS 客户端。

开始编码前，请先阅读并梳理现有实现：

- `GET /users/{userID}` 或等价公开主页接口；
- `GET /chatbot/bots`、`GET /chatbot/bots/public` 及智能体创建、更新、公开状态逻辑；
- `GET /short-drama/series`、`GET /short-drama/mine`、剧集审核与发布逻辑；
- 用户、智能体 owner、短剧 creator 的数据库关联和现有 cursor 工具。

## 产品目标

其他用户主页底部有三个 Tab：朋友圈、智能体、短剧。本任务只补齐后两个 Tab 所需的后端数据：

1. “智能体”只展示该主页用户创建且当前允许公开展示的智能体。
2. “短剧”只展示该主页用户创建、至少含一个已发布分集且当前允许公开观看的剧集。
3. 不允许客户端拉取全站列表后按 `user_id` 本地过滤；筛选、权限和分页必须在服务端完成。
4. 被封禁、删除、设为私密、审核未通过或仅自己可见的内容不得出现在其他用户主页。
5. 查询不存在、已注销或不可访问的用户时，沿用公开主页接口的稳定错误语义，不得返回其他用户的数据。

## 数据模型要求

### 智能体

确认智能体表存在稳定的创建者字段，例如 `owner_user_id`。如缺失，请增加字段并完成兼容迁移：

- 新建智能体时从当前鉴权用户写入 `owner_user_id`，不得接受客户端伪造 owner；
- 为公开主页查询增加适合当前数据库的联合索引，例如 `(owner_user_id, is_public, status, created_at, id)`；
- 历史数据必须根据现有归属关系回填，无法确认归属的数据不得公开展示；
- 删除使用项目既有硬删除或软删除语义，查询必须排除已删除记录。

### 短剧

沿用现有 `short_drama_series.creator_user_id`。确认并补充适合查询的联合索引，例如：

`(creator_user_id, status, published_at, id)`。

公开剧集的判定必须同时满足：

- 剧集未删除、未被管理员下架；
- 至少存在一个 `published` 且未删除的分集；
- 返回的 `episode_count` 只统计观众可见的已发布分集；
- `episodes` 只包含已发布分集，不得混入草稿、处理中、审核中、被拒绝或失败的分集。

## API 改造

优先以向后兼容方式扩展现有接口。旧请求不传新增参数时，行为必须保持不变。

### 1. 查询指定用户的公开智能体

扩展：

`GET /chatbot/bots/public?owner_user_id={userID}&cursor={cursor}&limit={limit}`

参数：

- `owner_user_id`：可选；传入时只返回该用户创建的公开智能体；
- `cursor`：可选、不透明；
- `limit`：默认 20，最小 1，最大 60，越界按项目规范处理；
- 排序固定为 `published_at DESC, id DESC`；若没有 `published_at`，使用 `updated_at DESC, id DESC`，并保证 cursor 稳定。

响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "bots": [{
      "bot_id": "bot_123",
      "name": "旅行助手",
      "emoji": "✈️",
      "avatar_url": "https://...",
      "opening_line": "想去哪里旅行？",
      "character_background": "公开角色简介",
      "gender": "female",
      "is_public": true,
      "source_bot_id": "bot_123",
      "origin_bot_id": "bot_123",
      "created_at": "2026-07-13T01:00:00Z",
      "owner": {
        "user_id": "user_1",
        "username": "alice",
        "nickname": "Alice",
        "avatar_url": "https://..."
      }
    }],
    "has_more": true,
    "next_cursor": "opaque-cursor"
  }
}
```

兼容要求：

- 继续兼容旧客户端能够解析的 `bots` 字段；新增 `has_more` 和 `next_cursor` 不得改变旧字段含义；
- 每一项的 owner 必须来自真实 `owner_user_id` 关联用户，不能使用当前观看者；
- 仅返回客户端公开展示、导入或发起聊天所必需的字段；严禁返回内部系统提示词、密钥、审核备注、管理字段或非公开配置；
- 如果现有公共智能体市场确实依赖 `character_background` 等字段完成导入，应保持现有公开字段兼容，但仍不得扩大敏感字段范围；
- `owner_user_id` 传入后必须直接进入数据库查询条件，不能先截取全站前 N 条再过滤；
- 未传 `owner_user_id` 时维持现有公共智能体市场行为。

### 2. 查询指定用户的已发布短剧

扩展：

`GET /short-drama/series?creator_user_id={userID}&cursor={cursor}&limit={limit}`

参数：

- `creator_user_id`：可选；传入时进入“创作者主页列表”模式；
- `cursor`：可选、不透明；
- `limit`：默认 12，最小 1，最大 30；
- 当传入 `creator_user_id` 时，`tab` 可省略；如同时传入 `tab`，以创作者筛选为硬条件，不能返回其他创作者内容；
- 创作者主页模式按 `published_at DESC, series_id DESC` 稳定排序。

响应继续兼容现有 `ShortDramaSeriesPage`：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "series": [{
      "series_id": "series_1",
      "title": "东京的一天",
      "intro": "短剧简介",
      "cover_url": "https://...",
      "episode_count": 8,
      "status": "published",
      "updated_at": "2026-07-13T01:00:00Z",
      "creator": {
        "user_id": "user_1",
        "username": "alice",
        "nickname": "Alice",
        "avatar_url": "https://...",
        "followed_by_me": false,
        "follows_me": false,
        "is_friend": false
      },
      "episodes": [{
        "video_id": "episode_1",
        "series_id": "series_1",
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
    "next_cursor": "opaque-cursor"
  }
}
```

短剧安全要求：

- `creator.user_id` 必须等于请求的 `creator_user_id`，并来自剧集真实 creator 关联；
- 列表不得返回未发布分集或审核原因；
- 对收费且未解锁的分集不得返回原始 `play_url`、`hls_url`、`mp4_url` 或永久对象存储地址，只返回安全封面、价格和锁定状态；
- 免费、当前用户已解锁或作者本人观看时，可按现有规则返回短时签名播放地址；
- `followed_by_me`、`follows_me`、`is_friend` 表示当前鉴权观看者与创作者之间的关系，不得改变成创作者自己的关系；
- 未传 `creator_user_id` 时保持现有 `recommended` / `watched` 行为。

## 用户与隐私规则

- 主页用户 ID 必须按项目现有规范验证和规范化，所有查询参数化，禁止字符串拼接 SQL；
- 智能体的 `is_public` 和短剧的 `published` 是内容级公开条件，不能因为观看者关注了作者就绕过审核或可见性；
- 如项目对封禁账号、注销账号或未成年人账号有统一内容隐藏规则，这两个接口必须复用该规则；
- 私密账号如何展示公开智能体/公开短剧应与产品现有公开内容规则一致。若当前没有统一规则，默认仍只按内容公开状态展示，但不得展示任何私密内容；
- 游客是否可访问沿用现有公共市场/短剧列表规则，不新增更宽松权限。

## 缓存与失效

- 缓存键必须包含 `owner_user_id` 或 `creator_user_id`、cursor、limit 和当前观看者权限作用域；
- 智能体切换公开状态、删除，短剧/分集审核通过、下架、删除后，必须使对应用户主页列表缓存失效；
- 不得因缓存键缺少用户 ID 而把 A 用户内容返回给 B 用户；
- 如响应包含 `ETag`、版本号或现有缓存元数据，请沿用当前规范。

## 自动化测试

至少覆盖：

1. 用户 A 有公开/私密/删除智能体，查询 A 只返回公开且有效的记录；
2. 查询 A 不得返回用户 B 的智能体；
3. 不传 `owner_user_id` 时现有公共智能体市场行为不变；
4. 用户 A 有发布、草稿、审核中、驳回、下架短剧，主页只返回符合公开条件的剧集；
5. 已发布剧集中混有多种状态分集时，只返回已发布分集且 `episode_count` 正确；
6. 查询 A 不得返回用户 B 的短剧；
7. 锁定短剧分集不会泄露真实播放 URL；
8. cursor 翻页无重复、无遗漏，新增同时间记录时以 ID 作为稳定 tie-breaker；
9. 不存在、注销、封禁用户的响应符合现有用户规则；
10. owner/creator 关系字段和当前观看者 follow 关系语义正确；
11. 更新公开状态、审核状态、删除内容后缓存及时失效；
12. 非法 limit、伪造 cursor、SQL 注入样式 user ID 按规范安全失败。

## 完成后的交付内容

完成实现后请输出：

1. 数据库迁移和索引文件；
2. 路由、controller/service/repository/model 的具体改动；
3. 新旧 API 兼容说明；
4. 自动化测试命令及通过结果；
5. 两个接口可供 iOS 联调的真实请求与响应样例；
6. 明确告知 iOS 应使用的最终参数名、cursor 规则和空列表响应结构。

