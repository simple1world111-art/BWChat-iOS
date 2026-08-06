# 朋友圈重启持久化与空快照契约——后端修复 Prompt

请修复 BWChat 后端在服务重启、依赖未就绪或网络抖动时，Peter（历史账号可能为 `u005`）及其他用户的朋友圈和登录会话异常丢失问题。不要只为 Peter 写特例；修复必须适用于所有账号。

## 一、必须达到的结果

1. 后端进程、容器或主机重启后，用户、朋友圈动态、媒体元数据、点赞、评论、关注关系和 refresh session 都不能丢失。
2. 同一账号重新登录后必须得到相同且永久稳定的 `user_id`。禁止按启动顺序重新生成用户 ID。
3. 数据库或依赖暂时不可用、实例正在 warm-up、只读副本落后时，朋友圈接口必须返回明确错误（推荐 HTTP `503`），禁止伪装成 `code: 0` + `moments: []`。
4. JWT 签名密钥、refresh-token 密钥和 refresh session/revocation 状态必须跨重启持久化。服务重启本身不能让仍在有效期内的 token 失效。
5. 三个朋友圈第一页接口必须返回 `snapshot_complete`，供 iOS 判断空数组能否安全替换本地非空缓存。

## 二、需要检查并修复的持久化问题

请逐项排查：

- 朋友圈或用户数据是否保存在进程内数组、内存数据库、临时目录或没有持久卷的容器目录中。
- Docker/Kubernetes 部署是否把数据库数据目录挂载到持久卷；发布、滚动重启和扩缩容后是否仍使用同一持久数据源。
- 启动脚本、migration、seed、测试 fixture 是否执行了 drop/truncate/reset/upsert 覆盖生产数据。
- Peter 是否是启动 seed 用户；seed 必须按稳定业务主键幂等更新，不能删除并重建账号，也不能改变 `user_id`。
- 朋友圈查询是否在数据库未连接、缓存未回填或查询异常时 catch 后返回空数组。此类异常必须向上返回失败。
- refresh token 是否只存在内存；JWT/refresh 签名 secret 是否在每次启动时随机生成。

如当前使用 SQLite，请将数据库放在持久路径并验证文件与 WAL 的持久化。如使用 PostgreSQL/MySQL，请确认连接的是持久实例，并为 `moments.author_id`、关注关系和倒序游标建立合适索引。

## 三、朋友圈响应契约

以下接口都要遵守：

- `GET /api/v1/moments/world?limit=&before_id=`
- `GET /api/v1/moments/feed?limit=&before_id=`
- `GET /api/v1/moments/user/{user_id}?limit=&before_id=`

完整、权威的第一页响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "moments": [],
    "has_more": false,
    "snapshot_complete": true
  }
}
```

规则：

- `moments` 必须存在且必须是数组，禁止缺字段或返回 `null`。
- `snapshot_complete: true` 表示本次结果已从权威持久数据库完成查询、鉴权和全部可见性过滤；即使数组为空，也确认服务端真实为空。
- 数据库未就绪、缓存 warm-up、依赖超时、读副本无法确认一致性或查询被降级时，不得返回 `snapshot_complete: true`。应返回 HTTP `503` 和非零业务码，例如：

```json
{
  "code": 50301,
  "message": "moments snapshot temporarily unavailable",
  "data": null
}
```

- 不允许用空数组作为异常 fallback。
- `before_id` 非空的后续页也必须来自同一权威数据源；`has_more` 必须按过滤后的结果计算。
- `/moments/feed` 的任何服务端缓存必须至少按 viewer `user_id` 隔离，并在关注、取关、拉黑、解除拉黑、动态发布/删除和权限变化时正确失效。

## 四、鉴权与重启要求

- access token 过期时，refresh token 在有效期内必须能正常换新。
- 服务重启不能清空 refresh session 表或改变 token 签名/加密密钥。
- 只有 token 确实过期、被撤销或签名无效时才返回 `401/403`。
- 网络错误、数据库错误、依赖超时和服务 warm-up 必须返回 `5xx`，不能伪装成 token 无效。
- 不要在日志中打印原始 access token 或 refresh token；仅记录 request ID、稳定 user ID、HTTP 状态、业务码和脱敏 token 指纹。

## 五、必须补充的自动化测试

请增加真实数据库/容器级集成测试，而不只是 mock：

1. 创建 Peter 和另一普通账号，分别发布动态；重启应用实例后，用户 ID 和动态 ID/数量/内容完全不变。
2. Peter 登录取得 access/refresh token；重启实例后，用 refresh token 换新成功。
3. 先取得非空朋友圈，再模拟数据库不可用；接口返回 `503`，不能返回成功空数组。
4. 一个真实没有动态的用户请求第一页，返回 `moments: []`、`has_more: false`、`snapshot_complete: true`。
5. 模拟 warm-up 或只读副本落后，验证不会返回 `snapshot_complete: true` 的空数组。
6. 删除用户最后一条动态后，完整第一页正确返回权威空快照，iOS 可以据此清除旧缓存。
7. 两个 viewer 并发请求 `/moments/feed`，验证缓存和关注结果不会串号。
8. 重启两次并执行滚动发布，重复验证上述数据和会话均保持。

## 六、交付内容

完成后请提供：

- 根因说明，明确是数据卷、启动初始化、ID、token secret/session，还是异常 fallback 中的哪些问题。
- 修改文件清单和数据库 migration。
- 部署/持久卷配置变更。
- 三个接口的新响应示例。
- 自动化测试命令与完整结果。
- 一次“发布前 → 重启 → 发布后”的 Peter 数据行数、稳定 `user_id`、朋友圈 ID 列表和 refresh 成功证据；不得包含原始 token。
