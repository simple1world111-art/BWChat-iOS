// BWChat/Views/MessageBubble.swift
// Premium gradient message bubble with avatar

import SwiftUI

struct MessageBubble: View {
    let message: Message
    let isFromMe: Bool
    var avatarURL: String = ""
    var onImageTap: ((String) -> Void)?
    var onVideoTap: ((String) -> Void)?
    var onReply: ((Message) -> Void)?
    var onQuoteTap: ((Int) -> Void)?

    @State private var swipeOffset: CGFloat = 0

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if isFromMe { Spacer(minLength: 40) }

            if !isFromMe {
                AvatarView(url: avatarURL, size: 36)
            }

            VStack(alignment: isFromMe ? .trailing : .leading, spacing: 2) {
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
            }

            if isFromMe {
                AvatarView(url: avatarURL, size: 36)
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

    @State private var showMenu = false

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
            .onLongPressGesture(minimumDuration: 0.5) {
                let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                impactFeedback.impactOccurred()
                showMenu = true
            }
            .confirmationDialog("", isPresented: $showMenu, titleVisibility: .hidden) {
                Button("复制") { UIPasteboard.general.string = message.content }
                Button("回复") { onReply?(message) }
                Button("取消", role: .cancel) {}
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

// MARK: - Time Separator

struct TimeSeparatorView: View {
    let timestamp: String

    var body: some View {
        Text(TimestampHelper.formatSeparator(timestamp))
            .font(.system(size: 12))
            .foregroundColor(AppColors.secondaryText)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(AppColors.separator.opacity(0.6))
            .cornerRadius(8)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
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
    var maxWidth: CGFloat = 160
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
                RoundedRectangle(cornerRadius: 12)
                    .fill(AppColors.separator)
                    .frame(width: 120, height: 90)
                    .overlay(
                        ProgressView()
                            .tint(AppColors.accent)
                    )
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(AppColors.separator)
                    .frame(width: 120, height: 90)
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundColor(AppColors.secondaryText)
                    )
            }
        }
        .task(id: url) {
            image = await ImageCacheManager.shared.loadImage(from: url, thumbnail: true)
            isLoading = false
        }
    }
}
