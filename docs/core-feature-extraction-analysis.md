# BWChat 核心功能抽离、上架级架构与新 iOS 项目迁移方案

> 审计日期：2026-07-21  
> 上架级补全日期：2026-07-22  
> 审计对象：`/Users/wegpt.com/Desktop/BWChat-iOS` 当前工作树  
> 目标：在新的项目路径下新建 iOS 项目，完整迁移登录注册、消息与 Agent 互动、视频、朋友圈、钱包，同时继续沿用现有后端接口。  
> 文档状态：**架构与上架方案 v2，可作为实施基线；仍需完成本文定义的 G0-G6 Gate，不能把“功能已迁移”视为“可上架”。**  
> 说明：当前工作树已有大量未提交修改。本文以当前工作树为准，行号可能随着后续编辑变化；本次只优化本文档，没有修改现有业务源码。

---

## 1. 最终结论

这次抽离不能按“复制几个页面文件”的方式完成。五组功能共享鉴权、HTTP、WebSocket、APNs、SQLite、媒体缓存、后台上传、钱包余额、远程配置、导航和本地化。如果只复制 `ChatView.swift`、`MomentsView.swift`、`WalletView.swift` 等页面，新工程会出现能编译但不能完整运行、实时消息丢失、余额串号、媒体上传不能恢复等问题。

建议采用以下迁移原则：

1. **服务端接口保持不变。** 原 endpoint、HTTP method、query/body 字段、响应 envelope、Bearer、Idempotency-Key、WebSocket 事件名和旧字段兼容解码均视为冻结的 wire contract。
2. **先兼容搬运，再客户端内部模块化。** 不要求后端重设计；在新客户端中用协议和 adapter 包住现有接口。
3. **登录注册是所有业务的根依赖。** 必须先完成 token、refresh、Keychain、账号隔离、WebSocket、push token 和启动恢复，再迁移业务页面。
4. **DM 与 Agent 是两套协议，不能强行统一模型。** DM 使用 HTTP + WebSocket + SQLite + outbox；Agent 使用 HTTP turn + 轮询，当前不进入 DM 的 MessageStore。
5. **“视频功能”按三个子域迁移。** 视频消息/通用播放、短剧/短视频、实时音视频通话彼此相邻但实现不同，应独立成模块。
6. **钱包是跨业务资金域。** IAP、提现、广告奖励、礼物、红包/转账、朋友圈/短剧/Agent 解锁必须共享同一账号级钱包状态，但各功能不能继续直接依赖 `WalletStore.shared`。

在“真实可提交 App Store”这一目标下，还必须追加以下发行结论：

7. **现有 `HTTP/WS` 与全局 `NSAllowsArbitraryLoads=true` 是 Release Blocker，而不只是迁移风险。** 生产发行前服务端必须提供有效的 `HTTPS/WSS`，客户端移除全局 ATS 放开；若服务端未就绪，只能继续开发/TestFlight 内测，不能宣称达到生产上架基线。
8. **原有 wire contract 可以冻结，但上架所需能力不能被“后端不改”阻断。** 账号删除、举报/屏蔽、内容审核、风控/资金账本隔离、隐私请求等若当前后端不存在，必须以“新增且向后兼容”的 endpoint 或运营能力补齐；冻结现有 endpoint 不等于禁止新增合规接口。
9. **付费域必须前置一个 `Wallet Core`。** 任何礼物、红包、朋友圈/短剧/Agent 解锁接入前，先完成账户级余额、账本语义、StoreKit 交易确认、幂等与统一失效；提现、广告奖励和用户间资金流再作为高风险子域单独过 Gate。
10. **聊天、朋友圈、短剧创作和 Agent 内容都属于内容安全范围。** 首次正式提交前必须具备过滤、举报、屏蔽、客服联系方式、审核处置流程、账号删除、隐私政策和年龄分级；只做客户端入口而没有服务端/运营闭环不算完成。
11. **首版必须主动收敛。** 推荐以“登录 + 基础消息 + 只读/轻互动内容 + 文本 Agent（可选）”建立上架候选；群通话、创作者付费、提现/USDT、广告奖励、红包/转账只有在各自的产品、法律、支付和后台 Gate 通过后才进入生产开关。

### 建议的新 App 主结构

```text
NewApp
├─ Auth：登录 / 注册 / 启动验签 / 会话恢复
├─ Messages
│  ├─ 统一会话列表
│  ├─ 人与人私聊
│  ├─ 群聊（若保留完整消息页则为条件必选）
│  ├─ Agent 会话与 Agent 创建/编辑
│  └─ 音视频通话（可独立开关）
├─ Video
│  ├─ 通用视频消息与播放器
│  ├─ 短剧浏览与互动
│  └─ 短剧创作者工作室
├─ Moments
│  ├─ 推荐
│  ├─ 关注
│  ├─ 发布/互动/通知
│  └─ 付费媒体
└─ Wallet
   ├─ 余额 / 流水 / 充值 / 提现
   ├─ 广告奖励
   ├─ 礼物
   ├─ 红包 / 转账
   └─ 付费内容结算桥
```

---

## 2. 硬约束与范围

### 2.1 必须迁移

- 登录、注册、启动验签、access/refresh token、Keychain、登出。
- 消息列表、人与人聊天、Agent 会话和 Agent 各种现有互动。
- 群聊：当前统一消息页实际会返回和打开群聊。若新项目保留“完整消息页”，群聊属于条件必选。
- 视频消息、通用播放器、短剧/短视频、短剧工作室。
- 朋友圈推荐、关注、发布、点赞、评论、通知、付费媒体。
- 钱包余额、流水、IAP、提现、广告奖励、礼物、红包/转账和各场景付费解锁。
- WebSocket、APNs、Notification Service Extension、SQLite、本地缓存、outbox、媒体缓存、后台上传。
- 现有本地化和实际被使用的 Assets。

### 2.2 接口兼容硬约束

以下内容不应因客户端重构而改变：

- API Base URL 和路径拼接语义。
- HTTP method。
- query、JSON、multipart 字段名。
- `{ code, message, data }` 响应包装及 `code` 的 Int/String 兼容。
- `Authorization: Bearer {token}`。
- 现有 `Idempotency-Key` 使用位置和稳定值来源。
- Message/Agent/Moment/ShortDrama/Wallet 的 camelCase、snake_case、旧别名和多层 envelope 兼容。
- WebSocket 连接、心跳、重连和事件 envelope。
- 相对媒体路径、`/api/...` 路径、绝对 URL 的兼容解析。

### 2.3 不在本次范围内

- 不破坏性重设计现有服务端协议，不修改既有 endpoint 或字段语义。
- 允许为上架必需能力增加向后兼容接口或后台能力，例如账号删除、举报/屏蔽、内容审核、隐私请求、TLS 入口与资金风控；这些必须单独建立后端 contract 和验收，不得假装由客户端单独完成。
- 不假设后端已支持文档中提出但代码没有使用的新能力。
- 不把安全/合规建议误写成已上线事实。
- 在新项目路径、Bundle ID、App Store Connect app 尚未确定前，不直接创建新 Xcode 工程。

---

## 3. 当前工程基线

### 3.1 技术与工程配置

| 项目 | 当前值 |
|---|---|
| UI | SwiftUI 为主，UIKit `UITabBarController + UINavigationController` 导航壳 |
| 架构 | MVVM，但大量 `.shared` 全局单例 |
| Deployment Target | iOS 16.0 |
| App Store 构建基线 | Xcode 26+、iOS 26 SDK+；Deployment Target 仍可为 iOS 16 |
| Swift Language Mode | Swift 5 |
| API | `http://52.193.78.191/api/v1`（仅现状兼容，生产发行前必须迁到 HTTPS） |
| WebSocket | `ws://52.193.78.191/ws`（仅现状兼容，生产发行前必须迁到 WSS） |
| LiveKit | `http://52.193.78.191/livekit`（仅现状兼容，生产发行前必须迁到 TLS） |
| 主 Bundle ID | `com.bwchat.app` |
| Notification Extension | `com.bwchat.app.NotificationService` |
| APNs entitlement | production |

解析到的包版本：

- LiveKit 2.15.1。
- SwiftProtobuf 1.35.1（间接依赖）。
- Google Mobile Ads 13.6.0。
- Google User Messaging Platform 3.1.0。

### 3.2 当前代码规模与耦合

| 文件 | 行数约 |
|---|---:|
| `Services/APIService.swift` | 4,325 |
| `Views/ChatView.swift` | 2,000 |
| `Views/GroupChatView.swift` | 2,254 |
| `Views/MomentsView.swift` | 2,094 |
| `Views/WalletView.swift` | 1,923 |
| `Views/ShortDramaFeedView.swift` | 1,631 |
| `ViewModels/ChatViewModel.swift` | 1,462 |
| `ViewModels/GroupChatViewModel.swift` | 1,599 |
| `Services/BackgroundUploadCoordinator.swift` | 1,049 |

主要单例调用量很高：`APIService.shared`、`AuthManager.shared`、`ImageCacheManager.shared`、`AppCacheRepository.shared`、`OutgoingStore.shared`、`WebSocketService.shared`、`WalletStore.shared` 等被跨模块直接访问。这是新工程需要处理的首要客户端耦合，但不应在第一阶段同时重写全部业务行为。

### 3.3 当前根生命周期

- `BWChatApp.swift` 管理 Splash、全局通话覆盖层、scenePhase、远程配置、钱包刷新、后台上传激活。
- `SplashScreen.swift` 决定登录页或主界面，执行 token 验签和 refresh。
- `MainTabView.swift` 使用动态 Tab 配置，消息 badge 与朋友圈 badge 从 `UnreadBadgeStore` 读取。
- `UIKitNav.swift` 为每个 Tab 建立 UIKit 导航栈，以解决 iOS 新版 Tab bar push/pop 动画问题。
- AppDelegate 负责 APNs 注册、push 点击、前台通知抑制、后台 URLSession 回调、通话邀请。

### 3.4 当前构建基线验证

2026-07-22 使用 Xcode 26.5 SDK 对当前工作树执行了不签名的 Debug、通用 iOS Simulator 构建，arm64 + x86_64、主 App 与 Notification Service Extension 均成功；随后同 DerivedData 的 quiet 增量构建也成功且未输出 warning。上一轮记录的 `GroupChatView.swift` x86_64 失败在当前工作树上未复现，应视为已被当前代码变化或构建环境消除，不能继续写成现存编译事实。

该结果只证明当前 Debug Simulator 可编译，不证明以下发行基线：Release Archive、Distribution signing、真机安装/权限、APNs、NSE 运行、StoreKit Sandbox、后台 URLSession、测试 target、提交校验、崩溃/性能和 App Review metadata。Phase 0 仍必须固定 commit/hash，在空 DerivedData 的 CI 中保存完整日志，并分别验证 Debug、Release、Tests、Extension 与真机。

---

## 4. 推荐的新工程模块边界

新工程建议用一个 App target + 若干本地 Swift Package/Framework target。最低系统继续保持 iOS 16 时，应继续使用 `ObservableObject/@StateObject`；若提高到 iOS 17 才考虑 Observation。

```text
Packages/
├─ AppCore
│  ├─ AppConfiguration
│  ├─ FlexibleDecoding
│  ├─ LocalizationTheme
│  ├─ Navigation
│  └─ AccountScope
├─ AuthKit
│  ├─ AuthDomain
│  ├─ AuthAPI
│  ├─ AuthSessionStore
│  └─ KeychainTokenStore
├─ Networking
│  ├─ HTTPClient
│  ├─ APIEnvelope
│  ├─ AuthRefreshCoordinator
│  ├─ Multipart
│  └─ MediaURLResolver
├─ Realtime
│  ├─ WebSocketClient
│  ├─ PushService
│  ├─ UnreadStore
│  └─ NotificationRouting
├─ Persistence
│  ├─ MessageStore
│  ├─ SnapshotCache
│  ├─ DraftStore
│  └─ AccountEncryption
├─ MediaCore
│  ├─ ImageCache
│  ├─ VideoCache
│  ├─ VideoPlayer
│  ├─ Thumbnail
│  └─ PhotoLibrarySaver
├─ Outbox
│  ├─ OutgoingStore
│  ├─ OutgoingFileStore
│  ├─ BackgroundUploadTransport
│  ├─ JobExecutorRegistry
│  └─ Reconciliation
├─ MessagingFeature
├─ AgentFeature
├─ CallsFeature
├─ MomentsFeature
├─ ShortDramaFeature
├─ WalletFeature
├─ ChatMoneyFeature
├─ GiftFeature
└─ PaidContentBridge
```

### 4.1 依赖方向

```text
AppShell
  ├─ AuthKit ──> Networking
  ├─ MessagingFeature ──> Networking / Realtime / Persistence / MediaCore / Outbox
  ├─ AgentFeature ──> Networking / MediaCore / WalletBridge
  ├─ MomentsFeature ──> Networking / MediaCore / Outbox / WalletBridge / ProfileBridge
  ├─ ShortDramaFeature ──> Networking / MediaCore / Outbox / WalletBridge / ProfileBridge
  └─ WalletFeature ──> Networking / StoreKit / RewardedAds
```

依赖规则：

- Feature 不直接访问其他 Feature 的具体 View 或 `.shared`。
- Feature 之间通过小协议桥接，如 `WalletBalanceProviding`、`WalletRouting`、`ProfileRouting`、`AuthSessionProviding`。
- 网络层保留原接口 wire contract，Feature API 只做类型化 facade。
- 不把 DM `Message` 和 Agent `AgentMessage` 合并成一个“万能消息模型”。

以上规则必须从 Phase 1 开始执行，不能把依赖注入推迟到最后。新工程只允许 `AppCompositionRoot` 创建长生命周期依赖；迁移期可以注入包住旧单例的 Legacy Adapter，但 Feature 新代码不得直接访问 `.shared`。依赖按生命周期分为：

| Scope | 典型依赖 | 销毁/切换条件 |
|---|---|---|
| Process | Environment、匿名 Transport、Logger、Clock、FeatureFlag bootstrap | 进程结束 |
| Account | Session、AuthorizedHTTPClient、Message/Wallet Repository、WS、Outbox、账号媒体索引 | logout / 换号立即失效 |
| Scene | 每 Tab Navigation、全局 modal、当前展示会话 | scene 结束 |
| Feature | ViewModel、编辑器、单次加载/提交 task | 页面或操作结束 |

`AccountContext` 至少包含 `userID + epoch + namespace + cacheKeyReference`。每次登录、恢复或切换账号都生成新 epoch；所有网络、WebSocket、后台上传和异步任务在落库或发布 UI 前必须再次校验 epoch，迟到的旧账号结果只能丢弃。

鉴权依赖不得形成 `AuthKit ↔ Networking` 循环。目标方向应为：

```text
TransportCore（无鉴权 URLSession）
  → AuthRemoteAPI（anonymous client）
  → SessionCoordinator（Keychain + refresh single-flight）
  → AuthorizedHTTPClient
  → Domain API / Repository
  → Feature
```

Wire DTO、Persistence Record、Domain Entity、View State 必须分层转换；兼容 camelCase/snake_case/旧 envelope 的逻辑只存在于 Wire DTO/Adapter，不继续污染 UI 和领域模型。

---

## 5. 登录与注册

### 5.1 核心文件

- `BWChat/Views/SplashScreen.swift`
- `BWChat/Views/LoginView.swift`
- `BWChat/Views/RegisterView.swift`
- `BWChat/ViewModels/AuthViewModel.swift`
- `BWChat/Managers/AuthManager.swift`
- `BWChat/Utils/KeychainHelper.swift`
- `BWChat/Models/User.swift`
- `BWChat/Services/APIService.swift` 的 Auth 和自动 refresh 部分。
- `BWChat/Services/PushService.swift`
- `BWChat/Services/WebSocketService.swift`
- `BWChatTests/AuthSessionTests.swift`

### 5.2 实际流程

#### 登录

```text
LoginView
  → AuthViewModel.login
  → POST /auth/login
  → token + refresh_token + user
  → AuthManager.login
  → access/refresh 写 Keychain
  → currentUser 写缓存
  → 设置 MessageStore owner
  → 最后才发布 isLoggedIn = true
  → 连接 WebSocket
  → 请求 APNs 权限并上传 device token
```

#### 注册

```text
RegisterView
  → username 最少 3 位
  → password 最少 6 位且两次一致
  → POST /auth/register
  → 后续与登录相同
```

#### 冷启动恢复

```text
Keychain 有 access token
  ├─ 有 cached user：先进入已登录界面，再异步 verify
  └─ 无 cached user：先 verify
verify 失败
  → POST /auth/refresh
  → 更新 token/user
refresh 失败
  → logout
```

### 5.3 必须冻结的接口

| 方法 | 路径 | 关键字段 |
|---|---|---|
| POST | `/auth/login` | `username`, `password`, `device_token?` |
| POST | `/auth/register` | `username`, `password`, `nickname?`, `device_token?` |
| GET | `/auth/verify` | Bearer；返回 `data.user` |
| POST | `/auth/refresh` | `refresh_token`；返回 `token`, `refresh_token`, `user` |
| POST | `/auth/logout` | Bearer |
| POST | `/auth/change-password` | `old_password`, `new_password` |
| POST | `/push/device-token` | `device_token` |

### 5.4 Token 与账号隔离要求

- Access token Keychain key：`jwt_token`。
- Refresh token Keychain key：`jwt_refresh_token`。
- Token 输入要去空白并移除重复 `Bearer ` 前缀。
- Authorization 只由一个 authorizer 构造，refresh 后重放必须覆盖旧 header。
- Keychain accessibility 当前为 `AfterFirstUnlockThisDeviceOnly`。
- 登录时 token 必须可读后再发布 `isLoggedIn=true`。
- logout 要清 token、当前用户、WebSocket、未读和账号内存状态。
- 账号级 SQLite/cache/outbox key 必须包含 userID，切换账号不能串数据。
- 仅在 key 中包含 userID 仍不足够；请求、WS、后台 task 和 callback 还必须绑定 `AccountContext.epoch`，旧 epoch 的异步结果不得落库或更新 UI。
- 401 的 refresh 要合并并发请求，避免多个 refresh 同时发生。
- 网络错误、5xx、解码错误不能误清登录态。
- cached user 只能进入 `restoring` 或受限的 `offlineAuthenticated` 状态；verify/refresh 完成前禁止提现、转账、付费解锁等不可安全重放的 mutation。
- logout 必须按“先失效 context → 停 WS/取消账号任务 → 解绑 push/后台任务 → 清内存投影 → 按策略清本地数据 → 最后发布未登录状态”的有序事务执行。

### 5.5 资源与本地化

- `auth_cat_idle`
- `auth_cat_peek`
- `auth_cat_cover`
- `AuthPortraitBackdrop` 当前存在，但需按实际 UI 引用决定是否迁移。
- `auth.*`、`splash.*`、`password.*`、`api.*` 和通用 key。
- 当前 10 套语言：zh-Hans、zh-Hant、en、ja、ko、de、es、fr、pt-BR、ru。

---

## 6. 消息页：人与人聊天与 Agent 互动

## 6.1 统一会话列表

### 核心文件

- `Views/ContactListView.swift`
- `ViewModels/ConversationListViewModel.swift`
- `Models/Conversation.swift`
- `Utils/UIKitNav.swift`
- `Views/MainTabView.swift`

### 实际数据来源

统一列表并发合并：

- `GET /chat/conversations`
- `GET /agent-conversations`
- `GET /agents/installed`
- 本地 Conversation snapshot。
- WebSocket 新消息预览。
- 本地草稿预览。

稳定 identity：

- `dm:{id}`
- `group:{id}`
- `agent:{conversationID}`
- `agent-profile:{agentID}`

点击行会分派到 DM、群聊、Agent 或剧本房。因此保留完整列表时，群聊不能只复制列表而不迁目标页。

## 6.2 人与人私聊

### 核心文件闭包

- `Views/ChatView.swift`
- `ViewModels/ChatViewModel.swift`
- `Models/Message.swift`
- `Views/MessageBubble.swift`
- `Components/ReplyPreviewBar.swift`
- `Components/StickerViews.swift`
- `Models/Sticker.swift`
- `Components/GiftViews.swift`
- `Models/Gift.swift` 中礼物和共享钱包模型。
- `Components/ChatMoneyViews.swift`
- `Components/ChatMoneyComposerViews.swift`
- `Components/ChatMoneyDetailViews.swift`
- `Models/ChatMoney.swift`
- `Services/ChatMoneyStore.swift`
- `Models/ChatBatchActions.swift`
- `Components/ChatBatchActionViews.swift`
- `Views/ImagePreviewView.swift`
- `Views/VideoPlayerView.swift`
- `Components/VideoThumbnailView.swift`
- `Components/AvatarView.swift`
- `Services/ChatAppearanceStore.swift`
- `Views/ChatBackgroundSettingsView.swift`

### 消息类型事实

| 类型 | 发送 | 展示 | 说明 |
|---|---:|---:|---|
| text | 是 | 是 | 复制、引用、撤回、转发、收藏 |
| image | 是 | 是 | 多选、后台上传、gallery、保存 |
| video | 是 | 是 | 多选、后台上传、播放、保存 |
| voice | 是 | 是 | m4a；当前恢复能力弱于 image/video |
| sticker | 是 | 是 | 远程 pack + asset manifest |
| emoji | 是 | 作为 text | 不是独立消息类型 |
| gift | 是 | 是 | 礼物目录、余额校验 |
| red_packet | 是 | 是 | 领取、详情、回执、隐私裁剪 |
| transfer | 是 | 是 | 接收、退回、详情、回执 |
| system | 服务端 | 是 | 居中提示 |
| recalled | recall API | 是 | 本人文本支持重新编辑 |
| chat_history / forward_bundle | 是 | 是 | 逐条/合并转发 |
| 通话记录 | 作为 text | 是 | 旧协议文本解析 |
| 文件附件 | 否 | 否 | 当前无完整 API/气泡链 |
| 位置 | 否 | 否 | 当前无聊天位置消息 |
| 联系人卡片 | 否 | 否 | 当前不存在 |

### DM HTTP 接口

| 方法 | 路径 | 关键 contract |
|---|---|---|
| GET | `/chat/contacts` | `data.contacts` |
| GET | `/chat/conversations` | `data.conversations` |
| GET | `/chat/messages/{contactID}` | `before_id`, `after_id`, `limit`; `messages`, `has_more` |
| GET | `/chat/messages/{contactID}/{messageID}/context` | `before`, `after` |
| POST | `/chat/messages/{contactID}/{messageID}/recall` | 空 JSON；返回 Message |
| POST | `/chat/messages/{contactID}/read` | 空 JSON |
| POST | `/chat/messages/text` | `receiver_id`, `content`, `reply_to_id?`, `client_message_id?` |
| POST | `/chat/messages/sticker` | `receiver_id`, `pack_id`, `sticker_id`, `reply_to_id?` |
| POST multipart | `/chat/messages/image` | `receiver_id`, `client_message_id?`, `image` |
| POST multipart | `/chat/messages/video` | `receiver_id`, `client_message_id?`, `video` |
| POST multipart | `/chat/messages/voice` | `receiver_id`, `duration`, `voice`; `audio/m4a` |
| GET | `/wallet/gifts/catalog` | 礼物目录 |
| POST | `/chat/messages/gift` | `receiver_id`, `recipient_id`, `gift_id` |

### Message 必须兼容的主字段

- `id: Int`
- `sender_id`
- `receiver_id`
- `msg_type`
- `content`
- `timestamp`
- `reply_to_id?`
- `reply_to?`
- `client_message_id?`
- `version`
- `updated_at?`

Decoder 还接受 camelCase、`message_id`、`from_user_id`、`recipient_id`、`created_at`、`type`、`payload/gift` 等旧字段。第一阶段不能“清理”这些兼容分支。

### 一致性链路

```text
打开 DM
  → 先从 SQLite MessageStore 恢复
  → 恢复本地 outbox pending
  → HTTP 增量同步/分页
  → WebSocket 接收 new_message
  → client_message_id + delivery matcher 去重
  → 更新会话预览、未读、水位和 SQLite
```

`APIService + MessageStore + OutgoingStore + WebSocket + ConversationList unread reconciliation` 是迁移中最重要的一致性闭包。

## 6.3 群聊条件闭包

若保留统一消息页中的群聊：

- `Views/GroupChatView.swift`
- `ViewModels/GroupChatViewModel.swift`
- `Models/Group.swift`
- `Components/MentionPickerView.swift`
- 群成员/群详情/群通话相关 View 和 ViewModel。

DM 支持引用但没有 @mention；群聊支持 mentions。若新产品明确不需要群聊，则必须同时过滤 group row、移除 group push/deep-link 和死路由。

## 6.4 Agent 聊天

### 核心文件

- `Views/AgentChatView.swift`
- `ViewModels/AgentChatViewModel.swift`
- `Views/AgentMessageView.swift`
- `Models/AgentModels.swift`
- `Views/AgentHubView.swift`
- `ViewModels/AgentCatalogViewModel.swift`
- `Views/AgentCreatorView.swift`
- `ViewModels/AgentCreatorViewModel.swift`

### Agent 与 DM 的本质差异

| 能力 | DM | Agent |
|---|---|---|
| 主 ID | Int Message ID | String message/turn ID + sequence |
| 实时 | WebSocket | 当前无 Agent WS |
| 持久消息 | SQLite MessageStore | 当前仅内存 + 重拉服务端 |
| 发送 | 直接消息 endpoint | 创建 turn |
| 结果 | HTTP + WS echo | 每秒轮询 turn |
| outbox | text/image/video 有 | 当前无完整持久 outbox |
| 草稿 | 有 | 当前无同等级草稿 |
| 未读 | 有 | 列表固定 0 |
| 付费媒体 | 无 Agent 语义 | locked/generated/unlock |

### Agent API

| 方法 | 路径 | 关键字段 |
|---|---|---|
| GET | `/agents/runtime-config` | `features`, `vision`, `paid_media` |
| GET | `/agents/public` | `owner_user_id?`, `cursor?`, `limit` |
| GET | `/agents/installed` | `agents` 或 `items` |
| GET | `/agents/{id}` | 兼容 direct 与 `data.agent/draft/item` |
| POST/DELETE | `/agents/{id}/install` | 安装/卸载 |
| POST | `/agent-conversations` | `agent_id`, `greeting_id`; Idempotency-Key |
| GET | `/agent-conversations` | conversations/items |
| GET | `/agent-conversations/{id}` | 多层 envelope |
| GET | `/agent-conversations/{id}/messages` | `before_sequence?`, `limit` |
| POST multipart | `/agent-assets/images` | JPEG image；Idempotency-Key；返回 `asset_id` |
| POST | `/agent-conversations/{id}/turns` | `client_message_id`, `parts`, `reply_to_id?`; Idempotency-Key |
| GET | `/agent-turns/{id}` | turn + response_message |
| POST | `/agent-media/{id}/unlock` | 空 JSON；Idempotency-Key |
| GET | Agent media path | Bearer；Range |

发送 parts 当前仅有：

```json
{"type":"text","text":"..."}
{"type":"input_image","asset_id":"..."}
```

### Agent 调用链

```text
会话行
  → 读取/创建 agent conversation
  → 并发 runtime config + wallet balance + messages
  → 选图时上传得到 asset_id
  → POST turn
  → 合并 accepted.message
  → 每 1 秒 GET turn，最长 20 分钟
  → completed / completed_with_errors / failed
  → paid_media ready_locked 时 unlock
  → 更新余额并重拉消息
```

现有响应包含 `events_url`，但客户端没有使用。第一阶段继续轮询才能保持现有行为；未来可消费 `events_url`，但轮询必须保留为兼容 fallback。

Agent 生成视频虽然有模型能力字段，但当前 UI 没有完整支持，不能在迁移验收中误报为已实现。

## 6.5 WebSocket、APNs 与未读

### WebSocket contract

- URL：`ws://52.193.78.191/ws?token={token}`。
- 每 15 秒发送 `{"type":"ping"}`。
- 期待 `pong`。
- 事件 envelope：`{"type":"event_name","data":{...}}`。
- 最大重连退避 30 秒。
- close code 4001、token reason、特定握手失败会触发 refresh。

关键入站事件：

- `new_message`
- `new_group_message`
- `contact_update`
- `group_contact_update`
- `chat_reset`
- `cache_cleanup`
- `chat_money_updated`
- `user_status`
- `call_invite` / `call_offer`
- `call_answer`
- `ice_candidate`
- `call_end` / `call_reject` / `call_busy`
- `group_call_invite` / `group_call_ended`

Agent 当前没有订阅 WebSocket 事件。

WebSocket 与 APNs 都只能作为“可能有变化”的同步提示，不是持久事实源。重连、push 唤醒或检测到序列缺口后必须执行 HTTP authoritative reconciliation；UI 不应在 ViewModel 中分别拼接 HTTP、WS、SQLite 和 pending 数组，而应统一进入 `MessageRepository/Ingestor`，由数据库 observation 驱动 timeline、会话预览与未读。

去重优先级为 `(accountID, client_message_id)`，其次为 server ID；乱序裁决只能使用后端明确承诺的 `version/sequence/server order`，不得把本地时间或未经确认单调递增的 ID 当同步水位。

### APNs contract

- DM 深链依赖 `sender_id`。
- 群聊依赖 `group_id`，mention 依赖 `is_mention`。
- 朋友圈互动 push 使用 `push_type=moments_update`。
- Notification Service Extension 处理图片/贴纸丰富通知。
- 当前正在查看对应会话时会抑制前台 banner。
- `UnreadBadgeStore` 以会话字典聚合 badge，不能把 APNs 总 badge 直接覆盖本地分会话状态。

---

## 7. 视频能力

“视频”应拆为：视频消息、通用播放/缓存、短剧、实时通话。

## 7.1 视频消息

### 文件

- `Models/Message.swift`
- `Views/MessageBubble.swift`
- `Views/ChatView.swift`
- `ViewModels/ChatViewModel.swift`
- `Views/GroupChatView.swift`
- `ViewModels/GroupChatViewModel.swift`
- `Views/VideoPlayerView.swift`
- `Components/VideoThumbnailView.swift`
- `Components/MediaPickerPreview.swift`
- `Managers/MediaCacheManager.swift`
- `Services/BackgroundUploadCoordinator.swift`

### 上传协议

- DM：`POST /chat/messages/video`，`receiver_id`、`client_message_id`、multipart `video`。
- Group：`POST /groups/{groupID}/messages/video`，`client_message_id`、multipart `video`。
- `.mov` → `video/quicktime`。
- `.m4v` → `video/x-m4v`。
- 其他 → `video/mp4`。

### 现有风险

- DM/群聊从 PhotosPicker 取视频后会 `Data(contentsOf:)` 整段读入内存，大视频可能 OOM。
- 新项目应直接让 outbox 接管文件 URL，但 wire contract 不变。
- UI 缺少统一的视频大小、时长、格式和压缩约束。

## 7.2 通用播放和缓存

### `VideoPlayerView`

- AVKit 全屏播放。
- 静音键下可播放。
- 下拉关闭。
- 播放 5 秒后调度缓存。
- 本地缓存优先。
- 网络错误监听不完整，真实播放失败可能黑屏。

### `MediaCacheManager`

- MP4 background URLSession。
- HLS `AVAssetDownloadURLSession`。
- 支持 MP4 和 `.movpkg`。
- 账号隔离目录：`Application Support/BWChat/Media/{account-hash}`。
- 排除 iCloud；文件保护为 `completeUntilFirstUserAuthentication`。
- 低于 2 GB 可用空间时拒绝新下载。
- 30 天未访问淘汰。
- 自适应 LRU 预算约 512 MB–5 GB。

迁移要修复：AppDelegate 当前只转发上传后台 session，没有完整转发 MediaCache MP4/HLS session 的恢复回调。

## 7.3 短剧/短视频

### 核心文件

- `Models/ShortDrama.swift`
- `ViewModels/ShortDramaFeedViewModel.swift`
- `Views/ShortDramaSeriesListView.swift`
- `Views/ShortDramaFeedView.swift`
- `Views/ShortDramaVideoPage.swift`
- `Views/ShortDramaActionRail.swift`
- `Views/ShortDramaCommentsSheet.swift`
- `Views/ShortDramaUnifiedEditorView.swift`

### API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/short-drama/series` | `filter`, `creator_user_id?`, `cursor`, `limit` |
| GET | `/short-drama/feed` | cursor feed |
| GET | `/short-drama/mine` | 我的作品 |
| POST | `/short-drama/series` | 创建系列 |
| PATCH | `/short-drama/series/{id}` | 更新系列 |
| GET | `/short-drama/series/{id}` | 系列详情 |
| POST multipart | `/short-drama/series/{id}/episodes` | 剧集、封面、视频、价格、client IDs |
| PATCH | `/short-drama/videos/{id}` | 更新剧集 |
| POST | `/short-drama/series/{id}/submit` | `client_request_id` |
| POST | `/short-drama/videos/{id}/unlock` | 解锁 |
| DELETE | `/short-drama/videos/{id}` | 删除 |
| POST/DELETE | `/short-drama/videos/{id}/like` | 点赞 |
| POST/DELETE | `/short-drama/videos/{id}/favorite` | 收藏 |
| GET/POST | `/short-drama/videos/{id}/comments` | 评论 |
| POST | `/short-drama/videos/{id}/progress` | `position_seconds`, `duration_seconds` |

### 浏览和播放

- 推荐/看过系列各自 cursor。
- 竖向 `UIPageViewController`。
- 当前/前一个/后一个最多保留 3 个播放器。
- 播放源优先 HLS，再 MP4/play URL 回退。
- 首帧前保留封面。
- 点赞、收藏、关注乐观更新。
- 评论 cursor 分页和乐观插入。
- 解锁后同步钱包快照。
- 观看进度在切页、暂停、后台和退出时提交。

重要缺陷：`ShortDramaFeedViewModel.normalizedVideos` 当前无条件按 episode/id 排序，会破坏全局推荐 Feed 的服务端顺序。新项目只应在单系列上下文排序；推荐 Feed 必须保留服务端顺序。接口不需要改变。

### 创作者工作室

- 最多 20 集。
- 视频直接复制到 outbox，避免 Data 中转。
- 每次最多并发上传 2 集。
- 全部成功后 submit。
- 支持草稿、处理、审核、发布、拒绝、失败。
- 当前短剧在杀进程后主要依赖用户重新进入 Studio/resume，并非完整无感恢复。

## 7.4 实时音视频通话

若“视频功能”包括实时通话，必须迁移：

- `Models/Call.swift`
- `Managers/CallManager.swift`
- `Views/CallView.swift`
- `Views/GroupCallView.swift`
- `BWChatApp.swift` 全局通话覆盖层/PiP。
- `WebSocketService.swift` 呼叫信令。
- `APIService.swift` `/call/...` 接口。
- LiveKit、Camera/Microphone 权限、background audio。

通话与视频消息/短剧没有共享上传和播放管线，建议单独 `CallsFeature`。

---

## 8. 朋友圈：推荐与关注

## 8.1 核心文件

- `Models/Moment.swift`
- `ViewModels/MomentsViewModel.swift`
- `Views/MomentsView.swift`
- `Views/CreateMomentView.swift`
- `Views/DiscoverView.swift` 中的 `MomentsNotificationManager`
- `Views/UserProfileView.swift`
- `ViewModels/UserProfileViewModel.swift`
- `Managers/ImageCacheManager.swift`
- `Managers/MediaCacheManager.swift`
- `Services/BackgroundUploadCoordinator.swift`
- `Views/VideoPlayerView.swift`

## 8.2 推荐与关注真实映射

| UI | 实际接口 | 缓存策略 |
|---|---|---|
| 推荐 | `GET /moments/world` | 账号级 snapshot，TTL 2 分钟，最多 200 条 |
| 关注 | `GET /moments/feed` | 账号级 snapshot，TTL 2 分钟；弱网时展示 stale 内容，服务端仍负责关注过滤与排序 |
| 用户动态 | `GET /moments/user/{userID}` | 账号级 snapshot |

关注 Feed 不在客户端二次过滤作者，并保持服务端排序。推荐、关注和用户动态都支持账号级离线快照；未被服务端以 `snapshot_complete: true` 确认的空第一页不能覆盖本地非空快照。

分页参数：`before_id`、默认 `limit=20`；按 Moment ID 去重。

## 8.3 功能范围

- 纯文字。
- 图片、视频或混合媒体，最多 9 个。
- 推荐/关注/用户动态。
- 点赞和点赞列表。
- 评论、回复、评论图。
- 发布、乐观本地投影、失败重试、删除待发。
- 付费媒体和钱包解锁。
- 通知 badge、通知列表、已读、详情。
- 用户主页跳转。
- 图片 gallery、视频播放、保存。

## 8.4 API

| 功能 | 接口 |
|---|---|
| 关注 Feed | `GET /moments/feed?limit=&before_id=` |
| 推荐 Feed | `GET /moments/world?limit=&before_id=` |
| 发布 | `POST /moments/create` multipart |
| 解锁 | `POST /moments/{id}/unlock` |
| 用户动态 | `GET /moments/user/{userID}` |
| 点赞 | `POST /moments/{id}/like` |
| 评论/回复/评论图 | `POST /moments/{id}/comment` multipart |
| 删除 | `DELETE /moments/{id}` |
| 未读 | `GET /moments/notifications/unread` |
| 通知列表 | `GET /moments/notifications/list?limit=50` |
| 通知已读 | `POST /moments/notifications/read` |
| Feed viewed | `POST /moments/feed/viewed` |
| 详情 | `GET /moments/detail/{id}` |

发布字段：

- `content`
- `client_request_id`
- `unlock_price_cat_food`
- 多个同名 multipart `media`

## 8.5 乐观发布与 outbox

```text
CreateMomentView
  → 图片压缩 / 视频文件暂存
  → OutgoingJob(scene=moment)
  → 本地负数 temp Moment 立即显示
  → background URLSession multipart upload
  → 服务端返回真实 Moment
  → temp ID 替换为 server ID
  → 本地媒体采用到 Image/Media Cache
```

现有实现最多重试 5 次，指数退避封顶 30 秒；`confirmationUnknown` 不会直接判失败。

风险：后台 URLSession 可以继续传输，但 App 被杀后内存闭包消失，无法自动完整重建“解析响应 → 替换 temp Moment”的业务闭包。新项目要加入按 scene 恢复的 executor registry，同时不改变 `/moments/create` 协议。

---

## 9. 钱包

## 9.1 实际钱包范围

1. 猫币余额、总余额、充值/领取可用余额。
2. 流水。
3. StoreKit 2 消耗型 IAP。
4. USDT 提现、记录和取消。
5. AdMob 激励广告。
6. 私聊/群聊礼物。
7. 私聊/群聊红包和转账。
8. 朋友圈付费媒体解锁。
9. 短剧分集解锁。
10. Agent 生成媒体解锁。
11. WebSocket 钱包/ChatMoney 状态同步。

## 9.2 核心文件

- `Services/WalletStore.swift`
- `Views/WalletView.swift`
- `Models/Gift.swift`
- `Services/AdRewardService.swift`
- `Models/ChatMoney.swift`
- `Services/ChatMoneyStore.swift`
- `Components/ChatMoneyViews.swift`
- `Components/ChatMoneyComposerViews.swift`
- `Components/ChatMoneyDetailViews.swift`
- `Components/GiftViews.swift`
- `Services/APIService.swift` 钱包/付费 endpoint。
- `Services/WebSocketService.swift` ChatMoney 事件。
- Moment/ShortDrama/Agent 的 paid unlock adapter。

## 9.3 钱包 API

| 方法 | 路径 | 关键 contract |
|---|---|---|
| GET | `/wallet/balance` | 多种余额字段 |
| GET | `/wallet/transactions` | 游标分页加载全部金币历史；客户端不再设置总条数上限 |
| POST | `/wallet/ios-iap/confirm` | product/transaction/original/JWS/date/bundle/appAccountToken |
| POST | `/wallet/withdrawals` | amount/usdt_amount/network/address/payout_account |
| GET | `/wallet/withdrawals` | 提现记录 |
| POST | `/wallet/withdrawals/{id}/cancel` | 取消 |
| GET | `/wallet/ad-rewards/status` | 服务端权威状态 |
| POST | `/wallet/ad-rewards/sessions` | platform/ad_unit_id |
| GET | `/wallet/gifts/catalog` | 礼物目录 |
| POST | `/chat/messages/gift` | 私聊礼物 |
| POST | `/groups/{id}/messages/gift` | 群礼物 |
| GET | `/wallet/chat-money/config` | 红包/转账配置；失败关闭 |
| POST | `/wallet/red-packets` | 带 client_message_id |
| POST | `/wallet/transfers` | 带 client_message_id |
| GET | `/wallet/chat-money/{asset}` | 当前用户角色裁剪详情 |
| POST | `/wallet/red-packets/{asset}/claim` | 领取 |
| POST | `/wallet/transfers/{asset}/accept` | 接收 |
| POST | `/wallet/transfers/{asset}/return` | 退回 |
| POST | `/moments/{id}/unlock` | 朋友圈解锁 |
| POST | `/short-drama/videos/{id}/unlock` | 短剧解锁 |
| POST | `/agent-media/{id}/unlock` | Agent 解锁；Idempotency-Key |

## 9.4 余额模型事实

`WalletBalanceResponseData` 支持：

- `balance`
- `total_balance`
- `recharge_claim_balance`
- `cat_hair_balance`
- `cat_hair_frozen_balance`
- `withdrawable_cat_hair_balance`
- `locked_cat_hair_balance`

当前 UI 实际使用存在语义混用：

- 主余额使用 `balance`。
- 红包/转账可用使用 `rechargeClaimBalance ?? balance`。
- “创作者收益”和“可提现猫币”目前都使用 `totalBalance`。
- `catHair*` 被解码和缓存，但没有完整参与提现 UI。

新客户端可以修复状态所有权和 UI 字段映射，但不能在没有后端确认的情况下自行改变余额会计含义。上线前必须由现有接口负责人确认每个字段语义。

代码审计进一步确认：`WalletStore.withdrawableCatFoodBalanceForAction` 当前实际回退到 `totalBalance/balance`，并未优先使用已解码的显式可提现字段；USDT 地址仅以长度判定，地址保存在 `UserDefaults`；换算与 UI 校验使用 `Double`。这些在启用提现时全部升级为 P0。目标实现必须：

- `WalletRepository` 是余额、流水和资金 mutation 的唯一客户端入口；Feature 只能触发失效/重拉，不自行修改局部余额。
- 充值余额、奖励/创作者收益、冻结额、可提现额使用后端明确分离的账本 bucket，禁止把 IAP 购得余额误当作可提现资产。
- 金额内部使用整数最小单位或 `Decimal`，JSON 字段按旧 contract 精确编码。
- 提现地址进入 Keychain 或受保护加密存储，并按网络做 checksum/格式校验；服务端仍为最终校验者。
- 每个资金 mutation 有稳定业务 ID、服务端幂等和可查询终态；结果未知时停止自动重试并进入人工/用户确认流程。

## 9.5 IAP

当前商品：

- `com.bwchat.app.catfood.100`
- `com.bwchat.app.catfood.800`
- `com.bwchat.app.catfood.1800`
- `com.bwchat.app.catfood.3000`
- `com.bwchat.app.catfood.9800`
- `com.bwchat.app.catfood.19800`

流程：

```text
StoreKit Product.purchase
  → 本地 VerificationResult 验证
  → 发送 JWS 与 transaction metadata 到 /wallet/ios-iap/confirm
  → 后端确认成功
  → transaction.finish
  → 刷新余额与流水
```

- unfinished transaction 在启动和 `Transaction.updates` 重试。
- 409/响应含 already 会按已确认处理。
- 现有代码没有 `.storekit` 测试配置。
- 新 Bundle ID/App Store app 通常不能直接假设复用旧商品，需要在创建新工程前明确 App Store Connect 策略；接口路径仍可保持不变。

## 9.6 提现

- 当前换算：1 猫币 = 0.005 USDT。
- UI 最低 0.5 USDT，且按 0.5 倍数。
- 默认网络：TRC20/ERC20/BEP20，可由远程配置调整。
- 请求同时发送猫币 `amount` 和字符串 `usdt_amount`。
- 当前地址只校验网络非空和长度至少 12。
- 当前换算使用 `Double`/取整，应在客户端内部改用 Decimal/整数最小单位，但请求字段和值语义保持一致。

## 9.7 红包与转账

- 私聊红包。
- 群拼手气/等额/专属红包。
- 私聊或群指定对象转账。
- 配置加载失败即关闭，避免使用不确定限额。
- 红包公共消息刻意不携带金额。
- 详情按当前 JWT 用户返回 `can_claim/can_accept/can_return`。
- WebSocket 使用 version 拒绝重复/乱序状态。
- 本地收据防止 UI 重复操作，但资金幂等最终依赖现有后端行为。

## 9.8 广告奖励

- Google rewarded ad + UMP。
- 每日上限 10。
- 生产需远程钱包开关、feature flag、服务端 status 同时启用。
- 生产先创建服务端 session，再把 user/session 信息写到 AdMob SSV custom data。
- 客户端 rewarded callback 只做本地提示；真正入账预期由服务端 SSV 完成。

## 9.9 钱包迁移风险

- `WalletStore` 内存状态目前没有强制绑定 account identity，切账号/离线失败可能短暂显示上一账号数据。
- Agent 解锁只更新 Agent ViewModel 的余额，没有统一同步全局 WalletStore。
- 提现/IAP 后部分刷新可能命中旧缓存。
- 一些资金 POST 没有显式 Idempotency-Key。本次接口保持不变，客户端应保留现有业务 ID、按钮互斥和重试语义；如果要增强服务端资金幂等，需要另立后端任务，不能在本次迁移中假设已支持。
- 当前 HTTP/WS 与 ATS 全放开对资金业务是生产发行阻断项。切 HTTPS/WSS 需要服务端配合，但“客户端不能单方面完成”不构成上架豁免；服务端未提供 TLS 入口时钱包与鉴权流量不得进入公开生产。
- IAP 购买的虚拟货币、创作者收入和可提现/USDT 资产之间必须有法律、财务与 App Review 书面结论。无法证明来源隔离、地区许可和合规处理时，Release 默认关闭提现、转账、红包及相关入口。

---

## 10. 共享基础设施

## 10.1 HTTP Client

必须保留：

- 默认 request timeout 15 秒，resource timeout 120 秒。
- waitsForConnectivity。
- GET/HEAD 对 408/425/429/500/502/503/504 的有限重试。
- `Retry-After` 兼容。
- 401 refresh coalescing。
- refresh 后重新覆盖 Authorization。
- 取消不显示为业务错误。
- 统一 `{code,message,data}` 解码。
- 结构化错误和历史 error body 兼容。

建议把 4,325 行 `APIService` 客户端内部拆成：

- `AuthAPI`
- `MessagingAPI`
- `AgentAPI`
- `MomentsAPI`
- `ShortDramaAPI`
- `WalletAPI`
- `ChatMoneyAPI`
- `CallAPI`

这些 facade 仍调用同一 `HTTPClient` 并生成完全相同的请求。

## 10.2 Snapshot cache

`CacheRepository.swift` 当前提供：

- SQLite snapshot。
- 账号 scope。
- TTL + stale retention。
- 同请求合并。
- stale-while-revalidate。
- AES-GCM 账号级加密。
- Keychain 保存 256 位缓存密钥。
- Chat draft。

必须保留账号隔离和加密；要把 namespace 明确归属各 Feature。

## 10.3 MessageStore

- SQLite 路径：`Application Support/BBchat/messages.sqlite`。
- WAL。
- 文件保护。
- messages/group_messages/conversations/tombstone。
- ownerID 账号隔离。
- 本地删除 tombstone 防止历史同步复活。

## 10.4 Outbox 与后台上传

### 现有数据

- `OutgoingState`
- `OutgoingScene`: directMessage/groupMessage/moment/shortDrama
- `OutgoingJob`
- `OutgoingPart`
- SQLite `outgoing_jobs/outgoing_parts`
- 账号和 client request ID。
- 文件 staging、SHA-256、进度、重试和 server ID。

### 现有后台 session

- Identifier：`com.bbchat.outgoing.background-upload`。
- `sessionSendsLaunchEvents=true`。
- waitsForConnectivity。
- 每 host 最多 2 连接。

### 必修的客户端恢复能力

当前业务操作通过内存闭包 enqueue。App 被杀后 URLSession 可继续，但闭包消失，无法自动执行后续业务动作。新工程应增加：

- `OutgoingJobExecutorRegistry`。
- 按 scene 从 SQLite payload 重建 executor。
- App 启动 reconcile。
- `confirmationUnknown` 的现有接口兼容查询/重拉策略。
- 短剧逐集继续和最终 submit。
- 后台 URLSession completion handler 在落库/reconcile 后再结束。

Executor Registry 不能只按 scene 找回闭包，还必须为每种 mutation 登记重试安全等级：

| 等级 | 条件 | 自动恢复策略 |
|---|---|---|
| A | 有稳定 client ID / Idempotency-Key | 可按上限自动重放 |
| B | 无直接幂等，但可查询 server terminal state | 先查询确认，再决定是否重放 |
| C | 无幂等且不可查询 | 进入 `requiresUserResolution`，禁止自动重试 |
| F | 资金操作结果未知 | 停止重放，查询账本/工单处理，绝不按普通指数退避重复扣款 |

建议目标状态机：

```text
queued → preparing → uploading → awaitingAck → committed
                    ↘ confirmationUnknown → retryScheduled
                                           → requiresUserResolution
                                           → permanentlyFailed / canceled
```

每个 executor payload 必须持久化 account epoch、稳定 operation ID、endpoint scene、文件清理条件、最大重试、确认查询方法和用户可见恢复动作；不得持久化 access token、明文聊天内容摘要或完整提现地址。

这些都是客户端内部增强，不要求修改现有上传 endpoint。

## 10.5 媒体 URL

必须继续支持：

- `https://...` / `http://...` 绝对 URL。
- `/api/...` 从 API origin 拼接。
- 普通相对 path 从 apiBaseURL 拼接。
- 受保护媒体 Bearer。
- AVPlayer 的 Range 和 HLS/MP4 回退。

---

## 11. 资源、权限、Entitlements 与依赖

## 11.1 Info.plist

必须按实际保留：

- `NSPhotoLibraryUsageDescription`
- `NSPhotoLibraryAddUsageDescription`
- `NSCameraUsageDescription`（实时视频通话）
- `NSMicrophoneUsageDescription`（语音消息、通话）
- `UIBackgroundModes`: remote-notification, audio（若保留通话）
- `GADApplicationIdentifier`（若保留广告奖励）
- 当前 `NSAllowsArbitraryLoads=true` 只可作为现状/开发兼容记录；Release 必须移除全局放开并使用 HTTPS/WSS，否则为发行阻断项。

## 11.2 Entitlements 和 target

- 主 App `aps-environment=production`。
- Notification Service Extension target。
- Extension 自身 production APNs entitlement。
- 新 Bundle ID 下要重新配置 APNs profile 和 extension ID。

## 11.3 第三方依赖

| 依赖 | 用途 | 是否条件必选 |
|---|---|---|
| LiveKit | 1v1/群音视频通话 | 仅保留通话时 |
| GoogleMobileAds | 激励广告 | 仅保留广告奖励时 |
| GoogleUserMessagingPlatform | 广告 consent | 仅保留广告奖励时 |
| SwiftProtobuf/WebRTC/UniFFI | LiveKit 间接依赖 | 随 LiveKit |

消息、朋友圈、短剧的基础 HTTP/媒体能力主要使用系统框架。

## 11.4 直接相关 Assets

### Auth

- `auth_cat_idle`
- `auth_cat_peek`
- `auth_cat_cover`

### Wallet

- `wallet_gold_coin_badge`
- `wallet_gold_coin_background`
- `wallet_empty_cat`
- `wallet_cat_hair`

### Gift / Chat action

- `gift_fish`
- `gift_wand`
- `gift_yarn`
- `gift_can`
- `gift_tree`
- `gift_bell`
- `gift_whimsical_arrow`
- `message_action_cat_default`
- `message_action_cat_active`

朋友圈和短剧主要使用远端媒体、SF Symbols 和共享主题，没有必须复制的专属位图。

## 11.5 本地化

当前 10 套语言均应迁移，然后再做 key 裁剪：

- zh-Hans
- zh-Hant
- en
- ja
- ko
- de
- es
- fr
- pt-BR
- ru

不建议只复制中文。通话记录解析、错误文案、钱包、聊天操作和内容类型都依赖本地化 key。

---

## 12. 已确认风险与优先级

### P0：迁移前必须有明确处理方案

1. 后台 URLSession 杀进程后业务闭包不可完整重建。
2. DM/群聊大视频整段读入 Data，存在内存峰值。
3. 短剧全局推荐 Feed 被客户端 episode 排序破坏服务端顺序。
4. WalletStore 内存状态可能在账号切换/离线失败时串号。
5. 当前生产 API/WS 为 HTTP/WS，资金和 JWT 存在传输安全风险；客户端不能在服务端不支持时单方面切换。
6. `APIService + MessageStore + OutgoingStore + WebSocket + unread reconciliation` 必须作为整体迁移。
7. 新工程必须从 Phase 1 建立 Composition Root、AccountContext/epoch 和依赖注入；不能先复制 `.shared` 再到末期重构。
8. App 内账号删除、密码找回/恢复、UGC 举报/屏蔽/审核、客服联系方式与隐私政策尚未形成完整闭环。
9. `PrivacyInfo.xcprivacy` 当前不存在；Required Reason API、第三方 SDK manifest/signature、App Privacy 标签与 ATT/广告数据流尚未审计。
10. 远程配置虽定义 `killSwitch`，当前代码没有实际消费；高风险功能缺少可验证的客户端 + 服务端双重关闭能力。
11. Profile 当前展示举报/限制/拉黑按钮，但实际处理分支仅提示 unavailable；不能作为 UGC 合规能力验收。
12. Release/Debug 均硬编码同一个明文生产 IP，缺少 dev/staging/prod 隔离、secret/config 验证与生产 allowlist。
13. 钱包字段语义、IAP 余额与可提现/USDT 的来源隔离、资金结果未知处理未确认；启用任何资金写操作前必须关闭。
14. Agent 创建器允许 public + 成人互动并直接 publish/install，缺少年龄门控和审核状态；公开发行前必须默认关闭成人能力并建立服务端审核。

### P1：新项目首轮稳定后处理

1. AppDelegate 未完整路由媒体下载后台 session。
2. VideoPlayer 网络错误状态不完整。
3. Agent 没有本地消息缓存、outbox、草稿和实时未读；若首版启用 Agent，恢复/取消/超时属于该功能的 P0。
4. Agent `events_url` 未使用，轮询最长 20 分钟。
5. Agent 解锁余额和全局 WalletStore 不一致。
6. 朋友圈乐观时间格式与相对时间解析不一致。
7. 朋友圈/短剧价格上限不一致。
8. Moments notification manager 藏在 Discover View 文件。
9. 钱包余额字段语义在 UI 中混用（钱包启用时升级为 P0）。
10. 提现地址校验、金额 Decimal、二次确认和风险提示不足（提现启用时升级为 P0）。

### P2：模块化和体验优化

1. 巨型 View/ViewModel 拆分；新工程按 feature slice 从第一天拆，旧工程无需先做无收益的大爆炸重构。
2. 旧工程 `.shared` 的全面清理可以渐进，但新工程的依赖注入和 lifecycle scope 已提升为 P0。
3. 视频缓存最多 5 GB 缺用户设置。
4. 已开始的媒体缓存下载不能完全取消。
5. 短剧进度只在状态变化时上报。
6. 关注 Feed 无离线 stale 体验，需确认新产品是否保留现策略。
7. 远程配置、动态路由和 Profile 入口要通过桥接协议解耦。

---

## 13. 分阶段迁移计划

## Phase -1：产品身份与发行可行性 Gate

- 确定这是同 Bundle ID/App Store listing 的升级，还是独立新 App；前者要求旧数据/Keychain/schema 迁移，后者默认无法读取旧 sandbox，通常需要重新登录。
- 后端确认 HTTPS/WSS/TLS 交付与证书运维；未确认不得进入 Production Ready。
- 确认首版公开、Beta、默认关闭和延期功能。
- 对 UGC、账号删除、隐私、IAP、广告、可提现余额/USDT、地区许可形成书面结论。
- 建立 ADR-001 产品身份、ADR-002 安全传输、ADR-003 首版范围与支付模型。

## Phase 0：冻结接口与基线

- 从当前代码生成 endpoint 清单。
- 为每个 endpoint 保存 request/response fixture。
- 锁定 Header、query、body、multipart、Idempotency-Key。
- 迁移现有 contract tests。
- 记录当前工作树 commit/hash 或快照，避免后续行号漂移。

## Phase 1：创建新工程和 Core

- 新 App target、Tests target、Notification Service Extension。
- iOS 16+、SwiftUI。
- AppCore、Networking、AuthKit、Persistence、MediaCore、Outbox。
- 从第一天建立 `AppCompositionRoot`、Process/Account/Scene/Feature scope、`AccountContext.epoch` 和可注入 Clock/UUID/Transport；新 Feature 禁止直接调用 `.shared`。
- 分离 anonymous Transport、SessionCoordinator 与 AuthorizedHTTPClient，消除 Auth/Networking 循环。
- 定义 Wire DTO → Domain → Persistence Record → View State 边界。
- 配置新 Bundle ID、Signing、APNs、App Store、AdMob。
- 暂时不迁复杂 UI，先用诊断页验证 Auth/HTTP/WS/cache。

## Phase 2：登录注册

- 登录、注册 UI。
- Keychain token。
- verify/refresh/logout。
- cached user。
- WebSocket connect/disconnect。
- device token upload。
- 账号切换/退出清理。

## Phase 3：消息列表和纯文本 DM

- 会话列表与 cache。
- DM 时间线。
- 文字发送、引用、撤回、已读。
- WebSocket echo 去重。
- unread floor/watermark。
- push 深链。

## Phase 4：Wallet Core 与一致性内核

- 先落地账号级 `WalletRepository`、服务端权威余额/流水、字段语义、统一失效刷新和 account epoch。
- 完成 StoreKit 交易确认 adapter、transaction 重放幂等、结果未知策略和 `.storekit` 测试配置。
- 定义资金 mutation 的稳定业务 ID、账本查询与禁止自动重试规则。
- 此阶段可以不开放充值/提现 UI，但后续礼物、ChatMoney 和付费解锁必须依赖该内核。

## Phase 5：富消息与 ChatMoney

- 图片、视频、语音、贴纸。
- 持久 outbox、媒体缓存、gallery、保存。
- 礼物。
- 红包、转账、详情、回执。
- 转发、收藏、多选、本地删除。
- 群聊和通话按产品范围接入。

## Phase 6：朋友圈

- 先推荐/关注/用户 Feed 只读。
- 点赞、评论、通知、个人页桥。
- 发布文字/图片。
- 视频发布和播放。
- 付费媒体解锁。
- 杀进程 outbox 恢复。

## Phase 7：短剧

- Catalog、系列、推荐/看过。
- 播放、HLS/MP4 fallback、进度。
- 关注、点赞、收藏、评论。
- 付费解锁。
- 创作者工作室、20 集上传、resume、submit。

## Phase 8：Agent

- Agent 目录、installed reconciliation。
- conversation 创建/读取。
- turn、轮询、前后台恢复。
- 图片调整。
- paid media、钱包不足和 unlock。
- Agent 编辑与新版本会话。
- 保留轮询兼容后再评估 events URL。

## Phase 9：钱包高风险子域

- 钱包账号状态隔离。
- 余额、流水、IAP。
- 提现和取消。
- 广告奖励 + SSV session。
- 所有 Feature 的 mutation result 统一刷新余额/失效流水 cache。
- 提现/USDT、广告、红包/转账分别通过法律、App Review、财务对账、地区与客服 Gate 后才打开生产 flag。

## Phase 10：发布硬化与持续模块化

- APIService facade 化。
- View 拆为小组件。
- 将剩余旧 `.shared` 包入 adapter 并逐步移除；不能把 dependency container 的建立推迟到此阶段。
- Feature 互相只通过协议桥接。
- 完成性能、后台恢复、无障碍、多语言、安全、隐私清单、观测、灰度与 Runbook 验收。

---

## 14. 验收清单

## 14.1 登录注册

- 登录/注册 request 字段与旧客户端一致。
- username/password 客户端校验一致。
- token 不重复 Bearer、不含意外空白。
- access token 过期只发生一次 refresh。
- 并发 protected request 等待同一 refresh。
- 冷启动 cached user 快速进入，再后台 verify。
- refresh 失败才 logout；5xx/断网不误退出。
- logout 清内存、token、WS、badge、钱包和账号 view state。
- A/B 账号切换无 cache/outbox/余额串号。

## 14.2 消息

- 冷启动先显示 SQLite，再增量同步。
- HTTP response 与 WS echo 不重复。
- 收消息后会话列表、聊天页和 badge 一致。
- 阅读一个会话只清该会话。
- push 冷启动能打开指定 DM/Group。
- text/image/video/voice/sticker/gift/red packet/transfer/forward bundle 正确显示。
- 引用定位可拉 context。
- 撤回时限和类型限制一致。
- 本地删除后同步不复活。
- image/video/text outbox 断网、后台、杀 App 恢复。
- 多选上限 99；资金消息转发规则正确。

## 14.3 Agent

- installed agent 和已有 conversation 两种列表行都可打开。
- turn completed/completed_with_errors/failed 正确。
- 后台停止轮询，前台恢复未完成 turn。
- 图片 asset 和所有 idempotency key 稳定。
- runtime flag/capability/旧版本/未解锁状态门控正确。
- locked preview 不泄露原图。
- unlock 更新 Agent 消息和全局钱包余额。
- 余额不足业务码显示充值入口。
- Agent 更新后旧会话不自动切版本。
- 明确 Agent 生成视频当前不是完整能力。

## 14.4 朋友圈

- 推荐请求 `/moments/world`，关注请求 `/moments/feed`。
- 关注页保持服务端排序，不本地二次过滤。
- 推荐 cache TTL、账号隔离正确。
- before_id 连续分页无重漏。
- 纯文字、1 图、9 图、视频、混合媒体发布。
- 本地 optimistic Moment 到 server ID 替换无闪烁。
- 断网重试、杀 App 自动恢复、不重复创建。
- 点赞、评论、回复、评论图、通知、详情、删除。
- 锁定预览、解锁、钱包余额更新。

## 14.5 视频消息与播放器

- MOV/M4V/MP4 DM/Group 发送。
- 大视频不产生整文件 Data 副本。
- client_message_id 重试不重复消息。
- 发送成功后优先使用本地缓存。
- HLS/MP4、Range、拖动、循环、前后台正确。
- 播放失败有明确错误 UI。
- 保存相册权限允许/拒绝正确。
- MP4/HLS 后台 session 可恢复。

## 14.6 短剧

- 推荐/看过 cursor 和服务端顺序正确。
- 全局推荐不按 episode 重新排序。
- 系列内按集数播放和继续观看。
- HLS、MP4、playURL 均可播放，HLS 无音轨可回退。
- 只保留当前/前/后播放器，长时间滑动内存稳定。
- 进度提交、点赞、收藏、关注、评论失败回滚。
- 解锁成功/余额不足/重复解锁正确。
- 创建系列、导入 20 集、并发 2 集上传、部分失败 resume。
- 杀 App 后续传并最终 submit。
- processing/reviewing/published/rejected/failed 完整。

## 14.7 钱包

- A/B 切换、logout、离线启动绝不串余额/流水/地址。
- 各余额字段与 UI 语义经接口负责人确认。
- 六种 IAP 商品可查询和购买。
- pending/cancel/failure/409/unfinished/crash recovery 正确。
- 同一 Apple transaction 不重复入账。
- 资金写操作后余额和流水立即刷新。
- 提现金额使用 Decimal/整数最小单位，request 值与旧接口一致。
- 提现创建/取消的重复点击和网络重试安全。
- 红包金额隐私、版本乱序、并发领取和转账终态正确。
- 广告只有服务端有效 SSV 入账。
- Moment/ShortDrama/Agent 解锁余额一致。

## 14.8 平台

- iOS 16 构建通过。
- 真机 APNs、Notification Service Extension、后台 URLSession 回调通过。
- Camera/Microphone/Photo 权限拒绝不崩溃。
- 多语言无缺 key。
- VoiceOver、Dynamic Type、小屏和键盘场景通过。
- 新 Bundle ID 的 APNs、IAP、AdMob、Store privacy metadata 均重新配置。

---

## 15. 现有测试与文档迁移清单

### Tests

- `BWChatTests/AuthSessionTests.swift`
- `BWChatTests/APIResponseContractTests.swift`
- `BWChatTests/ConversationListActionTests.swift`
- `BWChatTests/StickerPickerTests.swift`
- `BWChatTests/MomentsFollowingFeedTests.swift`
- `BWChatTests/ShortDramaPlaybackTests.swift`
- `BWChatTests/GameCenterTests.swift` 中 cache/wallet/short-drama contract 部分。
- `BWChatTests/InteractiveScriptContractTests.swift` 中群消息兼容部分（若保留群聊）。

### Docs

- `docs/auth-session-backend-restart-fix-prompt.md`
- `docs/chat-delivery-unread-backend-prompt.md`
- `docs/unread-badge-backend-prompt.md`
- `docs/conversation-delete-backend-prompt.md`
- `docs/conversation-list-actions-backend-prompt.md`
- `docs/media-background-upload-backend-prompt.md`
- `docs/cache-first-backend-compatibility-prompt.md`
- `docs/chat-money-backend-prompt.md`
- `docs/chat-money-backend-enable-prompt.md`
- `docs/chat-money-detail-decoding-fix-backend-prompt.md`
- `docs/chat-money-claim-idempotency-backend-prompt.md`
- `docs/chat-money-transfer-idempotency-backend-prompt.md`
- `docs/chat-money-wechat-parity-backend-prompt.md`
- `docs/wallet-ad-reward-backend-prompt.md`
- `docs/moments-following-feed-backend-prompt.md`
- `docs/short-drama-backend-prompt.md`
- `docs/short-drama-playback-backend-fix-prompt.md`
- `docs/user-profile-agents-short-dramas-backend-prompt.md`
- `docs/bwchat-batch2-backend-agent-prompt.md`

这些 docs 反映历史设计意图，不能替代当前代码和 contract tests，也不能被视为后端已上线证明。

---

## 16. 新工程启动前必须签署的产品、后端与发布决策

这些不是“少量参数”，而是会改变数据迁移、支付、合规和工程拓扑的 Gate -1 决策：

1. 新项目绝对路径。
2. 新 App 名称和 Product Module Name。
3. 新 Bundle ID。
4. 是否保留群聊。
5. 是否保留实时音视频通话。
6. 是否保留广告奖励。
7. 新 App Store Connect app 是否创建新 IAP Product ID，还是有既定迁移方案。
8. 是原 App 升级还是独立新 App；是否需要迁移旧 Keychain、SQLite、outbox、缓存和 pending transaction。
9. 生产 HTTPS/WSS/LiveKit TLS 域名、证书 owner、续期告警和下线明文入口日期。
10. 账号删除、密码找回、数据导出/保留、设备会话撤销的后端 owner 和交付日期。
11. UGC 举报/拉黑/审核/申诉、客服联系方式、处置 SLA、年龄门控和运营 owner。
12. 钱包各字段会计含义、IAP 余额与可提现收益隔离、所有资金幂等/查询、退款争议和对账 owner。
13. 隐私政策主体、数据地图、Privacy Manifest、App Privacy 标签、ATT/广告策略和地区发布范围。
14. 首版各 Feature 的 public/beta/flag-off/deferred 状态、灰度 owner、停止条件与回滚负责人。

其余技术决策可按本文执行，但上述任何 P0 决策没有 owner、结论与证据链接时，不得把项目状态标记为 Production Ready。

---

## 17. 推荐的第一批实际实施任务

当新项目路径确定后，第一批应只做：

1. 批准 ADR-001 产品身份、ADR-002 HTTPS/WSS、ADR-003 首版范围/支付模型。
2. 固定现工程基线，保存 Release/Debug 构建日志与脱敏 contract fixture。
3. 创建新 Xcode 工程、Tests 和 Notification Service Extension。
4. 建立 AppCompositionRoot、AccountContext/epoch、AppCore、Transport、AuthKit、Persistence、MediaCore、Outbox 本地模块。
5. 原样兼容 Auth path/field/envelope，同时将生产 transport 切换到 HTTPS/WSS。
6. 迁移登录注册 UI、Keychain 和 `User` 模型，并加入恢复、删除账号与隐私入口的骨架。
7. 写一个仅用于开发/Staging 的诊断页面验证：login → verify → refresh single-flight → WebSocket → push token → account cache → logout epoch invalidation。
8. 运行 Auth contract、账号切换竞争和 schema migration tests。
9. 验证通过后再进入消息列表和纯文本 DM。

这样可以把最复杂的业务页面建立在稳定的账号和接口兼容基线上，避免在 UI 已大量搬迁后才发现 token、账号隔离或 wire contract 不一致。

---

## 18. BWChat-iOS 源码复核：已证实缺口与目标修订

本节是 2026-07-22 对原工程的二次只读代码审计。结论分为“代码已证实”和“仍需运行时/后端证据”；不能把静态代码推断误写成线上事实。

| 证据 | 已证实问题 | 新工程目标 |
|---|---|---|
| 2026-07-22 Xcode 26.5 Debug generic Simulator build | arm64+x86_64、App+NSE 当前可编译；仅为开发构建证据 | CI 空缓存 Release/Tests/签名真机/Archive/提交验证仍是 Gate |
| `Utils/Constants.swift:17-24` | Debug/Release 都硬编码相同 `http/ws` IP；LiveKit 也是明文 | `.xcconfig`/Configuration 注入 dev、staging、prod；Release 只接受 allowlist 内 HTTPS/WSS/TLS URL，启动时断言配置 |
| `Info.plist:42-46` | 全局 `NSAllowsArbitraryLoads=true` | Release 移除全局例外；若开发环境临时需要，只存在于不可归档的 Debug 配置 |
| `Views/UserProfileView.swift:775-789` | 举报、限制、拉黑虽然展示，但统一提示 unavailable | 接入真实 API、服务端 enforcement、申诉/解除、列表过滤和处置 SLA；端到端测试后才计为完成 |
| `Views/AgentCreatorView.swift:195-204, 282-299` + `AgentCreatorViewModel.swift:61-107` | Agent 可选 public，并可直接启用成人互动/sensual 后发布安装；未见年龄门控和审核等待态 | V1 移除或强制关闭成人互动；public Agent 必须进入审核状态、内容分级和年龄限制，审核通过前仅 creator 私有可见 |
| 仓库全局搜索无 `PrivacyInfo.xcprivacy` | 主 App/Extension 隐私清单未落地 | 主 App、Extension 和本地 SDK 分别声明；Archive 生成 aggregate privacy report 并与 App Privacy 标签核对 |
| `Models/DynamicConfigModels.swift:102`，全仓无实际读取 | `killSwitch` 只有模型没有执行路径 | AppShell 和 mutation gateway 强制消费；高风险功能客户端/服务端双门控、默认关闭、可审计 |
| `Views/ChatView.swift:36-54` | PhotosPicker 视频复制后整文件读入 `Data` | Picker 文件 URL 直接 adopt 到 account-scoped staging；流式 multipart/后台 session，不保留与文件等大的内存副本 |
| `ViewModels/ShortDramaFeedViewModel.swift:898-905` | 推荐和系列上下文均按 episode/id 排序 | 仅 `seriesID != nil` 时排序；推荐 feed 保留 server order，增加 contract regression test |
| `Services/WalletStore.swift:182-195` | 可提现操作回退到 total/balance，金额换算使用 `Double` | 使用后端显式 withdrawable bucket；金额用整数最小单位/Decimal；缺字段 fail closed |
| `Services/WalletStore.swift:31-79` | USDT 地址只做长度校验并保存在 `UserDefaults` | 网络级地址校验 + 服务端复核；敏感地址使用 Keychain/受保护加密存储；日志只显示脱敏后缀 |
| `BWChatApp.swift:11-14, 102-105` | 根生命周期直接持有多个 singleton，账号切换依赖隐式全局状态 | Composition Root + AccountContext epoch；root 只持有 session state 和依赖容器 |
| `Services/APIService.swift:496-515` | 4,000+ 行 `@MainActor` API 单例，网络 facade、解码和 refresh 集中 | Transport/Auth/Authorized Client/Domain API 拆分；网络等待不占 MainActor，状态发布才回主线程 |
| `Services/MessageStore.swift:7-12, 210-211` | 单例 + 串行 queue 能避免并发 DB 访问，但 active owner 是隐式可变全局 | Account-scoped repository/DB actor，owner/epoch 显式参数；UI 通过 observation 读取唯一投影 |
| `Managers/ImageCacheManager.swift:248-253` | 已把 decode 移出主线程，但仍可能按原始像素完整解码 | 使用 `CGImageSourceCreateThumbnailAtIndex` 按目标像素下采样；缓存 cost 使用解码后字节数，按账号隔离受保护媒体 |
| 多个 View/ViewModel 1,000-2,200 行 | 状态观察面过宽、难测试、容易造成 invalidation fan-out | 按 screen state/container/leaf component/operation 拆分；不是按行数机械拆，而是按状态所有权和副作用边界拆 |
| `Services/PushService.swift` 将 device token 写 `UserDefaults` 且大量 `print` | push 身份与日志策略不统一 | APNs token 视为敏感标识；结构化 Logger + privacy redaction；logout/换号执行 server bind/unbind |
| `AuthManager.swift:142` 在 cached user 恢复前依据 token 设置 logged-in | UI 可能先进入已登录态但 account context 尚未完整建立 | 根状态使用 `restoring`；AccountContext、数据库 owner 和只读投影准备完成后才进入 authenticated |

已有的正向能力也应保留：MessageStore 已有 owner namespace、WAL、tombstone、client message unique index；ImageCache 已将主要 decode 移出主线程；HTTP 已有有限重试、Retry-After 与 refresh coalescing；Outbox 已持久化 job/part、hash、进度与账号。这些是迁移资产，不应因重构被丢失。

### 18.1 仍需运行时证据的项目

- SwiftUI 卡顿、掉帧、内存峰值和电量：静态代码只能提出高概率原因，必须用 Release 真机 + Instruments/MetricKit 建基线。
- WebSocket 丢洞、APNs 到达率、后台上传杀进程恢复：必须用代理故障注入和真机测试验证。
- 钱包幂等、提现来源隔离、UGC 处置：必须由后端 contract、账本和运营后台证明，客户端代码无法单独证明。
- Notification Service Extension 的受保护媒体下载、超时和内存：必须单独跑 extension 测试。

---

## 19. 目标运行时架构与不变量

### 19.1 建议的实际模块颗粒度

不要在第一天创建十几个空 Package。先以 5-7 个物理模块建立依赖纪律，达到稳定边界后再拆：

```text
AppShell
├─ PlatformCore
│  ├─ Configuration / Logging / Clock / FeatureFlags
│  ├─ Transport / Session / Realtime
│  ├─ Persistence / Media / Outbox
│  └─ Push / BackgroundTasks
├─ DomainInterfaces
│  ├─ AuthSessionProviding
│  ├─ WalletProviding / WalletRouting
│  ├─ ProfileRouting / ModerationProviding
│  └─ Analytics / SupportDiagnostics
├─ AuthFeature
├─ MessagingFeature
├─ ContentFeatures（Moments / ShortDrama，可在稳定后拆包）
├─ AgentFeature
└─ WalletFeature
```

物理模块合并不允许破坏逻辑层：Wire DTO、Domain、Persistence Record 和 Presentation State 仍然分开。禁止“Core”成为任何功能都能反向依赖的杂物箱。

### 19.2 App 与 Session 状态机

```swift
enum AppSessionState {
    case bootstrapping
    case unauthenticated
    case restoring(CachedAccount)
    case offlineAuthenticated(AccountContext)
    case authenticated(AccountContext)
    case switchingAccount
    case forcedUpgrade
    case maintenance
}
```

- 根 UI 只由一个状态机驱动，不再由 `isLoggedIn + cachedUser + splashBoolean` 的组合推断。
- `offlineAuthenticated` 允许读已加密的账号缓存和安全排队的 mutation；禁止资金、付费解锁、账号安全修改及无幂等写入。
- 强制升级/维护由已验证远程配置驱动，必须有无网回退和可访问的客服入口。
- 账号切换先 invalidate epoch，再取消账号 task；旧结果即使成功返回也不能落库。

### 19.3 导航与深链

- 每个 Tab/Scene 独立导航栈，保留各自历史；iOS 16 可使用 `NavigationStack`，若实测仍需 UIKit 壳，则只通过 `NavigationRouting` adapter 暴露，不让 Feature 依赖 UIKit。
- 路由只保存轻量、稳定 ID，不保存 View 或完整敏感模型。
- push、custom scheme、universal link 先解析为 typed route，再依次校验：来源 → 登录态 → 账号 → feature flag → 权限/内容可见性。
- 未登录时保存 `PendingRoute`；登录后重新授权和解析，不能直接执行旧 URL。
- Call overlay、全局 sheet、登录失效和 forced upgrade 由唯一 presentation coordinator 仲裁。

### 19.4 数据权威与唯一写入者

| 领域 | 唯一权威/写入入口 | 本地投影规则 |
|---|---|---|
| Auth | Keychain credential + 服务端 verify；SessionCoordinator 单写 | cached user 只用于启动展示 |
| Message timeline | MessageRepository/Ingestor | HTTP/WS/outbox ack 先入库，UI 只观察数据库 |
| Conversation/unread | Reconciliation engine + server watermark | push/WS 只触发同步，不直接覆盖最终计数 |
| Outbox | SQLite OutgoingJob state machine | ViewModel 不保存唯一 pending 真相 |
| Wallet | 服务端账本/余额；WalletRepository 单写 | Feature mutation 只 invalidate/reload，不本地增减真实余额 |
| Feed | 服务端 cursor/order；Repository 管理 snapshot | 乐观 interaction 有 operation ID 和回滚，推荐顺序不本地重排 |

跨表更新必须定义事务边界：消息入库、会话 preview、未读水位和 outbox ack 应在同一 repository operation 中提交，失败时可重复 reconcile。数据库 schema 有显式版本、migration journal 和损坏恢复策略。

### 19.5 Swift Concurrency 规则

- `SessionCoordinator`、`WalletRepository`、`OutboxCoordinator`、`MessageIngestor` 使用 actor 或等价串行 executor，明确单写。
- `@MainActor` 只负责 UI state 和必须在主线程的系统 API；网络等待、JSON decode、文件 IO、hash、图片下采样不放主线程。
- 所有长任务检查取消；`.task(id:)` 的 ID 必须包含真正影响结果的输入和 account epoch。
- `@unchecked Sendable` 必须有线程安全说明、owner 与审计测试，不能用于压下编译器错误。
- 采用 Xcode 26/iOS 26 SDK 构建、保持 iOS 16 deployment target 时，Phase 0 就开启完整并发警告；逐模块清零后再考虑 Swift 6 language mode。

---

## 20. 首版范围、用户旅程与状态完整性

### 20.1 推荐的 V1 公开范围

| 能力 | V1 默认状态 | 进入公开版的前置条件 |
|---|---|---|
| Auth/账号恢复 | Public | TLS、refresh single-flight、找回密码、删除账号、客服/隐私入口 |
| 1v1 文字/图片 DM | Public | 不丢不重、SQLite/outbox/WS/APNs、举报/拉黑 |
| 语音/视频消息 | Beta/flag off | 文件 URL 流式上传、大小/时长限制、弱网与磁盘/内存验证 |
| 群聊 | Deferred 或独立 Beta | mentions、成员治理、群举报/禁言、push/deep-link 完整 |
| 实时通话 | Deferred | CallKit/LiveKit/权限/弱网/后台/滥用治理/真机矩阵 |
| Agent 文本 | Beta | 取消/超时/恢复、内容安全、年龄分级；不启用付费媒体 |
| Moments/ShortDrama 浏览 | Public 只读可选 | 内容审核、年龄控制、举报入口、播放失败状态 |
| UGC 发布/创作者工作室 | flag off | 过滤、举报、屏蔽、审核、申诉、版权/删除 SLA |
| Wallet 只读余额/流水 | 可选 | 字段语义和账号隔离确认 |
| IAP/付费解锁 | flag off | Wallet Gate、StoreKit/Sandbox/Server 对账、App Review 模型确认 |
| 提现/USDT、红包/转账、广告奖励 | Deferred | 法律/地区/App Review/财务/风控/客服全部书面通过 |

“迁移代码”与“公开启用”是两件事。代码可以提前进入二进制，但所有未过 Gate 的入口、push、deep-link 和后台 mutation 必须同时不可达。

### 20.2 各 Feature 必须覆盖的状态矩阵

| 状态 | Auth | DM/Group | Agent | Feed/Video | Wallet |
|---|---|---|---|---|---|
| 首次/空 | 解释账号价值，不索取非必要信息 | 空会话/无联系人 CTA | 无 Agent/无会话 | 空 feed/无作品 | 无流水/无可购买商品 |
| Loading | 可取消，防重复提交 | skeleton 不覆盖已有缓存 | turn 进度与最长时间 | 首帧封面、分页加载 | product/balance/transaction 分开 |
| Offline | cached account 受限态 | 已缓存可读，安全写入排队 | 明确不可用或恢复 pending | 标 stale；遵守产品离线策略 | 只读缓存显式标记，不允许资金写 |
| Weak network | 不误 logout | pending/重试/结果未知可见 | 暂停、恢复或取消 | 清晰 buffer/回退 | 禁止盲重试扣款 |
| Permission denied | 不阻塞无关功能 | 相册/麦克风提供替代入口 | 相册拒绝仍可文本 | 保存相册拒绝可去设置 | ATT/通知拒绝不影响余额/奖励资格规则 |
| Rate limited | 展示可重试时间 | 保留草稿和 pending | 停止轮询退避 | 不清空已有内容 | 不重复提交，展示最终状态查询 |
| Maintenance/flag off | 可登录或展示状态页 | 只读/停写可配置 | 隐藏入口并保留已有数据 | 关闭发布而保留浏览 | 关闭 mutation，流水仍可查 |
| Account switch | 清空旧 context | 旧消息 task 结果丢弃 | 停旧 turn poll | 清播放器/账号 cache | 立即清余额投影再加载新账号 |

### 20.3 必须补齐的信任与设置页面

- 账号：改密、找回密码、设备/会话管理、删除账号、退出登录。
- 隐私：隐私政策、数据收集说明、权限状态、数据导出/删除请求、个性化/广告选择。
- 安全：已屏蔽用户、举报记录/状态（若产品提供）、社区规范、未成年人/敏感内容控制。
- 通知：系统权限状态、分类开关、免打扰与替代的站内通知入口。
- 存储：媒体缓存大小、清理、蜂窝网络自动播放/下载。
- 支持：客服联系方式、FAQ、版本/构建号、诊断 ID；诊断包不得包含 token、聊天正文或完整资金地址。

---

## 21. 安全、隐私、App Store 与内容治理 Gate

以下基于 2026-07-22 Apple 官方规则复核；App Review Guidelines 是动态规则，正式提交前必须再次以官方页面为准。

### 21.1 传输、凭证与本地数据

- Release Auth、Chat、Wallet、媒体和 Realtime 明文流量必须为 0；使用 TLS 1.2+、有效证书链和续期告警。
- WebSocket access token 不放 query；优先使用 header 或短时一次性 socket ticket，避免代理/日志泄漏。
- Keychain key 加入 app/environment namespace；access/refresh token 使用合适 accessibility，明确备份/换机策略。
- SQLite、outbox、受保护媒体按账号隔离并应用 Data Protection；缓存和临时文件排除 iCloud backup。
- `Logger` 使用 privacy 标记；禁止记录 Authorization、token hash（生产也不需要）、密码、聊天正文、JWS、完整提现地址和带签名 query 的媒体 URL。
- 不默认做证书 pinning；若采用必须有双证书轮换和远程应急方案，不能造成证书更新即全量断网。

Apple 官方说明，全局 `NSAllowsArbitraryLoads=YES` 显著降低安全性且审核时需要解释，应优先升级服务器或使用更窄例外：[NSAllowsArbitraryLoads](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowsarbitraryloads)。

### 21.2 账号生命周期与隐私请求

- App 内可创建账号，就必须在 App 内提供容易找到的账号删除入口；不能只写邮件联系客服。
- 删除流程覆盖账号、UGC、媒体、草稿、outbox、push token、服务端 session 与本地加密 key；法律必须保留的数据要说明类别和期限。
- 手工处理可以有时延，但需告知预计时间并在完成后确认。
- 正常 logout 与 delete account 不同：logout 可按政策保留加密离线数据，delete 必须执行确认过的数据删除/匿名化 contract。

官方依据：[App Review Guidelines 5.1.1(v)](https://developer.apple.com/app-store/review/guidelines/)、[Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)。

### 21.3 UGC、创作者与 Agent 内容安全

聊天、朋友圈、评论、短剧创作和 Agent 生成内容至少具备：

1. 发布前/后过滤与风险分级；非法和明显违规内容 fail closed。
2. 内容、消息、评论、用户和 Agent 的举报入口；举报带稳定 content ID，不上传多余私密上下文。
3. 用户拉黑/解除、服务端 enforcement、历史内容可见性与 push/推荐过滤。
4. 对外客服联系方式、社区规范、审核队列、处置 SLA、申诉和重复违规升级。
5. NSFW 默认隐藏、年龄声明/验证和未成年人限制；创作者标记超出年龄分级的内容。
6. Agent 清楚标识为 AI，提供重新生成/停止/举报；安全策略失败时不展示付费或原始受限媒体。
7. 若 Agent/机器人属于 Guideline 4.7 的软件内容，维护可审核的软件目录索引与 universal link；超出 App 年龄分级的 Agent 必须受年龄限制且不可被未成年人发现或调用。
8. 把用户消息、照片、语音或其他个人数据发送给第三方 AI 服务前，明确说明接收方、用途与数据类别并取得用户许可；拒绝后仍提供不向该服务传输数据的可理解结果。

现有 Agent 创建器中的“公开 + 成人互动/sensual + 直接 publish”组合不得原样迁入 V1。成人互动默认关闭并由服务端忽略旧客户端提交；公开 Agent 先进入 `draft → submitted → reviewing → approved/rejected`，只有审核通过且符合年龄分级的内容才能进入公共目录。以色情或露骨成人互动为主要用途的产品存在明确下架/拒审风险，不能仅靠“18+”开关解决。

只有 UI 按钮没有后端和运营闭环不算完成。Apple 对 UGC 明确要求过滤、举报与及时响应、屏蔽滥用用户及公开联系方式；4.7 还覆盖聊天机器人等软件内容，5.1.2(i) 要求向第三方 AI 共享个人数据前明确披露并取得许可：[App Review Guidelines 1.2、4.7、5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/)。

### 21.4 Privacy Manifest、App Privacy 与广告

- 主 App 和 Notification Service Extension 均建立 `PrivacyInfo.xcprivacy`；列出 collected data、tracking domains 和 Required Reason API。
- 当前源码已使用 `UserDefaults`，并在缓存模块读取 `volumeAvailableCapacityForImportantUsageKey`。初步候选理由分别为 CA92.1、E174.1，但不得直接照抄：以 Release Archive、Xcode aggregate privacy report 和 Apple 当期 reason 列表复核最终声明。
- 对 LiveKit、Google Mobile Ads、UMP 及其传递依赖检查最新 privacy manifest/signature；Archive 后生成 aggregate report。
- 建立数据地图，至少覆盖 user ID、消息正文、照片/视频、联系人/社交关系、购买、钱包/提现信息、位置、广告数据、诊断数据和推送 token；与 App Store Connect App Privacy 标签逐项一致。
- UMP consent 不等于 ATT。只有发生跨公司 app/site tracking 时才走 ATT；拒绝 ATT 后不得以功能、内容或奖励资格相要挟。
- 若不需要 tracking，配置非个性化/上下文广告和 SDK 限制，仍需真实披露 SDK 收集的数据。
- Push payload 只携带 opaque event/conversation ID，不携带聊天正文、资金信息或敏感媒体 URL；Notification Service Extension 只允许 HTTPS allowlist、MIME/大小/耗时限制，并在 logout/delete 时服务端解绑 APNs token。
- 如果 V1 不包含地图交友/附近能力，删除对应位置权限声明、代码路径和 App Privacy 披露；若保留，则 UI 触发时机、`Info.plist` usage description、实际授权 API 和降级行为必须一致。

官方依据：[Privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)、[Third-party SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/)、[App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)、[User privacy and data use](https://developer.apple.com/app-store/user-privacy-and-data-use/)。

### 21.5 IAP、虚拟币、赠送与 USDT

- 解锁 App 内数字功能、内容或虚拟币默认必须使用 IAP；虚拟币不得过期。
- 购买调用必须绑定稳定、不可反推用户身份的 `appAccountToken`；服务端验证 Apple 签名交易的 environment、bundle ID、product ID、transaction lineage 与账号绑定，再提交幂等账本 mutation。`pending`、`userCancelled`、`verified`、`unverified` 和服务端确认失败均有独立状态，不能遇到“已购买”就盲目 `finish()`。
- 用户间赠送只有在完全自愿、且 100% 到达接收者等适用条件下才可能适用特定规则；与数字内容/服务关联时仍必须按 IAP 处理。
- IAP 购得余额、创作者收益、广告奖励和可提现资产必须在服务端账本严格分 bucket；任何混用都阻断提现与用户间转移上线。
- 默认策略是 IAP 余额不可提现、广告奖励不可提现；只有 Apple 规则、当地法律、支付/税务与风控书面确认后才能改变，并通过服务端 ledger policy 版本化执行。
- USDT 提现会引入加密资产、金融、KYC/AML、地区许可和开发者组织身份问题；客户端工程完成不能替代法律意见。无书面地区矩阵时默认关闭。
- App Review notes 必须说明猫币的获得、消费、赠送、退款、是否可提现以及 Apple transaction 与服务端账本的对应关系。

官方依据：[App Review Guidelines 3.1.1、3.1.5、3.2.1(vii)](https://developer.apple.com/app-store/review/guidelines/)。

### 21.6 年龄分级、审核资料与构建要求

- 按聊天、UGC、创作者、AI 助手、敏感内容、广告、抽奖/随机性和金融能力真实填写新版年龄问卷；不能只按 UI 视觉判断。
- 提交材料包括：长期有效审核账号、双账号聊天方法、IAP/钱包演示路径、测试内容、后端在线状态、审核备注、隐私/服务条款/社区规范 URL、客服联系方式。
- 截至当前，上传 App Store Connect 必须使用 Xcode 26+ 与 iOS 26 SDK+ 构建；Deployment Target 仍可继续 iOS 16。
- `ITSAppUsesNonExemptEncryption` 必须由实际加密使用与出口合规问卷决定，不能因为只用系统 TLS 就机械复制旧值。

官方依据：[Upcoming Requirements](https://developer.apple.com/news/upcoming-requirements/)、[Set an app age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating)、[Before You Submit](https://developer.apple.com/app-store/review/guidelines/)。

---

## 22. Feature Flags、灰度、降级与回滚

### 22.1 设计规则

- 高风险 flag 默认 `false`；配置缺失、过期、签名/解析失败或账号不匹配时 fail closed。
- 客户端入口 flag 与服务端 mutation gate 双重校验；隐藏按钮不能替代服务端拒绝。
- flag 维度允许 build、OS、region、account cohort 和 percentage；稳定 hash 不能使用会跨账号继承的匿名 device ID 作为资金灰度唯一依据。
- 每个 flag 有 owner、创建原因、默认值、到期日、回滚动作和审计记录。
- 远程配置只能在编译进 App 的 allowlist route/component 中选取；不得下载执行代码或用 Web 内容改变 App 核心用途。

### 22.2 必备 kill switch

| Flag | 默认 | 关闭时行为 |
|---|---:|---|
| `messaging_write` | false→Gate 后 true | 会话只读，pending 保留 |
| `ugc_publish` | false | 保留草稿，浏览不受影响 |
| `agent_turns` / `agent_paid_media` | false | 停止新 turn/解锁，已有记录可读 |
| `wallet_iap` | false | 隐藏购买，继续处理 unfinished transaction |
| `wallet_withdrawal` | false | 禁止新提现，记录/终态查询仍可用 |
| `chat_money` / `paid_unlock` | false | 禁止新资金 mutation |
| `rewarded_ads` | false | 不加载 SDK/ad，不影响账户使用 |
| `calls` | false | 拒绝新邀请并兼容结束现有通话 |
| `background_upload` | false | 停止新入队，安全完成或暂停已有 job |
| `media_autoplay` | false | 静态封面 + 手动播放 |

目标传播：普通 flag p95 5 分钟内生效；Sev-0 资金/安全开关由后端即时拒绝，客户端下次前台/请求同步状态。

---

## 23. 可观测性、SLO 与隐私边界

### 23.1 统一关联 ID

- HTTP：`request_id`（接收服务端值），日志记录 endpoint template 而非完整 URL。
- Message：`client_message_id + server_message_id`。
- Outbox：`job_id + part_id + operation_type`。
- StoreKit：`transaction_id + appAccountToken`，不得记录 JWS 原文。
- Account：不可逆、环境内 scoped 的匿名 hash；禁止 analytics 直接使用 token/user content。

### 23.2 必须采集的健康指标

- crash-free、hang-free、MetricKit launch/hang/disk write、jetsam。
- login/verify/refresh 成功率；一次 401 风暴触发的 refresh 次数；被 epoch 丢弃的 stale callback。
- WS connect/reconnect/gap reconciliation；duplicate suppression；unread reconciliation 差异。
- outbox 各状态数量、最老 job 年龄、confirmationUnknown/requiresUserResolution。
- 视频首帧、播放失败、buffer、cache 命中、上传吞吐/内存峰值。
- wallet mutation、StoreKit confirm、余额收敛时间、账本差异、退款/拒付/提现终态。
- moderation report 创建到首次响应/处置时间。

### 23.3 首轮 SLO（有真实基线后校准）

| 指标 | Gate 目标 |
|---|---|
| TestFlight crash-free sessions | 连续 7 天 ≥ 99.9%，关键路径已知 crash 为 0 |
| hang-free sessions | ≥ 99.5%，已知主线程 >2 秒 P0/P1 为 0 |
| cached session 首屏 | iPhone 11/iOS 16 Release p95 ≤ 1 秒 |
| 冷启动可交互 | 同基线 p95 ≤ 2.5 秒 |
| 消息确认 | 正常网络 p95 ≤ 2 秒；弱网 p95 ≤ 5 秒 |
| WS 恢复 | 网络恢复后 p95 ≤ 10 秒并完成 gap sync |
| outbox | 随机 kill/relaunch 无丢失、无重复创建 |
| wallet | 每日账务对账差异 0；重复/超时回放无重复入账 |
| kill switch | 客户端 p95 ≤ 5 分钟；服务端资金 gate 即时 |
| dSYM/制品 | 上传率与 build 可追溯率 100% |

P0 告警要求 5 分钟发现、10 分钟确认；任何资金重复入账、跨账号显示或内容安全 Sev-0 立即停止灰度。

---

## 24. 测试策略、CI/CD 与发布证据

### 24.1 测试金字塔

| 层级 | 重点 |
|---|---|
| Unit | DTO adapter、金额/地址、state machine、feature flag、route parser、dedupe、clock/UUID |
| Contract | 每个冻结 endpoint 的 method/header/query/body/multipart/旧 envelope fixture |
| Repository integration | 临时 SQLite、schema N-2 migration、事务、损坏/密钥丢失、account epoch |
| Concurrency/fault | 50-100 并发 401、WS 乱序/重复/断线、迟到 callback、取消、时钟跳变 |
| UI | Auth、DM、举报/拉黑、删除账号、权限拒绝、Dynamic Type、deep-link |
| System/real device | APNs、NSE、background URLSession、StoreKit Sandbox、LiveKit、相册/麦克风/相机 |
| Destructive recovery | upload/commit/migration 中随机 kill、磁盘满、数据库损坏、离线/限流/5xx |

不要只追总行覆盖率；Auth session、资金、幂等、decoder、migration、account isolation 关键分支要求 ≥90%，且所有 P0 contract 有自动测试。

### 24.2 StoreKit 证据

- 建立 `.storekit` 配置并纳入 test plan，覆盖 success、pending、cancel、unverified、interrupted、unfinished、重复 confirm、crash before/after finish。
- 在 Apple Sandbox 走完整客户端 → 服务端确认 → 余额/流水 → transaction finish。
- 服务端处理 transaction 重放、退款/撤销与 App Store Server Notifications V2（若业务需要）；确认环境字段和 bundle/product ID。

官方参考：[Testing In-App Purchases in Xcode](https://developer.apple.com/documentation/storekit/testing-in-app-purchases-in-xcode)、[Testing at all stages](https://developer.apple.com/documentation/storekit/testing-at-all-stages-of-development-with-xcode-and-the-sandbox)。

### 24.3 CI 阻断门

每个 PR：

- 格式/静态检查、敏感信息扫描、依赖许可/漏洞、所有 Unit/Contract。
- iOS 16 deployment target + 当前 App Store SDK 编译主 App、Tests、NSE。
- Swift concurrency warning budget 不增加；P0 模块 warnings-as-errors。
- 校验 `PrivacyInfo.xcprivacy`、entitlements、InfoPlist、URL scheme、Bundle ID 和禁止的 Release HTTP URL。

Release candidate：

- 干净 commit 连续可重复 Archive；签名安装；dSYM/BCSymbolMap/隐私报告/依赖清单归档。
- TestFlight internal → external；灰度 1% → 5% → 20% → 50% → 100%，每阶段至少观察 24 小时并满足 error budget。
- 版本号、build、commit、配置版本、数据库 schema、服务端兼容窗口可追溯。

---

## 25. SwiftUI、媒体、内存与电量预算

### 25.1 代码级修订

- 大型 `ObservableObject` 拆成窄 state；row 只接收稳定值，避免整个消息数组/钱包对象引发宽泛刷新。
- `ForEach` 使用稳定 domain ID；禁止对会重排的对象使用不稳定 `\.self`/offset。
- 排序、过滤、formatter、JSON parse 和 image decode 不放 `body`；输入变化时预计算。
- 图片按显示尺寸下采样，不只 `UIImage(data:) + preparingForDisplay()`；长图/多图设像素和并发预算。
- 视频/语音/大图全程基于 file URL 和 bounded buffer；选择、压缩、hash、上传不制造完整重复 Data。
- 播放器只保留当前/前/后，离屏立即解绑 observer、time observer、audio probe 和 cache task。
- 遵守 Reduce Motion、Low Power Mode、thermal state 和蜂窝网络设置；后台无活跃业务时不得轮询。

### 25.2 首轮预算

| 场景 | 目标 |
|---|---|
| 30 分钟长聊天/短剧滑动 | 0 jetsam、0 持续增长；p95 memory ≤ 350 MB（再按目标机校准） |
| 大视频发送 | 峰值内存不随文件大小线性增长；文件大小/时长超限在入队前提示 |
| Feed 滚动 | Release 真机建立 hitch/帧率基线；高严重度 hitch 为 0 |
| 图片 | decode 尺寸 ≤ 实际渲染像素预算；列表禁止原图全尺寸解码 |
| 磁盘 | cache 有账号预算、LRU、磁盘不足阈值和用户清理入口 |
| 后台静置 | 无轮询、无持续定位；一小时电量下降中位数目标 ≤3% |

验证固定使用同一设备/OS/Release 交互脚本，对比 SwiftUI Instruments、Time Profiler、Allocations、Leaks、Network 与 Energy Log；无 trace 时必须标注为代码级假设。

---

## 26. 发布拓扑、数据迁移、备份与灾难恢复

### 26.1 Bundle ID 二选一

**原 App 升级：** 保持 Bundle ID/listing，必须迁移旧 Keychain、SQLite、cache、outbox、UserDefaults、APNs/NSE 和 unfinished StoreKit transaction。至少从最近两个线上版本做升级测试。

**独立新 App：** 新 sandbox 默认读不到旧数据；用户通常需要重新登录，pending outbox/media/cache 不承诺迁移。除非旧 App 已提前发布共享 App Group/Keychain access group 导出版本，否则新 App 上线时无法补救。

该决策必须写入 ADR，不能只在创建工程时口头选择。

### 26.2 数据迁移规则

- 每个 store 有 schema version、migration journal、前置备份/校验与完成标记。
- migration 中途 kill 后可重复运行；失败进入可恢复页面，不静默清库。
- 新 schema 在允许二进制回滚窗口内保持旧版本不会崩溃；否则只能 forward-fix，并提前写明。
- cache 可重建，outbox/pending mutation 不可当 cache 删除；资金账本从不以客户端为恢复来源。
- 加密 key 丢失时区分可重建 cache 与不可丢用户草稿/pending，给出用户可理解的恢复路径。

### 26.3 后端恢复目标

- 资金账本：RPO=0，目标 RTO≤1 小时；定期恢复演练和对账。
- 消息元数据：建议 RPO≤5 分钟、RTO≤4 小时；媒体对象存储有生命周期与校验。
- 配置/审核/举报：有备份、审计和权限隔离。
- 对 2× 预计峰值持续 60 分钟和 5× 突发 10 分钟做容量验证；不得以客户端缓存掩盖服务端容量缺口。

---

## 27. 上线运营、客服与 Runbook

公开上线前至少准备：

- 发布日 owner、值班表、Sev-0/1/2 定义、沟通频道、状态页和 App Review 联系人。
- TLS/证书、APNs、WS、IAP confirm、账本差异、举报队列、后台上传卡住的告警与 runbook。
- 用户工单：无法登录、消息丢失/重复、pending 卡住、误举报/拉黑、账号删除、购买未到账、退款/拒付、提现失败。
- 支持工具只暴露最小必要数据；所有客服访问有 RBAC 和审计日志。
- 线上诊断包包含 build/config/schema、匿名 request/job ID 和健康状态，不包含 token、消息正文、JWS、完整媒体 URL/提现地址。
- 每季度至少演练：证书故障、WS 重连风暴、push 失效、对象存储不可用、钱包停写、错误远程配置和数据库恢复。

---

## 28. G0-G7 Go/No-Go 与 RACI

### G0：产品/合规可行性

- [ ] Bundle ID/App Store 拓扑、首版范围、HTTPS/WSS、支付/USDT、UGC/隐私结论已批准。
- [ ] 所有 P0 有 owner、截止日期、证据链接和明确 No-Go 条件。

### G1：可重复工程与架构基础

- [ ] 干净 commit 的主 App/Tests/NSE Release 构建、签名安装和 CI 通过。
- [ ] Composition Root、四级 scope、AccountContext epoch、DTO/Domain/Record 边界完成。
- [ ] Release 无明文 endpoint，无业务新 `.shared`；并发高风险 warning 为 0。

### G2：Session/账号/平台生命周期

- [ ] 100 并发 401 只 refresh 一次；断网/5xx/解码错误不误 logout。
- [ ] A/B 换号无 cache/wallet/badge/media/outbox 串号；迟到 callback 全部丢弃。
- [ ] 找回密码、删除账号、push bind/unbind、NSE、deep-link 真机通过。

### G3：Messaging/Realtime/Outbox

- [ ] HTTP/WS 重复乱序、断线补洞后 timeline/conversation/unread 最终一致。
- [ ] 每 scene 的 kill/relaunch/confirmationUnknown 有自动化证据；资金未知结果不重放。
- [ ] 大视频无整文件 Data 副本；权限/弱网/磁盘满有明确 UI。

### G4：Wallet Core

- [ ] 字段语义、来源 bucket、幂等和查询终态由产品/后端/财务签字。
- [ ] StoreKit 本地、Sandbox、重复/崩溃/unfinished 测试通过，账本差异为 0。
- [ ] 未过法律/App Review/地区 Gate 的提现、USDT、红包/转账、广告全部默认关闭。

### G5：Feature 垂直切片

- [ ] Moments、ShortDrama、Agent 各自具备 API adapter、repository、route、state matrix、flag、测试和观测。
- [ ] UGC 过滤/举报/拉黑/审核/申诉与年龄控制端到端通过。
- [ ] 付费内容不泄露原始媒体，余额最终一致。

### G6：隐私、质量与发布运营

- [ ] Privacy Manifest、App Privacy、权限、本地化、VoiceOver/Dynamic Type、年龄分级和审核资料齐全。
- [ ] TestFlight 达到 SLO；Critical/High 安全问题为 0；dSYM 和 runbook 就绪。
- [ ] kill switch、停写、灰度停止、migration 和回滚演练通过。

### G7：App Store 发布

- [ ] App Review 账号与双账号互动、IAP/审核内容路径可用，后端保持在线。
- [ ] 发布经理、iOS、后端、QA、安全/隐私、内容运营、财务/法务、客服/SRE 分别对自己 Gate 签字。
- [ ] 任一 No-Go 未关闭，不因发布日期强行放行；只能缩减功能并重新验证。

RACI 最低角色：Product Owner、iOS Lead、Backend Lead、QA Lead、Security/Privacy、Content Safety、Finance/Legal、SRE/Support、Release Manager。每个 Gate 的“证据”必须是 CI 链接、测试报告、App Store 配置截图、后端 contract/对账报告或已批准 ADR，不能只填写“已沟通”。
