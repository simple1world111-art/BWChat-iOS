import CryptoKit
import ExpoModulesCore
import Foundation
import UIKit

public final class BWChatBackgroundUploadModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BWChatBackgroundUpload")

    OnCreate {
      Task { @MainActor in
        BWChatBackgroundUploadStore.shared.restoreBackgroundTasks()
      }
    }

    AsyncFunction("enqueueEpisodeAsync") { (payloadJSON: String) async throws -> String in
      try await BWChatBackgroundUploadStore.shared.enqueueEpisode(payloadJSON: payloadJSON)
    }

    AsyncFunction("getEpisodeTaskAsync") {
      (ownerID: String, jobID: String, episodeID: String) async -> String? in
      await BWChatBackgroundUploadStore.shared.encodedRecord(
        ownerID: ownerID,
        jobID: jobID,
        episodeID: episodeID
      )
    }

    AsyncFunction("markConfirmationUnknownAsync") {
      (
        ownerID: String,
        jobID: String,
        episodeID: String,
        errorCode: String
      ) async -> String? in
      await BWChatBackgroundUploadStore.shared.markConfirmationUnknown(
        ownerID: ownerID,
        jobID: jobID,
        episodeID: episodeID,
        errorCode: errorCode
      )
    }

    AsyncFunction("cancelJobAsync") { (ownerID: String, jobID: String) async in
      await BWChatBackgroundUploadStore.shared.cancelJob(ownerID: ownerID, jobID: jobID)
    }

    AsyncFunction("removeEpisodeTaskAsync") {
      (ownerID: String, jobID: String, episodeID: String) async in
      await BWChatBackgroundUploadStore.shared.removeEpisode(
        ownerID: ownerID,
        jobID: jobID,
        episodeID: episodeID
      )
    }

    AsyncFunction("removeJobAsync") { (ownerID: String, jobID: String) async in
      await BWChatBackgroundUploadStore.shared.removeJob(ownerID: ownerID, jobID: jobID)
    }
  }
}

public final class BWChatBackgroundUploadAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public typealias CompletionHandler = () -> Void

  private var completionHandlers: [String: CompletionHandler] = [:]

  public func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping CompletionHandler
  ) {
    guard BWChatBackgroundUploadStore.isSessionIdentifier(identifier) else {
      completionHandler()
      return
    }
    completionHandlers[identifier] = completionHandler
    Task { @MainActor in
      BWChatBackgroundUploadStore.shared.restoreBackgroundTasks()
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

private enum BWChatBackgroundUploadState: String, Codable {
  case preparing
  case uploading
  case succeeded
  case retryWaiting = "retry_waiting"
  case confirmationUnknown = "confirmation_unknown"
  case failedPermanent = "failed_permanent"
  case cancelled
}

private struct BWChatEpisodeUploadInput: Codable, Sendable {
  let ownerID: String
  let jobID: String
  let episodeID: String
  let generation: Int
  let requestURL: String
  let authorization: String
  let title: String
  let intro: String
  let episodeNumber: Int
  let unlockPriceGoldCoins: Int
  let videoURI: String
  let videoFilename: String
  let videoMIMEType: String
  let coverURI: String
  let coverFilename: String

  enum CodingKeys: String, CodingKey {
    case ownerID = "owner_id"
    case jobID = "job_id"
    case episodeID = "episode_id"
    case generation
    case requestURL = "request_url"
    case authorization
    case title
    case intro
    case episodeNumber = "episode_number"
    case unlockPriceGoldCoins = "unlock_price_gold_coins"
    case videoURI = "video_uri"
    case videoFilename = "video_filename"
    case videoMIMEType = "video_mime_type"
    case coverURI = "cover_uri"
    case coverFilename = "cover_filename"
  }
}

private struct BWChatBackgroundUploadIdentity: Codable, Sendable {
  let recordID: String
  let ownerID: String
  let jobID: String
  let episodeID: String
  let generation: Int

  enum CodingKeys: String, CodingKey {
    case recordID = "record_id"
    case ownerID = "owner_id"
    case jobID = "job_id"
    case episodeID = "episode_id"
    case generation
  }
}

private struct BWChatBackgroundUploadRecord: Codable, Sendable {
  let id: String
  let ownerID: String
  let jobID: String
  let episodeID: String
  var generation: Int
  var state: BWChatBackgroundUploadState
  var taskIdentifier: Int?
  var uploadedBytes: Int64
  var expectedBytes: Int64
  var httpStatus: Int?
  var responseBodyBase64: String?
  var lastErrorCode: String?
  var bodyRelativePath: String?
  var updatedAt: Double

  enum CodingKeys: String, CodingKey {
    case id
    case ownerID = "owner_id"
    case jobID = "job_id"
    case episodeID = "episode_id"
    case generation
    case state
    case taskIdentifier = "task_identifier"
    case uploadedBytes = "uploaded_bytes"
    case expectedBytes = "expected_bytes"
    case httpStatus = "http_status"
    case responseBodyBase64 = "response_body_base64"
    case lastErrorCode = "last_error_code"
    case bodyRelativePath = "body_relative_path"
    case updatedAt = "updated_at"
  }
}

@MainActor
private final class BWChatBackgroundUploadStore: NSObject {
  static let shared = BWChatBackgroundUploadStore()

  private static let sessionSuffix = ".short-drama.background-upload"
  private let fileManager = FileManager.default
  private var records: [String: BWChatBackgroundUploadRecord] = [:]
  private var responseData: [Int: Data] = [:]
  private var didLoad = false
  private var didRequestTaskRestore = false

  private lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.background(
      withIdentifier: Self.sessionIdentifier
    )
    configuration.sessionSendsLaunchEvents = true
    configuration.isDiscretionary = false
    configuration.waitsForConnectivity = true
    configuration.allowsCellularAccess = true
    configuration.httpMaximumConnectionsPerHost = 2
    return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
  }()

  private override init() {
    super.init()
  }

  static var sessionIdentifier: String {
    (Bundle.main.bundleIdentifier ?? "com.bwchat.app") + sessionSuffix
  }

  static func isSessionIdentifier(_ value: String) -> Bool {
    value == sessionIdentifier
  }

  func restoreBackgroundTasks() {
    loadIfNeeded()
    _ = session
    guard !didRequestTaskRestore else { return }
    didRequestTaskRestore = true
    session.getAllTasks { [weak self] tasks in
      Task { @MainActor in
        self?.reconcileSystemTasks(tasks)
      }
    }
  }

  func enqueueEpisode(payloadJSON: String) async throws -> String {
    loadIfNeeded()
    let input = try JSONDecoder().decode(
      BWChatEpisodeUploadInput.self,
      from: Data(payloadJSON.utf8)
    )
    let ownerID = input.ownerID.trimmingCharacters(in: .whitespacesAndNewlines)
    let jobID = input.jobID.trimmingCharacters(in: .whitespacesAndNewlines)
    let episodeID = input.episodeID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !ownerID.isEmpty, !jobID.isEmpty, !episodeID.isEmpty,
          let requestURL = URL(string: input.requestURL),
          ["http", "https"].contains(requestURL.scheme?.lowercased() ?? ""),
          let videoURL = URL(string: input.videoURI), videoURL.isFileURL,
          let coverURL = URL(string: input.coverURI), coverURL.isFileURL,
          fileManager.fileExists(atPath: videoURL.path),
          fileManager.fileExists(atPath: coverURL.path) else {
      throw BWChatBackgroundUploadError.invalidInput
    }

    let recordID = Self.recordID(ownerID: ownerID, jobID: jobID, episodeID: episodeID)
    if let existing = records[recordID],
       [.preparing, .uploading, .succeeded].contains(existing.state) {
      return try encode(existing)
    }

    removeBody(records[recordID])
    let boundary = "BWChat-\(UUID().uuidString)"
    let bodyURL = try bodyURL(ownerID: ownerID, jobID: jobID, episodeID: episodeID)
    var record = BWChatBackgroundUploadRecord(
      id: recordID,
      ownerID: ownerID,
      jobID: jobID,
      episodeID: episodeID,
      generation: max(input.generation, 0),
      state: .preparing,
      taskIdentifier: nil,
      uploadedBytes: 0,
      expectedBytes: 0,
      httpStatus: nil,
      responseBodyBase64: nil,
      lastErrorCode: nil,
      bodyRelativePath: relativePath(bodyURL),
      updatedAt: Date().timeIntervalSince1970
    )
    records[recordID] = record
    persist()

    do {
      try await Task.detached(priority: .utility) {
        try BWChatShortDramaMultipartBuilder.build(
          input: input,
          videoURL: videoURL,
          coverURL: coverURL,
          destinationURL: bodyURL,
          boundary: boundary
        )
      }.value
    } catch {
      record.state = .failedPermanent
      record.lastErrorCode = "multipart-prepare-failed"
      record.updatedAt = Date().timeIntervalSince1970
      records[recordID] = record
      persist()
      throw error
    }

    let bodyBytes = (try? bodyURL.resourceValues(forKeys: [.fileSizeKey]).fileSize)
      .map(Int64.init) ?? 0
    var request = URLRequest(url: requestURL)
    request.httpMethod = "POST"
    request.timeoutInterval = 600
    request.setValue(
      "multipart/form-data; boundary=\(boundary)",
      forHTTPHeaderField: "Content-Type"
    )
    request.setValue(Self.safeHeader(input.jobID), forHTTPHeaderField: "Idempotency-Key")
    let authorization = input.authorization.trimmingCharacters(in: .whitespacesAndNewlines)
    if !authorization.isEmpty {
      request.setValue(Self.safeHeader(authorization), forHTTPHeaderField: "Authorization")
    }

    let identity = BWChatBackgroundUploadIdentity(
      recordID: recordID,
      ownerID: ownerID,
      jobID: jobID,
      episodeID: episodeID,
      generation: record.generation
    )
    let task = session.uploadTask(with: request, fromFile: bodyURL)
    task.taskDescription = try JSONEncoder().encode(identity).base64EncodedString()
    record.state = .uploading
    record.taskIdentifier = task.taskIdentifier
    record.expectedBytes = bodyBytes
    record.updatedAt = Date().timeIntervalSince1970
    records[recordID] = record
    responseData[task.taskIdentifier] = Data()
    persist()
    task.resume()
    return try encode(record)
  }

  func encodedRecord(ownerID: String, jobID: String, episodeID: String) -> String? {
    loadIfNeeded()
    guard let record = records[Self.recordID(
      ownerID: ownerID,
      jobID: jobID,
      episodeID: episodeID
    )] else { return nil }
    return try? encode(record)
  }

  func markConfirmationUnknown(
    ownerID: String,
    jobID: String,
    episodeID: String,
    errorCode: String
  ) -> String? {
    loadIfNeeded()
    let recordID = Self.recordID(ownerID: ownerID, jobID: jobID, episodeID: episodeID)
    guard var record = records[recordID] else { return nil }
    record.state = .confirmationUnknown
    record.lastErrorCode = errorCode
    record.updatedAt = Date().timeIntervalSince1970
    records[recordID] = record
    persist()
    return try? encode(record)
  }

  func cancelJob(ownerID: String, jobID: String) async {
    loadIfNeeded()
    let matching = records.values.filter { $0.ownerID == ownerID && $0.jobID == jobID }
    let identifiers = Set(matching.compactMap(\.taskIdentifier))
    let tasks = await allTasks()
    for task in tasks where identifiers.contains(task.taskIdentifier) {
      task.cancel()
    }
    for existing in matching {
      var record = existing
      record.state = .cancelled
      record.lastErrorCode = "cancelled"
      record.updatedAt = Date().timeIntervalSince1970
      records[record.id] = record
      removeBody(record)
    }
    persist()
  }

  func removeEpisode(ownerID: String, jobID: String, episodeID: String) {
    loadIfNeeded()
    let recordID = Self.recordID(ownerID: ownerID, jobID: jobID, episodeID: episodeID)
    guard let record = records.removeValue(forKey: recordID) else { return }
    removeBody(record)
    persist()
  }

  func removeJob(ownerID: String, jobID: String) {
    loadIfNeeded()
    let matching = records.values.filter { $0.ownerID == ownerID && $0.jobID == jobID }
    for record in matching {
      records.removeValue(forKey: record.id)
      removeBody(record)
    }
    if let directory = try? jobDirectory(ownerID: ownerID, jobID: jobID, create: false) {
      try? fileManager.removeItem(at: directory)
    }
    persist()
  }

  private func reconcileSystemTasks(_ tasks: [URLSessionTask]) {
    loadIfNeeded()
    var activeRecordIDs = Set<String>()
    for task in tasks {
      guard let identity = identity(for: task), var record = records[identity.recordID] else {
        task.cancel()
        continue
      }
      activeRecordIDs.insert(identity.recordID)
      record.state = .uploading
      record.taskIdentifier = task.taskIdentifier
      record.uploadedBytes = task.countOfBytesSent
      record.expectedBytes = max(record.expectedBytes, task.countOfBytesExpectedToSend)
      record.updatedAt = Date().timeIntervalSince1970
      records[record.id] = record
      responseData[task.taskIdentifier, default: Data()] = Data()
    }
    for existing in Array(records.values) where
      [.preparing, .uploading].contains(existing.state) && !activeRecordIDs.contains(existing.id) {
      var record = existing
      let fullySent = record.expectedBytes > 0 && record.uploadedBytes >= record.expectedBytes
      record.state = fullySent ? .confirmationUnknown : .retryWaiting
      record.lastErrorCode = fullySent
        ? "background-response-needs-reconciliation"
        : "background-session-disconnected"
      record.updatedAt = Date().timeIntervalSince1970
      records[record.id] = record
      removeBody(record)
    }
    persist()
  }

  private func finish(task: URLSessionTask, error: Error?) {
    guard let identity = identity(for: task), var record = records[identity.recordID] else {
      responseData.removeValue(forKey: task.taskIdentifier)
      return
    }
    let data = responseData.removeValue(forKey: task.taskIdentifier) ?? Data()
    record.uploadedBytes = task.countOfBytesSent
    record.expectedBytes = max(record.expectedBytes, task.countOfBytesExpectedToSend)
    record.responseBodyBase64 = data.isEmpty ? nil : data.base64EncodedString()
    record.updatedAt = Date().timeIntervalSince1970

    if let error {
      let nsError = error as NSError
      let wasCancelled = nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
      let fullySent = record.expectedBytes > 0 && record.uploadedBytes >= record.expectedBytes
      record.state = wasCancelled
        ? .cancelled
        : (fullySent ? .confirmationUnknown : .retryWaiting)
      record.lastErrorCode = "\(nsError.domain):\(nsError.code)"
    } else if let response = task.response as? HTTPURLResponse {
      record.httpStatus = response.statusCode
      if (200..<300).contains(response.statusCode) {
        record.state = .succeeded
        record.lastErrorCode = nil
      } else if Self.isTransientStatus(response.statusCode) {
        record.state = .retryWaiting
        record.lastErrorCode = "http:\(response.statusCode)"
      } else {
        record.state = .failedPermanent
        record.lastErrorCode = "http:\(response.statusCode)"
      }
    } else {
      record.state = .confirmationUnknown
      record.lastErrorCode = "missing-http-response"
    }
    records[record.id] = record
    removeBody(record)
    persist()
  }

  private func allTasks() async -> [URLSessionTask] {
    await withCheckedContinuation { continuation in
      session.getAllTasks { continuation.resume(returning: $0) }
    }
  }

  private func loadIfNeeded() {
    guard !didLoad else { return }
    didLoad = true
    guard let data = try? Data(contentsOf: indexURL(create: true)),
          let decoded = try? JSONDecoder().decode(
            [String: BWChatBackgroundUploadRecord].self,
            from: data
          ) else { return }
    records = decoded
  }

  private func persist() {
    guard let data = try? JSONEncoder().encode(records) else { return }
    let url = indexURL(create: true)
    try? data.write(to: url, options: .atomic)
    applyFileProtection(to: url)
  }

  private func encode(_ record: BWChatBackgroundUploadRecord) throws -> String {
    let data = try JSONEncoder().encode(record)
    guard let value = String(data: data, encoding: .utf8) else {
      throw BWChatBackgroundUploadError.encodingFailed
    }
    return value
  }

  private func identity(for task: URLSessionTask) -> BWChatBackgroundUploadIdentity? {
    guard let description = task.taskDescription,
          let data = Data(base64Encoded: description) else { return nil }
    return try? JSONDecoder().decode(BWChatBackgroundUploadIdentity.self, from: data)
  }

  private func bodyURL(ownerID: String, jobID: String, episodeID: String) throws -> URL {
    let directory = try jobDirectory(ownerID: ownerID, jobID: jobID, create: true)
    return directory.appendingPathComponent(
      "multipart-\(Self.sha256(episodeID)).body",
      isDirectory: false
    )
  }

  private func jobDirectory(ownerID: String, jobID: String, create: Bool) throws -> URL {
    let directory = rootDirectory(create: create)
      .appendingPathComponent(Self.sha256("owner:\(ownerID)"), isDirectory: true)
      .appendingPathComponent(Self.sha256("job:\(jobID)"), isDirectory: true)
    if create {
      try fileManager.createDirectory(
        at: directory,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
      )
      excludeFromBackup(directory)
    }
    return directory
  }

  private func indexURL(create: Bool) -> URL {
    rootDirectory(create: create).appendingPathComponent("index.json", isDirectory: false)
  }

  private func rootDirectory(create: Bool) -> URL {
    let support = fileManager.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first!
    let root = support.appendingPathComponent("BWChat/BackgroundUploads", isDirectory: true)
    if create {
      try? fileManager.createDirectory(
        at: root,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
      )
      excludeFromBackup(root)
    }
    return root
  }

  private func relativePath(_ url: URL) -> String {
    let root = rootDirectory(create: true).path + "/"
    return url.path.hasPrefix(root) ? String(url.path.dropFirst(root.count)) : ""
  }

  private func removeBody(_ record: BWChatBackgroundUploadRecord?) {
    guard let path = record?.bodyRelativePath, !path.isEmpty else { return }
    let url = rootDirectory(create: false).appendingPathComponent(path, isDirectory: false)
    try? fileManager.removeItem(at: url)
  }

  private func applyFileProtection(to url: URL) {
    try? fileManager.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
      ofItemAtPath: url.path
    )
  }

  private func excludeFromBackup(_ url: URL) {
    var mutableURL = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? mutableURL.setResourceValues(values)
  }

  private static func recordID(ownerID: String, jobID: String, episodeID: String) -> String {
    sha256([ownerID, jobID, episodeID].joined(separator: "\u{0}"))
  }

  private static func sha256(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private static func safeHeader(_ value: String) -> String {
    value.replacingOccurrences(of: "\r", with: "_")
      .replacingOccurrences(of: "\n", with: "_")
  }

  private static func isTransientStatus(_ status: Int) -> Bool {
    status == 408 || status == 425 || status == 429 || (500...599).contains(status)
  }
}

extension BWChatBackgroundUploadStore: URLSessionDataDelegate, URLSessionTaskDelegate {
  nonisolated func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive data: Data
  ) {
    Task { @MainActor [weak self] in
      self?.responseData[dataTask.taskIdentifier, default: Data()].append(data)
    }
  }

  nonisolated func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didSendBodyData bytesSent: Int64,
    totalBytesSent: Int64,
    totalBytesExpectedToSend: Int64
  ) {
    Task { @MainActor [weak self] in
      guard let self,
            let identity = self.identity(for: task),
            var record = self.records[identity.recordID] else { return }
      record.state = .uploading
      record.taskIdentifier = task.taskIdentifier
      record.uploadedBytes = totalBytesSent
      record.expectedBytes = max(record.expectedBytes, totalBytesExpectedToSend)
      record.updatedAt = Date().timeIntervalSince1970
      self.records[record.id] = record
      self.persist()
    }
  }

  nonisolated func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    Task { @MainActor [weak self] in
      self?.finish(task: task, error: error)
    }
  }

  nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    guard let identifier = session.configuration.identifier else { return }
    Task { @MainActor in
      ExpoAppDelegateSubscriberRepository.getSubscriberOfType(
        BWChatBackgroundUploadAppDelegateSubscriber.self
      )?.invokeCompletionHandler(for: identifier)
    }
  }
}

private enum BWChatShortDramaMultipartBuilder {
  static func build(
    input: BWChatEpisodeUploadInput,
    videoURL: URL,
    coverURL: URL,
    destinationURL: URL,
    boundary: String
  ) throws {
    FileManager.default.createFile(atPath: destinationURL.path, contents: nil)
    let output = try FileHandle(forWritingTo: destinationURL)
    defer { try? output.close() }

    let fields: [(String, String)] = [
      ("title", input.title),
      ("intro", input.intro),
      ("episode_number", String(input.episodeNumber)),
      ("client_episode_id", input.episodeID),
      ("client_series_id", input.jobID),
      (
        "unlock_price_gold_coins",
        String(min(max(input.unlockPriceGoldCoins, 0), 100))
      ),
    ]
    for (name, value) in fields {
      try write("--\(boundary)\r\n", to: output)
      try write(
        "Content-Disposition: form-data; name=\"\(safeHeader(name))\"\r\n\r\n",
        to: output
      )
      try write("\(value)\r\n", to: output)
    }
    try appendFile(
      name: "video",
      filename: input.videoFilename,
      mimeType: input.videoMIMEType,
      sourceURL: videoURL,
      output: output,
      boundary: boundary
    )
    try appendFile(
      name: "cover",
      filename: input.coverFilename,
      mimeType: "image/jpeg",
      sourceURL: coverURL,
      output: output,
      boundary: boundary
    )
    try write("--\(boundary)--\r\n", to: output)
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
      ofItemAtPath: destinationURL.path
    )
  }

  private static func appendFile(
    name: String,
    filename: String,
    mimeType: String,
    sourceURL: URL,
    output: FileHandle,
    boundary: String
  ) throws {
    try write("--\(boundary)\r\n", to: output)
    try write(
      "Content-Disposition: form-data; name=\"\(safeHeader(name))\"; filename=\"\(safeHeader(filename))\"\r\n",
      to: output
    )
    try write("Content-Type: \(safeHeader(mimeType))\r\n\r\n", to: output)
    let input = try FileHandle(forReadingFrom: sourceURL)
    defer { try? input.close() }
    while let chunk = try input.read(upToCount: 1_048_576), !chunk.isEmpty {
      try output.write(contentsOf: chunk)
    }
    try write("\r\n", to: output)
  }

  private static func write(_ string: String, to output: FileHandle) throws {
    guard let data = string.data(using: .utf8) else { return }
    try output.write(contentsOf: data)
  }

  private static func safeHeader(_ value: String) -> String {
    value.replacingOccurrences(of: "\r", with: "_")
      .replacingOccurrences(of: "\n", with: "_")
      .replacingOccurrences(of: "\"", with: "_")
  }
}

private enum BWChatBackgroundUploadError: Error {
  case invalidInput
  case encodingFailed
}
