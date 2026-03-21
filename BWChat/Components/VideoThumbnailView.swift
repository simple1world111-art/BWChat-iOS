// BWChat/Components/VideoThumbnailView.swift
// Displays a video thumbnail loaded from the server

import SwiftUI

struct VideoThumbnailView: View {
    let videoURL: String
    @State private var image: UIImage?
    @State private var isLoading = true

    /// Derive the thumbnail URL from the video URL.
    /// e.g. /api/v1/images/u004/xxx.mp4 → /api/v1/public/images/u004/xxx_thumb.jpg
    private var thumbnailPath: String {
        var path = videoURL
        // Use public endpoint (no auth required for thumbnails)
        if path.hasPrefix("/api/v1/images/") {
            path = path.replacingOccurrences(of: "/api/v1/images/", with: "/api/v1/public/images/")
        }
        // Replace video extension with _thumb.jpg
        if let dotIndex = path.lastIndex(of: ".") {
            return String(path[path.startIndex..<dotIndex]) + "_thumb.jpg"
        }
        return path + "_thumb.jpg"
    }

    var body: some View {
        Group {
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: 200, maxHeight: 250)
                    .clipped()
            } else if isLoading {
                RoundedRectangle(cornerRadius: 14)
                    .fill(AppColors.separator)
                    .frame(width: 200, height: 140)
                    .overlay(ProgressView().tint(AppColors.accent))
            } else {
                // Fallback if thumbnail unavailable
                RoundedRectangle(cornerRadius: 14)
                    .fill(AppColors.separator)
                    .frame(width: 200, height: 140)
                    .overlay(
                        Image(systemName: "video.fill")
                            .font(.system(size: 28))
                            .foregroundColor(AppColors.secondaryText)
                    )
            }
        }
        .task {
            await loadThumbnail()
        }
    }

    private func loadThumbnail() async {
        // Use ImageCacheManager's full two-tier cache (memory + disk)
        let path = thumbnailPath
        if let loaded = await ImageCacheManager.shared.loadImage(from: path) {
            image = loaded
        }
        isLoading = false
    }
}
