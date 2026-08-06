# 修复 H5 上一局同步死锁并移除游戏价格提示 Prompt

你是 BWChat 的资深后端与 H5 游戏工程师。请直接在现有后端和 H5 游戏代码库实施修复、测试、部署与缓存失效；不要只给分析方案。

## 一、已确认的线上问题

2026-08-02 18:05 的线上 `just-clear` H5 bundle 存在以下逻辑：

- 用 `just-clear.tournament-entry.v2` 在 `localStorage` 持久化上一局 `round_id`；
- 新开局前，如果本地仍有上一局，会先调用 leaderboard 的 `finishGame`；
- 如果恢复/结算失败，会提示 `The previous result is still syncing. Please try again shortly.` 并拒绝新开局；
- round resume 只有在少数业务码（例如 `GAME_ROUND_NOT_FOUND`、`GAME_ROUND_NOT_RESUMABLE`）下才清理本地旧局；
- round/session 已过期、已结算、旧 token 无法恢复、兼容层返回非预期 404/409/410、响应契约差异等终态没有统一收敛，导致旧 `round_id` 永久残留；
- proof outbox 即使已经为空，也可能被旧 `round_id` 永久阻塞；
- 当前 H5 开始按钮仍展示类似 `开始（10 金币）`，iOS 游戏列表此前也展示每局金币价格。

本次目标不是绕过成绩提交，也不是无条件清空用户数据，而是由服务端权威状态安全区分“可重试同步”和“已经终止的陈旧回合”。

### 1.1 部署后复测发现的第二个阻塞（必须一并修复）

上一局 reconcile 与新版 H5 已经生效：线上按钮现在只显示“开始游戏”，点击后也确实调用了 native round-start bridge。但 2026-08-02 22:58 的同一账号、同一环境实测得到以下互相矛盾的权威结果：

- `GET /api/v1/wallet/balance`：iOS 钱包显示 `gold_coin_balance = 191`；
- `POST /api/v1/games/just_clear/sessions`：新大厅会话返回 `entry_price_gold_coins = 10`；
- 紧接着 `POST /api/v1/games/just_clear/sessions/{session_id}/rounds`，请求体为 `{"payment_method":"gold_coins"}`：返回 HTTP 422、业务码 `INSUFFICIENT_GOLD_COINS`、消息“金币余额不足”；
- 该 422 没有返回 `required_amount`、`gold_coin_balance` 或 `spendable_balance` 上下文。

因此现在的开局失败不是余额真的不足，也不是 H5 缓存，而是 round-start 扣费事务与钱包查询/大厅定价的账户或数据源不一致。请沿同一个已认证 `user_id` 追踪并修复，重点排查：

1. round-start 是否误读 legacy `cat_coins`、活动猫粮、收益余额、可提现余额或已废弃 wallet 表；
2. lobby session 绑定的用户主体是否与 Bearer token 当前用户一致，是否错误使用匿名 H5 身份、session 创建者、缓存用户或字符串/整数 ID 的另一条钱包记录；
3. 钱包查询与扣费事务是否连接了不同数据库、schema、读副本或租户；
4. 扣费判断是否使用了错误价格、单位换算、冻结金额或 `NULL` 回退；
5. 是否先扣减/预占后又用扣减后的值重复判断，或失败重试留下未释放的 reservation；
6. 幂等记录是否错误复用了先前失败结果。

round-start 必须在一个主库事务中锁定与 `/wallet/balance` 相同的 canonical Gold Coin 钱包行，以大厅会话中冻结的权威价格判断和扣款。对于余额 191、价格 10 的场景，必须成功创建 round 并将余额原子变为 181；不得为了通过测试而免费开局或绕过余额校验。

`INSUFFICIENT_GOLD_COINS` 响应必须附带非敏感诊断上下文：

```json
{
  "code": "INSUFFICIENT_GOLD_COINS",
  "message": "金币余额不足",
  "data": {
    "required_amount": 10,
    "gold_coin_balance": 9,
    "spendable_balance": 9
  }
}
```

注意：游戏仍只能扣 Gold Coins，不能改成猫粮或混合余额；这里修的是同一 Gold Coin 余额口径不一致。

### 1.2 第二次后端部署后的最新阻塞：round-start 现在返回 500

2026-08-02 23:29 在同一 iOS Debug 客户端重新创建全新的大厅会话并复测，结果已经从原来的 422 发生变化：

- Bearer 鉴权存在且 `/api/v1/wallet/balance` 请求成功，界面权威余额仍为 191；
- `POST /api/v1/games/just_clear/sessions` 成功，仍返回 `entry_price_gold_coins = 10`；
- H5 正常发出 `round_start_payment_requested`；
- 随后的 `POST /api/v1/games/just_clear/sessions/{session_id}/rounds` 返回 HTTP 500；
- 响应业务码为 `internal_server_error`，消息为“服务器内部错误”，没有余额诊断上下文；
- 本次可用于关联服务端日志的 `request_id` 为 `f03a07517649c70e9dba44a7f2c7f3f4`；
- 客户端随后重新拉取钱包，余额仍为 191，说明本次没有成功创建 round，也没有完成扣款。

这证明上一版“错误判定金币不足”的逻辑至少已经进入了新的执行分支，但新部署的 round-start 扣费事务在服务端内部抛出了未处理异常。不要继续修改 iOS/H5，也不要把 500 转成成功；请立即用上述 `request_id` 在反向代理、API worker 和数据库日志中定位原始 traceback，并检查当前实际运行的部署版本、实例和数据库迁移版本。

重点排查新改动中的：

1. canonical Gold Coin 钱包表名、列名或 ORM model 与生产库 migration 不一致；
2. 用户 ID、余额 Decimal/Integer、价格或 `NULL` 值发生类型转换异常；
3. 新增的 `SELECT ... FOR UPDATE`、扣减 SQL、外键、CHECK/NOT NULL 约束或返回行数断言失败；
4. round、wallet ledger、reservation、idempotency 记录之间的唯一键或外键冲突；
5. 幂等记录仍保存先前 422 的失败结果，新实现读取/反序列化旧记录时崩溃；
6. 事务已回滚但响应 DTO 仍强制读取不存在的 ledger/round/wallet 字段；
7. 只有部分 API 实例或 worker 已部署新代码，或代码已部署但 migration 未执行；
8. 数据库 deadlock、serialization failure 或连接主库失败没有被转换为可重试业务错误。

修复时必须保留原子性：锁定 canonical wallet、校验余额、写 wallet ledger、扣减余额、创建 round 和写入幂等成功结果必须在同一事务提交；任一步失败都必须完整回滚，不能只扣金币却没有 round。服务端日志需要输出脱敏后的 `request_id`、部署 revision、异常类型和事务阶段，但不能输出 Bearer token、完整 session ID 或用户隐私数据。

在部署前先用生产同 schema 的数据库执行集成测试；部署后必须用全新的 session 和 idempotency key 验证：余额 191、价格 10 时 round-start 返回 2xx、创建可用 round、钱包变为 181；同一 key 重放返回同一个 round 且余额仍为 181。只要 round-start 仍返回 500，就不得宣称修复完成。

### 1.3 第三次复测：已扣 10 金币，但 round-start 被 409 冲突阻塞

2026-08-02 23:58 的最新客户端失败日志显示，问题再次发生了变化：

- 点击开始时 H5 正常记录 `round_start_payment_requested`；
- round-start 接口连续返回 HTTP 409；
- native bridge 因此记录 `round_start_terminal status=failed error=native_payment_failed`，游戏没有进入；
- 当前权威钱包余额已经从此前的 191 变为 181，说明服务端曾经成功扣除 10 Gold Coins；
- 新大厅会话仍可正常创建，价格仍为 10，但客户端没有持有任何可继续的 round grant，只能显示“开始游戏”。

这是资金与游戏回合状态不一致的严重问题。根据现有证据，最可能是此前的 round-start 在扣款/提交事务后没有把成功响应交付给客户端，或者已经创建了 active round；后续新 session 的开局请求因此返回 `PREVIOUS_ROUND_ACTIVE`、幂等冲突或其他 409。此处是根据客户端日志作出的推断，必须以服务端 2026-08-02 23:58 左右的 round、wallet ledger、idempotency 和 API 失败日志确认具体业务码，不能只把 409 改成 200。

请直接完成以下修复和数据处置：

1. 查出这笔从 191 到 181 的 10 Gold Coins 流水，以及关联的 round、session、idempotency 记录和当前 round 状态；
2. 如果已经存在合法且可玩的 active round：不要再次扣款；为当前客户端恢复/换发有效的 round token，并以符合现有 `GameRoundStart` 契约的 2xx 成功响应交付该 round；
3. 如果 round 不存在、token 无法恢复、session 已失效或该 round 从未真正可玩：在同一修复事务中关闭孤儿 round/幂等记录并退回原 10 Gold Coins；随后允许用户重新开局；
4. 如果需要“退回旧扣款再创建新 round”，退款、重新扣款和创建 round 必须原子完成，最终余额只能是 181，不能变成 171，也不能免费开局；
5. 新 round 已提交成功但响应丢失时，同一 idempotency key 重放必须返回原 round 的 2xx 成功结果，不能返回 409；
6. 不同新 key 遇到同一用户仍可恢复的 active round 时，服务端必须返回可机读的恢复结果：优先直接幂等返回可用 grant；若保留 409，则必须返回稳定码 `PREVIOUS_ROUND_ACTIVE`、`previous_round_id`、权威 `session_id`、`resume_allowed=true` 和 `expires_at`，且客户端实际具备恢复路径；
7. 不允许出现“钱包已扣款，但 round-start 对客户端返回 4xx/5xx 且没有可恢复 round”的最终状态；
8. 对 2026-08-02 本轮部署窗口内所有同类孤儿扣款执行一次审计和安全修复，不要只手工修改当前测试账号。

部署后的强制验收：从当前余额 181 开始点击一次“开始游戏”，必须在不再扣第二笔 10 金币的情况下进入已付费 round，余额仍为 181；完成/关闭该局后再开全新一局，才允许从 181 正常扣至 171。接口不得再返回模糊 409，客户端不得再显示 `native_payment_failed`。

## 二、最终产品状态

1. 用户不得因为陈旧的本地 `round_id` 永久无法进入游戏。
2. 有真实未提交成绩且服务端仍接受结算时，必须保留并继续幂等重试，不得丢分。
3. 服务端已确认 round 不存在、不可恢复、已过期、已结算或已放弃时，H5 必须清理对应本地状态并允许重新开局。
4. 临时断网、超时和服务端 5xx 不能被误判为终态，也不能静默清除成绩。
5. iOS 游戏列表只显示游戏类型；H5 主按钮只显示“开始游戏”“继续”或“再来一局”，不展示 `10 金币`、币种图标或其他消费提示。
6. 隐藏价格提示不改变实际计费：round start 仍由服务端权威价格原子扣除 Gold Coins。
7. 不恢复游戏进入卡，不增加客户端价格参数，不允许 H5 自行扣币。

## 三、先做代码定位

全库搜索并列出命中位置：

- `The previous result is still syncing`
- `previous_round_active`
- `just-clear.tournament-entry.v2`
- `just-clear.pending-tournament-entry.v2`
- `just-clear.tournament-proof-outbox.v2`
- `finishGame`、`heartbeat`、`rounds/*/resume`
- `entryPriceGoldCoins`、`entry_price_gold_coins`
- `开始（`、`金币）`、`10 金币`

确认每个游戏是否复用同一套 round SDK；不能只修 `just-clear` 的一个编译产物而遗漏源码或其他游戏。

## 四、后端 round 生命周期修复

### 4.1 建立明确终态

round 至少区分：

- `active`：允许继续、心跳、proof event 和 finish；
- `settling`：结算处理中，同一 finish 请求可安全重放；
- `settled`：已完成，返回权威最终成绩和排行榜状态；
- `expired`：超过有效期且已不能提交；
- `abandoned`：服务端明确关闭、无最终成绩；

禁止仅依靠“数据库有一条 active 记录”判断上一局仍活动。所有读取和新开局事务都必须先根据 `expires_at` 收敛过期状态。

### 4.2 收敛 resume 契约

保留或实现：

```http
POST /api/v1/game-assets/{game_id}/rounds/{round_id}/resume
Content-Type: application/json

{}
```

响应必须稳定、可机读：

- 可恢复：HTTP 200，`code=0`，返回 `state=active`、同一个 `round_id`、`session_id`、新短期 `round_token` 和 `expires_at`；
- 已结算：HTTP 200，返回 `state=settled`、权威 final result，且不再返回可游戏 token；
- 已过期：HTTP 410，业务码 `GAME_ROUND_EXPIRED`，`terminal=true`；
- 已放弃：HTTP 410，业务码 `GAME_ROUND_ABANDONED`，`terminal=true`；
- 不存在或不属于当前用户：HTTP 404，业务码 `GAME_ROUND_NOT_FOUND`，不得泄露其他用户信息；
- session 已失效且 round 不可恢复：HTTP 410，业务码 `GAME_SESSION_EXPIRED`，`terminal=true`；
- 临时错误：5xx 或明确 `retryable=true`，不得标记 terminal。

如果现有安全策略不允许把“不属于用户”和“不存在”区分，二者统一返回 `GAME_ROUND_NOT_FOUND`。

### 4.3 finish 必须幂等且返回终态

现有 leaderboard `finishGame` 必须以 `(user_id, game_id, round_id)` 幂等：

- 第一次成功结算写入 final score、排行榜和钱包/奖励流水；
- 相同 `round_id + expected_revision + score` 重放返回第一次的权威结果，不重复计分或发奖；
- round 已经 settled 时返回 HTTP 200 和原 final result，不返回冲突；
- `expected_revision` 落后时返回当前权威 revision、是否仍可补交以及稳定业务码，不能只返回模糊 409；
- 已过期且不再接受成绩时返回 `GAME_ROUND_EXPIRED`、`terminal=true`；
- 无 round 或不可恢复返回稳定终态码；
- 网络超时后客户端重试不得产生第二次结算。

建议成功/终态响应包含：

```json
{
  "code": 0,
  "data": {
    "round_id": "uuid-v4",
    "state": "settled",
    "terminal": true,
    "accepted": true,
    "final_score": 495,
    "verified_revision": 104
  }
}
```

### 4.4 新 round 不得被幽灵 active 记录阻塞

`POST /games/{game_id}/sessions/{session_id}/rounds` 在同一事务中：

1. 锁定用户当前 round 指针；
2. 将超过 `expires_at` 的 active round 原子收敛为 `expired`；
3. 已 settled/expired/abandoned 的 round 不得触发 `previous_round_active`；
4. 只有仍在有效期、确实可恢复的 active round 才能返回 `PREVIOUS_ROUND_ACTIVE`；
5. 返回该错误时提供安全的 `previous_round_id`、`resume_allowed=true` 和 `expires_at`，让 H5 进入恢复流程；
6. 新 round 的扣币、grant 和幂等记录继续保持单事务，不能为解决死锁而重复扣币。

## 五、H5 恢复状态机

用一个显式状态管理开局：

`idle → reconcilingPrevious → requestingRound → started`，错误分为 `retryable` 和 `terminalReconciled`。不要再用多个独立布尔值和散落的 localStorage 判断。

新开局前按以下顺序执行：

1. 读取本地 `tournament-entry` 和 proof outbox。
2. 没有旧 round：直接调用 native `bwchat.game.request_round_start`。
3. 有旧 round：先调用 resume/status reconcile。
4. `active`：恢复 token；如果本地是 game-over，则排空 proof outbox 后幂等 finish；如果仍有可继续的游戏状态，则恢复该局。
5. `settled`：保存服务端 final result，清理该 round 的 entry、pending entry、proof outbox 和内存引用，再发起新 round。
6. `terminal=true` 的 not-found/expired/abandoned/session-expired/not-resumable：只清理这个 round 的本地数据，然后允许新 round。
7. 401 且 token 可刷新：只刷新一次后重试 reconcile；仍失败则显示登录/会话错误，不死循环。
8. 408、429、网络离线、5xx：保留本地数据，使用指数退避重试；同时提供可操作的“重试同步”按钮。
9. 不得因为响应 JSON 多一个字段或价格字段缺失而把可识别终态当作未知永久错误。
10. 所有清理操作必须比较当前 `round_id`，禁止旧异步回调清掉刚创建的新 round。

对于旧版 localStorage：增加一次性版本迁移。迁移不能按时间无条件删记录；必须先向服务端 reconcile。只有服务端确认终态后才删除。

## 六、移除价格提示

H5 所有入口统一修改：

- 标题页按钮：`开始游戏`，pending 时 `正在进入…`；
- 结果页按钮：`再来一局`，pending 时 `正在进入…`；
- 设置页 replay 确认、规则弹窗、排行榜说明、toast 和无障碍 label 均不得展示每局 Gold Coins 数量；
- 删除 `开始（${entryPriceGoldCoins} 金币）`、价格图标和默认 `10` 的展示回退；
- `entry_price_gold_coins` 可以继续作为服务端计费响应和客户端契约校验字段，但不得参与按钮/卡片/规则文案渲染；
- 不要通过 CSS 隐藏后保留可访问性文本，必须从渲染逻辑和 aria 文案中移除。

iOS 已同步删除游戏列表外层的价格 badge，不需要修改 round-start bridge 的安全校验。

## 七、缓存与发布

H5 代码发布后必须：

- 生成带新 content hash 的 JS/CSS 文件，禁止覆盖同名长缓存资源；
- HTML 使用 `no-cache` 或短缓存并指向新 hash；
- 失效 CDN、反向代理和服务端静态资源缓存；
- 确认 WKWebView 冷启动与已有缓存用户都获取新 bundle；
- 记录 H5 build/version，便于确认线上不再运行含旧 toast 逻辑的 bundle。

发布顺序：先部署后端幂等/终态契约，再发布 H5 状态机和价格文案，最后观察旧 H5 兼容指标。

## 八、测试与验收

自动化测试至少覆盖：

- active round 正常 resume；
- settled、expired、abandoned、not-found、session-expired 均能清理旧本地状态并进入新局；
- finish 超时后重放只结算一次；
- proof outbox 为空但旧 round 已终止时不会永久阻塞；
- proof outbox 非空且服务端仍接受时会先提交，不丢分；
- 断网和 5xx 保留本地状态，恢复网络后可继续同步；
- 陈旧异步回调不能清除新 round；
- 后端幽灵 active 记录过期后不会返回 `previous_round_active`；
- 重复点击只产生一次 native round-start 和一次扣币；
- H5 源码、构建产物、规则弹窗、按钮和 aria 文案均不含 `10 金币` 或动态开局价格；
- iOS 游戏列表不显示价格，但 round 仍按服务端权威价格正确扣费。
- canonical Gold Coin 余额为 191、会话价格为 10 时，round-start 成功且余额变为 181；
- 余额为 9、价格为 10 时才返回 `INSUFFICIENT_GOLD_COINS`，并包含 `required_amount=10`、`gold_coin_balance=9`；
- `/wallet/balance`、leaderboard `goldCoinBalance`、lobby price 和 round-start 扣费在同一用户/主库事务下口径一致；
- 相同 idempotency key 重放成功请求不会再次扣款，重放失败请求在余额或 reservation 已修复后遵循明确的幂等策略。

验收场景：保留一条历史 `just-clear.tournament-entry.v2`，让对应 round 分别处于 settled、expired 和 not-found；重新打开游戏后都应在一次 reconcile 内自动解除阻塞，点击“开始游戏”能够进入新局，不能再出现无限期的 `The previous result is still syncing`。

## 九、最终交付输出

完成后输出：

- 根因与命中的旧逻辑位置；
- 后端 API/状态机差异；
- H5 localStorage 迁移与清理条件；
- 改动文件和测试结果；
- CDN/静态资源失效结果与新 build hash；
- 指标：`previous_round_reconcile_total{result}`、`stale_round_cleared_total{reason}`、`finish_game_idempotency_replay_total`、`round_start_blocked_total{reason}`；
- round-start 钱包证据：同一用户的 canonical wallet 表/字段、会话冻结价格、扣费前后余额及失败响应上下文（不得输出令牌或完整 session ID）；
- 回滚步骤和所有未完成项。

不得通过无条件删除全部 localStorage、忽略未提交成绩、关闭幂等校验或允许重复扣币来“修复”问题。
