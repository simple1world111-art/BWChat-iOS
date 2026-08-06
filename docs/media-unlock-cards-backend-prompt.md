# 图片 / 视频解锁卡后端实施 Prompt

你是一名资深后端工程师。请在现有 BWChat 后端中实现“图片解锁卡”和“视频解锁卡”，并与现有道具背包、智能体付费媒体、朋友圈付费媒体能力打通。请先阅读并复用项目已有的数据模型、认证、钱包、幂等、事务、审计与错误响应规范，不要另建平行体系。

## 前置约束

- 继续满足 `docs/prop-bag-backend-prompt.md` 定义的道具背包契约。
- 继续满足 `docs/moments-single-media-type-backend-prompt.md`：一条朋友圈只能包含一种媒体类型；图片最多 9 张；视频最多 1 个。
- 服务端是库存、媒体类型、解锁状态和扣费结果的唯一可信来源。不得相信客户端传入的媒体类型、价格、库存数量或剩余数量。
- 现有客户端不传 `payment_method` 或发送空 JSON 时，必须继续走原有猫币解锁流程，保持向后兼容。

## 1. 初始化两种道具定义

新增或幂等 upsert 以下定义：

### 图片解锁卡

```json
{
  "definition_id": "media_unlock_card_image",
  "type": "media_unlock_card",
  "name": "图片解锁卡",
  "description": "可解锁一次智能体生成图片或一条朋友圈图片帖子",
  "stackable": true,
  "consumable": true,
  "equippable": false,
  "enabled": true,
  "metadata": {
    "media_type": "image",
    "supported_targets": ["agent_paid_media", "moment"]
  }
}
```

### 视频解锁卡

```json
{
  "definition_id": "media_unlock_card_video",
  "type": "media_unlock_card",
  "name": "视频解锁卡",
  "description": "可解锁一次智能体生成视频或一条朋友圈视频帖子",
  "stackable": true,
  "consumable": true,
  "equippable": false,
  "enabled": true,
  "metadata": {
    "media_type": "video",
    "supported_targets": ["agent_paid_media", "moment"]
  }
}
```

智能体视频生成尚未上线，但必须保留视频卡定义、发放、查询、消费模型和智能体视频类型校验。对于尚未生成成功、不可播放、已失败或已过期的智能体视频，返回不可解锁错误，且绝不能消耗卡券。

请为两种定义补齐项目支持的所有本地化名称和描述。库存条目的 `available_actions` 仅在道具有效、数量大于 0 且当前账号可使用该功能时包含：

```json
["consume_for_media_unlock"]
```

## 2. 道具背包查询

确保以下接口返回两种卡券，并遵循现有统一响应包装：

```http
GET /api/v1/me/prop-bag
```

单个库存条目至少返回：

```json
{
  "inventory_id": "inventory_uuid",
  "definition_id": "media_unlock_card_image",
  "type": "media_unlock_card",
  "name": "图片解锁卡",
  "description": "可解锁一次智能体生成图片或一条朋友圈图片帖子",
  "icon_url": null,
  "quantity": 3,
  "is_equipped": false,
  "acquired_at": "2026-08-01T12:00:00Z",
  "expires_at": null,
  "available_actions": ["consume_for_media_unlock"],
  "metadata": {
    "media_type": "image"
  }
}
```

不得返回已经耗尽或已过期的数量。若系统支持多批次有效期，可在返回层聚合数量，但消费时必须优先扣除最早过期的有效批次。

## 3. 扩展两个现有解锁接口

不要创建重复的解锁接口。扩展：

```http
POST /api/v1/agent-media/{media_id}/unlock
POST /api/v1/moments/{moment_id}/unlock
Idempotency-Key: <stable UUID>
Content-Type: application/json
```

使用卡券时请求体：

```json
{
  "payment_method": "prop_card",
  "prop_definition_id": "media_unlock_card_image"
}
```

猫币解锁可继续接受空对象，也可接受：

```json
{
  "payment_method": "cat_coins"
}
```

### 类型规则

- `media_unlock_card_image`：只可解锁 `image` 类型的智能体付费媒体，或只包含图片的朋友圈帖子。
- `media_unlock_card_video`：只可解锁 `video` 类型的智能体付费媒体，或只包含一个视频的朋友圈帖子。
- 朋友圈类型必须根据服务端已持久化媒体记录判断，不能根据客户端字段判断。
- 图卡不能解锁视频，视频卡不能解锁图片，也不能通过异常字段绕过。
- 一张卡解锁一个目标：一条图片朋友圈即使包含多张图片，也只消费一张图片卡。

## 4. 原子消费与幂等

在同一个数据库事务中完成以下步骤：

1. 验证当前用户、目标媒体存在、目标可解锁并读取服务端真实媒体类型。
2. 检查目标是否已被该用户解锁；如果已解锁，直接返回 `already_unlocked=true`，不扣卡、不扣币。
3. 校验卡券定义与目标媒体类型完全一致。
4. 对最早过期的有效库存行加行锁，确认数量大于 0 且未过期。
5. 原子扣减 1 张卡，并创建不可变的道具消费事件。
6. 创建或更新媒体解锁记录。
7. 提交事务后再返回资源地址和最新剩余数量。

同一用户、同一接口、同一 `Idempotency-Key` 的重试必须返回第一次成功结果，不能重复扣卡或重复扣币。相同幂等键但目标或请求体不同，返回冲突。并发请求只能有一个成功扣减。

卡券无效、数量不足、已过期、类型不匹配、媒体不可解锁或事务失败时：

- 不得创建解锁记录；
- 不得扣卡；
- 不得自动回退到猫币并扣费；
- 不得只完成一半操作。

## 5. 响应契约

保持两个现有接口的原字段不变，并在卡券支付成功时增加：

```json
{
  "payment_method": "prop_card",
  "already_unlocked": false,
  "consumed_prop": {
    "inventory_id": "inventory_uuid",
    "definition_id": "media_unlock_card_image",
    "remaining_quantity": 2
  }
}
```

- 智能体媒体响应继续返回 `balance`、`content_url`、`download_url`；卡券支付时猫币余额保持不变。
- 朋友圈响应继续返回解锁后的完整 `moment`，并可返回 `wallet_balance`；卡券支付时钱包余额保持不变。
- 已解锁重试的 `consumed_prop` 应返回第一次消费的稳定结果，或明确为 `null`，但不能再次消费。
- 视频 `content_url` 必须是 iOS `AVPlayer` 可直接播放的 HTTPS URL；如需鉴权，请使用短期签名 URL，不能依赖客户端无法注入的自定义请求头。支持 Range 请求并返回正确 MIME 类型。

## 6. 稳定错误码

沿用项目统一错误格式，并至少提供以下机器可识别错误码：

- `PROP_NOT_OWNED`：没有可用卡券。
- `PROP_EXPIRED`：卡券已过期。
- `PROP_MEDIA_TYPE_MISMATCH`：卡券与媒体类型不匹配。
- `PROP_NOT_CONSUMABLE`：道具不可消费或定义被禁用。
- `MEDIA_NOT_UNLOCKABLE`：媒体未就绪、失败、过期或不可解锁。
- `IDEMPOTENCY_CONFLICT`：同一幂等键对应了不同请求。

建议业务校验返回 422，并发库存冲突或幂等冲突返回 409。日志不得暴露签名 URL、鉴权令牌或用户隐私数据。

## 7. 发放与审计

- 提供仅限受信任后台、运营或内部服务调用的幂等发放能力，可按用户、定义、数量、有效期和业务来源发放。
- 每次发放、消费、过期、撤销均写入不可变事件：`event_id`、`user_id`、`definition_id`、`inventory_id`、`delta`、`balance_after`、`reason`、`source_type`、`source_id`、`idempotency_key`、`created_at`。
- 禁止客户端直接修改库存数量。

## 8. 必须提交的测试

至少覆盖：

1. 图片卡成功解锁智能体图片，扣 1 张且不扣猫币。
2. 图片卡成功解锁包含 1～9 张图片的朋友圈，只扣 1 张。
3. 视频卡成功解锁单视频朋友圈，只扣 1 张。
4. 视频卡针对已就绪智能体视频的预留成功路径。
5. 图片卡解锁视频、视频卡解锁图片均失败且不扣库存。
6. 无库存、过期、禁用、媒体未就绪均失败且不产生部分写入。
7. 已解锁目标不重复扣卡。
8. 同一幂等键重试不重复扣卡；不同请求复用同一键返回冲突。
9. 两个并发请求争用最后一张卡时最多一个成功。
10. 空请求体继续使用旧猫币解锁，不破坏旧客户端。
11. 卡券支付响应包含 `consumed_prop`，返回数量与数据库一致。
12. 视频签名 URL 支持 iOS 播放所需的 HTTPS、MIME 与 Range 行为。

完成后请输出：变更文件、迁移与回滚方式、接口示例、错误码、并发与幂等设计、自动化测试结果，以及需要客户端配合的任何差异。不要只给方案，请直接实现并运行测试。
