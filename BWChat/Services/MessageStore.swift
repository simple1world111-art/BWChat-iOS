// BWChat/Services/MessageStore.swift
// Local SQLite cache for messages and conversations

import Foundation
import SQLite3

final class MessageStore {
    static let shared = MessageStore()

    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "com.bwchat.messagestore", qos: .userInitiated)

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
        let dbDir = appSupport.appendingPathComponent("BWChat", isDirectory: true)
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
                id INTEGER PRIMARY KEY,
                group_id INTEGER NOT NULL,
                sender_id TEXT NOT NULL,
                msg_type TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                sender_nickname TEXT NOT NULL DEFAULT '',
                sender_avatar TEXT NOT NULL DEFAULT '',
                reply_to_id INTEGER,
                reply_to_json TEXT,
                mentions TEXT
            )
        """)
        exec("CREATE INDEX IF NOT EXISTS idx_gmsg_group ON group_messages (group_id)")
        exec("CREATE INDEX IF NOT EXISTS idx_gmsg_ts ON group_messages (group_id, timestamp)")

        exec("""
            CREATE TABLE IF NOT EXISTS conversations (
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
                PRIMARY KEY (id, type)
            )
        """)
    }

    // MARK: - DM Messages

    func saveMessage(_ message: Message) {
        queue.async { [weak self] in
            self?.insertMessage(message)
        }
    }

    func saveMessages(_ messages: [Message]) {
        queue.async { [weak self] in
            self?.exec("BEGIN TRANSACTION")
            for msg in messages {
                self?.insertMessage(msg)
            }
            self?.exec("COMMIT")
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
        queue.async { [weak self] in
            self?.insertGroupMessage(message)
        }
    }

    func saveGroupMessages(_ messages: [GroupMessage]) {
        queue.async { [weak self] in
            self?.exec("BEGIN TRANSACTION")
            for msg in messages {
                self?.insertGroupMessage(msg)
            }
            self?.exec("COMMIT")
        }
    }

    private func insertGroupMessage(_ msg: GroupMessage) {
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

        let sql = """
            INSERT OR REPLACE INTO group_messages
            (id, group_id, sender_id, msg_type, content, timestamp,
             sender_nickname, sender_avatar, reply_to_id, reply_to_json, mentions)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        execBind(sql) { stmt in
            sqlite3_bind_int64(stmt, 1, Int64(msg.id))
            sqlite3_bind_int64(stmt, 2, Int64(msg.groupID))
            Self.bindText(stmt, 3, msg.senderID)
            Self.bindText(stmt, 4, msg.msgType)
            Self.bindText(stmt, 5, msg.content)
            Self.bindText(stmt, 6, msg.timestamp)
            Self.bindText(stmt, 7, msg.senderNickname)
            Self.bindText(stmt, 8, msg.senderAvatar)
            if let rid = msg.replyToID {
                sqlite3_bind_int64(stmt, 9, Int64(rid))
            } else {
                sqlite3_bind_null(stmt, 9)
            }
            Self.bindTextOrNull(stmt, 10, replyJSON)
            Self.bindTextOrNull(stmt, 11, mentionsJSON)
        }
    }

    func loadGroupMessages(groupID: Int, beforeID: Int? = nil, limit: Int = 30) -> [GroupMessage] {
        var results: [GroupMessage] = []
        queue.sync {
            let sql: String
            if let bid = beforeID {
                sql = """
                    SELECT * FROM group_messages
                    WHERE group_id = \(groupID) AND id < \(bid)
                    ORDER BY id DESC LIMIT \(limit)
                """
            } else {
                sql = """
                    SELECT * FROM group_messages
                    WHERE group_id = \(groupID)
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
            let sql = "SELECT MAX(id) FROM group_messages WHERE group_id = \(groupID)"
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(stmt) }
            if sqlite3_step(stmt) == SQLITE_ROW && sqlite3_column_type(stmt, 0) != SQLITE_NULL {
                result = Int(sqlite3_column_int64(stmt, 0))
            }
        }
        return result
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

        return GroupMessage(
            id: id, groupID: groupID, senderID: senderID,
            msgType: msgType, content: content, timestamp: timestamp,
            senderNickname: senderNickname, senderAvatar: senderAvatar,
            replyToID: replyToID, replyTo: replyTo, mentions: mentions
        )
    }

    // MARK: - Conversations

    func saveConversations(_ convs: [Conversation]) {
        queue.async { [weak self] in
            self?.exec("DELETE FROM conversations")
            self?.exec("BEGIN TRANSACTION")
            for c in convs {
                self?.insertConversation(c)
            }
            self?.exec("COMMIT")
        }
    }

    func updateConversation(_ conv: Conversation) {
        queue.async { [weak self] in
            self?.insertConversation(conv)
        }
    }

    private func insertConversation(_ c: Conversation) {
        let sql = """
            INSERT OR REPLACE INTO conversations
            (id, type, name, avatar_url, last_message, last_message_time,
             unread_count, subtitle, group_id, member_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        execBind(sql) { stmt in
            Self.bindText(stmt, 1, c.id)
            Self.bindText(stmt, 2, c.type)
            Self.bindText(stmt, 3, c.name)
            Self.bindText(stmt, 4, c.avatarURL)
            Self.bindTextOrNull(stmt, 5, c.lastMessage)
            Self.bindTextOrNull(stmt, 6, c.lastMessageTime)
            sqlite3_bind_int(stmt, 7, Int32(c.unreadCount))
            Self.bindTextOrNull(stmt, 8, c.subtitle)
            if let gid = c.groupID {
                sqlite3_bind_int64(stmt, 9, Int64(gid))
            } else {
                sqlite3_bind_null(stmt, 9)
            }
            if let mc = c.memberCount {
                sqlite3_bind_int(stmt, 10, Int32(mc))
            } else {
                sqlite3_bind_null(stmt, 10)
            }
        }
    }

    func loadConversations() -> [Conversation] {
        var results: [Conversation] = []
        queue.sync {
            let sql = "SELECT * FROM conversations ORDER BY last_message_time DESC"
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

                results.append(Conversation(
                    type: type, id: id, name: name, avatarURL: avatarURL,
                    lastMessage: lastMessage, lastMessageTime: lastMessageTime,
                    unreadCount: unreadCount, subtitle: subtitle,
                    groupID: groupID, memberCount: memberCount
                ))
            }
        }
        return results
    }

    // MARK: - Cleanup

    func clearAll() {
        queue.async { [weak self] in
            self?.exec("DELETE FROM messages")
            self?.exec("DELETE FROM group_messages")
            self?.exec("DELETE FROM conversations")
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
