# Swift→Expo API 合同第二层库存

> 生成时间：2026-08-08T02:26:36.153Z  
> 生成脚本：`scripts/generate-api-contract-inventory.mjs`

本报告自动推断 route + HTTP method，并附带 auth、idempotency、no-cache 线索，只用于发现候选差异。通过不等于完整合同验收；body、响应 envelope/别名、错误、分页、账号隔离、并发/重试、生命周期和成功状态回写仍需域级测试。

## 汇总

| 项目                                           | 数量 |
| ---------------------------------------------- | ---: |
| Swift 调用合同                                 |  211 |
| Swift method 已推断                            |  211 |
| Expo 同 route+method 候选存在                  |  211 |
| Expo method+auth+idempotency+no-cache 线索一致 |  211 |
| method 候选缺口                                |    0 |
| auth/idempotency/no-cache 线索待判定           |    0 |
| 需人工判定 method                              |    0 |

## 候选差异/人工判定

| Native route | Native method | Swift function | 状态               | Expo 候选 |
| ------------ | ------------- | -------------- | ------------------ | --------- |
| —            | —             | —              | 无 method 候选差异 | —         |
