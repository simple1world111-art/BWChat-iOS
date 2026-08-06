# 直播主播自选语音 / 视频连线方式——后端实施 Prompt

你是一名资深后端与实时音视频工程师。请直接在 BWChat 后端仓库中实现“一对一直播主播在挂上直播时，自选允许语音连线、视频连线或两者都允许”的完整后端能力。请提交可运行代码、数据库迁移、自动化测试和接口 / WebSocket 契约更新，不要只给分析、伪代码或前端临时判断。

## 已完成的 iOS 契约

iOS 开播弹窗已有“语音”和“视频”两个勾选框，默认均不勾选，主播必须主动选择，并保证至少选择一种。创建直播席位时会发送：

```http
POST /one-to-one-live/slots
Idempotency-Key: <uuid>
Content-Type: application/json
```

```json
{
  "character_setting": "温柔的旅行摄影师",
  "live_avatar_asset_id": "live_avatar_01",
  "allowed_call_types": ["voice", "video"],
  "idempotency_key": "<uuid>"
}
```

字段名必须固定为 `allowed_call_types`；值只允许 `voice`、`video`。iOS 会解码每个 slot 的同名字段，并将“平台全局支持类型”和“主播允许类型”取交集，决定观众可见的连线按钮：仅允许语音时只显示语音按钮，仅允许视频时只显示视频按钮，两者都允许时显示两个按钮。

## P0：数据模型与兼容性

1. 为一对一直播 slot 持久化 `allowed_call_types`，不能只保存在进程内存或创建接口响应中。
2. 数据必须满足：
   - 数组长度为 1–2；
   - 只能包含 `voice`、`video`；
   - 不允许重复；
   - 建议按 `voice`、`video` 的固定顺序规范化后存储和返回。
3. 数据库迁移需把历史有效 slot 和历史默认值回填为 `["voice", "video"]`，前提是生产环境全局确实已同时开放这两种方式；若某种方式未全局开放，则默认值取当前全局 `supported_call_types`。
4. 兼容旧客户端：创建请求缺少 `allowed_call_types` 时，服务端使用当前全局 `supported_call_types` 作为默认值，但默认结果仍必须至少包含一种类型。
5. 新客户端传入空数组、未知值、重复值、非数组或全局未开放的类型时，返回稳定的 4xx 业务错误，不得静默扩大权限。建议：

```json
{
  "code": "LIVE_ALLOWED_CALL_TYPES_INVALID",
  "message": "请至少选择一种有效的连线方式",
  "data": null
}
```

## P0：所有读取与实时事件必须返回该字段

以下返回中的每一个 slot 都必须包含规范化后的 `allowed_call_types`：

- `POST /one-to-one-live/slots`
- `GET /one-to-one-live/slots`
- `GET /one-to-one-live/slots/me/current`
- 任何恢复当前 slot、分页列表或管理员查询所复用的 slot DTO
- `one_to_one_live.slot_created`
- `one_to_one_live.slot_updated`
- 其他携带完整 slot 的 WebSocket 事件

标准 slot 示例：

```json
{
  "id": "slot_01",
  "status": "waiting",
  "character_setting": "雨夜电台主播",
  "live_avatar_url": "https://example.com/live-avatar.jpg",
  "allowed_call_types": ["voice"],
  "created_at": "2026-07-31T12:00:00Z",
  "user": {
    "user_id": "host_01",
    "username": "radio",
    "nickname": "晚风",
    "avatar_url": "https://example.com/avatar.jpg",
    "gender": "female"
  }
}
```

列表页顶层现有的 `supported_call_types` 表示平台能力，slot 内的 `allowed_call_types` 表示主播选择，两者含义不能混用。实际可用类型为二者交集。

## P0：邀请接口必须由服务端强制校验

对以下接口：

```http
POST /one-to-one-live/slots/{slot_id}/invite
```

在创建 call、占用 slot、冻结 / 检查余额、签发 LiveKit token、发送 WebSocket 或 APNs 之前，原子校验：

1. `call_type` 是 `voice` 或 `video`；
2. `call_type` 位于平台全局 `supported_call_types`；
3. `call_type` 位于该 slot 持久化的 `allowed_call_types`；
4. slot 仍有效、主播仍在线且状态允许邀请。

如果观众请求主播未开放的类型，返回：

```json
{
  "code": "LIVE_CALL_TYPE_NOT_ALLOWED",
  "message": "该主播未开放视频连线",
  "data": {
    "slot_id": "slot_01",
    "requested_call_type": "video",
    "allowed_call_types": ["voice"]
  }
}
```

建议 HTTP 409 或 422，并在接口文档中固定一种。失败时不得创建残留 call、不得改变 slot 状态、不得产生计费记录、不得通知主播。不要信任前端按钮是否禁用，旧客户端、脚本和重放请求都必须经过相同校验。

邀请成功后的 REST 响应、WebSocket 邀请、APNs 数据和 LiveKit 房间配置仍以本次已确认的 `call_type` 为准。语音邀请不得被升级为视频；视频邀请也不得被降级为语音。

## 幂等、并发与状态约束

1. 同一创建幂等键重放时，必须返回第一次成功创建的同一 slot 及同一 `allowed_call_types`。
2. 如果相同幂等键对应的请求体不同（包括连线方式不同），返回幂等冲突，不能覆盖第一次结果。
3. slot 创建、允许类型持久化和事件投递应处于同一事务 / 可靠事件边界，避免列表看到默认值而创建响应看到用户选择。
4. 本期 iOS 只在开播创建时选择方式，没有在直播中修改的入口。若后端已有 slot 更新接口，只有 `waiting` 状态可修改；`inviting`、`connecting`、`in_call` 状态禁止修改，避免进行中的邀请与权限快照不一致。
5. call 创建时把最终 `call_type` 和当时 slot 的 `allowed_call_types` 快照写入 call / 审计数据，后续计费和终止逻辑不得受 slot 后续变化影响。

## 自动化测试与验收

至少覆盖：

1. 新客户端创建 `["voice", "video"]`、仅 `["voice"]`、仅 `["video"]` 均成功并原样规范化返回。
2. 旧客户端不传字段时使用兼容默认值。
3. 空数组、未知类型、重复类型、错误数据类型、全局未开放类型被拒绝。
4. 创建响应、列表、当前 slot 与 WebSocket slot 事件中的字段一致。
5. 仅语音 slot：语音邀请成功，视频邀请返回 `LIVE_CALL_TYPE_NOT_ALLOWED`，且无 call / slot 状态 / 计费 / 通知副作用。
6. 仅视频 slot：视频邀请成功，语音邀请被拒绝。
7. 同一幂等键同请求重放返回同一结果；同键不同 `allowed_call_types` 返回冲突。
8. 邀请并发、主播下播、slot 忙线和方式校验同时发生时，最终只有合法的一条邀请可以进入 pending / accepted。
9. 数据库迁移后，历史有效 slot 不出现 `null` 或空数组。
10. 日志以 `request_id + slot_id + host_user_id + requested_call_type` 串联校验和邀请链路，但不得记录完整 LiveKit JWT、APNs token 或其他密钥。

## 交付要求

交付时请给出：

- 修改的路由、service、repository、model / schema 和事件 DTO 文件；
- 数据库迁移及回滚说明；
- 最终 REST 与 WebSocket JSON 示例；
- 自动化测试命令与结果；
- 与 iOS 联调时可使用的测试账号 / slot 场景；
- 上线顺序：后端先兼容并返回字段，再发布 iOS，最后按需要收紧“字段必传”策略。
