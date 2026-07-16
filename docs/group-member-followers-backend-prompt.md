# 创建群聊支持“相互关注 + 粉丝”成员来源：后端调整 Prompt

请在现有 BWChat 后端中完整实现并验证以下需求。不要改动现有 iOS 请求路径和字段命名；需要兼容已上线客户端。

## 目标

iOS 创建群聊页不再只从好友列表选择成员：

1. 主页面展示当前登录用户的“相互关注”用户，可直接勾选。
2. 主页面有“粉丝”入口，进入当前登录用户的粉丝列表后可勾选。
3. 相互关注用户也属于粉丝，两个列表中的同一用户必须使用同一个稳定的 `user_id`。
4. `POST /groups/create` 必须允许把“相互关注用户”和“仅关注了我的粉丝”加入群聊，不能继续仅以好友关系作为准入条件。

## 一、关注/粉丝列表接口契约

保持以下接口可用：

- `GET /follows/following?page={Int}&limit={Int}`
- `GET /follows/followers?page={Int}&limit={Int}`

两个接口都以当前鉴权用户作为关系判断主体。响应继续使用项目现有统一响应包装，`data` 中返回：

```json
{
  "users": [
    {
      "user_id": "stable-user-id",
      "username": "optional_username",
      "nickname": "显示昵称",
      "avatar_url": "https://...",
      "bio": "",
      "following_count": 0,
      "follower_count": 0,
      "followed_by_me": true,
      "follows_me": true,
      "is_friend": false
    }
  ],
  "page": 1,
  "has_more": true,
  "next_page": 2,
  "total": 100
}
```

要求：

- `user_id`、`nickname`、`avatar_url`、`followed_by_me`、`follows_me` 必须返回，且关系布尔值不能省略或返回 `null`。
- `GET /follows/following` 中每项的 `followed_by_me` 应为 `true`；其中 `follows_me == true` 的用户即“相互关注”。
- `GET /follows/followers` 中每项的 `follows_me` 应为 `true`；`followed_by_me` 应准确反映当前用户是否也关注了对方。
- 查询其他用户列表时如现有接口支持 `user_id` 参数，列表主体可切换，但 `followed_by_me` / `follows_me` 仍必须表示“当前鉴权用户”和列表项之间的关系，避免字段语义漂移。
- 排除当前登录用户本人，删除/封禁/注销用户不得返回。
- 分页顺序必须稳定，推荐按关注关系创建时间倒序，再以关系记录 ID 或用户 ID 作为稳定次排序键；翻页期间不能重复或漏项。
- `has_more` 与 `next_page` 必须准确。最后一页返回 `has_more: false`，`next_page` 可为 `null`。
- 保持现有 `users` 字段；如后端当前使用 `following`、`followers`、`items` 或 `list`，可以为兼容保留，但推荐统一补充 `users`。

### 性能要求

- 避免逐用户查询关系造成 N+1；在列表 SQL 中一次性联表/子查询计算 `followed_by_me` 与 `follows_me`。
- 为关注关系的 `(follower_id, followed_id)` 建唯一索引，并为反向查询补充 `(followed_id, follower_id)` 索引。
- 单页 `limit` 默认 30，允许范围 1...50；非法值返回明确的 4xx 参数错误或按现有规范纠正。

## 二、创建群聊接口调整

保持现有接口：

```http
POST /groups/create
Authorization: Bearer <token>
Content-Type: application/json
```

请求体：

```json
{
  "name": "群聊名称",
  "member_ids": ["user-id-1", "user-id-2"],
  "is_public": false
}
```

服务端校验与写入要求：

1. 仅允许已登录用户调用。
2. `member_ids` 去重，忽略或拒绝创建者本人；最终群成员中创建者只能出现一次。
3. 每个待加入用户必须满足以下任一条件：
   - 创建者关注对方且对方也关注创建者（相互关注）；或
   - 对方关注创建者（对方是创建者的粉丝，包括仅单向关注创建者的粉丝）。
4. 上述条件等价于“对方关注创建者”。请仍以关注关系表的真实数据做服务端授权，不能信任客户端传入的关系字段。
5. 不再要求双方是传统好友；如果旧逻辑存在 `is_friend == true`、好友表关联或好友请求已接受的强制校验，请替换为本 Prompt 的关注关系校验。
6. 删除、封禁、被创建者拉黑、拉黑创建者、不可加入群聊或违反现有安全策略的账号必须拒绝。
7. 对无权限的成员 ID，整个创建操作应原子失败，不要静默跳过后创建部分成员群。返回稳定的业务错误码和可展示消息，例如：

```json
{
  "code": "GROUP_MEMBER_NOT_ELIGIBLE",
  "message": "部分成员已不在你的粉丝列表中",
  "data": {
    "invalid_member_ids": ["user-id-2"]
  }
}
```

8. 群创建、创建者入群、所选成员入群、初始群事件/会话生成必须放在同一个数据库事务中。
9. 保持现有成功响应包装，兼容 iOS 当前按空 `data` 解码的行为。
10. 继续执行现有群人数上限、群名长度、敏感词、公开群设置等规则，并返回明确错误。

## 三、并发与关系变化

- 用户打开选择页后，关注关系可能变化。创建群聊时必须重新查询并校验，不得只依赖缓存。
- 若粉丝在提交前取消关注，返回 `GROUP_MEMBER_NOT_ELIGIBLE`，且不得创建半成品群。
- 对重复提交应沿用项目现有幂等策略；如果当前没有，至少保证单次事务不会生成重复群成员记录。
- 群成员表对 `(group_id, user_id)` 建唯一约束。

## 四、兼容性

- 不删除或重命名现有关注列表、粉丝列表、创建群聊接口及字段。
- 旧客户端仍可能从好友列表提交成员；只要该用户满足现有合法策略，应保持兼容。若“好友”不一定等于粉丝，请与产品确认后采用并集策略：`是好友 OR 对方关注创建者`，并在交付说明中写清最终规则。
- 统一响应结构、HTTP 状态码、错误码风格遵循现有项目规范。

## 五、必须补充的测试

至少覆盖以下自动化测试：

1. A 与 B 相互关注：B 出现在 A 的 following，且 `followed_by_me=true`、`follows_me=true`；A 可把 B 加群。
2. C 仅关注 A：C 出现在 A 的 followers，且 `follows_me=true`、`followed_by_me=false`；A 可把 C 加群。
3. A 仅关注 D：D 不属于 A 的粉丝；A 不能按“粉丝”规则把 D 加群。
4. 无任何关系的 E：创建群聊返回 `GROUP_MEMBER_NOT_ELIGIBLE`。
5. 粉丝取消关注后再提交：原子失败，不产生群或残留群成员。
6. `member_ids` 包含重复 ID、创建者本人、无效 ID、已注销/封禁/拉黑用户。
7. following/followers 多页数据的 `has_more`、`next_page`、稳定排序、无重复无漏项。
8. 列表关系字段以当前鉴权用户为主体，验证查询自己和查询其他用户时语义均正确。
9. 并发创建/重复提交不会产生重复群成员。
10. 旧客户端创建群聊回归、公开群/私密群回归、群人数上限回归。

## 六、交付内容

完成后请提供：

- 修改的接口、服务、数据访问层、表结构/索引清单。
- 最终的成员准入规则说明，特别说明旧“好友”逻辑如何兼容。
- 请求/响应示例及错误码表。
- 数据库迁移文件与回滚方式（如有）。
- 自动化测试运行结果。
- 对两条列表 SQL 的查询计划或性能说明，确认没有 N+1。

