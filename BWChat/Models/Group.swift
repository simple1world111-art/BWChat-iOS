// BWChat/Models/Group.swift
// Data model for group chats

import Foundation

struct ChatGroup: Codable, Identifiable, Equatable, Hashable {
    let groupID: Int
    let name: String
    let avatarURL: String
    let creatorID: String
    let memberCount: Int
    let lastMessage: String?
    let lastMessageTime: String?
    let lastMessageSender: String?
    let unreadCount: Int
    let isPublic: Bool

    var id: Int { groupID }

    enum CodingKeys: String, CodingKey {
        case groupID = "group_id"
        case name
        case avatarURL = "avatar_url"
        case creatorID = "creator_id"
        case memberCount = "member_count"
        case lastMessage = "last_message"
        case lastMessageTime = "last_message_time"
        case lastMessageSender = "last_message_sender"
        case unreadCount = "unread_count"
        case isPublic = "is_public"
    }

    enum AlternateCodingKeys: String, CodingKey {
        case isPublic = "isPublic"
    }

    init(
        groupID: Int,
        name: String,
        avatarURL: String,
        creatorID: String,
        memberCount: Int,
        lastMessage: String?,
        lastMessageTime: String?,
        lastMessageSender: String?,
        unreadCount: Int,
        isPublic: Bool = false
    ) {
        self.groupID = groupID
        self.name = name
        self.avatarURL = avatarURL
        self.creatorID = creatorID
        self.memberCount = memberCount
        self.lastMessage = lastMessage
        self.lastMessageTime = lastMessageTime
        self.lastMessageSender = lastMessageSender
        self.unreadCount = unreadCount
        self.isPublic = isPublic
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let alternateContainer = try decoder.container(keyedBy: AlternateCodingKeys.self)

        self.groupID = try container.decode(Int.self, forKey: .groupID)
        self.name = try container.decode(String.self, forKey: .name)
        self.avatarURL = try container.decode(String.self, forKey: .avatarURL)
        self.creatorID = try container.decode(String.self, forKey: .creatorID)
        self.memberCount = try container.decode(Int.self, forKey: .memberCount)
        self.lastMessage = try container.decodeIfPresent(String.self, forKey: .lastMessage)
        self.lastMessageTime = try container.decodeIfPresent(String.self, forKey: .lastMessageTime)
        self.lastMessageSender = try container.decodeIfPresent(String.self, forKey: .lastMessageSender)
        self.unreadCount = try container.decode(Int.self, forKey: .unreadCount)
        self.isPublic = container.flexBool(for: .isPublic)
            ?? alternateContainer.flexBool(for: .isPublic)
            ?? false
    }

    var formattedTime: String {
        TimestampHelper.formatListTime(lastMessageTime)
    }
}

struct GroupDetail: Codable, Equatable {
    let groupID: Int
    let name: String
    let avatarURL: String
    let creatorID: String
    let members: [GroupMember]
    var isPublic: Bool

    enum CodingKeys: String, CodingKey {
        case groupID = "group_id"
        case name
        case avatarURL = "avatar_url"
        case creatorID = "creator_id"
        case members
        case isPublic = "is_public"
    }

    enum AlternateCodingKeys: String, CodingKey {
        case isPublic = "isPublic"
    }

    init(
        groupID: Int,
        name: String,
        avatarURL: String,
        creatorID: String,
        members: [GroupMember],
        isPublic: Bool = false
    ) {
        self.groupID = groupID
        self.name = name
        self.avatarURL = avatarURL
        self.creatorID = creatorID
        self.members = members
        self.isPublic = isPublic
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let alternateContainer = try decoder.container(keyedBy: AlternateCodingKeys.self)

        self.groupID = try container.decode(Int.self, forKey: .groupID)
        self.name = try container.decode(String.self, forKey: .name)
        self.avatarURL = try container.decode(String.self, forKey: .avatarURL)
        self.creatorID = try container.decode(String.self, forKey: .creatorID)
        self.members = try container.decode([GroupMember].self, forKey: .members)
        self.isPublic = container.flexBool(for: .isPublic)
            ?? alternateContainer.flexBool(for: .isPublic)
            ?? false
    }
}

struct GroupMember: Codable, Identifiable, Equatable, Hashable {
    let userID: String
    let nickname: String
    let avatarURL: String
    let role: String

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case role
    }
}

struct GroupReplyPreview: Codable, Equatable {
    let id: Int
    let senderID: String
    let msgType: String
    let content: String

    enum CodingKeys: String, CodingKey {
        case id
        case senderID = "sender_id"
        case msgType = "msg_type"
        case content
    }
}

struct GroupMessage: Codable, Identifiable, Equatable {
    let id: Int
    let groupID: Int
    let senderID: String
    let msgType: String
    let content: String
    let timestamp: String
    let senderNickname: String
    let senderAvatar: String
    let replyToID: Int?
    let replyTo: GroupReplyPreview?
    let mentions: [String]?
    let clientMessageID: String?

    enum CodingKeys: String, CodingKey {
        case id
        case messageID = "message_id"
        case messageId = "messageId"
        case msgID = "msg_id"
        case msgId = "msgId"
        case groupID = "group_id"
        case groupId = "groupId"
        case senderID = "sender_id"
        case senderId = "senderId"
        case fromUserID = "from_user_id"
        case fromUserId = "fromUserId"
        case userID = "user_id"
        case msgType = "msg_type"
        case msgTypeCamel = "msgType"
        case messageType = "message_type"
        case type
        case content
        case gift
        case payload
        case timestamp
        case createdAt = "created_at"
        case createdAtCamel = "createdAt"
        case time
        case senderNickname = "sender_nickname"
        case senderNicknameCamel = "senderNickname"
        case nickname
        case senderAvatar = "sender_avatar"
        case senderAvatarCamel = "senderAvatar"
        case avatarURL = "avatar_url"
        case replyToID = "reply_to_id"
        case replyToId = "replyToId"
        case replyTo = "reply_to"
        case replyToCamel = "replyTo"
        case mentions
        case clientMessageID = "client_message_id"
        case clientMessageId = "clientMessageId"
        case clientID = "client_id"
        case clientId = "clientId"
    }

    init(
        id: Int,
        groupID: Int,
        senderID: String,
        msgType: String,
        content: String,
        timestamp: String,
        senderNickname: String,
        senderAvatar: String,
        replyToID: Int?,
        replyTo: GroupReplyPreview?,
        mentions: [String]?,
        clientMessageID: String? = nil
    ) {
        self.id = id
        self.groupID = groupID
        self.senderID = senderID
        self.msgType = msgType
        self.content = content
        self.timestamp = timestamp
        self.senderNickname = senderNickname
        self.senderAvatar = senderAvatar
        self.replyToID = replyToID
        self.replyTo = replyTo
        self.mentions = mentions
        self.clientMessageID = clientMessageID
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedContent = container.flexContent(for: .content)
            ?? container.flexContent(for: .payload)
            ?? container.flexContent(for: .gift)
            ?? ""
        let decodedType = container.flexString(for: .msgType)
            ?? container.flexString(for: .msgTypeCamel)
            ?? container.flexString(for: .messageType)
            ?? container.flexString(for: .type)
            ?? (GiftMessagePayload.parse(decodedContent) == nil ? "text" : "gift")
        let decodedSenderID = container.flexString(for: .senderID)
            ?? container.flexString(for: .senderId)
            ?? container.flexString(for: .fromUserID)
            ?? container.flexString(for: .fromUserId)
            ?? container.flexString(for: .userID)
            ?? ""

        self.id = container.flexInt(for: .id)
            ?? container.flexInt(for: .messageID)
            ?? container.flexInt(for: .messageId)
            ?? container.flexInt(for: .msgID)
            ?? container.flexInt(for: .msgId)
            ?? 0
        self.groupID = container.flexInt(for: .groupID)
            ?? container.flexInt(for: .groupId)
            ?? 0
        self.senderID = decodedSenderID
        self.msgType = decodedType
        self.content = decodedContent
        self.timestamp = container.flexString(for: .timestamp)
            ?? container.flexString(for: .createdAt)
            ?? container.flexString(for: .createdAtCamel)
            ?? container.flexString(for: .time)
            ?? ISO8601DateFormatter().string(from: Date())
        self.senderNickname = container.flexString(for: .senderNickname)
            ?? container.flexString(for: .senderNicknameCamel)
            ?? container.flexString(for: .nickname)
            ?? decodedSenderID
        self.senderAvatar = container.flexString(for: .senderAvatar)
            ?? container.flexString(for: .senderAvatarCamel)
            ?? container.flexString(for: .avatarURL)
            ?? ""
        self.replyToID = container.flexInt(for: .replyToID)
            ?? container.flexInt(for: .replyToId)
        self.replyTo = (try? container.decodeIfPresent(GroupReplyPreview.self, forKey: .replyTo))
            ?? (try? container.decodeIfPresent(GroupReplyPreview.self, forKey: .replyToCamel))
        self.mentions = container.flexStringArray(for: .mentions)
        self.clientMessageID = container.flexString(for: .clientMessageID)
            ?? container.flexString(for: .clientMessageId)
            ?? container.flexString(for: .clientID)
            ?? container.flexString(for: .clientId)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(groupID, forKey: .groupID)
        try container.encode(senderID, forKey: .senderID)
        try container.encode(msgType, forKey: .msgType)
        try container.encode(content, forKey: .content)
        try container.encode(timestamp, forKey: .timestamp)
        try container.encode(senderNickname, forKey: .senderNickname)
        try container.encode(senderAvatar, forKey: .senderAvatar)
        try container.encodeIfPresent(replyToID, forKey: .replyToID)
        try container.encodeIfPresent(replyTo, forKey: .replyTo)
        try container.encodeIfPresent(mentions, forKey: .mentions)
        try container.encodeIfPresent(clientMessageID, forKey: .clientMessageID)
    }

    var isImage: Bool { msgType == "image" }
    var isVideo: Bool { msgType == "video" }
    var isVoice: Bool { msgType == "voice" }
    var isSystem: Bool { msgType == "system" }

    var voiceURL: String? {
        guard isVoice else { return nil }
        return content.components(separatedBy: "|").first
    }

    var voiceDuration: Double {
        guard isVoice, let durStr = content.components(separatedBy: "|").last else { return 0 }
        return Double(durStr) ?? 0
    }

    var formattedTime: String {
        TimestampHelper.formatTime(timestamp)
    }
}
