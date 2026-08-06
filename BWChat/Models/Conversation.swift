import Foundation
import Combine

enum ConversationReadTarget: Equatable {
    case direct(userID: String)
    case group(groupID: Int)

    var listIdentity: String {
        switch self {
        case .direct(let userID):
            return "dm:\(userID)"
        case .group(let groupID):
            return "group:\(groupID)"
        }
    }
}

struct ConversationSyncSnapshot: Codable, Equatable, Sendable {
    let conversations: [Conversation]
    let revision: Int64?
    let serverTime: String?
    let totalUnreadCount: Int?
    /// True only when the backend guarantees that `conversations` is the
    /// complete authoritative set. This lets the client distinguish a genuine
    /// empty inbox from a degraded/partial 200 response.
    let snapshotComplete: Bool?

    enum CodingKeys: String, CodingKey {
        case conversations
        case revision
        case serverTime = "server_time"
        case totalUnreadCount = "total_unread_count"
        case snapshotComplete = "snapshot_complete"
        case isComplete = "is_complete"
    }

    init(
        conversations: [Conversation],
        revision: Int64? = nil,
        serverTime: String? = nil,
        totalUnreadCount: Int? = nil,
        snapshotComplete: Bool? = nil
    ) {
        self.conversations = conversations
        self.revision = revision
        self.serverTime = serverTime
        self.totalUnreadCount = totalUnreadCount
        self.snapshotComplete = snapshotComplete
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        conversations = try container.decodeIfPresent([Conversation].self, forKey: .conversations) ?? []
        if let value = try? container.decodeIfPresent(Int64.self, forKey: .revision) {
            revision = value
        } else if let value = try? container.decodeIfPresent(String.self, forKey: .revision) {
            revision = Int64(value)
        } else {
            revision = nil
        }
        serverTime = try container.decodeIfPresent(String.self, forKey: .serverTime)
        totalUnreadCount = container.flexInt(for: .totalUnreadCount)
        snapshotComplete = container.flexBool(for: .snapshotComplete)
            ?? container.flexBool(for: .isComplete)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(conversations, forKey: .conversations)
        try container.encodeIfPresent(revision, forKey: .revision)
        try container.encodeIfPresent(serverTime, forKey: .serverTime)
        try container.encodeIfPresent(totalUnreadCount, forKey: .totalUnreadCount)
        try container.encodeIfPresent(snapshotComplete, forKey: .snapshotComplete)
    }
}

enum ConversationSnapshotReplacementPolicy {
    /// Non-empty snapshots remain backward compatible with older servers. An
    /// empty snapshot may erase existing rows only when the backend explicitly
    /// marks it complete. Monotonic revisions prevent an older response from
    /// replacing a newer accepted snapshot.
    static func shouldAccept(
        _ snapshot: ConversationSyncSnapshot,
        replacingLocalCount localCount: Int,
        lastAcceptedRevision: Int64?
    ) -> Bool {
        if let incomingRevision = snapshot.revision,
           let lastAcceptedRevision,
           incomingRevision < lastAcceptedRevision {
            return false
        }
        guard snapshot.conversations.isEmpty, localCount > 0 else { return true }
        guard snapshot.snapshotComplete == true else { return false }
        if lastAcceptedRevision != nil, snapshot.revision == nil { return false }
        return true
    }
}

struct ConversationReadReceipt: Codable, Equatable, Sendable {
    let conversationType: String
    let conversationID: String
    let readThroughMessageID: Int
    let unreadCount: Int
    let totalUnreadCount: Int?
    let revision: Int64?
    let serverTime: String?

    enum CodingKeys: String, CodingKey {
        case conversationType = "conversation_type"
        case conversationID = "conversation_id"
        case readThroughMessageID = "read_through_message_id"
        case unreadCount = "unread_count"
        case totalUnreadCount = "total_unread_count"
        case revision
        case serverTime = "server_time"
    }

    init(
        conversationType: String,
        conversationID: String,
        readThroughMessageID: Int,
        unreadCount: Int,
        totalUnreadCount: Int? = nil,
        revision: Int64? = nil,
        serverTime: String? = nil
    ) {
        self.conversationType = conversationType
        self.conversationID = conversationID
        self.readThroughMessageID = readThroughMessageID
        self.unreadCount = unreadCount
        self.totalUnreadCount = totalUnreadCount
        self.revision = revision
        self.serverTime = serverTime
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        conversationType = (try? container.decodeIfPresent(String.self, forKey: .conversationType)) ?? ""
        conversationID = (try? container.decodeIfPresent(String.self, forKey: .conversationID)) ?? ""
        readThroughMessageID = (try? container.decodeIfPresent(Int.self, forKey: .readThroughMessageID)) ?? 0
        unreadCount = (try? container.decodeIfPresent(Int.self, forKey: .unreadCount)) ?? 0
        totalUnreadCount = try? container.decodeIfPresent(Int.self, forKey: .totalUnreadCount)
        if let integer = try? container.decodeIfPresent(Int64.self, forKey: .revision) {
            revision = integer
        } else if let string = try? container.decode(String.self, forKey: .revision) {
            revision = Int64(string)
        } else {
            revision = nil
        }
        serverTime = try? container.decodeIfPresent(String.self, forKey: .serverTime)
    }

    var isMeaningful: Bool {
        !conversationID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var listIdentity: String {
        let normalized = conversationType
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if normalized == "group" || normalized == "group_chat" {
            return ConversationReadTarget.group(groupID: Int(conversationID) ?? 0).listIdentity
        }
        return ConversationReadTarget.direct(userID: conversationID).listIdentity
    }
}

extension Notification.Name {
    static let directHistoryCleared = Notification.Name("bbchat.directHistoryCleared")
}

struct DirectHistoryClearReceipt: Codable, Equatable, Sendable {
    let conversationID: String
    let clearedBeforeMessageID: Int
    let clearedAt: String?
    let revision: Int64

    enum CodingKeys: String, CodingKey {
        case conversationID = "conversation_id"
        case contactID = "contact_id"
        case clearedBeforeMessageID = "cleared_before_message_id"
        case clearedBeforeID = "cleared_before_id"
        case clearedAt = "cleared_at"
        case revision
    }

    init(
        conversationID: String,
        clearedBeforeMessageID: Int,
        clearedAt: String? = nil,
        revision: Int64 = 0
    ) {
        self.conversationID = conversationID
        self.clearedBeforeMessageID = clearedBeforeMessageID
        self.clearedAt = clearedAt
        self.revision = revision
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        conversationID = container.flexString(for: .conversationID)
            ?? container.flexString(for: .contactID)
            ?? ""
        clearedBeforeMessageID = container.flexInt(for: .clearedBeforeMessageID)
            ?? container.flexInt(for: .clearedBeforeID)
            ?? 0
        clearedAt = container.flexString(for: .clearedAt)
        if let value = try? container.decodeIfPresent(Int64.self, forKey: .revision) {
            revision = value
        } else {
            revision = Int64(container.flexInt(for: .revision) ?? 0)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(conversationID, forKey: .conversationID)
        try container.encode(clearedBeforeMessageID, forKey: .clearedBeforeMessageID)
        try container.encodeIfPresent(clearedAt, forKey: .clearedAt)
        try container.encode(revision, forKey: .revision)
    }
}

@MainActor
enum DirectHistoryClearCoordinator {
    static func apply(_ receipt: DirectHistoryClearReceipt) {
        guard let ownerID = AuthManager.shared.currentUser?.userID,
              !ownerID.isBlank,
              !receipt.conversationID.isBlank else { return }
        MessageStore.shared.applyDirectHistoryClear(
            ownerID: ownerID,
            contactID: receipt.conversationID,
            throughMessageID: receipt.clearedBeforeMessageID
        )
        NotificationCenter.default.post(name: .directHistoryCleared, object: receipt)
    }
}

struct Conversation: Codable, Identifiable, Equatable, Hashable {
    let type: String  // "dm", "group", or "agent"
    let id: String
    let name: String
    let avatarURL: String
    let lastMessage: String?
    let lastMessageTime: String?
    let unreadCount: Int
    let subtitle: String?
    let groupID: Int?
    let memberCount: Int?
    let conversationKind: String?
    let scriptRoomID: String?
    let scriptID: String?
    let agentConversationID: String?
    let agentID: String?
    let agentAvatarAssetID: String?
    let agentGreetingID: String?
    let lastMessageID: Int?
    let readThroughMessageID: Int?
    let revision: Int64?
    let isMuted: Bool
    let serverIsPinned: Bool?

    enum CodingKeys: String, CodingKey {
        case type
        case id
        case conversationID = "conversation_id"
        case name
        case title
        case avatarURL = "avatar_url"
        case avatarURLCamel = "avatarURL"
        case avatar
        case lastMessage = "last_message"
        case lastMessageCamel = "lastMessage"
        case lastMessageTime = "last_message_time"
        case lastMessageTimeCamel = "lastMessageTime"
        case unreadCount = "unread_count"
        case unread
        case unreadCountCamel = "unreadCount"
        case subtitle
        case groupID = "group_id"
        case groupIDCamel = "groupID"
        case memberCount = "member_count"
        case memberCountCamel = "memberCount"
        case conversationKind = "conversation_kind"
        case conversationKindCamel = "conversationKind"
        case scriptRoomID = "script_room_id"
        case scriptRoomIDCamel = "scriptRoomID"
        case scriptID = "script_id"
        case scriptIDCamel = "scriptID"
        case agentConversationID = "agent_conversation_id"
        case agentConversationIDCamel = "agentConversationID"
        case agentID = "agent_id"
        case agentIDCamel = "agentID"
        case agentAvatarAssetID = "agent_avatar_asset_id"
        case agentAvatarAssetIDCamel = "agentAvatarAssetID"
        case agentGreetingID = "agent_greeting_id"
        case agentGreetingIDCamel = "agentGreetingID"
        case lastMessageID = "last_message_id"
        case lastMessageIDCamel = "lastMessageID"
        case readThroughMessageID = "read_through_message_id"
        case readThroughMessageIDCamel = "readThroughMessageID"
        case revision
        case isMuted = "is_muted"
        case isMutedCamel = "isMuted"
        case serverIsPinned = "is_pinned"
        case serverIsPinnedCamel = "isPinned"
    }

    init(
        type: String,
        id: String,
        name: String,
        avatarURL: String,
        lastMessage: String?,
        lastMessageTime: String?,
        unreadCount: Int,
        subtitle: String?,
        groupID: Int?,
        memberCount: Int?,
        conversationKind: String? = nil,
        scriptRoomID: String? = nil,
        scriptID: String? = nil,
        agentConversationID: String? = nil,
        agentID: String? = nil,
        agentAvatarAssetID: String? = nil,
        agentGreetingID: String? = nil,
        lastMessageID: Int? = nil,
        readThroughMessageID: Int? = nil,
        revision: Int64? = nil,
        isMuted: Bool = false,
        serverIsPinned: Bool? = nil
    ) {
        self.type = Self.normalizedType(type, groupID: groupID, id: id)
        self.id = id
        self.name = name
        self.avatarURL = avatarURL
        self.lastMessage = lastMessage
        self.lastMessageTime = lastMessageTime
        self.unreadCount = unreadCount
        self.subtitle = subtitle
        self.groupID = groupID
        self.memberCount = memberCount
        self.conversationKind = conversationKind
        self.scriptRoomID = scriptRoomID
        self.scriptID = scriptID
        self.agentConversationID = agentConversationID
        self.agentID = agentID
        self.agentAvatarAssetID = agentAvatarAssetID
        self.agentGreetingID = agentGreetingID
        self.lastMessageID = lastMessageID
        self.readThroughMessageID = readThroughMessageID
        self.revision = revision
        self.isMuted = isMuted
        self.serverIsPinned = serverIsPinned
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedGroupID = container.flexInt(for: .groupID)
            ?? container.flexInt(for: .groupIDCamel)
        let decodedID = container.flexString(for: .id)
            ?? container.flexString(for: .conversationID)
            ?? decodedGroupID.map(String.init)
            ?? ""
        let decodedType = container.flexString(for: .type)
        self.type = Self.normalizedType(decodedType, groupID: decodedGroupID, id: decodedID)
        self.groupID = decodedGroupID
        self.id = decodedID
        self.name = container.flexString(for: .name)
            ?? container.flexString(for: .title)
            ?? decodedID
        self.avatarURL = container.flexString(for: .avatarURL)
            ?? container.flexString(for: .avatarURLCamel)
            ?? container.flexString(for: .avatar)
            ?? ""
        self.lastMessage = container.flexContent(for: .lastMessage)
            ?? container.flexContent(for: .lastMessageCamel)
        self.lastMessageTime = container.flexString(for: .lastMessageTime)
            ?? container.flexString(for: .lastMessageTimeCamel)
        self.unreadCount = container.flexInt(for: .unreadCount)
            ?? container.flexInt(for: .unread)
            ?? container.flexInt(for: .unreadCountCamel)
            ?? 0
        self.subtitle = container.flexString(for: .subtitle)
        self.memberCount = container.flexInt(for: .memberCount)
            ?? container.flexInt(for: .memberCountCamel)
        self.conversationKind = container.flexString(for: .conversationKind)
            ?? container.flexString(for: .conversationKindCamel)
        self.scriptRoomID = container.flexString(for: .scriptRoomID)
            ?? container.flexString(for: .scriptRoomIDCamel)
        self.scriptID = container.flexString(for: .scriptID)
            ?? container.flexString(for: .scriptIDCamel)
        self.agentConversationID = container.flexString(for: .agentConversationID)
            ?? container.flexString(for: .agentConversationIDCamel)
        self.agentID = container.flexString(for: .agentID)
            ?? container.flexString(for: .agentIDCamel)
        self.agentAvatarAssetID = container.flexString(for: .agentAvatarAssetID)
            ?? container.flexString(for: .agentAvatarAssetIDCamel)
        self.agentGreetingID = container.flexString(for: .agentGreetingID)
            ?? container.flexString(for: .agentGreetingIDCamel)
        self.lastMessageID = container.flexInt(for: .lastMessageID)
            ?? container.flexInt(for: .lastMessageIDCamel)
        self.readThroughMessageID = container.flexInt(for: .readThroughMessageID)
            ?? container.flexInt(for: .readThroughMessageIDCamel)
        if let integer = try? container.decodeIfPresent(Int64.self, forKey: .revision) {
            self.revision = integer
        } else if let number = container.flexInt(for: .revision) {
            self.revision = Int64(number)
        } else {
            self.revision = nil
        }
        self.isMuted = container.flexBool(for: .isMuted)
            ?? container.flexBool(for: .isMutedCamel)
            ?? false
        self.serverIsPinned = container.flexBool(for: .serverIsPinned)
            ?? container.flexBool(for: .serverIsPinnedCamel)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encode(avatarURL, forKey: .avatarURL)
        try container.encodeIfPresent(lastMessage, forKey: .lastMessage)
        try container.encodeIfPresent(lastMessageTime, forKey: .lastMessageTime)
        try container.encode(unreadCount, forKey: .unreadCount)
        try container.encodeIfPresent(subtitle, forKey: .subtitle)
        try container.encodeIfPresent(groupID, forKey: .groupID)
        try container.encodeIfPresent(memberCount, forKey: .memberCount)
        try container.encodeIfPresent(conversationKind, forKey: .conversationKind)
        try container.encodeIfPresent(scriptRoomID, forKey: .scriptRoomID)
        try container.encodeIfPresent(scriptID, forKey: .scriptID)
        try container.encodeIfPresent(agentConversationID, forKey: .agentConversationID)
        try container.encodeIfPresent(agentID, forKey: .agentID)
        try container.encodeIfPresent(agentAvatarAssetID, forKey: .agentAvatarAssetID)
        try container.encodeIfPresent(agentGreetingID, forKey: .agentGreetingID)
        try container.encodeIfPresent(lastMessageID, forKey: .lastMessageID)
        try container.encodeIfPresent(readThroughMessageID, forKey: .readThroughMessageID)
        try container.encodeIfPresent(revision, forKey: .revision)
        try container.encode(isMuted, forKey: .isMuted)
        try container.encodeIfPresent(serverIsPinned, forKey: .serverIsPinned)
    }

    var normalizedType: String {
        Self.normalizedType(type, groupID: groupID, id: id)
    }

    var isDM: Bool { normalizedType == "dm" }
    var isGroup: Bool { normalizedType == "group" }
    var isAgentConversation: Bool { normalizedType == "agent" }
    var isAgentChatThread: Bool {
        guard isAgentConversation else { return false }
        if let agentConversationID, !agentConversationID.isBlank { return true }
        return conversationKind?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_") == "agent_conversation"
    }
    var isScriptRoom: Bool {
        conversationKind?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_") == "script_room"
            && scriptRoomID?.isEmpty == false
    }

    var resolvedGroupID: Int? {
        guard isGroup else { return nil }
        if let groupID { return groupID }
        if let direct = Int(id) { return direct }
        let digits = id
            .split { !$0.isNumber }
            .last
            .flatMap { Int($0) }
        return digits
    }

    var listIdentity: String {
        if isAgentConversation {
            if let agentConversationID, !agentConversationID.isEmpty {
                return "agent:\(agentConversationID)"
            }
            // Older cached rows predate agent_conversation_id persistence.
            // Their row id is already the remote conversation id, so retain
            // the same stable identity after restoring from SQLite.
            if isAgentChatThread {
                return "agent:\(id)"
            }
            return "agent-profile:\(agentID ?? id)"
        }
        if isGroup {
            return "group:\(resolvedGroupID.map(String.init) ?? id)"
        }
        return "dm:\(id)"
    }

    func replacingAvatarURL(_ newAvatarURL: String) -> Conversation {
        Conversation(
            type: type,
            id: id,
            name: name,
            avatarURL: newAvatarURL,
            lastMessage: lastMessage,
            lastMessageTime: lastMessageTime,
            unreadCount: unreadCount,
            subtitle: subtitle,
            groupID: groupID,
            memberCount: memberCount,
            conversationKind: conversationKind,
            scriptRoomID: scriptRoomID,
            scriptID: scriptID,
            agentConversationID: agentConversationID,
            agentID: agentID,
            agentAvatarAssetID: agentAvatarAssetID,
            agentGreetingID: agentGreetingID,
            lastMessageID: lastMessageID,
            readThroughMessageID: readThroughMessageID,
            revision: revision,
            isMuted: isMuted,
            serverIsPinned: serverIsPinned
        )
    }

    func replacingName(_ newName: String) -> Conversation {
        Conversation(
            type: type,
            id: id,
            name: newName,
            avatarURL: avatarURL,
            lastMessage: lastMessage,
            lastMessageTime: lastMessageTime,
            unreadCount: unreadCount,
            subtitle: subtitle,
            groupID: groupID,
            memberCount: memberCount,
            conversationKind: conversationKind,
            scriptRoomID: scriptRoomID,
            scriptID: scriptID,
            agentConversationID: agentConversationID,
            agentID: agentID,
            agentAvatarAssetID: agentAvatarAssetID,
            agentGreetingID: agentGreetingID,
            lastMessageID: lastMessageID,
            readThroughMessageID: readThroughMessageID,
            revision: revision,
            isMuted: isMuted,
            serverIsPinned: serverIsPinned
        )
    }

    var formattedTime: String {
        TimestampHelper.formatListTime(lastMessageTime)
    }

    /// Compares message timestamps by their actual date whenever possible.
    /// The API has historically returned both ISO-8601 and SQL-style strings,
    /// so raw string comparison can put an older conversation above a newer one.
    static func compareMessageTimes(_ lhs: String?, _ rhs: String?) -> ComparisonResult {
        let left = lhs?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let right = rhs?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        if left == right { return .orderedSame }
        if left.isEmpty { return .orderedAscending }
        if right.isEmpty { return .orderedDescending }

        if let leftDate = TimestampHelper.parse(left),
           let rightDate = TimestampHelper.parse(right) {
            return leftDate.compare(rightDate)
        }

        return left.compare(right, options: [.numeric, .literal])
    }

    private static func normalizedType(_ rawType: String?, groupID: Int?, id: String) -> String {
        let normalized = rawType?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_") ?? ""
        if normalized == "group"
            || normalized == "group_chat"
            || normalized == "groupchat"
            || normalized == "room" {
            return "group"
        }
        if normalized == "dm"
            || normalized == "direct"
            || normalized == "direct_message"
            || normalized == "private"
            || normalized == "private_chat" {
            return "dm"
        }
        if normalized == "agent"
            || normalized == "agent_chat"
            || normalized == "agent_conversation"
            || normalized == "agent_profile" {
            return "agent"
        }
        if groupID != nil || id.hasPrefix("group_") || id.hasPrefix("group:") {
            return "group"
        }
        return "dm"
    }
}

struct ConversationPreference: Codable, Equatable, Sendable {
    let conversationType: String
    let targetID: String
    let isPinned: Bool
    let isHidden: Bool
    let revision: Int64
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case conversationType = "conversation_type"
        case targetID = "target_id"
        case isPinned = "is_pinned"
        case isHidden = "is_hidden"
        case revision
        case updatedAt = "updated_at"
    }

    init(
        conversationType: String,
        targetID: String,
        isPinned: Bool,
        isHidden: Bool = false,
        revision: Int64 = 0,
        updatedAt: String? = nil
    ) {
        self.conversationType = conversationType
        self.targetID = targetID
        self.isPinned = isPinned
        self.isHidden = isHidden
        self.revision = revision
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        conversationType = container.flexString(for: .conversationType) ?? ""
        targetID = container.flexString(for: .targetID) ?? ""
        isPinned = container.flexBool(for: .isPinned) ?? false
        isHidden = container.flexBool(for: .isHidden) ?? false
        if let decoded = try? container.decodeIfPresent(Int64.self, forKey: .revision) {
            revision = decoded
        } else {
            revision = Int64(container.flexInt(for: .revision) ?? 0)
        }
        updatedAt = container.flexString(for: .updatedAt)
    }
}

@MainActor
final class ConversationPreferenceStore: ObservableObject {
    static let shared = ConversationPreferenceStore()

    @Published private(set) var pinnedKeys: Set<String> = []
    @Published private(set) var updatingKeys: Set<String> = []

    private let defaults: UserDefaults
    private var scopeID: String
    private var revisionsByKey: [String: Int64] = [:]

    private init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        scopeID = Self.currentScopeID
        pinnedKeys = Self.loadAndMigrate(defaults: defaults, scopeID: scopeID)
    }

    func isPinned(_ conversation: Conversation) -> Bool {
        syncScopeIfNeeded()
        return pinnedKeys.contains(conversation.listIdentity)
    }

    func isPinned(groupID: Int) -> Bool {
        syncScopeIfNeeded()
        return pinnedKeys.contains(ConversationReadTarget.group(groupID: groupID).listIdentity)
    }

    func isUpdating(groupID: Int) -> Bool {
        updatingKeys.contains(ConversationReadTarget.group(groupID: groupID).listIdentity)
    }

    @discardableResult
    func setPinnedLocally(_ conversation: Conversation, isPinned: Bool) -> Bool {
        syncScopeIfNeeded()
        let key = conversation.listIdentity
        let previous = pinnedKeys.contains(key)
        if isPinned { pinnedKeys.insert(key) } else { pinnedKeys.remove(key) }
        persist()
        return previous
    }

    func applyServerSnapshot(_ conversations: [Conversation]) {
        syncScopeIfNeeded()
        var changed = false
        for conversation in conversations {
            guard let isPinned = conversation.serverIsPinned else { continue }
            let key = conversation.listIdentity
            if isPinned {
                changed = pinnedKeys.insert(key).inserted || changed
            } else {
                changed = pinnedKeys.remove(key) != nil || changed
            }
            if let revision = conversation.revision {
                revisionsByKey[key] = max(revisionsByKey[key] ?? 0, revision)
            }
        }
        if changed { persist() }
    }

    func apply(_ preference: ConversationPreference) {
        syncScopeIfNeeded()
        let key = Self.key(type: preference.conversationType, targetID: preference.targetID)
        guard !key.isEmpty, preference.revision >= (revisionsByKey[key] ?? 0) else { return }
        revisionsByKey[key] = preference.revision
        if preference.isPinned {
            pinnedKeys.insert(key)
        } else {
            pinnedKeys.remove(key)
        }
        persist()
    }

    @discardableResult
    func setPinned(
        _ conversation: Conversation,
        isPinned: Bool,
        optimisticPrevious: Bool? = nil
    ) async throws -> ConversationPreference {
        let type = conversation.normalizedType
        let targetID: String
        if type == "group" {
            targetID = conversation.resolvedGroupID.map(String.init) ?? conversation.id
        } else {
            targetID = conversation.id
        }
        return try await setPinned(
            type: type,
            targetID: targetID,
            isPinned: isPinned,
            optimisticPrevious: optimisticPrevious
        )
    }

    @discardableResult
    func setPinned(
        type: String,
        targetID: String,
        isPinned: Bool,
        optimisticPrevious: Bool? = nil
    ) async throws -> ConversationPreference {
        syncScopeIfNeeded()
        let normalizedType = type.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let key = Self.key(type: normalizedType, targetID: targetID)
        guard !key.isEmpty else {
            throw APIError.invalidURL
        }
        while updatingKeys.contains(key) {
            try Task.checkCancellation()
            await Task.yield()
        }

        let wasPinned = optimisticPrevious ?? pinnedKeys.contains(key)
        if optimisticPrevious == nil {
            if isPinned { pinnedKeys.insert(key) } else { pinnedKeys.remove(key) }
        } else if pinnedKeys.contains(key) != isPinned {
            return ConversationPreference(
                conversationType: normalizedType,
                targetID: targetID,
                isPinned: pinnedKeys.contains(key),
                revision: revisionsByKey[key] ?? 0
            )
        }
        updatingKeys.insert(key)
        persist()
        defer { updatingKeys.remove(key) }

        let local = ConversationPreference(
            conversationType: normalizedType,
            targetID: targetID,
            isPinned: isPinned,
            revision: revisionsByKey[key] ?? 0
        )
        let supportsRemote = ["dm", "group"].contains(normalizedType)
            && AppRemoteConfigStore.shared.featureFlags.isEnabled(
                "conversation_preferences_v1",
                default: false
            )
        guard supportsRemote else { return local }

        do {
            let remote = try await APIService.shared.updateConversationPreference(
                conversationType: normalizedType,
                targetID: targetID,
                isPinned: isPinned
            )
            apply(remote)
            return remote
        } catch {
            if pinnedKeys.contains(key) == isPinned {
                if wasPinned { pinnedKeys.insert(key) } else { pinnedKeys.remove(key) }
                persist()
            }
            throw error
        }
    }

    func clearPinnedLocally(_ conversation: Conversation) {
        syncScopeIfNeeded()
        pinnedKeys.remove(conversation.listIdentity)
        persist()
    }

    func resetForCurrentAccount() {
        scopeID = Self.currentScopeID
        pinnedKeys = Self.loadAndMigrate(defaults: defaults, scopeID: scopeID)
        revisionsByKey.removeAll()
        updatingKeys.removeAll()
    }

    private func syncScopeIfNeeded() {
        let current = Self.currentScopeID
        guard current != scopeID else { return }
        scopeID = current
        pinnedKeys = Self.loadAndMigrate(defaults: defaults, scopeID: current)
        revisionsByKey.removeAll()
        updatingKeys.removeAll()
    }

    private func persist() {
        defaults.set(Array(pinnedKeys), forKey: Self.storageKey(scopeID: scopeID))
    }

    static func loadAndMigrate(defaults: UserDefaults, scopeID: String) -> Set<String> {
        let storage = storageKey(scopeID: scopeID)
        if let values = defaults.stringArray(forKey: storage) {
            return Set(values)
        }
        let legacyKey = "bbchat.conversationList.pinned.\(scopeID)"
        let migrated = Set(defaults.stringArray(forKey: legacyKey) ?? [])
        defaults.set(Array(migrated), forKey: storage)
        defaults.removeObject(forKey: legacyKey)
        return migrated
    }

    private static var currentScopeID: String {
        let value = AuthManager.shared.currentUser?.userID
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? "anonymous" : value
    }

    private static func storageKey(scopeID: String) -> String {
        "bbchat.conversation.preferences.v1.\(scopeID)"
    }

    private static func key(type: String, targetID: String) -> String {
        let normalizedType = type.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedID = targetID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedType.isEmpty, !normalizedID.isEmpty else { return "" }
        if normalizedType == "group" { return "group:\(normalizedID)" }
        if normalizedType == "dm" { return "dm:\(normalizedID)" }
        return "\(normalizedType):\(normalizedID)"
    }
}

extension Conversation {
    init(agentConversation: AgentConversation) {
        let preview = AgentConversationPreviewResolver.text(
            for: agentConversation.latestMessage,
            fallback: agentConversation.title
        )
        self.init(
            type: "agent",
            id: agentConversation.id,
            name: agentConversation.agentProfile.name,
            avatarURL: "",
            lastMessage: preview.isBlank ? nil : preview,
            lastMessageTime: agentConversation.latestMessage?.updatedAt ?? agentConversation.updatedAt,
            unreadCount: 0,
            subtitle: nil,
            groupID: nil,
            memberCount: nil,
            conversationKind: "agent_conversation",
            agentConversationID: agentConversation.id,
            agentID: agentConversation.agentID,
            agentAvatarAssetID: agentConversation.agentProfile.avatarAssetID
        )
    }

    init(createdAgent agent: AgentSummary) {
        self.init(
            type: "agent",
            id: agent.id,
            name: agent.displayName,
            avatarURL: "",
            lastMessage: agent.profile?.tagline ?? agent.profile?.description,
            lastMessageTime: nil,
            unreadCount: 0,
            subtitle: nil,
            groupID: nil,
            memberCount: nil,
            conversationKind: "agent_profile",
            agentID: agent.id,
            agentAvatarAssetID: agent.resolvedAvatarAssetID,
            agentGreetingID: agent.greetings?.first?.id
        )
    }
}

extension AgentConversation {
    /// Older installations have the lightweight list row in MessageStore but
    /// not yet a full agent snapshot. It is still sufficient to render cached
    /// history while offline; capability metadata will refresh next time the
    /// network is available.
    init?(cachedConversationRow row: Conversation) {
        guard row.isAgentChatThread,
              let conversationID = row.agentConversationID ?? (row.id.isBlank ? nil : row.id),
              let agentID = row.agentID,
              !agentID.isBlank else { return nil }

        let timestamp = row.lastMessageTime ?? ""
        self.init(
            id: conversationID,
            title: row.name,
            status: "active",
            agentID: agentID,
            agentVersionID: "",
            agentProfile: AgentProfile(
                name: row.name,
                tagline: row.lastMessage,
                avatarAssetID: row.agentAvatarAssetID
            ),
            agentCapabilities: AgentCapabilities(),
            latestMessage: nil,
            createdAt: timestamp,
            updatedAt: timestamp
        )
    }
}
