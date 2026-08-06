# 后端调整 Prompt：图片/视频解锁静默自动抵扣

你正在调整 BWChat 后端的付费媒体解锁流程。iOS 客户端已移除图片解锁卡、视频解锁卡与余额支付的选择弹窗；用户点击锁定媒体后只发起一次解锁请求，不再选择支付方式，也不在客户端预扣或根据缓存库存决定扣费来源。

请先检查现有道具库存、钱包混合扣款、智能体付费媒体、朋友圈付费媒体、幂等记录和事务实现，然后直接完成代码、迁移与自动化测试。不要只给方案或伪代码。

## 1. 必须实现的扣费顺序

每次符合条件的图片或视频解锁，服务端必须在一个原子事务/一致性边界内严格按以下顺序裁决：

1. 优先消费 1 张与目标媒体类型匹配的有效解锁卡；
2. 没有可用匹配卡时，使用现有统一钱包扣款，先扣 `activity_cat_food`（活动猫粮）；
3. 猫粮不足的剩余金额再扣 `gold_coin`（金币）。

只要匹配卡存在且可用，就不得跳过道具去扣猫粮或金币。图片只能消费 `media_unlock_card_image`，视频只能消费 `media_unlock_card_video`。朋友圈纯图片帖子解锁只扣 1 张图片卡；单视频帖子只扣 1 张视频卡。不得同时扣卡和扣钱包，也不得让客户端补发第二次请求来完成回退。

## 2. 请求契约

以下两个现有接口新增自动支付方式：

- `POST /api/v1/agent-media/{media_id}/unlock`
- `POST /api/v1/moments/{moment_id}/unlock`

iOS 请求示例：

```json
{
  "payment_method": "auto",
  "prop_definition_id": "media_unlock_card_image"
}
```

视频请求的 `prop_definition_id` 为 `media_unlock_card_video`。

要求：

- `payment_method=auto` 表示服务端执行“匹配道具 → 活动猫粮 → 金币”的固定优先级，客户端不能覆盖该优先级。
- 服务端必须从目标媒体本身推导真实类型，并校验 `prop_definition_id` 与目标匹配；不得仅信任客户端字段。
- `prop_definition_id` 仅声明客户端预期的卡种，不能指定任意库存或其他道具。
- 保留现有空请求体/余额支付和显式 `payment_method=prop_card` 的旧客户端兼容路径，但新版 `auto` 路径不得退化为旧路径。

## 3. 原子性与幂等

在同一个事务中完成以下操作：

1. 锁定目标媒体/帖子与当前用户解锁记录；
2. 查询并锁定匹配的可消费道具库存；
3. 若有卡，消费 1 张并创建解锁记录；
4. 若无卡，调用现有统一钱包 `debitSpendableBalance`（或项目中的等价唯一领域方法），按猫粮优先、金币补足扣款，并创建解锁记录；
5. 写入不可变道具/钱包流水、业务结果和幂等结果后统一提交。

禁止以下实现：先查库存后在另一个事务扣款、先扣卡失败再由客户端重试余额、同时扣卡和钱包、部分提交、控制器复制钱包扣款逻辑。

同一用户、同一接口、同一 `Idempotency-Key` 的重试必须稳定返回第一次结果，不能重复扣卡、扣猫粮、扣金币或创建重复解锁记录。相同幂等键对应不同目标或不同请求体时返回 `IDEMPOTENCY_CONFLICT`。并发点击和并发消费最后一张卡时只能产生一个有效业务结果；失败竞争者必须重新在锁内裁决，不能错误地认为卡仍可用。

## 4. 成功响应

服务端必须返回实际采用的支付结果，而不是只回显请求中的 `auto`。

使用道具：

```json
{
  "payment_method": "prop_card",
  "already_unlocked": false,
  "consumed_prop": {
    "inventory_id": "inventory_uuid",
    "definition_id": "media_unlock_card_image",
    "remaining_quantity": 2
  },
  "charged_activity_cat_food": 0,
  "charged_gold_coins": 0,
  "total_charged": 0,
  "wallet_balance": {
    "currency": "gold_coin",
    "gold_coin_balance": 85,
    "activity_cat_food_balance": 20,
    "spendable_balance": 105
  }
}
```

使用钱包：

```json
{
  "payment_method": "spendable_balance",
  "already_unlocked": false,
  "consumed_prop": null,
  "charged_activity_cat_food": 20,
  "charged_gold_coins": 30,
  "total_charged": 50,
  "wallet_balance": {
    "currency": "gold_coin",
    "gold_coin_balance": 55,
    "activity_cat_food_balance": 0,
    "spendable_balance": 55
  }
}
```

同时保持各接口原有业务字段：智能体媒体继续返回可访问的 `content_url`、`download_url`；朋友圈继续返回解锁后的完整 `moment`。道具路径的 `consumed_prop` 必须存在，钱包路径的混合扣款字段和 `wallet_balance` 必须存在。已解锁重试不得产生任何新扣费，并稳定返回 `already_unlocked=true`。

## 5. 失败语义

- 没有可用匹配卡时不是错误，必须继续尝试猫粮与金币。
- 卡已过期、已耗尽或并发被占用时，应在同一次服务端请求的事务裁决中走钱包路径。
- 卡类型与目标不匹配、客户端传入非法定义、媒体不可解锁时不得扣任何资产。
- 钱包总可消费余额不足时返回现有稳定错误 `insufficient_spendable_balance`，并附带 `required_amount`、`activity_cat_food_balance`、`gold_coin_balance`、`spendable_balance`。
- 失败响应不得包含内容访问地址，日志不得记录签名 URL、token 或隐私数据。

## 6. 必须覆盖的测试

至少实现并运行以下测试：

1. 有图片卡时解锁图片，只扣 1 张卡，猫粮和金币不变。
2. 有视频卡时解锁视频，只扣 1 张卡，猫粮和金币不变。
3. 无匹配卡但猫粮足够时只扣猫粮。
4. 无匹配卡且猫粮不足时先耗尽猫粮，再扣剩余金币。
5. 有金币但也有匹配卡时仍必须优先扣卡。
6. 只有错误类型卡时不得消费错误卡，改走钱包。
7. 图片卡/视频卡类型声明与目标不匹配时整笔失败且不扣任何资产。
8. 总余额不足时不创建解锁记录、不扣卡、不扣钱包。
9. 同一幂等键重试不重复扣费，并返回相同的实际支付结果。
10. 并发争用最后一张卡时库存不为负，每个成功解锁最多收费一次。
11. 已解锁目标再次请求不重复扣费。
12. 旧客户端空请求体和显式 `prop_card` 路径保持兼容。
13. 两个接口的道具与钱包响应都符合上述字段契约。

## 7. 交付要求

完成后输出：变更文件、数据库迁移与回滚方式、接口/OpenAPI 变更、事务锁与幂等设计、错误码、自动化测试命令和结果、灰度发布顺序，以及是否存在需要 iOS 联调确认的差异。请直接实现并运行测试。
