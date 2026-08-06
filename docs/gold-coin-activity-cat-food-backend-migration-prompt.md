# 后端调整 Prompt：金币与活动猫粮最终契约

你正在调整 BWChat 后端。iOS 前端已经完成最终正名和页面归属调整：原“猫币”正式改名为“金币”，活动猫粮仍是独立赠送资产，并且只在前端道具包展示。

## 0. 不可违反的总规则

- 金币唯一机器名为 `gold_coin`，字段只能使用 `gold_coin` / `gold_coins`。
- 活动猫粮唯一机器名仍为 `activity_cat_food`，所有跨资源字段必须带完整前缀。
- 旧 `cat_coin` / `cat_coins` 是同一金币资产的历史名字，只能出现在数据库迁移、兼容读取和迁移测试中；新 API 响应、事件、配置和埋点不得继续输出。
- 更早的裸 `cat_food` 历史数据实际也表示金币，不得解释成活动猫粮。
- `activity_cat_food` 绝不能通过旧金币数据回填，只能来自真实的活动发放账本。
- StoreKit product ID 中已经发布的 `catfood` 字符串不可修改；这些商品购买的是金币。

## 1. 钱包余额最终响应

所有钱包余额接口统一返回：

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

- `spendable_balance` 是服务端权威值，必须等于当前可消费金币加活动猫粮。
- `spendable_balance` 只用于支持混合扣款的消费资格，不得用于提现、收益、红包或转账。
- 提现只能读取 `withdrawable_gold_coin_balance`。

## 2. 动态配置、充值与广告

- 商品数组改为 `gold_coin_products`。
- 商品数量字段改为 `gold_coin_amount`。
- 广告钱包奖励 `reward_item` 必须为 `gold_coin`。
- 保留 `wallet.activity_cat_food.enabled` 和扁平字段 `wallet.activity_cat_food_enabled`；任一明确为 `true` 即开启，缺失时关闭。
- 活动猫粮不允许购买，不进入 IAP 恢复、法币定价、提现或收益。
- Apple 已发布的 `com.bwchat.app.catfood.*` product ID 原样保留，但服务端入账资产必须是金币。

## 3. 混合扣款

礼物、智能体付费媒体、动态解锁、短剧解锁、一对一直播语音/视频继续由服务端按“活动猫粮优先、金币补足”原子扣款。客户端不选择资产，也不预扣余额。

统一响应：

```json
{
  "charged_activity_cat_food": 35,
  "charged_gold_coins": 15,
  "total_charged": 50,
  "wallet_balance": {
    "currency": "gold_coin",
    "gold_coin_balance": 85,
    "activity_cat_food_balance": 0,
    "spendable_balance": 85,
    "recharge_gold_coin_balance": 50,
    "gift_income_gold_coin_balance": 35,
    "withdraw_frozen_gold_coin_balance": 0,
    "withdrawable_gold_coin_balance": 35,
    "chat_money_frozen_gold_coin_balance": 0
  }
}
```

必须保证：

- 两个扣款分项均为非负整数。
- `total_charged = charged_activity_cat_food + charged_gold_coins`。
- 余额检查、两个账本变更、业务交付和幂等记录处于同一事务。
- 重试相同幂等键不得重复扣款或重复发放内容。

## 4. 直播字段

直播计费事件、结束响应和历史账单统一使用：

- `charged_activity_cat_food`
- `charged_gold_coins`
- `total_charged`
- `earned_gold_coins`
- `gold_coin_balance_after`
- `activity_cat_food_balance_after`
- `spendable_balance_after`

主播、收款方和创作者永远只获得金币，绝不能收到活动猫粮。删除旧的通用 `balance_after` 以及所有旧猫币字段的输出。

## 5. 其他字段统一正名

- 动态和短剧价格：`unlock_price_gold_coins`。
- 收费游戏价格：`entry_price_gold_coins`。
- 礼物接收金额：`gold_coin_amount`，`receiver_currency=gold_coin`。
- 提现金额：`gold_coin_amount`。
- 红包、转账及其他金币专属业务的金额、冻结额和账本字段均使用 `gold_coin` 前缀。
- 金币交易流水 `currency` 必须为 `gold_coin`。
- 猫粮明细接口保持 `GET /api/v1/wallet/activity-cat-food/transactions?limit=20&cursor=...`，资源内的 `balance_after` 只表示猫粮余额。

## 6. 错误码

- 混合扣款余额不足：`insufficient_spendable_balance`，附带：

```json
{
  "required_amount": 50,
  "gold_coin_balance": 0,
  "activity_cat_food_balance": 35,
  "spendable_balance": 35
}
```

- 只允许金币的业务余额不足：`insufficient_gold_coins`。
- 猫粮功能关闭：`activity_cat_food_disabled`。
- 不再返回 `insufficient_cat_coins`。
- 未知错误保持原有宽容格式，不得错误归类为猫粮不足。

## 7. 数据库与缓存迁移

执行可审计、可回滚的 schema/data migration：

1. 将所有现行 `cat_coin` / `cat_coins` 列、JSON 键、账本币种、冻结记录、商品配置、事件 payload 和统计维度迁移为对应 `gold_coin` / `gold_coins`。
2. 更早的裸 `cat_food` 金额继续迁入金币，但只在确认其属于历史金币结构时处理。
3. 禁止将任何旧金币记录写入 `activity_cat_food` 账本或余额。
4. 迁移前后分别校验用户总金币、充值金币、收益金币、冻结金币和可提现金币总量守恒。
5. 幂等键、订单号、Apple transaction ID 和账本记录 ID 不得改变。
6. 清理 Redis、任务队列、事件 outbox、物化视图和分析表中的旧键。
7. 若采用灰度发布，可短期接受旧请求字段并立即归一化，但 API 响应和新事件只输出最终金币字段；灰度结束后删除旧请求兼容。

## 8. 埋点与可观测性

- 埋点维度使用 `gold_coin`、`charged_gold_coins`、`earned_gold_coins`。
- 分别记录猫粮扣款、金币扣款、总扣款和扣款后余额。
- 增加迁移守恒指标、旧字段命中计数和兼容读取告警；稳定后旧字段命中必须归零。
- 日志不得把 `spendable_balance` 当作金币余额。

## 9. 验收测试

至少覆盖：

1. 钱包响应只包含最终金币字段和明确的活动猫粮字段。
2. 纯猫粮、纯金币、猫粮加金币三种混合扣款。
3. 金币为 0 但猫粮足够时，礼物/解锁/直播成功；收费游戏、红包、转账和提现失败并返回 `insufficient_gold_coins`。
4. 直播每个计费单元先扣猫粮，主播收入只增加金币。
5. IAP、广告奖励、提现、收益均只进入金币账本。
6. StoreKit `catfood` product ID 不变且到账金币。
7. 活动猫粮配置开关和明细分页正确。
8. 两代历史数据迁移后都进入金币，且不会产生任何活动猫粮。
9. 全量账本金额迁移前后守恒，幂等重试不重复扣款。
10. 静态搜索：除迁移代码、迁移测试和不可修改的 StoreKit product ID 外，不存在旧 `cat_coin` / `cat_coins` 或裸 `cat_food` 业务字段。

完成后输出：数据库迁移文件清单、API/事件字段对照表、灰度与回滚方案、守恒校验结果、测试结果，以及旧字段命中归零证据。
