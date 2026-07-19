// BWChat/Models/Call.swift
// Data models for voice/video calls (LiveKit-backed)

import Foundation

enum CallType: String, Codable, Equatable {
    case voice
    case video
}

enum CallState: Equatable {
    case idle
    case outgoing
    case incoming
    case connecting
    case connected
    case ended
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

    enum CodingKeys: String, CodingKey {
        case callID = "call_id"
        case roomName = "room_name"
        case token
        case livekitUrl = "livekit_url"
        case serverUrl = "server_url"
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
