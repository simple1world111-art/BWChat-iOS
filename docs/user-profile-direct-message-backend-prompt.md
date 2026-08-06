# 其他用户主页私信能力：后端实现 Prompt

请在现有 BBchat 后端中修复“从其他用户主页发起私信”的权限与契约一致性问题。必须沿用项目当前语言、框架、鉴权中间件、数据库访问层、事务、错误码体系、`{code,message,data}` 响应包装、WebSocket/推送实现和现有测试风格；不要新建独立服务，不要破坏现有 iOS 客户端。

## 已确认的前端行为与问题

- iOS 用户主页读取 `GET /api/v1/profile/public/{userID}` 返回的 `can_message`。
- 旧前端把 `can_message=false` 当成页面导航硬门禁，所以会直接提示“该主页暂不可私信”。前端现已调整为：只要目标 `user_id` 有效，就允许进入一对一聊天页；实际发送权限仍由后端权威判断并展示后端错误。
- iOS 进入聊天页后会读取 `GET /api/v1/chat/messages/{contactID}`；首次发送可能调用：
  - `POST /api/v1/chat/messages/text`
  - `POST /api/v1/chat/messages/sticker`
  - `POST /api/v1/chat/messages/image`
  - `POST /api/v1/chat/messages/video`
  - `POST /api/v1/chat/messages/voice`
  - `POST /api/v1/chat/messages/gift`
- 当前产品目标：已登录用户默认可以给其他有效用户发起私信，不应要求双方先成为好友或互相关注。拉黑、账号不可用、接收方明确关闭陌生人私信等安全/隐私规则仍必须生效。

## 必须实现

### 1. 统一私信权限判定

在领域/服务层实现唯一的私信权限判定函数，所有主页、历史与发送接口复用，避免各接口分别写“好友判断”。建议语义：

```text
evaluateDirectMessagePermission(viewerID, targetID)
  -> { allowed: Bool, reason: String? }
```

默认规则：

1. viewer 和 target 都存在且账号状态允许使用聊天。
2. viewer != target；给自己发消息按现有产品规则处理，不要误建陌生人会话。
3. 非好友、单向关注、无关注关系均允许发起私信。
4. 任意一方拉黑另一方时禁止发送；不要泄露“谁拉黑了谁”的敏感细节。
5. 如果项目已有“谁可以私信我”设置，则尊重该设置；没有该设置时默认允许陌生人私信，不要虚构一个默认关闭的配置。
6. 不要只在文本消息上实现；所有 DM 消息类型必须走同一权限函数。

### 2. 修正公开主页契约

`GET /api/v1/profile/public/{userID}` 中：

- `data.can_message` 必须使用上述统一权限判定结果。
- 对普通有效的陌生用户返回 `true`，不能因为 `is_friend=false` 就返回 `false`。
- 建议新增可选字段 `message_unavailable_reason`，仅在 `can_message=false` 时返回稳定机器值；旧客户端可忽略：
  - `dm_not_available`
  - `dm_recipient_disabled`
  - `account_unavailable`
- 不要返回“blocked_by_target”之类会泄露拉黑方向的值。
- `can_message` 必须是 JSON boolean；兼容层可继续容忍 0/1，但新响应不要输出字符串。

成功示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "user_id": "u002",
    "nickname": "Oscar",
    "avatar_url": "https://cdn.example/avatar.jpg",
    "is_friend": false,
    "followed_by_me": false,
    "follows_me": false,
    "can_message": true
  }
}
```

### 3. 允许无既有会话时读取聊天页

`GET /api/v1/chat/messages/{contactID}` 对“目标用户有效、双方未被禁止、但还没有任何历史消息”的情况返回成功空列表，而不是 403/404：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "messages": [],
    "has_more": false
  }
}
```

不要为了打开页面提前创建空会话记录。会话应在第一条消息成功落库时按现有模型创建/显现。

### 4. 首条陌生人私信必须原子化成功

当用户向没有既有会话、不是好友的目标发送第一条消息时：

- 在一个事务中完成权限复核、消息落库、会话摘要/索引更新和未读计数更新。
- 沿用现有 `client_message_id`/幂等机制；客户端重试不能生成重复消息或重复会话。
- 成功后发送方和接收方的 `GET /api/v1/chat/conversations` 都能看到同一个 DM 会话。
- WebSocket、新消息推送、会话列表刷新和未读数行为应与好友私信完全一致。
- 图片、视频、语音等涉及上传的接口也必须在最终提交消息时再次校验权限，避免上传期间权限变化造成绕过。

### 5. 稳定错误响应

权限不允许时，所有 DM 发送接口返回一致、可机器识别的 JSON 错误，不要返回 HTML、网关文本或因消息类型而变化的文案。沿用项目既有 HTTP 状态码与业务码规范；若当前没有对应规范，可采用：

```json
{
  "code": 40301,
  "message": "dm_not_available",
  "data": null
}
```

要求：

- HTTP 403：隐私/拉黑/接收设置导致禁止。
- HTTP 404：目标账号不存在；不要把普通“还没有会话”误报为 404。
- HTTP 409：仅用于真实状态冲突，不要用来表示“不是好友”。
- 客户端可安全展示的 `message` 必须稳定；详细内部原因只写服务端日志。

## 必须检查并移除的错误逻辑

全库搜索并审计以下类型的判断，不能只修主页接口：

- `is_friend == true` 才允许 DM
- 必须存在 friend relation / accepted friend request
- 必须互相关注才能发消息
- 只有既有 conversation 才能读取历史或发送
- 文本允许陌生人，但图片/视频/语音/贴纸/礼物仍要求好友
- `can_message` 与真实发送接口使用不同规则

## 测试与验收

请补充后端单元测试、接口测试和必要的并发/幂等测试，至少覆盖：

1. 无关注、非好友：主页 `can_message=true`，历史为空 200，文本首条发送成功。
2. 单向关注、互相关注、好友：均保持成功。
3. 已有历史但已解除好友：仍可继续私信，除非触发明确隐私规则。
4. viewer 拉黑 target、target 拉黑 viewer：主页 `can_message=false`，所有发送类型一致拒绝。
5. 接收方关闭陌生人私信（仅当项目已有该设置）：非好友拒绝，好友按产品现有规则处理。
6. 目标不存在/停用：稳定错误，不创建消息、会话、未读或通知。
7. text/sticker/image/video/voice/gift 使用同一权限矩阵。
8. 相同 `client_message_id` 重试：只生成一条消息。
9. 两个并发首条消息：只形成一个双方共享的 DM 会话，不出现重复 conversation。
10. 第一条消息成功后：接收方 WebSocket/推送、会话列表和未读数正确；发送方会话列表也立即可见。

## 交付要求

完成后请输出：

1. 根因与被移除的旧限制。
2. 修改文件与关键函数清单。
3. 最终私信权限矩阵。
4. 接口响应示例与新增/沿用的错误码。
5. 数据库迁移说明（如无迁移明确写“无”）。
6. 测试命令及完整结果。
7. 与当前 iOS 客户端的兼容性说明，明确 `can_message` 与所有发送接口使用同一个权威策略。
