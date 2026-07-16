// BWChat/Models/User.swift
// Data model for user information

import Foundation

struct User: Codable, Identifiable, Equatable {
    let userID: String
    let username: String
    let nickname: String
    let avatarURL: String
    var bio: String
    var gender: String
    var birthday: String
    var location: String
    var followingCount: Int
    var followerCount: Int
    var postsCount: Int?
    var momentsCount: Int?
    var followedByMe: Bool
    var followsMe: Bool
    var isFriend: Bool

    var id: String { userID }

    var genderDisplay: String {
        switch gender {
        case "male": return L10n.tr("profile.gender.male")
        case "female": return L10n.tr("profile.gender.female")
        case "other": return L10n.tr("profile.gender.other")
        default: return ""
        }
    }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
        case nickname
        case avatarURL = "avatar_url"
        case bio
        case gender
        case birthday
        case location
        case followingCount = "following_count"
        case followerCount = "follower_count"
        case postsCount = "posts_count"
        case momentsCount = "moments_count"
        case followedByMe = "followed_by_me"
        case followsMe = "follows_me"
        case isFriend = "is_friend"
    }

    init(
        userID: String,
        username: String,
        nickname: String,
        avatarURL: String,
        bio: String = "",
        gender: String = "",
        birthday: String = "",
        location: String = "",
        followingCount: Int = 0,
        followerCount: Int = 0,
        postsCount: Int? = nil,
        momentsCount: Int? = nil,
        followedByMe: Bool = false,
        followsMe: Bool = false,
        isFriend: Bool = false
    ) {
        self.userID = userID
        self.username = username
        self.nickname = nickname
        self.avatarURL = avatarURL
        self.bio = bio
        self.gender = gender
        self.birthday = birthday
        self.location = location
        self.followingCount = followingCount
        self.followerCount = followerCount
        self.postsCount = postsCount
        self.momentsCount = momentsCount
        self.followedByMe = followedByMe
        self.followsMe = followsMe
        self.isFriend = isFriend
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        userID = container.flexString(for: .userID) ?? ""
        username = container.flexString(for: .username) ?? ""
        nickname = container.flexString(for: .nickname) ?? L10n.tr("profile.defaultUser")
        avatarURL = container.flexString(for: .avatarURL) ?? ""
        bio = try container.decodeIfPresent(String.self, forKey: .bio) ?? ""
        gender = try container.decodeIfPresent(String.self, forKey: .gender) ?? ""
        birthday = try container.decodeIfPresent(String.self, forKey: .birthday) ?? ""
        location = try container.decodeIfPresent(String.self, forKey: .location) ?? ""
        followingCount = container.flexInt(for: .followingCount) ?? 0
        followerCount = container.flexInt(for: .followerCount) ?? 0
        postsCount = container.flexInt(for: .postsCount)
        momentsCount = container.flexInt(for: .momentsCount)
        followedByMe = container.flexBool(for: .followedByMe) ?? false
        followsMe = container.flexBool(for: .followsMe) ?? false
        isFriend = container.flexBool(for: .isFriend) ?? false
    }
}
