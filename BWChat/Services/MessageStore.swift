// BWChat/Services/MessageStore.swift
// Local SQLite cache for messages and conversations

import Foundation
import SQLite3

final class MessageStore {
    static let shared = MessageStore()

    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "com.bbchat.messagestore", qos: .userInitiated)
    private var activeOwnerID = ""

    private init() {
        openDatabase()
        createTables()
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
    }

    private func createTables() {
        exec("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY,
                sender_id TEXT NOT NULL,
                receiver_id TEXT NOT NULL,
                msg_type TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                reply_to_id INTEGER,
                reply_to_json TEXT
            )
        """)
        exec("CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages (sender_id, receiver_id)")
        exec("CREATE INDEX IF NOT EXISTS idx_msg_ts ON messages (timestamp)")

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
                PRIMARY KEY (owner_id, id)
            )
        """)
        migrateGroupMessagesTableIfNeeded()
        addColumnIfNeeded(table: "group_messages", column: "script_context_json", definition: "TEXT")
        exec("CREATE INDEX IF NOT EXISTS idx_gmsg_group ON group_messages (owner_id, group_id)")
        exec("CREATE INDEX IF NOT EXISTS idx_gmsg_ts ON group_messages (owner_id, group_id, timestamp)")

        migrateConversationsTableIfNeeded()
        addColumnIfNeeded(table: "conversations", column: "conversation_kind", definition: "TEXT")
        addColumnIfNeeded(table: "conversations", column: "script_room_id", definition: "TEXT")
        addColumnIfNeeded(table: "conversations", column: "script_id", definition: "TEXT")
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

    func saveMessage(_ message: Message) {
        queue.sync { [weak self] in
            self?.insertMessage(message)
        }
    }

    func saveMessages(_ messages: [Message]) {
        queue.sync { [weak self] in
            guard let self = self else { return }
            self.exec("BEGIN TRANSACTION")
            for msg in messages {
                self.insertMessage(msg)
            }
            self.exec("COMMIT")
        }
    }

    func deleteMessage(id: Int) {
        queue.sync { [weak self] in
            _ = self?.exec("DELETE FROM messages WHERE id = \(id)")
        }
    }

    private func insertMessage(_ msg: Message) {
        let replyJSON: String? = {
            guard let reply = msg.replyTo,
                  let data = try? JSONEncoder().encode(reply) else { return nil }
            return String(data: data, encoding: .utf8)
        }()

        let sql = """
            INSERT OR REPLACE INTO messages
            (id, sender_id, receiver_id, msg_type, content, timestamp, reply_to_id, reply_to_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """
        execBind(sql) { stmt in
            sqlite3_bind_int64(stmt, 1, Int64(msg.id))
            Self.bindText(stmt, 2, msg.senderID)
            Self.bindText(stmt, 3, msg.receiverID)
            Self.bindText(stmt, 4, msg.msgType)
            Self.bindText(stmt, 5, msg.content)
            Self.bindText(stmt, 6, msg.timestamp)
            if let rid = msg.replyToID {
                sqlite3_bind_int64(stmt, 7, Int64(rid))
            } else {
                sqlite3_bind_null(stmt, 7)
            }
            Self.bindTextOrNull(stmt, 8, replyJSON)
        }
    }

    func loadMessages(userID: String, contactID: String, beforeID: Int? = nil, limit: Int = 30) -> [Message] {
        var results: [Message] = []
        queue.sync {
            let sql: String
            if let bid = beforeID {
                sql = """
                    SELECT * FROM messages
                    WHERE ((sender_id = '\(esc(userID))' AND receiver_id = '\(esc(contactID))')
                        OR (sender_id = '\(esc(contactID))' AND receiver_id = '\(esc(userID))'))
                      AND id < \(bid)
                    ORDER BY id DESC LIMIT \(limit)
                """
            } else {
                sql = """
                    SELECT * FROM messages
                    WHERE ((sender_id = '\(esc(userID))' AND receiver_id = '\(esc(contactID))')
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
                WHERE ((sender_id = '\(esc(userID))' AND receiver_id = '\(esc(contactID))')
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
                       m.timestamp, m.reply_to_id, m.reply_to_json, latest.contact_id
                FROM messages AS m
                INNER JOIN (
                    SELECT CASE
                               WHEN sender_id = '\(owner)' THEN receiver_id
                               ELSE sender_id
                           END AS contact_id,
                           MAX(id) AS latest_id
                    FROM messages
                    WHERE sender_id = '\(owner)' OR receiver_id = '\(owner)'
                    GROUP BY contact_id
                ) AS latest ON latest.latest_id = m.id
            """
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(stmt) }

            while sqlite3_step(stmt) == SQLITE_ROW {
                guard let message = readMessageRow(stmt),
                      let contact = sqlite3_column_text(stmt, 8) else { continue }
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
                WHERE ((sender_id = '\(esc(userID))' AND receiver_id = '\(esc(contactID))')
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

        return Message(
            id: id, senderID: senderID, receiverID: receiverID,
            msgType: msgType, content: content, timestamp: timestamp,
            replyToID: replyToID, replyTo: replyTo
        )
    }

    // MARK: - Group Messages

    func saveGroupMessage(_ message: GroupMessage) {
        queue.sync { [weak self] in
            self?.insertGroupMessage(message)
        }
    }

    func saveGroupMessages(_ messages: [GroupMessage]) {
        queue.sync { [weak self] in
            guard let self = self else { return }
            self.exec("BEGIN TRANSACTION")
            for msg in messages {
                self.insertGroupMessage(msg)
            }
            self.exec("COMMIT")
        }
    }

    func deleteGroupMessage(id: Int) {
        queue.sync { [weak self] in
            guard let self, !self.activeOwnerID.isEmpty else { return }
            _ = self.exec(
                "DELETE FROM group_messages WHERE owner_id = '\(self.esc(self.activeOwnerID))' AND id = \(id)"
            )
        }
    }

    private func insertGroupMessage(_ msg: GroupMessage) {
        guard !activeOwnerID.isEmpty else { return }
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
            INSERT OR REPLACE INTO group_messages
            (owner_id, id, group_id, sender_id, msg_type, content, timestamp,
             sender_nickname, sender_avatar, reply_to_id, reply_to_json, mentions, script_context_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        execBind(sql) { stmt in
            Self.bindText(stmt, 1, activeOwnerID)
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
        }
    }

    func loadGroupMessages(groupID: Int, beforeID: Int? = nil, limit: Int = 30) -> [GroupMessage] {
        var results: [GroupMessage] = []
        queue.sync {
            guard !activeOwnerID.isEmpty else { return }
            let owner = esc(activeOwnerID)
            let sql: String
            if let bid = beforeID {
                sql = """
                    SELECT id, group_id, sender_id, msg_type, content, timestamp,
                           sender_nickname, sender_avatar, reply_to_id, reply_to_json, mentions, script_context_json
                    FROM group_messages
                    WHERE owner_id = '\(owner)' AND group_id = \(groupID) AND id < \(bid)
                    ORDER BY id DESC LIMIT \(limit)
                """
            } else {
                sql = """
                    SELECT id, group_id, sender_id, msg_type, content, timestamp,
                           sender_nickname, sender_avatar, reply_to_id, reply_to_json, mentions, script_context_json
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

    func latestGroupMessageID(groupID: Int) -> Int? {
        var result: Int?
        queue.sync {
            guard !activeOwnerID.isEmpty else { return }
            let sql = "SELECT MAX(id) FROM group_messages WHERE owner_id = '\(esc(activeOwnerID))' AND group_id = \(groupID)"
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
                       gm.reply_to_id, gm.reply_to_json, gm.mentions, gm.script_context_json
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

        return GroupMessage(
            id: id, groupID: groupID, senderID: senderID,
            msgType: msgType, content: content, timestamp: timestamp,
            senderNickname: senderNickname, senderAvatar: senderAvatar,
            replyToID: replyToID, replyTo: replyTo, mentions: mentions,
            scriptContext: scriptContext
        )
    }

    // MARK: - Conversations

    func saveConversations(_ convs: [Conversation], ownerID: String) {
        queue.sync { [weak self] in
            guard let self = self else { return }
            self.exec("DELETE FROM conversations WHERE owner_id = '\(self.esc(ownerID))'")
            self.exec("BEGIN TRANSACTION")
            for c in convs {
                self.insertConversation(c, ownerID: ownerID)
            }
            self.exec("COMMIT")
        }
    }

    func updateConversation(_ conv: Conversation, ownerID: String) {
        queue.sync { [weak self] in
            self?.insertConversation(conv, ownerID: ownerID)
        }
    }

    private func insertConversation(_ c: Conversation, ownerID: String) {
        let sql = """
            INSERT OR REPLACE INTO conversations
            (owner_id, id, type, name, avatar_url, last_message, last_message_time,
             unread_count, subtitle, group_id, member_count, conversation_kind, script_room_id, script_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        execBind(sql) { stmt in
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
        }
    }

    func loadConversations(ownerID: String) -> [Conversation] {
        var results: [Conversation] = []
        queue.sync {
            let sql = """
                SELECT id, type, name, avatar_url, last_message, last_message_time,
                       unread_count, subtitle, group_id, member_count,
                       conversation_kind, script_room_id, script_id
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

                results.append(Conversation(
                    type: type, id: id, name: name, avatarURL: avatarURL,
                    lastMessage: lastMessage, lastMessageTime: lastMessageTime,
                    unreadCount: unreadCount, subtitle: subtitle,
                    groupID: groupID, memberCount: memberCount,
                    conversationKind: conversationKind,
                    scriptRoomID: scriptRoomID,
                    scriptID: scriptID
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
                WHERE sender_id = '\(esc(senderID))'
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
        }
    }

    func clearAccount(userID: String) {
        queue.sync { [weak self] in
            guard let self else { return }
            let owner = self.esc(userID)
            self.exec("DELETE FROM messages WHERE sender_id = '\(owner)' OR receiver_id = '\(owner)'")
            self.exec("DELETE FROM group_messages WHERE owner_id = '\(owner)'")
            self.exec("DELETE FROM conversations WHERE owner_id = '\(owner)'")
        }
    }

    // MARK: - SQLite Helpers

    @discardableResult
    private func exec(_ sql: String) -> Bool {
        sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK
    }

    private func execBind(_ sql: String, binder: (OpaquePointer?) -> Void) {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
        binder(stmt)
        sqlite3_step(stmt)
        sqlite3_finalize(stmt)
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
