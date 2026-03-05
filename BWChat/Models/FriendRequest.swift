// BWChat/Models/FriendRequest.swift
// Data model for friend requests and search results

import Foundation

struct FriendRequest: Codable, Identifiable {
    let requestID: Int
    let userID: String
    let nickname: String
    let avatarURL: String
    let createdAt: String

    var id: Int { requestID }

    enum CodingKeys: String, CodingKey {
        case requestID = "request_id"
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case createdAt = "created_at"
    }
}

struct SearchUser: Codable, Identifiable {
    let userID: String
    let nickname: String
    let avatarURL: String
    let relation: String  // "none", "friend", "pending_sent", "pending_received"

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case relation
    }
}

struct FriendInfo: Codable, Identifiable, Hashable {
    let userID: String
    let nickname: String
    let avatarURL: String
    let addedAt: String

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case addedAt = "added_at"
    }
}
