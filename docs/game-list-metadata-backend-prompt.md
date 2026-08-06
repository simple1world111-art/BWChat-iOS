# BWChat 游戏列表元数据后端增量调整 Prompt

你是 BWChat 的资深后端工程师。请在现有游戏中心后端实现本次游戏列表 UI 所需的元数据升级。不要只输出方案，需要直接修改后端代码、数据库迁移、运营后台、接口响应和自动化测试，并给出部署与回滚步骤。

## 一、背景

BWChat iOS 游戏中心已将推荐和玩过列表调整为单列横向卡片。每个卡片展示：

- 左侧：游戏名称、游戏简介、游戏类型。
- 左侧：圆形展示的游戏图标（后端仍提供 1:1 方形源图，由客户端裁剪为圆形）。

现有接口主要返回：

- `id`
- `name`
- `poster_url`
- `order`
- `last_played_at`

本次需要新增：

- `description`
- `game_type`
- `icon_url`

现有接口路径、Bearer Token 鉴权、分页、会话创建、H5 启动和统一响应结构保持不变。本次不实现积分、排行榜、猫币或奖励。

API Base URL：

```text
http://52.198.192.138/api/v1
```

## 二、数据库迁移

在现有游戏表或对应游戏配置表中增加：

- `description`：游戏默认简介，文本类型，建议非空并提供安全默认值。
- `game_type`：运营展示用游戏类型，例如“益智”“棋牌”“休闲”；使用字符串或关联现有分类表。
- `icon_path`：方形游戏图标的后端受控资源路径。
- `localized_descriptions`：如果项目已有多语言 JSON 或翻译表，按现有方案保存多语言简介。
- `localized_game_types`：可选；如果游戏类型已由分类表国际化，则直接复用分类表。

要求：

1. 提供正式迁移和回滚迁移。
2. 不删除或重命名现有 `poster_url`/`poster_path` 字段。
3. 历史游戏数据迁移后仍可正常返回。
4. `icon_path` 只能指向 BWChat 后端受控的 `/api/v1/game-assets/` 资源。
5. 不允许保存任意第三方图标 URL。
6. 如果暂时没有独立图标，可在数据迁移时让 `icon_path` 为空，由接口层回退到现有海报；后续应由运营补齐方形图标。

## 三、接口调整

调整以下两个接口：

```http
GET /games/recommended?limit=50&cursor=...
GET /games/played?limit=50&cursor=...
```

所有用户接口继续使用：

```http
Authorization: Bearer <access_token>
```

统一响应结构保持：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

列表中的每个游戏必须返回：

```json
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
```

完整推荐接口示例：

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

玩过接口结构相同，但 `last_played_at` 返回 ISO 8601 字符串：

```json
"last_played_at": "2026-07-12T12:30:00.000Z"
```

实现要求：

1. `description`、`game_type` 和 `icon_url` 必须由后台动态配置，禁止根据游戏 ID 在接口代码中写死。
2. `icon_url` 返回完整 URL，并指向 BWChat 后端 `/api/v1/game-assets/`。
3. 推荐和玩过接口必须使用同一个游戏序列化器，防止字段不一致。
4. `poster_url` 必须继续返回，兼容旧版本客户端。
5. `icon_url` 缺失时，接口可以暂时回退为 `poster_url`，但不得返回空字符串或第三方地址。
6. `description` 和 `game_type` 不应返回只有空格的字符串。
7. 根据客户端语言或现有 `Accept-Language` 约定返回本地化名称、简介和类型；没有对应翻译时回退默认语言。
8. 不改变现有 cursor 排序和编码规则。
9. 不在列表接口返回 H5 真实入口地址或会话 ticket。

## 四、图标资源要求

- 推荐提供 1:1 方形图标，建议至少 512×512。
- 支持 PNG、JPEG、WebP 或 SVG；优先提供 PNG/WebP 以降低移动端列表渲染成本。
- 图标主体应尽量填满画布，不应在文件内部包含大面积透明边距。
- SVG 必须包含正确的 `viewBox`，避免图形缩在画布一角。
- 返回正确 MIME Type，例如 `image/png`、`image/webp`、`image/svg+xml`。
- 防止路径穿越、符号链接越界和任意文件读取。
- 资源可设置长期缓存，但更新图标时必须使用版本化路径或缓存失效策略。
- `icon_url` 和 `poster_url` 均不得跳转到第三方域名。

## 五、运营后台调整

在现有游戏管理页面增加：

- 游戏简介输入框。
- 游戏类型输入或分类选择器。
- 方形游戏图标上传、预览、替换和删除能力。
- 多语言简介配置；如类型使用多语言，也需要对应配置。

后台校验：

1. 简介去除首尾空格，并设置合理长度上限，建议 200～500 字符。
2. 游戏类型不能为空，并设置合理长度上限。
3. 图标必须是允许的图片类型。
4. 位图校验尺寸和文件大小；SVG 校验 XML、`viewBox` 和禁止危险外部引用。
5. 图标资源必须保存到后端受控目录。
6. 上下架、名称、简介、类型和图标修改都写入现有运营审计日志。
7. 不允许运营人员直接填写任意外部 `icon_url`。

## 六、兼容与发布顺序

采用向后兼容发布：

1. 先执行数据库迁移。
2. 部署后端接口和运营后台。
3. 为现有游戏补充简介、类型和方形图标。
4. 验证旧版客户端仍可使用 `poster_url`。
5. 再发布新版 iOS 客户端。

新版 iOS 已实现兼容逻辑：

- `icon_url` 缺失时使用 `poster_url`。
- `description` 缺失时显示本地化占位。
- `game_type` 缺失时显示“其他”。

后端仍应尽快补齐真实字段，不能长期依赖客户端占位。

## 七、自动化测试

至少覆盖：

1. 推荐接口返回 `description`、`game_type`、`icon_url`。
2. 玩过接口返回相同元数据以及正确的 `last_played_at`。
3. 两个接口的字段命名和序列化规则一致。
4. 根据语言返回对应的名称、简介和类型，并正确回退默认语言。
5. `icon_url` 是完整 URL 且属于 `/api/v1/game-assets/`。
6. 缺少独立图标时正确回退 `poster_url`。
7. 空简介、空类型、非法资源路径和第三方 URL 被后台校验拒绝。
8. PNG、WebP、SVG 返回正确 MIME Type。
9. 分页、排序、上下架和 Bearer Token 鉴权没有回归。
10. 旧版响应消费方不会因新增字段失败。
11. 日志中不出现 Bearer Token、游戏会话 ticket 或完整敏感启动 URL。

提供单元测试、接口集成测试和可直接在 CI 执行的命令及结果。

## 八、最终交付

完成后输出：

1. 修改文件清单。
2. 数据库迁移与回滚说明。
3. 推荐和玩过接口的新响应示例。
4. 运营后台字段和校验说明。
5. 图标资源存储、缓存和安全说明。
6. 多语言回退规则。
7. 自动化测试命令和结果。
8. 部署顺序及回滚步骤。
9. 尚需产品或运维确认的事项。

验收标准：后端改名、修改简介、修改类型或替换图标后，iOS 客户端刷新游戏列表即可生效，不需要客户端写死任何具体游戏内容。
