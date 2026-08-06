// BWChat/Components/VideoThumbnailView.swift
// Displays a video thumbnail loaded from the server

import SwiftUI
import AVFoundation

enum ChatMediaLayout {
    /// WeChat-style media rows use a small set of stable footprints rather
    /// than forcing every photo into one landscape box. This preserves a
    /// compact timeline without letterboxing portrait images.
    static let landscapeImageSize = CGSize(width: 160, height: 110)
    static let portraitImageSize = CGSize(width: 110, height: 156)
    static let squareImageSize = CGSize(width: 140, height: 140)

    /// Landscape fallback retained for placeholders and compatibility.
    static let imageThumbnailSize = landscapeImageSize
    static let mediaCornerRadius: CGFloat = 10

    /// Keep the existing landscape-video footprint while making portrait
    /// videos narrower and shorter than the old 200 x 250 maximum.
    static let landscapeVideoSize = CGSize(width: 200, height: 140)
    static let portraitVideoSize = CGSize(width: 112, height: 160)
    static let squareVideoSize = CGSize(width: 150, height: 150)

    static func imageThumbnailSize(for imageSize: CGSize?) -> CGSize {
        guard let imageSize, imageSize.width > 0, imageSize.height > 0 else {
            return landscapeImageSize
        }
        let aspectRatio = imageSize.width / imageSize.height
        if aspectRatio < 0.85 { return portraitImageSize }
        if aspectRatio > 1.18 { return landscapeImageSize }
        return squareImageSize
    }

    static func videoThumbnailSize(for imageSize: CGSize?) -> CGSize {
        guard let imageSize, imageSize.width > 0, imageSize.height > 0 else {
            return landscapeVideoSize
        }
        let aspectRatio = imageSize.width / imageSize.height
        if aspectRatio < 0.9 { return portraitVideoSize }
        if aspectRatio > 1.1 { return landscapeVideoSize }
        return squareVideoSize
    }
}

struct VideoThumbnailView: View {
    let videoURL: String
    private let explicitThumbnailURL: String?
    private let fixedSize: CGSize?
    private let showsPlayIndicator: Bool
    @State private var image: UIImage?

    /// Derive the thumbnail URL from the video URL.
    /// e.g. /api/v1/images/u004/xxx.mp4 → /api/v1/public/images/u004/xxx_thumb.jpg
    private var thumbnailPath: String {
        if let explicitThumbnailURL = explicitThumbnailURL?.chatMediaNonEmpty {
            return explicitThumbnailURL
        }
        return ImageCacheManager.videoThumbnailCacheKey(for: videoURL)
    }

    private var localVideoURL: URL? {
        guard let url = URL(string: videoURL), url.isFileURL else { return nil }
        return url
    }

    init(
        videoURL: String,
        thumbnailURL: String? = nil,
        showsPlayIndicator: Bool = false
    ) {
        self.videoURL = videoURL
        self.explicitThumbnailURL = thumbnailURL
        self.fixedSize = nil
        self.showsPlayIndicator = showsPlayIndicator
        let key = thumbnailURL?.chatMediaNonEmpty
            ?? ImageCacheManager.videoThumbnailCacheKey(for: videoURL)
        _image = State(initialValue: ImageCacheManager.shared.image(for: key))
    }

    init(
        videoURL: String,
        width: CGFloat,
        height: CGFloat,
        thumbnailURL: String? = nil,
        showsPlayIndicator: Bool = false
    ) {
        self.videoURL = videoURL
        self.explicitThumbnailURL = thumbnailURL
        self.fixedSize = CGSize(width: width, height: height)
        self.showsPlayIndicator = showsPlayIndicator
        let key = thumbnailURL?.chatMediaNonEmpty
            ?? ImageCacheManager.videoThumbnailCacheKey(for: videoURL)
        _image = State(initialValue: ImageCacheManager.shared.image(for: key))
    }

    private var displaySize: CGSize {
        fixedSize ?? ChatMediaLayout.videoThumbnailSize(for: image?.size)
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.1)

            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "video.fill")
                    .font(.system(size: 24))
                    .foregroundColor(.white.opacity(0.7))
            }

            if showsPlayIndicator {
                Circle()
                    .fill(Color.black.opacity(0.42))
                    .frame(width: 44, height: 44)
                Image(systemName: "play.fill")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(.white)
                    .offset(x: 1)
            }
        }
        .frame(width: displaySize.width, height: displaySize.height)
        .clipped()
        .clipShape(RoundedRectangle(
            cornerRadius: ChatMediaLayout.mediaCornerRadius,
            style: .continuous
        ))
        .overlay {
            RoundedRectangle(
                cornerRadius: ChatMediaLayout.mediaCornerRadius,
                style: .continuous
            )
            .stroke(Color.black.opacity(0.08), lineWidth: 0.5)
        }
        .transaction { transaction in
            transaction.animation = nil
        }
        .task(id: videoURL) {
            await loadThumbnail()
        }
    }

    private func loadThumbnail() async {
        let requestedVideoURL = videoURL
        let requestedThumbnailPath = thumbnailPath
        if let cached = ImageCacheManager.shared.image(for: requestedThumbnailPath) {
            image = cached
            return
        }

        if let localVideoURL {
            let loaded: UIImage? = await Task.detached(priority: .userInitiated) {
                let asset = AVURLAsset(url: localVideoURL)
                let generator = AVAssetImageGenerator(asset: asset)
                generator.appliesPreferredTrackTransform = true
                generator.maximumSize = CGSize(width: 600, height: 600)
                guard let cgImage = try? generator.copyCGImage(at: .zero, actualTime: nil) else { return nil }
                return UIImage(cgImage: cgImage)
            }.value
            guard !Task.isCancelled, requestedVideoURL == videoURL else { return }
            if let loaded {
                ImageCacheManager.shared.setImage(loaded, for: requestedThumbnailPath)
                image = loaded
            }
            return
        }
        // Use ImageCacheManager's full two-tier cache (memory + disk)
        image = nil
        let loaded = await ImageCacheManager.shared.loadImage(from: requestedThumbnailPath)
        guard !Task.isCancelled,
              requestedVideoURL == videoURL,
              requestedThumbnailPath == thumbnailPath else { return }
        image = loaded
    }
}
