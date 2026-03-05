# BWChat iOS

极简风格的轻量级聊天应用 iOS 客户端。

## 功能特性

- 用户登录/登出（JWT 认证）
- 联系人列表（实时更新）
- 文字消息收发
- 图片消息收发（含预览、缩放、保存）
- WebSocket 实时消息推送
- APNs 远程推送通知
- 每日数据重置处理
- 极简 UI 设计（Light/Dark Mode）

## 技术栈

| 组件 | 方案 |
|------|------|
| 语言 | Swift 5.9+ |
| 最低版本 | iOS 16.0 |
| UI | 纯 SwiftUI |
| 网络 | URLSession（原生） |
| WebSocket | URLSessionWebSocketTask |
| 架构 | MVVM |
| 依赖 | 零三方依赖 |

## 项目结构

```
BWChat/
├── BWChat.xcodeproj
├── BWChat/
│   ├── BWChatApp.swift          # App 入口
│   ├── Models/                  # 数据模型
│   ├── ViewModels/              # 视图模型
│   ├── Views/                   # SwiftUI 视图
│   ├── Services/                # 网络服务
│   ├── Managers/                # 全局管理器
│   ├── Components/              # 可复用组件
│   └── Utils/                   # 工具与扩展
└── BWChatNotificationService/   # 推送扩展
```

## 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/<your-org>/BWChat-iOS.git
cd BWChat-iOS

# 2. 用 Xcode 打开
open BWChat.xcodeproj

# 3. 配置服务器地址
#    编辑 BWChat/Utils/Constants.swift 中的 API_BASE_URL

# 4. 选择开发团队
#    Xcode > Signing & Capabilities > Team

# 5. Build & Run (⌘R)
```

## 服务器配置

编辑 `BWChat/Utils/Constants.swift`：

```swift
enum AppConfig {
    #if DEBUG
    static let apiBaseURL = "http://192.168.1.100:8000/api/v1"
    static let wsBaseURL  = "ws://192.168.1.100:8000/ws"
    #else
    static let apiBaseURL = "https://your-server.com/api/v1"
    static let wsBaseURL  = "wss://your-server.com/ws"
    #endif
}
```

## 测试账号

| 用户名 | 密码 |
|--------|------|
| alice | alice123 |
| bob | bob123 |
| charlie | charlie123 |

## License

Private - All rights reserved.
