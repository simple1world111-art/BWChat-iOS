# 地图始终显示本人头像——后端修复 Prompt

> 本文的生成/模糊坐标兜底方案已废弃。请以 `map-real-location-login-visit-backend-prompt.md` 为准，只使用设备实际上传的位置打点。

你是本项目的后端工程师。请直接实现并部署“地图页始终可以获得当前登录用户的公开展示坐标”，不要只给分析、伪代码或接口建议。完成代码、数据库回填、自动化测试和接口验证后，输出修改文件、测试结果、部署步骤及回滚方案。

## 背景与目标

iOS 地图页通过以下接口加载当前用户自己的地图标记：

```http
GET /api/v1/map/me
Authorization: Bearer <access-token>
```

设备授权定位时，客户端会优先使用本机坐标。用户拒绝定位、尚未授权、处于 `off`/`invisible`、从未开启地图或位置已过期时，接口仍必须返回一组稳定、隐私安全、可绘制的公开展示坐标，供客户端显示本人的头像。

这项要求只用于绘制本人标记，不得自动把用户改成在线、开启地图可见性或公开精确位置。

## `/map/me` 响应要求

在现有 presence 对象中增加并始终返回：

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
      "latitude": null,
      "longitude": null,
      "display_lat": 35.6812,
      "display_lng": 139.7671
    }
  }
}
```

要求：

- `display_lat`、`display_lng` 对所有正常账号始终存在且为 JSON number；
- 坐标范围分别为 `[-90, 90]`、`[-180, 180]`，两者不能同时为 `0`；
- `off`、`invisible`、`needs_location`、`stale` 状态均不得把展示坐标置空；
- `latitude`、`longitude` 可继续表达设备上传的精确/历史位置，没有时可以为 `null`；
- `display_lat`、`display_lng` 必须是经过模糊处理的公开展示坐标，禁止直接暴露精确实时住址；
- 响应使用 `Cache-Control: private, no-store`，禁止不同 token 之间串缓存。

## 展示坐标生成和回填

为所有缺少有效展示坐标的历史账号执行一次性回填，并保证新账号创建时同步生成。坐标必须稳定，不能每次请求随机变化。生成优先级：

1. 有历史位置：对最后位置进行隐私网格模糊；不受位置 TTL 限制；
2. 有资料城市/地区：使用地区中心点加基于用户 ID 的确定性偏移；
3. 两者都没有：根据用户 ID 哈希生成稳定的粗粒度公开坐标。

不要使用 `(0, 0)`、随机坐标或请求时临时生成后不落库的坐标。

## 必须完成的测试

1. 当前用户为 `off` 时，`/map/me` 仍返回有效 `display_lat/display_lng`，且不改变其可见性状态。
2. 当前用户为 `invisible`、从未开启地图、位置过期时同样返回稳定展示坐标。
3. 无定位历史、无资料地区的账号回填后坐标有效、非 `(0,0)`，重复请求结果一致。
4. 两个不同 bearer token 请求时返回各自的展示坐标，不发生缓存串号。
5. `latitude/longitude` 为 `null` 时仍正常返回，不得导致 HTTP 500 或 `data: null`。
6. 已有精确位置时不得把它原样复制到公开展示坐标；验证网格模糊生效。
7. 新账号创建后立即请求 `/map/me`，无需先打开地图也能获得展示坐标。

## 交付要求

请提供实际根因、数据库迁移与回填脚本、关键接口代码、全部测试结果、使用占位 token 的 curl 验证示例、生产发布与回滚方案。日志不得记录 bearer token 或原始精确坐标。
