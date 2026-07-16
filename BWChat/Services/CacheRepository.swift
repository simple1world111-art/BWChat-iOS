import CryptoKit
import Foundation
import SQLite3

struct CachePolicy: Sendable {
    let ttl: TimeInterval
    let staleRetention: TimeInterval

    static let walletBalance = CachePolicy(ttl: 30, staleRetention: 30 * 24 * 60 * 60)
    static let shortLived = CachePolicy(ttl: 60, staleRetention: 30 * 24 * 60 * 60)
    static let list = CachePolicy(ttl: 2 * 60, staleRetention: 30 * 24 * 60 * 60)
    static let feed = CachePolicy(ttl: 2 * 60, staleRetention: 30 * 24 * 60 * 60)
    static let mediaFeed = CachePolicy(ttl: 5 * 60, staleRetention: 30 * 24 * 60 * 60)
    static let profile = CachePolicy(ttl: 10 * 60, staleRetention: 90 * 24 * 60 * 60)
    static let catalog = CachePolicy(ttl: 60 * 60, staleRetention: 90 * 24 * 60 * 60)
}

struct CacheKey: Hashable, Sendable {
    let accountScope: String
    let namespace: String
    let key: String

    var identifier: String { "\(accountScope)|\(namespace)|\(key)" }

    @MainActor
    static func current(namespace: String, key: String) -> CacheKey? {
        guard AuthManager.shared.isLoggedIn,
              let userID = AuthManager.shared.currentUser?.userID.trimmingCharacters(in: .whitespacesAndNewlines),
              !userID.isEmpty else { return nil }
        return CacheKey(accountScope: "account:\(userID)", namespace: namespace, key: key)
    }
}

struct CachedSnapshot<Value> {
    let value: Value
    let updatedAt: Date
    let expiresAt: Date
    let isStale: Bool
}

enum CacheResult<Value> {
    case cache(Value, isStale: Bool)
    case remote(Value)
    case staleCache(Value, error: Error)
    case failure(Error)
}

enum ContentLoadState: Equatable {
    case idle
    case initialLoading
    case loaded
    case refreshing
    case failedWithoutCache
}

@MainActor
protocol CachedDataRepository: AnyObject {
    func cachedValue<Value: Codable>(for key: CacheKey, as type: Value.Type) -> CachedSnapshot<Value>?
    func load<Value: Codable>(
        key: CacheKey,
        policy: CachePolicy,
        forceRefresh: Bool,
        fetch: @escaping () async throws -> Value
    ) async -> CacheResult<Value>
    func invalidate(_ key: CacheKey)
}

/// Encrypted, account-scoped Codable snapshots backed by SQLite. This store
/// intentionally lives beside (not inside) MessageStore: message history has
/// its own normalized schema while API read models benefit from versioned
/// snapshots and independent TTLs.
final class PersistentSnapshotStore: @unchecked Sendable {
    static let shared = PersistentSnapshotStore()

    private let queue = DispatchQueue(label: "bbchat.snapshot-store", qos: .utility)
    private var db: OpaquePointer?
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private init() {
        let fileManager = FileManager.default
        let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let directory = support.appendingPathComponent("BWChat", isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var excludedDirectory = directory
        try? excludedDirectory.setResourceValues(values)

        let databaseURL = directory.appendingPathComponent("app-cache.sqlite")
        if sqlite3_open(databaseURL.path, &db) != SQLITE_OK {
            db = nil
            return
        }
        execute("PRAGMA journal_mode=WAL")
        execute("PRAGMA synchronous=NORMAL")
        execute("""
            CREATE TABLE IF NOT EXISTS cache_entries (
                account_scope TEXT NOT NULL,
                namespace TEXT NOT NULL,
                cache_key TEXT NOT NULL,
                payload BLOB NOT NULL,
                updated_at REAL NOT NULL,
                expires_at REAL NOT NULL,
                etag TEXT,
                schema_version INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (account_scope, namespace, cache_key)
            )
        """)
        execute("CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries(account_scope, expires_at)")
    }

    deinit { sqlite3_close(db) }

    func snapshot<Value: Codable>(for key: CacheKey, as type: Value.Type, now: Date = Date()) -> CachedSnapshot<Value>? {
        queue.sync {
            let sql = """
                SELECT payload, updated_at, expires_at
                FROM cache_entries
                WHERE account_scope = ? AND namespace = ? AND cache_key = ?
                LIMIT 1
            """
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
            defer { sqlite3_finalize(statement) }
            Self.bindText(statement, index: 1, value: key.accountScope)
            Self.bindText(statement, index: 2, value: key.namespace)
            Self.bindText(statement, index: 3, value: key.key)
            guard sqlite3_step(statement) == SQLITE_ROW,
                  let encrypted = Self.blob(statement, column: 0),
                  let plaintext = decrypt(encrypted, scope: key.accountScope),
                  let value = try? decoder.decode(Value.self, from: plaintext) else { return nil }

            let updatedAt = Date(timeIntervalSince1970: sqlite3_column_double(statement, 1))
            let expiresAt = Date(timeIntervalSince1970: sqlite3_column_double(statement, 2))
            return CachedSnapshot(value: value, updatedAt: updatedAt, expiresAt: expiresAt, isStale: now >= expiresAt)
        }
    }

    func save<Value: Codable>(
        _ value: Value,
        for key: CacheKey,
        policy: CachePolicy,
        updatedAt: Date = Date(),
        etag: String? = nil
    ) {
        queue.async { [weak self] in
            guard let self,
                  let encoded = try? self.encoder.encode(value),
                  let encrypted = self.encrypt(encoded, scope: key.accountScope) else { return }
            let sql = """
                INSERT OR REPLACE INTO cache_entries
                (account_scope, namespace, cache_key, payload, updated_at, expires_at, etag, schema_version)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            """
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(self.db, sql, -1, &statement, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(statement) }
            Self.bindText(statement, index: 1, value: key.accountScope)
            Self.bindText(statement, index: 2, value: key.namespace)
            Self.bindText(statement, index: 3, value: key.key)
            _ = encrypted.withUnsafeBytes { bytes in
                sqlite3_bind_blob(statement, 4, bytes.baseAddress, Int32(encrypted.count), Self.transientDestructor)
            }
            sqlite3_bind_double(statement, 5, updatedAt.timeIntervalSince1970)
            sqlite3_bind_double(statement, 6, updatedAt.addingTimeInterval(policy.ttl).timeIntervalSince1970)
            if let etag { Self.bindText(statement, index: 7, value: etag) } else { sqlite3_bind_null(statement, 7) }
            sqlite3_step(statement)
        }
    }

    func invalidate(_ key: CacheKey) {
        queue.async { [weak self] in
            guard let self else { return }
            let sql = "UPDATE cache_entries SET expires_at = 0 WHERE account_scope = ? AND namespace = ? AND cache_key = ?"
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(self.db, sql, -1, &statement, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(statement) }
            Self.bindText(statement, index: 1, value: key.accountScope)
            Self.bindText(statement, index: 2, value: key.namespace)
            Self.bindText(statement, index: 3, value: key.key)
            sqlite3_step(statement)
        }
    }

    func removeAccount(_ accountScope: String, deleteKey: Bool) {
        queue.sync {
            let sql = "DELETE FROM cache_entries WHERE account_scope = ?"
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(statement) }
            Self.bindText(statement, index: 1, value: accountScope)
            sqlite3_step(statement)
        }
        if deleteKey { _ = KeychainHelper.delete(key: encryptionKeyName(for: accountScope)) }
    }

    func pruneExpired(before date: Date) {
        queue.async { [weak self] in
            self?.execute("DELETE FROM cache_entries WHERE expires_at < \(date.timeIntervalSince1970)")
        }
    }

    private func encryptionKeyName(for scope: String) -> String {
        let digest = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        return "bbchat.cache-key.\(digest)"
    }

    private func symmetricKey(for scope: String) -> SymmetricKey {
        let name = encryptionKeyName(for: scope)
        if let data = KeychainHelper.loadData(key: name), data.count == 32 {
            return SymmetricKey(data: data)
        }
        let key = SymmetricKey(size: .bits256)
        let data = key.withUnsafeBytes { Data($0) }
        try? KeychainHelper.saveData(key: name, data: data)
        return key
    }

    private func encrypt(_ data: Data, scope: String) -> Data? {
        try? AES.GCM.seal(data, using: symmetricKey(for: scope)).combined
    }

    private func decrypt(_ data: Data, scope: String) -> Data? {
        guard let box = try? AES.GCM.SealedBox(combined: data) else { return nil }
        return try? AES.GCM.open(box, using: symmetricKey(for: scope))
    }

    @discardableResult
    private func execute(_ sql: String) -> Bool {
        sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK
    }

    private static let transientDestructor = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private static func bindText(_ statement: OpaquePointer?, index: Int32, value: String) {
        sqlite3_bind_text(statement, index, (value as NSString).utf8String, -1, transientDestructor)
    }

    private static func blob(_ statement: OpaquePointer?, column: Int32) -> Data? {
        guard let bytes = sqlite3_column_blob(statement, column) else { return nil }
        let count = Int(sqlite3_column_bytes(statement, column))
        return Data(bytes: bytes, count: count)
    }
}

@MainActor
final class AppCacheRepository: CachedDataRepository {
    static let shared = AppCacheRepository()

    private let store: PersistentSnapshotStore
    private var inFlight: [String: Task<Data, Error>] = [:]

    init(store: PersistentSnapshotStore = .shared) {
        self.store = store
    }

    func cachedValue<Value: Codable>(for key: CacheKey, as type: Value.Type = Value.self) -> CachedSnapshot<Value>? {
        guard isCurrentAccount(key) else { return nil }
        return store.snapshot(for: key, as: type)
    }

    func save<Value: Codable>(_ value: Value, for key: CacheKey, policy: CachePolicy) {
        guard isCurrentAccount(key) else { return }
        store.save(value, for: key, policy: policy)
    }

    func load<Value: Codable>(
        key: CacheKey,
        policy: CachePolicy,
        forceRefresh: Bool = false,
        fetch: @escaping () async throws -> Value
    ) async -> CacheResult<Value> {
        guard isCurrentAccount(key) else {
            return .failure(CacheRepositoryError.accountLocked)
        }

        let rawCached: CachedSnapshot<Value>? = store.snapshot(for: key, as: Value.self)
        let cached = rawCached.flatMap { isRetained($0, policy: policy) ? $0 : nil }
        if let cached, !cached.isStale, !forceRefresh {
            return .cache(cached.value, isStale: false)
        }

        if let cached, cached.isStale, !forceRefresh {
            Task { [weak self] in
                guard let self else { return }
                let _: Value? = try? await self.refreshValue(key: key, policy: policy, fetch: fetch)
            }
            return .cache(cached.value, isStale: true)
        }

        do {
            let data = try await coalescedData(for: key.identifier) {
                let value = try await fetch()
                return try JSONEncoder().encode(value)
            }
            let value = try JSONDecoder().decode(Value.self, from: data)
            store.save(value, for: key, policy: policy)
            return .remote(value)
        } catch {
            if let cached { return .staleCache(cached.value, error: error) }
            // A missing cache cannot supply Value. Callers that care about
            // the concrete failure receive it by throwing through `loadValue`.
            return .failure(error)
        }
    }

    func loadValue<Value: Codable>(
        key: CacheKey,
        policy: CachePolicy,
        forceRefresh: Bool = false,
        fetch: @escaping () async throws -> Value
    ) async throws -> Value {
        guard isCurrentAccount(key) else { throw CacheRepositoryError.accountLocked }
        let rawCached: CachedSnapshot<Value>? = store.snapshot(for: key, as: Value.self)
        let cached = rawCached.flatMap { isRetained($0, policy: policy) ? $0 : nil }
        if let cached, !cached.isStale, !forceRefresh {
            return cached.value
        }
        do {
            return try await refreshValue(key: key, policy: policy, fetch: fetch)
        } catch {
            if let cached { return cached.value }
            throw error
        }
    }

    func invalidate(_ key: CacheKey) { store.invalidate(key) }

    func removeAccountData(userID: String) {
        store.removeAccount("account:\(userID)", deleteKey: true)
    }

    private func coalescedData(for identifier: String, operation: @escaping () async throws -> Data) async throws -> Data {
        if let existing = inFlight[identifier] { return try await existing.value }
        let task = Task { try await operation() }
        inFlight[identifier] = task
        defer { inFlight[identifier] = nil }
        return try await task.value
    }

    private func refreshValue<Value: Codable>(
        key: CacheKey,
        policy: CachePolicy,
        fetch: @escaping () async throws -> Value
    ) async throws -> Value {
        let data = try await coalescedData(for: key.identifier) {
            try JSONEncoder().encode(try await fetch())
        }
        let value = try JSONDecoder().decode(Value.self, from: data)
        store.save(value, for: key, policy: policy)
        return value
    }

    private func isRetained<Value>(_ snapshot: CachedSnapshot<Value>, policy: CachePolicy) -> Bool {
        Date().timeIntervalSince(snapshot.expiresAt) <= policy.staleRetention
    }

    private func isCurrentAccount(_ key: CacheKey) -> Bool {
        guard AuthManager.shared.isLoggedIn, let userID = AuthManager.shared.currentUser?.userID else { return false }
        return key.accountScope == "account:\(userID)"
    }
}

private enum CacheRepositoryError: LocalizedError {
    case accountLocked
    case noCachedValue

    var errorDescription: String? {
        switch self {
        case .accountLocked: return "Account cache is locked"
        case .noCachedValue: return "No cached value"
        }
    }
}
