# 红包与转账详情响应契约修复 Prompt

你是一名负责 BWChat 钱包、红包和转账服务的资深后端工程师。请直接检查并修复生产代码、序列化器、权限裁剪逻辑和自动化测试，不要只给分析或伪代码。

## 现象

iOS 中，红包或转账的发送者有时可以正常查看，但接收者、群成员或其他合法会话参与者点击后会提示“数据解析失败”。

客户端调用：

```http
GET /api/v1/wallet/chat-money/{asset_id}
Authorization: Bearer <viewer JWT>
```

该问题同时影响 `red_packet` 和 `transfer`，说明公共详情接口针对不同 viewer 角色生成的 JSON 不一致。重点排查：

- 角色/权限裁剪时误删 DTO 公共必填字段；
- `false`、`0`、空数组被 serializer 的 `exclude_none`、`exclude_unset`、`exclude_defaults` 或手写过滤逻辑删除；
- 数字、布尔值或 `version` 被转换成字符串；
- GET 接口有时返回 `data: detail`，有时返回 `data: { "detail": detail }`；
- `viewer_state`、`unavailable_reason`、`status` 输出了未约定枚举；
- 合法查看者的 403/404 被错误包装成 HTTP 200 的另一种 JSON；
- 红包与转账分别使用了不同 serializer，导致同名字段类型或空值策略不同。

## 必须完成的修复

### 1. GET 详情接口只返回一种顶层结构

`GET /wallet/chat-money/{asset_id}` 成功时必须使用：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "asset_id": "asset-1",
    "kind": "red_packet",
    "scope": "group",
    "sender_id": "user-1",
    "status": "pending",
    "can_claim": false,
    "can_accept": false,
    "can_return": false,
    "claims": [],
    "version": 1
  }
}
```

GET 的 `data` 必须直接是详情对象，不要再包一层 `detail`。顶层：

- `code` 必须是 JSON integer；
- `message` 必须是 JSON string；
- `data` 必须是 JSON object。

### 2. 所有角色都必须返回公共非空字段

无论红包还是转账，无论 viewer 是发送者、接收者、已领取用户、未领取群成员或专属红包非指定成员，以下字段都不能缺失、不能为 null：

| 字段 | JSON 类型 | 约束 |
|---|---|---|
| `asset_id` | string | 稳定资产 ID |
| `kind` | string | 仅 `red_packet` / `transfer` |
| `scope` | string | 仅 `dm` / `group` |
| `sender_id` | string | 发送者用户 ID |
| `status` | string | 仅约定生命周期枚举 |
| `can_claim` | boolean | 无权限时明确返回 `false` |
| `can_accept` | boolean | 无权限时明确返回 `false` |
| `can_return` | boolean | 无权限时明确返回 `false` |
| `claims` | array | 不可见或无记录时返回 `[]` |
| `version` | integer | 大于等于 1，状态更新后单调递增 |

禁止把 `false`、`0`、`[]` 当作空值过滤掉。

### 3. 可选字段及类型必须稳定

以下字段允许省略或为 null，但一旦返回，类型必须正确：

- string：`sender_name`、`sender_avatar_url`、`recipient_id`、`recipient_name`、`greeting`、`note`、`expires_at`、`created_at`、`finalized_at`；
- integer：`total_amount`、`claimed_amount`、`packet_count`、`claimed_count`、`viewer_claim_amount`、`remaining_amount`、`remaining_count`；
- string enum：`mode`、`viewer_state`、`unavailable_reason`。

时间字段使用 ISO-8601 string。金额统一使用最小货币单位的 JSON integer，不能返回浮点数或字符串。

红包：

- `mode` 使用 `direct`、`lucky`、`equal`、`exclusive`；
- 不得向未领取普通查看者泄露 `total_amount`、`claimed_amount`、他人领取金额或可推导剩余总金额的数据；
- 当前用户已领取时可返回自己的 `viewer_claim_amount`；
- 不允许查看明细时仍必须返回 `claims: []`，不能省略；
- 每条 claim 必须稳定返回：

```json
{
  "user_id": "user-2",
  "nickname": "小猫",
  "avatar_url": null,
  "amount": 18,
  "claimed_at": "2026-07-20T04:00:00Z",
  "is_luckiest": false
}
```

转账：

- 合法会话参与者查看时返回 `recipient_id` 和 `total_amount`；
- 转账没有领取列表，但仍返回 `claims: []`；
- `mode`、`packet_count`、`claimed_count`、`viewer_claim_amount` 可省略或为 null。

### 4. 状态与权限必须按当前 JWT viewer 计算

允许的 `status`：

- 红包：`pending`、`partial`、`completed`、`expired_refunded`；
- 转账：`pending`、`accepted`、`returned`、`expired_refunded`。

允许的 `viewer_state`：

- 红包：`claimable`、`claimed`、`empty`、`expired`、`not_designated`、`sender_view`；
- 转账：`transfer_receivable`、`transfer_sender_waiting`、`transfer_observer`、`accepted`、`returned`、`expired_refunded`。

允许的 `unavailable_reason`：

- `red_packet_already_claimed`
- `red_packet_empty`
- `red_packet_expired`
- `red_packet_recipient_only`
- `red_packet_not_conversation_member`
- `transfer_recipient_only`
- `transfer_already_finalized`

权限规则：

- 所有终态均返回 `can_claim=false`、`can_accept=false`、`can_return=false`；
- 私聊普通红包：仅接收者在有效期内且未领取时 `can_claim=true`；
- 群 `lucky` / `equal` 红包：当前仍是群成员且未领取、未领完、未过期时 `can_claim=true`，发送者如果仍是有效群成员也可领取一次；
- `exclusive` 红包：仅指定成员可领取，其他群成员 `can_claim=false`；
- pending 转账：仅指定接收者 `can_accept=true`、`can_return=true`；
- 转账发送者和群内观察者的两个动作均为 `false`；
- 权限必须在同一事务快照中根据资产状态、会话成员关系、viewer ID 和领取记录计算，避免状态与权限互相矛盾。

### 5. 动作接口返回相同的 detail 契约

以下接口成功时允许使用 `data.detail`，但其中的 `detail` 必须满足上面完全相同的字段和类型：

```http
POST /wallet/red-packets/{asset_id}/claim
POST /wallet/transfers/{asset_id}/accept
POST /wallet/transfers/{asset_id}/return
```

标准结构：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "detail": {
      "asset_id": "asset-1",
      "kind": "transfer",
      "scope": "dm",
      "sender_id": "sender",
      "recipient_id": "recipient",
      "total_amount": 88,
      "status": "accepted",
      "can_claim": false,
      "can_accept": false,
      "can_return": false,
      "claims": [],
      "version": 2
    },
    "asset": {},
    "wallet_balance": {}
  }
}
```

### 6. 群红包领取列表必须完整、稳定且与计数一致

截图中的具体故障是 `claimed_count=3`，但 `claims` 只返回当前 viewer
本人一条。请重点检查 GET 详情接口和 claim 动作接口是否错误地把领取列表
裁剪成 `WHERE claimant_id = viewer_id`，或在 claim 成功后只序列化了本次新增
记录。

对于有权查看领取明细的合法会话参与者，必须满足：

- `claims` 返回当前事务快照中的全部已领取记录，不能只返回 viewer 本人；
- GET 详情与 claim 动作的 `data.detail.claims` 使用同一个查询和 serializer；
- `claimed_count == claims.length`；若产品确实需要分页，则必须提供明确的
  `claims_total`、稳定分页游标和独立分页接口，不能把截断数组伪装成完整列表；
- 领取记录按 `claimed_at` 升序稳定排序，同一用户同一红包最多一条；
- `is_luckiest` 未决时也明确返回 `false`，不能省略；
- `avatar_url` 无头像时返回 `null`，其他必填字段不能缺失；
- claim 事务提交后，动作响应和紧随其后的 GET 都必须能看到此前记录与本次
  新记录，禁止只返回增量记录；
- 红包未领完时，已领取 viewer 返回 `viewer_state="claimed"`、
  `can_claim=false`、`viewer_claim_amount=<本人金额>`，但资产全局
  `status` 仍为 `partial`；
- 同一时刻未领取 viewer 返回 `viewer_state="claimable"`、
  `can_claim=true`，不能因为其他用户已领取而关闭入口。

领取列表权限若因隐私策略需要限制，请返回明确的 `claims_visibility`，并让
`claims=[]`、`claimed_count` 和 UI 产品定义保持一致；不要对同一群聊中的
不同合法查看者静默返回彼此矛盾的“部分数组”。

### 7. HTTP 错误不能伪装成成功响应

- 非会话参与者访问：返回 HTTP 403 或 404；
- 资产不存在：返回 HTTP 404；
- 认证失败：返回 HTTP 401；
- 冲突/重复领取/重复收款：返回 HTTP 409；
- 错误体继续使用统一 JSON error envelope；
- 禁止返回 HTTP 200 + HTML、HTTP 200 + 字符串 `data`、HTTP 200 + 另一种错误对象。

## 必须补充的自动化测试

对红包和转账分别创建真实资产，并使用不同 JWT 调用同一个 GET 接口。至少覆盖：

1. 红包发送者；
2. 私聊红包接收者；
3. 群 lucky/equal 红包未领取成员；
4. 群红包已领取成员；
5. exclusive 指定成员；
6. exclusive 非指定但合法群成员；
7. 转账发送者；
8. 转账指定接收者；
9. 群转账合法观察者；
10. 非会话成员；
11. pending、partial、completed/accepted、returned、expired_refunded；
12. `false`、`0`、`[]` 不被 serializer 删除；
13. 所有字段 JSON 类型断言；
14. GET 不出现 `data.detail`；
15. 动作接口的 `data.detail` 与 GET DTO 使用同一个 serializer/schema。
16. 已有 2 人领取后第 3 人领取，claim 动作响应和 GET 都返回 3 条 claims；
17. 同一 partial 红包对已领取 viewer 返回 claimed，对未领取 viewer 返回 claimable；
18. `claimed_count` 与完整 `claims.length` 一致，记录顺序稳定且无重复用户。

每个 2xx 响应都要运行 JSON Schema/Pydantic/Zod 等严格契约校验。不要只断言 HTTP 状态码。

## 可观测性

为该 GET 接口增加结构化日志，但不要记录 JWT、完整昵称、头像 URL 或金额明细：

- request/correlation ID；
- `asset_id` 的安全哈希或内部 ID；
- viewer role；
- kind、scope、status；
- 输出字段名集合；
- serializer/schema 版本；
- HTTP 状态。

若序列化失败应返回 5xx 并告警，不能降级成不完整的 HTTP 200 JSON。

## 验收标准

- 所有合法角色点击红包、转账都不再触发 iOS“数据解析失败”；
- GET 始终是 `code/message/data-detail-object`；
- 公共必填字段在任何合法角色响应中都存在且类型固定；
- 权限裁剪只裁剪敏感可选数据，不裁剪 DTO 骨架；
- 红包隐私不泄露，转账金额和接收人对合法参与者正确；
- 群红包领取列表不会只剩当前用户，领取人数与列表条数一致；
- 已领取用户的卡片可呈现个人终态，未领取用户仍可领取同一 partial 红包；
- 动作权限与 viewer 身份、资产状态一致；
- 新增的角色矩阵、JSON 类型、并发和终态测试全部通过；
- 提交最终修改文件、根因、迁移兼容说明、测试命令和测试结果。
