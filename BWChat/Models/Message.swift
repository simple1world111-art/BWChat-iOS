// BWChat/Models/Message.swift
// Data model for chat messages

import Foundation

enum ChatMessageRecallState {
    static let recalledMessageType = "recalled"

    static func normalizedType(
        messageType: String,
        status: String?,
        isRecalled: Bool?,
        recalledAt: String?
    ) -> String {
        let normalizedType = messageType.lowercased().replacingOccurrences(of: "-", with: "_")
        let normalizedStatus = status?.lowercased().replacingOccurrences(of: "-", with: "_")
        let recallValues = ["recall", "recalled", "withdrawn", "revoked", "message_recalled"]
        if isRecalled == true
            || recalledAt != nil
            || recallValues.contains(normalizedType)
            || normalizedStatus.map(recallValues.contains) == true {
            return recalledMessageType
        }
        return messageType
    }

    static func isRecalledPreview(messageType: String?, content: String?) -> Bool {
        let normalizedType = messageType?
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")
        let recallValues = [recalledMessageType, "recall", "withdrawn", "revoked", "message_recalled"]
        if normalizedType.map({ recallValues.contains($0) }) == true { return true }
        return normalizedType == "system"
            && (content ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    static func notice(
        senderID: String?,
        viewerID: String?,
        senderName: String?
    ) -> String {
        if let senderID, senderID == viewerID {
            return L10n.tr("chat.recall.selfNotice")
        }
        let trimmedName = senderName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayName = trimmedName.flatMap { $0.isEmpty ? nil : $0 }
            ?? L10n.tr("chat.recall.someone")
        return L10n.tr(
            "chat.recall.otherNotice",
            displayName
        )
    }
}

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
    let clientMessageID: String?
    let version: Int
    let updatedAt: String?
    /// Server-generated lightweight preview. `content` remains the original
    /// media URL opened by the full-screen viewer.
    let thumbnailURL: String?

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
        case clientMessageID = "client_message_id"
        case clientMessageId = "clientMessageId"
        case clientID = "client_id"
        case version
        case updatedAt = "updated_at"
        case thumbnailURL = "thumbnail_url"
        case thumbnailURLCamel = "thumbnailURL"
        case previewURL = "preview_url"
        case previewURLCamel = "previewURL"
        case status
        case isRecalled = "is_recalled"
        case isRecalledCamel = "isRecalled"
        case recalledAt = "recalled_at"
        case recalledAtCamel = "recalledAt"
    }

    init(
        id: Int,
        senderID: String,
        receiverID: String,
        msgType: String,
        content: String,
        timestamp: String,
        replyToID: Int?,
        replyTo: ReplyPreview?,
        clientMessageID: String? = nil,
        version: Int = 1,
        updatedAt: String? = nil,
        thumbnailURL: String?
    ) {
        self.id = id
        self.senderID = senderID
        self.receiverID = receiverID
        self.msgType = msgType
        self.content = content
        self.timestamp = timestamp
        self.replyToID = replyToID
        self.replyTo = replyTo
        self.clientMessageID = clientMessageID
        self.version = version
        self.updatedAt = updatedAt
        self.thumbnailURL = thumbnailURL?.chatMediaNonEmpty
    }

    init(
        id: Int,
        senderID: String,
        receiverID: String,
        msgType: String,
        content: String,
        timestamp: String,
        replyToID: Int?,
        replyTo: ReplyPreview?,
        clientMessageID: String? = nil,
        version: Int = 1,
        updatedAt: String? = nil
    ) {
        self.init(
            id: id,
            senderID: senderID,
            receiverID: receiverID,
            msgType: msgType,
            content: content,
            timestamp: timestamp,
            replyToID: replyToID,
            replyTo: replyTo,
            clientMessageID: clientMessageID,
            version: version,
            updatedAt: updatedAt,
            thumbnailURL: nil
        )
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
        let recalledAt = container.flexString(for: .recalledAt)
            ?? container.flexString(for: .recalledAtCamel)
        self.msgType = ChatMessageRecallState.normalizedType(
            messageType: decodedType,
            status: container.flexString(for: .status),
            isRecalled: container.flexBool(for: .isRecalled)
                ?? container.flexBool(for: .isRecalledCamel),
            recalledAt: recalledAt
        )
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
        self.clientMessageID = container.flexString(for: .clientMessageID)
            ?? container.flexString(for: .clientMessageId)
            ?? container.flexString(for: .clientID)
        self.version = container.flexInt(for: .version) ?? 1
        self.updatedAt = container.flexString(for: .updatedAt)
        self.thumbnailURL = (
            container.flexString(for: .thumbnailURL)
                ?? container.flexString(for: .thumbnailURLCamel)
                ?? container.flexString(for: .previewURL)
                ?? container.flexString(for: .previewURLCamel)
        )?.chatMediaNonEmpty
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
        try container.encodeIfPresent(clientMessageID, forKey: .clientMessageID)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
        try container.encodeIfPresent(thumbnailURL, forKey: .thumbnailURL)
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

    var isRecalled: Bool {
        msgType == ChatMessageRecallState.recalledMessageType
            || (isSystem && content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    var callRecord: CallRecordContent? {
        CallRecordContent.parse(content)
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

/// One logical outgoing message keeps this identity from the first local
/// projection through HTTP/WebSocket acknowledgement. Server IDs are storage
/// identities and must not replace an already-rendered client identity.
enum ChatTimelineIdentity {
    static func resolvedClientMessageID(
        primary: String?,
        fallback: String? = nil
    ) -> String? {
        normalizedClientMessageID(primary) ?? normalizedClientMessageID(fallback)
    }

    static func value(clientMessageID: String?, serverID: Int) -> String {
        if let clientMessageID = normalizedClientMessageID(clientMessageID) {
            return "client:\(clientMessageID)"
        }
        return "server:\(serverID)"
    }

    private static func normalizedClientMessageID(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        return trimmed
    }
}

extension Message {
    /// Keeps the local timeline identity when a server event omits the echoed
    /// client_message_id. All authoritative server fields remain unchanged.
    func inheritingClientMessageID(_ fallback: String?) -> Message {
        let resolvedID = ChatTimelineIdentity.resolvedClientMessageID(
            primary: clientMessageID,
            fallback: fallback
        )
        guard resolvedID != clientMessageID else { return self }
        return Message(
            id: id,
            senderID: senderID,
            receiverID: receiverID,
            msgType: msgType,
            content: content,
            timestamp: timestamp,
            replyToID: replyToID,
            replyTo: replyTo,
            clientMessageID: resolvedID,
            version: version,
            updatedAt: updatedAt,
            thumbnailURL: thumbnailURL
        )
    }
}

/// Used for optimistic UI updates before server confirms
struct PendingMessage: Identifiable, Equatable {
    let id: UUID
    let createdAt: Date
    let receiverID: String
    let msgType: String
    let content: String
    let imageData: Data?
    let videoData: Data?
    let voiceData: Data?
    var localFileURL: URL?
    let voiceDuration: Double
    let filename: String?
    let replyToID: Int?
    var status: SendStatus = .sending

    enum SendStatus: Equatable {
        case sending
        case sent
        case failed
    }

    init(
        id: UUID = UUID(),
        createdAt: Date = Date(),
        receiverID: String,
        msgType: String,
        content: String,
        imageData: Data? = nil,
        videoData: Data? = nil,
        voiceData: Data? = nil,
        localFileURL: URL? = nil,
        voiceDuration: Double = 0,
        filename: String? = nil,
        replyToID: Int? = nil,
        status: SendStatus = .sending
    ) {
        self.id = id
        self.createdAt = createdAt
        self.receiverID = receiverID
        self.msgType = msgType
        self.content = content
        self.imageData = imageData
        self.videoData = videoData
        self.voiceData = voiceData
        self.localFileURL = localFileURL
        self.voiceDuration = voiceDuration
        self.filename = filename
        self.replyToID = replyToID
        self.status = status
    }

    var formattedTime: String {
        TimestampHelper.formatTime(createdAt)
    }
}

/// A picker result that has been fully imported before it is published to a
/// conversation timeline. Keeping the whole selection as one batch prevents
/// large photos from appearing one-by-one while PhotosUI is still decoding the
/// remaining items.
struct OutgoingMediaDraft: Sendable {
    enum Kind: Sendable {
        case image
        case video
    }

    let id: UUID
    let kind: Kind
    let data: Data?
    let localFileURL: URL?
    let filename: String

    init(
        id: UUID = UUID(),
        kind: Kind,
        data: Data,
        filename: String
    ) {
        self.id = id
        self.kind = kind
        self.data = data
        self.localFileURL = nil
        self.filename = filename
    }

    init(
        id: UUID = UUID(),
        kind: Kind,
        localFileURL: URL,
        filename: String
    ) {
        self.id = id
        self.kind = kind
        self.data = nil
        self.localFileURL = localFileURL
        self.filename = filename
    }

    var pendingPreviewCacheKey: String {
        "pending-media:\(id.uuidString)"
    }
}

struct ChatOutgoingPayload: Codable, Sendable {
    let conversationID: String
    let msgType: String
    let content: String
    let filename: String?
    let replyToID: Int?
    let mentions: [String]
    let mentionAll: Bool

    enum CodingKeys: String, CodingKey {
        case conversationID
        case msgType
        case content
        case filename
        case replyToID
        case mentions
        case mentionAll
    }

    init(
        conversationID: String,
        msgType: String,
        content: String = "",
        filename: String? = nil,
        replyToID: Int? = nil,
        mentions: [String] = [],
        mentionAll: Bool = false
    ) {
        self.conversationID = conversationID
        self.msgType = msgType
        self.content = content
        self.filename = filename
        self.replyToID = replyToID
        self.mentions = mentions
        self.mentionAll = mentionAll
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        conversationID = try container.decode(String.self, forKey: .conversationID)
        msgType = try container.decode(String.self, forKey: .msgType)
        content = try container.decodeIfPresent(String.self, forKey: .content) ?? ""
        filename = try container.decodeIfPresent(String.self, forKey: .filename)
        replyToID = try container.decodeIfPresent(Int.self, forKey: .replyToID)
        mentions = try container.decodeIfPresent([String].self, forKey: .mentions) ?? []
        mentionAll = try container.decodeIfPresent(Bool.self, forKey: .mentionAll) ?? false
    }
}

enum TimelineItem: Identifiable, Equatable {
    case confirmed(Message)
    case outgoing(PendingMessage)

    var id: String {
        switch self {
        case .confirmed(let message):
            return ChatTimelineIdentity.value(
                clientMessageID: message.clientMessageID,
                serverID: message.id
            )
        case .outgoing(let pending):
            return "client:\(pending.id.uuidString)"
        }
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

        if (type == ChatMoneyKind.redPacket.rawValue || type == ChatMoneyKind.transfer.rawValue),
           let leftMoney = ChatMoneyPayload.parse(lhs),
           let rightMoney = ChatMoneyPayload.parse(rhs) {
            // HTTP creation and the WebSocket event may legitimately carry
            // different status/version snapshots. The stable asset identity
            // is what correlates the two confirmations.
            return leftMoney.assetID == rightMoney.assetID
                && leftMoney.kind.rawValue == type
                && rightMoney.kind.rawValue == type
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
