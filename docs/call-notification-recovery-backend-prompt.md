# 后端任务 Prompt：修复 iOS 通话通知点击后的可接听恢复

请检查并修复 BBChat 普通好友语音/视频通话与群语音/视频通话的 APNs 邀请负载。目标是：被叫 App 在后台或被系统终止时收到通知，用户点击通知进入 App 后，客户端能够仅凭通知自定义字段重建来电会话并展示接听/拒绝窗口。

## 当前客户端约束

这是普通 APNs 通知链路，不是 PushKit/CallKit。用户点击通知后客户端可以展示 App 内接听页；若产品要求未点击通知也出现 iOS 系统来电页，需要另立 PushKit + CallKit 项目，不能通过普通 APNs 达成。

客户端会读取 APNs 自定义字段的顶层，以及 `data`、`payload`、`notification_data` 容器；容器可以是 JSON object 或 JSON string。推荐统一把字段放在顶层并使用 snake_case。

## 必须修复的负载契约

单聊语音/视频通话：

```json
{
  "aps": {
    "alert": { "title": "视频来电", "body": "Alice 邀请你视频通话" },
    "sound": "default",
    "content-available": 1
  },
  "push_type": "call",
  "event_id": "call:<call_id>:invite:<callee_user_id>",
  "call_id": "uuid",
  "caller_id": "caller-user-id",
  "caller_name": "Alice",
  "caller_avatar": "https://example.com/avatar.jpg",
  "room_name": "server-generated-room",
  "call_type": "video",
  "sent_at": "2026-08-10T12:00:00Z"
}
```

群语音/视频通话：

```json
{
  "aps": {
    "alert": { "title": "群语音通话", "body": "Alice 邀请你加入群通话" },
    "sound": "default",
    "content-available": 1
  },
  "push_type": "group_call",
  "event_id": "group-call:<call_id>:invite:<callee_user_id>",
  "call_id": "uuid",
  "caller_id": "caller-user-id",
  "group_id": 123,
  "group_name": "测试群",
  "room_name": "server-generated-room",
  "call_type": "voice",
  "sent_at": "2026-08-10T12:00:00Z"
}
```

约束：

1. `push_type` 只能使用 `call`/`call_invite` 或 `group_call`/`group_call_invite`。
2. `call_type` 只能使用 `voice`、`audio` 或 `video`。
3. 单聊必须包含非空的 `call_id`、`caller_id`、`room_name`、`call_type`；群聊还必须包含有效的 `group_id`、非空 `group_name`。
4. APNs 与 WebSocket 邀请必须使用完全相同的 `call_id`、`room_name`、`call_type` 和发起人/群信息。
5. 只能在通话记录和 LiveKit 房间已经成功创建、状态原子提交为 `ringing` 后发送 APNs，禁止先发通知再创建房间。
6. 对每位被叫最多发送一个逻辑邀请；APNs 重试必须复用同一个 `event_id` 和 `call_id`。
7. 被叫点击通知后调用现有 join/accept 接口时，仍在响铃的通话必须返回可用的 LiveKit token、`livekit_url`、`room_name` 和同一个 `call_id`；已结束、拒绝、超时的通话返回明确的 404/409/410 业务错误。
8. 通话结束、拒绝、忙线和超时状态必须幂等，并以 `call_id` 为主关联键，避免旧通知操作到新通话。

## 服务端排查项

- 记录 APNs 发送前的字段存在性检查结果，但不要记录完整 APNs token 或 LiveKit JWT。
- 用 `call_id + callee_user_id + apns_id` 串联通话创建、WebSocket 投递、APNs 投递、点击后的 join/accept。
- 检查 APNs provider 是否错误地只发送了展示字段（title/body）而遗漏自定义 data。
- 检查群通话选人后是否只向 `invitee_user_ids` 发送邀请，且每个邀请负载都包含完整群和房间字段。

## 验收

请用两台真机覆盖单聊语音、单聊视频、群语音、群视频，并分别测试被叫 App 前台、后台、被系统终止三种状态。每个场景必须证明：通知负载字段完整；点击通知后出现 App 内接听/拒绝窗口；接听后加入原通话房间；旧通知不会恢复已结束通话。

完成后输出：根因、修改文件、最终 APNs JSON、接口与状态机变更、部署/回滚步骤、两台真机测试结果和脱敏日志样例。
