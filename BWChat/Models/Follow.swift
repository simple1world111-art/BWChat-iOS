// BWChat/Models/Follow.swift
// Global one-way follow models.

import Foundation

struct FollowUser: Decodable, Identifiable, Equatable, Hashable {
    let userID: String
    let username: String
    let nickname: String
    let avatarURL: String
    let bio: String
    var followingCount: Int
    var followerCount: Int
    var followedByMe: Bool
    var followsMe: Bool
    var isFriend: Bool

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
        case nickname
        case avatarURL = "avatar_url"
        case bio
        case followingCount = "following_count"
        case followerCount = "follower_count"
        case followedByMe = "followed_by_me"
        case followsMe = "follows_me"
        case isFriend = "is_friend"
        case profile
        case user
    }

    init(
        userID: String,
        username: String = "",
        nickname: String,
        avatarURL: String,
        bio: String = "",
        followingCount: Int = 0,
        followerCount: Int = 0,
        followedByMe: Bool = false,
        followsMe: Bool = false,
        isFriend: Bool = false
    ) {
        self.userID = userID
        self.username = username
        self.nickname = nickname
        self.avatarURL = avatarURL
        self.bio = bio
        self.followingCount = followingCount
        self.followerCount = followerCount
        self.followedByMe = followedByMe
        self.followsMe = followsMe
        self.isFriend = isFriend
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let nested = try? container.decodeIfPresent(FollowUser.self, forKey: .profile) {
            self = nested
            return
        }
        if let nested = try? container.decodeIfPresent(FollowUser.self, forKey: .user) {
            self = nested
            return
        }

        self.userID = container.flexString(for: .userID) ?? ""
        self.username = container.flexString(for: .username) ?? ""
        self.nickname = container.flexString(for: .nickname) ?? L10n.tr("profile.defaultUser")
        self.avatarURL = container.flexString(for: .avatarURL) ?? ""
        self.bio = container.flexString(for: .bio) ?? ""
        self.followingCount = container.flexInt(for: .followingCount) ?? 0
        self.followerCount = container.flexInt(for: .followerCount) ?? 0
        self.followedByMe = container.flexBool(for: .followedByMe) ?? false
        self.followsMe = container.flexBool(for: .followsMe) ?? false
        self.isFriend = container.flexBool(for: .isFriend) ?? false
    }
}

struct PublicProfile: Decodable, Identifiable, Equatable {
    var userID: String
    var username: String
    var nickname: String
    var avatarURL: String
    var bio: String
    var gender: String
    var birthday: String
    var location: String
    var followingCount: Int
    var followerCount: Int
    var followedByMe: Bool
    var followsMe: Bool
    var isFriend: Bool

    var id: String { userID }

    var followUser: FollowUser {
        FollowUser(
            userID: userID,
            username: username,
            nickname: nickname,
            avatarURL: avatarURL,
            bio: bio,
            followingCount: followingCount,
            followerCount: followerCount,
            followedByMe: followedByMe,
            followsMe: followsMe,
            isFriend: isFriend
        )
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
        case followedByMe = "followed_by_me"
        case followsMe = "follows_me"
        case isFriend = "is_friend"
        case profile
        case user
    }

    init(
        userID: String,
        username: String = "",
        nickname: String,
        avatarURL: String,
        bio: String = "",
        gender: String = "",
        birthday: String = "",
        location: String = "",
        followingCount: Int = 0,
        followerCount: Int = 0,
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
        self.followedByMe = followedByMe
        self.followsMe = followsMe
        self.isFriend = isFriend
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let nested = try? container.decodeIfPresent(PublicProfile.self, forKey: .profile) {
            self = nested
            return
        }
        if let nested = try? container.decodeIfPresent(PublicProfile.self, forKey: .user) {
            self = nested
            return
        }

        self.userID = container.flexString(for: .userID) ?? ""
        self.username = container.flexString(for: .username) ?? ""
        self.nickname = container.flexString(for: .nickname) ?? L10n.tr("profile.defaultUser")
        self.avatarURL = container.flexString(for: .avatarURL) ?? ""
        self.bio = container.flexString(for: .bio) ?? ""
        self.gender = container.flexString(for: .gender) ?? ""
        self.birthday = container.flexString(for: .birthday) ?? ""
        self.location = container.flexString(for: .location) ?? ""
        self.followingCount = container.flexInt(for: .followingCount) ?? 0
        self.followerCount = container.flexInt(for: .followerCount) ?? 0
        self.followedByMe = container.flexBool(for: .followedByMe) ?? false
        self.followsMe = container.flexBool(for: .followsMe) ?? false
        self.isFriend = container.flexBool(for: .isFriend) ?? false
    }
}

struct FollowRelationship: Decodable, Equatable {
    let userID: String
    let followedByMe: Bool
    let followsMe: Bool
    let isFriend: Bool
    let followingCount: Int?
    let followerCount: Int?

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case followedByMe = "followed_by_me"
        case followsMe = "follows_me"
        case isFriend = "is_friend"
        case followingCount = "following_count"
        case followerCount = "follower_count"
        case relationship
        case relation
    }

    init(
        userID: String,
        followedByMe: Bool,
        followsMe: Bool = false,
        isFriend: Bool = false,
        followingCount: Int? = nil,
        followerCount: Int? = nil
    ) {
        self.userID = userID
        self.followedByMe = followedByMe
        self.followsMe = followsMe
        self.isFriend = isFriend
        self.followingCount = followingCount
        self.followerCount = followerCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let nested = try? container.decodeIfPresent(FollowRelationship.self, forKey: .relationship) {
            self = nested
            return
        }
        if let nested = try? container.decodeIfPresent(FollowRelationship.self, forKey: .relation) {
            self = nested
            return
        }

        self.userID = container.flexString(for: .userID) ?? ""
        self.followedByMe = container.flexBool(for: .followedByMe) ?? false
        self.followsMe = container.flexBool(for: .followsMe) ?? false
        self.isFriend = container.flexBool(for: .isFriend) ?? false
        self.followingCount = container.flexInt(for: .followingCount)
        self.followerCount = container.flexInt(for: .followerCount)
    }
}

struct FollowUsersPage: Decodable, Equatable {
    let users: [FollowUser]
    let hasMore: Bool
    let nextPage: Int?

    enum CodingKeys: String, CodingKey {
        case users
        case following
        case followers
        case items
        case list
        case hasMore = "has_more"
        case nextPage = "next_page"
        case page
        case total
    }

    init(users: [FollowUser], hasMore: Bool, nextPage: Int?) {
        self.users = users
        self.hasMore = hasMore
        self.nextPage = nextPage
    }

    init(from decoder: Decoder) throws {
        if let users = try? [FollowUser](from: decoder) {
            self.users = users
            self.hasMore = false
            self.nextPage = nil
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedUsers = Self.decodeUsers(from: container)
        let currentPage = container.flexInt(for: .page)
        let nextPage = container.flexInt(for: .nextPage)
        let total = container.flexInt(for: .total)
        let explicitHasMore = container.flexBool(for: .hasMore)
        let inferredHasMore: Bool
        if let explicitHasMore {
            inferredHasMore = explicitHasMore
        } else if nextPage != nil {
            inferredHasMore = true
        } else if let total {
            inferredHasMore = decodedUsers.count < total
        } else {
            inferredHasMore = false
        }

        self.users = decodedUsers
        self.hasMore = inferredHasMore
        self.nextPage = nextPage ?? (inferredHasMore ? currentPage.map { $0 + 1 } : nil)
    }

    private static func decodeUsers(from container: KeyedDecodingContainer<CodingKeys>) -> [FollowUser] {
        if let users = try? container.decodeIfPresent([FollowUser].self, forKey: .users) {
            return users
        }
        if let following = try? container.decodeIfPresent([FollowUser].self, forKey: .following) {
            return following
        }
        if let followers = try? container.decodeIfPresent([FollowUser].self, forKey: .followers) {
            return followers
        }
        if let items = try? container.decodeIfPresent([FollowUser].self, forKey: .items) {
            return items
        }
        if let list = try? container.decodeIfPresent([FollowUser].self, forKey: .list) {
            return list
        }
        return []
    }
}
