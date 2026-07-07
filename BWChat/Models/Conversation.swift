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
        TimestampHelper.formatListTime(lastMessageTime)
    }
}
