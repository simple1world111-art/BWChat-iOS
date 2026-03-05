// BWChat/Views/MessageBubble.swift
// Chat message bubble component

import SwiftUI

struct MessageBubble: View {
    let message: Message
    let isFromMe: Bool
    var onImageTap: ((String) -> Void)?

    var body: some View {
        HStack(alignment: .bottom, spacing: 4) {
            if isFromMe { Spacer(minLength: 60) }

            VStack(alignment: isFromMe ? .trailing : .leading, spacing: 2) {
                // Message content
                if message.isImage {
                    imageBubble
                } else {
                    textBubble
                }

                // Timestamp
                Text(message.formattedTime)
                    .font(.caption2)
                    .foregroundColor(AppColors.secondaryText)
                    .padding(.horizontal, 4)
            }

            if !isFromMe { Spacer(minLength: 60) }
        }
        .padding(.vertical, 2)
    }

    // MARK: - Text Bubble

    private var textBubble: some View {
        Text(message.content)
            .font(.body)
            .foregroundColor(isFromMe ? AppColors.sentBubbleText : AppColors.receivedBubbleText)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(isFromMe ? AppColors.sentBubble : AppColors.receivedBubble)
            .cornerRadius(18)
    }

    // MARK: - Image Bubble

    private var imageBubble: some View {
        CachedAsyncImage(url: message.content)
            .frame(maxWidth: 200, maxHeight: 250)
            .cornerRadius(12)
            .onTapGesture {
                onImageTap?(message.content)
            }
    }
}

// MARK: - Cached Async Image

struct CachedAsyncImage: View {
    let url: String
    @State private var image: UIImage?
    @State private var isLoading = true

    var body: some View {
        Group {
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
            } else if isLoading {
                RoundedRectangle(cornerRadius: 12)
                    .fill(AppColors.separator)
                    .frame(width: 150, height: 150)
                    .overlay(ProgressView())
            } else {
                // Failed placeholder
                RoundedRectangle(cornerRadius: 12)
                    .fill(AppColors.separator)
                    .frame(width: 150, height: 150)
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundColor(AppColors.secondaryText)
                    )
            }
        }
        .task {
            image = await ImageCacheManager.shared.loadImage(from: url)
            isLoading = false
        }
    }
}
