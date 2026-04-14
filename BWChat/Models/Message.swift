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
        case senderID = "sender_id"
        case receiverID = "receiver_id"
        case msgType = "msg_type"
        case content
        case timestamp
        case replyToID = "reply_to_id"
        case replyTo = "reply_to"
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
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        
        // Try with fractional seconds first, then without
        if let date = formatter.date(from: timestamp) {
            return Self.timeFormatter.string(from: date)
        }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: timestamp) {
            return Self.timeFormatter.string(from: date)
        }
        return timestamp
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f
    }()
}

/// Used for optimistic UI updates before server confirms
struct PendingMessage: Identifiable {
    let id: UUID = UUID()
    let receiverID: String
    let msgType: String
    let content: String
    let imageData: Data?
    let videoData: Data?
    let voiceData: Data?
    let voiceDuration: Double
    var status: SendStatus = .sending

    enum SendStatus {
        case sending
        case sent
        case failed
    }

    init(receiverID: String, msgType: String, content: String, imageData: Data? = nil, videoData: Data? = nil, voiceData: Data? = nil, voiceDuration: Double = 0) {
        self.receiverID = receiverID
        self.msgType = msgType
        self.content = content
        self.imageData = imageData
        self.videoData = videoData
        self.voiceData = voiceData
        self.voiceDuration = voiceDuration
    }
}
