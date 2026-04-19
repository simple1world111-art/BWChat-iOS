// BWChat/Managers/AuthManager.swift
// Global authentication state manager

import Foundation
import Combine

@MainActor
class AuthManager: ObservableObject {
    static let shared = AuthManager()

    @Published var isLoggedIn: Bool = false
    @Published var currentUser: User?

    private let tokenKey = "jwt_token"
    private let refreshTokenKey = "jwt_refresh_token"

    var token: String? {
        get { KeychainHelper.load(key: tokenKey) }
        set {
            if let value = newValue {
                KeychainHelper.save(key: tokenKey, value: value)
            } else {
                KeychainHelper.delete(key: tokenKey)
            }
        }
    }

    var refreshToken: String? {
        get { KeychainHelper.load(key: refreshTokenKey) }
        set {
            if let value = newValue {
                KeychainHelper.save(key: refreshTokenKey, value: value)
            } else {
                KeychainHelper.delete(key: refreshTokenKey)
            }
        }
    }

    private let currentUserKey = "cached_current_user"

    private init() {
        // Check if token exists on init
        isLoggedIn = token != nil
        // Restore cached user info
        if isLoggedIn, let data = UserDefaults.standard.data(forKey: currentUserKey),
           let user = try? JSONDecoder().decode(User.self, from: data) {
            currentUser = user
        }
    }

    func login(token: String, refreshToken: String, user: User) {
        self.token = token
        self.refreshToken = refreshToken
        self.currentUser = user
        self.isLoggedIn = true
        persistUser(user)
    }

    func logout() {
        self.token = nil
        self.refreshToken = nil
        self.currentUser = nil
        self.isLoggedIn = false
        UserDefaults.standard.removeObject(forKey: currentUserKey)
        UserCacheManager.shared.clearCache()
        ImageCacheManager.shared.clearCache()
        MessageStore.shared.clearAll()
        LocalCache.clear()
        UserDefaults.standard.removeObject(forKey: "bwchat.group_backfilled")
        UserDefaults.standard.removeObject(forKey: "bwchat.dm_backfilled")
        WebSocketService.shared.disconnect()
    }

    func updateUser(_ user: User) {
        self.currentUser = user
        persistUser(user)
    }

    private func persistUser(_ user: User) {
        if let data = try? JSONEncoder().encode(user) {
            UserDefaults.standard.set(data, forKey: currentUserKey)
        }
        UserCacheManager.shared.cacheUser(user)
    }
}
