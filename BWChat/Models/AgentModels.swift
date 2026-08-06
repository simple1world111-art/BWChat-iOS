// BWChat/Models/AgentModels.swift
// Models for the Agent Platform. These intentionally do not reuse legacy chat models.

import Foundation

struct AgentProfile: Codable, Equatable {
    let name: String
    let tagline: String?
    let description: String?
    let tags: [String]?
    let language: String?
    let avatarAssetID: String?

    enum CodingKeys: String, CodingKey {
        case name, tagline, description, tags, language
        case avatarAssetID = "avatar_asset_id"
    }

    init(
        name: String,
        tagline: String? = nil,
        description: String? = nil,
        tags: [String]? = nil,
        language: String? = nil,
        avatarAssetID: String? = nil
    ) {
        self.name = name
        self.tagline = tagline
        self.description = description
        self.tags = tags
        self.language = language
        self.avatarAssetID = avatarAssetID
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = container.lossyString(forKey: .name) ?? ""
        tagline = container.lossyString(forKey: .tagline)
        description = container.lossyString(forKey: .description)
        tags = container.lossyStringArray(forKey: .tags)
        language = container.lossyString(forKey: .language)
        avatarAssetID = container.lossyString(forKey: .avatarAssetID)
    }
}

struct AgentCapabilities: Codable, Equatable {
    let paidImages: Bool
    let paidVideos: Bool
    let stickers: Bool?
    let platformRewards: Bool?
    let proactiveMessages: Bool?

    enum CodingKeys: String, CodingKey {
        case paidImages = "paid_images"
        case paidVideos = "paid_videos"
        case stickers
        case platformRewards = "platform_rewards"
        case proactiveMessages = "proactive_messages"
    }

    init(
        paidImages: Bool = false,
        paidVideos: Bool = false,
        stickers: Bool? = nil,
        platformRewards: Bool? = nil,
        proactiveMessages: Bool? = nil
    ) {
        self.paidImages = paidImages
        self.paidVideos = paidVideos
        self.stickers = stickers
        self.platformRewards = platformRewards
        self.proactiveMessages = proactiveMessages
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        paidImages = container.lossyBool(forKey: .paidImages) ?? false
        paidVideos = container.lossyBool(forKey: .paidVideos) ?? false
        stickers = container.lossyBool(forKey: .stickers)
        platformRewards = container.lossyBool(forKey: .platformRewards)
        proactiveMessages = container.lossyBool(forKey: .proactiveMessages)
    }
}

struct AgentGreeting: Codable, Identifiable, Equatable {
    let id: String
    let text: String

    private enum CodingKeys: String, CodingKey {
        case id, text, message, content
        case greetingID = "greeting_id"
    }

    init(from decoder: Decoder) throws {
        if let value = try? decoder.singleValueContainer().decode(String.self) {
            id = "default"
            text = value
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = container.lossyString(forKey: .id)
            ?? container.lossyString(forKey: .greetingID)
            ?? "default"
        text = container.lossyString(forKey: .text)
            ?? container.lossyString(forKey: .message)
            ?? container.lossyString(forKey: .content)
            ?? ""
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(text, forKey: .text)
    }
}

struct AgentSummary: Codable, Identifiable, Equatable {
    let id: String
    let visibility: String?
    let status: String?
    let versionNumber: Int?
    let revision: Int?
    let isOwner: Bool?
    let profile: AgentProfile?
    let capabilities: AgentCapabilities?
    let greetings: [AgentGreeting]?
    let avatarAssetID: String?
    let primaryReferenceAssetID: String?
    let definition: AgentDefinition?

    enum CodingKeys: String, CodingKey {
        case id, visibility, status, revision, profile, capabilities, greetings, definition
        case agentID = "agent_id"
        case versionNumber = "version_number"
        case isOwner = "is_owner"
        case avatarAssetID = "avatar_asset_id"
        case primaryReferenceAssetID = "primary_reference_asset_id"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard let decodedID = container.lossyString(forKey: .id)
            ?? container.lossyString(forKey: .agentID),
              !decodedID.isEmpty else {
            throw DecodingError.keyNotFound(
                CodingKeys.agentID,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Agent response is missing id/agent_id"
                )
            )
        }
        id = decodedID
        visibility = container.lossyString(forKey: .visibility)
        status = container.lossyString(forKey: .status)
        versionNumber = container.lossyInt(forKey: .versionNumber)
        revision = container.lossyInt(forKey: .revision)
        isOwner = container.lossyBool(forKey: .isOwner)
        profile = try? container.decodeIfPresent(AgentProfile.self, forKey: .profile)
        capabilities = try? container.decodeIfPresent(AgentCapabilities.self, forKey: .capabilities)
        greetings = try? container.decodeIfPresent([AgentGreeting].self, forKey: .greetings)
        avatarAssetID = container.lossyString(forKey: .avatarAssetID)
        primaryReferenceAssetID = container.lossyString(forKey: .primaryReferenceAssetID)
        definition = try? container.decodeIfPresent(AgentDefinition.self, forKey: .definition)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encodeIfPresent(visibility, forKey: .visibility)
        try container.encodeIfPresent(status, forKey: .status)
        try container.encodeIfPresent(versionNumber, forKey: .versionNumber)
        try container.encodeIfPresent(revision, forKey: .revision)
        try container.encodeIfPresent(isOwner, forKey: .isOwner)
        try container.encodeIfPresent(profile, forKey: .profile)
        try container.encodeIfPresent(capabilities, forKey: .capabilities)
        try container.encodeIfPresent(greetings, forKey: .greetings)
        try container.encodeIfPresent(avatarAssetID, forKey: .avatarAssetID)
        try container.encodeIfPresent(primaryReferenceAssetID, forKey: .primaryReferenceAssetID)
        try container.encodeIfPresent(definition, forKey: .definition)
    }

    var displayName: String { profile?.name ?? "智能体" }
    var resolvedAvatarAssetID: String? { avatarAssetID ?? profile?.avatarAssetID }
}

struct AgentSummaryPage: Decodable, Equatable {
    let agents: [AgentSummary]
    let hasMore: Bool
    let nextCursor: String?

    private enum CodingKeys: String, CodingKey {
        case agents, items, bots
        case hasMore = "has_more"
        case nextCursor = "next_cursor"
    }

    init(from decoder: Decoder) throws {
        if let agents = try? decoder.singleValueContainer().decode([AgentSummary].self) {
            self.agents = agents
            hasMore = false
            nextCursor = nil
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        agents = try container.decodeIfPresent([AgentSummary].self, forKey: .agents)
            ?? container.decodeIfPresent([AgentSummary].self, forKey: .items)
            ?? container.decodeIfPresent([AgentSummary].self, forKey: .bots)
            ?? []
        let decodedCursor = container.lossyString(forKey: .nextCursor)
        nextCursor = decodedCursor
        hasMore = container.lossyBool(forKey: .hasMore) ?? (decodedCursor != nil)
    }
}

struct AgentDefinition: Codable, Equatable {
    let identity: String?
    let personality: [String]?
    let tone: AgentToneDefinition?
    let relationship: AgentRelationshipDefinition?
    let intimacy: AgentIntimacyDefinition?
    let greetings: [AgentGreeting]?
    let capabilities: AgentCapabilities?

    private enum CodingKeys: String, CodingKey {
        case identity, personality, tone, relationship, intimacy, greetings, capabilities
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        identity = container.lossyString(forKey: .identity)
        personality = container.lossyStringArray(forKey: .personality)
        tone = try? container.decodeIfPresent(AgentToneDefinition.self, forKey: .tone)
        relationship = try? container.decodeIfPresent(AgentRelationshipDefinition.self, forKey: .relationship)
        intimacy = try? container.decodeIfPresent(AgentIntimacyDefinition.self, forKey: .intimacy)
        greetings = try? container.decodeIfPresent([AgentGreeting].self, forKey: .greetings)
        capabilities = try? container.decodeIfPresent(AgentCapabilities.self, forKey: .capabilities)
    }
}

struct AgentToneDefinition: Codable, Equatable {
    let style: String?
    let replyLength: String?

    enum CodingKeys: String, CodingKey {
        case style
        case replyLength = "reply_length"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        style = container.lossyString(forKey: .style)
        replyLength = container.lossyString(forKey: .replyLength)
    }
}

struct AgentRelationshipDefinition: Codable, Equatable {
    let type: String?
    let addressStyle: String?

    enum CodingKeys: String, CodingKey {
        case type
        case addressStyle = "address_style"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = container.lossyString(forKey: .type)
        addressStyle = container.lossyString(forKey: .addressStyle)
    }
}

struct AgentIntimacyDefinition: Codable, Equatable {
    let adultEnabled: Bool?
    let style: String?
    let initiative: String?

    enum CodingKeys: String, CodingKey {
        case adultEnabled = "adult_enabled"
        case style, initiative
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        adultEnabled = container.lossyBool(forKey: .adultEnabled)
        style = container.lossyString(forKey: .style)
        initiative = container.lossyString(forKey: .initiative)
    }
}

private extension KeyedDecodingContainer {
    func lossyString(forKey key: Key) -> String? {
        if let value = try? decodeIfPresent(String.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return String(value) }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return String(value) }
        return nil
    }

    func lossyInt(forKey key: Key) -> Int? {
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(String.self, forKey: key) { return Int(value) }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return Int(value) }
        return nil
    }

    func lossyBool(forKey key: Key) -> Bool? {
        if let value = try? decodeIfPresent(Bool.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value != 0 }
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "true", "1", "yes": return true
            case "false", "0", "no": return false
            default: return nil
            }
        }
        return nil
    }

    func lossyStringArray(forKey key: Key) -> [String]? {
        if let values = try? decodeIfPresent([String].self, forKey: key) { return values }
        guard let value = try? decodeIfPresent(String.self, forKey: key) else { return nil }
        return value
            .split(whereSeparator: { $0 == "," || $0 == "，" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}

struct AgentActor: Codable, Equatable {
    let type: String
    let id: String
}

struct AgentPartMetadata: Codable, Equatable {
    let mediaType: String?
    let generationStatus: String?
    let pricePoints: Int?
    let access: String?
    let previewURL: String?
    let contentURL: String?
    let downloadURL: String?
    let width: Int?
    let height: Int?
    let errorCode: String?

    enum CodingKeys: String, CodingKey {
        case mediaType = "media_type"
        case generationStatus = "generation_status"
        case pricePoints = "price_points"
        case access
        case previewURL = "preview_url"
        case contentURL = "content_url"
        case downloadURL = "download_url"
        case width, height
        case errorCode = "error_code"
    }

    init(
        mediaType: String? = nil,
        generationStatus: String? = nil,
        pricePoints: Int? = nil,
        access: String? = nil,
        previewURL: String? = nil,
        contentURL: String? = nil,
        downloadURL: String? = nil,
        width: Int? = nil,
        height: Int? = nil,
        errorCode: String? = nil
    ) {
        self.mediaType = mediaType
        self.generationStatus = generationStatus
        self.pricePoints = pricePoints
        self.access = access
        self.previewURL = previewURL
        self.contentURL = contentURL
        self.downloadURL = downloadURL
        self.width = width
        self.height = height
        self.errorCode = errorCode
    }
}

struct AgentMessagePart: Codable, Identifiable, Equatable {
    let id: String
    let ordinal: Int
    let type: String
    let text: String
    let assetID: String?
    let referenceID: String?
    let metadata: AgentPartMetadata

    enum CodingKeys: String, CodingKey {
        case id, ordinal, type, text, metadata
        case assetID = "asset_id"
        case referenceID = "reference_id"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        ordinal = try container.decodeIfPresent(Int.self, forKey: .ordinal) ?? 0
        type = try container.decode(String.self, forKey: .type)
        text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
        assetID = try container.decodeIfPresent(String.self, forKey: .assetID)
        referenceID = try container.decodeIfPresent(String.self, forKey: .referenceID)
        metadata = try container.decodeIfPresent(AgentPartMetadata.self, forKey: .metadata)
            ?? AgentPartMetadata()
    }
}

struct AgentMessage: Codable, Identifiable, Equatable {
    let id: String
    let conversationID: String
    let sequenceNo: Int
    let sender: AgentActor
    let turnID: String?
    let source: String
    let status: String
    let replyToID: String?
    let clientMessageID: String?
    let createdAt: String
    let updatedAt: String
    let parts: [AgentMessagePart]

    enum CodingKeys: String, CodingKey {
        case id, sender, source, status, parts
        case conversationID = "conversation_id"
        case sequenceNo = "sequence_no"
        case turnID = "turn_id"
        case replyToID = "reply_to_id"
        case clientMessageID = "client_message_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    var orderedParts: [AgentMessagePart] { parts.sorted { $0.ordinal < $1.ordinal } }
}

struct AgentPaidMediaStatePolicy {
    static func displayStatus(for metadata: AgentPartMetadata) -> String {
        let status = metadata.generationStatus?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        switch status {
        case nil, "", "queued", "pending":
            return "queued"
        case "processing", "generating":
            return "generating"
        case "ready", "completed":
            if metadata.access == "locked" || metadata.access == "unlocked" {
                return "ready_locked"
            }
            return "generating"
        default:
            return status ?? "queued"
        }
    }

    static func hasVisibleUnlockedMedia(id: String, messages: [AgentMessage]) -> Bool {
        messages.lazy
            .flatMap(\.parts)
            .contains { part in
                part.type == "paid_media"
                    && part.referenceID == id
                    && part.metadata.access == "unlocked"
                    && (part.metadata.contentURL != nil || part.metadata.downloadURL != nil)
            }
    }
}

enum AgentConversationPreviewResolver {
    static func text(for message: AgentMessage?, fallback: String) -> String {
        guard let message else { return fallback }

        // A completed media part is what the user actually sees as the latest
        // message, so it must outrank any earlier processing text in that message.
        if let mediaPreview = message.orderedParts.lazy.compactMap(mediaPreview(for:)).first {
            return mediaPreview
        }

        return message.orderedParts
            .first(where: { $0.type == "text" && !$0.text.isBlank })?.text
            ?? fallback
    }

    private static func mediaPreview(for part: AgentMessagePart) -> String? {
        if part.type == "input_image" {
            return L10n.tr("message.image")
        }
        guard part.type == "paid_media",
              AgentPaidMediaStatePolicy.displayStatus(for: part.metadata) == "ready_locked" else {
            return nil
        }
        return part.metadata.mediaType?.lowercased() == "video"
            ? L10n.tr("message.video")
            : L10n.tr("message.image")
    }
}

struct AgentImageReplyTarget: Identifiable, Equatable {
    let messageID: String
    let partID: String
    let imagePath: String
    let isFromUser: Bool

    var id: String { "\(messageID):\(partID)" }
    var senderLabel: String { isFromUser ? "你" : "智能体" }
}

struct AgentConversation: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let status: String
    let agentID: String
    let agentVersionID: String
    let agentProfile: AgentProfile
    let agentCapabilities: AgentCapabilities
    let latestMessage: AgentMessage?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, status
        case agentID = "agent_id"
        case agentVersionID = "agent_version_id"
        case agentProfile = "agent_profile"
        case agentCapabilities = "agent_capabilities"
        case latestMessage = "latest_message"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    init(
        id: String,
        title: String,
        status: String,
        agentID: String,
        agentVersionID: String,
        agentProfile: AgentProfile,
        agentCapabilities: AgentCapabilities,
        latestMessage: AgentMessage?,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.agentID = agentID
        self.agentVersionID = agentVersionID
        self.agentProfile = agentProfile
        self.agentCapabilities = agentCapabilities
        self.latestMessage = latestMessage
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

struct CachedAgentMessagePage: Codable, Equatable {
    let messages: [AgentMessage]
    let hasMore: Bool
}

struct AgentTurn: Decodable, Identifiable, Equatable {
    let id: String
    let conversationID: String
    let triggerMessageID: String
    let responseMessageID: String?
    let status: String
    let interactionMode: String
    let chatModel: String
    let visionModel: String
    let errorCode: String
    let errorDetail: String
    let createdAt: String
    let updatedAt: String
    let completedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case conversationID = "conversation_id"
        case triggerMessageID = "trigger_message_id"
        case responseMessageID = "response_message_id"
        case interactionMode = "interaction_mode"
        case chatModel = "chat_model"
        case visionModel = "vision_model"
        case errorCode = "error_code"
        case errorDetail = "error_detail"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case completedAt = "completed_at"
    }

    static let terminalStatuses: Set<String> = ["completed", "completed_with_errors", "failed"]
    var isTerminal: Bool { Self.terminalStatuses.contains(status) }
}

struct AgentTurnAccepted: Decodable, Equatable {
    let turn: AgentTurn
    let message: AgentMessage
    let eventsURL: String

    enum CodingKeys: String, CodingKey {
        case turn, message
        case eventsURL = "events_url"
    }
}

struct AgentTurnResult: Decodable, Equatable {
    let turn: AgentTurn
    let responseMessage: AgentMessage?

    enum CodingKeys: String, CodingKey {
        case turn
        case responseMessage = "response_message"
    }
}

struct AgentImageUpload: Decodable, Equatable {
    let assetID: String
    enum CodingKeys: String, CodingKey { case assetID = "asset_id" }
}

struct AgentReferenceUpload: Decodable, Equatable {
    let primaryReferenceAssetID: String
    let avatarAssetID: String

    enum CodingKeys: String, CodingKey {
        case primaryReferenceAssetID = "primary_reference_asset_id"
        case avatarAssetID = "avatar_asset_id"
    }
}

struct AgentVersion: Decodable, Equatable {
    let id: String?
    let agentID: String?
    let versionNumber: Int?
    let status: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case agentID = "agent_id"
        case versionNumber = "version_number"
    }
}

struct AgentMediaUnlock: Decodable, Equatable {
    let charge: MixedAssetCharge?
    let alreadyUnlocked: Bool
    let contentURL: String
    let downloadURL: String
    let consumedProp: PropConsumptionResult?

    enum CodingKeys: String, CodingKey {
        case alreadyUnlocked = "already_unlocked"
        case contentURL = "content_url"
        case downloadURL = "download_url"
        case consumedProp = "consumed_prop"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        charge = try MixedAssetCharge.decodeIfPresent(from: decoder)
        alreadyUnlocked = container.flexBool(for: .alreadyUnlocked) ?? false
        contentURL = container.flexString(for: .contentURL) ?? ""
        downloadURL = container.flexString(for: .downloadURL) ?? ""
        consumedProp = try? container.decodeIfPresent(PropConsumptionResult.self, forKey: .consumedProp)
    }
}

struct AgentMediaResponse {
    let data: Data
    let mimeType: String?
    let contentRange: String?
    let contentLength: Int64?
    let acceptsRanges: Bool
}

struct AgentVisionConfig: Codable, Equatable {
    let maxImagesPerTurn: Int

    enum CodingKeys: String, CodingKey {
        case maxImagesPerTurn = "max_images_per_turn"
    }

    init(maxImagesPerTurn: Int = 1) {
        self.maxImagesPerTurn = max(1, maxImagesPerTurn)
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(maxImagesPerTurn: try container.decodeIfPresent(Int.self, forKey: .maxImagesPerTurn) ?? 1)
    }
}

struct AgentRuntimeConfig: Codable, Equatable {
    let agentsEnabled: Bool
    let imageInputEnabled: Bool
    let paidImagesEnabled: Bool
    let paidVideosEnabled: Bool
    let vision: AgentVisionConfig
    let imagePricePoints: Int?

    private enum CodingKeys: String, CodingKey {
        case features, vision, paidMedia = "paid_media"
    }

    private enum FeatureKeys: String, CodingKey {
        case agentsEnabled = "agents_enabled"
        case imageInputEnabled = "image_input_enabled"
        case paidImagesEnabled = "paid_images_enabled"
        case paidVideosEnabled = "paid_videos_enabled"
    }

    private enum PaidMediaKeys: String, CodingKey {
        case image
    }

    private enum ImagePricingKeys: String, CodingKey {
        case pricePoints = "price_points"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let features = try container.nestedContainer(keyedBy: FeatureKeys.self, forKey: .features)
        agentsEnabled = try features.decode(Bool.self, forKey: .agentsEnabled)
        imageInputEnabled = try features.decode(Bool.self, forKey: .imageInputEnabled)
        paidImagesEnabled = try features.decode(Bool.self, forKey: .paidImagesEnabled)
        paidVideosEnabled = try features.decode(Bool.self, forKey: .paidVideosEnabled)
        vision = try container.decode(AgentVisionConfig.self, forKey: .vision)

        if let paidMedia = try? container.nestedContainer(
            keyedBy: PaidMediaKeys.self,
            forKey: .paidMedia
        ), let image = try? paidMedia.nestedContainer(
            keyedBy: ImagePricingKeys.self,
            forKey: .image
        ) {
            imagePricePoints = try image.decodeIfPresent(Int.self, forKey: .pricePoints)
        } else {
            imagePricePoints = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        var features = container.nestedContainer(keyedBy: FeatureKeys.self, forKey: .features)
        try features.encode(agentsEnabled, forKey: .agentsEnabled)
        try features.encode(imageInputEnabled, forKey: .imageInputEnabled)
        try features.encode(paidImagesEnabled, forKey: .paidImagesEnabled)
        try features.encode(paidVideosEnabled, forKey: .paidVideosEnabled)
        try container.encode(vision, forKey: .vision)

        if let imagePricePoints {
            var paidMedia = container.nestedContainer(
                keyedBy: PaidMediaKeys.self,
                forKey: .paidMedia
            )
            var image = paidMedia.nestedContainer(
                keyedBy: ImagePricingKeys.self,
                forKey: .image
            )
            try image.encode(imagePricePoints, forKey: .pricePoints)
        }
    }
}
