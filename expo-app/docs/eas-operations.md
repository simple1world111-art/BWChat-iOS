# BBchat EAS Build / Update 操作手册

## 一次性切换边界

旧蒲公英 Swift 包不含 Expo Updates 客户端，因此无法通过任何代码或后台配置变成 EAS OTA 接收端。切换时每台设备必须安装一次本工程生成的新二进制：

- 开发设备：Development Build。
- 内部朋友：Preview 内部分发（iOS Ad Hoc 需要登记设备），或 Production 提交 TestFlight 后统一安装。
- 完成这次安装后，同一 runtime fingerprint 下的 JS/TS/图片等资源更新不再需要蒲公英，也不需要重新安装 App。

## 1. Expo 项目绑定

源码已经绑定 Expo owner `wegpt` 与 EAS Project ID `f623eda4-1a5f-4227-9890-1a2eb5a6df2c`；这些是公开项目标识，不是密钥。当前机器仍未登录 Expo，因此这里只能验证本地配置，不能把源码绑定误写成账号访问或真实发布已经通过。先在 `expo-app` 目录执行只读检查：

```bash
pnpm eas:whoami
pnpm eas:config:verify
```

只有迁移到另一个 Expo 项目时才运行 `eas:init`，并同步复核源码、GitHub Environment 与已安装二进制的 updates URL。

然后在 EAS 的 development、preview、production 三套 Environment 中配置：

```text
EAS_PROJECT_ID=<真实 UUID>
EXPO_OWNER=<Expo 账号或组织>
APP_ENV=development | preview | production
EXPO_PUBLIC_API_BASE_URL=<对应环境 API /api/v1>
EXPO_PUBLIC_WEB_BASE_URL=<对应环境 Web 根地址>
EXPO_PUBLIC_WEBSOCKET_URL=<对应环境 WebSocket URL>
EXPO_PUBLIC_REMOTE_CONFIG_URL=<对应环境 /app/config>
EXPO_PUBLIC_IOS_ADMOB_APP_ID=<对应环境 iOS AdMob App ID>
EXPO_PUBLIC_ANDROID_ADMOB_APP_ID=<对应环境 Android AdMob App ID>
EXPO_PUBLIC_SENTRY_DSN=<可选>
```

`EXPO_PUBLIC_*` 会进入客户端，不能放密码、私钥、管理令牌或其他秘密。`EXPO_TOKEN`、`SENTRY_AUTH_TOKEN` 只放 EAS Secret / CI Secret。

当前三个 EAS build profile 都设置了 `SENTRY_DISABLE_AUTO_UPLOAD=true`：在尚未提供 Sentry org/project/token 时，先保证首次安装包不会被 source-map/dSYM 上传步骤阻断。Sentry 凭据配置并验证后，应移除该变量、重新构建并单独验收 source map。

## 2. 首次二进制

先验证，再分别构建：

```bash
pnpm validate
pnpm expo:doctor
pnpm build:development:ios
pnpm build:preview:ios
pnpm build:prod:ios
pnpm submit:prod:ios
```

Android 使用对应的 `:android` 脚本。Production iOS 提交后，从 TestFlight 给朋友安装一次；以后 compatible OTA 直接进入同一 App。

首次包必须验证：登录/离线身份恢复、消息/地图/发现/我的、相机/相册/麦克风/定位/通知权限、冷启动、后台回前台、Sentry 环境标签与 Update metadata。

## 3. Preview OTA

任何更新都先发 Preview：

```bash
pnpm update:preview:dry-run -- "修复消息列表空状态与登录猫咪动效"
pnpm update:preview -- "修复消息列表空状态与登录猫咪动效"
pnpm update:list
```

`update:preview:dry-run` 只输出将执行的参数数组，不登录 Expo、不读取云端、不发布。确认 dry-run 后再运行 `update:preview`；它会以 JSON 输出同时包含 iOS/Android 的 update group ID，必须保留这个 UUID。Preview 发布脚本不会设置 rollout。

发布脚本会清除调用者 shell 中的 `APP_ENV`/`BWCHAT_EXPECTED_APP_ENV`，让 EAS CLI 第一次动态配置解析使用仓库内可用的 development 默认值；随后由明确的 `--environment preview|production` 加载服务端完整环境变量并再次解析。

在已安装 Preview 包上执行以下两轮：

1. 冷启动，客户端后台检查并下载，不阻塞首屏。
2. 再次冷启动，确认新 Update ID 生效。
3. 核对登录、消息、地图、发现、我的与本次改动页面。
4. 断网冷启动，确认仍能进入上次可用版本。

## 4. Production OTA

Production 脚本固定从 10% rollout 开始，不能直接全量：

```bash
pnpm update:production:dry-run -- <Preview update group UUID> \
  "VERIFIED: iOS/Android 两次冷启动、断网与改动页面均通过"
pnpm update:production -- <Preview update group UUID> \
  "VERIFIED: iOS/Android 两次冷启动、断网与改动页面均通过"
```

Preview 与 Production 的 `APP_ENV`、API/Web endpoint、APNs entitlement 等配置会进入 fingerprint，因此两套 runtime 正常情况下不同。禁止把 Preview update group 直接 `republish --destination-channel production`：这样会保留 Preview runtime 和 Preview 环境 bundle，Production 二进制不会命中，且即使误命中也会带错环境配置。

Production 脚本会先在线读取 Preview group，硬性确认它来自 `preview` branch、恰好包含 iOS/Android、两条 runtimeVersion 都非空且共享同一个有效 `gitCommitHash`；随后要求本地 HEAD 等于该 Preview commit 且整个 Git worktree clean。全部通过后，才从同一提交重新执行 `eas update --channel production --environment production --rollout-percentage 10`，生成 Production 自己的 bundle/fingerprint/runtime。缺少有效 UUID、`VERIFIED:` 验收说明、任一平台、commit 一致性或 clean worktree 都会拒绝。

观察启动成功率、错误率、登录、消息同步和本次改动至少一个完整使用周期后，再用：

```bash
pnpm update:rollout -- <Production rollout group UUID> 30 \
  "APPROVED: crash/API/login metrics stable for one cycle"
pnpm update:rollout -- <Production rollout group UUID> 50 \
  "APPROVED: 30 percent metrics stable for one cycle"
pnpm update:rollout -- <Production rollout group UUID> 100 \
  "APPROVED: 50 percent metrics stable for one cycle"
```

脚本只接受 30、50、100 三个扩量点，要求有效 group UUID 和不少于 8 字的 `APPROVED:` 监控证据，并用 group-scoped、non-interactive 的 `eas update:edit`。不要在已有 rollout 未完成时发布下一条 Production update；先完成、回退或取消当前 rollout。

## 5. 回退

灰度异常时优先停止/回退 rollout：

```bash
pnpm update:revert-rollout -- <异常 rollout group UUID> \
  "INCIDENT: startup error rate exceeded the recorded baseline"
```

需要让 channel 回到先前稳定 Update 时：

```bash
pnpm update:rollback -- <最新异常 Production group UUID> \
  "INCIDENT: login regression confirmed on Production"
```

两条脚本都要求有效 group UUID、`INCIDENT:` 原因，并固定 JSON/non-interactive。`update:revert-rollout` 用于撤销仍在进行的 rollout；`update:rollback` 要求输入该 branch/runtime 最新的异常 group，由 EAS republish 前一稳定 update，若没有前一条则回到 embedded update。可先给任一命令添加 `--dry-run` 检查参数而不访问云端。

回退后必须在 Preview/Production 对应二进制上再做两次冷启动，并确认 Update ID、runtimeVersion 和 channel；重新验证登录、消息、地图、发现、我的与事故页面，并记录新 rollback group ID。服务端 Remote Config 的 kill switch 可临时阻止进入业务，但不能代替 OTA 回退。

## 6. 何时必须重新构建

以下变更会或应当改变原生 runtime，不能只发 OTA：

- 新增/删除/升级原生依赖或 Expo SDK。
- 修改 iOS/Android 权限、entitlement、Info.plist、AndroidManifest、插件或 Build Properties。
- 修改通知扩展、LiveKit、原生支付、原生地图能力等原生代码。
- fingerprint 结果变化。

普通 TS/TSX、业务逻辑、文案、打包图片与不改变原生配置的样式变化可走 OTA。发布前执行 `pnpm fingerprint:generate -- all`，并与当前安装包 runtime 对照。该命令直接使用锁定版本的 `@expo/fingerprint`，不需要 Expo 登录，分别输出 iOS/Android hash；相同输入连续运行必须逐字一致。若要复现 Preview/Production 构建的指纹，必须先提供与对应 EAS Environment 完全相同的 `APP_ENV`、`EAS_PROJECT_ID` 和所有影响 `app.config.ts` 的环境变量；Preview/Production 缺 Project ID 时命令会明确失败，避免生成不可比较的假指纹。

## 7. Production 监控与放量门

每个 10%/30%/50% 观察周期至少记录：App Version、Build Number、runtimeVersion、Update/Group ID、channel、environment、平台、设备 OS、是否 embedded update、启动成功/崩溃、API 错误率、登录、消息同步和本次业务指标。Sentry 上报必须经过敏感字段过滤，禁止 token、密码、请求 Authorization、聊天正文和用户身份进入 release evidence。

出现崩溃或启动失败明显高于发布前基线、认证/消息主流程回归、数据损坏、权限/原生能力缺失或任何 P0/P1 问题时，不得扩量；立即冻结下一比例并执行回退。没有可比较的监控基线时，`APPROVED:` 不成立，保持当前比例。

每次 Production 发布在任务/发布记录中保留下表，禁止只保存终端截图：

| 字段       | 必填内容                                                              |
| ---------- | --------------------------------------------------------------------- |
| Commit     | 完整 Git SHA                                                          |
| Preview    | group UUID、双平台 runtime、真机两次冷启动与断网证据                  |
| Production | 同 commit 新生成的 Production group UUID、10% 发布时间、操作者/审批人 |
| 放量       | 10/30/50/100 各阶段时间、指标摘要、`APPROVED:` 证据                   |
| 事故       | 异常 group UUID、`INCIDENT:` 原因、revert/rollback group UUID         |
| 终验       | 回退或全量后的双平台核心流程和 Update metadata                        |

## 8. CI/CD 与权限

- Pull Request 由 `.github/workflows/expo-ci.yml` 分开执行 secret scan、Lint、Type Check、Tests、release-policy、资产/本地化、fingerprint、Expo config 和 Expo Doctor。
- `.github/workflows/eas-update.yml` 只允许手动 `workflow_dispatch`；Preview 必须从 `develop`，Production 必须从 `main`。
- Production job 绑定 GitHub `production` Environment。仓库管理员必须在 GitHub 中为它配置 Required reviewers，且关闭管理员绕过；代码无法代替这一外部权限设置。
- `EXPO_TOKEN` 只保存在 GitHub `preview`/`production` Environment Secret 或 EAS Secret。Production Environment 应使用独立、最小权限 token，并按组织策略轮换。
- `EAS_PROJECT_ID`、`EXPO_OWNER` 不是秘密，源码已提供当前项目默认值；GitHub Environment Variable 可作为显式镜像或迁移覆盖值，但必须与源码绑定一致。`APP_ENV` 和全部 `EXPO_PUBLIC_*` 业务配置仍必须存在于对应 EAS Environment。
- Preview 发布人是获准使用 `preview` Environment 的成员；Production 发布/扩量/回滚人是 `production` Required reviewers 与获准操作者。具体人员姓名尚待仓库管理员登记，未登记前不得声称权限验收完成。
- CI 不会在 `push` 后自动发布 OTA；Production 永远需要人工选择 target、提供 Preview group UUID 和 `VERIFIED:` 证据，通过 Preview commit/clean worktree 门禁，并经过 Environment 审批。Production 会从同 commit 在 production environment 重新生成更新，绝不跨 runtime republish Preview bundle。

## 9. 密钥防护

`pnpm secrets:scan` 会扫描仓库文本和高风险凭据文件名，拒绝私钥块、常见云 token、字面量 `EXPO_TOKEN`/`SENTRY_AUTH_TOKEN` 等赋值以及 `.env`、签名证书、keystore、service-account 文件。扫描只输出路径和规则，不回显命中的秘密值。`.env.example` 只能放占位值和 `EXPO_PUBLIC_*` 公共配置。

`artifacts/` 只保存本机验收证据，并同时被 `.gitignore` 与 `.easignore` 排除，不能进入 Git 历史或 EAS 上传上下文。证据继续保留在本机；清理时不能删除源码、原始数字图片或当前验收证据。

该本地高置信扫描不能替代 GitHub Secret Scanning、组织审计日志和凭据轮换。若秘密曾进入 Git 历史，删除当前文件不够：必须立即吊销/轮换，再清理历史并复核构建日志与 artifacts。

## 10. 当前证据与剩余外部工作

当前账号和项目已经真实接通：`eas whoami` 返回 Owner `wegpt`，`eas project:info` 返回 `@wegpt/bbchat` 与 Project ID `f623eda4-1a5f-4227-9890-1a2eb5a6df2c`。development/preview/production 三套 EAS Environment 已登记对应 `APP_ENV`、API/Web/WebSocket/Remote Config、双端 AdMob 与公开项目绑定；三个同名 Channel/Branch 已创建并读取确认。raw EAS config 的 development/preview/production × iOS/Android 六组合全部通过。

本地客户端已通过设置页十语言更新入口、后台/手动检查、15 分钟限流、并发 single-flight、下载后选择重启、缓存读写失败非阻断、最近检查结果、最低 Build/App Version 商店升级 Gate、监控标签与无敏感信息诊断复制。当前整仓为 **293 suites / 1905 tests**，发布策略 **28 cases**，密钥扫描 **1177 个文本文件**；45 个原数字资产与 10×1,138 本地化继续通过。诊断路径为“我的 → 设置 → 更新与诊断”。

仍未完成并且不得提前声称完成：

- Apple Distribution/Provisioning、App Store Connect 提交权限与可选 Sentry project/DSN/source map 上传尚未验收；Android Production Submit 仍需 Google Play service account/track。
- GitHub `preview`/`production` Environments、Production Required reviewers、实际发布/回滚人员名单与 `EXPO_TOKEN` Secret 尚未由仓库管理员配置。
- 尚未完成真实 Preview/Production Build、安装、Preview 两次冷启动/断网 OTA、Production 10% 灰度、30/50/100 扩量、撤销灰度和 rollback。
- 因此账号、项目、环境、通道与本地发布门已完成，但“朋友安装一次新包后持续收到 OTA”仍需后续真实安装包和 OTA 证据才能最终验收。
