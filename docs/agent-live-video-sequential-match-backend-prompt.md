# Agent 视频匹配顺序邀请直播用户——后端实施 Prompt

你是一名资深后端与实时音视频工程师。请直接在现有 BWChat 后端代码库中实现本次增量需求，提交可运行代码、数据库迁移、后台任务、测试和接口文档，不要只输出设计、总结或伪代码。

## 本次需求范围

本次只实现以下新增流程：

> 用户在智能体聊天窗口点击视频按钮，填写“我希望你能扮演”的角色设定并点击匹配后，后端从当前正在直播且可用的用户中依次发起一对一视频邀请。每次只邀请一位主播；拒绝、忙碌、离线或 15 秒未响应后自动尝试下一位。任意主播接受后立即停止匹配并进入现有一对一视频聊天；全部候选都未接受时结束匹配并通知客户端“暂时没有主播接听”。

不要重新设计直播大厅，不要改造现有好友视频聊天。本次是在已经存在的一对一直播席位、直播顶部邀请卡片和 LiveKit 视频通话能力上增加“Agent 自动顺序匹配”入口。

## 强制非回归要求

1. 不修改现有好友视频通话的 `/call/start`、普通 `call_invite`、CallKit、铃声、好友鉴权或全屏来电行为。
2. Agent 匹配只能邀请真实处于 `waiting` 状态的一对一直播席位，不创建假用户或假主播。
3. 发给主播的邀请必须继续使用轻量事件 `one_to_one_live.call_invite`，不能发送普通 `call_invite`，否则会触发现有强来电提醒。
4. 接受前不能签发 RTC token、创建 LiveKit participant、播放铃声或触发 CallKit。
5. 主播接受后复用现有一对一直播 accept/join、direct conversation、LiveKit 房间和通话结束能力。
6. 不要求双方是好友，不自动添加好友；这个权限豁免只能作用于本次有效的一对一直播通话。

## 一、匹配状态模型

新增 `one_to_one_live_matches`，至少包含：

- `id`：必须等于 iOS 提交的 `client_match_id`。
- `caller_user_id`。
- `source_agent_id`：发起匹配的智能体 ID，仅用于推荐上下文和审计，智能体本身不是 RTC participant。
- `role_setting`：用户本次编辑的角色设定，去除首尾空白后 1～300 字。
- `status`：`searching | accepted | exhausted | cancelled | ended`。
- `current_attempt_id`、`current_slot_id`、`accepted_call_id`。
- `candidate_count`、`attempted_count`。
- `created_at`、`accepted_at`、`cancelled_at`、`ended_at`。

新增 `one_to_one_live_match_attempts`，至少包含：

- `id`。
- `match_id`。
- `slot_id`、`host_user_id`。
- `call_id`：每次尝试使用独立 call_id，不能在不同主播之间复用。
- `sequence_number`。
- `status`：`pending | accepted | rejected | busy | expired | cancelled | skipped`。
- `sent_at`、`expires_at`、`resolved_at`。
- `result_reason`。

约束：

- 一个 caller 同一时刻最多一个 `searching` 匹配。
- 一个 match 同一时刻最多一个 `pending` attempt。
- 一个直播 slot 同一时刻最多被一个 call 占用。
- 所有状态切换必须使用事务、行锁、唯一索引或 compare-and-set，不能只做“先查再写”。

## 二、创建匹配接口

实现：

`POST /one-to-one-live/matches`

iOS 已按以下请求发送：

```json
{
  "role_setting": "温柔的旅行摄影师",
  "source_agent_id": "agent_01",
  "client_match_id": "match_客户端生成的UUID"
}
```

要求：

1. 校验登录状态、账号安全状态、角色设定长度、内容安全和调用频率。
2. `client_match_id` 是本次匹配的全局幂等键。服务端必须采用并原样返回，不得另换 match_id。
3. 相同用户使用相同 `client_match_id` 重试时返回同一个 match；不同用户不能复用该 ID。
4. 生成本次候选快照，只包含创建时真实可用的 `waiting` 直播席位。
5. 排除 caller 自己、已拉黑关系、封禁/违规账号、不可见账号及当前不可接受邀请的用户。
6. 候选按以下因素排序：角色相关度、主播当前可用性、推荐分、新鲜度、公平曝光和近期邀请冷却。
7. 必须先持久化 match，再异步启动首个 attempt，不能让 HTTP 请求一直等到所有主播尝试结束。

响应必须兼容当前 iOS：

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

如果没有候选，仍返回创建成功，然后立即通过 WebSocket 发送 `one_to_one_live.match_exhausted`，保持统一异步状态机。

## 三、顺序邀请调度器

创建 match 后启动可靠的后台调度流程：

1. 从尚未尝试的候选中取下一位。
2. 原子占用对应直播 slot：只有 `waiting -> inviting` 成功后才能发送邀请。
3. 创建独立 attempt 和 call_id，设置 `expires_at = server_now + 15 seconds`。
4. 每次只允许存在一个 pending attempt，绝对不能同时邀请多位主播。
5. 向当前主播发送 `one_to_one_live.call_invite`。
6. 等待接受、拒绝、busy、取消或服务端 15 秒超时。
7. 若未接受，原子释放仍属于当前 attempt 的 slot，然后开始下一位。
8. 若接受，将 match 更新为 `accepted`，停止后台调度，不再通知任何后续候选。
9. 候选全部处理完成仍无人接受时，将 match 更新为 `exhausted` 并通知 caller。

必须使用持久化任务、队列或可恢复的定时机制。服务进程重启后仍能恢复 pending attempt，不能依赖单进程内存 timer。

释放 slot 时必须带条件：

```sql
UPDATE one_to_one_live_slots
SET status = 'waiting',
    current_call_id = NULL,
    current_guest_user_id = NULL,
    invite_expires_at = NULL
WHERE id = :slot_id
  AND status = 'inviting'
  AND current_call_id = :attempt_call_id;
```

旧 attempt 的超时任务不得释放新的邀请或已经接通的通话。

## 四、发送给主播的邀请

继续使用已有轻量事件：

```json
{
  "type": "one_to_one_live.call_invite",
  "data": {
    "match_id": "match_xxx",
    "call_id": "call_attempt_01",
    "slot_id": "slot_host",
    "invitation_source": "agent_match",
    "caller_id": "u_caller",
    "caller_username": "Ming",
    "caller_avatar_url": "https://...",
    "role_setting": "温柔的旅行摄影师",
    "expires_at": "2026-07-22T12:00:15Z"
  }
}
```

- `role_setting` 是必填字段，必须原样携带本次 match 保存的角色要求，不能省略、置空，也不能替换成主播 slot 自己的 `character_setting`。
- iOS 会在主播接受前的顶部邀请卡片展示“希望你扮演：{role_setting}”，因此每个候选 attempt 都必须收到相同的本次角色要求。

主播继续使用已有接口：

- `POST /one-to-one-live/calls/{call_id}/accept`
- `POST /one-to-one-live/calls/{call_id}/reject`

行为要求：

- `reject/reason=rejected`：记录当前 attempt，然后尝试下一位。
- `reject/reason=busy`：记录 busy，然后尝试下一位。
- `reject/reason=timeout`：只能作为客户端补充信号；服务端仍必须自行在第 15 秒过期。
- 主播断线或席位失效：记录 skipped/busy，然后尝试下一位。
- 不要把单个主播的拒绝直接作为整个 match 的失败通知给 caller。

## 五、主播接受后的处理

接受操作必须在事务中保证只能成功一次，并完成：

1. 当前 attempt 从 `pending -> accepted`。
2. match 从 `searching -> accepted`。
3. slot 从 `inviting -> in_call`。
4. 停止所有后续候选调度。
5. 创建或复用 caller 与 host 的 direct conversation，但不建立好友关系。
6. 创建与现有 Call/LiveKit 生命周期兼容的双人房间。
7. 给接受方返回现有 `CallJoinResponse`。
8. 给 Agent 匹配 caller 发送 accepted WebSocket 事件。

发送给 caller 的字段必须完整兼容当前 iOS：

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

caller 收到事件后会调用现有接口：

`POST /one-to-one-live/calls/{call_id}/join`

该接口必须只给当前 caller 签发绑定其 user identity 和指定 room 的短时 RTC token，返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "call_id": "call_attempt_03",
    "room_name": "server-generated-room",
    "token": "short-lived-caller-token",
    "livekit_url": "wss://..."
  }
}
```

## 六、所有主播均未接受

当候选快照中的主播全部被拒绝、busy、离线或超时后：

1. 原子更新 match 为 `exhausted`。
2. 清理最后一个 attempt 和 slot 占用。
3. 只发送一次以下事件：

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

iOS 收到后会停止地球等待动画，并显示“暂时没有主播接听”。

## 七、取消匹配接口

实现：

`POST /one-to-one-live/matches/{match_id}/cancel`

要求：

1. 仅 caller 可取消，接口幂等。
2. caller 可能在创建匹配的 HTTP 响应返回前就取消，因此 `{match_id}` 就是请求中的 `client_match_id`。
3. 如果取消请求先于创建事务到达，必须记录取消 tombstone；后到达的创建请求不能再启动匹配。
4. 如果有 pending attempt，将其更新为 cancelled，并只释放仍绑定该 call_id 的 slot。
5. 向当前主播发送 `one_to_one_live.call_cancelled`，停止后续候选调度。
6. 向 caller 发送：

```json
{
  "type": "one_to_one_live.match_cancelled",
  "data": {
    "match_id": "match_xxx",
    "reason": "caller_cancelled"
  }
}
```

7. 如果主播已经接受并进入 connecting/in_call，不能由“取消匹配”接口直接把 slot 恢复为 waiting；此时应返回稳定的 `MATCH_ALREADY_ACCEPTED`。客户端随后使用现有通话结束接口结束本次 call，并由直播通话结束事务把未主动退出的主播 slot 恢复为 waiting。

## 八、并发与安全要求

- accept、reject、timeout、cancel 必须竞争同一条件状态，只有一个动作成为最终结果。
- 一位主播接受后，即使队列中已经存在下一任务，也必须通过 match 状态检查阻止其发送。
- 同一主播需要邀请冷却和频率限制，避免连续收到多个 Agent 匹配提示。
- 同一 caller 需要创建匹配和取消匹配限流。
- 不向客户端返回完整候选名单、推荐分、内部审核信息或其他主播隐私数据。
- 所有写操作记录 request_id、match_id、attempt_id、slot_id、call_id、用户 ID、状态前后值和原因。
- LiveKit 房间最多允许 caller 与接受的 host 两个指定 identity，禁止第三人加入。

## 九、必须完成的自动化测试

至少覆盖：

1. 创建接口原样返回 client_match_id，重复请求不会创建第二场匹配。
2. 候选只来自真实 waiting 直播席位，并正确排除 caller 自己和不可用账号。
3. 任意时刻只存在一个 pending attempt，不会并发邀请多位主播。
4. 第一位拒绝后才邀请第二位。
5. 第一位 15 秒超时后释放其 slot，再邀请第二位。
6. 第一位 busy/离线时继续下一位。
7. 任意主播接受后停止全部后续 attempt。
8. 接受、拒绝、超时、取消并发时只有一个终态。
9. 旧 attempt 超时不会释放新 attempt 或 in_call slot。
10. 全部候选未接受时只发送一次 match_exhausted。
11. 无候选时快速发送 match_exhausted。
12. caller 在创建响应前取消不会产生幽灵 match 或遗留 inviting slot。
13. accepted 事件包含 match_id、call_id、主播 ID、用户名、头像和人物设定。
14. 每位候选主播收到的 `one_to_one_live.call_invite.data.role_setting` 与创建 match 时提交的角色要求一致，且能在接受前看到。
14. caller 能通过现有 join 接口获取自己的 RTC token并进入同一双人房间。
15. Agent 匹配不会发送普通 call_invite，不会触发 CallKit 或好友视频铃声。
16. 普通好友视频、手动点击直播用户视频、直播退出和聊天权限回归测试全部通过。

## 十、交付要求

完成后请输出并提交：

- 数据库迁移与回滚方案。
- REST 路由、控制器、服务层和权限检查。
- 候选排序、持久化顺序调度器、15 秒过期任务。
- match/attempt/slot 的原子状态转换实现。
- WebSocket 事件实现及字段文档。
- 幂等、取消 tombstone、限流与审计日志。
- 单元测试、并发测试、集成测试和现有视频通话回归测试。
- 一份最终 iOS 联调说明，列出实际接口、响应、事件和稳定错误码。

请直接实现代码。不要只给分析，不要要求前端改用普通好友视频邀请，也不要改坏现有一对一直播或好友视频聊天。
