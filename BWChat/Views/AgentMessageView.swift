// BWChat/Views/AgentMessageView.swift

import SwiftUI
import UIKit

struct AgentMessageView: View {
    let message: AgentMessage
    let agentAvatarAssetID: String?
    let unlockingMediaIDs: Set<String>
    let onUnlock: (String, MediaUnlockPaymentMethod) -> Void
    let onImageTap: (String, CGRect) -> Void
    let replyImageTarget: AgentImageReplyTarget?
    let onImageMenuRequested: (AgentImageReplyTarget, CGRect) -> Void
    let onImageMenuTouchSequenceEnded: () -> Void
    @State private var menuOwnsTouchSequence = false

    private var isFromUser: Bool { message.sender.type == "user" }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if isFromUser { Spacer(minLength: 48) }
            if !isFromUser {
                AgentAvatarView(assetID: agentAvatarAssetID, size: 32)
            }

            VStack(alignment: isFromUser ? .trailing : .leading, spacing: 7) {
                if let replyImageTarget {
                    replyPreview(replyImageTarget)
                }
                ForEach(message.orderedParts) { part in
                    partView(part)
                }
            }
            .frame(maxWidth: 290, alignment: isFromUser ? .trailing : .leading)

            if !isFromUser { Spacer(minLength: 48) }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func partView(_ part: AgentMessagePart) -> some View {
        switch part.type {
        case "text":
            let displayedText = isFromUser
                ? AgentImageRequestMode.userVisibleText(from: part.text)
                : part.text
            if !displayedText.isBlank {
                Text(displayedText)
                    .font(.system(size: 15))
                    .foregroundColor(isFromUser ? AppColors.sentBubbleText : AppColors.receivedBubbleText)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 9)
                    .background {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(
                                isFromUser
                                    ? AnyShapeStyle(AppColors.sentBubbleGradient)
                                    : AnyShapeStyle(AppColors.cardBackground)
                            )
                    }
                    .overlay {
                        if !isFromUser {
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(AppColors.separator.opacity(0.7), lineWidth: 0.5)
                        }
                    }
                    .textSelection(.enabled)
            }
        case "input_image":
            if replyImageTarget == nil,
               let imageURL = AgentGalleryMediaResolver.imageURL(for: part) {
                AgentAuthenticatedImage(path: imageURL)
                    .frame(
                        width: historyImageSize(for: part).width,
                        height: historyImageSize(for: part).height
                    )
                    .clipShape(RoundedRectangle(
                        cornerRadius: ChatMediaLayout.mediaCornerRadius,
                        style: .continuous
                    ))
                    .contentShape(Rectangle())
                    .onTapCaptureFrame(sourceID: imageURL) { frame in
                        guard !menuOwnsTouchSequence else { return }
                        onImageTap(imageURL, frame)
                    }
                    .accessibilityLabel("查看大图")
                    .accessibilityHint("长按可回复并调整图片")
                    .accessibilityAddTraits(.isButton)
                    .messageMenuLongPress(
                        onLongPress: { frame in
                            guard let target = AgentGalleryMediaResolver.imageReplyTarget(
                                for: part,
                                in: message
                            ) else { return }
                            menuOwnsTouchSequence = true
                            onImageMenuRequested(target, frame)
                        },
                        onTouchSequenceEnded: releaseMenuTouchOwnership
                    )
            }
        case "paid_media":
            AgentPaidMediaView(
                messageID: message.id,
                isFromUser: isFromUser,
                part: part,
                isUnlocking: part.referenceID.map(unlockingMediaIDs.contains) ?? false,
                onUnlock: onUnlock,
                onImageTap: onImageTap,
                onImageMenuRequested: onImageMenuRequested,
                onImageMenuTouchSequenceEnded: onImageMenuTouchSequenceEnded
            )
        default:
            EmptyView()
        }
    }

    private func replyPreview(_ target: AgentImageReplyTarget) -> some View {
        ImageReplyReferenceView(
            senderName: target.senderLabel,
            detailText: "图片",
            style: .bubble(isFromMe: isFromUser)
        ) {
            AgentAuthenticatedImage(path: target.imagePath)
        }
        .contentShape(Rectangle())
        .onTapCaptureFrame(sourceID: target.imagePath) { frame in
            guard !menuOwnsTouchSequence else { return }
            onImageTap(target.imagePath, frame)
        }
        .accessibilityHint("长按可继续回复并调整")
        .messageMenuLongPress(
            onLongPress: { frame in
                menuOwnsTouchSequence = true
                onImageMenuRequested(target, frame)
            },
            onTouchSequenceEnded: releaseMenuTouchOwnership
        )
    }

    private func releaseMenuTouchOwnership() {
        onImageMenuTouchSequenceEnded()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            menuOwnsTouchSequence = false
        }
    }

    private func historyImageSize(for part: AgentMessagePart) -> CGSize {
        let imageSize: CGSize?
        if let width = part.metadata.width,
           let height = part.metadata.height,
           width > 0,
           height > 0 {
            imageSize = CGSize(width: CGFloat(width), height: CGFloat(height))
        } else {
            imageSize = nil
        }
        return ChatMediaLayout.imageThumbnailSize(for: imageSize)
    }
}

struct AgentPaidMediaView: View {
    let messageID: String
    let isFromUser: Bool
    let part: AgentMessagePart
    let isUnlocking: Bool
    let onUnlock: (String, MediaUnlockPaymentMethod) -> Void
    let onImageTap: (String, CGRect) -> Void
    let onImageMenuRequested: (AgentImageReplyTarget, CGRect) -> Void
    let onImageMenuTouchSequenceEnded: () -> Void
    @State private var videoPreviewItem: VideoPreviewItem?
    @State private var menuOwnsTouchSequence = false

    private var metadata: AgentPartMetadata { part.metadata }
    private var status: String { AgentPaidMediaStatePolicy.displayStatus(for: metadata) }
    private var isUnlocked: Bool { metadata.access == "unlocked" }
    private var mediaID: String? { part.referenceID }
    private var mediaKind: MediaUnlockKind { MediaUnlockKind(mediaType: metadata.mediaType) }
    private var aspectRatio: CGFloat {
        guard let width = metadata.width, let height = metadata.height, width > 0, height > 0 else {
            return 16 / 9
        }
        return CGFloat(width) / CGFloat(height)
    }

    private var historyMediaSize: CGSize {
        guard mediaKind == .video else {
            let imageSize = CGSize(
                width: CGFloat(metadata.width ?? 0),
                height: CGFloat(metadata.height ?? 0)
            )
            return ChatMediaLayout.imageThumbnailSize(for: imageSize)
        }
        if aspectRatio < 0.9 { return ChatMediaLayout.portraitVideoSize }
        if aspectRatio > 1.1 { return ChatMediaLayout.landscapeVideoSize }
        return ChatMediaLayout.squareVideoSize
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            mediaContent
                .frame(width: historyMediaSize.width, height: historyMediaSize.height)
                .background(AppColors.separator)
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

            if isUnlocked, let downloadURL = metadata.downloadURL ?? metadata.contentURL {
                Button {
                    Task {
                        if mediaKind == .video {
                            await MediaLibrarySaver.saveVideo(mediaPath: downloadURL)
                        } else {
                            await MediaLibrarySaver.saveImage(mediaPath: downloadURL)
                        }
                    }
                } label: {
                    Label(
                        L10n.tr("mediaUnlock.save.\(mediaKind.rawValue)"),
                        systemImage: "square.and.arrow.down"
                    )
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                }
                .buttonStyle(.plain)
            }
        }
        .fullScreenCover(item: $videoPreviewItem) { item in
            VideoPlayerView(videoURL: item.url)
        }
    }

    @ViewBuilder
    private var mediaContent: some View {
        switch status {
        case "failed":
            statePlaceholder(icon: "exclamationmark.triangle", text: "图片生成失败")
        case "expired":
            statePlaceholder(icon: "clock.badge.exclamationmark", text: "图片已过期")
        case "ready_locked" where isUnlocked:
            if mediaKind == .video,
               let contentURL = metadata.contentURL ?? metadata.downloadURL {
                ZStack {
                    if let previewURL = metadata.previewURL {
                        AgentAuthenticatedImage(path: previewURL)
                    } else {
                        Color.black.opacity(0.18)
                    }
                    Circle()
                        .fill(Color.black.opacity(0.42))
                        .frame(width: 44, height: 44)
                    Image(systemName: "play.fill")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.white)
                        .offset(x: 2)
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    videoPreviewItem = VideoPreviewItem(url: contentURL)
                }
                .accessibilityLabel(L10n.tr("mediaUnlock.playVideo"))
                .accessibilityAddTraits(.isButton)
            } else if let contentURL = AgentGalleryMediaResolver.imageURL(for: part) {
                AgentAuthenticatedImage(path: contentURL)
                    .contentShape(Rectangle())
                    .onTapCaptureFrame(sourceID: contentURL) { frame in
                        guard !menuOwnsTouchSequence else { return }
                        onImageTap(contentURL, frame)
                    }
                    .accessibilityLabel("查看大图")
                    .accessibilityHint("长按可回复并调整图片")
                    .accessibilityAddTraits(.isButton)
                    .messageMenuLongPress(
                        onLongPress: { frame in
                            menuOwnsTouchSequence = true
                            onImageMenuRequested(
                                AgentImageReplyTarget(
                                    messageID: messageID,
                                    partID: part.id,
                                    imagePath: contentURL,
                                    isFromUser: isFromUser
                                ),
                                frame
                            )
                        },
                        onTouchSequenceEnded: releaseMenuTouchOwnership
                    )
            } else {
                statePlaceholder(icon: "photo", text: "正在加载原图")
            }
        case "ready_locked":
            ZStack {
                if let previewURL = metadata.previewURL {
                    AgentAuthenticatedImage(path: previewURL, blurRadius: 9)
                } else {
                    Color.black.opacity(0.12)
                }
                Color.black.opacity(0.25)
                VStack(spacing: 10) {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 24, weight: .semibold))
                    Button {
                        guard let mediaID else { return }
                        onUnlock(mediaID, .automatic(mediaKind))
                    } label: {
                        HStack(spacing: 6) {
                            if isUnlocking { ProgressView().tint(.white).scaleEffect(0.7) }
                            Text(
                                isUnlocking
                                    ? L10n.tr("mediaUnlock.unlocking")
                                    : L10n.tr("mediaUnlock.title.\(mediaKind.rawValue)")
                            )
                                .font(.system(size: 13, weight: .semibold))
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(AppColors.accent)
                        .clipShape(Capsule())
                    }
                    .disabled(isUnlocking || mediaID == nil)
                }
                .foregroundColor(.white)
            }
        case "queued", "generating":
            VStack(spacing: 10) {
                ProgressView()
                Text(status == "queued" ? "等待生成图片…" : "正在生成图片…")
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        default:
            statePlaceholder(
                icon: mediaKind == .video ? "video" : "photo",
                text: L10n.tr("mediaUnlock.unavailable")
            )
        }
    }

    private func statePlaceholder(icon: String, text: String) -> some View {
        VStack(spacing: 9) {
            Image(systemName: icon).font(.system(size: 26))
            Text(text).font(.system(size: 13))
        }
        .foregroundColor(AppColors.secondaryText)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func releaseMenuTouchOwnership() {
        onImageMenuTouchSequenceEnded()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            menuOwnsTouchSequence = false
        }
    }
}

enum AgentGalleryMediaResolver {
    static func imageURL(for part: AgentMessagePart) -> String? {
        switch part.type {
        case "input_image":
            guard let assetID = part.assetID, !assetID.isBlank else { return nil }
            return "/agent-assets/\(assetID)/content"
        case "paid_media":
            guard part.metadata.mediaType != "video",
                  part.metadata.access == "unlocked",
                  let contentURL = part.metadata.contentURL,
                  !contentURL.isBlank else { return nil }
            return contentURL
        default:
            return nil
        }
    }

    static func imageURLs(in messages: [AgentMessage]) -> [String] {
        var seen = Set<String>()
        return messages.flatMap(\.orderedParts).compactMap { part in
            guard let url = imageURL(for: part), seen.insert(url).inserted else { return nil }
            return url
        }
    }

    static func imageReplyTarget(
        for part: AgentMessagePart,
        in message: AgentMessage
    ) -> AgentImageReplyTarget? {
        guard let imagePath = imageURL(for: part) else { return nil }
        return AgentImageReplyTarget(
            messageID: message.id,
            partID: part.id,
            imagePath: imagePath,
            isFromUser: message.sender.type == "user"
        )
    }
}

enum AgentHistoryImageReplyResolver {
    static func target(
        for message: AgentMessage,
        messages: [AgentMessage]
    ) -> AgentImageReplyTarget? {
        if let replyToID = message.replyToID,
           let sourceMessage = messages.first(where: { $0.id == replyToID }),
           let target = firstImageTarget(in: sourceMessage) {
            return target
        }

        // The turn payload includes a copy of the source image. This also keeps
        // the history preview working if an older source message is not loaded,
        // or if the accepted message temporarily omits reply_to_id.
        let isImageReply = message.replyToID != nil || message.orderedParts.contains { part in
            part.type == "text" && AgentImageRequestMode.isTransformRequest(text: part.text)
        }
        guard isImageReply else { return nil }
        return firstImageTarget(in: message)
    }

    private static func firstImageTarget(in message: AgentMessage) -> AgentImageReplyTarget? {
        message.orderedParts.lazy.compactMap { part in
            AgentGalleryMediaResolver.imageReplyTarget(for: part, in: message)
        }.first
    }
}

struct AgentAuthenticatedImage: View {
    let path: String
    var blurRadius: CGFloat = 0
    @State private var image: UIImage?
    @State private var didFail = false

    init(path: String, blurRadius: CGFloat = 0) {
        self.path = path
        self.blurRadius = blurRadius
        _image = State(initialValue: ImageCacheManager.shared.image(for: Self.cacheKey(for: path)))
    }

    private var cacheKey: String {
        Self.cacheKey(for: path)
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .blur(radius: blurRadius)
            } else if didFail {
                ZStack {
                    AppColors.separator
                    Image(systemName: "photo.badge.exclamationmark")
                        .foregroundColor(AppColors.secondaryText)
                }
            } else {
                ZStack {
                    AppColors.separator
                    ProgressView()
                }
            }
        }
        .clipped()
        .transaction { transaction in
            transaction.animation = nil
        }
        .onAppear {
            if let cached = ImageCacheManager.shared.image(for: cacheKey) {
                image = cached
                didFail = false
            }
        }
        .task(id: cacheKey) {
            if let cached = ImageCacheManager.shared.image(for: cacheKey) {
                image = cached
                didFail = false
                return
            }

            image = nil
            didFail = false
            let loaded = await ImageCacheManager.shared.loadImage(from: cacheKey)
            guard !Task.isCancelled else { return }
            if let loaded {
                image = loaded
            } else {
                didFail = true
            }
        }
    }

    private static func cacheKey(for path: String) -> String {
        MediaURLResolver.resolve(path)?.absoluteString
            ?? path.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
