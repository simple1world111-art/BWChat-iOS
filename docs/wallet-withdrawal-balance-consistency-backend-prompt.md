# 金币余额与收益提现一致性：后端修改 Prompt

你正在维护 BWChat 后端。请完成“金币钱包 / 收益提现”的余额口径与提现策略统一，目标是让 iOS 的“我的金币”和“收益提现”使用同一份权威快照，并且明确区分“金币总余额”和“可提现金币”。不要通过复制余额、前端兜底计算或信任客户端金额来制造表面一致。

## 1. 统一 `GET /api/v1/wallet/balance`

成功响应的 `data` 必须一次性返回以下完整字段，字段不可缺失、不可为负数，金额字段使用整数金币：

```json
{
  "currency": "gold_coin",
  "gold_coin_balance": 85,
  "activity_cat_food_balance": 20,
  "spendable_balance": 105,
  "recharge_gold_coin_balance": 50,
  "gift_income_gold_coin_balance": 35,
  "withdraw_frozen_gold_coin_balance": 0,
  "withdrawable_gold_coin_balance": 35,
  "chat_money_frozen_gold_coin_balance": 0
}
```

语义与约束：

- `gold_coin_balance`：用户当前可见的金币余额，是“我的金币”页主余额。
- `recharge_gold_coin_balance`：充值、广告奖励等不可提现金币余额。
- `gift_income_gold_coin_balance`：礼物/创作者收入金币余额。
- `withdrawable_gold_coin_balance`：当前真正允许发起提现的收入金币；必须小于等于 `gift_income_gold_coin_balance`，不得包含充值金币或活动猫粮。
- `withdraw_frozen_gold_coin_balance`：已提交提现、尚未完成或退回的冻结金币。
- `spendable_balance = gold_coin_balance + activity_cat_food_balance`。
- 若当前账务定义为金币余额由充值余额和收入余额组成，请在数据库事务和测试中固定 `gold_coin_balance = recharge_gold_coin_balance + gift_income_gold_coin_balance`；如冻结额不包含在可用金币中，请明确记录对应代数关系并保持所有接口一致。
- 任何充值、赠礼收入、消费、提现申请、提现撤销、提现完成后，必须由同一账本事务更新并返回一致快照，禁止按接口分别维护余额副本。

## 2. 下发机器可读的提现策略

在 `GET /api/v1/app/config` 的 `data.wallet` 返回数值策略。小数建议用十进制定点字符串，禁止只返回展示文案：

```json
{
  "exchange_rate_display": "1 Gold Coin = 0.005 USDT",
  "usdt_per_gold_coin": "0.005",
  "minimum_withdrawal_usdt": "0.50",
  "withdrawal_step_usdt": "0.50",
  "withdrawal_networks": [
    {
      "network": "TRC20",
      "enabled": true,
      "min_usdt": "0.50",
      "step_usdt": "0.50",
      "usdt_per_gold_coin": "0.005"
    },
    {
      "network": "ERC20",
      "enabled": false,
      "min_usdt": "5.00",
      "step_usdt": "0.50",
      "usdt_per_gold_coin": "0.005"
    }
  ]
}
```

网络级字段覆盖钱包级字段。若业务最终最低提现额不是示例中的 `0.50 USDT`，请返回真实值；iOS 已改为动态展示和校验，不再写死 `100 USDT`。

## 3. 服务端权威校验 `POST /api/v1/wallet/withdrawals`

iOS 当前请求示例：

```json
{
  "gold_coin_amount": 100,
  "usdt_amount": "0.50",
  "payout_method": "usdt",
  "payout_account": "TRC20:T...",
  "network": "TRC20",
  "wallet_address": "T..."
}
```

后端必须在数据库事务中：

1. 读取当前启用网络和提现策略，不信任客户端汇率与金额。
2. 用十进制定点数验证 `usdt_amount >= min_usdt` 且是 `step_usdt` 的整数倍。
3. 按服务端汇率重新计算所需金币，并验证它与 `gold_coin_amount` 一致。
4. 校验 `gold_coin_amount <= withdrawable_gold_coin_balance`。
5. 原子地从可提现余额转入提现冻结余额，创建提现单；并发请求不得透支。
6. 返回创建后的 `withdrawal` 和完整 `wallet_balance`；重复请求应有幂等机制，不能重复冻结。

建议错误码：

- `withdrawal_network_disabled`
- `withdrawal_below_minimum`
- `invalid_withdrawal_step`
- `withdrawal_quote_mismatch`
- `insufficient_withdrawable_gold_coin_balance`
- `invalid_usdt_wallet_address`

`POST /wallet/withdrawals/{id}/cancel` 必须在同一事务内解冻金币并返回最新完整余额。完成提现时扣除冻结额；拒绝/失败时退回可提现收入余额。

## 4. 提现记录响应

`GET /api/v1/wallet/withdrawals` 的每一项至少返回：

```json
{
  "id": "wd_123",
  "currency": "gold_coin",
  "gold_coin_amount": 100,
  "payout_usd": "0.50",
  "payout_method": "usdt",
  "network": "TRC20",
  "wallet_address": "T...",
  "status": "pending",
  "can_cancel": true,
  "created_at": "2026-08-02T00:00:00Z",
  "updated_at": "2026-08-02T00:00:00Z"
}
```

## 5. 必须补充的自动化测试

- 余额示例：总金币 85、充值金币 50、收入金币 35、可提现 35；两个页面分别读取总余额和可提现余额但来自同一快照。
- 35 金币按 `0.005` 折算为 `0.175 USDT`，因步进/最低额 `0.50` 暂不可提现。
- 100 金币可提交 `0.50 USDT`；99 金币不可提交。
- 已充值金币不能通过提现接口提走。
- 两个并发提现请求不会让可提现余额变负。
- 创建、撤销、完成、拒绝提现后的各余额字段和提现记录状态一致。
- 网络级策略覆盖全局策略，禁用网络不可提交。
- 客户端伪造 `gold_coin_amount` 或 `usdt_amount` 时返回稳定业务错误码，不产生账务变更。

完成后请输出：修改文件、数据库迁移（如有）、接口示例、余额不变量、幂等方案、并发控制方式和测试结果。
