// BWChat/Utils/KeychainHelper.swift
// Simple Keychain wrapper for secure token storage

import Foundation
import Security

struct KeychainError: Error, Equatable {
    let operation: String
    let status: OSStatus
}

enum KeychainHelper {
    private static let service = Bundle.main.bundleIdentifier ?? "com.bbchat.app"

    static func save(key: String, value: String) throws {
        try saveData(key: key, data: Data(value.utf8))
    }

    /// Stores device-local binary secrets. Cache encryption keys use this
    /// path so logging out can discard the in-memory key without deleting the
    /// keychain item needed to unlock the same account on the next login.
    static func saveData(key: String, data: Data) throws {
        let identityQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]

        // Update first so a transient add failure cannot destroy a previously
        // persisted token. Add only when the item genuinely does not exist.
        let updateAttributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(identityQuery as CFDictionary, updateAttributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainError(operation: "update", status: updateStatus)
        }

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainError(operation: "add", status: addStatus)
        }
    }

    static func load(key: String) -> String? {
        guard let data = loadData(key: key) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func loadData(key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else {
            if status != errSecItemNotFound {
                print("[Keychain] load failed operation=copy status=\(status)")
            }
            return nil
        }
        return result as? Data
    }

    @discardableResult
    static func delete(key: String) -> OSStatus {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        return SecItemDelete(query as CFDictionary)
    }
}
