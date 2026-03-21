// BWChat/Managers/UserCacheManager.swift
// Persistent local cache for user info (nickname, avatar URL, etc.)
// Avoids repeated network requests for data that rarely changes.

import Foundation

struct CachedUserInfo: Codable {
    let userID: String
    let username: String
    let nickname: String
    let avatarURL: String
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
        case nickname
        case avatarURL = "avatar_url"
        case updatedAt = "updated_at"
    }
}

@MainActor
class UserCacheManager {
    static let shared = UserCacheManager()

    private var users: [String: CachedUserInfo] = [:]
    private let fileURL: URL
    private let staleInterval: TimeInterval = 24 * 60 * 60 // 24h before background refresh

    private init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        fileURL = caches.appendingPathComponent("UserInfoCache.json")
        loadFromDisk()
    }

    // MARK: - Public API

    /// Get cached user info. Returns nil only if never cached.
    func getUser(_ userID: String) -> CachedUserInfo? {
        users[userID]
    }

    /// Cache user info from any API response that contains user data.
    func cacheUser(userID: String, username: String = "", nickname: String, avatarURL: String) {
        let info = CachedUserInfo(
            userID: userID,
            username: username,
            nickname: nickname,
            avatarURL: avatarURL,
            updatedAt: Date()
        )
        users[userID] = info
        saveToDisk()
    }

    /// Cache from a User model.
    func cacheUser(_ user: User) {
        cacheUser(userID: user.userID, username: user.username, nickname: user.nickname, avatarURL: user.avatarURL)
    }

    /// Cache from a FriendInfo model.
    func cacheFriend(_ friend: FriendInfo) {
        cacheUser(userID: friend.userID, nickname: friend.nickname, avatarURL: friend.avatarURL)
    }

    /// Cache from a Contact model.
    func cacheContact(_ contact: Contact) {
        cacheUser(userID: contact.userID, nickname: contact.nickname, avatarURL: contact.avatarURL)
    }

    /// Batch cache from friend list.
    func cacheFriends(_ friends: [FriendInfo]) {
        for f in friends { cacheFriend(f) }
    }

    /// Batch cache from contact list.
    func cacheContacts(_ contacts: [Contact]) {
        for c in contacts { cacheContact(c) }
    }

    /// Get nickname for a user (from cache), returns userID as fallback.
    func nickname(for userID: String) -> String {
        users[userID]?.nickname ?? userID
    }

    /// Get avatar URL for a user (from cache), returns empty string as fallback.
    func avatarURL(for userID: String) -> String {
        users[userID]?.avatarURL ?? ""
    }

    /// Clear all cached data (e.g. on logout).
    func clearCache() {
        users.removeAll()
        try? FileManager.default.removeItem(at: fileURL)
    }

    // MARK: - Disk Persistence

    private func saveToDisk() {
        do {
            let data = try JSONEncoder().encode(Array(users.values))
            try data.write(to: fileURL, options: .atomic)
        } catch {
            print("[UserCache] Save failed: \(error)")
        }
    }

    private func loadFromDisk() {
        guard let data = try? Data(contentsOf: fileURL),
              let list = try? JSONDecoder().decode([CachedUserInfo].self, from: data) else {
            return
        }
        for info in list {
            users[info.userID] = info
        }
    }
}
