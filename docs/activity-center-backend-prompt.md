# BBchat 活动中心后端完整实施 Prompt

> 将本文件原样交给后端编码 Agent。不要只输出设计说明或伪代码；必须在现有后端仓库中完成数据库迁移、领域服务、接口、管理配置、测试、监控与部署文档，并给出实际变更文件和可执行验证结果。

## 你的任务

在现有 BBchat 后端中实现生产可用的“活动中心”。移动端已经按本文契约开发，所有接口沿用现有 Bearer Token 鉴权、用户体系、钱包领域和统一响应壳：

```json
{"code": 0, "message": "ok", "data": {}}
```

API 基础路径为 `/api/v1`。业务成功必须 `code = 0`；业务失败使用稳定的机器错误码和合适的 HTTP 状态码，不得把数据库、网关或短信供应商内部错误直接暴露给客户端。

奖励资产只有两种：

- 福利任务只发 `activity_cat_food`。
- 幸运转盘只扣和发 `gold_coin`。

任何奖励金额、时段、档位、奖项和概率都必须来自当前生效的版本化服务端配置。客户端提交的金额、概率、中奖结果一律忽略并拒绝。不要在服务端业务代码中写生产奖励金额兜底。

## 1. 先审计并复用现有领域

开始编码前检查现有仓库并记录结果：

1. Bearer Token 中间件、统一响应壳和错误码约定。
2. 用户、注册时间、账号状态和好友申请模型。
3. 钱包主账户及 `gold_coin_balance`、`gift_income_gold_coin_balance`、`withdrawable_gold_coin_balance`、`activity_cat_food_balance` 的真实表结构与扣款顺序。
4. 现有不可变钱包流水、余额快照、事务锁、提现和对账任务。
5. 注册、短信验证码、手机号绑定、手机号唯一性、封禁和风控能力。
6. Redis、任务队列、配置后台、审计日志、指标和结构化日志基础设施。

必须复用这些能力，不得另建一套相互独立的钱包余额。若现有命名不同，在保持本文 JSON 契约不变的前提下映射到现有领域。

## 2. 数据库迁移

使用项目现有迁移工具创建等价的正式表。以下字段为最低要求；可按现有数据库类型调整 UUID、JSON 和时间类型，但不得弱化约束。

### 2.1 活动配置

`activity_config_versions`

- `id` UUID/ULID 主键
- `version` varchar 唯一、不可变
- `status` enum/check：`draft | active | archived`
- `business_timezone` IANA 时区名
- `starts_at`、`ends_at` nullable UTC timestamp
- `payload` JSON/JSONB，包含签到、餐点、任务、邀请、转盘完整配置
- `created_by`、`created_at`、`updated_at`
- `activated_by`、`activated_at` nullable
- `checksum`，对规范化 payload 计算

`activity_config_audits`

- 配置 ID、旧/新状态、旧/新 checksum、操作人、原因、UTC 时间、请求/变更追踪 ID
- 审计记录只追加不可修改

同一时刻最多一个满足时间范围的 `active` 版本。激活必须使用事务和互斥锁；激活新版本时归档旧版本。

### 2.2 签到与餐点

`activity_new_user_checkins`

- `user_id` + `activity_key` + `day_number` 唯一
- `config_version_id`
- `reward_activity_cat_food`
- `claimed_at`
- `ledger_entry_id`
- `idempotency_key`

`activity_meal_claims`

- `user_id` + `business_local_date` + `window_id` 唯一
- `config_version_id`
- `reward_activity_cat_food`
- `claimed_at`、`ledger_entry_id`、`idempotency_key`

签到为新用户一次性累计 7 天：从满足资格后开始，领取成功一次推进一天；未领取的自然日不会清零，也不能在同一个业务日领取多次。完成第 7 天后永久完成。

### 2.3 任务、联系人和分享

`activity_task_grants`

- `id`
- `user_id`
- `task_kind`：`contact_sync | invite_share | valid_invite`
- `business_local_date`（一次性任务可为空）
- `source_id`（匹配 session、分享 session 或 attribution ID）
- `config_version_id`
- `reward_activity_cat_food`
- `ledger_entry_id`
- `granted_at`
- 按任务语义建立唯一索引：通讯录每用户一次；分享每 session 一次；有效邀请每 attribution 一次

`contact_discovery_sessions`

- `id`、`user_id`
- `salt_version`、加密或密钥引用形式的 `salt_secret`
- `max_contacts`
- `expires_at`、`consumed_at`
- 不保存联系人姓名、头像、原始号码；上传的 hash 不进入永久表

联系人 hash 统一为小写十六进制：

```text
sha256(UTF8(salt + U+0000 + phone_e164))
```

匹配时从已验证手机号索引按相同 salt 生成短期 hash，或使用可轮换的受保护派生索引；响应后删除/过期临时 hash。盐至少按版本轮换，session 过期后不可使用。

`invite_share_sessions`

- `id`、`inviter_user_id`
- `invite_attribution_id`
- `token_hash`，不得明文永久保存分享 token
- `short_code`
- `created_at`、`expires_at`、`completed_at`
- `rewarded_at`、`ledger_entry_id`

分享完成接口只允许同一 session 完成一次；按业务时区和配置的每日上限发小额猫粮。达到上限仍可返回完成成功，但 `granted_activity_cat_food = 0`。

### 2.4 邀请归因与手机号

`activity_invite_attributions`

- `id`
- `inviter_user_id`、`invitee_user_id`，两者不得相同
- `share_session_id` nullable
- `short_code`
- `token_hash` nullable
- `redeemed_at`
- `verified_phone_id` nullable
- `qualified_at`、`rewarded_at` nullable
- `config_version_id`、`reward_activity_cat_food`、`ledger_entry_id` nullable
- `invitee_user_id` 全局唯一：一个受邀用户只能归因一次
- `verified_phone_id` 唯一：一个已验证手机号只能产生一次邀请资格

手机号表必须保存规范化 E.164 的唯一值或确定性加密/盲索引，数据库层建立全局唯一约束。不要只依赖应用层查询。

`phone_verification_sessions`

- `id`、`user_id`
- `phone_e164_encrypted`、`phone_unique_blind_index`
- 只保存验证码的强哈希，不保存明文验证码
- `expires_at`、`retry_after_at`、`attempts_remaining`、`verified_at`
- IP、设备、手机号、账号维度的频控计数可放 Redis

验证码成功必须在单一事务内绑定唯一手机号、消费 session，并检查是否存在待完成邀请归因；若满足条件，同一事务向邀请者发有效邀请猫粮。

### 2.5 转盘

`activity_wheel_user_progress`

- `user_id` 主键
- `current_tier_id`
- `config_version_id`
- `updated_at`

`activity_wheel_spins`

- `id`、`user_id`
- `idempotency_key`，与 `user_id` 唯一
- `config_version_id`
- `tier_id`、`tier_sequence`
- `cost_gold_coins`
- `prize_id`、`payout_gold_coins`
- `probability_ppm`
- `sample_ppm`，范围 `0...999999`
- `debit_ledger_entry_id`、`credit_ledger_entry_id`
- 扣款前后总余额、子账户余额快照
- `next_tier_id`
- `created_at`

历史抽奖记录必须保存当时的版本、花费、奖项、概率、抽样值和前后余额。配置修改不得改写历史。

### 2.6 幂等请求

如现有平台没有通用幂等表，增加 `api_idempotency_records`：

- `user_id`、`endpoint_key`、`idempotency_key` 联合唯一
- `request_fingerprint`
- `status`：`processing | completed | failed_final`
- 完整业务响应（加密/受控 JSON）、HTTP 状态
- `created_at`、`completed_at`、过期时间

同一 key 且 fingerprint 不同返回 `409 idempotency_key_reused`。`processing` 请求返回可重试的确定响应或等待首次事务结束。完成响应必须可原样重放。

## 3. 配置格式与发布校验

配置 payload 至少包含：

```json
{
  "new_user_check_in": {
    "enabled": true,
    "eligibility_days_after_registration": 30,
    "days": [
      {"day": 1, "reward_activity_cat_food": 0}
    ]
  },
  "meal_rewards": [
    {
      "window_id": "breakfast",
      "title_key": "activityCenter.meal.breakfast",
      "start_local": "07:00",
      "end_local": "09:00",
      "reward_activity_cat_food": 0
    }
  ],
  "tasks": {
    "contact_sync": {"enabled": true, "reward_activity_cat_food": 0},
    "invite_share": {"enabled": true, "reward_activity_cat_food": 0, "daily_limit": 0},
    "valid_invite": {"enabled": true, "reward_activity_cat_food": 0}
  },
  "wheel": {
    "enabled": true,
    "tiers": [
      {
        "tier_id": "tier_1",
        "sequence": 1,
        "cost_gold_coins": 1,
        "segments": [
          {"prize_id": "p1", "payout_gold_coins": 1, "probability_ppm": 250000, "display_order": 0}
        ]
      }
    ]
  }
}
```

示例中的 `0` 仅表示 schema 占位，不得作为生产默认值。发布前必须验证：

1. 签到正好 Day 1～7；所有 `reward_activity_cat_food` 必须为 10 的正整数倍，非 10 倍数禁止激活。
2. IANA 时区有效；餐点时间合法、`start < end`，同一窗口 ID 唯一。跨午夜窗口如需支持必须明确拆分业务日归属并测试。
3. 所有启用任务金额必须为 10 的正整数倍；分享每日上限为正整数。
4. 转盘至少一档；按 `sequence` 连续排序。
5. 第一档花费由运营配置；后续每档 `cost[n] == cost[n-1] * 10`，使用溢出安全整数。
6. 每档恰好 4 个奖项，`display_order` 恰好为 `0,1,2,3`，ID 唯一。
7. 每个 payout 为正整数，且 `min(payout_gold_coins) == cost_gold_coins`。
8. 每个概率为 `0...1_000_000` 整数，四项总和严格等于 `1_000_000 ppm`；至少一个概率大于 0。
9. 每档 `next_tier_id` 由服务端生成并且只能指向更高 `sequence` 的下一档；最后一档必须为 `null`，禁止回到第一档或任何低序号档位。
10. 激活前做完整 dry-run 校验；任一失败阻止发布并写审计。

提供后台或受保护的管理命令/API，实现草稿创建、校验、预览、激活和归档。只有授权运营角色可操作，所有动作写审计。

## 4. 移动端接口契约

所有时间使用带偏移的 ISO-8601；服务端内部存 UTC。`business_timezone` 返回 IANA 名称。所有整数不得以浮点返回。以下字段不可随意改名。

### 4.1 GET `/api/v1/activity-center`

返回当前用户完整快照：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "config_version": "activity-2026-08-v3",
    "server_time": "2026-08-03T12:28:00+09:00",
    "business_timezone": "Asia/Tokyo",
    "activity_cat_food_balance": 60,
    "gold_coin_balance": 1280,
    "phone_binding": {
      "is_verified": true,
      "masked_phone": "+81******5678",
      "default_region": "JP"
    },
    "check_in": {
      "activity_id": "new_user_7d_v1",
      "claimed_days": 1,
      "completed": false,
      "can_claim": true,
      "days": [
        {"day": 1, "reward_activity_cat_food": 10, "status": "claimed"},
        {"day": 2, "reward_activity_cat_food": 20, "status": "claimable"}
      ]
    },
    "meal_rewards": [
      {
        "window_id": "lunch",
        "title_key": "activityCenter.meal.lunch",
        "start_local": "12:00",
        "end_local": "14:00",
        "reward_activity_cat_food": 20,
        "status": "claimable",
        "next_transition_at": "2026-08-03T14:00:00+09:00",
        "claimed_at": null
      }
    ],
    "tasks": [
      {
        "id": "contact_sync",
        "kind": "contact_sync",
        "status": "available",
        "reward_activity_cat_food": 100,
        "daily_limit": null,
        "completed_count": 0,
        "credited_count": 0
      }
    ],
    "invitation": {
      "invite_code": "MEOW88",
      "share_url": "https://YOUR_HOST/i/opaque-token",
      "pending_invites": 1,
      "credited_invites": 0,
      "can_redeem": true
    },
    "wheel": {
      "enabled": true,
      "currency": "gold_coin",
      "current_tier": {
        "id": "tier_10",
        "sequence": 2,
        "cost_gold_coins": 10,
        "next_tier_id": "tier_100",
        "segments": [
          {"id": "p10", "payout_gold_coins": 10, "probability_ppm": 500000, "display_order": 0},
          {"id": "p20", "payout_gold_coins": 20, "probability_ppm": 300000, "display_order": 1},
          {"id": "p50", "payout_gold_coins": 50, "probability_ppm": 150000, "display_order": 2},
          {"id": "p100", "payout_gold_coins": 100, "probability_ppm": 50000, "display_order": 3}
        ]
      },
      "recent_winners": [
        {"id": "public-record-id", "display_name": "M***w", "avatar_url": "", "payout_gold_coins": 100}
      ]
    }
  }
}
```

签到状态只使用：`locked | claimable | claimed | completed | unavailable`。餐点/任务可使用 `available`。金额始终返回当前生效版本中的真实值；活动未启用时返回结构化 disabled 状态，不要让客户端猜测。

最近中奖记录只显示允许公开且经过脱敏的昵称/头像，绝不返回 user_id、手机号或完整姓名。

### 4.2 POST `/api/v1/activity-center/check-in/claim`

需要 `Idempotency-Key`。请求体 `{}`。服务端锁用户签到进度，以业务时区判断当日是否已领和当前 Day，不接受客户端 Day 或金额。

成功 `data`：

```json
{
  "granted_activity_cat_food": 5,
  "snapshot": {"...": "与 GET data 完全相同的最新快照"}
}
```

### 4.3 POST `/api/v1/activity-center/meals/{window_id}/claim`

需要 `Idempotency-Key`。服务端以自己的时钟和配置时区检查窗口，并执行用户+业务日期+窗口唯一约束。边界定义为 `[start, end)`。成功响应与签到相同。

稳定错误码至少包含：`activity_window_not_open`、`activity_reward_already_claimed`、`activity_not_eligible`、`activity_config_changed`。

### 4.4 POST `/api/v1/activity-center/wheel/spins`

需要 `Idempotency-Key`。请求：

```json
{
  "expected_config_version": "activity-2026-08-v3",
  "tier_id": "tier_10"
}
```

服务端必须按以下顺序在一个数据库事务中完成：

1. 取得幂等锁；若已完成，原样返回旧响应。
2. `SELECT ... FOR UPDATE` 锁定用户转盘进度和钱包余额。
3. 验证期望配置仍生效、`tier_id` 等于用户当前档位、档位配置合法。
4. 使用钱包现有可消费总金币口径检查余额；本私有构建允许消费全部 `gold_coin_balance`。子账户扣款顺序严格复用现有钱包规则。
5. 使用操作系统 CSPRNG/数据库安全随机源生成均匀整数 `sample_ppm ∈ [0, 999999]`。测试环境允许依赖注入固定 RNG，生产禁止可预测 PRNG。
6. 按 `display_order` 建立累计半开区间选择奖项，例如 `[0,c1)`、`[c1,c2)`；不得使用浮点。
7. 扣除花费，创建不可变 debit 流水。
8. 将奖金计入 `gift_income_gold_coin_balance` 和 `withdrawable_gold_coin_balance`，同时维护现有 `gold_coin_balance` 的代数一致性；创建不可变 credit 流水。
9. 写抽奖记录和所有余额快照。
10. 档位只能单向推进至下一档；完成最后一档后永久停留在已完成状态，`wheel.enabled=false`、`next_tier_id=null`，不得回到第一档。
11. 写幂等完成响应并提交。

任一步失败全部回滚。并发抽奖不得透支、重复扣款或跳档。

成功：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "result": {
      "spin_id": "spin-id",
      "tier_id": "tier_10",
      "cost_gold_coins": 10,
      "prize_id": "p20",
      "payout_gold_coins": 20,
      "net_delta_gold_coins": 10,
      "next_tier_id": "tier_100"
    },
    "snapshot": {"...": "最新完整快照，current_tier 已推进"}
  }
}
```

余额不足返回 `409 insufficient_gold_coins` 并包含 `required_amount` 和当前余额上下文；不要产生抽奖记录或流水。

### 4.5 POST `/api/v1/activity-center/contact-discovery/sessions`

请求 `{}`，响应：

```json
{
  "session_id": "session-id",
  "salt": "base64url-random-secret",
  "salt_version": "contacts-2026-08-03-01",
  "default_region": "JP",
  "max_contacts": 5000,
  "expires_at": "2026-08-03T03:38:00Z"
}
```

只允许已绑定唯一手机号的用户创建。session 短期有效、单次消费；盐用 CSPRNG 或受保护的版本化密钥派生。

### 4.6 POST `/api/v1/activity-center/contact-discovery/sessions/{id}/match`

需要 `Idempotency-Key`。请求只接收去重 hash：

```json
{
  "salt_version": "contacts-2026-08-03-01",
  "phone_hashes": ["64-char-lowercase-hex"]
}
```

严格校验数量、长度、格式、session 所属用户、版本、过期和单次消费。不得接收或记录姓名、头像、原始号码。只返回允许被发现的用户；屏蔽自己、封禁账号、已拉黑关系及隐私设置关闭者。

首次成功完成同步时发一次通讯录猫粮；零匹配也视为完成，防止奖励依赖社交图谱。响应：

```json
{
  "matches": [
    {"user_id": "u2", "nickname": "Momo", "avatar_url": "https://...", "relation": "none"}
  ],
  "granted_activity_cat_food": 100,
  "snapshot": {"...": "最新完整快照"}
}
```

### 4.7 POST `/api/v1/activity-center/invite-share-sessions`

请求 `{}`。创建可归因的一次性分享 session 和高熵 token；永久表只存 token hash。HTTPS 落地页地址必须与 `bwchat://invite/<token>` 对应，并同时展示短邀请码和下载入口。

```json
{
  "session_id": "share-session-id",
  "share_url": "https://YOUR_HOST/i/opaque-token",
  "invite_code": "MEOW88",
  "message": "Join me on BBchat",
  "expires_at": "2026-08-10T03:28:00Z"
}
```

不得把完整 token 写日志、指标 label 或分析事件。

### 4.8 POST `/api/v1/activity-center/invite-share-sessions/{id}/complete`

需要 `Idempotency-Key`，请求 `{}`。验证 session 所属用户和未过期；按每日上限发小额猫粮。响应为 `{granted_activity_cat_food, snapshot}`。系统分享完成信号只作为产品完成事件，不代表对方注册；大额奖励仍必须经过后续有效邀请资格。

### 4.9 POST `/api/v1/activity-center/invites/redeem`

需要 `Idempotency-Key`。请求：

```json
{"code_or_token": "MEOW88-or-opaque-token"}
```

接受短码或深链 token。禁止自邀、同一 invitee 重复归因、已验证手机号复用、多账号循环邀请、封禁账号和过期 token。兑换成功后即使手机号尚未验证，也创建 pending attribution；手机号验证成功时原子完成资格并奖励邀请者。响应 `data` 为最新完整快照。

### 4.10 POST `/api/v1/account/phone/verification-sessions`

请求：

```json
{"phone_e164": "+819012345678"}
```

只接受服务端再次验证为合法的 E.164。响应：

```json
{
  "session_id": "verification-id",
  "expires_at": "2026-08-03T03:38:00Z",
  "retry_after_seconds": 60
}
```

对账号、设备、IP、号码设置分钟/小时/日频控；验证码短期有效、强随机、限制尝试次数。日志不得出现完整号码或验证码。

### 4.11 POST `/api/v1/account/phone/verify`

需要 `Idempotency-Key`。请求：

```json
{"session_id": "verification-id", "code": "123456"}
```

原子验证并绑定全局唯一手机号。若号码已绑定其他账号，返回 `409 phone_already_bound`。成功 `data` 为最新活动中心完整快照。验证码错误只返回通用错误并递减次数，不泄露号码是否存在。

## 5. 账本和一致性硬要求

1. 签到、餐点、通讯录、分享、有效邀请仅写 `activity_cat_food` 账本，流水原因码分别固定且可审计。
2. 每笔 grant 流水保存 `config_version`、任务/窗口/Day、source ID、幂等键和前后余额。
3. 猫粮发放、领取记录和余额变更必须在同一事务；唯一约束冲突时返回第一次成功结果。
4. 转盘 debit/credit 两笔流水不可变并互相引用同一 `spin_id`。
5. 转盘奖金进入礼物收入和可提现金币余额；总余额和所有子账户必须满足现有钱包代数不变量。
6. 不允许负余额。数据库约束、锁或条件更新至少提供两层保护。
7. 配置切换时，已开始但未提交的事务固定使用锁定时读取的 active 版本；客户端版本不一致返回稳定错误并附最新快照或要求刷新。
8. 定时对账：按活动流水重算猫粮；按转盘 debit/credit 重算金币与子账户；发现不一致报警，不自动篡改历史。

## 6. 安全、隐私与风控

- 请求日志和 APM span 对 `Authorization`、验证码、E.164、contact hash 数组、完整邀请 token 和幂等响应做字段级脱敏。
- 客户端上传联系人 hash 的接口禁用 HTTP/CDN 缓存，请求体不进入错误采样。
- 联系人 session 和临时 hash 自动过期清理；原始联系人号码永不接收。
- 邀请 token 至少 128 bit 熵，恒定时间比较 token hash；短码避免易混字符并有足够空间。
- 防止自邀、设备农场、同 IP/设备批量账号、虚拟/高风险号码、封禁账号刷奖；风险规则拒绝时写安全审计但不暴露规则细节。
- 所有管理配置接口启用 RBAC、二次确认和审计。
- 金额和计数使用溢出安全整数；所有输入设置长度、数量和字符集上限。
- CORS、CSRF 和 rate limit 按现有移动 API 规范实施。

## 7. 测试（必须提交可运行测试，不接受测试清单代替）

### 单元/契约测试

- GET 快照字段和空值与本文 JSON 完全兼容。
- 签到累计 7 天、漏签不清零、同日重复、完成后重复、资格截止。
- 餐点 `[start,end)` 边界、业务时区、夏令时、重复领取和配置切换。
- 配置发布校验：10 倍档位、正好四项、min payout 等于 cost、ppm 总和、溢出和末档终止；必须拒绝任何回环或指向低序号档位的配置。
- RNG 注入固定样本 `0`、每个累计边界前后、`999999`，验证半开区间无空洞无重叠。
- 联系人哈希向量与 iOS 一致：`sha256(salt + NUL + e164)`；去重、上限、过期、错盐版本和零匹配。
- 手机号 E.164、验证码过期/错误次数/频控/唯一性。
- 邀请 token/短码、自动与手动兑换、自邀、重复归因、复用手机号。
- 分享每日上限和跨业务日重置。

### 并发/事务测试

- 100 个相同签到幂等请求只产生一条领取和一笔流水，响应一致。
- 100 个相同抽奖幂等请求只产生一次 debit、一次 credit、一次 spin 和一次档位推进。
- 多个不同幂等键并发抽奖串行锁定进度，不透支、不跳档、不降档；最后一档完成后不可继续抽奖。
- 签到、餐点和邀请资格并发唯一约束无重复发奖。
- 在扣款、入账、写 spin、推进档位每个故障点注入异常，验证事务完全回滚。
- 账本前后余额和钱包子账户代数一致。

### 隐私/安全测试

- 捕获测试日志、APM payload、失败请求持久化和数据库快照，断言不存在联系人原始号码、姓名、验证码、完整邀请 token。
- hash session 过期清理；token hash 不可反查；管理配置未授权访问被拒绝。
- 手机号唯一性、频控、自邀、批量刷号、封禁用户均被拒绝。

## 8. 监控与告警

增加低基数指标：

- 各 endpoint 成功率、延迟和稳定错误码计数。
- 各任务 claim 成功/重复/拒绝计数，不把 user_id、token、手机号或 idempotency key 放 label。
- 转盘按 config_version/tier 的 spin 数、总 cost、总 payout、实际中奖分布；偏离配置概率达到统计阈值报警。
- 幂等重放数、processing 超时数、钱包锁冲突、负余额保护触发数。
- 短信发送/验证成功率与频控拦截。
- 联系人 session 创建/匹配/过期和平均 hash 数（只记聚合数字）。
- 邀请 pending→qualified→rewarded 漏斗。
- 每日账本对账差异必须为 0，否则 P1 告警。

## 9. 发布与回滚

1. 先运行迁移和回填；新表为空时不得影响现有钱包。
2. 使用 feature flag 按内部账号、百分比逐步开放。
3. 先创建并校验 draft 配置，再激活；未激活时接口返回结构化 disabled，不发奖。
4. 发布前运行全量单元、契约、并发和迁移测试。
5. 回滚应用版本不能回滚或删除已产生流水；只关闭 feature flag/归档配置。
6. 保留配置、流水、spin 和审计记录；按隐私策略清理 session、临时 hash 和验证码。
7. 提供运维 runbook：配置误发、短信供应商故障、钱包对账异常、幂等 processing 卡死、概率异常的处置步骤。

## 10. 最终交付格式

完成后输出：

1. 实际修改/新增文件清单。
2. 迁移名称和向前/回滚策略。
3. 每个 endpoint 的实现位置与契约测试位置。
4. 钱包事务和锁的具体实现说明。
5. 配置校验器及一份**不含生产金额**的测试 fixture。
6. 执行过的测试命令和真实结果。
7. 安全/隐私检查结果。
8. 分阶段部署、监控和回滚步骤。
9. 所有尚未完成的依赖或风险；不得把核心逻辑留作 TODO。

验收标准是后端代码可直接部署到测试环境并与现有 iOS 契约联调，而不是仅生成接口文档。
