// BWChat/Components/AvatarView.swift
// Premium avatar with gradient placeholder

import SwiftUI

struct AvatarView: View {
    let url: String
    let size: CGFloat

    @State private var image: UIImage?

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
        .task(id: url) {
            image = nil
            let urlPath: String
            if url.hasPrefix("/") || url.hasPrefix("http") {
                urlPath = url
            } else {
                urlPath = "/api/v1/" + url
            }
            image = await ImageCacheManager.shared.loadImage(from: urlPath)
        }
    }
}
