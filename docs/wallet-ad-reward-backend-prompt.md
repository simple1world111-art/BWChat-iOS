# 钱包看广告领猫币：后端实现 Prompt

请在 BWChat 后端完整实现“钱包看激励广告领猫币”，不要只返回 mock。当前 iOS 客户端已经按下面的接口契约接入；请保持字段和路径兼容。

## 产品规则

- 入口位于“钱包 → 我的猫币/充值”页。
- 每个登录账号每个自然日最多成功领取 10 次，按服务端业务时区的每天 24:00（次日 00:00）刷新；默认业务时区使用 `Asia/Shanghai`，不要实现成滚动 24 小时。
- 限额必须以账号为维度，跨设备、重装 App、重复登录都共享同一个计数。
- 只有通过 Google AdMob Rewarded Ad SSV 验签的完成事件才能发猫币。客户端的 `userDidEarnReward` 只用于即时 UI，不得作为发粮凭证。
- 猫币奖励数量沿用现有运营/钱包配置；服务端必须校验 `reward_item`、`reward_amount` 和广告单元白名单，禁止直接信任回调参数决定任意发放数量。
- 发粮、写钱包流水、消耗当日次数必须在同一数据库事务中完成，并且全链路幂等。

## iOS 已接入的 API 契约

所有业务 API 都需要现有 Bearer 登录态，并使用项目现有的统一响应壳：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

### 1. 查询当日状态

`GET /api/v1/wallet/ad-rewards/status`

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "enabled": true,
    "daily_limit": 10,
    "watched_count": 3,
    "remaining_count": 7,
    "next_reset_at": "2026-07-22T00:00:00+08:00"
  }
}
```

要求：

- `watched_count + remaining_count == daily_limit`。
- `next_reset_at` 必须是服务端业务时区的下一次 00:00，并包含时区偏移。
- 未登录返回 401；功能关闭仍返回结构完整的数据，但 `enabled=false`。

### 2. 创建一次广告观看会话

`POST /api/v1/wallet/ad-rewards/sessions`

请求：

```json
{
  "platform": "ios",
  "ad_unit_id": "ca-app-pub-1877504503518465/1011630693"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "session_id": "01J...",
    "ssv_custom_data": "opaque-signed-or-random-session-token",
    "remaining_count": 7,
    "expires_at": "2026-07-21T18:30:00+08:00",
    "next_reset_at": "2026-07-22T00:00:00+08:00"
  }
}
```

要求：

- 从登录态取 `user_id`，绝不接受客户端提交用户 ID。
- 仅允许配置白名单内的 iOS AdMob rewarded ad unit。
- 当日已领取 10 次时返回 429，错误码建议 `AD_REWARD_DAILY_LIMIT_REACHED`。
- 功能未开放时返回 403，错误码建议 `AD_REWARD_DISABLED`。
- `ssv_custom_data` 必须不可枚举、不可伪造，并且只能关联到该 `session_id + user_id + ad_unit_id`。推荐随机 256-bit token，数据库只存 token 哈希；也可使用短期签名 token，但仍需保存 session 状态用于幂等。
- 会话建议 30 分钟过期。同一账号只保留一个可复用的未过期 pending 会话，避免广告加载重试制造大量会话。创建会话本身不能扣次数，只有 SSV 验证并成功入账后才扣次数。

### 3. AdMob SSV 回调

配置 AdMob 后台将 rewarded ad unit 的 SSV URL 指向：

`GET /api/v1/wallet/ad-rewards/admob/ssv`

该接口不使用用户 Bearer Token。完整保留原始 URL query 和顺序来验签，处理 Google 提供的参数，包括：

- `ad_network`
- `ad_unit`
- `custom_data`
- `key_id`
- `reward_amount`
- `reward_item`
- `signature`
- `timestamp`
- `transaction_id`
- `user_id`（iOS 会同时设置；只能作为交叉校验，账号归属仍以 session 为准）

SSV 安全要求：

1. 按 Google AdMob SSV 官方流程，用 `key_id` 对应的 Google 公钥执行 ECDSA 验签；验签内容不得重新排序、重新编码或修改。Google 公钥可缓存，但最长 24 小时，并支持轮换与找不到 key 时立即刷新一次。
2. URL decode `custom_data` 后查找 pending session，校验 token、账号、广告单元、有效期和状态。
3. 校验 `ad_unit` 是生产 rewarded ad unit，校验 `reward_item/reward_amount` 符合服务端配置，并对 `timestamp` 设置合理的防重放窗口。
4. 以 Google 的 `transaction_id` 建全局唯一索引。重复回调必须返回 HTTP 200 且不得重复发粮。
5. 在单个数据库事务/行锁中再次计算该账号当前业务日的已领取次数。若已到 10 次，不发粮，将 session 标记为 limit_rejected，并记录审计；并发第 10/11 个回调不能都成功。
6. 成功时原子执行：写 reward grant、增加钱包猫币余额、写 wallet transaction、增加当日领取计数、将 session 标记 credited。
7. 成功或已处理的重复回调返回 HTTP 200。临时数据库/依赖故障返回 5xx 以便 Google 重试；签名非法返回 400/403，并写安全日志，但日志禁止记录完整 token。

Google 官方说明：SSV 回调有唯一 `transaction_id`，签名验签需要使用 Google key server 的公钥，公钥缓存不应超过 24 小时；服务端不可达时 Google 会做有限次数重试。实现时以官方文档为准：

- https://developers.google.com/admob/ios/ssv
- https://developers.google.com/admob/ios/rewarded

## 数据模型与并发约束

请至少提供等价的数据结构：

### `wallet_ad_reward_sessions`

- `id` / `session_id`（唯一）
- `user_id`（索引）
- `token_hash`（唯一）
- `platform`
- `ad_unit_id`
- `reward_day`（业务时区日期，索引）
- `status`: `pending | verified | credited | expired | limit_rejected | invalid`
- `expires_at`
- `admob_transaction_id`（nullable，到账后唯一）
- `created_at / verified_at / credited_at`

### `wallet_ad_reward_grants`

- `id`
- `user_id`
- `reward_day`
- `session_id`（唯一）
- `admob_transaction_id`（全局唯一）
- `reward_item`
- `reward_amount`
- `wallet_transaction_id`（唯一）
- `created_at`

查询次数以 `credited` grant 为准，或维护带原子约束的 daily counter；无论采用哪种方式，都必须通过事务和唯一索引保证同账号同一天最多 10 条成功 grant。

## 钱包流水

- 新增/复用明确的流水类型，例如 `ad_reward`。
- 流水 metadata 至少记录内部 `session_id`、AdMob `transaction_id`、业务日、广告单元标识（可脱敏）。
- SSV 成功后，现有 `GET /api/v1/wallet/balance` 和 `GET /api/v1/wallet/transactions` 必须能立即读到新的余额和流水。
- 不允许仅改缓存不落主账；缓存失效放在事务成功之后。

## 动态开关与上线顺序

当前 iOS Release 只有同时满足以下条件才真正加载生产广告，但入口会一直保留：

1. `wallet.ad_reward_enabled = true`
2. feature flag `wallet_ad_reward_delivery` 为 enabled，且账号命中 rollout

上线顺序：先完成数据库迁移、API、SSV 验签、AdMob 后台回调配置和测试；再小流量打开 `wallet_ad_reward_delivery`；观察验签失败率、重复回调率、发放量和钱包对账后逐步放量。关闭开关不能删除历史记录或影响已收到 SSV 的合法 pending 会话， pending 的处理策略需明确并保持幂等。

## 必须通过的测试

- 同账号第 1～10 次成功，第 11 次 session 创建和并发 SSV 均不能发粮。
- 两个不同账号各自独立拥有 10 次。
- 同账号两台设备合计只能成功 10 次。
- `Asia/Shanghai` 23:59:59 前达到 10 次，次日 00:00:00 后恢复为 10 次；覆盖月末、年末。
- 10 个并发合法 SSV 最多产生 10 笔；已有 9 次时两个并发 SSV 只能一笔成功。
- 相同 `transaction_id` 重放 100 次只产生一笔余额和流水。
- 篡改 `custom_data`、`reward_amount`、`ad_unit`、`signature` 均不发粮。
- Google 公钥轮换、key cache 过期、临时数据库失败重试均可恢复且不重复发粮。
- status、session、钱包余额、钱包流水的集成测试全部通过。

交付时请附上：数据库迁移、接口实现、SSV 验签实现、自动化测试、AdMob 控制台配置说明、灰度/回滚步骤、监控指标和一份真实测试回调的脱敏日志证据。
