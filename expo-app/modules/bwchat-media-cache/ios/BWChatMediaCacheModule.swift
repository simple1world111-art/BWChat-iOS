import AVFoundation
import CryptoKit
import ExpoModulesCore
import Foundation
import UIKit

public final class BWChatMediaCacheModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BWChatMediaCache")

    OnCreate {
      Task { @MainActor in
        BWChatMediaCacheStore.shared.restoreBackgroundTasks()
      }
    }

    AsyncFunction("getCachedUriAsync") { (ownerID: String, mediaID: String) async -> String? in
      await BWChatMediaCacheStore.shared.cachedURI(ownerID: ownerID, mediaID: mediaID)
    }

    AsyncFunction("startCacheAsync") {
      (
        ownerID: String,
        mediaID: String,
        remoteURL: URL,
        authorizationHeaders: [String: String]?
      ) async -> Bool in
      await BWChatMediaCacheStore.shared.startCache(
        ownerID: ownerID,
        mediaID: mediaID,
        remoteURL: remoteURL,
        authorizationHeaders: authorizationHeaders
      )
    }

    AsyncFunction("adoptLocalFileAsync") {
      (ownerID: String, mediaID: String, remoteURL: String, sourceURL: URL) async -> String? in
      await BWChatMediaCacheStore.shared.adoptLocalFile(
        ownerID: ownerID,
        mediaID: mediaID,
        remoteURL: remoteURL,
        sourceURL: sourceURL
      )
    }

    AsyncFunction("usageBytesAsync") { (ownerID: String) async -> Int64 in
      await BWChatMediaCacheStore.shared.usageBytes(ownerID: ownerID)
    }

    AsyncFunction("clearAccountAsync") { (ownerID: String) async in
      await BWChatMediaCacheStore.shared.clearAccount(ownerID: ownerID)
    }

    AsyncFunction("clearAllAsync") { () async in
      await BWChatMediaCacheStore.shared.clearAll()
    }
  }
}

public final class BWChatMediaCacheAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public typealias CompletionHandler = () -> Void

  private var completionHandlers: [String: CompletionHandler] = [:]

  public func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping CompletionHandler
  ) {
    completionHandlers[identifier] = completionHandler
    Task { @MainActor in
      BWChatMediaCacheStore.shared.restoreBackgroundTasks()
    }
  }

  fileprivate func invokeCompletionHandler(for identifier: String) {
    guard let completionHandler = completionHandlers.removeValue(forKey: identifier) else {
      return
    }
    DispatchQueue.main.async {
      completionHandler()
    }
  }
}

@MainActor
private final class BWChatMediaCacheStore: NSObject {
  static let shared = BWChatMediaCacheStore()

  private struct Entry: Codable {
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
    let ownerID: String
    let isHLS: Bool
  }

  private let fileManager = FileManager.default
  private var loadedEntries: [String: [String: Entry]] = [:]
  private var activeDownloadKeys = Set<String>()
  private var hlsLocations: [Int: URL] = [:]
  private var didRestoreBackgroundTasks = false

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
    configuration.isDiscretionary = false
    return AVAssetDownloadURLSession(
      configuration: configuration,
      assetDownloadDelegate: self,
      delegateQueue: .main
    )
  }()

  func restoreBackgroundTasks() {
    guard !didRestoreBackgroundTasks else { return }
    didRestoreBackgroundTasks = true
    restoreTasks(in: fileSession)
    restoreTasks(in: hlsSession)
  }

  func cachedURI(ownerID: String, mediaID: String) -> String? {
    let owner = ownerID.trimmingCharacters(in: .whitespacesAndNewlines)
    let id = mediaID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !owner.isEmpty, !id.isEmpty else { return nil }
    var entries = entries(ownerID: owner)
    guard var entry = entries[id] else { return nil }
    let url = accountDirectory(ownerID: owner, create: false).appendingPathComponent(entry.relativePath)
    guard fileManager.fileExists(atPath: url.path) else {
      entries[id] = nil
      saveEntries(entries, ownerID: owner)
      return nil
    }
    entry.lastAccessedAt = Date()
    entries[id] = entry
    saveEntries(entries, ownerID: owner)
    return url.absoluteString
  }

  func startCache(
    ownerID: String,
    mediaID: String,
    remoteURL: URL,
    authorizationHeaders: [String: String]?
  ) -> Bool {
    let owner = ownerID.trimmingCharacters(in: .whitespacesAndNewlines)
    let id = mediaID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !owner.isEmpty,
          !id.isEmpty,
          ["http", "https"].contains(remoteURL.scheme?.lowercased() ?? ""),
          entries(ownerID: owner)[id] == nil,
          !activeDownloadKeys.contains(flightKey(ownerID: owner, mediaID: id)),
          canStartDownload(ownerID: owner) else {
      return false
    }

    let isHLS = Self.isHLS(remoteURL)
    let pending = PendingDownload(
      mediaID: id,
      remoteURL: remoteURL.absoluteString,
      ownerID: owner,
      isHLS: isHLS
    )
    guard let taskDescription = try? JSONEncoder().encode(pending).base64EncodedString() else {
      return false
    }

    activeDownloadKeys.insert(flightKey(ownerID: owner, mediaID: id))
    if isHLS {
      let options: [String: Any]? = authorizationHeaders.map {
        ["AVURLAssetHTTPHeaderFieldsKey": $0]
      }
      let asset = AVURLAsset(url: remoteURL, options: options)
      guard let task = hlsSession.makeAssetDownloadTask(
        asset: asset,
        assetTitle: id,
        assetArtworkData: nil,
        options: nil
      ) else {
        activeDownloadKeys.remove(flightKey(ownerID: owner, mediaID: id))
        return false
      }
      task.taskDescription = taskDescription
      task.resume()
      return true
    }

    var request = URLRequest(url: remoteURL)
    authorizationHeaders?.forEach { key, value in
      request.setValue(value, forHTTPHeaderField: key)
    }
    let task = fileSession.downloadTask(with: request)
    task.taskDescription = taskDescription
    task.resume()
    return true
  }

  func adoptLocalFile(
    ownerID: String,
    mediaID: String,
    remoteURL: String,
    sourceURL: URL
  ) -> String? {
    let owner = ownerID.trimmingCharacters(in: .whitespacesAndNewlines)
    let id = mediaID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !owner.isEmpty, !id.isEmpty, sourceURL.isFileURL,
          fileManager.fileExists(atPath: sourceURL.path) else {
      return nil
    }
    let directory = accountDirectory(ownerID: owner, create: true)
    let ext = sourceURL.pathExtension.nonEmpty ?? "mp4"
    let filename = Self.hashedFilename(id) + "." + ext
    let destination = directory.appendingPathComponent(filename)
    try? fileManager.removeItem(at: destination)
    do {
      try fileManager.copyItem(at: sourceURL, to: destination)
      applyFileProtection(to: destination)
      let now = Date()
      var entries = entries(ownerID: owner)
      entries[id] = Entry(
        id: id,
        remoteURL: remoteURL,
        relativePath: filename,
        isHLS: false,
        byteCount: allocatedSize(of: destination),
        createdAt: now,
        lastAccessedAt: now
      )
      prune(&entries, ownerID: owner, now: now)
      saveEntries(entries, ownerID: owner)
      return destination.absoluteString
    } catch {
      try? fileManager.removeItem(at: destination)
      return nil
    }
  }

  func usageBytes(ownerID: String) -> Int64 {
    let owner = ownerID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !owner.isEmpty else { return 0 }
    var entries = entries(ownerID: owner)
    let directory = accountDirectory(ownerID: owner, create: false)
    entries = entries.filter {
      fileManager.fileExists(atPath: directory.appendingPathComponent($0.value.relativePath).path)
    }
    saveEntries(entries, ownerID: owner)
    return entries.values.reduce(0) { $0 + max($1.byteCount, 0) }
  }

  func clearAccount(ownerID: String) {
    let owner = ownerID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !owner.isEmpty else { return }
    try? fileManager.removeItem(at: accountDirectory(ownerID: owner, create: false))
    loadedEntries[owner] = [:]
  }

  func clearAll() {
    try? fileManager.removeItem(at: rootDirectory(create: false))
    loadedEntries.removeAll()
  }

  private func restoreTasks(in session: URLSession) {
    session.getAllTasks { [weak self] tasks in
      Task { @MainActor in
        guard let self else { return }
        for task in tasks {
          guard let pending = self.pendingDownload(for: task) else { continue }
          self.activeDownloadKeys.insert(
            self.flightKey(ownerID: pending.ownerID, mediaID: pending.mediaID)
          )
        }
      }
    }
  }

  private func finishDownload(task: URLSessionTask, temporaryURL: URL) {
    guard let pending = pendingDownload(for: task) else { return }
    let directory = accountDirectory(ownerID: pending.ownerID, create: true)
    let remoteExtension = URL(string: pending.remoteURL)?.pathExtension.nonEmpty
    let ext = pending.isHLS ? "movpkg" : (remoteExtension ?? "mp4")
    let filename = Self.hashedFilename(pending.mediaID) + "." + ext
    let destination = directory.appendingPathComponent(filename)
    try? fileManager.removeItem(at: destination)
    do {
      try fileManager.moveItem(at: temporaryURL, to: destination)
      applyFileProtection(to: destination)
      let now = Date()
      var entries = entries(ownerID: pending.ownerID)
      entries[pending.mediaID] = Entry(
        id: pending.mediaID,
        remoteURL: pending.remoteURL,
        relativePath: filename,
        isHLS: pending.isHLS,
        byteCount: allocatedSize(of: destination),
        createdAt: now,
        lastAccessedAt: now
      )
      prune(&entries, ownerID: pending.ownerID, now: now)
      saveEntries(entries, ownerID: pending.ownerID)
    } catch {
      try? fileManager.removeItem(at: temporaryURL)
    }
    activeDownloadKeys.remove(
      flightKey(ownerID: pending.ownerID, mediaID: pending.mediaID)
    )
  }

  private func entries(ownerID: String) -> [String: Entry] {
    if let entries = loadedEntries[ownerID] { return entries }
    let index = indexURL(ownerID: ownerID)
    let decoded: [Entry]
    if let data = try? Data(contentsOf: index),
       let stored = try? JSONDecoder().decode([Entry].self, from: data) {
      decoded = stored
    } else {
      decoded = []
    }
    let entries = Dictionary(uniqueKeysWithValues: decoded.map { ($0.id, $0) })
    loadedEntries[ownerID] = entries
    return entries
  }

  private func saveEntries(_ entries: [String: Entry], ownerID: String) {
    loadedEntries[ownerID] = entries
    let directory = accountDirectory(ownerID: ownerID, create: true)
    let index = directory.appendingPathComponent("index.json")
    guard let data = try? JSONEncoder().encode(entries.values.sorted { $0.id < $1.id }) else {
      return
    }
    try? data.write(to: index, options: .atomic)
    applyFileProtection(to: index)
  }

  private func prune(_ entries: inout [String: Entry], ownerID: String, now: Date) {
    let directory = accountDirectory(ownerID: ownerID, create: true)
    let staleCutoff = now.addingTimeInterval(-30 * 24 * 60 * 60)
    for entry in Array(entries.values) where entry.lastAccessedAt < staleCutoff {
      try? fileManager.removeItem(at: directory.appendingPathComponent(entry.relativePath))
      entries[entry.id] = nil
    }

    var totalBytes = entries.values.reduce(0) { $0 + max($1.byteCount, 0) }
    let values = try? directory.resourceValues(
      forKeys: [.volumeAvailableCapacityForImportantUsageKey]
    )
    let available = Int64(values?.volumeAvailableCapacityForImportantUsage ?? 0)
    let adaptive = Int64(Double(max(available + totalBytes, 0)) * 0.15)
    let budget = min(
      5 * 1_024 * 1_024 * 1_024,
      max(512 * 1_024 * 1_024, adaptive)
    )
    for entry in entries.values.sorted(by: { $0.lastAccessedAt < $1.lastAccessedAt })
      where totalBytes > budget {
      try? fileManager.removeItem(at: directory.appendingPathComponent(entry.relativePath))
      entries[entry.id] = nil
      totalBytes -= max(entry.byteCount, 0)
    }
  }

  private func canStartDownload(ownerID: String) -> Bool {
    let directory = accountDirectory(ownerID: ownerID, create: true)
    let values = try? directory.resourceValues(
      forKeys: [.volumeAvailableCapacityForImportantUsageKey]
    )
    let available = Int64(values?.volumeAvailableCapacityForImportantUsage ?? 0)
    return available > 2 * 1_024 * 1_024 * 1_024
  }

  private func allocatedSize(of url: URL) -> Int64 {
    if let values = try? url.resourceValues(
      forKeys: [.fileAllocatedSizeKey, .totalFileAllocatedSizeKey]
    ), let size = values.totalFileAllocatedSize ?? values.fileAllocatedSize {
      return Int64(size)
    }
    guard let enumerator = fileManager.enumerator(
      at: url,
      includingPropertiesForKeys: [.fileAllocatedSizeKey]
    ) else {
      return 0
    }
    return enumerator.compactMap { $0 as? URL }.reduce(0) { partial, child in
      partial + Int64(
        (try? child.resourceValues(forKeys: [.fileAllocatedSizeKey]).fileAllocatedSize) ?? 0
      )
    }
  }

  private func applyFileProtection(to url: URL) {
    try? fileManager.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
      ofItemAtPath: url.path
    )
  }

  private func pendingDownload(for task: URLSessionTask) -> PendingDownload? {
    guard let description = task.taskDescription,
          let data = Data(base64Encoded: description) else {
      return nil
    }
    return try? JSONDecoder().decode(PendingDownload.self, from: data)
  }

  private func indexURL(ownerID: String) -> URL {
    accountDirectory(ownerID: ownerID, create: false).appendingPathComponent("index.json")
  }

  private func accountDirectory(ownerID: String, create: Bool) -> URL {
    let directory = rootDirectory(create: create).appendingPathComponent(
      Self.hashedFilename("account:\(ownerID)"),
      isDirectory: true
    )
    if create {
      try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
      excludeFromBackup(directory)
    }
    return directory
  }

  private func rootDirectory(create: Bool) -> URL {
    let support = fileManager.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first!
    let root = support.appendingPathComponent("BWChat/Media", isDirectory: true)
    if create {
      try? fileManager.createDirectory(at: root, withIntermediateDirectories: true)
      excludeFromBackup(root)
    }
    return root
  }

  private func excludeFromBackup(_ url: URL) {
    var mutableURL = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? mutableURL.setResourceValues(values)
  }

  private func flightKey(ownerID: String, mediaID: String) -> String {
    ownerID + "\u{0}" + mediaID
  }

  private static func isHLS(_ url: URL) -> Bool {
    url.pathExtension.lowercased() == "m3u8" ||
      url.absoluteString.lowercased().contains(".m3u8")
  }

  private static func hashedFilename(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}

extension BWChatMediaCacheStore: URLSessionDownloadDelegate {
  nonisolated func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    Task { @MainActor [weak self] in
      self?.finishDownload(task: downloadTask, temporaryURL: location)
    }
  }

  nonisolated func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    Task { @MainActor [weak self] in
      guard let self, let pending = self.pendingDownload(for: task) else { return }
      if error == nil,
         pending.isHLS,
         let location = self.hlsLocations.removeValue(forKey: task.taskIdentifier) {
        self.finishDownload(task: task, temporaryURL: location)
      } else if error != nil {
        self.activeDownloadKeys.remove(
          self.flightKey(ownerID: pending.ownerID, mediaID: pending.mediaID)
        )
      }
    }
  }

  nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    guard let identifier = session.configuration.identifier else { return }
    Task { @MainActor in
      ExpoAppDelegateSubscriberRepository.getSubscriberOfType(
        BWChatMediaCacheAppDelegateSubscriber.self
      )?.invokeCompletionHandler(for: identifier)
    }
  }
}

extension BWChatMediaCacheStore: AVAssetDownloadDelegate {
  nonisolated func urlSession(
    _ session: URLSession,
    assetDownloadTask: AVAssetDownloadTask,
    willDownloadTo location: URL
  ) {
    Task { @MainActor [weak self] in
      self?.hlsLocations[assetDownloadTask.taskIdentifier] = location
    }
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
