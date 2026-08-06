// BWChat/Models/Follow.swift
// Global one-way follow models.

import Foundation

struct FollowUser: Codable, Identifiable, Equatable, Hashable {
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

struct ProfileHighlight: Codable, Identifiable, Equatable, Hashable {
    let id: String
    let title: String
    let coverURL: String
    let itemCount: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case highlightID = "highlight_id"
        case title
        case name
        case coverURL = "cover_url"
        case coverURLCamel = "coverURL"
        case itemCount = "item_count"
    }

    init(id: String, title: String, coverURL: String, itemCount: Int? = nil) {
        self.id = id
        self.title = title
        self.coverURL = coverURL
        self.itemCount = itemCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let fallbackTitle = container.flexString(for: .title)
            ?? container.flexString(for: .name)
            ?? ""
        self.id = container.flexString(for: .id)
            ?? container.flexString(for: .highlightID)
            ?? fallbackTitle
        self.title = fallbackTitle
        self.coverURL = container.flexString(for: .coverURL)
            ?? container.flexString(for: .coverURLCamel)
            ?? ""
        self.itemCount = container.flexInt(for: .itemCount)
    }
}

extension FollowUser {
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(userID, forKey: .userID); try c.encode(username, forKey: .username)
        try c.encode(nickname, forKey: .nickname); try c.encode(avatarURL, forKey: .avatarURL)
        try c.encode(bio, forKey: .bio); try c.encode(followingCount, forKey: .followingCount)
        try c.encode(followerCount, forKey: .followerCount); try c.encode(followedByMe, forKey: .followedByMe)
        try c.encode(followsMe, forKey: .followsMe); try c.encode(isFriend, forKey: .isFriend)
    }
}

extension ProfileHighlight {
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(title, forKey: .title)
        try c.encode(coverURL, forKey: .coverURL); try c.encodeIfPresent(itemCount, forKey: .itemCount)
    }
}

extension PublicProfile {
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(userID, forKey: .userID); try c.encode(username, forKey: .username)
        try c.encode(nickname, forKey: .nickname); try c.encode(avatarURL, forKey: .avatarURL)
        try c.encode(bio, forKey: .bio); try c.encode(gender, forKey: .gender)
        try c.encode(birthday, forKey: .birthday); try c.encode(location, forKey: .location)
        try c.encode(followingCount, forKey: .followingCount); try c.encode(followerCount, forKey: .followerCount)
        try c.encode(followedByMe, forKey: .followedByMe); try c.encode(followsMe, forKey: .followsMe)
        try c.encode(isFriend, forKey: .isFriend); try c.encode(followRequested, forKey: .followRequested)
        try c.encodeIfPresent(postsCount, forKey: .postsCount); try c.encodeIfPresent(momentsCount, forKey: .momentsCount)
        try c.encodeIfPresent(websiteURL, forKey: .websiteURL); try c.encodeIfPresent(contactEmail, forKey: .contactEmail)
        try c.encodeIfPresent(contactURL, forKey: .contactURL); try c.encode(isVerified, forKey: .isVerified)
        try c.encode(category, forKey: .category); try c.encode(pronouns, forKey: .pronouns)
        try c.encode(isPrivate, forKey: .isPrivate); try c.encode(canViewMoments, forKey: .canViewMoments)
        try c.encode(canMessage, forKey: .canMessage); try c.encodeIfPresent(mutualFollowersCount, forKey: .mutualFollowersCount)
        try c.encode(mutualFollowers, forKey: .mutualFollowers); try c.encode(highlights, forKey: .highlights)
        try c.encodeIfPresent(accountCreatedAt, forKey: .accountCreatedAt)
    }
}

extension FollowUsersPage {
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(users, forKey: .users); try c.encode(hasMore, forKey: .hasMore)
        try c.encodeIfPresent(nextPage, forKey: .nextPage)
    }
}

struct PublicProfile: Codable, Identifiable, Equatable {
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
    var followRequested: Bool
    var postsCount: Int?
    var momentsCount: Int?
    var websiteURL: String?
    var contactEmail: String?
    var contactURL: String?
    var isVerified: Bool
    var category: String
    var pronouns: String
    var isPrivate: Bool
    var canViewMoments: Bool
    var canMessage: Bool
    var mutualFollowersCount: Int?
    var mutualFollowers: [FollowUser]
    var highlights: [ProfileHighlight]
    var accountCreatedAt: String?

    var id: String { userID }

    /// Opening a DM is a local navigation decision. `canMessage` is a
    /// server-side sending hint and must not strand a valid profile outside
    /// the chat screen when that hint is stale or overly restrictive.
    var directConversationUserID: String? {
        let normalized = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }

    var canOpenDirectConversation: Bool {
        directConversationUserID != nil
    }

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
        case followRequested = "follow_requested"
        case requestPending = "request_pending"
        case postsCount = "posts_count"
        case momentsCount = "moments_count"
        case websiteURL = "website_url"
        case contactEmail = "contact_email"
        case businessEmail = "business_email"
        case contactURL = "contact_url"
        case isVerified = "is_verified"
        case category
        case pronouns
        case isPrivate = "is_private"
        case canViewMoments = "can_view_moments"
        case canMessage = "can_message"
        case mutualFollowersCount = "mutual_followers_count"
        case mutualFollowers = "mutual_followers"
        case highlights
        case accountCreatedAt = "account_created_at"
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
        isFriend: Bool = false,
        followRequested: Bool = false,
        postsCount: Int? = nil,
        momentsCount: Int? = nil,
        websiteURL: String? = nil,
        contactEmail: String? = nil,
        contactURL: String? = nil,
        isVerified: Bool = false,
        category: String = "",
        pronouns: String = "",
        isPrivate: Bool = false,
        canViewMoments: Bool = true,
        canMessage: Bool = true,
        mutualFollowersCount: Int? = nil,
        mutualFollowers: [FollowUser] = [],
        highlights: [ProfileHighlight] = [],
        accountCreatedAt: String? = nil
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
        self.followRequested = followRequested
        self.postsCount = postsCount
        self.momentsCount = momentsCount
        self.websiteURL = websiteURL?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true ? nil : websiteURL
        self.contactEmail = contactEmail?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true ? nil : contactEmail
        self.contactURL = contactURL?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true ? nil : contactURL
        self.isVerified = isVerified
        self.category = category
        self.pronouns = pronouns
        self.isPrivate = isPrivate
        self.canViewMoments = canViewMoments
        self.canMessage = canMessage
        self.mutualFollowersCount = mutualFollowersCount
        self.mutualFollowers = mutualFollowers
        self.highlights = highlights
        self.accountCreatedAt = accountCreatedAt
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
        self.followRequested = container.flexBool(for: .followRequested)
            ?? container.flexBool(for: .requestPending)
            ?? false
        self.postsCount = container.flexInt(for: .postsCount)
        self.momentsCount = container.flexInt(for: .momentsCount)
        let website = container.flexString(for: .websiteURL) ?? ""
        self.websiteURL = website.isBlank ? nil : website
        let email = container.flexString(for: .contactEmail)
            ?? container.flexString(for: .businessEmail)
            ?? ""
        self.contactEmail = email.isBlank ? nil : email
        let contactURL = container.flexString(for: .contactURL) ?? ""
        self.contactURL = contactURL.isBlank ? nil : contactURL
        self.isVerified = container.flexBool(for: .isVerified) ?? false
        self.category = container.flexString(for: .category) ?? ""
        self.pronouns = container.flexString(for: .pronouns) ?? ""
        self.isPrivate = container.flexBool(for: .isPrivate) ?? false
        self.canViewMoments = container.flexBool(for: .canViewMoments) ?? true
        self.canMessage = container.flexBool(for: .canMessage) ?? true
        self.mutualFollowersCount = container.flexInt(for: .mutualFollowersCount)
        self.mutualFollowers = (try? container.decodeIfPresent([FollowUser].self, forKey: .mutualFollowers)) ?? []
        self.highlights = (try? container.decodeIfPresent([ProfileHighlight].self, forKey: .highlights)) ?? []
        self.accountCreatedAt = container.flexString(for: .accountCreatedAt)
    }
}

struct FollowRelationship: Decodable, Equatable {
    let userID: String
    let followedByMe: Bool
    let followsMe: Bool
    let isFriend: Bool
    let followRequested: Bool?
    let followingCount: Int?
    let followerCount: Int?

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case followedByMe = "followed_by_me"
        case followsMe = "follows_me"
        case isFriend = "is_friend"
        case followRequested = "follow_requested"
        case requestPending = "request_pending"
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
        followRequested: Bool? = nil,
        followingCount: Int? = nil,
        followerCount: Int? = nil
    ) {
        self.userID = userID
        self.followedByMe = followedByMe
        self.followsMe = followsMe
        self.isFriend = isFriend
        self.followRequested = followRequested
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
        self.followRequested = container.flexBool(for: .followRequested)
            ?? container.flexBool(for: .requestPending)
        self.followingCount = container.flexInt(for: .followingCount)
        self.followerCount = container.flexInt(for: .followerCount)
    }
}

struct FollowUsersPage: Codable, Equatable {
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
