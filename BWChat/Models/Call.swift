// BWChat/Models/Call.swift
// Data models for voice/video calls (LiveKit-backed)

import Foundation

enum CallType: String, Codable, Equatable, Sendable {
    case voice
    case video
}

enum LiveExperienceCardKind: String, Codable, CaseIterable, Equatable, Hashable, Identifiable, Sendable {
    case fiveMinutes = "5m"
    case tenMinutes = "10m"
    case fifteenMinutes = "15m"

    var id: String { definitionID }

    var minutes: Int {
        switch self {
        case .fiveMinutes: return 5
        case .tenMinutes: return 10
        case .fifteenMinutes: return 15
        }
    }

    var durationSeconds: Int { minutes * 60 }

    var definitionID: String { "live_experience_card_\(rawValue)" }

    var assetName: String { "prop_live_experience_card_\(rawValue)" }

    var localizedName: String {
        L10n.tr("prop.liveExperienceCard.name", minutes)
    }

    var localizedDescription: String {
        L10n.tr("prop.liveExperienceCard.description", minutes)
    }

    init?(definitionID: String) {
        guard let kind = Self.allCases.first(where: { $0.definitionID == definitionID }) else {
            return nil
        }
        self = kind
    }

    init?(durationSeconds: Int) {
        guard let kind = Self.allCases.first(where: { $0.durationSeconds == durationSeconds }) else {
            return nil
        }
        self = kind
    }
}

enum LiveCallPaymentMethod: Equatable, Sendable {
    case spendableBalance
    case experienceCard(LiveExperienceCardKind)

    var requestFields: [String: Any] {
        switch self {
        case .spendableBalance:
            // Preserve the existing request shape for older servers.
            return [:]
        case .experienceCard(let kind):
            return [
                "payment_method": "prop_card",
                "prop_definition_id": kind.definitionID
            ]
        }
    }

    var experienceCardKind: LiveExperienceCardKind? {
        guard case .experienceCard(let kind) = self else { return nil }
        return kind
    }

    var requiresStartingBalance: Bool {
        self == .spendableBalance
    }

    var idempotencyScope: String {
        switch self {
        case .spendableBalance:
            return "spendable_balance"
        case .experienceCard(let kind):
            return "prop_card:\(kind.definitionID)"
        }
    }
}

struct LiveCallInvitationRequest: Equatable, Sendable {
    let callType: CallType
    let paymentMethod: LiveCallPaymentMethod
    let idempotencyKey: UUID

    var body: [String: Any] {
        var value: [String: Any] = ["call_type": callType.rawValue]
        paymentMethod.requestFields.forEach { value[$0.key] = $0.value }
        return value
    }

    var idempotencyHeaderValue: String {
        idempotencyKey.uuidString
    }
}

enum LiveExperienceStatus: String, Decodable, Equatable, Sendable {
    case reserved
    case active
    case consumed
    case released
    case completed
    case unknown

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = (try? container.decode(String.self))?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_") ?? ""
        self = Self(rawValue: raw) ?? .unknown
    }

    var isReservedOrActive: Bool {
        self == .reserved || self == .active || self == .consumed
    }
}

struct LiveExperienceSnapshot: Decodable, Equatable, Sendable {
    let definitionID: String
    let durationSeconds: Int
    let status: LiveExperienceStatus
    let startedAt: String?
    let endsAt: String?
    let remainingSeconds: Int?
    let autoContinuePaymentMethod: String?
    let hostEarningEnabled: Bool
    let reservedProp: PropConsumptionResult?
    let consumedProp: PropConsumptionResult?
    let serverTime: String?
    private let receivedAt: Date

    enum CodingKeys: String, CodingKey {
        case definitionID = "definition_id"
        case propDefinitionID = "prop_definition_id"
        case durationSeconds = "duration_seconds"
        case status
        case startedAt = "started_at"
        case connectedAt = "connected_at"
        case endsAt = "ends_at"
        case experienceEndsAt = "experience_ends_at"
        case remainingSeconds = "remaining_seconds"
        case autoContinuePaymentMethod = "auto_continue_payment_method"
        case hostEarningEnabled = "host_earning_enabled"
        case reservedProp = "reserved_prop"
        case consumedProp = "consumed_prop"
        case serverTime = "server_time"
    }

    init(
        definitionID: String,
        durationSeconds: Int,
        status: LiveExperienceStatus,
        startedAt: String? = nil,
        endsAt: String? = nil,
        remainingSeconds: Int? = nil,
        autoContinuePaymentMethod: String? = "spendable_balance",
        hostEarningEnabled: Bool = false,
        reservedProp: PropConsumptionResult? = nil,
        consumedProp: PropConsumptionResult? = nil,
        serverTime: String? = nil,
        receivedAt: Date = Date()
    ) {
        self.definitionID = definitionID
        self.durationSeconds = max(durationSeconds, 0)
        self.status = status
        self.startedAt = startedAt
        self.endsAt = endsAt
        self.remainingSeconds = remainingSeconds.map { max($0, 0) }
        self.autoContinuePaymentMethod = autoContinuePaymentMethod
        self.hostEarningEnabled = hostEarningEnabled
        self.reservedProp = reservedProp
        self.consumedProp = consumedProp
        self.serverTime = serverTime
        self.receivedAt = receivedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let definitionID = container.flexString(for: .definitionID)
            ?? container.flexString(for: .propDefinitionID)
            ?? ""
        let decodedDuration = container.flexInt(for: .durationSeconds)
            ?? LiveExperienceCardKind(definitionID: definitionID)?.durationSeconds
            ?? 0
        self.init(
            definitionID: definitionID,
            durationSeconds: decodedDuration,
            status: (try? container.decode(LiveExperienceStatus.self, forKey: .status)) ?? .unknown,
            startedAt: container.flexString(for: .startedAt)
                ?? container.flexString(for: .connectedAt),
            endsAt: container.flexString(for: .endsAt)
                ?? container.flexString(for: .experienceEndsAt),
            remainingSeconds: container.flexInt(for: .remainingSeconds),
            autoContinuePaymentMethod: container.flexString(for: .autoContinuePaymentMethod),
            hostEarningEnabled: container.flexBool(for: .hostEarningEnabled) ?? false,
            reservedProp: try container.decodeIfPresent(PropConsumptionResult.self, forKey: .reservedProp),
            consumedProp: try container.decodeIfPresent(PropConsumptionResult.self, forKey: .consumedProp),
            serverTime: container.flexString(for: .serverTime)
        )
    }

    var cardKind: LiveExperienceCardKind? {
        LiveExperienceCardKind(definitionID: definitionID)
            ?? LiveExperienceCardKind(durationSeconds: durationSeconds)
    }

    func displayRemainingSeconds(connectedDuration: TimeInterval, now: Date = Date()) -> Int {
        if status == .released || status == .completed { return 0 }
        let elapsedSinceSnapshot = max(now.timeIntervalSince(receivedAt), 0)
        if let endsAt,
           let endDate = Self.date(from: endsAt),
           let serverTime,
           let serverDate = Self.date(from: serverTime) {
            return max(Int(ceil(endDate.timeIntervalSince(serverDate) - elapsedSinceSnapshot)), 0)
        }
        if let remainingSeconds {
            return max(Int(ceil(TimeInterval(remainingSeconds) - elapsedSinceSnapshot)), 0)
        }
        if let endsAt, let endDate = Self.date(from: endsAt) {
            return max(Int(ceil(endDate.timeIntervalSince(now))), 0)
        }
        return LiveExperienceBillingPolicy.remainingSeconds(
            durationSeconds: durationSeconds,
            connectedDuration: connectedDuration
        )
    }

    func anchored(serverTime: String?) -> LiveExperienceSnapshot {
        LiveExperienceSnapshot(
            definitionID: definitionID,
            durationSeconds: durationSeconds,
            status: status,
            startedAt: startedAt,
            endsAt: endsAt,
            remainingSeconds: remainingSeconds,
            autoContinuePaymentMethod: autoContinuePaymentMethod,
            hostEarningEnabled: hostEarningEnabled,
            reservedProp: reservedProp,
            consumedProp: consumedProp,
            serverTime: serverTime ?? self.serverTime
        )
    }

    private static func date(from value: String) -> Date? {
        fractionalFormatter.date(from: value) ?? formatter.date(from: value)
    }

    private static let fractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let formatter = ISO8601DateFormatter()
}

enum LiveExperienceBillingPolicy {
    static func shouldConsumeCard(connectedDuration: TimeInterval, freeSeconds: Int) -> Bool {
        connectedDuration > TimeInterval(max(freeSeconds, 0))
    }

    static func remainingSeconds(durationSeconds: Int, connectedDuration: TimeInterval) -> Int {
        max(Int(ceil(TimeInterval(max(durationSeconds, 0)) - max(connectedDuration, 0))), 0)
    }

    static func overageDuration(durationSeconds: Int, connectedDuration: TimeInterval) -> TimeInterval {
        max(connectedDuration - TimeInterval(max(durationSeconds, 0)), 0)
    }

    static func accruedOverageAmount(
        durationSeconds: Int,
        connectedDuration: TimeInterval,
        policy: LiveBillingPolicy
    ) -> Int {
        let overage = overageDuration(
            durationSeconds: durationSeconds,
            connectedDuration: connectedDuration
        )
        guard overage > 0 else { return 0 }
        return Int(ceil(overage / TimeInterval(policy.unitSeconds))) * policy.amountPerUnit
    }
}

enum LiveSlotCallTypePolicy {
    static let selectionOrder: [CallType] = [.voice, .video]

    static func normalized(_ callTypes: [CallType]) -> [CallType] {
        selectionOrder.filter(callTypes.contains)
    }

    static func effective(
        globallySupported: [CallType],
        hostAllowed: [CallType]?
    ) -> [CallType] {
        normalized(globallySupported).filter { callType in
            hostAllowed?.contains(callType) ?? true
        }
    }
}

enum CallState: Equatable {
    case idle
    case outgoing
    case incoming
    case connecting
    case connected
    case ended
}

enum LiveHostCallEndPolicy {
    static func shouldReturnToLobby(isLivePairCall: Bool, isOutgoing: Bool) -> Bool {
        isLivePairCall && !isOutgoing
    }
}

enum LiveCallEntrySource: Equatable {
    case lobby
    case agentMatch
}

struct LiveCallRoleIntroduction: Equatable {
    let title: String
    let detail: String
}

struct LiveCallRoleContext: Equatable {
    let source: LiveCallEntrySource
    let roleSetting: String

    init?(source: LiveCallEntrySource, roleSetting: String?) {
        let trimmed = roleSetting?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return nil }
        self.source = source
        self.roleSetting = trimmed
    }

    func introduction(isOutgoing: Bool) -> LiveCallRoleIntroduction {
        switch (source, isOutgoing) {
        case (.lobby, true):
            return LiveCallRoleIntroduction(title: "对方正在扮演", detail: roleSetting)
        case (.lobby, false):
            return LiveCallRoleIntroduction(title: "我正在扮演", detail: roleSetting)
        case (.agentMatch, true):
            return LiveCallRoleIntroduction(title: "我希望对方扮演", detail: roleSetting)
        case (.agentMatch, false):
            return LiveCallRoleIntroduction(title: "对方希望我扮演", detail: roleSetting)
        }
    }
}

struct LiveBillingPolicy: Decodable, Equatable {
    static let fallback = LiveBillingPolicy(
        currency: "spendable_balance",
        freeSeconds: 10,
        unitSeconds: 60,
        amountPerUnit: 100,
        minimumStartingBalance: 100,
        rounding: "started_unit"
    )

    let currency: String
    let freeSeconds: Int
    let unitSeconds: Int
    let amountPerUnit: Int
    let minimumStartingBalance: Int
    let rounding: String

    enum CodingKeys: String, CodingKey {
        case currency
        case freeSeconds = "free_seconds"
        case unitSeconds = "unit_seconds"
        case amountPerUnit = "amount_per_unit"
        case minimumStartingBalance = "minimum_starting_balance"
        case rounding
    }

    init(
        currency: String,
        freeSeconds: Int,
        unitSeconds: Int,
        amountPerUnit: Int,
        minimumStartingBalance: Int,
        rounding: String
    ) {
        let normalizedCurrency = currency.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedRounding = rounding.trimmingCharacters(in: .whitespacesAndNewlines)
        self.currency = normalizedCurrency.isEmpty ? "spendable_balance" : normalizedCurrency
        self.freeSeconds = max(freeSeconds, 0)
        self.unitSeconds = unitSeconds > 0 ? unitSeconds : 60
        self.amountPerUnit = amountPerUnit > 0 ? amountPerUnit : 100
        self.minimumStartingBalance = minimumStartingBalance > 0
            ? minimumStartingBalance
            : self.amountPerUnit
        self.rounding = normalizedRounding.isEmpty ? "started_unit" : normalizedRounding
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            currency: container.flexString(for: .currency) ?? "spendable_balance",
            freeSeconds: container.flexInt(for: .freeSeconds) ?? 10,
            unitSeconds: container.flexInt(for: .unitSeconds) ?? 60,
            amountPerUnit: container.flexInt(for: .amountPerUnit) ?? 100,
            minimumStartingBalance: container.flexInt(for: .minimumStartingBalance) ?? 100,
            rounding: container.flexString(for: .rounding) ?? "started_unit"
        )
    }

    func canStart(balance: Int) -> Bool {
        balance >= minimumStartingBalance
    }

    func billedUnits(for connectedDuration: TimeInterval) -> Int {
        let duration = max(connectedDuration, 0)
        guard duration > TimeInterval(freeSeconds) else { return 0 }
        return Int(ceil(duration / TimeInterval(unitSeconds)))
    }

    func accruedAmount(for connectedDuration: TimeInterval) -> Int {
        billedUnits(for: connectedDuration) * amountPerUnit
    }

    func freeSecondsRemaining(for connectedDuration: TimeInterval) -> Int {
        max(Int(ceil(TimeInterval(freeSeconds) - max(connectedDuration, 0))), 0)
    }

    var compactRateText: String {
        unitSeconds == 60
            ? L10n.tr("live.billing.ratePerMinute", amountPerUnit)
            : L10n.tr("live.billing.ratePerSeconds", amountPerUnit, unitSeconds)
    }

    var fullRuleText: String {
        unitSeconds == 60
            ? L10n.tr("live.billing.rulePerMinute", freeSeconds, amountPerUnit)
            : L10n.tr("live.billing.rulePerSeconds", freeSeconds, unitSeconds, amountPerUnit)
    }
}

enum LiveCallBillingPolicy {
    static let minimumStartingBalance = LiveBillingPolicy.fallback.minimumStartingBalance
    static let freeSeconds = TimeInterval(LiveBillingPolicy.fallback.freeSeconds)
    static let billingUnitSeconds = TimeInterval(LiveBillingPolicy.fallback.unitSeconds)
    static let spendableAmountPerUnit = LiveBillingPolicy.fallback.amountPerUnit

    static func canStart(balance: Int) -> Bool {
        LiveBillingPolicy.fallback.canStart(balance: balance)
    }

    static func billedUnits(for connectedDuration: TimeInterval) -> Int {
        LiveBillingPolicy.fallback.billedUnits(for: connectedDuration)
    }

    static func accruedSpendableAmount(for connectedDuration: TimeInterval) -> Int {
        LiveBillingPolicy.fallback.accruedAmount(for: connectedDuration)
    }

    static func freeSecondsRemaining(for connectedDuration: TimeInterval) -> Int {
        LiveBillingPolicy.fallback.freeSecondsRemaining(for: connectedDuration)
    }
}

enum LiveCallTerminationPolicy {
    static let defaultGraceMilliseconds = 2_600
    static let reconciliationMilliseconds = 800

    static func isInsufficientBalance(_ data: [String: Any]) -> Bool {
        let keys = [
            "reason",
            "status",
            "end_reason",
            "reason_code",
            "message_code",
            "code"
        ]
        return keys.contains { key in
            guard let raw = string(data[key]) else { return false }
            let normalized = raw
                .lowercased()
                .replacingOccurrences(of: "-", with: "_")
                .replacingOccurrences(of: " ", with: "_")
            return normalized == "billing_insufficient"
                || normalized == "insufficient_balance"
                || normalized == "insufficient_funds"
                || normalized == "balance_insufficient"
                || (normalized.contains("insufficient") && normalized.contains("balance"))
        }
    }

    static func message(isPayer: Bool, callType: CallType = .video) -> String {
        let media = callType == .voice ? "语音" : "视频"
        return isPayer
            ? "金币余额不足，本次\(media)即将结束"
            : "对方余额不足，本次\(media)即将结束"
    }

    static func graceNanoseconds(_ data: [String: Any]) -> UInt64 {
        let requested = int(data["termination_grace_ms"] ?? data["grace_ms"])
        let milliseconds: Int
        if let requested, (1_500...5_000).contains(requested) {
            milliseconds = requested
        } else {
            milliseconds = defaultGraceMilliseconds
        }
        return UInt64(milliseconds) * 1_000_000
    }

    private static func string(_ value: Any?) -> String? {
        if let value = value as? String {
            return value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let value = value as? NSNumber {
            return value.stringValue
        }
        return nil
    }

    private static func int(_ value: Any?) -> Int? {
        if let value = value as? Int { return value }
        if let value = value as? NSNumber { return value.intValue }
        if let value = value as? String { return Int(value) }
        return nil
    }
}

enum LiveCallTerminationPresentationPolicy {
    static func billingDetail(
        isPayer: Bool,
        chargedActivityCatFood: Int?,
        chargedGoldCoins: Int?,
        totalCharged: Int?,
        earnedGoldCoins: Int?,
        goldCoinBalanceAfter: Int?,
        activityCatFoodBalanceAfter: Int?,
        spendableBalanceAfter: Int?
    ) -> String? {
        if isPayer {
            var lines: [String] = []
            if let chargedActivityCatFood, chargedActivityCatFood > 0 {
                lines.append(L10n.tr("live.billing.chargedActivityCatFood", chargedActivityCatFood))
            }
            if let chargedGoldCoins, chargedGoldCoins > 0 {
                lines.append(L10n.tr("live.billing.chargedGoldCoins", chargedGoldCoins))
            }
            if let totalCharged {
                lines.append(L10n.tr("live.billing.totalCharged", max(totalCharged, 0)))
            }
            if let goldCoinBalanceAfter,
               let activityCatFoodBalanceAfter,
               let spendableBalanceAfter {
                lines.append(L10n.tr(
                    "live.billing.balanceAfter",
                    max(goldCoinBalanceAfter, 0),
                    max(activityCatFoodBalanceAfter, 0),
                    max(spendableBalanceAfter, 0)
                ))
            }
            return lines.isEmpty ? nil : lines.joined(separator: "\n")
        }

        if let earnedGoldCoins {
            return L10n.tr("live.billing.earnedGoldCoins", max(earnedGoldCoins, 0))
        }
        return nil
    }
}

enum LiveCallBusinessErrorPolicy {
    static func message(code: String?, serverMessage: String?) -> String? {
        let message = serverMessage?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        switch code?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased() {
        case "LIVE_HOST_CANNOT_CALL_OTHER_HOST":
            return message?.isEmpty == false
                ? message
                : LiveCallInitiationPolicy.hostingBlockMessage
        case "LIVE_SELF_CALL_FORBIDDEN":
            return "这是你的直播，其他用户可以从这里与你连线"
        case "LIVE_CALL_TYPE_NOT_ALLOWED":
            return message?.isEmpty == false
                ? message
                : "该主播未开放这种连线方式"
        case "PROP_NOT_OWNED", "PROP_EXPIRED", "PROP_NOT_CONSUMABLE":
            return L10n.tr("live.experience.error.unavailable")
        case "PROP_ALREADY_RESERVED", "LIVE_EXPERIENCE_CARD_BUSY":
            return L10n.tr("live.experience.error.busy")
        case "LIVE_EXPERIENCE_CARD_MISMATCH":
            return L10n.tr("live.experience.error.mismatch")
        default:
            return message?.isEmpty == false ? message : nil
        }
    }
}

enum LiveCallInitiationPolicy {
    static let hostingBlockMessage = "正在直播，无法与其他在直播的人视频"
    static let liveLobbyHostingBlockMessage = "正在直播，无法与其他主播连线"

    static func canInitiate(isCurrentUserLive: Bool) -> Bool {
        !isCurrentUserLive
    }
}

/// A direct-call history item encoded as a backwards-compatible text message.
/// The server remains readable by older clients (for example
/// `[视频通话] 通话时长 00:19`), while newer clients can render the same payload as
/// a dedicated WeChat-style call bubble.
struct CallRecordContent: Equatable {
    enum Status: Equatable {
        case completed(duration: String)
        case cancelled
        case rejected
        case missed
        case busy
    }

    let callType: CallType
    let status: Status

    var systemImage: String {
        callType == .video ? "video.fill" : "phone.fill"
    }

    func localizedDetail(isFromMe: Bool) -> String {
        switch status {
        case let .completed(duration):
            return L10n.tr("call.record.duration", duration)
        case .cancelled:
            return L10n.tr(isFromMe ? "call.record.cancelled.self" : "call.record.cancelled.peer")
        case .rejected:
            return L10n.tr(isFromMe ? "call.record.rejected.peer" : "call.record.rejected.self")
        case .missed:
            return L10n.tr(isFromMe ? "call.record.unanswered.peer" : "call.record.missed.self")
        case .busy:
            return L10n.tr(isFromMe ? "call.record.busy.peer" : "call.record.busy.self")
        }
    }

    static func parse(_ content: String) -> CallRecordContent? {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("["),
              let closeBracket = trimmed.firstIndex(of: "]") else { return nil }

        let labelStart = trimmed.index(after: trimmed.startIndex)
        let label = String(trimmed[labelStart ..< closeBracket])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let detailStart = trimmed.index(after: closeBracket)
        let detail = String(trimmed[detailStart...])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !detail.isEmpty, let callType = callType(from: label) else { return nil }

        if let duration = duration(in: detail) {
            return CallRecordContent(callType: callType, status: .completed(duration: duration))
        }

        let normalized = detail.lowercased()
        if containsAny(normalized, values: ["已取消", "對方已取消", "对方已取消", "cancelled", "canceled"]) {
            return CallRecordContent(callType: callType, status: .cancelled)
        }
        if containsAny(normalized, values: ["已拒绝", "已拒絕", "reject", "declined"]) {
            return CallRecordContent(callType: callType, status: .rejected)
        }
        if containsAny(normalized, values: ["忙线", "忙線", "busy"]) {
            return CallRecordContent(callType: callType, status: .busy)
        }
        if containsAny(
            normalized,
            values: [
                "未接听", "未接聽", "无应答", "無應答", "no answer", "missed", "unanswered",
                "keine antwort", "sin respuesta", "pas de réponse", "応答", "不在着信",
                "받지 않", "부재중", "sem resposta", "нет ответа", "пропущ"
            ]
        ) {
            return CallRecordContent(callType: callType, status: .missed)
        }
        return nil
    }

    private static func callType(from label: String) -> CallType? {
        let normalized = label.lowercased()
        if containsAny(
            normalized,
            values: ["视频", "視訊", "影片", "video", "vídeo", "ビデオ", "영상", "видео"]
        ) {
            return .video
        }
        if containsAny(
            normalized,
            values: [
                "语音", "語音", "voice", "audio", "voz", "音声", "음성",
                "sprach", "vocal", "голос"
            ]
        ) {
            return .voice
        }
        return nil
    }

    private static func duration(in detail: String) -> String? {
        guard let match = detail.range(
            of: #"(?<!\d)(?:\d{1,2}:)?\d{2}:\d{2}(?!\d)"#,
            options: .regularExpression
        ) else { return nil }
        return String(detail[match])
    }

    private static func containsAny(_ value: String, values: [String]) -> Bool {
        values.contains { value.localizedCaseInsensitiveContains($0) }
    }
}

/// Small, privacy-preserving WebRTC summary uploaded after a video call. The
/// server logs it by authenticated call participant so real-device quality can
/// be diagnosed without collecting media, IP addresses, or device identifiers.
struct CallQualityStreamReport: Equatable {
    var width: Int?
    var height: Int?
    var fps: Double?
    var bitrateBps: Int?
    var packetsLost: Int?
    var nackCount: Int?
    var pliCount: Int?
    var firCount: Int?
    var framesDropped: Int?
    var freezeCount: Int?
    var rttMs: Double?
    var fractionLost: Double?
    var qualityLimitationReason: String?

    var body: [String: Any] {
        var result: [String: Any] = [:]
        if let width { result["width"] = width }
        if let height { result["height"] = height }
        if let fps { result["fps"] = fps }
        if let bitrateBps { result["bitrate_bps"] = bitrateBps }
        if let packetsLost { result["packets_lost"] = packetsLost }
        if let nackCount { result["nack"] = nackCount }
        if let pliCount { result["pli"] = pliCount }
        if let firCount { result["fir"] = firCount }
        if let framesDropped { result["frames_dropped"] = framesDropped }
        if let freezeCount { result["freeze_count"] = freezeCount }
        if let rttMs { result["rtt_ms"] = rttMs }
        if let fractionLost { result["fraction_lost"] = fractionLost }
        if let qualityLimitationReason { result["quality_limitation_reason"] = qualityLimitationReason }
        return result
    }
}

struct CallQualityReport: Equatable {
    let appBuild: String
    let sampleCount: Int
    let outbound: CallQualityStreamReport?
    let inbound: CallQualityStreamReport?
    let iceTransport: String?
    let relay: Bool?

    var body: [String: Any] {
        var result: [String: Any] = [
            "app_build": appBuild,
            "sample_count": sampleCount
        ]
        if let outbound { result["outbound"] = outbound.body }
        if let inbound { result["inbound"] = inbound.body }
        if let iceTransport { result["ice_transport"] = iceTransport }
        if let relay { result["relay"] = relay }
        return result
    }
}

/// Decides when a LiveKit room becoming empty means the current client should
/// leave as well. A newly-created group room is allowed to wait for its first
/// guest; after another participant has joined, returning to one local member
/// ends the call automatically.
enum CallParticipantDeparturePolicy {
    static func shouldScheduleAutoExit(
        isGroupCall: Bool,
        hasObservedRemoteParticipant: Bool,
        remoteParticipantCount: Int
    ) -> Bool {
        guard remoteParticipantCount == 0 else { return false }
        return !isGroupCall || hasObservedRemoteParticipant
    }
}

/// Decides when a remote LiveKit participant is enough to promote an outgoing
/// call to the connected state. Ordinary direct calls wait for remote audio so
/// their timer does not start while the callee is still ringing. A live-pair
/// call reaches this path only after its lightweight invitation was accepted,
/// so the remote participant joining the room is the connection boundary.
enum CallConnectionTransitionPolicy {
    static func shouldMarkConnected(
        isOutgoing: Bool,
        isGroupCall: Bool,
        isLivePairCall: Bool,
        state: CallState,
        remoteParticipantCount: Int,
        hasRemoteAudio: Bool
    ) -> Bool {
        guard isOutgoing, remoteParticipantCount > 0 else { return false }

        switch state {
        case .outgoing:
            return isGroupCall || hasRemoteAudio
        case .connecting:
            return isLivePairCall
        default:
            return false
        }
    }
}

/// Stable server-side identity used to correlate duplicate invitations and
/// lifecycle signals. `call_id` is preferred, with the LiveKit room name as a
/// compatibility fallback for older server responses.
struct CallSignalIdentity: Equatable {
    let callID: String?
    let roomName: String?

    init(callID: String?, roomName: String?) {
        self.callID = Self.normalized(callID)
        self.roomName = Self.normalized(roomName)
    }

    var isEmpty: Bool {
        callID == nil && roomName == nil
    }

    func hasComparableKey(with other: CallSignalIdentity) -> Bool {
        (callID != nil && other.callID != nil) ||
        (roomName != nil && other.roomName != nil)
    }

    func matches(_ other: CallSignalIdentity) -> Bool {
        if let callID, let otherCallID = other.callID {
            return callID == otherCallID
        }
        if let roomName, let otherRoomName = other.roomName {
            return roomName == otherRoomName
        }
        return false
    }

    private static func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

struct CallSession: Identifiable {
    let id = UUID()
    let remoteUserID: String
    let remoteNickname: String
    let remoteAvatarURL: String
    let callType: CallType
    let isOutgoing: Bool
    var state: CallState
    let startedAt: Date

    // LiveKit room info
    var serverCallID: String? = nil
    var roomName: String = ""
    var livekitToken: String = ""
    var livekitURL: String = ""

    // Group call: nil for 1v1
    var groupID: Int?
    var groupName: String?

    // Accepted from the lightweight one-to-one live lobby flow. This lets
    // teardown refresh the direct-conversation row without changing ordinary
    // friend-call behavior.
    var isLivePairCall = false
    var liveRoleContext: LiveCallRoleContext?
    var liveBillingPolicy: LiveBillingPolicy?
    var liveExperience: LiveExperienceSnapshot?
    var isLiveRoleIntroductionDismissed = false
    /// Confirmed by a billing WebSocket event. The UI can still show the
    /// deterministic accrued amount while an event is in flight.
    var confirmedLiveActivityCatFoodCharge: Int?
    var confirmedLiveGoldCoinCharge: Int?
    var confirmedLiveTotalCharge: Int?
    /// Confirmed earnings for the host side of a paid live call.
    var confirmedLiveEarningGoldCoins: Int?

    var signalIdentity: CallSignalIdentity {
        CallSignalIdentity(callID: serverCallID, roomName: roomName)
    }

    var durationText: String {
        let elapsed = Int(Date().timeIntervalSince(startedAt))
        let minutes = elapsed / 60
        let seconds = elapsed % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

struct CallStartResponse: Decodable {
    let callID: String?
    let roomName: String
    let token: String
    let livekitUrl: String
    let callType: String
    let participantCount: Int?

    enum CodingKeys: String, CodingKey {
        case callID = "call_id"
        case roomName = "room_name"
        case token
        case livekitUrl = "livekit_url"
        case serverUrl = "server_url"
        case callType = "call_type"
        case participantCount = "participant_count"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        callID = try container.decodeIfPresent(String.self, forKey: .callID)
        roomName = try container.decode(String.self, forKey: .roomName)
        token = try container.decode(String.self, forKey: .token)
        if let value = try container.decodeIfPresent(String.self, forKey: .livekitUrl),
           !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            livekitUrl = value
        } else if let value = try container.decodeIfPresent(String.self, forKey: .serverUrl),
                  !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            livekitUrl = value
        } else {
            livekitUrl = AppConfig.livekitURL
        }
        callType = try container.decode(String.self, forKey: .callType)
        participantCount = try container.decodeIfPresent(Int.self, forKey: .participantCount)
    }
}

struct CallJoinResponse: Decodable {
    let callID: String?
    let roomName: String
    let token: String
    let livekitUrl: String
    let callType: CallType?
    let billingPolicy: LiveBillingPolicy?
    let liveExperience: LiveExperienceSnapshot?

    enum CodingKeys: String, CodingKey {
        case callID = "call_id"
        case roomName = "room_name"
        case token
        case livekitUrl = "livekit_url"
        case serverUrl = "server_url"
        case callType = "call_type"
        case billingPolicy = "billing_policy"
        case liveExperience = "live_experience"
        case experience
        case serverTime = "server_time"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        callID = try container.decodeIfPresent(String.self, forKey: .callID)
        roomName = try container.decode(String.self, forKey: .roomName)
        token = try container.decode(String.self, forKey: .token)
        if let value = try container.decodeIfPresent(String.self, forKey: .livekitUrl),
           !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            livekitUrl = value
        } else if let value = try container.decodeIfPresent(String.self, forKey: .serverUrl),
                  !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            livekitUrl = value
        } else {
            livekitUrl = AppConfig.livekitURL
        }
        callType = try container.decodeIfPresent(CallType.self, forKey: .callType)
        billingPolicy = try container.decodeIfPresent(LiveBillingPolicy.self, forKey: .billingPolicy)
        let decodedExperience = try container.decodeIfPresent(
            LiveExperienceSnapshot.self,
            forKey: .liveExperience
        ) ?? container.decodeIfPresent(LiveExperienceSnapshot.self, forKey: .experience)
        liveExperience = decodedExperience?.anchored(
            serverTime: container.flexString(for: .serverTime)
        )
    }
}

struct LiveCallInvitationResponse: Decodable {
    let callID: String
    let expiresAt: String?
    let callType: CallType
    let billingPolicy: LiveBillingPolicy?
    let liveExperience: LiveExperienceSnapshot?

    enum CodingKeys: String, CodingKey {
        case callID = "call_id"
        case expiresAt = "expires_at"
        case callType = "call_type"
        case billingPolicy = "billing_policy"
        case liveExperience = "live_experience"
        case experience
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        callID = container.flexString(for: .callID) ?? ""
        expiresAt = container.flexString(for: .expiresAt)
        callType = try container.decodeIfPresent(CallType.self, forKey: .callType) ?? .video
        billingPolicy = try container.decodeIfPresent(LiveBillingPolicy.self, forKey: .billingPolicy)
        liveExperience = try container.decodeIfPresent(
            LiveExperienceSnapshot.self,
            forKey: .liveExperience
        ) ?? container.decodeIfPresent(LiveExperienceSnapshot.self, forKey: .experience)
    }
}

struct OneToOneLiveCallState: Decodable, Equatable {
    enum Phase: Equatable {
        case pending
        case accepted
        case terminal
    }

    let callID: String
    let slotID: String?
    let status: String
    let expiresAt: String?
    let acceptedAt: String?
    let endReason: String?
    let endedAt: String?
    let terminationGraceMilliseconds: Int?
    let finalBilling: OneToOneLiveFinalBilling?
    let callType: CallType
    let billingPolicy: LiveBillingPolicy?
    let liveExperience: LiveExperienceSnapshot?
    let serverTime: String?

    enum CodingKeys: String, CodingKey {
        case callID = "call_id"
        case slotID = "slot_id"
        case status
        case expiresAt = "expires_at"
        case acceptedAt = "accepted_at"
        case endReason = "end_reason"
        case endedAt = "ended_at"
        case terminationGraceMilliseconds = "termination_grace_ms"
        case finalBilling = "final_billing"
        case callType = "call_type"
        case billingPolicy = "billing_policy"
        case liveExperience = "live_experience"
        case experience
        case serverTime = "server_time"
    }

    var phase: Phase {
        switch status
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_") {
        case "accepted", "in_call":
            return .accepted
        case "rejected", "cancelled", "canceled", "expired", "ended":
            return .terminal
        default:
            return .pending
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        callID = container.flexString(for: .callID) ?? ""
        slotID = container.flexString(for: .slotID)
        status = container.flexString(for: .status) ?? "pending"
        expiresAt = container.flexString(for: .expiresAt)
        acceptedAt = container.flexString(for: .acceptedAt)
        endReason = container.flexString(for: .endReason)
        endedAt = container.flexString(for: .endedAt)
        terminationGraceMilliseconds = container.flexInt(for: .terminationGraceMilliseconds)
        finalBilling = try container.decodeIfPresent(OneToOneLiveFinalBilling.self, forKey: .finalBilling)
        callType = try container.decodeIfPresent(CallType.self, forKey: .callType) ?? .video
        billingPolicy = try container.decodeIfPresent(LiveBillingPolicy.self, forKey: .billingPolicy)
        let decodedExperience = try container.decodeIfPresent(
            LiveExperienceSnapshot.self,
            forKey: .liveExperience
        ) ?? container.decodeIfPresent(LiveExperienceSnapshot.self, forKey: .experience)
        serverTime = container.flexString(for: .serverTime)
        liveExperience = decodedExperience?.anchored(serverTime: serverTime)
    }
}

struct OneToOneLiveFinalBilling: Decodable, Equatable {
    let chargedUnits: Int?
    let chargedActivityCatFood: Int?
    let chargedGoldCoins: Int?
    let totalCharged: Int?
    let earnedGoldCoins: Int?
    let goldCoinBalanceAfter: Int?
    let activityCatFoodBalanceAfter: Int?
    let spendableBalanceAfter: Int?
    let billingStatus: String?
    let experienceSecondsUsed: Int?
    let overageUnits: Int?
    let consumedProp: PropConsumptionResult?

    enum CodingKeys: String, CodingKey {
        case chargedUnits = "charged_units"
        case chargedActivityCatFood = "charged_activity_cat_food"
        case chargedGoldCoins = "charged_gold_coins"
        case totalCharged = "total_charged"
        case earnedGoldCoins = "earned_gold_coins"
        case goldCoinBalanceAfter = "gold_coin_balance_after"
        case activityCatFoodBalanceAfter = "activity_cat_food_balance_after"
        case spendableBalanceAfter = "spendable_balance_after"
        case billingStatus = "billing_status"
        case experienceSecondsUsed = "experience_seconds_used"
        case overageUnits = "overage_units"
        case consumedProp = "consumed_prop"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        chargedUnits = container.flexInt(for: .chargedUnits)
        chargedActivityCatFood = container.flexInt(for: .chargedActivityCatFood)
        chargedGoldCoins = container.flexInt(for: .chargedGoldCoins)
        totalCharged = container.flexInt(for: .totalCharged)
        earnedGoldCoins = container.flexInt(for: .earnedGoldCoins)
        goldCoinBalanceAfter = container.flexInt(for: .goldCoinBalanceAfter)
        activityCatFoodBalanceAfter = container.flexInt(for: .activityCatFoodBalanceAfter)
        spendableBalanceAfter = container.flexInt(for: .spendableBalanceAfter)

        let nonNegativeValues = [
            chargedUnits,
            chargedActivityCatFood,
            chargedGoldCoins,
            totalCharged,
            earnedGoldCoins,
            goldCoinBalanceAfter,
            activityCatFoodBalanceAfter,
            spendableBalanceAfter
        ].compactMap { $0 }
        guard nonNegativeValues.allSatisfy({ $0 >= 0 }) else {
            throw DecodingError.dataCorruptedError(
                forKey: .totalCharged,
                in: container,
                debugDescription: "Live billing amounts and balances must be non-negative."
            )
        }
        if let chargedActivityCatFood,
           let chargedGoldCoins,
           let totalCharged,
           totalCharged != chargedActivityCatFood + chargedGoldCoins {
            throw DecodingError.dataCorruptedError(
                forKey: .totalCharged,
                in: container,
                debugDescription: "Live total_charged must equal both charged asset amounts."
            )
        }

        billingStatus = container.flexString(for: .billingStatus)
        experienceSecondsUsed = container.flexInt(for: .experienceSecondsUsed)
        overageUnits = container.flexInt(for: .overageUnits)
        consumedProp = try container.decodeIfPresent(PropConsumptionResult.self, forKey: .consumedProp)
    }
}

struct OneToOneLiveSlotUser: Decodable, Equatable {
    let userID: String
    let username: String
    let nickname: String
    let avatarURL: String
    let gender: String

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
        case nickname
        case avatarURL = "avatar_url"
        case gender
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        userID = container.flexString(for: .userID) ?? ""
        username = container.flexString(for: .username) ?? ""
        nickname = container.flexString(for: .nickname) ?? ""
        avatarURL = container.flexString(for: .avatarURL) ?? ""
        gender = container.flexString(for: .gender) ?? ""
    }
}

struct OneToOneLiveSlot: Decodable, Equatable {
    let id: String
    let status: String
    let characterSetting: String
    let liveAvatarURL: String
    let allowedCallTypes: [CallType]?
    let createdAt: String?
    let user: OneToOneLiveSlotUser

    enum CodingKeys: String, CodingKey {
        case id
        case status
        case characterSetting = "character_setting"
        case liveAvatarURL = "live_avatar_url"
        case allowedCallTypes = "allowed_call_types"
        case createdAt = "created_at"
        case user
        case host
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = container.flexString(for: .id) ?? ""
        status = container.flexString(for: .status) ?? "waiting"
        characterSetting = container.flexString(for: .characterSetting) ?? ""
        liveAvatarURL = container.flexString(for: .liveAvatarURL) ?? ""
        allowedCallTypes = try container.decodeIfPresent(
            [CallType].self,
            forKey: .allowedCallTypes
        ).map(LiveSlotCallTypePolicy.normalized)
        createdAt = container.flexString(for: .createdAt)
        if let decodedUser = try container.decodeIfPresent(OneToOneLiveSlotUser.self, forKey: .user) {
            user = decodedUser
        } else {
            user = try container.decode(OneToOneLiveSlotUser.self, forKey: .host)
        }
    }
}

struct OneToOneLiveSlotPage: Decodable, Equatable {
    let items: [OneToOneLiveSlot]
    let nextCursor: String?
    let billingPolicy: LiveBillingPolicy
    let supportedCallTypes: [CallType]
    let liveAvatarUploadSupported: Bool

    enum CodingKeys: String, CodingKey {
        case items
        case slots
        case nextCursor = "next_cursor"
        case billingPolicy = "billing_policy"
        case supportedCallTypes = "supported_call_types"
        case liveAvatarUploadSupported = "live_avatar_upload_supported"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        items = try container.decodeIfPresent([OneToOneLiveSlot].self, forKey: .items)
            ?? container.decodeIfPresent([OneToOneLiveSlot].self, forKey: .slots)
            ?? []
        nextCursor = container.flexString(for: .nextCursor)
        billingPolicy = try container.decodeIfPresent(
            LiveBillingPolicy.self,
            forKey: .billingPolicy
        ) ?? .fallback
        let decodedTypes = try container.decodeIfPresent(
            [CallType].self,
            forKey: .supportedCallTypes
        ) ?? []
        supportedCallTypes = decodedTypes.isEmpty ? [.video] : decodedTypes
        liveAvatarUploadSupported = container.flexBool(
            for: .liveAvatarUploadSupported
        ) ?? false
    }
}

struct OneToOneLiveAvatarUpload: Decodable, Equatable {
    let assetID: String
    let liveAvatarURL: String

    enum CodingKeys: String, CodingKey {
        case assetID = "asset_id"
        case liveAvatarURL = "live_avatar_url"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        assetID = container.flexString(for: .assetID) ?? ""
        liveAvatarURL = container.flexString(for: .liveAvatarURL) ?? ""
    }
}

struct OneToOneLiveSlotCreationData: Decodable, Equatable {
    let slot: OneToOneLiveSlot

    enum CodingKeys: String, CodingKey {
        case slot
        case item
        case liveSlot = "live_slot"
    }

    init(from decoder: Decoder) throws {
        if let container = try? decoder.container(keyedBy: CodingKeys.self) {
            if let value = try container.decodeIfPresent(OneToOneLiveSlot.self, forKey: .slot) {
                slot = value
                return
            }
            if let value = try container.decodeIfPresent(OneToOneLiveSlot.self, forKey: .item) {
                slot = value
                return
            }
            if let value = try container.decodeIfPresent(OneToOneLiveSlot.self, forKey: .liveSlot) {
                slot = value
                return
            }
        }
        slot = try OneToOneLiveSlot(from: decoder)
    }
}

struct OneToOneLiveCurrentSlotData: Decodable, Equatable {
    let slot: OneToOneLiveSlot?

    enum CodingKeys: String, CodingKey {
        case slot
        case item
        case currentSlot = "current_slot"
    }

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(), single.decodeNil() {
            slot = nil
            return
        }

        if let container = try? decoder.container(keyedBy: CodingKeys.self) {
            if container.contains(.slot) {
                slot = try container.decodeIfPresent(OneToOneLiveSlot.self, forKey: .slot)
                return
            }
            if container.contains(.item) {
                slot = try container.decodeIfPresent(OneToOneLiveSlot.self, forKey: .item)
                return
            }
            if container.contains(.currentSlot) {
                slot = try container.decodeIfPresent(OneToOneLiveSlot.self, forKey: .currentSlot)
                return
            }
        }

        slot = try OneToOneLiveSlot(from: decoder)
    }
}

struct AgentLiveMatchResponse: Decodable {
    let matchID: String
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case matchID = "match_id"
        case createdAt = "created_at"
    }
}

struct GroupCallStatusResponse: Decodable {
    let active: Bool
    let callID: String?
    let roomName: String?
    let callType: String?
    let participantCount: Int?

    enum CodingKeys: String, CodingKey {
        case active
        case callID = "call_id"
        case roomName = "room_name"
        case callType = "call_type"
        case participantCount = "participant_count"
    }
}
