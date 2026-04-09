import Foundation

struct Conversation: Codable, Identifiable, Equatable, Hashable {
    let type: String  // "dm" or "group"
    let id: String
    let name: String
    let avatarURL: String
    let lastMessage: String?
    let lastMessageTime: String?
    let unreadCount: Int
    let subtitle: String?
    let groupID: Int?
    let memberCount: Int?

    enum CodingKeys: String, CodingKey {
        case type
        case id
        case name
        case avatarURL = "avatar_url"
        case lastMessage = "last_message"
        case lastMessageTime = "last_message_time"
        case unreadCount = "unread_count"
        case subtitle
        case groupID = "group_id"
        case memberCount = "member_count"
    }

    var isDM: Bool { type == "dm" }
    var isGroup: Bool { type == "group" }

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
