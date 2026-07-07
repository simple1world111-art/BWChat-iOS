# BWChat iOS 动态内更新改造 Prompt 设计

本文档把“尽可能一次上架后主要功能可内更新”的方案拆成两套可直接交给工程 agent/团队执行的 prompt：

- 前端 iOS Prompt：改造当前 SwiftUI 客户端为“合规动态宿主”。
- 后端 Prompt：提供远程配置、服务端驱动 UI、资源清单、灰度、审核模式和回滚能力。

核心边界：不要承诺 iOS 上“所有功能永远不再发版”。目标是把未来功能尽量设计成已审核原生能力、配置、内容、资源、WebKit 页面和服务端策略的组合。新增原生权限、原生 SDK、后台模式、支付能力、核心用途变化仍应走 App Store 发版。

## 当前代码依据

请执行 prompt 的工程方先阅读这些文件，不能脱离当前项目凭空重构：

- `README.md`：项目是 Swift 5.9+、iOS 16.0、纯 SwiftUI、MVVM、零三方依赖。
- `BWChat/Utils/Constants.swift`：当前 API/WS/LiveKit/IAP 商品/主题色硬编码。
- `BWChat/Services/APIService.swift`：已有 `fetchDiscoverConfig()`、`getGiftCatalog()`、Bot、钱包、IAP 确认等接口。
- `BWChat/Models/DiscoverConfig.swift`：已有发现页配置 schema 雏形。
- `BWChat/Views/DiscoverView.swift`：已有 `native/web/coming_soon` route 和 `InAppWebView`。
- `BWChat/Utils/UIKitNav.swift`：`MainTabController` 当前四个主 Tab 硬编码。
- `BWChat/Views/ProfileView.swift`：Profile 功能卡硬编码。
- `BWChat/Views/WalletView.swift`、`BWChat/Services/WalletStore.swift`：钱包使用 StoreKit，IAP 商品来自 `AppConfig.catFoodProducts`。
- `BWChat/Components/GiftViews.swift`、`BWChat/Models/Gift.swift`：礼物目录已有服务端 catalog，失败回落固定礼物。
- `BWChat/Services/ChatbotAPI.swift`、`BWChat/Models/BotConfig.swift`：Bot 行为和 prompt 适合由后端配置。

## 全局合规要求

无论前后端，都必须遵守：

1. 不能下载、安装、执行 Swift/Objective-C/C/C++ 原生代码，也不能通过动态配置引入未经审核的新原生能力。
2. 远程下发的只能是数据、资源、WebKit URL、服务端驱动 UI schema、功能开关、实验参数、文案、资源 URL、Bot/内容策略。
3. Web 内容必须通过 `WKWebView`，并且使用域名白名单、跳转拦截、权限提示和 JS bridge 白名单。
4. 数字内容、虚拟币、打赏、解锁功能必须遵循 StoreKit/IAP；不能通过 H5 或远程配置绕过。
5. App Review 期间必须能让审核员看到动态能力，不做隐藏功能；提供 review profile/demo account/config。
6. 所有动态能力必须有默认值、缓存、失败回退、kill switch、版本门槛和灰度回滚。

---

# Prompt A：前端 iOS 动态宿主改造

下面内容可直接复制给前端 iOS agent。

```text
你是 BWChat-iOS 的资深 iOS 工程师。请在当前项目 /Users/wegpt.com/Desktop/BWChat-iOS 中，把现有纯 SwiftUI 客户端改造成合规的“动态社交宿主”：尽量让后续活动、入口、轻页面、主题、礼物资源、Bot 策略、发现页、Profile 功能卡、H5 页面等通过服务端配置更新，而不是每次发 App Store 新版本。

重要边界：
- 不要实现下载或执行原生代码。
- 不要引入 React Native、热修复 SDK、JSPatch、动态库加载或任何绕过 App Store 审核的机制。
- 不要绕过 StoreKit/IAP。
- 不要删除现有聊天、联系人、发现、Profile、钱包、礼物、Bot 功能。
- 保持 Swift 5.9+、iOS 16.0、SwiftUI/MVVM、URLSession、零三方依赖的项目风格。
- 所有远程配置都必须有内置默认值、缓存、版本兼容、失败回退和 kill switch。

请先阅读并理解这些现有文件：
- README.md
- BWChat/Utils/Constants.swift
- BWChat/Services/APIService.swift
- BWChat/Models/DiscoverConfig.swift
- BWChat/Views/DiscoverView.swift
- BWChat/Utils/UIKitNav.swift
- BWChat/Views/MainTabView.swift
- BWChat/Views/ProfileView.swift
- BWChat/Views/WalletView.swift
- BWChat/Services/WalletStore.swift
- BWChat/Components/GiftViews.swift
- BWChat/Models/Gift.swift
- BWChat/Services/ChatbotAPI.swift
- BWChat/Models/BotConfig.swift

目标一：新增全局远程配置模型和拉取服务
请新增一套 App 级远程配置，不能只局限于 Discover：

建议新增文件：
- BWChat/Models/AppRemoteConfig.swift
- BWChat/Services/AppRemoteConfigStore.swift
- BWChat/Services/FeatureFlagService.swift
- BWChat/Models/DynamicRoute.swift
- BWChat/Models/DynamicScreen.swift

需要支持的顶层模型：
- schemaVersion: Int
- configVersion: String
- generatedAt: String
- minSupportedAppVersion: String?
- minSupportedBuild: Int?
- refreshIntervalSeconds: Int
- killSwitch: AppKillSwitch?
- featureFlags: [FeatureFlag]
- tabs: [DynamicTab]
- discover: DiscoverConfigData?
- profileSections: [DynamicSection]
- contactModules: [DynamicSection]
- theme: DynamicTheme?
- webViewPolicy: WebViewPolicy
- assetManifest: RemoteAssetManifest?
- wallet: WalletRemoteConfig?
- reviewMode: ReviewModeConfig?

AppRemoteConfigStore 要求：
- @MainActor ObservableObject 单例或环境对象均可，但要符合项目现有风格。
- 启动时先加载本地缓存，再异步请求后端 `/app/config`。
- 请求头包含 Accept-Language、X-App-Version、X-App-Build、Authorization（有 token 时）。
- 支持 ETag/If-None-Match，如果后端返回 304 则保留缓存。
- UserDefaults 缓存最近一次有效配置，key 使用 `bbchat.app.remoteConfig.v1`。
- 如果远程配置解析失败，保留缓存；如果缓存也没有，使用内置 defaults。
- refreshIntervalSeconds 最小值做保护，例如不能低于 60 秒。
- 支持 `forceRefresh()`，供 pull-to-refresh 或 debug 使用。

目标二：统一动态路由
把 Discover 当前局部 route 逻辑抽成全局 DynamicRoute：

支持 route 类型：
- native：只能跳转预先写在客户端里的原生页面。
- web/h5/url：打开受保护的 InAppWebView。
- screen：打开服务端驱动 UI 页面，按 screenID 获取或从 config 中读取 schema。
- coming_soon/disabled：显示现有 coming soon 弹窗。
- external：默认禁止；如必须支持，只允许白名单域名且用系统确认弹窗。

Native route 白名单至少包括：
- messages
- contacts
- discover
- profile
- moments
- my_moments
- groups
- nearby
- wallet
- settings
- edit_profile
- bot_create
- bot_market

请新增 `DynamicRouteHandler` 或等价工具，让 Discover、Profile、Contacts、动态 screen 中的 action 都使用同一套路由处理，不要在每个 View 里重复 switch。

验收：
- `DiscoverView.handleTap` 改为调用统一 route handler。
- `ProfileView` 的功能卡以后可由远程配置驱动，但钱包、我的动态、设置仍有内置 fallback。
- 未识别 route 必须安全降级为 coming soon，不崩溃。

目标三：动态主 Tab 配置
当前 `UIKitNav.swift` 的 `MainTabController` 四个 Tab 写死。请改造为：

- 默认仍保留 Messages、Contacts、Discover、Profile 四个核心 Tab。
- 支持后端配置 titleKey/title、systemImage/selectedSystemImage、order、enabled、route。
- 支持通过配置隐藏非核心 Tab 或增加 Web/Screen 类型 Tab，但核心聊天能力不能被远程配置破坏。
- 当远程配置缺失或非法时，使用现有四个 Tab。
- 切换语言时仍能更新 tab title。

推荐方式：
- 新增 `DynamicTabDescriptor`。
- `MainTabView` 持有 `AppRemoteConfigStore`。
- `MainTabController` 接收 `[DynamicTabDescriptor]`，根据 descriptor 创建对应 root view。
- 对 native 核心 tab 保持原来的 root：ContactListView、ContactsTabView、DiscoverView、ProfileView。
- 对 web/screen tab 使用 DynamicScreenView 或 InAppWebView。

验收：
- app 无网启动时 tab 与现状一致。
- 远程配置可以调整 Discover/Profile 的顺序或展示额外活动 tab。
- 未知 tab 类型不会导致空白页或崩溃。

目标四：服务端驱动 UI Renderer
实现一个轻量、受限、原生 SwiftUI 的动态页面渲染器。注意：这是渲染 JSON schema，不是执行代码。

建议新增：
- BWChat/Views/Dynamic/DynamicScreenView.swift
- BWChat/Views/Dynamic/DynamicComponentRenderer.swift
- BWChat/Models/DynamicScreen.swift
- BWChat/Services/DynamicScreenStore.swift

支持组件类型第一版只做这些：
- screen：页面根
- section：分组
- card：卡片
- row/actionRow：可点击行
- banner：顶部/活动 banner
- text：文本
- image：远程/本地图片
- button：按钮
- divider：分割线
- spacer：间距
- list：列表容器
- walletBalance：钱包余额小组件，只读
- giftPreview：礼物预览，只读或跳转礼物页
- botList：Bot 推荐/市场入口

每个组件字段：
- id: String
- type: String
- visible: Bool?
- minAppVersion/maxAppVersion: String?
- props: [String: JSONValue]
- action: DynamicRoute?
- children: [DynamicComponent]?

渲染要求：
- 所有文本支持 titleKey + fallbackTitle 或 localized map。
- 所有颜色使用安全解析，非法颜色回退系统色。
- 图片 URL 走 RemoteAssetManager 或安全 AsyncImage/CachedAsyncImage。
- 组件未知时忽略，不崩溃。
- screen schemaVersion 高于客户端支持时显示 fallback/coming soon。
- 不允许 schema 触发任意 native API，只能触发 DynamicRouteHandler 白名单动作。

验收：
- 能用本地 fixture JSON 渲染一个活动页，包括 banner、文本、图片、按钮、actionRow。
- 能从 Profile 或 Discover 打开 `screen:daily_rewards`。
- schema 缺字段/未知组件/非法颜色/非法 route 时仍稳定。

目标五：强化 InAppWebView
当前 `DiscoverView.swift` 里的 InAppWebView 太基础。请升级为安全 WebView 容器：

建议新增或改造：
- BWChat/Views/Web/InAppWebView.swift
- BWChat/Services/WebViewPolicyStore.swift

要求：
- 使用 WKWebViewConfiguration。
- 只允许 http/https。
- 域名必须匹配 `webViewPolicy.allowedDomains`，内置默认白名单包含当前已使用的可信域名。
- 对外部跳转、App Store 链接、tel/mailto 等进行拦截并明确处理。
- 可注入最小 JS bridge，但第一版仅允许白名单方法，例如：
  - close
  - openRoute
  - getAppInfo
  - setNavigationTitle
- JS bridge 不得暴露 token、通讯录、相册、定位、麦克风、摄像头等敏感能力。
- web 页面请求权限时必须走系统权限和明确用户动作。
- 显示加载、失败、重试状态。

验收：
- 非白名单域名打不开，并显示安全提示。
- 白名单 H5 能正常打开。
- 页面内跳转被导航策略正确处理。
- Discover 原有 web route 仍可用。

目标六：远程资源管理
实现 RemoteAssetManager，用于节日装饰、礼物图、banner、贴纸、背景等非可执行资源。

建议新增：
- BWChat/Services/RemoteAssetManager.swift
- BWChat/Models/RemoteAssetManifest.swift

Manifest 项：
- key
- url
- sha256
- contentType
- byteSize
- tags
- cachePolicy
- expiresAt
- minAppVersion

要求：
- 下载到 caches 目录。
- 校验 sha256，不匹配则丢弃。
- 限制单文件大小和总缓存大小。
- 支持按 key 获取本地 URL 或 fallback asset name。
- 不下载可执行格式，不处理 dylib/framework/swift/js bundle 作为原生能力。

验收：
- 礼物资产可优先使用远程 manifest，失败时回落 Assets.xcassets 固定图。
- 节日 banner/装饰可以通过 manifest 替换。

目标七：钱包和礼物动态化但不绕过 StoreKit
钱包：
- `WalletView` 当前 packages 来自 `AppConfig.catFoodProducts`。可以改成 WalletRemoteConfig + 内置 fallback。
- 远程配置只能控制已在 App Store Connect 配置过的 productID 的展示顺序、文案、推荐标记、活动展示。
- 真实价格必须以 StoreKit `Product` 返回为准。
- 不能通过远程配置新增非 IAP 支付方式来购买数字内容/虚拟币。

礼物：
- `GiftPanelViewModel.loadGifts()` 已从 `/wallet/gifts/catalog` 拉取。扩展 GiftCatalogItem 支持 remote asset URL、animation URL、localized names、active、sortOrder、badge。
- 发送礼物仍走后端校验余额和 giftID。
- 礼物价格和接收方收益以服务端为准，前端只做展示和基本余额提示。

验收：
- 远程礼物 catalog 成功时显示远程礼物；失败时保留固定礼物。
- StoreKit 商品不可用时显示已有错误，不崩溃。

目标八：Bot 和运营策略动态化
前端只需要支持展示和消费后端配置：
- Bot 推荐/市场入口可由 DynamicScreen 或 Profile/Contacts 模块配置。
- Bot 人设、开场白、模型选择、系统 prompt 仍由后端控制，前端不要拼接最终 prompt。
- 前端只传 messages + bot_id，保持 `ChatbotAPI.swift` 现有职责。

验收：
- 后端返回不同 Bot 配置时，列表和详情能正常展示。
- Bot 动态入口可通过 Discover/Profile/Screen 打开。

目标九：Debug 和审核辅助
增加一个仅 Debug 可见的配置调试入口：
- 显示当前 configVersion、generatedAt、ETag、lastFetch、feature flags、web allowlist、asset manifest 摘要。
- 提供清空缓存、强制刷新按钮。

App Review 相关：
- 如果后端返回 reviewMode，可在审核账号下展示固定 demo 配置。
- 不能隐藏关键功能；reviewMode 只用于稳定审核体验。

验收：
- Debug 下可确认正在使用远程配置还是 fallback。
- Release 下不暴露内部调试信息。

测试和验证要求：
- 添加必要的 XCTest：配置 decode、route 解析、feature flag rollout、screen schema decode、web policy domain match。
- 至少提供一个本地 fixture：`app_config_sample.json` 和 `dynamic_screen_daily_rewards.json`。
- 跑 `xcodebuild` 或项目现有构建命令，确保编译通过。
- 手动验证：无网启动、配置非法、配置过期、web 域名不在白名单、礼物 catalog 失败、StoreKit 商品加载失败。

交付物：
- 代码改动。
- 简短技术说明文档，说明哪些能力可内更新、哪些仍需 App Store 发版。
- 示例 JSON 配置。
- 验证命令和结果。
```

## 前端配置样例

前端 prompt 可以要求实现时使用这个 fixture 作为第一版契约：

```json
{
  "schema_version": 1,
  "config_version": "2026-07-04.1",
  "generated_at": "2026-07-04T00:00:00Z",
  "refresh_interval_seconds": 300,
  "kill_switch": {
    "enabled": false,
    "message": {
      "zh-Hans": "服务维护中，请稍后再试",
      "en": "Service is under maintenance. Please try again later."
    }
  },
  "feature_flags": [
    {
      "key": "dynamic_profile_modules",
      "enabled": true,
      "rollout_percentage": 100,
      "min_app_version": "1.0.0"
    },
    {
      "key": "daily_rewards_screen",
      "enabled": true,
      "rollout_percentage": 50,
      "min_app_version": "1.0.0"
    }
  ],
  "tabs": [
    {
      "id": "messages",
      "type": "native",
      "title_key": "tab.messages",
      "system_image": "bubble.left.and.bubble.right",
      "selected_system_image": "bubble.left.and.bubble.right.fill",
      "order": 10,
      "enabled": true,
      "route": { "type": "native", "name": "messages" }
    },
    {
      "id": "discover",
      "type": "native",
      "title_key": "tab.discover",
      "system_image": "safari",
      "selected_system_image": "safari.fill",
      "order": 30,
      "enabled": true,
      "route": { "type": "native", "name": "discover" }
    },
    {
      "id": "festival",
      "type": "screen",
      "title": { "zh-Hans": "活动", "en": "Events" },
      "system_image": "sparkles",
      "selected_system_image": "sparkles",
      "order": 35,
      "enabled": true,
      "route": { "type": "screen", "screen_id": "festival_home" }
    }
  ],
  "profile_sections": [
    {
      "id": "account",
      "order": 10,
      "items": [
        {
          "id": "wallet",
          "type": "row",
          "title_key": "profile.wallet",
          "system_image": "pawprint.fill",
          "colors": ["FFB703", "FB8500"],
          "route": { "type": "native", "name": "wallet" }
        },
        {
          "id": "daily_rewards",
          "type": "row",
          "title": { "zh-Hans": "每日奖励", "en": "Daily Rewards" },
          "system_image": "gift.fill",
          "colors": ["34C759", "00B894"],
          "route": { "type": "screen", "screen_id": "daily_rewards" }
        }
      ]
    }
  ],
  "web_view_policy": {
    "allowed_domains": ["playdot.games", "example.bwchat.app"],
    "allowed_bridge_methods": ["close", "openRoute", "getAppInfo", "setNavigationTitle"],
    "external_domains_open_in_safari": true
  },
  "wallet": {
    "cat_food_products": [
      {
        "product_id": "com.bwchat.app.catfood.100",
        "coins": 100,
        "recommended": false,
        "order": 10
      },
      {
        "product_id": "com.bwchat.app.catfood.800",
        "coins": 800,
        "recommended": true,
        "order": 20
      }
    ]
  },
  "asset_manifest": {
    "version": "2026-07-04.festival",
    "assets": [
      {
        "key": "festival.banner.summer",
        "url": "https://cdn.example.bwchat.app/assets/summer-banner.png",
        "sha256": "REPLACE_WITH_REAL_HASH",
        "content_type": "image/png",
        "byte_size": 240000,
        "tags": ["festival", "banner"]
      }
    ]
  }
}
```

---

# Prompt B：后端动态配置与 CMS 改造

下面内容可直接复制给后端 agent。

```text
你是 BWChat 后端资深工程师。请为 BWChat-iOS 提供合规动态内更新能力：远程配置、功能开关、服务端驱动 UI schema、WebView 策略、资源 manifest、礼物 catalog 扩展、钱包 IAP 展示配置、Bot 策略配置、审核模式和灰度回滚。

重要边界：
- 后端只能下发数据、schema、资源 URL、Web URL、文案、排序、开关和策略；不能下发原生可执行代码。
- 不要设计任何绕过 App Store/IAP 的数字内容购买流程。
- 不能把客户端变成未经审核的任意小程序商店。所有 native action 必须在客户端白名单内。
- 所有配置必须版本化、可校验、可灰度、可回滚、可审计。
- 必须兼容当前 iOS 已有接口，不要破坏登录、聊天、钱包、礼物、Bot。

请先理解当前 iOS 现状：
- iOS 已有 `/app/discover-config`，模型是 DiscoverConfigData。
- iOS 已有 `/wallet/gifts/catalog`，模型是 GiftCatalogItem。
- iOS 钱包使用 StoreKit，商品 ID 目前写在 AppConfig.catFoodProducts。
- iOS Bot 使用 `/chatbot/bots`、`/chatbot/bots/public`、`/chatbot/chat`、`/chatbot/chat/stream`。
- iOS 请求远程配置会带 Accept-Language、X-App-Version、X-App-Build，登录后带 Authorization。

目标一：新增 App 全局配置接口
新增：
GET /api/v1/app/config

请求头：
- Authorization: Bearer <token> 可选
- Accept-Language
- X-App-Version
- X-App-Build
- X-Platform: iOS
- X-Timezone 可选
- If-None-Match 可选

响应：
- 支持标准 APIResponseWrapper 风格，或至少保证 iOS 可以 decode。
- 支持 ETag；配置未变更时返回 304。
- Cache-Control 使用短 TTL，例如 60-300 秒。

响应 data 字段包含：
- schema_version
- config_version
- generated_at
- refresh_interval_seconds
- min_supported_app_version
- min_supported_build
- kill_switch
- feature_flags
- tabs
- discover
- profile_sections
- contact_modules
- web_view_policy
- wallet
- asset_manifest
- review_mode

要求：
- 根据 app version/build 返回兼容配置。
- 根据用户、语言、国家、实验组、审核账号返回差异化配置。
- 如果用户未登录，也返回公共默认配置。
- 所有 unknown/experimental 字段必须不影响旧客户端。

目标二：Feature Flag 和灰度系统
设计/实现 feature flag 存储和计算：

字段：
- key
- enabled
- rollout_percentage
- salt
- min_app_version
- max_app_version
- min_build
- max_build
- countries
- languages
- user_allowlist
- user_blocklist
- segments
- starts_at
- ends_at
- owner
- description

计算要求：
- 对 userID 或 deviceID 做稳定 hash，确保同一用户灰度结果稳定。
- 支持 kill switch，优先级高于普通 flag。
- 返回给 iOS 的是计算后的结果，不要让 iOS 承担复杂分群逻辑。
- 返回 config_version 和 flags snapshot，方便排查。

验收：
- 可按 1%、10%、50%、100% 灰度某个 screen/tab/module。
- 可一键关闭某个动态页面或 WebView 入口。

目标三：服务端驱动 UI Screen 接口
新增：
GET /api/v1/app/screens/{screen_id}

也允许小型 screen 直接内嵌在 `/app/config` 中，但大页面建议单独接口。

Screen schema：
- screen_id
- schema_version
- config_version
- title/title_key/localized_title
- min_app_version
- refresh_interval_seconds
- components

Component schema：
- id
- type
- visible
- min_app_version
- max_app_version
- props
- action
- children

第一版允许组件类型：
- screen
- section
- card
- row/actionRow
- banner
- text
- image
- button
- divider
- spacer
- list
- walletBalance
- giftPreview
- botList

Action/route schema：
- type: native | web | screen | coming_soon | disabled
- name
- url
- screen_id
- title/localized_title
- params

Native name 必须限制在 iOS 白名单：
- messages
- contacts
- discover
- profile
- moments
- my_moments
- groups
- nearby
- wallet
- settings
- edit_profile
- bot_create
- bot_market

后端校验：
- 禁止发布未知 native route，除非客户端 capability 声明支持。
- 禁止发布不在 WebView allowlist 的 URL。
- 禁止 schemaVersion 高于目标客户端支持范围。
- 图片资源必须来自受信 CDN，建议必须出现在 asset_manifest。

验收：
- 可以发布 `daily_rewards` 页面，并从 profile_sections 跳转打开。
- 可以对 `daily_rewards` 做灰度和一键关闭。
- 配置错误时发布系统拒绝，而不是让客户端崩溃。

目标四：WebView 策略接口
在 `/app/config` 返回：
- allowed_domains
- blocked_domains
- allowed_bridge_methods
- external_domains_open_in_safari
- require_https
- permission_policy

要求：
- 默认只允许公司控制域名和明确可信第三方域名。
- 不允许任意 URL 进入 App 内 WebView。
- JS bridge 方法必须白名单。
- 对需要登录态的 H5，设计安全 token 交换或 cookie 方案，不要把长期 token 暴露给 JS。

验收：
- 后端配置一个非白名单 URL 时，发布系统应拒绝。
- iOS 可以拿到 allowlist 并做拦截。

目标五：资源 manifest 和 CDN 管理
新增：
GET /api/v1/app/assets/manifest

也可把简化 manifest 放进 `/app/config`。

Manifest 字段：
- version
- generated_at
- assets[]

Asset 字段：
- key
- url
- sha256
- content_type
- byte_size
- width
- height
- tags
- cache_policy
- expires_at
- min_app_version

要求：
- 只允许非可执行资源：png/jpg/webp/gif/json/lottie/audio 等。
- 不允许 dylib/framework/ipa/swiftbundle 等可执行或伪热修复资源。
- 计算并返回 sha256，iOS 下载后校验。
- CDN URL 使用 HTTPS。
- 支持资源过期、灰度和回滚。

典型用途：
- 节日 banner
- 发现页图标/背景
- 礼物图片/动画
- 聊天背景
- 贴纸包
- 活动页图片

目标六：扩展 Discover 配置
保留现有：
GET /api/v1/app/discover-config

同时让 `/app/config.discover` 与它使用同一份配置源。

扩展 DiscoverItem：
- id
- title/title_key/localized_title
- subtitle/localized_subtitle
- system_image
- remote_icon_key
- colors
- badge_key
- dot_key
- enabled
- order
- route
- min_app_version

验收：
- 旧 iOS 仍可请求 `/app/discover-config`。
- 新 iOS 可从 `/app/config` 拿到同样发现页配置。

目标七：扩展 Profile/Contacts 动态模块
在 `/app/config` 返回：
- profile_sections
- contact_modules

Profile 适合远程控制：
- 钱包入口展示/排序
- 我的动态入口
- 每日奖励入口
- 活动入口
- Bot 市场入口
- 设置入口排序

Contacts 适合远程控制：
- Bot 推荐卡
- 新朋友/群组入口
- 活动邀请入口

要求：
- 不要远程删除核心聊天能力。
- 所有 action 必须使用 route schema。

目标八：钱包/IAP 配置
在 `/app/config.wallet` 或单独接口返回：
- cat_food_products
- withdrawal_networks
- exchange_rate_display
- terms_url
- ad_reward_enabled

cat_food_products 字段：
- product_id
- coins
- order
- recommended
- badge/localized_badge

关键规则：
- product_id 必须是 App Store Connect 已配置商品。
- iOS 真实价格以 StoreKit 返回为准。
- 后端 `/wallet/ios-iap/confirm` 继续验证 Apple transaction，并以服务器侧 product mapping 决定发放数量。
- 不允许 H5 或外部支付购买猫粮/数字内容。

验收：
- 能调整 IAP 商品展示顺序和推荐角标。
- Apple transaction 校验失败不会发放猫粮。

目标九：礼物 catalog 动态化
扩展：
GET /api/v1/wallet/gifts/catalog

Gift 字段：
- gift_id
- name/localized_name
- price
- receiver_currency
- asset_key
- remote_asset_key
- image_url 可选
- animation_asset_key 可选
- sort_order
- active
- badge/localized_badge
- min_app_version

要求：
- 发送礼物接口仍由服务器校验余额、价格、礼物是否 active。
- 客户端传 gift_id，价格以服务器实时数据为准。
- 下架礼物后，历史消息仍能用 fallback 名称/asset_key 显示。

验收：
- 新增节日礼物无需 iOS 发版即可出现。
- 价格变更由服务器控制。
- 老版本客户端看到无法识别礼物时有 fallback。

目标十：Bot 策略动态化
扩展 Bot 相关后端能力：
- Bot 市场/推荐列表可由 dynamic screen 或 contact/profile module 展示。
- BotConfig 返回 localized_name、avatar_url、tags、opening_line、gender、is_public。
- 最终系统 prompt、模型选择、安全策略由后端维护，不让 iOS 拼接最终 prompt。
- 支持按 feature flag 灰度不同 bot template、模型、回复策略。

验收：
- iOS 仍只发送 messages + bot_id。
- 后端可修改 Bot 人设/开场白/模型策略，无需 iOS 发版。

目标十一：审核模式和发布后台
实现 App Review Profile：
- 按审核账号、审核 build、IP/地区或手动开关返回稳定 demo config。
- demo config 展示动态发现页、WebView 活动页、礼物、Bot、Profile 动态入口。
- 不隐藏核心功能，不制造与真实用户完全不同的欺骗性 app。

发布后台/CMS 至少要有：
- 草稿
- 预览
- schema 校验
- 版本发布
- 灰度比例
- 回滚
- 审计日志
- owner/description
- 线上 config diff

验收：
- 可以回滚到上一版 config。
- 可以看到某个用户命中的 configVersion/feature flags。
- 发布非法 URL、未知 native route、缺少 fallback 文案时失败。

目标十二：观测和排障
后端日志和埋点：
- 每次 `/app/config` 返回 config_version、user_id、app_version、build、locale、flags。
- screen 打开、route 点击、web 拦截、asset 下载失败由 iOS 上报时可关联 config_version。
- Crash/错误分析能按 config_version 聚合。

交付物：
- API 实现。
- DB migration 或配置存储方案。
- JSON schema/TypeScript/Pydantic/Go struct 等契约文件。
- 示例配置和示例 dynamic screen。
- CMS/管理命令或最小发布脚本。
- 单元测试：flag rollout、schema validator、version compatibility、web allowlist、IAP product mapping。
- 集成说明：iOS 如何请求、缓存、回退、灰度。
```

## 后端响应样例

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "schema_version": 1,
    "config_version": "2026-07-04.1",
    "generated_at": "2026-07-04T00:00:00Z",
    "refresh_interval_seconds": 300,
    "feature_flags": [
      {
        "key": "daily_rewards_screen",
        "enabled": true,
        "rollout_percentage": 100
      }
    ],
    "profile_sections": [
      {
        "id": "growth",
        "order": 20,
        "items": [
          {
            "id": "daily_rewards",
            "type": "row",
            "title": {
              "zh-Hans": "每日奖励",
              "en": "Daily Rewards"
            },
            "system_image": "gift.fill",
            "colors": ["34C759", "00B894"],
            "route": {
              "type": "screen",
              "screen_id": "daily_rewards"
            }
          }
        ]
      }
    ],
    "web_view_policy": {
      "allowed_domains": ["example.bwchat.app", "playdot.games"],
      "blocked_domains": [],
      "allowed_bridge_methods": ["close", "openRoute", "getAppInfo", "setNavigationTitle"],
      "external_domains_open_in_safari": true,
      "require_https": true
    }
  }
}
```

动态 screen 样例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "screen_id": "daily_rewards",
    "schema_version": 1,
    "config_version": "2026-07-04.1",
    "title": {
      "zh-Hans": "每日奖励",
      "en": "Daily Rewards"
    },
    "components": [
      {
        "id": "hero",
        "type": "banner",
        "props": {
          "title": {
            "zh-Hans": "今天也来领猫粮",
            "en": "Claim today's cat food"
          },
          "subtitle": {
            "zh-Hans": "完成聊天、发动态、送礼物获得奖励",
            "en": "Chat, post, and gift to earn rewards"
          },
          "asset_key": "festival.banner.summer"
        }
      },
      {
        "id": "wallet",
        "type": "walletBalance",
        "props": {
          "style": "compact"
        },
        "action": {
          "type": "native",
          "name": "wallet"
        }
      },
      {
        "id": "open_moments",
        "type": "button",
        "props": {
          "title": {
            "zh-Hans": "去发动态",
            "en": "Post a Moment"
          }
        },
        "action": {
          "type": "native",
          "name": "moments"
        }
      }
    ]
  }
}
```

---

# 前后端协作顺序

建议按以下顺序推进，避免前端和后端互相等待：

1. 后端先确定 JSON schema、route 白名单、feature flag 计算规则和示例 fixture。
2. 前端用本地 fixture 先实现 decode、缓存、route handler、dynamic screen renderer。
3. 后端实现 `/app/config`、`/app/screens/{screen_id}`、manifest、web allowlist、发布校验。
4. 前端接入真实接口，并保留 `/app/discover-config` 的兼容 fallback。
5. 共同验证：无网、旧版本、非法配置、灰度、回滚、WebView 白名单、IAP 商品不可用、礼物 catalog 失败。
6. 上架前准备 App Review Notes：说明动态配置、WebKit 活动页、服务端驱动 UI、礼物/Bot/活动入口，提供 demo account 和 review config。

# 最小可行版本建议

第一版不要一次做“万能小程序平台”。建议按这个 MVP 做：

- `/app/config`
- 全局 AppRemoteConfigStore
- FeatureFlagService
- DynamicRouteHandler
- Discover/Profile 动态入口
- Hardened InAppWebView
- DynamicScreenRenderer 支持 8-10 个基础组件
- RemoteAssetManifest 支持图片资源
- 礼物 catalog 扩展 remote asset
- 钱包 IAP 展示配置但不改支付逻辑
- Debug 配置页和示例 fixture

这样能覆盖大部分运营和轻功能内更新，同时保持 App Store 风险可控。
