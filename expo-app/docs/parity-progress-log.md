# BWChat 像素级迁移进度日志

本日志只记录有源码证据和验证证据的进展。自 2026-08-08 起，前端样式/组件采用 **95–98% 视觉还原**标准，不再要求逐像素零差异；功能、交互、状态和全部后端契约仍必须与原版 **100% 一一对应**。页面未满足 `migration-status.md` 的四级完成条件时统一记录为“部分完成”，不会用入口、占位页或单独视觉通过冒充完成。下文早于新口径的 exact `FAIL` 是历史指标，需按新门禁重新判定，但不会自动证明功能完成。

## 2026-08-09：Preview/Production OTA、灰度撤销与 rollback 云端验收完成

- **Preview 构建/安装**：Android Build `b2a6a640-ed3e-4bdf-aa53-22e6a78d1119`、iOS Simulator Build `8b4e9e02-e9c4-4865-88da-704433659673` 均 `FINISHED`，来自 clean commit `b62c319328acef81b14d26fbb7e7d4e0f668f6b1`。Android APK 已下载核对四种 ABI 后清理；iOS 使用唯一固定模拟器安装验收，未创建额外模拟器。
- **Preview OTA**：首次冷启仍使用 embedded Update `0081774e-a1a0-4c37-8063-cf200342465e`，页面显示更新已下载且 App 未自动重启；第二次真实 terminate/launch 冷启切换到 OTA Update `019fe2bc-3020-7dac-b8ec-2f4c6edbf9b4`。最终只保留 embedded/OTA 两张诊断证据；临时 bundle、`dist`、Expo CLI symlink 已精确删除，模拟器与 Simulator.app 均关闭。
- **Production 演练**：双端 Production runtime 固定为 iOS `610f9a3e005a9939903c424963e89631d7be538f`、Android `141af77e63b25016ffb0edb39594e365ba31c193`。真实完成首次 10%→30%→50%、rollout 撤销到 embedded、恢复批次 10%→30%→50%→100%、全量 `update:rollback`，再把最终稳定批次 10%→30%→50%→100%。最终 group 为 iOS `a2b703fe-5775-417a-a607-a07521258972`、Android `ab2dd7d6-97ba-4f11-8c48-20a9d3266434`，最新云端记录均非 rollback 且无 rolloutPercentage，表示全量完成。
- **工具纠错**：fingerprint runtime 的双端发布实际返回两个 platform group，不是一个双平台 group。Production 门现分别读取 Preview iOS/Android group，要求同 timestamp/message/commit；`update:rollback` 显式要求 `ios|android`。pnpm 严格布局所需 Expo CLI link 由脚本临时创建并在成功/失败后只清理自有 link；`pnpm fingerprint:generate -- all` 的参数兼容也已修复。发布策略 **38 cases PASS**，改动后 Production fingerprint 与已发布 runtime 完全不变。
- **Production Build**：Android Store Build `4f2e2e67-2ab9-43e7-b87f-4c458a72c24d` 已发起且 runtime/commit 匹配，等待 EAS 完成。iOS Production Store Build 已通过代码/runtime 阶段，但 EAS 因尚无 Apple Distribution Certificate / Provisioning Profile 拒绝非交互签名；这是 Apple Developer 外部门槛，不是代码或 Expo OTA 失败。
- **整体进度**：页面复刻仍为 **47/47（100%）**；EAS 云端 OTA/灰度/撤销/rollback 已完成。最后阶段仅剩 Android Production 构建结果、最终全仓验证/文档提交，以及需要用户 Apple Developer 凭据才能完成的 iOS Production Store 签名包。

## 2026-08-09：EAS 第二阶段完成账号、项目、环境与通道绑定

- **真实云端状态**：Expo Owner `wegpt` 已登录；`@wegpt/bbchat` 与 Project ID `f623eda4-1a5f-4227-9890-1a2eb5a6df2c` 已创建并由 `project:info` 读取确认。development/preview/production 三套 EAS Environment 均已登记对应 APP_ENV 与公开业务配置，三个同名 Channel/Branch 已创建且互相隔离。
- **本地/云配置门**：raw EAS config 六组合全部通过；整仓 **293 suites / 1905 tests**、发布策略 **28 cases**、密钥扫描 **1177 个文本文件**、45 个原数字资产与 10×1,138 本地化全绿。Remote Config 最低 Build/App Version 已真正进入 AppGate；Sentry DSN 可选且首次构建关闭自动上传，不再阻断 Preview/Production。
- **发布纠错**：Preview 与 Production 环境会进入 fingerprint，不能直接跨 runtime republish。Production 现只接受 Preview 双平台共享同一 `gitCommitHash`、本地 HEAD 一致且 worktree clean 的输入，再从同 commit 按 production environment 重新生成 **10%** update；扩量固定 30%→50%→100%，撤销/回滚均要求事故证据。
- **总体进度**：页面复刻仍为 **47/47（100%）**。EAS 第二阶段已完成账号/项目/三环境/三通道绑定，下一步是提交独立副本、真实 Preview Build、安装与两次冷启动 OTA；Production 10%/扩量/撤销/rollback 和 Apple/Google/GitHub/Sentry 外部凭据仍待验收。本轮没有启动模拟器；115MB 最终视觉证据继续保留本机，并由 Git/EAS 双重忽略，没有删除任何源码或原始图片资产。

## 2026-08-09：ScriptRoomChatView 第 36 项正式验收通过；总进度 47/47

- **功能/API**：房间/消息恢复、角色与回合、发送/重试/结束、WebSocket/已读、缓存/preview、owner/room/generation 和失败/乱序均与 Swift 一一对应；GET room、submit、retry、end、group history/read 与 create room 七条链的 route/method/auth/query/body/idempotency/wrapper/data/decode/消费状态 100% PASS。
- **正式视觉**：固定双机同一 active 空时间线代表态，覆盖导航栏、三角色 roster、user/AI badge、剧情头和 composer；整屏 component style / 4pt structural SSIM **96.9673% PASS**、normalized RGB **99.0518%**。
- **代码门**：本页 9 suites/85 tests、最终整仓 **291 suites/1897 tests**、strict TypeScript、范围 ESLint/Prettier、45 原资产和七份 Swift 双副本全部通过；整仓回归额外修正群消息 normalizer 虚构 `thumbnail_url` 的历史参数错误。本页无专属位图，fallback 与远端鉴权图片路径按原版。
- **清理/总体**：正式目录只保留 audit 与 `states/active-empty/` 四个 PASS 文件；临时常量/query 分支已从产品代码移除，Native 返回发现页，临时截图/metrics 精确清理。最终逐行回收历史状态后，47 个编号项全部为 `✅`，无 `🟡`/`🔴` 遗留；总进度 **47/47（100%）**，剩余 **0** 项。

## 2026-08-09：GroupCallView 第 20 项正式验收通过；总进度 46/47

- **功能/API**：group start/leave/status、join、推送/实时信令、identity matching、失败清理、LiveKit participant/track、成员增删、人数/时长、重连/弱网与全部媒体控制均与 Swift/API 一一对应。
- **正式视觉**：固定双机语音 connected / 1 人 / 00:00 代表态，覆盖标题、人数/时长、最小化和静音/扬声器/挂断控制；整屏 component style / 4pt structural SSIM **99.2779% PASS**、normalized RGB **99.7572%**、strict ≤8 **98.7536%**。
- **代码门**：8 suites/90 tests、strict TypeScript、范围 ESLint/Prettier、45 原资产、飞机删除和十份 Swift 双副本全部通过；页面没有专属位图资产。
- **清理/总体**：正式目录只保留 audit 与 `states/voice-empty-connected/` 四个 PASS 文件；临时截图/metrics 和验收路由已精确清理，原版注入通话态已通过纯本地清理且没有调用后端。第 20 项更新为 `✅`，总进度 **46/47（97.87%）**，剩余 **1** 项。

## 2026-08-09：ShortDramaUnifiedEditorView 第 41 项正式验收通过；总进度 45/47

- **功能/API**：创建、编辑、失败任务恢复，系列 metadata、分集 PATCH/DELETE、两路上传、submit、八态失败恢复、owner/job/generation 与媒体接管均与 Swift 一一对应；Apple background `URLSession` 支持系统唤醒、杀进程重绑、一次 401 refresh 和 confirmation-unknown。
- **正式视觉**：固定双机同一 `test1` 创建初始态，覆盖导航栏、名称/海报/简介、分集列表、上传入口与底部发表条；整屏 component style/RGB **97.2524% PASS**、4pt structural SSIM **97.9488%**。
- **代码门**：扩大短剧回归 20 suites/151 tests、编辑器核心复跑 2 suites/15 tests、TypeScript、范围 ESLint/Prettier、Swift/Pod/autolink、45 原资产、10×1,138 本地化、飞机删除和三份 Swift 双副本全绿。
- **清理/总体**：正式目录只保留 audit 与 `states/create-initial/` 四个 PASS 文件；临时截图与 metrics 已删除。第 41 项更新为 `✅`，总进度 **45/47（95.74%）**，剩余 **2** 项。

## 2026-08-09：VideoPlayerView 第 45 项正式验收通过；总进度 44/47

- **功能/API**：私聊、群聊、Agent、朋友圈 Feed、动态详情、用户主页六类入口，prepared/ready/退出、原生 controls、URL/Range/401、owner/generation、手势、失败态和 Apple 后台 MP4/HLS `.movpkg` 缓存均与 Swift 一一对应。
- **真实入口纠错**：第一次正式测量发现 Expo 关闭键少了原生 full-screen cover 的 64pt 顶部安全区；修正后重新取证，不以旧失败截图冒充通过。
- **正式视觉/代码门**：固定双机同一 `test1`、同一朋友圈真实视频结束帧，整屏 component style/structure **99.7071% PASS**、RGB **99.8749%**、strict ≤8 **99.6319%**；10 suites/61 tests、TypeScript、范围 ESLint/Prettier、45 原资产、飞机删除和七份 Swift 双副本全绿。
- **清理/总体**：正式目录只保留 audit 与 `states/moment85-ended/` 四个 PASS 文件；临时帧、失败证据、metrics、LLDB 链接和临时验收路由已精确清理。第 45 项更新为 `✅`，总进度 **44/47（93.62%）**，剩余 **3** 项。

## 2026-08-09：ShortDramaVideoPage 第 42 项正式验收通过；总进度 43/47

- **功能/API**：首帧、加载/暂停/锁态、媒体候选/Range 鉴权、音轨 fallback/双循环、前后台/续播/历史/进度、解锁钱包和互动均与 Swift 一一对应。
- **HLS/代码门**：Apple `.movpkg` 持久缓存、认证、后台恢复、账户隔离与 LRU 已关闭旧缺口；页面/HLS 5 suites/31 tests、相邻 15 suites/120 tests、TypeScript、精确范围规范/格式、Swift parse/podspec 全绿。
- **正式视觉**：固定双机同一真实视频自动配帧，完整页 component style/structure **99.3673% PASS**、RGB **99.4273%**；复用 canonical 四件证据，本页无专属本地图。
- **总体**：第 42 项更新为 `✅`，总进度 **43/47（91.49%）**，剩余 **4** 项。

## 2026-08-09：ShortDramaFeedView 第 39 项正式验收通过；总进度 42/47

- **功能/API**：推荐/series feed、12 条分页、末 3 条预取、初始分集/位置、owner/scope、5 分钟/30 天/200 条缓存、切页/前后台/保存、进度 API、互动/评论/解锁钱包均与 Swift 一一对应。
- **HLS 缺口关闭**：Apple `AVAssetDownloadURLSession` 持久 `.movpkg`、认证头、后台恢复、owner/media 隔离、5 秒预热/只取消未开始、2GiB/30 天/LRU 全部接通；Android/Web 不伪造离线 HLS。
- **正式视觉/代码门**：复用同组件固定双机 `test1`、`series_003/video_014` canonical 画面，component style/structure **99.3673% PASS**、RGB **99.4273%**；当前 15 suites/120 tests、TypeScript、精确范围规范/格式、Swift parse/podspec 与源码锁全绿。
- **证据/总体**：不重复保存四张大图，引用 `short-drama-action-rail-current/states/series003-video014/`；本页无专属本地图。第 39 项更新为 `✅`，总进度 **42/47（89.36%）**，剩余 **5** 项。

## 2026-08-09：InAppWebView 第 47 项正式验收通过；总进度 41/47

- **功能/API**：普通 H5、游戏 URL/同源策略、外链、App/Game bridge、round 支付、广告结果、owner/generation、加载失败重试、持久 WebView 预热均与 Swift 一一对应；round POST 的 route/method/auth/idempotency/body/wrapper/data 和钱包状态消费 100% PASS。
- **正式视觉**：固定双机 1320×2868 相同 policy-blocked 代表态，component style / structure **95.1191% PASS**、RGB **99.5075%**、strict ≤8 **98.7165%**，没有 Refreshing/RedBox。
- **代码门**：当前 11 suites/79 tests、范围 ESLint/Prettier、七份 Swift 原仓/桌面副本源码锁全部通过；本页没有专属数字图片资产。
- **清理/总体**：正式目录只保留 audit 与 `states/blocked/` 四个 PASS 文件；固定 pair 捕获临时目录自动清理。第 47 项更新为 `✅`，总进度 **41/47（87.23%）**，剩余 **6** 项。

## 2026-08-08：ShortDramaActionRail 第 37 项正式验收通过；总进度 40/47

- **功能/API**：作者、关注、点赞、评论四个原版入口边界完整；like/follow route/method/auth/path/body/wrapper、乐观更新、服务端收口、同作者同步、失败快照回滚和 owner/video 生命周期 100% 一一对应，没有虚构分享/更多/触觉或播放 endpoint。
- **正式视觉**：固定双机同一 `test1`、同一 `series_003/video_014`，从两端时间序列自动匹配同一视频帧后，整屏 component style **99.3673% PASS**、RGB **99.4273%**、结构 **99.3673%**。
- **代码门**：3 suites/20 tests、TypeScript、范围 ESLint/Prettier、45 原资产、10×1,138 本地化、飞机删除和六份 Swift 双副本全绿。
- **清理/总体**：正式目录保留 audit 与 `states/series003-video014/` 四个 PASS 文件；临时时间序列将在共享 Feed/VideoPage 证据完成后精确删除。第 37 项更新为 `✅`，总进度 **40/47（85.11%）**，剩余 **7** 页。

## 2026-08-08：ShortDramaSeriesListView 第 40 项正式验收通过；总进度 39/47

- **功能/API**：推荐/看过双列表、owner+filter 缓存、游标分页、历史覆盖/排序、旧 feed 回退、系列详情补集、续播/指定分集与 editor 完成刷新均与 Swift 一一对应；三条 GET 的 route/method/auth/query/body/wrapper/data/编码及消费状态 100% PASS。
- **正式视觉**：固定两台 iPhone 17 Pro Max / iOS 26.4、1320×2868，同一 `test1` 与同一真实推荐列表；component style/RGB **97.0774% PASS**、4pt structural SSIM **97.9343%**，没有 Refreshing/RedBox。
- **代码门**：root 聚焦 **12 suites / 110 tests**、预验收 12 suites/113 tests、TypeScript、范围 ESLint/Prettier、45 原资产、10×1,138 本地化、飞机删除和六份 Swift 双副本全绿。
- **恢复/清理/总体**：仅为显露服务器隐藏的原版入口临时修改 Native 模拟器缓存副本，取证后已用事前备份逐字节恢复 plist 并删除备份。正式目录只保留 audit 与 `states/recommended-test1/` 四个 PASS 文件；第 40 项更新为 `✅`，总进度 **39/47（82.98%）**，剩余 **8** 页。

## 2026-08-08：WalletView 第 46 项正式验收通过；总进度 38/47

- **功能/API**：余额、金币/猫粮交易、提现记录/申请/取消、奖励广告 status/session/SSV、StoreKit 本地验签与充值确认，以及金币/收益 tab、表单、菜单、缓存和 owner-generation 均与 Swift 一一对应；九类钱包请求的 route/method/auth/query/body/timeout/wrapper/data/消费合同 100% PASS，保持原版无 Idempotency-Key/不盲重试语义。
- **正式视觉**：固定两台 iPhone 17 Pro Max / iOS 26.4、1320×2868，同一 `test1`、765 金币、广告 10 次与六档商品；component style / RGB **99.3599% PASS**、4pt structural SSIM **99.9549%**，没有 Refreshing/RedBox。
- **代码门**：钱包 **12 suites / 59 tests**、正式截图前共享整仓 **288 suites / 1854 tests**、TypeScript、ESLint/Prettier、四张钱包原图、45 原资产、10×1,138 本地化、飞机删除和七份 Swift 双副本全绿。
- **清理/总体**：正式目录只保留 audit 与 `states/coins-test1/` 四个 PASS 文件；登录/导航/临时 metrics 已精确清理，未删除代码或资产。第 46 项更新为 `✅`；总进度 **38/47（80.85%）**，剩余 **9** 页。

## 2026-08-08：GroupChatView 第 21 项正式验收通过；总进度 37/47

- **功能/API**：页面/owner/group 生命周期、缓存/增量/回补/分页、实时/成员、提及/回复/定位、五类消息发送与 outbox、礼物/ChatMoney、撤回/删除/清历史、转发/搜索、已读/会话预览、Composer、前后台和外观均与 Swift 一一对应；群聊全部 route/method/auth/query/body/multipart/timeout/idempotency/wrapper/data/状态消费代码矩阵 100% PASS。
- **正式视觉**：固定两台 iPhone 17 Pro Max / iOS 26.4、1320×2868，同一 `test1`、真实 `test1三人群聊通知测试-0724-0329`（group 17）媒体态；component style / RGB **98.8200% PASS**、4pt structural SSIM **99.9009%**，没有 Refreshing/RedBox。
- **代码门**：群聊及共享消息 **18 suites / 116 tests**、最新整仓 **288 suites / 1854 tests**、TypeScript、ESLint/Prettier、45 原资产、10×1,138 本地化、飞机删除和五份 Swift 双副本全绿。
- **清理/总体**：正式目录只保留 audit 与 `states/group17-media/` 四个 PASS 文件；登录/调试/临时 metrics/Jest JSON 已精确清理，未删除代码或资产；两台模拟器已关闭。第 21 项更新为 `✅`；总进度 **37/47（78.72%）**，剩余 **10** 页。

## 2026-08-08：MessageBubble 第 27 项正式验收通过；总进度 36/47

- **功能/API**：分支优先级、左右行结构、头像/时间/文字、回复、图片、视频、语音、贴纸、礼物、ChatMoney、转发包、通话记录、发送状态、菜单/多选和辅助语义均按 Swift→Expo 矩阵收口；呈现层不新增 endpoint，动作全部复用 ChatView 的原版对应调用。
- **正式视觉**：复用固定双机同一 `test1`/`Simple` 真实私聊 canonical 整屏证据，component style / RGB **98.1013% PASS**、4pt structural SSIM **99.6026%**。这同时验证气泡在真实导航、时间线和 Composer 容器中的尺寸、间距与锚点。
- **代码门**：私聊及相邻 **37 suites / 197 tests**、整仓 **286 suites / 1825 tests**、TypeScript、ESLint/Prettier、45 原资产、10×1,138 本地化、飞机删除和关联 Swift 双副本全绿。
- **清理/总体**：本项只保留独立 audit 并链接 ChatView canonical 证据，没有复制四张相同大图；未删除代码、测试、图片资产、Swift 副本或正式证据。第 27 项更新为 `✅`；总进度 **36/47（76.60%）**，剩余 **11** 页。

## 2026-08-08：ChatView 第 10 项正式验收通过；总进度 35/47

- **功能/API**：页面生命周期、缓存/增量/历史回补/分页、实时合并、已读、草稿、五类消息发送与 durable outbox、礼物/ChatMoney、回复/定位/撤回、菜单/多选/转发、Composer、背景和前后台状态均与 Swift 一一对应；全部后端 route/method/auth/query/body/multipart/timeout/idempotency/wrapper/data/状态消费代码矩阵 100% PASS。
- **正式视觉**：固定两台 iPhone 17 Pro Max / iOS 26.4、1320×2868，同一 `test1`、`Simple` 真实媒体会话。由首轮 **57.9786% FAIL** 和安全区修正后的 **91.4956% FAIL** 定位导航、safe-area 与 Swift 4pt 消息间距；最终 component style / RGB **98.1013% PASS**、4pt structural SSIM **99.6026%**。
- **代码门**：私聊及相邻 **37 suites / 197 tests**、整仓 **286 suites / 1825 tests**、TypeScript、ESLint/Prettier、45 原资产、10×1,138 本地化、飞机删除和 11 份 Swift 双副本全绿。
- **清理/总体**：正式目录只保留 audit 与 `states/simple-media/` 四个 PASS 文件；失败/调参/重载截图和临时 metrics 已精确清理，未删除代码或资产。第 10 项更新为 `✅`；总进度 **35/47（74.47%）**，剩余 **12** 页。

## 2026-08-08：AgentCreatorView 第 5 项正式验收通过；总进度 34/47

- **功能/API**：19 个 Form 区段、默认值/回填/枚举、参考图几何与压缩、创建/修订/发布/安装/首会话、幂等检查点、6002 冲突、直接深链、缓存通知和 owner/agent/generation 已按 Swift→Expo 矩阵收口；七类 API 的 method/auth/body/multipart/timeout/idempotency/wrapper/data/decode/状态消费一一对应。
- **正式视觉**：首轮同尺寸仅 **84.7805% FAIL**，根因是导航栏与 grouped Form 几何/Picker 结构，不是模拟器大小。修正后固定双机同为 iPhone 17 Pro Max / iOS 26.4、1320×2868，同一 `test1` 创建初始态达到 component style / structural SSIM **98.9004% PASS**、normalized RGB **99.0139%**。
- **代码门**：AgentCreator **4 suites / 43 tests**、整仓 **286 suites / 1825 tests**、TypeScript、ESLint/Prettier、45 原资产、10×1,138 本地化、飞机删除及 8 份 Swift 双副本全绿。
- **清理/总体**：只保留 audit 与 `states/create-initial/` 四个 PASS 文件，失败/旧 bundle/临时 metrics 已清理，未删除代码、图片资产或 Swift 副本。第 5 项更新为 `✅`；总进度 **34/47（72.34%）**，剩余 **13** 页。

## 2026-08-08：AgentChatView 第 4 项正式验收通过；总进度 33/47

- **功能/API**：首载/分页、缓存/合并、文字/图片 turn、回复/轮询/恢复、paid media/解锁、配置/编辑/新会话、视频匹配和 owner/conversation 竞态已收口；13 条后端链的 method/auth/query/body/multipart/timeout/idempotency/wrapper/data 一一对应。
- **正式视觉**：AgentMessage 正式图是完整 AgentChat 页面；复用同一固定双机 `test1`/`We` canonical 证据，component style/RGB **99.2580% PASS**、structural SSIM **99.8465%**，不重复存四张相同大图。
- **代码门**：聚焦 **15 suites / 66 tests**、整仓 **286 suites / 1825 tests**、TypeScript、ESLint/Prettier、资产/本地化/飞机删除及 4 份 Swift 双副本全绿。
- **清理/总体**：本项只留 audit 并链接 canonical 证据，没有新增截图垃圾，也未删除正式证据。第 4 项更新为 `✅`；总进度 **33/47（70.21%）**，剩余 **14** 页。

## 2026-08-08：ActivityCenterView 第 1 项正式验收通过；总进度 32/47

- **功能/API**：福利/转盘、签到/餐补、联系人/手机、匹配/好友、邀请/兑换/深链、奖励、缓存/幂等及 owner/generation 已按 Swift→Expo 矩阵收口；12 条 API 的 method/auth/path/query/body/no-store/idempotency/wrapper/data/retry 一一对应。
- **正式视觉**：固定双机同为 iPhone 17 Pro Max / iOS 26.4、1320×2868，同一 `test1` 和同一签到 2/7/三餐/每日任务快照；component style / structural SSIM **97.1249% PASS**、normalized RGB **97.7618%**。
- **代码门**：正式前修复范围 ESLint 2 errors/2 warnings；最终 **6 suites / 57 tests**、整仓 **286 suites / 1825 tests**、TypeScript、ESLint/Prettier、四张原图、资产/本地化/飞机删除及 4 份 Swift 双副本全绿。
- **清理/总体**：只保留 audit 与 `states/benefits-test1/` 四个 PASS 文件，working/临时 metrics 已清理，未删除代码或资产。第 1 项更新为 `✅`；总进度 **32/47（68.09%）**，剩余 **15** 页。

## 2026-08-08：ScriptEditorView 第 34 项正式验收通过；总进度 31/47

- **功能/API**：创建/编辑、七段 Form、完整校验/角色/媒体事务、分类缓存、owner/script 隔离和成功/失败状态已按 Swift→Expo 矩阵收口；分类/编辑恢复/资产上传/创建/编辑的 method/auth/query/body/multipart/timeout/wrapper/data/decode 一一对应。
- **正式视觉**：首轮同尺寸仅 **85.8775% FAIL**，根因是 grouped Form 几何和导航栏实现缺口，不是模拟器大小。修正封面白色外卡、主卡片横距/圆角、Toggle/计数输入行高、两类 section 间距和导航栏后，固定双机同一 `test1` 初始态达到 component style / structural SSIM **97.9781% PASS**、normalized RGB **99.0180%**。
- **代码门**：聚焦 **6 suites / 51 tests**、整仓 **286 suites / 1825 tests**、strict TypeScript、范围 ESLint/Prettier、资产、本地化、飞机删除和 8 份 Swift 双副本全绿。
- **清理/总体**：正式目录只保留 audit 与 `states/initial/` 四个 PASS 文件；首轮、重复截图、调参和临时 metrics 已精确清理，未删除代码、测试或图片资产。第 34 项更新为 `✅`；总进度 **31/47（65.96%）**，剩余 **16** 页。

## 2026-08-08：AgentHubView 第 6 项正式验收通过；总进度 30/47

- **功能/API**：五路并发加载、缓存/局部失败、owner 隔离、Creator write-through、会话复用/创建、卸载和 ScriptRoom handoff 已按 Swift→Expo 代码矩阵收口；五个 GET、创建 POST 与卸载 DELETE 的 method/auth/query/body/idempotency/wrapper/data/decode/状态消费一一对应。
- **正式视觉**：固定双机同为 iPhone 17 Pro Max / iOS 26.4、1320×2868，同一 `test1` 和同一真实 `We` 数据。修正默认“返回”文字、导航栏分隔线与背景后，component style / normalized RGB **99.8555% PASS**、4pt structural SSIM **99.9183%**。
- **代码门**：AgentHub **3 suites / 33 tests**、整仓 **286 suites / 1825 tests**、strict TypeScript、范围 ESLint/Prettier、45 原资产、10×1,138 本地化、飞机删除和 10 份 Swift 双副本全绿。
- **清理/总体**：正式目录只保留 audit 与 `states/loaded-test1/` 四个 PASS 文件；首轮、旧 bundle、重载过程和临时 metrics 垃圾已精确清理，未删除代码、测试、图片资产或 Swift 副本。第 6 项更新为 `✅`；总进度 **30/47（63.83%）**，剩余 **17** 页。

## 2026-08-08：AgentMessageView 第 7 项正式验收通过；总进度 29/47

- **功能/API**：消息与 part 顺序、用户可见 prompt、回复/输入图、paid media 全状态、解锁/保存/画廊/视频、认证媒体及 owner/conversation 竞态已按 Swift→Expo 代码矩阵收口；分页、turn、unlock 和媒体 transport 的 method/auth/query/body/idempotency/wrapper/data/状态消费一一对应。
- **正式视觉**：固定双机同一 `test1`、同一个 `We` Agent 实际会话；从历史约 82% 失败定位到底部安全区、导航栏、文本行高和保存行高度，并与 Swift 10/7pt 双层间距统一。最终 component style / normalized RGB **99.2580% PASS**、4pt structural SSIM **99.8465%**。
- **代码门**：聚焦及相邻 **10 suites / 55 tests**、最新整仓 **286 suites / 1825 tests**、strict TypeScript、范围 ESLint/Prettier、45 原资产、10×1,138 本地化、飞机删除、4 份 Swift 双副本与 iOS production export 全绿；export 为 **3,547 modules / 68 assets / 70 files**，HBC 13,470,202 bytes、SHA `9d493e8e…e3ae`。
- **清理/总体**：正式目录只保留 audit 与 `states/conversation-we/` 四个 PASS 文件；失败 working 与临时 export 已精确清理，未删除代码、测试、图片资产或 Swift 副本。第 7 项更新为 `✅`；总进度 **29/47（61.70%）**，剩余 **18** 页。

## 2026-08-08：CreateMomentView 第 13 项正式验收通过；总进度 28/47

- **功能/API**：文本/grapheme、9 图或 1 视频互斥、图片/视频准备、金币、发布门、草稿所有权、outbox、乐观项、确认替换、重试/取消/冷恢复和账号竞态已按 Swift→Expo 代码矩阵收口；`POST /moments/create` 的 background multipart、Bearer/401 refresh、稳定幂等身份、字段顺序、180/600 秒超时、wrapper/data 与 confirmation unknown 一一对应。
- **正式视觉**：固定两台 iPhone 17 Pro Max / iOS 26.4、1320×2868、同一 `test1`、相同空白初始态；component style / 4pt structural SSIM **98.3220% PASS**、normalized RGB **99.2572%**，没有 Refreshing/RedBox。
- **代码门**：聚焦及相邻 **12 suites / 76 tests**、最新整仓 **286 suites / 1809 tests**、strict TypeScript、范围 ESLint/Prettier、45 原资产、10×1,138 本地化、飞机删除、6 份 Swift 双副本与最新 iOS production export 全绿。
- **清理/总体**：正式目录只保留 audit 与 `states/initial/` 四个 PASS 文件，无 working、UI dump、导出包或临时截图；未删除代码、测试、图片资产或 Swift 副本。第 13 项更新为 `✅`；总进度 **28/47（59.57%）**，剩余 **19** 页。

## 2026-08-08：ScriptRoleEditorView 第 35 项正式验收通过；总进度 27/47

- **功能/API**：新增/编辑角色、名称/性别/公开描述/隐藏设定边界、校验顺序、取消/保存、角色 ID 与顺序、头像选择/压缩/所有权和 owner/generation 竞态均已按 Swift→Expo 代码矩阵收口。角色弹层没有后端调用；父级 `script_role_avatar` 上传及 `POST /scripts`、`PATCH /scripts/{id}` 的 method/auth/body/wrapper/data/状态消费一一对应。
- **正式视觉**：固定两台 iPhone 17 Pro Max / iOS 26.4、1320×2868、同一 `test1`、同一空角色初始态；component style / 4pt structural SSIM **96.8105% PASS**、normalized RGB **98.6341%**。本轮修正标题区、头像区、表单留白及性别标签/选择器布局，强制重新加载最新 bundle 后截图哈希变化，排除旧包误验。
- **代码门**：focused **6 suites / 46 tests**、最新整仓 **286 suites / 1809 tests**、strict TypeScript、范围 ESLint/Prettier、45 原资产、10×1,138 本地化、飞机删除守卫、5 份 Swift 双副本与 iOS production export 全部通过；export 为 **3,547 modules / 68 assets / 70 files**，HBC 13,465,812 bytes、SHA `ba5185c2…eea6b`。
- **清理/总体**：正式目录只保留 audit 与 `states/initial/` 四个 PASS 文件；临时 export 与空 working 已精确清理，未删除代码、测试、图片资产或 Swift 副本。第 35 项更新为 `✅`；总进度 **27/47（57.45%）**，剩余 **20** 页。

## 2026-08-08：DynamicScreenView 第 15 项正式验收通过；总进度 26/47

- **功能/API**：远端配置、严格 schema、缓存/ETag、`GET /app/screens/{id}`、401/retry、owner/generation、递归渲染、远端资产和完整路由矩阵与 Swift 一一对应；正式前把 identity 变更后的旧投影清理移到布局前，消除一帧旧账号页面闪现。
- **正式视觉**：固定两台 iPhone 17 Pro Max / iOS 26.4、同一 `test1` 和同一真实 `daily_rewards` 内容；component style / structural SSIM **97.2390% PASS**、normalized RGB **99.0432%**。动态页 7 suites / 60 tests、最新整仓 286 suites / 1809 tests 以及类型、格式、静态规范、资产、本地化、飞机删除和 Swift 双副本门全部通过。
- **证据/总体**：正式目录只保留 audit 与 `states/daily-rewards/` 四个 PASS 文件，无 working/临时截图。第 15 项更新为 `✅`；总进度 **26/47（55.32%）**，剩余 **21** 页。

## 2026-08-08：CreateGroupView 第 12 项正式验收通过；总进度 25/47

- **正式视觉**：root 从两端消息页真实 `+` → `发起群聊` 进入同一初始态；固定双机均为 iPhone 17 Pro Max / iOS 26.4、1320×2868，同一 `test1`、私有开关关闭、选择 0、同一 `Simple` 成员。component style / normalized RGB **99.5385% PASS**、4pt structural SSIM **99.5850%**，证据在 `artifacts/acceptance/create-group-current/states/initial/`。
- **功能/API**：互关/粉丝分页、稀疏续取、去重、选择、创建、群缓存与 owner/generation 竞态已完成 Swift→Expo 代码矩阵；四条真实 endpoint 的 method/auth/query/body/wrapper/data/decode/状态消费一一对应。13 suites / 97 tests、strict TypeScript、范围 ESLint/Prettier、10 locales、45 原资产和五份 Swift 双副本全部通过。
- **清理/总体**：正式目录只保留 audit 与四个 PASS 证据文件，临时捕获目录自动清理，没有删除代码或资产。第 12 项更新为 `✅`；总进度 **25/47（53.19%）**，剩余 **22** 页。

## 2026-08-08：RegisterView 第 31 项既有正式验收复核

- 用户要求先确认注册。root 复核 `initial`、`username-focus`、`password-focus`、`confirm-password-focus` 四个正式状态，component style 分别为 **99.8156% / 99.0650% / 99.6688% / 99.1691%**，全部 PASS；`POST /auth/register`、输入边界、token/Keychain、账号 generation、Realtime/定位/Push 生命周期及三张 1254×1254 原图均有独立代码与资产证据。
- 该页此前已经正式记为 `✅`，本次是证据复核而非新增页面，所以不重复增加 47 项计数；审计见 `artifacts/acceptance/register-current/audit.md`。

## 2026-08-08：ScriptCenterView 第 32 项功能/后端代码合同收口；仅固定双机代表视觉待验

- **页面/状态**：公开/我的、服务端分类、两列卡片、新建/详情、骨架/空/错、下拉刷新和 cursor 分页完整对应。selection 变化会同步清旧卡并串行只跑最新首屏；分类失效回退不重复请求；只有手动下拉显示 spinner；陈旧缓存与分页失败保持原版静默语义。
- **API/解码/缓存**：`/scripts/categories`、`/scripts`、详情/新建/更新/删除/建房的 route/method/auth/query/body/wrapper/data 及状态消费从代码层 **100% PASS**。查询值以 Foundation blank 判定但原样发送；Script Codable 的字符串、blank、枚举、整数/布尔/数组/fallback/CodingKeys 已严格对齐。owner 串行写、generation 与 compare-and-remove 阻止 A→B→A、library invalidation 和损坏缓存竞态复活。
- **十语言/a11y/证据**：保持原 `ScriptText` 中英分流，返回标题使用当前十语言 `common.back`；tab、创建、分类、卡片、重试、selected、live region 和 skeleton 隐藏已接。页面无专属本地 bitmap；原 Swift 与桌面完整副本逐字节一致。Focused **6 suites / 40 tests**、related **19 suites / 144 tests**、strict TypeScript、范围 ESLint/Prettier 全绿；审计见 `artifacts/acceptance/script-center-current/audit.md`。
- **交接状态**：按最新口径，逐页真实后端点测不再是功能/后端正式门；第 32 项唯一剩余门是 root 独立执行的固定 Native/Expo 双模拟器代表态 **95–98%** 视觉验收。子 agent 只提交实现/API/测试交接，不登记正式状态或全局完成页数。

## 2026-08-08：RegisterView 第 31 项代码/API/会话阶段收口；固定双机与真实后端待验

- **UI/交互**：四字段原值、Foundation blank、Swift 扩展字素计数、username→nickname→password→confirm 的 next/go、双清空/双显隐、四种 focus 对应 idle/peek/cover、hint 优先 server error、loading/busy/disabled、同步提交锁以及卸载/旧提交迟到门均已锁定；三张 1254×1254 猫图在原仓、桌面 Swift 副本和 Expo 中逐字节一致。
- **API/会话**：`POST /auth/register` 严格保留 raw username/password、blank nickname 省略、optional device token、auth false、15 秒 timeout、POST 无 transient retry、strict wrapper/data、Swift code/message/errorDescription 与 snake_case User。access/refresh token、Keychain、Auth generation/串行 commit、logout 取消迟到注册、Realtime、登录定位及 push 2/4/8 秒重试完整对应；原 Swift 工程未修改。
- **证据/状态**：Register 核心 **6 suites / 49 tests**、认证关联 **24 suites / 188 tests**、目标 ESLint/Prettier 与 strict TypeScript 通过。审计见 `artifacts/acceptance/register-current/audit.md`。按 root 稳定批次规则未操作模拟器，也未重复全仓 Jest/资产/本地化/飞机/export；当前源码完整 focus/error/loading/键盘/转场/动效固定双机 95–98%、非破坏性真实后端、冷启/APNs、VoiceOver/大字/十语言设备矩阵仍缺，第 31 项保持 `🟡`，正式总进度仍为 **3/47（6.38%）**。

## 2026-08-08：LoginView 第 24 项代码/API/会话阶段收口；固定双机与真实后端待验

- **UI/交互**：原版白底、动态居中、标题/卡片/字段/渐变按钮、258pt 三态猫和三张原图均保留；username/password 原值、Foundation blank、next/go、清空/显隐、点框聚焦、背景/Done/交互收键盘、Optional error、loading/busy/disabled 和同步提交锁已覆盖。页面卸载或 provider 拒绝旧 commit 后不导航、不写迟到状态。
- **API/会话**：`POST /auth/login` 的 raw body、optional device token、auth/timeout/retry、strict wrapper+data、missing/null data 的 Swift code/message、snake_case User、access/refresh token 与 Keychain 完整对应。Auth generation/串行 commit 防 bootstrap、refresh、双登录与 logout 乱序覆盖；Realtime、登录定位、push 权限、2/4/8 秒重试和同账号 logout→login 重传已接。
- **证据/状态**：原仓与桌面 Swift 副本无差异，三张猫图三处逐字节一致。聚焦 **15 suites / 113 tests**、关联 **22 suites / 155 tests**、最终全仓 **267 suites / 1,613 tests**、范围 ESLint/Prettier、strict TypeScript、45 原资产、10×1,138 本地化、飞机删除门和 iOS production export 全绿；export **3,519 modules / 68 assets / 70 files**，HBC 13,355,751 bytes、SHA `91c26a3c…251d`。临时 export 已精确删除，证据目录只留 `artifacts/acceptance/login-current/audit.md`。Mac 锁屏且 `Booted=0`，当前源码聚焦/错误/loading/键盘/转场/动效的固定双机 95–98%、真实后端成功/错误/冷启/退出再登/APNs 与 VoiceOver/大字/暗色/十语言仍缺，因此第 24 项保持 `🟡`，正式总进度仍为 **3/47（6.38%）**。

## 2026-08-08：ScriptRoleEditorView 第 35 项代码/API/状态收口；固定双机与真实服务待验

- **原版行为纠正**：逐行复核确认角色相册使用 `try? loadTransferable`，所以取消、权限/读取/解码失败必须静默保留旧头像；原版也没有选择中 spinner 或禁用头像/保存。Expo 已移除这些多加的状态，保留同帧防重入、generation/active/unmount gate 和只清 editor-owned cache URI；选图未返回时仍可保存当前旧头像，modal 关闭或 owner/script 切换后的迟到结果只清理且不 handoff。
- **功能/API**：名称 8、性别原枚举、公开描述 100、隐藏设定 500、必填校验顺序、3 秒 toast、取消/保存收键盘、新增/编辑稳定身份、server ID 和角色位置均已锁定。角色 modal 只回传本地 draft，没有 API、删除、发布或幂等键；父级仍按原顺序上传角色头像并随完整 Script `POST/PATCH`。
- **证据/状态**：focused **4 suites / 32 tests**、Script expanded **15 suites / 98 tests**、全仓 **267 suites / 1,614 tests**、strict TypeScript、范围 ESLint/Prettier、45/45 原资产、10×1,138 本地化、飞机删除门和 iOS production export 全过；export 为 **3,519 modules / 68 assets / 70 files**，HBC 13,355,560 bytes、SHA `6a8ce5d4…b7628`，临时目录已清理。审计见 `artifacts/acceptance/script-role-editor-current/audit.md`。Mac 锁定且 `Booted=0`，未启动模拟器、未调用真实后端；第 35 项保持 `🟡`，正式总进度仍为 **3/47（6.38%）**。

## 2026-08-08：ShortDramaFeedView 第 39 项代码/API/状态收口；固定双机终验待解锁

- **分页/生命周期**：推荐流与系列流保留原版独立 scope，账号、series、episode、initial position 任一改变都会 remount；首屏或分页在打开子页期间完成仍会保存，只有真正卸载/换 scope 的旧结果才丢弃。竖向 pager 分开“当前已提交页”和“手势开始后的播放目标页”，取消回旧页、完成才提交 selection；末三条加载有同帧锁及同 activation 防空页连抽。
- **API/缓存**：Feed/series 强制成功 wrapper＋非空 data，点赞/进度强制 wrapper，解锁同时强制 wrapper＋data；owner+scope cache 保留 5 分钟 fresh、30 天 stale fallback、200 条上限。同 key 请求合并、写入串行；清账号先推进 generation，再排在已有写后精确删除，旧请求/旧写不能复活缓存，corrupt/过期清理也不会误删刚写的新值。
- **证据**：Short Drama 相邻 **10 suites / 77 tests**、当轮全仓 **257 suites / 1,535 tests**、strict TypeScript、目标 ESLint/Prettier、资产 **45/45**、本地化 **10×1,138** 和 production iOS export **3,519 modules / 68 assets / 70 files** 全过；HBC 13,305,104 bytes，SHA-256 `01c8d193…76263`。两次约 19.7 MiB 的临时 export 目录在记录指标后均已永久删除，未删除代码或资产。审计见 `artifacts/acceptance/short-drama-feed-current/audit.md`。
- **正式状态**：本项代码/API/状态阶段收口，但真实推荐/系列数据、媒体/支付/弱网/前后台/手势取消与固定同型号同尺寸 Native/Expo 双模拟器 95–98% 样式门尚未执行，故第 39 项保持 `🟡`；正式总进度仍为 **3/47（6.38%）**，EAS 云端阶段未开始。

## 2026-08-08：飞机/flight-layer 产品功能删除门固化

- Expo 可执行 `src/`、`modules/` 和产品资产目录已全量扫描，不存在 `/map/flight-layer`、FlightLayer 模型/状态/轮询/模拟飞机/渲染器、airplane UI token 或六个 `flight_plane_*` imageset；API route/contract 两套库存均继续显式排除该路由，避免把用户要求删除的能力误报成候选缺口。
- 新增独立回归测试锁住源码、路由和资产缺失；在范围内保留的 **45/45** 张原数字资产继续逐字节一致，聚合 SHA-256 `7d5a25be…d6c6b`。发送按钮使用的 `paperplane.fill` 只是纸飞机发送符号，不包含被删除功能的 API、模型、状态或资产，予以保留。
- 原 Swift 工程及桌面只读 Swift 事实源副本不作删除或改写；删除只发生在 Expo 产品实现范围。完整证据见 `artifacts/acceptance/airplane-removal-current/audit.md`。这是一条产品范围要求，不增加 47 页完成数；总体仍为 **3/47（6.38%）**。

## 2026-08-08：MainTabView 第 25 项消息/朋友圈双 badge 真实接线（固定双机仍待验）

- **纠错**：原 MainTab 同时消费 `chatUnreadCount` 与 `momentsUnreadCount`，不是只有消息 badge。ContactList 已把排除 muted 的会话聚合接入 Messages；本轮新增 active-owner Moments store，把 Discover 的权威 `/moments/notifications/unread`、前台 `moments_update` push、朋友圈/通知页乐观清零串到 Discover Tab badge，并按原 descriptor `badge_key` aliases 映射，100 以上显示 `99+`。
- **账号/迟到门**：Moments store 换号/登出立即归零且不保存旧账号值；A→B→A 时不会复活 A 的旧 badge，旧账号迟到 fetch/push 也不能覆盖当前账号。Discover 只有通过原有 focus+generation+active owner commit gate 后才发布；清 badge 先更新 UI，再 best-effort 调用 read API，与 Swift `clearInteractionBadge()` 一致。
- **证据/总体**：MainTab badge、Push、ContactList、remote config、root title 聚焦 **7 suites / 42 tests**，目标 ESLint/Prettier 零 warning、全仓 strict TypeScript 通过；事实源 `MainTabView.swift`/`UIKitNav.swift` 与原工程逐字节一致，完整审计见 `artifacts/acceptance/main-tab-current/audit.md`。任意远程 screen/web 动态 Tab、每 Tab 独立返回栈/重选回根、通知与邀请深链、iOS 26 材质及固定双机 95–98% 矩阵仍缺，因此第 25 项继续 `🟡`，正式总进度仍为 **3/47（6.38%）**。

## 2026-08-08：Wallet 第 46 项奖励广告预载/展示时 SSV 顺序收口（真实 AdMob/到账仍待验）

- **原生顺序已对齐**：Expo 不再在点击后才创建并加载广告。现在先按账号+ad unit 单飞预载并缓存，点击时取出已加载广告，再创建 `/wallet/ad-rewards/sessions`；锁定的 `react-native-google-mobile-ads@16.3.4` 原生 patch 会在 `show({ serverSideVerificationOptions })` 时、真正展示前把 owner 与服务端 `ssv_custom_data` 写入 `GADRewardedAd`。这与 Swift 的 `load()` → `prepareServerVerification(for:)` → `present` 顺序一致。
- **失败和账号边界**：普通 session API 失败保留尚未展示的广告供下次点击重试；403/429 丢弃并分别关闭入口/清零次数；缓存按账号+unit 隔离，换号立即失效，失败 load 可重试。客户端 earned callback 仍不直接增加余额，只有同一上海业务日服务端 remaining 下降才确认 Google SSV 入账。
- **自动证据**：钱包/广告聚焦 **7 suites / 32 tests**、strict TypeScript、目标 ESLint/Prettier 全绿；新增 SDK 测试覆盖预载单飞、同对象消费、展示时 SSV、earned+closed、session 失败复用、账号切换与 load 失败重试；真实 hook 状态机测试继续证明 status→preload、take→session→show 顺序、5xx 保留、403 丢弃/禁用及 owner/unmount 失效。原版与桌面 Swift 副本 `AdRewardService.swift`/`WalletView.swift` 哈希逐字节一致，原工程 tracked/staged diff 为零。审计见 `artifacts/acceptance/wallet-ad-reward-current/audit.md`。
- **总体/门禁**：这只关闭原文档中的 SSV 时机代码缺口。真实 UMP/AdMob fill、Google SSV→后端→余额/流水、403/429/过期/跨日/多设备、前后台 presenter、StoreKit/生产钱包，以及 Wallet 固定双模拟器 95–98% 页面和交互矩阵仍未完成；第 46 项继续 `🟡`，正式总进度仍为 **3/47（6.38%）**，EAS 云端阶段未开始。

## 2026-08-08：SplashScreen 第 43 项固定双机组件视觉通过；设备会话门仍待完成

- **运行时纠错**：只靠源码无法发现 AuthProvider 的 500ms 无 token 窗口会在 router/重 provider 初始化期间先耗尽，第一轮 Expo 实际没有渲染 Splash。现把 `BootstrapGate` 提到 AuthProvider 根部、所有实时/通话/路由 provider 之前；模拟器重录确认白屏直达 Login 的缺口已消失。此项再次证明前端 95–98% 必须保留模拟器门。
- **同机型实测调整**：固定 Native `4CDB4BB3-F3A0-452E-8043-EC68EF7C1E4C` 与 Expo `98115C4F-1923-423B-8B76-CF07ED611A49` 均为 iPhone 17 Pro Max / iOS 26.4、1320×2868。SwiftUI 安全区内 `VStack` 的 86pt 底部 Spacer、末段 14pt spacing 与 bottom inset 已在 Expo 逐项补齐；Swift 36pt rounded-heavy 对应 RN 32pt 加 -2.5pt 光学校正。最终 Logo 顶边同为 y=2059、宽 351/356px，两行文案及 spinner 纵向差 0–1px。
- **95–98% 证据**：整屏 ±3px 比率 **99.0388% PASS**；另裁切内容区以排除白底虚高，组件结构相似度 **97.4053% PASS**、归一 RGB **98.4740%**。正式 Native/Expo/diff/metrics 及 component crop 证据保存在 `artifacts/acceptance/splash-current/`，失败页、bundle 下载和空白帧均未参与指标。聚焦 Splash/Auth bootstrap/storage **3 suites / 20 tests** 与全仓 TypeScript 通过。
- **状态/清理/总体**：视觉门通过不等于整页完成。cached user、20s watchdog、迟到验证、401/403 清会话、原 Swift→Expo binary Keychain 覆盖安装、APNs 上传及 Preview/Production 纯冷启动仍缺设备证据，因此第 43 项继续 `🟡`，正式总进度仍为 **3/47（6.38%）**；EAS 云端阶段未开始。正式证据哈希确认后，其余录屏/逐帧/contact sheet/临时 crop/试算整体移入可恢复废纸篓 `/Users/wegpt.com/.Trash/codex-splash-retry-20260808-final.F7ymgA`；源码、资产、文档和正式证据未删。Metro 已停、两台已 Shutdown，`Booted=0`。

## 2026-08-08：全项目 Swift→Expo 后端库存重新生成

- **第一层路由**：从当前只读 `APIService.swift` 重新提取 189 个路由模板，扣除飞机 `/map/flight-layer` 与两个只用于 Debug 路径诊断、并非独立请求的片段后，复刻范围内为 **186/186 已有 Expo 网络引用、候选缺口 0**。
- **第二层合同线索**：重新提取 **211/211** 个 Swift 请求合同；Expo 同 route+method 候选 **211/211**，auth/idempotency/no-cache 线索 **211/211**，method 缺口/flag review/人工 method review 均为 0。API route/client/normalizer/auth 聚焦 **4 suites / 25 tests** 通过。
- **边界/总体**：该自动库存只证明全局 route、method 和三类旗标没有静态候选缺口，不能替代各功能对 body、envelope、错误码、分页、缓存、账号隔离、竞态、重试和状态回写的人工矩阵；这些仍由 47 项逐项验收。因此不增加正式完成页，总进度仍为 **3/47（6.38%）**。

## 2026-08-08：VideoPlayerView 第 45 项补齐 Apple 后台 MP4/HLS 缓存；主 App 原生链接通过

- **事实源与边界**：只读原版 `VideoPlayerView.swift` 272 行、SHA-256 `ab6309d9…f3b2`，`MediaCacheManager.swift` 380 行、SHA-256 `36b2e026…3c93`；桌面新分支副本与两份事实源逐字节一致，原始 Swift 未修改。本轮只改新 Expo 副本，没有触碰第 13/47 项或其他代理负责的业务文件，也没有恢复已删除的飞机功能/资产。
- **原生缓存补齐**：新增本地 Expo module `BWChatMediaCache`。MP4 使用 Apple background `URLSessionDownloadTask`；HLS 使用 `AVAssetDownloadURLSession` 生成 `.movpkg`。实现账号 SHA-256 目录、账号 index、缺文件自愈/命中 touch、5 秒延迟与取消、2GB 空间 gate、30 天 stale、512MiB–5GiB/15% LRU、文件保护和备份排除；鉴权头传给 URL asset/request，任务元数据以 base64 `taskDescription` 持久化，启动时恢复系统任务，AppDelegate subscriber 接收后台 session 完成回调。本地上传确认继续采用文件复制，不把大视频整包读入 JS 内存。
- **播放器接线**：`MediaCacheService` 原生优先，Development Build 有模块时 MP4/HLS 都交给 Apple 下载器；无原生模块时只保留旧 JS MP4 fallback，绝不把 HLS 当普通文件。共享播放器命中本地 `.movpkg` 后直接使用 local URI，不再给本地包错误追加 Expo 在线 cache 标记。私聊、群聊、Agent、朋友圈 Feed/详情/用户主页六入口与十语言 loading/error/close 接线复核通过。
- **自动与原生证据**：聚焦 **5 suites / 34 tests**、本项 ESLint/Prettier、全仓 strict TypeScript、Swift parse/strict format、Podspec syntax、Expo autolink 全绿。当前共享副本全仓 Jest 为 **215/216 suites、1,292/1,293 tests**；唯一失败是 PropBag 测试把已存在但被 Prettier 换行的 `activity-cat-food` 路由误当缺失，第 45 项测试全过且未越权修改其他域。`pod install` 安装 `BWChatMediaCache 1.0.0`；模块 Simulator arm64 静态库独立 `BUILD SUCCEEDED`，SHA-256 `1e0c2139…f425`。主 App Simulator arm64 Debug 也 `BUILD SUCCEEDED`；最终 debug dylib 中可见 module、AppDelegate subscriber、`getCachedUriAsync`、`startCacheAsync`，SHA-256 `51f2993d…54bc`。首次完整 App 构建只在完成编译/链接后因本机没有 Sentry org 被上传脚本拦截，按脚本支持的 `SENTRY_DISABLE_AUTO_UPLOAD=true` 增量重跑通过，没有修改 Sentry 或业务代码。资源 **45/45**、聚合 `7d5a25be…d6c6b`，本地化 **10×1,138**、聚合 `d3b5e6ae…dc6e`。
- **正式状态/清理**：本轮没有启动模拟器，也没有调用 EAS。固定 Native `55451973-17BA-4288-AD7B-2E61A4378B74` / Expo `93BAFA82-73C5-4FC8-8640-D014DAF024DF` 上的真实受保护 MP4/HLS、`.movpkg` 离线播放、挂起/终止续传、系统回调、低空间/LRU/清理竞态、Range scrub、多指/中断/前后台、暗色/VoiceOver和同状态 95–98% diff 仍未验收；因此第 45 项保持 `🟡`，正式总进度仍是 **3/47（6.38%）**。哈希记录后已删除本轮临时 DerivedData，仅保留源码、Pods 集成文件、测试、文档和正式审计。

## 2026-08-08：SplashScreen 第 43 项固定双机逐帧尝试；仅 Native 证据有效

- **设备/尺寸**：只使用 root 固定 Native `4CDB4BB3-F3A0-452E-8043-EC68EF7C1E4C` 与 Expo `98115C4F-1923-423B-8B76-CF07ED611A49`；两台同为 iPhone 17 Pro Max / iOS 26.4、1320×2868，已排除设备和画布尺寸不一致造成的差异。
- **Native 参考**：10fps 逐帧中约第 74 帧进入前台、第 76–80 帧白色 launch、第 84 帧完整 React Splash、第 87–92 帧 Login。Expo 端准备同轮录制时，恰逢并行第 47 项依赖补丁提交，活跃 `node_modules` 临时缺少顶层链接，Metro 因缺少 `@expo/cli` 的 `./utils/env` 退出；dev client 的项目加载失败页不是有效产品证据。
- **验收结论**：本轮没有形成 Native/Expo/diff/metrics 四件套，未计算且不会声明 95–98% PASS。第 43 项仍为 `🟡`，依赖恢复后必须用同一 pair 重拍并核验字体、spinner、状态栏、安全区和逐帧时序。
- **清理/总体**：本轮临时录屏、抽帧目录、启动图和错误图已移入可恢复的 `/Users/wegpt.com/.Trash/codex-splash-qa-20260808.NmLuxC`，未删除源码、原始资产、文档或正式证据；两台已精确 Shutdown，`Booted=0`，8081 已关闭。正式总进度保持 **3/47（6.38%）**，功能/API 继续逐项收口，前端仍执行模拟器 95–98% 门，EAS 云端阶段未开始。

## 2026-08-08：EditProfileView 第 16 项二次代码/API/状态收口；固定双机仍待解锁

- **纠正的源码事实**：未知 gender 原值保留；非空非法生日显示原文；保存/上传时只禁用保存键而不禁表单；头像上传成功后的 GET 回读在已有 profile 时失败静默且仍清全图缓存；Swift `try?` 相册读取失败不显示网络错误。Expo 已对应，并用 current asset representation 尽量保留 HEIC 等原始表示。
- **API/隔离**：`GET/PUT /profile/me` 强制 `data.profile`，不接受 `data.user`/bare data；头像上传只接受 `data.avatar_url: String`，不接受 camelCase，也不擅自 trim/拒绝空字符串。编辑内容以 owner key remount，卸载后的旧 save/upload/get 不更新新账号 Auth、导航、toast 或字段。
- **自动门/清理**：聚焦 **3 suites / 19 tests**、本域 Prettier/ESLint、iOS Metro **3,503 modules / 68 assets / 70 files** 通过，HBC 13,096,423 bytes、SHA `7227d233…aff5bf`；临时 export 已移入废纸篓并确认不存在。strict TypeScript 当前仅剩并行第 38 项活跃 renderer 测试缺模块，本域无类型错误，待并行收口后统一复跑。
- **总体**：完整审计为 `artifacts/acceptance/edit-profile-current/audit.md`。真实相册权限/HEIC/超大图、字段和生日交互、浅暗色/大字/VoiceOver及同状态 95–98% 双机门未完成，第 16 项继续 `🟡`，正式总进度 **3/47（6.38%）**；EAS 未开始。

## 2026-08-08：FriendRequestsView 第 18 项代码/API/状态阶段收口；固定双机仍待解锁

- **功能/API**：严格 snake_case 申请模型、120 秒 TTL/30 天 retained cache、legacy 非空迁移、single-flight、owner/focus generation、已处理 ID 防复活、accept/reject 与 friends 刷新均已对应；接受成功恢复原生可见顺序“删行→立即 `friends.added` toast→等待普通好友缓存刷新”，慢刷新不再延迟 toast。按钮补按昵称区分的 VoiceOver hint。
- **证据**：专项 **4 suites / 25 tests**、相邻 **9 suites / 46 tests**、当轮全量 **210/210 suites、1,226/1,226 tests**、Prettier、ESLint、TypeScript 和 iOS Metro **3,496 modules / 68 assets** 通过；临时 export 已精确删除，原生事实源逐字节一致。完整审计为 `artifacts/acceptance/friend-requests-current/audit.md`。
- **双机/总体**：固定 pair 同为 iPhone 17 Pro Max/iOS 26.4 且保持 Shutdown；macOS 锁屏阻止只在 UI 中输入测试账号，未生成无效 Friend Requests 图。真实接受/拒绝/错误、暗色/大字/VoiceOver和 95–98% 视觉未过，第 18 项继续 `🟡`，正式总进度 **3/47（6.38%）**；EAS 未开始。

## 2026-08-08：ShortDramaActionRail 第 37 项代码/API/状态阶段完整收口；固定双机终验待解锁

- **UI/资产**：锁定 ActionRail、AvatarView、FeedViewModel 三份原生哈希，原项目和桌面副本逐字节一致且相关 Swift 无修改。58pt rail、18/6pt 组距、48/11/2pt 作者头像与 overlay 白描边、26/13pt 关注钮、27pt/44×34pt 图标、11pt/54pt/0.72 计数和 1K/1W/1M 完整保留；头像继续使用远端缓存和原 `#667EEA→#764BA2` 渐变占位，本组件无页面位图、分享、更多或触觉。
- **状态/API/隔离**：点赞和关注每次从同步最新状态翻转，支持快速双击及乱序回执；点赞失败恢复该次完整视频快照，关注失败严格恢复整个视频数组快照，同作者分集同步。成功关注发布带 `ownerId` 的关系事件，换号以用户 ID remount，旧账号事件/状态不进入新页面。like/follow 的 POST/DELETE、编码、body、required envelope 和 snake/camel/nested 回执已覆盖。
- **辅助功能/自动门**：作者/关注/点赞/评论均有 button/label，关注与点赞有 selected state；十语言四个 key 均存在。聚焦 **8 suites / 49 tests**、最终整仓 **210/210 suites、1,226/1,226 tests**、全仓 ESLint、strict TypeScript、45/45 原资产、10×1,138 本地化和 iOS Metro 全部通过；Metro 为 **3,496 modules / 68 assets**，HBC 13,072,890 bytes、SHA `de1b6653…dddb`。20MB/70 文件临时 export 在记录指标后已永久清理，完整报告为 `artifacts/acceptance/short-drama-action-rail-current/audit.md`。
- **固定双机/总体**：仅只读核对自己的 Native `55451973-17BA-4288-AD7B-2E61A4378B74` 与 Expo `93BAFA82-73C5-4FC8-8640-D014DAF024DF` 均为 Shutdown；没有关闭或操作 root 正在 Booted 的 Map/Expo pair。Mac 仍沿用同日 Computer Use 明确 locked 的阻塞，不启动设备、不落盘测试凭据，也不把源码门冒充 95–98% 视觉证据；第 37 项保持 `🟡`，整体正式进度仍为 **3/47（6.38%）**，EAS 未开始。

## 2026-08-08：ShortDramaVideoPage 第 42 项完整代码/API 阶段收口；固定双机终验待执行

- **事实源/UI**：锁定 `ShortDramaVideoPage.swift`、`ShortDramaFeedView.swift`、`ShortDramaFeedViewModel.swift` 三份 SHA-256，桌面完整副本与只读原版逐文件一致。保留全屏黑色 aspect-fill、首帧 cover/渐变与 180ms fade、原失败时 cover/loading 行为、74/28pt 播放钮、锁卡、底部 metadata＋ActionRail 全数值；没有虚构原版不存在的播放错误页。
- **播放/生命周期**：候选源严格 streaming→MP4→play→HLS 去重；账户本地缓存优先；API-path 内媒体通过 1-byte Range 复用 401 refresh 并读取最新 Bearer。主源明确无音轨会保时切首 fallback；`playToEnd` 与 0.35 秒/末 0.25 秒双循环保险替代单一自动 loop；非静音、音量、3 秒缓冲、AirPlay、前后台/路由/手动暂停/卸载暂停恢复均已接。
- **状态/API**：MP4 按 5 秒调度并在离页取消；进度差值 0.75 秒、4 秒超时，后发同视频请求真实 Abort 前一请求；解锁 header/body 复用失败保留 key，余额未知查 `/wallet/balance`，成功同时更新共享 WalletProvider；feed/detail/progress/unlock/like/follow/comments 合同保持。HLS 在线播放/鉴权完成，但 Expo 尚无原版 `.movpkg` 原生持久缓存模块，未误报解决。
- **辅助功能/证据**：补齐播放/暂停、返回、锁卡、关注/点赞 selected state、非当前页隐藏和 header/live-region；十语言关键文案存在。专项 **6 suites / 49 tests**，全仓 **209/209 suites、1202/1202 tests**，资源 45、本地化 10×1138、ESLint、strict TypeScript 全绿；iOS Metro **3496 modules/68 assets**，HBC 13,051,828 bytes。完整报告为 `artifacts/acceptance/short-drama-video-page-current/audit.md`；19MB 临时 export 已移到废纸篓，项目内未留本轮临时 bundle/截图/log。
- **固定双机尝试/总体**：只启动固定 Native `55451973-17BA-4288-AD7B-2E61A4378B74` 与 Expo `93BAFA82-73C5-4FC8-8640-D014DAF024DF`，两台确认为同一 iPhone 17 Pro/iOS 26.4。Native 到登录页，Expo 因 SpringBoard shell crash 无 display port；Computer Use 明确返回 Mac locked，无法在 UI 输入测试账号或执行同源视频播放/暂停/锁卡/弱网与截图对照。无效登录截图已移到废纸篓，两台已精确 Shutdown，未把启动尝试冒充 95–98% 证据；第 42 项保持 `🟡`，正式总进度仍为 **3/47（6.38%）**。

## 2026-08-08：DiscoverView 第 14 项根页代码/API 收口；复合子域与固定双机终验待执行

- **根页契约**：严格 `GET /app/discover-config` 与 `GET /moments/notifications/unread`，保留 config 独立 5 分钟节流、moments 每轮刷新、280ms 延后、focus/active/换号调度及 blur/background 取消；App/Build/语言请求头、可选 Bearer、required envelope/data、默认/远程 section、moments badge/new-dot 和全动态路由已一一对应。
- **隔离与 UI**：generation + focus + active owner 拒绝迟到发布，moments snapshot 按 owner 隔离；稳定 live/games/stories/benefits 入口不会被旧 coming-soon/H5 配置降级。原 16/20/36/12/14/40/70pt 布局常量、十语言、浅暗色、Dynamic Type 和 VoiceOver 代码已接入。
- **证据**：原生 5 份事实源与原项目逐字节一致；本页无专属位图，飞机功能/接口/六组资产不在 Expo 产品范围，其余数字资产 **45 files** 逐字节通过。聚焦 **5 suites / 25 tests**、Prettier、ESLint、strict TypeScript 通过；完整证据为 `artifacts/acceptance/discover-current/audit.md`。
- **固定双机尝试**：Native `4CDB4BB3-F3A0-452E-8043-EC68EF7C1E4C` 与 Expo `98115C4F-1923-423B-8B76-CF07ED611A49` 同为 iPhone 17 Pro Max/iOS 26.4、1320×2868。原生完整副本与 Expo development build 均完成本地 Xcode Debug 编译、安装和启动，Expo 通过 LAN Metro 加载 **3,654 modules**；两端均到登录页。macOS 锁屏使仅允许在运行时 UI 输入的测试账号无法使用，故没有进入 Discover 目标态，也没有拿登录页冒充 95–98% 证据。
- **清理/总体**：Metro 已停，只关闭 root 自己的固定 pair，复核 `Booted=0`；四张启动临时图和两个明确临时 DerivedData 目录已移入系统废纸篓，约 2.5GB，源码/资产/文档/正式证据未删。LiveLobby、Agent 地球匹配、真实双账号音视频和 Discover 默认/远程/自定义 section 同状态 95–98% 视觉/设备门仍缺；第 14 项保持 `🟡`，正式总进度仍为 **3/47（6.38%）**，EAS 云端阶段未开始。

## 2026-08-08：ScriptRoomChatView 第 36 项代码/API/并发阶段收口；固定双机终验待执行

- **UI/交互**：角色横栏、剧情头、倒序底部时间线、queued/generating/failed/ended、双向气泡、1–5 行输入、1000 grapheme、50ms + 200ms 回底、3s toast、导航返回与原生锚点 `Menu` 均已按 Swift 数值/语义还原，不再用 Alert 动作菜单冒充 Menu。
- **状态/并发**：provisional 导航交接、room/message cache、local conversation preview 全部 owner-scoped；运行时长历史不误截 100，仅在持久化边界保留 100。owner/room/session generation 及 unmount gate 覆盖 A→B、A→B→A 与迟到 load/send/retry/end/WS；发送成功后会立即更新会话预览。
- **API/证据**：房间 GET、submit/retry/end、group history/read 与 create room 七条链路的 path/method/auth/body/编码/strict envelope/data 均对应。原生 6 份事实源与原项目逐字节一致；聚焦 **7 suites / 52 tests**、当轮全仓 **207 suites / 1,181 tests**、TypeScript、ESLint 和 iOS Metro 通过。临时 Metro 目录已删除，没有删除源码、原始资产、文档或正式证据。完整报告为 `artifacts/acceptance/script-room-chat-current/audit.md`。
- **状态/总体**：本轮没有启动模拟器；真实六链路、断网/乱序/账号切换、键盘/浅暗色/大字/VoiceOver 和固定同型号同尺寸 Native/Expo 同状态 95–98% 视觉门仍缺；第 36 项保持 `🟡`，正式总进度仍为 **3/47（6.38%）**，EAS 未开始。

## 2026-08-08：ProfileView 第 29 项代码/API 阶段收口；固定双机终验待执行

- **事实源**：锁定 `ProfileView.swift`、`ProfileViewModel.swift`、`APIService.swift`、`AppRemoteConfigStore.swift`、`WalletStore.swift`、`DynamicRouteHandler.swift` 六个 SHA-256；桌面新副本与原项目逐字节一致，原项目未修改。本页没有专属本地位图，头像来自用户 URL，二维码运行时生成。
- **功能/API**：严格 `GET /profile/me` 与 `GET /wallet/balance` 已一一对应；资料成功回写 AuthProvider，profile/wallet/error/loading/share/toast 全部按 owner 隔离，generation + active owner + response owner 阻止账号切换后的迟到污染。Focus/active/下拉生命周期、Remote Config profile/contact 双来源和默认回退、当前语言 title/subtitle、原三项标题例外、native/web/external/screen 全动态路由、Alert、系统分享、M 级二维码、复制 toast 均已对齐。
- **UI/辅助功能**：原 16/14pt 外距与组距、18pt Hero、82/76pt 头像、24/22pt 标题/统计、42pt 操作按钮、40/50pt 菜单图标/行、78% sheet、62pt 分享头像、172pt 二维码及 50pt 按钮保持；十语言、动态浅暗色和 VoiceOver role/label 已接。
- **验证**：Profile 聚焦 **4/4 suites、19/19 tests**、Prettier、ESLint 通过；独立证据为 `artifacts/acceptance/profile-current/audit.md`。全仓统一 TypeScript/Jest/Metro 门将在并行 ScriptRoom/VideoPlayer/ContactList 合并后重跑。
- **状态/总体**：尚未启动固定 Native/Expo 双模拟器；初始/加载/错误/下拉/分享/动态路由/浅暗色/最大字体/VoiceOver 的 95–98% 视觉与设备门仍缺，所以本页保持 `🟡`，正式总进度仍为 **3/47（6.38%）**。本轮没有旧 Profile 截图，无需清理旧证据；没有留下临时构建垃圾。EAS 云端绑定、Preview/Production OTA、灰度与回滚未开始。

## 2026-08-08：当前主账本 3/47；ImagePreview 27/27，最新整仓 195/197 suites

- **正式完成页**：`MapDatingView`、`PropBag`、`ActivityCatFood`，当前 **3/47（6.38%）**。后两屏同尺寸双机组件样式为 **98.8948% / 98.1606% PASS**，原数字资产逐字节一致。
- **代码/API 已收口但页面未完成**：AgentChat（13 条后端链、14 suites/60 tests）、AddFriend（搜索/follow 3 suites/16 tests，关联 6 suites/27 tests）、AddGroupMembers（群组 13 suites/67 tests，API/cache 3 suites/14 tests）与 Splash（3 suites/19 tests）均已写独立 audit；必须等各自固定双模拟器视觉/设备门完成后才能计页。
- **GroupInfo**：功能/API/状态 13/13、主视口 96.5974% PASS，但 flag 关闭状态、末次微调重拍及十语言/暗色/动态字体/VoiceOver未齐，保持 `🟡`。
- **Auth**：Login/Register API 5/5、静态视觉 98.8222% / 98.3298% PASS；完整设备/VoiceOver、真实注册成功/token 持久化、真实 APNs token仍未齐，保持 `🟡`。
- **资源/进程纪律**：模拟器按代理固定 pair、每人最多两台；不用即关。主机锁屏后 AddFriend 已停止 8081、关闭固定双机并删除本轮临时图；全局 0 台 Booted，遗留 8083 Metro 也由 root 确认归属后正常停止。
- **最新统一门禁**：原数字图片 **51/51**、聚合 SHA-256 `295154cd…`；本地化 **10×1,138**；ImagePreview 聚焦 **5 suites / 27 tests** 与相关 ESLint 全过，整仓 strict TypeScript 全过。最终整仓重跑为 **195/197 suites、1,116/1,118 tests**：仅并发剧本域的 `script-editor.test.ts`、`script-detail.test.ts` 仍按旧 request options 断言，未接受同域新加的 `requiredEnvelope/requiredData`；最终全仓 ESLint 也仅在并发 `script-editor.tsx` 报 3 个 refs errors / 2 个 warnings，均与本项无关。本轮更早的并发变更前基线曾为 197/197、1,117/1,117 全绿。无模拟器 iOS Metro export 为 **3,487 modules / 68 assets**；19MB 临时导出目录已在验证后删除。
- **EAS 阶段**：遵循用户指定顺序，先完成本地整体复刻；Expo 云端绑定、Preview/Production OTA、10% 灰度、扩大/撤销与回滚当前均未开始。

## 2026-08-08：VideoPlayerView 第 45 项共享入口/Range/手势代码阶段收口；HLS 离线缓存与双机终验待完成

- **原生事实源**：完整审计 272 行 `VideoPlayerView.swift`，只读原仓与新分支副本 SHA-256 均为 `ab6309d94c607f33317492c1b699896f3f7a2ee455fcb963865a67c3981cf3b2`；两个仓库对播放器和 MediaCacheManager 的定向 git status 都为空，确认未改原始 Swift。
- **唯一共享入口**：私聊、群聊、Agent 直接使用 `VideoPlayerOverlay`；朋友圈主 Feed、动态详情、用户主页的 `MediaViewer` 视频分支也已切到同一组件，删除此前独立的简化 Moment video Modal。六个原生调用上下文现在共用同一状态机，不会出现聊天与动态视频手势/缓存分叉。
- **播放与生命周期**：异步准备本地缓存或远端 source，只有 `readyToPlay` 才安装可见 `VideoView` 并自动播放；退出立即 pause，保留 full-screen Modal 自己的 slide，不再额外把画面飞到 ±height。2 秒前向 buffer、waits-to-minimize-stalling、防休眠、原生 controls、黑底/隐藏状态栏、loading/error/28pt 关闭键均按原值；新增 Expo Video background playback plugin、`staysActiveInBackground` 与 iOS audio background mode，系统中断期间不通过 AppState 强制抢播。
- **Range/鉴权与 MP4 缓存**：public/cross-origin/local source 不添加 Bearer；受保护同源视频在交给 native player 前先以 `Range: bytes=0-0` 进入统一 authenticated resource lifecycle，过期 token 会 single-flight refresh，随后播放器的 metadata/scrub Range 和延迟完整文件下载都使用新 Bearer。本地账号缓存优先；ready 后才开始 5 秒延迟任务，退出取消；2GB disk gate、30 天 stale、512MB–5GB/15% LRU 保持。
- **手势冲突**：位置感知 pinch 保留最小 0.5、无最大值、触点内容保持、低于 1 的 200ms ease-out 与 cancel/fail 复位；放大平移和 scale≤1.05 的下拉退出互斥。单指 10pt 后只接收纵向意图，距离严格 >110 或 0.2 秒预测严格 >450 直接 dismiss；背景 320pt 衰减至 10%，画面 8pt 后按 900pt 缩至 0.55，拒绝/取消用 320ms、0.86 回弹。系统 native gesture、单指 pan、多指 pinch 采用 simultaneous + pointer/pinching gate，loading/error 不启用自定义手势。
- **自动证据**：聚焦 **4 suites / 28 tests**、本项 ESLint、Expo public config 通过；最终 iOS Metro export **3,493 modules / 68 assets**。原资产 **51/51**、本地化 **10×1,138** 复核通过。最终整仓 **202/205 suites、1,160/1,164 tests**，4 个失败只在并行剧本/群已读旧断言；全仓 TypeScript/ESLint 也只剩并行 profile 域 1/2 个问题，本项文件全绿。独立审计为 `artifacts/acceptance/video-player-current/audit.md`；19MB 临时导出物已移出项目，未保留截图垃圾。
- **明确未完成**：Expo Video 文档确认 iOS HLS 不支持持久 cache，原 `AVAssetDownloadURLSession` 的离线 `.movpkg` 下载仍需新的 native module；当前只完成 HLS 在线 content type 与同源 refresh/Bearer，不能冒充 HLS 离线缓存完成。Mac 锁屏期间未启动模拟器；固定 Native `55451973-17BA-4288-AD7B-2E61A4378B74` / Expo `93BAFA82-73C5-4FC8-8640-D014DAF024DF` 的 MP4/HLS 实流、Range scrub、系统 controls/极端多指、前后台/中断和 95–98% 截图门尚未执行。第 45 项保持 `🟡`，整体正式进度仍 **3/47**，未调用 EAS。

## 2026-08-08：ImagePreviewView 第 23 项代码/入口阶段收口；双机终验待解锁

- **原生事实源**：完整审计 1,457 行 `ImagePreviewView.swift`，SHA-256 锁定为 `9b0a8f707861dbf4f7b0af0243341812ad4ebeda8992050154603803c18364be`；原生文件保持未修改。0.5–5 倍缩放、1.05 复位、触点保持、2.5 倍双击、方向锁、18/72/28+900 阈值、Hero 时长、旧图前插、保存权限与错误反馈均保留原值。
- **共享图库核心**：URL 去重和初始页重映射之外，现以 URL 作为稳定 page key，旧图前插不会因 index 改变重挂全部图片；只对当前页和相邻页执行鉴权原图解码，避免打开长历史时一次性下载整段图片；手势取消会恢复横向页、纵向拖动或缩放状态，屏幕尺寸变化会保持当前 URL。Hero 优先复用来源缩略图 URI，避免原图尚未下载时飞行动画为空。
- **五类入口**：私聊、群聊继续使用共享 `ChatImageBubble`，带 `before_id` 旧图加载和当前 URL 保持；朋友圈动态与评论图继续使用同一 `ImageGallerySource`；Agent 普通 `input_image` 与已解锁 `paid_media` 现在都直接使用 `ImageGallerySource`，后者传入原始有序 `galleryImagePaths`、当前 index 和来源身份，不再只是手工打开 Modal。锁定预览、视频、生成中/失败/过期媒体不会进入图片图库。
- **保存与 VoiceOver**：同源媒体仍走 refresh-aware Bearer 二进制下载、cache 临时文件、Expo Image 解码校验、add-only photo 权限、创建 asset 与 finally 清理；0.5s/20pt 长按、中触觉和系统 action sheet 保持。图库根节点新增 modal 语义、页码 adjustable、前后翻页、保存、朗读页码、VoiceOver escape/activate 退出动作。
- **自动证据**：图库/Agent 聚焦 **5 suites / 27 tests** 与相关 ESLint 通过，整仓 strict TypeScript 通过；iOS Metro export **3,487 modules / 68 assets**。原资产 **51/51**、本地化 **10×1,138** 复核通过。最终整仓 Jest 的本项与 195 个 suites 通过；另 2 个并发剧本域 suites 因 request options 断言过期失败；全仓 ESLint 另有并发 `script-editor.tsx` 3 个 refs errors / 2 warnings。均已向 root 报告且未越权修改。19MB Metro 临时目录已删除，只保留 `artifacts/acceptance/image-preview-current/audit.md`。
- **正式状态**：Mac 仍锁定，本轮没有启动任何模拟器，也未调用 EAS。固定 Native `55451973-17BA-4288-AD7B-2E61A4378B74` / Expo `93BAFA82-73C5-4FC8-8640-D014DAF024DF` 的直聊、群聊、Moment、评论、Agent 五入口 Hero/分页/多指/长按保存/VoiceOver 与 95–98% 截图门尚未执行；第 23 项保持 `🟡`，整体正式进度仍 **3/47**。

## 2026-08-08：EditProfile 第 16 项代码/API/缓存阶段收口；双机终验待解锁

- **页面与字段**：88pt 头像、28pt 相机角标、表单几何、昵称/地区、1–3 行签名、Swift 扩展字素 150 上限、原生 SwiftUI 性别 menu、生日 wheel/未来日期限制/减 18 年/清除完成和 2.5 秒错误 toast 已按原版源码锁定；生日 wheel 新增当前 App locale 注入，五字段和头像入口补齐 VoiceOver label/state。
- **后端与缓存**：`GET/PUT /profile/me`、`POST /profile/avatar` 现在都强制成功 wrapper 与 `data`；PUT 发送 nickname/bio/gender/birthday/location 五字段，头像使用 `image` + `avatar.jpg` + `image/jpeg` + 90 秒。上传后严格回读服务端资料，调用共享 `clearImageCache` 清除 Expo、adopted、authenticated 的内存/磁盘和并发代际，再更新认证用户；仍保留原版“上传头像会用服务端资料覆盖未保存字段”的行为。
- **自动证据**：原生 view/view-model/API/image-cache 四份源码 hash 已锁；聚焦 **3 suites / 14 tests**、strict TypeScript、相关 ESLint 与 Prettier 通过。独立审计位于 `artifacts/acceptance/edit-profile-current/audit.md`；原页没有专属位图，不存在待复制的页面 raster asset。
- **正式状态**：当前没有启动模拟器。真实测试账号、HEIC/超大图、相册权限、上传/保存竞态、不同语言 wheel、键盘、dark/最大字号/VoiceOver，以及同型号同尺寸 native/expo/diff 95–98% 尚未执行，所以第 16 项仍为 `🟡`，整体正式进度保持 **3/47**；未调用 EAS。

## 2026-08-08：FriendRequests 第 18 项动态颜色补齐；代码阶段保持全绿

- **事实纠正**：原 `FriendsViewModel.acceptRequest` 只删除申请、通过标准 `.list` 缓存路径刷新好友列表并显示成功 toast，不发布 `FollowRelationshipStore` 事件；因此旧迁移矩阵里的“必须额外跨页面关系广播”不是原版合同，已从完成门禁移除。
- **本轮修复**：好友申请页此前固定使用浅色 `colors`，与 Swift 动态 `secondarySystemBackground`/文本/separator 不一致；现改为 `palette(useColorScheme())`，页面、空态、昵称/副标题、拒绝按钮和 divider 均随 light/dark 变化，accept accent gradient 保持原版。
- **既有代码门**：120 秒 TTL、30 天 stale retention、非空 legacy 迁移、账号隔离、同账号 single-flight、迟到响应、已处理 request 防复活、same-frame 操作锁、strict GET/accept/reject wrapper 和接受后好友缓存刷新保持不变。聚焦 **4 suites / 24 tests**、strict TypeScript、ESLint、Prettier 通过。
- **正式状态**：真实接受/拒绝、返回通讯录后的好友列表/badge、dark/最大字号/VoiceOver 和同型号同尺寸 native/expo/diff 95–98% 尚未执行；第 18 项继续 `🟡`，整体仍 **3/47**，未启动模拟器、未调用 EAS。

## 2026-08-08：FollowList 第 17 项动态颜色补齐；三列表代码阶段保持全绿

- **本轮修复**：关注、粉丝和推荐三类列表此前固定浅色页面/卡片/文字，现统一接入 `palette(useColorScheme())`；原 16/12/28 边距、10pt 间距、14pt 卡片、48pt 头像、16/13pt 文字和 32pt 胶囊按钮不变，最终暗色值仍由双模拟器对原版校准。
- **既有合同**：三条 GET、follow/unfollow、relationship 的 method/path/query/body/wrapper，10 分钟 TTL、90 天 retention、分页/去重/single-flight、推荐初始值和排除规则、账号/路由/迟到响应 gate、乐观更新/失败回滚、关系广播与缓存写回保持一一对应。
- **自动证据**：聚焦 **5 suites / 27 tests**、相关 ESLint/Prettier 和最新全仓 strict TypeScript 通过；原页面无专属位图。独立审计为 `artifacts/acceptance/follow-list-current/audit.md`。
- **正式状态**：真实三列表、分页/错误/加载、关注/取关、dark/最大字号/VoiceOver 和同型号同尺寸 native/expo/diff 95–98% 未执行；第 17 项保持 `🟡`，整体仍 **3/47**，未调用 EAS。

## 2026-08-08：ChatBackground 第 9 项代码/API/缓存阶段收口；双机终验待解锁

- **后端与状态**：`GET /chat/backgrounds`、`POST/DELETE /chat/backgrounds/{type}/{target}` 的 method、编码、multipart `image`、90 秒、strict wrapper/data、API error 与空上传响应强制回读均和 Swift 一致；global、DM、group exact/global fallback 一一对应。
- **图片与缓存**：按 JPEG magic、≤900KB、≤1280px 原样保留，否则使用 1280→960→720→640 与 0.72/0.65/0.55/0.45/0.35 阶梯；上传后立即采用压缩本地图，URL/updated_at 版本变更、上传、删除会移除 adopted/authenticated/Expo image 旧缓存。同源图片使用 Bearer、401 refresh 一次、二次 401 会话失效、同 identity 单飞与旧请求防回填。
- **账号与 UI**：删除不属于原版的 AsyncStorage 背景列表；进程内 snapshot 绑定 owner，A→B 第一帧不闪旧背景、旧 A 响应不污染 B。设置预览、私聊、群聊统一使用鉴权 layer；light/dark 次级背景、280pt 预览、原行几何、0.62 saturation、0.82 contrast、0.46 white wash 已锁。SwiftUI brightness `+0.03` 在 RN iOS 仅能先用乘法 `1.03` 近似，必须以双机 95–98% 结果决定是否再调。
- **同文件 DirectChatSettings**：66pt 头像卡、当前聊天背景路由、清历史 destructive 确认、8% busy 层、API/non-API 错误分流和成功顶部 toast 已同步收口；`DELETE /chat/messages/{encodedID}/history` 新增 strict wrapper/data 门，保留每次 UUID 幂等键、flexible receipt、账号单调水位和会话预览即时清除。
- **自动证据**：聚焦 **10 suites / 40 tests** 通过，相关 ESLint、Prettier 与本模块独立 strict TypeScript 通过；原版 view/store/API 三文件 hash 自动锁定。完整审计位于 `artifacts/acceptance/chat-background-current/audit.md`。
- **正式状态**：Mac 当前锁定，所有模拟器均 Shutdown；尚未用 `test1` 在同型号、同 iOS 26.4 原版/Expo 双机完成真实相册、上传、恢复、冷启动、账号切换、light/dark/动态字体/VoiceOver 和截图差分，因此第 9 项仍为 `🟡`，整体仍 **3/47**。本轮没有调用 EAS，也没有保存密码或产生待清理截图。

## 2026-08-08：GroupInfo v2 后端/API 与状态矩阵 13/13；代表性双机视觉 96.5974% PASS

- **功能矩阵 13/13**：①通知免打扰与 mentions/重要成员例外；② viewer 备注/显示成员昵称；③成员列表、添加、移除和实时资料；④公告读写；⑤邀请创建/二维码/分享/撤销；⑥邀请预览/接受/打开群；⑦五类举报；⑧九类型消息搜索/筛选/游标/定位；⑨重要成员去重、排除本人、失效 ID 清理和四人上限；⑩群名/备注/我的群昵称文字设置；⑪三种邀请深链、token 校验、登录前 pending 与冷/热单次投递；⑫ notification/viewer/announcement/member 四类实时事件、旧 revision 拒绝和跨页写回；⑬ parent/child flag、权限合并、操作锁、乐观回滚、业务错误、清历史/退出/解散生命周期。
- **后端契约**：逐条对应原 Swift 的 `/groups/{id}`、notification/viewer/announcement/members、invites/preview/accept、reports、messages/search、conversation preference、history/leave/dismiss 路由；保留 snake_case body、`expires_in_days: 7`、空接受 body、可选空白字段省略、`Idempotency-Key`、`no-store`、URL escaping、30 条搜索默认与 1...100 clamp。WebSocket 同时接受 `data` 与 root payload，并把 `group_member_profile_updated` 归一为原 `group_member_updated` 状态流。
- **自动证据**：GroupInfo API、群 API、搜索、邀请 route、邀请 cold/hot handler、实时、缓存修订、页面交互和源码拓扑合计 **9 suites / 55 tests** 全过；本域相关 ESLint、Prettier 与全项目 strict TypeScript 全过。
- **固定双机证据**：仅启动用户指定的 Expo `93BAFA82-73C5-4FC8-8640-D014DAF024DF` 与 Native `55451973-17BA-4288-AD7B-2E61A4378B74`，两者均为 **1206×2622 / iOS 26.4**。同账号、同群、同免打扰/置顶/公开状态下，GroupDetail 初始可见视口的组件样式相似度为 **96.5974% PASS**（normalized RGB **97.7639%**、4pt structural SSIM **96.5974%**、严格像素 ≤3/≤8 **80.7528% / 81.2722%**）。实际交互另通过通知例外页、重要成员页/筛选、成员页/筛选、群名表单、清历史确认取消、解散确认取消；没有执行清历史、踢人或解散等破坏性确认。
- **视觉纠错**：对照截图后关闭了详情页多余 section 大间距、左贴开关、双行 row 高度和文字返回按钮差异；通知页、群名页、投诉页恢复 Swift `Form` 的 inset 圆角分组；重要成员恢复 inset List。iOS 26.4 下 Expo 原生 header search bar 会把 FlatList 视觉内容推到导航栏后方，已改为显式搜索按钮和同页搜索框，筛选实测只保留命中成员。
- **正式状态**：13/13 表示功能/API/状态矩阵完成，GroupDetail 主视口及通知/重要成员代表性状态已达到 95–98% 视觉门。由于服务器当前关闭邀请、公告、viewer、举报、消息搜索 flags，无法在同一真实后端状态下获得这些子页的 Native/Expo 成对运行截图；对应子页已完成 Swift 源码逐行样式审计、Expo 直达渲染和自动门，但不把单边截图冒充双机终验。因此 GroupInfo 域继续 `🟡`，不增加 47 页完成数；未调用 EAS。

## 2026-08-08：Auth 后端矩阵 5/5 与会话刷新生命周期完成代码级验收（页面仍待终验）

- **API 矩阵 5/5**：① `POST /auth/login` 精确保留原始 username/password、可选 `device_token`；② `POST /auth/register` 精确保留原始值，只省略空白 nickname 与缺失 device token；③ authenticated `GET /auth/verify`；④ unauthenticated `POST /auth/refresh` 发送已存 `refresh_token`；⑤ authenticated `POST /auth/logout` 发送空对象。五条调用均按 Swift 的 `APIResponseWrapper` 解包，登录/注册/刷新只接受字符串 `token`、字符串 `refresh_token` 与 user，裸 payload、字段缺失或错误类型失败关闭；`EmptyData` wrapper 允许省略 data。
- **生命周期**：受保护请求 401 后共享 single-flight refresh；刷新成功先保存双 token，再更新当前 user/账号缓存，最后使用新 Bearer 只重放原请求一次；重放仍 401、刷新 endpoint 明确 401 或本地缺 refresh token 才清会话并广播 invalidated。普通受保护请求的刷新 403、5xx、网络与解码失败不清现有会话；启动恢复的显式 fallback 则按原版对 401/403/凭据业务码清理，对网络/5xx/解码失败恢复缓存身份并标为 unverified。GET/HEAD 保留原版最多两次 transient retry，登录/注册/刷新/退出 POST 不因 5xx 自动重复。共享层新增显式 `invalidateSessionOnUnauthorized:false` 供原版不应登出的 Remote Config 路径使用，默认认证行为不变。
- **表单/可选系统信息**：推送 token 缓存是可选输入，读取失败时继续登录/注册且不发送 `device_token`；登录 401/已知错误、注册未授权、网络/超时、5xx、解码失败继续映射到原版 10 语言 key，不再在非中文语言回退硬编码中文。
- **自动证据**：认证 API、client 生命周期、启动恢复、normalizer、成功响应、表单策略与源码门禁 **8 suites / 49 tests** 全过；共享客户端另经 ActivityCenter、CatFood、token/auth storage 与 push 源码 **9 suites / 75 tests** 回归；相关 ESLint、Prettier 与全项目 strict TypeScript 通过。没有启动模拟器、没有真实注册、没有保存测试账号密码、没有调用 EAS。
- **正式状态**：本节证明 Auth 后端/API 矩阵与代码生命周期完成，不替代页面终验。Login/Register 静态样式仍为 ≤3 **98.8222% / 98.3298% PASS**，但完整设备交互状态、VoiceOver、真实注册/token 持久化、真实 APNs token 与 `BWChatAuthCompat` 覆盖安装证据未齐，因此两页继续 `🟡`；整体仍为 **1/47（2.13%）**，EAS 仍停在本地门禁阶段。

## 2026-08-08：功能矩阵改用原 Swift→Expo 后端 API 全量对应判定

- 用户确认完整功能矩阵可以从原代码对接的后端 API 是否全部正确接入来判断。以后 API-backed 功能以原 Swift 为事实源，逐项审计 path、method、Bearer/其他鉴权、请求字段与可选值、幂等键、分页、成功 envelope/字段别名、业务/HTTP 错误、缓存和账号隔离、并发/single-flight/重试、前后台或实时事件触发、成功后的本地/全局状态回写；全量 100% 对应并有契约/状态机自动测试，即可记为功能矩阵完成。
- 代表性真实后端抽查继续保留用于发现环境问题，但不再要求把每一种成功/错误/空态都在模拟器人工触发后才承认 API 功能完成。联系人/相册/通知/分享/键盘/真实音视频媒体等无法仅由 HTTP 契约证明的系统能力仍单列原生集成证据。
- 视觉门没有改变：页面样式/组件仍必须完成同状态原生/Expo/diff/metrics 并达到 **95–98%**；API 功能矩阵通过不能替代视觉，视觉通过也不能掩盖 API 缺口。三个 subagent 正按新口径重算各自的“API 功能矩阵进度”和“视觉进度”，重算完成前沿用上一份严格数字，不提前抬升整页 **1/47**。

## 2026-08-08：三个 subagent 域统一编号账本与视觉门禁纠正

- **ActivityCenter 2/7**：①签到✅（真实 `1/7→2/7`，按钮服务端禁用）；②饭点⛔（待真实可领取窗）；③幸运转盘⛔（账号 765 < 1000，且概率消费需真实用户动作）；④手机号绑定⛔（待真实号码/短信码）；⑤联系人发现⛔（待已验证手机号与明确授权测试通讯录）；⑥邀请✅（share session→系统 Copy→complete，`0/5→1/5`、+10，取消不重复）；⑦好友请求⛔（待真实匹配对象与 `/friends/request`）。**96.1656%** 只代表 1320×2868 初始福利中心可见视口的 component-style 指标，不是整页、两个 Tab、全部弹窗或交互状态的 95–98% 终验。
- **PropBag / ActivityCatFood 7/10**：①真实 `/me/prop-bag` 接口✅；②库存与消费回执✅；③道具卡说明弹层/外部关闭/刷新✅；④CatFood enabled/disabled fail-close✅；⑤流水接口与 cursor 分页✅；⑥余额/规则/流水/返回及页面交互✅；⑦18 张实际道具/猫粮 1x/2x/3x 原图 0 mismatch✅；⑧十语言/深浅色/大字/VoiceOver⛔；⑨固定双机同数据同流程⛔；⑩两屏 95–98% 视觉⛔。测试账号真实显示猫粮 58、15 分钟×1、10 分钟×1、视频×1，以及 5 条规则和 9 条流水；定向 5 suites / 29 tests 通过。当前只有全分辨率 Native 道具包图，不能拿 Native review 数据与 Expo 真实账号数据混算视觉比例。
- **LiveLobby 1/13**：①4 张实际引用直播原图逐字节一致✅；②大厅框架/视觉⛔；③列表/分页/排序/current-slot/实时合并⛔；④挂播弹窗/校验⛔；⑤头像裁剪/上传⛔；⑥真实创建槽⛔；⑦25 秒持久心跳⛔；⑧退出/tombstone⛔；⑨主播卡/详情⛔；⑩支付/体验卡⛔；⑪邀请完整生命周期⛔；⑫LiveKit 通话生命周期⛔；⑬计费/体验计时/最终账单⛔。Live 定向现为 9 suites / 48 tests，但自动测试不进入正式 13 项计数；当前只有 1320×2868 原生空态，没有 Expo 同状态截图、diff、metrics，因此视觉不是“失败比例”，而是尚无判定资格。
- **统一整体状态**：三个域均未完成整页，整体继续为 **1/47（2.13%）**。Login/Register 静态视觉虽分别为 ≤3 **98.8222% / 98.3298% PASS**，仍因完整设备功能矩阵、VoiceOver、真实注册与覆盖安装未齐保持 `🟡`。以后任一分项正式完成时，汇报必须同时列出 Activity、Prop/CatFood、Live、Login/Register、整体页面和 EAS 阶段，禁止只汇报单域变化。

## 2026-08-08：Auth 旧身份兼容模块完成 Pod 编译（完整覆盖安装仍待终验）

- `pod install` 已把本地 `BWChatAuthCompat 1.0.0` 纳入 `Podfile.lock` / `Manifest.lock`；App 的 Debug 与 Release xcconfig 均含 `-l"BWChatAuthCompat"`、模块搜索路径和 module map。使用 CocoaPods 同一包清单生成临时 Expo Modules Provider 时，也真实得到 `internal import BWChatAuthCompat` 与 `(module: BWChatAuthCompatModule.self, name: nil)`；探针核对后已删除，不再停留在仅有 JS optional module 或 autolinking 搜索列表的状态。
- 使用真实 Xcode/Pods 依赖图构建 arm64 iOS Simulator 的 `BWChatAuthCompat` 目标，`xcodebuild` 退出码为 **0**；产物包含 arm64 `libBWChatAuthCompat.a`、Swift module、ObjC compatibility header 与 module map。构建时同时真实编译/复用 `ExpoModulesCore` 及其 React Native 依赖，不是字符串扫描或伪造产物。
- 本轮没有把 Pod 目标成功冒充为整 App 完成：尚缺 App target 最终链接、含该模块的新 binary 安装，以及同 bundle 下“旧 Swift 包写入 `cached_current_user` → Expo 包覆盖升级 → 自动恢复并迁移清理”的真实设备链。Login/Register 因此继续为 `🟡`，整体正式页面仍为 **1/47（2.13%）**。
- 清理遵守单版本规则：已确认无代码/文档引用的 19MB 旧无飞机 export 和约 26MB 损坏依赖副本均使用 macOS 废纸篓 API移出项目；源码、当前依赖、原始数字图片、Pods 状态和正式验收证据未删除。该次 Pod 构建的临时 DerivedData 在记录必要哈希后删除。

## 2026-08-08：Auth 焦点弹簧与存储故障会话语义补齐（页面仍待终验）

- 逐行对照 `LoginView` / `RegisterView` / `AuthMotion` 后补回原版从未编辑到编辑、从编辑到收键盘时的 **360ms / 0.88 damping** 布局弹簧；原三张猫图仍直接使用原数字资产，猫 mood 的并行 spring 在依赖切换清理时会停止旧动画，快速切换输入框不再叠加过期动画。未聚焦布局数值和现有静态截图基准没有改变。
- 对照 `AuthManager` 的内存 token 与普通退出语义，修复 SecureStore/AsyncStorage 短暂失败会阻止 Expo 登录或让退出 UI 残留身份的问题：规范化 access/refresh token 先进入当前内存会话；Keychain 写失败不阻断本次受保护请求；退出先清内存 token、当前用户和未验证标记，再 best-effort 删除新旧 token/身份缓存。缓存失败诊断只含操作名和 Error 类型，明确不含 token、用户 JSON、账号或密码。
- 自动证据：新增存储写失败仍登录、删除失败仍退出四条断言，并更新焦点动效源码门禁；Auth API、表单、页面交互、缓存迁移、启动恢复、SecureStore token、实时、推送合并实测 **13 suites / 65 tests** 全通过且 Jest 干净退出，相关 ESLint 和 strict TypeScript 通过。
- 正式状态：这轮关闭的是动效和异常存储代码缺口，没有新增设备截图，也不冒充页面完成。Login/Register 仍缺完整设备状态矩阵、VoiceOver、真实注册成功会话与新原生兼容模块覆盖安装；两页保持 `🟡`，整体仍为 **1/47（2.13%）**。

## 2026-08-08：Auth 登录后实时连接与推送启动运行回归（页面仍待终验）

- 实时连接组件新增运行回归：有登录身份时按 `user_id` 启动；只有 App 回到 active 且仍有身份时才主动重连；退出登录立即停止；账号切换先执行旧 effect 清理，再以新账号启动；卸载同时移除 AppState 监听。本组 **3/3** 通过，不再只依赖源码字符串断言。
- 推送启动组件新增运行回归：未登录时不请求通知权限、不上传原生 token；登录后才请求权限并注册 token；APNs token 轮换、App 回前台会按当前账号重新同步；账号切换会 abort 旧任务并移除旧监听；前台通知执行 badge/会话副作用，通知点击保存 pending target、校验未消费后精确进入指定消息并标记一次。本组 **3/3** 通过。
- 当时合并证据：Auth API、表单、页面交互、缓存迁移、启动恢复、SecureStore token、实时连接、推送服务与推送启动共 **13 suites / 61 tests** 实测全通过；两份新增测试各自 ESLint 和全项目 strict TypeScript 通过。测试使用 mock 身份和不含密码的 token 占位，不保存用户提供的测试密码；后续新增断言后的当前总数以上一节 65 项为准。
- 资源与状态：本轮只做代码/自动化，没有启动模拟器；系统级 `simctl` 核对为 **0 台 Booted**。这关闭的是登录后的自动化子项，真实 APNs 设备/后端推送、新 `BWChatAuthCompat` binary 覆盖安装、Login 完整设备状态矩阵、VoiceOver，以及 Register 真实成功创建/token 会话仍未齐，因此 Login/Register 继续为 `🟡`，整体正式完成页保持 **1/47（2.13%）**。

## 2026-08-08：旧原生 Auth 身份升级兼容与空闲模拟器降温规则（Auth 页面仍待终验）

- 覆盖安装审计确认：原 Swift 用同一 bundle 的 Keychain 保存 `jwt_token` / `jwt_refresh_token`，Expo 已能继承；但旧当前用户快照在 `UserDefaults.cached_current_user`，此前 JS 只读 AsyncStorage，离线覆盖升级会有 token 却不能立即恢复身份。现新增自动链接的 iOS Expo Module `BWChatAuthCompat`，只读取旧 cached-user JSON 和 `bbchat.last_active_account_id`，首次恢复后迁入当前 Expo cache 并删除旧 current-user 快照；当前 Expo cache 优先，不会让旧身份覆盖新账号。Android/旧数据不存在时以 optional module 安全返回空。
- 迁移自动证据：旧完整 User JSON、last-active-id 最小身份修复、当前 Expo cache 优先、保存/退出同时清理新旧 current-user 四条路径均通过；Expo autolinking 已解析出 `BWChatAuthCompat` pod/module，认证相关总计更新为 **11 suites / 50 tests**，定向 ESLint 与 strict TypeScript 通过。该能力需要下一次正式 binary 通过 Pods 编译并做“旧 Swift 包→Expo 包”覆盖安装验证，旧 Development Build 不含新 module，不能冒充已完成实机迁移。
- 用户新增强制资源规则：模拟器只在安装、交互或取证时保持 Booted；进入代码、文档、后端、构建排队或等待时立即 shutdown 本域固定 pair，需要时只重启同一 pair，不创建第三台。规则下发后 ActivityCenter 与 PropBag/CatFood 共 4 台空闲设备已关机；LiveLobby 当时正在 GUI 登录/导航，完成当前取证后同样立即关闭。Metro/无设备构建可以后台继续。
- 页面状态：这轮关闭的是跨版本身份缓存代码缺口，不等于 Login/Register 完整页面终验。两页继续为 `🟡`，整体页面仍为 **1/47（2.13%）**。

## 2026-08-08：ActivityCenter API 矩阵 7/7；综合证据 2/7；页面仍未完成

- 真实后端：在分配给 ActivityCenter 的唯一 Expo 模拟器上使用运行时测试会话执行签到，服务端权威快照从 `1/7` 更新到 `2/7`，同一领取按钮随即禁用；未出现乐观状态回滚、重复领取或旧快照覆盖。测试凭据、token 和用户身份没有写入源码、测试、文档、证据文件名或日志。
- 邀请后端：真实创建 invite-share session，打开 iOS 系统分享面板并选择本地“拷贝”，随后向后端提交 complete 回执；真实任务从今日 `0/5` 更新为 `1/5` 并发放 +10 猫粮。该动作只把邀请内容复制到模拟器剪贴板，没有向第三方发送消息；完成后重新打开分享面板并取消，证明取消分支不会再次领奖。
- 视觉证据：两台固定的 1320×2868 / iOS 26.4 模拟器分别运行原生 Debug `ActivityCenterPreview` 与 Expo 开发期同源预览。**福利页初始可见视口**的组件样式相似度为 **96.1656% PASS**，其中 normalized RGB **96.9209%**、4pt structural SSIM **96.1656%**；严格像素 ≤3/≤8 分别为 **77.1242% / 81.0690%** 并继续保留，明确不把跨 SwiftUI/React Native 的字体、SF Symbol 与位图光栅差异隐藏成逐像素通过。该结果不是全部滚动区、幸运转盘 Tab、弹窗及交互状态的整页视觉终验。活动中心猫粮图标、奖励爆发图、奖励猫爪和转盘金币徽章共 **4 张**实际相关位图均有固定 SHA-256 守卫，并与原版逐字节一致。
- 自动与清理：ActivityCenter 定向为 **4 suites / 48 tests**，通用客户端重试选项为 **1 suite / 5 tests**，定向 ESLint 和 Prettier 检查通过；后端兼容解码已与 Swift 一致拒绝 `1e3`、`1.0`、`0x10` 等非十进制整数字符串，HTTP 2xx 空/畸形成功响应会按“结果不确定”保留幂等键，避免重试重复领奖。新增共享 `transientRetries` 可选项且默认行为不变，只在 Activity mutation POST 设置 `false`，已与原 Swift“POST 不做 transient auto-retry”严格对齐；默认带幂等键 POST 仍重试和关闭后只请求一次均有真实 client 回归。饭点、转盘、手机号、联系人和好友请求新增 12 个状态机自动门：饭点歧义失败保留乐观态/幂等键且重复点击只发一次；转盘无效配置前置拒绝、400 清键、5xx 留键且均释放操作门；联系人未绑手机、权限/哈希失败均不创建 match key，match 的 400/5xx 分流正确且账号切换后旧结果不发布；手机号验证只发一次、400 清 session key、5xx 保留 session/key；好友请求失败释放后可重试。正式证据只保留 `artifacts/acceptance/activity-center/check-in/` 与 `invite/`；本轮未启动模拟器、未产生临时截图或垃圾证据，没有删除源码、原始资产、文档或正式证据。全项目 strict TypeScript 仍仅被本域外 `push-bootstrap` fixture 缺新字段和 `realtime-provider` 缺直接类型依赖阻塞，本域没有新增诊断。
- 进度：按更新判定，签到、饭点、转盘、手机号绑定、联系人、邀请、好友请求的 API route/method/auth/body/envelope/error/idempotency/pagination/cache/lifecycle 与状态机矩阵正式记为 **7/7（100%）**。既有签到、邀请 **2/7** 只表示真实后端/系统/双机综合证据，不再作为 API 功能完成率。系统/外部能力证据仍单列：系统分享已过，真实 SMS、联系人权限/授权测试通讯录、深链冷/热态未过；视觉仍只有福利页初始可见视口 96.1656%，不是整页终验。因此 `ActivityCenterView` 仍为 `🟡`，整体已完成页面数保持 **1/47（2.13%）**。
- 资源规则：用户新增“没有正在安装、交互或取证时必须关闭模拟器”。ActivityCenter 固定 Native/Expo pair 已在空闲后确认全部 `Shutdown`；后续需要时只重启原固定 UDID，不新建第三台，也不切换或操作其他域的设备。

## 2026-08-08：Auth 空白收键盘、成功持久化与必需响应数据回归（页面仍待终验）

- 本轮继续逐行对照 `LoginView`、`RegisterView`、`AuthViewModel`、`AuthManager` 与 Expo 实现，补回 Swift 在整页 `contentShape` 上点击空白收起键盘/清除焦点的交互；Login/Register 分别增加不参与辅助功能树的背景点击层，保留原输入框、按钮和跳转在其上方响应。组件测试实际触发两个背景并确认 `Keyboard.dismiss`，源码门禁同时防止后续误删。
- Auth 成功合同收紧：`/auth/login`、`/auth/register`、`/auth/verify`、`/auth/refresh` 均声明成功 envelope 必须含 data；成功码但 data 为 null、缺少 access/refresh token 或 user 时失败关闭，数字/字符串 5xx 业务码继续映射服务不可用。登录/注册成功后，Provider 回归确认先保存 access/refresh token、当前 User 与账号级用户缓存，再公开已登录身份，并启动带账号 epoch 保护的登录定位；原始用户名、密码、可选昵称和 `device_token` 请求字段未改变。
- 自动证据：认证相关定向回归 **10 suites / 46 tests** 全通过；登录/注册同一渲染帧双触发仍只发一次请求，注册昵称原值不裁剪，空白背景收键盘、清除/密码显隐 Button 角色与成功持久化均有真实组件/Provider 测试。测试中的 React 19 异步 `act` 噪声也已通过正确等待 RNTL v14 的异步 API 消除；定向 ESLint 与 strict TypeScript 通过。
- 当前视觉证据没有重复生成：Login 仍为 ≤3 **98.8222% PASS**，Register 为 ≤3 **98.3298% PASS**；每页继续只保留 native、Expo、diff、metrics 四件最新正式证据，dark/最大字号临时截图已删除，源码、原始数字图片和正式证据未删除。此前隔离的损坏旧 node_modules 副本已通过 macOS 废纸篓 API 精确移出项目；当前 `expo-app/node_modules` 未触碰。
- 正式状态：这轮完成的是 Auth 源码/自动化子项，不把它冒充整页完成。Login 仍缺当前源码的完整聚焦/错误/加载/成功设备矩阵、十语言逐页与 VoiceOver；Register 还缺真实 `/auth/register` 成功创建、token/session 持久化和同类完整设备矩阵。两页保持 `🟡`，整体正式完成页仍为 **1/47（2.13%）**。

## 2026-08-08：验收口径调整为视觉 95–98%、功能/后端 100% 一一对应

- 前端门禁：静态 UI 默认采用 ≤3 色阶像素比例 ≥95%；MapKit、系统玻璃等动态系统表面可采用 ≤8 色阶比例 ≥95%，同时必须人工确认组件、布局和主要样式无明显缺失。exact ratio 只作为诊断指标，不再要求零差异。
- 功能门禁：原 Swift 的页面状态、交互、导航、错误/空/加载态、动效、缓存/恢复、权限、后台行为，以及每个后端接口的路径、方法、请求字段、响应兼容、鉴权和错误映射必须逐项一一对应；视觉通过不得覆盖这些缺口。
- 资产与证据：原始数字图片继续保持 byte-for-byte 和 SHA-256 校验；每轮仍只保留最新两张配对图、`metrics.json` 和一张差分图，清理上一轮垃圾证据。当前正式完成页仍为 **0/47**，需按新口径逐页重新验收功能/后端后才能增加。

## 2026-08-08：Login/Register 十语言、输入判定与 Auth 后端请求契约补齐（Login 真实主链通过，页面仍待完整终验）

- 原版差距：Expo 登录/注册此前把中文标题、占位、按钮、清除/显隐/键盘完成辅助标签及错误兜底写死；还会裁剪用户名/昵称，并允许纯空格密码通过启用条件。Swift `AuthViewModel` 使用 `L10n`，只用 `isBlank` 判断空白但保留非空原始输入，并按 401/四类服务端 code 映射无效凭据。
- 本轮实现：Login/Register 所有可见文案和辅助标签已接入原版 10 语言 catalog；登录/注册 enablement、3/6 位验证顺序、确认密码空白语义、invalid-credentials/普通 API/非 API 错误映射均抽成共享策略。`/auth/login` 与 `/auth/register` 继续发送原始用户名、密码和非空昵称，保留可选 `device_token`，全空白昵称省略，不再私自 trim 改写后端输入。
- 设备运行证据：清除视觉 fixture 后在现有 Expo `iPhone 17 Pro Max / iOS 26.4` Development Build 实际触发 Login 用户名/密码聚焦、peek/coverEyes 猫态、清空、密码显隐、按钮启用/禁用和 Register 跳转；Register 实际触发四字段、3/6 位提示、密码不一致提示、匹配后按钮启用及返回登录。全程没有点击注册，不在后端创建测试垃圾账号；本轮只保留可访问性树结论，临时截图在记录完成后删除。
- 真实 Auth 主链证据：使用用户提供的既有内部测试账号调用真实 `/auth/login`，正确凭据成功进入真实会话列表；首次登录完成系统通知授权但拒绝系统保存密码。随后终止并冷启动 Development Build，SecureStore 会话直接恢复到已登录态；从设置执行退出并确认后会话被清除并返回 Login；错误密码由真实后端响应映射为原版本地化“用户不存在或密码错误”；再次输入正确凭据可重新登录。测试密码没有写入源码、测试、文档或证据文件。
- 运行基础设施纠错：Metro 曾因依赖目录中约 980 个异常冲突副本卡在扫描；异常 `node_modules` 已从项目根移出并按锁文件重建。随后发现初版 blockList 把依赖包内部合法的 `dist/` 误排除，现已收窄到项目根目录的 `artifacts`、原生 build、`dist-*` 和 `.expo`，专项测试明确证明 `node_modules/*/dist` 不会被屏蔽；无 fixture iOS Bundle 最终 **3611 modules / Bundled**。
- 验证证据：Auth/视觉门禁定向测试通过；最新完整 `pnpm validate` 通过原始资产 **51/51**、本地化 **10×1,138**、ESLint、strict TypeScript、**108/108 suites、553/553 tests**、EAS 发布策略、确定性 iOS/Android fingerprint 与 Expo public config。
- 视觉结论：Login 现有同机静态证据在新静态门禁下为 ≤3 **98.8222%**，样式达到 95–98% 标准；Register 静态证据 ≤3 **97.5417%** 也达标。真实 Login 成功、错误凭据、token/session 冷启动恢复、退出清除和再次登录已通过，但加载/瞬态网络失败、完整猫动效逐帧、十语言逐页、VoiceOver、动态字体/暗色以及真实 `/auth/register` 成功与 token 持久化仍未终验，因此两页保持 `🟡`；MapDating 在本节之后正式通过，当前总数为 **1/47**。

## 2026-08-08：Login/Register 整框聚焦、提交互斥与普通退出缓存语义补齐（页面仍待终验）

- 源码对照发现并修复三类真实差异：原 Swift 在整个 `AuthFieldChrome` 上设置 `contentShape` 与点击聚焦，Expo 旧实现只有直接点进 TextInput 才聚焦；Swift 在异步请求前同步设置 `isLoading`，Expo 旧实现可能在 React 重渲染前收到第二次提交；Swift 认证页使用显式 point 字号，Expo 旧实现会跟随系统字体缩放改变布局。当前 Login/Register 四类输入框均可从图标、内边距或空白区域聚焦；登录和注册共用同步 submission lock，请求 `finally` 后才释放；认证标题、输入、按钮、提示、页脚和键盘完成按钮均锁定原版固定字号。
- 辅助功能同步补齐：主按钮提供原文案 accessibility label，并公开 busy/disabled state；错误与校验提示使用 polite live region；原版可见的清除、密码显隐、完成和跳转语义继续保留。样式修复没有更改 `/auth/login`、`/auth/register` 的字段、原始值、可选昵称或 `device_token` 契约。
- 会话/缓存纠错：源码核对确认 `AuthManager.logout()` 的普通退出只删除 token 和当前用户快照，明确保留账号级离线缓存；Expo 旧代码却额外清空全部用户信息缓存。现已移除普通退出的全局缓存清理，显式“清除当前账号/全部缓存”入口仍负责删除业务数据，和原版职责重新一致。
- 自动证据：新增 submission lock 边界测试，并新增 Login/Register 真实组件级同渲染帧连续两次提交测试，分别确认后端只调用一次、请求结束后释放，以及注册昵称原值不被裁剪。认证相关定向回归 6 suites / 21 tests 与新增组件测试 2/2 通过；第一次全仓运行如实因地图源码测试依赖同一行格式而失败，修正为仍严格匹配调用但允许 Prettier 换行后，第二次完整 `pnpm validate` 通过原图 **51/51**、本地化 **10×1,138**、ESLint、strict TypeScript、**110/110 suites、560/560 tests**、EAS 发布策略、iOS/Android fingerprint 与 Expo public config。
- 当前静态视觉证据：增加仅由 `__DEV__ + EXPO_PUBLIC_VISUAL_ACCEPTANCE` 守卫的 auth-login/auth-register 路由，绕过持久会话而不删除测试账号 token；现有唯一 Expo 模拟器以原版对应的 1320×2868、语言、外观、时间和状态栏重拍。Login exact **79.6994%**、≤3 **98.8222%**、≤8 **99.4558%**、MAE **0.3305**；Register exact **71.1475%**、≤3 **98.3298%**、≤8 **99.3200%**、MAE **0.4726**，两页静态态均 PASS。每页只在 `artifacts/acceptance/auth-current/{login,register}/` 保留 native、Expo、diff、metrics 四个文件；验证 SHA-256 后删除旧静态/聚焦/语言/失败迭代共 **101** 个文件和全部 `/tmp` 对比产物，`artifacts/acceptance` 降至约 **12MB**。删除物是已被新证据取代的未跟踪生成物，源码、测试、原始数字图片、文档和当前证据均未删除。
- 隔离与状态：原工程仍在 `codex/hot` 且 tracked/staged diff 为零；桌面副本同在 `codex/hot`，两份保留的原生 `BWChat` 目录 `diff -qr` 完全一致。测试账号凭据没有写入源码、测试、文档或证据。当前静态态已复验，但新交互补丁尚未完成真实边缘/图标触摸、聚焦/错误/加载/成功态、最大字体、暗色和 VoiceOver 同轮设备矩阵；真实 `/auth/register` 成功/token 持久化也未执行。Login/Register 继续为 `🟡`，正式完成总数仍为 **1/47（2.13%）**；本节不是完成汇报。

## 2026-08-08：Auth 深色/最大字号实机纠错与并行域阶段记录（页面仍待终验）

- Login/Register 深色系统外观实机复验发现根级 `<StatusBar style="auto" />` 会在认证白底上产生白色状态栏图标；两个认证路由现各自显式使用 dark 状态栏，并增加源码门禁。干净重启 auth-login fixture 后，Login 的 9:41、信号、Wi-Fi 与电量图标均恢复黑色，白色背景完整覆盖安全区；Register 也以同一 dark + accessibility-extra-extra-extra-large 矩阵通过。固定 point 字号使标题、猫图、输入卡、按钮和页脚没有随最大系统字号断裂。复验后已恢复 light/large，停止认证 fixture，启动无 fixture Metro，并确认测试账号 SecureStore 会话重新进入真实消息列表。
- 本轮认证定向回归 4 suites / 11 tests、strict TypeScript 和定向 ESLint 均通过。所有 dark/max 与标准会话临时截图已按精确文件名删除，只保留既有 `auth-current/{login,register}` 四件静态证据；没有删除源码、原始数字图片或正式证据。真实注册成功/token 持久化、完整字段聚焦/键盘/错误/加载/成功态和 VoiceOver 仍未结束，因此 Login/Register 保持 `🟡`。
- 用户授权三个 subagent 对 ActivityCenter、PropBag/ActivityCatFood、LiveLobby 分域负责到完整闭环，并要求统一只在运行时使用测试账号、禁止持久化凭据。当前阶段回报：ActivityCenter 7/7 子功能已具备成功/失败/幂等或 single-flight 自动门，本域 **50%**；PropBag/ActivityCatFood 已完成数据状态门、分页、18 PNG 字节一致、十语言静态门和 Wallet fail-close 复验，本域 **70%**；LiveLobby 已完成阶段机、事件游标、计费/体验卡、持久心跳及共享事件关联/业务码自动门，本域约 **42%**。LiveLobby 实际引用的猫粮与 5/10/15 分钟体验卡 4 张 native-original 位图已逐文件 SHA-256 与原工程一致，作为不依赖运行态的资产子项正式记为 **1/13（7.7%）**；其余阶段百分比只表示准备度，不代表页面完成。三个域正式完成页面数目前均为 0，整体页面仍为 **1/47（2.13%）**。
- 用户随后把模拟器规则调整为按 subagent 独立配额：ActivityCenter、PropBag/ActivityCatFood、LiveLobby 每域固定最多两台（一台原版、一台 Expo），禁止第三台、禁止反复新建，也不得操作其他域的设备。三个域分别使用 8083/8084/8085 Metro 端口避免串包，并在不用时关闭各自闲置实例；主线程继续处理共享层、Auth、全量回归和进度记录，不因 subagent 运行而停止。

## 2026-08-08：MapDating 正式完成（功能/后端一一对应，视觉 PASS，1/47）

- 真实缺陷与根因：iOS Simulator 的 `locationd` 已持续产生东京模拟坐标 `35.681236, 139.767125`、5m 精度，但地图一直停留在服务端旧金山位置。源码核对确认 Expo `LocationObjectCoords` 的水平精度字段为 `accuracy`，迁移代码却只读取原生形状的 `horizontalAccuracy`，导致所有真实 Expo 定位都被 100m/30s 质量门禁拒绝；原测试也只构造了错误的原生形状，因此没有抓到该缺陷。
- 修复与合同：`MapDeviceLocation` 现在兼容真实 Expo `accuracy` 和既有原生形状 `horizontalAccuracy`，质量门禁、同批最佳精度排序及 `accuracy_m` 请求体统一经过同一精度归一化函数；测试默认改用真实 Expo 返回结构，并另保留原生形状兼容用例。没有改变经纬度、`source`、`event_id`、`recorded_at` 或 `/map/me/location` 的后端契约。
- 设备与真实后端证据：修复热刷新后地图立即从旧金山切到东京；撤销定位权限、清除模拟位置并冷启动后，地图仍从真实 `/map/me` 回到东京且显示本人原头像，独立证明此前 `map_visit` 已保存到后端。随后在授权态切到大阪，真实定位再次移动地图，`PUT /map/me/location` 的 `map_visit` 成功返回；真实 `/map/users` 成功返回 **3** 名用户，且 **3/3** 都有可绘制坐标，上传后再次刷新成功。把相机临时拟合到这批真实远端用户后，3 个头像 marker 均在原生地图无障碍树中成为可点击按钮；实际点击其中一个后成功进入对应真实用户资料页并加载昵称、关系、资料、推荐和动态内容，证明 marker ID → `/user-profile?id=...` 导航主链。验收结束后已把模拟器和测试账号地图位置恢复到统一东京坐标。
- 前后台设备证据：保持唯一一台 Expo 模拟器，把地图应用切到非活动态后把模拟位置从东京改到大阪，再以同一 PID 回到前台；地图重新定位到大阪并显示本人原头像。随后在活动态把位置恢复东京，10m watcher 再次把地图和头像恢复东京，证明 AppState 恢复、watcher 重建/继续和本地视口刷新链可运行；测试账号最终位置仍恢复为东京。
- 安全与清理：测试账户密码、token、用户身份和用户坐标均未写入源码、测试、文档或证据；临时运行探针只输出 presence 开关、用户总数/可绘制数量及请求成功，不输出 PII，得到结论后立即从代码删除。用于把真实 marker 暂时移入视口的拟合代码也在点击验收后立即删除，并通过冷启动确认恢复原版的本人 50m 视口。前后台验收的两张临时截图在人工确认后删除。Auth 临时截图与一份约 997MB 的失败依赖副本已删除；另一份已确认损坏的依赖垃圾副本正在按精确路径清理，当前源码、依赖、原始图片资产和正式验收证据均未触碰。
- 自动边界：新增真实 Expo permission/watch mock 验证既有授权不重复询问、denied 且不可再询问时不弹窗、notDetermined 只请求一次、无效精度被过滤、首个有效位置即收敛并移除 watch、5 秒无有效位置超时返回、系统定位失败向页面转发。100m 或 60 秒前台上报条件已抽为真实运行代码共用策略，并验证 99.999m/59.999s 不上传、100.001m 或 60s 上传、首次和定时 force 上传。
- enabled/foreground 真实后端证据：补齐原 Swift 已有的 `PUT /map/me/settings` 和 `POST /map/me/disable`，字段只发送 `visibility_scope`、`online_status`、`status_text` 中实际提供者，并保留 Swift 的“成功空响应后 GET `/map/me`”回读。设备验收把测试账号临时设为 `everyone + online`，真实 `map_visit` 成功后把位置从大阪跨 100m 以上切回东京，真实 `foreground_update` 成功保存；随后自动 disable，真实响应确认恢复 `enabled=false / visibility_scope=off`。临时设置/日志/定时代码已删除，永久代码只保留原版后端合同。
- 系统状态与无障碍：在同一台 Expo 模拟器以暗色外观和 `accessibility-extra-extra-extra-large` 最大内容尺寸实际运行，原生 MapKit、本人原头像、在线点、系统标签栏和版权信息均正常显示且无布局断裂，随后恢复 light/large；运行时无障碍树已确认地图、本人位置、三个真实远端 marker 按钮、法律信息及标签栏语义，marker 点击可进入对应资料页。
- 正式完成判定：地图动态视觉证据为 exact **82.3837%**、≤3 **93.1626%**、≤8 **95.1897%**、MAE **1.1070**，达到 MapKit 动态门禁并经人工确认；功能/后端覆盖 `/map/me`、`/map/users`、`/map/me/location` 三种 source、settings/disable、权限/超时/失败、坐标质量、相机、头像、marker、资料导航和前后台生命周期。最新完整 `pnpm validate` 通过原始资产 **51/51**、本地化 **10×1,138**、ESLint、strict TypeScript、**109/109 suites、557/557 tests**、EAS 发布策略、确定性指纹与 Expo public config。因此 `MapDatingView` 正式记为 `✅`，整体完成页从 **0/47** 提升到 **1/47**。
- 整体目标进度：页面 **1/47（2.13%）**；实现/验收阶段进入其余 46 页，下一优先项仍是 Login/Register 完整状态矩阵。EAS 阶段仍因本机未登录、未绑定真实 Project ID 而停在本地发布门禁通过；Preview、Production OTA、10% 灰度、扩大/撤销和回滚均未执行。

## 2026-08-07：MapDating 固定双机同轮复拍与安全区实验回退（视觉 PASS，功能/后端未终验，0/47）

- 模拟器规则：按用户最新要求，快速对比时固定最多保留两台同型号、同系统模拟器，一台只运行原版，一台只运行 Expo；每轮先检查已启动列表，关闭无关实例，不再无限创建新模拟器。当前固定为 `iPhone 17 Pro Max / iOS 26.4.1`，原版 UDID `9988D2D6-A6A5-45AA-BAB9-5EED9B9FC776`，Expo UDID `4CDB4BB3-F3A0-452E-8043-EC68EF7C1E4C`，两端都锁定 9:41、满电、相同语言、状态和测试数据。
- 安全区实验及回退：桥接层曾把原版实测的 `{top:62,bottom:83}` 安全区精确注入 Expo host；虽然内部 safe-area/tab/署名几何一致，但 MapKit 可视 region/span 随之漂移。v17/v18 的整屏 exact 仅 **20.0851% / 20.1525%**，约 **302 万**像素不同，因此没有保留。当前回退为地图 host 全屏、`MKMapView.layoutMargins.bottom=83`、原版 logical/display region 与垂直相机偏移公式；只把视觉改善计入进度，不虚报内部安全区结构一致。
- 同轮双机硬证据：原版 `artifacts/acceptance/map-current/native-map-live-two-device-v1.png` 与 Expo v19 `artifacts/acceptance/map-current/native-bridge-expo-map-live-v19.png` 为相同 `1320×2868` 画布；exact **82.3837%**、≤3 **93.1626%**、≤8 **95.1897%**、MAE **1.1070**、RMSE **6.5364**。按用户新的动态系统表面门禁，`metrics.json` 现以 tolerance 8 / minimum 95% 判定视觉 **PASS**；exact 与不同像素数只保留为诊断信息。
- 肉眼一致性复核：两台设备均为 `iPhone 17 Pro Max / iOS 26.4`，不是模拟器尺寸不一致。底部标签栏区域 ≤3/≤8 色阶一致率为 **97.2758% / 99.7898%**、平均每通道误差仅 **0.2417**；地图主体 ≤3 为 **92.7784%**。对地图主体执行 ±18px 整数平移搜索后，`0px/0px` 仍是显著最优解，排除了整体截图错位；剩余边缘主要是同坐标下的 MapKit 动态内容和采样差异，现不再作为视觉阻塞。
- 证据清理：按用户新增的“单版本保留”规则，在确认上述四个最新文件存在并逐个记录 SHA-256 后，删除 MapDating v1–v18 重复截图、旧 diff、回退实验和两套临时 DerivedData，共 **93 个旧条目**；`map-current` 从约 **6.8GB** 降至 **5.0MB**，整个 `artifacts` 现为 **77MB**。当前只保留两张配对原图、`metrics.json` 和 `diff-8x.png`；源码、原始图片资产、审计和进度文档均未删除。
- 自动化与构建证据：MapDating 定向契约 **6/6**、strict TypeScript 和最新 iOS Simulator Xcode 构建均通过，构建结果为 `BUILD SUCCEEDED`；最新全仓为 **107/107 suites、544/544 tests**。这些证明本轮代码契约和视觉门禁，但不能替代真实 `/map/me`、`/map/users`、定位权限/超时、前后台上报、头像下载、marker 点击及资料导航验收；原版仓库 tracked 文件仍为零改动。
- 整体目标进度：MapDating 视觉已按新标准 PASS，但功能/后端尚未终验，所以正式完成页仍为 **0/47**；EAS 仍未登录/绑定真实项目，Preview、Production OTA、10% 灰度、扩大/回滚均未完成。以后每正式完成一个功能复刻，必须按 `migration-status.md` 的规则立即汇报该项证据、完成页进度、实现阶段、EAS 阶段和剩余阻塞。

## 2026-08-07：MapDating 地图署名避让底部标签栏（子项完成，页面仍 FAIL）

- 根因与实现：原版 `MKAttributionLabel` 位于底部标签栏上方，旧 Expo 桥接则把 MapKit 署名留在屏幕底部并被标签栏覆盖；偏差恰好是当前设备 `UITabBar` 的 83pt 高度。桥接层现从同一 window 读取可见 `UITabBar.bounds.height`，写入 `MKMapView.layoutMargins.bottom` 并触发布局，不再依赖未被原生 view config 接收的 JS 数字 prop，因此也会随设备标签栏高度自适应。
- 运行时硬证据：在唯一启动的 `iPhone 17 Pro Max / iOS 26.4.1` 验收机中，LLDB 读取到地图 frame 为 `(0,0,440,956)`、`UITabBar` 为 `(0,873,440,83)`、Expo `MKAttributionLabel.y=852.260`、`MKAppleLogoLabel.y=836.906`；两个署名坐标与原版目标完全一致。截图保存于 `artifacts/acceptance/map-current/native-bridge-expo-map-v13.png`。
- 自动与构建证据：MapDating 契约测试 **6/6**、strict TypeScript、完整 iOS Simulator Xcode 编译均通过，构建日志明确为 `BUILD SUCCEEDED`。验收前已检查模拟器，只保留当前使用的一台；后续切换原版/Expo 也必须先关闭上一台和其他闲置模拟器。
- 页面仍未通过：原版 fresh v3 与 Expo v13 的整屏严格差分为 exact **82.1434%**、≤1 **89.6535%**、≤3 **92.9159%**、≤8 **94.9416%**、MAE **1.2113**、RMSE **7.3615**，仍有 **676,007** 像素不同，`artifacts/acceptance/map-current/v13-vs-native-fresh-v3/metrics.json` 明确为 `FAIL`。差异图主要落在 MapKit 实时道路/POI/瓦片文字和依赖底图采样的系统玻璃材质；头像 marker、相机与 tab/署名几何仍需继续分层验收，因此总页数保持 **0/47**。

## 2026-08-07：按用户要求删除飞机功能（不计入迁移缺口）

- 范围决定：用户明确要求不再迁移飞机功能。Expo 活跃代码中的飞机接口、鉴权/轮询、路线、marker、信息气泡、远端开关、专用验收变体、fixture、测试及静态资源引用均已删除；后续不会把飞机功能列入 MapDating 的完成条件。
- 资产边界（最终规则）：原版 Swift 项目和桌面事实源副本保持逐字节不动；Expo 产品资产归档中的六个 `flight_plane_*.imageset` 此前虽未被运行代码引用，但现已按用户“飞机全部删除”的明确要求从新 Expo 副本移入 macOS 废纸篓，可恢复。其余 **45 个在范围数字媒体文件**继续与原版逐字节校验，当前聚合 SHA-256 为 `7d5a25be…d6c6b`；验证脚本同时强制 Expo 资产目录不得再出现 `flight_plane_` 条目。
- 验收口径：删除飞机功能不会让 MapDating 自动通过。底图、地图版权语言、marker、视口、定位、头像、资料导航和多状态截图仍需逐项验收；当前仍是 **0/47**。

## 2026-08-07：撤回 MapDating 完成结论并执行同设备截图验收（FAIL，0/47）

- 纠错结论：此前把“源码实现和自动化通过”误报成“完成”，但当时没有逐页像素验收，因此该完成结论无效并已撤回。当前唯一有效口径仍是 **0/47 页通过**；自动化结果只证明代码回归，不代表页面验收。
- 同设备证据：在同一台 `iPhone 17 Pro Max / iOS 26.4.1` 模拟器（`1320×2868`、9:41、100% 电量、相同东京站坐标）轮换安装原版与 Expo，重新稳定捕获 MapDating。原版 SHA-256 为 `02518521…9398`，Expo 为 `d15b805c…5299`；差分为 exact **73.4371%**、≤1 **79.7696%**、≤3 **83.9397%**、≤8 **88.1569%**、MAE **4.5949**、RMSE **19.4404**，仍有 **1,005,606** 个不同像素，`metrics.json` 明确为 `FAIL`。
- 已确认差异：系统原生 `NativeTabs` 和 22pt iOS 地图相机下边距已使相机几何与底部 Tab Bar 大幅靠近原版，但 MapKit 矢量标签/POI 选择、版权语言（原版 `地图 法律信息`，Expo `Maps Legal`）、SwiftUI continuous-corner marker 描边/阴影仍不同。给两端追加相同 `AppleLanguages=zh-Hans` 启动参数后，Expo 版权仍未切为中文，证明不是单纯截图启动语言偶发差异；`react-native-maps` iOS props 也没有 locale 接口，需继续评估原生 SwiftUI Map 桥接或等价原生实现。
- 证据目录：`artifacts/acceptance/map-current/recapture-v3-diff/` 保留原版、Expo、8×差分、50% 叠图、变化 mask 与指标 JSON；原始配对图位于同级 `native-map-recapture-v2.png` 和 `expo-map-recapture-v3.png`。
- 自动化与像素验收分离：补齐验收构建产物的 ESLint 全局忽略后，最新 `pnpm validate` 重新通过原图 **51/51**、本地化 **10×1,138**、ESLint、strict TypeScript、**104/104 suites、538/538 tests**、EAS 发布策略、iOS/Android fingerprint 与 Expo public config。这一结果不会覆盖上面的截图 FAIL。
- 仍未完成：飞机功能已按用户要求从迁移范围删除；底图 locale、marker 栅格、真实定位/头像/资料导航、暗色/动态字体/VoiceOver 和其余 46 页截图矩阵均未通过；真实 EAS Preview/Production OTA、10% 灰度、扩大/回滚也因未登录/未绑定项目而未执行。

## 2026-08-07：MapDatingView presence、公开用户、头像 marker、视口与前台定位链源码级补齐（未通过地图终验）

- 纠错结论：此前 Expo 地图只显示系统当前位置 pin，而当前 Swift 主页面实际会先读取 `/map/me`、再加载无需定位权限的 `/map/users`，解析当前 presence 与公开用户坐标，绘制当前/远端头像 marker，并按当前位置或用户集合调整视口；这一真实差距现已补到 Expo 源码。Swift ViewModel/API 中还有好友、设置、关闭、屏蔽、举报等接口，但当前 `MapDatingView` 主体没有展示对应控件，因此本轮没有把这些休眠接口虚报成已还原页面功能。
- 协议与数据链：新增 MapDating repository，兼容直包/包装响应、snake/camel 与嵌套坐标别名，拒绝非有限值和 `(0,0)`，排除当前用户、保持首次顺序去重，并在重复项后到有效坐标时替换无坐标版本；公开用户请求只携带可选经纬度，不私自加入 radius/relation/limit。presence 优先、设备位置回退，当前位置严格使用 50m region，无当前位置时对用户坐标做 1.35 倍拟合，跨日期线跨度超过 180° 时回退全球视口。
- 页面与生命周期：当前用户 marker 为 46pt、4pt 白边、12pt 绿色在线点，远端 marker 为 40pt、3pt 白边、10pt 在线点，点击远端用户进入资料页；保留东京站默认 region 与原版圆形加载浮层。每次页面访问只生成一个稳定 event ID，5 秒新鲜定位用于 `map_visit`，10m watcher 驱动定位，100m/60 秒阈值用于 `foreground_update`，另有 60 秒定时上报；进入后台停止 watcher，回前台恢复并刷新公开用户，缺少用户坐标会显示十语言错误提示。
- 自动证据：MapDating 定向为 **3 suites / 26 tests**；最新完整 `pnpm validate` 通过原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**104/104 suites、538/538 tests**、EAS 发布策略、确定性 iOS/Android fingerprint 与 Expo public config。
- 仍未完成：feature flag 航线/飞机层、轮询 TTL 与 mock 尚未实现；真实后端、定位权限/精度/超时、前后台运行、头像下载、marker 点击/资料导航均未在设备验收；React Native Map 与 MapKit 的地图瓦片、视口、marker 栅格、导航 chrome、十语言、暗色、动态字体、VoiceOver以及原生/Expo/diff 截图完全未通过。因此本轮只是“功能实现 + 自动化验收”，MapDating 仍为 `🟡`，像素级页面总数仍是 **0/47**。

## 2026-08-07：Login 最新源码稳定态复拍与输入面板源码校准（Login 仍 FAIL，0/47）

- Login 验收结论：先作废冷启动动画未结束、标题未稳定的错误配对图；随后在两台同型号 iPhone 17 Pro Max / iOS 26.4 模拟器固定 9:41、满信号、Wi-Fi、100% 电量，分别运行原版与 Expo 最新源码并等待稳定后配对。标题/副标题区域已经逐像素一致；按 SwiftUI overlay stroke 拆出卡片/输入框独立视觉层并向外扩展 1 个物理像素，同时校准用户名 SF Symbol、15pt SwiftUI eye 的 Expo 光学尺寸、禁用按钮合成色和底部注册文案后，当前保留结果为 exact **79.6994%**、≤1 **93.5237%**、≤3 **98.8222%**、≤8 **99.4558%**、MAE **0.3305**、RMSE **1.4303**。因为仍有 **768,531** 个像素不完全相同，`metrics.json` 明确为 `FAIL`，Login 和全局仍为 **0/47**。
- 历史迭代清理：本节记录的单次采样、2/3pt 描边、overlay、mask 及其他旧 Login 迭代后来均已被当前源码证据取代；按“一轮只保留四件证据”规则，它们已于 2026-08-08 删除，当前只保留 `artifacts/acceptance/auth-current/login/` 的 native、Expo、diff、metrics。历史数值保留用于解释回滚决策，但旧文件不再占用工作区。
- Composer 源码契约：逐行复核 `StickerViews.swift`、`ChatView.swift`、`GroupChatView.swift` 后，私聊和群聊的键盘/表情/加号切换键已统一为 42×54pt、28pt regular、选中 trait、选择触觉且无按压缩放；输入栏按原白色 0.82→0.96 渐变与贴纸态 secondarySystem 背景做 250ms 交叉切换；面板按 250ms easeInOut 裁切到 emoji 250pt 或 plus 高度。plus 面板严格为 4 列、12pt 列距、76pt 单元、18pt 行距、16pt 上下距，1 项自聊为 108pt、6 项普通私聊/群聊为 202pt；自聊只显示相册，其余显示相册/礼物/红包/转账/语音/视频，placeholder、相册和辅助标签改用十语言 key。这里仍是源码/自动化完成，不是聊天页截图终验。
- 自动证据：Composer 新增 **1 suite / 6 tests**；Auth overlay/光学参数源码断言同步升级。最新完整 `pnpm validate` 通过原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**103/103 suites、532/532 tests**、EAS 发布策略、确定性 iOS/Android fingerprint 与 Expo public config。
- 仍未完成：Login 用户名聚焦、密码聚焦、错误、加载、注册转场和三种猫弹簧逐帧尚未按当前源码全部重拍；十语言、动态字体、暗色、VoiceOver 及真实服务端错误码也未完成。私聊/群聊 Composer 仍缺同机键盘、emoji、贴纸、plus、自聊 gating、触觉和转场逐帧差分，所以没有任何页面新增为通过。

## 2026-08-07：VideoThumbnailView 发送回执缓存链纠错（未通过真机/截图终验）

- 纠错结论：逐行复核 `VideoThumbnailView.swift` 和两条视频发送链后发现，Expo 虽已生成并上传本地 JPEG 首帧，但服务端确认消息替换乐观消息时只把视频文件迁入远端 URL 的媒体缓存，没有像原版那样把已生成缩略图同步迁入确认后的缩略图缓存键；第一帧可能被无谓重新下载。现在确认函数接收完整消息回执，并同时采用视频文件与缩略图文件。
- 路径契约：共享 `chatVideoThumbnailPath` 与原版 `deletingPathExtension()` 对齐，`/media/movie.mov?version=2` 精确推导为 `/media/movie_thumb.jpg`，不会错误保留查询串；服务端有 `thumbnail_url` 时优先使用，否则采用推导路径，并同时登记原始相对键与基于 API 地址解析的绝对键。私聊和群聊继续共用同一链路。
- 组件契约：消息缩略图保留原版时间 0、最大 600×600 异步首帧、请求变化/卸载取消、无图片转场、失败 video.fill 占位、44pt/42% 黑底播放圆、17pt bold 图标和 0.5pt 边框；发送端仍是最大 480px、JPEG 0.62，并在上传回执后把该文件原位采用到图片缓存，不另做重复网络请求。
- 自动证据：新增 `VideoThumbnailView` 源码契约 **1 suite / 4 tests**，相关缩略图/发送/缓存定向为 **4 suites / 20 tests**。第一次完整验收诚实抓到 1 条旧源码断言仍要求 `response.content`，结果为 **101/102 suites、525/526 tests**；将断言升级为完整回执且明确检查视频与缩略图双缓存后，第二次 `pnpm validate` 通过原图 **51/51**、本地化 **10×1,138**、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**102/102 suites、526/526 tests**、EAS 发布策略、确定性 iOS/Android fingerprint 与 Expo public config。
- 仍未完成：原生的图片缓存内存/磁盘预算由共享 `ImageCacheService` 承担，但本轮未在真实视频上验证生成取消竞态、损坏视频、HEVC/HDR、旋转 metadata、断网恢复、服务端缩略图 404、清缓存并发和滚动复用；Agent、朋友圈、短剧等其他视频表面也未全部统一到该组件。原生/Expo/diff 截图和滚动性能证据缺失，所以状态仍为 `🟡`，页面总数仍为 **0/47**。

## 2026-08-07：ToastView 顶部/居中及通话根错误链源码级补齐（未通过动画终验）

- 纠错结论：旧共享 `TopToast` 已有 15pt、20×10pt、75% 黑底、20pt 圆角和点击穿透，但只从 `-8pt` 进入，并在 `duration-200ms` 提前开始退出；Wallet 的原 `CenterToastModifier` 则被画成静态 `top: 45%`，没有 0.94 scale 转场。两处都不符合 Swift 源码，本轮按两个独立 modifier 重做，仍只记组件代码级补齐。
- 顶部与居中契约：TopToast 现在按实测自身高度从顶部移入并淡入，CenterToast 保持真正全屏居中及 `0.94→1` 缩放；两者使用 SwiftUI 默认 easeInOut 对应的 350ms、完整 duration 后才开始退出、message 改变重启而普通父重渲染不重置 timer、不可命中，并有 assertive alert 语义。几何分别为 15pt/20×10/75%/20pt/顶部 8pt 与 15pt semibold/22×12/78%/22pt/横向 40pt。
- 调用链：Wallet 已从两套内联静态提示改为共享 Top/Center；普通 `CallProvider` 的权限、连接、麦克风、摄像头和音频路由错误，以及 `LiveCallProvider` 的邀请/余额/连接错误，均恢复原 `BWChatApp.swift` 两条 4 秒根级顶部 toast，不再用阻断 Alert 或底部 13pt 自定义条代替。全仓当前有 20 个 Expo 消费文件导入共享 TopToast。
- 自动证据：新增 **1 suite / 5 tests**，通话/直播/钱包定向为 **6 suites / 36 tests**。该轮 `pnpm validate` 通过原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**101 suites / 522 tests**、EAS 发布策略、确定性 iOS/Android fingerprint 与 Expo public config；最新全仓结果见上方 VideoThumbnailView 条目。
- 仍未完成：原 Swift 其余 `.toast` 调用面还要逐个映射；普通与直播两条根 toast 同时出现时的嵌套顺序、长文换行/intrinsic size、安全区、easeInOut 曲线、首尾帧、VoiceOver播报和屏幕旋转尚未在同机验证。原生/Expo/diff 及逐帧动画图均缺，因此状态仍为 `🟡`、页面总数仍为 **0/47**。

## 2026-08-07：LoadingView、RootTabTitle 与 SystemSegmentedTabs 源码级还原补齐（页面仍未通过截图终验）

- `LoadingView`：逐行恢复默认 `common.loading` 动态本地化、调用方 message、12pt 间距、caption 12/15pt 次级文字、全宽/全高居中和背景 80% 遮罩。全 Swift 仓库搜索确认这个通用 View 当前没有实际调用点，因此只记录共享组件契约，不把任何页面 loading 态冒充为完成；各页面的自有 spinner 仍需随页面单独审计。
- `RootTabTitle`：新增共享 Expo 组件并替换消息、通讯录、发现、我的四个原生调用面，保留 literal/localizedKey 双来源、随语言变化重取词、22pt semibold、主文字色、单行、0.78 最小缩放、8pt leading inset、28pt 最小高度和 header trait；同时移除 Expo 中硬编码的“消息”“我的”。调用方的 36pt header、2/12pt 外围间距继续留在各页面，不混入共享标题自身。
- `SystemSegmentedTabs`：把游戏中心、活动中心、剧本中心、群列表、朋友圈、短剧列表、直播大厅七个原生调用面统一到 `@expo/ui` SwiftUI segmented Picker，删除群/朋友圈/直播三套手绘近似；保留 17pt、默认 196pt/活动 228pt、regular/medium/semibold/bold 权重、动态标题、选择绑定和每页原 accessibility identifier，朋友圈封面态继续在原生控件后叠 16% 黑色 Capsule 背景。
- 自动证据：三项新增 **3 suites / 11 tests**；segmented 相关页面定向为 **8 suites / 51 tests**。最新 `pnpm validate` 通过原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**100 suites / 517 tests**、EAS 发布策略、确定性 iOS/Android fingerprint 与 Expo public config；Expo Doctor最近一次为 **20/20**。
- 仍未完成：Expo SwiftUI Picker 与原 `UISegmentedControl` 的 intrinsic height、tint/material、字体基线、选中动画、触控和 VoiceOver必须在同系统同机复核；ActivityIndicator 与 ProgressView 的系统栅格/转速也需设备对照。四个根页和七个 segmented 页面仍缺安全区、极端十语言、暗色、动态字体、VoiceOver及原生/Expo/diff 截图，所以共享组件仍是 `🟡`，页面总数仍为 **0/47**。

## 2026-08-07：AvatarView 源码级还原补齐（受影响页面仍未通过截图终验）

- 纠错结论：逐行复核 `AvatarView.swift` 后发现通用 Expo 头像在空 URL 时显示姓名首字母，而原版固定为 `#667EEA→#764BA2` 左上到右下渐变、38% 尺寸/medium 的白色 80% `person.fill`；同源私有头像也没有统一经过 Bearer、adopted/memory-disk cache，网络/解码失败可能留下空白。本轮统一改为原符号、方向、22% 连续圆角、无过渡，并复用 `AuthenticatedImage`，加载、无效 URL和错误都回到同一原版占位图。群聊 1–9 人拼图的每个子头像也改用该共享路径。
- 点击契约：新增共享 `UserAvatarButton`，严格保留 0.45 秒长按、长按不再误触主页、空 user ID 不导航、同头像 0.6 秒防重复 push，以及 `profile.open`/默认十语言辅助标签。它已接入私聊双方、群聊双方（他人头像长按继续 @）、加好友、群详情预览、群成员全页、短剧作者和礼物收礼人；同时纠正 Activity 匹配用户、通话全屏头像和短剧 Action Rail 把原版 22% 圆角误画成圆形/11pt 硬圆角的问题。
- 自动证据：新增 **2 suites / 7 tests**，覆盖原占位符号、鉴权/失败 fallback、trimmed user ID、0.6 秒节流、0.45 秒长按排他、Swift 常量和七类调用面接线。该轮 `pnpm validate` 为 **97 suites / 506 tests**；最新全仓证据见上方 LoadingView/RootTabTitle 条目。
- 仍未完成：真实鉴权头像的 401/token 刷新、损坏图片、超大图、账号切换、离线缓存与清缓存竞态尚未在设备联调；Expo Image 与原 UIImage 的解码/downsample、连续圆角栅格、SF Symbol 抗锯齿、长按与滚动/消息菜单手势优先级、VoiceOver 触摸顺序仍需原生/Expo/diff 逐页复拍。因此这是共享组件代码级补齐，不是任一页面像素级完成，整体仍为 **0/47**。

## 2026-08-07：修正 EAS 指纹与 Production 发布验收门禁（真实云端仍未验收）

- 纠错结论：复核发现旧 `pnpm fingerprint:generate` 实际把 `fingerprint:generate` 当作 Expo 项目目录并报 `Invalid project root`，所以过去不能把这条命令写成已通过证据。本轮改为锁定 `@expo/fingerprint 0.20.6` 的本地工具，分别生成 iOS/Android hash，无需 Expo 登录；同一输入连续两次输出逐字一致。Preview/Production 环境缺 `EAS_PROJECT_ID` 时会失败，避免拿缺少 updates URL/project extra 的 development config 冒充远端 build 指纹。
- 发布门禁：Preview update 明确以 all platform/JSON/non-interactive 发布。Production 不再重新 bundle 当前工作区，而是要求真实 Preview update group UUID 和至少 8 字的 `VERIFIED:` 真机冷启动验收说明；发布前在线读取 group，拒绝非 preview branch、group 不一致、缺 iOS/Android 或 runtimeVersion 的输入，再把同一组已验收二进制资源精确 republish 到 Production channel，并强制 `--rollout-percentage 10`。策略单测覆盖合法参数以及 UUID、验收前缀、branch、双平台四类拒绝路径。
- 未完成且不得声称完成：当前 `eas whoami` 仍为 **Not logged in**，没有真实 Project ID、EAS Environment、Apple/Google 凭据或 Preview group，所以上述成功仅是本地工具/门禁验收，不是 Preview/Production OTA、10% 灰度、扩大/撤销灰度或 rollback 通过。47 页像素级完成数仍为 **0/47**。

## 2026-08-07：Login 行为补验与 Register 静态/用户名同机验收（全部仍 FAIL，0/47）

- 总结论：Login 已补拍密码聚焦并真实验证用户名清除、密码显隐、输入后按钮启用和“完成”收键盘；历史静态/用户名/密码三态 MAE 分别为 **1.1251 / 1.4721 / 1.7067**，均为 `FAIL`。随后共享 AuthChrome 又补入子控件阴影、SF Symbol 光学校准和完成文字位移，因此这三组 Login 图只保留为历史证据，必须从最新源码同机重拍后才能报告新的当前数字，不能把旧数字冒充最新通过结果。
- Register 静态证据：首张原版/Expo 配对图 MAE **15.7491**，Expo 整块内容比 SwiftUI 高约 400px。恢复 `.frame(minHeight:)` 的居中语义和安全区坐标后，再逐项补 10pt 中文标题视觉间距、13pt 注册字段间距、19⅓pt 返回按钮、SwiftUI 父卡片对子控件产生的阴影，以及按 `person.fill/face.smiling/lock.fill/lock.rotation/eye.fill` 分别校准的光学尺寸；最终标题、副标题、四条占位文字、底部登录文字和六个符号边界均对齐，正式 MAE **0.5865**、exact **68.3876%**、≤3 **97.5417%**、≤8 **98.6213%**，仍因非零差分写入 `verdict: FAIL`。
- Register 用户名聚焦证据：发现两台模拟器分别使用 English Japan/US 键盘后，作废跨机对比，改在同一临时 iPhone 17 Pro Max / iOS 26.4 模拟器中轮换安装同 bundle id 的原版与 Expo 构建。编辑态整体 95px 偏差修正后，标题、副标题、四字段占位文字和完成文案边界一致；正式 MAE **0.8369**、exact **67.6117%**、≤3 **94.2206%**、≤8 **98.5315%**，仍为 `FAIL`。Expo 昵称聚焦图也已采集，但切换密码时 macOS 锁屏，昵称原版配对和密码/确认密码矩阵尚未完成。
- 文件与隔离证据：本节旧 Register 静态、用户名聚焦、首次未对齐、overlay 和变化 mask 已在 2026-08-08 被当前源码复拍取代并删除；目前只保留 `artifacts/acceptance/auth-current/register/` 的 native、Expo、diff、metrics。原工程和独立副本原生 tracked/staged diff 均为零，两份 `BWChat` 目录 `diff -qr` 零差异；原工程原先已有的 untracked MentionPicker、artifacts 与 tmp 仍未触碰，副本分支为 `codex/hot`。
- 自动验证：最新 `pnpm validate` 通过原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**95 suites / 499 tests** 和 Expo public config；public config 继续包含 `ios.appleTeamId=A5U93R249R`、APNs entitlement 与 EAS Updates 配置。
- 仍未完成：Register 静态和用户名差分没有清零；昵称、密码、确认密码、输入/清除、双密码显隐、3/6 位与不一致提示、按钮启用、next/go、返回、错误态、三种猫弹簧逐帧、十语言、暗色/动态字体/VoiceOver 仍缺完整原版/Expo/diff 矩阵。Login 也需按最新共享 AuthChrome 重拍全部三态。两页和全局继续是 **0/47**。

## 2026-08-07：Image/Media/User 三类缓存代码级还原（未通过 HLS/后台/真机终验）

- 验收结论：旧共享表把三类 manager 整项标成 `🔴`，并误写为“Range、账号隔离、清理设置未迁”。逐行读取三份 Swift 和 Expo 后确认：设置页与大量业务 AsyncStorage 缓存早已存在，而通用 Range 也不属于这三个 manager；本轮补齐缺失的图片确认接管、账号视频缓存与用户资料缓存，把状态修正为 `🟡`。因为 HLS、系统后台下载、真机磁盘与三图差分没有通过，不能简称缓存完成，整体像素级完成仍是 **0/47**。
- 图片缓存：`AuthenticatedImage`、Avatar 和群成员图显式使用 Expo Image `memory-disk`；同源请求继续只向 API origin 附 Bearer。新增 SHA-256 adopted cache：聊天本地图片上传确认后，先把准备好的文件同时绑定服务端原图/thumbnail 的 raw 与 absolute key，再删除 outbox 和替换消息，因此内存命中时不会因 `file://`→远端 URL 变化闪回 placeholder；冷启动会从持久 index 恢复，全部清理同时删除 adopted、Expo 内存和磁盘缓存。原 Swift 的 200 张/80MB、720/2048 downsample 与 3 路 decode semaphore 没有被虚构为已等价，因为 Expo Image 没有公开相同预算接口。
- 视频缓存：新增账号 SHA-256 目录、账号 index、缺文件自愈、5 秒 delayed task/cancel、同媒体 single-flight、仅 API 同源 Bearer、低于 2GB 不启动、30 天淘汰、可用空间加缓存总量的 15% 预算并限制 512MB–5GB、last-access LRU 和按账号/全部清理。聊天/图库播放器先找本地 URI，再为 MP4 调度缓存；本地视频上传确认后先复制进 `chat-video:<remote>` key 再清 outbox。`.m3u8` 明确跳过而非错误地当普通文件缓存，因为 RN 当前没有等价 `AVAssetDownloadURLSession` 的离线 HLS 包。
- 用户缓存：新增 userID/username/nickname/avatar/updatedAt 的内存＋AsyncStorage 快照、损坏数据恢复、单条/好友/联系人/搜索/关注/公开资料/群消息批量缓存、昵称取 userID 和头像取空串 fallback。登录/verify/refresh/资料更新写入，群聊缺昵称/头像时读取，登出和全部清理删除；账号业务缓存和视频目录仍各自隔离。
- 自动、导出与隔离证据：缓存新增 **3 suites / 13 tests**；连同聊天图片/视频 outbox 定向为 **5 suites / 20 tests**。全仓 `pnpm validate` 通过原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**94 suites / 497 tests** 和 Expo public config。production iOS Hermes export为 **3,440 modules、74 assets、12,389,394-byte HBC、20MB/76 files**，SHA-256 `e50b4f875ead3be40ee5233574d1c73254a139954298a80c37dafc3e4cdfa4d5`。原工程和副本 `BWChat` 目录 `diff -qr` 为零，副本原生 tracked/staged diff 也为零。
- 仍未完成：HLS 离线包、background URLSession 在 App 挂起/杀进程后继续、active download 取消/系统完成回调；Expo Image 的精确内存预算/downsample/decode 并发；朋友圈/短剧/Agent 的所有 adopted/preload key；真实 API/CDN 鉴权、断点/损坏响应、低空间、清理与下载竞态、超大视频、账号瞬切和真机磁盘回收；原版/Expo/diff 截图与滚动/首帧性能。`Range` 仍是 Agent/API 独立缺口。本记录不得简称为“缓存完成”。

## 2026-08-07：AdRewardService 代码级复核与失败重试/午夜刷新补齐（未通过真实 AdMob/SSV）

- 验收结论：共享服务表把 `AdRewardService` 整项标成 `🔴` 已落后于代码；钱包奖励广告、游戏 H5 广告、UMP、进程级互斥、status/session、SSV pending、上海业务日和每日 10 次大部分早已接通。本轮逐段对照 Swift，补齐 SDK 失败重试、上海午夜定时同步、账号隔离本地计数落盘和 403/429 状态，并增加 SDK/存储/源码回归，所以只能修正为 `🟡`。没有真实广告、Google SSV 入账、真机和截图证据，整体像素级完成仍是 **0/47**。
- UMP/SDK 与展示 Gate：保持 UMP `gatherConsent` 成功且 `canRequestAds` 后才初始化 Google Mobile Ads；多个入口共用 single-flight，成功后进程复用。复核发现旧 Expo 把首次拒绝/网络异常得到的 `false` 永久缓存，后续同意或恢复网络也无法再准备，本轮改为失败即释放 flight、只有成功才永久初始化。钱包和游戏继续共用进程级 owner Gate，重复点击或跨入口同时展示返回 unavailable；游戏保持 allowlist、2.5 秒加载门及 completed/dismissed/no-fill/load/present 终态。
- 钱包限额与 SSV：status 与 session 精确使用 `/wallet/ad-rewards/status`、`/wallet/ad-rewards/sessions`，session body 保留 platform/ad_unit_id/gold_coin；RewardedAd 绑定当前 owner 与服务端 `ssv_custom_data`。设备兜底按账号隔离、10 次封顶、Asia/Shanghai 日期，首次和跨日会持久写入 0 次；除前台同步外新增上海午夜 timer。earned callback 不在客户端减权威额度，而是保存 remaining-before/reset/expiry pending；只在同业务日服务端 remaining 下降时确认并刷新余额/流水，跨业务日保持 pending，默认 30 分钟过期，最多 6 次每秒轮询。session 403 会禁用入口，429 会立即把剩余次数归零。
- 自动与导出证据：本项新增 **3 suites / 12 tests**，连同 wallet/game/Gate 定向为 **6 suites / 35 tests**；覆盖初始化并发、成功缓存、拒权/异常后重试、10 次封顶/账号隔离/上海午夜落盘、pending store 隔离及 Swift 源码接线。最新全仓为原图 **51/51**、本地化 **10×1,138**、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**91 suites / 484 tests** 和 Expo public config。production iOS Hermes export 为 **3,437 modules、74 assets、12,340,255-byte HBC、20MB/76 files**，SHA-256 `e27405c476e08539806d270255badbd5ef72fa89404f4367d25f3cdf2c674b4f`。
- 仍未完成：RN Google Mobile Ads 只允许在 `createForAdRequest` 时传 SSV options，因此钱包当前必须先建 server session 再加载广告，无法完全复制 Swift“先预载广告、展示前才建 session/绑定 SSV”的顺序；需要真实设备评估 session TTL 与加载失败浪费。真实 UMP 受监管地区/隐私表单、production/test device、fill/no-fill、快速关闭/earned callback、Google SSV 回调签名与后端入账、余额/流水、403/429、多设备每日限额、跨日 pending、前后台 presenter、远程 unit/flag 均未端到端验证；广告页面原生/Expo/diff 截图也未做。本记录不得简称为“奖励广告完成”或“到账完成”。

## 2026-08-07：LoginLocationRecorder 与地图访问定位代码级还原（未通过真机/截图终验）

- 验收结论：旧 Expo 地图会请求一次 Balanced 定位并只在本地放 marker，登录后完全不记录位置，也没有原 Swift 的质量策略或 `/map/me/location` 上报。本轮补齐明确登录/注册与每次地图访问两种 source、质量 Gate、账号竞态保护、自动化和 production export，因此服务从 `🔴` 调整为 `🟡`；地图页完整业务、真机权限/定位、真实后端和三图差分均未完成，像素级完成仍为 **0/47**。
- 质量与权限契约：按 Swift 固定最大年龄 30 秒、水平精度 0…100m、纬度 -90…90、经度 -180…180、拒绝 `(0,0)` sentinel，并用 12 秒超时请求 Highest 位置。已授权直接继续；不可再次请求时静默退出；其他状态请求 when-in-use。位置 watch 只接受合格点并立即移除 subscription，失败/超时返回空，不影响登录或页面存活。
- 登录与地图访问契约：Auth token 和 User 成功持久化后才异步记录；空 ID、不匹配账号或已有记录 flight 均退出，权限前、权限后和定位后连续复核账号，登出一开始即清身份 ref。上传失败只进监控，不回滚认证。地图每次 mount 创建稳定 UUID，取得合格位置后先渲染本地 marker/region，再以 `map_visit` 上传；请求体保留 `latitude/longitude/accuracy_m/source/event_id/recorded_at` 六字段和 PUT `/map/me/location`。
- 自动与导出证据：定位定向 **2 suites / 20 tests**，覆盖 30 秒/100m 边界、未来/过期/负精度/越界/零坐标、批次最佳精度、精确 wire body、空/错账号、拒权、账号中途切换、全局单航班解锁和上传失败不破坏登录，并逐项读取 Swift 断言接线。最新全仓为原图 **51/51**、本地化 **10×1,138**、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**88 suites / 472 tests** 和 Expo public config。production iOS Hermes export 为 **3,436 modules、74 assets、12,337,576-byte HBC、20MB/76 files**，SHA-256 `396810c0d6e6bf77c435778c175f19899e7a28ff0a1924e296a663150ff5d17e`。
- 仍未完成：Expo `watchPositionAsync` 与 CoreLocation 回调批次、最佳点/缓存点选择和系统精度授权需真机对照；notDetermined/denied/restricted、系统定位关闭、12 秒超时、前后台、快速登出/换号及真实 PUT 响应/时间解析没有设备/后端证据。原 MapDating 的 presence、设置/关闭、nearby/friends/all users、100m/60 秒 `foreground_update`、头像 marker/详情/屏蔽/举报、viewport/航线飞机层仍大量缺失；原生、Expo、diff 截图完全未做。本记录不得简称为“定位完成”或“地图完成”。

## 2026-08-07：Push/APNs 第一轮代码级还原（Notification Service Extension 仍未迁）

- 验收结论：旧 Expo 只有通知权限 wrapper，缺少 APNs token 注册、原 payload 正规化、前台抑制和通知点击路由。本轮完成这部分代码、定向测试、全量回归、production iOS prebuild entitlement 检查及 production Hermes export，所以共享服务只能从 `🔴` 调整为 `🟡`。原 Swift 的 Notification Service Extension 原生 target、真实 APNs/后端/双设备、锁屏与点击尚未通过，页面像素级完成仍严格为 **0/47**。
- token 与注册契约：App 启动即安装通知 handler 并尝试取得原生 device token；token 写入独立 AsyncStorage store，使登录/注册可在不加载通知 native module 的情况下携带 `device_token`。登录后请求 alert/badge/sound 权限，按账号＋token 单航班 POST `/push/device-token`，失败按 2/4/8 秒重试；App 回前台和系统 token 轮换时重新确保注册。EAS development/preview/production profile 现分别固定 `APP_ENV`，避免 production 意外生成 development APNs entitlement。
- payload、显示与路由契约：支持 `data/payload/notification_data` 字典或 JSON string 扁平化且顶层优先，兼容 direct/group/sender/message/revision/mention/badge/name/avatar 等 snake/camel 别名，并以会话＋消息生成稳定事件 ID。前台 call 保留声音但不显示、moments 显示＋声音、badge-only 和当前会话静默、其他通知显示＋声音；收到 payload 更新 badge 并触发会话补偿刷新。冷/热点击持久化后按最多 256 个事件 ID 去重，私聊/群聊带 messageId 打开并调用现有缺页定位，朋友圈进入互动通知；call 继续交给 CallProvider。
- 自动、原生配置与导出证据：Push 定向 **2 suites / 12 tests**；最新全仓为原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**86 suites / 452 tests** 和 Expo public config。独立 `/tmp` production prebuild 生成的 `BBchat.entitlements` 实际为 `aps-environment=production` 与 `com.apple.developer.usernotifications.communication=true`，Xcode 工程只有主 App 一个 native target，明确证明 NSE 尚未生成。production iOS Hermes export 为 **3,435 modules、74 assets、12,328,321-byte HBC、20MB/76 files**，SHA-256 `ced3e9d13a1d394e4b2d4e1b1f4bb224a59fada5a568911284c7bac7d5b90510`。
- 仍未完成：原 NSE 的头像/群头像、贴纸/图片/视频 attachment 下载、INSendMessageIntent 通信通知富化、失败/超时降级和资源缓存没有迁入新的 Expo config plugin/native target；群通知设置的防御性前台抑制、原按会话未读 badge store、silent push 后台同步仍不等价。真实 APNs entitlement 还需签名 provisioning、真机 token、后端 token 注册/推送、前后台/锁屏/权限拒绝与变化、通知点击、CallProvider 竞态、重复/乱序和双设备验证；模拟器不能替代远程 APNs 真机验收，原生/Expo/diff 三图也未做。本记录不得简称为“推送完成”。

## 2026-08-07：ReplyPreviewBar 回复、菜单与时间线定位代码级复核（未通过终验）

- 验收结论：共享组件表把 `ReplyPreviewBar.swift` 整项标为 `🔴` 是清单落后于代码。复核确认私聊/群聊早已接入回复条、引用气泡、菜单、撤回、多选、上下文跳转和稳定排序；真实缺口是右下时间线 locator 未实现、高亮在 2 秒后直接消失而非 1.5 秒停留＋0.5 秒淡出。本轮补齐两项并增加 UI/源码接线回归，因此只能修正为 `🟡`；真实后端和原版/Expo/diff 三图没有通过，像素级完成仍是 **0/47**。
- 回复与菜单契约：composer 文字回复恢复 3×36pt accent indicator、12/13pt 两行和 18pt 取消；图片回复恢复 10×6pt 外距、2×44pt indicator、44pt/6pt 圆角缩略图、28pt 取消圆键和 photo 明细。气泡内文字引用保持 2.5pt indicator、8×6pt 内距、11/12pt 文案和最多两行；图片引用保持 75pt indicator、56pt 缩略图。八种菜单动作/图标/资格顺序沿用原策略，长按为 0.45 秒、20pt movement、中触觉；菜单最多四列、58×56pt item、6pt 内距、14×7pt 箭头、8pt 圆角并按 anchor/安全区选择上开或下开。
- 定位器与高亮契约：新增 36pt `systemUltraThinMaterial` capsule，13pt semibold 图标、13pt medium 标题、6pt 间距、有标题 13pt/无标题 11pt 横距、80% 白描边和 0.14/7pt/3pt 阴影。群聊优先级严格为 @我→回复我→N 条新消息→回到最新，私聊为回复我→N 条新消息→回到最新；不在底部收到新消息时去重排队，点击 @/回复逐条跳转，点击新消息/底部清队列并回到底部。引用和搜索上下文跳转继续居中；accent 15% 圆角高亮改为停留 1.5 秒后以 ease-out 0.5 秒淡出。
- 自动与导出证据：本项专项 **3 suites / 17 tests**，覆盖全部几何常量、菜单布局/动作、回复协议/草稿/上下文/撤回、本地删除、composer 和气泡 UI、四种定位器标签/图标/优先级、私聊/群聊接线与高亮时间。最新全仓为原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**84 suites / 440 tests** 和 Expo public config。production iOS Hermes export 为 **3,432 modules、74 assets、12,298,669-byte HBC、20MB/76 files**，SHA-256 `93b0eb9477955e972b85a3e77b248ff0f1fe4b04264360c96bb9edd24029429d`。
- 仍未完成：真实 WebSocket 重复/乱序/断线重连、媒体 outbox 确认替换、跨设备回复/@、已读、上下文缺页与业务错误没有联调；RN 以 inverted list `contentOffset.y <= 24` 近似 Swift 底部 anchor 的 onAppear/onDisappear，需要真机滚动校准；原 AgentChat 图片长按只显示 reply 菜单并回填 composer 图片的链路仍缺失；引用图片当前未证明原 `ImageCacheManager` 的鉴权/缩略磁盘缓存等价。菜单触控序列、箭头锚点、0.3 秒滚动、locator 右侧转场、系统 material/字体/SF Symbol、深浅色、动态字体、VoiceOver、十语言及原版/Expo/diff 截图完全未验收。本记录不得简称为“回复功能完成”。

## 2026-08-07：MediaPickerPreview 选择后预览代码级还原（未通过终验）

- 验收结论：旧 Expo 在相册返回后会立即发送，确实缺少 `MediaPickerPreview.swift` 的确认层；本轮新增共享预览并同时接入私聊、群聊。源码对照、组件交互、接线回归和 production iOS export 已通过，因此共享组件只能从 `🔴` 调整为 `🟡`；没有真实相册/模拟器和原版/Expo/diff 三图，整体像素级完成仍是 **0/47**。
- 结构与视觉契约：系统选择继续限定图片＋视频、按用户选择顺序、最多 9 项；返回后先进入全屏 slide preview，不再立即排队发送。预览恢复三列、8pt 行列间距、16pt 网格外距、正方形 10pt 圆角 cell、300×300 最大视频首帧、11pt medium 视频 badge/6×3pt 内距/6pt inset、22pt 删除图标/4pt inset、14pt 已选计数，以及 16pt semibold 白字、24×10pt 内距和 20pt 圆角的原渐变发送按钮。页面背景、secondary bottom bar 与本地化标题/取消/计数/发送文案均按原色彩角色接入。
- 交互与发送契约：删除只移除当前 UUID 对应顺序位，最后一项删除后关闭；取消不会创建发送任务；发送先复制当前数组、关闭预览，再把确认后的顺序交给既有私聊或群聊图片/视频 document outbox。图片/视频类型会继续使用各自已有的即时乐观消息、client ID、预处理、持久重试和成功原位替换，不因加入预览而旁路。
- 自动与导出证据：专项 **2 suites / 6 tests** 覆盖全部 Swift 几何常量、视频 badge/首帧限制、顺序删除、最后一项关闭、取消、发送防御性复制、私聊/群聊接线、9 项/有序混选。最新全量为原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**82 suites / 432 tests** 和 Expo public config。production iOS Hermes export 为 **3,432 modules、74 assets、12,295,192-byte HBC、20MB/76 files**，HBC SHA-256 `3fad6685e69380945e12b72a94b02b5433618c6a1812d0986bc31b376f6001ad`。第一次误用 `--dev false` 被 CLI 当成 dev 开关，生成 22.5MB JavaScript 开发包，已明确作废；随后不带 `--dev` 并设 `NODE_ENV=production` 的 Hermes 结果才计入证据。
- 仍未完成：真实照片权限、有限相册、取消系统 picker、HEIC/Live Photo、损坏文件、超长/旋转视频、首帧生成失败、内存/存储不足尚未联调；0.2 秒 ease-in-out 重排虽已接入 `LayoutAnimation`，逐帧曲线仍未与 SwiftUI 对拍；NavigationView/LazyVGrid、系统标题栏、安全区、系统字体/SF Symbol、深浅色、动态字体、VoiceOver、十语言极端文案及原生/Expo/diff 截图完全未验收。本记录不得简称为“媒体预览完成”。

## 2026-08-07：ChatBatchAction 消息多选与转发代码级复核（未通过终验）

- 验收结论：共享组件表原先把 `ChatBatchActionViews.swift` 标成 `🔴` 同样是清单落后于代码；复核确认私聊/群聊的消息多选、转发目标、确认发送、合并记录卡和详情均已接通，本轮新增 UI 流程与源码接线测试并通过全量回归，因此修正为 `🟡`。没有真实服务端、模拟器交互和原版/Expo/diff 三图，不能称为完成；像素级完成仍为 **0/47**。
- 多选契约：私聊和群聊长按菜单进入同一 selection 模式，导航标题显示选择数；消息引用稳定编码 conversation scope/type/id/message ID，按 timestamp 后 message ID 排序，重复点击取消，最多 99 条。发送中/失败临时消息、系统、撤回、通话记录不可选；single/individual/merged 分别执行原版类型资格，语音不能逐条但可合并，礼物与嵌套聊天记录不能合并。选择行恢复 24pt indicator/44pt footprint，底部 58pt 工具栏使用 20pt icon/12pt label，空选择 35% disabled。
- 转发与详情契约：选择页并发加载 `/friends/list` 与 `/groups/list`，合并私聊和群目标，支持 38pt 搜索、loading、空态、部分失败 Alert、全失败 retry、42pt 头像/52pt 行、单选即时确认和最多 9 个多选；完成时按显示名排序。确认层固定 310pt、36×5pt handle、16pt 栈距、20pt 横距、12pt/10pt preview；发送为同一 body/header operation id 的 `/chat/forwards`，失败关闭确认并提示。合并记录气泡为 230pt 宽、12pt 内距/圆角、10pt 栈距和三行摘要；payload 严格限定 chat-history/forward-bundle，详情按 ordinal 排序，语音显示本地化占位并有 loading/error/retry。
- 自动证据：批量动作定向为 **3 suites / 15 tests**，其中新增 UI 直接点击工具栏/气泡、私聊＋群目标、多选排序、确认发送、失败重试和详情关闭；策略继续覆盖 99/9 上限、消息类型资格、稳定 reference、230/310pt 全部几何、API 与 bundle normalizer。最新全量为原图 **51/51**、本地化 **10×1,138**、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**80 suites / 426 tests** 和 Expo public config；本轮未改生产代码，沿用已通过的 **3,431 modules / 74 assets / 12,279,969-byte HBC** production iOS export。
- 仍未完成：真实好友/群列表缓存与部分失败、9 目标和 99 消息边界、不可转发版本冲突、服务端业务错误、幂等重试、目标会话即时 mutation、跨设备回执未联调；SwiftUI List/searchable/system sheet `.height(310)` 与 RN Modal/absolute card 的转场、拖拽、键盘、导航返回及暗色/动态字体/VoiceOver/十语言未逐项验证；原版、Expo、差分截图完全未做。本记录不得简称为“消息转发完成”。

## 2026-08-07：MentionPicker 群 @ 提及代码级复核与交互验收（未通过终验）

- 验收结论：共享组件表原先把 `MentionPickerView.swift` 标成 `🔴` 是文档落后于代码；复核确认正式选择器和 GroupChat 输入/发送链路已经存在，本轮补齐选择器 UI 与源码接线测试并完成全量回归，因此只能修正为 `🟡`。没有真实群/键盘/模拟器和原版/Expo/diff 三图，不能称为完成；页面级像素完成仍为 **0/47**。
- 选择器契约：正式组件使用全屏 slide modal，恢复取消/居中标题/多选或完成、38pt 搜索、cache/chat initial members、后台 server refresh、下拉强制刷新、loading/error/retry/search-empty；成员按 ID 去重、排除自己，空昵称/角色/头像按原优先级合并后以昵称和 ID 排序。群主/owner/admin 才显示 `@所有人` 且搜索时隐藏；单选即时返回，多选以 `@所有人` 后接原成员顺序返回；行使用 38pt 头像、16/12pt 文案和 21pt selection symbol。
- 输入/发送契约：只在开头或空白后插入独立 `@` 时打开选择器；replacement range、光标和 mention span 全按 JS UTF-16 code unit 计算，与 Swift `NSString`/`NSRange` 一致。token 保存不含尾随空格的长度；改动 span 内文字或删除紧随空格会并集删除整个 mention；前方编辑平移未相交 span。群草稿保存 mention spans，越界缓存拒绝恢复；发送时直提及 ID 去重排序，`@所有人` 独立输出 `mention_all`，失败重试保留服务端消息字段。
- 审计排除：`MentionPickerView 2.swift` 是原工程本来就未跟踪的早期简化重复文件，桌面副本中逐字保留供审计，但 Xcode 正式使用无后缀文件；它不是第二套产品能力，状态改为“审计排除”，没有删除也没有接入以制造重复符号。
- 自动证据：提及定向为 **3 suites / 12 tests**，覆盖 emoji UTF-16 offset、插入/整体删除/span 平移、standalone `@`、成员归一化、草稿和 wire 字段，以及搜索/无结果、单选、多选、`@所有人`、错误/重试。最新全量为原图 **51/51**、本地化 **10×1,138**、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**78 suites / 420 tests** 和 Expo public config；本轮未改生产代码，沿用上一项已通过的 **3,431 modules / 74 assets / 12,279,969-byte HBC** production iOS export。
- 仍未完成：真实群详情、缓存回退、owner/admin 权限、账号切换、群发送/失败重试与服务端 mention alert 未联调；`localeCompare` 和 Swift localized compare、组合附加符/ZWJ/超长昵称、选择中再次搜索、键盘关闭/恢复、iOS searchable/List/fullScreenCover/下拉刷新手感、暗色/动态字体/VoiceOver/十语言未逐项验证；原版、Expo、差分截图完全未做。本记录不得简称为“群 @ 完成”。

## 2026-08-07：DynamicScreen 服务端驱动页面第一轮代码级还原（未通过终验）

- 验收结论：第 15 项 `DynamicScreenView.swift` 已从完全未迁移变为真实可运行页面，源码协议、首轮实现、定向交互测试、全量回归和 production iOS export 通过，所以只能由 `🔴` 调整为 `🟡`。没有原版/Expo/diff 三图、模拟器逐项点击、真实服务端/账号/CDN 证据，当前像素级完成仍严格为 **0/47**。
- 数据与缓存契约：按原版实现 Remote Config 内嵌 screen 优先、5 个 bundled fixture 回退、`GET /app/screens/{screenID}`、8 秒超时、`If-None-Match`/304、guest/用户账号隔离 screen 与 ETag 缓存、schema v1 Gate、App/Build/平台/语言/时区头和可选 Bearer。解析 snake/camel Screen、Component、Route 和任意 JSON props，保留 visible/children/min/max 字段；加载失败时继续展示内嵌或缓存页面，只有完全无页面时显示错误/即将上线空态。
- 渲染与交互契约：覆盖原 Swift switch 的全部 19 个 token：screen/section/list、card、row/actionRow/action_row、banner、text、image、button、divider、spacer、walletBalance/wallet_balance、giftPreview/gift_preview、agentList/agent_list；未知 token 静默忽略。恢复 16/16/24pt 内容边距、12/10pt 栈距、14pt 圆角、40/48/42pt 图标、`#FFF4C9→#E9F8FF` banner、46pt 渐变按钮、160pt 默认图片、动态语言降级、钱包刷新/默认钱包 route、前 4 个原固定礼物、Agent 默认卡和 native/web/external/screen route Alert 行为。原 `feature/[slug]` 迁移说明页保留，动态 screen 使用独立路由，避免补本项时破坏地图等旧入口。
- 原资产与远端资源：静态映射复制来的全部 **32 个 Assets.xcassets imageset**，fallback 名称可直接命中原图；没有重绘、转码或压缩，51 个 raster 聚合仍为 `295154cd…6362`。远端图片继续复用 HTTPS、可执行扩展名、图片 MIME、8 MiB、响应 Content-Type、精确 byte size 和 SHA-256 校验后再写 `RemoteAssets` cache；导出产物逐项包含这些原版图片。
- 自动与导出证据：定向新增协议/本地化、fixture/cache 隔离、19 token/几何/资产映射、行/横幅/嵌套/钱包/礼物交互测试；最新 `pnpm validate` 为原图 **51/51**、本地化 **10×1,138**、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**76 suites / 415 tests** 和 Expo public config。production iOS Hermes export 为 **3,431 modules、74 assets、12,279,969-byte HBC、20MB/76 files**，HBC SHA-256 `5d6c0534fe1af96fd3f19651b0337cf296f84d4d54ec76fd6d50a00161c8b223`。
- 仍未完成：真实 `/app/config`、`/app/screens/{id}`、304/ETag、token 过期、账号切换、缓存命中和恶意/损坏/超限 CDN 资源未联调；原版 API conditional 请求可在 401 后 refresh/replay，本轮独立 fetch 尚未证明这一点等价；SwiftUI LazyVStack/Button/AsyncImage 与 RN ScrollView/Pressable/Expo Image 的布局、点击高亮、系统字体/SF Symbol、下拉刷新、导航返回、深浅色、动态字体、VoiceOver、十语言极端文案、弱网/离线/前后台尚未逐项验收；原版、Expo、差分三图完全未做。本记录不得简称为“动态页面完成”。

## 2026-08-07：PropBag 与猫粮明细第一轮代码级还原（未通过终验）

- 验收结论：第 30 项 `PropBagView.swift` 的占位入口已替换为真实页面，并通过源码逐段对照、功能实现、自动化和 production iOS export，因此只能从 `🔴` 调整为 `🟡`。没有原版/Expo/diff 三图、模拟器逐项点击或真实后端账户证据，当前像素级完成仍严格为 **0/47**。
- 页面与原资产：恢复 3 列道具网格、10pt 网格间距、92pt artwork、原 Swift modifier 顺序对应的 170pt 内容高加 10/8pt 卡内距、13pt 单行最小 0.76 缩放标题、16pt heavy 数量胶囊、加载/错误/空态、下拉刷新，以及道具说明弹层。图片/视频解锁卡、5/10/15 分钟直播体验卡和猫粮图全部直接引用复制来的 Assets.xcassets 1x 基准及同目录 2x/3x variation；最新资产聚合哈希仍为 `295154cd…6362`，没有重绘、转码或压缩。
- 数据与消费回执：真实入口覆盖个人页和远程 `prop_bag` route；库存使用 `/me/prop-bag`、no-store、60 秒账号隔离缓存，兼容 snake/camel，过滤零数量和退役 `game_entry_card`。猫粮详情使用精确 `/wallet/activity-cat-food/transactions?limit=20&cursor=`、no-store、1–50 clamp、重复 ID/cursor Gate；两个远程配置形态按原版 OR，服务端 `activity_cat_food_disabled` 会 fail-closed。朋友圈列表/详情的混合扣款、媒体卡消费回执，以及直播体验卡预占，都会同步钱包或全局道具库存。
- 自动与导出证据：最新 `pnpm validate` 为原图 **51/51**、本地化 **10×1,138**、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**72 suites / 398 tests** 和 Expo public config。production iOS Hermes export 为 **3,424 modules、74 assets、12,238,389-byte HBC、20MB/76 files**，输出逐项列出猫粮、两张媒体卡和三张直播卡，六组均为 **3 variations**。首次直接引用 `@3x` 的导出曾被 Metro 拒绝；已按 Expo 多倍率规则改为引用未带 scale 后缀的原 1x 文件，由 Metro 自动收集原 2x/3x，失败结果未被冒充成功。
- 仍未完成：真实库存/余额/猫粮流水/分页/禁用业务错误未联调；Agent 付费媒体解锁未迁，公开资料锁定动态仍导向详情；React Native 弹层尚未证明等价 SwiftUI compact popover 的锚点、箭头和 material。NavigationBar、系统字体/SF Symbol、卡高、阴影、深浅色、动态字体、VoiceOver、十语言、旋转/安全区、原版/Expo/diff 截图和逐帧手势均未验收。本记录不得简称为“道具包完成”。

## 2026-08-07：Discover 直播大厅与一对一直播首轮代码级还原（未通过终验）

- 验收结论：第 14 项 `DiscoverView.swift` 的直播大厅及第 8 项 `CallView.swift` 的直播计费层已通过本轮源码逐段对照、实现、自动化和 production iOS export，因此 `DiscoverView` 只能从 `🔴` 调整为 `🟡`。真实双账号/双设备、后端/钱包/道具/WebSocket、模拟器交互和原生/Expo/diff 截图均未通过；当前像素级完成仍严格为 **0/47**。
- 大厅与实时状态：恢复推荐/聊过 Tab、计费横幅、两列 4:5 主播卡、双块骨架、加载/空/错/刷新、可用状态排序、当前账号主播卡、10 秒轮询、前台/重连刷新、WebSocket created/updated/ended、event ID 去重、同 slot 时间乱序保护、请求期间本地 mutation 保留、当前 slot 端点 404/405 回退、25 秒心跳、挂上/退出直播和失败后当前 slot 恢复。对照本轮另修复了原生 17pt segmented 字、性别胶囊 88% 透明、圆形弹窗头像描边/阴影、弹窗 18/24pt 横向留白、白色 72% 描边、主按钮渐变，以及聚焦时遮罩首击只收键盘的行为。
- 头像、道具与支付：头像裁剪按原 `minimumScale`、1–5 倍缩放、offset clamp、CGRect integral intersection、三分网格、1024px、1MB 与 0.86/0.78/0.70/0.62/0.54 JPEG 序列实现。道具库存接入 `/me/prop-bag`、no-store、60 秒账号隔离缓存、5/10/15 分钟体验卡过滤/数量/预占消费；支付页原封使用三张体验卡和猫粮位图，余额路径先校验 minimum starting balance，道具路径发送 `payment_method=prop_card` 与 `prop_definition_id`。
- 邀请与通话：支持 flat/nested/JSON-string 邀请 payload；实现呼入/呼出、忙线拒绝、15 秒倒计时、接受/拒绝/取消、accepted/terminal 状态回查及丢事件补偿。通话层接入服务端计费策略、免费时段、按起始单位计费、体验卡剩余/结束前 60 秒、观众混合扣款/主播收益、角色介绍、余额不足宽限与最终结算；LiveKit 断线会在 800ms 内查询 call state，识别余额不足则恢复结算结束卡，否则走连接错误。通话背景、角色按钮渐变和结束遮罩已按 Swift 数值校正。
- 自动证据：最新 `pnpm validate` 为原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**69 suites / 385 tests** 与 Expo public config。production iOS Hermes export 成功：**3,420 modules、74 assets、12,197,524-byte HBC、20MB/76 files**。
- 仍未完成：真实 `/one-to-one-live`、`/me/prop-bag`、钱包与服务端结算没有双账号端到端证据；AgentChat 的地球匹配与 `agentMatch` 四类角色标题上下文未齐；系统 material、弹簧/转场、深浅色、动态字体、VoiceOver、权限/弱网/前后台、真实 LiveKit 音频路由，以及原版/Expo/diff 截图和逐帧手势均未验收。本记录不得简称为“Discover 完成”或“直播完成”。

## 2026-08-07：ActivityCenter 第一轮代码级还原（未通过终验）

- 验收结论：第 1 项 `ActivityCenterView.swift` 已通过源码审计、第一轮功能实现、专项自动化、production iOS export、Expo Doctor 和完整 Simulator Debug Xcode 编译；真实后端/系统交互及原生/Expo/diff 截图尚未通过，所以只从 `🔴` 改为 `🟡`，当前像素级完成仍为 **0/47**。
- 页面与动效：恢复福利/转盘双 Tab、签到累计进度、以服务端时间锚点排序的饭点奖励、服务端动态四段奖池及 1,000,000 PPM 概率校验。转盘按源码执行 420°/s 预备、六个完整圈、4 秒主旋转、0.6 秒滑行、0.75 秒二次减速，服务端决定落点，结果在停稳后 260ms 显示并再提交权威快照；领取使用乐观状态，奖励猫粮执行 burst/scale/opacity。活动猫粮与金币图复用原生资产字节，没有重绘或替换。
- 数据、安全与恢复：精确接入活动中心快照、签到、饭点、转盘、联系人会话/匹配、手机号发送/验证、邀请分享/完成/兑换和好友请求。联系人只上传 `SHA256(salt + "\\0" + E.164)`，不上传姓名或原手机号，并执行去重、排序和数量上限。缓存按账号隔离，以服务端快照为权威；签到/饭点的明确失败回滚，网络/超时/5xx/解码歧义保留乐观态和同一幂等键；各操作独立 Gate，账号切换后旧请求不能覆盖或解锁新账号状态。联系人匹配只有真正发出 match 后才允许按明确错误清键，创建 session 失败不会误删上一枚待确认键。
- 自动与构建证据：ActivityCenter 定向为 **4 suites / 21 tests**；最新全量为原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**62 suites / 357 tests** 和 Expo public config。Expo Doctor **20/20**；production iOS export **3,408 modules、74 assets、12,018,174-byte HBC、19MB/76 files**，输出明确包含 ActivityCenter 三档猫粮图、claim burst、reward paw 和钱包金币图。完整 Simulator Debug 原生构建明确返回 `BUILD SUCCEEDED`。
- 仍未完成：真实活动中心配置/时区/签到/饭点/轮盘各业务错误，iOS 真机联系人权限和大通讯录，真实短信验证码、系统分享、邀请冷/热深链、好友状态与账号切换竞态均未联调；系统字体、间距、四段落点、逐帧转盘/奖励动画、深浅色、动态字体、VoiceOver、十语言，以及原版、Expo、差分三图尚未验收。因此本轮绝不称为“完成”。

## 2026-08-07：GameCenter 与 InAppWeb 第一轮代码级还原（未通过终验）

- 验收结论：第 19 项 `GameCenterView.swift` 与第 47 项 `Web/InAppWebView.swift` 已通过源码审计、首轮实现、专项自动化、production iOS export、Expo Doctor 和本地 Simulator Debug 完整 Xcode 编译，但尚未做原生/Expo/diff 截图、真实 H5/后端/广告交互或真机验收，因此两项只能从 `🔴` 提升为 `🟡`；当前像素级完成仍为 **0/47**。
- GameCenter：恢复推荐/玩过双 Tab、加载/空/错/重试、服务端顺序去重、推荐 cursor 分页与重复 cursor Gate、账号隔离缓存、海报/SVG、lobby 冷启动幂等 Gate和返回刷新。游戏 session、付费 round、钱包同步、恢复 token 失败、request/session 双身份 ledger、稳定错误码均独立处理，lobby 不再冒充 round。游戏和钱包奖励广告共用进程级展示互斥及 consent/SDK 初始化；游戏广告另有 allowlist、SSV、no-fill/超时/取消等稳定结果。
- InAppWeb：Remote Config policy 支持 snake/camel、HTTPS、域名/路径/bridge allowlist；同源留在 WebView，允许的动态 native/web route 进入 App，外部 HTTP(S) 交系统浏览器。锁定版本的 `react-native-webview` patch 把 `isMainFrame` 送到 JS，并拒绝设备运动方向权限；页面同时禁媒体权限、弹窗和多窗口，只有可信主帧可发 `bwchatGameBridge`/`bwchat` 消息。H5 profile 去重、round ledger、奖励广告、动态路由本地化、加载/阻止/错误/重试/toast/返回手势均已有实现。
- 自动与构建证据：最新全量 `pnpm validate` 为原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**58 suites / 336 tests** 和 Expo public config；Game/Web 相关定向 suites 为 **7 suites / 36 tests**，其中包含 native patch 回归。Expo Doctor 为 **20/20**；production iOS export 为 **3,287 modules、74 assets、11,581,507-byte HBC、19MB/76 files**。独立 `/tmp` prebuild/Pods 工程已完整 `BUILD SUCCEEDED`，产物 `Info.plist` 命中原 iOS AdMob App ID。首次构建暴露 Desktop 嵌套 ExpoModulesJSI framework 签名问题，已用锁文件约束的 pnpm dependency patch 固化并测试；Sentry 缺 org 只在本地构建时显式关闭上传，未冒充凭据已配置。
- 仍未完成：GameCenter 海报透明像素裁切/栅格化和所有系统字体/间距/动效无截图差分证据；InAppWeb 尚无 WebView 池/预热复用；真实推荐/玩过/lobby/付费 round/余额不足/恢复 token、真实 H5 bridge/重定向/恶意子帧/弱网、真实 AdMob/SSV、账号切换/缓存恢复、十语言/暗色/动态字体/VoiceOver 和逐帧手势均未验收。两项涉及新原生依赖/patch，朋友必须先安装包含该 fingerprint 的新 binary，后续同 runtime 的 JS/资产才可 OTA；当前仍未登录 EAS、没有 Project ID，也没有真实 Preview/Production OTA 或 rollback 记录。

## 2026-08-07：Wallet VoiceOver、动态字体、暗色与键盘交互代码级补全（未通过终验）

- 源码结论：原 `WalletView.swift` 主钱包使用固定 white/black/system-size，因此 Expo 主页面继续保持相同固定视觉和默认 Dynamic Type scaling，没有擅自套全局暗色主题；交易记录卡片唯一使用原 `AppColors.cardBackground = Color(.systemBackground)` 的地方，Expo 已补 `useColorScheme()`，在暗色下切为系统黑卡背景。四个 Wallet 表面均有回归门，禁止加入 `allowFontScaling={false}`。
- VoiceOver：补齐返回键、主/记录 Tab selected、六个商品 selected、购买/提现/广告 busy+disabled、协议 checkbox checked、网络选择 expanded/value、网络选项 selected、输入框标签、全部提现、记录入口、重试、提现撤销上下文、标题 header、加载态和 alert live region。装饰背景、金币徽章、空态猫图从可访问性树排除；无交互交易行合并成包含标题、说明、时间、金额的一次完整播报，提现行仍保留独立撤销按钮。
- 键盘/点击：按 Swift `KeyboardDismissTapInstaller(consumesOutsideTaps: false)` 增加非阻断背景轻点收键盘；钱包地址与提现金额的 62/68pt 整块输入区域均可聚焦，不再只有文字区域可点；金额框补齐 `.never` 大小写和关闭自动纠错，全部提现同时收键盘、关闭网络菜单并填入最大值。上述属性不改变布局、尺寸或颜色。
- 自动证据：新增 **4 项**专项测试，覆盖主页面语义契约、Dynamic Type 未禁用、交易行完整播报/动态系统卡色、空态及撤销 busy/disabled 语义；与原记录页 5 项交互测试合计 **9/9** 通过。最新 `pnpm validate` 为原图 **51/51**、本地化 **10×1,138**、ESLint **0 error / 1 生成文件 warning**、strict TypeScript、**51 suites / 299 tests**、Expo public config。production iOS export 成功：**3,270 modules、74 assets、11,477,124-byte HBC、19MB/76 files**。
- 仍未完成：以上是可由源码和组件测试证明的代码级还原，不是 VoiceOver/大字体/暗色模拟器或真机终验；背景轻点、整框聚焦、网络菜单焦点顺序、Toast 实际播报、最大字号截断、暗色交易卡和逐帧键盘动画仍需原生/Expo 对照。既有所有截图差分仍非零，Wallet 继续为 `🟡`，整体像素级完成仍为 **0/47**。

## 2026-08-07：EAS OTA 客户端本地验收通过，真实发布未验收

- 已完成的本地客户端范围：`UpdateService` 在 Development/Updates disabled 时不检查；启动后非阻塞检查、15 分钟限流、并发 single-flight、下载后不强制重启、手动重启、读写缓存失败不影响稳定版本、check/fetch/reload 异常上报均已有实现和测试。检查时间与 `no-update/downloaded/error` 结果会持久化并写入 Sentry tags；初始化 tags 补齐 App/Build/Runtime/Update/Channel/Environment/Platform/OS/embedded 状态，仍保持 `sendDefaultPii=false`。
- 设置入口与诊断：原设置页新增明确的“更新与诊断”入口；诊断页覆盖十种 App 语言，可查看环境/channel、runtime、Update ID、embedded/OTA 来源、最近检查时间与结果、Remote Config/kill switch、App/API，并可手动检查、在下载后选择重启、复制不含账号与 Token 的诊断数据，以及逐项验证通知、相册与定位原生能力。异步操作均有错误边界；这组入口是热更新需求要求的扩展，不冒充 Swift 原版已有像素元素。
- 自动证据：最新 `pnpm validate` 通过原图 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、ESLint **0 error / 1 个生成文件 warning**、strict TypeScript、**50 suites / 295 tests** 与 Expo public config；其中 OTA/诊断/监控新增 **12 项**定向测试。Expo Doctor **20/20**；production iOS export 成功，为 **3,270 modules、74 assets、11,471,433-byte HBC、19MB/76 files**。
- 隔离证据：原工程与桌面副本分支均为 `codex/hot`、HEAD 均为 `0830c012…af221`；原工程和副本原生 `BWChat` tracked/staged diff 都为零，两份原生目录 `diff -qr` 为零。Expo 代码仅在桌面独立副本 `/Users/wegpt.com/Desktop/BWChat-Expo-HotUpdate/expo-app`。
- 未完成且不得声称完成：`pnpm eas:whoami` 实测仍为 **Not logged in**，没有真实 EAS Project ID/owner/Apple 凭据，因而未生成可供朋友安装的 Preview/Production 包，也未执行真实 Preview OTA 两次冷启动、Production 10% 灰度、扩大比例、撤销灰度或 rollback。以上外部链路完成前，“以后所有人的 App 自动跟着更新”仍未端到端验收；整体像素级完成仍为 **0/47**。

## 2026-08-07：Wallet compact 与十语言极端文案矩阵（未通过终验）

- 结论：在同一台 iPhone 17 Pro Max / iOS 26.4、同一固定状态栏和同一钱包夹具上，为 `en/ja/ko/es/fr/de/pt-BR/ru/zh-Hans/zh-Hant` 十种语言逐一生成当前 Swift 原版与 Expo compact 金币页、收益页配对图。每张 Expo 图必须依次通过 Metro ready、`iOS Bundled` 和页面金色像素门；两批误拍到 Dev Launcher/白色过渡帧的金币图、1 张残留蓝色 `Refreshing…` 覆盖层的韩语收益图均已明确作废并重拍，不计入正式数字。十组有效金币图 exact 为 **83.1256%–83.5046%**、≤3 为 **91.7186%–92.0832%**、≤8 为 **94.6344%–95.0090%**、归一化 RGB MAE 为 **0.007239–0.009208**；收益图 exact 为 **91.4494%–92.0497%**、≤3 为 **96.7152%–97.2134%**、≤8 为 **98.0264%–98.4871%**、MAE 为 **0.004828–0.006020**。全部存在非零差分，因此 Wallet 仍为 `🟡`，像素级完成仍是 **0/47**。
- 长标题：Expo 不再对所有标题一律缩窄，而是先测量 18pt/对应字重的固有宽度；只有超过 Swift 的 114pt 标签宽度时，才按原 `.minimumScaleFactor(0.86) + .allowsTightening(true)` 下限进行横向收紧。德语有效图与原版同为 `Meine Goldm… / Meine Einnah…`，西语、葡语、俄语、日语等完整/截断内容也逐项一致；简体/繁体等短标题保持 1.0 比例，没有被本轮长文案修正误压缩。
- compact 主页面：固定 compact 金币页与收益页十语言正式差分范围如上；收益摘要 footer 的 Swift `HStack(spacing: 3)` 已按源码改为独立 3pt gap。金币/收益 compact 路由、固定数据和可选语言都只在 `__DEV__ && EXPO_PUBLIC_VISUAL_ACCEPTANCE` 下生效，不改变 production 路由或语言存储。十语言完整/截断内容、摘要三列、字段标题/占位、记录链接、全部提现和底部禁用按钮均已逐图检查，没有发现结构性溢出或错误换行。
- 自动证据：本轮修改后 `pnpm validate` 通过资产 **51/51**（聚合 `295154cd…6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae…dc6e`）、strict TypeScript、**47 suites / 283 tests** 和 Expo public config；ESLint **0 error / 1 个生成文件 warning**。三张 Wallet 业务位图和全部 51 个原数字资产均继续由哈希校验，未重绘、转码或压缩。
- 已否决方案：曾仅在 A/B 分支把 Wallet 图片从 `expo-image` 切到 React Native/UIKit 图片管线；简中 compact exact 从 **83.4323%** 降到 **38.8771%**，背景 cover 裁切位置也明显错误。该实验已完整回退，回退复测 exact **83.4302%**，与基线截图噪声范围一致；失败方案未保留在产品代码中。
- 仍未完成：compact 金币/收益十语言矩阵已经齐全，但全图残差仍集中在 SwiftUI/React Native 的位图解码/合成、系统字体与 SF Symbol 抗锯齿、阴影和 iOS 26 工具栏材质。未通过逐像素门槛，不能称为 compact、Wallet 或任一页面完成；暗色、动态字体、VoiceOver、逐帧交互、真实 StoreKit/AdMob/钱包接口和 OTA 真机链路仍未验收。

## 2026-08-07：Wallet 交易/提现记录页状态矩阵首轮验收（未通过终验）

- 结论：用同一台 iPhone 17 Pro Max / iOS 26.4、固定状态栏和当前 Swift 源码，为交易记录与提现记录分别补拍空态、固定非空数据、错误态、持续加载态的原版/Expo/5 倍差分图；交易记录还分别覆盖收入/支出 Tab。状态路由及固定数据均只在 `__DEV__ && EXPO_PUBLIC_VISUAL_ACCEPTANCE` 下生效，不进入 production。所有状态仍有非零差分，因此 `WalletView.swift` 继续是 `🟡 部分完成`，像素级完成仍为 **0/47**。
- 空态：交易记录 exact/≤3/≤8/MAE 为 **99.8122% / 99.9173% / 99.9598% / 0.000050**；提现记录为 **99.7983% / 99.9040% / 99.9475% / 0.000107**。154×142pt 原猫图、标题、导航位置均已对齐，残差主要是系统字形、SF Symbol 和位图边缘抗锯齿。
- 非空态：交易收入为 **99.5039% / 99.5877% / 99.6456% / 0.000659**，交易支出为 **99.5011% / 99.5792% / 99.6334% / 0.000690**，提现四状态记录为 **98.8267% / 99.0385% / 99.1720% / 0.001347**。夹具覆盖 IAP、收礼、收转账、送礼、发红包、转账，以及 pending/processing/completed/rejected 和可取消/说明字段；卡片布局与信息层级已进入截图矩阵，但系统字体/SF Symbol/金币图抗锯齿仍未清零。
- 错误态：交易记录为 **99.8122% / 99.9173% / 99.9598% / 0.000050**，提现记录为 **99.7983% / 99.9040% / 99.9475% / 0.000107**。持续加载态分别为 **99.9274% / 99.9328% / 99.9354% / 0.000105** 和 **99.9125% / 99.9179% / 99.9216% / 0.000169**；spinner 的中心、尺寸和颜色一致，截图瞬间的旋转相位不一致。
- 交互自动证据：新增 5 项组件级操作测试，实际调用收入→支出→收入 Tab press handler、提现取消 ID 转发、取消失败 Alert，以及两个页面的 RefreshControl 刷新 handler；最新全量 `pnpm validate` 通过资产 **51/51**、本地化 **10×1,138**、strict TypeScript、**47 suites / 283 tests** 和 Expo public config，ESLint **0 error / 1 个生成文件 warning**，Expo Doctor **20/20**。
- 打包/资产证据：最新 production iOS export 为 **3,269 modules、74 assets、11,447,660-byte HBC、19MB/76 files**；钱包空态图、顶部背景、金币徽章在 export 中分别命中原 SHA-256 `44bba6bc…`、`4fcf09b0…`、`8685a0a4…`，逐字节一致。
- 仍未完成：以上差分都没有清零；Mac 锁屏导致本轮无法通过真实 Simulator 鼠标/触摸操作复拍，交互目前只有组件 press/RefreshControl 自动证据；真实下拉手势、分页触底、取消成功后列表变更、导航返回手感、compact、暗色、VoiceOver、十语言、动态字体和真实接口错误仍需验收。这一轮不能称为记录页完成，更不能称为 Wallet 或整体完成。

## 2026-08-07：WalletView 当前源码基准截图与差分验收（未通过终验）

- 结论：重新从当前 Swift 源码构建原版 Simulator App，并用同一台 iPhone 17 Pro Max / iOS 26.4、同一状态栏、同一固定钱包数据分别拍摄“我的金币”和“收益提现”；Expo Development Build 也以同样数据冷启动重拍。两种状态均已生成原版、Expo、半透明叠图和 5 倍差分图，但差分仍非零，因此 `WalletView.swift` 继续标记 `🟡 部分完成`，当前像素级完成仍是 **0/47**。
- 固定数据：金币余额 85、活动猫粮 20、可消费 105、充值 50、礼物收入 35、可提现 35、冻结均为 0；最低提现 0.50 USDT、步长 0.50、汇率 0.005、预估 0.18 USDT；广告剩余 0 次；六个 StoreKit 商品保持原顺序和价格。该数据只由 `__DEV__ && EXPO_PUBLIC_VISUAL_ACCEPTANCE` 守卫的截图夹具提供，不进入 production 路径。
- 差分结果：金币页全图完全一致像素 **83.3823%**、每通道误差 ≤3 的像素 **91.9591%**、≤8 的像素 **93.7888%**、归一化 RGB MAE **0.006556**；收益页分别为 **91.6660% / 97.9052% / 98.7816% / 0.003048**。收益页表单主体区域完全一致 **98.6986%**，底部区域 **100%**；主要剩余差异集中在 SwiftUI 与 React Native 的系统字体/SF Symbol 抗锯齿、收益卡阴影，以及 iOS 26 导航栏自动 Liquid Glass 返回按钮材质。以上数字只是客观进度，不作为“已通过”的替代。
- 本轮像素调整：补齐 Swift `GeometryReader` 相对导航内容原点的 10pt 偏移、60pt 底部白色覆盖、金币广告条/充值面板的 1 物理像素对齐、收益卡 footer modifier 顺序、摘要/字段标题 1 物理像素对齐、禁用提现按钮的实际合成颜色，以及 44pt 返回 hit area、42pt 圆形可见区域和精确 `#1A1A2E` chevron；三张 Wallet 位图继续直接复用原文件，没有重绘或压缩。
- 最新自动证据：`pnpm validate` 再次通过资产 **51/51**、本地化 **10×1,138**、strict TypeScript、**47 suites / 283 tests** 和 Expo public config；ESLint 为 **0 error / 1 个 `.expo/types/router.d.ts` 自动生成文件的 unused-disable warning**，不再误写成零警告。Expo Doctor **20/20**。最新 iOS Hermes export 为 **3,269 modules、74 assets、11,447,660-byte HBC、19MB/76 files**，三张 Wallet 资产仍按 SHA-256 逐字节命中。原工程与副本 `BWChat` 目录 `diff -qr` 为零，两边原生 tracked/staged diff 均为零。
- 仍未完成：金币页与收益页现有差分没有清零；返回按钮 Liquid Glass、系统字形/抗锯齿、阴影和逐帧交互仍需继续验收；交易/提现记录页虽已补空/非空/错/加载首轮矩阵，但差分非零且真实 Simulator 点击受 Mac 锁屏阻塞；提交、菜单、键盘、toast、Alert、compact 设备、暗色、VoiceOver 和十语言仍无完整截图矩阵；StoreKit Sandbox、真实 AdMob/SSV、生产钱包接口、账号切换/缓存恢复和 OTA 真机链路仍未验收。没有 EAS Project ID/Expo 登录，当前配置还不能实际发布 OTA。

## 2026-08-07：WalletView / WalletStore 第一轮源码还原与原生构建验收

- 结果：第 46 项已完成源码审计、第一轮功能实现、自动化检查及本地 Simulator 原生编译，但没有原生/Expo/diff 截图，也没有 StoreKit Sandbox、真实 AdMob/SSV 或生产钱包接口联调，所以只从“未迁移”提升为“部分完成”；像素级完成仍是 **0/47**，不简称“完成”。
- 审计范围：逐行复核原 `WalletView.swift` 全部 2,082 行，以及 `WalletStore`、`AdRewardService`、钱包模型/API、动态配置与原测试；记录金币/收益双 Tab、compact `<650pt` 分支、商品/广告/摘要/提现/交易/空态的精确尺寸、颜色、圆角、字体、阴影、间距、键盘和动画参数，并复核严格 `gold_coin`、提现 min/step/max/12 字符账户规则、上海业务日和服务端权威广告到账语义。
- UI/交互：迁入 246pt 顶部 Tab、32×4pt 下划线、原弧形背景与 119/147pt 金币徽章、广告条、三列六商品、42/52pt 黄色购买按钮、条款整行切换、130/148pt 收益摘要、62/68pt 提现字段、160ms 网络菜单、spring 键盘聚焦收折、顶部/居中 toast；交易和提现页恢复双 Tab、游标分页、加载/空/错态及 154×142pt 原猫图。三张 Wallet 位图在最终 iOS export 中分别以原 SHA-256 `44bba6bc…`、`4fcf09b0…`、`8685a0a4…` 找到逐字节相同文件；全部 51 张原图聚合哈希仍为 `295154cd…6362`。
- 数据/购买/广告：接入余额、交易、提现记录、提现创建/取消、奖励 session/status 和 iOS IAP confirm 精确路由与字段；交易/提现按首见 ID 去重并保留服务端游标，钱包状态、提现账户、未完成购买和广告 pending 均账号隔离。IAP 使用六个原商品、购买监听、未完成交易重放、服务端确认后才 finish，409 视为已确认；广告先创建服务端 session 并附 SSV，客户端 earned 回调只登记 pending，只有同一上海业务日且服务端计数下降才确认，最多 6×1 秒轮询，不由客户端直接加余额。
- 自动/打包证据：`pnpm validate` 通过原图 51/51、本地化 10×1,138、ESLint、strict TypeScript、**46 suites / 278 tests**；Wallet 专项 **9/9** 覆盖源码视觉常量、六商品、snake/camel 模型、余额失败关闭、USDT/提现、广告 pending/上海时区、交易去重和全部请求。Expo Doctor **20/20**；iOS Hermes export 成功（**3,268 modules、74 assets、11,430,773-byte HBC**），三张 Wallet 资产逐字节命中。干净 `/tmp` prebuild/Pod 环境完整 Xcode `BUILD SUCCEEDED`，371MB Simulator App 含 `ExpoIap 5.0.1`、`RNGoogleMobileAds 16.4.0`、Google Mobile Ads SDK 13.5.0、`EXUpdates.bundle` 及原 iOS AdMob App ID。第一次构建因 Desktop File Provider 扩展属性触发签名拒绝，第二次清洁依赖后走到 Sentry 缺 org；最终保持业务配置不变、仅对本地验收关闭 Sentry 自动上传后成功，两次失败均未冒充通过。
- 隔离证据：原工程与桌面副本都在 `codex/hot`、HEAD 同为 `0830c012…af221`；原工程 tracked/staged diff 为零，两个 `BWChat` 原生目录 `diff -qr` 为零，副本原生目录 tracked/staged diff 也为零；实际 Expo 工作区没有生成 `ios` 目录，所有 prebuild/Pods/Xcode 产物只位于独立 `/tmp`。原工程既有的 untracked `MentionPickerView 2.swift`、`artifacts/`、`tmp/` 未被本轮改动。
- 仍未完成：原生/Expo/diff 三图与逐帧转场；StoreKit Sandbox 的购买/取消/未完成重放；真实 AdMob load/show/earned 与后端 SSV callback；真实余额/记录/提现/401/业务错误、账号切换和缓存恢复；网络菜单锚点、键盘、toast、Alert、暗色/VoiceOver/十语言。`react-native-google-mobile-ads` 需在创建广告对象时给 SSV，当前点击后建 session 再加载，尚未等价原版“预加载后临展示才绑定 SSV”；Android 也没有与 `/wallet/ios-iap/confirm` 对应的后端协议。新增 IAP/广告是原生依赖，朋友需要先安装一次包含新 fingerprint runtime 的新包，之后同 runtime 的 JS/资产改动才能 OTA。

## 2026-08-07：SplashScreen 启动与会话恢复第一轮源码还原

- 结果：本轮完成的是第 43 项的源码审计、第一轮实现和自动化/原生构建验证，不是像素验收。源码复核纠正了旧清单：实际 `SplashScreen.swift` 没有猫图、失败提示或重试按钮，原生 `UILaunchScreen` 也为空白；Expo 不再显示旧紫底图标启动页。由于没有启动模拟器，也没有原生/Expo/diff 三图，本项仍为“部分完成”，像素级完成仍是 **0/47**。
- 视觉/动效契约：React 首屏恢复纯白背景、36pt heavy rounded `BBchat`、15pt semibold“正在进入”、13pt medium/72% muted tagline、14pt 栈间距、绿色 spinner 顶距 6pt、固定 86pt 底部留白；标题 scale 0.6→1、全部内容 opacity 0→1，并把 SwiftUI `.spring(response: 0.8, dampingFraction: 0.6)` 转换为 RN spring 的 mass/stiffness/damping。原生 launch 配置生成无 subview 的白色 storyboard，编译后的 App 含 `SplashScreen.storyboardc`，不是拿 React 首屏冒充系统 launch。
- 会话契约：无 access token 固定停留 500ms 后进入登录；有 cached user 时首帧恢复身份并在后台 verify；无 cached user 时只把 20 秒 watchdog 当 UI 逃生口，迟到验证仍可恢复。verify 失败仅显式 refresh 一次；只有 HTTP 401/403 或 `invalid_token`、`refresh_token_expired`、`refresh_token_invalid`、`session_revoked` 才清凭据，网络/服务端/解码等瞬时失败保留 token，能恢复缓存身份时标记 session unverified。refresh 成功先持久化 access/refresh token 和 user，再发布登录身份；全局导航 guard 负责后台验证迟到成功或明确失效后的路由修正。
- 覆盖安装兼容：SecureStore 主键改为原 Swift Keychain 的 `jwt_token` / `jwt_refresh_token`，service 固定 `com.bwchat.app`，可访问级别为 after-first-unlock-this-device-only；同时只读迁移早期 Expo 的两枚开发 key，登出清理全部四个别名。此处有代码与 mock 契约证据，但尚未用旧 Swift 真机包→新 Expo 包覆盖安装验证，所以不能声称真实迁移验收完成。
- 自动验证：新增 **15 项**测试，覆盖全部视觉/时间/spring 常量、明确凭据失效策略及嵌套业务码、verify/refresh 精确请求、导航 guard、500ms 无 token、cached user 瞬时失败、20 秒迟到成功、明确拒绝清理、refresh 先持久化，以及旧/新 Keychain 读取迁移/写入/清理。最新全量为原图 **51/51**（聚合 `295154cd...6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae...dc6e`）、ESLint 零警告、strict TypeScript、**45 suites / 269 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（**3,118 modules、74 packaged assets、11,039,920-byte bundle**）。独立 `/tmp` 工程完成 Pods 和完整 iOS Simulator Debug Xcode 编译，日志 `/tmp/bwchat-splash-xcodebuild-retry.log` 明确 `BUILD SUCCEEDED`，351 MB App 产物含 `EXUpdates.bundle`；首次构建只因 Desktop 文件提供器给依赖 framework 加扩展属性而失败，改用相同依赖的干净临时副本后通过，不是代码或 storyboard 错误。
- 仍未完成：RN `SF Pro Rounded` 实际字形/字重、spinner 尺寸与线宽、spring 每帧曲线、状态栏/安全区需要最终三图差分；旧 Swift `UserDefaults` 的 cached user/last active account 不能由当前 JS 直接读取，因此覆盖安装后若只有旧 Keychain token 且首次启动离线，会在 20 秒后显示登录但不删 token；恢复会话时原版还会连接 WebSocket、申请 Push 权限并上传 APNs token，当前 WebSocket 由登录 provider 恢复但 Push 后两项未迁；真实 verify/refresh/401/403/业务码/弱网/解码错误、覆盖安装 Keychain、账号切换、暗色/动态字体/VoiceOver/十语言、原生/Expo/diff 截图与转场均未验收。DEBUG 专用 `gameReentryReview`/钱包截图路由只是原生测试入口，不计入产品路径，也未迁入 Expo。

## 2026-08-07：ShortDramaStudioView 工作室列表第一轮源码还原

- 结果：个人页“我的短剧”已从占位提示接到真实 Studio；源码审计、首轮功能实现、专项测试、全量回归、Expo Doctor 和 iOS 离线导出通过。没有启动模拟器，也没有原生/Expo/diff 三图，因此本项和共享 `ShortDramaFeedView`/`ShortDramaSeriesListView` 仍是“部分完成”，像素级完成仍为 **0/47**。
- 页面契约：恢复 inline 标题、36×36pt/17pt semibold 返回键和 34×34pt/18pt semibold创建键；滚动内容为 16pt 横距/顶距、30pt 底距，卡间 12pt。首载空列表恢复 92pt 顶距、12pt 间距、14pt semibold 加载文案；真正空态恢复 70pt 顶距、28pt 卡内距/16pt 圆角、44pt 图标、16pt 主间距、6pt 文案间距、18/14pt 文案及 18×40pt 创建胶囊。
- 卡片/状态契约：复用原系列卡的 14pt 内距、16pt 圆角、70% separator 描边、10pt 标题区距、首基线 7pt 状态布局、131pt 海报、三行简介、每页 15 集范围、5 列/8pt 间距/44pt 分集格、44pt 创作者区。系列状态 pill 使用 caption2 bold、7×3pt padding、12% 状态色底；published=online、processing/reviewing=accent、rejected/failed=error、draft/unknown=secondary。分集状态点严格为底部居中 7pt 圆点和 5pt padding。源码复核后删除了 Expo 曾额外显示的失败原因，因为原共享卡片没有渲染 `series.statusMessage`。
- 数据/导航契约：精确接入 `GET /short-drama/mine?limit=20[&cursor]`，下拉刷新重置游标，最后一卡附近触发分页并按 series ID 保留首项去重；初始页前拼接当前账号持久短剧任务，已被远端 server ID 表示的本地卡会过滤。远端提交/编辑结果会替换对应本地投影；账号切换会清空旧状态并重新加载。创建进入统一编辑器；服务端卡进入 edit，本地 `local:{job}` 卡带 `resumeJobId` 恢复原任务。原版给可见失败任务填入“重试”状态消息，但共享卡没有显示它；本轮照搬这一行为，没有虚构额外提示。
- 自动验证：新增 **6 项** Studio 契约测试，覆盖全部页面常量、七种发布状态颜色/本地化、本地失败投影与远端过滤、分页保留首项、远端 upsert 替换本地任务，以及 mine endpoint/20 条/游标编码。最新全量为原图 **51/51**（聚合 `295154cd...6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae...dc6e`）、ESLint 零警告、strict TypeScript、**42 suites / 254 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（**3,116 modules、74 packaged assets、11,033,564-byte bundle**）。本轮只有 JS/TS 改动且没有新增原生依赖；上一轮同一依赖图的 `/tmp` iOS arm64/x86_64 Simulator Debug 全量 Xcode 编译证据仍为 `BUILD SUCCEEDED`。
- 仍未完成：真实 `/short-drama/mine` 分页、detail 补载、创建/编辑/上传队列完成广播和账号切换联调；原版自身没有显式失败说明/一键重试，当前也只能点击本地卡恢复编辑；`FlatList.onEndReached` 与 Swift 最后一张卡 `onAppear`、系统导航栏/下拉刷新、动态字体、暗色、VoiceOver、十语言极端文案；原生、Expo、差分三图和逐帧转场验收。`ShortDramaFeedView.swift` 中当前导航不调用的旧私有详情/旧分集上传界面仍未迁入，未把死代码误算成已完成产品路径。

## 2026-08-07：ShortDramaUnifiedEditorView 创建/编辑/恢复上传第一轮源码还原

- 结果：短剧列表创建按钮已从占位目标切换到真实统一编辑器，支持创建、现有系列编辑和失败上传任务恢复；源码审计、首轮功能实现、自动化与 iOS 离线打包层已通过。真实服务端、原生后台 `URLSession` 等价能力、Studio 任务入口和原生/Expo/diff 截图均未验收，因此第 41 项只从“未迁移”变为“部分完成”，当前像素级完成仍为 **0/47**。
- 页面/交互契约：恢复 transparent inline 导航与返回键；滚动区为 16pt 外距、14pt section 间距、96pt 底部留白、secondary 背景，两张卡均为 14pt 内距、16pt 圆角和 0.7pt separator。系列卡恢复 44pt 标题输入、12pt 圆角/131pt 封面、黑底 `photo` badge、3–5 行/最小 76pt 简介；分集卡恢复标题、0.5pt divider、5 列/8pt 间距/44pt 高方格、价格与集号 capsule、成功/失败角标及添加视频格。底部发布条用 `ExpoBlur` 的 iOS material 承载，按钮最小 48pt/12pt 圆角；分集编辑 page-sheet 恢复价格数字过滤/0–100 截断、标题、3–6 行简介、取消/保存和破坏性删除。
- 媒体/校验契约：新系列必须有本地封面；标题非空、至少一集、每集标题非空、集号为唯一正整数才可发布，简介不作必填。封面先识别 JPEG 魔数避免无意义重编码，再按最大 1280px、JPEG 0.78、900KB，以及 0.65/0.55/0.45/0.35 与每轮 75% 尺寸递减到 640px；视频和最大 720px/JPEG 0.82 首帧复制到账号＋草稿隔离的 document outbox，文件名沿用 `episode-{selectionIndex}-{uuid}` / `episode-cover-{index}-{uuid}.jpg`。相册最多补入 `20 - 本地视频数`，服务端已有分集不占本地 20 个名额，并发预处理后仍按原选择顺序追加；删除后连续重排集号。
- 上传/恢复契约：发布前先持久化完整 job 和所有 part，再立即把本地系列投影回列表并退出编辑页。创建精确 POST `/short-drama/series`，更新 PATCH `/short-drama/series/{id}`；已有脏分集先 PATCH `/short-drama/videos/{id}`，新分集最多 2 路并发 POST `/short-drama/series/{id}/episodes`，全部成功再 POST `/short-drama/series/{id}/submit`。失败任务保留每集状态、服务端 series ID 和原 client request ID，手动重试不会重复创建系列；登录身份恢复后自动续跑非永久失败任务，成功后广播 library mutation 并清理任务文件。
- 自动验证：新增 **11 项**定向测试，覆盖两页全部关键几何/媒体常量、初始化排序与脏集号、发布 Gate、本地视频 20 项规则、选择顺序/默认标题/删除重排、0–100 价格规则、文件名/MIME/本地投影、上传响应别名、六组精确路由/字段/180s 与 600s 超时、两路并发上限、干净/脏服务端分集，以及失败持久化和重试不重复建系列。最新全量为原图 **51/51**、本地化 **10×1,138**、ESLint 零警告、strict TypeScript、**41 suites / 248 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（**3,114 modules、74 packaged assets、11,005,813-byte bundle**）。本轮新增原生 `expo-blur ~57.0.2`，首个包含它的安装包必须重新构建且会进入新的 fingerprint runtime；另在独立 `/tmp` 生成 iOS 工程、安装 Pods 后完成 arm64/x86_64 Simulator Debug 全量 Xcode 编译，日志明确 `BUILD SUCCEEDED`，产物含 `libExpoBlur.a`、`libEXUpdates.a` 与 `EXUpdates.bundle`。这仍不是模拟器运行或像素验收。
- 仍未完成：真实图片/视频选择的权限、HEIC/48MP/4K/超长视频、存储不足和内存极限；App 被 iOS 挂起/杀进程后的原生后台续传、系统完成回调、进度/取消和 `confirmationUnknown`；真实服务端创建/更新/删除/上传/提交、幂等、两路并发和中间失败；原 `ImageCacheManager`/`MediaCacheManager` 对确认媒体的接管；Studio 列表的发布状态、分集状态点、失败任务可见重试入口；SwiftUI Form/page-sheet/键盘/material、暗色/动态字体/VoiceOver/十语言；原生、Expo、差分三图和逐帧转场验收。

## 2026-08-07：ShortDramaSeriesListView 独立推荐/看过列表第一轮源码还原

- 结果：发现页短剧入口已从迁移占位页切换到原版独立短剧系列列表；它与用户公开资料里的作者短剧 Tab、个人页“我的短剧”进入 Studio 是三条不同路径，本轮没有混用。源码审计、首轮功能实现、自动化和 iOS 离线打包层通过；创建编辑器、真实服务端和原生/Expo/diff 截图未验收，因此第 40 项仍为“部分完成”，当前像素级完成仍为 **0/47**。
- 页面/卡片契约：恢复 transparent inline 导航、36×36pt/17pt semibold 返回键、196pt 原生 segmented 推荐/看过双 Tab、34×34pt/18pt semibold 创建键；列表为 secondary background、16pt 外距、14pt 卡距，加载/更多为 28pt padding，空态为 34pt semibold Symbol、12pt 间距/80pt 顶距，非空错误使用顶部 8pt 红色 capsule。系列卡恢复 14pt 内距/16pt 圆角/0.7 separator 描边、10pt 标题区距、17pt 两行粗体标题、131pt/12pt 圆角海报和原三色对角渐变、三行 15pt 简介；创作者区恢复 14pt 顶部分割、10pt 顶距/横距、44pt 头像与 14pt medium 单行文案。
- 分集/导航契约：系列总集数取服务端总数和已载入数组较大值；每页严格 15 集、范围使用 `1 – 15` 格式、20pt 间距/5pt 文案距/16pt semibold、76pt 最小宽度、38×3pt 下划线、底部 12pt；5 列 8pt 间距、44pt 高/8pt 圆角方格，缺失分集为 tertiary 文案，收费分集右上 9pt lock/6pt inset，缺集加载器缩放 0.65。挂载时发现服务端只给部分 episodes 会静默 GET detail 并按 ID 合并；点击缺失 slot 会等待补载后按数组索引打开。点系列恢复本地 episode/position，直接点分集从 0 开始，创作者头像进入真实公开资料。
- 数据/缓存契约：精确接入 `GET /short-drama/series?tab={recommended|watched}&limit=12[&cursor]`；两个 Tab 独立懒加载、下拉强制刷新、末系列触发游标分页、按 series ID 保留首项去重。缓存按账户＋Tab 隔离，TTL 5 分钟、陈旧保留 30 天、最多 200 条；无可用系列缓存且新接口失败时请求旧 `/short-drama/feed?limit=60`，按 drama ID（空时 video ID）分组并按集数排序，“看过”只保留本地历史并按 `watched_at` 倒序。播放器保存账户观看历史后广播，两个 Tab即时覆盖 resume episode/position/time，“看过”重新排序。
- 自动验证：新增 **8 项**测试覆盖全部导航/卡片/分集/缓存常量、分集排序与 ID 覆盖、15 集 slots/range/缺集、series 去重、旧 feed 分组与历史覆盖、精确 query、账户＋Tab 隔离 5 分钟/30 天/200 条缓存，以及历史校验/保存/广播。最新全量为原图 **51/51**、本地化 **10×1,138**、ESLint 零警告、strict TypeScript、**39 suites / 237 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（**3,103 modules、74 packaged assets、10,922,859-byte bundle**）。原工程 tracked/staged 零改动，副本原生目录逐文件一致，Expo 工作区没有生成 `ios` 目录。
- 仍未完成：创建按钮对应的 `ShortDramaUnifiedEditorView` 仍是占位目标；同 Swift 文件中给 Studio 卡片复用的 publish status pill 和分集左下状态点尚未迁；RN `FlatList` 末端回调与 Swift 最后一卡 `onAppear`、range 颜色/下划线 180ms ease-in-out 仍需逐帧差分；真实推荐/看过接口、旧 feed 降级、缓存新鲜/陈旧、跨账号历史、缺集 detail、深链/支付/401/弱网、暗色/动态字体/VoiceOver/十语言；原生、Expo、差分三图与转场验收。

## 2026-08-07：ShortDramaFeedView / ShortDramaVideoPage 播放部分第一轮源码还原

- 结果：旧 Expo 的“9:16 单集播放器＋剧集按钮”已替换为全屏纵向分页 feed，Action Rail 与底部 metadata 已按原版全屏结构重排；源码审计、首轮功能实现、自动化和 iOS 离线打包层通过，但真实媒体/支付/弱网与原生/Expo/diff 截图均未验收，同一 Swift 文件中的 Studio/编辑上传区也未迁，因此两页仍是“部分完成”，当前像素级完成仍为 **0/47**。
- 页面/播放契约：恢复黑色全屏页、隐藏系统导航栏、42pt 返回圆钮、18pt bold chevron、17pt 居中标题、14pt 横距/安全区后 8pt 顶距；纵向分页只给当前页前后各一页准备媒体。播放器使用 aspect-fill、无系统 controls、loop、非静音/音量 1、3 秒前向缓冲和 >1 秒续播；仅同源、同端口且位于 API base path 内的媒体附 Bearer。封面首帧前保持显示，无图/失败时使用 `#171725→black` 背景，首帧后 180ms ease-out 渐隐；恢复中心 loading、全屏点按暂停、74pt 圆形/28pt play/18% 描边/45%-16pt-6pt 阴影及 180ms 显隐。锁卡为 24pt 图标、9pt 间距、18×14pt 内距、14pt 圆角、58% 黑底及 36pt 外约束。
- 底部/生命周期契约：恢复底部 16pt 横距/28pt 底距与 14pt metadata-action rail 间距；作者/剧名/简介为 16/17/14pt bold/bold/medium，剧名 2 行、简介 3 行，集数 pill 12pt/10×5pt/16% 白底，分集标题 12pt semibold，并保留原黑色文字阴影。滚动过半切换播放目标，切页、手动暂停、路由离焦和 App 后台均暂停并记录；回前台/回焦点按手动暂停状态恢复。
- 数据/缓存/支付契约：新增 FeedPage/UnlockResult 全部 `videos/items/list/feed/cursor` 与 `video/episode` 别名；系列模式继续 GET detail，推荐模式精确 GET `/short-drama/feed?limit=12[&cursor]`，到最后 3 条触发；首载过滤规则保留“有播放 URL 或需解锁”，按集数再 ID 排序，加载更多则按源码只收有 URL 且不在既有 ID 的项。feed 缓存按账号＋series/recommended 隔离，TTL 5 分钟、陈旧保留 30 天、最多 200；新鲜缓存不请求，陈旧请求失败回退。进度切换时写账户观看记录，变化不足 0.75 秒不报，POST `/progress` 固定 4 秒；解锁先读/刷新 spendable，余额不足进入钱包，否则 request header/body 复用同一失败保留 UUID，成功用 episode 或本地 unlocked 回写并缓存服务端钱包。点赞、同作者关注和评论计数继续乐观同步。
- 自动验证：新增 **8 项**测试覆盖全部 pager/overlay/cache/progress 常量、HLS→play-HLS→MP4→play 优先级、锁定判断、首载过滤排序、三页媒体窗口、尾部 3 条分页、源码中首载与追加过滤差异、0.75 秒边界、同源 API path 鉴权、Feed/Unlock 别名和混合扣款、三个精确请求、账户/系列隔离 5 分钟/30 天/200 条缓存及新鲜/陈旧回退。最新全量为原图 **51/51**、本地化 **10×1,138**、ESLint 零警告、strict TypeScript、**38 suites / 229 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（**3,100 modules、74 packaged assets、10,884,706-byte bundle**）。
- 仍未完成：UIKit `UIPageViewController` 与 RN `FlatList` 的翻页启动/取消/惯性手感；原 `MediaCacheManager` 显式调度/取消、HLS 音轨探测和 MP4/play/HLS 保时回退、0.35 秒/尾端 0.25 秒双循环保险、后发进度任务真实取消；推荐 feed 产品入口；同文件 Studio 列表/详情、系列编辑、分集上传/编辑/删除/提交；真实推荐流/系列/点赞/关注/评论/进度/余额/幂等支付、401 刷新、弱网/损坏视频/长视频、前后台和账号切换；评论 `.medium/.large` detents、十语言长文案/VoiceOver；原生、Expo、差分三图与逐帧转场验收。

## 2026-08-07：ShortDramaActionRail / ShortDramaCommentsSheet 第一轮源码还原

- 结果：系列详情播放器已叠加真实 Action Rail，评论按钮进入真实评论 page-sheet；源码审计、功能实现、自动化和 iOS 离线打包层通过，但父级 ShortDramaFeed 仍不是原版全屏竖滑结构，真实互动与截图差分也未验收，因此两组件仍标记“部分完成”，当前像素级完成仍为 **0/47**。源码复核同时纠正旧清单：原 Action Rail 只有作者/关注、点赞、评论，没有分享或更多按钮。
- Action Rail 契约：恢复 58pt rail、18pt 组距；作者区 6pt 间距、48pt/11pt 连续圆角头像、2pt 白描边，非本人显示 26pt 圆形关注钮与 13pt bold plus/check。点赞/评论恢复 27pt bold SF Symbol、44×34pt footprint、5pt 文案距、11pt bold/54pt 计数、0.72 最小缩放，以及 45% 黑/8pt/2pt 阴影；计数严格按 ≥1,000 K、≥10,000 W、≥1,000,000 M 和一位小数去 `.0`。点赞/取消走乐观状态和计数/失败回滚；关注/取消关注同步同作者全部分集并失败回滚；头像进入真实 UserProfile。
- Comments Sheet 契约：恢复 18×14pt header、17/13pt 标题计数；列表 18×10pt，加载顶距 40，空态 30pt 图标/10pt 间距/48pt 顶距；行 36pt 头像、10pt 横距、4pt 文案距、8pt 头距、13/11/14pt 字号与 10pt 纵距；composer 为 16×12pt/10pt 间距，输入 15pt、14×10pt、18pt 圆角/1–4 行，发送 44×38pt/16pt 图标。原 `.medium/.large` detents 当前由 pageSheet 承载，错误 toast 为默认 2 秒。
- 数据/缓存/行为契约：补齐 Comment/CommentsPage/InteractionResult 与 `comment_id/text/items/list/cursor`、numeric ID、camel/snake 归一化。精确接入 POST/DELETE `/short-drama/videos/{id}/like`、GET `/comments?limit=30[&cursor]`、POST `/comments`。评论缓存按账户＋视频隔离，TTL 60 秒、陈旧保留 30 天、最多 200；缓存优先，陈旧刷新失败保留缓存且不报错。分页仅过滤已存在 ID，保留原版同页重复行为；发送先清输入并头插本地 UUID，成功替换/加计数/持久化，失败删除并恢复内容；评论用户关闭 sheet 后 220ms 进入资料页。
- 自动验证：新增 **8 项**测试覆盖 Action Rail 全几何、K/W/M 边界、评论 sheet/row/composer 全几何与缓存常量、评论和互动别名、原版分页去重与今天/昨天/MM/dd 时间、账户隔离 60 秒/30 天/200 条缓存、like POST/DELETE fallback，以及评论 limit→cursor 查询顺序与发送 body。最新全量为原图 **51/51**、本地化 **10×1,138**、ESLint 零警告、strict TypeScript、**37 suites / 221 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（**3,097 modules、74 packaged assets、10,850,490-byte bundle**）。
- 仍未完成：原版 ShortDramaFeed 全屏竖向 pager、Action Rail 与底部 metadata 的全屏定位、播放器池/首帧/预载/循环/进度/解锁；真实点赞/关注/评论首载/分页/发送、快速连点乱序与账号切换；`.medium/.large` sheet、系统下拉/键盘、头像鉴权缓存、时间 locale、暗色/动态字体/VoiceOver/十语言；原生、Expo、差分三图截图与转场验收。

## 2026-08-07：ScriptEditorView / ScriptRoleEditorView 第一轮源码还原

- 结果：Script Center 加号与 Script Detail owner 编辑动作已从占位目标切换为真实 Script Editor，角色行进入真实角色 page-sheet；源码审计、功能实现、自动化和 iOS 离线打包层通过，但真实上传/创建/更新和原生/Expo/diff 截图均未验收，因此两页仍标记“部分完成”，当前像素级完成仍为 **0/47**。
- 主编辑器视觉/交互契约：按源码顺序恢复发布设置、封面、标题、简介、分类、世界隐藏设定和角色列表 grouped section；保留 14pt 黑色 semibold section header、180pt 已选封面/150pt 空封面/14pt 圆角、标题 15、简介 500/130pt、世界设定 500/120pt、11pt 计数器、42pt 角色头像、15/12pt 双行说明、最多 12 个角色以及 3.5 秒错误 toast。入口支持完整 script 同步内存桥与直接深链 GET；分类使用账户隔离的一小时缓存并在陈旧时刷新。
- 角色编辑视觉/交互契约：page-sheet 恢复 92pt 头像、2pt accent 描边与 24pt camera；角色名 8 字、原生 menu 性别、公开说明 100/110pt、AI 隐藏设定 500/110pt、取消/保存工具栏和 3 秒校验 toast。选择图按角色 800px/0.8/700KB、封面 1600px/0.82/1.5MB 处理；已满足尺寸/字节的 JPEG 依据原 `FF D8 FF` 魔数避免二次有损编码，其余按初始质量→0.65→0.55→0.45→0.35 与 75% 尺寸逐步压缩至 640px 下限。
- 验证/请求契约：所有文本用扩展字素计数与截断。私人草稿仍执行最大长度/角色性别等基础校验；公开额外要求标题 5–15、简介 20–500、封面、至少一个分类、至少两个角色、所有角色名称/公开说明/头像完整，角色名按大小写和音标折叠后不得重复。请求严格生成 `client_role_id`、可选 `role_id`、numeric category ID；保存固定为封面上传→逐角色头像上传→`POST /scripts` 或 `PATCH /scripts/{id}`，资源 multipart 固定 `business`、`file`、JPEG 文件名/MIME 和 90 秒超时，成功后失效账户目录并广播完整 script。
- 自动验证：新增 **8 项**测试覆盖两页几何/全部上限/上传阈值、家庭 emoji 与组合音标扩展字素、私人/公开校验顺序、大小写与音标折叠重名、角色本地校验、draft 回填与 exact body、create/update 路由，以及 multipart 两字段/文件元数据/90 秒。最新全量为原图 **51/51**、本地化 **10×1,138**、ESLint 零警告、strict TypeScript、**36 suites / 213 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（**3,093 modules、74 packaged assets、10,815,880-byte bundle**）。
- 仍未完成：真实分类/GET/封面与多头像上传/POST/PATCH、服务端验证错误与部分上传失败恢复；SwiftUI grouped Form 的系统 section/row/inset、Toggle、Picker 菜单锚点、`.large` sheet、PhotosPicker 与键盘手感；HEIC/EXIF/48MP/权限/内存极限；暗色、动态字体、VoiceOver、中英文；原生、Expo、差分三图截图与转场验收。

## 2026-08-07：ScriptDetailView 第一轮源码还原

- 结果：Script Center 卡片已从占位目标切换为真实 Script Detail，并从选角创建真实房间后进入现有 ScriptRoomChat；源码审计、功能实现、自动化和 iOS 离线打包层通过，但 ScriptEditor、真实后端与截图差分未完成，因此仍标记“部分完成”，当前像素级完成仍为 **0/47**。
- 视觉/交互契约：恢复 16pt 横距/18pt section 间距/110pt 底部内容留白；封面宽高比 1.55、18pt 圆角、底部 72% 黑渐变、16pt 文案距、25pt 两行标题/13pt 作者。摘要/角色/owner 卡均为 16pt 内距/圆角；状态 badge 11pt/8×4pt；角色行为 48pt 头像、12pt 间距、15/10/13pt 名称/性别/说明。owner 动作为 14pt 纵距、46pt divider 缩进；底部按钮恢复 13pt 圆角/13pt 纵距与禁用 45%。角色详情恢复 92pt 头像/22pt 名称；选角恢复 10pt 间距、48pt 头像、12pt 卡内距/14pt 圆角与 22pt 选择圈。
- 数据/导航契约：补齐 `GET /scripts/{id}`、`PATCH /scripts/{id}`、`DELETE /scripts/{id}` 和 `POST /scripts/{id}/rooms`；创建体仅含 `player_role_id`，请求头使用当前尝试 UUID `Idempotency-Key`，沿用原 15 秒请求基线。目录通过内存桥传完整 script 避免首帧空白，深链回退 GET；owner 身份、ready/非后台隐藏/至少两角色/非工作中 Gate、status/visibility/admin badge 顺序与四类性别文案均按源码。创建成功保存 5 分钟/365 天账户房间缓存、失效 Agent Hub、关 sheet 后 250ms 进入真实房间；visibility/update 用带对象 library-change 触发详情与目录刷新，删除用 ID 事件避免详情错误自刷。
- 自动验证：新增 **6 项**测试覆盖全部源码几何、owner/开始 Gate/角色查找、badge 顺序/色调/性别本地化、同步导航桥、精确 get/PATCH/DELETE 路由，以及房间创建 body/header/响应 conversation。最新全量为原图 **51/51**、本地化 **10×1,138**、ESLint 零警告、strict TypeScript、**35 suites / 205 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（**3,091 modules、74 packaged assets、10,768,006-byte bundle**）。
- 仍未完成：ScriptEditor 仍是占位目标；SwiftUI `.medium/.large` presentation detents 当前由 React Native pageSheet 代替，原生 NavigationStack/toolbar/confirmation dialog 手感未差分；真实详情/可见性/删除/创建房间、服务端验证错误和会话列表刷新未联调；封面裁切/安全区、暗色/动态字体/VoiceOver/中英文；原生、Expo、差分三图截图与转场验收。

## 2026-08-07：ScriptCenterView 第一轮源码还原

- 结果：发现页“互动剧本”已从通用功能占位页切换为真实 Script Center；源码审计、功能实现、自动化和 iOS 离线打包层通过，但详情/编辑目标、真实后端和截图差分未完成，因此仍标记“部分完成”，当前像素级完成仍为 **0/47**。源码复核同时纠正旧清单：“已加入房间入口”属于 Agent Hub，不属于 Script Center。
- 视觉契约：导航栏 principal 使用 `@expo/ui` SwiftUI `Picker` 的 segmented style，恢复 196pt 公开/我的原生分段和 17pt 系统字；加号 18pt/34pt。分类栏恢复 8pt 间距、16pt 横距、10/12pt 上下距、13×7pt 胶囊。内容恢复两列/12pt 间距/16pt 横距/24pt 底距、6 个骨架；卡片为 10pt 内距/9pt 间距/15pt 圆角、0.82 封面/12pt 圆角，10pt badge、15pt 标题、12pt 两行简介/32pt 最小高、最多四个 22pt/-5pt 重叠头像/1.5pt 描边和 10pt 作者。
- 数据/缓存契约：新增 ScriptCategory/Creator/InteractiveScript/Page 类型与严格必需 `script_id/title`、numeric ID、`intro/cover/author/characters` 别名归一化；分类按 `(sort_order,id)` 排序。精确接入 `GET /scripts/categories` 与 `GET /scripts?scope&limit[&category_id][&cursor]`，limit 夹在 1…50、默认 20；公开/我的与各分类独立账户缓存，分类 TTL 1 小时、页面 TTL 5 分钟、陈旧保留 90 天。恢复缓存优先、强制刷新、失效分类回全部、选择竞态丢弃、游标分页、script ID 去重和 library-change 全选择失效。
- 自动验证：新增 **8 项**测试覆盖全部源码几何、numeric/legacy 别名、分类排序、badge 优先级、系统语言中文、分页去重、一小时/五分钟/90 天缓存、账户级失效事件、精确查询顺序/编码/limit 与必需字段拒绝。最新全量为原图 **51/51**、本地化 **10×1,138**、ESLint、strict TypeScript、**34 suites / 199 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（**3,088 modules、74 packaged assets、10,731,975-byte bundle**）。
- 仍未完成：ScriptDetail/ScriptEditor 仍是占位目标；真实分类/公开/我的/游标分页与错误响应、缓存过期/账号切换联调；原 Swift `foregroundStyle` SF Symbol 渐变和完整 skeleton redaction、强制 light toolbar、导航栏 segmented 实机高度、暗色/动态字体/VoiceOver/中英文；原生、Expo、差分三图截图与转场验收。

## 2026-08-07：ScriptRoomChatView 第一轮源码还原

- 结果：Agent Hub 的已加入剧本入口已从占位功能页切换为真实 Script Room Chat；源码审计、功能实现、自动化和 iOS 离线打包层通过，但没有执行真实房间联调和原生/Expo/diff 截图，因此仍标记“部分完成”，当前像素级完成仍为 **0/47**。
- 视觉/交互契约：按 Swift 恢复 14×8pt 横向角色栏、52pt 角色单元、40pt 圆头像、12pt user/AI badge；消息区使用 inverted bottom timeline，14pt 外距/13pt 行距，顶部 96×72pt 剧情头、底部 queued/generating/failed/ended 状态；消息恢复 52pt 侧留白、32pt 角色头像、13×10pt/16pt 气泡、11/8/15pt 名称/AI tag/正文与发送渐变。输入栏恢复 12×9pt 外距、13×10pt/18pt 输入底、1–5 行语义、Swift Character 等价 1000 字上限和 38pt 发送；新消息/回合状态按源码延迟 50ms 后用 200ms ease-out 回底，错误 toast 3 秒。
- 数据/状态契约：新增完整 `ScriptRoom/Role/Assignment/Snapshot/TurnResponse/TurnState` 与群消息 `script_context` snake/camel 归一化；精确接入 `GET /script-rooms/{room}`、`POST /turns`、`POST /turns/{turn}/retry`、`POST /end` 及 WebSocket `script_turn_state`。恢复会话行 provisional 首帧、完整定义才允许发送、账户隔离 5 分钟元数据 TTL/365 天陈旧保留、100 条消息持久缓存、`after_id` 100 条循环增量同步、ID 去重排序、失败输入还原、回合重试、结束后二次确认/只读、活跃群标记与 through-message 已读。
- 自动验证：新增 **7 项**测试覆盖全部源码几何、房间/角色/消息上下文别名、provisional/权威发送 Gate、100 条去重/分组/排序、用户身份与头像优先级、5 分钟/365 天缓存、WebSocket 状态和四个精确接口。最新全量为原图 **51/51**、本地化 **10×1,138**、ESLint、strict TypeScript、**33 suites / 191 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（**3,085 modules、74 packaged assets、10,692,068-byte bundle**）。
- 仍未完成：真实服务端完整房间/增量历史/发送/重试/结束/WS/已读与断网、缓存过期联调；SwiftUI `Menu` 的锚点式弹出目前仍由系统 Alert 动作菜单替代；provisional→权威房间首帧、极端长消息/历史、键盘/安全区/暗色/VoiceOver/中英文本地化；原生、Expo、差分三图截图与转场验收。

## 2026-08-07：AgentCreatorView 第一轮源码还原

- 结果：Agent Hub 的创建按钮和 owner 长按编辑已从占位功能页切换为真实 Agent Creator；源码审计、功能实现、自动化和 iOS 离线打包层通过，没有执行真实后端全事务和逐屏截图 diff，因此仍标记“部分完成”，当前像素级完成仍为 **0/47**。
- 视觉/表单契约：恢复创建/调整标题、创建/保存尾按钮及 0.8 倍进度；按原顺序建立视觉形象、名称、一句话、描述、标签、语言、可见性、身份、性格、语气、回复长度、开场白、关系、称呼、成人互动、亲密风格、主动程度、图片能力、视频能力与错误共 19 个 Form section。参考图恢复 64pt、12pt 圆角、1pt/16% accent 描边、14pt 行距、15/12pt 双行说明和 22pt photo 图标；section header 为原 14pt semibold/black/textCase nil。菜单与开关使用 `@expo/ui` 原生 SwiftUI Picker/Toggle，视频开关固定关闭且 disabled。
- 字段/默认契约：完整保留 `companion` 标签、`zh-CN/private`、`温暖, 细心`、`warm/medium/companion/natural`、adult=false、`romantic/responsive`、`你好`、paidImages=true 默认值；语言为中/英/日，可见性 private/unlisted/public，语气四档、长度三档、关系七类、亲密四档、主动三档。编辑按 definition 优先、summary 回退填充；名称/介绍/描述/身份/开场白按源码 trim，标签与性格同时按中英文逗号拆分并过滤空值，address style 保留原值；definition 固定写入空 example dialogues、visual identity 描述与 paid video/sticker/reward/proactive=false。
- 图片/事务契约：PhotosPicker 等价入口先校验短边 ≥512、比例 0.5–2，再转 JPEG 0.92；上传阶段先在 ≤1600px 且 ≤2MB 时保留，否则按 1600→1200→900→675→640 和 0.82/0.65/0.55/0.45/0.35 逐步 JPEG，精确 POST `/agent-assets/reference-images` 的 `image/agent-reference.jpg/image/jpeg`、90 秒与 `Idempotency-Key`。随后创建模式精确 POST `/agents`，编辑模式精确 PATCH `/agents/{id}/draft` 的 `expected_revision/patch`，再 POST publish、install，创建模式尽力创建第一 greeting 会话；上传/创建/发布/会话四个 UUID 在失败重试间各自保留。服务端 `6002` 会 GET 最新 Agent、覆盖表单并显示原冲突文案。
- 导航/缓存契约：Hub 在进入编辑前以内存桥传完整 installed summary，避免路由只带 ID 导致空表单闪烁；直接深链仍可 GET Agent。保存安装成功后失效当前账号 5 分钟 Hub 快照，返回时重新并行加载；键盘支持交互式滚动收起、外部点击收起和离页收起。
- 自动验证：新增 **7 项**测试覆盖参考图全部几何/校验/压缩/上传常量、19 字段默认及保存 Gate、完整 definition payload/trim/中英文逗号、definition 优先回填、编辑内存桥、multipart 与四个 get/create/revision patch/publish 精确协议。最新全量为原图 **51/51**、本地化 **10×1,138**、ESLint、strict TypeScript、**32 suites / 184 tests**、Expo public config；iOS Hermes export 成功（**3,081 modules、74 packaged assets、10,640,249-byte bundle**）。
- 仍未完成：真实后端上传→草稿→发布→安装→首会话全链和各中间失败恢复；HEIC/EXIF/超大图内存、恰好 512/2MB/比例边界真机；系统 Form 默认边距、TextField 动态高度、原生菜单/开关、暗色 black header、键盘、VoiceOver 与十语言；原生/Expo/diff 三图截图和转场验收。

## 2026-08-07：AgentHubView 第一轮源码还原

- 结果：发现页与个人页的智能体入口已切到真实 Agent Hub；源码审计、功能实现、自动化和 iOS 离线打包层通过，没有执行真实账号/后端和逐屏截图 diff，因此仍标记“部分完成”，当前像素级完成仍为 **0/47**。源码复核同时纠正旧清单：原 `AgentHubView` 不请求也不展示公共 Agent，本页实际聚合运行时配置、已安装 Agent、Agent 会话、已加入剧本和钱包 spendable 余额。
- 视觉契约：恢复居中 17pt semibold 标题、16pt semibold 加号及创建智能体无障碍标签；列表恢复 16pt 外距、12pt section/card 间距、60pt 底部留白、13pt section 标题/4pt 顶距、14pt 卡内距与圆角；Agent/会话头像为 54/50pt，默认圆角为尺寸 22%，原 accent gradient+sparkles 占位；剧本头像 54pt/11pt 圆角；恢复 16/13/11pt 文案、10pt tag/7×3pt padding、聊天尾标、70pt 空态、44pt 创建胶囊以及 12pt 内距/16pt 外距/12pt 圆角的底部错误 banner。
- 数据与行为契约：首载并行请求 `/agents/runtime-config`、`/agents/installed`、`/agent-conversations`、`/chat/conversations` 与 `/wallet/balance`；使用 `Promise.allSettled` 保留任一成功分支并展示首个错误。账户隔离 Hub 快照使用原 5 分钟 TTL/90 天陈旧保留；前台每 5 分钟刷新运行配置。剧本行只接受规范化 `script_room` 且有 room ID 的会话，兼容 ISO 与后端无时区 SQL 时间，按 room 保留最新并稳定倒序；预览按原版让已完成 input/付费媒体优先于同消息文字。打开 Agent 优先复用最新未关闭会话，否则使用第一 greeting 创建；失败期间同一 Agent 保留幂等 UUID，服务端 6000–6399 能力错误会重载运行配置；卸载精确 DELETE `/agents/{encoded id}/install` 并同步快照。
- 导航/状态契约：实现初始加载、缓存优先、下拉刷新、部分成功、空列表、错误关闭、打开中禁用/进度、移除中禁用、长按 owner 编辑与所有 Agent 卸载；创建/编辑现已进入真实 AgentCreator，剧本房间聊天现已进入真实 ScriptRoomChat。两者仍各自保留视觉/真实后端缺口，不把入口可点击当成像素验收通过。
- 自动验证：新增 **5 项**测试覆盖全部几何/刷新常量、媒体预览优先级、SQL/ISO 时间比较与剧本去重排序、5 分钟/90 天/账号隔离缓存、运行配置/安装列表/卸载/幂等创建的精确协议及 capabilities 解码。最新全量为原图 **51/51**（聚合 `295154cd...6362`）、本地化 **10×1,138**（聚合 `d3b5e6ae...dc6e`）、ESLint、strict TypeScript、**31 suites / 177 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（**3,078 modules、74 packaged assets、10,604,351-byte bundle**）。
- 隔离证据：原工程 tracked/staged diff 为零；桌面独立副本仍在 `codex/hot`；两边 HEAD 同为 `0830c012...`，两个 `BWChat` 原生目录 `diff -qr` 零差异；实际 Expo 工作区没有生成的 `ios` 目录。原工程原先已有的 untracked MentionPicker/artifacts/tmp 未被本轮改动。
- 仍未完成：真实五接口成功/部分失败/6000–6399 错误/账号切换联调；AgentChat 对 runtime/spendable 全能力消费；SwiftUI context menu 与 Alert 长按动作的原生手感差分；暗色、VoiceOver、十语言长文案、后台前台边界；原生/Expo/diff 三图截图与转场验收。

## 2026-08-07：EditProfileView 第一轮源码还原

- 结果：资料主页“编辑资料”已从占位入口切换为真实编辑页；源码审计、功能实现、自动化和 iOS 离线打包层通过，没有执行真实账号和逐屏截图 diff，因此仍标记“部分完成”，当前像素级完成仍为 **0/47**。
- 视觉契约：恢复 88pt 头像、6pt/3pt accent 阴影、28pt 相机角标/12pt 图标、20pt 顶距、12pt 头像文案间距、24pt section 间距；表单恢复 16pt 外距、14pt 圆角、4pt 纵向 padding、96pt/15pt medium 标签、15pt 值、每行 16×18pt padding、16pt 缩进分隔线；签名恢复 1–3 行、5pt 间距、11pt medium 等宽计数及达到上限变 warning；生日卡恢复 wheel DatePicker、16pt padding、8pt 间距、14pt 清除/完成；错误 toast 恢复 14pt medium、20×10pt padding、75% 黑、20pt 圆角、底部 30pt、2.5 秒。
- 行为契约：从 Auth 缓存立即填充；签名按 Swift `Character` 的扩展字素而不是 UTF-16 截至 150；生日用 Gregorian/POSIX `yyyy-MM-dd` 归一化，兼容 ISO 前 10 位、无值默认当前日期减 18 年、禁止未来日期；性别只接受 unset/male/female/other。保存精确 PUT `/profile/me` 并完整发送 nickname/bio/gender/birthday/location；头像精确 POST `/profile/avatar`，multipart 字段 `image`、文件名 `avatar.jpg`、MIME `image/jpeg`、90 秒超时，成功后重载 `/profile/me`、清内存/磁盘图片缓存并同步 Auth 用户。
- 自动验证：新增 **6 项**测试覆盖全部几何/动画常量、家庭 emoji 与组合音标的扩展字素计数、生日合法/非法/ISO/清空/18 年默认、原值保留、五字段 PUT 和头像 multipart。最新全量为原图 **51/51**、本地化 **10×1,138**、ESLint、strict TypeScript、**30 suites / 172 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（3,075 modules、74 packaged assets），原生 provider 已注册 `ExpoUIModule`。
- 隔离证据：原工程 tracked/staged diff 为零；桌面独立副本仍在 `codex/hot`；两个 `BWChat` 原生目录 `diff -qr` 零差异；实际 Expo 工作区没有生成的 `ios` 目录。
- 仍未完成：真实账号资料/头像联调；PHPicker 的 HEIC/超大图/权限边界和保存竞态；不同 locale 的原生滚轮、键盘、暗色/VoiceOver；原生/Expo/diff 三图截图与转场验收。

## 2026-08-07：WebSocket / 已读回执 / 普通好友与群组通话第一轮还原及原生编译验收

- 结果：WebSocket、私聊/群聊单调已读、普通好友与群组 LiveKit 通话已经完成源码、功能、自动化和本地原生编译层验收；没有真实双设备/后端/EAS/逐屏截图证据，所以仍全部标记“部分完成”，当前像素级完成仍为 **0/47**。
- 实时契约：access token 只保留一个 query 值；收到首个服务端消息后才进入 connected；15 秒 ping、45 秒健康检测、1/2/4…30 秒指数重连、token close 后 verify 再连、前台立即重连、账号登录/退出启停。事件覆盖 dm/group 新消息、已读、群清历史、会话偏好、群移除/改名、ChatMoney 消息/回执、通话信令和会话刷新；已读分别精确 POST 私聊/群聊 read 路由，并按账号＋会话维护只增不减的 through message ID。
- 通话契约：接入普通好友 start/join/end/reject/busy 与群 start/leave/status 原路由；兼容 voice/audio、room/livekit token/server alias 和 ws/wss 规范化；接入 WebSocket/通知呼入、重复邀请/占线、45 秒拨号超时、麦克风/摄像头权限。UI 覆盖语音头像舞台、远端/本地视频、群语音/视频网格、参与者/发言状态、连接/重连/弱网/时长、静音/扬声器/摄像头/翻转/最小化/结束。
- 原生音效：`bwchat-call-sounds` Expo module 原样使用原 `CallManager.swift` 的拨出 SystemSound 1151、来电 1005 和系统震动；全新临时 prebuild 中 Expo Autolinking 找到 `BWChatCallSounds`，CocoaPods 安装 149 dependency / 151 Pods，生成 `ExpoModulesProvider.swift` 导入并注册模块，arm64 Simulator App 与模块静态库均成功编译链接且模块符号可见。
- 自动/构建证据：原图 **51/51** 聚合 `295154cd...6362`；本地化 **10×1,138** 聚合 `d3b5e6ae...dc6e`；ESLint、strict TypeScript、**29 suites / 166 tests**、Expo public config、Expo Doctor **20/20**；iOS Hermes export 成功（3,073 modules、74 packaged assets）；Xcode Debug `xcodebuild` 退出码 **0**，产物为 arm64 Mach-O `BBchatdevelopment.app`、bundle ID `com.bwchat.app`。
- 隔离证据：原工程 tracked/staged diff 为零；独立副本为桌面 `BWChat-Expo-HotUpdate` 的 `codex/hot`；两边 HEAD 同为 `0830c012...af221`，两个 `BWChat` 原生目录 `diff -qr` 零差异；实际 Expo 工作区没有生成的 `ios` 目录。原工程原先已有的 untracked MentionPicker/artifacts/tmp 未被改动。
- 仍未完成：真实服务端断线/乱序/重复/跨设备事件；真实 APNs/后台/锁屏；双设备好友通话、多人群通话、音频路由、中断与弱网；billing/余额宽限/角色质量、CallKit、完整 PiP；Sentry source map（org/project/secret 尚缺）；真实 EAS project/build/update/rollback；暗色、VoiceOver 及 47 页原生/Expo/diff 三图验收。

## 2026-08-06：GroupChatView @原子 token / GroupMessageSearchView 第一轮还原

- 结果：群聊 @成员编辑模型、选择器、草稿/发送链路，以及群消息筛选搜索/回原消息定位已完成代码与自动化层验收；没有执行原生/Expo 逐屏截图 diff，仍标记“部分完成”，当前像素级完成仍为 **0/47**。
- @行为契约：按 Swift `MentionKind/MentionSpan/MentionDocument` 使用 JS 原生 UTF-16 索引，direct/all span 不包含尾随空格；选中时按顺序替换触发 `@`，编辑 span 内部或删除尾随 separator 会整段删除，前置编辑会精确平移未触及 span；只有开头或空白后独立 `@` 打开选择器。发送唯一排序 `mentions` 与 `mention_all`，文稿和引用共同保存；cache-first 成员加载、排除自己、字段补全/去重、群主/管理员 `@所有人`、单选立即返回、多选顺序插入、点击收到消息昵称插入均已接入。
- 搜索行为契约：入口按原版同时受 `group_info_v2` 与 `group_message_search_v1` 控制；接入 `GET /groups/{id}/messages/search`，固定 `q`、1...100 的 `limit`（默认 30）、可选 `sender_id/message_type/from/to/cursor` 顺序与 ISO8601 日期；恢复 350ms 可取消防抖、空输入/加载/无结果、all/text/image/video/voice/sticker/gift/file/system 九类型、发送者/日期 Form、日期 min/max、游标分页和 message ID 去重。结果恢复 42pt 头像、发送者/详细时间、三行预览、媒体本地化和点击后跨群详情页返回群聊并加载 20+20 上下文定位。
- 数据契约：迁移 `GroupMessageLocator/SearchResult/SearchPage`，兼容 `results/messages`、snake/camel locator/highlight/cursor/has-more，缺 locator 时回退消息 ID/history sequence；定位总线同时支持搜索页先发请求、群聊后恢复订阅和正在显示时即时定位，并按 group ID 隔离。
- 自动验证：原图 51 文件聚合哈希与源完全一致；本地化 10×1,138 条逐值一致；ESLint、TypeScript、**26 suites / 146 tests**、Expo public config、Expo Doctor **20/20**、iOS Hermes export（2,813 modules，8,425,012 bytes）全部通过。
- 仍未完成：React Native `TextInput` 没有 UIKit `markedTextRange` 的公开等价物，中文/日文 IME 组合态必须真机确认；成员 Picker、系统搜索栏、日期 Form、键盘、返回层级、错误 Alert、暗色/VoiceOver 仍需与 Swift 原版逐帧对照；搜索服务端和两个远程 flag 尚未用真实账号联调；最终截图 diff 未执行。

## 2026-08-06：ChatView / GroupChatView 回复、撤回、长按菜单、多选与转发第一轮还原

- 结果：私聊和群聊已接入回复、撤回与重编辑、长按菜单、本地删除、最多 99 条多选、逐条/合并转发以及合并记录详情。源码审计、功能实现、静态检查、单元/契约测试和 iOS 离线导出均通过；本轮没有启动模拟器，也没有完成原生/Expo/diff 截图，因此两个页面继续是“部分完成”，像素级完成页仍为 **0/47**。
- 回复/定位契约：原版 `ReplyPreviewBar.swift` 的文字 3×36pt 指示条、44pt 图片缩略图、图片引用 2.5×75pt 指示条/56pt 缩略图均已映射；文字和贴纸发送保留 `reply_to_id` 与 embedded reply，回复随账号＋dm/group 草稿共同保存和恢复。时间线优先使用 embedded reply，没有时按 `reply_to_id` 回查；目标不在当前页时分别请求 `/chat/messages/{contact}/{message}/context?before=20&after=20` 与 `/groups/{group}/{message}/context?before=20&after=20`，再滚动并高亮。
- 撤回/菜单契约：恢复 recalled/withdrawn/message-recalled 等别名和空 system 撤回；只有本人 text/image/video/voice/sticker 且发送时间相对当前在 -300…120 秒内可撤回，分别精确 POST 私聊/群聊 recall 路由；仅本机发起的文字撤回保留“重新编辑”。长按恢复 0.45 秒、允许移动 20pt、中等触觉；菜单恢复 58×56pt 单元、6pt 内边距、最多四列、14×7pt 箭头、10pt 屏幕边距和按消息类型排序的 copy/retry/forward/save/reply/recall/delete/multi-select。账号＋会话隔离的本地删除 ID 会参与首载、分页和上下文过滤，乐观负 ID 不会被错误隐藏。
- 多选/转发契约：可选消息排除 system/recalled/call record/chat-money receipt 和乐观发送行；选择按时间再按 message ID 排序，最多 99 条，退出/返回会先结束选择模式。恢复 24pt 选择圈/44pt hit area、58pt 工具栏、20pt 图标/12pt 标签、删除确认；单条/逐条/合并模式分别执行原版资格规则并携带 source `expected_version`。转发目标按好友后群组组合、搜索、单选/多选、最多 9 个；群目标恢复由 1–9 位真实成员组成的 42pt 九宫格头像并 cache-first 刷新。请求精确 POST `/chat/forwards`，body 使用 snake_case，`Idempotency-Key` 与 `client_operation_id` 相同；合并记录严格解析 chat_history/forward_bundle JSON，并通过导航栈 GET `/chat/forward-bundles/{encoded id}` 展示详情。确认页恢复 310pt、36×5pt handle、16pt 间距、20pt 横距及 12pt/10pt 预览内边距/圆角。
- 自动验证：新增回复/菜单 9 项与转发 9 项测试，覆盖几何、动作顺序、撤回边界/别名、草稿兼容、删除隔离、call record 排除、99/9 上限、资格与排序、严格 bundle 解析、精确路由/body/header 和响应归一化。最新全量结果为：原图 **51 files**、聚合 `295154cd...6362`；本地化 **10×1,138**、聚合 `d3b5e6ae...dc6e`；ESLint、strict TypeScript、**24 suites / 132 tests**、Expo public config、Expo Doctor **20/20**；iOS export **2,721 modules**、Hermes bundle **8,265,178 bytes**。
- 隔离证据：原工程 `/Users/wegpt.com/Desktop/BWChat-iOS` tracked diff 为零；独立副本位于 `/Users/wegpt.com/Desktop/BWChat-Expo-HotUpdate` 的 `codex/hot`，原生 tracked diff 为零；两个 `BWChat` 原生目录 `diff -qr` 零差异。原工程里原先已有的 untracked MentionPicker/artifacts/tmp 没有被本轮改动。
- 仍未完成：真实生产 reply/context/recall/forward 响应和业务错误联调；WebSocket 收消息、撤回、chat-money update 与跨设备版本事件；本地删除对会话列表预览/全部缓存的统一更新；React Native 与 UIKit 长按触控归属和箭头定位、原版 1.5 秒保持＋0.5 秒淡出；暗色、VoiceOver、极端十语言/超长好友群列表；以及原生、Expo、差分三图最终像素验收。

## 2026-08-06：ChatMoney 红包/转账创建、气泡、开封与详情第一轮还原

- 结果：私聊和群聊 plus 面板的红包/转账入口已从迁移提示切换为真实链路；消息时间线、会话预览、回执、创建、领取、收款、退回和详情均有可运行 Expo 实现。源码审计、功能实现和代码级自动检查已通过，但没有运行模拟器截图差分，所以 `ChatView`、`GroupChatView`、`MessageBubble` 与三个 `ChatMoney*Views` 仍全部标记“部分完成”，像素级完成页仍为 **0/47**。
- 模型/安全契约：迁入 `red_packet/transfer`、`dm/group`、`direct/lucky/equal/exclusive`、六种资产状态、十二种 viewer state 和七种 unavailable reason；消息 JSON 只接受直接对象且必须有 asset/kind/scope/sender，红包金额不保留也不编码，只有转账消息公开 `amount`。兼容 snake/camel、direct/private、redPacket/redpacket/packet、expired/refunded 等原别名；回执支持最多四层 `content/payload/data/receipt/receipt_message/receiptMessage/event`，并恢复角色相关多语言文案与 asset ID 类型回落。
- 创建/接口契约：配置精确 GET `/wallet/chat-money/config` 且失败关闭；红包精确 POST `/wallet/red-packets`，转账精确 POST `/wallet/transfers`，保留失败重试期间同一 `client_message_id`；详情/领取/收款/退回精确使用 `/wallet/chat-money/{asset}`、`/wallet/red-packets/{asset}/claim`、`/wallet/transfers/{asset}/accept|return`。群转账先选择收款人；红包支持拼手气、等额和专属，保留金币余额、人数、金额、每份至少 1 金币、配置上限和群成员上限校验。
- 本地状态契约：账号隔离保存已领取 asset 与金额/昵称/头像/时间元数据、转账 accepted/returned 终态；领取记录按用户只增不减，同版本合并，旧版本不覆盖，终态强制关闭 claim/accept/return。领取中等触觉并保证至少 750ms 翻转，成功/失败通知触觉；创建响应不插乐观资金消息，服务端确认消息才进入时间线。
- 视觉参数：恢复 245pt 气泡、红包 78+28pt/6pt、转账 74+28pt/5pt、44×48pt 红包图形、42pt 转账圆形、原 `#FA9D3B/#F6C58E/#D95940/#C94B38/#F4D49B`；创建页恢复 16pt 横距、64/56pt 行、188×48pt 按钮和 350ms 聚焦；开封恢复 52% 遮罩、最大 340pt、430–550pt 高、92pt 开按钮、720°/750ms 翻转、182pt 红弧头、58pt 已领金额、68pt 领取行；转账详情恢复 64/62pt 状态图形、48pt 金额、52pt 收款按钮及钱包中心。
- 自动验证：新增 9 项测试，覆盖全部几何/颜色常量、金额隐私、别名/严格解析、配置与详情、输入边界、信封权限、嵌套回执/角色文案、领取记录合并及全部精确接口。原图 51 文件与本地化 10×1,138 条哈希、ESLint、TypeScript、**22 suites / 114 tests**、Expo public config、Expo Doctor **20/20** 与 iOS export（**2,714 modules，8,153,006-byte bundle**）全部通过。
- 仍未完成：真实生产配置/创建/领取/收款/退回及业务错误联调；WebSocket `chat_money_updated`、15 秒心跳与跨设备版本事件；当前钱包/账单还是现有迁移入口；系统导航栈/原生 confirmation dialog 与 React Native 全屏 Modal 的最终手感差分；暗色、VoiceOver、极端十语言文案、收款人超长列表，以及原生/Expo/diff 三图像素验收。

## 2026-08-06：GiftViews / ChatView / GroupChatView 礼物全链路第一轮还原

- 结果：私聊和群聊 plus 面板的礼物入口已从“仍在迁移”提示升级为真实选择页；服务端 gift 消息已从通用 `[礼物]` 占位升级为原版 232pt 礼物卡。源码可确定的目录、余额、收礼人、发送、动画和气泡已迁入并通过代码级自动检查，但这不是像素验收；尚未运行模拟器截图差分，因此 `GiftViews`、`ChatView`、`GroupChatView` 与 `MessageBubble` 仍标记“部分完成”，像素级完成页仍为 0/47。
- 目录/资产契约：原样迁入 `fish_10/10/gift_fish`、`wand_20/20/gift_wand`、`yarn_50/50/gift_yarn`、`can_100/100/gift_can`、`tree_200/200/gift_tree`、`bell_500/500/gift_bell` 六档目录及多语言名称；兼容原 snake/camel 字段、仅 `gold_coin` 收礼、active/sort order、退役 `game_entry_card/prop_game_entry_card` 过滤和固定目录回落。六张礼物图、`gift_whimsical_arrow` 1x/2x/3x、`wallet_gold_coin_badge` 与 `activity_cat_food_icon` 全部继续引用 byte-for-byte 原图；远程礼物 key 复用 HTTPS/MIME/8 MiB/字节数/SHA-256 校验缓存。
- 选择页契约：恢复群成员先选页、排除自己、群详情 cache-first/服务端更新、42pt 头像/14pt 卡/10pt 行距；礼物页恢复 34/31pt 猫粮余额图、12/22/11pt 余额层级、30pt 收礼人摘要、三列 10pt 网格、52pt 礼物图、13/12pt 名称和价格、16pt 卡圆角、1.6+0.8pt 双描边、1.012 spring、48pt 发送按钮。余额使用 `spendable_balance` 并显示猫粮+金币拆分；不足时先收页、250ms 后进入钱包，发送页生命周期只跟随 1.2s 本地动画，不等待网络。
- 消息/发送契约：兼容固定 gift ID、直接 JSON 及 `gift/payload/data/item/content/message` envelope，迁入 gift/name/asset/amount/currency/收礼人/发送人全部别名与 legacy “礼物”本地化。直聊精确 POST `/chat/messages/gift`，群聊精确 POST `/groups/{id}/messages/gift`；请求体都同时含 `recipient_id/receiver_id/gift_id/idempotency_key`，请求头使用相同 `Idempotency-Key`。同一“收礼人|礼物”失败/未知重试保留 UUID，只有服务端成功才清除；按原版不插乐观礼物消息，本地中等触觉和动画先呈现，成功回执才进入时间线。
- 气泡/动画契约：恢复 68pt 礼物、44×30pt 原图箭头、54pt 收礼人头像、13pt 金币徽章、80/74pt 两侧列、8×9pt padding、232pt 固定宽、18pt 方向缺角、发送 `#FFF4C9→#FFE8A3`/接收 `white→#FFF8DF` 与 70% 金边；收礼头像可进入用户主页。动画恢复 22% 黑遮罩、96pt 礼物、0.62→1.05 spring、各礼物原旋转、树 -8pt、6 个 18→76pt 粒子、15/11pt 交替大小、950ms ease-out 和每粒 40ms 延迟。
- 自动验证：新增 9 项测试，覆盖六档目录/全部几何常量、别名/排序/退役与币种过滤、固定/嵌套/直接 payload、完整编码/本地化、失败幂等键保留、气泡/动画参数、直聊/群聊精确路径/请求头/请求体/回执回落、目录和混合余额接口。该里程碑通过后，最新全量回归基线仍为：原图 51 文件聚合哈希 `295154cd...6362`、本地化 10×1,138 条聚合哈希 `d3b5e6ae...dc6e`、ESLint、TypeScript、**22 suites / 114 tests**、Expo public config、Expo Doctor **20/20** 与 iOS export（**2,714 modules，8,153,006-byte bundle**）全部通过。
- 仍未完成：系统 `UISheetPresentationController` medium/large detent 与自绘 Expo sheet 的最终高度/拖拽手感差分；服务端真实礼物目录、remote asset、扣款 charge/业务错误与群成员数据联调；原 `UserCacheManager` 的任意群成员头像缓存、完整钱包页、后台进程级 coordinator；暗色/VoiceOver/超长 10 语言文案和最终原图/Expo/diff 三图验收。

## 2026-08-06：StickerViews / ChatView / GroupChatView 表情与贴纸第一轮还原

- 结果：私聊和群聊的表情按钮已从文字占位升级为真实 emoji/贴纸面板，服务端 sticker 消息已从 `[贴纸]` 占位升级为原尺寸气泡、远程资源校验和 client identity 乐观发送。源码可确定的常量及协议完成第一轮迁移；未运行模拟器截图差分，因此 `ChatView`、`GroupChatView`、`MessageBubble` 与 `StickerViews` 仍标记“部分完成”，像素级完成页仍是 0/47。
- 面板契约：原封不动迁入固定 57 个 emoji 及顺序、`fallback_0...56` ID、10 递增 order、简/繁/英/日包名、emoji 默认首 Tab；恢复 250pt 首选/220pt 最低高度、14×8pt Tab padding、8pt Tab 间距、32pt capsule、20/22/13pt cover/图/字、12% accent 选中底；emoji 使用 8 列/2pt 列距/4pt 行距/28pt 字/44pt 行，贴纸使用 4 列/10pt 列距/12pt 行距/54pt 图/10pt 字/76pt 行。emoji 按 JS/NSString 同为 UTF-16 code unit 的选区替换并把光标放到插入值之后，面板不会因插入或发送自动关闭。
- 消息与接口契约：迁入 `sticker_id/pack_id/asset_key/name/width/height` 六字段 JSON 和 legacy 单 asset key 解析；气泡最大 148pt、仅缩小不放大、8pt padding、14pt 圆角、发送/接收 18%/72% 白底、6%/4pt/2pt 阴影，失败占位恢复 12pt 圆角、8% 填色、18% 描边和 12pt semibold 两行字。直聊精确调用 `/chat/messages/sticker` 并含 `receiver_id`，群聊调用 `/groups/{id}/messages/sticker` 且不虚构 receiver；两者都先插入 client identity 乐观消息、成功原位替换、失败整条移除。
- 远程资产契约：消费原 `asset_manifest`，仅接受 HTTPS、png/jpeg/jpg/webp/gif、最大 8 MiB且拦截原执行扩展名；下载后复核响应 MIME、声明/实际字节数与可选 SHA-256，验证成功才原子写入 `RemoteAssets` cache，否则显示原版文字/SF Symbol fallback。为原生字节哈希新增 SDK 57 匹配的 `expo-crypto 57.0.1`，因此首个包含此能力的安装包必须重新 EAS Build，之后同 fingerprint 的贴纸逻辑/配置可继续 OTA。
- 自动验证：新增 fallback 全数组、包过滤/首 Tab/服务端顺序、贴纸排序、UTF-16 emoji 选区、JSON/legacy payload、148pt 不放大、manifest 安全边界及直聊/群聊精确路径/字段测试。原图 51 文件聚合哈希 `295154cd...6362`、本地化 10×1,138 条聚合哈希 `d3b5e6ae...dc6e`、ESLint、TypeScript、20 suites / 96 tests、Expo public config、Expo Doctor 20/20 与 iOS export（2,706 modules，7,967,997-byte bundle）全部通过；原仓与独立副本原生目录 tracked/staged diff 为零且 `diff -qr` 零差异。
- 仍未完成：真实 `/app/config` 贴纸包/CDN/错误资源联调；原键盘、贴纸和 plus panel 等高保留与 spring 过渡；群聊 @ mention 原子 span 与 emoji 插入协作；缓存版本回滚、暗色、VoiceOver、极端长本地化文案和最终原图/Expo/diff 三图验收。

## 2026-08-06：ChatView / GroupChatView 语音录制、气泡与播放第一轮还原

- 结果：私聊与群聊输入栏的麦克风已从无动作图标升级为真实按住录音、上滑取消和发送；服务端 voice 消息已从 `[语音]` 占位升级为原比例气泡与共享播放器。源码参数完成第一轮迁移，但麦克风权限、AudioSession 中断、实体设备音频和截图差分尚未验收，因此相关页面仍为“部分完成”，像素级完成页仍是 0/47。
- 录音/输入契约：恢复空输入时麦克风、语音模式下键盘返回且隐藏表情/加号；按钮 54pt 高、20pt 圆角、16pt medium，按住切 accent，向上超过 80pt 后 0.15s 切 80% 红色，松开取消。使用 AAC `.m4a`、22,050Hz、单声道、iOS medium quality，少于 1 秒删除；100ms 更新时长。松手后上传异步独立执行，不阻塞下一次录音。
- 录音反馈契约：恢复全屏黑色 60% 遮罩、24pt 纵向间距、100pt accent 圆、取消时 0.2s 放大到 1.1 并切 90% 红、36pt bold `xmark`；正常态 5 根 4pt 宽、4pt 间距、16/24/32/24/16 高的 0.4s 波形；48pt light 等宽 `m:ss` 计时、15pt 白色 70% 提示和底部 120pt。所有数值已集中为可测试 policy。
- 气泡/播放契约：解析原 `URL|duration`；宽度 `min(max(80, 80 + duration×8), 200)`，12×10pt padding、18pt 方向缺角、6pt 内容间距和 14pt 整秒；3 根声波宽 2pt/间距 2pt，静止 6/10/6、播放 8/14/10，并按 0.4s/每根 0.15s 延迟循环。单例播放器保证一次只播一条；远端相对 URL 按 API origin 还原、同源带 Bearer、先下载再播放，0.1s 更新时间，再点/播完归零；录音开始先停止播放。
- 接口/状态契约：私聊 `POST /chat/messages/voice` 带 `receiver_id/duration/voice`，群聊 `POST /groups/{id}/messages/voice` 不虚构 receiver；两者按 Swift 使用一位小数 duration、`audio/m4a` 和 60 秒超时，且不添加原接口不存在的 client 字段。私聊按源码先插入固定 100pt 本地发送气泡，失败保留提示/本地重试，回执以本地 client identity 原位替换；群聊按源码成功回执后插入。
- 自动验证：新增 payload 解析、80/200pt 宽度边界、全部录音/气泡视觉常量、时间格式、origin URL、私聊/群聊 multipart 精确路由/字段/缺失字段/MIME/60s 超时测试。原图 51 文件哈希、本地化 10×1,138 条逐值校验、ESLint、TypeScript、19 suites / 87 tests、Expo public config、Expo Doctor 20/20 与 iOS export（2,694 modules，7.9 MB bundle）全部通过。
- 仍未完成：Development Build 上的麦克风首次拒绝/受限/设置恢复、电话/耳机/蓝牙/后台中断、短录音边界、损坏/401/超时音频下载失败态与真机声波节奏；暗色/VoiceOver 和最终原图/Expo/diff 三图验收。

## 2026-08-06：ChatView / GroupChatView 视频气泡、持久发送与共享播放器第一轮还原

- 结果：私聊与群聊的视频消息已从文字占位升级为真实缩略图气泡、混合相册选择、持久发送、失败恢复和共享全屏播放器。源码可确定参数已逐项迁移；本轮没有运行模拟器截图差分，因此 `ChatView`、`GroupChatView`、`MessageBubble`、`VideoPlayerView` 和 `VideoThumbnailView` 均只标记“部分完成”，像素级完成页仍为 0/47。
- 气泡/首帧契约：按原版比例 `<0.9` 纵向、`>1.1` 横向、其余方形，恢复 200×140、112×160、150×150 三种 footprint、10pt 圆角、0.5pt 黑色 8% 描边、黑色 10% 底、44pt 黑色 42% 播放圆和 17pt bold 播放图标右移 1pt。本地展示首帧最大 600px；发送首帧最大 480px、JPEG 0.62；远端先用明确 thumbnail，否则把 `/api/v1/images/` 转 public path 并推导 `_thumb.jpg`。
- 发送/恢复契约：相册最多 9 项且图片/视频保持原选择顺序；私聊精确发送 `/chat/messages/video` 的 `receiver_id/client_message_id/video/thumbnail`，群聊使用 `/groups/{id}/messages/video` 且不虚构 receiver，MOV/M4V/MP4 MIME 与 600 秒超时按 Swift 还原。视频原文件和首帧复制到 `document/bwchat-outbox/chat-videos/{owner}/{client}`，按账号+direct/group+联系人/群隔离；实现 `staging → queued → preparing → uploading → retry_waiting/failed`、持久 `attempt_count/next_attempt_at/last_error`、瞬时错误最多 5 次原指数+jitter 自动重试、失败手动重试、重进会话恢复、client ID 原位确认及成功清理。
- 播放器/手势契约：恢复黑色全屏、ready 自动播放、退出暂停、原生控制器、2 秒前向缓冲、远端缓存和 28pt/80% 白关闭键；pinch 最小 0.5、位置感知缩放、低于 1 用 0.2 秒复位，放大后平移且 scale>1.05 禁用下拉退出。单指 10pt 后只接受纵向意图；距离>110 或预测终点>450 退出；背景按 320pt 衰减到 10%，画面在 8pt 后按 900pt 缩到最低 0.55，拒绝以 response 0.32/damping 0.86 回弹。RNGH 没有 UIKit `predictedEndTranslation`，当前以 `translation + velocity × 0.2s` 做有源码依据的近似，保留真机验收项。
- 自动验证：新增视频三种 footprint 边界、public thumbnail/playback URL、480px/0.62/600s 预处理与 MIME、手势透明度/缩放/退出数学、私聊/群聊 multipart 精确路由字段、队列状态序列、持久文件、账号/会话隔离、重进/跨账号拒绝、手动重试、成功清理和瞬时错误分类测试。原图 51 文件哈希、本地化 10×1,138 条逐值校验、ESLint、TypeScript、18 suites / 83 tests、Expo public config、Expo Doctor 20/20 与 iOS export（2,680 modules，7.9 MB bundle）全部通过。
- 仍未完成：原生 background URLSession 在 App 挂起/终止期间继续实际传输、confirmation-unknown/进度/取消；HTTP 缓存持久性和 Range/鉴权边界；系统 controls 与自定义极端多指手势、播放中断/前后台生命周期真机验证；暗色/VoiceOver 与最终原图/Expo/diff 三图验收。

## 2026-08-06：ChatView / GroupChatView 图片 OutgoingStore 恢复语义

- 结果：私聊与群聊图片从仅限当前 JS 生命周期的内存重试升级为 document 持久发件箱。退出/终止 App 后重新进入同一会话，会按原 `client_message_id` 恢复发送中或失败气泡并继续到期任务；本轮没有运行模拟器截图差分，因此两页仍为“部分完成”，不计入像素级完成数。
- 原版源码契约：定向审计 `ChatViewModel`、`GroupChatViewModel`、`OutgoingStore`、`OutgoingFileStore`、`UploadEngine` 和 `OutgoingRetryScheduler`；对应实现 `staging → queued → preparing → uploading → retry_waiting/failed`，按 owner + direct/group + business key 隔离，持久 `attempt_count/next_attempt_at/last_error`，瞬时错误至多 5 次自动重试，永久失败保留可点重试，成功按 client identity 替换并删除 job/文件。
- 文件与恢复契约：选择后仍在同一 UI turn 插入本地气泡；随后立即写入账号隔离 job，把 picker 原文件复制到 `document/bwchat-outbox/chat-images/{owner}/{client}`，JPEG 原图与 thumbnail 处理完成后也复制进同一目录，避免 `ImageManipulator` cache 在重启后失效。恢复只读取当前账号及当前联系人/群；服务端页刷新保留本地 sending/failed 行；当前账号清理与全部数据清理覆盖 job 和文件目录。
- 重试契约：只把 API 网络错误、408/425/429/5xx 视为瞬时；采用原版 2 的幂次、300 秒上限和 0–20% jitter，写入 `next_attempt_at` 后调度；400 等业务错误直接进入永久失败，手动重试不跨账号取任务。JS 无法等价原生 background URLSession 在进程终止期间继续传输，这一缺口继续明确保留。
- 自动验证：新增 staging/queued/preparing/uploading 状态序列、durable 文件路径、client ID 成功确认与清理、账号/会话隔离、永久失败重进恢复、跨账号重试拒绝、手动重试、确定性临时 ID、瞬时错误分类及持久到期自动重试测试。原图 51 文件哈希、本地化 10×1,138 条逐值校验、ESLint、TypeScript、17 suites / 75 tests、Expo public config、Expo Doctor 20/20 与 iOS export（2,674 modules，7.8 MB bundle）全部通过。

## 2026-08-06：ChatView / GroupChatView 图片气泡、发送与图库第一轮还原

- 结果：私聊和群聊的图片消息已从 `[图片]` 文字占位升级为真实缩略图、选择/发送/失败重试和全聊天图库；仍缺跨重启的原生 OutgoingStore/BackgroundUploadCoordinator 语义与最终截图 diff，因此聊天页面继续标记为“部分完成”。
- 气泡视觉契约：按 `ChatMediaLayout` 原值恢复横图 160×110、竖图 110×156、方图 140×140，比例 `<0.85` / `>1.18`，默认横图；统一 10pt 圆角、0.5pt 黑色 8% 描边、separator 占位、22pt photo 图标、aspect-fill；优先服务端 `thumbnail_url`，没有时回退原图，URL 继续走同源 Bearer 鉴权。
- 选择/预处理契约：相册按选择顺序返回、最多 9 项；图片选择后在同一 UI 周期插入本地 URI 乐观气泡，再并发处理/上传。原图执行 1200px、JPEG 0.7 起、2MB 上限及原版降质/缩尺寸阶梯；额外生成 360px、JPEG 0.58 起、140KB 上限缩略图，文件名使用 `_thumb.jpg`。
- 接口/状态契约：私聊 `POST /chat/messages/image` 带 `receiver_id/client_message_id/image/thumbnail`；群聊 `POST /groups/{id}/messages/image` 不虚构 receiver；均使用 180 秒超时和 `client_message_id` 对账。气泡即时 sending，服务端回执按 client identity 原位替换，失败显示 22pt 红色重试按钮并复用已处理文件；当前 JS 生命周期内保留原始 picker asset 以处理预处理失败后的重试。
- 图库契约：两种聊天都把当前已加载的全部 image 消息按时间顺序传入共享图库；缩略图提供 global frame、fill 和 10pt 圆角 Hero；接近最旧两页时复用聊天 `before_id` 加载器，把新增旧图前插且保持当前 URL；全屏缩放、分页、下拉退出、长按保存沿用 `ImagePreviewView` 第一轮实现。
- 自动验证：新增三种 footprint 边界、原图/缩略图压缩预算、私聊/群聊精确 URL、字段存在性和 180 秒 multipart 超时测试；原图 51 文件哈希、本地化 10×1,138 条逐值校验、ESLint、TypeScript、16 suites / 71 tests、Expo public config、Expo Doctor 20/20 与 iOS export（2,673 modules，7.8 MB bundle）全部通过；原仓与独立副本原生目录 tracked/staged diff 均为零。
- 该阶段当时仍未完成：图片 outbox 文件 staging、App 终止后恢复、后台 URLSession、confirmation-unknown、进度遮罩/取消；视频/语音/贴纸/礼物/红包/转账、回复/撤回/多选/转发/menu；暗色/VoiceOver 和最终原图/Expo/diff 三图验收。其后已迁内容以本文更靠前的新里程碑及状态总表为准。

## 2026-08-06：ImagePreviewView / 图片图库与保存第一轮还原

- 结果：朋友圈主 Feed、个人动态、动态详情和评论图片已从普通横向 Modal 切换到共享全屏图库；源码可确定的缩放、分页、下拉退出、Hero 和长按保存契约完成第一轮。私聊/群聊/Agent 尚未全部接入，且未做模拟器截图 diff，因此 `ImagePreviewView.swift` 只从“未迁移”提升为“部分完成”。
- 手势契约：按原值实现 0.5–5 倍捏合、≤1.05 回到静止、触点下内容保持、双击触点 2.5 倍/再次双击复位、缩放后独立拖动；静止态自绘水平分页，边缘 0.25 阻尼；纵向意图要求 `abs(y) > abs(x) × 1.12`，18pt 视觉死区，72pt 距离或至少 28pt 且 900pt/s 快甩退出，拒绝时 0.16s 回弹；拖动背景按 320pt 衰减至 25%，图片按 900pt 衰减且最低 0.55。
- Hero/视觉契约：来源按 global frame 捕获并在呈现期间保持布局但设为透明；记录 source ID、fit/fill、6/8/4pt 圆角和已加载图片固有尺寸，计算来源可见 rect 与全屏 aspect-fit rect；打开 0.22s，点击来源返回 0.24s，下拉来源返回 0.18s，无来源退出 0.18/0.26s；黑底、当前页 14pt 圆角、顶部 54pt 的 14pt medium `当前 / 总数` 胶囊、白色 loading spinner 与 48pt 灰色失败图标均已迁。
- 图库状态：URL 稳定去重并按被点 URL 重映射初始页；页切换重置缩放；可选旧图 loader 在 index≤1 时触发、前插去重并平移 index 保持当前图不跳；只显示当前来源 Hero，切页后不错误返回原缩略图。
- 保存契约：长按 0.5s、允许 20pt 移动、中等触觉，iOS 使用保存/取消 action sheet；新增 `expo-media-library` 与 fingerprint 原生配置，申请 add-only photo 权限，同源媒体带 Bearer 下载到 cache，`expo-image` 解码校验后写入相册，最终清理临时文件，并复用原 10 语言的 permission/invalid/saved/failed 文案。
- 自动验证：新增缩放/方向/死区常量、稳定去重/选中 URL 重映射、退出阈值、Hero aspect-fit、权限/下载/校验/保存/清理的契约测试。原图 51 文件哈希、本地化 10×1,138 条逐值校验、ESLint、TypeScript、15 suites / 67 tests、Expo public config、Expo Doctor 20/20 与 iOS export（2,670 modules，7.8 MB bundle）全部通过；原仓与独立副本原生目录的 tracked/staged diff 均为零。
- 仍未完成：私聊/群聊/Agent 图片入口和聊天旧图加载调用方；视频全屏预览/保存；极端多指手势、真实相册权限、暗色/VoiceOver；最终原图/Expo/diff 三图像素验收。

## 2026-08-06：Moments 主 Feed / 发布 / 通知与 outbox 第一轮还原

- 结果：发现页朋友圈已从迁移占位页切换为真实世界/关注双 Feed；个人页“我的朋友圈”按原版进入单用户 Feed、没有双栏；发布、互动消息、主 Feed 点赞/评论/回复/图片评论/删除/解锁全部接入真实端点。`MomentsView.swift` 与 `CreateMomentView.swift` 仍只标记为“部分完成”，未做截图 diff。
- 视觉契约：恢复 226pt 封面 + 44pt 底部延伸、三色渐变/22pt 模糊头像/双层遮罩、76pt/16pt 圆角白边头像、18pt 名称、196pt 粗体 segmented、滚动封面/浅色导航 chrome、32pt 通知心形/红 badge/14×10pt banner；Feed 复用 44pt/11pt 头像和原 `MomentRow`。发布页恢复 16pt 横/14pt 顶边距、12pt 卡、190pt 编辑区与 200 字计数、三列最大 96pt 媒体格/10pt 间距、64pt 金币行和 16pt paperplane。
- 接口与状态：接入 `/moments/world`、`/moments/feed`、`/moments/user/{id}`、`/moments/create`、delete、unread/list/read/feed-viewed；三 Feed 使用 `before_id`、20 条页、账号隔离 200 条快照和 `snapshot_complete` 空页保护，通知 cache-first/最多 500 条。发现页延时 280ms 获取 Moment badge/dot；通知入口即时清本地 badge 并上报已读。
- 发布可靠性：严格执行最多 9 图或 1 视频且禁止混选、1200px/JPEG 0.7/2MB 预处理、图片 180 秒/视频 600 秒；媒体先复制到 document outbox，持久化任务与确定性负数临时动态，`client_request_id` 服务端幂等，瞬时错误指数重试最多 5 次，失败显示原版 68pt 左缩进重试行，重新进入 Feed 恢复任务，删除临时动态取消任务。
- 自动验证：新增精确 Feed/通知/删除/发布 URL、query、method、multipart/超时、通知别名、9 图/1 视频规则、Feed/通知账号缓存、200 条上限、空快照保护、合并/插入策略、乐观 ID/媒体和 durable `file://`/`content://` URL 测试。原图 51 文件哈希、本地化 10×1,138 条逐值校验、ESLint、TypeScript、13 suites / 59 tests、Expo public config、Expo Doctor 20/20 与 iOS export（2,648 modules，7.7 MB bundle）全部通过。
- 仍未完成：原生 background URLSession 在 App 被系统挂起/终止时继续上传和 confirmation-unknown 状态、视频首帧持久预览/本地缓存接管、解锁后的钱包与道具全局 store、评论 context menu、完整视频预览、暗色/VoiceOver、服务端真实账号联调和最终原图/Expo/diff 三图验收；Hero/双击/捏合/方向锁定下拉图片图库已在后续轮次补齐第一轮。

## 2026-08-06：MomentDetail / 评论与付费解锁第一轮还原

- 结果：用户主页评论按钮和评论文本已按原生层级进入真实动态详情；详情内的点赞、普通评论、回复、评论图片和付费媒体自动解锁完成第一轮，详情变更返回后会即时同步用户主页。主 Moments 双 feed 和高级图库仍未完成，因此 `MomentsView.swift` 只从“未迁移”提升为“部分完成”。
- 视觉契约：详情使用 secondary background、inline“动态详情”标题、缓存加载/36pt 缺失图标/15pt 缺失文案；继续复用 44pt 头像并纠正为原版 11pt 圆角、16×14pt 行边距和微信式媒体网格。底部评论器恢复 hairline、14pt reply 边距、10pt reply 图标、12pt 回复摘要、60×60/6pt 图片预览、20pt 图片按钮、16pt/14×10pt/20pt 圆角输入框、15pt semibold/16×10pt/20pt 发送按钮、22pt 关闭按钮及 12×8pt 外边距；评论缩略图纠正为 50×50/4pt。
- 行为契约：接入 `GET /moments/detail/{id}`、`POST /moments/{id}/comment` multipart 和 `POST /moments/{id}/unlock`；评论图统一重新编码 JPEG 0.7，回复发送原 `reply_to_user_id`；解锁按首媒体选择 image/video，使用 `payment_method=auto` 与 `media_unlock_card_image/video`，失败重试复用同一幂等键。解锁响应兼容直接 Moment 与 wrapper，混合扣款校验 `total = activity cat food + gold coins`，并解析 wallet/consumed prop；账号详情缓存与主页 feed 由 mutation bus 同步。
- SDK 维护：Expo SDK 57 补丁更新到 `expo 57.0.11`，12 个已发布官方模块同步到 Doctor 要求版本。Doctor 当前声明但 npm 稳定仓库尚未发布的 `expo-sharing ~57.0.10` 单独保留稳定 `57.0.8` 并加入官方 `expo.install.exclude`，未关闭其余依赖校验。
- 自动验证：新增直接/包装解锁响应、混合扣款一致性、详情/评论/解锁精确端点、multipart、自动视频卡请求体、幂等头、详情缓存账号隔离和 mutation 单次广播测试。原图 51 文件哈希、本地化 10×1,138 条逐值校验、ESLint、TypeScript、12 suites / 52 tests、Expo public config、Expo Doctor 20/20 与 iOS export（2,641 modules，7.6 MB bundle）全部通过。
- 仍未完成：主 Moments 推荐/关注双 feed、封面/通知/创建/删除/outbox；评论 context menu；解锁后钱包与道具全局 store 同步；Hero/双击/捏合/下拉图库和完整视频预览；暗色/VoiceOver、服务端真实账号联调和最终原图/Expo/diff 三图验收。

## 2026-08-06：UserProfile 三类内容与 AgentChat / 短剧播放第一轮还原

- 结果：用户公开资料的动态、智能体、短剧三个内容 Tab 已从空态切换为真实数据流；Agent 卡已按原版复用/安装/创建会话并进入真实文本聊天；短剧卡已进入真实系列播放器。由于评论/解锁/高级媒体、短剧完整 feed 与最终截图 diff 尚未完成，相关页面仍统一标记为“部分完成”。
- 动态视觉与行为契约：恢复 44pt 头像、12pt 间距、16×14pt 行边距、15pt 作者/正文、12pt 时间、30×24pt 省略按钮、34pt 深色操作胶囊、`#F5F6FA` 社交盒；媒体使用屏宽减 88pt、单图最大 208pt、网格最大 284pt、4pt 间距、2/4 张两列其余三列及 6/8pt 圆角。接入 24 条首屏、`before_id` 分页、200 条账号+目标缓存、非权威空首屏保护、真实点赞、多图分页预览、视频预览和未解锁提示。
- Agent 契约：恢复 14pt/14pt Agent 卡、58pt 头像、13pt 间距、16/13/11pt 三层文案和 34pt 尾图标；打开时优先最新未关闭会话，否则检查已安装、必要时安装并以第一 greeting 创建。聊天接入最近 30 条与 `before_sequence`、服务端有序 parts、文字 turn/幂等 client ID、乐观气泡、1 秒轮询、终态消息合并、错误重试；视觉恢复 28pt 标题头像、32pt 消息头像、290pt parts、15pt 字体、13×9pt padding、16pt 圆角、原三套媒体 footprint 和 54pt 输入区。
- 短剧契约：接入作者 series 的 `limit=12/cursor`、200 条账号缓存、published+目标作者过滤；恢复 16pt 外边距、14pt 卡间距/内边距、16pt 圆角、131pt 海报、三行简介、每页 15 集的范围切换、5 列 44pt 分集方格和锁态；详情重新取数、按分集号排序、优先 requested/resume 分集，已解锁视频由 `expo-video` 真实播放。
- 自动验证：新增朋友圈严格解码/完整性策略/合并、Agent 卡/会话/有序 parts、短剧状态/作者过滤、所有新增端点精确 URL/请求体/幂等头、两类 200 条账号缓存隔离及 Agent 会话解析测试。原图 51 文件哈希、本地化 10×1,138 条逐值校验、ESLint、TypeScript、12 suites / 49 tests、Expo public config、Expo Doctor 20/20 与 iOS export（2,637 modules，7.6 MB bundle）全部通过。
- 仍未完成：动态评论发布/回复/删除、动态详情/支付解锁与 Hero/缩放图库；Agent 图片上传/回复/变换、付费媒体真实解锁/保存/视频、版本提示/编辑/钱包/视频角色匹配；短剧竖滑 feed、播放器池/首帧/预加载、点赞/评论/分享/解锁/进度、Studio；暗色/VoiceOver、服务端真实账号联调和最终原图/Expo/diff 三图验收。

## 2026-08-06：FollowListViews / UserProfileView 核心链路第一轮还原

- 结果：关注、粉丝、推荐三列表与用户公开资料核心页完成第一轮；好友搜索、我的资料统计、三类列表和公开资料之间已有真实导航与关注关系同步。资料内容的动态、智能体、短剧尚未迁移，且未做最终截图 diff，因此两页均只标记为“部分完成”。
- 视觉契约：关注列表恢复 16pt 水平/12pt 顶/28pt 底边距、10pt 卡间距、14pt 卡内边距/圆角、48pt 头像、16/13pt 文案、32pt 关注胶囊和 80pt 加载/空态。公开资料恢复 72pt/16pt 圆角头像、1/2pt 普通/高亮边框、16/17/12pt 姓名与统计、11pt 关系 capsule、36pt/8pt 圆角操作按钮、106×136pt 推荐卡、64pt 高亮、43+1pt Tab、6% scrim、24pt 顶圆角、36×4pt handle、46pt 更多操作行及 60pt 分隔缩进。
- 行为契约：接入 `/follows/following`、`/follows/followers`、`/users/recommended?limit/exclude_user_id`、`/profile/public/{id}` 与 `POST/DELETE /follows/{id}`；恢复 page/limit/user_id 分页、去重、下拉刷新、推荐过滤、推荐为空时四类关注源回退、公开资料 flexible decode、账号隔离缓存、私密账号关注请求态、乐观更新/失败回滚、当前账号关注列表即时插入/移除及跨页 relationship 合并；私信按原版只要 userID 有效就可进入聊天，分享/复制/账号创建信息真实可用。
- 自动验证：新增公开资料嵌套/别名、推荐与公开资料精确 URL、relationship 广播/字段合并、当前账号关注列表插入/移除、私密账号请求态保持、关注列表 500 条上限和两类缓存账号隔离测试；原图 51 文件哈希、本地化 10×1,138 条逐值校验、TypeScript、ESLint、10 suites / 40 tests、Expo public config、Expo Doctor 20/20 与 iOS export（2,622 modules，7.5 MB bundle）全部通过。
- 仍未完成：公开资料的真实动态列表/点赞/评论/媒体预览/付费解锁、智能体列表与安装会话、短剧列表与播放、三类内容分页/错误/加载细态；高亮加载细态、更多 sheet 精确弹簧动效、服务端真实账号联调、暗色/VoiceOver 和最终原图/Expo/diff 三图验收。

## 2026-08-06：GroupDetailView / AddGroupMembersView 核心链路第一轮还原

- 结果：群聊省略号已进入真实群信息页；默认核心成员管理、群名、置顶、群背景入口、清历史、公开性、退出/解散完成第一轮；远程 flag 子页仍有缺口，因此群详情继续标记为“部分完成”。
- 视觉契约：群信息恢复 secondary system 背景、plain section、54pt 行、17pt body；成员区按 ≤375pt 五列/其余六列、最多三行、48pt 头像、8pt 列距/14pt 行距、18pt 顶边距、10pt 虚线添加框和 12pt“更多群成员”；成员全页恢复系统搜索、44pt 头像、群主/管理员 badge 与移除按钮；添加成员恢复 13pt 标题、36/24pt 选择区、42pt 头像、76pt 分隔缩进和原空态。
- 行为契约：接入群详情 GET、rename、visibility、members add/remove、leave、dismiss、带幂等键的群清历史、会话置顶 preference；恢复 server permission + owner/admin 本地能力回退、账号隔离详情/置顶/清历史缓存、好友与群详情并发加载、现有成员排除、多选、成员搜索/移除、公开设置乐观回滚、退出/解散清缓存、群名/成员数跨页即时更新。
- 清历史契约：按 `history_sequence` 维护账号＋群单调水位线；群聊时间线即时过滤、关闭旧分页，并在重新加载/分页时再次套用水位线，保留没有 sequence 的乐观消息。
- 自动验证：新增 flexible GroupDetail/Member/ViewerSettings/permissions、owner/admin 能力、详情缓存隔离、置顶与会话快照同步、群清历史单调水位线/过滤以及全部核心端点精确路径、请求体与幂等头测试；当前 9 suites / 35 tests 通过。
- 仍未完成：群邀请/二维码、公告、群备注、我的群昵称、显示成员昵称、通知免打扰/例外、群消息筛选搜索/定位、举报等远程 flag 子功能；WebSocket 详情事件、暗色/VoiceOver、最终原图/Expo/diff 三图验收。

## 2026-08-06：CreateGroupView 第一轮还原

- 结果：群列表加号已从迁移入口切换为真实建群 modal；群名、公开开关、互关与粉丝两种成员来源、选择和创建完成第一轮，尚未做最终截图 diff，因此标记为“部分完成”。
- 视觉契约：按 Swift 局部使用系统白底；恢复 13pt uppercase 分组标题、16pt 群名输入、16×12pt 内边距、12pt 圆角与 60% separator 底色；公开行恢复 17pt globe/24pt 槽、16pt medium 文案和系统 Toggle；粉丝入口恢复 42pt accentLight 圆图标、26pt 计数 capsule；成员行恢复 36pt 勾选 hit area、24pt/2pt 选择圈、42pt 头像、16pt medium 名称、76pt 分隔缩进与原版空/加载态。
- 行为契约：接入 `POST /groups/create` 的 `name/member_ids/is_public` 原请求体，接入 `/follows/following` 与 `/follows/followers` 的 page/limit/user_id 协议；恢复两源并发首载、下拉刷新、互关稀疏页连续跳过、排除自己、跨页去重、末行可见分页、已选跨二级页共享、空白群名/零成员禁用和创建成功返回后群列表重新聚焦刷新。
- 自动验证：新增嵌套 profile/user、users/following/followers/items/list、flexible has_more/next_page、互关资格、排除自己、去重、异常分页游标以及精确创建请求体/查询 URL 测试；当前 9 suites / 30 tests 通过。
- 仍未完成：服务端真实账号联调、创建失败的原版上层错误呈现链路、暗色/VoiceOver、键盘与超长文案截图、最终原图/Expo/diff 三图验收。

## 2026-08-06：GroupChatView / GroupMessage 文字链路第一轮还原

- 结果：群列表已进入真实群聊，群文字消息的加载、历史分页、乐观发送与失败重试完成第一轮；媒体和高级群聊能力仍未完成，因此继续标记为“部分完成”。
- 视觉契约：恢复“群名（人数）”导航标题、右侧群信息入口、2 分钟时间分隔、36pt 成员头像、他人消息发送者昵称、左右消息气泡、撤回/系统提示、原版输入 chrome、语音/表情/发送/加号切换和六入口面板骨架；时间线实际消费 group 专属背景并回退 global 背景。
- 行为契约：接入 `GET /groups/{id}/messages?before_id/after_id/limit` 与 `POST /groups/{id}/messages/text`；迁移 group message flexible 字段、reply、mentions、history sequence、recalled、client identity 去重、最新 100 条及 `before_id` 分页；群草稿使用独立 `group` key，避免与同数字 ID 的私聊草稿冲突。
- 自动验证：新增群消息 flexible decode、撤回/reply/mentions/history sequence/排序以及私聊与群聊草稿 key 隔离测试；当前 8 suites / 26 tests 通过。
- 该阶段当时仍未完成：图片/视频/语音/贴纸/礼物/红包/转账、@成员原子 token、回复发送、撤回/重编辑、多选/转发/定位/搜索、SQLite/outbox/WebSocket、成员快照、读回执、群详情/群背景设置入口、群通话、暗色/VoiceOver 和最终截图 diff。其后已迁内容以本文更靠前的新里程碑及状态总表为准。

## 2026-08-06：AddFriendView / FriendRequestsView / ContactsTabView 第一轮还原

- 结果：好友搜索、关注切换、私信、好友请求接受/拒绝、通讯录根页和我的群组列表完成第一轮；公开主页和建群仍是迁移入口，群聊文字链路在后续一轮完成，均未标记像素级完成。
- 视觉契约：加好友恢复 16pt/8pt 搜索外边距、14×10pt 内边距、12pt 圆角、16pt 搜索图标/文本、18pt 清除图标与 36pt hit frame；结果行恢复 44pt 头像、16pt semibold 名称、56×32pt/13pt 胶囊。好友请求恢复 44pt 头像、16/13pt 双行、38pt 圆按钮和 72pt 分隔缩进。通讯录恢复 22pt 根标题、72pt/14pt 模块与好友卡、40pt 模块图标、42pt 好友头像、24pt 分组标题左边距；群列表恢复 196pt segmented、70pt 空态图标、48pt/72pt 群行和 unread badge。
- 行为契约：接入 `/friends/search`、`/friends/list`、`/friends/requests`、accept/reject、`POST/DELETE /follows/{id}` 和 `/groups/list`；恢复 400ms 搜索防抖、乐观关注/回滚、request-pending 别名、modal 私信 250ms 延时、好友/请求/群账号隔离缓存和静默刷新；补回原版默认 `contact_modules` 并过滤联系人页重复 Agent 模块。
- 自动验证：新增搜索/好友/请求/follow 嵌套响应、request_pending、群 flexible decode、三类账号缓存隔离、默认与远程 contact module 过滤测试；该轮 8 suites / 24 tests 通过。
- 仍未完成：UserProfileView、CreateGroupView、群聊媒体与高级能力、群成员拼图头像、好友关系跨页事件、暗色/VoiceOver 和最终截图 diff。

## 2026-08-06：DirectChatSettingsView / 私聊清历史第一轮还原

- 结果：聊天导航省略号已替换为真实聊天信息页，私聊清历史端到端行为完成第一轮；尚未进行模拟器截图 diff，仍为“部分完成”。
- 视觉契约：恢复 16pt 根边距/18pt 卡间距、66pt 头像、10pt 头像标题间距、22pt 纵向内边距、18pt semibold 昵称、12pt 连续圆角；背景与清历史行恢复 17pt SF Symbol、28pt 图标 frame、16pt 文案、16pt 行 padding；清除时使用全屏 8% 黑色遮罩与 accent spinner；成功 toast 为 15pt 白字、20×10pt padding、75% 黑底、20pt 圆角、顶部 8pt、2 秒生命周期。
- 行为契约：接入原版 `DELETE /chat/messages/{contact}/history` 与 `Idempotency-Key`；回执兼容 `conversation_id/contact_id`、`cleared_before_message_id/cleared_before_id` 和 snake/camel；账号＋联系人持久单调水位线防止旧 HTTP 分页复活；当前时间线即时清除，保留独立乐观发送队列；会话预览、时间、未读及离线快照同步清除。
- 自动验证：新增 flexible receipt、缺失会话 ID 回填、账号隔离、单调水位线、事件有效回执、旧消息过滤、乐观消息保留和会话预览清除测试；当前 6 suites / 18 tests 通过。
- 仍未完成：原版完整 SQLite MessageStore/read-through/outbox、聊天其余媒体与高级行为、暗色/VoiceOver 和最终原图/Expo/diff 三图验收。

## 2026-08-06：ChatBackgroundSettingsView / ChatAppearanceStore 第一轮还原

- 结果：全局背景设置与私聊背景消费完成第一轮；滤镜和所有入口尚未达到像素级完成。
- 行为契约：迁移 global/dm/group key、exact 优先和 global fallback；账号隔离缓存；`GET/POST/DELETE /chat/backgrounds`；snake/camel flexible decode；上传后本地 version、删除即时失效；1280px、JPEG 0.72 起、900KB 限制和逐级降质/缩尺寸。
- 视觉契约：恢复 14pt/8pt 预览卡、15pt 标题、12pt 状态 badge、280pt 预览、28pt 默认图标、两行 54pt 操作卡、56pt 缩进分隔线、上传 spinner 和禁用态；聊天时间线实际渲染当前 DM 或全局背景与 46% 白色遮罩。
- 自动验证：新增 exact/global fallback、原 snake/camel decode、无效 target 丢弃和相对路径测试；该轮 5 suites / 14 tests 与完整 `pnpm validate` 通过。
- 仍未完成：Swift saturation/contrast/brightness GPU 滤镜、群聊背景设置入口、独立磁盘 LRU/清理和最终截图 diff；DirectChatSettings 入口与群聊背景消费已在后续轮次补齐。

## 2026-08-06：AppLanguageStore / ProfileSettingsView 第一轮还原

- 结果：本地化数据底座完整迁移，设置链路第一轮完成；全 App 多语言仍为部分完成。
- 数据证据：10 个原版 `.lproj/Localizable.strings` 共 11,380 条记录已机械生成 JSON 并逐值回验；每语言实际 1,137 个唯一 key，明确保留重复 `common.save` 的后值覆盖规则；固定聚合摘要 `d3b5e6ae3e97ede67304e4bfbbf4ff086b702f9aaf819fbe6e56cb64f628dc6e`。
- 行为契约：恢复 system/en/ja/ko/es/fr/de/pt-BR/ru/zh-Hans/zh-Hant 顺序、系统语言别名匹配、即时切换、持久选择、Apple `%@/%d/%f` 格式；API 和 Remote Config 发送当前 App 语言。
- 设置契约：恢复 14pt 分组卡、40pt 渐变图标、55pt 缩进分隔线；语言、聊天背景入口、用户名重置、修改密码、视频缓存、当前/全部账号缓存和退出确认；用户名 3–20 位/同名/冷却错误映射及密码四项校验接入原端点。
- 自动验证：新增语言匹配、原值、占位符和德语重复 key 测试；当前 4 suites / 12 tests 与完整 `pnpm validate` 通过。
- 仍未完成：聊天背景详情尚为迁移入口；其余业务页面未全部调用 `t()`；InfoPlist 本地化、最终交互截图与像素 diff 未完成。

## 2026-08-06：原生图片资产完整镜像

- 结果：资产文件复制与完整性校验完成；页面内使用方式随页面迁移继续验收。
- 已复制：33 个图片 Asset catalog 条目，共 51 个 PNG/JPG 文件、约 7.9 MB，保留原目录、原文件名、1x/2x/3x 文件和原始字节。
- 完整性证据：源/目标逐文件 SHA-256 零差异；排序路径与文件哈希的聚合摘要均为 `295154cd037fdca6be35c66e0232274f73bd2d9f46162aef823b572e57af6362`。
- 打包保证：`src/assets/nativeAssets.ts` 使用静态 `require()` 注册所有图片条目；登录三态猫已切换到该原生资产注册表；`pnpm validate` 会先执行 `pnpm assets:verify`。
- 打包证据：`expo export --platform ios` 成功，Metro 的 iOS 资产清单逐项列出全部 33 个原生图片条目及其 density variations；不是仅存档而未引用。
- 未完成：各业务页面中的具体 frame、content mode、遮罩、动效、明暗状态和截图 diff，仍在相应页面完成时逐项验证；系统 SF Symbols 按源码参数还原，不属于可复制的仓库图片文件。

## 2026-08-06：ProfileView 第一轮源码还原

- 结果：资料主页的源码可确定部分已完成第一轮，仍为“部分完成”，不冒充像素级完成。
- 视觉契约：恢复 22pt 根标题；16/18pt 卡边距与圆角；82pt 渐变外框、76pt/16.72pt 圆角头像；24pt 用户名、12pt/22pt ID 胶囊；22/13pt 三项统计；14pt 三行 bio；42pt 双操作按钮；14pt 分组卡、40pt 渐变图标、55pt 缩进分隔线及全部原色值。
- 功能契约：接入 `/profile/me` 与 `/wallet/balance`；恢复下拉刷新、资料错误 banner、统计 K/M 格式、原版默认 profile item 回退、远程 `profile_sections` snake_case 解析/enable/minBuild/order、主页深链、M 纠错真实二维码、系统分享与复制链接。
- 自动验证：资产校验、ESLint、TypeScript、3 suites / 10 tests、Expo public config、Expo Doctor 20/20 与 iOS export 全部通过；远程配置测试新增 profile section 原协议 fixture。
- 仍未完成：编辑资料、粉丝/关注列表和业务详情目标仍是迁移入口；ProfileSettingsView、10 语言、暗色/辅助功能与最终原图/Expo/diff 三图验收未完成。

## 2026-08-06：源码审计与独立副本

- 结果：基础设施完成。
- 原版代码：桌面独立副本中保留 129 个 Swift 文件、101,556 行；原 Swift tracked diff 为零。
- 审计产物：枚举 47 个 View、15 个 Component、274 个 API 函数、185 个静态 path template、398 个测试方法、10 × 1,138 个本地化值与 34 个 Asset catalog 条目。
- 证据：`native-audit.generated.md`、`native-audit.generated.json`、`migration-status.md`。
- 未完成：47 个业务页面尚无任一达到像素级完成条件。

## 2026-08-06：Expo / EAS 热更新底座

- 结果：基础设施完成，真实 EAS 云端联调受 Expo 登录与 Project ID 阻塞。
- 已实现：Expo SDK 57、Expo Router、TypeScript strict、EAS development/preview/production profile、fingerprint runtime、三 channel、production 10% rollout 脚本、后台静默下载/下次冷启生效、手动检查、Remote Config 缓存/校验/Gate、Sentry 标签、CI。
- 验证：Expo Doctor 20/20；TypeScript、ESLint、Jest 与 public config 均已有本机通过记录。
- 未完成：EAS Project 绑定、真实 development/preview/production build、首次安装、OTA、回滚与 source map 云端验收。

## 2026-08-06：MainTabView / ContactListView 第一轮源码还原

- 结果：部分完成，未标记为像素级完成。
- 已恢复：默认“消息 / 地图 / 发现 / 我的”顺序；普通/选中 SF Symbols；黑色选中态；消息标题、加号菜单、搜索、空/错误/搜索空态；72pt 行、50pt 头像、160pt 可滚动尾部留白；全屏地图默认 region 与定位加载态。
- 源码参数：`DynamicTabDescriptor.defaultTabs`、`UIKitNav.MainTabController`、`RootTabTitle`、`ContactListView`、`ConversationRow`、`MapDatingView`。
- 验证：TypeScript 通过；ESLint 无 error。
- 未完成：详见 `migration-status.md` 的第 11、25、26 项；在功能契约全部完成前不进入最终像素 diff 判定。

## 2026-08-06：AuthManager / APIService 第一轮行为还原

- 结果：核心认证与会话快照契约部分完成，整个服务层仍未完成。
- 源码纠错：登录/注册使用 `token` 与 `refresh_token`；verify 使用 `data.user`；个人资料使用 `data.profile`；会话使用 `last_message_time/name/id` 与 flexible key，而非初始骨架的假定字段。
- 已恢复：Bearer token 规范化、SecureStore、401 single-flight refresh 与一次重放、GET/HEAD 两次瞬时重试、缓存身份先恢复、非确定性网络错误不退出、401/403 才清凭据、账号隔离会话快照、revision 单调保护、非完整空快照防误删。
- 自动测试：新增 native-compatible normalizer 与快照替换策略测试；当前 3 suites / 8 tests 全部通过。
- 未完成：device token、账号 epoch/有序 teardown、274 个 API 全量迁移、业务错误、WebSocket 与数据库消息存储等，详见总表。

## 2026-08-06：LoginView / RegisterView 第一轮源码还原

- 结果：代码层视觉与交互参数部分完成，尚未标记为像素级完成。
- 资源证据：`auth_cat_idle/peek/cover` 三张 1254 × 1254 原图从独立 Swift 副本复制；SHA-256 与 Asset catalog 源文件逐一一致。
- 已恢复：AuthPalette 全色值、动态顶部间距、35/15pt 标题组、258pt 猫、142pt 叠层、三种焦点情绪、弹簧 opacity/scale/offset、8pt 卡、52pt/17pt 输入、52pt/18pt 渐变按钮、清除、双密码显隐、inline error/hint、键盘完成栏、注册全屏转场与本地校验。
- 自动验证：TypeScript、ESLint、3 suites / 8 tests 通过；`expo export --platform ios` 成功打包 2,204 个模块。
- 未完成：10 语言、device token/Push/WebSocket、SF Rounded 与 focus shift 的截图精调、错误码全映射、VoiceOver、最终原图/Expo/diff 三图验收。

## 2026-08-06：AppRemoteConfigStore / 动态 Tab 协议还原

- 结果：远程配置底座与已知原生 Tab 消费部分完成。
- 源码纠错：由初始自造的 camelCase `features/configVersion` 改为兼容原版 `schema_version/config_version/feature_flags/tabs/kill_switch`，同时保留旧值兼容。
- 已恢复：包装/裸响应、账号隔离 config/ETag/last-fetch、304、8 秒超时、60 秒最小刷新、Accept-Language/X-App-Version/X-App-Build/X-Platform/X-Timezone、可选 Bearer、数组/字典/布尔三种 flag、稳定 rollout、动态 Tab enable/order/minBuild/去重/core 回填。
- 自动验证：新增原 Swift snake_case fixture；当前 3 suites / 9 tests、完整 `pnpm validate` 和 iOS export 均通过。
- 未完成：动态 screen/web Tab、各业务子配置 renderer、资源 manifest、真实 `/app/config` 联调、Tab badge/深链/栈修复与最终截图 diff。

## 2026-08-06：Message / ChatView 第一轮行为与视觉还原

- 结果：文字聊天核心与第一层视觉部分完成，整个聊天系统仍未完成。
- 源码纠错：消息 canonical 字段改为 `id/sender_id/receiver_id/msg_type/timestamp`；移除原版不存在的气泡内时间；按 `client_message_id` 而非临时 server ID 保持乐观气泡身份。
- 已恢复：14 组 flexible 字段别名、payload/gift content、撤回归一化、reply preview、thumbnail、`before_id/after_id/limit/has_more`、排序、首屏/历史分页、乐观发送/失败重试、账号会话隔离草稿、后台保存、2 分钟时间分隔、双侧 36pt 头像、18pt 气泡与原版 composer 第一层结构。
- 自动验证：新增消息 flexible decode/撤回/reply/分页排序测试；当前 3 suites / 10 tests 与完整 `pnpm validate` 通过。
- 未完成：SQLite/持久 outbox/WebSocket/读回执及所有媒体、钱、礼物、贴纸、回复、多选、转发、菜单、录音、通话等高级能力，详见总表第 10/27 项。

## 2026-08-08：ContactListView 第 11 项代码/API/状态阶段收口；锁屏阻断固定双机终验

- **范围与事实源**：严格按 `ContactListView.swift` → `src/app/(tabs)/conversations.tsx` 复刻消息/会话列表；ContactsTab/MainTab 留在第 25 项。11 份 Swift/模型/服务事实源与只读原项目逐字节一致，原项目 tracked/staged diff 仍为空；图片与数字资产没有重绘、压缩、替换或删除。
- **功能与后端**：会话、好友、Agent 会话、installed Agent、ScriptRoom 合并；owner-scoped 缓存/草稿/pin/hidden/live-pair/read、2 分钟 TTL/30 天 stale、single-flight、revision/snapshot 单调、A→B→A/登出迟到隔离、实时消息优先、搜索、左滑、置顶/隐藏/删除、四类路由、暗色/十语言/Dynamic Type/VoiceOver均已收口。会话/好友/Agent/剧本房读取、Agent 会话创建、偏好、DM/群清历史及已读等 12 条调用均有 path/method/auth/body/envelope/timeout/idempotency/retry 契约。
- **自动门**：本项 6 suites/44 tests、相邻 7 suites/41 tests、Prettier、隔离 ESLint、TypeScript 通过；iOS Metro 为 3496 modules/68 assets，临时导出已删除。最近全量 207/209、1202/1204 的两个失败来自并行中的 DynamicScreen，本项全绿，待并行收口后统一复跑。
- **固定模拟器门**：Native `5E04A5DE-7C70-4E30-BF7D-4A2A34C109BE` 与 Expo `B8892B82-E4CB-4BAE-A054-49573EBAD2A9` 同为 iPhone 17 Pro Max/iOS 26.4，Expo 真包已通过 LAN Metro 加载；macOS 锁屏阻断了仅允许在 UI 中输入的测试账号，无法进入同账号会话状态。无效登录截图已精确删除，Metro 已停，agent 自己的两台模拟器已 Shutdown；未生成伪造 95–98% 结论。
- **结论与整体进度**：独立审计为 `artifacts/acceptance/contact-list-current/audit.md`。第 11 项继续 `🟡`，正式完成仍为 **3/47（6.38%）**；前端 95–98% 双机门继续启用，功能/API 100% 一一对应门不变，EAS 云端阶段仍按用户顺序暂不开始。

## 2026-08-08：MainTabView 系统图标角标补齐；模拟器门继续启用

- **原生一致性**：Expo 的 Push bootstrap 同时订阅当前账号的 Messages 未读总数和 Moments 未读数，把二者之和写入系统 App 图标；本地已读、朋友圈清除、账号切换和退出都会重新同步，行为对应原生 `UnreadBadgeStore.totalUnreadCount` 与 `syncApplicationBadge()`。
- **自动门**：主 Tab/Push/ContactList/Remote Config/根标题聚焦 **7 suites / 41 tests**、目标 ESLint、Prettier、strict TypeScript 全部通过；原生事实源保持只读。
- **验收状态**：当前 `Booted=0`，没有为了赶进度新增模拟器。固定同型号双机下的 0/1/99/100、推送增长、已读清除、换号与 App 图标实显 95–98% 验收尚未执行，因此第 25 项仍为 `🟡`，整体正式完成仍为 **3/47（6.38%）**。

## 2026-08-08：MomentsView owner 隔离与原生评论长按菜单收口

- **功能修正**：Feed/详情/乐观发布/上传状态/mutation 总线全部 owner-scoped；页面按账号和模式 remount，卸载后的加载、点赞、评论、删除、解锁、图片准备迟到结果不再提交。旧账号的临时动态、确认动态或失败状态不能串入新账号。
- **交互修正**：评论文字普通点击继续回复；长按使用系统 context menu，可进入评论者资料，回复评论还可进入被回复者资料，标签和原 Swift 一致。
- **自动门**：Moments/Create/Profile/Gallery/Video 聚焦 **9 suites / 60 tests**、目标 Prettier/ESLint、全仓 strict TypeScript 通过；原 `MomentsView.swift`/`MomentsViewModel.swift` 与桌面事实副本逐字节一致，原项目 tracked/staged clean。
- **验收状态**：没有启动模拟器或制造截图。真实后端与固定同型号双机的 Feed/详情/上传/评论菜单/解锁/换号/浅暗色/大字/VoiceOver/95–98% 尚待执行，因此第 28 项仍为 `🟡`，整体仍为 **3/47（6.38%）**。

## 2026-08-08：UserProfileView 第 44 项严格后端契约检查点

- **代码/API 收口**：Public profile、User moments、Public agents、Short drama series 都严格要求原生 `APIResponseWrapper` 和 data；Moment like 要求 wrapper，并保持原生缺 data 时 false。Follow/unfollow、推荐与四路 fallback、Agent resolver、短剧分页继续使用原 path/query/body。
- **跨账号与交互**：用户主页按 owner+target keyed remount，资料/推荐/关注和三个内容 Tab 都有 generation gate；内容加载的 busy gate 也按 generation 占用，旧 StrictMode effect 不会挡住新代次。朋友圈 mutation/upload 状态按 owner 隔离。评论文字普通点击回复，长按原生菜单可进入评论者及被回复者资料。
- **自动门**：UserProfile 关联 **8 suites / 46 tests**、范围 ESLint/Prettier、全仓 strict TypeScript 通过；原 Swift 文件与桌面事实副本逐字节一致，原项目 tracked/staged clean。
- **证据与清理**：本轮 `Booted=0`，没有生成截图、diff、bundle 或临时日志，因此无需清理；此前临时 Metro export 已精确删除，只保留源码、测试和 `artifacts/acceptance/user-profile-current/audit.md`。
- **当前结论**：第 44 项继续 `🟡`；固定双模拟器同状态 95–98%、真实后端、三 Tab、菜单/键盘/媒体、十语言/暗色/大字/VoiceOver 仍待验，正式整体仍为 **3/47**。

## 2026-08-08：Follow relationship 跨页面 owner 隔离修正

- **发现的真实缺口**：原关系总线虽然事件可选带 owner，但订阅者仍共享一个全局 Set，且 AddFriend/UserProfile 的部分发布未传 owner；旧账号迟到关系理论上可写入新账号页面。
- **修正**：listener 改为 normalized owner 分桶；blank owner no-op；关系成功只更新对应 owner 的 profile/follow caches。AddFriend 增加账号 generation 与换号状态清理，UserProfile 以 owner+target key remount；FollowList/ShortDrama/UserProfile/AddFriend 全部按 owner 订阅和发布。
- **自动门**：跨消费者 **13 suites / 73 tests**、范围 ESLint/Prettier、strict TypeScript 通过；测试明确证明 owner A 不触发 owner B，以及 AddFriend 换号后旧关注完成不广播。
- **证据与结论**：`Booted=0`，没有生成截图、export、日志或临时文件，因此无需清理。第 2/17/37/44 项仍为代码阶段 `🟡`，固定双模拟器 95–98% 与真实后端待验；整体正式进度仍为 **3/47**。
