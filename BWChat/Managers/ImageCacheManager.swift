// BWChat/Managers/ImageCacheManager.swift
// In-memory image cache

import SwiftUI

@MainActor
class ImageCacheManager {
    static let shared = ImageCacheManager()

    private let cache = NSCache<NSString, UIImage>()
    private var loadingTasks: [String: Task<UIImage?, Never>] = [:]

    private init() {
        cache.countLimit = 100
        cache.totalCostLimit = 50 * 1024 * 1024 // 50 MB
    }

    func image(for url: String) -> UIImage? {
        cache.object(forKey: url as NSString)
    }

    func setImage(_ image: UIImage, for url: String) {
        cache.setObject(image, forKey: url as NSString)
    }

    func loadImage(from urlPath: String) async -> UIImage? {
        // Check cache first
        if let cached = image(for: urlPath) {
            return cached
        }

        // Check if already loading
        if let existingTask = loadingTasks[urlPath] {
            return await existingTask.value
        }

        // Start loading
        let task = Task<UIImage?, Never> {
            do {
                let data = try await APIService.shared.loadImage(path: urlPath)
                if let image = UIImage(data: data) {
                    self.setImage(image, for: urlPath)
                    return image
                }
            } catch {
                print("[ImageCache] Failed to load image: \(error)")
            }
            return nil
        }

        loadingTasks[urlPath] = task
        let result = await task.value
        loadingTasks.removeValue(forKey: urlPath)
        return result
    }

    func clearCache() {
        cache.removeAllObjects()
        loadingTasks.values.forEach { $0.cancel() }
        loadingTasks.removeAll()
    }

    func removeImage(for urlPath: String) {
        cache.removeObject(forKey: urlPath as NSString)
        loadingTasks.removeValue(forKey: urlPath)
    }
}
