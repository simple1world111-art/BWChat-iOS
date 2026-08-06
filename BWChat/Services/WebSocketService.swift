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
    case conversationReadState = "conversation_read_state"
    case pong
}

/// Compatibility rules for live-invitation events during the backend rollout.
/// The canonical protocol remains `{ "type": "one_to_one_live.call_invite", "data": ... }`.
enum LiveCallWebSocketCompatibility {
    static func normalizedType(_ rawType: String) -> String {
        rawType
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")
    }

    static func payload(from envelope: [String: Any]) -> [String: Any]? {
        for key in ["data", "payload"] {
            if let dictionary = dictionaryValue(envelope[key]) {
                return dictionary
            }
        }

        var rootPayload = envelope
        rootPayload.removeValue(forKey: "type")
        return rootPayload.isEmpty ? nil : rootPayload
    }

    static func isLegacyLiveInvite(_ payload: [String: Any]) -> Bool {
        var candidates = [payload]
        for key in ["data", "payload", "invitation", "call"] {
            if let nested = dictionaryValue(payload[key]) {
                candidates.append(nested)
            }
        }

        for candidate in candidates {
            if firstString(candidate, keys: ["slot_id", "live_slot_id", "slotId"]) != nil {
                return true
            }

            let source = firstString(
                candidate,
                keys: ["invitation_source", "source", "call_source", "scene"]
            )?
                .lowercased()
                .replacingOccurrences(of: "-", with: "_")
            if source == "one_to_one_live"
                || source == "live_lobby"
                || source == "agent_match"
                || source == "live" {
                return true
            }
        }
        return false
    }

    private static func dictionaryValue(_ value: Any?) -> [String: Any]? {
        if let dictionary = value as? [String: Any] { return dictionary }
        if let string = value as? String,
           let data = string.data(using: .utf8),
           let dictionary = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return dictionary
        }
        return nil
    }

    private static func firstString(_ data: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let value = data[key] as? String {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { return trimmed }
            }
            if let value = data[key] as? NSNumber { return value.stringValue }
        }
        return nil
    }
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
    let groupNotificationSettingsPublisher = PassthroughSubject<GroupNotificationSettings, Never>()
    let groupViewerSettingsPublisher = PassthroughSubject<GroupViewerSettings, Never>()
    let groupAnnouncementPublisher = PassthroughSubject<GroupAnnouncement, Never>()
    let groupMemberUpdatePublisher = PassthroughSubject<GroupMemberUpdateEvent, Never>()
    let groupHistoryClearPublisher = PassthroughSubject<GroupHistoryClearReceipt, Never>()
    let conversationPreferencePublisher = PassthroughSubject<ConversationPreference, Never>()
    let cacheCleanupPublisher = PassthroughSubject<[String], Never>()
    let scriptTurnStatePublisher = PassthroughSubject<ScriptTurnState, Never>()
    let chatMoneyUpdatePublisher = PassthroughSubject<ChatMoneyUpdateEvent, Never>()

    // Call signaling
    let callOfferPublisher = PassthroughSubject<[String: Any], Never>()
    let callAnswerPublisher = PassthroughSubject<[String: Any], Never>()
    let iceCandidatePublisher = PassthroughSubject<[String: Any], Never>()
    let callEndPublisher = PassthroughSubject<[String: Any], Never>()
    let callRejectPublisher = PassthroughSubject<[String: Any], Never>()
    let callBusyPublisher = PassthroughSubject<[String: Any], Never>()

    // Lightweight one-to-one live invitations. These intentionally use a
    // separate channel from normal calls so they never trigger the existing
    // full-screen incoming-call UI or ringtone before the recipient accepts.
    let liveCallInvitePublisher = PassthroughSubject<[String: Any], Never>()
    let liveCallAcceptedPublisher = PassthroughSubject<[String: Any], Never>()
    let liveCallRejectedPublisher = PassthroughSubject<[String: Any], Never>()
    let liveCallCancelledPublisher = PassthroughSubject<[String: Any], Never>()
    let liveMatchExhaustedPublisher = PassthroughSubject<[String: Any], Never>()
    let liveMatchCancelledPublisher = PassthroughSubject<[String: Any], Never>()
    let liveCallBillingPublisher = PassthroughSubject<[String: Any], Never>()
    let liveSlotCreatedPublisher = PassthroughSubject<[String: Any], Never>()
    let liveSlotUpdatedPublisher = PassthroughSubject<[String: Any], Never>()
    let liveSlotEndedPublisher = PassthroughSubject<[String: Any], Never>()

    // Group call signaling
    let groupCallInvitePublisher = PassthroughSubject<[String: Any], Never>()
    let groupCallEndedPublisher = PassthroughSubject<[String: Any], Never>()

    private var webSocketTask: URLSessionWebSocketTask?
    private var connectionOwnerID: String?
    private var heartbeatTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var healthCheckTask: Task<Void, Never>?
    private var reconnectDelay: TimeInterval = 1
    private let maxReconnectDelay: TimeInterval = 30
    private var isManuallyDisconnected = false
    private var isConnecting = false
    /// True once we've asked APIService to refresh the token in response to
    /// the current disconnect cycle. Reset to false on every successful
    /// connect (first received message). Prevents an infinite refresh loop
    /// when the server keeps rejecting for a non-token reason — after one
    /// failed refresh attempt, we fall through to the normal reconnect
    /// backoff so a transient server issue doesn't spam /auth/refresh.
    private var tokenRefreshAttempted = false
    private let networkMonitor = NWPathMonitor()
    private var lastPathStatus: NWPath.Status?
    private var isNetworkSatisfied = true
    private var lastMessageReceivedAt = Date()

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
        networkMonitor.start(queue: DispatchQueue(label: "bbchat.netmon"))
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
        isConnecting = false
        reconnectDelay = 1
        connect()
    }

    func connect() {
        guard let token = AuthTokenNormalizer.normalize(AuthManager.shared.token) else {
            AuthTokenDiagnostics.log("websocket-missing-token", token: nil)
            return
        }
        guard !isConnecting && webSocketTask == nil else { return }
        guard let ownerID = AuthManager.shared.currentUser?.userID, !ownerID.isEmpty else { return }
        isManuallyDisconnected = false
        isConnecting = true
        connectionOwnerID = ownerID
        reconnectDelay = 1

        heartbeatTask?.cancel()
        heartbeatTask = nil

        guard var components = URLComponents(string: AppConfig.wsBaseURL) else {
            isConnecting = false
            return
        }
        var queryItems = components.queryItems ?? []
        queryItems.removeAll { $0.name == "token" }
        queryItems.append(URLQueryItem(name: "token", value: token))
        components.queryItems = queryItems
        guard let url = components.url else {
            isConnecting = false
            return
        }
        AuthTokenDiagnostics.log("websocket-connect", token: token)

        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        let session = URLSession(configuration: config)
        webSocketTask = session.webSocketTask(with: url)
        webSocketTask?.resume()

        startListening()
    }

    func disconnect() {
        isManuallyDisconnected = true
        isConnecting = false
        heartbeatTask?.cancel()
        heartbeatTask = nil
        healthCheckTask?.cancel()
        healthCheckTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        connectionOwnerID = nil
        isConnected = false
    }

    private func startListening() {
        guard let task = webSocketTask else { return }
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self = self else { return }
                guard self.webSocketTask === task else { return }
                switch result {
                case .success(let message):
                    if !self.isConnected {
                        self.isConnected = true
                        self.isConnecting = false
                        self.startHeartbeat()
                        self.startHealthCheck()
                        AppMessageSyncCoordinator.shared.requestSync(.webSocketReconnect)
                        // A successful receive means this session made it
                        // past the handshake; any previous refresh attempt
                        // is forgiven so the next disconnect can try
                        // again if it needs to.
                        self.tokenRefreshAttempted = false
                    }
                    self.lastMessageReceivedAt = Date()
                    self.handleMessage(message)
                    self.startListening()
                case .failure(let error):
                    self.handleDisconnect(error: error)
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
        guard let ownerID = connectionOwnerID,
              AuthManager.shared.currentUser?.userID == ownerID else { return }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rawType = json["type"] as? String else {
            return
        }
        let type = LiveCallWebSocketCompatibility.normalizedType(rawType)

        switch type {
        case "new_message":
            // DM message
            if let msgData = json["data"],
               let msgJSON = try? JSONSerialization.data(withJSONObject: msgData),
               let msg = try? JSONDecoder().decode(Message.self, from: msgJSON) {
                // Persist for every incoming message (not only when a chat screen is open).
                if MessageStore.shared.saveMessage(msg, ownerID: ownerID) {
                    if let previewRequest = ChatMediaPreviewRequest.resolve(
                        messageType: msg.msgType,
                        content: msg.content,
                        thumbnailURL: msg.thumbnailURL
                    ) {
                        ChatMediaPreviewPreloader.schedule([previewRequest], limit: 1)
                    }
                    if msg.senderID != ownerID,
                       let route = NotificationRoute.parse(json) {
                        UnreadBadgeStore.shared.applyNotification(route)
                    }
                    newMessagePublisher.send(msg)
                }
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
                if MessageStore.shared.saveGroupMessage(msg, ownerID: ownerID) {
                    if let previewRequest = ChatMediaPreviewRequest.resolve(
                        messageType: msg.msgType,
                        content: msg.content,
                        thumbnailURL: msg.thumbnailURL
                    ) {
                        ChatMediaPreviewPreloader.schedule([previewRequest], limit: 1)
                    }
                    if msg.senderID != ownerID,
                       let route = NotificationRoute.parse(json) {
                        UnreadBadgeStore.shared.applyNotification(route)
                    }
                    groupMessagePublisher.send(msg)
                }
            }

        case "conversation_read_state":
            if let receiptData = json["data"] ?? Optional(json),
               let receiptJSON = try? JSONSerialization.data(withJSONObject: receiptData),
               let receipt = try? JSONDecoder().decode(ConversationReadReceipt.self, from: receiptJSON),
               receipt.isMeaningful {
                UnreadBadgeStore.shared.applyReadReceipt(receipt)
                AppMessageSyncCoordinator.shared.requestSync(.notification)
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
                if let groupID = Self.intValue(d["group_id"] ?? d["groupID"]),
                   let isMuted = Self.boolValue(d["is_muted"] ?? d["isMuted"]) {
                    GroupNotificationSettingsStore.shared.applyMutedSummary(
                        groupID: groupID,
                        isMuted: isMuted
                    )
                }
                groupContactUpdatePublisher.send(d)
            }

        case "group_notification_settings_updated":
            if let settingsData = json["data"] ?? Optional(json),
               let settingsJSON = try? JSONSerialization.data(withJSONObject: settingsData),
               let settings = try? JSONDecoder().decode(
                GroupNotificationSettings.self,
                from: settingsJSON
               ) {
                GroupNotificationSettingsStore.shared.apply(settings)
                groupNotificationSettingsPublisher.send(settings)
            }

        case "group_viewer_settings_updated":
            if let settingsData = json["data"] ?? Optional(json),
               let settingsJSON = try? JSONSerialization.data(withJSONObject: settingsData),
               let settings = try? JSONDecoder().decode(GroupViewerSettings.self, from: settingsJSON) {
                GroupInfoPreferencesStore.shared.apply(settings)
                groupViewerSettingsPublisher.send(settings)
            }

        case "group_announcement_updated":
            if let announcementData = json["data"] ?? Optional(json),
               let announcementJSON = try? JSONSerialization.data(withJSONObject: announcementData),
               let announcement = try? JSONDecoder().decode(GroupAnnouncement.self, from: announcementJSON) {
                groupAnnouncementPublisher.send(announcement)
            }

        case "group_member_updated", "group_member_profile_updated":
            if let updateData = json["data"] ?? Optional(json),
               let updateJSON = try? JSONSerialization.data(withJSONObject: updateData),
               let update = try? JSONDecoder().decode(GroupMemberUpdateEvent.self, from: updateJSON) {
                groupMemberUpdatePublisher.send(update)
            }

        case "group_history_cleared":
            if let receiptData = json["data"] ?? Optional(json),
               let receiptJSON = try? JSONSerialization.data(withJSONObject: receiptData),
               let receipt = try? JSONDecoder().decode(GroupHistoryClearReceipt.self, from: receiptJSON) {
                GroupInfoPreferencesStore.shared.applyHistoryClear(receipt)
                groupHistoryClearPublisher.send(receipt)
            }

        case "conversation_preferences_updated":
            if let preferenceData = json["data"] ?? Optional(json),
               let preferenceJSON = try? JSONSerialization.data(withJSONObject: preferenceData),
               let preference = try? JSONDecoder().decode(ConversationPreference.self, from: preferenceJSON) {
                ConversationPreferenceStore.shared.apply(preference)
                conversationPreferencePublisher.send(preference)
            }

        case "group_removed":
            if let d = json["data"] as? [String: Any],
               let gid = Self.intValue(d["group_id"]) {
                groupRemovedPublisher.send(gid)
            }

        case "group_renamed":
            if let d = json["data"] as? [String: Any],
               let gid = Self.intValue(d["group_id"]),
               let name = d["name"] as? String {
                groupRenamedPublisher.send((gid, name))
            }

        case "cache_cleanup":
            if let d = json["data"] as? [String: Any],
               let urls = d["deleted_urls"] as? [String] {
                cacheCleanupPublisher.send(urls)
            }

        case "script_turn_state":
            if let stateData = json["data"],
               let stateJSON = try? JSONSerialization.data(withJSONObject: stateData),
               let state = try? JSONDecoder().decode(ScriptTurnState.self, from: stateJSON) {
                scriptTurnStatePublisher.send(state)
            }

        case "chat_money_updated":
            if let updateData = json["data"],
               let updateJSON = try? JSONSerialization.data(withJSONObject: updateData),
               let update = try? JSONDecoder().decode(ChatMoneyUpdateEvent.self, from: updateJSON) {
                if let message = update.directMessage {
                    _ = MessageStore.shared.saveMessage(message, ownerID: ownerID)
                }
                if let message = update.groupMessage {
                    _ = MessageStore.shared.saveGroupMessage(message, ownerID: ownerID)
                }
                if let message = update.directReceiptMessage {
                    _ = MessageStore.shared.saveMessage(message, ownerID: ownerID)
                }
                if let message = update.groupReceiptMessage {
                    _ = MessageStore.shared.saveGroupMessage(message, ownerID: ownerID)
                }
                if let balance = update.walletBalance {
                    WalletStore.shared.applyServerBalance(balance)
                }
                chatMoneyUpdatePublisher.send(update)
            }

        case "call_invite":
            if let d = LiveCallWebSocketCompatibility.payload(from: json) {
                if LiveCallWebSocketCompatibility.isLegacyLiveInvite(d) {
                    liveCallInvitePublisher.send(d)
                } else {
                    callOfferPublisher.send(d)
                }
            }

        case "call_offer":
            if let d = Self.dictionaryValue(json["data"]) {
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
            if let d = Self.dictionaryValue(json["data"]) {
                callEndPublisher.send(d)
            }

        case "call_reject":
            if let d = Self.dictionaryValue(json["data"]) {
                callRejectPublisher.send(d)
            }

        case "call_busy":
            if let d = Self.dictionaryValue(json["data"]) {
                callBusyPublisher.send(d)
            }

        case "one_to_one_live.call_invite",
             "one_to_one_live.call.invite",
             "one_to_one_live_call_invite",
             "live_call_invite":
            if let d = LiveCallWebSocketCompatibility.payload(from: json) {
                liveCallInvitePublisher.send(d)
            }

        case "one_to_one_live.call_accepted":
            if let d = Self.dictionaryValue(json["data"]) {
                liveCallAcceptedPublisher.send(d)
            }

        case "one_to_one_live.call_rejected":
            if let d = Self.dictionaryValue(json["data"]) {
                liveCallRejectedPublisher.send(d)
            }

        case "one_to_one_live.call_cancelled", "one_to_one_live.call_expired":
            if let d = Self.dictionaryValue(json["data"]) {
                liveCallCancelledPublisher.send(d)
            }

        case "one_to_one_live.match_exhausted":
            if let d = Self.dictionaryValue(json["data"]) {
                liveMatchExhaustedPublisher.send(d)
            }

        case "one_to_one_live.match_cancelled":
            if let d = Self.dictionaryValue(json["data"]) {
                liveMatchCancelledPublisher.send(d)
            }

        case "one_to_one_live.billing_updated",
             "one_to_one_live.earning_updated",
             "one_to_one_live.experience_reserved",
             "one_to_one_live.experience_started",
             "one_to_one_live.experience_consumed",
             "one_to_one_live.experience_released",
             "one_to_one_live.experience_completed",
             "one_to_one_live.overage_started":
            if let d = Self.dictionaryValue(json["data"]) {
                liveCallBillingPublisher.send(d)
            }

        case "one_to_one_live.billing_insufficient":
            if var d = Self.dictionaryValue(json["data"]) {
                // Preserve the event semantic even when an older backend omits
                // the reason field from data.
                if d["reason"] == nil {
                    d["reason"] = "billing_insufficient"
                }
                liveCallBillingPublisher.send(d)
            }

        case "one_to_one_live.slot.created":
            if let d = Self.dictionaryValue(json["data"]) {
                liveSlotCreatedPublisher.send(d)
            }

        case "one_to_one_live.slot.updated":
            if let d = Self.dictionaryValue(json["data"]) {
                liveSlotUpdatedPublisher.send(d)
            }

        case "one_to_one_live.slot.ended":
            if let d = Self.dictionaryValue(json["data"]) {
                liveSlotEndedPublisher.send(d)
            }

        case "group_call_invite":
            if let d = Self.dictionaryValue(json["data"]) {
                groupCallInvitePublisher.send(d)
            }

        case "group_call_ended":
            if let d = Self.dictionaryValue(json["data"]) {
                groupCallEndedPublisher.send(d)
            }

        case "group_call_participant_joined", "group_call_participant_left":
            // LiveKit participant delegates are the authoritative media roster.
            // The backend also broadcasts lifecycle reconciliation events so
            // other clients can update non-call surfaces; consuming them here
            // prevents valid high-frequency group activity from being reported
            // as an unknown protocol message.
            break

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

    func sendCallEnd(targetID: String, callID: String? = nil, roomName: String? = nil) {
        let msg: [String: Any] = [
            "type": "call_end",
            "data": callSignalData(targetID: targetID, callID: callID, roomName: roomName)
        ]
        sendJSON(msg)
    }

    func sendCallReject(
        targetID: String,
        reason: String = "declined",
        callID: String? = nil,
        roomName: String? = nil
    ) {
        var data = callSignalData(targetID: targetID, callID: callID, roomName: roomName)
        data["reason"] = reason
        let msg: [String: Any] = [
            "type": "call_reject",
            "data": data
        ]
        sendJSON(msg)
    }

    func sendCallBusy(targetID: String, callID: String? = nil, roomName: String? = nil) {
        let msg: [String: Any] = [
            "type": "call_busy",
            "data": callSignalData(targetID: targetID, callID: callID, roomName: roomName)
        ]
        sendJSON(msg)
    }

    private func callSignalData(targetID: String, callID: String?, roomName: String?) -> [String: Any] {
        var data: [String: Any] = ["target_id": targetID]
        if let callID = callID?.trimmingCharacters(in: .whitespacesAndNewlines), !callID.isEmpty {
            data["call_id"] = callID
        }
        if let roomName = roomName?.trimmingCharacters(in: .whitespacesAndNewlines), !roomName.isEmpty {
            data["room_name"] = roomName
        }
        return data
    }

    private func sendJSON(_ dict: [String: Any]) {
        guard isConnected,
              let task = webSocketTask,
              task.state == .running,
              let data = try? JSONSerialization.data(withJSONObject: dict),
              let text = String(data: data, encoding: .utf8) else { return }
        let message = URLSessionWebSocketTask.Message.string(text)
        task.send(message) { [weak self] error in
            if let error = error {
                print("[WS] sendJSON error: \(error)")
                Task { @MainActor in self?.handleDisconnect(error: error) }
            }
        }
    }

    private static func dictionaryValue(_ value: Any?) -> [String: Any]? {
        if let dictionary = value as? [String: Any] {
            return dictionary
        }
        if let string = value as? String,
           let data = string.data(using: .utf8),
           let dictionary = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return dictionary
        }
        return nil
    }

    private static func firstString(_ data: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let string = data[key] as? String { return string }
            if let number = data[key] as? NSNumber { return number.stringValue }
        }
        return nil
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) }
        return nil
    }

    private static func boolValue(_ value: Any?) -> Bool? {
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.boolValue }
        if let string = value as? String {
            switch string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "true", "1", "yes": return true
            case "false", "0", "no": return false
            default: return nil
            }
        }
        return nil
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
        guard isConnected, let task = webSocketTask, task.state == .running else { return }
        let pingMessage = URLSessionWebSocketTask.Message.string("{\"type\": \"ping\"}")
        task.send(pingMessage) { [weak self] error in
            if let error {
                Task { @MainActor in
                    self?.handleDisconnect(error: error)
                }
            }
        }
    }

    private func startHealthCheck() {
        healthCheckTask?.cancel()
        healthCheckTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(AppConfig.wsHeartbeatInterval * 3 * 1_000_000_000))
                guard !Task.isCancelled, let self = self else { break }
                let elapsed = Date().timeIntervalSince(self.lastMessageReceivedAt)
                if elapsed > AppConfig.wsHeartbeatInterval * 3 {
                    print("[WS] Health check: no data for \(Int(elapsed))s, reconnecting")
                    self.fastReconnect()
                    break
                }
            }
        }
    }

    private func handleDisconnect(error: Error? = nil) {
        // Capture signals for token-rejection BEFORE we tear the task down.
        //
        //  closeCode 4001 / closeReason "Invalid token"
        //     → server had accepted the connection, then closed it with a
        //       custom close code. Only set on a *successful* handshake
        //       that is later closed.
        //
        //  NSURLErrorDomain -1011 (bad server response)
        //     → handshake itself failed. Server returned a non-101 HTTP
        //       status (403 for expired token, 404/500 for other reasons).
        //       closeCode is NOT populated in this case, so we have to
        //       detect it via the URLSession error.
        let staleTask = webSocketTask
        let closeCodeRaw = staleTask?.closeCode.rawValue ?? 0
        let reasonStr = staleTask?.closeReason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        let nsError = error as NSError?
        let handshakeFailure = nsError?.domain == NSURLErrorDomain && nsError?.code == NSURLErrorBadServerResponse

        let tokenLikelyInvalid =
            closeCodeRaw == 4001 ||
            reasonStr.localizedCaseInsensitiveContains("token") ||
            handshakeFailure

        isConnected = false
        isConnecting = false
        heartbeatTask?.cancel()
        heartbeatTask = nil
        healthCheckTask?.cancel()
        healthCheckTask = nil

        webSocketTask = nil
        if error == nil {
            staleTask?.cancel(with: .goingAway, reason: nil)
        }

        guard !isManuallyDisconnected else { return }

        // First disconnect that looks like a token issue → try refresh once.
        // The tokenRefreshAttempted flag resets on the next successful
        // connect (first received message), so subsequent token rejections
        // will refresh again — but a repeated refresh without ever
        // connecting falls through to normal backoff reconnect to avoid
        // hammering /auth/refresh.
        if tokenLikelyInvalid && !tokenRefreshAttempted {
            tokenRefreshAttempted = true
            print("[WS] handshake/token failure (code=\(closeCodeRaw) reason=\(reasonStr) err=\(nsError?.code ?? 0)) — attempting refresh")
            reconnectTask?.cancel()
            reconnectTask = Task { [weak self] in
                await self?.refreshTokenAndReconnect()
            }
            return
        }

        scheduleReconnect()
    }

    private func scheduleReconnect(retryTokenRefresh: Bool = false) {
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            guard let self = self else { return }
            let delay = self.reconnectDelay
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            if retryTokenRefresh {
                // A transport/server failure does not prove that the refresh
                // token is invalid. Allow a later handshake to try again once
                // the backend has recovered.
                self.tokenRefreshAttempted = false
            }
            self.reconnectDelay = min(self.reconnectDelay * 2, self.maxReconnectDelay)
            self.connect()
        }
    }

    /// Called when the WS server signals an expired/invalid token. Use the
    /// refresh token to obtain a new access token (same as the HTTP path's
    /// `attemptTokenRefresh`), persist it, then reconnect. Clear the local
    /// session only when the refresh token is definitively rejected. Backend
    /// restarts, timeouts, decoding failures, and 5xx responses must preserve
    /// the Keychain tokens and retry with backoff.
    @MainActor
    private func refreshTokenAndReconnect() async {
        do {
            let (newToken, newRefresh, user) = try await APIService.shared.refreshTokens()
            try AuthManager.shared.updateSessionTokens(
                accessToken: newToken,
                refreshToken: newRefresh,
                source: "websocket-refresh"
            )
            AuthManager.shared.updateUser(user)
            print("[WS] token refreshed, reconnecting")
            reconnectDelay = 1
            connect()
        } catch APIError.unauthorized {
            print("[WS] refresh token rejected — logging out")
            AuthManager.shared.logout()
        } catch {
            print("[WS] token refresh temporarily failed: \(error) — preserving session")
            scheduleReconnect(retryTokenRefresh: true)
        }
    }
}
