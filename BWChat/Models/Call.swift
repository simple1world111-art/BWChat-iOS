// BWChat/Models/Call.swift
// Data models for voice/video calls (LiveKit-backed)

import Foundation

enum CallType: String, Codable {
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
