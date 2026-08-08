# 固定 47 项批量验收流程

## 目标与不变门槛

- 正式范围固定为 47 个功能页面/组件，不把测试、共享组件、审计或基础设施另算成功能项。
- 前端组件样式保持 95–98% 门槛；功能与后端合同从代码层逐项确认 Swift 与 Expo 的 route、method、auth、query/body、wrapper/data、解码和状态接线 100% 一一对应。
- 不再把逐页真实后端点测作为完成门。代码/API 静态矩阵无缺口，并且固定双模拟器的代表视觉态达到 95–98%，即可记为 `✅`。
- 本地 47/47 前不执行 EAS Preview/Production OTA、灰度或回滚。

## 为什么改为批量验收

旧流程按页面反复启动模拟器、构建、登录、跑全仓测试、导出和清理，造成大量重复等待。新流程把验证分成三个层级：

1. **页面提交门**：只跑该页 focused/related tests、strict TypeScript、目标 ESLint/Prettier；代码审计完成即可进入待运行验收队列。
2. **批次工程门**：同一批源码只跑一次 full Jest、资产、本地化、飞机删除门和 production iOS export；共享结果可被该批所有页面引用。
3. **固定双机视觉门**：一次启动，连续验收同一导航域的多个页面；批次结束统一关闭两台模拟器。

工程门共享不会降低每页的代码/API 一一对应要求；它只消除对同一源码快照的重复计算。真实服务端成功、失败、弱网、冷启动和 APNs 等运行点测可作为额外信心证据，但不再阻塞页数增长。

## 固定设备和资源纪律

- Native：`4CDB4BB3-F3A0-452E-8043-EC68EF7C1E4C`
- Expo：`98115C4F-1923-423B-8B76-CF07ED611A49`
- 每个 agent 的配对均固定为同型号、同系统、同分辨率；脚本发现自己固定配对的型号或系统不符时会拒绝启动/取证。
- 其他 agent 的模拟器可以同时 Booted；脚本只提示其 UDID，绝不关闭、启动、截图或操作不属于自己的设备。每个 agent 仍最多只开自己的两台。
- Simulator 在 macOS 上是单一应用、多设备窗口；前台点击、输入和焦点切换会共享应用焦点。为彻底避免跨窗口误操作，正式视觉验收只由 root 使用固定 Native/Expo 配对执行。
- 子 agent 只负责功能实现、Swift→Expo 代码/API 自查、定向测试和复验导航说明；不得操作模拟器做正式验收，也不得登记 47 项正式完成数。它们的模拟器保持 Shutdown。
- 使用前统一 9:41、100% 电量、满 Wi‑Fi/蜂窝和 light/dark appearance；闲置或批次结束立即 shutdown。
- 两台均关闭 `Connect Hardware Keyboard`，避免后台窗口隐藏软件键盘而制造焦点假差异。
- 测试账号只在运行时 UI 输入，凭据不进入命令、源码、日志、截图文件名或审计。

## 冻结 Bundle 与开发覆盖层

- 普通 `pnpm start` 只用于实现；正式取证必须使用 `pnpm parity:serve:frozen`。
- 冻结入口固定 `CI=1 --no-dev --minify`：Metro 不监听文件变化、不触发 Fast Refresh，并使用 production-mode JS bundle。并行 agent 可以继续只读工作；bundle 建立完成前不得写共享源码。
- iOS Debug AppDelegate 通过配置插件持久调用 `RCTDevLoadingViewSetEnabled(false)`，彻底隐藏 Development Client 的蓝色 `Refreshing...` / `Reloading...` 原生条；Preview/Production 本来也不编译该开发覆盖层。
- 蓝色刷新条、Dev Menu、RedBox、launcher、远程调试器或系统权限弹窗出现在截图中时，该图直接判为无效状态，不计算视觉指标。
- 冻结 bundle 完成加载并确认无覆盖层后才允许 release 并行文件写入；当前运行中的 bundle不会被后续修改刷新。

## 批次顺序

为减少重复导航和数据准备，按业务域连续验收：

1. 认证与根导航：Splash、Login、Register、MainTab、Discover、Profile。
2. 好友、群组与聊天：联系人、好友请求、群详情、群聊、私聊、消息组件、媒体预览。
3. Agent 与剧本：Agent Hub/Creator/Chat/Message、剧本中心/详情/编辑/角色/房间。
4. 朋友圈、活动、钱包与短剧：发布/Feed/用户主页、活动中心、Wallet、短剧 Feed/系列/评论/视频/编辑器。
5. 系统和外部能力：通话、群通话、WebView、通知、相册、StoreKit/AdMob/APNs 等仍逐项完成源码/API 接线审计；真实设备或服务点测另列为非阻塞增强证据。

每批只在源码快照稳定后开始。共享代码在批次中变化时，当前批次停止，重新跑一次批次工程门后继续，不能沿用旧结果。

## 每页代表视觉状态集合

不再无限追加截图，也不要求每页穷举全部运行组合。按页面可见差异从以下六类选择最少且足够的代表态；未截图的行为由源码矩阵和定向测试确认：

1. `initial`：初始/首载稳定态。
2. `content`：真实数据主态和主要导航。
3. `empty-error`：空、加载、失败、重试及服务端关闭态。
4. `interaction`：输入、键盘、菜单、分页、刷新、选择、保存或支付等主要交互。
5. `lifecycle`：仅当生命周期会产生独立可见布局时取证。
6. `accessibility`：仅选择会改变该页可见布局的代表外观/字号/长文案；语义接线从代码层审计。

同一状态必须使用相同账号、后端快照、语言、appearance、滚动位置和系统状态。不能用不同数据的两张图计算视觉相似度。

## 自动化取证

```sh
pnpm parity:pair:status
pnpm parity:pair:boot
pnpm parity:serve:frozen
pnpm parity:pair:capture -- login initial component
pnpm parity:pair:capture -- map live pixel 8
pnpm parity:pair:shutdown
```

组件局部验收可以附裁切坐标：

```sh
pnpm parity:pair:capture -- prop-bag content component 57 123 1206 2622
```

每个通过状态只保留四件当前证据：`native.png`、`expo.png`、`diff-8x.png`、`metrics.json`。新 PASS 会原子替换同状态旧文件并删除对应失败尝试；FAIL 只保留一个有界 `working/<state>` 尝试，下一次自动替换。临时截图和比较目录在命令退出时精确删除，源码、测试、原资产、文档和正式审计不在清理范围。

## 正式完成判定

每页必须同时满足：

- Swift 事实源和 Expo 功能矩阵无未解释缺口。
- 所有后端 route/method/auth/query/body/envelope/data/error/retry/idempotency 与消费状态接线从代码层逐项通过。
- 足以覆盖主要可见布局差异的代表视觉态完成；不要求模拟器逐项点通真实后端功能。
- 普通页面组件样式指标至少 95%；动态地图等明确记录的系统表面可使用既定像素容差，但同样至少 95%。
- focused/related 与当前批次工程门全绿；原数字资产逐字节一致。
- 失败/中间证据已经清理，仅保留当前正式证据和 `audit.md`。

满足后才汇报该功能正式完成，并同时更新固定总进度 `N/47`。
