# BBchat Expo / EAS 热更新版

这是从原 Swift 工程完整复制后，在独立桌面目录中新增的 Expo SDK 57 工程。原 Swift 源码保留在父目录 `BWChat/`，迁移代码位于本目录；原桌面工程 `BWChat-iOS` 不参与修改。

## 当前事实

- 分支：`codex/hot`
- iOS Bundle ID / Android package：`com.bwchat.app`
- Runtime：Expo fingerprint policy
- Channel：`development`、`preview`、`production`
- Production OTA：发布脚本强制从 10% rollout 开始
- 迁移状态：目前仍是逐页迁移阶段，不能把入口或占位页视为原版已还原

完整清单见：

- [迁移状态总表](./docs/migration-status.md)
- [逐次进度日志](./docs/parity-progress-log.md)
- [自动生成的原生审计](./docs/native-audit.generated.md)
- [EAS 发布与回滚手册](./docs/eas-operations.md)

## 本地开发

需要 Node.js 22 与 pnpm 11。

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm validate
pnpm start
```

此项目包含自定义原生模块与 `expo-updates`，正式调试应使用 Development Build，不以 Expo Go 作为最终验收环境。

```bash
pnpm build:development:ios
pnpm build:development:android
```

## 每次提交前

```bash
pnpm audit:native
pnpm validate
pnpm expo:doctor
pnpm exec expo export --platform ios --output-dir dist-ios
```

当前本机基线：原生 51 个图片文件 SHA-256 校验通过；10 语言 × 1,138 条记录逐值校验通过；ESLint、TypeScript、22 个 Jest suites / 114 tests、Expo Doctor 20/20 与 iOS export（2,714 modules，8,153,006-byte bundle）均通过。以上是代码级验收，不代表页面已经通过截图像素验收。

## 关键边界

蒲公英安装的旧 Swift 二进制不包含 `expo-updates`，不能接收 EAS Update。所有朋友必须先安装一次新的 EAS 构建；之后只要 runtime fingerprint 兼容，JavaScript、TypeScript 与打包资源更新即可通过 OTA 下发。新增/升级原生模块、权限、原生配置或 SDK 导致 fingerprint 改变时，仍需重新构建并让用户安装新二进制。
