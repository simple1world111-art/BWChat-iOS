// BWChat/Services/MediaLibrarySaver.swift
// Save chat / Moments images and videos to the photo library (long-press).

import Foundation
import Photos
import UIKit

@MainActor
final class MediaSaveFeedback: ObservableObject {
    static let shared = MediaSaveFeedback()
    @Published var toastMessage: String?
    private init() {}

    func show(_ message: String) {
        toastMessage = message
    }
}

@MainActor
enum MediaLibrarySaver {

    private static func hasAddAccess() async -> Bool {
        let current = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        if current == .authorized || current == .limited { return true }
        if current == .denied || current == .restricted { return false }
        let requested = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        return requested == .authorized || requested == .limited
    }

    private static func performChanges(_ block: @escaping () -> Void) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            PHPhotoLibrary.shared().performChanges(block) { ok, err in
                if let err = err {
                    cont.resume(throwing: err)
                } else if !ok {
                    cont.resume(throwing: NSError(domain: "BWChat", code: -1, userInfo: [NSLocalizedDescriptionKey: "保存失败"]))
                } else {
                    cont.resume()
                }
            }
        }
    }

    static func saveImage(mediaPath: String) async {
        guard await hasAddAccess() else {
            MediaSaveFeedback.shared.show("请在设置中允许 BWChat 将照片添加到相册")
            return
        }
        do {
            let data = try await APIService.shared.loadAuthenticatedMedia(path: mediaPath)
            guard let image = UIImage(data: data) else {
                MediaSaveFeedback.shared.show("图片数据无效")
                return
            }
            try await performChanges {
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }
            MediaSaveFeedback.shared.show("已保存到相册")
        } catch {
            MediaSaveFeedback.shared.show("保存失败")
        }
    }

    static func saveVideo(mediaPath: String) async {
        guard await hasAddAccess() else {
            MediaSaveFeedback.shared.show("请在设置中允许 BWChat 将视频添加到相册")
            return
        }
        let tmp: URL
        do {
            let data = try await APIService.shared.loadAuthenticatedMedia(path: mediaPath)
            let ext = (mediaPath as NSString).pathExtension.lowercased()
            let suffix = ext.isEmpty ? "mp4" : ext
            tmp = FileManager.default.temporaryDirectory
                .appendingPathComponent("bwchat-video-\(UUID().uuidString).\(suffix)")
            try data.write(to: tmp, options: .atomic)
        } catch {
            MediaSaveFeedback.shared.show("视频下载失败")
            return
        }
        do {
            try await performChanges {
                PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: tmp)
            }
            MediaSaveFeedback.shared.show("视频已保存到相册")
        } catch {
            MediaSaveFeedback.shared.show("视频保存失败")
        }
        try? FileManager.default.removeItem(at: tmp)
    }
}
