# 地图默认显示全部用户——后端实现 Prompt

> 坐标来源要求已由 `map-real-location-login-visit-backend-prompt.md` 取代。不得再使用城市中心、用户 ID 哈希或随机坐标生成地图点；请结合最新 Prompt 实施。

你是本项目的后端工程师。请直接实现并部署“地图默认显示全部其他用户”，不要只给分析、伪代码或接口建议。需要完成接口、查询、坐标回填、自动化测试和接口验证，并输出根因、修改文件、测试结果、部署步骤与回滚方案。

## 产品要求（以此为准）

iOS 地图页不再区分“附近/好友”，也不显示筛选、范围或空态组件。页面打开后必须默认返回并绘制所有可用的其他用户。

新增接口：

```http
GET /api/v1/map/users
Authorization: Bearer <access-token>
```

客户端可能附带 `lat`、`lng`，它们只能用于计算 `distance_m` 或排序，绝不能用于半径筛选。

## 禁止施加的筛选或上限

`GET /map/users` 不得因为以下条件排除用户：

- 距离或国家/城市；
- `radius_m`；
- 是否好友或关注关系；
- `include_friends`；
- `visibility_scope`；
- `online_status`；
- `enabled`、`visible_on_map`；
- 用户是否开启过地图；
- 位置 TTL、`expires_at` 或最近活跃时间；
- 默认 `limit=50`、分页默认值或数据库查询的隐式上限。

除当前登录用户本人、已删除账号、已封禁账号等硬性账号安全状态外，所有正常账号都必须出现在结果中。不要复用 `/map/nearby` 的候选筛选 SQL；为 `/map/users` 编写独立的全量查询。

## 坐标要求

每个返回用户必须有可绘制的隐私展示坐标：

- `display_lat` 为 JSON number，范围 `[-90, 90]`；
- `display_lng` 为 JSON number，范围 `[-180, 180]`；
- 两者不能同时为 `0`；
- 不能返回 `null`、空字符串或省略字段；
- 不要直接暴露精确实时住址，使用粗粒度、模糊后的公开展示坐标。

请为没有有效地图位置的现有账号执行一次性回填，并保证新账号创建时也会生成展示坐标。建议优先级：

1. 有历史位置：使用经过网格模糊后的最后位置，不检查 TTL；
2. 有资料城市/地区：使用该地区中心点加稳定的确定性偏移；
3. 两者都没有：根据用户 ID 哈希生成稳定的粗粒度公开坐标。

同一用户的回填坐标必须稳定，不能每次请求随机跳动。禁止用 `(0,0)` 作为缺失值。

## 固定响应契约

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "viewer_id": "current-user-id",
    "snapshot_id": "unique-snapshot-id",
    "users": [
      {
        "user_id": "other-user-id",
        "nickname": "User name",
        "avatar_url": "https://example.com/avatar.jpg",
        "online_status": "online",
        "visibility_scope": "off",
        "distance_m": 123456,
        "distance_text": "123 km",
        "display_lat": 35.6812,
        "display_lng": 139.7671,
        "last_active_at": "2026-07-31T00:00:00Z"
      }
    ]
  }
}
```

要求：

- `users` 必须包含全部符合硬性账号安全条件的其他用户，不能静默截断；
- 空结果只能是 `"users": []`，不能为 `null`、缺失或改名；
- `user_id` 必须是非空字符串，且每个用户只出现一次；
- `viewer_id` 必须来自本次鉴权上下文；
- `snapshot_id` 必须能追踪本次查询；
- 返回 `Cache-Control: private, no-store`，禁止跨 token 共享缓存；
- HTTP 2xx 才表示成功，错误不能伪装成 HTTP 200 + `data: null`。

如果用户量已经大到单次 JSON 不适合传输，请不要自行恢复数量限制。先实现完整结果并在交付说明中报告实测响应大小和延迟，再提出服务端聚合/地图瓦片方案供产品确认。

## 必须完成的测试

1. 建立 A、B、C 三个正常账号，A 请求时结果包含 B、C，不包含 A。
2. B 为 `off`、`invisible`、从未开启地图、位置过期时，A 仍能看到 B。
3. C 与 A 不同国家且距离超过 50,000 km 的边界场景，A 仍能看到 C。
4. B 不是好友、被取消关注时仍返回。
5. 请求携带或不携带 `lat/lng`，用户集合完全一致。
6. 数据库中超过 50 个正常账号时，响应不能只返回前 50 个。
7. 无历史位置、无资料地区的账号经过回填后仍有稳定、有效、非 `(0,0)` 的展示坐标。
8. 两个不同 bearer token 请求相同 URL 时，`viewer_id` 和排除的本人正确，不会缓存串号。
9. 一条脏账号数据不能导致整批响应失败；应修复/跳过并记录结构化告警。

## 可观测性与交付

结构化日志至少记录 `request_id`、`snapshot_id`、哈希后的 `viewer_id`、正常账号总数、坐标回填数、最终返回数、查询耗时、序列化耗时和响应字节数；不要记录精确原始坐标或真实 token。

完成后提供：

- 实际根因与修复前后证据；
- 变更文件、数据库迁移和回填脚本；
- `/map/users` 的关键查询代码；
- 全部测试结果；
- 使用占位 token 的 curl 验证示例；
- 生产发布、监控和回滚方案。
