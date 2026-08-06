# BWChat 微信式红包与转账核心闭环后端实施 Prompt

你是 BWChat 后端 Agent。请直接检查并修改后端仓库，使聊天猫币红包和转账支持 iOS 端完整的微信式核心闭环。不要只给分析或伪代码；先识别技术栈、数据库、迁移工具、任务队列、WebSocket 和测试框架，再按现有风格实现并执行测试。

## 产品约束

1. 货币为整数猫币，不使用小数、浮点数、微信支付或真实货币。
2. 不新增支付密码、Face ID 或支付挑战；已登录 JWT 和现有风控继续生效。
3. 支持私聊红包、群拼手气红包、群普通红包、群专属红包、私聊转账和群内指定成员转账。
4. 未领取红包 24 小时后退回剩余猫币；未收转账 24 小时后全额退回。
5. 红包领取前不得通过消息、推送、WebSocket 或普通会话成员接口泄露金额。

## 保留并兼容现有端点

```text
GET  /wallet/chat-money/config
POST /wallet/red-packets
POST /wallet/transfers
GET  /wallet/chat-money/{asset_id}
POST /wallet/red-packets/{asset_id}/claim
POST /wallet/transfers/{asset_id}/accept
POST /wallet/transfers/{asset_id}/return
```

## 配置接口

- 将红包和转账的 `minimum_amount`、`maximum_amount` 分开。
- 返回 `red_packet_minimum_amount`、`red_packet_maximum_amount`、`transfer_minimum_amount`、`transfer_maximum_amount`、`maximum_packet_count`、`expires_after_seconds`、`maximum_greeting_length`、`maximum_transfer_note_length`。
- 保持旧字段一段兼容期，旧客户端必须继续可用。

## 红包规则

- `direct`：仅私聊接收者可领取，`packet_count=1`。
- `lucky`：群成员每人最多一次，`total_amount >= packet_count`；并发分配必须保证每份至少 1 猫币、总和精确等于 `total_amount`，最后一份领取后状态为 `completed`。
- `equal`：`amount_per_packet × packet_count` 必须精确等于 `total_amount`。
- `exclusive`：仅 `recipient_id` 可领取，`packet_count=1`。
- 群 `lucky` 与群 `equal` 的发送者只要仍是有效群成员，也可以像其他群成员一样领取一次自己发出的红包；不得因为 `sender_id == viewer_id` 将 `can_claim` 置为 `false`。仅私聊 `direct` 的发送者，以及不是指定对象的 `exclusive` 发送者不可领取。
- 群成员资格在创建和领取时都要校验；退群、被移除、群解散等情况返回稳定机器码。
- 领取接口必须幂等；重复请求返回第一次领取形成的同一金额，不得重复入账。
- 抢完、过期、已领取、非专属对象分别返回稳定 `unavailable_reason`。

## 转账规则

```text
pending -> accepted
pending -> returned
pending -> expired_refunded
```

上述三个终态不可逆。仅指定 `recipient_id` 可以 `accept` 或 `return`。创建、冻结、收款、退还、到期退款、账本和钱包流水必须在数据库事务中完成；并发动作只能有一个终态胜出。

## 详情接口按 JWT 当前用户返回

- 新增 `created_at`、`finalized_at`、`viewer_state`、`unavailable_reason`、`remaining_amount`、`remaining_count` 和 `version`。
- `can_claim`、`can_accept`、`can_return` 必须与 `viewer_state` 一致。
- 红包发送者可看总额和剩余汇总；已领取者可看自己的领取金额；未领取普通成员在领取前不能看到总额或其他敏感金额。
- 领取列表只在产品允许的红包详情状态返回。
- 转账金额对会话参与者公开，但钱包余额只返回给实际受影响用户。

## 新增结构化聊天回执

- `msg_type = chat_money_receipt`。
- `content` 为 JSON，至少包含 `event_id`、`asset_id`、`kind`、`event_type`、`actor_id`、`actor_name`、`sender_id`、`sender_name`、`scope`、`created_at`；其中 `kind` 必须为 `red_packet` 或 `transfer`，以便客户端为到期退回事件显示准确的资产类型。
- `event_type` 支持 `red_packet_claimed`、`transfer_accepted`、`transfer_returned`、`asset_expired_refunded`。
- 回执按用户可见范围写入或投递；私聊红包领取后，发送者和领取者能用同一结构分别渲染个性化文案。
- 禁止后端直接写死中文文案。
- 唯一键至少包含 `asset_id + event_type + actor_id`，重试不得产生重复聊天回执。
- Action 响应可返回 `receipt_message` 或 `receipt_group_message`；`chat_money_updated` 同时携带原消息更新和新增回执。
- 原消息状态更新必须保持同一消息 ID，不产生新的红包/转账卡片、不增加错误未读。
- APNs 只使用安全摘要，不泄露红包金额。

## 并发与一致性

- 使用行锁、条件更新、CAS 或等价机制，禁止无锁“先查后改”。
- 余额、冻结额、资产状态、领取记录、账本、钱包流水、回执和审计事件保持事务一致性。
- `version` 仅在真实资产变化时单调递增。
- 操作成功后立即 GET 不得读到旧状态。
- 到期任务必须幂等，且与 `claim/accept/return` 并发时只有一个结果生效。

## 机器错误码

```text
chat_money_insufficient_balance
chat_money_amount_out_of_range
red_packet_count_out_of_range
red_packet_total_too_small
red_packet_already_claimed
red_packet_empty
red_packet_expired
red_packet_recipient_only
red_packet_not_conversation_member
transfer_recipient_only
transfer_already_finalized
chat_money_idempotency_conflict
```

## 必须新增并执行的测试

- 四种红包模式的创建、领取、金额守恒和权限测试。
- 20 个并发领取、最后一份领取、重复领取、领取与到期并发测试。
- 转账 `accept/return/expiry` 相互竞争和重复请求测试。
- 回执唯一性、用户可见范围、历史消息与 WebSocket 一致性测试。
- 红包公共消息及通知不泄露金额的契约测试。
- 事务任一步失败时的完整回滚测试。
- 旧配置字段和旧客户端消息结构的兼容测试。

最终报告列出根因、修改文件、数据库迁移、接口样例、WebSocket 样例、并发测试结果、回滚方案和实际执行命令。不要用 iOS 本地缓存代替服务端幂等或资金安全。
