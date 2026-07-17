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

enum ChatMoneyViewerState: String, Codable {
    case claimable
    case claimed
    case empty
    case expired
    case notDesignated = "not_designated"
    case senderView = "sender_view"
    case transferReceivable = "transfer_receivable"
    case transferSenderWaiting = "transfer_sender_waiting"
    case transferObserver = "transfer_observer"
    case accepted
    case returned
    case expiredRefunded = "expired_refunded"
}

enum ChatMoneyUnavailableReason: String, Codable {
    case alreadyClaimed = "red_packet_already_claimed"
    case empty = "red_packet_empty"
    case expired = "red_packet_expired"
    case recipientOnly = "red_packet_recipient_only"
    case notConversationMember = "red_packet_not_conversation_member"
    case transferRecipientOnly = "transfer_recipient_only"
    case transferFinalized = "transfer_already_finalized"
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
    var createdAt: String? = nil
    var finalizedAt: String? = nil
    var viewerState: ChatMoneyViewerState? = nil
    var unavailableReason: ChatMoneyUnavailableReason? = nil
    var remainingAmount: Int? = nil
    var remainingCount: Int? = nil

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
        case createdAt = "created_at"
        case finalizedAt = "finalized_at"
        case viewerState = "viewer_state"
        case unavailableReason = "unavailable_reason"
        case remainingAmount = "remaining_amount"
        case remainingCount = "remaining_count"
    }
}

enum ChatMoneyRedPacketPresentationPolicy {
    static func senderCanClaimOwnPacket(
        scope: ChatMoneyScope,
        mode: RedPacketMode?
    ) -> Bool {
        scope == .group && (mode == .lucky || mode == .equal)
    }

    static func canShowOpenAction(
        detail: ChatMoneyDetail,
        isSender: Bool
    ) -> Bool {
        guard detail.canClaim else {
            return false
        }
        if isSender {
            return senderCanClaimOwnPacket(scope: detail.scope, mode: detail.mode)
        }
        return true
    }

    static func shouldShowEnvelope(
        payload: ChatMoneyPayload,
        isSender _: Bool,
        hasLocalClaim: Bool
    ) -> Bool {
        guard payload.kind == .redPacket,
              !hasLocalClaim,
              payload.status == .pending || payload.status == .partial
        else {
            return false
        }
        if let packetCount = payload.packetCount,
           let claimedCount = payload.claimedCount,
           claimedCount >= packetCount {
            return false
        }
        // Both sides see the envelope while it is open. After detail loads,
        // scope + mode + can_claim decide whether the center action is "Open".
        return true
    }

    static func shouldShowEnvelope(
        detail: ChatMoneyDetail,
        viewerID: String?,
        isSender: Bool,
        hasLocalClaim: Bool
    ) -> Bool {
        guard detail.kind == .redPacket,
              !hasLocalClaim,
              detail.status == .pending || detail.status == .partial,
              detail.unavailableReason == nil,
              detail.viewerClaimAmount == nil
        else {
            return false
        }
        if let remainingCount = detail.remainingCount, remainingCount <= 0 {
            return false
        }
        if let packetCount = detail.packetCount,
           let claimedCount = detail.claimedCount,
           claimedCount >= packetCount {
            return false
        }
        if isSender {
            return true
        }
        guard detail.canClaim else {
            return false
        }
        if let viewerState = detail.viewerState, viewerState != .claimable {
            return false
        }
        if let viewerID,
           detail.claims.contains(where: { $0.userID == viewerID }) {
            return false
        }
        return true
    }
}

struct ChatMoneyLimits: Codable, Equatable {
    let minimumAmount: Int
    let maximumAmount: Int
    let maximumPacketCount: Int
    let expiresAfterSeconds: Int
    var redPacketMinimumAmount: Int? = nil
    var redPacketMaximumAmount: Int? = nil
    var transferMinimumAmount: Int? = nil
    var transferMaximumAmount: Int? = nil
    var maximumGreetingLength: Int? = nil
    var maximumTransferNoteLength: Int? = nil

    func minimumAmount(for kind: ChatMoneyKind) -> Int {
        kind == .redPacket
            ? redPacketMinimumAmount ?? minimumAmount
            : transferMinimumAmount ?? minimumAmount
    }

    func maximumAmount(for kind: ChatMoneyKind) -> Int {
        kind == .redPacket
            ? redPacketMaximumAmount ?? maximumAmount
            : transferMaximumAmount ?? maximumAmount
    }

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
        case redPacketMinimumAmount = "red_packet_minimum_amount"
        case redPacketMaximumAmount = "red_packet_maximum_amount"
        case transferMinimumAmount = "transfer_minimum_amount"
        case transferMaximumAmount = "transfer_maximum_amount"
        case maximumGreetingLength = "maximum_greeting_length"
        case maximumTransferNoteLength = "maximum_transfer_note_length"
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
    var directReceiptMessage: Message? = nil
    var groupReceiptMessage: GroupMessage? = nil
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
    let directReceiptMessage: Message?
    let groupReceiptMessage: GroupMessage?

    enum CodingKeys: String, CodingKey {
        case detail
        case payload = "asset"
        case walletBalance = "wallet_balance"
        case directReceiptMessage = "receipt_message"
        case groupReceiptMessage = "receipt_group_message"
    }

    var result: ChatMoneyActionResult {
        ChatMoneyActionResult(
            detail: detail,
            payload: payload,
            walletBalance: walletBalance,
            directReceiptMessage: directReceiptMessage,
            groupReceiptMessage: groupReceiptMessage
        )
    }
}

struct ChatMoneyUpdateEvent: Decodable, Equatable {
    let payload: ChatMoneyPayload
    let directMessage: Message?
    let groupMessage: GroupMessage?
    let walletBalance: WalletBalanceResponseData?
    let directReceiptMessage: Message?
    let groupReceiptMessage: GroupMessage?

    enum CodingKeys: String, CodingKey {
        case payload = "asset"
        case directMessage = "message"
        case groupMessage = "group_message"
        case walletBalance = "wallet_balance"
        case directReceiptMessage = "receipt_message"
        case groupReceiptMessage = "receipt_group_message"
    }
}

enum ChatMoneyReceiptEventType: String, Codable {
    case redPacketClaimed = "red_packet_claimed"
    case transferAccepted = "transfer_accepted"
    case transferReturned = "transfer_returned"
    case assetExpiredRefunded = "asset_expired_refunded"
}

struct ChatMoneyReceiptPayload: Codable, Equatable {
    let eventID: String
    let assetID: String
    let kind: ChatMoneyKind?
    let eventType: ChatMoneyReceiptEventType
    let actorID: String
    let actorName: String
    let senderID: String
    let senderName: String
    let scope: ChatMoneyScope
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case eventID = "event_id"
        case assetID = "asset_id"
        case kind
        case eventType = "event_type"
        case actorID = "actor_id"
        case actorName = "actor_name"
        case senderID = "sender_id"
        case senderName = "sender_name"
        case scope
        case createdAt = "created_at"
    }

    static func parse(_ content: String) -> ChatMoneyReceiptPayload? {
        parse(content, depth: 0)
    }

    static func isReceiptMessageType(_ rawValue: String?) -> Bool {
        guard let rawValue else { return false }
        let normalized = rawValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")
        return [
            "chat_money_receipt",
            "chat_money_event",
            "money_receipt",
            "red_packet_receipt"
        ].contains(normalized)
    }

    private static func parse(_ content: String, depth: Int) -> ChatMoneyReceiptPayload? {
        guard depth < 4 else { return nil }
        let normalized = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, let data = normalized.data(using: .utf8) else {
            return nil
        }

        if let decoded = try? JSONDecoder().decode(ChatMoneyReceiptPayload.self, from: data) {
            // Some servers keep the asset kind under `asset_kind` or a nested
            // `asset` object. Enrich a normally decoded receipt when possible.
            if decoded.kind == nil,
               let object = try? JSONSerialization.jsonObject(
                   with: data,
                   options: [.fragmentsAllowed]
               ),
               let enriched = parseJSONObject(object, depth: depth),
               enriched.kind != nil {
                return enriched
            }
            return decoded
        }

        guard let object = try? JSONSerialization.jsonObject(
            with: data,
            options: [.fragmentsAllowed]
        ) else {
            return nil
        }
        return parseJSONObject(object, depth: depth)
    }

    private static func parseJSONObject(
        _ object: Any,
        depth: Int
    ) -> ChatMoneyReceiptPayload? {
        if let encoded = object as? String {
            return parse(encoded, depth: depth + 1)
        }
        guard let dictionary = object as? [String: Any] else { return nil }

        if let payload = payload(from: dictionary) {
            return payload
        }

        for key in [
            "content",
            "payload",
            "data",
            "receipt",
            "receipt_message",
            "receiptMessage",
            "event"
        ] {
            guard let nested = dictionary[key] else { continue }
            if let encoded = nested as? String,
               let payload = parse(encoded, depth: depth + 1) {
                return payload
            }
            if let payload = parseJSONObject(nested, depth: depth + 1) {
                return payload
            }
        }
        return nil
    }

    private static func payload(from dictionary: [String: Any]) -> ChatMoneyReceiptPayload? {
        func string(_ keys: [String], in source: [String: Any]? = nil) -> String? {
            let source = source ?? dictionary
            for key in keys {
                if let value = source[key] as? String, !value.isBlank {
                    return value
                }
                if let value = source[key] as? NSNumber {
                    return value.stringValue
                }
            }
            return nil
        }

        let actor = dictionary["actor"] as? [String: Any] ?? [:]
        let sender = dictionary["sender"] as? [String: Any] ?? [:]
        let asset = dictionary["asset"] as? [String: Any] ?? [:]
        guard let assetID = string(["asset_id", "assetId"]),
              let eventRaw = string(["event_type", "eventType", "type"]),
              let eventType = ChatMoneyReceiptEventType(
                rawValue: eventRaw
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .lowercased()
                    .replacingOccurrences(of: "-", with: "_")
              )
        else {
            return nil
        }

        let actorID = string(["actor_id", "actorId"])
            ?? string(["id", "user_id", "userId"], in: actor)
            ?? ""
        let senderID = string(["sender_id", "senderId"])
            ?? string(["id", "user_id", "userId"], in: sender)
            ?? ""
        let actorName = string(["actor_name", "actorName"])
            ?? string(["name", "nickname"], in: actor)
            ?? actorID
        let senderName = string(["sender_name", "senderName"])
            ?? string(["name", "nickname"], in: sender)
            ?? senderID
        let scopeRaw = string(["scope"])?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let scope: ChatMoneyScope = [
            "group",
            "group_chat",
            "groupchat"
        ].contains(scopeRaw ?? "") ? .group : .direct
        let eventID = string(["event_id", "eventId"])
            ?? "\(assetID):\(eventType.rawValue):\(actorID)"
        let kindRaw = string(["kind", "asset_kind", "assetKind"])
            ?? string(["kind", "asset_kind", "assetKind"], in: asset)
        let kind = kindRaw.flatMap(resolveKind)

        return ChatMoneyReceiptPayload(
            eventID: eventID,
            assetID: assetID,
            kind: kind,
            eventType: eventType,
            actorID: actorID,
            actorName: actorName,
            senderID: senderID,
            senderName: senderName,
            scope: scope,
            createdAt: string(["created_at", "createdAt", "timestamp"]) ?? ""
        )
    }

    @MainActor
    var localizedText: String {
        localizedText(viewerID: AuthManager.shared.currentUser?.userID)
    }

    func localizedText(viewerID: String?) -> String {
        switch eventType {
        case .redPacketClaimed:
            if viewerID == actorID {
                return L10n.tr("chatMoney.receipt.claimedByMe", senderName)
            }
            if viewerID == senderID {
                return L10n.tr("chatMoney.receipt.claimedMine", actorName)
            }
            return L10n.tr("chatMoney.receipt.claimed", actorName, senderName)
        case .transferAccepted:
            if viewerID == actorID, let senderName = validDisplayName(senderName, id: senderID) {
                return L10n.tr("chatMoney.receipt.transferAcceptedByMe", senderName)
            }
            if viewerID == senderID, let actorName = validDisplayName(actorName, id: actorID) {
                return L10n.tr("chatMoney.receipt.transferAcceptedMine", actorName)
            }
            if let actorName = validDisplayName(actorName, id: actorID),
               let senderName = validDisplayName(senderName, id: senderID) {
                return L10n.tr(
                    "chatMoney.receipt.transferAcceptedBetween",
                    actorName,
                    senderName
                )
            }
            return L10n.tr("chatMoney.receipt.transferAccepted")
        case .transferReturned:
            if viewerID == actorID, let senderName = validDisplayName(senderName, id: senderID) {
                return L10n.tr("chatMoney.receipt.transferReturnedByMe", senderName)
            }
            if viewerID == senderID, let actorName = validDisplayName(actorName, id: actorID) {
                return L10n.tr("chatMoney.receipt.transferReturnedMine", actorName)
            }
            if let actorName = validDisplayName(actorName, id: actorID),
               let senderName = validDisplayName(senderName, id: senderID) {
                return L10n.tr(
                    "chatMoney.receipt.transferReturnedBetween",
                    actorName,
                    senderName
                )
            }
            return L10n.tr("chatMoney.receipt.transferReturned")
        case .assetExpiredRefunded:
            switch resolvedKind {
            case .redPacket:
                return L10n.tr("chatMoney.receipt.redPacketExpiredRefunded")
            case .transfer:
                return L10n.tr("chatMoney.receipt.transferExpiredRefunded")
            case nil:
                return L10n.tr("chatMoney.receipt.expiredRefunded")
            }
        }
    }

    private var resolvedKind: ChatMoneyKind? {
        if let kind {
            return kind
        }

        let normalizedAssetID = assetID
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")
        if normalizedAssetID.hasPrefix("red_packet")
            || normalizedAssetID.hasPrefix("redpacket")
            || normalizedAssetID.hasPrefix("rp_") {
            return .redPacket
        }
        if normalizedAssetID.hasPrefix("transfer")
            || normalizedAssetID.hasPrefix("tr_") {
            return .transfer
        }
        return nil
    }

    private static func resolveKind(_ rawValue: String) -> ChatMoneyKind? {
        let normalized = rawValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")
        switch normalized {
        case "red_packet", "redpacket", "packet":
            return .redPacket
        case "transfer":
            return .transfer
        default:
            return nil
        }
    }

    private func validDisplayName(_ name: String, id: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != id else { return nil }
        let unavailableNames = ["未知", "unknown", "null", "nil", "system"]
        return unavailableNames.contains(trimmed.lowercased()) ? nil : trimmed
    }
}

extension Message {
    var isRedPacket: Bool { msgType == ChatMoneyKind.redPacket.rawValue }
    var isTransfer: Bool { msgType == ChatMoneyKind.transfer.rawValue }
    var isSystem: Bool { msgType == "system" }
    var chatMoneyPayload: ChatMoneyPayload? {
        guard isRedPacket || isTransfer else { return nil }
        return ChatMoneyPayload.parse(content)
    }
    var chatMoneyReceiptPayload: ChatMoneyReceiptPayload? {
        ChatMoneyReceiptPayload.parse(content)
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
    var chatMoneyReceiptPayload: ChatMoneyReceiptPayload? {
        ChatMoneyReceiptPayload.parse(content)
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

enum ChatMoneyMessagePromptTone {
    case action
    case waiting
    case status
}

struct ChatMoneyMessagePrompt {
    let text: String
    let tone: ChatMoneyMessagePromptTone
}

enum ChatMoneyMessagePromptResolver {
    static func prompt(
        for payload: ChatMoneyPayload,
        viewerID: String?,
        isFromMe: Bool? = nil
    ) -> ChatMoneyMessagePrompt {
        let normalizedViewerID = viewerID?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let viewerIsSender = normalizedViewerID == payload.senderID || isFromMe == true
        let explicitlyMatchesRecipient = normalizedViewerID.map { viewerID in
            payload.recipientID == viewerID
        } ?? false
        let viewerIsRecipient = explicitlyMatchesRecipient
            || (payload.scope == .direct && !viewerIsSender && isFromMe == false)

        guard payload.status == .pending || payload.status == .partial else {
            let text: String
            if payload.kind == .transfer {
                switch payload.status {
                case .accepted:
                    if viewerIsSender {
                        text = L10n.tr("chatMoney.transfer.card.acceptedByRecipient")
                    } else if viewerIsRecipient {
                        text = L10n.tr("chatMoney.transfer.card.receivedByMe")
                    } else {
                        text = payload.status.localizedTitle
                    }
                case .returned:
                    if viewerIsSender {
                        text = L10n.tr("chatMoney.transfer.card.returnedToMe")
                    } else if viewerIsRecipient {
                        text = L10n.tr("chatMoney.transfer.card.returnedByMe")
                    } else {
                        text = payload.status.localizedTitle
                    }
                case .expiredRefunded:
                    text = L10n.tr("chatMoney.transfer.card.expiredRefunded")
                default:
                    text = payload.status.localizedTitle
                }
            } else {
                text = payload.status.localizedTitle
            }
            return ChatMoneyMessagePrompt(text: text, tone: .status)
        }

        switch payload.kind {
        case .transfer:
            if viewerIsRecipient {
                return ChatMoneyMessagePrompt(
                    text: L10n.tr("chatMoney.transfer.receivePrompt"),
                    tone: .action
                )
            }
            if viewerIsSender {
                return ChatMoneyMessagePrompt(
                    text: L10n.tr("chatMoney.transfer.waitingForRecipient"),
                    tone: .waiting
                )
            }
            return ChatMoneyMessagePrompt(
                text: L10n.tr("chatMoney.transfer.pendingReceipt"),
                tone: .status
            )

        case .redPacket:
            let viewerCanClaim: Bool
            switch (payload.scope, payload.mode) {
            case (.group, .lucky), (.group, .equal):
                viewerCanClaim = true
            case (_, .exclusive):
                viewerCanClaim = viewerIsRecipient
            case (.direct, _):
                viewerCanClaim = viewerIsRecipient
                    || (!viewerIsSender && isFromMe == false)
            default:
                viewerCanClaim = false
            }

            if viewerCanClaim {
                return ChatMoneyMessagePrompt(
                    text: L10n.tr("chatMoney.redPacket.claimPrompt"),
                    tone: .action
                )
            }
            if viewerIsSender {
                return ChatMoneyMessagePrompt(
                    text: payload.mode == .exclusive
                        ? L10n.tr("chatMoney.redPacket.waitingForExclusiveRecipient")
                        : L10n.tr("chatMoney.redPacket.waitingForRecipient"),
                    tone: .waiting
                )
            }
            return ChatMoneyMessagePrompt(
                text: payload.status.localizedTitle,
                tone: .status
            )
        }
    }
}

enum ChatMoneyPreview {
    static func isReceipt(content: String?, msgType: String?) -> Bool {
        if let content, ChatMoneyReceiptPayload.parse(content) != nil {
            return true
        }
        return ChatMoneyReceiptPayload.isReceiptMessageType(msgType)
    }

    static func isReceiptDisplayText(_ content: String) -> Bool {
        let receiptKeys = [
            "chatMoney.receipt.claimedByMe",
            "chatMoney.receipt.claimedMine",
            "chatMoney.receipt.claimed",
            "chatMoney.receipt.transferAccepted",
            "chatMoney.receipt.transferAcceptedByMe",
            "chatMoney.receipt.transferAcceptedMine",
            "chatMoney.receipt.transferAcceptedBetween",
            "chatMoney.receipt.transferReturned",
            "chatMoney.receipt.transferReturnedByMe",
            "chatMoney.receipt.transferReturnedMine",
            "chatMoney.receipt.transferReturnedBetween",
            "chatMoney.receipt.redPacketExpiredRefunded",
            "chatMoney.receipt.transferExpiredRefunded",
            "chatMoney.receipt.expiredRefunded",
            "chatMoney.receipt.activity"
        ]
        return receiptKeys.contains { matchesLocalizedTemplate(content, key: $0) }
    }

    static func text(
        content: String?,
        msgType: String?,
        viewerID: String? = nil
    ) -> String? {
        let type = msgType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let receipt = content.flatMap(ChatMoneyReceiptPayload.parse) {
            return receipt.localizedText(viewerID: viewerID)
        }
        if ChatMoneyReceiptPayload.isReceiptMessageType(type) {
            return L10n.tr("chatMoney.receipt.activity")
        }

        if let payload = content.flatMap(ChatMoneyPayload.parse) {
            let base = payload.kind == .redPacket
                ? L10n.tr("chatMoney.preview.redPacket")
                : L10n.tr("chatMoney.preview.transfer")
            guard viewerID != nil else { return base }
            let prompt = ChatMoneyMessagePromptResolver.prompt(
                for: payload,
                viewerID: viewerID
            )
            return "\(base) \(prompt.text)"
        }
        if type == ChatMoneyKind.redPacket.rawValue {
            return L10n.tr("chatMoney.preview.redPacket")
        }
        if type == ChatMoneyKind.transfer.rawValue {
            return L10n.tr("chatMoney.preview.transfer")
        }
        return nil
    }

    private static func matchesLocalizedTemplate(_ content: String, key: String) -> Bool {
        let template = L10n.tr(key)
        guard template != key else { return false }
        let literalParts = template
            .components(separatedBy: "%@")
            .filter { !$0.isEmpty }
        guard !literalParts.isEmpty else { return false }
        if !template.contains("%@") {
            return content == template
        }

        var searchStart = content.startIndex
        for part in literalParts {
            guard let range = content.range(
                of: part,
                range: searchStart..<content.endIndex
            ) else {
                return false
            }
            searchStart = range.upperBound
        }
        return true
    }
}
