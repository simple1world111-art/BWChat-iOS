# Just Clear 排行榜头像跳转

游戏容器在 `WKUserContentController` 上注册 `bwchatGameBridge`，并通过弱代理转发给 WebView coordinator；容器销毁时同时移除 handler。桥接消息和 `bwchat://profile/{user_id}` 回退协议经过同一套用户 ID 校验与 0.6 秒同用户防抖，WebView 不会打开消息中的 `deep_link`。

验证通过后仅把 `user_id` 交给 `UIKitNavigator.openUserProfile(userID:)`。该方法沿用 App 的 `UserProfileView(userID:)` 目的页，因此本人和其他用户继续使用 `UserProfileViewModel.isMe` 的现有展示规则。个人主页 push 到当前可见的 tab navigation controller；返回时原游戏 hosting controller 与 `WKWebView` 仍在导航栈中，不会重新加载游戏。

桥接拒绝日志只包含固定事件、拒绝原因和传输通道，不记录昵称、头像 URL、完整 payload、Cookie 或 token。H5 登录态继续只使用现有 HttpOnly 游戏会话 Cookie。

最低支持版本：iOS 16.0（与当前 Xcode target 一致）。本次交付仅修改 iOS 工程；Android 最低版本与 `BWChatGameBridge.postMessage(jsonString)` 接入不在此仓库内。

## 所有 H5 游戏共用的激励广告桥

游戏仍使用同一个 `bwchatGameBridge` handler，并发送 `type=bwchat.game.show_rewarded_ad`、`version=1`。原生只按 `type/version` 路由；`source` 和 `placement` 只校验为 1–64 位小写 slug，不维护游戏或广告场景白名单。因此新增符合协议的后端托管游戏不需要修改或重新发布 iOS。

安全边界依次为：主 frame、与初始游戏页同源的受信任 BWChat 后端地址、`/api/v1/game-assets/` 路径、后端 session 格式，以及 `wallet.ad_reward.ios_ad_unit_ids` 远端配置白名单。当前后端仍配置为 HTTP，因此桥接只对该配置中的同源主 frame 和托管路径提供迁移期兼容；第三方 host、跨源页面和非游戏托管路径仍会被拒绝。初始游戏页或 `AppConfig.apiBaseURL` 任一切换到 HTTPS 后，奖励广告桥会自动恢复 HTTPS 强校验，不能降级回 HTTP。当前生产广告单元作为内置安全回退；远端列表非空时会替换回退列表，因此新增或撤销广告单元都可通过配置完成。正式环境仍应尽快让后端用 HTTPS 返回游戏 launch URL。

所有请求交给唯一的 `RewardedAdCoordinator`，并与钱包入口共用进程级展示锁。游戏 WebView 打开时会按当前广告单元白名单提前加载广告；点击时复用预加载对象，消费后自动补载，避免把 SDK 网络加载延迟留到用户点击之后。每个广告对象在展示前单独设置 H5 session 返回的 `ssv_user_id` 与 `ssv_custom_data`，参数不会跨请求缓存。原生只把 SDK 终态回传为 `completed`、`dismissed`、`failed` 或 `unavailable`；不会调用 SSV 地址、增加猫币、执行复活或修改 H5 数据。H5 必须在 `completed` 后继续等待自己的后端 claim 与 Google SSV 确认。

结果首选通过 `bwchat:rewarded-ad-result` 的 `CustomEvent` 返回，同时兼容 `window.__bwchatRewardedAdResult(result)` 和页面 `postMessage`。结果使用 WebKit 参数绑定传入 JavaScript，不拼接 request/session/SSV 字段；同一 `request_id` 在当前 WebView 生命周期内最多发送一次终态。广告覆盖期间不会刷新或替换游戏 WebView。

Android 不在本 iOS 仓库的交付范围内；Android 容器需按同一协议暴露 `BWChatGameBridge.postMessage(jsonString)`，并复用其全局 rewarded-ad coordinator。新增普通 H5 游戏只需实现后端 session/claim、H5 发送器和结果监听器。
