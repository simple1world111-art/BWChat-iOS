// BWChat/Models/Contact.swift
// Data model for contact list items

import Foundation

struct Contact: Codable, Identifiable, Equatable, Hashable {
    let userID: String
    let nickname: String
    let avatarURL: String
    let lastMessage: String?
    let lastMessageTime: String?
    let unreadCount: Int

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case lastMessage = "last_message"
        case lastMessageTime = "last_message_time"
        case unreadCount = "unread_count"
    }

    var formattedTime: String {
        TimestampHelper.formatListTime(lastMessageTime)
    }
}
