# BBchat 后端：通知 / 会话摘要 / 消息详情一致性修复 Prompts

以下 4 个 prompt 可分别执行，也可按 P0 → P1 → P2 → P3 顺序交给同一个后端 Agent。要求 Agent 直接检查并修改后端代码、迁移与测试，不只给方案。

## P0：修复“外面看到新消息，进入详情却没有”的读写一致性

```text
请直接检查并修复 BBchat 后端消息写入与读取的一致性问题，并提交代码、迁移和自动化测试。

现象：APNs/前台通知和 GET /chat/conversations 已出现某条新消息，但立即进入会话后，以下详情接口暂时查不到同一个 message_id：
- GET /chat/messages/{contact_id}
- GET /chat/messages/{contact_id}/{message_id}/context
- GET /groups/{group_id}/messages
- GET /groups/{group_id}/messages/{message_id}/context

必须实现的契约：
1. message_id 是通知、WebSocket、会话摘要和详情记录唯一且相同的 canonical ID。
2. 只有当消息事务已提交，且上述 recent/context 接口立即可读到该 ID 后，才能更新会话摘要并投递 WebSocket/APNs。禁止“先通知、后落详情”。
3. 如果使用读副本、搜索索引或异步投影，context/recent 的最新消息读取必须走主库、read-your-writes 路由或可靠的 replica watermark；不能在已发通知后返回 404/空数组。
4. 使用 transactional outbox：消息记录、会话 last_message_id/revision、outbox 记录在同一数据库事务提交；worker 仅消费已提交 outbox，且可幂等重放。
5. direct/group 的发送接口必须按 (sender_id, conversation_scope, client_message_id) 幂等；Idempotency-Key 与 client_message_id 重试只能返回同一 canonical message，不能生成重复 ID。
6. recent/context/conversations 必须使用同一可见性规则（成员关系、删除/撤回、个人清空水位除外），不能出现摘要可见而详情被过滤。

请重点审计所有文字、图片、视频、语音、贴图、礼物、转发、红包/转账回执写入路径，不能只修 text。

验收测试必须覆盖：
- 每种消息 POST 成功返回后，零等待调用 recent 和 context，均包含返回的 message_id。
- 收到任何 conversation last_message_id、WebSocket message_id 或 push message_id 后，context 必定返回该 canonical 消息。
- 并发发送、worker 重试、断线重连、读副本延迟、同一 Idempotency-Key 重放均无重复、无摘要超前、无 ID 漂移。
- direct 与 group 各有集成测试；测试失败时输出 message_id、conversation_id、revision、outbox_id 和 commit 时间线。

完成后请给出：根因、修改文件/迁移、旧数据兼容方式、测试命令与结果，以及从“数据库提交 → 摘要 → WebSocket → APNs”的实际顺序。
```

## P1：统一 APNs、WebSocket 与会话卡片 payload

```text
请直接统一 BBchat 后端 APNs、WebSocket 和 GET /chat/conversations 的消息事件契约，并补齐 schema/契约测试。目标是三个表面展示同一 canonical message 的同一 version，而不是各自拼接文案或猜 ID。

统一字段要求：
- canonical：message_id、conversation_type(dm|group)、conversation_id、sender_id、msg_type、content/content_preview、sent_at、version、conversation_revision、unread_count、total_unread_count。
- group 另含 group_id、sender_nickname；媒体另含稳定的 content URL 与 thumbnail_url。
- 禁止用裸字段 id 代表 push 的 message_id；event_id 建议为 {conversation_type}:{conversation_id}:message:{message_id}:{version}。
- direct 的 conversation_id 必须是接收者当前视角下可打开的对端用户 ID；group 必须是 group_id 的字符串形式。

WebSocket：
- 新消息发 new_message / new_group_message，data 直接放 canonical 消息对象（若保留 data.message 包装，也要全局一致）。
- 已存在消息的媒体/撤回/状态变化发 message_updated / group_message_updated，沿用相同 message_id，version 严格递增。
- contact_update / group_contact_update 的 message_id、last_message、msg_type、last_message_time 必须来自同一消息行和同一 version，不允许单独异步拼接出旧内容+新 ID。
- 允许 at-least-once，但必须按 message_id + version 幂等，不能让旧 version 晚到后覆盖新 version。

APNs：
- data.message_id 必须等于会话摘要 last_message_id 和 WebSocket canonical message.id。
- aps.alert.title/body、content_preview、msg_type 必须由同一 canonical message/version 生成。
- push 入队必须晚于消息可读提交；禁止仅有预览、没有 canonical message_id 的普通聊天推送。

验收测试：对同一条 direct/group 消息抓取数据库行、conversation 响应、WebSocket 两类事件和 APNs payload，逐字段断言 ID/type/content/time/version 一致；加入乱序和重复投递测试，证明旧 version 不会回滚摘要或详情。

完成后输出最终 JSON 示例（direct、group、image、video 各一份）、兼容策略、契约测试结果和上线顺序。
```

## P2：修复图片/视频消息与缩略图延迟可见

```text
请直接修复 BBchat 后端图片/视频消息“通知和会话卡片先出现，但详情消息或缩略图稍后才出现”的媒体就绪时序，并补齐端到端测试。

必须满足：
1. 图片/视频原文件与 thumbnail 在对象存储/CDN 已可 GET（正确鉴权下 200，非 404/0 字节）后，接收方消息才可进入可见状态、更新 conversation last_message_id、发 WebSocket 和 APNs。
2. 推荐流程：上传临时 key → 校验 size/hash/mime → 生成/接收 thumbnail → promote/copy 到不可变最终 key → 验证可读 → 数据库事务写 canonical message + conversation + transactional outbox → 发事件。
3. 如果业务必须异步转码，pending 媒体不得作为接收方的最终新消息发布；ready 后沿用同一 message_id、version + 1，发送 message_updated/group_message_updated。不要创建第二条消息。
4. POST /chat/messages/image|video 和 /groups/{group_id}/messages/image|video 必须支持 Idempotency-Key + client_message_id，并返回完整 canonical 消息：正数 id、正确 msg_type、非空稳定 content、thumbnail_url、timestamp、version、client_message_id。
5. content/thumbnail_url 使用不可变或带版本的稳定 URL；CDN 不得缓存首次 404。若确需短暂处理，响应要有明确 media_status/Retry-After，但在 ready 前不能推送成最终消息。
6. 清理失败临时文件和孤儿对象；重试不得重复扣费、重复建消息或让 conversation 指向未就绪资产。

验收测试：
- 图片/视频 POST 返回的同一毫秒，分别 GET content 与 thumbnail，均成功且非空；recent/context 立即含同一 message_id。
- 注入对象存储延迟、缩略图失败、worker 重试、客户端超时重传，证明不会提前发通知/摘要，不会重复消息。
- APNs、WebSocket、conversation、context 中的 message_id/content/thumbnail_url/version 完全一致。
- 记录并断言 media_uploaded_at、media_ready_at、message_committed_at、event_enqueued_at、push_sent_at 的单调顺序。

完成后给出根因、状态机、修改文件/迁移、失败补偿逻辑、测试结果及灰度/回滚方案。
```

## P3：取消已经读到的迟到 Push，只通知真正未读消息

```text
请直接修复 BBchat 后端“WebSocket 消息已被用户看到并标记已读，但稍后仍收到 APNs 弹窗”的竞态，并提交 worker、数据模型/迁移、指标与自动化测试。目标：普通聊天 APNs 只代表发送时仍未读的 canonical message；WebSocket 继续实时，不因 Push 防抖而延迟。

必须实现：
1. 消息事务提交后立即发送 WebSocket，但普通聊天 Push 使用可取消的延迟任务，建议 grace window 500–1000ms；不要在请求线程同步等待。
2. Push worker 真正调用 APNs 前，必须以 recipient_id + conversation_type + conversation_id 读取权威 read_through_message_id。若 read_through_message_id >= message_id，任务标记 cancelled_read，不得调用 APNs。
3. 已读接口成功提交后，应按 recipient + conversation 批量取消 message_id <= read_through_message_id 的 pending Push 任务。取消与 worker 抢占必须使用条件更新/行锁，保证最多一个终态：sent、cancelled_read 或 failed；禁止“先查未读、随后已读、仍继续发送”的 TOCTOU。
4. Push 幂等键固定为 recipient_id + conversation_type + conversation_id + message_id + version；worker 重试不能重复发送。新 version 不能重新通知已经读过的 message_id，除非是明确允许的业务提醒类型。
5. APNs payload 必须包含 canonical message_id、conversation_type、可直接打开的 conversation_id、sender_id、unread_count、total_unread_count、conversation_revision、sent_at 和 event_id。direct 的 conversation_id 必须是接收者视角下的对端用户 ID，不能使用内部 thread UUID。
6. unread_count/total_unread_count 必须在发送前重新读取或由同一权威事务生成，禁止把消息创建时的旧未读数长期保存在延迟任务里。
7. 通话邀请、红包到期等强时效业务不套用普通聊天 grace window；请用明确的 push_type 白名单区分，不要靠缺字段猜测。

验收测试：
- direct/group：WebSocket 到达后在 grace window 内提交已读，断言 APNs client 从未被调用，任务终态为 cancelled_read。
- 已读恰好与 worker 并发，循环压测至少 1000 次，不得出现 read_through_message_id >= message_id 后仍 sent。
- 未读消息超过 grace window 正常发送且只发送一次；APNs 失败重试不重复。
- 多设备同账号任一设备提交已读后，其他设备不再收到该消息的待发送 Push。
- 输出指标：message_committed_at、websocket_sent_at、read_committed_at、push_claimed_at、push_sent_at/cancelled_at、cancel_reason，并统计 websocket_to_push、read_cancel_rate、late_push_after_read_count；late_push_after_read_count 必须为 0。

完成后请给出：根因、状态机/锁策略、修改文件与迁移、最终 Push payload、测试命令和结果、灰度参数（grace window）及回滚方案。
```
