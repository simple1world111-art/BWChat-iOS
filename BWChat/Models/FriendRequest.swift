// BWChat/Models/FriendRequest.swift
// Data model for friend requests and search results

import Foundation

struct FriendRequest: Codable, Identifiable, Equatable {
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

enum FriendCacheKeys {
    static func friends(for userID: String?) -> String {
        "friends.\(normalizedUserID(userID))"
    }

    static func requests(for userID: String?) -> String {
        "friend_requests.\(normalizedUserID(userID))"
    }

    private static func normalizedUserID(_ userID: String?) -> String {
        let trimmed = userID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "anonymous" : trimmed
    }
}
