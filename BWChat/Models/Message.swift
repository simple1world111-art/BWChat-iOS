// BWChat/Models/Message.swift
// Data model for chat messages

import Foundation

struct ReplyPreview: Codable, Equatable {
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

struct Message: Codable, Identifiable, Equatable {
    let id: Int
    let senderID: String
    let receiverID: String
    let msgType: String
    let content: String
    let timestamp: String
    let replyToID: Int?
    let replyTo: ReplyPreview?

    enum CodingKeys: String, CodingKey {
        case id
        case messageID = "message_id"
        case messageId = "messageId"
        case senderID = "sender_id"
        case senderId = "senderId"
        case fromUserID = "from_user_id"
        case fromUserId = "fromUserId"
        case userID = "user_id"
        case receiverID = "receiver_id"
        case receiverId = "receiverId"
        case recipientID = "recipient_id"
        case recipientId = "recipientId"
        case toUserID = "to_user_id"
        case toUserId = "toUserId"
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
        case replyToID = "reply_to_id"
        case replyToId = "replyToId"
        case replyTo = "reply_to"
        case replyToCamel = "replyTo"
    }

    init(
        id: Int,
        senderID: String,
        receiverID: String,
        msgType: String,
        content: String,
        timestamp: String,
        replyToID: Int?,
        replyTo: ReplyPreview?
    ) {
        self.id = id
        self.senderID = senderID
        self.receiverID = receiverID
        self.msgType = msgType
        self.content = content
        self.timestamp = timestamp
        self.replyToID = replyToID
        self.replyTo = replyTo
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

        self.id = container.flexInt(for: .id)
            ?? container.flexInt(for: .messageID)
            ?? container.flexInt(for: .messageId)
            ?? 0
        self.senderID = container.flexString(for: .senderID)
            ?? container.flexString(for: .senderId)
            ?? container.flexString(for: .fromUserID)
            ?? container.flexString(for: .fromUserId)
            ?? container.flexString(for: .userID)
            ?? ""
        self.receiverID = container.flexString(for: .receiverID)
            ?? container.flexString(for: .receiverId)
            ?? container.flexString(for: .recipientID)
            ?? container.flexString(for: .recipientId)
            ?? container.flexString(for: .toUserID)
            ?? container.flexString(for: .toUserId)
            ?? ""
        self.msgType = decodedType
        self.content = decodedContent
        self.timestamp = container.flexString(for: .timestamp)
            ?? container.flexString(for: .createdAt)
            ?? container.flexString(for: .createdAtCamel)
            ?? container.flexString(for: .time)
            ?? ISO8601DateFormatter().string(from: Date())
        self.replyToID = container.flexInt(for: .replyToID)
            ?? container.flexInt(for: .replyToId)
        self.replyTo = (try? container.decodeIfPresent(ReplyPreview.self, forKey: .replyTo))
            ?? (try? container.decodeIfPresent(ReplyPreview.self, forKey: .replyToCamel))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(senderID, forKey: .senderID)
        try container.encode(receiverID, forKey: .receiverID)
        try container.encode(msgType, forKey: .msgType)
        try container.encode(content, forKey: .content)
        try container.encode(timestamp, forKey: .timestamp)
        try container.encodeIfPresent(replyToID, forKey: .replyToID)
        try container.encodeIfPresent(replyTo, forKey: .replyTo)
    }

    var isImage: Bool {
        msgType == "image"
    }

    var isVideo: Bool {
        msgType == "video"
    }

    var isVoice: Bool {
        msgType == "voice"
    }

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

/// Used for optimistic UI updates before server confirms
struct PendingMessage: Identifiable {
    let id: UUID = UUID()
    let createdAt: Date = Date()
    let receiverID: String
    let msgType: String
    let content: String
    let imageData: Data?
    let videoData: Data?
    let voiceData: Data?
    let voiceDuration: Double
    let filename: String?
    let replyToID: Int?
    var status: SendStatus = .sending

    enum SendStatus {
        case sending
        case sent
        case failed
    }

    init(
        receiverID: String,
        msgType: String,
        content: String,
        imageData: Data? = nil,
        videoData: Data? = nil,
        voiceData: Data? = nil,
        voiceDuration: Double = 0,
        filename: String? = nil,
        replyToID: Int? = nil
    ) {
        self.receiverID = receiverID
        self.msgType = msgType
        self.content = content
        self.imageData = imageData
        self.videoData = videoData
        self.voiceData = voiceData
        self.voiceDuration = voiceDuration
        self.filename = filename
        self.replyToID = replyToID
    }

    var formattedTime: String {
        TimestampHelper.formatTime(createdAt)
    }
}

enum MessageDeliveryMatcher {
    static func normalizedType(_ value: String) -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch normalized {
        case "photo", "picture": return "image"
        case "audio": return "voice"
        case "emoji": return "text"
        default: return normalized
        }
    }

    /// Compares the content carried by HTTP and WebSocket confirmations for
    /// one already source-correlated outgoing operation.
    static func contentsMatch(
        type rawType: String,
        lhs: String,
        rhs: String
    ) -> Bool {
        let type = normalizedType(rawType)
        if type == "gift",
           let leftGift = GiftMessagePayload.parse(lhs),
           let rightGift = GiftMessagePayload.parse(rhs) {
            return leftGift.giftID == rightGift.giftID
                && leftGift.recipientID == rightGift.recipientID
        }

        // Upload paths commonly return absolute and relative URLs for the
        // same stored asset. The caller must additionally require matching
        // sender, destination, type, reply target, source and timestamp.
        if type == "image" || type == "video" || type == "voice" {
            return true
        }

        return lhs == rhs
    }
}
