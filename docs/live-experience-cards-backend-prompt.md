# 直播体验卡后端实现 Prompt

请直接在现有后端仓库中实现以下需求，并复用当前“一对一直播大厅”、道具背包、可消费余额、主播金币收益、REST、WebSocket、事务与审计基础设施。不要只输出设计说明；请完成迁移、代码、测试、灰度开关和监控。旧客户端、普通好友/群通话和 Agent 自动匹配必须保持原行为。

## 1. 固定产品规则

- 新增三个一次性道具定义：
  - `live_experience_card_5m`，`duration_seconds = 300`
  - `live_experience_card_10m`，`duration_seconds = 600`
  - `live_experience_card_15m`，`duration_seconds = 900`
- 三者 `type = live_experience_card`，唯一可消费动作是 `consume_for_live_experience`；补齐后端当前支持的全部语言名称和说明。
- 只能用于“发现 → 聊天 → 直播大厅”对某个直播中的用户发起的一对一语音或视频连线。普通好友通话、群通话、Agent 自动匹配不得接受该支付方式。
- 邀请拒绝、主动取消、超时、未接通均释放预占，不消耗卡。
- 双方接通后仍沿用现有 10 秒免费保护边界：连接时长 `<= 10.000s` 结束则释放；`> 10.000s` 时原子消费整张且只消费一次。
- 卡内时长从双方实际接通的服务端时间开始：`experience_ends_at = connected_at + duration_seconds`。提前结束不返还剩余时长。
- 体验期观众可消费余额扣款为 0，主播金币收益为 0。
- 卡券到期且通话仍在继续时，无第二段免费期：只要 `overage_seconds > 0`，立即按现有 `started_unit` 规则进入第一个计费单元，并恢复主播正常收益。
- 卡券邀请不要求观众在发起前满足最低余额门槛。到期续聊时余额不足，沿用当前余额不足宽限事件、提示和服务端结束通话逻辑。
- 余额支付请求和缺少 `payment_method` 的旧客户端继续完全走现有路径。

## 2. 道具定义与库存

迁移/种子数据必须幂等。三种定义均返回：

```json
{
  "definition_id": "live_experience_card_5m",
  "type": "live_experience_card",
  "available_actions": ["consume_for_live_experience"],
  "metadata": { "duration_seconds": 300 }
}
```

- 发放仅允许复用可信内部发放入口，禁止客户端自报数量、定义或时长。
- 选择用户拥有且未过期库存时使用“最早到期优先”，再用稳定主键打破并列。
- 库存需要区分 available/reserved/consumed/released，或提供等价的预占记录；不可在邀请发起时永久扣减。
- 预占和邀请必须处于同一数据库事务，并对选中的库存行加锁。并发邀请最多一个成功。
- 所有终态都必须清理预占。增加定时回收任务处理崩溃、消息丢失造成的预占泄漏；回收必须核对通话和消费流水，不能误释放已消费卡。

## 3. 邀请契约与幂等

现有直播大厅邀请接口接受 `Idempotency-Key` 请求头。卡券请求固定为：

```http
POST /one-to-one-live/slots/{slot_id}/invite
Idempotency-Key: <stable UUID for this user action>
Content-Type: application/json

{
  "call_type": "voice",
  "payment_method": "prop_card",
  "prop_definition_id": "live_experience_card_5m"
}
```

- `call_type` 支持 `voice` / `video`，并继续校验主播开放能力。
- 相同用户、相同 `Idempotency-Key` 的重试必须返回首次结果，不能创建第二个邀请、第二次预占或第二条消费流水。
- 缺少 `payment_method` 时按旧余额支付处理；不得猜测使用体验卡。
- `payment_method = prop_card` 时定义必须属于上述三种且场景必须是直播大厅手动邀请。
- 卡券不可用时绝不静默降级为余额支付。

成功响应在原字段旁返回统一快照：

```json
{
  "call_id": "live-call-id",
  "call_type": "voice",
  "expires_at": "2026-08-01T12:00:15.000Z",
  "live_experience": {
    "definition_id": "live_experience_card_5m",
    "duration_seconds": 300,
    "status": "reserved",
    "started_at": null,
    "ends_at": null,
    "remaining_seconds": 300,
    "auto_continue_payment_method": "spendable_balance",
    "host_earning_enabled": false,
    "reserved_prop": {
      "inventory_id": "inventory-id",
      "definition_id": "live_experience_card_5m",
      "remaining_quantity": 1
    },
    "consumed_prop": null
  }
}
```

稳定业务错误码：

- `PROP_NOT_OWNED`：没有可用库存
- `PROP_EXPIRED`：目标库存已过期
- `PROP_NOT_CONSUMABLE`：类型、动作或场景不允许
- `PROP_ALREADY_RESERVED` 或 `LIVE_EXPERIENCE_CARD_BUSY`：并发占用
- `LIVE_EXPERIENCE_CARD_MISMATCH`：definition、时长或通话归属不匹配

所有错误均返回机器码和可本地化消息；错误发生后不得产生余额扣款。

## 4. 统一 LiveExperienceSnapshot

邀请、接受、加入、通话状态查询和实时事件必须共享同一字段语义：

```json
{
  "definition_id": "live_experience_card_10m",
  "duration_seconds": 600,
  "status": "active",
  "started_at": "2026-08-01T12:00:00.000Z",
  "ends_at": "2026-08-01T12:10:00.000Z",
  "remaining_seconds": 420,
  "auto_continue_payment_method": "spendable_balance",
  "host_earning_enabled": false,
  "reserved_prop": null,
  "consumed_prop": {
    "inventory_id": "inventory-id",
    "definition_id": "live_experience_card_10m",
    "remaining_quantity": 0
  }
}
```

- `status` 只使用 `reserved | active | consumed | released | completed`。
- `started_at` / `ends_at` 使用 UTC ISO-8601 服务端时间；`remaining_seconds` 由服务端计算且不得为负。
- 接通后快照为 `active`；超过 10 秒并完成消费后为 `consumed`；体验结束并进入超额计费后为 `completed`；未消费释放为 `released`。
- `host_earning_enabled` 在体验期必须为 `false`，开始超额计费后为 `true`。
- 接受接口、加入接口与 `GET /one-to-one-live/calls/{call_id}` 都必须返回最新 `live_experience`；状态查询额外返回 `server_time`，供客户端 WebSocket 重连后校时恢复倒计时。
- 快照的 definition、duration、库存、call、payer、host 必须来自服务端持久化记录，不接受客户端二次提交覆盖。

## 5. 状态机、消费与结算

在现有通话状态机中以事务方式实现：

1. 邀请创建：锁定最早到期库存，创建 reservation 和 `reserved` 快照。
2. 拒绝/取消/邀请过期/从未接通：`reserved -> released`，库存恢复可用，写释放审计。
3. 双方接通：记录唯一 `connected_at` 与 `experience_ends_at`，进入 `active`。重放接通事件不得重置时间。
4. 连接时长首次严格大于 10 秒：在同一事务中将 reservation 消费，写唯一消费流水，`active -> consumed`。以 reservation/call 唯一约束防重复消费。
5. `<= 10 秒` 挂断：释放而不是消费；`> 10 秒` 挂断：整张保持已消费，不返还剩余分钟。
6. 到达 `experience_ends_at`：标记 `completed`；截至此刻观众扣款与主播收益均为 0。
7. 任意 `overage_seconds > 0`：基于超额时长单独调用现有 started-unit 结算，不再套用其前 10 秒免费期。第一个正超额即产生第一个计费单元和对应主播收益。
8. 续费余额不足：发送现有 `one_to_one_live.billing_insufficient`，保留现有宽限毫秒字段并由服务端结束通话。
9. 最终结算必须可幂等重放，且返回：

```json
{
  "experience_seconds_used": 600,
  "overage_units": 1,
  "charged_units": 1,
  "total_charged": 100,
  "earned_gold_coins": 100,
  "billing_status": "settled",
  "consumed_prop": {
    "inventory_id": "inventory-id",
    "definition_id": "live_experience_card_10m",
    "remaining_quantity": 0
  }
}
```

注意：体验卡不足 10 秒释放时，`consumed_prop = null`、`total_charged = 0`、`earned_gold_coins = 0`。金额字段继续采用现有币种拆分和余额优先级。

## 6. WebSocket

在现有 envelope、鉴权、event_id 去重和 call_id 关联规则下发送：

- `one_to_one_live.experience_reserved`
- `one_to_one_live.experience_started`
- `one_to_one_live.experience_consumed`
- `one_to_one_live.experience_released`
- `one_to_one_live.experience_completed`
- `one_to_one_live.overage_started`

每个事件 `data` 至少包含 `event_id`、`call_id`、`server_time`、完整 `live_experience`；涉及库存变化时包含 `reserved_prop` 或 `consumed_prop`。事件可能重复或乱序，因此快照需有可比较的服务端版本/更新时间，并确保客户端随时可通过状态查询收敛到最新值。不要把这些事件发给普通通话、群通话或 Agent 匹配。

## 7. 数据一致性与安全

- 为 reservation、consumption ledger、call settlement、idempotency record 建立必要唯一约束。
- 所有库存选择、预占、释放、消费、体验结束和超额结算记录审计流水，至少包含 actor、payer、host、call、slot、definition、inventory、旧/新状态、时间、幂等键和 trace ID。
- 客户端传入的 `duration_seconds`、价格、收益策略、remaining、时间戳一律忽略。
- 处理跨进程并发、任务重试、WebSocket 重放、接受/取消竞态、10 秒边界竞态、结束/计费竞态和服务重启。
- 若现有计费基于周期任务，必须保证 `experience_ends_at` 与超额首单元边界不因调度延迟而少收、多收或给主播多记收益。

## 8. 测试、发布与回滚

至少新增以下自动化测试：

- 三种定义、国际化、duration 与动作解码。
- 最早到期库存选择、过期库存、无库存、并发双邀请、相同幂等键重试。
- 拒绝、取消、超时、未接通全部释放。
- 精确 10.000 秒释放，10.001 秒只消费一次。
- 5/10/15 分钟的开始、倒计时、提前挂断不返还、到期完成。
- 体验期观众扣款 0、主播收益 0。
- 到期后 0 超额不计费，首个正超额立即产生 started unit；没有第二段 10 秒免费期。
- 到期余额充足正常续聊；余额不足发送宽限事件并结束。
- 接受、加入、状态查询与所有 WebSocket 事件快照一致；断线重连可恢复。
- 旧客户端余额邀请、普通通话、群通话、Agent 匹配无回归。
- 迁移 up/down、灰度关闭、预占回收、重复任务和故障恢复。

用 feature flag 按用户/版本灰度。监控至少包含邀请量、预占成功/冲突/失败、释放原因、消费数、10 秒内释放率、预占年龄与泄漏、体验到期数、超额转化、余额不足结束、观众扣款、主播收益、重复消费阻断、事件延迟和状态查询恢复率。增加不变量告警：体验期扣款非 0、体验期主播收益非 0、同一 reservation 多次消费、已消费库存被释放、终态仍有 reservation。

最终请提交：迁移、实现、测试结果、API/OpenAPI 更新、事件 schema、灰度与回滚步骤，以及前端联调所需的示例请求/响应。
