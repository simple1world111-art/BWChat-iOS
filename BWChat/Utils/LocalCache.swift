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
    private static let writeQueue = DispatchQueue(label: "bwchat.localcache.write", qos: .utility)

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
        guard let data = try? Data(contentsOf: url),
              let value = try? decoder.decode(T.self, from: data)
        else { return nil }
        return value
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
}
