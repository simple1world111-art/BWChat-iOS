import Foundation

struct MomentAuthor: Codable, Identifiable, Equatable {
    let userID: String
    let nickname: String
    let avatarURL: String

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
    }
}

struct MomentComment: Codable, Identifiable, Equatable {
    let id: Int
    let content: String
    let createdAt: String?
    let userID: String
    let nickname: String
    let avatarURL: String
    let replyTo: MomentAuthor?

    enum CodingKeys: String, CodingKey {
        case id, content
        case createdAt = "created_at"
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case replyTo = "reply_to"
    }
}

struct Moment: Codable, Identifiable, Equatable {
    let id: Int
    let author: MomentAuthor
    let content: String
    let images: [String]
    let createdAt: String
    let likes: [MomentAuthor]
    let comments: [MomentComment]
    let likedByMe: Bool

    enum CodingKeys: String, CodingKey {
        case id, author, content, images
        case createdAt = "created_at"
        case likes, comments
        case likedByMe = "liked_by_me"
    }

    var formattedTime: String {
        Self.relativeTime(from: createdAt)
    }

    static func relativeTime(from dateStr: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        guard let date = formatter.date(from: dateStr) else { return dateStr }

        let now = Date()
        let interval = now.timeIntervalSince(date)

        if interval < 60 { return "刚刚" }
        if interval < 3600 { return "\(Int(interval / 60))分钟前" }
        if interval < 86400 { return "\(Int(interval / 3600))小时前" }
        if interval < 172800 { return "昨天" }

        let display = DateFormatter()
        display.dateFormat = "MM月dd日"
        return display.string(from: date)
    }
}
