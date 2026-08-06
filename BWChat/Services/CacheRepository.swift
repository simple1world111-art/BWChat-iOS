import CryptoKit
import Foundation
import SQLite3

enum WalletCacheSchemaMigration {
    static let currentVersion = 3

    private static let oldestLegacyCurrency = ["cat", "food"].joined(separator: "_")
    private static let previousCurrency = ["cat", "coin"].joined(separator: "_")
    private static let canonicalCurrency = "gold_coin"

    private static var keyMap: [String: String] {
        var mappings: [String: String] = [:]

        for legacyCurrency in [oldestLegacyCurrency, previousCurrency] {
            mappings[legacyCurrency] = canonicalCurrency
            mappings[legacyCurrency + "_balance"] = canonicalCurrency + "_balance"
            mappings[legacyCurrency + "_amount"] = canonicalCurrency + "_amount"
            mappings[legacyCurrency + "_products"] = canonicalCurrency + "_products"
            mappings[legacyCurrency + "_balance_after"] = canonicalCurrency + "_balance_after"
        }

        for prefix in ["recharge_", "gift_income_", "withdraw_frozen_", "withdrawable_", "chat_money_frozen_"] {
            mappings[prefix + previousCurrency + "_balance"] = prefix + canonicalCurrency + "_balance"
        }

        let previousPluralCurrency = previousCurrency + "s"
        mappings["charged_" + oldestLegacyCurrency] = "charged_gold_coins"
        mappings["earned_" + oldestLegacyCurrency] = "earned_gold_coins"
        mappings["unlock_price_" + oldestLegacyCurrency] = "unlock_price_gold_coins"
        mappings["charged_" + previousPluralCurrency] = "charged_gold_coins"
        mappings["earned_" + previousPluralCurrency] = "earned_gold_coins"
        mappings["unlock_price_" + previousPluralCurrency] = "unlock_price_gold_coins"
        mappings["entry_price_" + previousPluralCurrency] = "entry_price_gold_coins"

        let oldestCamel = "cat" + "Food"
        let previousCamel = "cat" + "Coin"
        for legacyCamel in [oldestCamel, previousCamel] {
            mappings[legacyCamel] = "goldCoin"
            mappings[legacyCamel + "Balance"] = "goldCoinBalance"
            mappings[legacyCamel + "Amount"] = "goldCoinAmount"
            mappings[legacyCamel + "Products"] = "goldCoinProducts"
            mappings[legacyCamel + "BalanceAfter"] = "goldCoinBalanceAfter"
        }
        mappings["charged" + "Cat" + "Food"] = "chargedGoldCoins"
        mappings["earned" + "Cat" + "Food"] = "earnedGoldCoins"
        mappings["unlockPrice" + "Cat" + "Food"] = "unlockPriceGoldCoins"
        mappings["charged" + "Cat" + "Coins"] = "chargedGoldCoins"
        mappings["earned" + "Cat" + "Coins"] = "earnedGoldCoins"
        mappings["unlockPrice" + "Cat" + "Coins"] = "unlockPriceGoldCoins"
        mappings["entryPrice" + "Cat" + "Coins"] = "entryPriceGoldCoins"

        return mappings
    }

    static func migrateJSONObject(_ object: Any) -> Any {
        if let dictionary = object as? [String: Any] {
            var result: [String: Any] = [:]

            // Canonical keys win when both versions exist.
            for (key, value) in dictionary where keyMap[key] == nil {
                result[key] = migrateJSONObject(value)
            }
            for (key, value) in dictionary {
                guard let canonicalKey = keyMap[key], result[canonicalKey] == nil else { continue }
                result[canonicalKey] = migrateJSONObject(value)
            }
            return result
        }
        if let array = object as? [Any] {
            return array.map(migrateJSONObject)
        }
        if let string = object as? String,
           string == oldestLegacyCurrency || string == previousCurrency {
            return canonicalCurrency
        }
        return object
    }

    static func migratedJSONData(_ data: Data) -> Data? {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              JSONSerialization.isValidJSONObject(object) else { return nil }
        let migrated = migrateJSONObject(object)
        return try? JSONSerialization.data(withJSONObject: migrated, options: [.sortedKeys])
    }
}

enum WalletLegacyUserDefaultsMigration {
    static func run(userID: String, defaults: UserDefaults = .standard) {
        guard !userID.isEmpty else { return }
        let versionKey = "bbchat.wallet.cache-schema-version.\(userID)"
        guard defaults.integer(forKey: versionKey) < WalletCacheSchemaMigration.currentVersion else { return }

        let canonicalCurrency = "gold_coin"
        let previousCurrency = ["cat", "coin"].joined(separator: "_")
        let canonicalStem = "bbchat.wallet." + canonicalCurrency
        let previousStem = "bbchat.wallet." + previousCurrency
        let oldestLegacyStem = "bbchat.wallet." + "cat" + "food"
        migrateValue(
            from: previousStem + ".balance.\(userID)",
            to: canonicalStem + ".balance.\(userID)",
            defaults: defaults
        )
        migrateValue(
            from: previousStem + ".processedTransactions.\(userID)",
            to: canonicalStem + ".processedTransactions.\(userID)",
            defaults: defaults
        )
        migrateValue(
            from: oldestLegacyStem + ".balance.\(userID)",
            to: canonicalStem + ".balance.\(userID)",
            defaults: defaults
        )
        migrateValue(
            from: oldestLegacyStem + ".processedTransactions.\(userID)",
            to: canonicalStem + ".processedTransactions.\(userID)",
            defaults: defaults
        )
        defaults.set(WalletCacheSchemaMigration.currentVersion, forKey: versionKey)
    }

    private static func migrateValue(from legacyKey: String, to canonicalKey: String, defaults: UserDefaults) {
        if defaults.object(forKey: canonicalKey) == nil,
           let legacyValue = defaults.object(forKey: legacyKey) {
            defaults.set(legacyValue, forKey: canonicalKey)
        }
        defaults.removeObject(forKey: legacyKey)
    }
}

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
    static let scriptCatalog = CachePolicy(ttl: 5 * 60, staleRetention: 90 * 24 * 60 * 60)
    static let agentCatalog = CachePolicy(ttl: 5 * 60, staleRetention: 90 * 24 * 60 * 60)
    static let agentChat = CachePolicy(ttl: 5 * 60, staleRetention: 365 * 24 * 60 * 60)
    static let scriptRoom = CachePolicy(ttl: 5 * 60, staleRetention: 365 * 24 * 60 * 60)
    static let draft = CachePolicy(ttl: 100 * 365 * 24 * 60 * 60, staleRetention: 0)
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
        // Existing installations created this table before snapshot schemas
        // were versioned. SQLite reports a harmless duplicate-column error on
        // fresh databases where CREATE TABLE already included the column.
        execute("ALTER TABLE cache_entries ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1")
        execute("CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries(account_scope, expires_at)")
        migrateWalletCurrencySchemaIfNeeded()
        purgeRemovedFavoritesCacheIfNeeded()
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
            guard let self else { return }
            if !self.write(value, for: key, policy: policy, updatedAt: updatedAt, etag: etag) {
                print("[CacheRepository] save failed namespace=\(key.namespace)")
            }
        }
    }

    /// Durability seam for network refreshes that must not report success
    /// before the replacement snapshot has reached SQLite.
    func saveAsync<Value: Codable>(
        _ value: Value,
        for key: CacheKey,
        policy: CachePolicy,
        updatedAt: Date = Date(),
        etag: String? = nil
    ) async -> Bool {
        await withCheckedContinuation { continuation in
            queue.async { [weak self] in
                guard let self else {
                    continuation.resume(returning: false)
                    return
                }
                let saved = self.write(
                    value,
                    for: key,
                    policy: policy,
                    updatedAt: updatedAt,
                    etag: etag
                )
                if !saved {
                    print("[CacheRepository] save failed namespace=\(key.namespace)")
                }
                continuation.resume(returning: saved)
            }
        }
    }

    private func write<Value: Codable>(
        _ value: Value,
        for key: CacheKey,
        policy: CachePolicy,
        updatedAt: Date,
        etag: String?
    ) -> Bool {
        guard let encoded = try? encoder.encode(value),
              let encrypted = encrypt(encoded, scope: key.accountScope) else { return false }
        let sql = """
            INSERT OR REPLACE INTO cache_entries
            (account_scope, namespace, cache_key, payload, updated_at, expires_at, etag, schema_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, \(WalletCacheSchemaMigration.currentVersion))
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return false }
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
        return sqlite3_step(statement) == SQLITE_DONE
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

    func remove(_ key: CacheKey) {
        queue.async { [weak self] in
            guard let self else { return }
            let sql = "DELETE FROM cache_entries WHERE account_scope = ? AND namespace = ? AND cache_key = ?"
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(self.db, sql, -1, &statement, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(statement) }
            Self.bindText(statement, index: 1, value: key.accountScope)
            Self.bindText(statement, index: 2, value: key.namespace)
            Self.bindText(statement, index: 3, value: key.key)
            sqlite3_step(statement)
        }
    }

    func removeNamespace(accountScope: String, namespace: String) {
        queue.async { [weak self] in
            guard let self else { return }
            let sql = "DELETE FROM cache_entries WHERE account_scope = ? AND namespace = ?"
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(self.db, sql, -1, &statement, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(statement) }
            Self.bindText(statement, index: 1, value: accountScope)
            Self.bindText(statement, index: 2, value: namespace)
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

    private func purgeRemovedFavoritesCacheIfNeeded() {
        let migrationKey = "bbchat.cache-migration.favorites-removed-v1"
        guard !UserDefaults.standard.bool(forKey: migrationKey) else { return }
        guard execute("DELETE FROM cache_entries WHERE namespace = 'favorites-v1'") else { return }
        UserDefaults.standard.set(true, forKey: migrationKey)
    }

    private func migrateWalletCurrencySchemaIfNeeded() {
        let sql = """
            SELECT account_scope, namespace, cache_key, payload
            FROM cache_entries
            WHERE schema_version < ?
        """
        var select: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &select, nil) == SQLITE_OK else { return }
        defer { sqlite3_finalize(select) }
        sqlite3_bind_int(select, 1, Int32(WalletCacheSchemaMigration.currentVersion))

        var rows: [(String, String, String, Data)] = []
        while sqlite3_step(select) == SQLITE_ROW {
            guard let accountScope = Self.text(select, column: 0),
                  let namespace = Self.text(select, column: 1),
                  let cacheKey = Self.text(select, column: 2),
                  let encrypted = Self.blob(select, column: 3),
                  let plaintext = decrypt(encrypted, scope: accountScope),
                  let migrated = WalletCacheSchemaMigration.migratedJSONData(plaintext),
                  let reencrypted = encrypt(migrated, scope: accountScope) else { continue }
            rows.append((accountScope, namespace, cacheKey, reencrypted))
        }

        let updateSQL = """
            UPDATE cache_entries SET payload = ?, schema_version = ?
            WHERE account_scope = ? AND namespace = ? AND cache_key = ?
        """
        for row in rows {
            var update: OpaquePointer?
            guard sqlite3_prepare_v2(db, updateSQL, -1, &update, nil) == SQLITE_OK else { continue }
            _ = row.3.withUnsafeBytes { bytes in
                sqlite3_bind_blob(update, 1, bytes.baseAddress, Int32(row.3.count), Self.transientDestructor)
            }
            sqlite3_bind_int(update, 2, Int32(WalletCacheSchemaMigration.currentVersion))
            Self.bindText(update, index: 3, value: row.0)
            Self.bindText(update, index: 4, value: row.1)
            Self.bindText(update, index: 5, value: row.2)
            sqlite3_step(update)
            sqlite3_finalize(update)
        }
    }

    private func encryptionKeyName(for scope: String) -> String {
        let digest = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        return "bbchat.cache-key.\(digest)"
    }

    private func existingSymmetricKey(for scope: String) -> SymmetricKey? {
        let name = encryptionKeyName(for: scope)
        if let data = KeychainHelper.loadData(key: name), data.count == 32 {
            return SymmetricKey(data: data)
        }
        return nil
    }

    private func symmetricKeyForEncryption(for scope: String) -> SymmetricKey? {
        if let existing = existingSymmetricKey(for: scope) { return existing }
        let name = encryptionKeyName(for: scope)
        let key = SymmetricKey(size: .bits256)
        let data = key.withUnsafeBytes { Data($0) }
        do {
            try KeychainHelper.saveData(key: name, data: data)
        } catch {
            print("[CacheRepository] encryption key save failed")
            return nil
        }
        guard KeychainHelper.loadData(key: name) == data else {
            print("[CacheRepository] encryption key readback failed")
            return nil
        }
        return SymmetricKey(data: data)
    }

    private func encrypt(_ data: Data, scope: String) -> Data? {
        guard let key = symmetricKeyForEncryption(for: scope) else { return nil }
        return try? AES.GCM.seal(data, using: key).combined
    }

    private func decrypt(_ data: Data, scope: String) -> Data? {
        guard let key = existingSymmetricKey(for: scope),
              let box = try? AES.GCM.SealedBox(combined: data) else { return nil }
        return try? AES.GCM.open(box, using: key)
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

    private static func text(_ statement: OpaquePointer?, column: Int32) -> String? {
        guard let value = sqlite3_column_text(statement, column) else { return nil }
        return String(cString: value)
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
            guard isCurrentAccount(key) else {
                return .failure(CacheRepositoryError.accountLocked)
            }
            _ = await store.saveAsync(value, for: key, policy: policy)
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

    func remove(_ key: CacheKey) { store.remove(key) }

    func removeNamespace(_ namespace: String) {
        guard AuthManager.shared.isLoggedIn,
              let userID = AuthManager.shared.currentUser?.userID.trimmingCharacters(in: .whitespacesAndNewlines),
              !userID.isEmpty else { return }
        let accountScope = "account:\(userID)"
        let prefix = "\(accountScope)|\(namespace)|"
        let matchingIdentifiers = inFlight.keys.filter { $0.hasPrefix(prefix) }
        for identifier in matchingIdentifiers {
            inFlight[identifier]?.cancel()
            inFlight[identifier] = nil
        }
        store.removeNamespace(accountScope: accountScope, namespace: namespace)
    }

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
        guard isCurrentAccount(key) else { throw CacheRepositoryError.accountLocked }
        _ = await store.saveAsync(value, for: key, policy: policy)
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

struct CachedAgentCatalogSnapshot: Codable, Equatable {
    let runtimeConfig: AgentRuntimeConfig?
    let installedAgents: [AgentSummary]
    let conversations: [AgentConversation]
    let joinedScriptRooms: [Conversation]
    let spendableBalance: Int?

    private enum CodingKeys: String, CodingKey {
        case runtimeConfig
        case installedAgents
        case conversations
        case joinedScriptRooms
        case spendableBalance
        case legacyWalletBalance = "walletBalance"
    }

    init(
        runtimeConfig: AgentRuntimeConfig?,
        installedAgents: [AgentSummary],
        conversations: [AgentConversation],
        joinedScriptRooms: [Conversation] = [],
        spendableBalance: Int?
    ) {
        self.runtimeConfig = runtimeConfig
        self.installedAgents = installedAgents
        self.conversations = conversations
        self.joinedScriptRooms = joinedScriptRooms
        self.spendableBalance = spendableBalance
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        runtimeConfig = try container.decodeIfPresent(AgentRuntimeConfig.self, forKey: .runtimeConfig)
        installedAgents = try container.decodeIfPresent([AgentSummary].self, forKey: .installedAgents) ?? []
        conversations = try container.decodeIfPresent([AgentConversation].self, forKey: .conversations) ?? []
        // Keep snapshots written before joined scripts were shown in the Agent Hub readable.
        joinedScriptRooms = try container.decodeIfPresent([Conversation].self, forKey: .joinedScriptRooms) ?? []
        spendableBalance = try container.decodeIfPresent(Int.self, forKey: .spendableBalance)
            ?? container.decodeIfPresent(Int.self, forKey: .legacyWalletBalance)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(runtimeConfig, forKey: .runtimeConfig)
        try container.encode(installedAgents, forKey: .installedAgents)
        try container.encode(conversations, forKey: .conversations)
        try container.encode(joinedScriptRooms, forKey: .joinedScriptRooms)
        try container.encodeIfPresent(spendableBalance, forKey: .spendableBalance)
    }
}

/// Account-scoped snapshot for the Agent Hub. It outlives the SwiftUI view so
/// navigating away and back does not replace the list with a loading screen.
@MainActor
enum AgentCatalogLocalCache {
    private static let namespace = "agent-catalog-v1"
    private static let cacheKey = "overview"

    static func cachedSnapshot() -> CachedSnapshot<CachedAgentCatalogSnapshot>? {
        guard let key = CacheKey.current(namespace: namespace, key: cacheKey) else {
            return nil
        }
        let snapshot: CachedSnapshot<CachedAgentCatalogSnapshot>? =
            AppCacheRepository.shared.cachedValue(for: key)
        guard let snapshot,
              Date().timeIntervalSince(snapshot.expiresAt) <= CachePolicy.agentCatalog.staleRetention else {
            return nil
        }
        return snapshot
    }

    static func save(_ snapshot: CachedAgentCatalogSnapshot) {
        guard let key = CacheKey.current(namespace: namespace, key: cacheKey) else {
            return
        }
        AppCacheRepository.shared.save(snapshot, for: key, policy: .agentCatalog)
    }

    static func invalidate() {
        guard let key = CacheKey.current(namespace: namespace, key: cacheKey) else {
            return
        }
        AppCacheRepository.shared.invalidate(key)
    }
}

/// Account-scoped snapshots needed to open an existing agent chat without a
/// network round trip. Media pixels continue to use ImageCacheManager; this
/// cache owns the conversation metadata and decoded message timeline.
@MainActor
enum AgentChatLocalCache {
    private static let conversationNamespace = "agent-conversation"
    private static let messageNamespace = "agent-messages"

    static func cachedConversation(id: String) -> AgentConversation? {
        guard let key = CacheKey.current(namespace: conversationNamespace, key: id) else {
            return nil
        }
        let snapshot: CachedSnapshot<AgentConversation>? = AppCacheRepository.shared.cachedValue(for: key)
        return snapshot?.value
    }

    static func saveConversation(_ conversation: AgentConversation) {
        guard let key = CacheKey.current(
            namespace: conversationNamespace,
            key: conversation.id
        ) else { return }
        AppCacheRepository.shared.save(conversation, for: key, policy: .agentChat)
    }

    static func saveConversations(_ conversations: [AgentConversation]) {
        conversations.forEach(saveConversation)
    }

    static func cachedMessagePage(conversationID: String) -> CachedAgentMessagePage? {
        guard let key = CacheKey.current(namespace: messageNamespace, key: conversationID) else {
            return nil
        }
        let snapshot: CachedSnapshot<CachedAgentMessagePage>? = AppCacheRepository.shared.cachedValue(for: key)
        return snapshot?.value
    }

    static func saveMessages(
        _ messages: [AgentMessage],
        hasMore: Bool,
        conversationID: String
    ) {
        guard let key = CacheKey.current(namespace: messageNamespace, key: conversationID) else {
            return
        }
        AppCacheRepository.shared.save(
            CachedAgentMessagePage(messages: messages, hasMore: hasMore),
            for: key,
            policy: .agentChat
        )
    }
}

/// Account-scoped room metadata for script chats. Group messages themselves
/// remain in MessageStore so the room snapshot and timeline have independent
/// lifecycles, matching the agent-chat cache layout.
@MainActor
enum ScriptRoomLocalCache {
    private static let namespace = "script-room-v1"

    static func cachedSnapshot(roomID: String) -> CachedSnapshot<ScriptRoom>? {
        guard let key = CacheKey.current(namespace: namespace, key: roomID) else {
            return nil
        }
        let snapshot: CachedSnapshot<ScriptRoom>? = AppCacheRepository.shared.cachedValue(for: key)
        guard let snapshot,
              Date().timeIntervalSince(snapshot.expiresAt) <= CachePolicy.scriptRoom.staleRetention else {
            return nil
        }
        return snapshot
    }

    static func cachedRoom(roomID: String) -> ScriptRoom? {
        cachedSnapshot(roomID: roomID)?.value
    }

    static func saveRoom(_ room: ScriptRoom) {
        guard let key = CacheKey.current(namespace: namespace, key: room.roomID) else {
            return
        }
        AppCacheRepository.shared.save(room, for: key, policy: .scriptRoom)
    }
}

struct ChatDraftQuote: Codable, Equatable {
    let messageID: Int
    let senderID: String
    let senderName: String
    let msgType: String
    let content: String
    let timestamp: String
}

struct ChatDraftRecord: Codable, Equatable {
    let schemaVersion: Int
    var document: ComposerDocument
    var quote: ChatDraftQuote?
    var updatedAt: Date

    init(document: ComposerDocument, quote: ChatDraftQuote?, updatedAt: Date = Date()) {
        self.schemaVersion = 1
        self.document = document
        self.quote = quote
        self.updatedAt = updatedAt
    }

    var isEmpty: Bool {
        document.text.isBlank && quote == nil
    }
}

@MainActor
final class ChatDraftStore: ObservableObject {
    static let shared = ChatDraftStore()

    @Published private(set) var revision = 0
    private var pendingSaves: [String: Task<Void, Never>] = [:]
    private var memoryRecords: [String: ChatDraftRecord] = [:]

    private init() {}

    func draft(conversationType: String, conversationID: String) -> ChatDraftRecord? {
        guard let key = cacheKey(conversationType: conversationType, conversationID: conversationID) else {
            return nil
        }
        if let record = memoryRecords[key.identifier] {
            return record
        }
        let snapshot: CachedSnapshot<ChatDraftRecord>? = AppCacheRepository.shared.cachedValue(for: key)
        if let record = snapshot?.value {
            memoryRecords[key.identifier] = record
        }
        return snapshot?.value
    }

    func preview(for conversation: Conversation) -> String? {
        guard conversation.isDM || conversation.isGroup else { return nil }
        let type = conversation.isGroup ? "group" : "dm"
        let id = conversation.isGroup
            ? conversation.resolvedGroupID.map(String.init) ?? conversation.id
            : conversation.id
        guard let draft = draft(conversationType: type, conversationID: id), !draft.isEmpty else {
            return nil
        }
        let text = draft.document.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { return text }
        return draft.quote.map { L10n.tr("draft.quote", $0.senderName) }
    }

    func scheduleSave(
        document: ComposerDocument,
        quote: ChatDraftQuote?,
        conversationType: String,
        conversationID: String
    ) {
        guard let key = cacheKey(conversationType: conversationType, conversationID: conversationID) else {
            return
        }
        pendingSaves[key.identifier]?.cancel()
        pendingSaves[key.identifier] = nil

        // Deletion must win immediately. Debouncing an empty document leaves a
        // window where a disappearing chat view can flush the previous draft
        // back to disk before the delayed removal runs.
        let record = ChatDraftRecord(document: document, quote: quote)
        guard !record.isEmpty else {
            persist(document: document, quote: quote, key: key)
            return
        }

        pendingSaves[key.identifier] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            self?.persist(
                document: document,
                quote: quote,
                key: key
            )
        }
    }

    func flush(
        document: ComposerDocument,
        quote: ChatDraftQuote?,
        conversationType: String,
        conversationID: String
    ) {
        guard let key = cacheKey(conversationType: conversationType, conversationID: conversationID) else {
            return
        }
        pendingSaves[key.identifier]?.cancel()
        pendingSaves[key.identifier] = nil
        persist(document: document, quote: quote, key: key)
    }

    func remove(conversationType: String, conversationID: String) {
        guard let key = cacheKey(conversationType: conversationType, conversationID: conversationID) else {
            return
        }
        pendingSaves[key.identifier]?.cancel()
        pendingSaves[key.identifier] = nil
        memoryRecords[key.identifier] = nil
        AppCacheRepository.shared.remove(key)
        revision &+= 1
    }

    func removeIfMatching(
        text: String,
        replyID: Int?,
        conversationType: String,
        conversationID: String
    ) {
        guard let existing = draft(
            conversationType: conversationType,
            conversationID: conversationID
        ) else { return }
        guard existing.document.text.trimmingCharacters(in: .whitespacesAndNewlines)
                == text.trimmingCharacters(in: .whitespacesAndNewlines),
              existing.quote?.messageID == replyID else { return }
        remove(conversationType: conversationType, conversationID: conversationID)
    }

    private func persist(document: ComposerDocument, quote: ChatDraftQuote?, key: CacheKey) {
        let record = ChatDraftRecord(document: document, quote: quote)
        if record.isEmpty {
            memoryRecords[key.identifier] = nil
            AppCacheRepository.shared.remove(key)
        } else {
            memoryRecords[key.identifier] = record
            AppCacheRepository.shared.save(record, for: key, policy: .draft)
        }
        revision &+= 1
    }

    private func cacheKey(conversationType: String, conversationID: String) -> CacheKey? {
        CacheKey.current(
            namespace: "chat-draft-v1",
            key: "\(conversationType):\(conversationID)"
        )
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
