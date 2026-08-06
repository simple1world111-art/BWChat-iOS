import Foundation

enum ChatConversationType: String, Codable, CaseIterable {
    case dm
    case group
}

struct ForwardMessageSource: Codable, Hashable {
    let conversationType: ChatConversationType
    let conversationID: String
    let messageID: Int
    let expectedVersion: Int

    enum CodingKeys: String, CodingKey {
        case conversationType = "conversation_type"
        case conversationID = "conversation_id"
        case messageID = "message_id"
        case expectedVersion = "expected_version"
    }
}

struct ForwardTarget: Codable, Hashable, Identifiable {
    let conversationType: ChatConversationType
    let conversationID: String
    var displayName: String
    var avatarURL: String

    var id: String { "\(conversationType.rawValue):\(conversationID)" }

    enum CodingKeys: String, CodingKey {
        case conversationType = "conversation_type"
        case conversationID = "conversation_id"
    }

    init(conversationType: ChatConversationType, conversationID: String, displayName: String, avatarURL: String) {
        self.conversationType = conversationType
        self.conversationID = conversationID
        self.displayName = displayName
        self.avatarURL = avatarURL
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        conversationType = try container.decode(ChatConversationType.self, forKey: .conversationType)
        conversationID = try container.decode(String.self, forKey: .conversationID)
        displayName = ""
        avatarURL = ""
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(conversationType, forKey: .conversationType)
        try container.encode(conversationID, forKey: .conversationID)
    }
}

enum ForwardMode: String, Codable, CaseIterable {
    case single
    case individual
    case merged
}

struct ForwardFlowDraft: Identifiable, Equatable {
    let id = UUID()
    let mode: ForwardMode
    let sources: [ForwardMessageSource]
    let preview: String
}

struct ForwardRequest: Codable, Equatable {
    let clientOperationID: UUID
    let mode: ForwardMode
    let sources: [ForwardMessageSource]
    let targets: [ForwardTarget]

    enum CodingKeys: String, CodingKey {
        case clientOperationID = "client_operation_id"
        case mode, sources, targets
    }
}

struct ForwardCreatedMessage: Codable, Equatable, Identifiable {
    let conversationType: ChatConversationType
    let conversationID: String
    let messageID: Int

    var id: String { "\(conversationType.rawValue):\(conversationID):\(messageID)" }

    enum CodingKeys: String, CodingKey {
        case conversationType = "conversation_type"
        case conversationID = "conversation_id"
        case messageID = "message_id"
    }
}

struct ForwardOperationResult: Codable, Equatable {
    let clientOperationID: UUID
    let bundleID: String?
    let createdMessages: [ForwardCreatedMessage]

    enum CodingKeys: String, CodingKey {
        case clientOperationID = "client_operation_id"
        case bundleID = "bundle_id"
        case createdMessages = "created_messages"
    }
}

struct ForwardBundleItem: Codable, Equatable, Hashable, Identifiable {
    let ordinal: Int
    let senderName: String
    let sentAt: String
    let messageType: String
    let summary: String
    let assetID: String?

    var id: Int { ordinal }

    enum CodingKeys: String, CodingKey {
        case ordinal
        case senderName = "sender_name"
        case sentAt = "sent_at"
        case messageType = "message_type"
        case summary
        case assetID = "asset_id"
    }
}

struct ForwardBundle: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    let createdAt: String
    let items: [ForwardBundleItem]

    enum CodingKeys: String, CodingKey {
        case id = "bundle_id"
        case title
        case createdAt = "created_at"
        case items
    }
}

struct ForwardBundleMessagePayload: Codable, Equatable {
    let bundleID: String
    let title: String
    let itemCount: Int
    let summary: String

    enum CodingKeys: String, CodingKey {
        case bundleID = "bundle_id"
        case title
        case itemCount = "item_count"
        case summary
    }

    static func parse(_ content: String, messageType: String) -> ForwardBundleMessagePayload? {
        guard messageType == "chat_history" || messageType == "forward_bundle",
              let data = content.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }
}
