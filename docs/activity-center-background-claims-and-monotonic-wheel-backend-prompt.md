# BBchat 活动中心后台领取与转盘单向推进修复 Prompt

> 将本文件原样交给后端编码 Agent。必须直接修改现有后端仓库并完成测试；不要只输出分析、伪代码或接口建议。

## 目标

修复活动中心的领取与幸运转盘契约，使 iOS 可以采用“前端立即播放动画、网络后台确认”的交互，同时确保任何重试、并发和快照刷新都不会让转盘回到较低档位或第一档。

保留现有 Bearer Token 鉴权、统一响应壳、钱包事务、不可变流水和以下路径：

- `GET /api/v1/activity-center`
- `POST /api/v1/activity-center/check-in/claim`
- `POST /api/v1/activity-center/meals/{window_id}/claim`
- `POST /api/v1/activity-center/wheel/spins`

## 1. 所有变更接口必须支持可靠的后台确认

1. 签到、饭点领取、任务奖励和转盘接口必须接受 `Idempotency-Key`，唯一范围至少为 `user_id + endpoint + key`。
2. 同一个 key、同一个请求指纹的并发请求只能执行一次钱包事务；其余请求等待或重放完全相同的成功响应，不得重复扣款、发奖或推进档位。
3. 同一个 key 配合不同请求指纹返回 HTTP 409 和稳定机器码 `idempotency_key_reused`。
4. 成功响应必须在钱包事务、奖励流水、领取记录/抽奖记录和用户进度全部提交后返回；响应中的完整 `snapshot` 必须是同一事务提交后的状态。
5. 对超时或连接中断，客户端会使用原 key 重试。后端不得因为首次请求已成功而返回“已领取”错误，必须重放首次成功响应。
6. 业务失败返回稳定、可区分的错误码；5xx/超时不得泄露数据库或供应商内部信息。

领取成功响应继续使用：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "granted_activity_cat_food": 20,
    "snapshot": {}
  }
}
```

`granted_activity_cat_food` 必须等于本次真实入账金额；重放响应也必须保持相同值。

## 2. 转盘档位只能单向推进，禁止任何回环

1. 配置中的档位按 `sequence` 严格递增且唯一，建议从 1 连续编号。
2. 非末档的 `next_tier_id` 只能指向唯一的下一高档；末档 `next_tier_id` 必须为 `null`。
3. 配置校验器必须拒绝：回到第一档、指向自身、指向任意更低/相同 sequence、跳档、环形链、悬空 ID。
4. 用户首次进入从第一档开始；每次成功抽奖恰好推进一档。进度更新与扣款、派奖、抽奖记录必须处于同一数据库事务并锁定该用户的进度行。
5. 完成末档后永久保留末档完成状态。`GET` 和 spin 成功响应都必须返回：

```json
{
  "wheel": {
    "enabled": false,
    "currency": "gold_coin",
    "current_tier": {
      "id": "tier_1000",
      "sequence": 4,
      "cost_gold_coins": 1000,
      "next_tier_id": null,
      "segments": [
        {"id": "tier_1000_p1000", "payout_gold_coins": 1000, "probability_ppm": 500000, "display_order": 0},
        {"id": "tier_1000_p2000", "payout_gold_coins": 2000, "probability_ppm": 300000, "display_order": 1},
        {"id": "tier_1000_p5000", "payout_gold_coins": 5000, "probability_ppm": 150000, "display_order": 2},
        {"id": "tier_1000_p10000", "payout_gold_coins": 10000, "probability_ppm": 50000, "display_order": 3}
      ]
    }
  }
}
```

末档完成后再次请求抽奖必须返回 HTTP 409、机器码 `wheel_completed`，不得扣款。

6. 不得根据“当天”“重新进入页面”“服务重启”“配置缓存刷新”把用户进度重置到第一档。只有启用全新 `config_version` 时才能初始化该版本的独立进度；旧版本历史不可改写。
7. 若客户端提交的 `tier_id` 不等于数据库锁定后的当前档位，返回 HTTP 409、机器码 `wheel_tier_stale`，并附最新完整 snapshot；不得按客户端档位继续扣款。

## 3. spin 响应必须与当前档位严格一致

成功响应格式保持：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "result": {
      "spin_id": "...",
      "tier_id": "tier_10",
      "cost_gold_coins": 10,
      "prize_id": "tier_10_p20",
      "payout_gold_coins": 20,
      "net_delta_gold_coins": 10,
      "next_tier_id": "tier_100"
    },
    "snapshot": {}
  }
}
```

必须满足：

- `result.tier_id` 等于本次请求并经数据库锁确认的档位。
- `result.prize_id` 必须能在该档 `segments[].id` 中精确找到，且 payout 完全一致。
- 非末档时，`result.next_tier_id == snapshot.wheel.current_tier.id`，且新 sequence 严格更大。
- 末档时，`result.next_tier_id` 必须为 JSON `null`，`snapshot.wheel.enabled=false`，snapshot 保留末档而不是首档。
- `snapshot.gold_coin_balance` 必须是本次扣款和派奖完成后的余额。

## 4. 数据迁移与存量错误进度修复

1. 检查当前配置是否把末档 `next_tier_id` 指回第一档；创建新版本或安全迁移为 `null`，清除所有回环。
2. 检查 `activity_wheel_user_progress` 是否缺少 `config_version_id`、当前 sequence 或完成状态；补充必要字段和约束。
3. 对已经因旧逻辑从高档回到第一档的用户，从不可变 `activity_wheel_spins` 历史重建其最高已完成 sequence：
   - 只允许恢复到历史最高进度或末档完成；
   - 禁止降低任何用户当前有效 sequence；
   - 脚本必须可 dry-run、输出脱敏计数、可重复执行且写审计。
4. 不得删除或重写历史抽奖流水，不得通过补余额掩盖进度错误。

## 5. 必须提供的自动化测试

至少覆盖：

1. 四档连续抽奖依次为 `1 → 2 → 3 → 4 → completed`，不存在 `4 → 1`。
2. 每一档响应的 `prize_id` 都能在本次档位四个 segments 中找到。
3. 末档完成后 GET 仍返回末档且 `enabled=false`；再次 spin 不扣款。
4. 同一幂等 key 并发 20 次只产生一笔扣款、一笔派奖、一个 spin 和一次进度推进。
5. 不同 key 并发时通过行锁串行推进，不透支、不跳档、不降档。
6. 请求超时后用原 key 重试，得到完全相同的 `spin_id`、奖品、余额和 snapshot。
7. 服务重启、Redis 清空、跨业务日后，档位不会回退。
8. 新 config version 初始化新进度，但旧版本进度与历史保持不变。
9. 存量修复脚本能把已回环用户恢复到历史最高档并保持幂等。

## 6. 交付与验收

输出并实际执行：

- 变更文件清单和数据库迁移；
- 回环配置审计结果与修复后的版本摘要；
- 存量数据 dry-run/执行结果（脱敏）；
- 单元、集成、并发和契约测试命令及真实结果；
- 使用测试账号连续完成所有档位的脱敏 HTTP 响应；
- 末档完成后再次 GET 和 spin 的验收证据；
- 监控指标：领取/抽奖幂等重放率、`wheel_tier_stale`、档位回退拦截、钱包事务失败率和接口延迟。

不得修改 iOS 字段名来迁就后端内部模型，也不得恢复任何“末档回到第一档”的循环玩法。
