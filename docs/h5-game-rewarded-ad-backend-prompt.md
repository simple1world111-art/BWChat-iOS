# BWChat 所有 H5 游戏通用激励广告奖励：后端实现 Prompt

> 已废弃：本文档的旧产品规则会让游戏广告同时发猫币和复活，不能再用于实现。当前规则是“钱包广告才发猫币，游戏广告只授予游戏效果”。请使用同目录的 `h5-game-revive-only-rewarded-ad-backend-prompt.md`。

以下内容可直接交给 BWChat 后端开发 Agent。目标是一次建设所有后端托管 H5 游戏共用的 session、Google SSV、grant 和 claim 基础设施；Just Clear 只是第一条配置与回归夹具。请完成实现、迁移、自动化测试和部署说明，不要返回 mock，也不要把客户端 `completed` 当成发奖凭证。

```text
请完整实现 BWChat 后端的“所有 H5 游戏通用激励广告确认奖励”能力，并让当前 Just Clear 的 `placement=revive` 作为第一条策略正常工作。实现必须复用现有 Google AdMob SSV 验签与钱包账本基础设施。

最终边界必须是：

- 新增普通 H5 游戏时不修改、不重新发布 iOS/Android。
- 不新增 WKScriptMessageHandler、移动端广告 Service 或游戏 ID 分支。
- 后端不为每个游戏复制 session controller、SSV callback、session/grant 表或验签器。
- 新游戏通过游戏目录、奖励策略配置和通用 H5 sender 接入；只有该游戏确实存在全新且无法由通用 entitlement 表达的服务端业务效果时，才允许增加业务 effect handler。
- Just Clear 只能作为配置数据和测试 fixture 出现，通用 session/SSV/claim 主流程中禁止 `if game_id == "just-clear"` 或 `switch source`。

一、先检查现状，保持已发布契约兼容

1. 先搜索并核对现有实现：
   - `POST /api/v1/games/{game_id}/sessions`
   - `/api/v1/game-assets/just-clear/` 中的 H5 代码
   - `/api/v1/wallet/ad-rewards/status`
   - `/api/v1/wallet/ad-rewards/sessions`
   - `/api/v1/wallet/ad-rewards/admob/ssv`
   - 钱包余额、猫币流水、动态配置和 feature flag
2. 如果 Just Clear 已存在广告 session/claim 路由，增加兼容适配层转入通用服务；不要把旧路由继续实现成独立业务主流程，也不要让已发布 H5 与客户端同时改协议。
3. 不要复制第二套 AdMob 验签器。钱包广告与 H5 游戏广告必须共用同一个可信 SSV 验签模块、公钥缓存、transaction_id 防重放和审计机制。
4. 当前 iOS 已实现统一原生桥，不需要后端要求客户端再发版，也不要为 Just Clear 创建原生专属消息类型。

二、必须理解的客户端边界

H5 调用 iOS/Android 原生广告桥时发送：

{
  "type": "bwchat.game.show_rewarded_ad",
  "version": 1,
  "source": "just_clear",
  "placement": "revive",
  "request_id": "UUID v4",
  "session_id": "后端生成的 26 位 ULID",
  "ad_unit_id": "后端选择的 rewarded ad unit",
  "ssv_user_id": "后端生成的非隐私标识",
  "ssv_custom_data": "后端生成的短期一次性 token",
  "reward_item": "cat_food",
  "reward_amount": 10
}

原生会在展示本次广告前设置：

- `ServerSideVerificationOptions.userIdentifier = ssv_user_id`
- `ServerSideVerificationOptions.customRewardText = ssv_custom_data`

原生最终只向 H5 回传：

{
  "request_id": "...",
  "session_id": "...",
  "status": "completed | dismissed | failed | unavailable",
  "error_code": "可选稳定错误码"
}

重要：

- `completed` 只表示 Google Mobile Ads SDK 触发了 earned-reward callback，不是可信发奖证明。
- H5、iOS、Android 都不能直接加猫币、执行复活或把 session 改成已领取。
- 只有后端收到并验签通过 Google AdMob SSV 后，奖励才能进入可领取/已入账状态。
- `source`、`placement`、`reward_item`、`reward_amount` 都不能作为授权依据，后端必须以 session 创建时保存的服务端配置为准。

三、通用奖励策略与 Just Clear 首条配置

建立服务端奖励策略配置，至少以 `game_id + placement + version` 唯一确定：

- `source_slug`
- `placement_slug`
- `enabled`
- `platform`
- `ad_unit_id`
- `reward_item`
- `reward_amount`
- `effect_type`
- `daily_limit_bucket`
- `session_ttl_seconds`
- `claim_ttl_seconds`
- `policy_version`

通用 session 创建时必须把命中的策略快照固化到 session，避免广告展示期间运营配置变化导致验签或发奖不一致。H5 提交的 source、placement、reward 文案都不能覆盖策略。

Just Clear 只插入第一条策略数据：

- `source_slug=just_clear`
- `placement_slug=revive`
- `reward_item=cat_food`
- `reward_amount=10`
- `effect_type=revive`
- `daily_limit_bucket=wallet_ad_reward`

通用规则：

1. 游戏效果权益绑定 `user_id + game_id + context_type + context_id + session_id`；Just Clear 的 context 是当前 `round_id`。
2. 同一业务上下文的同一奖励阶段只能消费一次；重复 claim 返回第一次结果。
3. 如果策略发放猫币，必须计入对应的服务端日限额 bucket；钱包入口与游戏入口使用同一 bucket 时不得分别计数。
4. `effect_type` 是服务端策略结果，不是 H5 的授权输入。通用 claim 返回 effect 数据，后端权威游戏状态需要通过通用 entitlement consumer 或受控 effect handler 更新。
5. 新游戏的 revive、continue、bonus、double_reward 等普通效果应优先表示为通用 entitlement，不得为了换一个游戏 slug 复制一套广告系统。

四、创建游戏广告 session

推荐统一路由：

POST /api/v1/games/{game_id}/ad-rewards/sessions

所有游戏使用同一个通用 controller；`game_id` 只是经过认证和校验的路由参数，不能对应不同 controller 或表。Just Clear 首个调用示例：

POST /api/v1/games/just-clear/ad-rewards/sessions

如果现有 game_id 使用下划线或数据库 ID，请沿用现有规范。也可以提供不带 game_id 的统一路由 `POST /api/v1/game-ad-rewards/sessions`，由游戏 Cookie 唯一确定 game；无论采用哪种 URL，都必须落入同一个 service 方法、数据模型和状态机。

该接口由 H5 调用，认证必须来自现有 HttpOnly 游戏会话 Cookie。不要要求 H5 读取 App JWT，也不要接受请求体中的 user_id。

请求：

{
  "placement": "revive",
  "round_id": "后端已知或可验证的本局 ID",
  "request_id": "UUID v4"
}

成功响应继续使用 BWChat 统一响应壳。以下是由 Just Clear 策略生成的首个 fixture；未来游戏返回自己的合法 source/placement/effect 配置，但字段结构不变：

{
  "code": 0,
  "message": "ok",
  "data": {
    "type": "bwchat.game.show_rewarded_ad",
    "version": 1,
    "source": "just_clear",
    "placement": "revive",
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "session_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "ad_unit_id": "ca-app-pub-1877504503518465/1011630693",
    "ssv_user_id": "opaque-game-user-id",
    "ssv_custom_data": "url-safe-one-time-token",
    "reward_item": "cat_food",
    "reward_amount": 10,
    "expires_at": "2026-07-31T14:30:00+09:00",
    "status": "pending"
  }
}

创建规则：

1. 验证游戏会话 Cookie 有效，并从服务端会话取得真实 `user_id` 和 `game_id`。
2. 验证 `round_id` 属于当前用户、当前游戏，且当前状态确实允许复活。
3. `request_id` 必须是 UUID v4；以 `(user_id, request_id)` 建唯一约束。相同请求重试应返回同一个仍有效 session。
4. `session_id` 必须是 26 位 ULID并全局唯一。
5. `ad_unit_id` 只能由后端配置选择，并且必须与 App 动态配置 `wallet.ad_reward.ios_ad_unit_ids` 中允许的生产广告单元一致。H5 不能提交或覆盖广告单元。
6. `ssv_user_id` 使用非邮箱、非手机号、非 JWT 的不透明标识；它只用于和 SSV 回调交叉校验，账号归属仍以数据库 session 为准。
7. `ssv_custom_data` 必须不可枚举、不可伪造、一次性且短期有效。推荐随机 256-bit URL-safe token，数据库只保存 token 哈希；token 绑定：
   `session_id + user_id + game_id + placement + round_id + ad_unit_id + expected_reward + expires_at`。
8. pending session 建议 30 分钟过期。创建 session 不发奖、不扣次数。
9. 同一用户、同一 round、同一 placement 同时只能存在一个可用 pending session；并发创建必须通过唯一约束或事务合并。
10. 功能关闭、日限额已满、局状态不允许复活、游戏会话过期、广告单元未配置时，返回稳定机器码，不要返回一个最终无法 claim 的假 session。

建议错误码：

- `GAME_AD_REWARD_DISABLED`
- `GAME_AD_REWARD_DAILY_LIMIT_REACHED`
- `GAME_AD_REWARD_ROUND_NOT_ELIGIBLE`
- `GAME_AD_REWARD_SESSION_CONFLICT`
- `GAME_AD_REWARD_AD_UNIT_UNAVAILABLE`
- `GAME_SESSION_EXPIRED`

五、统一 Google AdMob SSV 回调

AdMob 控制台的服务器端验证回调 URL 配置为公开 HTTPS 地址：

GET https://<正式域名>/api/v1/wallet/ad-rewards/admob/ssv

不要配置 `http://52.193.78.191/...`。Google 回调必须使用具有有效证书的公网 HTTPS 域名。

该接口不使用用户 Bearer Token，也不使用游戏 Cookie。必须保留原始 URL query 的编码和顺序，并按 Google 官方 SSV 规范处理：

- `ad_network`
- `ad_unit`
- `custom_data`
- `reward_amount`
- `reward_item`
- `timestamp`
- `transaction_id`
- `user_id`
- `signature`
- `key_id`

验签与处理要求：

1. 使用 `key_id` 对应的 Google AdMob 公钥执行 ECDSA SHA-256 验签。
2. 待验签内容必须直接取原始 query 中 `signature` 参数之前的字节，禁止重新排序、重新 URL 编码或用解析后的 map 重建。
3. Google 公钥允许缓存，但不得超过 24 小时；找不到 `key_id` 时立即刷新一次后重试，支持密钥轮换。
4. `custom_data` percent decode 后查找 token 哈希对应的 session；禁止只解 JWT 后直接发奖而不查 session 状态。
5. 校验 session 未过期、状态可处理、账号一致、广告单元一致、游戏/placement/round 一致。
6. `user_id` 只用于和 session 保存的 `ssv_user_id` 交叉校验，不得用它直接决定领取账号。
7. 校验回调中的 `ad_unit`、`reward_item`、`reward_amount` 与服务端 session 记录及 AdMob 后台配置一致。不要相信 H5 payload。
8. 对 `timestamp` 设置合理防重放窗口；已验签但因 Google 重试延迟到达的合法回调，应有明确兼容策略。
9. `transaction_id` 建全局唯一索引。相同回调重复 100 次只能产生一份 reward grant、一笔钱包流水和一个复活权益。
10. 合法回调或已处理的重复回调返回 HTTP 200；临时数据库/依赖故障返回 5xx 让 Google 重试；验签失败或字段篡改返回 400/403。
11. 日限额必须在 SSV 事务内再次检查并加锁，不能只在创建 session 时检查。并发到达第 10/11 个回调时最多一笔成功。

SSV 验证成功后的单个数据库事务至少完成：

1. 锁定广告 session，确认仍为 pending。
2. 写入唯一 `admob_transaction_id`、验证时间和原始回调的安全摘要。
3. 创建唯一 reward grant。
4. 若配置为 10 猫币：
   - 增加用户猫币余额；
   - 写入明确类型的 wallet transaction，例如 `game_ad_reward`；
   - 增加共享的账号级广告奖励当日计数。
5. 按 session 保存的策略创建一条通用、未消费的游戏效果 entitlement；Just Clear 首条策略生成绑定当前 `round_id` 的 revive entitlement。
6. 将 session 标记为 `verified/credited`。
7. 事务提交后再做缓存失效、事件通知和 WebSocket 推送。

任何一步失败都必须整体回滚，不能出现“猫币已加但复活权益没建”或“session 已完成但没有钱包流水”。

六、所有游戏共用的 H5 查询与 claim

推荐路由：

POST /api/v1/games/{game_id}/ad-rewards/sessions/{session_id}/claim

请求使用同一 HttpOnly 游戏会话 Cookie。请求体可以为空；如果携带 `round_id`，只能用于交叉校验，不能覆盖 session 绑定值。

统一响应示例。`game_effect` 来自 session 的服务端策略；以下仍以 Just Clear 首个 fixture 表示：

SSV 尚未到达：

{
  "code": 0,
  "message": "ok",
  "data": {
    "session_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "status": "pending",
    "retry_after_ms": 1000,
    "reward": null,
    "game_effect": null
  }
}

SSV 已验证且首次 claim：

{
  "code": 0,
  "message": "ok",
  "data": {
    "session_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "status": "claimed",
    "reward": {
      "item": "cat_food",
      "amount": 10,
      "wallet_transaction_id": "txn_..."
    },
    "game_effect": {
      "type": "revive",
      "round_id": "round_...",
      "granted": true,
      "consumed": true
    },
    "game_state": {
      "round_id": "round_...",
      "status": "active"
    }
  }
}

claim 规则：

1. `pending` 时不得复活、不得返回伪造成功；H5 按 `retry_after_ms` 轮询。
2. 只有 SSV 已验证、用户/游戏/round 匹配时才允许消费复活权益。
3. claim 必须使用数据库事务和行锁/CAS；第一次消费后记录 `claimed_at`。
4. 同一个 session 重复 claim 返回第一次的同一成功结果，不得再次修改余额、日计数或游戏状态。
5. 不同 session 试图复活同一个已复活阶段时，只有第一份可以成功，其余返回稳定的 `GAME_AD_REWARD_ALREADY_CONSUMED`，不得再次发业务权益。
6. SSV 即使晚于 H5 轮询窗口到达，也要保留已验证 grant；用户重新进入本局或恢复页面时可以查询最终状态。
7. `dismissed/failed/unavailable` 由 H5 解除 loading，不调用 claim；即使恶意 H5 强行调用，后端也只能根据真实 SSV 状态处理。

可同时提供只读接口，便于页面恢复：

GET /api/v1/games/{game_id}/ad-rewards/sessions/{session_id}

七、所有 H5 游戏共用的发送器与页面行为

请在后端托管资源中提供一个版本化通用模块，例如 `/api/v1/game-assets/_shared/bwchat-rewarded-ad-v1.js`。Just Clear 和以后所有游戏复用该模块完成 session 创建、原生 bridge 发送、终态监听、claim 轮询、超时恢复和重复点击保护；不得让每个游戏复制一份容易漂移的桥代码。

同步把 `/api/v1/game-assets/just-clear/` 改为首个接入 fixture：

1. 用户点击奖励入口后立即禁用按钮并显示明确 loading，防止连续点击创建多个 session。
2. 通用 sender 先调用后端创建广告 session，再把响应字段原样组装成固定原生桥 payload。
3. 同一次用户操作只生成一个 UUID v4 `request_id`，网络重试复用该 ID。
4. 收到 `bwchat:rewarded-ad-result`：
   - `completed`：开始轮询 claim；
   - `dismissed/failed/unavailable`：立即解除遮罩并显示可重试状态；
   - 任何分支都不能永久卡住按钮。
5. claim 返回 `pending` 时按服务端 `retry_after_ms` 退避；建议前台先等待 15～30 秒，超时后显示“奖励确认中”，并允许页面恢复后继续查同一 session。
6. 只有 claim 返回 `status=claimed` 且 `game_effect.granted=true` 时才能执行策略对应的效果；Just Clear 才是恢复当前局，未来游戏按自己的 effect 数据处理。
7. H5 不直接修改钱包余额；余额展示以后端响应或重新查询钱包为准。
8. 刷新、返回前台、WebView 恢复时，使用持久化的 session_id 查询最终状态，不能再创建一个 session 冒领奖励。

八、通用数据模型与唯一约束

`game_ad_reward_policies`

- `id`
- `game_id`
- `source_slug`
- `placement_slug`
- `platform`
- `enabled`
- `ad_unit_id`
- `reward_item / reward_amount`
- `effect_type`
- `daily_limit_bucket`
- `session_ttl_seconds / claim_ttl_seconds`
- `policy_version`
- `created_at / updated_at`
- 唯一约束 `(game_id, placement_slug, platform, policy_version)`

策略必须由受控后台或迁移写入，不能由普通 H5 动态创建。

请至少提供等价的数据结构：

`game_ad_reward_sessions`

- `session_id` ULID，全局唯一
- `request_id`
- `user_id`
- `game_id`
- `placement`
- `round_id`
- `context_type / context_id`（逐步替代游戏专属字段；Just Clear 可兼容映射 round_id）
- `policy_id / policy_version`
- `ad_unit_id`
- `ssv_user_id_hash` 或可安全比对值
- `ssv_custom_data_hash`，唯一
- `expected_reward_item`
- `expected_reward_amount`
- `status`: `pending | verified | credited | claimed | expired | rejected`
- `expires_at`
- `admob_transaction_id`，nullable，到账后全局唯一
- `created_at / verified_at / credited_at / claimed_at`
- 唯一约束 `(user_id, request_id)`
- 唯一约束 `(user_id, game_id, round_id, placement, active_status)` 或等价并发约束

`game_ad_reward_grants`

- `id`
- `session_id`，唯一
- `user_id`
- `game_id`
- `round_id`
- `context_type / context_id`
- `policy_id / policy_version`
- `placement`
- `admob_transaction_id`，全局唯一
- `reward_item / reward_amount`
- `wallet_transaction_id`，需要钱包奖励时唯一
- `game_effect_type`
- `game_effect_status`: `available | consumed`
- `created_at / consumed_at`

数据库约束必须是最后防线，不能只依赖 Redis 锁或应用层先查后写。

九、安全、日志和监控

1. 日志禁止记录完整 `ssv_custom_data`、JWT、Cookie、Google signature、完整 callback query、手机号或邮箱。
2. 可以记录 session/request/transaction 的不可逆短哈希、game_id、placement、状态、验签耗时和稳定错误码。
3. 指标至少包括：
   - session 创建成功/拒绝数量
   - 原生 completed 到 SSV 到达的延迟
   - SSV 验签成功率、失败原因、重复回调率
   - pending/verified/claimed/expired 数量
   - claim 等待时长和超时率
   - 每日猫币发放量、复活权益量、钱包对账差异
4. 告警覆盖验签失败率突增、未知 key_id、公钥刷新失败、SSV 5xx、重复钱包流水、grant 与账本不一致。

十、必须通过的测试

1. Just Clear 作为配置 fixture 完整观看：SSV 验签成功，10 猫币只入账一次，当前 round 只复活一次；通用服务代码中不存在 Just Clear 分支。
2. 原生返回 `completed` 但没有 SSV：claim 始终 pending/最终过期，不发猫币、不复活。
3. 伪造 H5 completed、直接调用 claim：不能获得奖励。
4. 篡改 `custom_data`、`user_id`、`ad_unit`、`reward_amount`、`reward_item`、`signature`：全部拒绝且不发奖。
5. 相同 Google `transaction_id` 重放 100 次：只有一份 grant、一笔钱包流水、一次日计数、一次复活权益。
6. 相同 request_id 并发创建 20 次：只产生一个可用 session。
7. 相同 session 并发 claim 20 次：只消费一次，其他请求返回同一结果。
8. 两个 session 并发复活同一个 round：最多一个成功。
9. 钱包入口和 Just Clear 入口合并计算日限额；已有 9 次时两个并发合法 SSV 只能一笔发猫币。
10. Google 公钥轮换、未知 key_id 刷新、公钥缓存超过 24 小时、数据库临时失败后重试均可恢复且不重复发奖。
11. H5 快速连点按钮不会叠加 session、广告或遮罩。
12. SSV 延迟、App 前后台切换、WebView 恢复、断网重连后仍能查询同一 session 并得到唯一最终结果。
13. 使用第二个未来游戏 fixture（例如 `source=future_game_fixture`、`placement=bonus`）时，只新增目录与策略数据，就能复用相同 session/SSV/grant/claim 基础设施，不新增移动端或通用服务分支。
14. 再加入第三个 fixture（例如 `source=unknown_game_2`、`placement=continue_stage`），证明不新增 controller、表、SSV URL、验签器或 App 代码仍能工作。
15. 静态检查或测试明确禁止通用服务出现 `just_clear`、`future_game_fixture` 等具体 source 的 if/switch。

十一、以后新增游戏的接入边界

新增普通 H5 游戏只允许做：

1. 在游戏目录注册 game/source。
2. 写入一条或多条 `game_ad_reward_policies`。
3. 引入通用 H5 rewarded-ad sender。
4. 为游戏创建经过服务端验证的业务 context。
5. 若通用 entitlement 已能表达效果，直接消费通用 claim 结果。
6. 只有全新的权威服务端业务效果无法由现有 entitlement 表达时，增加一个独立、可测试的 effect handler；不得修改 SSV、session、grant、claim 主状态机。

新增普通游戏严禁要求：

- iOS/Android 增加 game_id/source/placement 分支或重新发版
- 新增消息 type、WebView handler 或广告 Service
- 新增游戏专属 SSV callback
- 复制 session/grant 表或 AdMob 公钥缓存
- 让客户端决定奖励数量、账号归属或 claim 成功
- 仅因 source/placement 新增一个 controller switch case

十二、AdMob 控制台和上线交付

1. 在使用的生产 rewarded ad unit 中启用服务器端验证。
2. 回调 URL 使用正式 HTTPS 域名：
   `https://<正式域名>/api/v1/wallet/ad-rewards/admob/ssv`
3. 使用 AdMob 控制台测试工具发送真实测试回调，保存脱敏后的验签成功日志。
4. 确认 AdMob 广告单元中配置的 reward item/amount 与服务端配置一致。
5. 先上线数据库迁移、SSV 验签、session/claim 和 H5 恢复逻辑，再灰度开启游戏广告奖励。
6. 回滚开关只能阻止新 session；已经收到合法 SSV 的 session 必须按既定策略完成或可恢复，不能造成账本悬挂。

交付时必须附上：

- 数据库迁移
- session/status/claim API 实现
- 统一 AdMob SSV 验签模块及复用说明
- 通用 H5 sender 及 Just Clear 首个接入修改
- 新增未来游戏仅需目录与策略配置的演示
- 自动化与并发测试
- AdMob 控制台配置步骤
- HTTPS 域名与证书确认
- 灰度、监控、对账和回滚方案
- 一次真实 AdMob 测试 SSV 的脱敏证据

Google 官方规范以以下页面为准：

- https://developers.google.com/admob/ios/ssv
- https://developers.google.com/admob/ios/rewarded
```
