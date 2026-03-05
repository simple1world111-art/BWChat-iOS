// BWChat/Models/Group.swift
// Data model for group chats

import Foundation

struct Group: Codable, Identifiable, Equatable, Hashable {
    let groupID: Int
    let name: String
    let avatarURL: String
    let creatorID: String
    let memberCount: Int
    let lastMessage: String?
    let lastMessageTime: String?
    let lastMessageSender: String?
    let unreadCount: Int

    var id: Int { groupID }

    enum CodingKeys: String, CodingKey {
        case groupID = "group_id"
        case name
        case avatarURL = "avatar_url"
        case creatorID = "creator_id"
        case memberCount = "member_count"
        case lastMessage = "last_message"
        case lastMessageTime = "last_message_time"
        case lastMessageSender = "last_message_sender"
        case unreadCount = "unread_count"
    }

    var formattedTime: String {
        guard let timeStr = lastMessageTime else { return "" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        var date: Date?
        date = formatter.date(from: timeStr)
        if date == nil {
            formatter.formatOptions = [.withInternetDateTime]
            date = formatter.date(from: timeStr)
        }
        guard let parsedDate = date else { return "" }

        let calendar = Calendar.current
        if calendar.isDateInToday(parsedDate) {
            let tf = DateFormatter()
            tf.dateFormat = "HH:mm"
            return tf.string(from: parsedDate)
        } else if calendar.isDateInYesterday(parsedDate) {
            return "昨天"
        } else {
            let tf = DateFormatter()
            tf.dateFormat = "MM/dd"
            return tf.string(from: parsedDate)
        }
    }
}

struct GroupDetail: Codable {
    let groupID: Int
    let name: String
    let avatarURL: String
    let creatorID: String
    let members: [GroupMember]

    enum CodingKeys: String, CodingKey {
        case groupID = "group_id"
        case name
        case avatarURL = "avatar_url"
        case creatorID = "creator_id"
        case members
    }
}

struct GroupMember: Codable, Identifiable, Equatable, Hashable {
    let userID: String
    let nickname: String
    let avatarURL: String
    let role: String

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case role
    }
}

struct GroupMessage: Codable, Identifiable, Equatable {
    let id: Int
    let groupID: Int
    let senderID: String
    let msgType: String
    let content: String
    let timestamp: String
    let senderNickname: String
    let senderAvatar: String

    enum CodingKeys: String, CodingKey {
        case id
        case groupID = "group_id"
        case senderID = "sender_id"
        case msgType = "msg_type"
        case content
        case timestamp
        case senderNickname = "sender_nickname"
        case senderAvatar = "sender_avatar"
    }

    var isImage: Bool { msgType == "image" }

    var formattedTime: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
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
