// BWChat/Models/Call.swift
// Data models for voice/video calls

import Foundation

enum CallType: String, Codable {
    case voice
    case video
}

enum CallState {
    case idle
    case outgoing
    case incoming
    case connected
    case ended
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

    var durationText: String {
        let elapsed = Int(Date().timeIntervalSince(startedAt))
        let minutes = elapsed / 60
        let seconds = elapsed % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}
