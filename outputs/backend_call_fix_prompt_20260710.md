# BBchat 语音/视频通话后端修复 Prompt

你是本项目的资深后端与实时音视频工程师。请直接检查并修复 BBchat 的 LiveKit、通话 REST API、WebSocket 信令和 APNs 推送链路，目标是让 iOS 的单聊语音、单聊视频、群语音、群视频都能可靠发起、收到邀请、接听、挂断与释放房间。

## 已知现状与故障证据

- iOS API 基址：`http://52.198.192.138/api/v1`
- iOS WebSocket：`ws://52.198.192.138/ws?token=<access_token>`
- 旧客户端曾硬编码 LiveKit：`ws://52.198.192.138:7880`
- 当前架构已确认通过 nginx/负载均衡反向代理 LiveKit，7880 是内部 upstream，不要求公网开放。因此从公网直测 `:7880` 无响应不能单独判定为故障；应测试后端实际返回给 iOS 的公网代理 URL。
- 模拟器运行日志曾显示携带现有 access token 连接业务 `/ws` 时多次在约 30 秒后 `NSURLErrorDomain -1001` 超时；无 token 的标准 WebSocket Upgrade 会立即返回 403。请结合当前部署重新验证已认证 WebSocket，排查鉴权后的用户查询、Redis/pubsub、连接注册或 upstream 处理。
- iOS 已调整为信任 API 返回的 `livekit_url`/`server_url`，兼容 `wss://`、`ws://`、`https://`、`http://` 和同源代理路径；HTTP(S) 会自动规范为 WS(S)。API 必须返回客户端真正可访问的代理入口。
- 已修复客户端群来电接听错误：接听群邀请会调用 `/call/join` 加入邀请里的原房间，不会再次调用群通话 start。

## P0：LiveKit 基础设施

1. 确认 LiveKit 服务进程健康，内部 7880 能被 nginx/负载均衡 upstream 访问。若 nginx 与 LiveKit 同机可监听 localhost；若跨容器/主机，则监听和容器网络必须允许代理访问。7880 不需要对公网开放。
2. 生产环境提供受信任证书的公网代理入口，例如 `wss://call.example.com`，或正确重写路径的 `wss://api.example.com/livekit`，由 443/TCP 终止 TLS 并代理 WebSocket 到内部 LiveKit 7880；不要向 iOS 返回私网地址、localhost 或内部端口。
3. 配置 `rtc.use_external_ip: true`（适用于当前公有云/NAT 部署），确保 LiveKit 广播公网 ICE candidate。
4. 开放并验证：
   - 443/TCP：HTTPS/WSS 信令；
   - 7881/TCP：ICE/TCP fallback；
   - 50000-60000/UDP，或配置并开放 7882/UDP mux；
   - 建议开启 TURN/UDP 3478 和 TURN/TLS 443/5349，以覆盖蜂窝网络、VPN 和公司网络。
5. 从服务器外部测试公网代理 URL 的 HTTPS/WSS Upgrade 和真实 LiveKit token 连接；不要用公网直测内部 7880 作为验收标准。若使用路径前缀，确认 `/livekit/rtc` 等请求能正确 rewrite 到 LiveKit `/rtc`，并保留 Upgrade、Connection、Host、X-Forwarded-Proto 等头。
6. API 返回的 `livekit_url`（也兼容字段名 `server_url`）必须是上述公网代理 URL。不要返回 `ws://52.198.192.138:7880`、容器名或私网地址。

如果复用 API 域名并使用 `/livekit` 前缀，可以按实际网络调整为类似配置：

```nginx
location /livekit/ {
    # 结尾的 / 会将 /livekit/rtc rewrite 为内部 /rtc
    proxy_pass http://127.0.0.1:7880/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
    proxy_buffering off;
}
```

此时 API 返回 `https://api.example.com/livekit` 或 `wss://api.example.com/livekit`，iOS/LiveKit SDK 会连接 `/livekit/rtc`（并可能尝试 `/livekit/rtc/v1`）。如果使用独立域名，则可在该域名的 `location /` 直接代理到内部 7880。标准 nginx HTTP/WebSocket 反向代理只承载信令，不能代替 ICE/UDP、ICE/TCP 或 TURN 媒体通道。

参考：

- https://docs.livekit.io/transport/self-hosting/ports-firewall/
- https://docs.livekit.io/transport/self-hosting/deployment/
- https://docs.livekit.io/home/server/generating-tokens

## P0：REST API 合约

保持现有鉴权和统一响应包装：

```json
{"code": 0, "message": "ok", "data": {}}
```

实现并核对以下接口：

### `POST /api/v1/call/start`

请求：

```json
{"target_id": "callee-user-id", "call_type": "voice"}
```

`call_type` 只允许 `voice` 或 `video`。校验双方关系、账号状态、屏蔽关系和被叫是否忙线。以不可预测且唯一的 `room_name` 创建一次通话会话，向主叫签发 LiveKit token，并通过 WebSocket + APNs 通知被叫。

响应 data：

```json
{
  "call_id": "uuid",
  "room_name": "call_<random>",
  "token": "livekit-jwt",
  "livekit_url": "wss://call.example.com",
  "call_type": "voice",
  "participant_count": 1
}
```

### `POST /api/v1/call/join`

请求：

```json
{"room_name": "call_<random>"}
```

校验当前用户确实是该单聊的被叫或该群的成员，并且会话仍处于 `ringing/active`。必须加入原有房间，不能创建或替换房间。响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "room_name": "call_<random>",
    "token": "livekit-jwt",
    "livekit_url": "wss://call.example.com"
  }
}
```

### `POST /api/v1/call/group/{group_id}/start`

请求：`{"call_type":"voice"}`。校验群成员权限；同一群同一时间只允许一个活动通话，需用数据库唯一约束/事务/分布式锁保证幂等。返回字段与 `/call/start` 一致，并向其他有效群成员广播同一个 `room_name`。

### `POST /api/v1/call/group/{group_id}/leave`

将当前成员标记离开；最后一名成员离开后关闭会话并广播 `group_call_ended`。重复 leave 必须幂等。

### `GET /api/v1/call/group/{group_id}/status`

返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "active": true,
    "room_name": "group_call_<random>",
    "call_type": "video",
    "participant_count": 2
  }
}
```

建议补充幂等 REST lifecycle 接口，例如 `/call/{call_id}/reject`、`/busy`、`/end`，作为 WebSocket 断线时的可靠 fallback。

## P0：LiveKit Token

- 必须用服务端 SDK 与正确的 `LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET` 签发，密钥不得传给客户端。
- `sub/identity` 使用当前登录用户的稳定唯一 ID；同一房间内每个用户 identity 必须唯一。
- grant 至少包含：`roomJoin=true`、正确且完全一致的 `room`、`canPublish=true`、`canSubscribe=true`，允许 microphone；视频通话还需允许 camera。
- token 使用较短 TTL（例如 10-60 分钟），服务器时间必须同步；不得把 A 房间 token 返回给 B 房间。
- `/call/start` 和 `/call/join` 返回的 `room_name`、token grant 中的 room、信令/推送中的 `room_name` 必须逐字一致。

## P0：WebSocket 信令

服务端发给 iOS 的统一 envelope：

```json
{"type": "call_invite", "data": {}}
```

单聊邀请：

```json
{
  "type": "call_invite",
  "data": {
    "call_id": "uuid",
    "caller_id": "user-id",
    "caller_name": "nickname",
    "caller_avatar": "https://...",
    "room_name": "call_<random>",
    "call_type": "voice"
  }
}
```

群邀请使用 `type=group_call_invite`，data 必须含 `call_id`、`caller_id`、`group_id`、`group_name`、`room_name`、`call_type`。

客户端发出的 lifecycle 消息当前格式：

```json
{"type":"call_reject","data":{"target_id":"...","reason":"declined"}}
{"type":"call_busy","data":{"target_id":"..."}}
{"type":"call_end","data":{"target_id":"..."}}
```

转发给对端时统一补充 `from_user_id`、`call_id`、`room_name`，事件类型分别为 `call_reject`、`call_busy`、`call_end`。只能转发与当前认证用户相关的通话，不能信任客户端伪造的 sender id。事件需要按 call_id/room_name 关联，不能让一条旧通话事件结束用户的新通话。

呼叫状态建议：`ringing -> accepted -> active -> ended/rejected/busy/missed`。状态切换必须原子、幂等；45-60 秒无人接听自动转 `missed` 并通知主叫。断线重连后应允许客户端查询当前状态。

## P0：标准 APNs 邀请

即使被叫 WebSocket 不在线，也要发送 APNs。自定义字段建议放在 payload 顶层；当前 iOS 同时兼容顶层或 `data` 字典/JSON 字符串：

```json
{
  "aps": {
    "alert": {"title": "语音来电", "body": "Alice 邀请你通话"},
    "sound": "default",
    "content-available": 1
  },
  "push_type": "call",
  "call_id": "uuid",
  "caller_id": "user-id",
  "caller_name": "Alice",
  "caller_avatar": "https://...",
  "room_name": "call_<random>",
  "call_type": "voice"
}
```

群通话使用 `push_type=group_call` 并补充 `group_id`、`group_name`。不得发送已经结束或过期的房间；用户点击旧通知时 `/call/join` 应返回明确的 404/410 业务错误。

## P1：真正的后台/杀进程来电

当前 iOS 只有普通 APNs，不具备 PushKit + CallKit 的系统来电能力。普通通知只能让用户点击后进入 App，不能达到微信/电话那种被杀进程后立即展示系统接听界面。若产品需要此能力，请先设计后端 VoIP token 注册与 VoIP APNs 发送，但不要在配套 iOS 版本上线前启用：

- 新增 VoIP token 注册/注销接口，区分普通 APNs token；
- 使用正确的 VoIP topic、`apns-push-type: voip`、高优先级与即时过期策略；
- payload 带 `call_id`、caller/group 信息、room、call_type；
- 与 iOS PushKit/CallKit 上报接听、拒绝、结束、超时的接口配套；
- 严禁把普通消息伪装成 VoIP push，避免 Apple 限流或封禁。

## 验收测试

请提供自动化测试和两台真机联调证据，至少覆盖：

1. 单聊语音：A 发起，B 前台收到，B 接听，双方互相听到，任一方挂断另一方立即结束。
2. 单聊视频：双方都能发布/订阅音视频，前后摄像头、静音、扬声器切换有效。
3. 群语音与群视频：第二人通过 `/call/join` 加入同一个 room；不得创建新房间。
4. 被叫 WebSocket 离线时通过 APNs 收到邀请，点击后可以 join。
5. Busy、reject、missed、重复点击接听、旧通知、token 过期、用户非群成员等边界。
6. Wi-Fi、蜂窝网络、VPN/公司网络；验证 UDP、ICE/TCP、TURN fallback。
7. 服务重启、WebSocket 重连、重复请求与并发 start 的幂等性。
8. 日志中以 `call_id + room_name + user_id` 串起 API、WS、APNs、token 和 LiveKit participant，但不得记录完整 JWT、API secret 或 APNs token。

完成后请输出：根因、修改文件/配置、接口示例、部署命令、端口/安全组变更、回滚方案、测试结果，以及一份可供 iOS 联调的最终协议文档。
