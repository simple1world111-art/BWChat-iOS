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
    var followedByMe: Bool
    var followRequested: Bool

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case relation
        case followedByMe = "followed_by_me"
        case followRequested = "follow_requested"
        case requestPending = "request_pending"
    }

    init(
        userID: String,
        nickname: String,
        avatarURL: String,
        relation: String,
        followedByMe: Bool = false,
        followRequested: Bool = false
    ) {
        self.userID = userID
        self.nickname = nickname
        self.avatarURL = avatarURL
        self.relation = relation
        self.followedByMe = followedByMe
        self.followRequested = followRequested
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        userID = container.flexString(for: .userID) ?? ""
        nickname = container.flexString(for: .nickname) ?? L10n.tr("profile.defaultUser")
        avatarURL = container.flexString(for: .avatarURL) ?? ""
        relation = container.flexString(for: .relation) ?? "none"
        followedByMe = container.flexBool(for: .followedByMe) ?? false
        followRequested = container.flexBool(for: .followRequested)
            ?? container.flexBool(for: .requestPending)
            ?? false
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(userID, forKey: .userID)
        try container.encode(nickname, forKey: .nickname)
        try container.encode(avatarURL, forKey: .avatarURL)
        try container.encode(relation, forKey: .relation)
        try container.encode(followedByMe, forKey: .followedByMe)
        try container.encode(followRequested, forKey: .followRequested)
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
