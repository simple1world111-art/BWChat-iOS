# 群语音/群视频指定成员邀请后端调整

## 背景与根因

客户端现已在群聊中增加群通话成员多选，并在
`POST /api/v1/call/group/{group_id}/start` 请求中发送 `invitee_user_ids`。
旧接口只接收 `call_type`，并向全部有效群成员广播邀请；如果后端忽略新字段，
客户端虽然显示“已选择成员”，实际仍会打扰全群，属于不完整修复。

## 请求契约

```json
{
  "call_type": "voice",
  "invitee_user_ids": ["user-1", "user-2"]
}
```

- `call_type` 只允许 `voice` 或 `video`。
- `invitee_user_ids` 出现时必须是非空数组；去除首尾空白并去重，但保持第一次出现的顺序。
- 发起者本人不得作为受邀人；无效、已注销、被封禁、已退群或不属于该群的 ID 必须整体拒绝，不能静默部分成功。
- 建议设置明确的群通话邀请人数上限，并返回稳定业务错误码与可展示消息。
- 灰度期间可暂时兼容没有 `invitee_user_ids` 的旧客户端，沿用“邀请全群其他有效成员”；全部受支持客户端升级后，再决定是否将该字段设为必填。

## 服务端行为

1. 在同一事务或分布式锁内校验发起者群成员权限、受邀人集合，以及“同一群只有一个活动通话”的约束。
2. 创建同一个 `call_id`、`room_name` 和 LiveKit 房间；发起者获得本人的 LiveKit token。
3. 仅向 `invitee_user_ids` 中通过校验的用户发送 `group_call_invite` WebSocket 事件和 APNs/Android 推送，不得再向全群广播邀请。
4. 邀请记录需持久化为 `call_id + user_id`，用于幂等推送、重复请求去重、过期邀请判断和审计。
5. `/call/join` 必须校验当前用户是该群有效成员，且通话仍为 `ringing/active`。如果产品定义为“仅受邀成员可加入”，还必须校验邀请记录；如果允许其他群成员主动加入，则状态查询不得自动触发来电 UI 或推送。
6. `group_call_ended` 只发给实际受邀或已加入该通话的成员，避免泄漏不相关通话活动。
7. 响应继续保持现有 `CallStartResponse` 契约，不改变 `room_name`、`token`、`livekit_url`、`call_type`、`call_id` 与 `participant_count` 的语义。

## 推荐错误码

- `group_call_invitees_required`
- `group_call_invitee_invalid`
- `group_call_invitee_not_member`
- `group_call_invitee_unavailable`
- `group_call_invitee_limit_exceeded`
- `group_call_already_active`

错误响应不得包含其他用户的隐私资料；可返回 `invalid_invitee_user_ids` 供客户端定位，但日志中不要记录令牌、APNs token 或 LiveKit JWT。

## 必测场景

1. 语音、视频分别选择 1 人和多人，只收到对应成员的 WebSocket 与推送邀请。
2. 发起者、自身重复 ID、空 ID、重复 ID、非群成员、退群成员、封禁成员和不存在成员。
3. 任一受邀人无效时事务整体失败，不能创建房间或向部分用户发邀请。
4. 重复点击、请求重放、并发发起、已有活动群通话时保持幂等且只有一个房间。
5. 未选择成员的新客户端请求返回稳定错误；没有新字段的旧客户端按灰度兼容策略处理。
6. 被邀请成员接听、拒绝、超时、离线后上线、重复接听和通话结束；所有事件使用同一个 `call_id` 与 `room_name`。
7. 未被邀请成员不会出现来电 UI；其主动加入行为严格符合上面的产品定义。

交付时请附数据库迁移与回滚步骤、OpenAPI 更新、WebSocket/APNs 事件样例、接口与并发测试结果，以及按 `call_id` 检索的脱敏联调日志。
