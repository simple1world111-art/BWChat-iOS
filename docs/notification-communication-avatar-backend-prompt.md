# BBchat 消息通知昵称与头像后端修复 Prompt

你是本项目的资深后端与 APNs 工程师。请直接检查并修复 BBchat 的普通聊天消息推送链路，让 iOS 在 App 位于前台、后台或被杀进程时，都能把单聊通知显示为真实用户昵称与用户头像，把群聊通知显示为群名称、发送者昵称，并向系统提供群头像。不要只给建议，请完成代码、配置、自动化测试和可部署交付。

## 一、已知客户端契约

- 主 App Bundle ID：`com.bwchat.app`。
- Notification Service Extension：`com.bwchat.app.NotificationService`。
- iOS 最低版本：iOS 16。
- iOS 使用 `INSendMessageIntent` 生成系统通信通知。
- 推送必须使用普通 alert APNs，不得把聊天消息伪装成 VoIP push。
- `aps` 内必须包含 `"mutable-content": 1`，否则系统不会运行 Notification Service Extension，昵称和头像转换不会发生。
- 客户端优先读取顶层自定义字段，同时兼容 `data`、`payload`、`notification_data` 字典或 JSON 字符串；后端新实现统一使用顶层字段，避免双重序列化。
- 后端必须显式发送 `conversation_type`：私聊固定为 `dm`，群聊固定为 `group`。客户端会用其他字段兼容旧推送，但新推送不能依赖猜测。

### 展示语义必须严格区分

| 会话类型 | APNs 原始标题（扩展失败时的兜底） | iOS 通信身份 | 通信头像 | 结构化字段 |
| --- | --- | --- | --- | --- |
| 私聊 `dm` | 发送者昵称 | `sender` = 真实发送者 | `sender_avatar` | `sender_id`、`sender_nickname`、`sender_avatar` |
| 群聊 `group` | 群名称 | `sender` = 客户端构造的群视觉身份，`speakableGroupName` = `nil` | 优先由 `group_member_avatars` 本地合成，`group_avatar` 兜底 | 私聊字段 + `group_id`、`group_name`、`group_avatar`、`group_member_avatars` |

iOS 会根据 `INSendMessageIntent` 决定通信通知的最终标题、子标题和头像布局，后端不能只靠 `aps.alert` 改变左侧图标。为满足产品要求的“左侧群头像、首行群名称、次行发送者昵称与消息摘要”，客户端在群聊通知中会有意把群构造成 `sender` 视觉身份，并把 `speakableGroupName` 设为 `nil`；真实发送者继续通过结构化字段传递，并显示在正文 `发送者昵称：消息摘要` 中。这不同于 Apple 默认的“真实发送者为主、群名称为上下文”布局，是本产品明确选择的展示语义。不得拿发送者头像、通用 `avatar_url` 或 App 图标代替群头像。

`sender_avatar` 和 `group_avatar` 必须提供与 App 消息列表一致的原始方形头像素材，不要由后端预先裁成圆形。群聊必须额外发送 `group_member_avatars`，其成员和顺序必须与群详情接口返回给消息列表的 `members.prefix(9)` 完全相同；客户端会优先用该数组执行与 `GroupMemberAvatarView` 相同的本地拼图，只有该字段缺失时才使用 `group_avatar`。iOS 通信通知会强制给外层身份头像应用圆形蒙版，客户端会把私聊头像按 `22%` 圆角、群头像按 `18%` 圆角放入安全方形区域，以保留完整四角；右下角 App 来源小图标仍由系统自动叠加。

群头像拼图算法必须严格一致：

- 取群详情成员数组的前 9 项，禁止按在线状态、发送者或头像是否为空重新排序。
- 1 人使用 1 列，2–4 人使用 2 列，5–9 人使用 3 列。
- 第一行人数为 `成员数 % 列数`；余数为 0 时第一行使用完整列数。每一行水平居中，所有行整体垂直居中。
- 外边距为头像边长的 `6%`，成员间距为 `3%`，群头像外圆角为 `18%`，成员小头像圆角为 `22%`，背景色为 `#E5E5EA`。
- 成员头像为空或下载失败时保留该成员的位置，使用 `#667EEA → #764BA2` 左上到右下渐变和白色 `person.fill` 占位；不得删除该项导致后续成员位置前移。

## 二、必须修复的根因

请追踪“消息写库/广播 → 推送任务 → APNs provider → Apple”完整链路，确认当前为什么只发送了 `sender_id`，或为什么把用户 ID 放进 `aps.alert.title`，以及为什么没有发送可下载的头像地址。

必须确保：

1. 推送任务在消息产生时保存发送者显示快照，不要等异步 worker 执行时再依赖可能已删除或改名的用户记录。
2. `sender_id` 仅用于会话定位和深链，绝不能用作面向用户的通知标题或昵称。
3. 单聊和群聊都发送 `sender_nickname`、`sender_avatar`。
4. 群聊额外发送 `group_id`、`group_name`、`group_avatar`、`group_member_avatars`。
5. 剧本/角色消息使用消息快照中的 `sender_nickname`、`sender_avatar`，不能用合成的 `sender_id` 代替角色名。
6. 头像为空时字段可省略或传空字符串，但不得把用户 ID、用户名代号或任意占位 URL 当头像。
7. `group_name`、`group_avatar` 必须在创建每一条 APNs payload 时从已提交的最新群资料读取；禁止长期缓存群名称/头像快照。
8. 群重命名或换头像提交后，必须立即失效推送 worker、Redis、本地进程及任务模板中的旧群资料缓存。
9. 增加 `group_revision`（单调递增整数或群资料 `updated_at`），群名称、头像变化时必须更新。
10. 群聊的 `group_avatar` 不得为空；如果产品中的群头像是成员头像九宫格，后端必须生成或缓存一张可匿名下载的合成图片，并把该图片 URL 作为 `group_avatar` 发送。Notification Service Extension 无法读取主 App 内存中的九宫格视图。

## 三、最终 APNs Payload

### 1. 单聊消息

```json
{
  "aps": {
    "alert": {
      "title": "小黑",
      "body": "你好"
    },
    "sound": "default",
    "badge": 3,
    "mutable-content": 1
  },
  "push_type": "chat_message",
  "conversation_type": "dm",
  "sender_id": "user-123",
  "sender_nickname": "小黑",
  "sender_avatar": "https://cdn.example.com/avatars/user-123.webp",
  "message_id": "98765",
  "msg_type": "text"
}
```

要求：

- `aps.alert.title = sender_nickname`，不得等于 `sender_id`。
- `sender_avatar` 是发送者当前消息快照头像。
- 保留现有深链所需的 `sender_id` 和消息字段。

### 2. 群聊消息

```json
{
  "aps": {
    "alert": {
      "title": "产品讨论群",
      "body": "小黑：今晚发布"
    },
    "sound": "default",
    "badge": 5,
    "mutable-content": 1
  },
  "push_type": "group_message",
  "conversation_type": "group",
  "group_id": "group-456",
  "group_name": "产品讨论群",
  "group_avatar": "https://cdn.example.com/groups/group-456.webp",
  "group_member_avatars": [
    "https://cdn.example.com/avatars/user-123.webp",
    "https://cdn.example.com/avatars/user-456.webp",
    "https://cdn.example.com/avatars/user-789.webp"
  ],
  "group_revision": 18,
  "sender_id": "user-123",
  "sender_nickname": "小黑",
  "sender_avatar": "https://cdn.example.com/avatars/user-123.webp",
  "message_id": "98766",
  "msg_type": "text"
}
```

要求：

- 群名称来自群资料快照，发送者昵称和头像来自该条消息的发送者快照。
- 必须同时提供发送者头像、群头像和有序 `group_member_avatars`；三者不能互相替代。
- `group_avatar` 必须是该群在客户端会话列表中应展示的同一张头像；如果是合成群头像，由后端输出已经合成好的静态图片 URL。
- `group_member_avatars` 必须与群详情接口成员顺序一致，最多 9 项；空头像使用空字符串占位，不能过滤。
- `aps.alert.title` 使用群名称，不能显示群 ID 或发送者 ID。
- `aps.alert.body` 使用“发送者昵称：消息摘要”；同时保留结构化 `sender_nickname` 和 `content_preview`。
- 群重命名成功后的下一条消息必须使用新 `group_name` 和更大的 `group_revision`。

## 四、头像 URL 硬约束

Notification Service Extension 是独立进程，App 被杀时不能依赖主 App 的登录态或内存缓存。因此头像地址必须满足：

- 优先返回完整的公网 HTTPS URL，不要只返回数据库文件键。
- 无需 Bearer Token、Cookie 或主 App Keychain 即可 GET；如头像必须私有，生成有效期足够长的只读签名 URL。
- 在通知投递后至少 24 小时内有效，避免 APNs 排队或用户网络延迟时立即过期。
- 返回 HTTP 2xx 和真实图片字节，不能返回 HTML、JSON 错误页或登录页。
- 支持 `jpg`、`jpeg`、`png`、`gif`、`heic` 或 `webp`；建议静态头像使用 JPEG/WebP。
- 建议单张不超过 1 MB，硬上限不得超过 10 MB。
- CDN/对象存储的 TLS 证书链必须被 iOS 信任。
- 更新头像后 URL 应有版本号或内容哈希，避免 CDN 和系统缓存继续展示旧头像。
- URL 不能依赖仅主 App 才能读取的 Cookie、Keychain token、自定义请求头或本机文件路径。

当前 iOS 暂时兼容相对路径和现有 HTTP API 源站，但生产推送必须迁移到 HTTPS；不要把 HTTP 兼容视为最终方案。

## 五、APNs Provider 要求

- Header：
  - `apns-push-type: alert`
  - `apns-topic: com.bwchat.app`
  - `apns-priority: 10`
- JSON 使用 UTF-8，有效 payload 不超过 APNs 限制。
- `mutable-content` 必须是 `aps` 内的数字 `1`，不是字符串 `"1"`，也不能放到顶层。
- 不要只发送 `content-available`；静默推送不能替代消息 alert。
- APNs 发送失败必须记录 HTTP 状态、`apns-id`、reason 和内部 message ID，但不得记录完整 device token、消息正文或签名头像 URL。
- token 无效时按 APNs reason 清理；瞬时失败按可控退避重试，不能重试产生重复业务通知。

## 六、兼容字段

iOS 当前兼容下列字段，但后端新代码必须统一输出 snake_case 标准字段：

- 昵称：`sender_nickname`（兼容 `sender_name`）。
- 发送者头像：`sender_avatar`（兼容 `sender_avatar_url`）。
- 群头像：`group_avatar`（兼容 `group_avatar_url`）。
- 群名称：`group_name`。
- 群资料版本：`group_revision`（兼容 `group_updated_at`）。

不要输出含义模糊的通用 `avatar_url`，因为客户端无法可靠判断它属于发送者还是群。

## 七、自动化与联调验收

请至少增加并通过以下测试：

1. 单聊 payload：标题等于昵称，含 `sender_id`、`sender_nickname`、`sender_avatar` 和 `mutable-content: 1`。
2. 群聊 payload：同时含群名称、群头像、发送者昵称和发送者头像。
3. 分类字段：单聊严格发送 `conversation_type=dm`，群聊严格发送 `conversation_type=group`；禁止使用用户/群 ID 的格式推断类型。
4. 群重命名：重命名前发送一条、重命名后再发送一条；后一条 payload 和真机通知必须立即显示新群名，且 `group_revision` 增大。
5. 群换头像：更新后的下一条通知必须使用新 URL/版本并显示新群头像，不能继续命中旧 CDN 或 worker 缓存。
6. 昵称包含中文、日文、韩文、emoji 时 UTF-8 正确且不被截成用户 ID。
7. 发送者改名或换头像后，新消息使用新快照；历史推送任务仍保持创建时的完整快照。
8. 剧本角色消息显示角色名和角色头像，而非 `script-role:*` 代号。
9. 头像为空时仍显示正确昵称，不生成损坏 URL。
10. 对每个非空头像 URL 做集成测试：匿名 GET 返回 2xx、可被图片解码、大小合规。
11. App 前台、后台、被杀进程各验证单聊和群聊；至少使用两台真机发送真实 APNs，截图确认锁屏、通知中心和横幅。
12. 检查 APNs payload 大小；长昵称、长正文和长签名 URL 下仍不超过限制，必要时安全截断正文而不是删除身份字段。
13. 回归通知点击深链、badge、声音、mention 和消息去重，不能因新增字段破坏现有行为。
14. 在 APNs provider 发送前断言群聊的 `group_avatar` 非空且可解析为 HTTPS URL；为空时记录可检索的结构化错误并阻止“看似成功但只能显示 App 图标”的静默降级。
15. 真机抓取一条最终 APNs JSON，确认 `aps["mutable-content"]` 是数字 `1`，顶层 `conversation_type=group`，且 `group_avatar` 匿名 GET 返回 HTTP 2xx 和可解码图片。
16. 针对 1–9 人分别做群头像快照测试，确认通知扩展合成结果与消息列表 `GroupMemberAvatarView` 的成员、顺序、行列、间距、底色和圆角一致；重点覆盖三人群“第一行 1 人居中、第二行 2 人”。

## 八、交付内容

完成后输出：

- 根因和涉及的后端调用链。
- 修改文件、数据库字段或任务结构。
- 单聊与群聊最终 payload 实例。
- APNs headers 和环境/topic 配置。
- 自动化测试结果。
- 两台真机联调证据。
- 部署步骤、灰度方案、监控指标和回滚方案。

如果现有消息模型没有稳定的昵称/头像快照，请补充最小向后兼容迁移，并保证旧记录和在途任务不会因空字段导致推送失败。
