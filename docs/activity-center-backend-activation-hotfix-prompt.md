# 活动中心线上配置激活修复 Prompt

> 将本文件原样交给当前 BBchat 后端编码 Agent。必须直接检查并修改现有后端仓库、数据库迁移/配置发布流程和测试环境数据；不要只解释原因，也不要只重启服务。完成标准是已登录用户的真实接口验收通过。

## 已确认的线上现象

2026-08-03，iOS 已登录用户请求：

```http
GET /api/v1/activity-center
Authorization: Bearer <existing access token>
```

接口可达且响应壳能够解析，但 `data` 当前具有以下状态：

```json
{
  "config_version": null,
  "meal_rewards": [],
  "tasks": [],
  "wheel": {
    "enabled": false,
    "current_tier": null,
    "recent_winners": []
  }
}
```

这说明路由和鉴权已经部署，但运行环境没有读到当前生效的活动配置。单纯重启应用服务不会创建或激活配置。

## 必须完成的修复

1. 在实际部署环境检查活动配置迁移是否已经执行，确认 `activity_config_versions`、审计表及关联配置表/JSON 字段真实存在。
2. 检查“当前 active 配置”查询的全部过滤条件：
   - `status = active`；
   - `starts_at IS NULL OR starts_at <= now()`；
   - `ends_at IS NULL OR ends_at > now()`；
   - 环境、租户、feature flag、内部账号白名单条件；
   - UTC 与 `Asia/Tokyo` 的转换不能让配置错误地落在有效期外。
3. 检查是否只有 draft 行、active 行被意外归档、激活事务未提交，或配置存在但应用读取了另一套数据库/schema。
4. 检查 Redis/进程内配置缓存。激活事务提交后必须使活动配置缓存失效；缓存 key 必须包含环境/租户，且不能永久缓存“没有 active 配置”的结果。
5. 使用项目正式的受保护管理命令/API 发布配置，不要在 GET 接口中硬编码奖励，不要伪造 `config_version`。激活必须在事务内完成：锁配置发布域、校验 draft、归档旧 active、激活新版本、写审计、提交后清缓存。
6. 若当前环境没有待发布 draft，创建一份仅用于本测试/私有环境的版本化配置。所有数值必须位于配置 payload 中并可后续动态修改，不能写入业务代码：

```json
{
  "version": "activity-2026-08-private-v1",
  "status": "draft",
  "business_timezone": "Asia/Tokyo",
  "starts_at": null,
  "ends_at": null,
  "payload": {
    "new_user_check_in": {
      "enabled": true,
      "eligibility_days_after_registration": 30,
      "days": [
        {"day": 1, "reward_activity_cat_food": 10},
        {"day": 2, "reward_activity_cat_food": 20},
        {"day": 3, "reward_activity_cat_food": 30},
        {"day": 4, "reward_activity_cat_food": 40},
        {"day": 5, "reward_activity_cat_food": 50},
        {"day": 6, "reward_activity_cat_food": 60},
        {"day": 7, "reward_activity_cat_food": 100}
      ]
    },
    "meal_rewards": [
      {"window_id": "breakfast", "title_key": "activityCenter.meal.breakfast", "start_local": "07:00", "end_local": "09:00", "reward_activity_cat_food": 10},
      {"window_id": "lunch", "title_key": "activityCenter.meal.lunch", "start_local": "12:00", "end_local": "14:00", "reward_activity_cat_food": 20},
      {"window_id": "dinner", "title_key": "activityCenter.meal.dinner", "start_local": "18:00", "end_local": "21:00", "reward_activity_cat_food": 20}
    ],
    "tasks": {
      "contact_sync": {"enabled": true, "reward_activity_cat_food": 100},
      "invite_share": {"enabled": true, "reward_activity_cat_food": 10, "daily_limit": 5},
      "valid_invite": {"enabled": true, "reward_activity_cat_food": 100}
    },
    "wheel": {
      "enabled": true,
      "tiers": [
        {"tier_id": "tier_1", "sequence": 1, "cost_gold_coins": 1, "segments": [
          {"prize_id": "tier_1_p1", "payout_gold_coins": 1, "probability_ppm": 500000, "display_order": 0},
          {"prize_id": "tier_1_p2", "payout_gold_coins": 2, "probability_ppm": 300000, "display_order": 1},
          {"prize_id": "tier_1_p5", "payout_gold_coins": 5, "probability_ppm": 150000, "display_order": 2},
          {"prize_id": "tier_1_p10", "payout_gold_coins": 10, "probability_ppm": 50000, "display_order": 3}
        ]},
        {"tier_id": "tier_10", "sequence": 2, "cost_gold_coins": 10, "segments": [
          {"prize_id": "tier_10_p10", "payout_gold_coins": 10, "probability_ppm": 500000, "display_order": 0},
          {"prize_id": "tier_10_p20", "payout_gold_coins": 20, "probability_ppm": 300000, "display_order": 1},
          {"prize_id": "tier_10_p50", "payout_gold_coins": 50, "probability_ppm": 150000, "display_order": 2},
          {"prize_id": "tier_10_p100", "payout_gold_coins": 100, "probability_ppm": 50000, "display_order": 3}
        ]},
        {"tier_id": "tier_100", "sequence": 3, "cost_gold_coins": 100, "segments": [
          {"prize_id": "tier_100_p100", "payout_gold_coins": 100, "probability_ppm": 500000, "display_order": 0},
          {"prize_id": "tier_100_p200", "payout_gold_coins": 200, "probability_ppm": 300000, "display_order": 1},
          {"prize_id": "tier_100_p500", "payout_gold_coins": 500, "probability_ppm": 150000, "display_order": 2},
          {"prize_id": "tier_100_p1000", "payout_gold_coins": 1000, "probability_ppm": 50000, "display_order": 3}
        ]},
        {"tier_id": "tier_1000", "sequence": 4, "cost_gold_coins": 1000, "segments": [
          {"prize_id": "tier_1000_p1000", "payout_gold_coins": 1000, "probability_ppm": 500000, "display_order": 0},
          {"prize_id": "tier_1000_p2000", "payout_gold_coins": 2000, "probability_ppm": 300000, "display_order": 1},
          {"prize_id": "tier_1000_p5000", "payout_gold_coins": 5000, "probability_ppm": 150000, "display_order": 2},
          {"prize_id": "tier_1000_p10000", "payout_gold_coins": 10000, "probability_ppm": 50000, "display_order": 3}
        ]}
      ]
    }
  }
}
```

发布校验器必须拒绝任何不是 10 的正整数倍的 `reward_activity_cat_food`。同时自动生成单向且无回环的 `next_tier_id`：`tier_1 → tier_10 → tier_100 → tier_1000 → null`。末档完成后返回 `wheel.enabled=false` 并保持末档进度，严禁回到第一档。每档必须正好四个奖项、概率和严格为 `1_000_000 ppm`、最低奖金等于该档花费。

## 接口验收，不通过不得宣布完成

使用测试环境真实 Bearer Token 连续执行并保存脱敏结果：

1. `GET /api/v1/activity-center` 返回 HTTP 200、`code=0`。
2. `data.config_version` 必须是非空字符串，且等于刚激活的版本；不得为 `null`。
3. `check_in.days` 正好 7 项，每项金额来自 active payload。
4. `meal_rewards` 正好包含早餐、午餐、晚餐。
5. `tasks` 包含 `contact_sync`、`invite_share`、`valid_invite`。
6. `wheel.enabled=true`，`current_tier` 非空且正好四个 segments；每个金额、概率、顺序来自 active payload。
7. 重启后端后重复 GET，仍返回相同非空版本，证明配置已持久化且不是进程内临时数据。
8. 增加契约测试：存在 active 配置时不得返回 `config_version=null`；没有 active 配置时允许返回结构化 unavailable，但所有领取/抽奖接口必须拒绝发奖。
9. 输出实际迁移状态、active 配置记录的脱敏摘要、激活命令/API、缓存失效证据、测试命令和真实测试结果。

不要修改 iOS 字段名来迁就后端内部模型。GET 使用 `current_tier.id` 和 `segments[].id`；配置 payload 可使用 `tier_id`/`prize_id`，由响应 DTO 明确映射。
