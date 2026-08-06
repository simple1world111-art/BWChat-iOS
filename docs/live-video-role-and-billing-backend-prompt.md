# 一对一直播角色上下文与猫币计费后端实现 Prompt

请在现有 `one_to_one_live` 模块中实现以下能力。必须复用现有用户、钱包、直播槽位、智能体匹配、LiveKit 房间和 WebSocket 基础设施；不要改变普通好友语音/视频、群通话、智能体文字聊天的计费行为。

## 一、范围和不可变规则

1. 只有 `one_to_one_live` 一对一直播视频收费。
2. 普通好友视频、普通好友语音、群通话全部免费，不能创建直播计费账单。
3. 付款人永远是主动发起直播连线的人：
   - 在直播大厅点击主播头像并发起视频的人；
   - 在智能体聊天页点击视频按钮并发起匹配的人。
4. 被呼叫、正在直播、接受邀请的一方不扣猫币。
5. 接通后的前 10 秒免费。连接时长不超过 10 秒时收费为 0。
6. 超过 10 秒后，按完整接通时长每开始一个 60 秒计费单元收取 100 猫币，向上取整。前 10 秒只决定本次通话是否免费，但仍计入第一个 60 秒周期：

   `charge = connected_duration_seconds <= 10 ? 0 : ceil(connected_duration_seconds / 60) * 100`

   边界示例：
   - `0...10s`：0
   - `>10...60s`：100
   - `>60...120s`：200
   - `>120...180s`：300
7. 发起时可用猫币余额小于 100，服务端必须拒绝，不能只依赖客户端判断。
8. 每个成功计费单元必须从付款人扣除 100 猫币，并把同样的 100 猫币增加到本次接听主播的钱包。当前规则不收平台手续费，即主播实收等于付款人实扣。
9. 已经拥有有效直播槽位、当前处于直播状态的用户不能主动呼叫其他主播，也不能从智能体入口发起直播匹配；但仍然可以作为主播接收和接受其他用户的呼叫。

## 一（补充）、主播禁止主动连接其他主播

以下两个主动发起接口都必须执行服务端校验：

- 直播大厅呼叫创建接口（当前 `requestOneToOneLiveCall` 对应接口）
- 智能体直播匹配创建接口（当前 `startAgentOneToOneLiveMatch` 对应接口）

以鉴权用户作为发起人查询有效直播槽位。若该用户存在 `waiting`、`invited`、`connecting`、`busy` 或项目中其他表示仍在直播的状态，拒绝创建呼叫或匹配：

```json
{
  "code": "LIVE_HOST_CANNOT_CALL_OTHER_HOST",
  "message": "正在直播，无法与其他在直播的人视频"
}
```

建议返回 HTTP `409 Conflict`。校验要求：

1. 不能信任客户端传入的发起人 ID，必须使用鉴权用户。
2. 判断直播状态与创建呼叫/匹配记录必须放在同一事务或同一把用户级互斥锁中，避免“同时挂上直播和发起匹配”的竞态。
3. 创建直播槽位接口也必须检查该用户是否已有尚未结束的主动直播呼叫或智能体匹配；存在时拒绝挂上直播，保证两个方向都不能并发穿透。
4. 该限制只阻止主播作为付款方主动发起，不得阻止主播收到邀请、接受邀请或在挂断后回到直播大厅。
5. 目标主播必须排除发起人自己的直播槽位；即使客户端传入自己的 `slot_id`，服务端也必须拒绝。

## 二、角色上下文

为直播呼叫保存不可变的角色快照，不能在通话中再次读取可能已修改的槽位或智能体配置。

### 直播大厅入口

- `entry_source = "live_lobby"`
- `role_setting` 保存主播直播槽位的 `character_setting`
- 付款方展示语义：`对方正在扮演`
- 主播方展示语义：`我正在扮演`

### 智能体入口

- `entry_source = "agent_match"`
- `role_setting` 保存发起人提交的 `role_setting`
- 付款方展示语义：`我希望对方扮演`
- 主播方展示语义：`对方希望我扮演`

以下事件和加入响应都返回相同的角色快照：

- `one_to_one_live.call_invite`
- `one_to_one_live.call_accepted`
- 接受/加入 LiveKit 房间的 HTTP 响应

推荐字段：

```json
{
  "call_id": "live_call_xxx",
  "entry_source": "live_lobby",
  "role_setting": "复古唱片店老板",
  "payer_user_id": "viewer_user_id",
  "host_user_id": "host_user_id"
}
```

不得把智能体入口的 `role_setting` 误写成主播自己的直播设定，也不得把大厅入口的主播设定解释为“对方希望我扮演”。

## 三、发起前余额校验

在以下两个入口的创建事务中做服务端强校验：

- 直播大厅呼叫创建接口（当前 `requestOneToOneLiveCall` 对应接口）
- 智能体直播匹配创建接口（当前 `startAgentOneToOneLiveMatch` 对应接口）

要求：

1. 以鉴权用户作为 `payer_user_id`，客户端传入的 payer ID 一律不可信。
2. 锁定或使用可串行化方式读取付款人的可消费总余额。
3. 余额 `< 100` 时返回 HTTP `402`（若项目已有统一余额不足状态码，可沿用，但语义必须明确）：

```json
{
  "code": "LIVE_VIDEO_INSUFFICIENT_BALANCE",
  "message": "猫币余额不足，无法与ta视频",
  "required_balance": 100,
  "balance": 80
}
```

4. 余额校验与呼叫/匹配记录创建必须防并发穿透。多个并发请求不能在只有 100 余额时都被视为可发起。
5. 仅收到邀请但未接通、被拒绝、超时或取消时不得扣款。

## 四、接通时间和计费状态机

以 LiveKit 中付款人和主播双方都已加入房间作为 `connected_at`。优先使用可信 LiveKit webhook；如果已有可信的服务端接通状态机，可以复用，但不能使用客户端本地时间作为账务依据。

建议状态字段：

```text
call_id
payer_user_id
host_user_id
entry_source
role_setting
connected_at
free_until
ended_at
charged_units
charged_cat_food
earned_cat_food
billing_status
```

计费状态机：

1. 双方未进入媒体房间：`pending`，0 猫币。
2. 双方进入后记录唯一 `connected_at`，`free_until = connected_at + 10s`。
3. 通话在 `free_until` 之前结束：`charged_units = 0`。
4. 通话跨过 10 秒边界时，在同一事务中从付款人扣除第 1 个计费单元 100 猫币，并向主播增加 100 猫币。
5. 接通总时长超过 60 秒、120 秒、180 秒等整分钟边界时，再以同样方式完成下一次付款人扣款和主播入账。免费 10 秒不能顺延这些整分钟边界。
6. 通话结束时按服务端时长公式复核应付单元数，只补扣尚未成功记录的单元，绝不能重复扣款。
7. 付款人在进入下一个计费单元时余额不足 100：
   - 不得产生负余额；
   - 发送余额不足事件；
   - 服务端结束 LiveKit 通话并向双方发送既有的通话结束事件；
   - 已完成计费单元不退款。

调度任务可能延迟，因此最终结算必须使用公式复核；同时必须设置单通话最高时长或可靠的后台续费任务，避免服务重启导致长时间漏扣。

## 五、账务原子性和幂等

每个计费单元使用稳定幂等键：

`one_to_one_live:{call_id}:unit:{unit_index}`

数据库唯一约束至少包含：

`UNIQUE(call_id, payer_user_id, unit_index)`

每次扣款必须在同一个数据库事务中完成：

1. 锁定付款人钱包；
2. 确认该单元尚未扣款；
3. 确认付款人余额至少 100；
4. 锁定主播钱包；
5. 从付款人扣减 100；
6. 向主播增加 100；
7. 分别写入付款人支出流水和主播收入流水；
8. 更新通话累计单元、累计费用和累计主播收益；
9. 提交后再分别发送付款人扣费事件与主播收益事件。

付款人扣款和主播入账必须同成同败，禁止先扣款再异步给主播入账。任务重试、重复 webhook、重复结束请求、多个 worker 同时结算都只能产生一次扣款和一次对应收益。

钱包流水建议：

```json
{
  "type": "one_to_one_live_video_charge",
  "amount": -100,
  "call_id": "live_call_xxx",
  "unit_index": 1,
  "idempotency_key": "one_to_one_live:live_call_xxx:unit:1"
}
```

主播收入流水建议：

```json
{
  "type": "one_to_one_live_video_earning",
  "amount": 100,
  "call_id": "live_call_xxx",
  "unit_index": 1,
  "payer_user_id": "viewer_user_id",
  "idempotency_key": "one_to_one_live:live_call_xxx:unit:1:host_earning"
}
```

## 六、客户端所需 WebSocket 事件

每次成功扣款后，仅向付款人发送：

```json
{
  "type": "one_to_one_live.billing_updated",
  "data": {
    "call_id": "live_call_xxx",
    "charged_units": 1,
    "charged_cat_food": 100,
    "balance_after": 900,
    "status": "active"
  }
}
```

同一事务成功后，向主播发送：

```json
{
  "type": "one_to_one_live.earning_updated",
  "data": {
    "call_id": "live_call_xxx",
    "earned_units": 1,
    "earned_cat_food": 100,
    "balance_after": 600,
    "status": "active"
  }
}
```

余额不足时向付款人发送：

```json
{
  "type": "one_to_one_live.billing_insufficient",
  "data": {
    "call_id": "live_call_xxx",
    "charged_units": 1,
    "charged_cat_food": 100,
    "balance_after": 20,
    "status": "billing_insufficient",
    "reason": "insufficient_balance"
  }
}
```

随后必须走既有服务端通话结束广播，使双方立即退出媒体房间。主播端只接收自己的累计收益和自己的 `balance_after`，不能接收付款人的钱包余额。

## 七、接口兼容与安全

1. 所有新增响应字段保持向后兼容。
2. `call_id`、payer、host、entry source 和角色快照都以服务端记录为准。
3. 加入接口必须校验当前用户确实是该通话的 payer 或 host。
4. 普通 `/calls` 路径不得进入本计费状态机。
5. 日志不得记录 LiveKit token、钱包完整敏感信息或用户提交角色文本的非必要副本。
6. 所有时间统一使用 UTC，金额使用整数猫币，禁止浮点金额。

## 八、必须通过的自动化测试

1. 大厅入口双方收到大厅语义的同一角色快照。
2. 智能体入口双方收到智能体语义的同一 `role_setting` 快照。
3. 余额 99 拒绝；余额 100 允许创建。
4. 未接通、拒绝、取消、超时均扣 0。
5. 时长 `10s` 扣 0，`10.001s` 扣 100。
6. 时长 `60s` 扣 100，`60.001s` 扣 200；`120.001s` 扣 300。
7. 重复 webhook、重复结算、任务重试不重复扣款。
8. 两个并发计费任务不造成负余额。
9. 下一单元余额不足时不扣款、双方被结束通话、付款人收到余额不足事件。
10. 已在直播的用户从大厅或智能体入口主动发起时，返回 `LIVE_HOST_CANNOT_CALL_OTHER_HOST`，不创建呼叫、匹配、LiveKit 房间或账务记录；其接收和接受邀请能力不受影响。
10. 每个成功计费单元付款人减少 100、主播增加 100，两边流水与余额在同一事务中一致。
11. 普通好友视频、语音和群通话始终不创建直播扣费流水。
12. 付款方扣费事件、主播收益事件中的累计金额和各自 `balance_after` 与数据库最终账务一致。
