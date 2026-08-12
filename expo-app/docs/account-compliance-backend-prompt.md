# BBchat 账号合规闭环后端实施 Prompt

将本文件完整交给后端工程代理。不得自行修改路径、字段名、状态码、幂等规则或删除语义；如现有后端结构冲突，先提交兼容层方案，不得要求前端猜测别名。

## 目标与上线边界

实现邮箱验证注册、密码找回、邮箱绑定/更换、账号删除、法律文档、公开删除网页和 `id7.com` TLS 统一入口。保留现有登录、刷新、登出、修改密码和全部钱包接口。新接口只接受和返回 `snake_case`。

统一响应：

```json
{ "code": 0, "message": "ok", "data": {} }
```

```json
{
  "code": "SYMBOLIC_ERROR_CODE",
  "message": "安全、可展示的默认文案",
  "data": { "retry_after_seconds": 0, "field_errors": {} }
}
```

HTTP 状态固定：请求结构错误 `400`；access token 无效 `401`；唯一性、幂等或 preview 冲突 `409`；session/token 过期 `410`；验证码、密码或字段失败 `422`；旧注册需升级 `426`；限流 `429`；服务/邮件故障 `500/503`。

禁止在日志、APM、Sentry、邮件日志、审计记录中写密码、验证码、JWT、验证 token、删除 token、完整邮箱。禁止任何响应暴露服务器 IP、`8001` 或 `7880`。

## 生产环境

```dotenv
PUBLIC_ORIGIN=https://id7.com
PUBLIC_API_BASE_URL=https://id7.com/api/v1
PUBLIC_WEBSOCKET_URL=wss://id7.com/ws
PUBLIC_LIVEKIT_URL=wss://id7.com/livekit
SUPPORT_EMAIL=<必须由部署方配置>

EMAIL_PROVIDER=<smtp 或实际 provider>
EMAIL_FROM_ADDRESS=<发件邮箱>
EMAIL_FROM_NAME=BBchat
SMTP_HOST=<如适用>
SMTP_PORT=<如适用>
SMTP_USERNAME=<secret>
SMTP_PASSWORD=<secret>

ACCOUNT_DATA_PURGE_DAYS=7
FINANCIAL_LEDGER_RETENTION_DAYS=2555
SECURITY_EVENT_RETENTION_DAYS=180
DELETION_AUDIT_RETENTION_DAYS=1095
REQUIRE_VERIFIED_EMAIL_REGISTRATION=false
```

缺少 `SUPPORT_EMAIL` 或邮件服务时不得阻止旧服务启动，但 `/health.account_compliance` 必须为 `degraded`，邮箱接口返回 `503 EMAIL_DELIVERY_UNAVAILABLE`。不得把任何 secret 放进 Remote Config。

## TLS 与代理

- `/api/v1/*` → 内部 API。
- `/ws` → 业务 WebSocket，支持 Upgrade。
- `/livekit` → LiveKit WebSocket。
- `/privacy` → 隐私政策 H5。
- `/account-deletion` → 公开删除网页。
- `/health` → 不泄密的健康检查。
- TLS 1.2+；迁移期 HTTP 只重定向 HTTPS。旧 IP WebSocket 只能临时反向代理，不能依赖 301。
- 呼叫/直播接口 `livekit_url` 固定为 `wss://id7.com/livekit`。
- Push 中头像、媒体、附件始终使用完整 `https://id7.com/...`，不得发相对地址。
- H5 Cookie 必须 `Secure; HttpOnly; SameSite=Strict`，CORS 仅允许正式 H5 Origin。

健康检查格式：

```json
{
  "status": "ok|degraded",
  "account_compliance": {
    "support_email_configured": true,
    "email_delivery_ready": true,
    "deletion_worker_ready": true,
    "legal_documents_ready": true
  }
}
```

## 数据迁移

迁移必须向后兼容，旧账号不强制邮箱非空。

- `users`：`email nullable`、`email_normalized nullable`、`email_verified_at nullable`、`status active|delete_pending|deleted`、`auth_version integer default 0`。`email_normalized` 建大小写不敏感唯一索引，允许多个 `null`。
- `verification_sessions`：`id`、`purpose registration|email_binding|password_reset|web_deletion`、`user_id nullable`、`target_email_normalized nullable`、`identifier_hash nullable`、`code_hmac`、`attempt_count`、`expires_at`、`resend_available_at`、`consumed_at`。
- `scoped_tokens`：`token_hash`、`purpose registration|deletion_identity|deletion_authorization`、`user_id nullable`、`email_normalized nullable`、`payload_hash`、`expires_at`、`consumed_at`。
- `account_deletion_requests`：`request_id`、`user_id`、`client_request_id unique`、`status accepted|purging|settlement_pending|completed|failed`、`accepted_at`、`purge_by`、`completed_at`、`failure_code nullable`。
- transactional outbox：用户状态、`auth_version`、删除请求和 outbox 必须在同一事务中提交。

## 验证码与 token

- 邮箱规范化：trim、Unicode NFC、全地址 lowercase、域名 IDNA，最大 254 bytes。
- 验证码固定 6 位 ASCII 数字，10 分钟有效，60 秒后可重发，最多错误 5 次。
- 验证码以服务端 secret HMAC 存储；不得明文或普通 SHA-256。
- 验证 token 至少 256-bit CSPRNG，只存 hash，15 分钟有效。
- 按 IP、规范化邮箱/identifier hash、账号和设备限流。
- 注册/绑定邮件发送失败时不得创建可用 session。
- 找回密码防枚举：存在、不存在、未绑定邮箱必须同 HTTP 状态、同 JSON shape、相近延迟；不返回 masked email；不存在账号生成不可验证 dummy session；异步邮件失败只做内部告警。

标准错误码：`INVALID_EMAIL`、`EMAIL_ALREADY_IN_USE`、`INVALID_VERIFICATION_CODE`、`VERIFICATION_EXPIRED`、`TOO_MANY_ATTEMPTS`、`RATE_LIMITED`、`EMAIL_DELIVERY_UNAVAILABLE`、`INVALID_CURRENT_PASSWORD`、`PASSWORD_POLICY_VIOLATION`、`IDEMPOTENCY_CONFLICT`、`DELETION_PREVIEW_STALE`、`DELETION_AUTHORIZATION_EXPIRED`、`ACCOUNT_DELETION_PENDING`、`EMAIL_VERIFICATION_REQUIRED`。

## 注册接口

### `POST /auth/registration/email-verification-sessions`

请求 `{ "email":"member@example.com" }`。响应：

```json
{
  "session_id": "uuid",
  "masked_email": "m***@example.com",
  "server_time": "ISO8601",
  "expires_at": "ISO8601",
  "resend_available_at": "ISO8601",
  "code_length": 6
}
```

### `POST /auth/registration/email-verification-sessions/{session_id}/resend`

空 JSON body，返回同一响应结构。重发必须令旧验证码失效，session identity 不得被换成其他邮箱。

### `POST /auth/registration/email-verification-sessions/{session_id}/verify`

请求 `{ "code":"123456" }`。响应：

```json
{
  "email_verification_token": "opaque-token",
  "normalized_email": "member@example.com",
  "expires_at": "ISO8601"
}
```

### `POST /auth/register-v2`

Header `Idempotency-Key` 必须等于 body `client_request_id`。

```json
{
  "username": "原始值",
  "password": "原始值",
  "nickname": "可选原始值",
  "email": "member@example.com",
  "email_verification_token": "opaque-token",
  "client_request_id": "uuid",
  "device_token": "可选"
}
```

响应必须与旧注册相同：`{"token":"...","refresh_token":"...","user":{}}`。token 必须绑定同一规范化邮箱，只能在用户事务成功后消费。username/email 唯一性与创建用户同事务。同 key + 同 payload 不得重复创建；首次响应丢失后重试为同一用户签发新 AuthSession 并撤销首次未交付 refresh token；同 key + 不同 payload 返回 `409 IDEMPOTENCY_CONFLICT`。

切换顺序：新接口先上线；客户端 OTA 达到 100% 且真实注册验收后设置 `REQUIRE_VERIFIED_EMAIL_REGISTRATION=true`。此后旧 `/auth/register` 返回 `426`：

```json
{ "code": "EMAIL_VERIFICATION_REQUIRED", "message": "请更新应用后完成邮箱验证", "data": null }
```

旧账号登录、刷新、修改密码不受影响。

## 密码找回

- `POST /auth/password-reset/sessions`：请求 `{ "identifier":"用户名或邮箱" }`。
- `POST /auth/password-reset/sessions/{session_id}/resend`：空 JSON body。
- 两者响应均不得含邮箱或存在性信息：

```json
{
  "session_id": "opaque-id",
  "server_time": "ISO8601",
  "expires_at": "ISO8601",
  "resend_available_at": "ISO8601",
  "code_length": 6
}
```

- `POST /auth/password-reset/sessions/{session_id}/confirm`：Header `Idempotency-Key` 等于 `client_request_id`；body 为 `{"code":"123456","new_password":"...","client_request_id":"uuid"}`。
- 成功后 `auth_version + 1`，删除 refresh token，关闭 WebSocket，撤销 push/device session；不返回 AuthSession。`delete_pending/deleted` 账号不可借此恢复。

## 邮箱安全

### `GET /account/security`

```json
{
  "email": { "verified": true, "masked_email": "m***@example.com", "verified_at": "ISO8601" },
  "deletion_status": "active"
}
```

不得返回完整邮箱。

### `POST /account/email-verification-sessions`

请求 `{"current_password":"当前密码","email":"new@example.com"}`。必须验证当前密码，session 绑定当前 `user_id` 与新邮箱。发送成功后返回带 masked email 的标准验证 session。

### resend / verify

- `POST /account/email-verification-sessions/{session_id}/resend`：空 body，不再次要求密码。
- `POST /account/email-verification-sessions/{session_id}/verify`：body `{"code":"123456"}`。
- verify 成功事务中更新邮箱与 `email_verified_at`；重复 verify 返回当前成功状态但不重复写入；向旧、新邮箱发送安全通知。

## 账号删除

### `GET /account/deletion/preview`

实时统计并返回：

```json
{
  "preview_token": "opaque-token",
  "expires_at": "ISO8601",
  "confirmation_username": "exact-username",
  "purge_within_days": 7,
  "impact": {
    "gold_coins_to_forfeit": 0,
    "props_to_forfeit": 0,
    "cancellable_withdrawals": 0,
    "settling_withdrawals": 0,
    "owned_groups_to_dissolve": 0
  },
  "delete_categories": [
    "profile",
    "contact_data",
    "location",
    "public_content",
    "private_media",
    "social_relationships"
  ],
  "retained_categories": [
    {
      "category": "financial_ledger",
      "retention_days": 2555,
      "reason": "financial_and_payment_compliance"
    }
  ]
}
```

`preview_token` 绑定 `user_id`、影响摘要 hash，5 分钟有效。保留类别和期限必须来自服务器实际配置。

### `POST /account/deletion/authorizations`

```json
{
  "current_password": "当前密码",
  "confirmation_username": "exact-username",
  "preview_token": "opaque-token"
}
```

用户名逐字匹配 preview；重新计算影响摘要，变化返回 `409 DELETION_PREVIEW_STALE`。响应 `{ "deletion_authorization_token":"opaque-single-purpose-token", "expires_at":"ISO8601" }`。token 5 分钟有效且只能删除账号。

### `POST /account/deletion/requests`

不得依赖 access token；Header `Idempotency-Key` 等于 body `client_request_id`。

```json
{ "deletion_authorization_token": "opaque-single-purpose-token", "client_request_id": "uuid" }
```

同 key + 同 token 重试返回同一 receipt；不同 payload 返回 `409 IDEMPOTENCY_CONFLICT`。响应 HTTP `202`：

```json
{ "request_id": "uuid", "status": "accepted", "accepted_at": "ISO8601", "purge_by": "ISO8601" }
```

接受事务必须锁定 user、创建唯一删除请求、改为 `delete_pending`、`auth_version + 1`、撤销 refresh/device session、写 outbox，然后提交。提交后断开 WebSocket、LiveKit 和 push。认证中间件必须拒绝 `delete_pending/deleted`，不得只等 JWT 过期。

## 删除 worker 的固定业务语义

1. 金币、道具立即作废。
2. 可取消提现自动取消，返还金币随即作废；不可取消/付款中提现继续结算，收款地址结算完成后删除。
3. 用户拥有的全部群组统一解散，不转让：立即标记 dissolved、禁止发言、通知成员、列表移除、群内容与媒体进入删除任务。
4. 聊天及必要引用：删除正文与媒体；sender 改成不可反查 surrogate；仅留“该内容已删除” tombstone；不保留昵称、头像或原始 user_id 映射。
5. 删除资料、邮箱、手机号、push token、设备标识、位置、联系人哈希、社交关系、Moments、Agent、剧本/角色/房间、短剧、媒体，以及 CDN、对象存储、索引、缓存、第三方副本。
6. 普通数据在 `ACCOUNT_DATA_PURGE_DAYS` 内完成；财务、安全、删除审计按配置去标识化保留最小合法字段。
7. worker 必须幂等重试；失败进入 dead-letter 并告警，禁止静默跳过数据域。
8. username/email 在普通清除完成前保持占用，完成后允许复用；user_id 永不复用。

## 法律文档与 Remote Config

从同一份版本化 `legal_documents` 数据源生成：

- `GET /app/screens/wallet_terms`
- `GET /app/screens/privacy_policy`
- `GET /app/screens/data_privacy`
- `https://id7.com/privacy`
- `https://id7.com/account-deletion`

每份包含 `document_version`、`effective_at`、`locale`、审核正文、客服方式、删除范围和保留说明；支持 ETag/If-None-Match 与 `de/en/es/fr/ja/ko/pt-BR/ru/zh-Hans/zh-Hant`。

`GET /app/config` 必须返回：

```json
{
  "account": {
    "support_email": "来自 SUPPORT_EMAIL",
    "privacy_screen_id": "privacy_policy",
    "data_privacy_screen_id": "data_privacy",
    "account_deletion_url": "https://id7.com/account-deletion"
  },
  "wallet": { "terms_screen_id": "wallet_terms" }
}
```

## 公开删除网页

`https://id7.com/account-deletion` 不要求安装 App。输入用户名或邮箱，复用防枚举 OTP；成功后仅以 Secure/HttpOnly/SameSite=Strict session 识别用户；使用同一 preview/deletion service/worker；展示资产、提现、群组、保留数据和不可撤回说明；未绑定邮箱旧账号显示 `SUPPORT_EMAIL`。必须有 CSRF、限流、审计；token 不得进入 URL、Referer、日志或浏览器存储。

## 旧账号人工恢复

提供仅限内部管理员/CLI 的操作，输入 `user_id`、目标邮箱、`case_reference`、理由；要求管理员权限、MFA 和审计；只发送确认链接，用户点击后才绑定，禁止直接标记 verified。客服不得索取密码、验证码或 JWT。

## 必须通过的验收

- 邮箱唯一性、token 绑定/过期/消费/并发。
- 注册响应丢失后的幂等重试。
- 找回密码账号枚举与时延差异。
- 重发、5 次错误锁定、限流。
- 删除 preview stale、授权过期、重复提交与不确定网络结果。
- `auth_version` 与 `delete_pending` 拒绝；WebSocket/LiveKit/push 撤销。
- 群组统一解散；钱包作废；提现取消/继续结算。
- 对象存储/CDN/索引/缓存清除；worker 重试/dead-letter/告警。
- H5 CSRF、Cookie、OTP、无 App 删除。
- 所有生产响应、日志与导出均不得出现内部 IP、`8001` 或 `7880`。

部署完成后输出：迁移清单、路由清单、环境变量清单、回滚方案、测试报告，以及 `/health` 四项全部 ready 的证据。在前端 OTA 达到 100% 前不得开启 `REQUIRE_VERIFIED_EMAIL_REGISTRATION`。
