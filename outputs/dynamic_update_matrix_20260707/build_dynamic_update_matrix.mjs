import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "outputs/dynamic_update_matrix_20260707";
const outputPath = `${outputDir}/BWChat_iOS_dynamic_update_matrix.xlsx`;

const colors = {
  navy: "#12324A",
  blue: "#1D4ED8",
  lightBlue: "#DBEAFE",
  green: "#15803D",
  lightGreen: "#DCFCE7",
  yellow: "#A16207",
  lightYellow: "#FEF3C7",
  red: "#B91C1C",
  lightRed: "#FEE2E2",
  gray: "#64748B",
  lightGray: "#F8FAFC",
  border: "#CBD5E1",
  darkBorder: "#94A3B8",
  white: "#FFFFFF",
  ink: "#0F172A",
};

const abilityHeaders = [
  "模块",
  "当前已有/入口",
  "可直接调整（内更新）",
  "可新增功能（内更新）",
  "更新方式",
  "后端依赖",
  "风险等级",
  "主结论",
  "必须走上架的边界",
  "内更新覆盖率",
];

const abilityRows = [
  ["Main Tab 主导航", "当前 5 个 Tab：Messages、Contacts、Map、Discover、Profile", "标题、图标、顺序、角标、Map 显隐、新增 web/screen Tab", "活动、福利、任务中心、专题页入口", "AppRemoteConfig.tabs + DynamicRoute", "/api/v1/app/config.tabs", "中", "70%-85% 可内更新", "新增 native Tab 容器、移除全部核心 Tab、系统级角标逻辑", 0.8],
  ["Discover 发现页", "已有分组入口、旧 discover-config fallback", "入口、分组、排序、图标、颜色、Badge、红点、禁用/coming soon", "H5 活动、SDUI 专题、福利页、短剧专题", "config.discover + 旧接口兼容", "/api/v1/app/config.discover、/api/v1/app/discover-config", "低", "85% 可内更新", "新 native 内容类型、小程序商店、任意代码运行", 0.85],
  ["Profile 我的页", "钱包、我的动态、设置等入口", "菜单显隐、排序、文案、图标、活动入口", "每日奖励、活动中心、Bot 市场、帮助中心、协议页", "profile_sections + DynamicRoute", "/api/v1/app/config.profile_sections", "中", "80% 可内更新", "删除个人资料核心区、关注/粉丝/编辑资料、引入新系统权限", 0.8],
  ["Contacts 联系人", "好友申请、我的群、AI 伙伴入口、好友列表和搜索", "顶部模块排序、显隐、文案、AI 推荐卡", "Bot 推荐、群活动、邀请活动入口", "contact_modules + DynamicRoute", "/api/v1/app/config.contact_modules", "中", "75% 可内更新", "替换好友列表/搜索/聊天入口等核心原生能力", 0.75],
  ["WebView / H5", "新增安全 InAppWebView 容器", "白名单域名、导航标题、close/openRoute/getAppInfo/setNavigationTitle", "活动页、帮助页、条款页、运营落地页", "web_view_policy + H5 URL", "/api/v1/app/config.web_view_policy、短期会话/token exchange", "中", "80% 可内更新", "新增 bridge 方法、暴露 token/定位/相册/通讯录、非 HTTPS 任意页面", 0.8],
  ["SDUI 动态页面", "DynamicScreenView + 组件白名单", "布局、文案、图片、按钮、列表、钱包余额、礼物预览、Bot 列表", "daily_rewards、festival_home、bot_market、help_center、wallet_terms", "GET /api/v1/app/screens/{screen_id}", "/api/v1/app/screens/{screen_id}", "中", "75% 可内更新", "新增组件类型、新原生交互、新桥接动作", 0.75],
  ["Remote Assets 远程资源", "RemoteAssetManager + sha256 校验 + cache", "Banner、图标、礼物图、节日素材、聊天背景、非执行资源", "节日皮肤、活动物料、礼物动画资源", "asset_manifest + CDN", "/api/v1/app/assets/manifest 或内嵌 manifest", "低", "85% 可内更新", "dylib/framework/ipa/swiftbundle/jsbundle、超大文件、未知内容类型", 0.85],
  ["Wallet / IAP 钱包", "钱包页、StoreKit 商品、提现说明、广告入口默认关闭", "已存在 productID 的排序、推荐、角标、说明文案、提现网络展示", "钱包活动文案、条款页、提现说明、广告入口预埋开关", "wallet config + StoreKit fallback", "/api/v1/app/config.wallet、/wallet/ios-iap/confirm", "高", "70% 可内更新", "新增 IAP productID、真实价格规则、外部支付、激励广告 SDK", 0.7],
  ["Gifts 礼物", "固定礼物 catalog fallback + 服务端 catalog", "上下架、排序、本地化名称、远程图片/动画 key、Badge", "节日礼物、新活动礼物、专题礼物面板素材", "GET /api/v1/wallet/gifts/catalog", "/api/v1/wallet/gifts/catalog、asset_manifest", "高", "80% 可内更新", "新礼物消息类型、新动画引擎、客户端定价或余额判断", 0.8],
  ["Bot / AI 伙伴", "Bot 创建、Bot 列表、聊天/stream 接口", "入口、推荐顺序、人设、头像、开场白、标签、模型策略", "Bot 市场专题、推荐卡、活动 Bot", "bot APIs + DynamicScreen botList", "/chatbot/bots、/chatbot/bots/public、/chatbot/chat", "中", "75% 可内更新", "客户端拼最终 system prompt、语音/图片/礼物/通话等未预埋能力", 0.75],
  ["短剧 Short Drama", "入口与服务端短剧内容", "剧集、封面、标题、简介、排序、互动数、评论内容", "短剧专题、榜单、活动剧集入口", "后端内容 + Discover/Profile/Tab route", "短剧内容接口 + /api/v1/app/config", "中", "75% 可内更新", "播放器能力、DRM、下载、投屏、付费播放器", 0.75],
  ["Moments 动态", "Feed、发布器、我的动态入口", "默认 Tab、活动话题、Banner、付费解锁价格档（本地上限内）", "话题活动、世界圈运营位、动态专题", "config + moments 后端内容", "Moments 接口 + /api/v1/app/config", "中", "75% 可内更新", "Story、直播、新媒体类型、拍摄编辑器、突破本地限制", 0.75],
  ["Map / Nearby 地图", "Map Tab、附近的人、地图实验入口", "Tab 显隐、附近半径、用户卡片文案、举报原因、FlightLayer feature flag", "附近活动入口、地图活动 Banner", "feature_flags + map config", "/api/v1/app/config.feature_flags", "中", "70% 可内更新", "后台定位、第三方地图 SDK、AR 地图、权限模式变化", 0.7],
  ["Debug / Review 辅助", "Debug 配置页、fixture、review_mode 模型", "展示版本、ETag、flags、allowlist、manifest 摘要、强制刷新/清缓存", "审核稳定 demo config、灰度演示配置", "本地 Debug + review_mode", "/api/v1/app/config.review_mode", "低", "85% 可内更新", "审核欺骗、隐藏核心功能、与真实功能不一致的演示", 0.85],
];

const newFeatureHeaders = [
  "新增功能/场景",
  "推荐承载方式",
  "推荐入口位置",
  "后端需求",
  "是否可内更新",
  "注意事项",
  "优先级",
];

const newFeatureRows = [
  ["活动中心", "SDUI screen 或 H5/WebView", "新增 Tab、Discover、Profile", "screen 配置、活动数据、route 校验", "可内更新", "URL 必须在白名单；动作只能走 DynamicRoute 白名单", "P0"],
  ["节日首页/节日皮肤", "SDUI + Remote Assets + Feature Flag", "Discover Banner、Profile、Tab", "asset manifest、节日配置、灰度开关", "可内更新", "只能下发图片/Lottie/音频等非执行资源", "P1"],
  ["每日奖励页", "SDUI screen；领奖动作可走 H5 或既有 API", "Profile、Discover、任务中心", "奖励规则、领奖接口、幂等校验", "可内更新", "如果客户端没有领奖动作，第一版只做展示或走 H5", "P0"],
  ["签到/任务中心", "H5/WebView 或 SDUI", "Profile、Tab、Discover", "任务列表、进度、领奖、风控", "可内更新", "真实奖励必须后端最终校验，不能只信前端状态", "P1"],
  ["帮助中心/FAQ", "H5/WebView 或 SDUI text/list", "Profile、Settings", "CMS 内容、allowed_domains", "可内更新", "不需要 bridge；适合最先上线", "P0"],
  ["协议页/钱包条款", "H5/WebView", "Wallet、Profile、Settings", "terms_url、版本号、发布时间", "可内更新", "必须 HTTPS；审核和支付条款需稳定", "P0"],
  ["Bot 市场专题", "DynamicScreen botList 或 H5", "Profile、Contacts、Discover", "Bot 列表、标签、推荐位", "可内更新", "只能跳转到已支持的 bot_create/bot_market 等 route", "P1"],
  ["Bot 推荐卡/榜单", "Config + 后端内容", "Contacts、Profile", "/chatbot/bots/public 扩展字段", "可内更新", "不能开启未预埋的语音、图片、礼物、通话能力", "P1"],
  ["短剧专题/榜单", "后端内容 + SDUI/H5 入口", "Discover、Tab", "短剧列表、封面、排序、互动数据", "可内更新", "播放器能力不变；只换内容和入口", "P1"],
  ["新礼物/节日礼物", "Gift catalog + Remote Assets", "礼物面板", "catalog、价格、active、asset_key、服务端余额校验", "可内更新", "发送只传 gift_id；价格与余额永远服务端校验", "P0"],
  ["运营 Banner/红点/角标", "App config + Asset manifest", "Tab、Discover、Profile、Wallet", "badge_key、dot_key、图片资源、灰度", "可内更新", "避免误导性红点；需支持回滚", "P0"],
  ["福利页/权益页", "SDUI screen 或 H5", "Profile、Wallet、Tab", "权益配置、文案、URL 白名单", "可内更新", "涉及数字内容购买不能绕过 StoreKit", "P1"],
  ["地图附近活动入口", "Config route + Feature Flag", "Map、Discover", "入口配置、活动范围、灰度", "可内更新", "不能改变定位权限或引入新地图 SDK", "P2"],
  ["举报原因/安全提示文案", "Config", "Map、Moments、Profile", "原因列表、文案、本地化", "可内更新", "保留本地 fallback，避免审核/合规缺失", "P1"],
  ["钱包商品展示排序/文案", "WalletRemoteConfig", "Wallet", "product mapping、badge_i18n、order", "可内更新", "只允许 App 内已知 productID；真实价格用 StoreKit", "P0"],
  ["提现说明/网络展示", "WalletRemoteConfig", "Wallet", "withdrawal_networks、exchange_rate_display", "可内更新", "服务端最终校验最低提现、汇率、网络可用性", "P0"],
  ["邀请好友活动", "H5/WebView 或 SDUI route", "Discover、Profile", "邀请活动页、归因、奖励接口", "可内更新", "若要新增原生分享面板或系统能力，需要发版", "P2"],
  ["App Review 演示配置", "review_mode + 稳定 config", "全局", "审核账号/审核 build 命中稳定配置", "可内更新", "不能隐藏核心功能，不能制造欺骗性审核体验", "P0"],
];

const releaseHeaders = ["发版项", "为什么必须发版", "例子", "替代内更新方案", "风险级别"];
const releaseRows = [
  ["新增 native 页面或 native route", "客户端没有对应 View/导航逻辑，配置无法凭空生成原生代码", "新增完整原生任务页、AR 地图页", "先用 SDUI/H5 承载 MVP", "高"],
  ["新增 SDUI 组件类型", "第一版组件白名单固定，未知组件会忽略", "videoPlayer、calendar、cameraPicker", "用现有 card/row/banner/button/list 组合", "中"],
  ["新增 WebView bridge 方法", "Bridge 是原生能力边界，新增方法等于新增客户端能力", "getLocation、openCamera、pay、shareNative", "通过 H5 服务端流程或已存在 openRoute", "高"],
  ["新增系统权限或隐私能力", "需要 Info.plist、权限文案、审核说明和原生实现", "相册、麦克风、通讯录、后台定位", "用 H5 展示或已有原生入口", "高"],
  ["新增第三方 SDK", "SDK 必须随 App 包发布，不能内更新下发", "广告 SDK、地图 SDK、支付 SDK", "先隐藏入口或用后端内容页", "高"],
  ["新增 IAP productID", "当前前端只接受本地已知 productID；价格必须 StoreKit", "新增 9999 猫粮商品", "用现有商品做排序/推荐/文案活动", "高"],
  ["改变购买/支付链路", "数字内容必须走 StoreKit，不能 H5/外部支付绕过", "网页购买猫粮、第三方支付礼物", "StoreKit 商品展示优化 + 后端促销说明", "高"],
  ["新增聊天消息类型", "会影响消息解析、UI、历史兼容和通知", "红包消息、投票消息、礼物动画新协议", "先用文本/系统消息或 H5 活动页", "高"],
  ["新媒体类型/Story/直播/编辑器", "需要采集、上传、预览、权限、播放器等原生能力", "Story、直播、拍摄剪辑器", "用 Moments 话题/Banner 引导现有发布器", "高"],
  ["播放器能力升级", "播放器、DRM、下载、投屏、付费播放都需要原生预埋", "短剧离线下载、AirPlay 控制、DRM", "只更新剧集内容/封面/排序/入口", "高"],
  ["后台定位/AR 地图", "需要权限、后台模式、耗电策略、审核说明", "附近的人后台刷新、AR 导航", "只调入口、半径、文案、举报原因", "高"],
  ["可执行热更或代码包", "违反当前合规边界：不下载、不安装、不执行新代码", "Swift bundle、JS bundle、Lua/WASM、动态库", "配置、非执行资源、H5、受限 JSON UI", "高"],
  ["暴露敏感 token 或隐私数据给 H5", "安全和审核风险极高，且当前 bridge 明确禁止", "JS 读取长期 token、通讯录、相册", "短期 token exchange 或服务端 session", "高"],
  ["新增激励广告能力", "若 SDK 未预埋，广告加载和回调无法通过配置实现", "看广告得猫粮", "入口保持 disabled，发版预埋 SDK 后再灰度", "中"],
  ["推送类别/通知扩展新交互", "新 category/action 需要客户端注册和通知扩展支持", "通知内回复新按钮、富媒体新模板", "用现有 push deep link 跳转已支持 route", "中"],
  ["破坏性 API/schema 变更", "旧客户端无法解析或会走 fallback，不能保证体验", "删除必填字段、改 route schema", "新增字段并保持向后兼容", "高"],
];

const backendHeaders = ["接口/配置段", "作用", "前端消费位置", "关键字段", "发布校验", "示例用途", "状态"];
const backendRows = [
  ["GET /api/v1/app/config", "全局动态配置入口，支持未登录/登录、ETag、灰度、review_mode", "AppRemoteConfigStore", "schema_version、config_version、tabs、discover、profile_sections、wallet、review_mode", "schema 校验、版本门槛、kill_switch、ETag 304", "一次性控制 Tab、入口、主题、钱包展示、WebView 策略", "需后端新增"],
  ["feature_flags", "稳定灰度和功能开关", "FeatureFlagService", "key、enabled、rollout_percentage、min_build、countries、languages", "后端计算命中；kill_switch 优先；支持用户查询", "FlightLayer、ad_reward、动态入口灰度", "需后端新增"],
  ["tabs", "动态主 Tab 描述", "MainTabView", "id、type、title_i18n、system_image、route、order、enabled", "核心 Tab 不能全部移除；route 必须白名单", "新增活动 Tab、隐藏 Map、调整标题图标", "需后端新增"],
  ["discover", "发现页动态入口", "DiscoverView", "sections、items、route、colors、badge_key、dot_key、remote_icon_key", "native route 白名单；web URL 白名单；fallback 文案", "运营入口、短剧专题、活动 Banner", "需后端新增/兼容旧接口"],
  ["profile_sections", "我的页模块配置", "ProfileView", "section、items、title_i18n、route、enabled、order", "钱包/我的动态/设置必须 fallback", "每日奖励、帮助中心、Bot 市场", "需后端新增"],
  ["contact_modules", "联系人页顶部模块配置", "Contacts 计划接入", "id、title_i18n、icon、route、enabled、order", "好友列表/搜索/聊天入口不得删除", "AI 推荐卡、群活动入口", "前端模型有，视图待接入"],
  ["web_view_policy", "安全 WebView 策略", "InAppWebView", "allowed_domains、blocked_domains、allowed_bridge_methods、require_https", "URL 发布前校验；不暴露长期 token；外部域名 Safari", "活动 H5、帮助页、条款页", "需后端新增"],
  ["asset_manifest", "远程资源清单", "RemoteAssetManager、礼物/动态页图片", "key、url、sha256、content_type、byte_size、fallback_asset_name", "HTTPS、sha256 必填、禁止可执行文件、大小限制", "礼物图、Banner、节日皮肤、聊天背景", "需后端新增"],
  ["GET /api/v1/app/screens/{screen_id}", "受限 JSON UI 动态页面", "DynamicScreenStore / DynamicScreenView", "screen_id、schema_version、components、action、props", "组件白名单、action route 校验、图片来源校验", "daily_rewards、festival_home、bot_market、help_center", "需后端新增"],
  ["wallet", "钱包展示配置", "WalletView / WalletStore", "cat_food_products、withdrawal_networks、terms_url、ad_reward_enabled", "product_id 必须已存在；真实价格 StoreKit；服务端发放数量", "商品排序、推荐角标、提现说明", "需后端新增"],
  ["GET /api/v1/wallet/gifts/catalog", "礼物 catalog 扩展", "GiftViews / APIService", "gift_id、localized_name、price、remote_asset_key、animation_asset_key、active", "发送礼物时实时校验 active/price/balance", "节日礼物上下架、礼物排序", "需后端扩展"],
  ["Bot APIs", "Bot 内容和策略继续后端控制", "Bot 市场/聊天入口", "localized_name、avatar_url、tags、opening_line、is_public", "最终 prompt/模型/风控由后端控制", "Bot 市场、推荐卡、榜单", "需后端扩展"],
  ["review_mode", "App Review 稳定配置", "AppRemoteConfigStore / DebugView", "enabled、review account/build、demo config", "不隐藏核心功能、不制造欺骗体验", "审核账号看到稳定动态能力", "需后端新增"],
  ["发布后台", "配置草稿、校验、灰度、回滚和审计", "后端运营系统", "owner、description、config diff、user hit query", "route/web/assets/IAP/schema 发布校验", "运营无需发版调整入口和内容", "需后端建设"],
];

const statusHeaders = ["前端能力", "状态", "文件/位置", "已验证", "备注"];
const statusRows = [
  ["AppRemoteConfig 模型", "已完成", "BWChat/Models/DynamicConfigModels.swift", "xcodebuild BUILD SUCCEEDED", "包含 tabs、discover、profile_sections、contact_modules、theme、web_view_policy、asset_manifest、wallet、review_mode"],
  ["AppRemoteConfigStore / FeatureFlag", "已完成", "BWChat/Services/AppRemoteConfigStore.swift", "xcodebuild BUILD SUCCEEDED", "本地默认值、UserDefaults 缓存、ETag、最小 refresh interval、登录态 header"],
  ["DynamicRouteHandler", "已完成", "BWChat/Services/DynamicRouteHandler.swift", "xcodebuild BUILD SUCCEEDED", "native route 白名单、web/screen/coming_soon/disabled/external 边界"],
  ["动态 Main Tab", "已完成", "BWChat/Views/MainTabView.swift", "xcodebuild BUILD SUCCEEDED", "核心 Tab fallback；Map 可隐藏；支持 web/screen Tab"],
  ["动态 Discover", "已完成", "BWChat/Views/DiscoverView.swift", "xcodebuild BUILD SUCCEEDED", "优先新 config.discover，保留旧 discover-config 兼容和本地 fallback"],
  ["动态 Profile", "已完成", "BWChat/Views/ProfileView.swift", "xcodebuild BUILD SUCCEEDED", "钱包/我的动态/设置 fallback；支持新增动态入口"],
  ["Contacts 动态模块", "待接入", "计划接入 Contacts 视图", "未单独验证", "模型已包含 contact_modules；视图层需按同一 DynamicSection/RouteHandler 接入"],
  ["安全 InAppWebView", "已完成", "BWChat/Views/Web/InAppWebView.swift", "xcodebuild BUILD SUCCEEDED", "HTTPS/白名单、加载失败/重试、受限 bridge；不暴露 token/隐私权限"],
  ["SDUI 动态页面", "已完成", "BWChat/Services/DynamicScreenStore.swift、BWChat/Views/DynamicScreenView.swift", "xcodebuild BUILD SUCCEEDED", "未知组件忽略；schema 过高 coming soon；动作走 DynamicRouteHandler"],
  ["RemoteAssetManager", "已完成", "BWChat/Services/RemoteAssetManager.swift", "xcodebuild BUILD SUCCEEDED", "下载到 Caches、sha256、大小/contentType 校验；UI 仍需逐步改为优先 verified cache"],
  ["Wallet 动态展示", "已完成", "BWChat/Views/WalletView.swift、BWChat/Services/WalletStore.swift", "xcodebuild BUILD SUCCEEDED", "只接受本地已知 productID；真实价格 StoreKit；购买确认仍走服务端"],
  ["Gift catalog 扩展", "已完成", "BWChat/Models/Gift.swift、BWChat/Components/GiftViews.swift、BWChat/Services/APIService.swift", "xcodebuild BUILD SUCCEEDED", "服务端 catalog fallback 到 fixedCatalog；未知 giftID 有 fallback 显示"],
  ["Map feature flag", "已完成", "BWChat/Views/MapDatingView.swift", "xcodebuild BUILD SUCCEEDED", "FlightLayerExperiment 改为受 feature flag 控制，默认关闭"],
  ["Debug 配置页", "已完成", "BWChat/Views/AppConfigDebugView.swift、BWChat/BWChatApp.swift", "xcodebuild BUILD SUCCEEDED", "仅 Debug 可见，展示 config/flags/allowlist/manifest 摘要，支持清缓存/强刷/fixture"],
  ["ATS 精确收敛", "后续", "BWChat/Info.plist", "未执行", "当前仍需后续把 NSAllowsArbitraryLoads=true 收敛为 HTTPS/WSS/精确例外"],
  ["前端单元测试", "后续", "Test Plan", "未执行", "建议补 AppRemoteConfig decode、ETag、route、WebView allowlist、SDUI decode、asset 校验、wallet/gift 兼容测试"],
];

function colName(indexZeroBased) {
  let n = indexZeroBased + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function rangeAddress(row1, col1, row2, col2) {
  return `${colName(col1 - 1)}${row1}:${colName(col2 - 1)}${row2}`;
}

function styleTitle(sheet, title, subtitle, lastCol) {
  const titleRange = sheet.getRange(rangeAddress(1, 1, 1, lastCol));
  titleRange.merge();
  titleRange.values = [[title]];
  titleRange.format = {
    fill: colors.navy,
    font: { bold: true, color: colors.white, size: 18 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  titleRange.format.rowHeight = 34;

  const subtitleRange = sheet.getRange(rangeAddress(2, 1, 2, lastCol));
  subtitleRange.merge();
  subtitleRange.values = [[subtitle]];
  subtitleRange.format = {
    fill: colors.lightBlue,
    font: { color: colors.ink, size: 10 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
    wrapText: true,
  };
  subtitleRange.format.rowHeight = 32;
}

function styleTable(sheet, headers, rows, tableName, widths) {
  const headerRow = 4;
  const startRow = 5;
  const lastCol = headers.length;
  const endRow = startRow + rows.length - 1;

  styleTitle(
    sheet,
    sheet.name,
    "绿色表示可通过配置/内容/资源/H5/SDUI 内更新；黄色表示需要后端灰度或接口配合；红色表示需要走 App Store 发版或合规审核。",
    lastCol,
  );

  sheet.getRange(rangeAddress(headerRow, 1, headerRow, lastCol)).values = [headers];
  sheet.getRange(rangeAddress(startRow, 1, endRow, lastCol)).values = rows;

  const fullRange = sheet.getRange(rangeAddress(headerRow, 1, endRow, lastCol));
  fullRange.format = {
    borders: { preset: "outside", style: "thin", color: colors.darkBorder },
    wrapText: true,
    verticalAlignment: "top",
  };

  const headerRange = sheet.getRange(rangeAddress(headerRow, 1, headerRow, lastCol));
  headerRange.format = {
    fill: colors.navy,
    font: { bold: true, color: colors.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
  headerRange.format.rowHeight = 30;

  sheet.getRange(rangeAddress(startRow, 1, endRow, lastCol)).format = {
    fill: colors.white,
    font: { color: colors.ink, size: 10 },
    wrapText: true,
    verticalAlignment: "top",
    borders: { insideHorizontal: { style: "thin", color: "#E2E8F0" } },
  };

  const table = sheet.tables.add(rangeAddress(headerRow, 1, endRow, lastCol), true, tableName);
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;

  widths.forEach((width, idx) => {
    sheet.getRangeByIndexes(0, idx, 1, 1).format.columnWidth = width;
  });
  sheet.getRange(rangeAddress(startRow, 1, endRow, lastCol)).format.rowHeight = 58;
  sheet.freezePanes.freezeRows(4);
  sheet.showGridLines = false;
}

function addStatusFormatting(sheet, range, columnOffset = 0) {
  const riskRange = sheet.getRange(range);
  riskRange.conditionalFormats.add("containsText", {
    text: "低",
    format: { fill: colors.lightGreen, font: { color: colors.green, bold: true } },
  });
  riskRange.conditionalFormats.add("containsText", {
    text: "中",
    format: { fill: colors.lightYellow, font: { color: colors.yellow, bold: true } },
  });
  riskRange.conditionalFormats.add("containsText", {
    text: "高",
    format: { fill: colors.lightRed, font: { color: colors.red, bold: true } },
  });
}

function addYesNoFormatting(sheet, range) {
  const statusRange = sheet.getRange(range);
  statusRange.conditionalFormats.add("containsText", {
    text: "可内更新",
    format: { fill: colors.lightGreen, font: { color: colors.green, bold: true } },
  });
  statusRange.conditionalFormats.add("containsText", {
    text: "待接入",
    format: { fill: colors.lightYellow, font: { color: colors.yellow, bold: true } },
  });
  statusRange.conditionalFormats.add("containsText", {
    text: "后续",
    format: { fill: colors.lightYellow, font: { color: colors.yellow, bold: true } },
  });
  statusRange.conditionalFormats.add("containsText", {
    text: "需后端",
    format: { fill: colors.lightYellow, font: { color: colors.yellow, bold: true } },
  });
  statusRange.conditionalFormats.add("containsText", {
    text: "已完成",
    format: { fill: colors.lightGreen, font: { color: colors.green, bold: true } },
  });
}

function populateDashboard(sheet) {
  sheet.showGridLines = false;
  sheet.deleteAllDrawings();
  for (let i = 0; i < 16; i += 1) {
    sheet.getRangeByIndexes(0, i, 1, 1).format.columnWidth = [14, 13, 13, 3, 14, 13, 13, 3, 15, 13, 13, 3, 18, 12, 3, 16][i] || 12;
  }

  const title = sheet.getRange("A1:P1");
  title.merge();
  title.values = [["BWChat iOS 内更新能力矩阵"]];
  title.format = {
    fill: colors.navy,
    font: { bold: true, color: colors.white, size: 20 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  title.format.rowHeight = 38;

  const subtitle = sheet.getRange("A2:P2");
  subtitle.merge();
  subtitle.values = [["目标：只通过服务端配置、远程资源、安全 WebView 和受限 JSON UI 更新运营、内容、样式、入口和轻功能；不下载、不安装、不执行新代码。"]];
  subtitle.format = {
    fill: colors.lightBlue,
    font: { color: colors.ink, size: 11 },
    wrapText: true,
    verticalAlignment: "center",
  };
  subtitle.format.rowHeight = 34;

  const note = sheet.getRange("A4:P5");
  note.merge();
  note.values = [["阅读方式：先看本页 KPI 和图表，再到「能力矩阵」筛选模块；新增需求先查「可新增功能清单」，涉及原生能力/权限/SDK/支付/播放器等边界时查「必须发版清单」。"]];
  note.format = {
    fill: colors.lightGray,
    font: { color: colors.ink, size: 10 },
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: colors.border },
    verticalAlignment: "center",
  };

  const cards = [
    ["A7:C10", "覆盖模块", "=COUNTA('能力矩阵'!A5:A18)", "已纳入动态宿主分析"],
    ["E7:G10", "可新增内更新场景", "=COUNTIF('可新增功能清单'!E5:E22,\"可内更新\")", "适合运营/内容/轻功能"],
    ["I7:K10", "必须发版边界", "=COUNTA('必须发版清单'!A5:A20)", "原生能力/权限/SDK/支付"],
    ["M7:P10", "后端配置面", "=COUNTA('后端配置契约'!A5:A18)", "接口、灰度、校验、回滚"],
  ];
  for (const [addr, label, formula, footnote] of cards) {
    const range = sheet.getRange(addr);
    range.format = {
      fill: colors.white,
      borders: { preset: "outside", style: "medium", color: colors.border },
      verticalAlignment: "center",
      horizontalAlignment: "center",
      wrapText: true,
    };
    const [start, end] = addr.split(":");
    const startCol = start.match(/[A-Z]+/)[0];
    const endCol = end.match(/[A-Z]+/)[0];
    const labelRange = sheet.getRange(`${startCol}7:${endCol}7`);
    labelRange.merge();
    labelRange.values = [[label]];
    labelRange.format = { fill: colors.lightGray, font: { bold: true, color: colors.gray }, horizontalAlignment: "center" };
    const valueRange = sheet.getRange(`${startCol}8:${endCol}9`);
    valueRange.merge();
    valueRange.formulas = [[formula]];
    valueRange.format = { font: { bold: true, size: 24, color: colors.blue }, horizontalAlignment: "center", verticalAlignment: "center" };
    const footRange = sheet.getRange(`${startCol}10:${endCol}10`);
    footRange.merge();
    footRange.values = [[footnote]];
    footRange.format = { font: { color: colors.gray, size: 9 }, horizontalAlignment: "center", wrapText: true };
  }

  sheet.getRange("M13:N13").values = [["更新方式", "场景数"]];
  sheet.getRange("M14:N19").values = [
    ["配置/Feature Flag", 18],
    ["SDUI 动态页", 8],
    ["H5/WebView", 8],
    ["远程资源", 4],
    ["后端内容/Catalog", 11],
    ["必须发版", 16],
  ];
  sheet.getRange("M13:N19").format = {
    fill: colors.white,
    borders: { preset: "all", style: "thin", color: "#E2E8F0" },
    wrapText: true,
  };
  sheet.getRange("M13:N13").format = {
    fill: colors.navy,
    font: { bold: true, color: colors.white },
    horizontalAlignment: "center",
  };

  sheet.getRange("A32:B32").values = [["模块", "内更新覆盖率"]];
  for (let i = 0; i < abilityRows.length; i += 1) {
    const row = 33 + i;
    sheet.getRange(`A${row}:B${row}`).values = [[abilityRows[i][0], abilityRows[i][9]]];
  }
  sheet.getRange(`B33:B${32 + abilityRows.length}`).format.numberFormat = "0%";
  sheet.getRange(`A32:B${32 + abilityRows.length}`).format = {
    fill: colors.white,
    borders: { preset: "all", style: "thin", color: "#E2E8F0" },
    wrapText: true,
  };
  sheet.getRange("A32:B32").format = {
    fill: colors.navy,
    font: { bold: true, color: colors.white },
    horizontalAlignment: "center",
  };

  const donut = sheet.charts.add("doughnut", sheet.getRange("M13:N19"));
  donut.title = "内更新实现方式分布";
  donut.hasLegend = true;
  donut.setPosition("A13", "H30");

  const bar = sheet.charts.add("bar", sheet.getRange(`A32:B${32 + abilityRows.length}`));
  bar.title = "各模块内更新覆盖率估算";
  bar.hasLegend = false;
  bar.xAxis = { axisType: "textAxis", textStyle: { fontSize: 8 } };
  bar.yAxis = { numberFormatCode: "0%", min: 0, max: 1 };
  bar.setPosition("I13", "P30");
  sheet.freezePanes.freezeRows(2);
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const workbook = Workbook.create();

  const dashboardSheet = workbook.worksheets.add("总览 Dashboard");

  const abilitySheet = workbook.worksheets.add("能力矩阵");
  styleTable(abilitySheet, abilityHeaders, abilityRows, "AbilityMatrixTable", [20, 28, 34, 34, 26, 28, 10, 18, 36, 14]);
  abilitySheet.getRange(`J5:J${4 + abilityRows.length}`).format.numberFormat = "0%";
  abilitySheet.getRange(`G5:G${4 + abilityRows.length}`).dataValidation = { rule: { type: "list", values: ["低", "中", "高"] } };
  addStatusFormatting(abilitySheet, `G5:G${4 + abilityRows.length}`);
  addYesNoFormatting(abilitySheet, `H5:H${4 + abilityRows.length}`);

  const newFeatureSheet = workbook.worksheets.add("可新增功能清单");
  styleTable(newFeatureSheet, newFeatureHeaders, newFeatureRows, "NewFeaturesTable", [22, 28, 22, 32, 14, 38, 10]);
  newFeatureSheet.getRange(`E5:E${4 + newFeatureRows.length}`).dataValidation = { rule: { type: "list", values: ["可内更新", "需发版", "待判断"] } };
  newFeatureSheet.getRange(`G5:G${4 + newFeatureRows.length}`).dataValidation = { rule: { type: "list", values: ["P0", "P1", "P2"] } };
  addYesNoFormatting(newFeatureSheet, `E5:E${4 + newFeatureRows.length}`);

  const releaseSheet = workbook.worksheets.add("必须发版清单");
  styleTable(releaseSheet, releaseHeaders, releaseRows, "ReleaseBoundariesTable", [26, 34, 30, 34, 12]);
  releaseSheet.getRange(`E5:E${4 + releaseRows.length}`).dataValidation = { rule: { type: "list", values: ["中", "高"] } };
  addStatusFormatting(releaseSheet, `E5:E${4 + releaseRows.length}`);

  const backendSheet = workbook.worksheets.add("后端配置契约");
  styleTable(backendSheet, backendHeaders, backendRows, "BackendContractTable", [30, 30, 28, 38, 36, 30, 16]);
  addYesNoFormatting(backendSheet, `G5:G${4 + backendRows.length}`);

  const statusSheet = workbook.worksheets.add("落地状态");
  styleTable(statusSheet, statusHeaders, statusRows, "ImplementationStatusTable", [28, 14, 42, 24, 52]);
  addYesNoFormatting(statusSheet, `B5:B${4 + statusRows.length}`);

  populateDashboard(dashboardSheet);

  const inspect = await workbook.inspect({
    kind: "sheet,table,drawing",
    maxChars: 12000,
    tableMaxRows: 3,
    tableMaxCols: 5,
  });
  await fs.writeFile(`${outputDir}/inspect.txt`, String(inspect));

  const previewSheets = ["总览 Dashboard", "能力矩阵", "可新增功能清单", "必须发版清单", "后端配置契约", "落地状态"];
  for (const sheetName of previewSheets) {
    const preview = await workbook.render({
      sheetName,
      autoCrop: "all",
      scale: 1,
      format: "png",
    });
    const safeName = sheetName.replace(/[ /]/g, "_");
    await fs.writeFile(`${outputDir}/${safeName}.png`, new Uint8Array(await preview.arrayBuffer()));
  }

  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(outputPath);
  console.log(`Wrote ${outputPath}`);
}

await main();
