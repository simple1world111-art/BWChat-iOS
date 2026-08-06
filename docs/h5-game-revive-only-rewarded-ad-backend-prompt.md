# H5 游戏激励广告只复活、不发猫币：后端调整 Prompt

请直接检查并修改 BWChat 后端仓库，把“钱包看广告领猫币”和“H5 游戏看广告获得游戏效果”彻底拆成两种服务端业务用途。不要只给分析、伪代码或 mock；请完成数据库迁移、接口/SSV/claim 实现、自动化测试、部署与回滚说明。

## 一、不可改变的产品规则

1. 只有从 BWChat 钱包入口创建的激励广告会话可以增加猫币。
2. Just Clear 以及以后所有后端托管 H5 游戏中的激励广告，只能授予对应的游戏效果；Just Clear 当前效果是复活本局。
3. 游戏广告在任何阶段都不得：
   - 增加猫币余额；
   - 写猫币收入流水；
   - 增加钱包广告领取次数；
   - 返回一个会让 H5 误以为猫币到账的 reward 对象。
4. 不修改已上线的 iOS H5 bridge v1 消息结构。为了兼容旧 H5，游戏消息里即使仍有：

```json
{
  "reward_item": "cat_food",
  "reward_amount": 10
}
```

这两个字段也只能作为旧协议的兼容字段，不能决定钱包记账。不要要求先发布新版 iOS 才能完成本次修复。
5. Google Mobile Ads SDK 的客户端 `earned`/`completed` 只表示广告观看完成，不是可信的发奖或复活凭证。游戏只能在 Google SSV 验签成功且后端 claim 成功后复活。
6. 钱包广告现有的发猫币行为、日限额、余额流水和接口兼容性必须保留。

## 二、先审计并报告当前误发路径

请先搜索并画出当前真实调用链，至少覆盖：

- 钱包广告 session 创建接口；
- H5 游戏广告 session 创建接口；
- `GET /api/v1/wallet/ad-rewards/admob/ssv`；
- SSV token/custom_data 到 session 的解析或查询；
- reward grant、钱包余额、钱包流水和每日次数；
- 游戏 status/claim 接口；
- Just Clear 托管 H5 的 session、原生回调和 claim 逻辑。

明确指出游戏广告目前在哪个函数、事务或事件消费者中进入了猫币记账，并修复根因。不要只在 H5 隐藏“+10 猫币”文案；数据库余额必须保持不变。

## 三、用服务端权威字段区分业务用途

在广告 session 上增加或规范化一个不可由 H5/客户端覆盖的权威字段：

```text
reward_purpose:
  wallet_cat_food
  game_effect
```

游戏 session 还必须保存服务端策略快照：

```text
game_id
placement
context_type
context_id
effect_type
policy_id
policy_version
```

当前 Just Clear 的服务端策略为：

```text
reward_purpose = game_effect
game_id = just-clear            # 沿用仓库现有 ID/slug 规范
placement = revive
context_type = round
context_id = 当前服务端可验证的 round_id
effect_type = revive
```

规则：

1. `reward_purpose` 只能由命中的服务端 endpoint/策略写入。不得接受请求体、H5 bridge、Google 回调中的值来覆盖。
2. 钱包 session 创建服务只能创建 `wallet_cat_food`。
3. 通用 H5 游戏 session 创建服务只能创建 `game_effect`。
4. `source`、`placement`、`reward_item`、`reward_amount`、Google SSV 的 `reward_item/reward_amount` 均不能把 `game_effect` 升级为 `wallet_cat_food`。
5. 如果旧数据没有 `reward_purpose`：
   - 能根据 session 创建入口、关联的 game_id/round_id 或现有类型可靠识别为游戏广告的，迁移为 `game_effect`；
   - 能可靠识别为钱包入口的，迁移为 `wallet_cat_food`；
   - 无法可靠识别的 pending session 不得默认发猫币，应标记为需审计/拒绝，并允许用户重新创建会话。
6. 不要仅用 `placement == "revive"` 判断是否发猫币；用途必须是 session 创建时固化的权威字段。

如果当前钱包与游戏 session 分表，也必须提供等价的显式 session 类型，并让统一 SSV resolver 在找到 token 后先确定 session 类型，再进入对应业务处理器。

## 四、SSV 验签共享，验签后的业务处理必须分流

继续复用一套 Google AdMob SSV 安全基础设施：

- 原始 query 字节验签；
- Google 公钥缓存与轮换；
- ECDSA SHA-256；
- `transaction_id` 全局防重放；
- token 哈希查找；
- 用户、广告单元、有效期和 session 状态交叉校验；
- 安全日志和审计摘要。

验签成功后，必须按数据库中的 `reward_purpose` 分流：

### `wallet_cat_food`

保持现有钱包行为，在单一数据库事务内：

1. 锁定钱包广告 session；
2. 写唯一 Google `transaction_id`；
3. 创建唯一钱包 reward grant；
4. 按服务端钱包配置增加整数猫币；
5. 写唯一 wallet transaction；
6. 原子增加账号当日钱包广告成功次数；
7. 将 session 标记为 credited。

### `game_effect`

在单一数据库事务内：

1. 锁定游戏广告 session；
2. 写唯一 Google `transaction_id` 和 verified_at；
3. 创建一条绑定 `user_id + game_id + context_type + context_id + effect_type + session_id` 的游戏 entitlement；
4. 将 session 标记为 verified/claimable；
5. 猫币余额增量必须严格为 0；
6. 不得创建 wallet transaction；
7. 不得创建钱包 reward grant；
8. 不得增加钱包广告领取次数。

不要让两个分支先执行一个“通用发猫币 grant”，再由游戏分支补发复活。通用层只负责“SSV 已可信验证”的事实；钱包记账和游戏 entitlement 是互斥的业务处理器。

建议增加数据库防线，而不只依赖 `if`：

- Google `transaction_id` 全局唯一；
- 每个 session 最多一个 SSV verification/grant；
- 游戏 entitlement 对业务上下文和效果有唯一约束；
- wallet ledger/grant 必须关联 `reward_purpose=wallet_cat_food` 的 session，可用外键、约束、触发器或事务内强校验实现；
- 游戏 session 的 wallet_transaction_id 必须始终为 null。

## 五、H5 游戏 claim 只能消费游戏效果

保持或提供通用接口：

```http
POST /api/v1/games/{game_id}/ad-rewards/sessions/{session_id}/claim
```

要求：

1. 使用现有 HttpOnly 游戏会话 Cookie 认证，从服务端取得真实 user_id/game_id；不接受请求体提交 user_id。
2. session 必须是 `reward_purpose=game_effect`，且 user/game/context 匹配。
3. SSV 未到达时返回 pending，不复活、不发猫币。
4. SSV 已验证后，claim 在事务/行锁/CAS 中仅消费一次 entitlement，并执行或授权对应游戏效果。
5. Just Clear 只有 claim 成功后才能把当前 round 恢复为可继续状态。
6. 同 session 重复 claim 返回第一次的同一成功结果，不重复复活。
7. 不同 session 并发复活同一 round 的同一阶段，最多一个成功。
8. 钱包 session 不能调用游戏 claim；游戏 session 不能调用钱包 status/credit 路径完成发粮。

推荐游戏 claim 响应：

SSV 尚未到达：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "session_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "status": "pending",
    "retry_after_ms": 1000,
    "game_effect": null
  }
}
```

首次或幂等重复 claim 成功：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "session_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "status": "claimed",
    "game_effect": {
      "type": "revive",
      "context_type": "round",
      "context_id": "round_...",
      "granted": true,
      "consumed": true
    },
    "game_state": {
      "round_id": "round_...",
      "status": "active"
    }
  }
}
```

游戏响应中不要返回下面这些字段：

```json
{
  "reward": {
    "item": "cat_food",
    "amount": 10,
    "wallet_transaction_id": "..."
  }
}
```

若为兼容已发布 H5 必须暂时保留 `reward` 字段，则游戏 claim 中固定返回 `reward: null`，并尽快让共享 H5 sender 只读取 `game_effect`。

## 六、通用 H5 sender 行为

更新所有后端托管游戏共用的 rewarded-ad 模块，并让 Just Clear 使用它：

1. 创建 `game_effect` session；
2. 把服务端响应原样交给 `window.webkit.messageHandlers.bwchatGameBridge`；
3. 收到原生 `completed` 后轮询后端 claim；
4. 只有 `status=claimed` 且 `game_effect.granted=true` 才执行复活/继续等游戏效果；
5. 不修改或猜测钱包余额；
6. 不展示“获得 10 猫币”等文案；
7. dismissed/failed/unavailable 立即解除 loading；
8. 刷新、前后台恢复、断网重连继续查询同一 session，不能创建新 session 冒领；
9. 新游戏只能通过策略和 entitlement 接入，通用服务中禁止 `if game_id == "just-clear"`。

为兼容当前 iOS，游戏 session 响应仍可保留合法的正整数 `reward_amount` 和非空 `reward_item`，但建议将其视为 bridge v1 占位元数据，并在 API 文档中明确：

```text
deprecated_for_business_authorization = true
wallet_credit_allowed = false
```

不要依靠把 `reward_amount` 改成 0 来表达“不发猫币”，因为当前 iOS bridge v1 会拒绝非正整数。

## 六-A、修复 Just Clear “新局仍显示复活机会已使用”

当前线上 Just Clear 包存在一条必须修复的旧局复用路径。现场缓存和本地持久化状态已观察到：

```text
当前 durable game:
status = game-over
reviveUsed = true
```

新棋盘构造器本身会设置：

```text
reviveUsed = false
```

但显式点击“再来一局/Play again”时，当前实现会在服务端同步缓存的 `entryId` 仍等于当前 `round_id` 时直接复用缓存的 authoritative state，逻辑等价于：

```ts
const nextState =
  cachedEntry !== null && cachedEntry.entryId === currentEntryId
    ? cachedEntry.state
    : createNewGameState(...)
```

如果该缓存来自上一局复活后的 verified state，它会带着 `reviveUsed=true` 被当成“新局”启动。随后无棋可走时，H5 在调用原生广告之前就根据 `state.reviveUsed` 显示“本局复活机会已使用”，所以这不是 iOS/AdMob 的次数判断。

请同时修复 H5 和服务端局生命周期，要求：

1. 明确拆分两个动作：
   - `resumeCurrentRound`：仅恢复同一个未结束 round 的 authoritative state，必须保留该 round 的 `reviveUsed`；
   - `startNewRound` / `playAgain`：必须结束或结算旧 round，并创建全新的服务端 `round_id/entry_id`。
2. 用户显式点击“开始新游戏”“再来一局”时，禁止走 `cachedEntry.state` 恢复分支；必须创建全新的游戏状态，并强制：

```text
newRound.round_id != oldRound.round_id
newRound.reviveUsed = false
newRound.status = active
```

3. 只有页面重载、App 重启或前后台恢复时，且服务端确认该 round 仍为 active，才允许恢复同一 round；恢复不是“新局”。
4. 上一局已经 `game-over/finished/expired` 时，服务端不得把它继续作为 active entry 返回，也不得因为客户端携带旧 pending entry token 而复用旧 `entry_id`。
5. 若上一局 finish 请求仍在同步：
   - “再来一局”应等待旧局幂等结算完成后创建新局；
   - 不得把旧 authoritative state 当作新局；
   - 不得重复扣除新局入场猫币。
6. 新局创建、扣除入场猫币、生成新 `round_id` 和初始化 authoritative state 必须在同一事务/幂等操作中完成。客户端重试同一个 `start_request_id` 返回同一新局；新的用户操作必须使用新的 request id。
7. `reviveUsed` 必须按 round 隔离：
   - 同一 round 成功 claim 后永久为 true；
   - 新 round 初始化为 false；
   - 不得按 user、game_id、当天或旧 entry 全局继承；
   - 不得只在 React 内存中清零而保留服务端 authoritative state 为 true。
8. 新局启动后清理或隔离旧 round 的客户端引用：
   - `currentEntryId/currentRoundId` 指向新值；
   - 丢弃旧 `cachedEntry/authoritativeState`；
   - rewarded-ad recover/ack 存储必须按新 `context_id` 查询；
   - 旧 round 的 pending/claimed session 不得被新 round 恢复或消费。
9. 服务端创建游戏广告 session 时，必须确认：

```text
context_type = round
context_id = 当前 active round_id
round.revive_used = false
round.status = active/no-moves（按现有状态机约束）
```

10. claim 时再次在事务内锁定 round 并校验同一 `round_id` 尚未复活；成功后同时把服务端 authoritative `revive_used` 设为 true。旧 round 的 session 对新 round claim 必须返回稳定冲突错误，不得消费新 round 的机会。
11. 不要用“清空全部 WebKit LocalStorage”规避问题；这会破坏比赛局恢复、匿名会话和其他托管游戏。修复必须建立在 round 身份与状态机正确隔离上。
12. H5 发布必须更新静态资源内容哈希/版本，并确保入口 HTML 不会继续命中旧 bundle；部署后验证实际 WebView 加载的 bundle 已包含修复。

## 七、迁移、补偿和对账

1. 上线前查询历史游戏广告 session、SSV transaction、wallet grant 和 wallet transaction。
2. 列出因游戏广告误发猫币的数量、用户数、总额和时间范围，先只生成审计报告，不要自动扣减用户已有余额。
3. 是否追回历史误发属于产品/运营决策，不在本次代码自动执行范围内。
4. 对未完成的游戏 pending/verified session 按新规则处理：可继续复活，但不得再发猫币。
5. 迁移和部署必须支持回滚；回滚不能把已迁移的游戏 session 再次当作钱包 session。
6. 增加一次性对账：
   - `game_effect` session 对应 wallet grant/流水数量必须为 0；
   - `wallet_cat_food` credited session 必须有且仅有一份钱包 grant/流水；
   - 所有余额变化都能关联合法的钱包用途 session 或其他既有合法业务类型。

## 八、必须通过的自动化测试

至少覆盖：

1. 钱包入口完整观看：SSV 后猫币只增加一次，写一笔钱包流水，当日次数加一。
2. Just Clear 完整观看：SSV 后余额完全不变、没有钱包流水、钱包广告次数不变；claim 仅复活一次。
3. 第二个未来游戏 fixture 通过配置接入：余额不变，只获得配置的游戏效果；不新增移动端或 SSV 分支。
4. 游戏 payload 伪造 `reward_item=cat_food`、`reward_amount=999999`：余额仍不变。
5. 游戏对应的 Google SSV 回调包含 `reward_item/reward_amount`：只用于核对广告真实性/配置，不触发钱包记账。
6. 原生 completed 但无 SSV：不复活、不发猫币。
7. 提前关闭、load failed、unavailable：不复活、不发猫币。
8. 相同 `transaction_id` 重放 100 次：游戏最多一份 entitlement，钱包没有流水。
9. 相同游戏 session 并发 claim 20 次：业务效果只消费一次。
10. 两个游戏 session 并发复活同一 round：最多一个成功，余额始终不变。
11. 钱包 session 调用游戏 claim、游戏 session 调用钱包 credit/status 变更路径：均被拒绝。
12. 旧数据 reward_purpose 迁移覆盖 wallet/game/unknown 三类，unknown 不会发粮。
13. 数据库事务中途失败后整体回滚，不出现“已复活但 session 未消费”或“游戏 session 写入钱包流水”。
14. 静态检查保证通用 SSV/session/claim 服务不存在具体游戏 slug 的 if/switch。
15. 同一 round 首次复活成功后再次无棋可走：显示“本局复活机会已使用”，不再创建广告 session。
16. 使用过复活的 round 点击“再来一局”：返回新的 `round_id/entry_id`，新状态 `reviveUsed=false`，能够创建并观看一次新的复活广告。
17. 未使用复活的 round 点击“再来一局”：同样创建新 round，不复用旧 authoritative state。
18. 页面刷新/App 重启恢复同一个未结束 round：保持原 `round_id`；若该局已复活，`reviveUsed` 仍为 true。
19. 旧局 finish 与新局 start 并发或网络重试 20 次：只结算旧局一次、只扣一次新局入场猫币、只产生一个新 round，且新 round 的 `reviveUsed=false`。
20. 用旧 round 的 claimed/pending 广告 session 对新 round claim：稳定拒绝，且不改变新 round 的 `reviveUsed`。
21. 服务端错误地返回旧 active entry 的回归 fixture：H5 不得把旧 cached authoritative state 当成显式“再来一局”的新状态，应阻止启动并提示重试。
22. 发布验证必须从真实 iOS WKWebView 加载生产 H5，断言新 bundle hash 生效；不能只用桌面浏览器或开发服务器通过测试。

关键余额断言必须使用明确的前后值，例如：

```text
初始余额 100
钱包广告成功一次 -> 110（具体数量以服务端钱包配置为准）
Just Clear 广告成功并复活 -> 仍为 110
重复 SSV/重复 claim -> 仍为 110
```

## 九、日志、监控与告警

日志禁止记录完整 custom_data、JWT、Cookie、Google signature、邮箱、手机号或完整用户标识。可以记录不可逆短哈希和：

- session purpose；
- game_id/placement/effect_type；
- session/SSV/claim 状态；
- Google transaction 短哈希；
- wallet balance delta；
- 是否创建 wallet transaction；
- 稳定错误码和处理耗时。

新增指标/告警：

- 按 `reward_purpose` 统计 session、SSV 成功率、重复率和延迟；
- `game_effect` 的 wallet balance delta 非 0：立即高优先级告警；
- `game_effect` 关联 wallet grant/transaction：立即高优先级告警；
- 钱包 credited session 缺失 grant/流水；
- entitlement 重复消费；
- unknown legacy purpose 数量。

## 十、上线顺序与交付要求

上线顺序：

1. 数据库迁移和约束；
2. SSV resolver 与用途分流；
3. 游戏 entitlement/claim；
4. 共享 H5 sender 和 Just Clear；
5. 自动化测试与历史数据审计；
6. 先测试广告、再小流量生产；
7. 观察“游戏广告钱包增量”指标持续为 0 后逐步放量。

回滚开关应分别控制新钱包 session 和新游戏 session，不得混用。关闭游戏广告只阻止新 session；已收到合法 SSV 的游戏 session仍应按“只给游戏效果、不发猫币”完成。

交付时请返回：

- 找到的当前误发根因和真实调用链；
- 修改的文件列表；
- 数据库迁移与约束；
- session/SSV/claim 实现；
- 钱包与游戏用途分流说明；
- 共享 H5 sender 修改；
- 自动化与并发测试结果；
- 历史误发审计 SQL/报告（只读，不自动扣款）；
- 脱敏的测试 SSV 日志；
- 灰度、监控、对账和回滚步骤。
