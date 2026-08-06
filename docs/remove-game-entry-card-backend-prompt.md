# 全面下线“游戏进入卡”后端与 H5 实施 Prompt

你是 BWChat 的资深后端与 H5 游戏工程师。请直接在现有代码库中实施“全面下线游戏进入卡”，完成代码、数据迁移、自动化测试、部署与回滚说明；不要只输出设计方案。

## 一、目标状态

1. `game_entry_card`、`prop_game_entry_card`、`consume_for_game_entry` 不再是可售卖、可赠送、可发放、可查询或可消费的线上能力。
2. 点击游戏中心卡片只创建免费 lobby session，不扣费。
3. 用户在 H5 游戏中主动点击“开始游戏”或“再来一局”时，H5 只发起一次 native round-start bridge 请求。
4. 每局只允许使用 Gold Coins；不再展示或接受支付方式选择。
5. 游戏价格始终由服务端游戏目录/计价配置决定，客户端和 H5 都不能提交或覆盖价格。
6. 扣币、round grant、幂等记录和审计流水在同一事务中完成；失败不能扣币，重复请求不能重复扣币。
7. 图片/视频解锁卡、直播体验卡及其他道具完全不受影响。

## 二、实施前检查

先全库检索以下标识，并给出命中文件与用途清单：

- `game_entry_card`
- `prop_game_entry_card`
- `consume_for_game_entry`
- `prop_card`
- 游戏道具定义、商城/礼物目录、活动奖励、运营后台发放、背包聚合、游戏 round 支付、审计、缓存和定时任务

注意：`prop_card` 仍可能被媒体解锁卡和直播体验卡使用，禁止全局删除；只移除游戏 round 与 `game_entry_card` 的关联。

## 三、服务端改造

### 3.1 停止新增与曝光

- 将 `game_entry_card` 标记为 retired/inactive，所有环境均不可重新启用。
- 从商城、礼物、活动奖励、签到、任务、兑换码、运营后台快捷发放、随机掉落和默认种子数据中移除。
- 清理会把它重新写回数据库的 seed/upsert/同步任务。
- 从公开道具定义接口、远程配置和缓存快照中移除，并主动失效 CDN/Redis/本地目录缓存。
- 运营后台历史记录允许只读查询，但新发放、撤销后再发放、复制活动等写操作必须拒绝，返回稳定错误 `PROP_DEFINITION_RETIRED`。

### 3.2 道具包契约

`GET /me/prop-bag` 及所有分页、筛选和 summary 聚合必须排除 `definition_id = game_entry_card`：

- `items` 不返回该定义；
- `total_quantity`、`equipped_count`、`expiring_count` 不得统计该定义；
- cursor 必须基于过滤后的可见集合稳定分页，不能出现空页死循环；
- 旧缓存中即使含有该道具，也必须在响应边界再次过滤。

不要改变其他道具的字段、排序、数量或 `available_actions`。

### 3.3 Lobby session 保持免费

保留：

```http
POST /games/{game_id}/sessions
Idempotency-Key: <uuid-v4>
Content-Type: application/json

{"purpose":"lobby"}
```

要求：

- 只做鉴权、游戏可用性校验和短期 launch ticket/session 创建；
- 不扣金币、不消费任何道具、不创建付费流水；
- 返回服务端权威的 `entry_price_gold_coins`，仅用于计费契约校验和回合审计；iOS 列表与 H5 按钮均不得展示该价格；
- 响应不得包含已生效的 `payment_method`、`wallet_balance` 或 `consumed_prop`。

### 3.4 Round start 只允许金币

保留并收敛：

```http
POST /games/{game_id}/sessions/{session_id}/rounds
Authorization: Bearer <token>
Idempotency-Key: <uuid-v4>
Content-Type: application/json

{"payment_method":"gold_coins"}
```

兼容规则：

- 当前 iOS 会显式发送 `payment_method=gold_coins`；服务端仅接受该值。
- 如需兼容已约定的旧 H5/客户端空 body，可在受控版本窗口内把“缺省值”解释为 `gold_coins`，记录兼容指标；不要永久保留多支付方式分支。
- 收到 `payment_method=prop_card` 或 `prop_definition_id=game_entry_card` 时，不得消费库存；返回 HTTP 409、业务码 `GAME_ENTRY_CARD_RETIRED`。
- 收到其他支付方式返回 `PAYMENT_METHOD_UNSUPPORTED`。
- 客户端提交的价格字段一律拒绝或忽略并记录安全日志，实际金额只读取服务端游戏配置快照。

事务内按以下顺序执行：

1. 校验 Bearer 用户、game、session 归属、session 有效期、round trigger 和限流。
2. 用 `(user_id, game_id, session_id, idempotency_key)` 查幂等记录；相同请求返回原结果，不重复扣费；payload 冲突返回 `IDEMPOTENCY_CONFLICT`。
3. 锁定用户 Gold Coins 钱包和计价配置快照。
4. 校验余额；不足返回 `INSUFFICIENT_GOLD_COINS`，且不得写扣款或 round grant。
5. 原子扣除权威价格，写不可变钱包流水，reason 使用稳定值 `game_round_start`。
6. 创建一次性 `round_id`、短期 `round_token` 和过期时间，并绑定 user/game/session/price。
7. 写审计记录并提交事务。

成功响应：

```json
{
  "code": 0,
  "data": {
    "round_id": "opaque-id",
    "round_token": "opaque-secret",
    "expires_at": "2026-08-02T12:05:00Z",
    "payment_method": "gold_coins",
    "entry_price_gold_coins": 25,
    "wallet_balance": {
      "gold_coin_balance": 75,
      "spendable_balance": 75
    },
    "consumed_prop": null
  }
}
```

`round_token`、launch ticket、Authorization 和完整钱包对象禁止进入普通日志、APM breadcrumb、错误消息或分析事件。

## 四、存量卡处理与补偿

必须提供 dry-run 和 execute 两种模式的一次性幂等迁移任务，不能直接删除库存而不留账。

1. 迁移参数 `GAME_ENTRY_CARD_RETIREMENT_COMPENSATION_GOLD_COINS_PER_CARD` 必须由产品明确配置为正整数；代码和迁移脚本禁止猜测兑换比例。
2. dry-run 输出：受影响用户数、有效卡总数、过期卡总数、预计补偿 Gold Coins 总量和异常库存样本，不输出敏感个人信息。
3. execute 对每个用户锁定库存与钱包，读取所有有效且数量大于 0 的 `game_entry_card`，按 `有效数量 × 补偿单价` 计入现有“可消费、不可提现”的 Gold Coins 余额桶。
4. 禁止把补偿计入可提现礼物收入；如果现有钱包没有可消费且不可提现的余额能力，停止 execute 并把它作为明确阻塞项报告，不能新建平行钱包。
5. 将旧库存置为 retired/zero 或写等价的不可消费终态，保留历史事件；写钱包流水 reason `game_entry_card_retirement_compensation`。
6. 以 `(campaign_id, user_id, definition_id)` 建唯一约束，重复执行必须返回原结果，不可重复补偿。
7. 单用户事务失败可安全重试；输出成功、跳过、失败计数和可重试清单。
8. 为客服/运营提供只读对账查询：原数量、补偿比例、补偿金额、迁移时间、流水 ID、request ID。

## 五、H5 游戏改造

- 删除金币/游戏进入卡选择器、卡数量查询、卡片图标、卡支付埋点和卡错误文案。
- “开始游戏/再来一局”按钮只显示“开始游戏”或“再来一局”，不得拼接 Gold Coins 数量、币种图标或任何消费提示；这只隐藏价格提示，不改变服务端权威扣费和账本规则。
- 用户点击后立即禁用按钮并只发送一次既有 `bwchat.game.request_round_start` bridge 消息；等待 native callback 后才进入游戏。
- `started`：只使用 native 返回的 `round_id`/`round_token` 恢复或创建本局。
- `failed`：恢复按钮，并展示金币不足、请求过期、限流或游戏不可用；不得在 H5 自行扣币或生成 token。
- `cancelled` 只作为旧客户端兼容终态保留；新 iOS 不再显示支付选择框。
- 页面刷新、前后台切换、重复点击和 callback 重放都不能触发第二次扣币。

## 六、兼容、监控与发布顺序

发布顺序：

1. 先部署服务端：停止发放和曝光、背包过滤、round 仅金币、保留旧客户端稳定错误。
2. 执行 dry-run，对账并由产品确认补偿比例与总额。
3. 执行存量迁移，抽样核对库存与钱包流水。
4. 发布 H5 与 iOS；iOS 已不再查询游戏进入卡，也不再展示支付方式选择。
5. 观察一个完整旧版本兼容窗口后，移除空 body 兼容分支与仅供旧版使用的错误映射。

至少增加以下指标与告警：

- `game_round_start_total{result}`、`game_round_charge_gold_coins_total`
- `game_round_idempotency_replay_total`、`game_round_idempotency_conflict_total`
- `retired_game_entry_card_request_total{client_version}`
- `prop_bag_retired_item_filtered_total`
- 补偿迁移成功/失败用户数和金币总额对账
- “扣币成功但无 round grant”必须为 0，并设置高优先级告警

## 七、自动化测试与验收

必须覆盖：

- lobby session 永不扣费且返回正数权威价格；
- round body 为 `gold_coins` 时按服务端价格只扣一次；
- 空 body 兼容窗口行为（如启用）；
- `prop_card + game_entry_card` 被稳定拒绝且库存、钱包均不变；
- 余额不足、session 过期、游戏下线、限流、幂等重放和幂等冲突；
- 并发相同请求只产生一笔钱包流水和一个 round；
- `/me/prop-bag` items、summary、分页和缓存均不暴露退役道具；
- 其他媒体/直播道具仍可正常查询和消费；
- 存量迁移 dry-run、execute、重复 execute、单用户失败重试和总额对账；
- H5 重复点击、刷新、callback 重放、失败恢复按钮。

完成后再次全库检索退役标识。允许保留的位置仅限：

- 存量迁移/对账代码；
- 明确的旧客户端拒绝分支；
- 对应自动化测试和历史数据库迁移。

最终输出：改动文件、数据库迁移、API 契约差异、测试结果、补偿 dry-run 结果、发布顺序、监控面板、回滚步骤，以及所有未完成/阻塞项。不得声称已完成未执行的测试或迁移。
