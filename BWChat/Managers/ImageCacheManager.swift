// BWChat/Managers/ImageCacheManager.swift
// Two-tier image cache: in-memory (NSCache) + disk (Caches directory)

import SwiftUI
import UIKit
import AVFoundation
import Dispatch
import os.lock
import CryptoKit
import ImageIO

extension String {
    var chatMediaNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

struct ChatMediaPreviewRequest: Hashable, Sendable {
    let sourcePath: String
    let cacheKey: String
    let usesImageThumbnailEndpoint: Bool

    static func resolve(
        messageType: String,
        content: String,
        thumbnailURL: String?
    ) -> Self? {
        let normalizedType = MessageDeliveryMatcher.normalizedType(messageType)
        let normalizedContent = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedContent.isEmpty,
              MediaURLResolver.resolve(normalizedContent) != nil else { return nil }
        let explicitPreview = thumbnailURL?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .chatMediaNonEmpty
            .flatMap { MediaURLResolver.resolve($0) == nil ? nil : $0 }

        switch normalizedType {
        case "image":
            if let explicitPreview {
                return Self(
                    sourcePath: explicitPreview,
                    cacheKey: explicitPreview,
                    usesImageThumbnailEndpoint: false
                )
            }
            return Self(
                sourcePath: normalizedContent,
                cacheKey: normalizedContent + "?thumb=1",
                usesImageThumbnailEndpoint: true
            )
        case "video":
            if let explicitPreview {
                return Self(
                    sourcePath: explicitPreview,
                    cacheKey: explicitPreview,
                    usesImageThumbnailEndpoint: false
                )
            }
            let thumbnailPath = ImageCacheManager.videoThumbnailCacheKey(
                for: normalizedContent
            )
            return Self(
                sourcePath: thumbnailPath,
                cacheKey: thumbnailPath,
                usesImageThumbnailEndpoint: false
            )
        default:
            return nil
        }
    }

    static func resolve(messageType: String, content: String) -> Self? {
        resolve(
            messageType: messageType,
            content: content,
            thumbnailURL: nil
        )
    }
}

/// Starts media work when a message enters the data layer, before SwiftUI
/// creates its bubble. ImageCacheManager still owns request coalescing and the
/// memory/disk tiers, so the eventual bubble joins the same in-flight load.
enum ChatMediaPreviewPreloader {
    static let presentationBudgetNanoseconds: UInt64 = 450_000_000
    private static let pollIntervalNanoseconds: UInt64 = 20_000_000

    static func schedule(_ requests: [ChatMediaPreviewRequest], limit: Int = 8) {
        for request in uniqueTail(requests, limit: limit) {
            Task(priority: .utility) {
                await preload(request)
            }
        }
    }

    static func preloadBeforePresentation(
        _ requests: [ChatMediaPreviewRequest],
        limit: Int = 6,
        maxWaitNanoseconds: UInt64 = presentationBudgetNanoseconds
    ) async {
        let selected = uniqueTail(requests, limit: limit)
        guard !selected.isEmpty else { return }

        for request in selected where !isCached(request) {
            Task(priority: .userInitiated) {
                await preload(request)
            }
        }

        let start = DispatchTime.now().uptimeNanoseconds
        while !selected.allSatisfy(isCached) {
            guard !Task.isCancelled else { return }
            let elapsed = DispatchTime.now().uptimeNanoseconds - start
            guard elapsed < maxWaitNanoseconds else { return }
            try? await Task.sleep(nanoseconds: min(
                pollIntervalNanoseconds,
                maxWaitNanoseconds - elapsed
            ))
        }
    }

    static func isCached(_ request: ChatMediaPreviewRequest) -> Bool {
        ImageCacheManager.shared.image(for: request.cacheKey) != nil
    }

    private static func preload(_ request: ChatMediaPreviewRequest) async {
        _ = await ImageCacheManager.shared.loadImage(
            from: request.sourcePath,
            thumbnail: request.usesImageThumbnailEndpoint
        )
    }

    private static func uniqueTail(
        _ requests: [ChatMediaPreviewRequest],
        limit: Int
    ) -> [ChatMediaPreviewRequest] {
        guard limit > 0 else { return [] }
        var seen = Set<ChatMediaPreviewRequest>()
        let uniqueRequests = requests.reversed().filter {
            seen.insert($0).inserted
        }
        return Array(uniqueRequests.prefix(limit).reversed())
    }
}

/// Non-main-actor so disk reads and image decoding don't block the UI
/// thread — previously the whole class was @MainActor, which meant
/// `Data(contentsOf:)` and `UIImage(data:)` ran on main and caused
/// visible scroll jank in the Moments feed. NSCache is already
/// thread-safe; we guard only the loadingTasks dictionary with a
/// lock. We use `OSAllocatedUnfairLock` (not `NSLock`) because in
/// Swift 6 `NSLock.lock()/unlock()` is unavailable in async contexts;
/// the closure-based `withLock` is safe to call from inside async
/// functions and enforces that we don't hold the lock across
/// suspensions.
final class ImageCacheManager: @unchecked Sendable {
    static let shared = ImageCacheManager()

    private let memoryCache = NSCache<NSString, UIImage>()
    private let loadingTasks = OSAllocatedUnfairLock<[String: Task<UIImage?, Never>]>(initialState: [:])
    private let decodeSemaphore = DispatchSemaphore(value: 3)
    private let diskCacheURL: URL

    private init() {
        memoryCache.countLimit = 200
        memoryCache.totalCostLimit = 80 * 1024 * 1024 // 80 MB

        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        diskCacheURL = caches.appendingPathComponent("ImageCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: diskCacheURL, withIntermediateDirectories: true)
    }

    // MARK: - Public API

    func image(for url: String) -> UIImage? {
        memoryCache.object(forKey: url as NSString)
    }

    func setImage(_ image: UIImage, for url: String) {
        memoryCache.setObject(image, forKey: url as NSString, cost: Self.decodedCost(of: image))
    }

    /// Decodes a just-selected photo away from the main actor and places the
    /// prepared pixels in the memory cache before its optimistic row exists.
    /// The first rendered frame therefore contains the photo rather than a
    /// placeholder that changes size a moment later.
    func prepareLocalPreview(data: Data, for cacheKey: String) async {
        await Task.detached(priority: .userInitiated) { [weak self] in
            guard let self,
                  let prepared = self.decodeWithLimit(data: data, maxPixelSize: 720) else { return }
            self.memoryCache.setObject(
                prepared,
                forKey: cacheKey as NSString,
                cost: Self.decodedCost(of: prepared)
            )
        }.value
    }

    /// Seeds both cache tiers from a file that the user just uploaded, so the
    /// confirmed row never downloads the same image again.
    func adoptLocalFile(
        _ localURL: URL,
        for remoteURL: String,
        previewURL: String? = nil
    ) async {
        let diskCacheURL = self.diskCacheURL
        await Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            guard let data = try? Data(contentsOf: localURL),
                  let original = self.decodeWithLimit(data: data, maxPixelSize: 2048),
                  let thumbnail = self.decodeWithLimit(data: data, maxPixelSize: 720) else { return }

            // Chat bubbles request the thumbnail cache key while image preview
            // requests the original key. Seed both before replacing the local
            // pending row with the server-confirmed row; otherwise the first
            // confirmed render briefly falls back to its network-loading UI.
            var imagesByKey = [
                remoteURL: original,
                remoteURL + "?thumb=1": thumbnail
            ]
            if let previewURL = previewURL?.chatMediaNonEmpty {
                imagesByKey[previewURL] = thumbnail
            }
            for (key, image) in imagesByKey {
                self.memoryCache.setObject(
                    image,
                    forKey: key as NSString,
                    cost: Self.decodedCost(of: image)
                )
                let destination = Self.diskFileURL(in: diskCacheURL, for: key)
                try? data.write(to: destination, options: .atomic)
            }
        }.value
    }

    /// Seeds the exact thumbnail key used by chat video rows from the local
    /// video. This runs before an optimistic row is confirmed, so changing
    /// from a file URL to the server URL never produces a placeholder frame.
    func adoptLocalVideoThumbnail(
        _ localURL: URL,
        for remoteVideoURL: String,
        thumbnailURL: String? = nil
    ) async {
        let cacheKey = thumbnailURL?.chatMediaNonEmpty
            ?? Self.videoThumbnailCacheKey(for: remoteVideoURL)
        let diskCacheURL = self.diskCacheURL
        await Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            let asset = AVURLAsset(url: localURL)
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 600, height: 600)
            guard let cgImage = try? generator.copyCGImage(at: .zero, actualTime: nil) else { return }
            let image = UIImage(cgImage: cgImage)
            let cost = cgImage.bytesPerRow * cgImage.height
            self.memoryCache.setObject(image, forKey: cacheKey as NSString, cost: cost)
            guard let data = image.jpegData(compressionQuality: 0.82) else { return }
            let destination = Self.diskFileURL(in: diskCacheURL, for: cacheKey)
            try? data.write(to: destination, options: .atomic)
        }.value
    }

    static func videoThumbnailCacheKey(for videoURL: String) -> String {
        var path = videoURL
        if path.hasPrefix("/api/v1/images/") {
            path = path.replacingOccurrences(
                of: "/api/v1/images/",
                with: "/api/v1/public/images/"
            )
        }
        if let dotIndex = path.lastIndex(of: ".") {
            return String(path[path.startIndex..<dotIndex]) + "_thumb.jpg"
        }
        return path + "_thumb.jpg"
    }

    /// Chat bubbles prefer the server thumbnail endpoint, but older or
    /// partially deployed backends may only expose the original media URL.
    /// Keep the original as a second candidate so an unsupported `thumb=1`
    /// query cannot turn an otherwise valid incoming image into a placeholder.
    static func requestPaths(for urlPath: String, thumbnail: Bool) -> [String] {
        guard thumbnail else { return [urlPath] }

        let thumbnailPath: String
        if var components = URLComponents(string: urlPath) {
            var queryItems = components.queryItems ?? []
            queryItems.removeAll { $0.name.caseInsensitiveCompare("thumb") == .orderedSame }
            queryItems.append(URLQueryItem(name: "thumb", value: "1"))
            components.queryItems = queryItems
            thumbnailPath = components.string
                ?? urlPath + (urlPath.contains("?") ? "&thumb=1" : "?thumb=1")
        } else {
            thumbnailPath = urlPath + (urlPath.contains("?") ? "&thumb=1" : "?thumb=1")
        }

        return thumbnailPath == urlPath ? [urlPath] : [thumbnailPath, urlPath]
    }

    func loadImage(from urlPath: String, thumbnail: Bool = false) async -> UIImage? {
        let cacheKey = thumbnail ? urlPath + "?thumb=1" : urlPath
        let requestPaths = Self.requestPaths(for: urlPath, thumbnail: thumbnail)

        // 1. Memory cache (synchronous, already decoded) — fast path
        if let cached = memoryCache.object(forKey: cacheKey as NSString) {
            return cached
        }

        // 2. Get-or-create the in-flight Task inside the lock so two
        //    concurrent callers end up awaiting the same Task rather
        //    than racing two network loads for the same key.
        let diskCacheURL = self.diskCacheURL
        let maxPixelSize: CGFloat = thumbnail ? 720 : 2048
        let task: Task<UIImage?, Never> = loadingTasks.withLock { tasks in
            if let existing = tasks[cacheKey] {
                return existing
            }
            let newTask = Task.detached(priority: .userInitiated) { [weak self] () -> UIImage? in
                guard let self else { return nil }
                if let localURL = URL(string: urlPath), localURL.isFileURL,
                   let data = try? Data(contentsOf: localURL),
                   let prepared = self.decodeWithLimit(data: data, maxPixelSize: maxPixelSize) {
                    self.memoryCache.setObject(
                        prepared,
                        forKey: cacheKey as NSString,
                        cost: Self.decodedCost(of: prepared)
                    )
                    return prepared
                }
                // 2a. Disk cache — read + decode OFF the main thread
                let diskURL = Self.diskFileURL(in: diskCacheURL, for: cacheKey)
                if let data = try? Data(contentsOf: diskURL),
                   let prepared = self.decodeWithLimit(data: data, maxPixelSize: maxPixelSize) {
                    self.memoryCache.setObject(
                        prepared,
                        forKey: cacheKey as NSString,
                        cost: Self.decodedCost(of: prepared)
                    )
                    return prepared
                }

                // 2b. Network — decode OFF the main thread too. Try the
                // thumbnail first, then the original path when the thumbnail
                // route is missing, rejects the query, or returns non-image
                // data. A 404 for both candidates still requires a backend fix.
                var lastFailure: String?
                for requestPath in requestPaths {
                    guard !Task.isCancelled else { return nil }
                    do {
                        let data = try await APIService.shared.loadImage(path: requestPath)
                        guard let prepared = self.decodeWithLimit(
                            data: data,
                            maxPixelSize: maxPixelSize
                        ) else {
                            lastFailure = "response was not a decodable image"
                            continue
                        }
                        self.memoryCache.setObject(
                            prepared,
                            forKey: cacheKey as NSString,
                            cost: Self.decodedCost(of: prepared)
                        )
                        self.saveToDisk(data: data, urlPath: cacheKey)
                        return prepared
                    } catch is CancellationError {
                        return nil
                    } catch {
                        lastFailure = error.localizedDescription
                    }
                }
                #if DEBUG
                let diagnosticPath = MediaURLResolver.resolve(urlPath)?.path ?? "<invalid-media-path>"
                print(
                    "[ImageCache] Failed all image candidates path=\(diagnosticPath) "
                        + "attempts=\(requestPaths.count) reason=\(lastFailure ?? "unknown")"
                )
                #endif
                return nil
            }
            tasks[cacheKey] = newTask
            return newTask
        }

        let result = await task.value

        _ = loadingTasks.withLock { tasks in
            tasks.removeValue(forKey: cacheKey)
        }

        return result
    }

    func clearCache() {
        memoryCache.removeAllObjects()
        loadingTasks.withLock { tasks in
            tasks.values.forEach { $0.cancel() }
            tasks.removeAll()
        }
        try? FileManager.default.removeItem(at: diskCacheURL)
        try? FileManager.default.createDirectory(at: diskCacheURL, withIntermediateDirectories: true)
    }

    func removeImage(for urlPath: String) {
        memoryCache.removeObject(forKey: urlPath as NSString)
        _ = loadingTasks.withLock { tasks in
            tasks.removeValue(forKey: urlPath)
        }
        let fileURL = Self.diskFileURL(in: diskCacheURL, for: urlPath)
        try? FileManager.default.removeItem(at: fileURL)
    }

    /// Batch-remove cached media for a list of server URL paths.
    /// Also removes derived video thumbnail caches.
    func removeImages(for urlPaths: [String]) {
        for urlPath in urlPaths {
            removeImage(for: urlPath)
            // Also remove the video thumbnail derived from this URL
            if let dotIndex = urlPath.lastIndex(of: ".") {
                let thumbPath = urlPath
                    .replacingOccurrences(of: "/api/v1/images/", with: "/api/v1/public/images/")
                let thumbURL = String(thumbPath[thumbPath.startIndex..<dotIndex]) + "_thumb.jpg"
                removeImage(for: thumbURL)
            }
        }
    }

    func removeMomentMediaCaches(for moment: Moment) {
        var paths = Set(moment.images.filter { !$0.isEmpty })
        for media in moment.media {
            if !media.url.isEmpty {
                paths.insert(media.url)
            }
            if let thumbnailURL = media.thumbnailURL, !thumbnailURL.isEmpty {
                paths.insert(thumbnailURL)
            }
            if let lockedPreviewURL = media.lockedPreviewURL, !lockedPreviewURL.isEmpty {
                paths.insert(lockedPreviewURL)
            }
        }

        for path in paths {
            removeImage(for: path)
            removeImage(for: path + "?thumb=1")
        }
    }

    // MARK: - Disk Helpers

    private static func diskFileURL(in baseURL: URL, for urlPath: String) -> URL {
        let normalized = urlPath.trimmingCharacters(in: .whitespacesAndNewlines)
        let digest = SHA256.hash(data: Data(normalized.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return baseURL.appendingPathComponent(digest)
    }

    private func saveToDisk(data: Data, urlPath: String) {
        let fileURL = Self.diskFileURL(in: diskCacheURL, for: urlPath)
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Decode Data into a UIImage AND force-render its bitmap off the
    /// main thread. Without `preparingForDisplay()`, UIImage defers
    /// decoding until the image is first drawn on-screen — which lands
    /// on the main thread during scrolling and causes visible hitches.
    private static func decodeAndPrepare(data: Data, maxPixelSize: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, Int(maxPixelSize)),
            kCGImageSourceShouldCacheImmediately: true
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(
            source,
            0,
            options as CFDictionary
        ) else { return nil }
        let image = UIImage(cgImage: cgImage)
        if #available(iOS 15.0, *) {
            return image.preparingForDisplay() ?? image
        }
        return image
    }

    private func decodeWithLimit(data: Data, maxPixelSize: CGFloat) -> UIImage? {
        decodeSemaphore.wait()
        defer { decodeSemaphore.signal() }
        return Self.decodeAndPrepare(data: data, maxPixelSize: maxPixelSize)
    }

    private static func decodedCost(of image: UIImage) -> Int {
        guard let cgImage = image.cgImage else {
            return Int(image.size.width * image.scale * image.size.height * image.scale * 4)
        }
        return cgImage.bytesPerRow * cgImage.height
    }
}
