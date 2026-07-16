# BWChat 猫粮红包与转账：后端实现 Prompt

你是 BWChat 后端仓库的实现 Agent。请先阅读仓库的 `AGENTS.md`、认证/钱包/消息/群聊/WebSocket/APNs/迁移/测试实现，再在现有技术栈和约定内完成本需求。不要另起一套钱包或消息系统，不要只写设计文档；需要完成迁移、业务代码、任务、接口、事件、测试和运行说明，并实际执行仓库适用的自动化命令。

## 一、不可更改的产品规则

1. 资产单位是整数“猫粮”，不得出现小数或浮点运算；发送方扣减多少，接收方合计增加多少，平台手续费固定为 0。
2. 私聊支持单人红包和单人转账；群聊支持拼手气红包、普通红包、专属红包和指定成员转账。
3. 红包领取前不公开金额。转账金额在聊天卡片中公开。群聊专属红包只有指定成员能领；群转账全群可见，但仅指定成员能收款或退还。
4. 创建成功时立即冻结发送方猫粮。24 小时未完成自动退款；群红包部分领取时只退未领取余额。
5. 转账发送者不能主动撤销。指定收款人可在领取前退还。
6. 群普通/拼手气红包允许发送者本人领取；专属红包和群转账禁止指定自己。每位用户对同一个红包最多成功领取一次。
7. 收到的猫粮可继续消费，并按现有提现体系进入可提现资产；因此必须保留资金来源谱系，支持提现延迟、异常冻结、追溯和运营处置。
8. 单笔默认 1–20,000 猫粮；群红包最多 100 份，且不得超过当前群成员数。限制最终由服务端配置返回并强制执行。
9. 生产功能开关 `chat_red_packet_enabled`、`chat_transfer_enabled` 默认关闭。未完成实名、年龄/地区准入、AML、制裁筛查、风控及 Apple 审核确认前不得打开。

### 验收与启用要求

- 完成后端账本、权限、风控与自动化验收不等于自动启用。测试/预发布环境需要显式设置 `chat_red_packet_enabled=true`、`chat_transfer_enabled=true`，并让 `GET /wallet/chat-money/config` 对验收账号返回 `red_packet_enabled=true`、`transfer_enabled=true`。
- iOS 以 `GET /wallet/chat-money/config` 为资金功能的唯一权威开关；不要要求新版本同时依赖 `/app/config` 才能开放。为兼容仍使用旧入口开关的已发布客户端，`GET /app/config` 的 `feature_flags` 也应同步返回同名 key、`enabled=true`、`rollout_percentage=100`。
- 当前用户仍须通过 eligibility 校验。验收账号必须返回 `eligibility.eligible=true`；未通过实名、年龄、地区或风控检查的账号返回明确 `reason_code`、安全文案和可选处理 URL，不能误报为全局功能未开放。
- 修改 `/app/config` 时同步更新 `config_version` 与 HTTP `ETag`，避免客户端在刷新周期内持续使用旧缓存。
- 生产环境只有在上述合规前置条件完成后才能执行同样的显式启用步骤；回滚时两个接口的开关必须同时关闭，但已有资产的收款、退款和过期任务继续运行。

状态机只能是：

- 红包：`pending -> partial -> completed`，或 `pending/partial -> expired_refunded`。
- 转账：`pending -> accepted | returned | expired_refunded`。

所有状态只允许前进。领取、收款、退还、创建重试和过期任务都必须幂等。

## 二、先确认并复用的现有能力

开始编码前，请定位并复用：

- JWT 当前用户解析、好友关系、群成员/禁言/封禁校验。
- 钱包余额、充值猫粮、礼物收入、提现余额、冻结余额及钱包流水。
- 私聊消息表、群聊消息表、会话摘要、历史分页、未读计数。
- WebSocket 发布与多设备 fan-out、APNs 推送、后台任务/定时任务、审计系统。
- 现有事务、行锁、分布式锁、幂等键和迁移工具。

若现有钱包只有单一 `balance`，不要用“先扣余额再异步记账”的方式实现。必须先补齐可用、冻结、待提现/可提现所需的账本语义，并在同一数据库事务里变更。

## 三、数据模型与迁移

按仓库命名规范创建等价结构，并为外键、状态查询、到期扫描和幂等访问加索引。

### 1. `chat_money_assets`

至少包含：

- `id`：不可枚举的 UUID/ULID，API 中的 `asset_id`。
- `kind`：`red_packet | transfer`。
- `scope`：`dm | group`。
- `red_packet_mode`：`direct | lucky | equal | exclusive`，转账为空。
- `sender_user_id`、`receiver_user_id`（私聊对方）、`group_id`、`designated_recipient_user_id`。
- `total_amount`、`claimed_amount`、`refunded_amount`、`packet_count`、`claimed_count`，全部为受约束的 64 位整数；写入 API 前确认可安全解码为 iOS `Int`。
- `greeting`（最多 60 个字符）、`note`（最多 20 个字符）。
- `status`、`version`（每次可见状态改变原子递增）。
- `client_message_id`、关联私聊或群聊 `message_id`。
- `expires_at`、`completed_at`、`created_at`、`updated_at`。
- 风控字段：`risk_state`、`frozen_reason`、`review_case_id` 等，或复用现有风险表。

约束：

- `(sender_user_id, client_message_id)` 唯一。
- `total_amount > 0`，`0 <= claimed_amount + refunded_amount <= total_amount`。
- 私聊必须有 `receiver_user_id`，群聊必须有 `group_id`。
- `direct` 红包固定一份；`exclusive` 固定一份且必须有指定成员。
- 转账必须有指定接收人，且红包字段组合合法。

### 2. `red_packet_claims`

至少包含 `id`、`asset_id`、`user_id`、`amount`、`allocation_index`、`claimed_at`、关联收入账本交易 ID。`(asset_id, user_id)` 唯一，`(asset_id, allocation_index)` 唯一。

### 3. 不可篡改双向账本

复用或扩展现有 ledger。每笔经济动作有一个事务头和至少两条借贷分录，分录只能追加，不能 UPDATE/DELETE 修正；冲正必须追加反向交易。至少覆盖：

- 创建：发送方可用余额 -> 资产冻结托管。
- 红包领取：资产冻结托管 -> 领取人可用余额。
- 转账收款：资产冻结托管 -> 指定收款人可用余额。
- 到期/退还：资产冻结托管 -> 发送方可用余额。

每个 ledger transaction 有唯一 `operation_key`，例如 `red_packet:create:{asset_id}`、`red_packet:claim:{asset_id}:{user_id}`、`transfer:accept:{asset_id}`、`chat_money:expire:{asset_id}`。事务提交前校验分录和为 0、币种一致、余额不为负。

### 4. 资金来源谱系

收到的猫粮允许提现，必须记录每一份收入来自哪个发送用户、哪个资产、发送方余额的原始来源批次（IAP、礼物收入、其他转赠等）。领取时按明确且固定的 FIFO 或现有 lot 规则切分/转移来源批次，不得把来源洗成“普通余额”。

来源 lot 至少可回答：当前可提现猫粮源自哪些 IAP 订单/收入、经过几次转赠、关联哪些账号/设备/IP、是否处于提现等待期或风险冻结。禁止形成通过相互转账重复计入收益、突破提现限制或丢失 chargeback 追索关系的闭环。

### 5. 钱包流水

返回现有 `WalletTransaction` 可解码格式，新增类型：

- `red_packet_sent`：发送方负数语义。
- `red_packet_received`：领取人正数语义。
- `red_packet_refund`：发送方正数语义。
- `transfer_sent`：发送方负数语义。
- `transfer_received`：收款人正数语义。
- `transfer_returned`：发送方正数语义。

流水需要关联 `asset_id`、对方用户、群聊（如有）、账本 transaction、来源谱系和人类可读 note。不得把冻结和退款重复算作消费/收入。

### 6. 迁移安全

- 迁移先加表/字段/索引，再部署兼容代码，最后启用消费者和定时任务。
- 给出向前迁移和回滚命令。回滚只能关闭功能和停止新建，不得删除已发生账本、领取、审计或来源数据。
- 对大型钱包/消息表使用在线索引或仓库现有低锁方案。

## 四、原子业务流程

### 创建红包/转账

在一个数据库事务内：

1. 锁定发送方钱包，验证功能开关、JWT、实名/年龄/地区/日限额、账户和风险状态。
2. 校验好友关系或当前群成员身份；校验指定成员仍在群内，且专属红包/群转账目标不是自己。
3. 校验金额、份数、文本长度、余额和来源 lot 的可转赠/可提现属性。
4. 使用 `(sender_user_id, client_message_id)` 幂等读取或创建；同 key 不同请求体返回 `409 idempotency_conflict`。
5. 创建资产，冻结资金并追加平衡账本。
6. 创建唯一聊天消息。`msg_type` 固定为 `red_packet` 或 `transfer`，`content` 是下述版本化 JSON 字符串。
7. 更新会话摘要但不增加发送方自己的未读。
8. 提交后才发布 WebSocket/APNs；发布使用 outbox，避免数据库成功而事件丢失。

HTTP 超时后以同一 `client_message_id` 重试，必须返回同一个资产、同一个消息 ID，不得重复冻结或重复发消息。

### 红包领取

在单事务内锁定资产行（或使用等价的原子 CAS）：验证状态、到期时间、可领取角色、群成员身份、唯一领取约束；确定金额；写 claim；从托管转给领取人；转移来源 lot；写流水；更新 claimed 数量/金额、状态和 version；写 outbox。

并发 100 个领取请求不得超发、不得负余额、不得产生两个相同用户领取记录。重复请求返回第一次成功的同一结果；已被别人领完返回稳定业务错误。

### 拼手气整数分配

不得使用浮点数。推荐在创建时用密码学安全随机源预生成不可变的整数份额并随机排列：

- `N` 份总额 `T`，先保证每份 1；在剩余整数上做有上界的随机切分。
- 所有份额严格 `>= 1`，份额总和严格等于 `T`。
- 分配结果仅存服务端，不进入公共消息 JSON。
- 领取按原子 `allocation_index` 取下一份；重试取原份额。
- 全部领完后按金额最大者标记 `is_luckiest=true`；并列时用最早领取或固定 allocation index 规则，结果确定且可复算。

普通红包每份等于 `amount_per_packet`，必须验证 `total_amount == amount_per_packet * packet_count` 且检查整数溢出。

### 转账收款/退还

只有指定接收人可以操作。`accept` 把全部冻结金额转入接收人；`return` 把全部冻结金额退回发送人。发送人没有撤回接口。两个操作并发时最多一个状态转换成功；重复同操作返回同一终态结果。

### 24 小时过期

用可重试定时任务批量扫描 `expires_at <= now` 的非终态资产，逐条锁定并处理：

- 红包退 `total_amount - claimed_amount`。
- 转账退全部金额。
- 状态改为 `expired_refunded`，写退款流水、账本、version、审计和 outbox。

任务至少一次执行也必须只退款一次。实现失败重试、死信/告警和人工补偿命令；补偿命令同样走幂等业务服务，禁止手改余额。

## 五、iOS 已实现的 HTTP 契约

所有接口使用现有 JWT 和统一响应包：

```json
{"code":0,"message":"ok","data":{}}
```

错误使用稳定 `code`/业务错误标识和安全文案；不要泄露余额、实名资料、风控规则、随机份额、他人 IP/设备或内部堆栈。

### `GET /wallet/chat-money/config`

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "red_packet_enabled": false,
    "transfer_enabled": false,
    "limits": {
      "minimum_amount": 1,
      "maximum_amount": 20000,
      "maximum_packet_count": 100,
      "expires_after_seconds": 86400
    },
    "eligibility": {
      "eligible": false,
      "reason_code": "kyc_required",
      "message": "请先完成实名认证",
      "action_url": "bwchat://wallet/identity"
    }
  }
}
```

eligibility 必须按当前用户动态返回；生产总开关关闭时两个 enabled 必须为 false。

### `POST /wallet/red-packets`

私聊单人红包：

```json
{
  "client_message_id": "018f-stable-uuid",
  "scope": "dm",
  "receiver_id": "user-2",
  "mode": "direct",
  "total_amount": 88,
  "packet_count": 1,
  "greeting": "天天开心"
}
```

群拼手气：

```json
{
  "client_message_id": "018f-stable-uuid",
  "scope": "group",
  "group_id": 42,
  "mode": "lucky",
  "total_amount": 100,
  "packet_count": 5,
  "greeting": "好运来"
}
```

群普通红包还会传 `amount_per_packet`；群专属红包传 `mode=exclusive`、`recipient_id`、仅用于公共展示的 `recipient_name`、`packet_count=1`。不要信任客户端传来的昵称，服务端用用户表当前昵称规范化。

### `POST /wallet/transfers`

```json
{
  "client_message_id": "018f-stable-uuid",
  "scope": "group",
  "group_id": 42,
  "recipient_id": "user-2",
  "recipient_name": "小白",
  "amount": 500,
  "note": "谢谢"
}
```

私聊另传 `receiver_id`，且 `recipient_id` 必须等于对方用户。

### 统一创建响应

私聊返回 `message`，群聊返回 `group_message`；另一个字段省略。必须返回最新钱包余额。

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "group_message": {
      "id": 90123,
      "group_id": 42,
      "sender_id": "user-1",
      "msg_type": "red_packet",
      "content": "{\"schema_version\":1,\"asset_id\":\"asset-1\",\"kind\":\"red_packet\",\"scope\":\"group\",\"mode\":\"lucky\",\"sender_id\":\"user-1\",\"greeting\":\"好运来\",\"packet_count\":5,\"claimed_count\":0,\"status\":\"pending\",\"expires_at\":\"2026-07-17T08:00:00Z\",\"version\":1}",
      "timestamp": "2026-07-16T08:00:00Z",
      "sender_nickname": "小黑",
      "sender_avatar": "https://cdn.example/avatar.jpg",
      "client_message_id": "018f-stable-uuid"
    },
    "asset": {
      "schema_version": 1,
      "asset_id": "asset-1",
      "kind": "red_packet",
      "scope": "group",
      "mode": "lucky",
      "sender_id": "user-1",
      "greeting": "好运来",
      "packet_count": 5,
      "claimed_count": 0,
      "status": "pending",
      "expires_at": "2026-07-17T08:00:00Z",
      "version": 1
    },
    "wallet_balance": {
      "balance": 9500,
      "total_balance": 9500,
      "recharge_claim_balance": 9500,
      "cat_hair_balance": 0,
      "cat_hair_frozen_balance": 0,
      "withdrawable_cat_hair_balance": 0,
      "locked_cat_hair_balance": 0
    }
  }
}
```

### 公共消息 `content` 的强制隐私规则

- 红包 `content`/`asset` 只能包含：`schema_version`、`asset_id`、`kind`、`scope`、`mode`、`sender_id`、可选指定人 ID/昵称、祝福语、份数、已领份数、公开状态、到期时间、version。
- 红包公共数据在任何状态都禁止出现 `amount`、`total_amount`、`claimed_amount`、未领取份额、随机种子或领取人私有资格。
- 转账公共数据包含上述通用字段以及 `amount`、指定接收人、note；金额全群可见。
- 历史消息、WebSocket、APNs、日志和分析事件同样遵守，不能只在创建接口隐藏。

### `GET /wallet/chat-money/{asset_id}`

返回按当前用户角色裁剪的详情：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "asset_id": "asset-1",
    "kind": "red_packet",
    "scope": "group",
    "mode": "lucky",
    "sender_id": "user-1",
    "sender_name": "小黑",
    "sender_avatar_url": "https://cdn.example/avatar.jpg",
    "packet_count": 5,
    "claimed_count": 2,
    "greeting": "好运来",
    "status": "partial",
    "expires_at": "2026-07-17T08:00:00Z",
    "can_claim": true,
    "can_accept": false,
    "can_return": false,
    "viewer_claim_amount": null,
    "claims": [],
    "version": 3
  }
}
```

权限裁剪要求：

- 调用者必须是私聊参与者或当前群成员，否则 403/404。
- 未领取红包的普通查看者不得收到 `total_amount`、`claimed_amount`、他人领取金额或可推导剩余金额的数据；可令 `claims=[]`。
- 领取成功后可返回该用户自己的 `viewer_claim_amount`；红包完成后或发送者查看时，才按产品规则返回总额和完整领取明细。
- 专属红包非指定成员 `can_claim=false`；已领取用户不能再次领取。
- 转账指定接收人 pending 时 `can_accept=true`、`can_return=true`；其他人及发送人均为 false。
- 终态所有动作布尔值都为 false。

### 动作接口

- `POST /wallet/red-packets/{asset_id}/claim`
- `POST /wallet/transfers/{asset_id}/accept`
- `POST /wallet/transfers/{asset_id}/return`

成功统一返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "detail": {"asset_id":"asset-1","kind":"red_packet","scope":"group","sender_id":"user-1","status":"partial","can_claim":false,"can_accept":false,"can_return":false,"viewer_claim_amount":27,"claims":[],"version":4},
    "asset": {"schema_version":1,"asset_id":"asset-1","kind":"red_packet","scope":"group","mode":"lucky","sender_id":"user-1","packet_count":5,"claimed_count":3,"status":"partial","version":4},
    "wallet_balance": {"balance":1027,"total_balance":1027,"recharge_claim_balance":1027,"cat_hair_balance":0,"cat_hair_frozen_balance":0,"withdrawable_cat_hair_balance":0,"locked_cat_hair_balance":0}
  }
}
```

`detail` 需要满足 iOS DTO 的非空字段：`asset_id/kind/scope/sender_id/status/can_claim/can_accept/can_return/claims/version`。可选金额字段无权限时必须省略或为 null。

## 六、消息、实时同步和通知

### 历史与摘要

- 创建返回、历史消息、WebSocket 必须使用同一个数据库消息 ID；不得为状态更新创建新聊天消息或新未读。
- 状态更新原地替换原消息 `content`，保留 timestamp、发送者和 client correlation。
- 私聊/群聊历史接口必须支持 `red_packet`、`transfer`，不得降级为 text 或丢弃 JSON。
- 会话摘要和回复预览固定为 `[红包]`、`[转账]`，红包摘要绝不带金额。

### WebSocket `chat_money_updated`

事务提交后通过可靠 outbox 发送给所有相关在线设备：

```json
{
  "type": "chat_money_updated",
  "data": {
    "asset": {"schema_version":1,"asset_id":"asset-1","kind":"red_packet","scope":"group","mode":"lucky","sender_id":"user-1","packet_count":5,"claimed_count":3,"status":"partial","version":4},
    "group_message": {"id":90123,"group_id":42,"sender_id":"user-1","msg_type":"red_packet","content":"{...同一份公开 asset JSON...}","timestamp":"2026-07-16T08:00:00Z","sender_nickname":"小黑","sender_avatar":""},
    "wallet_balance": {"balance":1027,"total_balance":1027,"recharge_claim_balance":1027,"cat_hair_balance":0,"cat_hair_frozen_balance":0,"withdrawable_cat_hair_balance":0,"locked_cat_hair_balance":0}
  }
}
```

- 每次可见变更 `version` 严格递增；重放允许，但内容必须相同。客户端会丢弃 `version <= 当前版本`。
- 可返回完整 `message` 或 `group_message`；必须至少返回 `asset`。
- `wallet_balance` 只发送给余额实际受影响的用户，并针对每个收件人单独构造事件；绝不能把某人的余额广播给群成员。
- 多设备接收相同版本，断线重连后通过历史/详情获得最终状态。

### APNs

- 新红包：`[红包] 你收到一个红包`，不带金额。
- 新转账可按产品规则显示转账通知，但不得向非指定群成员泄露账户或私有信息。
- 领取/退款状态通知按受影响用户投递；推送 payload 只放路由所需的 message/group/asset ID，不放余额、随机份额、KYC 或风控信息。

## 七、安全、合规和运营硬要求

1. 所有服务端校验均以 JWT 当前用户为准，忽略客户端 sender、nickname、资格、余额、状态和 version。
2. 实施实名/KYC、最低年龄、允许地区、日/周/月发送与接收限额、单账号/设备/IP/支付工具关联限额。
3. 在创建、领取、收款、退还、提现前运行风控：设备指纹、IP/地理异常、撞库账号、批量小号、循环转赠、快速进出、随机红包套利、chargeback 关联。
4. 接入 AML/制裁筛查及可疑交易规则；命中时允许拒绝、延迟到账、冻结提现或进入人工审核，但不能破坏账本平衡。
5. 对新收到/多次转赠的猫粮设置可配置提现等待期；消费可用与提现可用要分开建模。
6. 审计日志记录 actor、请求 ID、client_message_id、资产、前后状态、version、账本 transaction、设备/IP 风险摘要、策略版本和运营动作。敏感字段加密/脱敏并按权限访问。
7. 提供运营只读查询、冻结/解冻、限制账号、人工退款/冲正、重放 outbox、重跑过期、标记调查案件接口。任何资金调整必须追加账本和审计，禁止直接改余额。
8. 使用速率限制、CSRF/重放适用防护、输入规范化、参数化 SQL；资产 ID 不可枚举。未授权访问尽量返回 404，避免存在性探测。

## 八、自动化测试和验收

必须新增并通过以下测试，优先使用真实数据库事务和现有 WebSocket/outbox 测试设施：

### 契约与隐私

- 六种场景：私聊红包、私聊转账、群拼手气、群普通、群专属、群指定转账。
- 红包创建响应、历史、WebSocket、APNs、日志中均不存在金额字段；恶意客户端无法通过详情未授权获取或推导金额。
- 转账公共 payload 有 amount；消息 ID 在 HTTP/WS/历史中一致；摘要分别为 `[红包]`、`[转账]`。
- iOS 示例 JSON 均可解码，snake_case 和必填字段完全一致。

### 资金不变量

- 创建余额不足不建资产、不发消息、不写半条账。
- 任意成功流程中发送方扣减 = 接收方合计增加 + 发送方退款，手续费为 0，ledger 分录和为 0。
- 普通/拼手气份额均为正整数且总和准确；测试边界 1、20,000、1/100 份和乘法溢出。
- 部分领取过期只退剩余；转账 accepted/returned/expired 三者互斥。
- 来源 lot 总量守恒，经过多次转赠仍可追溯到原始 IAP/收入，提现等待/冻结正确继承。

### 并发与幂等

- 同一 `client_message_id` 并发创建 20 次只冻结一次、只发一条消息；不同 body 冲突。
- 同一用户并发领取只成功一次；100 个用户抢少量份数不超发。
- accept/return/expire 并发只有一个终态；定时任务重复执行不重复退款。
- outbox 重放、WebSocket 重复/乱序、多设备操作和进程在提交前后崩溃均收敛到正确状态。

### 权限与风控

- 非好友、退群成员、被封禁用户、非指定人、自我指定、KYC/年龄/地区/限额/风险不合格请求被拒绝。
- 群普通/拼手气允许发送者领取；私聊红包发送者、专属非目标、群转账非目标不能操作。
- 终态接口重复调用返回幂等结果或稳定冲突，不产生新流水。

### 回归

- 现有充值、礼物、提现、钱包列表、私聊/群聊分页、未读、APNs 和 WebSocket 测试继续通过。
- 功能开关关闭时创建/操作拒绝，config 显示关闭；已存在资产的退款/过期后台处理仍继续，不能因关开关锁死资金。

## 九、交付输出

完成后请提供：

1. 修改文件清单和关键事务说明。
2. 数据库向前迁移、部署顺序、回滚/停用步骤。
3. 所有真实请求/响应/WebSocket 示例。
4. 自动化测试命令及其实际通过结果；先从仓库脚本、CI 配置或 README 找到真实命令，不要臆造。若存在例如 `make test`、`pytest`、`npm test`、迁移 dry-run/rollback、lint/typecheck，请逐项执行适用命令。
5. 仍需外部完成的 KYC/AML/制裁/Apple/牌照事项，以及确保生产开关仍为关闭的证据。
6. 对账查询：可按 asset ID 输出资产状态、claim、钱包流水、ledger 分录、来源 lot 和 outbox 投递状态，证明金额守恒且不泄露给普通 API 用户。

验收前不要打开生产功能开关，不要用 Mock 代替账本，不要把随机分配放到客户端，不要用异步补账掩盖非原子资金变更。
