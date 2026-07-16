// BWChat/Models/ChatMoney.swift
// Public chat snapshots and role-filtered details for cat-food red packets/transfers.

import Foundation

enum ChatMoneyKind: String, Codable, CaseIterable {
    case redPacket = "red_packet"
    case transfer
}

enum ChatMoneyScope: String, Codable {
    case direct = "dm"
    case group
}

enum RedPacketMode: String, Codable, CaseIterable, Identifiable {
    case direct
    case lucky
    case equal
    case exclusive

    var id: String { rawValue }

    var localizedTitle: String {
        switch self {
        case .direct: return L10n.tr("chatMoney.redPacket.mode.direct")
        case .lucky: return L10n.tr("chatMoney.redPacket.mode.lucky")
        case .equal: return L10n.tr("chatMoney.redPacket.mode.equal")
        case .exclusive: return L10n.tr("chatMoney.redPacket.mode.exclusive")
        }
    }
}

enum ChatMoneyStatus: String, Codable {
    case pending
    case partial
    case completed
    case accepted
    case returned
    case expiredRefunded = "expired_refunded"

    var isTerminal: Bool {
        switch self {
        case .completed, .accepted, .returned, .expiredRefunded: return true
        case .pending, .partial: return false
        }
    }

    var localizedTitle: String {
        switch self {
        case .pending: return L10n.tr("chatMoney.status.pending")
        case .partial: return L10n.tr("chatMoney.status.partial")
        case .completed: return L10n.tr("chatMoney.status.completed")
        case .accepted: return L10n.tr("chatMoney.status.accepted")
        case .returned: return L10n.tr("chatMoney.status.returned")
        case .expiredRefunded: return L10n.tr("chatMoney.status.expiredRefunded")
        }
    }
}

/// Safe to persist in Message.content and broadcast to every participant.
/// Red packet amounts intentionally do not exist in this type.
struct ChatMoneyPayload: Codable, Equatable {
    let schemaVersion: Int
    let assetID: String
    let kind: ChatMoneyKind
    let scope: ChatMoneyScope
    let mode: RedPacketMode?
    let senderID: String
    let recipientID: String?
    let recipientName: String?
    let greeting: String?
    let note: String?
    let amount: Int?
    let packetCount: Int?
    let claimedCount: Int?
    let status: ChatMoneyStatus
    let expiresAt: String?
    let version: Int

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case assetID = "asset_id"
        case kind, scope, mode
        case senderID = "sender_id"
        case recipientID = "recipient_id"
        case recipientName = "recipient_name"
        case greeting, note, amount
        case packetCount = "packet_count"
        case claimedCount = "claimed_count"
        case status
        case expiresAt = "expires_at"
        case version
    }

    init(
        schemaVersion: Int = 1,
        assetID: String,
        kind: ChatMoneyKind,
        scope: ChatMoneyScope,
        mode: RedPacketMode? = nil,
        senderID: String,
        recipientID: String? = nil,
        recipientName: String? = nil,
        greeting: String? = nil,
        note: String? = nil,
        amount: Int? = nil,
        packetCount: Int? = nil,
        claimedCount: Int? = nil,
        status: ChatMoneyStatus = .pending,
        expiresAt: String? = nil,
        version: Int = 1
    ) {
        self.schemaVersion = schemaVersion
        self.assetID = assetID
        self.kind = kind
        self.scope = scope
        self.mode = mode
        self.senderID = senderID
        self.recipientID = recipientID
        self.recipientName = recipientName
        self.greeting = greeting
        self.note = note
        self.amount = kind == .transfer ? amount : nil
        self.packetCount = packetCount
        self.claimedCount = claimedCount
        self.status = status
        self.expiresAt = expiresAt
        self.version = version
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedKind = try container.decode(ChatMoneyKind.self, forKey: .kind)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        assetID = try container.decode(String.self, forKey: .assetID)
        kind = decodedKind
        scope = try container.decode(ChatMoneyScope.self, forKey: .scope)
        mode = try container.decodeIfPresent(RedPacketMode.self, forKey: .mode)
        senderID = try container.decode(String.self, forKey: .senderID)
        recipientID = try container.decodeIfPresent(String.self, forKey: .recipientID)
        recipientName = try container.decodeIfPresent(String.self, forKey: .recipientName)
        greeting = try container.decodeIfPresent(String.self, forKey: .greeting)
        note = try container.decodeIfPresent(String.self, forKey: .note)
        // Defense in depth: even if an upstream serializer accidentally adds
        // an amount to a red-packet message, never retain or re-encode it.
        amount = decodedKind == .transfer
            ? try container.decodeIfPresent(Int.self, forKey: .amount)
            : nil
        packetCount = try container.decodeIfPresent(Int.self, forKey: .packetCount)
        claimedCount = try container.decodeIfPresent(Int.self, forKey: .claimedCount)
        status = try container.decodeIfPresent(ChatMoneyStatus.self, forKey: .status) ?? .pending
        expiresAt = try container.decodeIfPresent(String.self, forKey: .expiresAt)
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
    }

    static func parse(_ content: String) -> ChatMoneyPayload? {
        guard let data = content.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ChatMoneyPayload.self, from: data)
    }

    var encodedContent: String? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

struct ChatMoneyClaimRecord: Codable, Identifiable, Equatable {
    let userID: String
    let nickname: String
    let avatarURL: String?
    let amount: Int
    let claimedAt: String
    let isLuckiest: Bool

    var id: String { "\(userID)-\(claimedAt)" }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case amount
        case claimedAt = "claimed_at"
        case isLuckiest = "is_luckiest"
    }
}

struct ChatMoneyDetail: Codable, Identifiable, Equatable {
    let assetID: String
    let kind: ChatMoneyKind
    let scope: ChatMoneyScope
    let mode: RedPacketMode?
    let senderID: String
    let senderName: String?
    let senderAvatarURL: String?
    let recipientID: String?
    let recipientName: String?
    let totalAmount: Int?
    let claimedAmount: Int?
    let packetCount: Int?
    let claimedCount: Int?
    let greeting: String?
    let note: String?
    let status: ChatMoneyStatus
    let expiresAt: String?
    let canClaim: Bool
    let canAccept: Bool
    let canReturn: Bool
    let viewerClaimAmount: Int?
    let claims: [ChatMoneyClaimRecord]
    let version: Int

    var id: String { assetID }

    enum CodingKeys: String, CodingKey {
        case assetID = "asset_id"
        case kind, scope, mode
        case senderID = "sender_id"
        case senderName = "sender_name"
        case senderAvatarURL = "sender_avatar_url"
        case recipientID = "recipient_id"
        case recipientName = "recipient_name"
        case totalAmount = "total_amount"
        case claimedAmount = "claimed_amount"
        case packetCount = "packet_count"
        case claimedCount = "claimed_count"
        case greeting, note, status
        case expiresAt = "expires_at"
        case canClaim = "can_claim"
        case canAccept = "can_accept"
        case canReturn = "can_return"
        case viewerClaimAmount = "viewer_claim_amount"
        case claims, version
    }
}

struct ChatMoneyLimits: Codable, Equatable {
    let minimumAmount: Int
    let maximumAmount: Int
    let maximumPacketCount: Int
    let expiresAfterSeconds: Int

    static let fixture = ChatMoneyLimits(
        minimumAmount: 1,
        maximumAmount: 20_000,
        maximumPacketCount: 100,
        expiresAfterSeconds: 86_400
    )

    enum CodingKeys: String, CodingKey {
        case minimumAmount = "minimum_amount"
        case maximumAmount = "maximum_amount"
        case maximumPacketCount = "maximum_packet_count"
        case expiresAfterSeconds = "expires_after_seconds"
    }
}

struct ChatMoneyEligibility: Codable, Equatable {
    let eligible: Bool
    let reasonCode: String?
    let message: String?
    let actionURL: String?

    static let eligibleFixture = ChatMoneyEligibility(
        eligible: true,
        reasonCode: nil,
        message: nil,
        actionURL: nil
    )

    enum CodingKeys: String, CodingKey {
        case eligible
        case reasonCode = "reason_code"
        case message
        case actionURL = "action_url"
    }
}

struct ChatMoneyConfiguration: Codable, Equatable {
    let redPacketEnabled: Bool
    let transferEnabled: Bool
    let limits: ChatMoneyLimits
    let eligibility: ChatMoneyEligibility

    static let fixture = ChatMoneyConfiguration(
        redPacketEnabled: true,
        transferEnabled: true,
        limits: .fixture,
        eligibility: .eligibleFixture
    )

    static let unavailable = ChatMoneyConfiguration(
        redPacketEnabled: false,
        transferEnabled: false,
        limits: .fixture,
        eligibility: ChatMoneyEligibility(
            eligible: false,
            reasonCode: "configuration_not_loaded",
            message: nil,
            actionURL: nil
        )
    )

    enum CodingKeys: String, CodingKey {
        case redPacketEnabled = "red_packet_enabled"
        case transferEnabled = "transfer_enabled"
        case limits, eligibility
    }
}

struct CreateRedPacketRequest: Equatable {
    let clientMessageID: String
    let scope: ChatMoneyScope
    let receiverID: String?
    let groupID: Int?
    let recipientID: String?
    let recipientName: String?
    let mode: RedPacketMode
    let totalAmount: Int
    let amountPerPacket: Int?
    let packetCount: Int
    let greeting: String
}

struct CreateTransferRequest: Equatable {
    let clientMessageID: String
    let scope: ChatMoneyScope
    let receiverID: String?
    let groupID: Int?
    let recipientID: String
    let recipientName: String?
    let amount: Int
    let note: String
}

enum ChatMoneyCreatedMessage: Equatable {
    case direct(Message)
    case group(GroupMessage)
}

struct ChatMoneyCreationResult: Equatable {
    let message: ChatMoneyCreatedMessage
    let payload: ChatMoneyPayload
    let walletBalance: WalletBalanceResponseData?
}

struct ChatMoneyActionResult: Equatable {
    let detail: ChatMoneyDetail
    let payload: ChatMoneyPayload
    let walletBalance: WalletBalanceResponseData?
}

struct ChatMoneyCreationResponseData: Decodable {
    let directMessage: Message?
    let groupMessage: GroupMessage?
    let payload: ChatMoneyPayload
    let walletBalance: WalletBalanceResponseData?

    enum CodingKeys: String, CodingKey {
        case directMessage = "message"
        case groupMessage = "group_message"
        case payload = "asset"
        case walletBalance = "wallet_balance"
    }

    func result() throws -> ChatMoneyCreationResult {
        let created: ChatMoneyCreatedMessage
        if let directMessage {
            created = .direct(directMessage)
        } else if let groupMessage {
            created = .group(groupMessage)
        } else {
            throw APIError.invalidResponse
        }
        return ChatMoneyCreationResult(
            message: created,
            payload: payload,
            walletBalance: walletBalance
        )
    }
}

struct ChatMoneyActionResponseData: Decodable {
    let detail: ChatMoneyDetail
    let payload: ChatMoneyPayload
    let walletBalance: WalletBalanceResponseData?

    enum CodingKeys: String, CodingKey {
        case detail
        case payload = "asset"
        case walletBalance = "wallet_balance"
    }

    var result: ChatMoneyActionResult {
        ChatMoneyActionResult(
            detail: detail,
            payload: payload,
            walletBalance: walletBalance
        )
    }
}

struct ChatMoneyUpdateEvent: Decodable, Equatable {
    let payload: ChatMoneyPayload
    let directMessage: Message?
    let groupMessage: GroupMessage?
    let walletBalance: WalletBalanceResponseData?

    enum CodingKeys: String, CodingKey {
        case payload = "asset"
        case directMessage = "message"
        case groupMessage = "group_message"
        case walletBalance = "wallet_balance"
    }
}

extension Message {
    var isRedPacket: Bool { msgType == ChatMoneyKind.redPacket.rawValue }
    var isTransfer: Bool { msgType == ChatMoneyKind.transfer.rawValue }
    var chatMoneyPayload: ChatMoneyPayload? {
        guard isRedPacket || isTransfer else { return nil }
        return ChatMoneyPayload.parse(content)
    }

    func replacingChatMoneyPayload(_ payload: ChatMoneyPayload) -> Message {
        Message(
            id: id,
            senderID: senderID,
            receiverID: receiverID,
            msgType: payload.kind.rawValue,
            content: payload.encodedContent ?? content,
            timestamp: timestamp,
            replyToID: replyToID,
            replyTo: replyTo
        )
    }
}

extension GroupMessage {
    var isRedPacket: Bool { msgType == ChatMoneyKind.redPacket.rawValue }
    var isTransfer: Bool { msgType == ChatMoneyKind.transfer.rawValue }
    var chatMoneyPayload: ChatMoneyPayload? {
        guard isRedPacket || isTransfer else { return nil }
        return ChatMoneyPayload.parse(content)
    }

    func replacingChatMoneyPayload(_ payload: ChatMoneyPayload) -> GroupMessage {
        GroupMessage(
            id: id,
            groupID: groupID,
            senderID: senderID,
            msgType: payload.kind.rawValue,
            content: payload.encodedContent ?? content,
            timestamp: timestamp,
            senderNickname: senderNickname,
            senderAvatar: senderAvatar,
            replyToID: replyToID,
            replyTo: replyTo,
            mentions: mentions,
            clientMessageID: clientMessageID,
            scriptContext: scriptContext
        )
    }
}

enum ChatMoneyPreview {
    static func text(content: String?, msgType: String?) -> String? {
        let type = msgType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if type == ChatMoneyKind.redPacket.rawValue || content.flatMap(ChatMoneyPayload.parse)?.kind == .redPacket {
            return L10n.tr("chatMoney.preview.redPacket")
        }
        if type == ChatMoneyKind.transfer.rawValue || content.flatMap(ChatMoneyPayload.parse)?.kind == .transfer {
            return L10n.tr("chatMoney.preview.transfer")
        }
        return nil
    }
}
