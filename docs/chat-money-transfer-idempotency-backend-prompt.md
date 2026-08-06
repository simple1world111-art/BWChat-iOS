# BWChat 转账终态、幂等与并发互斥专项修复 Prompt

你是 BWChat 后端 Agent。请直接检查并修改当前后端仓库，修复聊天猫币转账在“确认收款 / 退还 / 到期退款”之间可能出现的状态倒退、重复入账和并发冲突。不要只给分析或伪代码；先识别项目技术栈、数据库、迁移工具、任务队列和测试框架，再按现有代码风格实现并执行验收。

## iOS 当前契约

- `POST /wallet/transfers/{asset_id}/accept`：仅指定收款人确认收款。
- `POST /wallet/transfers/{asset_id}/return`：仅指定收款人在待收款状态主动退还。
- `GET /wallet/chat-money/{asset_id}`：返回按 JWT 当前用户裁剪的转账详情。
- 转账状态只能是：

```text
pending -> accepted
pending -> returned
pending -> expired_refunded
```

`accepted`、`returned`、`expired_refunded` 都是不可逆终态，任何终态之间都不能再次迁移。

## 必须实现的资金与状态原子性

1. 创建转账时冻结发送方整数猫币，创建、冻结账本和消息写入必须保持业务一致性。
2. `accept` 必须在一个数据库事务中完成：锁定转账、校验指定收款人、执行 `pending -> accepted` 条件更新、把冻结猫币入账收款人、写双向账本和钱包流水。
3. `return` 必须在一个数据库事务中完成：锁定转账、校验指定收款人、执行 `pending -> returned` 条件更新、把冻结猫币退回发送人、写双向账本和钱包流水。
4. 到期任务只能执行 `pending -> expired_refunded`，并且只能退款一次。
5. 禁止“先查状态再更新”的无锁竞态。使用行锁、`UPDATE ... WHERE status='pending'`、状态版本 CAS 或等价机制；受影响行数为 0 时必须读取并返回当前终态。
6. 余额、冻结余额、转账状态、账本、钱包流水和业务审计日志必须在同一事务中提交；任一步失败必须完整回滚。
7. 金额全部使用整数类型，禁止浮点计算；不得收取额外手续费。

## 幂等与冲突规则

- 同一用户重复调用同一个已成功动作：推荐返回幂等成功，响应中返回第一次形成的同一终态快照和当前余额，不得再次入账或新增流水。
- 对已 `accepted` 的转账调用 `return`、对已 `returned/expired_refunded` 的转账调用 `accept`：返回稳定 `409`，机器码 `transfer_already_finalized`，并在响应中尽量附带当前详情。
- 两台设备或并发请求同时调用 `accept`：只能有一次资金入账。
- `accept`、`return`、到期任务同时竞争：只能有一个状态迁移成功，其他操作读取胜出的终态，不得产生双重资金流。
- JWT 用户不是指定 `recipient_id` 时，`accept/return` 返回 `403`，机器码 `transfer_recipient_only`。

## 详情接口必须按当前用户裁剪

`GET /wallet/chat-money/{asset_id}` 必须返回一致的状态和权限：

```text
can_accept = status == pending AND current_user_id == recipient_id
can_return = status == pending AND current_user_id == recipient_id
```

终态时所有用户都必须得到：

```json
{
  "status": "accepted",
  "can_claim": false,
  "can_accept": false,
  "can_return": false
}
```

要求：

- 指定收款人在 `pending` 时可以看到确认收款和退还操作；发送者及群内普通成员只读。
- 操作成功后立即 GET 必须读到终态，不能因读写分离返回旧 `pending`；使用主库读取、read-your-writes token 或等价方案。
- `version` 只在真实状态变化时单调递增，终态不能被旧 HTTP/WebSocket 快照覆盖。
- 转账金额按产品设计对会话参与者公开，但余额只返回给受影响用户。

## 操作成功响应样例

`POST /wallet/transfers/tr_xxx/accept`：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "detail": {
      "asset_id": "tr_xxx",
      "kind": "transfer",
      "scope": "group",
      "sender_id": "sender_id",
      "recipient_id": "recipient_id",
      "recipient_name": "Peter",
      "total_amount": 88,
      "note": "test",
      "status": "accepted",
      "can_claim": false,
      "can_accept": false,
      "can_return": false,
      "claims": [],
      "version": 2
    },
    "asset": {
      "schema_version": 1,
      "asset_id": "tr_xxx",
      "kind": "transfer",
      "scope": "group",
      "sender_id": "sender_id",
      "recipient_id": "recipient_id",
      "recipient_name": "Peter",
      "amount": 88,
      "note": "test",
      "status": "accepted",
      "version": 2
    },
    "wallet_balance": {
      "balance": 1088
    }
  }
}
```

`return` 响应结构相同，但 `status="returned"`，钱包余额只发给实际退款到账的发送方；调用者如不是余额受影响用户，可不返回其余额字段。

## 消息、WebSocket 和多设备同步

每次唯一成功的终态迁移提交后只发送一次 `chat_money_updated`：

- `asset.status/version` 与数据库已提交状态一致；
- `message` 或 `group_message` 使用原消息 ID 和替换后的版本化内容，不创建新消息、不增加未读；
- 会话摘要同步为 `[转账]`，消息卡片显示“已收款 / 已退还 / 已过期”；
- 仅向余额受影响用户携带 `wallet_balance`；
- 多设备重复或乱序事件不能倒退资源版本，也不能重复入账；
- APNs 文案不得暴露非会话参与者的资金信息。

## 数据库迁移与审计

- 如果当前转账表没有状态版本、终态时间、终态操作者和关联账本交易 ID，请补迁移。
- 建议记录 `finalized_at`、`finalized_by_user_id`、`finalization_reason`、`version`，以及 accept/return/expiry 的幂等业务键。
- 审计日志要记录 actor、asset_id、旧状态、新状态、设备/IP 风控上下文、请求 ID和结果，但不能记录 JWT 或敏感凭证。
- 提供可安全执行的回滚方式；回滚不能删除已完成账本或重新开放终态转账。

## 必须新增并执行的自动化测试

1. 首次 accept：收款人只入账一次，状态为 accepted，冻结余额正确结清。
2. 首次 return：发送人只退款一次，状态为 returned。
3. 同一转账 20 个并发 accept：只有一个状态迁移和一组账本分录。
4. 同一转账 20 个并发 return：只有一个退款。
5. accept 与 return 各 20 个并发竞争：只能一个终态胜出。
6. accept/return 与到期任务并发：只能一个终态胜出。
7. 两台设备重复同一动作：幂等，不重复入账。
8. accept 成功后调用 return，以及 return 后调用 accept：稳定 409，无资金变化。
9. 非指定收款人、发送者、普通群成员调用动作：403，无资金变化。
10. 操作成功后立即 GET：终态一致且 `can_accept=false/can_return=false`。
11. HTTP、历史消息和 WebSocket 的资源版本一致，乱序事件不会倒退。
12. 任一事务步骤注入失败：完整回滚，不出现“状态已完成但余额未到账”或相反情况。

请运行仓库实际的迁移、单元、集成和并发测试命令。最终报告必须列出：根因、修改文件、迁移、真实请求响应样例、并发测试结果、回滚方式、所有执行命令及结果。不要用 iOS 本地终态缓存替代后端资金安全与幂等保证。
