import CryptoKit
import Foundation
import SQLite3
import UIKit

// MARK: - Durable outbox model

enum OutgoingState: String, Codable, CaseIterable, Sendable {
    case staging
    case queued
    case preparing
    case uploading
    case committing
    case succeeded
    case retryWaiting
    case confirmationUnknown
    case failedPermanent
    case cancelled

    var isTerminal: Bool {
        self == .succeeded || self == .failedPermanent || self == .cancelled
    }

    var isUserVisibleFailure: Bool { self == .failedPermanent }

    func canTransition(to next: OutgoingState) -> Bool {
        if self == next { return true }
        switch self {
        case .staging:
            return [.queued, .preparing, .succeeded, .retryWaiting, .confirmationUnknown, .failedPermanent, .cancelled].contains(next)
        case .queued:
            // Text and metadata-only jobs can commit without a media upload.
            return [.preparing, .uploading, .committing, .succeeded, .retryWaiting, .confirmationUnknown, .failedPermanent, .cancelled].contains(next)
        case .preparing:
            return [.queued, .uploading, .retryWaiting, .failedPermanent, .cancelled].contains(next)
        case .uploading:
            return [.committing, .succeeded, .retryWaiting, .confirmationUnknown, .failedPermanent, .cancelled].contains(next)
        case .committing:
            // A job with several independently uploaded parts returns to uploading
            // after each legacy multipart commit.
            return [.uploading, .succeeded, .retryWaiting, .confirmationUnknown, .failedPermanent, .cancelled].contains(next)
        case .retryWaiting:
            return [.queued, .preparing, .uploading, .failedPermanent, .cancelled].contains(next)
        case .confirmationUnknown:
            // Media requests carry a stable client request ID and idempotency
            // key, so an unknown acknowledgement can safely enter the bounded
            // retry pipeline instead of remaining stuck forever.
            return [.queued, .retryWaiting, .succeeded, .failedPermanent, .cancelled].contains(next)
        case .failedPermanent:
            return [.queued, .cancelled].contains(next)
        case .succeeded, .cancelled:
            return false
        }
    }
}

enum OutgoingScene: String, Codable, Sendable {
    case directMessage
    case groupMessage
    case moment
    case shortDrama
}

struct OutgoingJob: Identifiable, Codable, Equatable, Sendable {
    let clientRequestID: String
    let ownerID: String
    let scene: OutgoingScene
    var businessKey: String
    var payload: Data
    var state: OutgoingState
    var serverID: String?
    var attemptCount: Int
    var nextAttemptAt: Date?
    var lastErrorCode: String?
    let createdAt: Date
    var updatedAt: Date

    var id: String { clientRequestID }

    init(
        clientRequestID: String = UUID().uuidString,
        ownerID: String,
        scene: OutgoingScene,
        businessKey: String = "",
        payload: Data = Data(),
        state: OutgoingState = .staging,
        serverID: String? = nil,
        attemptCount: Int = 0,
        nextAttemptAt: Date? = nil,
        lastErrorCode: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.clientRequestID = clientRequestID
        self.ownerID = ownerID
        self.scene = scene
        self.businessKey = businessKey
        self.payload = payload
        self.state = state
        self.serverID = serverID
        self.attemptCount = attemptCount
        self.nextAttemptAt = nextAttemptAt
        self.lastErrorCode = lastErrorCode
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

struct OutgoingPart: Identifiable, Codable, Equatable, Sendable {
    let id: String
    let jobID: String
    let role: String
    let ordinal: Int
    var localRelativePath: String
    var thumbnailRelativePath: String?
    var filename: String
    var mimeType: String
    var byteSize: Int64
    var sha256: String?
    var uploadSessionID: String?
    var urlSessionTaskID: Int?
    var uploadedBytes: Int64
    var state: OutgoingState

    init(
        id: String = UUID().uuidString,
        jobID: String,
        role: String,
        ordinal: Int,
        localRelativePath: String,
        thumbnailRelativePath: String? = nil,
        filename: String,
        mimeType: String,
        byteSize: Int64,
        sha256: String? = nil,
        uploadSessionID: String? = nil,
        urlSessionTaskID: Int? = nil,
        uploadedBytes: Int64 = 0,
        state: OutgoingState = .staging
    ) {
        self.id = id
        self.jobID = jobID
        self.role = role
        self.ordinal = ordinal
        self.localRelativePath = localRelativePath
        self.thumbnailRelativePath = thumbnailRelativePath
        self.filename = filename
        self.mimeType = mimeType
        self.byteSize = byteSize
        self.sha256 = sha256
        self.uploadSessionID = uploadSessionID
        self.urlSessionTaskID = urlSessionTaskID
        self.uploadedBytes = uploadedBytes
        self.state = state
    }
}

extension Notification.Name {
    static let outgoingStoreDidChange = Notification.Name("com.bbchat.outgoing-store-did-change")
    static let outgoingUploadNeedsRecovery = Notification.Name("com.bbchat.outgoing-upload-needs-recovery")
}

@MainActor
final class OutgoingRetryScheduler {
    static let shared = OutgoingRetryScheduler()

    private struct Entry {
        let fireDate: Date
        let token: UUID
        let task: Task<Void, Never>
    }

    private var entries: [String: Entry] = [:]

    private init() {}

    func schedule(
        ownerID: String,
        jobID: String,
        notBefore fireDate: Date,
        operation: @escaping @MainActor () async -> Void
    ) {
        let key = "\(ownerID)\n\(jobID)"
        if let existing = entries[key], existing.fireDate <= fireDate {
            return
        }

        entries[key]?.task.cancel()
        let token = UUID()
        let task = Task { [weak self] in
            let delay = max(0, fireDate.timeIntervalSinceNow)
            if delay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
            guard !Task.isCancelled,
                  let self,
                  self.entries[key]?.token == token else { return }
            self.entries.removeValue(forKey: key)
            await operation()
        }
        entries[key] = Entry(fireDate: fireDate, token: token, task: task)
    }

    func cancel(ownerID: String, jobID: String) {
        let key = "\(ownerID)\n\(jobID)"
        entries.removeValue(forKey: key)?.task.cancel()
    }
}

// MARK: - SQLite store

final class OutgoingStore: @unchecked Sendable {
    static let shared = OutgoingStore()

    private let queue = DispatchQueue(label: "com.bbchat.outgoing-store", qos: .utility)
    private var db: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private init() {
        let directory = OutgoingFileStore.rootDirectory
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        OutgoingFileStore.excludeFromBackup(directory)
        let databaseURL = directory.appendingPathComponent("outgoing.sqlite", isDirectory: false)
        guard sqlite3_open(databaseURL.path, &db) == SQLITE_OK else {
            assertionFailure("Unable to open outgoing.sqlite")
            return
        }
        execute("PRAGMA journal_mode=WAL")
        execute("PRAGMA synchronous=NORMAL")
        execute("PRAGMA foreign_keys=ON")
        createTables()
    }

    deinit { sqlite3_close(db) }

    func create(_ job: OutgoingJob, parts: [OutgoingPart] = []) throws {
        try queue.sync { try createLocked(job, parts: parts) }
        notifyChange(ownerID: job.ownerID)
    }

    /// Persists an optimistic outgoing job without blocking the caller's actor.
    ///
    /// Chat view models run on `MainActor`. Calling the synchronous `create`
    /// there prevents SwiftUI from committing the optimistic bubble until the
    /// SQLite transaction completes, which makes text sends feel network-bound
    /// even though the pending model has already been appended.
    func createAsync(_ job: OutgoingJob, parts: [OutgoingPart] = []) async throws {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                do {
                    try self.createLocked(job, parts: parts)
                    self.notifyChange(ownerID: job.ownerID)
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    func upsert(_ job: OutgoingJob) throws {
        try queue.sync { try upsertJobLocked(job) }
        notifyChange(ownerID: job.ownerID)
    }

    func upsert(_ part: OutgoingPart, ownerID: String) throws {
        try queue.sync { try upsertPartLocked(part) }
        notifyChange(ownerID: ownerID)
    }

    func updateJob(
        id: String,
        ownerID: String,
        state: OutgoingState,
        serverID: String? = nil,
        lastErrorCode: String? = nil,
        incrementAttempt: Bool = false,
        nextAttemptAt: Date? = nil
    ) {
        queue.sync {
            guard let currentState = currentJobStateLocked(id: id, ownerID: ownerID),
                  currentState.canTransition(to: state) else { return }
            guard let statement = prepare("""
                UPDATE outgoing_jobs
                SET state = ?, server_id = COALESCE(?, server_id),
                    last_error_code = ?, attempt_count = attempt_count + ?,
                    next_attempt_at = ?, updated_at = ?
                WHERE client_request_id = ? AND owner_id = ?
            """) else { return }
            defer { sqlite3_finalize(statement) }
            bind(state.rawValue, to: 1, in: statement)
            bind(serverID, to: 2, in: statement)
            bind(lastErrorCode, to: 3, in: statement)
            sqlite3_bind_int(statement, 4, incrementAttempt ? 1 : 0)
            bind(nextAttemptAt?.timeIntervalSince1970, to: 5, in: statement)
            sqlite3_bind_double(statement, 6, Date().timeIntervalSince1970)
            bind(id, to: 7, in: statement)
            bind(ownerID, to: 8, in: statement)
            sqlite3_step(statement)
        }
        notifyChange(ownerID: ownerID)
    }

    private func currentJobStateLocked(id: String, ownerID: String) -> OutgoingState? {
        guard let statement = prepare("""
            SELECT state FROM outgoing_jobs
            WHERE client_request_id = ? AND owner_id = ? LIMIT 1
        """) else { return nil }
        defer { sqlite3_finalize(statement) }
        bind(id, to: 1, in: statement)
        bind(ownerID, to: 2, in: statement)
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        return OutgoingState(rawValue: text(statement, 0))
    }

    func updatePart(
        id: String,
        ownerID: String,
        state: OutgoingState,
        taskID: Int? = nil,
        uploadedBytes: Int64? = nil,
        sha256: String? = nil
    ) {
        queue.sync {
            guard let statement = prepare("""
                UPDATE outgoing_parts
                SET state = ?, task_id = COALESCE(?, task_id),
                    uploaded_bytes = COALESCE(?, uploaded_bytes),
                    sha256 = COALESCE(?, sha256)
                WHERE id = ?
            """) else { return }
            defer { sqlite3_finalize(statement) }
            bind(state.rawValue, to: 1, in: statement)
            if let taskID { sqlite3_bind_int64(statement, 2, sqlite3_int64(taskID)) } else { sqlite3_bind_null(statement, 2) }
            if let uploadedBytes { sqlite3_bind_int64(statement, 3, uploadedBytes) } else { sqlite3_bind_null(statement, 3) }
            bind(sha256, to: 4, in: statement)
            bind(id, to: 5, in: statement)
            sqlite3_step(statement)
        }
        notifyChange(ownerID: ownerID)
    }

    func jobs(ownerID: String, includeTerminal: Bool = true) -> [OutgoingJob] {
        queue.sync {
            let terminalClause = includeTerminal ? "" : " AND state NOT IN ('succeeded', 'failedPermanent', 'cancelled')"
            guard let statement = prepare("""
                SELECT client_request_id, owner_id, scene, business_key, payload_json,
                       state, server_id, attempt_count, next_attempt_at, last_error_code,
                       created_at, updated_at
                FROM outgoing_jobs WHERE owner_id = ?\(terminalClause)
                ORDER BY created_at ASC
            """) else { return [] }
            defer { sqlite3_finalize(statement) }
            bind(ownerID, to: 1, in: statement)
            var result: [OutgoingJob] = []
            while sqlite3_step(statement) == SQLITE_ROW {
                guard let scene = OutgoingScene(rawValue: text(statement, 2)),
                      let state = OutgoingState(rawValue: text(statement, 5)) else { continue }
                result.append(OutgoingJob(
                    clientRequestID: text(statement, 0),
                    ownerID: text(statement, 1),
                    scene: scene,
                    businessKey: text(statement, 3),
                    payload: blob(statement, 4),
                    state: state,
                    serverID: nullableText(statement, 6),
                    attemptCount: Int(sqlite3_column_int(statement, 7)),
                    nextAttemptAt: nullableDate(statement, 8),
                    lastErrorCode: nullableText(statement, 9),
                    createdAt: Date(timeIntervalSince1970: sqlite3_column_double(statement, 10)),
                    updatedAt: Date(timeIntervalSince1970: sqlite3_column_double(statement, 11))
                ))
            }
            return result
        }
    }

    func parts(jobID: String) -> [OutgoingPart] {
        queue.sync {
            guard let statement = prepare("""
                SELECT id, job_id, role, ordinal, local_relative_path,
                       thumbnail_relative_path, filename, mime_type, byte_size, sha256,
                       upload_session_id, task_id, uploaded_bytes, state
                FROM outgoing_parts WHERE job_id = ? ORDER BY ordinal ASC
            """) else { return [] }
            defer { sqlite3_finalize(statement) }
            bind(jobID, to: 1, in: statement)
            var result: [OutgoingPart] = []
            while sqlite3_step(statement) == SQLITE_ROW {
                guard let state = OutgoingState(rawValue: text(statement, 13)) else { continue }
                result.append(OutgoingPart(
                    id: text(statement, 0),
                    jobID: text(statement, 1),
                    role: text(statement, 2),
                    ordinal: Int(sqlite3_column_int(statement, 3)),
                    localRelativePath: text(statement, 4),
                    thumbnailRelativePath: nullableText(statement, 5),
                    filename: text(statement, 6),
                    mimeType: text(statement, 7),
                    byteSize: sqlite3_column_int64(statement, 8),
                    sha256: nullableText(statement, 9),
                    uploadSessionID: nullableText(statement, 10),
                    urlSessionTaskID: sqlite3_column_type(statement, 11) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(statement, 11)),
                    uploadedBytes: sqlite3_column_int64(statement, 12),
                    state: state
                ))
            }
            return result
        }
    }

    func cancel(jobID: String, ownerID: String) {
        updateJob(id: jobID, ownerID: ownerID, state: .cancelled)
        queue.sync {
            guard let statement = prepare("UPDATE outgoing_parts SET state = 'cancelled' WHERE job_id = ?") else { return }
            defer { sqlite3_finalize(statement) }
            bind(jobID, to: 1, in: statement)
            sqlite3_step(statement)
        }
        notifyChange(ownerID: ownerID)
    }

    func removeTerminalJobs(olderThan cutoff: Date) -> [(ownerID: String, jobID: String)] {
        queue.sync {
            guard let select = prepare("""
                SELECT owner_id, client_request_id FROM outgoing_jobs
                WHERE state IN ('succeeded', 'cancelled') AND updated_at < ?
            """) else { return [] }
            defer { sqlite3_finalize(select) }
            sqlite3_bind_double(select, 1, cutoff.timeIntervalSince1970)
            var jobs: [(String, String)] = []
            while sqlite3_step(select) == SQLITE_ROW { jobs.append((text(select, 0), text(select, 1))) }
            guard let delete = prepare("""
                DELETE FROM outgoing_jobs
                WHERE state IN ('succeeded', 'cancelled') AND updated_at < ?
            """) else { return jobs }
            defer { sqlite3_finalize(delete) }
            sqlite3_bind_double(delete, 1, cutoff.timeIntervalSince1970)
            sqlite3_step(delete)
            return jobs
        }
    }

    private func createTables() {
        execute("""
            CREATE TABLE IF NOT EXISTS outgoing_jobs (
                client_request_id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                scene TEXT NOT NULL,
                business_key TEXT NOT NULL DEFAULT '',
                payload_json BLOB NOT NULL,
                state TEXT NOT NULL,
                server_id TEXT,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                next_attempt_at REAL,
                last_error_code TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
        """)
        execute("CREATE INDEX IF NOT EXISTS idx_outgoing_owner_state ON outgoing_jobs(owner_id, state, next_attempt_at)")
        execute("""
            CREATE TABLE IF NOT EXISTS outgoing_parts (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                role TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                local_relative_path TEXT NOT NULL,
                thumbnail_relative_path TEXT,
                filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                byte_size INTEGER NOT NULL,
                sha256 TEXT,
                upload_session_id TEXT,
                task_id INTEGER,
                uploaded_bytes INTEGER NOT NULL DEFAULT 0,
                state TEXT NOT NULL,
                FOREIGN KEY(job_id) REFERENCES outgoing_jobs(client_request_id) ON DELETE CASCADE
            )
        """)
        execute("CREATE INDEX IF NOT EXISTS idx_outgoing_parts_job ON outgoing_parts(job_id, ordinal)")
        execute("CREATE INDEX IF NOT EXISTS idx_outgoing_parts_task ON outgoing_parts(task_id)")
    }

    private func upsertJobLocked(_ job: OutgoingJob) throws {
        guard let statement = prepare("""
            INSERT INTO outgoing_jobs
            (client_request_id, owner_id, scene, business_key, payload_json, state,
             server_id, attempt_count, next_attempt_at, last_error_code, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(client_request_id) DO UPDATE SET
              business_key=excluded.business_key, payload_json=excluded.payload_json,
              state=excluded.state, server_id=excluded.server_id,
              attempt_count=excluded.attempt_count, next_attempt_at=excluded.next_attempt_at,
              last_error_code=excluded.last_error_code, updated_at=excluded.updated_at
        """) else { throw StoreError.sqlite }
        defer { sqlite3_finalize(statement) }
        bind(job.clientRequestID, to: 1, in: statement)
        bind(job.ownerID, to: 2, in: statement)
        bind(job.scene.rawValue, to: 3, in: statement)
        bind(job.businessKey, to: 4, in: statement)
        bind(job.payload, to: 5, in: statement)
        bind(job.state.rawValue, to: 6, in: statement)
        bind(job.serverID, to: 7, in: statement)
        sqlite3_bind_int(statement, 8, Int32(job.attemptCount))
        bind(job.nextAttemptAt?.timeIntervalSince1970, to: 9, in: statement)
        bind(job.lastErrorCode, to: 10, in: statement)
        sqlite3_bind_double(statement, 11, job.createdAt.timeIntervalSince1970)
        sqlite3_bind_double(statement, 12, job.updatedAt.timeIntervalSince1970)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw StoreError.sqlite }
    }

    private func createLocked(_ job: OutgoingJob, parts: [OutgoingPart]) throws {
        guard execute("BEGIN IMMEDIATE TRANSACTION") else { throw StoreError.sqlite }
        do {
            try upsertJobLocked(job)
            for part in parts { try upsertPartLocked(part) }
            guard execute("COMMIT") else { throw StoreError.sqlite }
        } catch {
            execute("ROLLBACK")
            throw error
        }
    }

    private func upsertPartLocked(_ part: OutgoingPart) throws {
        guard let statement = prepare("""
            INSERT INTO outgoing_parts
            (id, job_id, role, ordinal, local_relative_path, thumbnail_relative_path,
             filename, mime_type, byte_size, sha256, upload_session_id, task_id,
             uploaded_bytes, state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              local_relative_path=excluded.local_relative_path,
              thumbnail_relative_path=excluded.thumbnail_relative_path,
              filename=excluded.filename, mime_type=excluded.mime_type,
              byte_size=excluded.byte_size, sha256=excluded.sha256,
              upload_session_id=excluded.upload_session_id, task_id=excluded.task_id,
              uploaded_bytes=excluded.uploaded_bytes, state=excluded.state
        """) else { throw StoreError.sqlite }
        defer { sqlite3_finalize(statement) }
        bind(part.id, to: 1, in: statement)
        bind(part.jobID, to: 2, in: statement)
        bind(part.role, to: 3, in: statement)
        sqlite3_bind_int(statement, 4, Int32(part.ordinal))
        bind(part.localRelativePath, to: 5, in: statement)
        bind(part.thumbnailRelativePath, to: 6, in: statement)
        bind(part.filename, to: 7, in: statement)
        bind(part.mimeType, to: 8, in: statement)
        sqlite3_bind_int64(statement, 9, part.byteSize)
        bind(part.sha256, to: 10, in: statement)
        bind(part.uploadSessionID, to: 11, in: statement)
        if let taskID = part.urlSessionTaskID { sqlite3_bind_int64(statement, 12, sqlite3_int64(taskID)) } else { sqlite3_bind_null(statement, 12) }
        sqlite3_bind_int64(statement, 13, part.uploadedBytes)
        bind(part.state.rawValue, to: 14, in: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw StoreError.sqlite }
    }

    @discardableResult
    private func execute(_ sql: String) -> Bool {
        sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK
    }

    private func prepare(_ sql: String) -> OpaquePointer? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
        return statement
    }

    private func bind(_ value: String?, to index: Int32, in statement: OpaquePointer?) {
        guard let value else { sqlite3_bind_null(statement, index); return }
        sqlite3_bind_text(statement, index, value, -1, transient)
    }

    private func bind(_ value: Data, to index: Int32, in statement: OpaquePointer?) {
        value.withUnsafeBytes { bytes in
            sqlite3_bind_blob(statement, index, bytes.baseAddress, Int32(bytes.count), transient)
        }
    }

    private func bind(_ value: Double?, to index: Int32, in statement: OpaquePointer?) {
        if let value { sqlite3_bind_double(statement, index, value) } else { sqlite3_bind_null(statement, index) }
    }

    private func text(_ statement: OpaquePointer?, _ column: Int32) -> String {
        guard let value = sqlite3_column_text(statement, column) else { return "" }
        return String(cString: value)
    }

    private func nullableText(_ statement: OpaquePointer?, _ column: Int32) -> String? {
        sqlite3_column_type(statement, column) == SQLITE_NULL ? nil : text(statement, column)
    }

    private func blob(_ statement: OpaquePointer?, _ column: Int32) -> Data {
        guard let bytes = sqlite3_column_blob(statement, column) else { return Data() }
        return Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, column)))
    }

    private func nullableDate(_ statement: OpaquePointer?, _ column: Int32) -> Date? {
        sqlite3_column_type(statement, column) == SQLITE_NULL
            ? nil
            : Date(timeIntervalSince1970: sqlite3_column_double(statement, column))
    }

    private func notifyChange(ownerID: String) {
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .outgoingStoreDidChange, object: ownerID)
        }
    }

    enum StoreError: Error { case sqlite }
}

// MARK: - File staging

enum OutgoingFileStore {
    static let rootDirectory: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("BWChat/Outbox", isDirectory: true)
    }()

    static func jobDirectory(ownerID: String, jobID: String) throws -> URL {
        let ownerDirectory = rootDirectory.appendingPathComponent(pathComponent(ownerID), isDirectory: true)
        let jobDirectory = ownerDirectory.appendingPathComponent(pathComponent(jobID), isDirectory: true)
        try FileManager.default.createDirectory(
            at: jobDirectory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        excludeFromBackup(jobDirectory)
        return jobDirectory
    }

    static func stage(data: Data, ownerID: String, jobID: String, filename: String) async throws -> URL {
        try await Task.detached(priority: .utility) {
            let directory = try jobDirectory(ownerID: ownerID, jobID: jobID)
            let destination = directory.appendingPathComponent(filename, isDirectory: false)
            try data.write(to: destination, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return destination
        }.value
    }

    static func stage(file source: URL, ownerID: String, jobID: String, filename: String) async throws -> URL {
        try await Task.detached(priority: .utility) {
            let directory = try jobDirectory(ownerID: ownerID, jobID: jobID)
            let destination = directory.appendingPathComponent(filename, isDirectory: false)
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.copyItem(at: source, to: destination)
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: destination.path
            )
            return destination
        }.value
    }

    static func relativePath(for url: URL) -> String {
        let root = rootDirectory.standardizedFileURL.path
        let path = url.standardizedFileURL.path
        guard path.hasPrefix(root + "/") else { return url.lastPathComponent }
        return String(path.dropFirst(root.count + 1))
    }

    static func absoluteURL(for relativePath: String) -> URL {
        rootDirectory.appendingPathComponent(relativePath, isDirectory: false)
    }

    static func sha256(of url: URL) async throws -> String {
        try await Task.detached(priority: .utility) {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            var hasher = SHA256()
            while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
                hasher.update(data: chunk)
            }
            return hasher.finalize().map { String(format: "%02x", $0) }.joined()
        }.value
    }

    static func removeJob(ownerID: String, jobID: String) {
        guard let url = try? jobDirectory(ownerID: ownerID, jobID: jobID) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    static func cleanup(ttl: TimeInterval = 7 * 24 * 60 * 60) {
        let removed = OutgoingStore.shared.removeTerminalJobs(olderThan: Date().addingTimeInterval(-ttl))
        for item in removed { removeJob(ownerID: item.ownerID, jobID: item.jobID) }
    }

    static func excludeFromBackup(_ url: URL) {
        var mutableURL = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? mutableURL.setResourceValues(values)
    }

    private static func pathComponent(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

struct LegacyMultipartTextField: Sendable {
    let name: String
    let value: String
}

struct LegacyMultipartFileField: Sendable {
    let name: String
    let filename: String
    let mimeType: String
    let fileURL: URL
}

enum LegacyMultipartAdapter {
    static func build(
        textFields: [LegacyMultipartTextField],
        fileFields: [LegacyMultipartFileField],
        destinationURL: URL,
        boundary: String
    ) throws {
        FileManager.default.createFile(atPath: destinationURL.path, contents: nil)
        let output = try FileHandle(forWritingTo: destinationURL)
        defer { try? output.close() }

        func write(_ string: String) throws {
            guard let data = string.data(using: .utf8) else { return }
            try output.write(contentsOf: data)
        }

        for field in textFields {
            try write("--\(boundary)\r\n")
            try write("Content-Disposition: form-data; name=\"\(field.name)\"\r\n\r\n")
            try write("\(field.value)\r\n")
        }

        for field in fileFields {
            try write("--\(boundary)\r\n")
            try write("Content-Disposition: form-data; name=\"\(field.name)\"; filename=\"\(field.filename)\"\r\n")
            try write("Content-Type: \(field.mimeType)\r\n\r\n")
            let input = try FileHandle(forReadingFrom: field.fileURL)
            defer { try? input.close() }
            while let chunk = try input.read(upToCount: 1_048_576), !chunk.isEmpty {
                try output.write(contentsOf: chunk)
            }
            try write("\r\n")
        }
        try write("--\(boundary)--\r\n")
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: destinationURL.path
        )
    }
}

// MARK: - Upload transport

struct UploadTransportResult: @unchecked Sendable {
    let data: Data
    let response: HTTPURLResponse
}

protocol UploadTransport: Sendable {
    func upload(request: URLRequest, fileURL: URL, jobID: String, partID: String, ownerID: String) async throws -> UploadTransportResult
    func cancel(jobID: String) async
    func activeJobIDs(ownerID: String) async -> Set<String>
}

extension UploadTransport {
    func activeJobIDs(ownerID: String) async -> Set<String> { [] }
}

final class BackgroundUploadCoordinator: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    static let shared = BackgroundUploadCoordinator()

    private static let identifier = "com.bbchat.outgoing.background-upload"
    private let lock = NSLock()
    private var responseData: [Int: Data] = [:]
    private var continuations: [Int: CheckedContinuation<UploadTransportResult, Error>] = [:]
    private var backgroundCompletionHandler: (() -> Void)?

    @MainActor private var compatibilityTasks: [String: Task<Void, Never>] = [:]
    @MainActor private var compatibilityBackgroundTaskIDs: [String: UIBackgroundTaskIdentifier] = [:]

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        configuration.waitsForConnectivity = true
        configuration.allowsCellularAccess = true
        configuration.httpMaximumConnectionsPerHost = 2
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    private override init() { super.init() }

    func activate() {
        _ = session
        OutgoingFileStore.cleanup()
    }

    func upload(
        request: URLRequest,
        fileURL: URL,
        jobID: String,
        partID: String,
        ownerID: String
    ) async throws -> UploadTransportResult {
        try await withCheckedThrowingContinuation { continuation in
            let task = session.uploadTask(with: request, fromFile: fileURL)
            task.taskDescription = [ownerID, jobID, partID].joined(separator: "\n")
            lock.withLock {
                continuations[task.taskIdentifier] = continuation
                responseData[task.taskIdentifier] = Data()
            }
            OutgoingStore.shared.updatePart(
                id: partID,
                ownerID: ownerID,
                state: .uploading,
                taskID: task.taskIdentifier
            )
            OutgoingStore.shared.updateJob(id: jobID, ownerID: ownerID, state: .uploading)
            task.resume()
        }
    }

    func cancel(jobID: String) async {
        let tasks = await allTasks()
        for task in tasks where taskIdentity(task)?.jobID == jobID { task.cancel() }
    }

    func activeJobIDs(ownerID: String) async -> Set<String> {
        let tasks = await allTasks()
        return Set(tasks.compactMap { task in
            guard let identity = taskIdentity(task), identity.ownerID == ownerID else { return nil }
            return identity.jobID
        })
    }

    func handleEvents(forBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == Self.identifier else {
            completionHandler()
            return
        }
        lock.withLock { backgroundCompletionHandler = completionHandler }
        _ = session
    }

    /// Compatibility bridge for non-file requests while their call sites migrate to UploadEngine.
    @MainActor
    func enqueue(id: String, operation: @escaping @MainActor () async -> Void) {
        guard compatibilityTasks[id] == nil else { return }
        let backgroundID = UIApplication.shared.beginBackgroundTask(withName: id) { [weak self] in
            Task { @MainActor in self?.finishCompatibilityTask(id: id) }
        }
        compatibilityBackgroundTaskIDs[id] = backgroundID
        compatibilityTasks[id] = Task { [weak self] in
            await operation()
            self?.finishCompatibilityTask(id: id)
        }
    }

    @MainActor
    func contains(id: String) -> Bool { compatibilityTasks[id] != nil }

    @MainActor
    private func finishCompatibilityTask(id: String) {
        compatibilityTasks[id] = nil
        guard let backgroundID = compatibilityBackgroundTaskIDs.removeValue(forKey: id), backgroundID != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundID)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.withLock { responseData[dataTask.taskIdentifier, default: Data()].append(data) }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        guard let identity = taskIdentity(task) else { return }
        OutgoingStore.shared.updatePart(
            id: identity.partID,
            ownerID: identity.ownerID,
            state: .uploading,
            uploadedBytes: totalBytesSent
        )
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let identity = taskIdentity(task) else { return }
        let stored = lock.withLock { () -> (Data, CheckedContinuation<UploadTransportResult, Error>?) in
            let data = responseData.removeValue(forKey: task.taskIdentifier) ?? Data()
            return (data, continuations.removeValue(forKey: task.taskIdentifier))
        }
        if OutgoingStore.shared.jobs(ownerID: identity.ownerID)
            .contains(where: { $0.id == identity.jobID && $0.state == .cancelled }) {
            stored.1?.resume(throwing: CancellationError())
            return
        }

        if let error {
            let nsError = error as NSError
            let wasCancelled = nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
            let bodyWasFullySent = task.countOfBytesExpectedToSend > 0
                && task.countOfBytesSent >= task.countOfBytesExpectedToSend
            let outcomeIsAmbiguous = !wasCancelled && bodyWasFullySent
            OutgoingStore.shared.updatePart(
                id: identity.partID,
                ownerID: identity.ownerID,
                state: wasCancelled ? .cancelled : (outcomeIsAmbiguous ? .confirmationUnknown : .retryWaiting)
            )
            if !wasCancelled {
                OutgoingStore.shared.updateJob(
                    id: identity.jobID,
                    ownerID: identity.ownerID,
                    state: outcomeIsAmbiguous ? .confirmationUnknown : .retryWaiting,
                    lastErrorCode: "\(nsError.domain):\(nsError.code)",
                    incrementAttempt: !outcomeIsAmbiguous,
                    nextAttemptAt: outcomeIsAmbiguous ? nil : Date().addingTimeInterval(5)
                )
            }
            stored.1?.resume(throwing: error)
            if stored.1 == nil, !wasCancelled {
                notifyRecoveryNeeded(ownerID: identity.ownerID, jobID: identity.jobID)
            }
            return
        }

        guard let response = task.response as? HTTPURLResponse else {
            let error = URLError(.badServerResponse)
            OutgoingStore.shared.updateJob(
                id: identity.jobID,
                ownerID: identity.ownerID,
                state: .confirmationUnknown,
                lastErrorCode: "missing-http-response"
            )
            stored.1?.resume(throwing: error)
            if stored.1 == nil {
                notifyRecoveryNeeded(ownerID: identity.ownerID, jobID: identity.jobID)
            }
            return
        }

        if (200..<300).contains(response.statusCode) {
            OutgoingStore.shared.updatePart(
                id: identity.partID,
                ownerID: identity.ownerID,
                state: .succeeded,
                uploadedBytes: task.countOfBytesSent
            )
            OutgoingStore.shared.updateJob(
                id: identity.jobID,
                ownerID: identity.ownerID,
                state: stored.1 == nil ? .confirmationUnknown : .committing,
                lastErrorCode: stored.1 == nil ? "background-response-needs-reconciliation" : nil
            )
        } else {
            OutgoingStore.shared.updatePart(id: identity.partID, ownerID: identity.ownerID, state: .retryWaiting)
            if stored.1 == nil {
                let isTransientStatus = response.statusCode == 408
                    || response.statusCode == 425
                    || response.statusCode == 429
                    || (500...599).contains(response.statusCode)
                OutgoingStore.shared.updateJob(
                    id: identity.jobID,
                    ownerID: identity.ownerID,
                    state: isTransientStatus ? .retryWaiting : .failedPermanent,
                    lastErrorCode: "http:\(response.statusCode)",
                    incrementAttempt: isTransientStatus,
                    nextAttemptAt: isTransientStatus ? Date().addingTimeInterval(5) : nil
                )
            }
        }
        stored.1?.resume(returning: UploadTransportResult(data: stored.0, response: response))
        if stored.1 == nil {
            notifyRecoveryNeeded(ownerID: identity.ownerID, jobID: identity.jobID)
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let completion = lock.withLock { () -> (() -> Void)? in
            defer { backgroundCompletionHandler = nil }
            return backgroundCompletionHandler
        }
        DispatchQueue.main.async { completion?() }
    }

    private func allTasks() async -> [URLSessionTask] {
        await withCheckedContinuation { continuation in
            session.getAllTasks { continuation.resume(returning: $0) }
        }
    }

    private func taskIdentity(_ task: URLSessionTask) -> (ownerID: String, jobID: String, partID: String)? {
        guard let values = task.taskDescription?.split(separator: "\n", omittingEmptySubsequences: false).map(String.init), values.count == 3 else { return nil }
        return (values[0], values[1], values[2])
    }

    private func notifyRecoveryNeeded(ownerID: String, jobID: String) {
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: .outgoingUploadNeedsRecovery,
                object: ownerID,
                userInfo: ["job_id": jobID]
            )
        }
    }
}

extension BackgroundUploadCoordinator: UploadTransport {}

actor UploadEngine {
    static let shared = UploadEngine()

    private let store: OutgoingStore
    private let transport: UploadTransport

    init(store: OutgoingStore = .shared, transport: UploadTransport = BackgroundUploadCoordinator.shared) {
        self.store = store
        self.transport = transport
    }

    func enqueue(job: OutgoingJob, parts: [OutgoingPart]) async throws {
        var preparedParts: [OutgoingPart] = []
        preparedParts.reserveCapacity(parts.count)
        for var part in parts {
            if part.sha256 == nil, !part.localRelativePath.isEmpty {
                part.sha256 = try? await OutgoingFileStore.sha256(
                    of: OutgoingFileStore.absoluteURL(for: part.localRelativePath)
                )
            }
            preparedParts.append(part)
        }
        if let existing = store.jobs(ownerID: job.ownerID).first(where: { $0.id == job.id }) {
            store.updateJob(id: existing.id, ownerID: existing.ownerID, state: .queued)
            let existingParts = store.parts(jobID: existing.id)
            for part in existingParts {
                store.updatePart(id: part.id, ownerID: existing.ownerID, state: .queued)
            }
            if existingParts.isEmpty {
                for part in preparedParts {
                    var queuedPart = part
                    queuedPart.state = .queued
                    try store.upsert(queuedPart, ownerID: job.ownerID)
                }
            }
            return
        }
        var queuedJob = job
        queuedJob.state = .queued
        queuedJob.updatedAt = Date()
        let queuedParts = preparedParts.map { part -> OutgoingPart in
            var part = part
            part.state = .queued
            return part
        }
        try store.create(queuedJob, parts: queuedParts)
    }

    func upload(request: URLRequest, multipartFileURL: URL, job: OutgoingJob, part: OutgoingPart) async throws -> UploadTransportResult {
        try Task.checkCancellation()
        return try await transport.upload(
            request: request,
            fileURL: multipartFileURL,
            jobID: job.clientRequestID,
            partID: part.id,
            ownerID: job.ownerID
        )
    }

    func markSucceeded(jobID: String, ownerID: String, serverID: String?) {
        store.updateJob(id: jobID, ownerID: ownerID, state: .succeeded, serverID: serverID)
    }

    func markConfirmationUnknown(jobID: String, ownerID: String, code: String) {
        store.updateJob(id: jobID, ownerID: ownerID, state: .confirmationUnknown, lastErrorCode: code)
    }

    func markRetryWaiting(jobID: String, ownerID: String, error: Error, attempt: Int) {
        let cappedAttempt = min(max(attempt, 0), 8)
        let base = min(pow(2, Double(cappedAttempt)), 300)
        let jitter = Double.random(in: 0...(base * 0.2))
        store.updateJob(
            id: jobID,
            ownerID: ownerID,
            state: .retryWaiting,
            lastErrorCode: String(describing: error),
            incrementAttempt: true,
            nextAttemptAt: Date().addingTimeInterval(base + jitter)
        )
    }

    nonisolated static func isTransient(_ error: Error) -> Bool {
        if let urlError = error as? URLError {
            return [
                .notConnectedToInternet, .networkConnectionLost, .timedOut,
                .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed,
                .internationalRoamingOff, .dataNotAllowed, .backgroundSessionWasDisconnected,
                .badServerResponse, .resourceUnavailable, .cannotLoadFromNetwork
            ].contains(urlError.code)
        }
        if case APIError.networkError(let underlying) = error {
            return isTransient(underlying)
        }
        if case APIError.serverError(let code, _) = error {
            return code == 408 || code == 425 || code == 429 || (500...599).contains(code)
        }
        return false
    }

    func cancel(jobID: String, ownerID: String) async {
        store.cancel(jobID: jobID, ownerID: ownerID)
        await transport.cancel(jobID: jobID)
        OutgoingFileStore.removeJob(ownerID: ownerID, jobID: jobID)
    }

    func recover(ownerID: String, jobIDs: Set<String>? = nil) async {
        BackgroundUploadCoordinator.shared.activate()
        let activeJobIDs = await transport.activeJobIDs(ownerID: ownerID)
        for job in store.jobs(ownerID: ownerID, includeTerminal: false)
        where jobIDs?.contains(job.id) ?? true {
            switch job.state {
            case .preparing:
                store.updateJob(id: job.id, ownerID: ownerID, state: .queued)
            case .uploading where !activeJobIDs.contains(job.id):
                markRetryWaiting(
                    jobID: job.id,
                    ownerID: ownerID,
                    error: URLError(.backgroundSessionWasDisconnected),
                    attempt: job.attemptCount
                )
            case .committing:
                store.updateJob(id: job.id, ownerID: ownerID, state: .confirmationUnknown)
            default:
                break
            }
        }
    }
}

enum OutgoingRetryPolicy {
    static let maximumAutomaticAttempts = 5

    static func shouldRetry(job: OutgoingJob, error: Error) -> Bool {
        guard job.attemptCount < maximumAutomaticAttempts else { return false }
        return job.state == .retryWaiting
            || job.state == .confirmationUnknown
            || UploadEngine.isTransient(error)
    }

    static func scheduledDate(for job: OutgoingJob, now: Date = Date()) -> Date {
        max(job.nextAttemptAt ?? now, now)
    }
}

@MainActor
final class UploadProjectionStore: ObservableObject {
    static let shared = UploadProjectionStore()

    @Published private(set) var jobs: [OutgoingJob] = []
    private var ownerID = ""
    private var observer: NSObjectProtocol?

    private init() {
        observer = NotificationCenter.default.addObserver(
            forName: .outgoingStoreDidChange,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor [weak self] in
                guard let self,
                      let changedOwner = notification.object as? String,
                      changedOwner == self.ownerID else { return }
                self.reload()
            }
        }
    }

    func setOwner(_ ownerID: String) {
        guard self.ownerID != ownerID else { return }
        self.ownerID = ownerID
        reload()
        Task { await UploadEngine.shared.recover(ownerID: ownerID) }
    }

    func reload() {
        guard !ownerID.isEmpty else { jobs = []; return }
        jobs = OutgoingStore.shared.jobs(ownerID: ownerID)
    }
}

private extension NSLock {
    func withLock<T>(_ operation: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try operation()
    }
}
