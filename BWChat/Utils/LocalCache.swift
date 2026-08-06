// BWChat/Utils/LocalCache.swift
// Tiny generic JSON disk cache for Codable lists.
//
// Usage:
//   let cached = LocalCache.load([FriendInfo].self, key: "friends") ?? []
//   LocalCache.save(friends, key: "friends")
//
// Writes happen on a background queue (atomic), reads are synchronous
// (called during ViewModel init to seed @Published state instantly).
// Files live under Caches/ListCache/<key>.json so iOS can evict them
// under disk pressure without data loss (server is still source of truth).

import Foundation

enum LocalCache {
    private static let encoder = JSONEncoder()
    private static let decoder = JSONDecoder()
    private static let writeQueue = DispatchQueue(label: "bbchat.localcache.write", qos: .utility)

    private static var cacheDir: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("ListCache", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    private static func fileURL(for key: String) -> URL {
        cacheDir.appendingPathComponent("\(key).json")
    }

    /// Synchronous load. Returns nil if the file is missing or decode fails.
    static func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        let url = fileURL(for: key)
        guard let source = try? Data(contentsOf: url) else { return nil }
        let data = WalletCacheSchemaMigration.migratedJSONData(source) ?? source
        if data != source {
            try? data.write(to: url, options: .atomic)
        }
        guard let value = try? decoder.decode(T.self, from: data)
        else { return nil }
        return value
    }

    static func migrateWalletCurrencySchemaIfNeeded(defaults: UserDefaults = .standard) {
        let versionKey = "bbchat.local-cache.schema-version"
        guard defaults.integer(forKey: versionKey) < WalletCacheSchemaMigration.currentVersion else { return }
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: cacheDir,
            includingPropertiesForKeys: nil
        ) else {
            defaults.set(WalletCacheSchemaMigration.currentVersion, forKey: versionKey)
            return
        }

        for file in files where file.pathExtension == "json" {
            guard let source = try? Data(contentsOf: file),
                  let migrated = WalletCacheSchemaMigration.migratedJSONData(source) else { continue }
            try? migrated.write(to: file, options: .atomic)
        }
        defaults.set(WalletCacheSchemaMigration.currentVersion, forKey: versionKey)
    }

    /// Fire-and-forget save to disk on a background queue.
    static func save<T: Encodable>(_ value: T, key: String) {
        let url = fileURL(for: key)
        writeQueue.async {
            if let data = try? encoder.encode(value) {
                try? data.write(to: url, options: .atomic)
            }
        }
    }

    /// Delete one key (or pass nil to wipe the whole ListCache directory).
    static func clear(key: String? = nil) {
        if let key = key {
            try? FileManager.default.removeItem(at: fileURL(for: key))
        } else {
            try? FileManager.default.removeItem(at: cacheDir)
        }
    }

    /// Removes only legacy JSON entries that are unambiguously scoped to one
    /// account. Unscoped legacy keys are migrated before removal and are never
    /// deleted as a side effect of a normal logout.
    static func clearAccount(userID: String) {
        guard !userID.isEmpty,
              let files = try? FileManager.default.contentsOfDirectory(
                at: cacheDir,
                includingPropertiesForKeys: nil
              ) else { return }
        let encoded = userID.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? userID
        for file in files where file.lastPathComponent.contains(userID) || file.lastPathComponent.contains(encoded) {
            try? FileManager.default.removeItem(at: file)
        }
    }
}
