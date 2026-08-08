# Expo/EAS 原始 TODO 完成审计

审计日期：2026-08-09  
原始要求：`/Users/wegpt.com/Downloads/expo_eas_hot_update_codex_todo.md`（1,065 行、237 个显式复选项）  
代码副本：`/Users/wegpt.com/Desktop/BWChat-Expo-HotUpdate`，分支 `codex/hot`  
原项目：`/Users/wegpt.com/Desktop/BWChat-iOS`，没有在其 tracked 源码上实施本次改造。

本审计把“代码/本地证据”“真实 EAS 云端证据”和“需要外部账号的证据”分开。`✅` 表示该阶段全部显式复选项已有对应证据；`⚠️` 表示实现或流程已建立，但仍有下方明确列出的外部/运行证据；`↪` 表示用户明确取消了以风险监控或逐功能设备点测作为完成门槛。

最终本地门禁：密钥扫描 1,184 个文本文件、45/45 原数字资产（聚合 `7d5a25be20c04d12ad6a9faae260fb1c6696fd9faefde071b33d9aebe60d6c6b`）、10×1,138 本地化、ESLint、strict TypeScript、296/296 suites、1,912/1,912 tests、38/38 发布策略、Android 隔离 prebuild、双端 fingerprint、7 个 EAS profile/platform config 全部通过；Expo Doctor 在显式提供 npm/CocoaPods/Xcode 工具路径后 20/20 通过。Production fingerprint 在本轮脚本/文档变更后仍与云端稳定版本逐字一致。

## 237 项逐阶段覆盖

| 原始章节                    | 项数 | 结论 | 权威证据与逐项覆盖                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ---: | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 阶段一：评估现有项目        |   26 | ✅   | `native-audit.generated.md/json` 覆盖项目结构、47 个 View、模型、资产、SDK、权限、原生能力及相机/相册/上传/推送/登录/IAP/支付/定位/音视频/后台/分享/深链；API route/contract 两套 inventory 覆盖接口。                                                                                                                                 |
| 阶段二：创建 Expo 项目      |    9 | ✅   | Expo SDK 57、TypeScript strict、Expo Router、路径别名、ESLint、Prettier、环境配置、ignore 和 `src` 分层目录均已落地并进入完整门禁。                                                                                                                                                                                                    |
| 阶段三：页面与业务迁移      |   12 | ✅   | `migration-status.md` 的 47/47 页面矩阵逐项记录组件、服务、模型、Storage、加载/空/错态、错误处理、统一 API client 与环境集中配置；后端合同按用户口径从代码侧 100% 一一对应。                                                                                                                                                           |
| 阶段四：原生能力            |    8 | ✅   | 官方 Expo 模块、Config Plugin、最小自定义 `BWChatAuthCompat`/Apple 后台媒体能力及 service 封装均有源码、prebuild、Pods/Gradle 与测试证据；页面不直接拼装底层原生生命周期。                                                                                                                                                             |
| app.config.ts               |   13 | ✅   | 名称/slug/scheme/bundle/package/version、fingerprint、updates URL、权限、原图标、透明原生启动层、Config Plugins 与公开/敏感变量边界均由 `verify-eas-config` 和 prebuild 验证。                                                                                                                                                         |
| 初始化 EAS                  |    9 | ✅   | Owner `wegpt`、`@wegpt/bbchat`、Project ID `f623eda4-1a5f-4227-9890-1a2eb5a6df2c`、expo-updates、updates URL/project extra 及双端 raw config 已在真实云端/本地读取。                                                                                                                                                                   |
| eas.json                    |    9 | ✅   | development/preview/production、对应 channel/environment、autoIncrement、internal distribution、development client 与 submit profiles 均存在；六个平台/profile raw config 通过。                                                                                                                                                       |
| 环境变量                    |    7 | ✅   | 三套 EAS Environment 已真实建立并读取；API/Web/WS/Remote Config/AdMob、`.env.example`、缺失值 Gate、密钥扫描已完成。Sentry DSN 是可选外部值，当前通过 `SENTRY_DISABLE_AUTO_UPLOAD` 明确降级，不会阻断构建。                                                                                                                            |
| 客户端更新服务              |   10 | ✅   | `src/services/update`、Provider、设置页覆盖异步非阻断检查、状态记录、手动检查、下载后重启、失败降级、监控、Development 禁用、15 分钟限流与 single-flight；iOS Preview 两次冷启已验证。                                                                                                                                                 |
| Remote Config/Feature Flags |   12 | ✅   | 默认配置、类型、远端加载、账号隔离缓存、schema、8 秒超时、失败回退、hook、maintenance、最低 Build/App Version、商店升级 Gate 与禁止执行远程代码均有源码/测试。                                                                                                                                                                         |
| Runtime 管理                |    5 | ✅   | fingerprint policy、原生变更规则、PR 模板、EAS Build 边界和发布前双端指纹检查已完成；`pnpm fingerprint:generate -- all` 可直接运行且 Production 指纹连续稳定。                                                                                                                                                                         |
| 构建流程                    |    9 | ⚠️   | Preview Android/iOS 构建、安装与 Preview channel 已通过；Android Production Store Build 已发起。独立 Android Development Client 云产物未单独制作；iOS Production Store Build 因缺 Apple Distribution Certificate/Provisioning Profile 无法完成签名，因此“Production 包/双端签名正常”尚未全部证明。                                     |
| OTA 发布流程                |    9 | ✅/↪ | Preview 先行、Production 固定 10%、清晰 message、30/50/100 与禁止无说明全量均已真实执行。原文要求观察崩溃率/API 错误率/转化后再扩量；本次没有真实用户监控样本，且用户明确要求内部自用、不以潜在风险与逐功能测试阻塞，故这三项作为用户豁免，不冒充有监控数据。                                                                          |
| 回滚流程                    |    8 | ✅/↪ | 比例调整、进行中 rollout 撤销、全量 `update:rollback`、SOP、Owner 操作者、全部 Update/Group ID 均已真实记录。回滚后的逐业务设备点测按用户“不测试功能、API 代码一致即可”规则豁免；云端最新状态已验证并最终恢复稳定全量。                                                                                                                |
| 监控和错误追踪              |   10 | ⚠️   | Sentry SDK、runtime/update/channel/environment、检查/下载/reload 错误、隐私过滤及禁止 token/密码/正文均已接线和测试；尚无真实 Sentry DSN/org/project/token，因此线上事件接收与 source map/dSYM 解析没有外部证据。                                                                                                                      |
| 自动化脚本                  |    8 | ✅   | lint/typecheck/test、双端 Build、Preview/Production Update 与固定 10% 门均在 `package.json`/scripts；发布策略当前 38 cases。                                                                                                                                                                                                           |
| CI/CD                       |   10 | ⚠️   | PR CI、develop Preview 手动任务、main Production 人工任务、禁止自动全量和 Secret 引用均在 `.github`；workflow 已升级为两个 Preview platform group。GitHub `preview`/`production` Environment、Required reviewers 与 `EXPO_TOKEN` Secret 尚未在远端仓库配置，不能由本地代码证明。                                                       |
| 测试方案                    |   27 | ⚠️/↪ | iOS 启动、登录恢复、路由/API/资产/存储/Remote Config、Preview 安装、marker OTA、首启下载、二次冷启、Production 10%/灰度/rollback 与 fingerprint 原生变更门已有证据。Android APK 已云构建但未在 Android 模拟器启动；Production 二进制隔离、断网/弱网与回滚后全业务设备点测没有完整双端证据，按用户简化功能测试规则不阻塞代码/OTA 结论。 |
| 验收标准                    |   21 | ⚠️   | Expo/RN/TS、双端构建能力、Router、Build/Submit/Update 配置、fingerprint、三环境、channel 隔离、Preview OTA、Production 灰度、rollback、非阻断、Remote Config/flags/cache、文档、secret scan 与本地质量门均满足。最终未闭环的是可安装 iPhone Production 包和真实 Sentry 接收；Android Production 构建结果也需等待。                     |
| 第一批 Codex 任务           |   15 | ✅   | 仓库评估、Expo 结构、Router、全部核心页、app/eas 配置、expo-updates、Update/Remote Config、flags、channels、Preview Build、测试 OTA、第二次冷启与剩余 TODO 输出均已完成。                                                                                                                                                              |

## 真实云端证据

- Preview Build：Android `b2a6a640-ed3e-4bdf-aa53-22e6a78d1119`、iOS Simulator `8b4e9e02-e9c4-4865-88da-704433659673`，均 `FINISHED`、commit `b62c319328acef81b14d26fbb7e7d4e0f668f6b1`。
- Preview OTA：iOS embedded `0081774e-a1a0-4c37-8063-cf200342465e` 首启后台下载；第二次冷启应用 `019fe2bc-3020-7dac-b8ec-2f4c6edbf9b4`。两张最终证据位于 `artifacts/verification/eas-preview-ota/`。
- Production 初始灰度：iOS group `860372a8-adb0-463e-95a2-d7e430d57b52`、Android `878b65d7-c56c-4137-9dd7-7b4390eaf705`，10%→30%→50%。
- Rollout 撤销：iOS `f25f78c2-1bbc-4ab5-9b52-f34a5d202837`、Android `de8d6088-0972-422d-897b-b8a66060807c`，均 rollback-to-embedded。
- 恢复并全量：iOS `52daadd8-a540-4ca5-82a1-966162d32f46`、Android `4b4eaa17-88aa-4f80-8d0e-d48f8ce80506`，10%→30%→50%→100%。
- 全量后 rollback：iOS `f37fd2a9-3b62-46e1-9fcc-ff6465531af0`、Android `f101042f-c7bb-4ae1-92d7-59446d653425`，均 rollback-to-embedded。
- 最终稳定全量：iOS `a2b703fe-5775-417a-a607-a07521258972`、Android `ab2dd7d6-97ba-4f11-8c48-20a9d3266434`；最新云端记录 `isRollBackToEmbedded=false` 且无 `rolloutPercentage`，表示已全量。
- Production runtime：iOS `610f9a3e005a9939903c424963e89631d7be538f`、Android `141af77e63b25016ffb0edb39594e365ba31c193`。
- Android Production Store Build：`4f2e2e67-2ab9-43e7-b87f-4c458a72c24d`，commit/runtime 已匹配，当前等待最终状态。

## 剩余外部动作

1. 使用有效 Apple Developer 账号在交互式 EAS credentials 流程创建/选择 Apple Distribution Certificate 与 Provisioning Profile，然后重跑 `pnpm build:prod:ios`；若朋友通过 TestFlight 安装，还需 App Store Connect 权限与 `pnpm submit:prod:ios`。
2. 等待并核对 Android Production Build；若通过 Google Play 分发 AAB，需要 Play service account/track。内部朋友也可先安装已完成的 Preview APK，以后接收 Preview channel OTA。
3. 若要启用真实错误平台，配置 Sentry DSN/org/project/token，移除 `SENTRY_DISABLE_AUTO_UPLOAD` 后重新 Build 并验证 source map/dSYM。
4. 若要从 GitHub 发布而不是本机发布，在远端创建 `preview`/`production` Environments、Required reviewers、`EXPO_TOKEN` Secret 和匹配的公开 Variables。

以上外部项不会改变 47/47 页面复刻与已经证明的 EAS Update/灰度/撤销/rollback 能力，但 Apple 签名完成前，不能声称 iPhone 朋友已经拿到可安装的 Production 包。
