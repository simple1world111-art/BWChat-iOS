# BWChat 游戏中心后端实施 Prompt

> 钱包隔离要求：如果进入游戏或创建游戏 session 存在入场费用，该费用必须继续只扣猫币。新资产 `activity_cat_food`（猫粮）不得抵扣游戏入场费，也不得改变现有 `cat_food` 历史字段代表猫币的语义。

你是 BWChat 的资深后端工程师。请在现有 BWChat 后端项目中直接完成游戏中心后端能力，并提供数据库迁移、接口实现、运营后台、鉴权与安全控制、自动化测试和部署说明。不要只输出设计方案。

## 一、目标与边界

为 BWChat iOS 游戏中心提供动态游戏目录和安全的 H5 启动会话。

必须实现：

- 后台动态新增、编辑、排序、上下架游戏。
- 登录用户获取推荐游戏和最近玩过的游戏。
- 点击游戏时创建短期会话，并返回可直接加载的 `launch_url`。
- H5 游戏文件由 BWChat 后端托管。
- 成功创建会话后，服务端记录该用户的最近游玩时间。
- 接口沿用 BWChat 现有 Bearer Token、错误码、日志和审计体系。

本期明确不实现：

- 游戏积分和积分上报。
- 排行榜。
- 猫币、钱包奖励和结算任务。
- App 内置 H5 游戏文件。
- 客户端自行拼接启动地址。

## 二、现有约定

API Base URL：

```text
http://52.198.192.138/api/v1
```

游戏静态资源路径：

```text
http://52.198.192.138/api/v1/game-assets/
```

统一响应结构：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

用户接口必须使用现有 Bearer Token。不要新建与现有用户体系并行的鉴权系统。

## 三、数据模型与迁移

请结合当前后端技术栈建立正式迁移，至少包含以下实体。

### 1. games

建议字段：

- `id`：稳定字符串 ID，创建后不可随意修改，例如 `open_2048`。
- `name`：默认游戏名称。
- `localized_names`：可选，多语言名称 JSON；如项目已有国际化表则复用。
- `description`：默认游戏简介。
- `localized_descriptions`：可选，多语言简介 JSON；如项目已有国际化表则复用。
- `game_type`：游戏类型，例如休闲、益智、棋牌；由运营后台配置，不由客户端推断。
- `icon_path` 或 `icon_url`：方形游戏图标，支持 PNG、JPEG、WebP、SVG。
- `poster_path` 或 `poster_url`：海报资源位置，支持 PNG、JPEG、WebP、SVG。
- `entry_path`：H5 入口资源路径，只保存服务端受控路径，不接受任意第三方 URL。
- `sort_order`：整数，数值越小或越大优先必须统一定义，并在接口中保持稳定。
- `enabled`：是否启用。
- `visible_from`、`visible_until`：可选的定时上下架时间。
- `created_at`、`updated_at`。
- `created_by`、`updated_by`：如项目已有运营审计体系则接入。

要求：

- `id` 唯一。
- 对启用状态和排序建立适用索引。
- `icon_path`、`poster_path` 和 `entry_path` 必须限制在后端受控的游戏资源目录内。
- 删除游戏优先使用下架或软删除，避免破坏历史游玩记录。

### 2. user_game_recents

建议字段：

- `user_id`。
- `game_id`。
- `last_played_at`。
- `play_count`，可选。
- `created_at`、`updated_at`。

要求：

- `(user_id, game_id)` 唯一。
- 每次成功创建会话后原子地 upsert。
- 最近玩过接口按 `last_played_at DESC`，再以稳定字段作为同时间排序条件。

### 3. game_sessions

建议字段：

- `id`：ULID、UUID 或项目现有安全 ID。
- `user_id`。
- `game_id`。
- `ticket_hash`：只保存票据摘要，不明文保存可使用票据。
- `expires_at`。
- `used_at`：用于单用途兑换。
- `revoked_at`。
- `created_at`。
- `request_id`、IP、User-Agent 等必要审计字段；遵循现有隐私规范。

要求：

- 会话绑定用户和游戏。
- 票据高熵、短期、单用途，默认有效期建议 5 分钟，可配置。
- 数据库和日志中不得记录明文 ticket。
- 为过期数据提供安全清理任务。

## 四、用户 API

所有路径均相对于 `/api/v1`，不要重复添加 `/api/v1`。

### 1. 推荐游戏

```http
GET /games/recommended?limit=50&cursor=...
Authorization: Bearer <access_token>
```

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "id": "open_2048",
        "name": "2048 数字方块",
        "description": "合并相同数字，挑战更高分数。",
        "game_type": "益智",
        "icon_url": "http://52.198.192.138/api/v1/game-assets/2048/icon.png",
        "poster_url": "http://52.198.192.138/api/v1/game-assets/2048/poster.png",
        "order": 100,
        "last_played_at": null
      }
    ],
    "next_cursor": null
  }
}
```

实现要求：

- 只返回当前已启用且在可见时间范围内的游戏。
- 服务端决定名称、简介、类型、图标、海报、排序和上下架状态。
- 排序必须稳定，例如 `sort_order ASC, id ASC`。
- `limit` 默认 50，并设置合理上限。
- 使用不透明 cursor，不允许客户端通过 cursor 注入查询条件。
- `icon_url` 和 `poster_url` 必须是可供 iOS 加载的完整 URL；为兼容旧客户端，暂时保留 `poster_url`。
- 本接口不返回真实 H5 入口地址。

### 2. 最近玩过

```http
GET /games/played?limit=50&cursor=...
Authorization: Bearer <access_token>
```

响应结构与推荐接口一致，但 `last_played_at` 返回 ISO 8601 字符串：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "id": "open_2048",
        "name": "2048 数字方块",
        "description": "合并相同数字，挑战更高分数。",
        "game_type": "益智",
        "icon_url": "http://52.198.192.138/api/v1/game-assets/2048/icon.png",
        "poster_url": "http://52.198.192.138/api/v1/game-assets/2048/poster.png",
        "order": 100,
        "last_played_at": "2026-07-12T12:30:00.000Z"
      }
    ],
    "next_cursor": null
  }
}
```

实现要求：

- 同一用户和游戏只返回一条记录。
- 按最近成功创建会话的时间倒序。
- 默认不返回已下架游戏；若产品要求保留历史入口，应只展示不可点击状态，不能继续创建会话。本期建议直接过滤。
- 无记录时返回空数组和 `next_cursor: null`，不要使用 404。

### 3. 创建游戏会话

```http
POST /games/{game_id}/sessions
Authorization: Bearer <access_token>
Content-Type: application/json

{}
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "session_id": "01K...",
    "launch_url": "http://52.198.192.138/api/v1/game-assets/2048/?ticket=...",
    "expires_at": "2026-07-12T12:35:00.000Z"
  }
}
```

实现要求：

- 校验登录态、游戏存在、已启用且当前可见。
- 在服务端根据受控 `entry_path` 生成 `launch_url`；不能使用客户端提交的 URL。
- `launch_url` 必须位于 `/api/v1/game-assets/`，不得重定向到任意第三方域名。
- 将 ticket 使用 URL-safe 编码作为查询参数。
- 会话创建成功与最近玩过 upsert 应在同一事务中完成，避免创建成功但最近记录丢失。
- 对同一用户的高频创建进行限流，但正常双击防护之外的合理重试应返回清晰错误。
- 响应、应用日志、Nginx access log 和错误追踪系统不得输出完整 ticket 或完整 `launch_url` 查询参数。

建议业务错误：

- 未登录或 token 失效：沿用现有鉴权错误。
- 游戏不存在：`game_not_found`。
- 游戏已下架或不可见：`game_unavailable`。
- 请求过频：`game_session_rate_limited`。
- 资源配置错误：内部错误，对客户端返回通用信息。

## 五、Ticket 兑换与 H5 资源访问

当浏览器访问带 ticket 的 H5 入口时，后端必须：

1. 从查询参数读取 ticket，但禁止记录明文。
2. 对 ticket 做摘要后查询会话。
3. 校验会话未过期、未撤销、未使用，并与入口游戏匹配。
4. 原子标记 `used_at`，防止并发重放。
5. 成功后建立短期、HttpOnly 的游戏访问 Cookie，或通过等效的服务端会话方式允许同源静态资源继续加载。
6. Cookie 至少设置 `HttpOnly`、合理 `SameSite` 和最短必要有效期；迁移 HTTPS 后必须设置 `Secure`。
7. 票据无效、过期或已使用时返回友好的失效页，不泄露内部原因。

注意：HTML、JS、CSS、图片、字体和音频等后续资源不能要求重复消费同一个单用途 ticket。应由兑换后建立的短期同源会话授权，或让无敏感内容的静态资源以只读方式提供。

## 六、游戏资源托管

- 所有游戏内容位于后端受控目录，并通过 `/api/v1/game-assets/{game}/...` 提供。
- 防止 `..`、双重 URL 编码、符号链接越界和任意文件读取。
- 返回正确的 MIME Type，包括 `.svg`、`.js`、`.css`、字体、音频和 WebAssembly。
- 静态资源可设置版本化缓存；入口 HTML 和会话兑换响应禁止被公共缓存。
- 设置适当的 `Content-Security-Policy`，默认禁止摄像头、麦克风、定位和支付相关能力。
- 设置 `X-Content-Type-Options: nosniff`、合理的 Referrer Policy，并限制 iframe 嵌入来源。
- H5 不得把 ticket 写入 localStorage、日志或分析事件。
- 游戏资源引用应使用同源相对路径，避免 iOS WebView 同源限制阻止加载。

## 七、运营后台

在现有运营后台加入游戏管理，不创建孤立的管理系统。至少支持：

- 新增和编辑游戏。
- 配置稳定 ID、多语言名称、多语言简介、游戏类型、方形图标、海报、入口路径、排序、启用状态和定时上下架。
- 海报预览及 PNG/SVG 类型校验。
- 校验入口文件存在且位于允许目录。
- 上下架二次确认。
- 权限分级，仅授权运营人员可修改。
- 记录操作人、修改前后内容、时间和 request ID。

禁止运营人员直接填写任意外部 `launch_url`。后台只能选择或填写后端受控的资源路径。

## 八、安全、限流与审计

- 所有用户接口复用现有 Bearer Token 中间件。
- 对游戏目录接口进行按用户/IP 的读取限流；对创建会话使用更严格限流。
- ticket 至少使用密码学安全随机数，不能由 session ID、用户 ID 或时间戳推导。
- 票据比较使用安全比较方式。
- 防止重放、路径穿越、开放重定向和 cursor 篡改。
- 日志中对 Authorization、ticket、Cookie 和完整查询参数脱敏。
- 审计游戏配置变更和异常高频会话创建。
- 数据库故障时不能返回已生成但未持久化的有效 ticket。

当前使用 HTTP IP 仅用于兼容现有环境。请同时给出迁移到正式 HTTPS 域名的步骤，包括证书、反向代理、资源 URL、Cookie `Secure` 和 iOS ATS 收紧计划，但不要擅自改变当前客户端契约。

## 九、自动化测试

至少覆盖：

1. 未登录、token 过期和正常登录。
2. 推荐列表的启用状态、可见时间、稳定排序和分页 cursor。
3. 最近玩过去重、倒序、空列表和已下架过滤。
4. 游戏 ID 不存在、已下架和配置损坏时禁止创建会话。
5. 成功创建会话同时更新最近玩过。
6. ticket 随机性、过期、撤销、单用途和并发重放。
7. ticket 不能用于另一款游戏入口。
8. 创建会话限流。
9. `icon_url`、`poster_url` 和 `launch_url` 始终属于允许的后端资源路径。
10. PNG、SVG、JS、CSS、字体和其他游戏资源返回正确 MIME Type。
11. 路径穿越、双重编码和非法外部重定向被拒绝。
12. 日志测试确认不会记录 Bearer Token 或明文 ticket。
13. 数据库事务回滚时不会遗留有效会话或错误的最近玩过记录。

提供接口级集成测试，并给出可在 CI 中直接执行的命令和结果。

## 十、部署与验收

实施完成后必须：

1. 运行数据库迁移并提供可回滚方案。
2. 初始化至少两条测试游戏配置，但业务代码不得写死游戏名称或 ID。
3. 验证推荐、玩过和创建会话三个接口的真实 Bearer Token 调用。
4. 验证 iOS WKWebView 可加载 HTTP 游戏入口及全部同源资源。
5. 验证后台上下架、改名、换海报和排序后，App 刷新即可生效。
6. 验证完整 launch URL 和 ticket 未出现在服务器日志中。
7. 给出变更文件清单、迁移文件、环境变量、部署命令和测试结果。

最终验收标准：

- App 不包含任何 H5 游戏文件。
- 客户端不写死具体游戏。
- 游戏目录完全由后台配置控制。
- 点击游戏必须先创建服务端会话。
- `launch_url` 由后端生成且仅指向 BWChat 受控游戏资源。
- 成功创建会话后，“最近玩过”立即更新且不重复。
- 下架游戏无法新建会话。
- ticket 短期、单用途、不可重放且不会泄露到日志。
- 不存在积分、排行榜、猫币或奖励相关实现。

## 十一、最终交付格式

完成实施后请输出：

1. 后端修改文件清单。
2. 数据库表与迁移说明。
3. 三个用户接口和运营后台说明。
4. ticket 生命周期及安全控制说明。
5. 游戏资源部署与缓存策略。
6. 自动化测试命令和结果。
7. 部署、回滚和 HTTPS 迁移步骤。
8. 尚需产品或运维确认的事项。
