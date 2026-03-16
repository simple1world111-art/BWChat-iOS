// BWChat/Views/MessageBubble.swift
// Premium gradient message bubble - adaptive spacing

import SwiftUI

struct MessageBubble: View {
    let message: Message
    let isFromMe: Bool
    var onImageTap: ((String) -> Void)?
    var onVideoTap: ((String) -> Void)?

    var body: some View {
        HStack(alignment: .bottom, spacing: 4) {
            if isFromMe { Spacer(minLength: 40) }

            VStack(alignment: isFromMe ? .trailing : .leading, spacing: 2) {
                if message.isImage {
                    imageBubble
                } else if message.isVideo {
                    videoBubble
                } else {
                    textBubble
                }

                Text(message.formattedTime)
                    .font(.system(size: 11))
                    .foregroundColor(AppColors.tertiaryText)
                    .padding(.horizontal, 4)
            }

            if !isFromMe { Spacer(minLength: 40) }
        }
        .padding(.vertical, 2)
    }

    // MARK: - Gradient Text Bubble

    private var textBubble: some View {
        Text(message.content)
            .font(.system(size: 16))
            .foregroundColor(isFromMe ? .white : AppColors.primaryText)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                Group {
                    if isFromMe {
                        AppColors.sentBubbleGradient
                    } else {
                        LinearGradient(
                            colors: [AppColors.receivedBubble, AppColors.receivedBubble],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    }
                }
            )
            .cornerRadius(18, corners: isFromMe ? [.topLeft, .topRight, .bottomLeft] : [.topLeft, .topRight, .bottomRight])
    }

    // MARK: - Image Bubble

    private var imageBubble: some View {
        CachedAsyncImage(url: message.content)
            .frame(maxWidth: 200, maxHeight: 250)
            .cornerRadius(14)
            .shadow(color: .black.opacity(0.06), radius: 4, x: 0, y: 2)
            .onTapGesture {
                onImageTap?(message.content)
            }
    }

    // MARK: - Video Bubble

    private var videoBubble: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14)
                .fill(isFromMe ? Color.blue.opacity(0.15) : AppColors.separator)
                .frame(width: 200, height: 140)

            VStack(spacing: 8) {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 44))
                    .foregroundColor(.white)
                    .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 2)

                Text("视频")
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
            }
        }
        .cornerRadius(14)
        .shadow(color: .black.opacity(0.06), radius: 4, x: 0, y: 2)
        .onTapGesture {
            onVideoTap?(message.content)
        }
    }
}

// MARK: - Rounded Corner Extension

extension View {
    func cornerRadius(_ radius: CGFloat, corners: UIRectCorner) -> some View {
        clipShape(RoundedCorner(radius: radius, corners: corners))
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat = .infinity
    var corners: UIRectCorner = .allCorners

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
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
                RoundedRectangle(cornerRadius: 14)
                    .fill(AppColors.separator)
                    .frame(width: 150, height: 150)
                    .overlay(
                        ProgressView()
                            .tint(AppColors.accent)
                    )
            } else {
                RoundedRectangle(cornerRadius: 14)
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
