// BWChat/Managers/ImageCacheManager.swift
// Two-tier image cache: in-memory (NSCache) + disk (Caches directory)

import SwiftUI

@MainActor
class ImageCacheManager {
    static let shared = ImageCacheManager()

    private let memoryCache = NSCache<NSString, UIImage>()
    private var loadingTasks: [String: Task<UIImage?, Never>] = [:]
    private let diskCacheURL: URL

    private init() {
        memoryCache.countLimit = 100
        memoryCache.totalCostLimit = 50 * 1024 * 1024 // 50 MB

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

        // 1. Memory cache
        if let cached = memoryCache.object(forKey: cacheKey as NSString) {
            return cached
        }

        // 2. Disk cache
        if let diskImage = loadFromDisk(urlPath: cacheKey) {
            memoryCache.setObject(diskImage, forKey: cacheKey as NSString)
            return diskImage
        }

        // 3. Deduplicate in-flight loads
        if let existingTask = loadingTasks[cacheKey] {
            return await existingTask.value
        }

        // 4. Network load
        let task = Task<UIImage?, Never> {
            do {
                let data = try await APIService.shared.loadImage(path: loadPath)
                if let image = UIImage(data: data) {
                    self.memoryCache.setObject(image, forKey: cacheKey as NSString)
                    self.saveToDisk(data: data, urlPath: cacheKey)
                    return image
                }
            } catch {
                print("[ImageCache] Failed to load image: \(error)")
            }
            return nil
        }

        loadingTasks[cacheKey] = task
        let result = await task.value
        loadingTasks.removeValue(forKey: cacheKey)
        return result
    }

    func clearCache() {
        memoryCache.removeAllObjects()
        loadingTasks.values.forEach { $0.cancel() }
        loadingTasks.removeAll()
        try? FileManager.default.removeItem(at: diskCacheURL)
        try? FileManager.default.createDirectory(at: diskCacheURL, withIntermediateDirectories: true)
    }

    func removeImage(for urlPath: String) {
        memoryCache.removeObject(forKey: urlPath as NSString)
        loadingTasks.removeValue(forKey: urlPath)
        let fileURL = diskFileURL(for: urlPath)
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

    private func diskFileURL(for urlPath: String) -> URL {
        let safeFilename = urlPath
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        return diskCacheURL.appendingPathComponent(safeFilename)
    }

    private func saveToDisk(data: Data, urlPath: String) {
        let fileURL = diskFileURL(for: urlPath)
        try? data.write(to: fileURL, options: .atomic)
    }

    private func loadFromDisk(urlPath: String) -> UIImage? {
        let fileURL = diskFileURL(for: urlPath)
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return UIImage(data: data)
    }
}
