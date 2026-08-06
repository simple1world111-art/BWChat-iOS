import CryptoKit
import Foundation
import SwiftUI

enum RemoteAssetError: LocalizedError {
    case missingAsset
    case invalidURL
    case unsupportedContentType
    case executableResource
    case fileTooLarge
    case checksumMismatch

    var errorDescription: String? {
        switch self {
        case .missingAsset: return "Missing remote asset"
        case .invalidURL: return "Invalid remote asset URL"
        case .unsupportedContentType: return "Unsupported remote asset content type"
        case .executableResource: return "Executable remote resources are not allowed"
        case .fileTooLarge: return "Remote asset is too large"
        case .checksumMismatch: return "Remote asset checksum mismatch"
        }
    }
}

@MainActor
final class RemoteAssetManager: ObservableObject {
    static let shared = RemoteAssetManager()

    @Published private(set) var manifest: RemoteAssetManifest?

    private let maxSingleFileBytes = 8 * 1024 * 1024
    private let fileManager = FileManager.default

    private init() {}

    func apply(_ manifest: RemoteAssetManifest?) {
        self.manifest = manifest
    }

    func asset(for key: String?) -> RemoteAsset? {
        guard let key, !key.isBlank else { return nil }
        return manifest?.assetsByKey[key]
    }

    func trustedRemoteURL(for key: String?) -> URL? {
        guard let asset = asset(for: key),
              isAllowed(asset),
              let url = URL(string: asset.url),
              url.scheme?.lowercased() == "https" else {
            return nil
        }
        return url
    }

    func verifiedCachedURL(for key: String) async throws -> URL {
        guard let asset = asset(for: key) else { throw RemoteAssetError.missingAsset }
        guard isAllowed(asset) else { throw RemoteAssetError.unsupportedContentType }
        guard let url = URL(string: asset.url), url.scheme?.lowercased() == "https" else {
            throw RemoteAssetError.invalidURL
        }

        let cacheURL = try cacheFileURL(for: asset)
        if fileManager.fileExists(atPath: cacheURL.path) {
            return cacheURL
        }

        let (data, response) = try await URLSession.shared.data(from: url)
        if let expectedSize = asset.byteSize, data.count != expectedSize {
            throw RemoteAssetError.fileTooLarge
        }
        if data.count > min(asset.byteSize ?? maxSingleFileBytes, maxSingleFileBytes) {
            throw RemoteAssetError.fileTooLarge
        }
        if let httpResponse = response as? HTTPURLResponse,
           let responseType = httpResponse.value(forHTTPHeaderField: "Content-Type")?.lowercased(),
           !isAllowedContentType(responseType) {
            throw RemoteAssetError.unsupportedContentType
        }
        if let expectedHash = asset.sha256?.lowercased(), !expectedHash.isEmpty {
            let actualHash = SHA256.hash(data: data)
                .map { String(format: "%02x", $0) }
                .joined()
            guard actualHash == expectedHash else {
                throw RemoteAssetError.checksumMismatch
            }
        }

        try fileManager.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: cacheURL, options: [.atomic])
        return cacheURL
    }

    private func isAllowed(_ asset: RemoteAsset) -> Bool {
        guard let url = URL(string: asset.url), !isExecutable(url: url) else {
            return false
        }
        if let byteSize = asset.byteSize, byteSize > maxSingleFileBytes {
            return false
        }
        guard let contentType = asset.contentType?.lowercased(), !contentType.isBlank else {
            return false
        }
        return isAllowedContentType(contentType)
    }

    private func isAllowedContentType(_ contentType: String) -> Bool {
        let normalized = contentType
            .components(separatedBy: ";")
            .first?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? contentType

        if normalized.hasPrefix("image/") {
            return ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"].contains(normalized)
        }
        if normalized.hasPrefix("audio/") {
            return true
        }
        return [
            "application/json",
            "application/lottie+json",
            "application/octet-stream+lottie"
        ].contains(normalized)
    }

    private func isExecutable(url: URL) -> Bool {
        let banned = [
            "dylib",
            "framework",
            "ipa",
            "swiftbundle",
            "jsbundle",
            "wasm",
            "lua",
            "js"
        ]
        return banned.contains(url.pathExtension.lowercased())
    }

    private func cacheFileURL(for asset: RemoteAsset) throws -> URL {
        let root = try fileManager.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let filename = asset.key
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        let ext = URL(string: asset.url)?.pathExtension ?? "asset"
        return root
            .appendingPathComponent("RemoteAssets", isDirectory: true)
            .appendingPathComponent("\(filename).\(ext)")
    }
}

struct RemoteAssetImage: View {
    let assetKey: String?
    var fallbackAssetName: String?
    var fallbackSystemImage: String = "photo"
    var fallbackText: String?
    var contentMode: ContentMode = .fit

    @ObservedObject private var assetManager = RemoteAssetManager.shared
    @State private var cachedURL: URL?

    var body: some View {
        Group {
            if let cachedURL {
                AsyncImage(url: cachedURL) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().aspectRatio(contentMode: contentMode)
                    case .empty: ProgressView().tint(AppColors.accent)
                    case .failure:
                        fallback
                    @unknown default:
                        fallback
                    }
                }
            } else {
                fallback
            }
        }
        .task(id: assetKey) {
            cachedURL = nil
            guard let assetKey, !assetKey.isBlank else {
                return
            }
            do {
                cachedURL = try await assetManager.verifiedCachedURL(for: assetKey)
            } catch is CancellationError {
                return
            } catch {
                cachedURL = nil
            }
        }
    }

    @ViewBuilder
    private var fallback: some View {
        if let fallbackAssetName, UIImage(named: fallbackAssetName) != nil {
            Image(fallbackAssetName)
                .resizable()
                .aspectRatio(contentMode: contentMode)
        } else if let fallbackText, !fallbackText.isBlank {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(AppColors.accent.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(AppColors.accent.opacity(0.18), lineWidth: 1)
                    )

                Text(fallbackText)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(AppColors.secondaryText)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.65)
                    .padding(6)
            }
        } else {
            Image(systemName: fallbackSystemImage)
                .resizable()
                .scaledToFit()
                .foregroundColor(AppColors.tertiaryText)
        }
    }
}
