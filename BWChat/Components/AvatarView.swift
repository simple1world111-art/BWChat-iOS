// BWChat/Components/AvatarView.swift
// Circular avatar component

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
                // Placeholder
                Circle()
                    .fill(AppColors.separator)
                    .overlay(
                        Image(systemName: "person.fill")
                            .foregroundColor(AppColors.secondaryText)
                            .font(.system(size: size * 0.4))
                    )
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .task {
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
