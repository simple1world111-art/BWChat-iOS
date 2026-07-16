// BWChat/Managers/AuthManager.swift
// Global authentication state manager

import Foundation
import Combine
import CryptoKit

enum AuthTokenNormalizer {
    static func normalize(_ value: String?) -> String? {
        guard var value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }
        if value.lowercased().hasPrefix("bearer ") {
            value = String(value.dropFirst(7)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return value.isEmpty ? nil : value
    }
}

struct AuthTokenMetadata: Equatable {
    let isEmpty: Bool
    let length: Int
    let sha256Prefix: String
    let hasBearerPrefix: Bool
    let hasExactlyTwoDots: Bool
}

enum AuthTokenDiagnostics {
    static func metadata(for value: String?) -> AuthTokenMetadata {
        let value = value ?? ""
        let digest = SHA256.hash(data: Data(value.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return AuthTokenMetadata(
            isEmpty: value.isEmpty,
            length: value.utf8.count,
            sha256Prefix: String(digest.prefix(12)),
            hasBearerPrefix: value.lowercased().hasPrefix("bearer "),
            hasExactlyTwoDots: value.filter { $0 == "." }.count == 2
        )
    }

    static func log(_ label: String, token: String?) {
        #if DEBUG
        let metadata = metadata(for: token)
        print(
            "[AuthToken] \(label) empty=\(metadata.isEmpty) length=\(metadata.length) "
                + "sha256=\(metadata.sha256Prefix) bearer_prefix=\(metadata.hasBearerPrefix) "
                + "two_dots=\(metadata.hasExactlyTwoDots)"
        )
        #endif
    }
}

struct AuthTokenStore {
    let load: (String) -> String?
    let save: (String, String) throws -> Void
    let delete: (String) -> OSStatus

    static let live = AuthTokenStore(
        load: KeychainHelper.load,
        save: KeychainHelper.save,
        delete: KeychainHelper.delete
    )
}

enum AuthSessionError: Error {
    case missingAccessToken
    case missingRefreshToken
    case accessTokenReadbackMismatch
}

@MainActor
final class AuthManager: ObservableObject {
    static let shared = AuthManager()

    @Published var isLoggedIn: Bool = false
    @Published var currentUser: User?

    private static let tokenKey = "jwt_token"
    private static let refreshTokenKey = "jwt_refresh_token"
    private let tokenStore: AuthTokenStore
    private let applicationSideEffectsEnabled: Bool
    private var inMemoryAccessToken: String?
    private var inMemoryRefreshToken: String?

    var token: String? {
        get { inMemoryAccessToken }
        set {
            let normalized = Self.normalizeToken(newValue)
            inMemoryAccessToken = normalized
            if let normalized {
                do {
                    try tokenStore.save(Self.tokenKey, normalized)
                } catch let error as KeychainError {
                    let metadata = AuthTokenDiagnostics.metadata(for: normalized)
                    print("[Keychain] access-token save failed operation=\(error.operation) status=\(error.status) length=\(metadata.length) sha256=\(metadata.sha256Prefix)")
                } catch {
                    let metadata = AuthTokenDiagnostics.metadata(for: normalized)
                    print("[Keychain] access-token save failed status=unknown length=\(metadata.length) sha256=\(metadata.sha256Prefix)")
                }
            } else {
                logDeleteFailureIfNeeded(tokenStore.delete(Self.tokenKey), label: "access-token")
            }
        }
    }

    var refreshToken: String? {
        get { inMemoryRefreshToken }
        set {
            let normalized = Self.normalizeToken(newValue)
            inMemoryRefreshToken = normalized
            if let normalized {
                do {
                    try tokenStore.save(Self.refreshTokenKey, normalized)
                } catch let error as KeychainError {
                    let metadata = AuthTokenDiagnostics.metadata(for: normalized)
                    print("[Keychain] refresh-token save failed operation=\(error.operation) status=\(error.status) length=\(metadata.length) sha256=\(metadata.sha256Prefix)")
                } catch {
                    let metadata = AuthTokenDiagnostics.metadata(for: normalized)
                    print("[Keychain] refresh-token save failed status=unknown length=\(metadata.length) sha256=\(metadata.sha256Prefix)")
                }
            } else {
                logDeleteFailureIfNeeded(tokenStore.delete(Self.refreshTokenKey), label: "refresh-token")
            }
        }
    }

    private let currentUserKey = "cached_current_user"
    private let knownAccountsKey = "bbchat.known_account_ids"

    init(
        tokenStore: AuthTokenStore = .live,
        restoreCachedUser: Bool = true,
        applicationSideEffectsEnabled: Bool = true
    ) {
        self.tokenStore = tokenStore
        self.applicationSideEffectsEnabled = applicationSideEffectsEnabled
        inMemoryAccessToken = Self.normalizeToken(tokenStore.load(Self.tokenKey))
        inMemoryRefreshToken = Self.normalizeToken(tokenStore.load(Self.refreshTokenKey))
        isLoggedIn = inMemoryAccessToken != nil

        // Restore cached user info
        if restoreCachedUser, isLoggedIn,
           let data = UserDefaults.standard.data(forKey: currentUserKey),
           let user = try? JSONDecoder().decode(User.self, from: data) {
            currentUser = user
            if applicationSideEffectsEnabled {
                MessageStore.shared.setActiveOwner(user.userID)
            }
        }
    }

    func login(token: String, refreshToken: String, user: User) throws {
        try updateSessionTokens(accessToken: token, refreshToken: refreshToken, source: "login")
        self.currentUser = user
        persistUser(user)
        rememberAccount(user.userID)
        if applicationSideEffectsEnabled {
            MessageStore.shared.setActiveOwner(user.userID)
        }
        // This is deliberately last: views may start protected requests as
        // soon as this published value changes.
        self.isLoggedIn = true
    }

    func updateSessionTokens(accessToken: String, refreshToken: String, source: String) throws {
        guard let normalizedAccess = Self.normalizeToken(accessToken) else {
            throw AuthSessionError.missingAccessToken
        }
        guard let normalizedRefresh = Self.normalizeToken(refreshToken) else {
            throw AuthSessionError.missingRefreshToken
        }

        self.token = normalizedAccess
        self.refreshToken = normalizedRefresh

        let responseMetadata = AuthTokenDiagnostics.metadata(for: normalizedAccess)
        let readbackMetadata = AuthTokenDiagnostics.metadata(for: self.token)
        AuthTokenDiagnostics.log("\(source)-response-normalized", token: normalizedAccess)
        AuthTokenDiagnostics.log("\(source)-auth-manager-readback", token: self.token)
        #if DEBUG
        print("[AuthToken] \(source)-readback-match=\(responseMetadata == readbackMetadata)")
        #endif
        guard responseMetadata == readbackMetadata else {
            throw AuthSessionError.accessTokenReadbackMismatch
        }
    }

    func logout() {
        let previousUserID = currentUser?.userID
        self.token = nil
        self.refreshToken = nil
        self.currentUser = nil
        self.isLoggedIn = false
        if applicationSideEffectsEnabled {
            UserDefaults.standard.removeObject(forKey: currentUserKey)
        }
        if let previousUserID { rememberAccount(previousUserID) }
        if applicationSideEffectsEnabled {
            MessageStore.shared.setActiveOwner(nil)
            UnreadBadgeStore.shared.setChatUnreadCount(0)
            UnreadBadgeStore.shared.setMomentsUnreadCount(0)
            ChatAppearanceStore.shared.clear()
            WebSocketService.shared.disconnect()
        }
    }

    /// Explicit privacy action. Normal logout deliberately does not call this
    /// so signing back into the same account restores its offline data.
    func clearLocalData(for userID: String) {
        MediaCacheManager.shared.clearAccount(userID: userID)
        AppCacheRepository.shared.removeAccountData(userID: userID)
        MessageStore.shared.clearAccount(userID: userID)
        LocalCache.clearAccount(userID: userID)
        UserDefaults.standard.removeObject(forKey: "bbchat.group_backfilled.\(userID)")
        UserDefaults.standard.removeObject(forKey: "bbchat.dm_backfilled.\(userID)")
        var known = Set(UserDefaults.standard.stringArray(forKey: knownAccountsKey) ?? [])
        known.remove(userID)
        UserDefaults.standard.set(Array(known), forKey: knownAccountsKey)
    }

    func clearAllLocalAccountData() {
        let known = UserDefaults.standard.stringArray(forKey: knownAccountsKey) ?? []
        known.forEach(clearLocalData(for:))
        UserDefaults.standard.removeObject(forKey: knownAccountsKey)
        UserCacheManager.shared.clearCache()
        ImageCacheManager.shared.clearCache()
    }

    func updateUser(_ user: User) {
        self.currentUser = user
        persistUser(user)
        rememberAccount(user.userID)
        if applicationSideEffectsEnabled, isLoggedIn {
            MessageStore.shared.setActiveOwner(user.userID)
        }
    }

    private func persistUser(_ user: User) {
        guard applicationSideEffectsEnabled else { return }
        if let data = try? JSONEncoder().encode(user) {
            UserDefaults.standard.set(data, forKey: currentUserKey)
        }
        UserCacheManager.shared.cacheUser(user)
    }

    private func rememberAccount(_ userID: String) {
        guard applicationSideEffectsEnabled else { return }
        guard !userID.isEmpty else { return }
        var known = Set(UserDefaults.standard.stringArray(forKey: knownAccountsKey) ?? [])
        known.insert(userID)
        UserDefaults.standard.set(Array(known), forKey: knownAccountsKey)
        UserDefaults.standard.set(userID, forKey: "bbchat.last_active_account_id")
    }

    static func normalizeToken(_ value: String?) -> String? {
        AuthTokenNormalizer.normalize(value)
    }

    private func logDeleteFailureIfNeeded(_ status: OSStatus, label: String) {
        guard status != errSecSuccess, status != errSecItemNotFound else { return }
        print("[Keychain] \(label) delete failed status=\(status)")
    }
}
