# 地图真实定位：登录记录 + 每次访问重打点——后端实施 Prompt

你是本项目的后端工程师。请直接实现并部署本需求，不要只给分析、接口建议或伪代码。此文档对地图坐标来源的要求优先于此前“城市中心、用户 ID 哈希、随机或模糊生成坐标”的方案：这些生成坐标必须停止用于地图用户打点。

## 产品目标

1. 用户每次完成登录后，iOS 获取一次近期、精度合格的设备 GPS，并上传真实经纬度。
2. 用户每次进入地图页面，iOS 再获取一次设备 GPS 并上传；第二次、第三次访问都必须以本次新位置覆盖地图上的旧点。
3. 地图上的用户点只允许来自设备实际上传的位置记录，不得使用城市中心、资料地区、IP 定位、用户 ID 哈希或随机坐标冒充真实位置。
4. 用户关闭地图、隐身、不是好友、距离很远或旧位置过期，都不能阻止本次真实位置写入和下一次地图查询返回。

## 调整现有写入接口

```http
PUT /api/v1/map/me/location
Authorization: Bearer <access-token>
Content-Type: application/json
```

请求示例：

```json
{
  "latitude": 35.681236,
  "longitude": 139.767125,
  "accuracy_m": 12.4,
  "source": "map_visit",
  "event_id": "7CF12963-91BB-4DA7-A3DF-197E37E71121",
  "recorded_at": "2026-07-31T01:30:00Z"
}
```

`source` 允许：

- `login`：本次显式登录成功后采集；
- `map_visit`：本次打开地图页面采集；
- `foreground_update`：用户停留在地图页期间的后续更新。

必须校验：

- 经纬度为有限 JSON number，范围分别为 `[-90,90]`、`[-180,180]`，不能同时为 `(0,0)`；
- `accuracy_m` 为 `0...100`；
- `recorded_at` 与服务器当前时间差不超过 2 分钟，拒绝客户端缓存的陈旧位置；
- `event_id` 为非空 UUID，并以 `(user_id,event_id)` 建唯一约束，重复请求必须幂等；
- `user_id` 只能从 bearer token 的鉴权上下文取得，禁止信任请求体用户 ID。

## 数据模型与更新语义

至少保存两层数据：

1. `user_current_locations`：每个用户一条当前点，保存经纬度、精度、来源、客户端记录时间、服务端接收时间和最后事件 ID；
2. `user_location_events`：按事件追加的历史记录，用于审计和排查，但不得写入日志正文或分析平台。

更新规则：

- 只有 `recorded_at` 晚于当前记录时才覆盖 `user_current_locations`；
- 同一次 `event_id` 重试直接返回第一次结果，不重复追加历史；
- `map_visit` 第二次访问必须覆盖第一次访问的位置；不能因为 TTL、地图开关、隐身状态或 visibility scope 拒绝；
- 写位置接口不得擅自修改 `enabled`、`visible_on_map`、`online_status` 或 `visibility_scope`；
- HTTP 成功响应必须回传实际落库后的坐标和事件：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "presence": {
      "enabled": false,
      "visibility_scope": "off",
      "online_status": "invisible",
      "visible_on_map": false,
      "status": "off",
      "latitude": 35.681236,
      "longitude": 139.767125,
      "accuracy_m": 12.4,
      "location_source": "map_visit",
      "location_event_id": "7CF12963-91BB-4DA7-A3DF-197E37E71121",
      "location_recorded_at": "2026-07-31T01:30:00Z"
    }
  }
}
```

## 地图读取接口

`GET /api/v1/map/users` 必须使用 `user_current_locations` 的最新真实记录生成：

- `display_lat = user_current_locations.latitude`；
- `display_lng = user_current_locations.longitude`；
- 返回全部拥有真实位置记录且账号状态正常的其他用户；
- 不按半径、好友关系、地图开关、在线/隐身状态、TTL 或最近活跃时间过滤；
- 禁止城市中心、资料地区、IP、哈希、随机坐标和 `(0,0)` 回填；
- 没有任何设备真实位置记录的历史用户不能伪造点，应等待其下一次登录上传；
- 同一用户只返回一条，必须是 `recorded_at` 最新的当前点；
- `Cache-Control: private, no-store`，不同 token 不得串缓存。

`GET /api/v1/map/me` 返回本人最新真实记录的 `latitude/longitude/accuracy_m`；没有真实记录时返回 `null`，不得生成备用坐标。

## 必须完成的自动化测试

1. 用户 A 登录上传 `source=login` 后，A 的当前位置与事件表均正确写入。
2. A 第一次访问地图上传事件 V1 后地图点为 V1；第二次访问上传事件 V2 后地图点更新为 V2。
3. 重放 V2 的相同 `event_id` 不产生第二条事件，响应保持一致。
4. 较旧 `recorded_at` 晚到时不能覆盖较新的当前点。
5. A 为 `off`、`invisible`、从未开启地图时仍能写入位置，且设置状态不被改变。
6. 精度大于 100 米、过期时间、越界坐标、`NaN/Infinity`、空事件 ID 均被 4xx 拒绝。
7. B 查询 `/map/users` 能看到 A 的最新真实点，不受距离、好友关系和 TTL 影响。
8. 没有设备位置记录的账号不得生成哈希或随机点。
9. 两个 token 并发上传时只能更新各自鉴权账号，不能串号。
10. 超过 50 个有真实位置的正常账号时 `/map/users` 不得静默截断。

## 安全、日志与交付

真实位置属于高敏感数据。数据库字段应加密或使用等效保护，严格限制后台访问权限，并给出数据保留和删除方案。应用日志、结构化日志、崩溃平台和分析平台不得记录原始经纬度。

交付时提供：根因、数据库迁移、回填/清理旧生成坐标脚本、关键查询与幂等代码、全部测试结果、占位 token 的 curl 示例、生产发布监控、回滚方案。清理旧哈希/随机坐标时必须可审计且可回滚。
