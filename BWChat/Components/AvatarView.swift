// BWChat/Components/AvatarView.swift
// Premium avatar with gradient placeholder

import SwiftUI

struct AvatarView: View {
    let url: String
    let size: CGFloat

    @State private var image: UIImage?

    private var resolvedPath: String {
        if url.isEmpty { return "" }
        if url.hasPrefix("/") || url.hasPrefix("http") { return url }
        return "/api/v1/" + url
    }

    var body: some View {
        Group {
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                // Gradient placeholder
                Circle()
                    .fill(AppColors.accentGradient)
                    .overlay(
                        Image(systemName: "person.fill")
                            .foregroundColor(.white.opacity(0.8))
                            .font(.system(size: size * 0.38, weight: .medium))
                    )
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .onAppear {
            // Try synchronous memory cache first for instant display
            let path = resolvedPath
            guard !path.isEmpty else { return }
            if let cached = ImageCacheManager.shared.image(for: path) {
                image = cached
            }
        }
        .task(id: url) {
            let path = resolvedPath
            guard !path.isEmpty else {
                image = nil
                return
            }
            // Only clear image if we had one but sync cache no longer has this path
            if image != nil, ImageCacheManager.shared.image(for: path) == nil {
                image = nil
            }
            if let loaded = await ImageCacheManager.shared.loadImage(from: path) {
                image = loaded
            }
        }
    }
}
