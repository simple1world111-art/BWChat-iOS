// BWChat/Managers/ImageCacheManager.swift
// Two-tier image cache: in-memory (NSCache) + disk (Caches directory)

import SwiftUI
import UIKit
import os.lock

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
        memoryCache.setObject(image, forKey: url as NSString)
    }

    func loadImage(from urlPath: String, thumbnail: Bool = false) async -> UIImage? {
        let cacheKey = thumbnail ? urlPath + "?thumb=1" : urlPath
        let loadPath = thumbnail ? urlPath + (urlPath.contains("?") ? "&thumb=1" : "?thumb=1") : urlPath

        // 1. Memory cache (synchronous, already decoded) — fast path
        if let cached = memoryCache.object(forKey: cacheKey as NSString) {
            return cached
        }

        // 2. Get-or-create the in-flight Task inside the lock so two
        //    concurrent callers end up awaiting the same Task rather
        //    than racing two network loads for the same key.
        let memoryCache = self.memoryCache
        let diskCacheURL = self.diskCacheURL
        let task: Task<UIImage?, Never> = loadingTasks.withLock { tasks in
            if let existing = tasks[cacheKey] {
                return existing
            }
            let newTask = Task.detached(priority: .userInitiated) { [weak self] () -> UIImage? in
                // 2a. Disk cache — read + decode OFF the main thread
                let diskURL = Self.diskFileURL(in: diskCacheURL, for: cacheKey)
                if let data = try? Data(contentsOf: diskURL),
                   let prepared = Self.decodeAndPrepare(data: data) {
                    memoryCache.setObject(prepared, forKey: cacheKey as NSString, cost: data.count)
                    return prepared
                }

                // 2b. Network — decode OFF the main thread too
                do {
                    let data = try await APIService.shared.loadImage(path: loadPath)
                    if let prepared = Self.decodeAndPrepare(data: data) {
                        memoryCache.setObject(prepared, forKey: cacheKey as NSString, cost: data.count)
                        self?.saveToDisk(data: data, urlPath: cacheKey)
                        return prepared
                    }
                } catch {
                    print("[ImageCache] Failed to load image: \(error)")
                }
                return nil
            }
            tasks[cacheKey] = newTask
            return newTask
        }

        let result = await task.value

        loadingTasks.withLock { tasks in
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
        loadingTasks.withLock { tasks in
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

    // MARK: - Disk Helpers

    private static func diskFileURL(in baseURL: URL, for urlPath: String) -> URL {
        let safeFilename = urlPath
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        return baseURL.appendingPathComponent(safeFilename)
    }

    private func saveToDisk(data: Data, urlPath: String) {
        let fileURL = Self.diskFileURL(in: diskCacheURL, for: urlPath)
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Decode Data into a UIImage AND force-render its bitmap off the
    /// main thread. Without `preparingForDisplay()`, UIImage defers
    /// decoding until the image is first drawn on-screen — which lands
    /// on the main thread during scrolling and causes visible hitches.
    private static func decodeAndPrepare(data: Data) -> UIImage? {
        guard let image = UIImage(data: data) else { return nil }
        if #available(iOS 15.0, *) {
            return image.preparingForDisplay() ?? image
        }
        return image
    }
}
