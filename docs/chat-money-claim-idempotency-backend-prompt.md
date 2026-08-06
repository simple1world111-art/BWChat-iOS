# BWChat 红包重复领取与详情状态专项修复 Prompt

你是 BWChat 后端 Agent。请直接检查并修改当前后端仓库，修复红包领取后的详情状态错误和重复领取风险，不要只给分析或伪代码。先识别项目实际技术栈、迁移工具、测试框架与现有红包表结构，再按现有代码风格实现。

## 已确认的线上现象

同一用户点击群红包领取后：

- `POST /wallet/red-packets/{asset_id}/claim` 成功，群红包 `claimed_count` 从 `0` 变成 `1`；
- 再请求 `GET /wallet/chat-money/{asset_id}`，返回的整体状态为 `partial`，这是合理的；
- 但当前用户仍收到 `can_claim: true`；
- `viewer_claim_amount` 为空，领取明细中也没有当前用户记录；
- 因此前端重新打开详情后仍显示“开”，并可能再次提交领取。

这说明后端只更新了红包总进度，没有基于 JWT 当前用户正确裁剪详情，或者领取记录没有和余额入账在同一事务中可靠落库。前端本地防重只能作为 UX 兜底，资金安全必须由后端保证。

如果出现 `claimed_count > 0` 但 `claims: []`，也属于契约错误。尤其当当前用户已经领取时，详情必须至少返回当前用户自己的领取记录，不能让界面同时显示“已领取 1/N”和“暂时还没有人领取”。

## 必须实现的数据库约束

1. 红包领取表必须以 `(red_packet_id, claimant_user_id)` 建立不可绕过的唯一约束/唯一索引。若已有逻辑唯一判断但没有数据库约束，必须补迁移。
2. 每条领取记录必须至少保存：领取记录 ID、红包 ID、领取用户 ID、整数猫币金额、领取时间、账本交易 ID、创建时间。
3. 领取记录、红包剩余份数/余额、用户余额入账、双向账本、钱包流水必须在同一数据库事务中提交。
4. 不允许使用“先查询是否领取，再插入”的无锁竞态实现。必须依赖唯一约束，并配合行锁、原子条件更新或等价机制。
5. 迁移必须可重复执行，并提供安全回滚；回滚前检查并报告是否存在重复领取脏数据，不能静默删除资金记录。

## `POST /wallet/red-packets/{asset_id}/claim`

从 JWT 获取 `current_user_id`，不能接受客户端传入 claimant 用户 ID。事务内完成：

1. 锁定红包主记录，校验聊天可见权限、群成员关系、专属领取人、有效期和资产状态。
2. 查询或尝试插入 `(asset_id, current_user_id)` 领取记录。
3. 第一次成功领取时，只分配一份整数猫币，更新剩余金额/份数，写入余额与账本，再提交事务。
4. 同一用户对同一红包的重试不得再次扣减红包、增加余额、增加 `claimed_count` 或新增流水。
5. 推荐将重复请求实现为幂等成功：返回第一次的同一领取记录和当前最新详情；如果项目规范必须返回冲突，则返回稳定的 `409` 与机器码 `red_packet_already_claimed`。无论采用哪种方式，都不得二次分配。
6. 并发两次领取请求的验收结果必须是：领取表只有一行、用户只入账一次、红包只减少一份、账本只产生一组业务分录。

成功响应必须包含按当前用户裁剪后的数据，结构与 iOS 契约一致：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "detail": {
      "asset_id": "rp_xxx",
      "kind": "red_packet",
      "scope": "group",
      "mode": "lucky",
      "status": "partial",
      "packet_count": 3,
      "claimed_count": 1,
      "can_claim": false,
      "can_accept": false,
      "can_return": false,
      "viewer_claim_amount": 12,
      "claims": [
        {
          "user_id": "current_user_id",
          "nickname": "当前用户昵称",
          "avatar_url": null,
          "amount": 12,
          "claimed_at": "2026-07-16T10:05:30Z",
          "is_luckiest": false
        }
      ],
      "version": 2
    },
    "asset": {
      "schema_version": 1,
      "asset_id": "rp_xxx",
      "kind": "red_packet",
      "scope": "group",
      "mode": "lucky",
      "sender_id": "sender_id",
      "packet_count": 3,
      "claimed_count": 1,
      "status": "partial",
      "version": 2
    },
    "wallet_balance": {
      "balance": 1012
    }
  }
}
```

红包还有剩余份数时，整体 `status` 可以是 `partial`，但领取过的当前用户必须得到 `can_claim=false` 和自己的 `viewer_claim_amount`。红包全部领完时，整体状态必须为 `completed`。

## `GET /wallet/chat-money/{asset_id}`

详情接口必须根据 JWT 当前用户实时计算，而不是直接返回红包主表上的公共布尔值：

```text
viewer_has_claimed = EXISTS(
  SELECT 1 FROM red_packet_claims
  WHERE red_packet_id = :asset_id
    AND claimant_user_id = :current_user_id
)

can_claim =
  feature_and_user_eligible
  AND viewer_has_chat_access
  AND NOT viewer_has_claimed
  AND packet_has_remaining_share
  AND packet_not_expired
  AND exclusive_recipient_matches_if_needed
```

字段要求：

- 当前用户已领取：`can_claim=false`；
- 当前用户已领取：`viewer_claim_amount` 必须返回其真实整数金额；
- 当前用户未领取：不得通过详情或公共消息泄露随机红包中尚未领取的金额；
- `claims` 如果因隐私策略不能返回完整列表，至少必须保证当前用户自己的领取记录可用于确认状态；
- `claimed_count` 必须与领取表有效记录数一致，不能仅依赖容易漂移的缓存计数；
- `version` 在每次真实状态变更后单调递增。只读详情请求不能无故递增版本。

## WebSocket 与消息同步

首次领取事务提交后发送一次 `chat_money_updated`：

- 公共 `asset` 包含最新 `claimed_count/status/version`，不包含随机金额；
- 仅给余额受影响的领取用户发送 `wallet_balance`；
- 当前领取用户再次拉取详情时必须能读到已提交的领取记录，不能出现 WebSocket 已更新但详情读副本仍返回旧状态；
- 如果使用读写分离，领取后的详情读取必须走主库、read-your-writes token，或采用其他能保证读己之写的方案。

## 自动化验收测试

必须新增并执行以下测试：

1. 单用户首次领取：领取记录、余额、账本、红包计数全部正确。
2. 同用户顺序重复领取：只入账一次；响应为幂等成功或稳定 409。
3. 同用户 20 个并发请求：数据库只有一条领取记录且只入账一次。
4. 同账号两台设备并发领取：结果同上。
5. 领取成功后立即 GET 详情：`can_claim=false`，`viewer_claim_amount` 等于首次领取金额。
6. 群红包剩余时：整体 `status=partial`，已领取用户不可再领，未领取且有资格的其他成员仍可领取。
7. 红包领完：`status=completed`，所有用户 `can_claim=false`。
8. 专属红包非指定成员、非群成员、过期红包、资格受限账号均不可领取。
9. 事务中任一步失败时完整回滚，不出现“计数增加但没有领取记录”或“余额增加两次”。
10. WebSocket 乱序/重放不会倒退资源版本，也不会再次触发钱包入账。

请运行仓库实际的迁移、单元测试、集成测试和并发测试命令。最终报告必须列出：根因、修改文件、数据库迁移、接口真实响应样例、并发测试结果、回滚方式、所有执行过的验收命令及结果。不要以修改 iOS 前端作为后端问题的替代方案。
