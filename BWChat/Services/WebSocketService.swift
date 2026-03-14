// BWChat/Services/WebSocketService.swift
// WebSocket connection manager with group & friend support

import Foundation
import Combine

enum WSMessageType: String {
    case newMessage = "new_message"
    case userStatus = "user_status"
    case chatReset = "chat_reset"
    case newGroupMessage = "new_group_message"
    case groupCreated = "group_created"
    case friendRequest = "friend_request"
    case friendAccepted = "friend_accepted"
    case pong
}

@MainActor
class WebSocketService: ObservableObject {
    static let shared = WebSocketService()

    @Published var isConnected: Bool = false

    // Publishers for different message types
    let newMessagePublisher = PassthroughSubject<Message, Never>()
    let userStatusPublisher = PassthroughSubject<(String, String), Never>()
    let chatResetPublisher = PassthroughSubject<Void, Never>()
    let groupMessagePublisher = PassthroughSubject<GroupMessage, Never>()
    let groupCreatedPublisher = PassthroughSubject<[String: Any], Never>()
    let friendRequestPublisher = PassthroughSubject<[String: String], Never>()
    let friendAcceptedPublisher = PassthroughSubject<[String: String], Never>()
    let contactUpdatePublisher = PassthroughSubject<[String: Any], Never>()
    let groupContactUpdatePublisher = PassthroughSubject<[String: Any], Never>()

    private var webSocketTask: URLSessionWebSocketTask?
    private var heartbeatTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var reconnectDelay: TimeInterval = 1
    private let maxReconnectDelay: TimeInterval = 30
    private var isManuallyDisconnected = false

    private init() {}

    func connect() {
        guard let token = AuthManager.shared.token else { return }
        isManuallyDisconnected = false
        reconnectDelay = 1

        let urlString = AppConfig.wsBaseURL + "?token=\(token)"
        guard let url = URL(string: urlString) else { return }

        let session = URLSession(configuration: .default)
        webSocketTask = session.webSocketTask(with: url)
        webSocketTask?.resume()

        isConnected = true
        startListening()
        startHeartbeat()
    }

    func disconnect() {
        isManuallyDisconnected = true
        heartbeatTask?.cancel()
        heartbeatTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        isConnected = false
    }

    private func startListening() {
        webSocketTask?.receive { [weak self] result in
            Task { @MainActor in
                guard let self = self else { return }
                switch result {
                case .success(let message):
                    self.handleMessage(message)
                    self.startListening()
                case .failure:
                    self.handleDisconnect()
                }
            }
        }
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            guard let data = text.data(using: .utf8) else { return }
            processRawJSON(data)
        case .data(let data):
            processRawJSON(data)
        @unknown default:
            break
        }
    }

    // Parse raw JSON and route to the correct publisher
    private func processRawJSON(_ data: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return
        }

        switch type {
        case "new_message":
            // DM message
            if let msgData = json["data"],
               let msgJSON = try? JSONSerialization.data(withJSONObject: msgData),
               let msg = try? JSONDecoder().decode(Message.self, from: msgJSON) {
                newMessagePublisher.send(msg)
            }

        case "user_status":
            if let d = json["data"] as? [String: Any],
               let uid = d["user_id"] as? String,
               let status = d["status"] as? String {
                userStatusPublisher.send((uid, status))
            }

        case "chat_reset":
            chatResetPublisher.send()

        case "new_group_message":
            if let msgData = json["data"],
               let msgJSON = try? JSONSerialization.data(withJSONObject: msgData),
               let msg = try? JSONDecoder().decode(GroupMessage.self, from: msgJSON) {
                groupMessagePublisher.send(msg)
            }

        case "group_created":
            if let d = json["data"] as? [String: Any] {
                groupCreatedPublisher.send(d)
            }

        case "friend_request":
            if let d = json["data"] as? [String: Any] {
                var info: [String: String] = [:]
                if let uid = d["user_id"] as? String { info["user_id"] = uid }
                if let nick = d["nickname"] as? String { info["nickname"] = nick }
                if let avatar = d["avatar_url"] as? String { info["avatar_url"] = avatar }
                friendRequestPublisher.send(info)
            }

        case "friend_accepted":
            if let d = json["data"] as? [String: Any] {
                var info: [String: String] = [:]
                if let uid = d["user_id"] as? String { info["user_id"] = uid }
                if let nick = d["nickname"] as? String { info["nickname"] = nick }
                friendAcceptedPublisher.send(info)
            }

        case "pong":
            break

        case "contact_update":
            if let d = json["data"] as? [String: Any] {
                contactUpdatePublisher.send(d)
            }

        case "group_contact_update":
            if let d = json["data"] as? [String: Any] {
                groupContactUpdatePublisher.send(d)
            }

        default:
            print("[WS] Unknown message type: \(type)")
        }
    }

    private func startHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(AppConfig.wsHeartbeatInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }
                self?.sendPing()
            }
        }
    }

    private func sendPing() {
        let pingMessage = URLSessionWebSocketTask.Message.string("{\"type\": \"ping\"}")
        webSocketTask?.send(pingMessage) { error in
            if error != nil {
                Task { @MainActor in
                    self.handleDisconnect()
                }
            }
        }
    }

    private func handleDisconnect() {
        isConnected = false
        heartbeatTask?.cancel()
        webSocketTask = nil

        guard !isManuallyDisconnected else { return }

        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            guard let self = self else { return }
            let delay = self.reconnectDelay
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self.reconnectDelay = min(self.reconnectDelay * 2, self.maxReconnectDelay)
            self.connect()
        }
    }
}
