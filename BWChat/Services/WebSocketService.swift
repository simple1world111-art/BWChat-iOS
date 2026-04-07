// BWChat/Services/WebSocketService.swift
// WebSocket connection manager with group & friend support

import Foundation
import Combine
import Network

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

    /// The user ID of the chat currently being viewed (nil if not in a chat)
    var activeChatUserID: String?
    /// The group ID of the group chat currently being viewed (nil if not in a group chat)
    var activeGroupID: Int?

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
    let groupRemovedPublisher = PassthroughSubject<Int, Never>()
    let groupRenamedPublisher = PassthroughSubject<(Int, String), Never>()
    let cacheCleanupPublisher = PassthroughSubject<[String], Never>()

    // Call signaling
    let callOfferPublisher = PassthroughSubject<[String: Any], Never>()
    let callAnswerPublisher = PassthroughSubject<[String: Any], Never>()
    let iceCandidatePublisher = PassthroughSubject<[String: Any], Never>()
    let callEndPublisher = PassthroughSubject<String, Never>()
    let callRejectPublisher = PassthroughSubject<[String: Any], Never>()
    let callBusyPublisher = PassthroughSubject<String, Never>()

    private var webSocketTask: URLSessionWebSocketTask?
    private var heartbeatTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var reconnectDelay: TimeInterval = 1
    private let maxReconnectDelay: TimeInterval = 30
    private var isManuallyDisconnected = false
    private let networkMonitor = NWPathMonitor()
    private var lastPathStatus: NWPath.Status?
    private var isNetworkSatisfied = true

    private init() {
        startNetworkMonitor()
    }

    /// Monitor network path changes (VPN on/off, WiFi/cellular switch).
    /// When the path changes while connected, immediately reconnect.
    private func startNetworkMonitor() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                let wasSatisfied = self.isNetworkSatisfied
                self.isNetworkSatisfied = (path.status == .satisfied)

                // Network path changed while we should be connected → fast reconnect
                if !self.isManuallyDisconnected && self.isNetworkSatisfied {
                    if self.lastPathStatus != nil && self.lastPathStatus != path.status {
                        // Network restored after being down
                        self.fastReconnect()
                    } else if wasSatisfied && path.usesInterfaceType(.other) != self.usesVPN(path) {
                        // Path type changed (e.g. VPN toggled) – force reconnect
                        self.fastReconnect()
                    }
                }
                self.lastPathStatus = path.status
            }
        }
        networkMonitor.start(queue: DispatchQueue(label: "bwchat.netmon"))
    }

    private func usesVPN(_ path: NWPath) -> Bool {
        path.usesInterfaceType(.other)
    }

    /// Immediately tear down and reconnect with no backoff delay.
    private func fastReconnect() {
        guard !isManuallyDisconnected, AuthManager.shared.token != nil else { return }
        heartbeatTask?.cancel()
        reconnectTask?.cancel()
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        isConnected = false
        reconnectDelay = 1
        connect()
    }

    func connect() {
        guard let token = AuthManager.shared.token else { return }
        isManuallyDisconnected = false
        reconnectDelay = 1

        let urlString = AppConfig.wsBaseURL + "?token=\(token)"
        guard let url = URL(string: urlString) else { return }

        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        let session = URLSession(configuration: config)
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

        case "group_removed":
            if let d = json["data"] as? [String: Any],
               let gid = d["group_id"] as? Int {
                groupRemovedPublisher.send(gid)
            }

        case "group_renamed":
            if let d = json["data"] as? [String: Any],
               let gid = d["group_id"] as? Int,
               let name = d["name"] as? String {
                groupRenamedPublisher.send((gid, name))
            }

        case "cache_cleanup":
            if let d = json["data"] as? [String: Any],
               let urls = d["deleted_urls"] as? [String] {
                cacheCleanupPublisher.send(urls)
            }

        case "call_offer":
            if let d = json["data"] as? [String: Any] {
                callOfferPublisher.send(d)
            }

        case "call_answer":
            if let d = json["data"] as? [String: Any] {
                callAnswerPublisher.send(d)
            }

        case "ice_candidate":
            if let d = json["data"] as? [String: Any] {
                iceCandidatePublisher.send(d)
            }

        case "call_end":
            if let d = json["data"] as? [String: Any],
               let fromUser = d["from_user_id"] as? String {
                callEndPublisher.send(fromUser)
            }

        case "call_reject":
            if let d = json["data"] as? [String: Any] {
                callRejectPublisher.send(d)
            }

        case "call_busy":
            if let d = json["data"] as? [String: Any],
               let fromUser = d["from_user_id"] as? String {
                callBusyPublisher.send(fromUser)
            }

        default:
            print("[WS] Unknown message type: \(type)")
        }
    }

    // MARK: - Call Signaling Helpers

    func sendCallOffer(targetID: String, callType: CallType, sdp: String) {
        let msg: [String: Any] = [
            "type": "call_offer",
            "data": [
                "target_id": targetID,
                "call_type": callType.rawValue,
                "sdp": sdp
            ]
        ]
        sendJSON(msg)
    }

    func sendCallAnswer(targetID: String, sdp: String) {
        let msg: [String: Any] = [
            "type": "call_answer",
            "data": ["target_id": targetID, "sdp": sdp]
        ]
        sendJSON(msg)
    }

    func sendICECandidate(targetID: String, candidate: [String: Any]) {
        let msg: [String: Any] = [
            "type": "ice_candidate",
            "data": [
                "target_id": targetID,
                "candidate": candidate
            ]
        ]
        sendJSON(msg)
    }

    func sendCallEnd(targetID: String) {
        let msg: [String: Any] = [
            "type": "call_end",
            "data": ["target_id": targetID]
        ]
        sendJSON(msg)
    }

    func sendCallReject(targetID: String, reason: String = "declined") {
        let msg: [String: Any] = [
            "type": "call_reject",
            "data": ["target_id": targetID, "reason": reason]
        ]
        sendJSON(msg)
    }

    func sendCallBusy(targetID: String) {
        let msg: [String: Any] = [
            "type": "call_busy",
            "data": ["target_id": targetID]
        ]
        sendJSON(msg)
    }

    private func sendJSON(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let text = String(data: data, encoding: .utf8) else { return }
        let message = URLSessionWebSocketTask.Message.string(text)
        webSocketTask?.send(message) { _ in }
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
