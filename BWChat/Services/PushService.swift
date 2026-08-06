// BWChat/Services/PushService.swift
// APNs push notification management

import Foundation
import Combine
import UserNotifications
import UIKit

enum NotificationConversationType: String, Codable, Sendable {
    case direct = "dm"
    case group
}

struct NotificationRoute: Codable, Equatable, Identifiable, Sendable {
    let eventID: String
    let conversationType: NotificationConversationType
    let conversationID: String
    let senderID: String?
    let groupID: Int?
    let messageID: Int?
    let conversationRevision: Int64?
    let unreadCount: Int?
    let totalUnreadCount: Int?
    let senderName: String?
    let senderAvatar: String?
    let groupName: String?
    let groupAvatar: String?
    let messageType: String?
    let contentPreview: String?
    let sentAt: String?
    let receivedAt: Date
    let isDirectMention: Bool
    let isMentionAll: Bool
    let notificationMode: String?

    enum CodingKeys: String, CodingKey {
        case eventID
        case conversationType
        case conversationID
        case senderID
        case groupID
        case messageID
        case conversationRevision
        case unreadCount
        case totalUnreadCount
        case senderName
        case senderAvatar
        case groupName
        case groupAvatar
        case messageType
        case contentPreview
        case sentAt
        case receivedAt
        case isDirectMention
        case isMentionAll
        case notificationMode
    }

    init(
        eventID: String,
        conversationType: NotificationConversationType,
        conversationID: String,
        senderID: String?,
        groupID: Int?,
        messageID: Int?,
        conversationRevision: Int64?,
        unreadCount: Int?,
        totalUnreadCount: Int?,
        senderName: String?,
        senderAvatar: String?,
        groupName: String?,
        groupAvatar: String?,
        messageType: String?,
        contentPreview: String?,
        sentAt: String?,
        receivedAt: Date,
        isDirectMention: Bool = false,
        isMentionAll: Bool = false,
        notificationMode: String? = nil
    ) {
        self.eventID = eventID
        self.conversationType = conversationType
        self.conversationID = conversationID
        self.senderID = senderID
        self.groupID = groupID
        self.messageID = messageID
        self.conversationRevision = conversationRevision
        self.unreadCount = unreadCount
        self.totalUnreadCount = totalUnreadCount
        self.senderName = senderName
        self.senderAvatar = senderAvatar
        self.groupName = groupName
        self.groupAvatar = groupAvatar
        self.messageType = messageType
        self.contentPreview = contentPreview
        self.sentAt = sentAt
        self.receivedAt = receivedAt
        self.isDirectMention = isDirectMention
        self.isMentionAll = isMentionAll
        self.notificationMode = notificationMode
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        eventID = try container.decode(String.self, forKey: .eventID)
        conversationType = try container.decode(
            NotificationConversationType.self,
            forKey: .conversationType
        )
        conversationID = try container.decode(String.self, forKey: .conversationID)
        senderID = try container.decodeIfPresent(String.self, forKey: .senderID)
        groupID = try container.decodeIfPresent(Int.self, forKey: .groupID)
        messageID = try container.decodeIfPresent(Int.self, forKey: .messageID)
        conversationRevision = try container.decodeIfPresent(
            Int64.self,
            forKey: .conversationRevision
        )
        unreadCount = try container.decodeIfPresent(Int.self, forKey: .unreadCount)
        totalUnreadCount = try container.decodeIfPresent(Int.self, forKey: .totalUnreadCount)
        senderName = try container.decodeIfPresent(String.self, forKey: .senderName)
        senderAvatar = try container.decodeIfPresent(String.self, forKey: .senderAvatar)
        groupName = try container.decodeIfPresent(String.self, forKey: .groupName)
        groupAvatar = try container.decodeIfPresent(String.self, forKey: .groupAvatar)
        messageType = try container.decodeIfPresent(String.self, forKey: .messageType)
        contentPreview = try container.decodeIfPresent(String.self, forKey: .contentPreview)
        sentAt = try container.decodeIfPresent(String.self, forKey: .sentAt)
        receivedAt = try container.decodeIfPresent(Date.self, forKey: .receivedAt) ?? Date()
        isDirectMention = try container.decodeIfPresent(
            Bool.self,
            forKey: .isDirectMention
        ) ?? false
        isMentionAll = try container.decodeIfPresent(Bool.self, forKey: .isMentionAll) ?? false
        notificationMode = try container.decodeIfPresent(
            String.self,
            forKey: .notificationMode
        )
    }

    var id: String { eventID }

    var listIdentity: String {
        switch conversationType {
        case .direct: return ConversationReadTarget.direct(userID: conversationID).listIdentity
        case .group:
            return ConversationReadTarget.group(groupID: groupID ?? Int(conversationID) ?? 0).listIdentity
        }
    }

    static func parse(_ userInfo: [AnyHashable: Any]) -> NotificationRoute? {
        let payload = NotificationPayloadNormalizer.flatten(userInfo)
        let groupID = NotificationPayloadNormalizer.intValue(payload["group_id"])
        let rawType = NotificationPayloadNormalizer.firstString(
            payload,
            keys: ["conversation_type", "conversationType", "push_type", "pushType", "type"]
        )?.lowercased()
        let isGroup = groupID != nil
            || rawType.map {
                ["group", "group_message", "new_group_message", "group_chat", "groupchat"].contains($0)
            } == true
        let type: NotificationConversationType = isGroup ? .group : .direct
        let senderID = NotificationPayloadNormalizer.firstString(
            payload,
            keys: ["sender_id", "senderId", "from_user_id", "user_id"]
        )
        let explicitConversationID = NotificationPayloadNormalizer.firstString(
            payload,
            keys: ["conversation_id", "conversationId"]
        )
        let conversationID: String
        switch type {
        case .group:
            guard let resolved = explicitConversationID ?? groupID.map(String.init), !resolved.isEmpty else {
                return nil
            }
            conversationID = resolved
        case .direct:
            guard let resolved = explicitConversationID ?? senderID, !resolved.isEmpty else { return nil }
            conversationID = resolved
        }
        let messageID = NotificationPayloadNormalizer.firstInt(
            payload,
            keys: ["message_id", "messageId", "msg_id", "id"]
        )
        let revision = NotificationPayloadNormalizer.firstInt64(
            payload,
            keys: ["conversation_revision", "conversationRevision", "revision"]
        )
        let suppliedEventID = NotificationPayloadNormalizer.firstString(
            payload,
            keys: ["event_id", "eventId"]
        )
        let stableFallback = [
            type.rawValue,
            conversationID,
            messageID.map(String.init) ?? "",
            NotificationPayloadNormalizer.firstString(payload, keys: ["sent_at", "timestamp"]) ?? ""
        ].joined(separator: ":")
        // APNs and WebSocket can use different transport event IDs for the
        // same logical message. Prefer the conversation-scoped message ID so
        // every delivery path resolves to one idempotency key.
        let canonicalEventID = messageID.map {
            "\(type.rawValue):\(conversationID):message:\($0)"
        }

        return NotificationRoute(
            eventID: canonicalEventID ?? suppliedEventID ?? stableFallback,
            conversationType: type,
            conversationID: conversationID,
            senderID: senderID,
            groupID: groupID ?? (type == .group ? Int(conversationID) : nil),
            messageID: messageID,
            conversationRevision: revision,
            unreadCount: NotificationPayloadNormalizer.firstInt(
                payload,
                keys: ["unread_count", "unreadCount", "unread"]
            ),
            totalUnreadCount: NotificationPayloadNormalizer.firstInt(
                payload,
                keys: ["total_unread_count", "totalUnreadCount", "badge"]
            ) ?? NotificationPayloadNormalizer.intValue(
                NotificationPayloadNormalizer.dictionaryValue(payload["aps"])?["badge"]
            ),
            senderName: NotificationPayloadNormalizer.firstString(
                payload,
                keys: ["sender_name", "senderName", "sender_nickname", "nickname"]
            ),
            senderAvatar: NotificationPayloadNormalizer.firstString(
                payload,
                keys: [
                    "sender_avatar_url", "sender_avatar",
                    "senderAvatarURL", "senderAvatarUrl", "senderAvatar",
                    "avatar_url", "avatar"
                ]
            ),
            groupName: NotificationPayloadNormalizer.firstString(
                payload,
                keys: ["group_name", "groupName", "conversation_name"]
            ),
            groupAvatar: NotificationPayloadNormalizer.firstString(
                payload,
                keys: [
                    "group_avatar_url", "group_avatar",
                    "groupAvatarURL", "groupAvatarUrl", "groupAvatar"
                ]
            ),
            messageType: NotificationPayloadNormalizer.firstString(
                payload,
                keys: ["msg_type", "message_type", "last_message_type"]
            ),
            contentPreview: NotificationPayloadNormalizer.firstString(
                payload,
                keys: ["content_preview", "content", "message", "last_message"]
            ),
            sentAt: NotificationPayloadNormalizer.firstString(
                payload,
                keys: ["sent_at", "timestamp", "last_message_time"]
            ),
            receivedAt: Date(),
            isDirectMention: NotificationPayloadNormalizer.firstBool(
                payload,
                keys: ["is_direct_mention", "isDirectMention", "is_mention"]
            ) ?? false,
            isMentionAll: NotificationPayloadNormalizer.firstBool(
                payload,
                keys: ["is_mention_all", "isMentionAll", "mention_all"]
            ) ?? false,
            notificationMode: NotificationPayloadNormalizer.firstString(
                payload,
                keys: ["notification_mode", "notificationMode"]
            )?.lowercased()
        )
    }
}

enum NotificationPayloadNormalizer {
    static func flatten(_ userInfo: [AnyHashable: Any]) -> [AnyHashable: Any] {
        var result = userInfo
        for containerKey in ["data", "payload", "notification_data"] {
            guard let nested = dictionaryValue(userInfo[containerKey]) else { continue }
            for (key, value) in nested where result[key] == nil {
                result[key] = value
            }
        }
        return result
    }

    static func dictionaryValue(_ value: Any?) -> [String: Any]? {
        if let dictionary = value as? [String: Any] { return dictionary }
        if let dictionary = value as? [AnyHashable: Any] {
            return dictionary.reduce(into: [:]) { result, entry in
                guard let key = entry.key as? String else { return }
                result[key] = entry.value
            }
        }
        if let string = value as? String,
           let data = string.data(using: .utf8),
           let dictionary = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return dictionary
        }
        return nil
    }

    static func firstString(_ values: [AnyHashable: Any], keys: [String]) -> String? {
        keys.lazy.compactMap { stringValue(values[$0]) }.first { !$0.isEmpty }
    }

    static func firstInt(_ values: [AnyHashable: Any], keys: [String]) -> Int? {
        keys.lazy.compactMap { intValue(values[$0]) }.first
    }

    static func firstInt64(_ values: [AnyHashable: Any], keys: [String]) -> Int64? {
        keys.lazy.compactMap { key -> Int64? in
            let value = values[key]
            if let integer = value as? Int64 { return integer }
            if let integer = value as? Int { return Int64(integer) }
            if let number = value as? NSNumber { return number.int64Value }
            if let string = value as? String { return Int64(string) }
            return nil
        }.first
    }

    static func firstBool(_ values: [AnyHashable: Any], keys: [String]) -> Bool? {
        keys.lazy.compactMap { value -> Bool? in
            let raw = values[value]
            if let bool = raw as? Bool { return bool }
            if let number = raw as? NSNumber { return number.boolValue }
            if let string = raw as? String {
                switch string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
                case "true", "1", "yes": return true
                case "false", "0", "no": return false
                default: return nil
                }
            }
            return nil
        }.first
    }

    static func stringValue(_ value: Any?) -> String? {
        if let string = value as? String {
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    static func intValue(_ value: Any?) -> Int? {
        if let integer = value as? Int { return integer }
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) }
        return nil
    }
}

enum MessageSyncReason: String, Codable, Sendable {
    case coldLaunch
    case foreground
    case notification
    case silentPush
    case webSocketReconnect
}

@MainActor
final class AppMessageSyncCoordinator: ObservableObject {
    static let shared = AppMessageSyncCoordinator()

    @Published private(set) var pendingRoute: NotificationRoute?
    @Published private(set) var syncGeneration = 0
    @Published private(set) var lastReason: MessageSyncReason?
    @Published private(set) var needsSync = false

    private var processedEventIDs = Set<String>()
    private let defaults = UserDefaults.standard
    private let routeKey = "bwchat.message-sync.pending-route"
    private let processedKey = "bwchat.message-sync.processed-event-ids"
    private let dirtyKey = "bwchat.message-sync.dirty"

    private init() {
        if let data = defaults.data(forKey: routeKey) {
            pendingRoute = try? JSONDecoder().decode(NotificationRoute.self, from: data)
        }
        processedEventIDs = Set(defaults.stringArray(forKey: processedKey) ?? [])
        needsSync = defaults.bool(forKey: dirtyKey) || pendingRoute != nil
        if needsSync {
            syncGeneration = 1
            lastReason = pendingRoute == nil ? .coldLaunch : .notification
        }
    }

    func receive(_ userInfo: [AnyHashable: Any], opensConversation: Bool, reason: MessageSyncReason) {
        let route = NotificationRoute.parse(userInfo)
        if let route, !processedEventIDs.contains(route.eventID) {
            UnreadBadgeStore.shared.applyNotification(route)
        }
        if opensConversation, let route, !processedEventIDs.contains(route.eventID) {
            pendingRoute = route
            persistPendingRoute()
        }
        requestSync(reason)
    }

    func requestSync(_ reason: MessageSyncReason) {
        lastReason = reason
        syncGeneration &+= 1
        needsSync = true
        defaults.set(true, forKey: dirtyKey)
        if let key = CacheKey.current(namespace: "conversations", key: "list") {
            AppCacheRepository.shared.invalidate(key)
        }
    }

    func markSynced(generation: Int? = nil) {
        if let generation, generation != syncGeneration { return }
        needsSync = false
        defaults.set(false, forKey: dirtyKey)
    }

    func consume(_ route: NotificationRoute) {
        guard pendingRoute?.eventID == route.eventID else { return }
        processedEventIDs.insert(route.eventID)
        if processedEventIDs.count > 256 {
            processedEventIDs = Set(processedEventIDs.sorted().suffix(256))
        }
        defaults.set(Array(processedEventIDs), forKey: processedKey)
        pendingRoute = nil
        defaults.removeObject(forKey: routeKey)
    }

    func discardPendingRoute() {
        pendingRoute = nil
        defaults.removeObject(forKey: routeKey)
    }

    private func persistPendingRoute() {
        guard let pendingRoute,
              let data = try? JSONEncoder().encode(pendingRoute) else { return }
        defaults.set(data, forKey: routeKey)
    }
}

struct ConversationUnreadState: Codable, Equatable, Sendable {
    var revision: Int64?
    var lastMessageID: Int?
    var readThroughMessageID: Int?
    var serverUnreadCount: Int
    var pendingEventIDs: Set<String>

    var projectedUnreadCount: Int {
        max(0, serverUnreadCount + pendingEventIDs.count)
    }
}

@MainActor
final class UnreadBadgeStore: ObservableObject {
    static let shared = UnreadBadgeStore()

    @Published private(set) var chatUnreadCount: Int = 0
    @Published private(set) var momentsUnreadCount: Int = 0
    /// The per-conversation values are the only source used to derive the chat
    /// tab and application badge. Zero values are intentionally retained so a
    /// secondary list can distinguish "known read" from "not loaded yet".
    @Published private(set) var conversationUnreadCounts: [String: Int] = [:]

    private var states: [String: ConversationUnreadState] = [:]
    /// Muted conversations keep their per-row unread counts, but they do not
    /// contribute to the Messages tab or application icon badge.
    private var mutedConversationIdentities: Set<String> = []
    private var ownerID: String?

    private init() {
        ensureOwner()
    }

    var totalUnreadCount: Int {
        chatUnreadCount + momentsUnreadCount
    }

    func setChatUnreadCount(_ count: Int) {
        ensureOwner()
        let next = max(0, count)
        conversationUnreadCounts = next == 0 ? [:] : ["legacy:aggregate": next]
        states = next == 0 ? [:] : [
            "legacy:aggregate": ConversationUnreadState(
                revision: nil,
                lastMessageID: nil,
                readThroughMessageID: nil,
                serverUnreadCount: next,
                pendingEventIDs: []
            )
        ]
        updateChatUnreadTotal()
    }

    func replaceChatUnreadCounts(
        _ counts: [String: Int],
        mutedIdentities: Set<String>? = nil
    ) {
        ensureOwner()
        if let mutedIdentities {
            mutedConversationIdentities = normalizedIdentities(mutedIdentities)
            persistMutedConversationIdentities()
        }
        for (identity, count) in counts {
            let normalizedIdentity = identity.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalizedIdentity.isEmpty else { continue }
            var state = states[normalizedIdentity] ?? ConversationUnreadState(
                revision: nil,
                lastMessageID: nil,
                readThroughMessageID: nil,
                serverUnreadCount: 0,
                pendingEventIDs: []
            )
            if state.revision != nil {
                continue
            }
            state.serverUnreadCount = max(0, count - state.pendingEventIDs.count)
            states[normalizedIdentity] = state
        }
        let supplied = Set(counts.keys)
        for identity in states.keys where !supplied.contains(identity) {
            states.removeValue(forKey: identity)
        }
        conversationUnreadCounts = states.reduce(into: [:]) { result, entry in
            let identity = entry.key.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !identity.isEmpty else { return }
            result[identity] = entry.value.projectedUnreadCount
        }
        updateChatUnreadTotal()
    }

    func setConversationMuted(_ isMuted: Bool, for identity: String) {
        ensureOwner()
        let normalizedIdentity = identity.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedIdentity.isEmpty else { return }
        let changed: Bool
        if isMuted {
            changed = mutedConversationIdentities.insert(normalizedIdentity).inserted
        } else {
            changed = mutedConversationIdentities.remove(normalizedIdentity) != nil
        }
        guard changed else { return }
        persistMutedConversationIdentities()
        updateChatUnreadTotal()
    }

    func setConversationUnreadCount(_ count: Int, for identity: String) {
        ensureOwner()
        let normalizedIdentity = identity.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedIdentity.isEmpty else { return }
        states[normalizedIdentity] = ConversationUnreadState(
            revision: states[normalizedIdentity]?.revision,
            lastMessageID: states[normalizedIdentity]?.lastMessageID,
            readThroughMessageID: count == 0
                ? states[normalizedIdentity]?.lastMessageID
                : states[normalizedIdentity]?.readThroughMessageID,
            serverUnreadCount: max(0, count),
            pendingEventIDs: []
        )
        conversationUnreadCounts[normalizedIdentity] = max(0, count)
        updateChatUnreadTotal()
    }

    func incrementConversationUnread(for identity: String) {
        ensureOwner()
        let normalizedIdentity = identity.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedIdentity.isEmpty else { return }
        var state = states[normalizedIdentity] ?? ConversationUnreadState(
            revision: nil,
            lastMessageID: nil,
            readThroughMessageID: nil,
            serverUnreadCount: conversationUnreadCounts[normalizedIdentity] ?? 0,
            pendingEventIDs: []
        )
        state.serverUnreadCount += 1
        states[normalizedIdentity] = state
        conversationUnreadCounts[normalizedIdentity] = state.projectedUnreadCount
        updateChatUnreadTotal()
    }

    func applyNotification(_ route: NotificationRoute) {
        ensureOwner()
        let identity = route.listIdentity
        let eventID = incomingEventID(
            identity: identity,
            messageID: route.messageID,
            fallback: route.eventID
        )
        var state = states[identity] ?? ConversationUnreadState(
            revision: nil,
            lastMessageID: nil,
            readThroughMessageID: nil,
            serverUnreadCount: conversationUnreadCounts[identity] ?? 0,
            pendingEventIDs: []
        )
        if let revision = route.conversationRevision,
           let currentRevision = state.revision,
           revision < currentRevision {
            return
        }
        if let revision = route.conversationRevision { state.revision = revision }
        let messageWasAlreadyObserved = route.messageID.map { messageID in
            state.lastMessageID.map { messageID <= $0 } ?? false
        } ?? false
        if let messageID = route.messageID {
            state.lastMessageID = max(state.lastMessageID ?? messageID, messageID)
        }
        if let unreadCount = route.unreadCount {
            state.serverUnreadCount = max(0, unreadCount)
            if route.conversationRevision != nil {
                state.pendingEventIDs.removeAll()
            } else {
                acknowledgePendingEvents(
                    in: &state,
                    identity: identity,
                    throughMessageID: route.messageID,
                    fallbackEventID: eventID
                )
            }
        } else {
            if messageWasAlreadyObserved { return }
            if state.pendingEventIDs.insert(eventID).inserted == false { return }
        }
        states[identity] = state
        conversationUnreadCounts[identity] = state.projectedUnreadCount
        updateChatUnreadTotal()
    }

    /// Records a live incoming message exactly once across WebSocket, APNs and
    /// conversation-list rendering. `messageID` is the canonical idempotency
    /// key; the transport event ID is only a fallback for legacy payloads.
    @discardableResult
    func recordIncomingMessage(
        identity: String,
        messageID: Int?,
        eventID: String,
        baselineUnreadCount: Int
    ) -> Int {
        ensureOwner()
        let normalizedIdentity = identity.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedIdentity.isEmpty else { return max(0, baselineUnreadCount) }

        var state = states[normalizedIdentity] ?? ConversationUnreadState(
            revision: nil,
            lastMessageID: nil,
            readThroughMessageID: nil,
            serverUnreadCount: max(0, baselineUnreadCount),
            pendingEventIDs: []
        )
        let baseline = max(0, baselineUnreadCount)
        if state.projectedUnreadCount < baseline {
            state.serverUnreadCount += baseline - state.projectedUnreadCount
        }

        // A notification path may already have applied this same message
        // before the list publisher receives it. Do not add a second delta.
        if let messageID,
           let lastMessageID = state.lastMessageID,
           messageID <= lastMessageID {
            states[normalizedIdentity] = state
            conversationUnreadCounts[normalizedIdentity] = state.projectedUnreadCount
            updateChatUnreadTotal()
            return state.projectedUnreadCount
        }

        let canonicalEventID = incomingEventID(
            identity: normalizedIdentity,
            messageID: messageID,
            fallback: eventID
        )
        if state.pendingEventIDs.insert(canonicalEventID).inserted {
            if let messageID {
                state.lastMessageID = max(state.lastMessageID ?? messageID, messageID)
            }
        }
        states[normalizedIdentity] = state
        conversationUnreadCounts[normalizedIdentity] = state.projectedUnreadCount
        updateChatUnreadTotal()
        return state.projectedUnreadCount
    }

    func applyServerSnapshot(
        identity: String,
        unreadCount: Int,
        revision: Int64?,
        lastMessageID: Int?,
        readThroughMessageID: Int?
    ) {
        ensureOwner()
        var state = states[identity] ?? ConversationUnreadState(
            revision: nil,
            lastMessageID: nil,
            readThroughMessageID: nil,
            serverUnreadCount: 0,
            pendingEventIDs: []
        )
        if revision == nil, state.revision != nil { return }
        if let revision, let current = state.revision, revision < current { return }
        if revision == nil,
           let lastMessageID,
           let currentLastMessageID = state.lastMessageID,
           lastMessageID < currentLastMessageID {
            return
        }
        state.revision = revision ?? state.revision
        state.lastMessageID = lastMessageID ?? state.lastMessageID
        state.readThroughMessageID = readThroughMessageID ?? state.readThroughMessageID
        state.serverUnreadCount = max(0, unreadCount)
        if revision != nil {
            state.pendingEventIDs.removeAll()
        } else {
            acknowledgePendingEvents(
                in: &state,
                identity: identity,
                throughMessageID: lastMessageID,
                fallbackEventID: nil
            )
        }
        states[identity] = state
        conversationUnreadCounts[identity] = state.projectedUnreadCount
        updateChatUnreadTotal()
    }

    func applyReadReceipt(_ receipt: ConversationReadReceipt) {
        ensureOwner()
        applyServerSnapshot(
            identity: receipt.listIdentity,
            unreadCount: receipt.unreadCount,
            revision: receipt.revision,
            lastMessageID: nil,
            readThroughMessageID: receipt.readThroughMessageID
        )
    }

    /// Returns nil until this identity has been supplied by the canonical
    /// conversation list. Callers can then safely fall back to their own cache.
    func conversationUnreadCount(for identity: String) -> Int? {
        ensureOwner()
        return conversationUnreadCounts[identity]
    }

    private func incomingEventID(
        identity: String,
        messageID: Int?,
        fallback: String
    ) -> String {
        if let messageID {
            return "\(identity):message:\(messageID)"
        }
        return fallback
    }

    private func acknowledgePendingEvents(
        in state: inout ConversationUnreadState,
        identity: String,
        throughMessageID: Int?,
        fallbackEventID: String?
    ) {
        guard let throughMessageID else {
            if let fallbackEventID {
                state.pendingEventIDs.remove(fallbackEventID)
            }
            return
        }
        let prefix = "\(identity):message:"
        state.pendingEventIDs = state.pendingEventIDs.filter { eventID in
            guard eventID.hasPrefix(prefix),
                  let messageID = Int(eventID.dropFirst(prefix.count)) else {
                return eventID != fallbackEventID
            }
            return messageID > throughMessageID
        }
    }

    private func updateChatUnreadTotal() {
        persist()
        let next = conversationUnreadCounts.reduce(into: 0) { total, entry in
            guard !mutedConversationIdentities.contains(entry.key) else { return }
            total += entry.value
        }
        guard chatUnreadCount != next else {
            syncApplicationBadge()
            return
        }
        chatUnreadCount = next
        syncApplicationBadge()
    }

    func setMomentsUnreadCount(_ count: Int) {
        ensureOwner()
        let next = max(0, count)
        guard momentsUnreadCount != next else {
            syncApplicationBadge()
            return
        }
        momentsUnreadCount = next
        syncApplicationBadge()
    }

    func incrementMomentsUnread() {
        ensureOwner()
        momentsUnreadCount += 1
        syncApplicationBadge()
    }

    func syncApplicationBadge() {
        UIApplication.shared.applicationIconBadgeNumber = totalUnreadCount
    }

    func resetForCurrentAccount() {
        ownerID = nil
        ensureOwner()
    }

    private func ensureOwner() {
        let nextOwner = AuthManager.shared.currentUser?.userID
        guard ownerID != nextOwner else { return }
        ownerID = nextOwner
        states = [:]
        mutedConversationIdentities = []
        conversationUnreadCounts = [:]
        chatUnreadCount = 0
        momentsUnreadCount = 0
        if let nextOwner {
            mutedConversationIdentities = Set(
                UserDefaults.standard.stringArray(
                    forKey: mutedPersistenceKey(nextOwner)
                ) ?? []
            )
        }
        guard let nextOwner,
              let data = UserDefaults.standard.data(forKey: persistenceKey(nextOwner)),
              let decoded = try? JSONDecoder().decode([String: ConversationUnreadState].self, from: data) else {
            syncApplicationBadge()
            return
        }
        states = decoded
        conversationUnreadCounts = decoded.mapValues(\.projectedUnreadCount)
        chatUnreadCount = conversationUnreadCounts.reduce(into: 0) { total, entry in
            guard !mutedConversationIdentities.contains(entry.key) else { return }
            total += entry.value
        }
        syncApplicationBadge()
    }

    private func persist() {
        guard let ownerID,
              let data = try? JSONEncoder().encode(states) else { return }
        UserDefaults.standard.set(data, forKey: persistenceKey(ownerID))
    }

    private func persistenceKey(_ ownerID: String) -> String {
        "bwchat.unread-state.\(ownerID)"
    }

    private func persistMutedConversationIdentities() {
        guard let ownerID else { return }
        UserDefaults.standard.set(
            mutedConversationIdentities.sorted(),
            forKey: mutedPersistenceKey(ownerID)
        )
    }

    private func mutedPersistenceKey(_ ownerID: String) -> String {
        "bwchat.muted-badge-identities.\(ownerID)"
    }

    private func normalizedIdentities(_ identities: Set<String>) -> Set<String> {
        Set(identities.compactMap { identity in
            let normalized = identity.trimmingCharacters(in: .whitespacesAndNewlines)
            return normalized.isEmpty ? nil : normalized
        })
    }
}

@MainActor
class PushService: ObservableObject {
    static let shared = PushService()

    @Published var isAuthorized: Bool = false
    private var cachedDeviceToken: String?
    /// Track whether we need to upload once we receive a token
    private var pendingUpload: Bool = false
    /// Track whether we've already successfully uploaded the current token
    private var tokenUploaded: Bool = false
    /// Retry count for failed uploads
    private var uploadRetryCount: Int = 0
    private let maxUploadRetries: Int = 3

    private init() {}

    /// Register for remote notifications immediately at app launch.
    /// This should be called from didFinishLaunchingWithOptions, before login.
    /// iOS will return a device token regardless of notification permission.
    func registerForRemoteNotifications() {
        UIApplication.shared.registerForRemoteNotifications()
        print("[Push] Registered for remote notifications")
    }

    /// Request push notification permission (separate from registration).
    /// Call this after login to prompt the user.
    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, error in
            Task { @MainActor in
                self.isAuthorized = granted
                print("[Push] Permission granted: \(granted), error: \(String(describing: error))")
                if granted {
                    // Re-register in case token needs refresh
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }

    /// Re-register for push notifications when app becomes active.
    /// This ensures the device token stays fresh and is re-uploaded
    /// after the app returns from background or after being killed.
    func reregisterIfNeeded() {
        // Always ask iOS for a fresh token when becoming active
        UIApplication.shared.registerForRemoteNotifications()

        // If we have a token and are logged in but haven't uploaded, upload now
        if let token = deviceToken, AuthManager.shared.token != nil, !tokenUploaded {
            print("[Push] Re-uploading token on foreground return")
            uploadRetryCount = 0
            uploadTokenToServer(token)
        }
    }

    /// Handle device token registration from APNs callback.
    /// Called by AppDelegate when APNs returns a device token.
    func didRegisterForRemoteNotifications(deviceToken: Data) {
        let tokenString = deviceToken.hexString
        let previousToken = cachedDeviceToken
        print("[Push] Device token received: \(tokenString.prefix(16))...")

        UserDefaults.standard.set(tokenString, forKey: "device_token")
        cachedDeviceToken = tokenString

        // Reset upload state if token changed
        if previousToken != tokenString {
            tokenUploaded = false
            uploadRetryCount = 0
        }

        // Upload to server if we're logged in
        if AuthManager.shared.token != nil {
            uploadTokenToServer(tokenString)
        } else if pendingUpload {
            // Will be uploaded when ensureTokenUploaded() is called after login
            print("[Push] Token received but not logged in yet, waiting for login")
        }

        // If ensureTokenUploaded() was called before we got the token,
        // fulfill that pending request now
        if pendingUpload && AuthManager.shared.token != nil {
            pendingUpload = false
            uploadTokenToServer(tokenString)
        }
    }

    /// Handle registration failure
    func didFailToRegisterForRemoteNotifications(error: Error) {
        print("[Push] FAILED to register for remote notifications: \(error.localizedDescription)")
        print("[Push] Error details: \(error)")
    }

    /// Ensure the device token is uploaded to the server.
    /// Call this after every successful login (manual or auto-login).
    func ensureTokenUploaded() {
        uploadRetryCount = 0
        tokenUploaded = false

        if let token = deviceToken {
            print("[Push] ensureTokenUploaded: uploading existing token \(token.prefix(16))...")
            uploadTokenToServer(token)
        } else {
            // Token not yet received from APNs - mark as pending.
            // When didRegisterForRemoteNotifications fires, it will upload.
            pendingUpload = true
            print("[Push] ensureTokenUploaded: no token yet, marked as pending")
            // Also re-register in case the system hasn't called back yet
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// Get the current device token
    var deviceToken: String? {
        cachedDeviceToken ?? UserDefaults.standard.string(forKey: "device_token")
    }

    /// Keep the system badge aligned with the app's unread stores. This does
    /// not mark any conversation as read; callers must clear a concrete
    /// conversation through `UnreadBadgeStore` first.
    func syncBadgeFromUnreadState() {
        UnreadBadgeStore.shared.syncApplicationBadge()
    }

    // MARK: - Private

    private func uploadTokenToServer(_ token: String) {
        guard AuthManager.shared.token != nil else {
            print("[Push] Cannot upload token: not logged in")
            pendingUpload = true
            return
        }

        Task {
            do {
                try await APIService.shared.registerDeviceToken(token)
                print("[Push] Device token uploaded successfully")
                tokenUploaded = true
                uploadRetryCount = 0
            } catch {
                print("[Push] Failed to upload device token: \(error)")
                uploadRetryCount += 1

                // Retry with exponential backoff
                if uploadRetryCount <= maxUploadRetries {
                    let delay = UInt64(pow(2.0, Double(uploadRetryCount))) * 1_000_000_000
                    print("[Push] Retrying upload in \(uploadRetryCount * 2)s (attempt \(uploadRetryCount)/\(maxUploadRetries))")
                    try? await Task.sleep(nanoseconds: delay)
                    if !tokenUploaded {
                        uploadTokenToServer(token)
                    }
                } else {
                    print("[Push] Max retries reached, will retry on next app launch")
                }
            }
        }
    }
}
