// BWChat/Services/ChatAppearanceStore.swift
// Chat background state and rendering helpers.

import Foundation
import SwiftUI
import UIKit

enum ChatBackgroundTargetType: String, Codable, CaseIterable {
    case global
    case dm
    case group
}

struct ChatBackground: Codable, Equatable, Identifiable {
    let targetType: ChatBackgroundTargetType
    let targetID: String
    let imageURL: String
    let updatedAt: String?

    var id: String { Self.key(targetType: targetType, targetID: targetID) }

    enum CodingKeys: String, CodingKey {
        case targetType = "target_type"
        case targetID = "target_id"
        case imageURL = "image_url"
        case updatedAt = "updated_at"
    }

    static func key(targetType: ChatBackgroundTargetType, targetID: String) -> String {
        "\(targetType.rawValue):\(targetID)"
    }
}

@MainActor
final class ChatAppearanceStore: ObservableObject {
    static let shared = ChatAppearanceStore()

    @Published private(set) var backgroundsByKey: [String: ChatBackground] = [:]
    @Published private(set) var isLoading = false

    private var didLoad = false

    private init() {}

    func loadIfNeeded() async {
        guard !didLoad else { return }
        await load()
    }

    func load() async {
        guard AuthManager.shared.token != nil else {
            clear()
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let backgrounds = try await APIService.shared.getChatBackgrounds()
            let next = Dictionary(uniqueKeysWithValues: backgrounds.map { ($0.id, $0) })
            removeChangedCaches(previous: backgroundsByKey, next: next)
            backgroundsByKey = next
            didLoad = true
        } catch {
            print("[ChatAppearanceStore] load backgrounds failed: \(error)")
        }
    }

    func clear() {
        backgroundsByKey = [:]
        didLoad = false
        isLoading = false
    }

    func exactBackground(targetType: ChatBackgroundTargetType, targetID: String) -> ChatBackground? {
        backgroundsByKey[ChatBackground.key(targetType: targetType, targetID: targetID)]
    }

    func effectiveBackground(targetType: ChatBackgroundTargetType, targetID: String) -> ChatBackground? {
        if let specific = exactBackground(targetType: targetType, targetID: targetID) {
            return specific
        }
        if targetType != .global {
            return exactBackground(targetType: .global, targetID: "global")
        }
        return nil
    }

    func uploadBackground(
        targetType: ChatBackgroundTargetType,
        targetID: String,
        imageData: Data
    ) async throws {
        let old = exactBackground(targetType: targetType, targetID: targetID)
        let filename = "background_\(Int(Date().timeIntervalSince1970)).jpg"
        let result = try await APIService.shared.uploadChatBackground(
            targetType: targetType,
            targetID: targetID,
            imageData: imageData,
            filename: filename
        )
        if let background = result.background {
            let uploadedBackground = localVersionedBackground(background)
            if let old {
                removeCachedImages(for: old)
            }
            BackgroundImageCache.shared.cacheImageData(result.imageData, for: uploadedBackground)
            backgroundsByKey[uploadedBackground.id] = uploadedBackground
        } else {
            if let old {
                removeCachedImages(for: old)
            }
            await load()
        }
    }

    func deleteBackground(targetType: ChatBackgroundTargetType, targetID: String) async throws {
        try await APIService.shared.deleteChatBackground(targetType: targetType, targetID: targetID)
        let key = ChatBackground.key(targetType: targetType, targetID: targetID)
        if let removed = backgroundsByKey.removeValue(forKey: key) {
            removeCachedImages(for: removed)
        }
    }

    nonisolated static func resolvedImagePath(_ imageURL: String) -> String {
        if imageURL.isEmpty { return "" }
        if imageURL.hasPrefix("/") || imageURL.hasPrefix("http") { return imageURL }
        return "/api/v1/" + imageURL
    }

    nonisolated static func cacheKey(for background: ChatBackground) -> String {
        var key = resolvedImagePath(background.imageURL)
        if let updatedAt = background.updatedAt, !updatedAt.isEmpty {
            let encoded = updatedAt.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? updatedAt
            key += key.contains("?") ? "&bg_updated_at=\(encoded)" : "?bg_updated_at=\(encoded)"
        }
        return key
    }

    private func removeChangedCaches(previous: [String: ChatBackground], next: [String: ChatBackground]) {
        for (key, oldBackground) in previous {
            guard let newBackground = next[key] else {
                removeCachedImages(for: oldBackground)
                continue
            }
            if oldBackground.imageURL != newBackground.imageURL || oldBackground.updatedAt != newBackground.updatedAt {
                removeCachedImages(for: oldBackground)
            }
        }
    }

    private func removeCachedImages(for background: ChatBackground) {
        BackgroundImageCache.shared.removeImage(for: background)
        ImageCacheManager.shared.removeImage(for: Self.resolvedImagePath(background.imageURL))
        ImageCacheManager.shared.removeImage(for: Self.cacheKey(for: background))
    }

    private func localVersionedBackground(_ background: ChatBackground) -> ChatBackground {
        guard background.updatedAt?.isEmpty ?? true else { return background }
        return ChatBackground(
            targetType: background.targetType,
            targetID: background.targetID,
            imageURL: background.imageURL,
            updatedAt: "local-\(Int(Date().timeIntervalSince1970))"
        )
    }
}

struct ChatBackgroundLayer: View {
    let background: ChatBackground?

    @State private var image: UIImage?

    init(background: ChatBackground?) {
        self.background = background
    }

    init(imageURL: String?) {
        if let imageURL, !imageURL.isEmpty {
            self.background = ChatBackground(
                targetType: .global,
                targetID: "preview",
                imageURL: imageURL,
                updatedAt: nil
            )
        } else {
            self.background = nil
        }
    }

    private var cacheKey: String {
        guard let background else { return "" }
        return ChatAppearanceStore.cacheKey(for: background)
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                AppColors.secondaryBackground

                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .saturation(0.62)
                        .contrast(0.82)
                        .brightness(0.03)
                        .overlay(Color.white.opacity(0.46))
                        .transition(.opacity)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
        }
        .onAppear {
            guard let background else { return }
            if let cached = BackgroundImageCache.shared.image(for: background) {
                image = cached
            }
        }
        .task(id: cacheKey) {
            guard let background else {
                image = nil
                return
            }
            if let loaded = await BackgroundImageCache.shared.loadImage(for: background) {
                image = loaded
            }
        }
    }
}

final class BackgroundImageCache: @unchecked Sendable {
    static let shared = BackgroundImageCache()

    private let memoryCache = NSCache<NSString, UIImage>()
    private let diskCacheURL: URL

    private init() {
        memoryCache.countLimit = 40
        memoryCache.totalCostLimit = 60 * 1024 * 1024

        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        diskCacheURL = caches.appendingPathComponent("ChatBackgroundCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: diskCacheURL, withIntermediateDirectories: true)
    }

    func image(for background: ChatBackground) -> UIImage? {
        memoryCache.object(forKey: ChatAppearanceStore.cacheKey(for: background) as NSString)
    }

    func loadImage(for background: ChatBackground) async -> UIImage? {
        let key = ChatAppearanceStore.cacheKey(for: background)
        if let cached = memoryCache.object(forKey: key as NSString) {
            return cached
        }

        let diskURL = diskFileURL(for: key)
        if let diskImage = await decodeImageFromDisk(diskURL) {
            memoryCache.setObject(diskImage, forKey: key as NSString)
            return diskImage
        }

        do {
            let data = try await APIService.shared.loadImage(path: ChatAppearanceStore.resolvedImagePath(background.imageURL))
            cacheImageData(data, for: background)
            return memoryCache.object(forKey: key as NSString)
        } catch {
            print("[BackgroundImageCache] load failed: \(error)")
            return nil
        }
    }

    func cacheImageData(_ data: Data, for background: ChatBackground) {
        let key = ChatAppearanceStore.cacheKey(for: background)
        guard let image = Self.decodeAndPrepare(data: data) else { return }
        memoryCache.setObject(image, forKey: key as NSString, cost: data.count)
        let fileURL = diskFileURL(for: key)
        try? data.write(to: fileURL, options: .atomic)
    }

    func removeImage(for background: ChatBackground) {
        let key = ChatAppearanceStore.cacheKey(for: background)
        memoryCache.removeObject(forKey: key as NSString)
        try? FileManager.default.removeItem(at: diskFileURL(for: key))
    }

    private func diskFileURL(for key: String) -> URL {
        let safeFilename = key
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
            .replacingOccurrences(of: "?", with: "_")
            .replacingOccurrences(of: "&", with: "_")
            .replacingOccurrences(of: "=", with: "_")
        return diskCacheURL.appendingPathComponent(safeFilename)
    }

    private func decodeImageFromDisk(_ url: URL) async -> UIImage? {
        await Task.detached(priority: .userInitiated) {
            guard let data = try? Data(contentsOf: url) else { return nil }
            return Self.decodeAndPrepare(data: data)
        }.value
    }

    private static func decodeAndPrepare(data: Data) -> UIImage? {
        guard let image = UIImage(data: data) else { return nil }
        if #available(iOS 15.0, *) {
            return image.preparingForDisplay() ?? image
        }
        return image
    }
}
