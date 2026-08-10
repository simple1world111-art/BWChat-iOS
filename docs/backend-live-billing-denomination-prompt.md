# 一对一直播按币种守恒结算改造 Prompt

请修改 BBchat 后端的一对一语音/视频直播计费与结算逻辑，修复“观众消耗猫粮后，主播却收到等值金币，导致平台额外承担金币成本”的问题。

## 当前错误

当一次计费为：

- 观众消耗猫粮 `58`
- 观众消耗金币 `42`
- 总消耗 `100`

当前服务端给主播记入 `earned_gold_coins = 100`。这相当于把平台发放的猫粮转换成了可作为金币收益的资产，额外铸造了 `58` 金币。

## 必须实现的账本规则

1. 观众仍按现有规则优先扣猫粮，不足部分再扣金币。
2. 主播收益必须保持币种守恒，不允许跨币种转换：
   - `earned_activity_cat_food = charged_activity_cat_food`
   - `earned_gold_coins = charged_gold_coins`
3. 示例中的主播必须收到 `58` 猫粮和 `42` 金币，不能收到 `100` 金币。
4. 猫粮收益只进入主播的 `activity_cat_food_balance`；不得进入金币余额、礼物金币收益、可提现金币或充值金币账户。
5. 金币收益继续走现有主播金币收益账本规则。
6. 保留 `total_charged` 仅用于服务端审计，并强制满足：
   - `total_charged = charged_activity_cat_food + charged_gold_coins`
7. 每个计费单元还必须满足：
   - `earned_activity_cat_food = charged_activity_cat_food`
   - `earned_gold_coins = charged_gold_coins`
   - 禁止以 `total_charged` 作为 `earned_gold_coins`。

## 事务与幂等要求

- 观众扣款、主播分币种入账、计费流水和通话结算必须在同一数据库事务中完成。
- 使用 `call_id + billing_unit/index` 或现有唯一计费键保证幂等；WebSocket 重试、任务重跑和接口重试不能重复扣款或重复发放收益。
- 任一步骤失败必须整体回滚，禁止出现“观众已扣款但主播未入账”或反向情况。
- 余额不足时不得产生不完整的部分结算；如果现有业务允许部分结算，也必须保证实际扣除额与实际收益逐币种完全相等。
- 并发计费必须使用行锁、原子余额更新或等价机制，禁止余额穿透和重复结算。

## 接口和实时事件契约

更新 `one_to_one_live.billing_updated`。观众端和主播端均应携带本次或累计的统一口径字段：

```json
{
  "call_id": "call-id",
  "charged_activity_cat_food": 58,
  "charged_gold_coins": 42,
  "total_charged": 100,
  "earned_activity_cat_food": 58,
  "earned_gold_coins": 42
}
```

观众端继续返回：

```json
{
  "activity_cat_food_balance_after": 0,
  "gold_coin_balance_after": 100,
  "spendable_balance_after": 100
}
```

如服务端支持主播结算后余额，也请新增并返回语义明确的字段，例如：

```json
{
  "host_activity_cat_food_balance_after": 158,
  "host_gold_coin_balance_after": 242
}
```

`GET /one-to-one-live/calls/{call_id}` 的 `final_billing` 也必须返回：

```json
{
  "charged_activity_cat_food": 58,
  "charged_gold_coins": 42,
  "total_charged": 100,
  "earned_activity_cat_food": 58,
  "earned_gold_coins": 42
}
```

兼容性要求：`earned_gold_coins` 从现在起只能表示金币部分的收益，不能再表示猫粮与金币的合计。若仍需总收益字段，可新增 `total_earned_spendable` 仅供审计，但客户端不依赖也不展示该字段。

## 数据库与流水

- 检查一对一直播计费表、主播收益表和钱包流水表是否只有 `earned_gold_coins`。
- 如缺失，新增 `earned_activity_cat_food` 非负整数字段，默认值为 `0`。
- 猫粮入账生成独立的猫粮收益流水，金币入账生成独立的金币收益流水，二者使用同一结算关联 ID。
- 不要静默把历史 `earned_gold_coins` 拆分；如需修复历史数据，请先提供可审计的迁移方案和受影响记录数量。

## 必须补充的测试

至少覆盖以下用例，并断言钱包余额、流水、实时事件和 `final_billing` 一致：

1. 混合结算：扣 `58` 猫粮 + `42` 金币，主播得 `58` 猫粮 + `42` 金币。
2. 全猫粮：扣 `100` 猫粮，主播得 `100` 猫粮 + `0` 金币。
3. 全金币：扣 `100` 金币，主播得 `0` 猫粮 + `100` 金币。
4. 同一计费键重复执行，不重复扣款、不重复入账。
5. 并发执行同一计费单元，只成功结算一次。
6. 余额不足时账本保持一致且不产生平台垫付金币。
7. 通话结束与断线重连后的最终对账字段逐币种一致。
8. 回归断言：任何情况下都不能出现 `earned_gold_coins > charged_gold_coins`，也不能出现 `earned_activity_cat_food > charged_activity_cat_food`。

完成后请输出：修改文件、迁移脚本、核心事务说明、接口示例、测试结果，以及部署前后如何核对没有额外铸造金币。
