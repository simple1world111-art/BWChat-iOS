import AVFoundation
import CryptoKit
import Foundation

@MainActor
final class MediaCacheManager: NSObject, ObservableObject {
    static let shared = MediaCacheManager()

    struct Entry: Codable, Equatable, Identifiable {
        let id: String
        let remoteURL: String
        let relativePath: String
        let isHLS: Bool
        var byteCount: Int64
        var createdAt: Date
        var lastAccessedAt: Date
    }

    private struct PendingDownload: Codable {
        let mediaID: String
        let remoteURL: String
        let accountScope: String
        let isHLS: Bool
    }

    @Published private(set) var totalBytes: Int64 = 0
    @Published private(set) var activeDownloadIDs = Set<String>()

    private let fileManager = FileManager.default
    private var entries: [String: Entry] = [:]
    private var loadedScope: String?
    private var delayedTasks: [String: Task<Void, Never>] = [:]
    private var hlsLocations: [Int: URL] = [:]

    private lazy var fileSession: URLSession = {
        let identifier = (Bundle.main.bundleIdentifier ?? "com.bwchat.app") + ".media.mp4"
        let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
        configuration.waitsForConnectivity = true
        configuration.isDiscretionary = false
        return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }()

    private lazy var hlsSession: AVAssetDownloadURLSession = {
        let identifier = (Bundle.main.bundleIdentifier ?? "com.bwchat.app") + ".media.hls"
        let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
        configuration.waitsForConnectivity = true
        return AVAssetDownloadURLSession(
            configuration: configuration,
            assetDownloadDelegate: self,
            delegateQueue: .main
        )
    }()

    private override init() {
        super.init()
    }

    func localURL(mediaID: String) -> URL? {
        ensureLoaded()
        guard var entry = entries[mediaID], let directory = mediaDirectory(), loadedScope != nil else { return nil }
        let url = directory.appendingPathComponent(entry.relativePath)
        guard fileManager.fileExists(atPath: url.path) else {
            entries[mediaID] = nil
            persistIndex()
            return nil
        }
        entry.lastAccessedAt = Date()
        entries[mediaID] = entry
        persistIndex()
        return url
    }

    func scheduleCache(
        mediaID: String,
        remoteURL: URL,
        authorizationHeaders: [String: String]? = nil,
        delay: TimeInterval = 5
    ) {
        ensureLoaded()
        guard entries[mediaID] == nil, activeDownloadIDs.contains(mediaID) == false else { return }
        delayedTasks[mediaID]?.cancel()
        delayedTasks[mediaID] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(max(delay, 0) * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self?.startDownload(mediaID: mediaID, remoteURL: remoteURL, authorizationHeaders: authorizationHeaders)
        }
    }

    func cancelScheduledCache(mediaID: String) {
        delayedTasks[mediaID]?.cancel()
        delayedTasks[mediaID] = nil
    }

    /// Copies an already-uploaded local media file into the playback cache.
    /// FileManager performs a file copy; the video is never materialized as Data.
    func adoptLocalFile(mediaID: String, remoteURL: String, sourceURL: URL) {
        ensureLoaded()
        guard let scope = loadedScope, let directory = mediaDirectory(for: scope) else { return }
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let ext = sourceURL.pathExtension.nonEmpty ?? "mp4"
        let filename = Self.hashedFilename(mediaID) + "." + ext
        let destination = directory.appendingPathComponent(filename)
        try? fileManager.removeItem(at: destination)
        do {
            try fileManager.copyItem(at: sourceURL, to: destination)
            try fileManager.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: destination.path
            )
            entries[mediaID] = Entry(
                id: mediaID,
                remoteURL: remoteURL,
                relativePath: filename,
                isHLS: false,
                byteCount: allocatedSize(of: destination),
                createdAt: Date(),
                lastAccessedAt: Date()
            )
            totalBytes = entries.values.reduce(0) { $0 + $1.byteCount }
            pruneIfNeeded()
            persistIndex()
        } catch {
            try? fileManager.removeItem(at: destination)
        }
    }

    func clearCurrentAccount() {
        ensureLoaded()
        guard let directory = mediaDirectory() else { return }
        try? fileManager.removeItem(at: directory)
        entries.removeAll()
        totalBytes = 0
        persistIndex()
    }

    func clearAccount(userID: String) {
        let scope = "account:\(userID)"
        if let directory = mediaDirectory(for: scope) {
            try? fileManager.removeItem(at: directory)
        }
        if loadedScope == scope {
            entries.removeAll()
            totalBytes = 0
        }
    }

    func formattedUsage() -> String {
        ByteCountFormatter.string(fromByteCount: totalBytes, countStyle: .file)
    }

    private func startDownload(mediaID: String, remoteURL: URL, authorizationHeaders: [String: String]?) async {
        delayedTasks[mediaID] = nil
        ensureLoaded()
        guard let scope = loadedScope,
              entries[mediaID] == nil,
              canStartDownload() else { return }

        let isHLS = remoteURL.pathExtension.lowercased() == "m3u8" || remoteURL.absoluteString.lowercased().contains(".m3u8")
        let pending = PendingDownload(mediaID: mediaID, remoteURL: remoteURL.absoluteString, accountScope: scope, isHLS: isHLS)
        guard let taskDescription = try? JSONEncoder().encode(pending).base64EncodedString() else { return }

        activeDownloadIDs.insert(mediaID)
        var finalAuthorizationHeaders = authorizationHeaders
        if authorizationHeaders?["Authorization"] != nil {
            var auditRequest = URLRequest(url: remoteURL)
            AuthRequestAuthorizer.addAuthHeader(&auditRequest, token: AuthManager.shared.token)
            AuthRequestAuthorizer.logFinalRequest(auditRequest, expectsAuthorization: true)
            finalAuthorizationHeaders = auditRequest.value(forHTTPHeaderField: "Authorization")
                .map { ["Authorization": $0] }
        }
        if isHLS {
            let options: [String: Any]? = finalAuthorizationHeaders.map { ["AVURLAssetHTTPHeaderFieldsKey": $0] }
            let asset = AVURLAsset(url: remoteURL, options: options)
            guard let task = hlsSession.makeAssetDownloadTask(
                asset: asset,
                assetTitle: mediaID,
                assetArtworkData: nil,
                options: nil
            ) else {
                activeDownloadIDs.remove(mediaID)
                return
            }
            task.taskDescription = taskDescription
            task.resume()
        } else {
            var request = URLRequest(url: remoteURL)
            finalAuthorizationHeaders?.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
            let task = fileSession.downloadTask(with: request)
            task.taskDescription = taskDescription
            task.resume()
        }
    }

    private func finishDownload(task: URLSessionTask, temporaryURL: URL) {
        guard let pending = pendingDownload(for: task), pending.accountScope == loadedScope,
              let directory = mediaDirectory(for: pending.accountScope) else { return }
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let ext = pending.isHLS ? "movpkg" : (URL(string: pending.remoteURL)?.pathExtension.nonEmpty ?? "mp4")
        let filename = Self.hashedFilename(pending.mediaID) + "." + ext
        let destination = directory.appendingPathComponent(filename)
        try? fileManager.removeItem(at: destination)
        do {
            try fileManager.moveItem(at: temporaryURL, to: destination)
            try? fileManager.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: destination.path
            )
            let size = allocatedSize(of: destination)
            entries[pending.mediaID] = Entry(
                id: pending.mediaID,
                remoteURL: pending.remoteURL,
                relativePath: filename,
                isHLS: pending.isHLS,
                byteCount: size,
                createdAt: Date(),
                lastAccessedAt: Date()
            )
            totalBytes = entries.values.reduce(0) { $0 + $1.byteCount }
            pruneIfNeeded()
            persistIndex()
        } catch {
            try? fileManager.removeItem(at: temporaryURL)
        }
        activeDownloadIDs.remove(pending.mediaID)
    }

    private func ensureLoaded() {
        guard AuthManager.shared.isLoggedIn, let userID = AuthManager.shared.currentUser?.userID else {
            loadedScope = nil
            entries.removeAll()
            totalBytes = 0
            return
        }
        let scope = "account:\(userID)"
        guard loadedScope != scope else { return }
        loadedScope = scope
        if let key = CacheKey.current(namespace: "media-cache", key: "index"),
           let cached: CachedSnapshot<[Entry]> = AppCacheRepository.shared.cachedValue(for: key) {
            entries = Dictionary(uniqueKeysWithValues: cached.value.map { ($0.id, $0) })
        } else {
            entries = [:]
        }
        removeMissingEntries()
        totalBytes = entries.values.reduce(0) { $0 + $1.byteCount }
    }

    private func persistIndex() {
        guard let key = CacheKey.current(namespace: "media-cache", key: "index") else { return }
        let tenYears: TimeInterval = 10 * 365 * 24 * 60 * 60
        AppCacheRepository.shared.save(
            Array(entries.values),
            for: key,
            policy: CachePolicy(ttl: tenYears, staleRetention: tenYears)
        )
    }

    private func removeMissingEntries() {
        guard let directory = mediaDirectory() else { return }
        entries = entries.filter { fileManager.fileExists(atPath: directory.appendingPathComponent($0.value.relativePath).path) }
    }

    private func canStartDownload() -> Bool {
        guard let directory = mediaDirectory() else { return false }
        let values = try? directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        let available = Int64(values?.volumeAvailableCapacityForImportantUsage ?? 0)
        return available > 2 * 1024 * 1024 * 1024
    }

    private func pruneIfNeeded() {
        guard let directory = mediaDirectory() else { return }
        let now = Date()
        let oldCutoff = now.addingTimeInterval(-30 * 24 * 60 * 60)
        for entry in entries.values where entry.lastAccessedAt < oldCutoff {
            try? fileManager.removeItem(at: directory.appendingPathComponent(entry.relativePath))
            entries[entry.id] = nil
        }

        totalBytes = entries.values.reduce(0) { $0 + $1.byteCount }
        let values = try? directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        let available = Int64(values?.volumeAvailableCapacityForImportantUsage ?? 0)
        let adaptive = Int64(Double(max(available + totalBytes, 0)) * 0.15)
        let budget = min(5 * 1024 * 1024 * 1024, max(512 * 1024 * 1024, adaptive))
        for entry in entries.values.sorted(by: { $0.lastAccessedAt < $1.lastAccessedAt }) where totalBytes > budget {
            try? fileManager.removeItem(at: directory.appendingPathComponent(entry.relativePath))
            entries[entry.id] = nil
            totalBytes -= entry.byteCount
        }
    }

    private func allocatedSize(of url: URL) -> Int64 {
        if let values = try? url.resourceValues(forKeys: [.fileAllocatedSizeKey, .totalFileAllocatedSizeKey]),
           let size = values.totalFileAllocatedSize ?? values.fileAllocatedSize {
            return Int64(size)
        }
        if let enumerator = fileManager.enumerator(at: url, includingPropertiesForKeys: [.fileAllocatedSizeKey]) {
            return enumerator.compactMap { $0 as? URL }.reduce(0) { partial, child in
                partial + Int64((try? child.resourceValues(forKeys: [.fileAllocatedSizeKey]).fileAllocatedSize) ?? 0)
            }
        }
        return 0
    }

    private func pendingDownload(for task: URLSessionTask) -> PendingDownload? {
        guard let description = task.taskDescription,
              let data = Data(base64Encoded: description) else { return nil }
        return try? JSONDecoder().decode(PendingDownload.self, from: data)
    }

    private func mediaDirectory() -> URL? {
        guard let scope = loadedScope else { return nil }
        return mediaDirectory(for: scope)
    }

    private func mediaDirectory(for scope: String) -> URL? {
        guard let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let root = support.appendingPathComponent("BWChat/Media", isDirectory: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableRoot = root
        try? fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        try? mutableRoot.setResourceValues(values)
        return root.appendingPathComponent(Self.hashedFilename(scope), isDirectory: true)
    }

    private static func hashedFilename(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

extension MediaCacheManager: URLSessionDownloadDelegate {
    nonisolated func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        Task { @MainActor [weak self] in self?.finishDownload(task: downloadTask, temporaryURL: location) }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        Task { @MainActor [weak self] in
            guard let self, let pending = self.pendingDownload(for: task) else { return }
            if error == nil,
               pending.isHLS,
               let location = self.hlsLocations.removeValue(forKey: task.taskIdentifier) {
                self.finishDownload(task: task, temporaryURL: location)
            } else if error != nil {
                self.activeDownloadIDs.remove(pending.mediaID)
            }
        }
    }
}

extension MediaCacheManager: AVAssetDownloadDelegate {
    nonisolated func urlSession(
        _ session: URLSession,
        assetDownloadTask: AVAssetDownloadTask,
        willDownloadTo location: URL
    ) {
        Task { @MainActor [weak self] in self?.hlsLocations[assetDownloadTask.taskIdentifier] = location }
    }

    nonisolated func urlSession(
        _ session: URLSession,
        assetDownloadTask: AVAssetDownloadTask,
        didLoad timeRange: CMTimeRange,
        totalTimeRangesLoaded loadedTimeRanges: [NSValue],
        timeRangeExpectedToLoad: CMTimeRange
    ) {}

    nonisolated func urlSession(
        _ session: URLSession,
        assetDownloadTask: AVAssetDownloadTask,
        didResolve resolvedMediaSelection: AVMediaSelection
    ) {}

}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
