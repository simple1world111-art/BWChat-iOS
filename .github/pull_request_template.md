## 验证

- [ ] `cd expo-app && pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm release-policy:test`（发布脚本或 EAS 配置变更）
- [ ] `pnpm secrets:scan`
- [ ] Preview 渠道已验证（如需 OTA）

## 原生变更判断

- [ ] 本 PR 只改 JS/TS、样式、文案或打包资源，可走 EAS Update
- [ ] 本 PR 改了依赖、权限、Config Plugin、Expo SDK、图标/启动图或原生配置，必须走 EAS Build
- [ ] 已用 `pnpm fingerprint:generate -- all` 对比 iOS/Android Runtime 兼容性

## 发布

- [ ] Production 已校验 Preview 双平台 group 的同一 `gitCommitHash` 与 clean HEAD，再用 production environment 重新生成 10% 更新（禁止跨 runtime republish Preview bundle）
- [ ] 扩量只按 30% → 50% → 100%，并附 `APPROVED:` 监控证据
- [ ] 回退/回滚已记录坏 group UUID、`INCIDENT:` 原因、操作者与验证结果
- [ ] 没有提交 Token、私钥、证书或密码
