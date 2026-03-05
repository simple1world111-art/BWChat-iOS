// BWChat/Models/Contact.swift
// Data model for contact list items

import Foundation

struct Contact: Codable, Identifiable, Equatable {
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
