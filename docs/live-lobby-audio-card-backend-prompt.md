# 直播大厅音视频双入口后端实施 Prompt

你正在维护 BWChat 后端。请在不破坏现有一对一直播视频、旧客户端和 Agent 自动匹配的前提下，为直播大厅加入语音/视频双入口、用户性别展示和服务端统一计费策略。请直接完成代码、数据库迁移、接口契约、WebSocket 事件、LiveKit token 权限、自动化测试和发布说明，不要只给方案。

## 一、目标与硬性约束

1. 大厅用户可以选择 `voice` 或 `video` 邀请主播；两种媒体类型使用同一套余额校验、计费、主播收入和结束状态机。
2. 当前正式规则：
   - 接通后的前 10 秒免费；
   - 超过 10 秒后，按本次接通总时长每开始 60 秒收取 100 猫币；
   - 发起邀请前最低可用余额为 100 猫币；
   - 舍入方式固定为 `started_unit`。
3. 计费策略由服务端统一下发。邀请创建时必须生成通话级不可变快照，此后即使全局配置变化，该通话的展示、扣款和结算也只能使用快照。
4. 旧客户端没有传 `call_type` 时必须默认 `video`。旧视频请求、响应、事件和钱包流水必须继续可用。
5. Agent 自动匹配保持纯视频，不为 Agent 匹配开放语音。
6. 后端必须是计费事实源；客户端展示的计费估算不得参与最终扣款。

## 二、统一枚举与计费策略

新增或复用以下枚举：

```text
call_type: voice | video
gender: male | female | other | unspecified
rounding: started_unit
```

面向客户端的计费对象字段必须固定为：

```json
{
  "currency": "cat_food",
  "free_seconds": 10,
  "unit_seconds": 60,
  "amount_per_unit": 100,
  "minimum_starting_balance": 100,
  "rounding": "started_unit"
}
```

要求：

- 全局配置读取失败或出现非法值时，服务端拒绝启动或回退到上述安全默认值，并记录高优先级告警，不得下发 0 秒计费单位、负数价格等无效策略。
- 通话记录保存完整策略快照，而不是只保存一个可能随时变化的配置 ID。
- 计费边界必须覆盖：`0`、`10`、`10.001`、`60`、`60.001`、`120`、`120.001` 秒，对应费用为 `0`、`0`、`100`、`100`、`200`、`200`、`300` 猫币。
- 语音和视频对相同时长必须产生完全一致的费用。

## 三、大厅接口

扩展 `GET /one-to-one-live/slots` 的页面级响应：

```json
{
  "items": [
    {
      "id": "slot_01",
      "status": "waiting",
      "character_setting": "雨夜电台主播",
      "created_at": "2026-07-24T12:00:00Z",
      "user": {
        "user_id": "user_01",
        "username": "radio",
        "nickname": "晚风",
        "avatar_url": "https://...",
        "gender": "female"
      }
    }
  ],
  "next_cursor": null,
  "billing_policy": {
    "currency": "cat_food",
    "free_seconds": 10,
    "unit_seconds": 60,
    "amount_per_unit": 100,
    "minimum_starting_balance": 100,
    "rounding": "started_unit"
  },
  "supported_call_types": ["voice", "video"]
}
```

性别要求：

- `user.gender` 只能返回 `male`、`female`、`other`、`unspecified`。
- 必须经过用户隐私设置过滤；未填写、无权限展示、历史脏值或未知值统一输出 `unspecified`。
- 不要从头像、昵称或其他资料推断性别。
- 大厅创建/更新/结束的 WebSocket 快照若携带用户对象，也必须使用相同的过滤逻辑。

能力开关要求：

- 后端音视频链路全部准备好后才在 `supported_call_types` 中加入 `voice`。
- 灰度阶段可以只返回 `["video"]`；客户端会禁用语音入口。

## 四、邀请、接受、加入和状态查询

扩展：

```http
POST /one-to-one-live/slots/{slot_id}/invite
Content-Type: application/json

{"call_type":"voice"}
```

规则：

- `call_type` 缺失时默认 `video`；非法值返回稳定的 4xx 业务错误，不能静默改成其他类型。
- 邀请创建必须在同一事务/一致性边界内完成：验证 slot 仍可用、禁止自呼叫、禁止主播主动呼叫其他主播、验证没有并发有效邀请、验证余额、锁定媒体类型和计费快照。
- 支持 `Idempotency-Key`；同一个用户、slot、媒体类型和幂等键的重试返回同一个有效邀请。不同幂等键的并发请求只能有一个成功。
- 响应至少包含：

```json
{
  "call_id": "call_01",
  "expires_at": "2026-07-24T12:00:15Z",
  "call_type": "voice",
  "billing_policy": {
    "currency": "cat_food",
    "free_seconds": 10,
    "unit_seconds": 60,
    "amount_per_unit": 100,
    "minimum_starting_balance": 100,
    "rounding": "started_unit"
  }
}
```

以下接口都必须返回服务端确认的 `call_type` 和相同的不可变 `billing_policy` 快照：

- `POST /one-to-one-live/calls/{call_id}/accept`
- `POST /one-to-one-live/calls/{call_id}/join`
- `GET /one-to-one-live/calls/{call_id}`

接受和加入响应继续返回现有的 `call_id`、`room_name`、`token`、`livekit_url`，只做向后兼容的字段追加。

## 五、WebSocket 与状态机

邀请、接受、拒绝、取消、超时、进入通话、余额不足预终止、结束和恢复相关事件必须贯通 `call_type`。邀请和接受事件必须携带完整 `billing_policy` 快照；状态查询是断线恢复的兜底事实源。

至少保证：

- 同一 `call_id` 的媒体类型和计费快照永远不变化。
- 事件具备稳定 `event_id`、`call_id`、`slot_id`、发生时间，可安全去重和乱序处理。
- 接受与取消/超时并发时只能有一个终态，终态事件优先。
- 邀请拒绝、取消或超时后释放 slot；通话结束后主播恢复到大厅等待状态，除非主播主动退出直播。
- 余额不足的预终止与最终结算可以重复投递，但不得重复扣款或重复增加主播收入。
- 服务重启和 WebSocket 重连后，`GET /one-to-one-live/calls/{call_id}` 能恢复正确状态、媒体类型、策略快照和最终结算。

## 六、LiveKit 媒体权限

- `voice` token 允许双方订阅并发布麦克风音轨，不要求摄像头权限，不允许发布视频轨。
- `video` 保持现有麦克风和摄像头能力。
- 房间仍限制为本次两名参与者，token 身份、房间名和过期时间沿用现有安全策略。
- 服务端不要仅依靠客户端隐藏摄像头；LiveKit grant 必须按 `call_type` 限制发布媒体。

## 七、钱包、扣款与主播收入

- 语音和视频都使用同一原子计费服务、同一余额门槛和相同的通话时长来源。
- 继续保留现有视频钱包流水类型、字段含义和查询兼容性。
- 为语音增加可区分的流水类型或稳定媒体字段，例如 `live_voice_charge` / `live_voice_income`；不得把语音伪装成视频流水。
- 每笔扣款/收入都携带 `call_id`、`call_type`、计费单位、计费策略版本或快照摘要，并使用唯一幂等键。
- 扣款与主播收入必须原子对应；任何重试不得造成一方成功、另一方重复或缺失。
- 最终状态返回 `charged_units`、`charged_cat_food`、`earned_cat_food`、`balance_after`、`billing_status`。
- 余额不足时沿用现有宽限/结束流程，并确保语音与视频行为一致。

## 八、稳定业务错误

复用现有错误码并保持客户端可展示文案，至少覆盖：

- 自呼叫；
- 主播主动呼叫其他主播；
- slot 已结束或正在通话；
- 已存在进行中的邀请/通话；
- 余额不足；
- 不支持的 `call_type`；
- 邀请过期；
- 重复接受、取消与终态冲突。

错误响应必须包含稳定机器码，不能让客户端依赖自然语言判断状态。

## 九、数据库迁移与兼容

- 为历史直播通话补齐 `call_type = video`。
- 历史记录没有策略快照时，仅在读取旧记录时使用 10/60/100 默认策略；新通话必须落库快照。
- 所有新字段使用向后兼容的可选字段追加，旧客户端未传 `call_type` 仍走完整视频流程。
- 先部署数据库与后端兼容读取，再部署写入和事件字段，最后在大厅响应中发布 `voice` 能力；回滚时从能力列表移除 `voice` 即可，不影响视频。

## 十、自动化测试与验收

请新增并运行：

1. 契约测试：新旧大厅响应、四种性别及隐私过滤、缺失 `call_type` 默认视频、非法媒体类型、邀请/接受/加入/状态响应和 WebSocket 字段一致。
2. 计费测试：上述所有边界、语音/视频同价、策略变更后旧通话仍使用原快照。
3. 并发与幂等测试：重复邀请、并发接受/取消、重复计费事件、服务重启恢复。
4. 权限测试：语音 token 不能发布视频；视频 token 权限保持不变；第三人不能加入房间。
5. 钱包测试：余额不足、整单位边界、扣款和收入原子性、视频旧流水兼容、语音流水可区分。
6. 流程测试：拒绝、超时、接受、主动挂断、余额不足结束后大厅恢复；Agent 自动匹配仍只能创建视频通话。

交付时请附上：

- 数据库迁移与回滚方式；
- 修改过的接口和事件样例；
- 自动化测试结果；
- 灰度开关与发布顺序；
- 监控指标：邀请成功率、接受率、音视频入房失败率、计费失败/重试、重复结算拦截、余额不足结束数。

