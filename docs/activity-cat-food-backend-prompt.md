# 后端任务 Prompt：新增独立“猫粮”钱包子账本

你正在为 BWChat 后端新增一套独立于猫币的活动代币“猫粮”。请先检查现有钱包账户、不可变流水、礼物、付费解锁、短剧、通话计费、红包、转账、IAP 和提现实现，再基于现有技术栈、鉴权、错误结构、事务和幂等规范增量实现；不要另起互不一致的钱包框架，也不要只提交伪代码。

## 绝对不可混淆的命名

- 用户可见名称：简中“猫粮”、繁中“貓糧”、英文 `Cat Food`。
- 新资产的唯一机器代码：`activity_cat_food`。
- 当前历史机器字段 `cat_food`、`cat_food_balance`、`cat_food_amount`、`cat_food_delta`、`charged_cat_food`、`earned_cat_food`、`unlock_price_cat_food`、`currency: "cat_food"` 以及 StoreKit 商品 ID `com.bwchat.app.catfood.*` 实际都代表现在的“猫币”。这些字段不得改义、复用、删除或破坏性重命名。
- 可以新增明确别名 `cat_coin_balance`，但旧客户端依赖的 `balance` 和 `cat_food_balance` 必须继续只返回猫币余额。
- 新代码、数据库字段、日志、指标和事件禁止用裸 `cat_food` 指代新猫粮。

## 产品规则

1. 1 猫粮与 1 猫币拥有相同消费能力。
2. 符合条件的消费必须先扣猫粮，不足部分再扣猫币。
3. 猫粮可用于：单聊/群聊送礼、智能体和朋友圈付费媒体、短剧解锁、普通通话与一对一直播通话等现有猫币消费。
4. 猫粮不可用于：IAP 充值、提现、红包、转账、进入游戏或创建收费游戏会话；也不能直接转给其他用户。游戏入口费用继续只扣猫币。
5. 礼物或通话产生的接收方收益继续使用现有结算资产、比例与锁定规则，不把猫粮直接记入接收方猫粮账户。
6. 首版猫粮永久有效，不实现到期批次。
7. 首版仅由新增官方活动或运营后台发放；现有广告奖励、H5 游戏奖励及其他免费猫币奖励不要自动迁移。

## 数据与账本

- 优先扩展现有多币种钱包账户和不可变流水；如果现有模型无法安全承载，再新增 `activity_cat_food_accounts` 与 `activity_cat_food_ledger`，但所有扣款仍必须进入统一钱包领域服务。
- 账户至少包含 `user_id`、非负 `balance`、`version`、`created_at`、`updated_at`；所有现有用户迁移后的初始猫粮余额为 0。
- 流水不可物理删除，至少记录：`id`、`user_id`、`currency=activity_cat_food`、`type`、`delta`、`balance_before`、`balance_after`、`source_type`、`source_id/activity_id`、`business_type`、`business_id`、`idempotency_key`、`operator_id`、受限大小的 `metadata`、`created_at`。
- 流水类型至少覆盖 `official_activity_grant`、`spend`、`refund`、`adjust`、`revoke`。
- 为用户时间线、业务关联 ID、活动 ID、幂等键和并发账户更新添加必要索引与唯一约束。

## 余额 API

向后兼容扩展：

`GET /api/v1/wallet/balance`

新响应示例：

```json
{
  "data": {
    "balance": 100,
    "cat_food_balance": 100,
    "cat_coin_balance": 100,
    "activity_cat_food_balance": 35,
    "spendable_balance": 135,
    "total_balance": 100,
    "recharge_claim_balance": 80
  },
  "request_id": "req_..."
}
```

要求：

- `balance`、`cat_food_balance`、`cat_coin_balance` 都是同一猫币余额；不得把猫粮并入这些字段。
- `activity_cat_food_balance` 只表示猫粮。
- `spendable_balance = cat_coin_balance + activity_cat_food_balance`。
- 猫粮不得进入任何 withdrawable、recharge、claim、creator earnings 或 payout 字段。
- 所有会返回 `wallet_balance` 的礼物、解锁、短剧和通话响应，应返回同一完整余额结构；字段仅做向后兼容追加。

## 猫粮明细 API

实现：

`GET /api/v1/wallet/activity-cat-food/transactions?cursor=<cursor>&limit=20`

- 只能读取当前鉴权用户；不接受客户端传入其他 `user_id`。
- `limit` 为 1～50，使用稳定游标，按 `created_at DESC, id DESC` 排序。
- 返回 `id`、`type`、有符号 `delta`、`balance_after`、本地化 `title`、安全的 `source`、`created_at` 和 `next_cursor`。
- 空明细返回 HTTP 200、空 `items` 和 `next_cursor: null`。

```json
{
  "data": {
    "items": [
      {
        "id": "txn_01...",
        "type": "official_activity_grant",
        "delta": 50,
        "balance_after": 50,
        "source": "summer_event_2026",
        "title": "夏日活动奖励",
        "created_at": "2026-08-01T00:00:00Z"
      }
    ],
    "next_cursor": null
  },
  "request_id": "req_..."
}
```

## 受保护的官方发放能力

- 提供内部服务方法及受保护的运营/活动接口；公网移动端不得提交 `amount` 和 `activity_id` 即可领取。
- 发放请求必须包含服务端确认的用户、活动、正数金额、操作者/调用方和业务幂等键。
- 在一个事务中锁定账户、校验活动资格、更新余额、写流水与活动领取记录；同一活动业务键重试返回第一次结果，不得重复到账。
- `adjust/revoke` 需要更高权限、原因和审计；撤回不得令余额为负。不能安全撤回时必须失败并人工处理，不能静默扣猫币补偿。

## 统一原子扣款

在现有钱包领域层实现唯一的消费方法，所有符合范围的业务都调用它，禁止各控制器复制扣款逻辑：

```text
debitSpendableBalance(user, amount, businessType, businessID, idempotencyKey)
activityCatFoodCharge = min(activityCatFoodBalance, amount)
catCoinCharge = amount - activityCatFoodCharge
```

- 同一数据库事务/一致性边界内锁定两种账户，确认 `activity_cat_food + cat_coins >= amount`，写两种资产各自的流水，再提交礼物、解锁或计费业务结果。
- 任一账户不足、业务写入失败、流水失败或并发版本冲突时整笔回滚，不允许只扣一种资产。
- 同一业务幂等键必须返回相同的 `charged_activity_cat_food` 和 `charged_cat_coins`，重试不得重复消费。
- 消费结果追加：

```json
{
  "charged_activity_cat_food": 35,
  "charged_cat_coins": 15,
  "total_charged": 50,
  "wallet_balance": {
    "cat_coin_balance": 85,
    "activity_cat_food_balance": 0,
    "spendable_balance": 85
  }
}
```

- 完整退款必须引用原始扣款流水，按原来的两种资产拆分退回；不得根据退款时余额重新执行“猫粮优先”。首版若业务不支持部分退款，必须明确拒绝部分退款，而不是自行决定拆分。
- 通话按现有计费单位逐笔调用统一扣款；最终账单同时汇总两种扣款金额，余额不足预终止判断使用 `spendable_balance`。
- 余额不足继续兼容旧客户端的稳定错误码，同时在错误详情追加 `required_amount`、`cat_coin_balance`、`activity_cat_food_balance`、`spendable_balance`。

## 必须隔离的路径

- IAP 验单和补单永远只增加猫币。
- 红包创建、转账创建及其退款/退回永远只读写猫币；不能通过猫粮发出，也不能把收到的资产记成猫粮。
- `POST /games/{game_id}/sessions` 及任何游戏入场、门票或开局费用继续只扣猫币，禁止调用猫粮优先的统一消费方法。相关响应、余额不足判断和退款也必须维持猫币单账本语义。
- 提现、可提现余额、创作者收益与 USDT/法币换算永远排除猫粮。
- 广告奖励和现有 H5 游戏奖励继续发猫币，除非后续有独立产品需求。

## 配置、兼容与上线

- 新增逻辑远程开关 `wallet.activity_cat_food.enabled`，默认关闭；按当前钱包配置 JSON 契约下发为 `wallet.activity_cat_food_enabled`，供本版 iOS 客户端直接解码。
- 上线顺序：数据库迁移与回滚脚本 → 后端双读/余额字段 → 统一扣款服务 → iOS 兼容版本 → 开启展示 → 最后启用官方活动发放。
- 旧客户端必须继续正常查询猫币、充值、补单、送礼、解锁、通话、红包、转账和提现；不得因为未知 `activity_cat_food` 流水导致整个钱包响应解码失败。
- 添加指标：grant 成功/重复/失败、两种扣款拆分、余额不足、事务回滚、幂等冲突、负余额保护；日志不得记录 token、完整支付凭据或敏感 metadata。

## 测试与交付

必须覆盖：

1. 旧余额响应与新余额响应兼容，历史 `cat_food` 始终是猫币。
2. 纯猫粮、纯猫币、混合扣款、总余额不足、并发消费和幂等重试。
3. 发放重复请求、并发发放、越权发放、非法金额和撤回边界。
4. 完整退款严格回到原资产。
5. 礼物、媒体/动态/短剧解锁、普通通话和直播通话全部走统一扣款。
6. 红包、转账、IAP、提现、收费游戏入口、广告和游戏奖励与猫粮隔离；即使用户猫粮充足但猫币不足，收费游戏入口也必须按现有规则提示猫币不足。
7. 明细空态、分页稳定性、用户隔离和本地化降级。
8. 旧版本客户端端到端回归。

完成后请输出：修改文件、迁移及回滚步骤、OpenAPI/接口样例、统一扣款调用点清单、测试命令与结果、监控项、灰度开关和仍需 iOS 联调确认的内容。
