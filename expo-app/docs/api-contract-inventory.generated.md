# Swift→Expo API 合同第二层库存

> 生成时间：2026-08-12T12:55:45.990Z  
> 生成脚本：`scripts/generate-api-contract-inventory.mjs`

本报告自动推断 route + HTTP method，并附带 auth、idempotency、no-cache 线索，只用于发现候选差异。通过不等于完整合同验收；body、响应 envelope/别名、错误、分页、账号隔离、并发/重试、生命周期和成功状态回写仍需域级测试。

## 汇总

| 项目                                           | 数量 |
| ---------------------------------------------- | ---: |
| Swift 调用合同                                 |  208 |
| Swift method 已推断                            |  208 |
| Expo 同 route+method 候选存在                  |  207 |
| Expo method+auth+idempotency+no-cache 线索一致 |  198 |
| method 候选缺口                                |    1 |
| auth/idempotency/no-cache 线索待判定           |    9 |
| 需人工判定 method                              |    0 |

## 候选差异/人工判定

| Native route                    | Native method | Swift function     | 状态                     | Expo 候选                                                 |
| ------------------------------- | ------------- | ------------------ | ------------------------ | --------------------------------------------------------- |
| `/auth/register`                | POST          | `register`         | method_candidate_missing | —                                                         |
| `/chat/messages/image`          | POST          | `sendImageMessage` | contract_flag_review     | GET src/api/bwchat.ts:1404<br>POST src/api/bwchat.ts:1581 |
| `/chat/messages/image`          | POST          | `sendImageMessage` | contract_flag_review     | GET src/api/bwchat.ts:1404<br>POST src/api/bwchat.ts:1581 |
| `/chat/messages/video`          | POST          | `sendVideoMessage` | contract_flag_review     | GET src/api/bwchat.ts:1404<br>POST src/api/bwchat.ts:1630 |
| `/chat/messages/video`          | POST          | `sendVideoMessage` | contract_flag_review     | GET src/api/bwchat.ts:1404<br>POST src/api/bwchat.ts:1630 |
| `/friends/search`               | GET           | `searchUsers`      | contract_flag_review     | GET src/api/bwchat.ts:267                                 |
| `/groups/:param/messages/image` | POST          | `sendGroupImage`   | contract_flag_review     | POST src/api/bwchat.ts:1602                               |
| `/groups/:param/messages/image` | POST          | `sendGroupImage`   | contract_flag_review     | POST src/api/bwchat.ts:1602                               |
| `/groups/:param/messages/video` | POST          | `sendGroupVideo`   | contract_flag_review     | POST src/api/bwchat.ts:1657                               |
| `/groups/:param/messages/video` | POST          | `sendGroupVideo`   | contract_flag_review     | POST src/api/bwchat.ts:1657                               |
