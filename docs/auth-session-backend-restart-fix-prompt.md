# BBchat 后端重启不应导致用户重新登录：修复 Prompt

你是 BBchat 项目的资深后端与安全工程师。请直接检查并修复现有鉴权、JWT、refresh token、WebSocket 鉴权和部署配置，使后端进程重启、容器重建、滚动发布或短时故障不会让已登录用户被迫重新登录。

不要只给建议。请先阅读现有实现与部署配置，定位根因，修改代码、配置、迁移和测试，并给出可复现的重启前后验证证据。必须沿用项目当前框架、数据库、Redis、迁移工具、配置管理和响应结构，不要另起一套独立鉴权服务。

## 已知客户端契约

- API 基址：`http://52.198.192.138/api/v1`
- WebSocket：`ws://52.198.192.138/ws?token=<access_token>`
- 登录：`POST /api/v1/auth/login`
- 刷新：`POST /api/v1/auth/refresh`，请求体：

```json
{
  "refresh_token": "<refresh-token>"
}
```

- 登录与刷新成功响应中的 `data` 必须包含：

```json
{
  "token": "<access-token>",
  "refresh_token": "<rotated-or-current-refresh-token>",
  "user": {}
}
```

- iOS 将 access token 和 refresh token 持久化在 Keychain。
- iOS 只会在 refresh token 被服务器明确以 `401`（或项目统一的明确失效状态）拒绝时清除本地登录态。
- 网络超时、连接失败、响应解析失败、`429` 和 `5xx` 都被视为临时故障，客户端会保留登录态并退避重试。

## 必须排查的根因

逐项检查并用代码、运行配置或日志证明结论：

1. JWT 签名密钥是否在每次进程启动时随机生成，或在不同实例间不一致。
2. `.env`、Docker/Kubernetes Secret、systemd EnvironmentFile、CI/CD secret 注入是否稳定，重启或重新部署后是否改变。
3. access token 与 refresh token 是否使用不同密钥、算法、issuer 或 audience；所有实例是否完全一致。
4. refresh token、session、JTI、token family、撤销列表或黑名单是否仅保存在进程内存。
5. Redis 是否使用持久卷/持久化策略，容器重建后 session 是否丢失；数据库迁移或启动脚本是否会清表。
6. 多实例或滚动发布时，是否存在各实例密钥不同、session 本地化、负载均衡后请求落到另一实例即 401 的问题。
7. 服务刚启动、数据库/Redis 尚未 ready 时，鉴权中间件是否错误返回 401，而不是 503。
8. WebSocket 握手失败时，是否把数据库、Redis、内部依赖或服务未就绪错误错误映射成 401/403。
9. refresh token rotation 是否存在并发刷新竞态，导致同一客户端启动时多个请求使整个 token family 被误判为重放并撤销。
10. 服务器时间、容器时区和 NTP 是否正常，是否因时间漂移使 `exp`、`nbf`、`iat` 校验异常。

## 必须实现的行为

### 1. 稳定的 JWT 密钥

- JWT 密钥必须来自外部持久配置，不得在应用启动时生成。
- 所有副本必须读取同一版本的密钥。
- 启动时若密钥缺失、为空、仍是示例值或长度/强度不足，生产环境必须 fail fast，不能静默生成新密钥。
- 不得把真实密钥提交到 Git、镜像、日志或响应中。
- 如需密钥轮换，实现 `kid` 与验证密钥环：新 token 使用当前密钥签发，旧密钥至少保留到其签发的最长 refresh token TTL 结束。不能通过直接替换唯一密钥让全体用户掉线。

### 2. 持久化 refresh session

- 将 refresh session/token family/JTI/撤销状态持久化到项目现有数据库或持久化 Redis。
- 数据至少能表达：用户、token 哈希或 JTI、family ID、签发时间、过期时间、撤销时间、替换关系、设备标识（若现有系统支持）。
- 数据库中不得明文保存 refresh token；保存安全哈希或不可逆标识。
- 进程重启、容器重建和请求切换到另一实例后，旧 refresh token 在有效期内仍能正常刷新。
- 用户主动退出、修改密码、封禁账号或明确安全事件仍应按现有策略撤销相应 session。

### 3. 正确区分鉴权失败和临时故障

- 仅在 token 缺失、格式错误、签名无效、已过期、已撤销或用户/session 明确无效时返回 401/403。
- 数据库、Redis、依赖服务不可用，服务启动未 ready，内部异常或超时必须返回 503/5xx，不能伪装成 401。
- `/auth/refresh` 的 401 表示客户端必须重新登录，因此必须只用于不可恢复的 refresh token 失效。
- 错误响应继续遵循项目既有 JSON schema，同时提供稳定的机器可读错误码，例如：
  - `access_token_expired`
  - `refresh_token_expired`
  - `refresh_token_revoked`
  - `invalid_token_signature`
  - `auth_dependency_unavailable`
- 不在响应和日志中输出完整 token、密码、JWT secret 或 Authorization header。

### 4. 并发刷新与 rotation

- 检查 iOS 启动时 HTTP 与 WebSocket 可能同时触发刷新这一场景。
- refresh rotation 必须具备事务性或原子性，避免两个近乎同时到达的刷新请求把合法 session family 永久撤销。
- 优先采用项目现有数据库事务、行锁、唯一约束或 Redis 原子操作。
- 如果实现短暂 grace window，只能用于同一 session/device 的并发刷新，并限制时间和重放风险；说明具体安全边界。
- 返回的新 access token 与 refresh token 必须在提交持久化状态后才对外成功响应。

### 5. WebSocket 鉴权语义

- 有效 token：正常完成 WebSocket Upgrade。
- access token 明确无效或过期：握手返回明确 401/403，或在已建立连接后使用约定关闭码 `4001`，reason 中给稳定机器可读原因。
- 数据库/Redis/内部服务未就绪：返回 503 或让客户端正常退避重连，不得返回 token invalid。
- 后端重启时允许连接中断，但恢复后使用原 token 或 refresh 后的新 token应能自动重连，无需人工登录。

### 6. 启动、就绪与滚动发布

- readiness probe 只有在数据库、Redis、密钥与必要迁移均可用后才成功。
- 负载均衡不得把流量发给尚未 ready 的实例。
- shutdown 时停止接收新连接并给予请求/连接合理的 drain 时间。
- 多实例不得依赖 sticky session 才能维持登录；任意实例都应能校验 token 和读取 refresh session。

## 数据迁移和兼容要求

- 尽量保持现有已签发 token 有效。如果当前部署每次启动都换密钥，修复部署后首次切换可能无法恢复已经被旧密钥破坏的 token；必须明确说明这一点，之后的重启不得再造成掉线。
- 新增 session 表/字段时提供正式迁移和回滚迁移，不在启动代码中粗暴建表或清表。
- 保持现有 iOS 字段名 `token`、`refresh_token`、`user` 兼容。
- 不通过无限延长 access token TTL 掩盖问题；使用短期 access token + 可持久刷新 session。
- 不接受关闭 JWT 签名验证、忽略过期时间、把 secret 发给客户端、把 refresh token 放进 URL 等不安全方案。

## 必须新增的自动化测试

至少覆盖：

1. 登录后获得 access/refresh token，重启应用进程，再用旧 access token访问受保护接口；未过期时仍成功。
2. 登录后等待或构造 access token 过期，重启应用进程，再用重启前的 refresh token 刷新成功。
3. 重建容器/滚动替换实例后，重启前的 refresh token 仍可刷新。
4. 两个实例使用同一密钥和 session 存储：A 登录、B 验证和刷新均成功。
5. Redis/数据库短时不可用时 `/auth/refresh` 返回 503/5xx，恢复后同一个 refresh token仍可成功使用，不能被撤销。
6. 两个并发 refresh 请求不会错误撤销合法用户的整个 session；结果符合你实现并记录的 rotation 策略。
7. 已过期、被撤销、签名篡改的 refresh token明确返回 401，且错误码正确。
8. 用户主动退出后 refresh token 被撤销，重启后也不能恢复。
9. WebSocket 在后端重启后自动重连；若 access token过期，刷新后重连成功。
10. 密钥缺失或不同实例密钥不一致时，部署检查或启动检查能明确失败/告警。

## 重启验收步骤

请在与生产部署方式一致的环境执行并保存脱敏输出：

1. 登录测试账号，记录 token 的哈希/前后各少量字符、`kid`、`iat`、`exp`，不得记录完整 token。
2. 调用一个受保护 REST 接口并建立 WebSocket，确认成功。
3. 重启应用进程或滚动重建容器，不清数据库/Redis。
4. 使用重启前 token 再次调用受保护接口。
5. 调用 `/auth/refresh`，确认成功并获得新 token。
6. 使用新 token重新连接 WebSocket。
7. 重复至少三次，并执行一次跨实例验证。
8. 模拟数据库或 Redis 暂停，确认返回临时错误且不会撤销 session；恢复后刷新成功。

## 可观测性

- 使用 request ID、user ID、session/family ID 的安全哈希、实例 ID、错误码串联登录、验证、刷新和 WebSocket 日志。
- 记录但不泄露：JWT `kid`、验证失败类别、refresh rotation 结果、依赖不可用、实例版本。
- 增加指标：refresh 成功率、按错误码统计的 401、鉴权 5xx、WebSocket 鉴权失败、rotation 冲突、不同 `kid` 验证次数。
- 对后端发布后 401/refresh failure 突增设置告警。

## 最终交付格式

完成后请输出：

1. 已确认的根因及证据。
2. 修改的文件、配置、迁移和关键代码说明。
3. JWT 密钥与 session 持久化方案，以及多实例/轮换策略。
4. REST 与 WebSocket 最终错误语义和响应示例。
5. 部署命令、Secret 配置方式、readiness/drain 变更。
6. 自动化测试与三次重启验收结果。
7. 首次上线影响、兼容性、监控和回滚方案。
8. 仍存在的风险或需要客户端配合的事项。
