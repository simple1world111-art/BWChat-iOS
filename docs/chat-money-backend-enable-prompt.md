# BWChat 猫粮红包与转账开放修复 Prompt

你是 BWChat 后端 Agent。请直接检查并修改当前后端代码、环境配置、网关/CDN 配置和自动化测试，解决 iOS 端红包与转账始终显示“该功能暂未开放”的问题。不要只给分析或示例代码；请完成实现、迁移/配置、测试和可复现验收，并报告实际结果。

## 已确认的客户端现象

- iOS 已正确请求 `GET /api/v1/wallet/chat-money/config`。
- 线上接口已经返回 HTTP 200，因此不是路由不存在或基础鉴权失败。
- iOS 只有在配置响应成功解码，并且对应开关为 `true` 时才允许创建红包或转账。
- iOS 日志显示该 GET 请求曾出现 `cache_hit=true`，存在继续读取旧的关闭配置，或不同用户之间错误复用资格配置的风险。
- iOS 对配置采用 fail-closed：响应缺字段、字段类型错误、`data=null`、开关为 false 或解码失败，最终都会保持关闭状态。

## 修复目标

1. 在目标部署环境显式开启：
   - `chat_red_packet_enabled=true`
   - `chat_transfer_enabled=true`
2. 确保配置读取的是部署环境中的真实配置，而不是代码默认值、错误的环境变量名、未刷新进程内缓存或另一套配置中心 namespace。
3. 对满足资格的当前登录用户返回：
   - `red_packet_enabled: true`
   - `transfer_enabled: true`
   - `eligibility.eligible: true`
4. 配置接口必须禁止浏览器、URLSession、反向代理和 CDN 缓存，避免旧开关和用户资格串号。
5. 响应 JSON 必须严格匹配下方 iOS 契约；不要把整数或布尔值序列化成字符串，也不要省略必填对象或字段。

## 必须实现的接口行为

### `GET /api/v1/wallet/chat-money/config`

成功且当前用户具备资格时必须返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "red_packet_enabled": true,
    "transfer_enabled": true,
    "limits": {
      "minimum_amount": 1,
      "maximum_amount": 20000,
      "maximum_packet_count": 100,
      "expires_after_seconds": 86400
    },
    "eligibility": {
      "eligible": true,
      "reason_code": null,
      "message": null,
      "action_url": null
    }
  }
}
```

字段约束：

- `code` 是整数，成功值为 `0`。
- `data` 不得为 `null`。
- `red_packet_enabled`、`transfer_enabled`、`eligibility.eligible` 必须是 JSON boolean，不得使用 `1`、`0`、`"true"` 或 `"false"`。
- `minimum_amount`、`maximum_amount`、`maximum_packet_count`、`expires_after_seconds` 必须是 JSON integer。
- `limits` 和 `eligibility` 必须始终存在。
- 字段名称严格使用上述 snake_case。
- 资格不足时仍返回完整 `data` 和 `limits`；使用 `eligibility.eligible=false`、稳定 `reason_code`、用户可读 `message` 和可选 `action_url`。不要把资格不足伪装成响应解码失败。
- 全局开关关闭时才返回对应 `*_enabled=false`；用户实名、年龄、地区或风控不满足应主要通过 `eligibility` 表达。

## 配置与部署修复

请完成以下检查和修改：

1. 查明当前配置来源：环境变量、数据库、配置中心或管理后台，并输出实际生效值，敏感信息除外。
2. 确认运行进程读取的变量名与部署清单完全一致，不允许因为缺失配置而悄悄回退到 `false` 后继续部署。
3. 在测试/预发布环境默认显式开启；生产环境仅在现有实名、地区准入、AML、风控和 Apple 审核发布条件满足后开启。
4. 如果使用配置缓存，开关变化后必须主动失效或使用有版本的配置；不得要求等待不可控 TTL。
5. 如果服务启动时读取环境变量，更新部署配置后滚动重启所有实例，并验证每个实例返回一致结果。
6. 检查负载均衡后的全部实例，避免部分实例 true、部分实例 false。
7. 如果存在管理后台，请保证保存动作更新的就是此接口读取的配置源，并记录审计日志。

## HTTP 缓存修复

该响应包含当前用户资格，必须按私有敏感配置处理。接口响应至少设置：

```http
Cache-Control: private, no-store, no-cache, max-age=0, must-revalidate
Pragma: no-cache
Expires: 0
Vary: Authorization, Accept-Language
```

同时完成：

- 在 CDN、Nginx、API Gateway、Ingress、Service Worker 等所有中间层对该路径禁用缓存。
- 不得返回允许共享缓存的 `public`、`s-maxage` 或长 `max-age`。
- 若之前缓存过该路径，部署时主动 purge `/api/v1/wallet/chat-money/config`。
- 不得仅依赖 query string 时间戳规避缓存。
- 验证用户 A 的 eligibility 永远不会被用户 B 获得。

## 权限与资格要求

- 接口继续要求有效 JWT；未登录保持 401。
- 配置响应按当前 JWT 用户实时计算 eligibility。
- 对验收账号配置为可用状态，确保实名、年龄、地区、账号状态和风控规则不会错误拦截。
- 如果账号被拦截，必须返回具体稳定的 `reason_code`，并在交付报告中说明命中的规则；不要返回笼统的功能未开放。
- 红包/转账创建接口仍必须在服务端再次校验全局开关和 eligibility，不能只相信客户端配置。

## 自动化测试

至少新增或修复以下测试：

1. 两个总开关开启且用户具备资格时，断言响应中的三个 boolean 都为 `true`。
2. 开关关闭、用户资格不足、未登录三种情况分别返回预期状态和完整结构。
3. 对响应做 JSON Schema/契约测试，禁止缺字段以及 boolean/integer 字符串化。
4. 断言响应包含上述禁止缓存头。
5. 使用两个 eligibility 不同的用户连续请求，断言不会出现跨用户缓存或数据串号。
6. 多实例/配置热更新测试：开关更新后所有实例在规定时间内返回一致状态。
7. 创建红包和转账的 happy path 测试，证明配置开放后 POST 接口不会再因旧开关返回 403。

## 必须执行的验收

使用真实目标环境和两个测试账号执行，令 `BASE_URL` 为包含 `/api/v1` 的地址，`TOKEN_ELIGIBLE` 为具备资格的测试账号令牌；不得把令牌提交到仓库或打印到交付报告：

```bash
curl --fail-with-body -i \
  -H "Authorization: Bearer ${TOKEN_ELIGIBLE}" \
  -H "Accept: application/json" \
  "${BASE_URL}/wallet/chat-money/config"
```

验收结果必须同时满足：

- HTTP 200。
- `code == 0` 且 `data != null`。
- `data.red_packet_enabled == true`。
- `data.transfer_enabled == true`。
- `data.eligibility.eligible == true`。
- 所有 limits 为整数且值在服务端允许范围内。
- 响应含 `Cache-Control: private, no-store`，且不含共享缓存指令。
- 连续请求不会返回过期的 false 配置；响应头不应出现 CDN/代理缓存命中。

再执行以下机器校验；根据项目实际测试框架补充后端测试命令：

```bash
curl --fail-with-body -sS \
  -H "Authorization: Bearer ${TOKEN_ELIGIBLE}" \
  "${BASE_URL}/wallet/chat-money/config" \
| jq -e '
  .code == 0 and
  .data.red_packet_enabled == true and
  .data.transfer_enabled == true and
  .data.eligibility.eligible == true and
  (.data.limits.minimum_amount | type) == "number" and
  (.data.limits.maximum_amount | type) == "number" and
  (.data.limits.maximum_packet_count | type) == "number" and
  (.data.limits.expires_after_seconds | type) == "number"
'
```

## 交付格式

完成后请输出：

1. 根因，明确区分“总开关未启用”“账号 eligibility 不通过”“响应契约错误”“缓存旧配置”中的实际命中项。
2. 修改的文件、配置项、数据库/配置中心记录和网关规则。
3. 部署与缓存 purge/滚动重启结果。
4. 脱敏后的真实配置响应及响应头。
5. 所有自动化测试和上述 curl/jq 验收命令的实际输出摘要。
6. 回滚方式；回滚时必须能够立即关闭创建接口，但不得破坏已经冻结、待领取或待退款资产的结算与到期退款任务。

不要通过修改 iOS、硬编码特定用户、跳过实名/风控、始终返回 eligible=true，或只在响应外层增加一个新字段来规避问题。最终判断标准是：目标环境中符合资格的真实测试账号能够获得严格符合契约且不可缓存的开放配置，并成功调用红包和转账创建接口。
