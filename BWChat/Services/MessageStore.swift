// BWChat/Services/MessageStore.swift
// Local SQLite cache for messages and conversations

import Foundation
import SQLite3

final class MessageStore: @unchecked Sendable {
    static let shared = MessageStore()

    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "com.bbchat.messagestore", qos: .userInitiated)
    private var activeOwnerID = ""

    private init() {
        openDatabase()
        createTables()
    }

    // Async compatibility layer for UI-facing callers. SQLite access remains
    // serialized by `queue`; the waiting thread is a utility worker instead
    // of the main actor.
    func loadMessagesAsync(
        userID: String,
        contactID: String,
        beforeID: Int? = nil,
        limit: Int = 30
    ) async -> [Message] {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: self.loadMessages(
                    userID: userID,
                    contactID: contactID,
                    beforeID: beforeID,
                    limit: limit
                ))
            }
        }
    }

    func latestMessageIDAsync(userID: String, contactID: String) async -> Int? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: self.latestMessageID(
                    userID: userID,
                    contactID: contactID
                ))
            }
        }
    }

    func localMessageCountAsync(userID: String, contactID: String) async -> Int {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                continuation.resume(returning: self.localMessageCount(
                    userID: userID,
                    contactID: contactID
                ))
            }
        }
    }

    func saveMessagesAsync(_ messages: [Message], ownerID: String? = nil) async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                self.saveMessages(messages, ownerID: ownerID)
                continuation.resume()
            }
        }
    }

    func loadGroupMessagesAsync(
        ownerID: String? = nil,
        groupID: Int,
        beforeID: Int? = nil,
        limit: Int = 30
    ) async -> [GroupMessage] {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: self.loadGroupMessages(
                    ownerID: ownerID,
                    groupID: groupID,
                    beforeID: beforeID,
                    limit: limit
                ))
            }
        }
    }

    func latestGroupMessageIDAsync(ownerID: String? = nil, groupID: Int) async -> Int? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: self.latestGroupMessageID(
                    ownerID: ownerID,
                    groupID: groupID
                ))
            }
        }
    }

    func saveGroupMessagesAsync(_ messages: [GroupMessage], ownerID: String? = nil) async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                self.saveGroupMessages(messages, ownerID: ownerID)
                continuation.resume()
            }
        }
    }

    func loadConversationsAsync(ownerID: String) async -> [Conversation] {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: self.loadConversations(ownerID: ownerID))
            }
        }
    }

    func saveConversationsAsync(_ conversations: [Conversation], ownerID: String) async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                self.saveConversations(conversations, ownerID: ownerID)
                continuation.resume()
            }
        }
    }

    deinit {
        sqlite3_close(db)
    }

    // MARK: - Database Setup

    private func openDatabase() {
        let fileManager = FileManager.default
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dbDir = appSupport.appendingPathComponent("BBchat", isDirectory: true)
        try? fileManager.createDirectory(at: dbDir, withIntermediateDirectories: true)

        let dbURL = dbDir.appendingPathComponent("messages.sqlite")

        // Exclude from iCloud backup
        var resourceURL = dbURL
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? resourceURL.setResourceValues(values)

        if sqlite3_open(dbURL.path, &db) != SQLITE_OK {
            print("[MessageStore] Failed to open database")
            db = nil
        }

        // Enable WAL mode for better concurrent read/write
        exec("PRAGMA journal_mode=WAL")
        exec("PRAGMA synchronous=NORMAL")
        exec("PRAGMA secure_delete=FAST")
        try? fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: dbURL.path
        )
    }

    private func createTables() {
        migrateDirectMessagesTableIfNeeded()
        addColumnIfNeeded(table: "messages", column: "version", definition: "INTEGER NOT NULL DEFAULT 1")
        addColumnIfNeeded(table: "messages", column: "updated_at", definition: "TEXT")
        addColumnIfNeeded(table: "messages", column: "client_message_id", definition: "TEXT")
        addColumnIfNeeded(table: "messages", column: "thumbnail_url", definition: "TEXT")
        exec("CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages (owner_id, sender_id, receiver_id, id)")
        exec("CREATE INDEX IF NOT EXISTS idx_msg_ts ON messages (owner_id, timestamp)")
        exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_client_id ON messages (owner_id, client_message_id) WHERE client_message_id IS NOT NULL")

        exec("""
            CREATE TABLE IF NOT EXISTS group_messages (
                owner_id TEXT NOT NULL,
                id INTEGER NOT NULL,
                group_id INTEGER NOT NULL,
                sender_id TEXT NOT NULL,
                msg_type TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                sender_nickname TEXT NOT NULL DEFAULT '',
                sender_avatar TEXT NOT NULL DEFAULT '',
                reply_to_id INTEGER,
                reply_to_json TEXT,
                mentions TEXT,
                script_context_json TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT,
                mention_all INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (owner_id, id)
            )
        """)
        migrateGroupMessagesTableIfNeeded()
        addColumnIfNeeded(table: "group_messages", column: "script_context_json", definition: "TEXT")
        addColumnIfNeeded(table: "group_messages", column: "version", definition: "INTEGER NOT NULL DEFAULT 1")
        addColumnIfNeeded(table: "group_messages", column: "updated_at", definition: "TEXT")
        addColumnIfNeeded(table: "group_messages", column: "client_message_id", definition: "TEXT")
        addColumnIfNeeded(table: "group_messages", column: "mention_all", definition: "INTEGER NOT NULL DEFAULT 0")
        addColumnIfNeeded(table: "group_messages", column: "history_sequence", definition: "INTEGER")
        addColumnIfNeeded(table: "group_messages", column: "thumbnail_url", definition: "TEXT")
        exec("CREATE INDEX IF NOT EXISTS idx_gmsg_group ON group_messages (owner_id, group_id)")
        exec("CREATE INDEX IF NOT EXISTS idx_gmsg_ts ON group_messages (owner_id, group_id, timestamp)")
        exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_gmsg_client_id ON group_messages (owner_id, client_message_id) WHERE client_message_id IS NOT NULL")

        exec("""
            CREATE TABLE IF NOT EXISTS local_message_tombstones (
                owner_id TEXT NOT NULL,
                conversation_type TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                message_id INTEGER NOT NULL,
                deleted_at REAL NOT NULL,
                PRIMARY KEY (owner_id, conversation_type, conversation_id, message_id)
            )
        """)
        exec("CREATE INDEX IF NOT EXISTS idx_tombstone_owner ON local_message_tombstones (owner_id, conversation_type, conversation_id)")

        exec("""
            CREATE TABLE IF NOT EXISTS direct_history_clear_watermarks (
                owner_id TEXT NOT NULL,
                contact_id TEXT NOT NULL,
                cleared_before_message_id INTEGER NOT NULL,
                updated_at REAL NOT NULL,
                PRIMARY KEY (owner_id, contact_id)
            )
        """)

        exec("""
            CREATE TABLE IF NOT EXISTS group_history_clear_watermarks (
                owner_id TEXT NOT NULL,
                group_id INTEGER NOT NULL,
                cleared_before_sequence INTEGER NOT NULL,
                updated_at REAL NOT NULL,
                PRIMARY KEY (owner_id, group_id)
            )
        """)

        migrateConversationsTableIfNeeded()
        addColumnIfNeeded(table: "conversations", column: "is_muted", definition: "INTEGER NOT NULL DEFAULT 0")
        addColumnIfNeeded(table: "conversations", column: "conversation_kind", definition: "TEXT")
        addColumnIfNeeded(table: "conversations", column: "script_room_id", definition: "TEXT")
        addColumnIfNeeded(table: "conversations", column: "script_id", definition: "TEXT")
        addColumnIfNeeded(table: "conversations", column: "agent_conversation_id", definition: "TEXT")
        addColumnIfNeeded(table: "conversations", column: "agent_id", definition: "TEXT")
        addColumnIfNeeded(table: "conversations", column: "agent_avatar_asset_id", definition: "TEXT")
        addColumnIfNeeded(table: "conversations", column: "agent_greeting_id", definition: "TEXT")
        addColumnIfNeeded(table: "conversations", column: "last_message_id", definition: "INTEGER")
        addColumnIfNeeded(table: "conversations", column: "read_through_message_id", definition: "INTEGER")
        addColumnIfNeeded(table: "conversations", column: "revision", definition: "INTEGER")
    }

    private func createDirectMessagesTable() {
        exec("""
            CREATE TABLE IF NOT EXISTS messages (
                owner_id TEXT NOT NULL,
                id INTEGER NOT NULL,
                sender_id TEXT NOT NULL,
                receiver_id TEXT NOT NULL,
                msg_type TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                reply_to_id INTEGER,
                reply_to_json TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT,
                PRIMARY KEY (owner_id, id)
            )
        """)
    }

    private func migrateDirectMessagesTableIfNeeded() {
        let columns = tableColumnNames("messages")
        guard !columns.isEmpty else {
            createDirectMessagesTable()
            return
        }
        guard !columns.contains("owner_id") else { return }

        exec("BEGIN IMMEDIATE TRANSACTION")
        guard exec("ALTER TABLE messages RENAME TO messages_legacy") else {
            exec("ROLLBACK")
            return
        }
        createDirectMessagesTable()

        var owners = Set(UserDefaults.standard.stringArray(forKey: "bbchat.known_account_ids") ?? [])
        let legacyOwner = legacyOwnerID()
        if !legacyOwner.isEmpty { owners.insert(legacyOwner) }
        for ownerID in owners where !ownerID.isEmpty {
            let owner = esc(ownerID)
            exec("""
                INSERT OR IGNORE INTO messages
                (owner_id, id, sender_id, receiver_id, msg_type, content, timestamp, reply_to_id, reply_to_json)
                SELECT '\(owner)', id, sender_id, receiver_id, msg_type, content, timestamp, reply_to_id, reply_to_json
                FROM messages_legacy
                WHERE sender_id = '\(owner)' OR receiver_id = '\(owner)'
            """)
        }
        exec("DROP TABLE messages_legacy")
        exec("COMMIT")
    }

    private func migrateGroupMessagesTableIfNeeded() {
        let columns = tableColumnNames("group_messages")
        guard !columns.isEmpty, !columns.contains("owner_id") else { return }
        let legacyOwner = legacyOwnerID().replacingOccurrences(of: "'", with: "''")
        exec("ALTER TABLE group_messages RENAME TO group_messages_legacy")
        exec("""
            CREATE TABLE group_messages (
                owner_id TEXT NOT NULL,
                id INTEGER NOT NULL,
                group_id INTEGER NOT NULL,
                sender_id TEXT NOT NULL,
                msg_type TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                sender_nickname TEXT NOT NULL DEFAULT '',
                sender_avatar TEXT NOT NULL DEFAULT '',
                reply_to_id INTEGER,
                reply_to_json TEXT,
                mentions TEXT,
                script_context_json TEXT,
                mention_all INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (owner_id, id)
            )
        """)
        if !legacyOwner.isEmpty {
            exec("""
                INSERT OR IGNORE INTO group_messages
                (owner_id, id, group_id, sender_id, msg_type, content, timestamp,
                 sender_nickname, sender_avatar, reply_to_id, reply_to_json, mentions)
                SELECT '\(legacyOwner)', id, group_id, sender_id, msg_type, content, timestamp,
                       sender_nickname, sender_avatar, reply_to_id, reply_to_json, mentions
                FROM group_messages_legacy
            """)
        }
        exec("DROP TABLE group_messages_legacy")
    }

    private func legacyOwnerID() -> String {
        if let id = UserDefaults.standard.string(forKey: "bbchat.last_active_account_id"), !id.isEmpty {
            return id
        }
        guard let data = UserDefaults.standard.data(forKey: "cached_current_user"),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
        return (object["user_id"] as? String) ?? (object["userID"] as? String) ?? ""
    }

    func setActiveOwner(_ userID: String?) {
        queue.sync { activeOwnerID = userID ?? "" }
    }

    private func migrateConversationsTableIfNeeded() {
        let columns = tableColumnNames("conversations")
        guard !columns.isEmpty else {
            createConversationsTable()
            return
        }

        guard !columns.contains("owner_id") else { return }

        exec("ALTER TABLE conversations RENAME TO conversations_legacy")
        createConversationsTable()
        exec("""
            INSERT OR IGNORE INTO conversations
            (owner_id, id, type, name, avatar_url, last_message, last_message_time,
             unread_count, subtitle, group_id, member_count)
            SELECT '', id, type, name, avatar_url, last_message, last_message_time,
                   unread_count, subtitle, group_id, member_count
            FROM conversations_legacy
        """)
        exec("DROP TABLE conversations_legacy")
    }

    private func createConversationsTable() {
        exec("""
            CREATE TABLE IF NOT EXISTS conversations (
                owner_id TEXT NOT NULL,
                id TEXT NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                avatar_url TEXT NOT NULL DEFAULT '',
                last_message TEXT,
                last_message_time TEXT,
                unread_count INTEGER NOT NULL DEFAULT 0,
                subtitle TEXT,
                group_id INTEGER,
                member_count INTEGER,
                conversation_kind TEXT,
                script_room_id TEXT,
                script_id TEXT,
                agent_conversation_id TEXT,
                agent_id TEXT,
                agent_avatar_asset_id TEXT,
                agent_greeting_id TEXT,
                last_message_id INTEGER,
                read_through_message_id INTEGER,
                revision INTEGER,
                is_muted INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (owner_id, id, type)
            )
        """)
        exec("CREATE INDEX IF NOT EXISTS idx_conversations_owner_time ON conversations (owner_id, last_message_time)")
    }

    private func tableColumnNames(_ tableName: String) -> Set<String> {
        var names = Set<String>()
        let sql = "PRAGMA table_info(\(tableName))"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return names }
        defer { sqlite3_finalize(stmt) }

        while sqlite3_step(stmt) == SQLITE_ROW {
            if let name = sqlite3_column_text(stmt, 1) {
                names.insert(String(cString: name))
            }
        }
        return names
    }

    private func addColumnIfNeeded(table: String, column: String, definition: String) {
        guard !tableColumnNames(table).contains(column) else { return }
        exec("ALTER TABLE \(table) ADD COLUMN \(column) \(definition)")
    }

    // MARK: - DM Messages

    @discardableResult
    func saveMessage(_ message: Message, ownerID: String? = nil) -> Bool {
        queue.sync { [weak self] in
            guard let self else { return false }
            return self.insertMessage(message, ownerID: ownerID ?? self.activeOwnerID)
        }
    }

    func saveMessages(_ messages: [Message], ownerID: String? = nil) {
        queue.sync { [weak self] in
            guard let self = self else { return }
            let resolvedOwnerID = ownerID ?? self.activeOwnerID
            self.exec("BEGIN TRANSACTION")
            for msg in messages {
                _ = self.insertMessage(msg, ownerID: resolvedOwnerID)
            }
            self.exec("COMMIT")
        }
    }

    func deleteMessage(id: Int, ownerID: String) {
        queue.sync { [weak self] in
            guard let self, !ownerID.isEmpty else { return }
            _ = self.exec("DELETE FROM messages WHERE owner_id = '\(self.esc(ownerID))' AND id = \(id)")
        }
    }

    @discardableResult
    private func insertMessage(_ msg: Message, ownerID: String) -> Bool {
        guard !ownerID.isEmpty else { return false }
        let conversationID = msg.senderID == ownerID ? msg.receiverID : msg.senderID
        if let watermark = directHistoryClearMessageIDUnlocked(
            ownerID: ownerID,
            contactID: conversationID
        ), msg.id <= watermark {
            return false
        }
        guard !isHidden(
            ownerID: ownerID,
            conversationType: "dm",
            conversationID: conversationID,
            messageID: msg.id
        ) else { return false }
        guard msg.version >= storedVersion(table: "messages", ownerID: ownerID, messageID: msg.id) else {
            return false
        }
        let replyJSON: String? = {
            guard let reply = msg.replyTo,
                  let data = try? JSONEncoder().encode(reply) else { return nil }
            return String(data: data, encoding: .utf8)
        }()

        let sql = """
            INSERT INTO messages
            (owner_id, id, sender_id, receiver_id, msg_type, content, timestamp, reply_to_id, reply_to_json, version, updated_at, client_message_id, thumbnail_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(owner_id, id) DO UPDATE SET
                sender_id = excluded.sender_id,
                receiver_id = excluded.receiver_id,
                msg_type = excluded.msg_type,
                content = excluded.content,
                timestamp = excluded.timestamp,
                reply_to_id = excluded.reply_to_id,
                reply_to_json = excluded.reply_to_json,
                client_message_id = COALESCE(excluded.client_message_id, messages.client_message_id),
                thumbnail_url = COALESCE(excluded.thumbnail_url, messages.thumbnail_url),
                version = excluded.version,
                updated_at = excluded.updated_at
            WHERE excluded.version >= messages.version
        """
        execBind(sql) { stmt in
            Self.bindText(stmt, 1, ownerID)
            sqlite3_bind_int64(stmt, 2, Int64(msg.id))
            Self.bindText(stmt, 3, msg.senderID)
            Self.bindText(stmt, 4, msg.receiverID)
            Self.bindText(stmt, 5, msg.msgType)
            Self.bindText(stmt, 6, msg.content)
            Self.bindText(stmt, 7, msg.timestamp)
            if let rid = msg.replyToID {
                sqlite3_bind_int64(stmt, 8, Int64(rid))
            } else {
                sqlite3_bind_null(stmt, 8)
            }
            Self.bindTextOrNull(stmt, 9, replyJSON)
            sqlite3_bind_int(stmt, 10, Int32(msg.version))
            Self.bindTextOrNull(stmt, 11, msg.updatedAt)
            Self.bindTextOrNull(stmt, 12, msg.clientMessageID)
            Self.bindTextOrNull(stmt, 13, msg.thumbnailURL)
        }
        return true
    }

    func loadMessages(userID: String, contactID: String, beforeID: Int? = nil, limit: Int = 30) -> [Message] {
        var results: [Message] = []
        queue.sync {
            let sql: String
            if let bid = beforeID {
                sql = """
                    SELECT id, sender_id, receiver_id, msg_type, content, timestamp, reply_to_id, reply_to_json, version, updated_at, client_message_id, thumbnail_url
                    FROM messages
                    WHERE owner_id = '\(esc(userID))'
                      AND ((sender_id = '\(esc(userID))' AND receiver_id = '\(esc(contactID))')
                        OR (sender_id = '\(esc(contactID))' AND receiver_id = '\(esc(userID))'))
                      AND id < \(bid)
                    ORDER BY id DESC LIMIT \(limit)
                """
            } else {
                sql = """
                    SELECT id, sender_id, receiver_id, msg_type, content, timestamp, reply_to_id, reply_to_json, version, updated_at, client_message_id, thumbnail_url
                    FROM messages
                    WHERE owner_id = '\(esc(userID))'
                      AND ((sender_id = '\(esc(userID))' AND receiver_id = '\(esc(contactID))')
                        OR (sender_id = '\(esc(contactID))' AND receiver_id = '\(esc(userID))'))
                    ORDER BY id DESC LIMIT \(limit)
                """
            }

            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(stmt) }

            while sqlite3_step(stmt) == SQLITE_ROW {
                if let msg = readMessageRow(stmt) {
                    results.append(msg)
                }
            }
        }
        return results.reversed()
    }

    func latestMessageID(userID: String, contactID: String) -> Int? {
        var result: Int?
        queue.sync {
            let sql = """
                SELECT MAX(id) FROM messages
                WHERE owner_id = '\(esc(userID))'
                  AND ((sender_id = '\(esc(userID))' AND receiver_id = '\(esc(contactID))')
                    OR (sender_id = '\(esc(contactID))' AND receiver_id = '\(esc(userID))'))
            """
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(stmt) }
            if sqlite3_step(stmt) == SQLITE_ROW && sqlite3_column_type(stmt, 0) != SQLITE_NULL {
                result = Int(sqlite3_column_int64(stmt, 0))
            }
        }
        return result
    }

    /// Returns one locally persisted latest message per DM in a single query.
    /// This lets the conversation list repair a stale server/cache preview
    /// without issuing one SQLite query for every visible row.
    func loadLatestDirectMessages(ownerID: String) -> [String: Message] {
        var results: [String: Message] = [:]
        queue.sync {
            let owner = esc(ownerID)
            let sql = """
                SELECT m.id, m.sender_id, m.receiver_id, m.msg_type, m.content,
                       m.timestamp, m.reply_to_id, m.reply_to_json, m.version, m.updated_at, m.client_message_id, m.thumbnail_url, latest.contact_id
                FROM messages AS m
                INNER JOIN (
                    SELECT CASE
                               WHEN sender_id = '\(owner)' THEN receiver_id
                               ELSE sender_id
                           END AS contact_id,
                           MAX(id) AS latest_id
                    FROM messages
                    WHERE owner_id = '\(owner)'
                      AND (sender_id = '\(owner)' OR receiver_id = '\(owner)')
                    GROUP BY contact_id
                ) AS latest ON latest.latest_id = m.id
                WHERE m.owner_id = '\(owner)'
            """
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(stmt) }

            while sqlite3_step(stmt) == SQLITE_ROW {
                guard let message = readMessageRow(stmt),
                      let contact = sqlite3_column_text(stmt, 12) else { continue }
                results[String(cString: contact)] = message
            }
        }
        return results
    }

    func localMessageCount(userID: String, contactID: String) -> Int {
        var count = 0
        queue.sync {
            let sql = """
                SELECT COUNT(*) FROM messages
                WHERE owner_id = '\(esc(userID))'
                  AND ((sender_id = '\(esc(userID))' AND receiver_id = '\(esc(contactID))')
                    OR (sender_id = '\(esc(contactID))' AND receiver_id = '\(esc(userID))'))
            """
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(stmt) }
            if sqlite3_step(stmt) == SQLITE_ROW {
                count = Int(sqlite3_column_int(stmt, 0))
            }
        }
        return count
    }

    private func readMessageRow(_ stmt: OpaquePointer?) -> Message? {
        guard let stmt = stmt else { return nil }
        let id = Int(sqlite3_column_int64(stmt, 0))
        let senderID = String(cString: sqlite3_column_text(stmt, 1))
        let receiverID = String(cString: sqlite3_column_text(stmt, 2))
        let msgType = String(cString: sqlite3_column_text(stmt, 3))
        let content = String(cString: sqlite3_column_text(stmt, 4))
        let timestamp = String(cString: sqlite3_column_text(stmt, 5))
        let replyToID: Int? = sqlite3_column_type(stmt, 6) != SQLITE_NULL ? Int(sqlite3_column_int64(stmt, 6)) : nil

        var replyTo: ReplyPreview?
        if sqlite3_column_type(stmt, 7) != SQLITE_NULL,
           let text = sqlite3_column_text(stmt, 7) {
            let json = String(cString: text)
            if let data = json.data(using: .utf8) {
                replyTo = try? JSONDecoder().decode(ReplyPreview.self, from: data)
            }
        }

        let version = Int(sqlite3_column_int(stmt, 8))
        let updatedAt = sqlite3_column_type(stmt, 9) != SQLITE_NULL
            ? String(cString: sqlite3_column_text(stmt, 9)) : nil
        let clientMessageID = sqlite3_column_type(stmt, 10) != SQLITE_NULL
            ? String(cString: sqlite3_column_text(stmt, 10)) : nil
        let thumbnailURL = sqlite3_column_type(stmt, 11) != SQLITE_NULL
            ? String(cString: sqlite3_column_text(stmt, 11)) : nil
        return Message(
            id: id, senderID: senderID, receiverID: receiverID,
            msgType: msgType, content: content, timestamp: timestamp,
            replyToID: replyToID, replyTo: replyTo,
            clientMessageID: clientMessageID,
            version: max(version, 1), updatedAt: updatedAt,
            thumbnailURL: thumbnailURL
        )
    }

    // MARK: - Group Messages

    @discardableResult
    func saveGroupMessage(_ message: GroupMessage, ownerID: String? = nil) -> Bool {
        queue.sync { [weak self] in
            guard let self else { return false }
            return self.insertGroupMessage(message, ownerID: ownerID ?? self.activeOwnerID)
        }
    }

    func saveGroupMessages(_ messages: [GroupMessage], ownerID: String? = nil) {
        queue.sync { [weak self] in
            guard let self = self else { return }
            let resolvedOwnerID = ownerID ?? self.activeOwnerID
            self.exec("BEGIN TRANSACTION")
            for msg in messages {
                _ = self.insertGroupMessage(msg, ownerID: resolvedOwnerID)
            }
            self.exec("COMMIT")
        }
    }

    func deleteGroupMessage(id: Int, ownerID: String) {
        queue.sync { [weak self] in
            guard let self, !ownerID.isEmpty else { return }
            _ = self.exec(
                "DELETE FROM group_messages WHERE owner_id = '\(self.esc(ownerID))' AND id = \(id)"
            )
        }
    }

    @discardableResult
    private func insertGroupMessage(_ msg: GroupMessage, ownerID: String) -> Bool {
        guard !ownerID.isEmpty else { return false }
        if let watermark = groupHistoryClearSequenceUnlocked(ownerID: ownerID, groupID: msg.groupID) {
            guard let sequence = msg.historySequence, sequence > watermark else { return false }
        }
        guard !isHidden(
            ownerID: ownerID,
            conversationType: "group",
            conversationID: String(msg.groupID),
            messageID: msg.id
        ) else { return false }
        guard msg.version >= storedVersion(table: "group_messages", ownerID: ownerID, messageID: msg.id) else {
            return false
        }
        let replyJSON: String? = {
            guard let reply = msg.replyTo,
                  let data = try? JSONEncoder().encode(reply) else { return nil }
            return String(data: data, encoding: .utf8)
        }()
        let mentionsJSON: String? = {
            guard let m = msg.mentions,
                  let data = try? JSONEncoder().encode(m) else { return nil }
            return String(data: data, encoding: .utf8)
        }()
        let scriptContextJSON: String? = {
            guard let context = msg.scriptContext,
                  let data = try? JSONEncoder().encode(context) else { return nil }
            return String(data: data, encoding: .utf8)
        }()

        let sql = """
            INSERT INTO group_messages
            (owner_id, id, group_id, sender_id, msg_type, content, timestamp,
             sender_nickname, sender_avatar, reply_to_id, reply_to_json, mentions, script_context_json, version, updated_at, client_message_id, mention_all, history_sequence, thumbnail_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(owner_id, id) DO UPDATE SET
                group_id = excluded.group_id,
                sender_id = excluded.sender_id,
                msg_type = excluded.msg_type,
                content = excluded.content,
                timestamp = excluded.timestamp,
                sender_nickname = excluded.sender_nickname,
                sender_avatar = excluded.sender_avatar,
                reply_to_id = excluded.reply_to_id,
                reply_to_json = excluded.reply_to_json,
                mentions = excluded.mentions,
                script_context_json = excluded.script_context_json,
                client_message_id = COALESCE(excluded.client_message_id, group_messages.client_message_id),
                mention_all = excluded.mention_all,
                history_sequence = COALESCE(excluded.history_sequence, group_messages.history_sequence),
                thumbnail_url = COALESCE(excluded.thumbnail_url, group_messages.thumbnail_url),
                version = excluded.version,
                updated_at = excluded.updated_at
            WHERE excluded.version >= group_messages.version
        """
        execBind(sql) { stmt in
            Self.bindText(stmt, 1, ownerID)
            sqlite3_bind_int64(stmt, 2, Int64(msg.id))
            sqlite3_bind_int64(stmt, 3, Int64(msg.groupID))
            Self.bindText(stmt, 4, msg.senderID)
            Self.bindText(stmt, 5, msg.msgType)
            Self.bindText(stmt, 6, msg.content)
            Self.bindText(stmt, 7, msg.timestamp)
            Self.bindText(stmt, 8, msg.senderNickname)
            Self.bindText(stmt, 9, msg.senderAvatar)
            if let rid = msg.replyToID {
                sqlite3_bind_int64(stmt, 10, Int64(rid))
            } else {
                sqlite3_bind_null(stmt, 10)
            }
            Self.bindTextOrNull(stmt, 11, replyJSON)
            Self.bindTextOrNull(stmt, 12, mentionsJSON)
            Self.bindTextOrNull(stmt, 13, scriptContextJSON)
            sqlite3_bind_int(stmt, 14, Int32(msg.version))
            Self.bindTextOrNull(stmt, 15, msg.updatedAt)
            Self.bindTextOrNull(stmt, 16, msg.clientMessageID)
            sqlite3_bind_int(stmt, 17, msg.mentionAll ? 1 : 0)
            if let sequence = msg.historySequence {
                sqlite3_bind_int64(stmt, 18, sequence)
            } else {
                sqlite3_bind_null(stmt, 18)
            }
            Self.bindTextOrNull(stmt, 19, msg.thumbnailURL)
        }
        return true
    }

    // MARK: - Local deletion tombstones

    func isDirectMessageHidden(ownerID: String, contactID: String, messageID: Int) -> Bool {
        queue.sync {
            if let watermark = directHistoryClearMessageIDUnlocked(
                ownerID: ownerID,
                contactID: contactID
            ), messageID <= watermark {
                return true
            }
            return isHidden(
                ownerID: ownerID,
                conversationType: "dm",
                conversationID: contactID,
                messageID: messageID
            )
        }
    }

    func applyDirectHistoryClear(ownerID: String, contactID: String, throughMessageID: Int) {
        guard !ownerID.isEmpty, !contactID.isEmpty, throughMessageID >= 0 else { return }
        queue.sync {
            let previous = directHistoryClearMessageIDUnlocked(
                ownerID: ownerID,
                contactID: contactID
            ) ?? -1
            let effective = max(previous, throughMessageID)
            let sql = """
                INSERT INTO direct_history_clear_watermarks
                (owner_id, contact_id, cleared_before_message_id, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(owner_id, contact_id) DO UPDATE SET
                    cleared_before_message_id = MAX(
                        direct_history_clear_watermarks.cleared_before_message_id,
                        excluded.cleared_before_message_id
                    ),
                    updated_at = excluded.updated_at
            """
            exec("BEGIN IMMEDIATE TRANSACTION")
            execBind(sql) { statement in
                Self.bindText(statement, 1, ownerID)
                Self.bindText(statement, 2, contactID)
                sqlite3_bind_int64(statement, 3, Int64(effective))
                sqlite3_bind_double(statement, 4, Date().timeIntervalSince1970)
            }
            let owner = esc(ownerID)
            let contact = esc(contactID)
            exec("""
                DELETE FROM messages
                WHERE owner_id = '\(owner)'
                  AND id <= \(effective)
                  AND ((sender_id = '\(owner)' AND receiver_id = '\(contact)')
                    OR (sender_id = '\(contact)' AND receiver_id = '\(owner)'))
            """)
            exec("COMMIT")
        }
    }

    func directHistoryClearMessageID(ownerID: String, contactID: String) -> Int? {
        queue.sync {
            directHistoryClearMessageIDUnlocked(ownerID: ownerID, contactID: contactID)
        }
    }

    private func directHistoryClearMessageIDUnlocked(ownerID: String, contactID: String) -> Int? {
        let sql = """
            SELECT cleared_before_message_id
            FROM direct_history_clear_watermarks
            WHERE owner_id = ? AND contact_id = ?
            LIMIT 1
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(statement) }
        Self.bindText(statement, 1, ownerID)
        Self.bindText(statement, 2, contactID)
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        return Int(sqlite3_column_int64(statement, 0))
    }

    func isGroupMessageHidden(ownerID: String, groupID: Int, messageID: Int) -> Bool {
        queue.sync {
            isHidden(
                ownerID: ownerID,
                conversationType: "group",
                conversationID: String(groupID),
                messageID: messageID
            )
        }
    }

    func hideDirectMessages(ownerID: String, contactID: String, messageIDs: Set<Int>) {
        guard !messageIDs.isEmpty else { return }
        queue.sync {
            exec("BEGIN IMMEDIATE TRANSACTION")
            for messageID in messageIDs {
                insertTombstone(
                    ownerID: ownerID,
                    conversationType: "dm",
                    conversationID: contactID,
                    messageID: messageID
                )
                exec("DELETE FROM messages WHERE owner_id = '\(esc(ownerID))' AND id = \(messageID)")
            }
            exec("COMMIT")
        }
    }

    func hideGroupMessages(ownerID: String, groupID: Int, messageIDs: Set<Int>) {
        guard !messageIDs.isEmpty else { return }
        queue.sync {
            exec("BEGIN IMMEDIATE TRANSACTION")
            for messageID in messageIDs {
                insertTombstone(
                    ownerID: ownerID,
                    conversationType: "group",
                    conversationID: String(groupID),
                    messageID: messageID
                )
                exec("DELETE FROM group_messages WHERE owner_id = '\(esc(ownerID))' AND id = \(messageID)")
            }
            exec("COMMIT")
        }
    }

    func applyGroupHistoryClear(ownerID: String, groupID: Int, throughSequence: Int64) {
        guard !ownerID.isEmpty, groupID > 0, throughSequence >= 0 else { return }
        queue.sync {
            let previous = groupHistoryClearSequenceUnlocked(ownerID: ownerID, groupID: groupID) ?? -1
            let effective = max(previous, throughSequence)
            let sql = """
                INSERT INTO group_history_clear_watermarks
                (owner_id, group_id, cleared_before_sequence, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(owner_id, group_id) DO UPDATE SET
                    cleared_before_sequence = MAX(
                        group_history_clear_watermarks.cleared_before_sequence,
                        excluded.cleared_before_sequence
                    ),
                    updated_at = excluded.updated_at
            """
            exec("BEGIN IMMEDIATE TRANSACTION")
            execBind(sql) { statement in
                Self.bindText(statement, 1, ownerID)
                sqlite3_bind_int64(statement, 2, Int64(groupID))
                sqlite3_bind_int64(statement, 3, effective)
                sqlite3_bind_double(statement, 4, Date().timeIntervalSince1970)
            }
            let owner = esc(ownerID)
            exec("""
                DELETE FROM group_messages
                WHERE owner_id = '\(owner)'
                  AND group_id = \(groupID)
                  AND (history_sequence IS NULL OR history_sequence <= \(effective))
            """)
            exec("COMMIT")
        }
    }

    func groupHistoryClearSequence(ownerID: String, groupID: Int) -> Int64? {
        queue.sync {
            groupHistoryClearSequenceUnlocked(ownerID: ownerID, groupID: groupID)
        }
    }

    func visibleGroupMessages(
        _ messages: [GroupMessage],
        ownerID: String,
        groupID: Int
    ) -> [GroupMessage] {
        guard let watermark = groupHistoryClearSequence(ownerID: ownerID, groupID: groupID) else {
            return messages
        }
        return messages.filter { message in
            guard message.groupID == groupID,
                  let sequence = message.historySequence else { return false }
            return sequence > watermark
        }
    }

    private func groupHistoryClearSequenceUnlocked(ownerID: String, groupID: Int) -> Int64? {
        let sql = """
            SELECT cleared_before_sequence
            FROM group_history_clear_watermarks
            WHERE owner_id = ? AND group_id = ?
            LIMIT 1
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(statement) }
        Self.bindText(statement, 1, ownerID)
        sqlite3_bind_int64(statement, 2, Int64(groupID))
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        return sqlite3_column_int64(statement, 0)
    }

    private func insertTombstone(
        ownerID: String,
        conversationType: String,
        conversationID: String,
        messageID: Int
    ) {
        let sql = """
            INSERT OR IGNORE INTO local_message_tombstones
            (owner_id, conversation_type, conversation_id, message_id, deleted_at)
            VALUES (?, ?, ?, ?, ?)
        """
        execBind(sql) { statement in
            Self.bindText(statement, 1, ownerID)
            Self.bindText(statement, 2, conversationType)
            Self.bindText(statement, 3, conversationID)
            sqlite3_bind_int64(statement, 4, Int64(messageID))
            sqlite3_bind_double(statement, 5, Date().timeIntervalSince1970)
        }
    }

    private func isHidden(
        ownerID: String,
        conversationType: String,
        conversationID: String,
        messageID: Int
    ) -> Bool {
        let sql = """
            SELECT 1 FROM local_message_tombstones
            WHERE owner_id = ? AND conversation_type = ? AND conversation_id = ? AND message_id = ?
            LIMIT 1
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return false }
        defer { sqlite3_finalize(statement) }
        Self.bindText(statement, 1, ownerID)
        Self.bindText(statement, 2, conversationType)
        Self.bindText(statement, 3, conversationID)
        sqlite3_bind_int64(statement, 4, Int64(messageID))
        return sqlite3_step(statement) == SQLITE_ROW
    }

    private func storedVersion(table: String, ownerID: String, messageID: Int) -> Int {
        let sql = "SELECT version FROM \(table) WHERE owner_id = ? AND id = ? LIMIT 1"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return 0 }
        defer { sqlite3_finalize(statement) }
        Self.bindText(statement, 1, ownerID)
        sqlite3_bind_int64(statement, 2, Int64(messageID))
        guard sqlite3_step(statement) == SQLITE_ROW else { return 0 }
        return Int(sqlite3_column_int(statement, 0))
    }

    func loadGroupMessages(ownerID: String? = nil, groupID: Int, beforeID: Int? = nil, limit: Int = 30) -> [GroupMessage] {
        var results: [GroupMessage] = []
        queue.sync {
            let resolvedOwnerID = ownerID ?? activeOwnerID
            guard !resolvedOwnerID.isEmpty else { return }
            let owner = esc(resolvedOwnerID)
            let sql: String
            if let bid = beforeID {
                sql = """
                    SELECT id, group_id, sender_id, msg_type, content, timestamp,
                           sender_nickname, sender_avatar, reply_to_id, reply_to_json, mentions, script_context_json, version, updated_at, client_message_id, mention_all, history_sequence, thumbnail_url
                    FROM group_messages
                    WHERE owner_id = '\(owner)' AND group_id = \(groupID) AND id < \(bid)
                    ORDER BY id DESC LIMIT \(limit)
                """
            } else {
                sql = """
                    SELECT id, group_id, sender_id, msg_type, content, timestamp,
                           sender_nickname, sender_avatar, reply_to_id, reply_to_json, mentions, script_context_json, version, updated_at, client_message_id, mention_all, history_sequence, thumbnail_url
                    FROM group_messages
                    WHERE owner_id = '\(owner)' AND group_id = \(groupID)
                    ORDER BY id DESC LIMIT \(limit)
                """
            }

            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(stmt) }

            while sqlite3_step(stmt) == SQLITE_ROW {
                if let msg = readGroupMessageRow(stmt) {
                    results.append(msg)
                }
            }
        }
        return results.reversed()
    }

    func latestGroupMessageID(ownerID: String? = nil, groupID: Int) -> Int? {
        var result: Int?
        queue.sync {
            let resolvedOwnerID = ownerID ?? activeOwnerID
            guard !resolvedOwnerID.isEmpty else { return }
            let sql = "SELECT MAX(id) FROM group_messages WHERE owner_id = '\(esc(resolvedOwnerID))' AND group_id = \(groupID)"
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(stmt) }
            if sqlite3_step(stmt) == SQLITE_ROW && sqlite3_column_type(stmt, 0) != SQLITE_NULL {
                result = Int(sqlite3_column_int64(stmt, 0))
            }
        }
        return result
    }

    /// Returns one locally persisted latest message per group in a single query.
    func loadLatestGroupMessages() -> [Int: GroupMessage] {
        var results: [Int: GroupMessage] = [:]
        queue.sync {
            guard !activeOwnerID.isEmpty else { return }
            let owner = esc(activeOwnerID)
            let sql = """
                SELECT gm.id, gm.group_id, gm.sender_id, gm.msg_type, gm.content,
                       gm.timestamp, gm.sender_nickname, gm.sender_avatar,
                       gm.reply_to_id, gm.reply_to_json, gm.mentions, gm.script_context_json, gm.version, gm.updated_at, gm.client_message_id, gm.mention_all, gm.history_sequence, gm.thumbnail_url
                FROM group_messages AS gm
                INNER JOIN (
                    SELECT group_id, MAX(id) AS latest_id
                    FROM group_messages
                    WHERE owner_id = '\(owner)'
                    GROUP BY group_id
                ) AS latest
                    ON latest.group_id = gm.group_id
                   AND latest.latest_id = gm.id
                WHERE gm.owner_id = '\(owner)'
            """
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(stmt) }

            while sqlite3_step(stmt) == SQLITE_ROW {
                guard let message = readGroupMessageRow(stmt) else { continue }
                results[message.groupID] = message
            }
        }
        return results
    }

    private func readGroupMessageRow(_ stmt: OpaquePointer?) -> GroupMessage? {
        guard let stmt = stmt else { return nil }
        let id = Int(sqlite3_column_int64(stmt, 0))
        let groupID = Int(sqlite3_column_int64(stmt, 1))
        let senderID = String(cString: sqlite3_column_text(stmt, 2))
        let msgType = String(cString: sqlite3_column_text(stmt, 3))
        let content = String(cString: sqlite3_column_text(stmt, 4))
        let timestamp = String(cString: sqlite3_column_text(stmt, 5))
        let senderNickname = String(cString: sqlite3_column_text(stmt, 6))
        let senderAvatar = String(cString: sqlite3_column_text(stmt, 7))
        let replyToID: Int? = sqlite3_column_type(stmt, 8) != SQLITE_NULL ? Int(sqlite3_column_int64(stmt, 8)) : nil

        var replyTo: GroupReplyPreview?
        if sqlite3_column_type(stmt, 9) != SQLITE_NULL,
           let text = sqlite3_column_text(stmt, 9) {
            let json = String(cString: text)
            if let data = json.data(using: .utf8) {
                replyTo = try? JSONDecoder().decode(GroupReplyPreview.self, from: data)
            }
        }

        var mentions: [String]?
        if sqlite3_column_type(stmt, 10) != SQLITE_NULL,
           let text = sqlite3_column_text(stmt, 10) {
            let json = String(cString: text)
            if let data = json.data(using: .utf8) {
                mentions = try? JSONDecoder().decode([String].self, from: data)
            }
        }

        var scriptContext: GroupMessageScriptContext?
        if sqlite3_column_type(stmt, 11) != SQLITE_NULL,
           let text = sqlite3_column_text(stmt, 11) {
            let json = String(cString: text)
            if let data = json.data(using: .utf8) {
                scriptContext = try? JSONDecoder().decode(GroupMessageScriptContext.self, from: data)
            }
        }

        let version = Int(sqlite3_column_int(stmt, 12))
        let updatedAt = sqlite3_column_type(stmt, 13) != SQLITE_NULL
            ? String(cString: sqlite3_column_text(stmt, 13)) : nil
        let clientMessageID = sqlite3_column_type(stmt, 14) != SQLITE_NULL
            ? String(cString: sqlite3_column_text(stmt, 14)) : nil
        let mentionAll = sqlite3_column_int(stmt, 15) != 0
        let historySequence = sqlite3_column_type(stmt, 16) != SQLITE_NULL
            ? sqlite3_column_int64(stmt, 16) : nil
        let thumbnailURL = sqlite3_column_type(stmt, 17) != SQLITE_NULL
            ? String(cString: sqlite3_column_text(stmt, 17)) : nil
        return GroupMessage(
            id: id, groupID: groupID, senderID: senderID,
            msgType: msgType, content: content, timestamp: timestamp,
            senderNickname: senderNickname, senderAvatar: senderAvatar,
            replyToID: replyToID, replyTo: replyTo, mentions: mentions,
            mentionAll: mentionAll,
            clientMessageID: clientMessageID,
            scriptContext: scriptContext,
            historySequence: historySequence,
            version: max(version, 1), updatedAt: updatedAt,
            thumbnailURL: thumbnailURL
        )
    }

    // MARK: - Conversations

    func saveConversations(_ convs: [Conversation], ownerID: String) {
        queue.sync { [weak self] in
            guard let self = self else { return }
            guard self.exec("BEGIN IMMEDIATE TRANSACTION") else { return }
            guard self.exec("DELETE FROM conversations WHERE owner_id = '\(self.esc(ownerID))'") else {
                self.exec("ROLLBACK")
                return
            }
            for c in convs {
                guard self.insertConversation(c, ownerID: ownerID) else {
                    self.exec("ROLLBACK")
                    return
                }
            }
            guard self.exec("COMMIT") else {
                self.exec("ROLLBACK")
                return
            }
        }
    }

    func updateConversation(_ conv: Conversation, ownerID: String) {
        queue.sync { [weak self] in
            guard let self else { return }
            _ = self.insertConversation(conv, ownerID: ownerID)
        }
    }

    @discardableResult
    private func insertConversation(_ c: Conversation, ownerID: String) -> Bool {
        let sql = """
            INSERT OR REPLACE INTO conversations
            (owner_id, id, type, name, avatar_url, last_message, last_message_time,
             unread_count, subtitle, group_id, member_count, conversation_kind, script_room_id, script_id,
             agent_conversation_id, agent_id, agent_avatar_asset_id, agent_greeting_id,
             last_message_id, read_through_message_id, revision, is_muted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        return execBind(sql) { stmt in
            Self.bindText(stmt, 1, ownerID)
            Self.bindText(stmt, 2, c.id)
            Self.bindText(stmt, 3, c.type)
            Self.bindText(stmt, 4, c.name)
            Self.bindText(stmt, 5, c.avatarURL)
            Self.bindTextOrNull(stmt, 6, c.lastMessage)
            Self.bindTextOrNull(stmt, 7, c.lastMessageTime)
            sqlite3_bind_int(stmt, 8, Int32(c.unreadCount))
            Self.bindTextOrNull(stmt, 9, c.subtitle)
            if let gid = c.groupID {
                sqlite3_bind_int64(stmt, 10, Int64(gid))
            } else {
                sqlite3_bind_null(stmt, 10)
            }
            if let mc = c.memberCount {
                sqlite3_bind_int(stmt, 11, Int32(mc))
            } else {
                sqlite3_bind_null(stmt, 11)
            }
            Self.bindTextOrNull(stmt, 12, c.conversationKind)
            Self.bindTextOrNull(stmt, 13, c.scriptRoomID)
            Self.bindTextOrNull(stmt, 14, c.scriptID)
            Self.bindTextOrNull(stmt, 15, c.agentConversationID)
            Self.bindTextOrNull(stmt, 16, c.agentID)
            Self.bindTextOrNull(stmt, 17, c.agentAvatarAssetID)
            Self.bindTextOrNull(stmt, 18, c.agentGreetingID)
            if let messageID = c.lastMessageID {
                sqlite3_bind_int64(stmt, 19, Int64(messageID))
            } else {
                sqlite3_bind_null(stmt, 19)
            }
            if let readThroughID = c.readThroughMessageID {
                sqlite3_bind_int64(stmt, 20, Int64(readThroughID))
            } else {
                sqlite3_bind_null(stmt, 20)
            }
            if let revision = c.revision {
                sqlite3_bind_int64(stmt, 21, revision)
            } else {
                sqlite3_bind_null(stmt, 21)
            }
            sqlite3_bind_int(stmt, 22, c.isMuted ? 1 : 0)
        }
    }

    func loadConversations(ownerID: String) -> [Conversation] {
        var results: [Conversation] = []
        queue.sync {
            let sql = """
                SELECT id, type, name, avatar_url, last_message, last_message_time,
                       unread_count, subtitle, group_id, member_count,
                       conversation_kind, script_room_id, script_id,
                       agent_conversation_id, agent_id, agent_avatar_asset_id, agent_greeting_id,
                       last_message_id, read_through_message_id, revision, is_muted
                FROM conversations
                WHERE owner_id = '\(esc(ownerID))'
                ORDER BY last_message_time DESC
            """
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(stmt) }

            while sqlite3_step(stmt) == SQLITE_ROW {
                let id = String(cString: sqlite3_column_text(stmt, 0))
                let type = String(cString: sqlite3_column_text(stmt, 1))
                let name = String(cString: sqlite3_column_text(stmt, 2))
                let avatarURL = String(cString: sqlite3_column_text(stmt, 3))
                let lastMessage = sqlite3_column_type(stmt, 4) != SQLITE_NULL
                    ? String(cString: sqlite3_column_text(stmt, 4)) : nil
                let lastMessageTime = sqlite3_column_type(stmt, 5) != SQLITE_NULL
                    ? String(cString: sqlite3_column_text(stmt, 5)) : nil
                let unreadCount = Int(sqlite3_column_int(stmt, 6))
                let subtitle = sqlite3_column_type(stmt, 7) != SQLITE_NULL
                    ? String(cString: sqlite3_column_text(stmt, 7)) : nil
                let groupID: Int? = sqlite3_column_type(stmt, 8) != SQLITE_NULL
                    ? Int(sqlite3_column_int64(stmt, 8)) : nil
                let memberCount: Int? = sqlite3_column_type(stmt, 9) != SQLITE_NULL
                    ? Int(sqlite3_column_int(stmt, 9)) : nil
                let conversationKind = sqlite3_column_type(stmt, 10) != SQLITE_NULL
                    ? String(cString: sqlite3_column_text(stmt, 10)) : nil
                let scriptRoomID = sqlite3_column_type(stmt, 11) != SQLITE_NULL
                    ? String(cString: sqlite3_column_text(stmt, 11)) : nil
                let scriptID = sqlite3_column_type(stmt, 12) != SQLITE_NULL
                    ? String(cString: sqlite3_column_text(stmt, 12)) : nil
                let storedAgentConversationID = sqlite3_column_type(stmt, 13) != SQLITE_NULL
                    ? String(cString: sqlite3_column_text(stmt, 13)) : nil
                let agentID = sqlite3_column_type(stmt, 14) != SQLITE_NULL
                    ? String(cString: sqlite3_column_text(stmt, 14)) : nil
                let agentAvatarAssetID = sqlite3_column_type(stmt, 15) != SQLITE_NULL
                    ? String(cString: sqlite3_column_text(stmt, 15)) : nil
                let agentGreetingID = sqlite3_column_type(stmt, 16) != SQLITE_NULL
                    ? String(cString: sqlite3_column_text(stmt, 16)) : nil
                let lastMessageID = sqlite3_column_type(stmt, 17) != SQLITE_NULL
                    ? Int(sqlite3_column_int64(stmt, 17)) : nil
                let readThroughMessageID = sqlite3_column_type(stmt, 18) != SQLITE_NULL
                    ? Int(sqlite3_column_int64(stmt, 18)) : nil
                let revision = sqlite3_column_type(stmt, 19) != SQLITE_NULL
                    ? Int64(sqlite3_column_int64(stmt, 19)) : nil
                let isMuted = sqlite3_column_int(stmt, 20) != 0
                let normalizedKind = conversationKind?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .lowercased()
                    .replacingOccurrences(of: "-", with: "_")
                let isLegacyAgentThread = type
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .lowercased() == "agent"
                    && normalizedKind == "agent_conversation"
                let agentConversationID = storedAgentConversationID
                    ?? (isLegacyAgentThread ? id : nil)

                results.append(Conversation(
                    type: type, id: id, name: name, avatarURL: avatarURL,
                    lastMessage: lastMessage, lastMessageTime: lastMessageTime,
                    unreadCount: unreadCount, subtitle: subtitle,
                    groupID: groupID, memberCount: memberCount,
                    conversationKind: conversationKind,
                    scriptRoomID: scriptRoomID,
                    scriptID: scriptID,
                    agentConversationID: agentConversationID,
                    agentID: agentID,
                    agentAvatarAssetID: agentAvatarAssetID,
                    agentGreetingID: agentGreetingID,
                    lastMessageID: lastMessageID,
                    readThroughMessageID: readThroughMessageID,
                    revision: revision,
                    isMuted: isMuted
                ))
            }
        }
        return results
    }

    func hasOutgoingMessage(from senderID: String, to receiverID: String) -> Bool {
        var hasMessage = false
        queue.sync {
            let sql = """
                SELECT 1 FROM messages
                WHERE owner_id = '\(esc(senderID))'
                  AND sender_id = '\(esc(senderID))'
                  AND receiver_id = '\(esc(receiverID))'
                LIMIT 1
            """
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(stmt) }
            hasMessage = sqlite3_step(stmt) == SQLITE_ROW
        }
        return hasMessage
    }

    // MARK: - Cleanup

    func clearAll() {
        queue.sync { [weak self] in
            self?.exec("DELETE FROM messages")
            self?.exec("DELETE FROM group_messages")
            self?.exec("DELETE FROM conversations")
            self?.exec("DELETE FROM local_message_tombstones")
            self?.exec("DELETE FROM direct_history_clear_watermarks")
            self?.exec("DELETE FROM group_history_clear_watermarks")
        }
    }

    func clearAccount(userID: String) {
        queue.sync { [weak self] in
            guard let self else { return }
            let owner = self.esc(userID)
            self.exec("DELETE FROM messages WHERE owner_id = '\(owner)'")
            self.exec("DELETE FROM group_messages WHERE owner_id = '\(owner)'")
            self.exec("DELETE FROM conversations WHERE owner_id = '\(owner)'")
            self.exec("DELETE FROM local_message_tombstones WHERE owner_id = '\(owner)'")
            self.exec("DELETE FROM direct_history_clear_watermarks WHERE owner_id = '\(owner)'")
            self.exec("DELETE FROM group_history_clear_watermarks WHERE owner_id = '\(owner)'")
            self.exec("PRAGMA wal_checkpoint(TRUNCATE)")
        }
    }

    // MARK: - SQLite Helpers

    @discardableResult
    private func exec(_ sql: String) -> Bool {
        sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK
    }

    @discardableResult
    private func execBind(_ sql: String, binder: (OpaquePointer?) -> Void) -> Bool {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return false }
        binder(stmt)
        let result = sqlite3_step(stmt) == SQLITE_DONE
        sqlite3_finalize(stmt)
        return result
    }

    private func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "'", with: "''")
    }

    private static func bindText(_ stmt: OpaquePointer?, _ index: Int32, _ value: String) {
        sqlite3_bind_text(stmt, index, (value as NSString).utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    }

    private static func bindTextOrNull(_ stmt: OpaquePointer?, _ index: Int32, _ value: String?) {
        if let v = value {
            bindText(stmt, index, v)
        } else {
            sqlite3_bind_null(stmt, index)
        }
    }
}
