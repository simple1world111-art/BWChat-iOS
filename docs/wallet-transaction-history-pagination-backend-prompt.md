# 后端调整 Prompt：金币明细全量历史与游标分页

你正在调整 BWChat 后端的金币账本查询。iOS 客户端已经移除原先最多展示 500 条的硬截断，并支持通过 `next_cursor` 自动加载更早记录。请完成后端分页、历史数据迁移和完整性验证，让用户能够一直翻到其第一条金币记录。

## 1. 目标

- `GET /api/v1/wallet/transactions` 必须能够通过游标分页读取当前登录用户的**全部金币历史**。
- `limit` 只是单页大小，不是总记录数或保留期限；不得只保留/只查询最近 50、100、500 条。
- 不得为了上线分页删除、聚合、覆盖或重新生成旧账本记录。
- 金币账本应为追加式事实记录；如历史数据已归档，接口也必须透明地继续查询归档数据。

## 2. 请求与响应契约

请求：

```http
GET /api/v1/wallet/transactions?limit=50&cursor=<opaque_cursor>
Authorization: Bearer <token>
```

- `cursor` 缺失时返回最新一页。
- `limit` 默认 50，允许范围 1...100；超出范围可钳制或返回明确的 400，但不得把它解释为总历史上限。
- `cursor` 必须是不透明字符串，客户端不会解析其内容。

成功响应统一为：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [
      {
        "id": "ledger_01J...",
        "type": "gift_sent",
        "currency": "gold_coin",
        "gold_coin_amount": -20,
        "gold_coin_balance_after": 80,
        "title": "Gift sent",
        "note": "...",
        "created_at": "2026-08-05T03:20:10.123Z"
      }
    ],
    "next_cursor": "opaque-older-page-cursor"
  }
}
```

- 按 `created_at DESC, id DESC` 返回；同一排序键必须稳定。
- 还有更早记录时返回非空 `next_cursor`；到达最早记录时必须返回 `null`。
- 空页不得重复返回当前 cursor，也不得制造无限翻页。
- 每条记录必须有跨请求稳定且唯一的 `id`。
- 金额使用有符号整数：收入为正、支出为负。已有业务若内部以方向字段存储，可在读模型中规范化，但不得改变账本事实。
- 新响应只输出 `currency=gold_coin`、`gold_coin_amount`、`gold_coin_balance_after` 等最终字段。
- 为兼容已经发布的旧客户端，无分页参数的请求也应返回最新一页；`data.items`、`data.transactions` 二选一后保持稳定，不要在灰度期间随机切换形状。

## 3. 分页正确性

- 使用 keyset/cursor pagination，不要使用会在新增流水时漂移的 offset pagination。
- cursor 至少绑定当前用户、排序边界和必要的查询版本；必须签名或使用不可伪造的服务端令牌。
- 分页期间产生新流水时，继续使用旧 cursor 不得导致历史记录跳过或重复。建议 cursor 带首次请求的高水位快照，再使用 `(created_at, id)` 查找更早记录。
- cursor 属于其他用户、已损坏或已过期时返回明确的 400/422，绝不能泄露其他用户账本。
- 建议索引：`(user_id, created_at DESC, id DESC)`，并用真实大账户验证执行计划。

## 4. 历史金币迁移与兼容读取

历史数据可能使用 `cat_coin`、`cat_coins`，更早的裸 `cat_food` 也表示同一金币资产。请执行可审计、可回滚的数据迁移：

1. 将确认属于历史金币账本的 `cat_coin`、`cat_coins`、裸 `cat_food` 迁移/映射为 `gold_coin`。
2. 将旧金额字段 `cat_coin_amount`、`cat_food_amount`、`coin_amount` 等规范化为 `gold_coin_amount`。
3. 将旧 `balance_after` 在金币账本读取模型中规范化为 `gold_coin_balance_after`。
4. `activity_cat_food` 是独立活动资产，绝不能迁入金币账本。
5. 保持原账本 `id`、幂等键、订单号、Apple transaction ID、业务引用和时间戳不变。
6. 如果暂不能一次性改完物理表，先在查询层做兼容读取，但新写入和 API 输出必须只使用最终金币字段。
7. 单条旧记录字段异常不得导致整个分页接口返回空数组；应记录可观测错误并修复数据。禁止静默丢失真实金币流水。

## 5. 数据保留与对账

- 查清生产环境是否存在定时清理、ORM 默认 `LIMIT`、Repository 层 `.take()`、Redis 列表裁剪、物化视图窗口、冷热分层遗漏或仅查最近 N 天等限制，并全部从用户账本查询链路移除。
- 如果法规/业务确有保留期，不能私自假设；请明确列出政策依据、实际期限和用户可导出方案，再请求产品确认。
- 按用户核对迁移前后：记录数、收入总额、支出总额、净变动、首条/末条记录以及当前余额关联关系。
- 不得用“补一条余额调整”掩盖历史流水缺失。

## 6. 验收测试

至少覆盖：

1. 一个拥有 1,237 条流水的用户，从第一页连续翻页后恰好获得 1,237 个唯一 ID，能够读到第一条历史记录。
2. 记录数恰好为 0、1、50、51、500、501、1,000+ 的边界。
3. 分页过程中插入一条新流水，旧 cursor 继续向后翻页不漏、不重。
4. 相同 `created_at` 下使用 `id` 稳定排序。
5. 最后一页 `next_cursor=null`，空账户也为 `null`。
6. 非法 cursor、跨用户 cursor 和篡改 cursor 被拒绝。
7. 旧 `cat_coin` / `cat_coins` / 裸 `cat_food` 金币记录均以最终金币字段返回；`activity_cat_food` 不混入。
8. 一条损坏记录不会让整页有效记录消失，并产生告警/修复任务。
9. 新旧客户端兼容测试，无参数请求仍能正常显示最新流水。
10. 对生产级大账户执行 SQL/ORM 查询计划验证，不出现全表扫描或逐条 N+1 查询。

## 7. 交付结果

完成后请输出：

- 修改文件和数据库 migration 清单；
- 最终 OpenAPI/接口契约；
- cursor 结构与防篡改策略（不要输出生产密钥）；
- 数据保留链路审计结果；
- 历史字段迁移与守恒对账结果；
- 1,237 条全量翻页测试结果；
- 上线顺序、监控指标和可回滚方案。
