# “我的智能体”展示已加入剧本：后端工程 Prompt

## 使用说明

以下 Prompt 可直接交给后端工程 Agent。iOS 当前从 `GET /chat/conversations` 读取会话，并筛选 `conversation_kind=script_room` 展示在“智能体 > 我加入的剧本”。如果现有接口已完整、及时地返回这些行，则无需新增接口；请先审计并用测试证明，再只修复缺口。

---

你是 BWChat 后端工程 Agent。请审计并补齐“用户加入剧本后，在我的智能体中可持续看到并重新进入剧本房间”的后端契约。先检查真实路由、数据库模型、创建房间事务、会话列表查询、缓存层和自动化测试。不得凭接口文档假设已经实现；已经满足的要求请给出代码与测试证据并标记“无需修改”。

所有改动必须向后兼容。不要删除或改名旧字段，不要为了本需求新建与现有会话列表重复的数据源。

## 一、iOS 当前调用与展示规则

智能体主页并行请求：

- `GET /agents/runtime-config`
- `GET /agents/installed`
- `GET /agent-conversations`
- `GET /chat/conversations`
- `GET /wallet/balance`

iOS 从 `/chat/conversations` 中筛选同时满足以下条件的行：

- `conversation_kind=script_room`
- `script_room_id` 非空
- 会话属于当前登录用户且用户仍有读取权限

客户端按 `script_room_id` 去重；同一房间若意外返回多行，保留 `last_message_time` 更新的一行，再按 `last_message_time` 倒序展示。每一行代表一次剧本房间，不按 `script_id` 合并，因此同一剧本的多次开局可以分别保留。

点击行后，iOS 使用 `script_room_id` 打开 `ScriptRoomChatView`，并使用 `group_id` 读取消息。客户端会缓存会话行和 `ScriptRoom` 快照；创建房间后会使智能体主页缓存失效并强制刷新。

## 二、必须审计和补齐的契约

### A. 创建剧本房间必须原子地产生会话关系

审计：

```http
POST /scripts/{script_id}/rooms
```

成功事务必须原子完成：

1. 创建 `script_room`；
2. 创建或关联稳定的群聊 `group_id`；
3. 写入当前用户的房间成员/参与关系；
4. 创建可被 `/chat/conversations` 查询到的会话关系；
5. 写入开局时不可变的 `script_snapshot`；
6. 提交后更新会话列表 revision/ETag，并发送现有会话变更事件（若项目已有）。

响应继续返回 `room`，并应返回可选的完整 `conversation`，便于新客户端立即本地插入：

```json
{
  "code": 0,
  "data": {
    "room": {
      "room_id": "room_1",
      "script_id": "script_1",
      "group_id": 901,
      "status": "active",
      "player_role_id": "role_1",
      "assignments": [],
      "script_snapshot": {
        "title": "失落星港",
        "synopsis": "……",
        "cover_url": "https://cdn.example/cover.webp",
        "roles": []
      }
    },
    "conversation": {
      "type": "group",
      "id": "901",
      "name": "失落星港",
      "avatar_url": "https://cdn.example/cover.webp",
      "group_id": 901,
      "conversation_kind": "script_room",
      "script_room_id": "room_1",
      "script_id": "script_1",
      "last_message": null,
      "last_message_time": "2026-07-27T10:00:00Z",
      "unread_count": 0,
      "revision": 123
    }
  }
}
```

重复相同 `Idempotency-Key` 必须返回同一个房间和同一条会话关系，不得重复创建群、重复扣费或重复写入成员关系。

### B. 会话列表必须包含当前用户加入的剧本房间

审计：

```http
GET /chat/conversations
```

每条剧本房间行必须稳定返回：

- `type=group`（保持现有群消息兼容）；
- `conversation_kind=script_room`；
- 非空且稳定的 `script_room_id`；
- 非空且稳定的 `script_id`；
- 有效 `group_id`；
- 剧本快照标题 `name` 和封面 `avatar_url`，不能因原剧本后续编辑而无版本变化；
- `last_message`、`last_message_id`、`last_message_time`；
- `unread_count`、`read_through_message_id`；
- 建议返回 `script_room_status=active|ended` 和单调递增 `revision`。

查询必须以当前用户的有效参与关系为准，而不是仅查询剧本创建者、群创建者或最近发言者。刚完成 `POST /scripts/{script_id}/rooms` 后，同账号紧接着调用 `/chat/conversations` 必须读到新房间，不能依赖最终一致缓存等待数分钟。

房间结束后仍应保留在已加入记录中并可读取历史，除非产品已有明确的“离开/删除记录”操作。普通的 `status=ended` 不能自动删除参与关系。若现有产品明确只展示 active 房间，请把该差异作为产品阻塞报告，不要静默改变语义。

### C. 删除、退出和权限语义

请区分以下操作，不得混用：

- 删除会话列表行：只隐藏或删除当前用户的列表记录；
- 退出剧本房间：撤销成员权限，并从已加入列表移除；
- 结束剧本房间：停止新回合，但保留参与者历史读取与已加入记录；
- 删除原剧本：不得破坏既有房间的 `script_snapshot` 和合法历史读取；
- 后台封禁/权限收回：接口返回稳定业务错误码，且不得泄漏房间内容。

如果项目尚无退出/移除剧本功能，本次不要擅自新增破坏性 API；只需要保证已加入关系和历史展示稳定。

### D. 缓存、版本与账号隔离

1. `/chat/conversations` 的账号私有缓存必须使用 `Cache-Control: private, no-cache`，并按真实鉴权方式设置 `Vary: Authorization`。
2. 若使用 ETag，必须包含当前账号的会话资源版本和查询参数；账号 A 的 ETag 不能让账号 B 命中 `304`。
3. 创建/结束房间、新剧本消息、已读变化、退出或权限收回后，会话 revision/ETag 必须变化。
4. CDN、Redis、本地进程缓存和数据库查询都不得跨账号复用可见列表。
5. 推送或 WebSocket 深链继续携带 `conversation_kind`、`script_room_id`、`script_id` 和 `group_id`。

## 三、数据库约束与索引

按真实 schema 验证等价约束，不要重复创建已有索引：

- `script_rooms(room_id)` 唯一；
- 房间到群的关系唯一且稳定；
- 用户参与关系至少有 `(user_id, room_id)` 唯一约束；
- 会话列表查询有覆盖 `user_id`、可见状态、更新时间的索引；
- 群消息有 `(group_id, id)` 索引；
- 幂等键在正确用户/接口作用域内唯一。

数据迁移必须补齐历史房间的参与关系和会话元数据。无法可靠推断的数据要输出统计与人工处理方案，禁止给错误用户补关系。

## 四、自动化测试

至少覆盖：

1. 用户加入别人的公开剧本后，立即能在 `/chat/conversations` 看到完整 `script_room` 行；
2. 用户加入自己的剧本也能看到；
3. 同一剧本创建两个不同房间时返回两个不同 `script_room_id`；
4. 重复 Idempotency-Key 只产生一个房间、一个群和一条参与关系；
5. 房间结束后仍能列出并读取历史，但不能提交新回合；
6. 删除原剧本后，既有房间仍使用快照展示标题、封面和角色；
7. 新消息和已读操作正确更新最后消息、未读数和 revision；
8. 账号 A 看不到账号 B 未参与的房间，伪造 room/group ID 返回稳定无权限错误；
9. 旧客户端忽略新增字段时原有会话列表和群聊行为不变；
10. 历史数据迁移后，参与者能看到自己过去加入的房间，非参与者不会被误加。

## 五、交付要求

完成后输出：

1. 路由、service/repository、数据库模型与缓存层的现状审计；
2. 每项要求的“已满足 / 已修改 / 阻塞”矩阵；
3. 具体代码、迁移和索引文件；
4. 创建房间与会话列表的真实请求/响应样例；
5. 测试命令与通过结果；
6. 历史数据回填、灰度、监控和回滚方案；
7. 明确说明 iOS 是否需要解析额外字段或切换接口。

若现有 `/chat/conversations` 已满足全部要求，不要新增 `/scripts/joined`；以审计证据和测试补强作为交付。
