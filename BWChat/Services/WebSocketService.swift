// BWChat/Services/WebSocketService.swift
// WebSocket connection manager

import Foundation
import Combine

enum WSMessageType: String {
    case newMessage = "new_message"
    case userStatus = "user_status"
    case chatReset = "chat_reset"
    case pong
}

struct WSMessage: Decodable {
    let type: String
    let data: WSMessageData?
    let message: String?

    enum CodingKeys: String, CodingKey {
        case type, data, message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decode(String.self, forKey: .type)
        message = try container.decodeIfPresent(String.self, forKey: .message)
        // data can be Message or UserStatusData
        data = try? container.decodeIfPresent(WSMessageData.self, forKey: .data)
    }
}

enum WSMessageData: Decodable {
    case message(Message)
    case userStatus(UserStatusData)

    struct UserStatusData: Decodable {
        let userID: String
        let status: String

        enum CodingKeys: String, CodingKey {
            case userID = "user_id"
            case status
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        // Try as Message first
        if let msg = try? container.decode(Message.self) {
            self = .message(msg)
            return
        }
        // Try as UserStatus
        if let status = try? container.decode(UserStatusData.self) {
            self = .userStatus(status)
            return
        }
        throw DecodingError.typeMismatch(
            WSMessageData.self,
            DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Unknown data type")
        )
    }
}

@MainActor
class WebSocketService: ObservableObject {
    static let shared = WebSocketService()

    @Published var isConnected: Bool = false

    // Publishers for different message types
    let newMessagePublisher = PassthroughSubject<Message, Never>()
    let userStatusPublisher = PassthroughSubject<(String, String), Never>()
    let chatResetPublisher = PassthroughSubject<Void, Never>()

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
                    self.startListening() // Continue listening
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
            do {
                let wsMessage = try JSONDecoder().decode(WSMessage.self, from: data)
                processWSMessage(wsMessage)
            } catch {
                print("[WS] Failed to decode message: \(error)")
            }
        case .data(let data):
            do {
                let wsMessage = try JSONDecoder().decode(WSMessage.self, from: data)
                processWSMessage(wsMessage)
            } catch {
                print("[WS] Failed to decode data message: \(error)")
            }
        @unknown default:
            break
        }
    }

    private func processWSMessage(_ wsMessage: WSMessage) {
        switch wsMessage.type {
        case "new_message":
            if case .message(let msg) = wsMessage.data {
                newMessagePublisher.send(msg)
            }
        case "user_status":
            if case .userStatus(let status) = wsMessage.data {
                userStatusPublisher.send((status.userID, status.status))
            }
        case "chat_reset":
            chatResetPublisher.send()
        case "pong":
            break // Heartbeat response
        default:
            print("[WS] Unknown message type: \(wsMessage.type)")
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

        // Auto-reconnect with exponential backoff
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
