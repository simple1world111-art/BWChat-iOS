# BWChat 一对一“直播”后端最终实现 Prompt

你是一名资深后端与实时音视频工程师。请直接在现有 BWChat 后端仓库中完整实现“一对一直播大厅”，提交可运行代码、数据库迁移、测试与接口文档，不要只给方案或伪代码。

这份 Prompt 已合并此前全部需求，不需要再执行任何旧 Prompt。

## 0. 最高优先级：不得影响现有视频聊天

“直播”本质上是一个公开的一对一视频邀请入口，用户接受以后复用现有视频聊天的 LiveKit/RTC 媒体能力；它不是多人直播，也不是第二套音视频系统。

必须遵守以下非回归边界：

1. 不修改现有好友视频通话的接口语义、鉴权、WebSocket 事件、CallKit、铃声、全屏来电页或 UI 行为。
2. 保持现有 `/call/start`、`/call/{id}/join`、结束通话等接口兼容；保持现有 `call_invite`、`call_reject`、`call_busy`、`call_end` 事件兼容。
3. 新功能统一放在 `/one-to-one-live` 命名空间，并使用 `one_to_one_live.*` WebSocket 事件，不能把直播邀请伪装成现有 `call_invite`。
4. 直播邀请不校验好友关系，但这个豁免只能用于有效直播席位对应的双方，不能放宽普通私聊、普通好友视频或其他用户关系鉴权。
5. 接受直播邀请后，可以复用现有 Call/LiveKit 服务层和通话结束能力；新生成的 `call_id` 必须能被现有通话结束、断线清理、LiveKit webhook 与审计链路识别。
6. 接受前绝不能创建 RTC participant、播放铃声、触发 CallKit 或发送强提醒。接受后才签发 RTC 凭证并进入现有全屏视频通话。

## 1. 产品行为

### 直播大厅

- 顶部有“推荐”和“聊过”两个列表。
- 列表没有预置用户或假数据，只返回后端真实的 `waiting` 席位。
- 每项列表 UI 只展示用户头像和用户名，不展示签名、简介或人物设定。
- 服务端仍需返回本次 `character_setting`，因为点击头像或用户名后的详情弹框要展示它。
- 点击右上角“+”后，用户手动填写“我扮演的角色设定”并挂上直播；不能用个人签名、bio 或资料字段自动代入。
- 用户挂上直播后，真实头像和用户名进入列表；用户可以主动“退出直播”。

### 查看与邀请

- 点击直播列表中的头像或用户名，前端会显示：直播人名字、其本次人物设定和“与 TA 视频”按钮。
- 点击“与 TA 视频”后创建一次最多 15 秒的邀请。
- 被邀请者只收到 App 顶部的轻提示卡片，可以接受或拒绝；不触发当前好友视频的强来电提醒。
- 15 秒内未接受视为自动拒绝。服务端时间是权威，客户端倒计时只负责展示。
- 一次席位同一时刻只能存在一个待处理邀请，其他竞争者得到明确的“忙碌/已被占用”错误。
- 拒绝、取消或超时后，主播席位恢复为 `waiting`；主播主动退出则永久结束本次席位。

### 接受后

- 双方接受后进入仅允许两人的现有视频聊天媒体链路，初始为全屏视频。
- 前端可以把全屏视频缩小，缩小后底层是这两人的聊天窗口，视频继续以现有小窗方式运行。
- 因此接受时后端必须创建或复用这两人的 direct conversation，并给予本次有效直播关系所需的双向聊天权限；不得把双方自动变成好友，也不得全局放宽私聊权限。
- 任一方结束视频后只结束本次直播通话；只要主播没有主动点击“退出直播”，原席位必须自动恢复为 `waiting`，保留本次 `character_setting`，主播无需重新挂上直播并会重新出现在大厅。
- 只有主播主动点击“退出直播”并调用席位 DELETE 接口时，才永久结束本次直播席位并从大厅移除。

## 2. 数据模型与状态机

新增或扩展 `one_to_one_live_slots`：

- `id`
- `host_user_id`
- `character_setting`：本次手动人物设定，去除首尾空白后 1～300 字
- `status`：`waiting | inviting | in_call | ended`
- `current_call_id`：`inviting/in_call` 时关联的通话 ID
- `current_guest_user_id`
- `invite_expires_at`
- `room_name`
- `started_at`、`connected_at`、`ended_at`
- `ended_by_user_id`、`end_reason`
- `last_heartbeat_at`、`created_at`、`updated_at`

新增或扩展一对一直播通话记录，至少保存：

- `call_id`、`slot_id`
- `caller_user_id`、`host_user_id`
- `status`：`pending | accepted | rejected | cancelled | expired | in_call | ended`
- `expires_at`、`accepted_at`、`connected_at`、`ended_at`
- `rejection_reason`、`ended_by_user_id`、`end_reason`
- 关联的 direct conversation ID

状态转换必须通过事务、行锁、唯一索引或 compare-and-set 原子完成：

```text
waiting --invite--> inviting --accept--> in_call --hangup/leave--> waiting
                         |
                         +--reject/cancel/15s timeout--> waiting

waiting --host exits--> ended
inviting/in_call --host exits--> ended
```

约束：

- 一个用户同一时刻最多拥有一个未结束席位。
- 一个席位最多一个 guest，房间最多两个 identity。
- 用户不能邀请自己。
- `inviting` 状态禁止第二个邀请者创建邀请。
- 普通挂断、对方挂断、连接失败或 RTC 房间结束只结束当前 call，不等同于主播退出直播；恢复 `waiting` 时必须清空 `current_call_id`、`current_guest_user_id`、`invite_expires_at` 和本次 room 关联，但保留 slot ID、host、`character_setting` 与直播意图。
- 所有重试、重复点击、定时任务和 webhook 重放必须幂等。

## 3. 大厅 REST API

沿用项目已有 API 版本前缀。以下省略 `/api` 前缀时，按现有项目规范补齐。

### 3.1 获取列表

`GET /one-to-one-live/slots?filter=recommended|chatted&cursor=<cursor>&limit=30`

- 只返回 `waiting` 席位。
- `recommended` 按现有推荐能力和新鲜度排序。
- `chatted` 只返回和当前用户真实连接成功过的一对一直播对象。
- 排除被拉黑、封禁、审核不通过和不可见账号。
- 使用稳定 cursor 分页。

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "id": "slot_01",
        "status": "waiting",
        "character_setting": "温柔的旅行摄影师",
        "created_at": "2026-07-22T11:30:00Z",
        "user": {
          "user_id": "u_host",
          "username": "Xia",
          "avatar_url": "https://..."
        }
      }
    ],
    "next_cursor": null
  }
}
```

不要返回用户签名，不要返回 RTC token、内部风控字段或隐私数据。

### 3.2 挂上直播

`POST /one-to-one-live/slots`

```json
{
  "character_setting": "温柔的旅行摄影师",
  "idempotency_key": "UUID"
}
```

- 校验认证、账号状态、限流、内容安全和 1～300 字限制。
- 在事务中创建 `waiting` 席位；相同幂等键返回同一结果。
- 不在此时签发 RTC token，不让 host 进入空 RTC 房间。
- 返回完整 slot。前端可以先乐观显示当前真实用户，随后必须以服务端 slot 为准。

### 3.3 主播退出直播

`DELETE /one-to-one-live/slots/{slot_id}`

- 仅 host 可操作，使用 `Idempotency-Key`。
- `waiting`：更新为 `ended` 并实时从列表移除。
- `inviting`：结束席位，同时取消待处理邀请并通知 caller。
- `in_call`：结束席位和关联通话，关闭房间或移除双方 participant，并通知对端。
- 重复请求返回同一个最终 `ended` 结果。
- 保存 `ended_by_user_id`、`end_reason`、`ended_at`。
- 该 DELETE 是唯一代表主播主动退出直播的操作。退出后不得再被普通 call_end、断线清理或迟到 webhook 恢复为 waiting。

### 3.4 心跳与恢复

`POST /one-to-one-live/slots/{slot_id}/heartbeat`

- host 在 waiting 时每 20～30 秒上报。
- 超过合理窗口（建议 90 秒）且 host 不在有效会话中时，自动结束僵尸席位。
- App 重连后通过重新拉取列表和自己的当前 slot 收敛状态。

可补充：

`GET /one-to-one-live/slots/me/current`

用于恢复右上角“退出直播”状态和当前人物设定。

## 4. 15 秒视频邀请 API

iOS 前端已按以下路径和结构接入，后端必须兼容。

### 4.1 发起邀请

`POST /one-to-one-live/slots/{slot_id}/invite`

请求体当前为空 `{}`，可支持 `Idempotency-Key` 请求头。

服务端原子完成：

1. 校验 caller 已登录、不是 host、双方账号可用。
2. 仅校验直播席位有效，不校验好友关系。
3. 仅允许 `waiting -> inviting`，设置 guest、call_id 和 `expires_at = server_now + 15 seconds`。
4. 向 host 发送独立的 `one_to_one_live.call_invite` WebSocket 事件。
5. 返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "call_id": "call_live_01",
    "expires_at": "2026-07-22T12:00:15Z"
  }
}
```

竞争失败使用稳定业务错误，例如：`LIVE_SLOT_BUSY`、`LIVE_SLOT_ENDED`、`LIVE_SELF_CALL_FORBIDDEN`。

### 4.2 接受邀请

`POST /one-to-one-live/calls/{call_id}/accept`

- 只能由对应 host 在 15 秒截止前接受。
- 使用事务保证 pending 只成功接受一次。
- 创建或复用双方 direct conversation，但不建立好友关系。
- 创建与现有通话系统兼容的 1 对 1 Call/LiveKit 房间记录。
- 只给当前 host 签发短时 LiveKit token。
- 更新 slot 为 `in_call`，向 caller 发送 `one_to_one_live.call_accepted`。
- 返回现有 iOS `CallJoinResponse` 兼容结构：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "call_id": "call_live_01",
    "room_name": "server-generated-room",
    "token": "short-lived-host-token",
    "livekit_url": "wss://..."
  }
}
```

### 4.3 caller 在已接受后加入

`POST /one-to-one-live/calls/{call_id}/join`

- 只能由该 call 的 caller 调用。
- 只有 `accepted/in_call` 状态可签发 token。
- 只给当前 caller 签发绑定其 user identity 和指定 room 的短时 token。
- 返回与 accept 完全相同的 `CallJoinResponse` 字段。

### 4.4 拒绝

`POST /one-to-one-live/calls/{call_id}/reject`

```json
{ "reason": "rejected" }
```

允许 `reason = rejected | timeout | busy`：

- `rejected`：用户点拒绝。
- `timeout`：客户端倒计时结束后补充上报。
- `busy`：被邀请者已有通话或其他邀请。

服务器仍必须自行在第 15 秒过期，不能依赖客户端请求。有效拒绝后把 slot 原子恢复为 `waiting`，清空本次 guest/call/expiry，并通知 caller。

### 4.5 caller 取消

`POST /one-to-one-live/calls/{call_id}/cancel`

- 只允许 caller 取消仍为 pending 的邀请。
- 原子恢复 slot 为 `waiting` 并通知 host。
- 接受完成后不能用此接口取消；应走现有结束通话链路。

### 4.6 已接通直播通话结束

复用现有结束通话接口、`call_end` 信令和 LiveKit webhook，但对 `origin = one_to_one_live` 的通话必须在同一幂等事务中：

1. 将本次直播 call 更新为 `ended`，保存通话结束人、原因和时间。
2. 仅当 slot 仍为 `in_call` 且 `current_call_id` 等于本次 `call_id` 时，将原 slot 恢复为 `waiting`。
3. 清空 slot 的本次 caller、call、邀请截止时间和 room 关联，保留 slot ID、host、`character_setting`、创建时间和直播意图。
4. 广播 `one_to_one_live.slot.updated`，使大厅重新出现该主播。
5. 若 slot 已因主播调用 DELETE 进入 `ended`，任何普通挂断、重复请求或迟到 webhook 都不得把它恢复。

此流程必须覆盖主播挂断、caller 挂断、连接失败、LiveKit participant 离开和 room finished；所有入口重复执行只能记录一次通话历史，并收敛到相同 slot 状态。

## 5. Agent 视频顺序匹配

Agent 聊天窗口中的视频按钮使用同一套一对一直播邀请，但 caller 不手动选择主播。服务端必须负责候选选择与顺序轮询，不能把全部在线主播名单下发客户端，也不能同时骚扰多位主播。

完整流程：

1. 用户编辑“我希望你能扮演”的角色设定并点击匹配，iOS 显示转动地球等待动画。
2. 服务端从真实 `waiting` 直播席位中生成一次候选快照，并按角色相关度、可用性、推荐分和公平性排序。
3. 每次只把一个候选席位原子更新为 `inviting`，向该主播发送与手动直播邀请完全相同的顶部轻提示 `one_to_one_live.call_invite`。
4. 每位主播最多等待 15 秒。拒绝、busy、超时或离线时，安全恢复该席位为 waiting，然后自动尝试候选快照中的下一位。
5. 某位主播接受后立即停止轮询，不再通知其他候选；双方进入现有一对一视频链路。
6. 所有候选都未接受时结束匹配，向 caller 发送 `one_to_one_live.match_exhausted`。iOS 会停止地球等待并显示“暂时没有主播接听”。
7. caller 点击“取消匹配”时终止当前邀请和后续轮询；当前尚未接受的主播收到取消事件，其席位恢复 waiting。

### 5.1 创建 Agent 匹配

`POST /one-to-one-live/matches`

iOS 请求：

```json
{
  "role_setting": "温柔的旅行摄影师",
  "source_agent_id": "agent_01",
  "client_match_id": "match_客户端生成的UUID"
}
```

要求：

- `role_setting` 是用户本次编辑的目标角色设定，用于候选相关度排序，不是用户签名。
- `source_agent_id` 仅用于推荐上下文、审计和风控，不能把 Agent 当作 RTC participant。
- `client_match_id` 由 iOS 在请求前生成，是本次匹配的全局幂等 ID。服务端必须采用并原样返回该 ID，重复请求不能创建第二场匹配。
- 同一 caller 同一时刻最多一个 `searching/connecting` 匹配。
- 创建响应应在开始投递首个主播邀请前提交持久化状态；即使 WebSocket 事件比 HTTP 响应先到，事件中的 `match_id` 也必须与 `client_match_id` 相同。
- 没有候选时仍可成功创建后立即发送 exhausted，或返回项目约定的明确业务错误；推荐前者，保持统一异步状态机。

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "match_id": "match_客户端生成的UUID",
    "created_at": "2026-07-22T12:00:00Z"
  }
}
```

建议新增 `one_to_one_live_matches`：

- `id`/`client_match_id`
- `caller_user_id`、`source_agent_id`、`role_setting`
- `status`：`searching | connecting | accepted | exhausted | cancelled | ended`
- 候选快照或可审计的候选版本
- 当前 `slot_id`、`call_id`、候选序号
- `created_at`、`accepted_at`、`ended_at`

建议新增 attempts 记录每次候选的 `match_id`、`slot_id`、`call_id`、顺序、发送时间、截止时间和结果。不要因候选重试复用旧 `call_id`；每个主播尝试使用独立 call_id，但都关联同一个 match_id。

### 5.2 取消 Agent 匹配

`POST /one-to-one-live/matches/{match_id}/cancel`

- caller 可在搜索过程中取消，接口幂等。
- iOS 可能在创建匹配的 HTTP 响应返回前就调用取消。因此后端必须能按 `client_match_id` 记录取消 tombstone，或在创建事务中检查同 ID 的取消状态，确保不会留下幽灵匹配。
- 若当前有 pending 主播邀请，将 attempt 更新为 cancelled，恢复仍归属于该 attempt 的 slot，并向主播发送 `one_to_one_live.call_cancelled`。
- 已 accepted/in_call 时不能用该接口挂断，必须走现有通话结束接口。
- 完成取消后向 caller 发送 `one_to_one_live.match_cancelled`，数据至少包含 `match_id` 和 `reason`。

### 5.3 顺序轮询规则

- 候选必须来自创建匹配时真实可用的 waiting 席位，排除 caller 自己、拉黑关系、违规账号和已邀请过的席位。
- 每次只能保留一个 pending attempt；上一位明确终态后才能邀请下一位。
- 每个 attempt 的 15 秒由服务端权威定时器或持久化任务管理，进程重启后仍能继续或正确收敛。
- 使用 compare-and-set 校验 `slot.current_call_id == attempt.call_id` 后才可释放席位，禁止旧超时任务释放新的邀请或已接通通话。
- caller 断线不立即终止，可保留短暂重连窗口；最终必须有最大匹配生命周期，建议不超过候选数乘 15 秒并设置硬上限。
- 主播接受、caller 取消、attempt 超时三者并发时只能有一个最终结果。接受成功后后台队列必须停止。
- 为避免同一主播连续被多个 Agent 匹配打扰，要做冷却、公平调度与速率限制。

### 5.4 Agent 匹配事件

发送给主播的仍然是第 6 节定义的 `one_to_one_live.call_invite`，但 `data` 额外包含：

```json
{
  "match_id": "match_xxx",
  "invitation_source": "agent_match",
  "role_setting": "用户希望对方扮演的设定"
}
```

- Agent 匹配邀请中的 `role_setting` 必须非空，并与创建 match 时提交的值一致；它表示 caller 对主播提出的本次角色要求，不能错误使用主播 slot 自己的 `character_setting`。
- iOS 会在主播接受前的顶部轻提示卡片中直接展示该字段。

主播仍调用同一个 accept/reject API。后端根据 call_id 关联 match_id：

- 拒绝、busy、timeout：不要给 caller 发送最终失败；服务端自动尝试下一位。
- 接受：给 caller 发送 `one_to_one_live.call_accepted`，并停止匹配。
- 全部未接受：发送 `one_to_one_live.match_exhausted`。

Agent 匹配接受事件必须包含 iOS 建立聊天和视频所需的主播信息：

```json
{
  "type": "one_to_one_live.call_accepted",
  "data": {
    "match_id": "match_xxx",
    "call_id": "call_attempt_03",
    "slot_id": "slot_host",
    "host_id": "u_host",
    "host_username": "Xia",
    "host_avatar_url": "https://...",
    "character_setting": "主播本次扮演的角色设定",
    "conversation_id": "conversation_01"
  }
}
```

候选耗尽事件：

```json
{
  "type": "one_to_one_live.match_exhausted",
  "data": {
    "match_id": "match_xxx",
    "reason": "no_host_accepted",
    "attempted_count": 4
  }
}
```

Agent caller 收到 accepted 后会继续调用现有的 `POST /one-to-one-live/calls/{call_id}/join` 获取自己的 `CallJoinResponse`。接受前不能签发 RTC token。

## 6. WebSocket 事件（字段必须兼容 iOS）

所有事件通过现有已认证 WebSocket，外层继续使用项目现有 `{type, data}` 结构。

### 给 host：新邀请

```json
{
  "type": "one_to_one_live.call_invite",
  "data": {
    "call_id": "call_live_01",
    "slot_id": "slot_01",
    "caller_id": "u_caller",
    "caller_username": "Ming",
    "caller_avatar_url": "https://...",
    "character_setting": "caller 本次可展示的角色设定或空字符串",
    "expires_at": "2026-07-22T12:00:15Z"
  }
}
```

### 给 caller：已接受

```json
{
  "type": "one_to_one_live.call_accepted",
  "data": {
    "call_id": "call_live_01",
    "slot_id": "slot_01",
    "accepted_by": "u_host",
    "conversation_id": "conversation_01"
  }
}
```

### 关闭等待状态

- `one_to_one_live.call_rejected`
- `one_to_one_live.call_cancelled`
- `one_to_one_live.call_expired`

这些事件的 `data` 至少包含 `call_id`、`slot_id`、`reason`。事件必须只投递给该直播呼叫的双方。

大厅另外发送：

- `one_to_one_live.slot.created`
- `one_to_one_live.slot.updated`
- `one_to_one_live.slot.ended`

每个事件带唯一 `event_id`、`occurred_at` 和可合并的 slot。客户端断线重连后仍以 REST 数据为准。

严禁为上述直播邀请同时发送普通 `call_invite`，否则会触发现有好友视频的强提醒。

## 7. RTC、聊天与结束通话复用要求

- 使用现有 LiveKit server URL、token 生成器、room webhook、通话质量和结束能力。
- token 必须绑定指定 room 与当前登录用户 identity，短时有效；永远不能把 API secret 下发客户端。
- room 只允许 host 和 caller 两个确定身份，禁止第三人加入，也不允许中途补位。
- 使用 LiveKit 官方 webhook 校正 joined、left 和 room finished，验证签名并幂等处理重放。
- `call_id` 应进入现有 Call 服务生命周期，使 iOS 当前 `CallManager.endCall()` 能正常结束直播视频；如内部需要增加 `origin = one_to_one_live`，只能做可选字段扩展，不能破坏旧记录解析。
- 直播 call 结束后，现有结束链路必须按 4.6 节把未主动退出的原 slot 恢复为 `waiting`；不能把普通“挂断视频”解释为“退出直播”。
- accept 时创建/复用 direct conversation。双方在该直播 call 有效期间及之后能否继续聊天，按产品现有安全策略选择最窄授权；最低要求是视频缩小后两人聊天页可读写。
- 该授权不能隐式添加好友，不能让任意非好友互发消息，不能绕过拉黑、封禁和举报安全规则。
- 如果现有聊天接口严格要求好友关系，请增加 `conversation_participant` 或 `relationship_source = live_call` 的窄范围授权分支，不要修改全局好友判断。

## 8. 定时任务、并发和幂等

- 服务端定时扫描 `pending` 且 `expires_at <= now` 的邀请，使用原子条件更新为 `expired`。
- 过期任务必须同时把仍属于该 `call_id` 的 slot 恢复为 `waiting`，避免旧任务释放后来的新邀请。
- accept、reject、cancel、expire 竞争时只能有一个最终结果。
- 同一用户短时间频繁邀请需要限流；同一 caller 不能同时占用多个席位。
- 所有写接口记录 user_id、slot_id、call_id、request_id、状态前后值和失败原因，便于审计。

## 9. 必须提供的自动化测试

至少覆盖：

1. 同一 host 并发挂上直播只产生一个未结束席位。
2. 列表无假数据，只返回 waiting；列表字段无签名，详情可取得 character_setting。
3. 两个 caller 并发邀请同一席位，只有一个成功。
4. 不能邀请自己；非好友可以通过直播席位邀请；普通 `/call/start` 仍保持原好友规则。
5. 直播邀请只发 `one_to_one_live.call_invite`，不发普通 `call_invite`。
6. 第 15 秒服务端自动过期，发送 expired，slot 恢复 waiting。
7. accept 与 timeout、reject、cancel 并发只有一个终态。
8. 接受后双方分别获得绑定自己 identity 的 RTC token，第三人无法获得或进入。
9. 接受时创建/复用 direct conversation，双方能聊天但不会自动成为好友。
10. 主播退出 waiting 后立即从推荐和聊过列表消失。
11. 主播在 inviting 时退出会取消邀请；在 in_call 时退出会结束双方通话。
12. 主播或 caller 挂断、连接失败、participant 离开或 room finished 后，直播 call 结束且原 slot 自动恢复 waiting，主播无需重新挂上直播并重新出现在大厅。
13. 主播主动 DELETE 席位后保持 ended；迟到的 call_end 或 webhook 不得复活该席位。
14. “聊过”只包含真实连接成功过的直播对象，不包含仅邀请、拒绝或超时记录。
15. WebSocket 断线、App 被杀、重复 webhook 和后台任务重跑不会留下永久僵尸席位。
16. 运行现有好友音视频、消息、好友关系全部回归测试，结果与改动前一致。
17. Agent 匹配一次只邀请一位主播，拒绝/超时后才邀请下一位。
18. 某位主播接受后停止所有后续 attempt，未出现多位主播同时接受。
19. 全部候选未接受时发送唯一的 match_exhausted，客户端可显示“暂时没有主播接听”。
20. caller 在创建响应返回前取消时，client_match_id 不会产生幽灵匹配或遗留 inviting 席位。
21. Agent 匹配 accepted 事件包含 match_id、call_id 和主播资料，caller 能通过 join 接口进入同一双人房间。

## 10. 交付要求

完成后输出并提交：

- 数据库迁移和回滚方案。
- 路由、控制器、服务层、Repository/DAO 与权限策略。
- 原子状态转换、15 秒过期任务和幂等实现。
- LiveKit token、room 限制和 webhook 处理。
- direct conversation 的窄范围授权实现。
- REST/OpenAPI 文档、WebSocket 事件文档和稳定错误码表。
- 单元、并发、集成与现有视频通话回归测试。
- 一份 iOS 联调说明，逐项列出最终请求、响应和事件示例。

不要要求 iOS 改回普通 `call_invite`，不要删除或替换现有好友视频链路。若现有后端结构与命名不同，请在保持上述外部契约和非回归边界的前提下适配现有架构。
