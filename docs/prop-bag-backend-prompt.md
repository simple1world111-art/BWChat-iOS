# 道具包后端基础能力实现 Prompt

你正在为 BWChat 实现“我的 → 道具包”的后端基础能力。iOS 首版已经完成入口、资产概览、`全部 / 使用中 / 将过期`筛选、双列道具卡和空状态；目前不应在客户端伪造用户资产。请基于现有后端技术栈、鉴权、错误响应、数据库迁移和测试规范实现，不要另起一套框架。

## 本次范围

先实现“可查询、可扩展、可审计”的道具库存底座。具体道具的业务效果、使用条件和扣减规则之后逐个设计，因此本次不要把头像框、聊天特效等规则写死在通用库存服务中。

## 数据模型

1. `prop_definitions`：道具定义。
   - `id`：稳定字符串 ID，不允许复用。
   - `type`：可扩展字符串，例如 `avatar_cosmetic`、`chat_effect`、`utility`；未知类型必须可透传。
   - `name_i18n`、`description_i18n`：多语言 JSON。
   - `icon_url`、`theme`：展示资源；`theme` 至少可包含两个十六进制颜色。
   - `stackable`、`equippable`、`consumable`。
   - `enabled`、`metadata`、`created_at`、`updated_at`。
2. `user_prop_inventory`：用户实际持有记录。
   - `id`：库存实例 ID。
   - `user_id`、`prop_definition_id`、`quantity`。
   - `status`：`active / consumed / expired / revoked`。
   - `is_equipped`。
   - `acquired_at`、`expires_at`（可空）、`updated_at`、`version`。
   - 同一用户、同一定义、同一到期时间的可堆叠道具应有明确且一致的合并策略。
3. `user_prop_events`：不可变审计流水。
   - 记录 `grant / consume / equip / unequip / expire / revoke / adjust`。
   - 包含变更前后数量、来源、业务关联 ID、操作者、幂等键和时间。

必须添加必要的外键、唯一约束和以下查询所需索引：用户有效库存、即将过期库存、定义 ID、审计流水业务关联 ID。

## 查询 API

实现：

`GET /api/v1/me/prop-bag?filter=all|equipped|expiring&cursor=<cursor>&limit=20`

规则：

- 只能返回当前鉴权用户的库存，不接受客户端传入其他 `user_id`。
- `all` 仅返回仍可展示的有效库存；`equipped` 返回 `is_equipped=true`；`expiring` 返回服务端时间起 7 天内到期的库存。
- 使用稳定游标分页，排序为：使用中优先、最近到期优先、最近获得优先、`inventory_id` 兜底。
- `limit` 限制为 1～50。
- 到期判断只使用服务端 UTC 时间；已到期记录不能继续以 active 返回。
- 名称和描述根据请求语言返回，并提供服务端默认语言降级。

成功响应固定为：

```json
{
  "data": {
    "summary": {
      "total_quantity": 3,
      "equipped_count": 1,
      "expiring_count": 1
    },
    "items": [
      {
        "inventory_id": "inv_01...",
        "definition_id": "avatar_frame_aurora",
        "type": "avatar_cosmetic",
        "name": "极光头像框",
        "description": "",
        "icon_url": "https://...",
        "theme": { "colors": ["667EEA", "C779FF"] },
        "quantity": 1,
        "is_equipped": true,
        "acquired_at": "2026-08-01T00:00:00Z",
        "expires_at": null,
        "available_actions": ["unequip"],
        "metadata": {}
      }
    ],
    "next_cursor": null,
    "server_time": "2026-08-01T00:00:00Z"
  },
  "request_id": "req_..."
}
```

空库存必须返回 HTTP 200、空 `items`、三项 summary 为 0，不能用 404。

## 写入边界

- 本次只提供受保护的内部 grant/adjust 能力，供运营后台或其他可信业务服务发放道具；不要开放“客户端传 definition_id 即可领取”的公网接口。
- grant 必须支持幂等键，事务内同时写库存和审计流水，重试不能重复发放。
- 为未来 `equip / unequip / consume` 预留领域服务接口，但本次不实现任何具体道具效果。之后每个道具的 prompt 会补充规则。
- 禁止物理删除用户库存或审计流水；撤销使用状态和事件表示。

## 动态配置

如果服务端下发 `profile_sections`，加入或保留以下入口，不能因为远端配置覆盖而丢失：

```json
{
  "id": "prop_bag",
  "type": "row",
  "title_key": "propBag.title",
  "system_image": "shippingbox.fill",
  "colors": ["675AF5", "9D64F4"],
  "order": 15,
  "enabled": true,
  "route": { "type": "native", "name": "prop_bag" }
}
```

## 安全、并发与测试

- 所有接口复用现有登录鉴权、限流、统一错误结构和 `request_id`。
- 数量不得为负；更新使用事务和版本号或行锁处理并发。
- `icon_url` 只允许受信任的 HTTPS CDN 域名；metadata 设置大小和嵌套深度限制。
- 覆盖单元/集成测试：空库存、三种筛选、7 天边界、已过期过滤、分页稳定性、越权隔离、幂等重试、并发 grant、国际化降级、远端 profile 入口保留。
- 给出迁移、回滚、接口文档、示例请求响应和测试命令；不要提交仅有伪代码的实现。

完成后请列出改动文件、迁移影响、接口契约、测试结果，以及 iOS 接入时需要确认的 base URL 和鉴权方式。
