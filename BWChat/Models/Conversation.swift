import Foundation

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
        agentGreetingID: String? = nil
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
    }

    var normalizedType: String {
        Self.normalizedType(type, groupID: groupID, id: id)
    }

    var isDM: Bool { normalizedType == "dm" }
    var isGroup: Bool { normalizedType == "group" }
    var isAgentConversation: Bool { normalizedType == "agent" }
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
            agentGreetingID: agentGreetingID
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

extension Conversation {
    init(agentConversation: AgentConversation) {
        let preview = agentConversation.latestMessage?.orderedParts
            .first(where: { $0.type == "text" && !$0.text.isBlank })?.text
            ?? agentConversation.title
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
