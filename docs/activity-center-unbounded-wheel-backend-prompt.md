# BWChat 幸运转盘动态递增档位后端实施 Prompt

> 将本文件原样交给后端编码 Agent。必须直接修改现有后端仓库、迁移、配置校验器、领域服务和测试；不要只输出设计说明。本文取代此前“固定四档”和“第四档为末档”的转盘要求。

## 目标

将幸运转盘从预先枚举的四个档位改为“没有固定四档末档”的动态档位系统：保持现有 `1 → 10 → 100 → 1000 → 10000...` 十倍递增规则；用户每成功抽奖一次，`sequence` 精确增加 1；服务端根据版本化规则按需生成当前档位和下一档，不能因为配置只列了四项而停止、禁用或回到第一档。

注意区分：

- 每一档仍固定显示 4 个奖区，这是单个转盘的奖品布局。
- 档位数量不设为 4，也不预先写死为任意有限数组。
- iOS 以成功响应中的完整 snapshot 为权威，不自行推算档位、价格或奖金。

保留现有接口：

- `GET /api/v1/activity-center`
- `POST /api/v1/activity-center/wheel/spins`

保留 Bearer Token、统一响应壳、`Idempotency-Key`、钱包事务和不可变流水。

## 1. 先审计当前四档来源

检查并记录：

1. active activity config 是否包含固定 `tiers[]`，以及是否只有 `tier_1/tier_10/tier_100/tier_1000`。
2. 是否存在 `sequence == 4`、`next_tier_id == null`、`wheel_completed` 或末档禁用分支。
3. `activity_wheel_user_progress` 保存的是固定 `tier_id`，还是可持续增长的 sequence。
4. 配置缓存、Redis、DTO mapper 和测试 fixture 是否假设最多四档。
5. 钱包余额、流水 delta、档位 cost 和 payout 使用的数据库整数范围；确认 iOS 当前 JSON 数值必须可解码为有符号 64 位整数。

必须删除所有“第四档即完成”的业务判断，不能只增加更多静态档位。

## 2. 配置改为动态生成规则

将固定 `tiers[]` 替换为版本化生成规则。字段可映射到现有命名，但管理端和审计必须完整保存等价信息：

```json
{
  "wheel": {
    "enabled": true,
    "tier_generation": {
      "base_sequence": 1,
      "base_cost_gold_coins": 1,
      "growth_mode": "geometric",
      "cost_multiplier": 10,
      "payout_multipliers": [1, 2, 5, 10],
      "probability_ppm": [500000, 300000, 150000, 50000]
    }
  }
}
```

要求：

1. `sequence >= 1`，用户没有“completed/terminal tier”状态。
2. 保持既有十倍增长语义，不得在第四档之后改成线性、固定金额或回到第一档：`cost(n) = base_cost * 10^(n - base_sequence)`。
3. 档位必须按需计算，不能通过追加 `tier_10000/tier_100000...` 的有限静态数组伪装成无限档位。所有乘法和幂计算必须使用溢出安全整数运算。
4. 四个 payout 由 `cost(n) * multiplier[i]` 动态生成；四个概率和必须严格等于 `1_000_000 ppm`。
5. tier/prize ID 必须确定性生成且在同一 config version 内稳定，例如：
   - `tier_id = "<config_version>:tier:<sequence>"`
   - `prize_id = "<tier_id>:prize:<display_order>"`
6. 配置激活时验证基础金额、增长参数、乘数、概率、整数范围和未来安全窗口；禁止回退到固定四档兜底。

“无限”在本次兼容改造中表示不再把第四档设为产品末档，并按需动态生成后续十倍档位；当前 iOS、JSON 契约和钱包使用有符号 64 位整数，所以数学意义上的无限增长无法由现有金额类型表达。金额及最高奖项必须处于 `0...Int64.max`。在触及范围前必须报警并阻止发布不安全配置，不能回到第一档、产生负数或静默截断。若产品确实要求越过该范围，必须另立 iOS + API + 钱包 + 账本的版本化任意精度金额迁移，不得只在后端改成浮点数，也不得单方面把既有 JSON 数值改成字符串。

## 3. 用户进度模型

迁移 `activity_wheel_user_progress`，至少包含：

- `user_id`
- `config_version_id`
- `current_sequence`，使用 BIGINT
- `revision` 或乐观锁版本
- `updated_at`
- 唯一约束：`user_id + config_version_id`

不再把固定 `tier_id` 作为进度真相；tier ID 从 config version 和 sequence 确定性派生。首次进入初始化为 `base_sequence`。

已有四档用户按历史最高有效 sequence 迁移，不得丢失已完成抽奖记录。迁移脚本必须支持 dry-run、幂等执行、脱敏统计和审计。

## 4. GET 快照契约

`GET /activity-center` 每次根据数据库 `current_sequence` 动态生成当前 tier：

```json
{
  "wheel": {
    "enabled": true,
    "currency": "gold_coin",
    "current_tier": {
      "id": "activity-v5:tier:11",
      "sequence": 11,
      "cost_gold_coins": 10000000000,
      "next_tier_id": "activity-v5:tier:12",
      "segments": [
        {"id": "activity-v5:tier:11:prize:0", "payout_gold_coins": 10000000000, "probability_ppm": 500000, "display_order": 0},
        {"id": "activity-v5:tier:11:prize:1", "payout_gold_coins": 20000000000, "probability_ppm": 300000, "display_order": 1},
        {"id": "activity-v5:tier:11:prize:2", "payout_gold_coins": 50000000000, "probability_ppm": 150000, "display_order": 2},
        {"id": "activity-v5:tier:11:prize:3", "payout_gold_coins": 100000000000, "probability_ppm": 50000, "display_order": 3}
      ]
    }
  }
}
```

只要活动启用且配置有效，就不能因为 sequence 大于 4 而返回 `enabled=false`、`current_tier=null` 或第一档。

## 5. Spin 原子事务

`POST /activity-center/wheel/spins` 必须在单一事务中：

1. 根据 `user_id + config_version_id` 锁定进度行。
2. 验证客户端 `tier_id` 等于锁内当前 sequence 派生出的 tier ID；不一致返回 `409 wheel_tier_stale` 和最新 snapshot，不扣款。
3. 动态计算本档 cost、四个奖项和概率，从服务端安全随机抽样。
4. 原子扣款、派奖、写不可变流水和完整 spin 历史。
5. 将 `current_sequence` 精确更新为 `current_sequence + 1`。
6. 动态生成下一档 snapshot 并提交事务。
7. 成功后返回：`result.tier_id` 为刚抽取的档位，`result.next_tier_id == snapshot.wheel.current_tier.id`。

不得存在末档、完成态、自动回到第一档或固定列表查不到就禁用的分支。

## 6. 幂等与并发

1. 同一用户、接口和 `Idempotency-Key` 只能产生一次扣款、派奖、spin 和 sequence 增长。
2. 相同 key 重放必须返回完全相同的 `spin_id`、中奖结果和 snapshot。
3. 不同 key 并发请求必须通过进度行锁串行处理，后一个请求使用更新后的 sequence；不得重复同一档、跳档或透支。
4. key 相同但请求指纹不同返回 `409 idempotency_key_reused`。

## 7. 必须完成的测试

至少覆盖：

1. 从 sequence 1 连续抽到 11，始终每次 `+1`，并验证 `1 → 10 → 100 → 1000 → 10000...`，没有第四档终止逻辑。
2. 直接构造 sequence 11（cost 为 10,000,000,000）的 GET 和 spin，动态 tier、cost、四个 prize ID 均正确。
3. 每档始终恰好 4 个奖区，概率和为 `1_000_000 ppm`。
4. 服务重启、Redis 清空、跨业务日后 sequence 不回退。
5. 同一幂等 key 并发 20 次只推进一次；不同 key 并发能够严格串行推进。
6. 余额不足时返回稳定错误，不推进 sequence、不写半笔流水。
7. 溢出边界测试必须在扣款前失败，并记录配置/监控错误；不得崩溃或产生负数。
8. 旧四档用户迁移后能够从其当前 sequence 继续到 5、6、7……

## 8. 交付验收

输出并实际执行：

- 数据库迁移和回滚方案；
- 新旧配置转换与 active version 发布过程；
- 存量用户 dry-run/迁移结果；
- 单元、集成、并发和契约测试真实结果；
- sequence 1、4、5、10、11 的脱敏 HTTP 响应；
- 监控指标：当前 sequence 分布、动态生成失败、溢出拦截、幂等重放、钱包事务失败和接口延迟。

不得修改 iOS 字段名，不得恢复固定四档、末档完成或回到第一档的逻辑。
