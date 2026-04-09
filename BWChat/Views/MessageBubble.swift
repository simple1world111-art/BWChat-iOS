// BWChat/Views/MessageBubble.swift
// Premium gradient message bubble - adaptive spacing

import SwiftUI

struct MessageBubble: View {
    let message: Message
    let isFromMe: Bool
    var onImageTap: ((String) -> Void)?
    var onVideoTap: ((String) -> Void)?
    var onReply: ((Message) -> Void)?
    var onQuoteTap: ((Int) -> Void)?

    @State private var swipeOffset: CGFloat = 0

    var body: some View {
        HStack(alignment: .bottom, spacing: 4) {
            if isFromMe { Spacer(minLength: 40) }

            VStack(alignment: isFromMe ? .trailing : .leading, spacing: 2) {
                // Quoted message preview
                if let reply = message.replyTo {
                    let senderName = reply.senderID == AuthManager.shared.currentUser?.userID ? "我" : UserCacheManager.shared.getUser(reply.senderID)?.nickname ?? reply.senderID
                    QuotedMessageView(
                        senderName: senderName,
                        content: reply.content,
                        msgType: reply.msgType,
                        isFromMe: isFromMe,
                        onTap: { onQuoteTap?(reply.id) }
                    )
                }

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
        .offset(x: swipeOffset)
        .gesture(
            DragGesture(minimumDistance: 30)
                .onChanged { value in
                    let horizontal = value.translation.width
                    if (isFromMe && horizontal < 0) || (!isFromMe && horizontal > 0) {
                        swipeOffset = horizontal * 0.4
                    }
                }
                .onEnded { value in
                    let threshold: CGFloat = 50
                    if abs(value.translation.width) > threshold {
                        onReply?(message)
                    }
                    withAnimation(.spring(response: 0.3)) { swipeOffset = 0 }
                }
        )
        .overlay(alignment: isFromMe ? .leading : .trailing) {
            if abs(swipeOffset) > 20 {
                Image(systemName: "arrowshape.turn.up.left.fill")
                    .font(.system(size: 16))
                    .foregroundColor(AppColors.accent)
                    .opacity(min(abs(swipeOffset) / 50, 1))
            }
        }
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
            .contextMenu {
                Button {
                    UIPasteboard.general.string = message.content
                } label: {
                    Label("复制", systemImage: "doc.on.doc")
                }
                Button {
                    onReply?(message)
                } label: {
                    Label("回复", systemImage: "arrowshape.turn.up.left")
                }
            } preview: {
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
                    .cornerRadius(18)
            }
    }

    // MARK: - Image Bubble

    private var imageBubble: some View {
        CachedAsyncImage(url: message.content)
            .shadow(color: .black.opacity(0.06), radius: 4, x: 0, y: 2)
            .onTapGesture {
                onImageTap?(message.content)
            }
    }

    // MARK: - Video Bubble

    private var videoBubble: some View {
        ZStack {
            VideoThumbnailView(videoURL: message.content)
                .frame(maxWidth: 200, maxHeight: 250)
                .cornerRadius(14)

            Image(systemName: "play.circle.fill")
                .font(.system(size: 44))
                .foregroundColor(.white)
                .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 2)
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
    var maxWidth: CGFloat = 220
    @State private var image: UIImage?
    @State private var isLoading = true

    var body: some View {
        Group {
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: maxWidth)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            } else if isLoading {
                RoundedRectangle(cornerRadius: 14)
                    .fill(AppColors.separator)
                    .frame(width: 160, height: 120)
                    .overlay(
                        ProgressView()
                            .tint(AppColors.accent)
                    )
            } else {
                RoundedRectangle(cornerRadius: 14)
                    .fill(AppColors.separator)
                    .frame(width: 160, height: 120)
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundColor(AppColors.secondaryText)
                    )
            }
        }
        .task(id: url) {
            image = await ImageCacheManager.shared.loadImage(from: url)
            isLoading = false
        }
    }
}
