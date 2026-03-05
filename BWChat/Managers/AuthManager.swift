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

    private init() {
        // Check if token exists on init
        isLoggedIn = token != nil
    }

    func login(token: String, user: User) {
        self.token = token
        self.currentUser = user
        self.isLoggedIn = true
    }

    func logout() {
        self.token = nil
        self.currentUser = nil
        self.isLoggedIn = false
        WebSocketService.shared.disconnect()
    }

    func updateUser(_ user: User) {
        self.currentUser = user
    }
}
