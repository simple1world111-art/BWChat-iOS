// BWChat/Views/AgentMessageView.swift

import SwiftUI
import UIKit

struct AgentMessageView: View {
    let message: AgentMessage
    let agentAvatarAssetID: String?
    let unlockingMediaIDs: Set<String>
    let onUnlock: (String) -> Void
    let onImageTap: (String, CGRect) -> Void

    private var isFromUser: Bool { message.sender.type == "user" }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isFromUser { Spacer(minLength: 48) }
            if !isFromUser {
                AgentAvatarView(assetID: agentAvatarAssetID, size: 32)
            }

            VStack(alignment: isFromUser ? .trailing : .leading, spacing: 7) {
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
            if !part.text.isBlank {
                Text(part.text)
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
            if let imageURL = AgentGalleryMediaResolver.imageURL(for: part) {
                AgentAuthenticatedImage(path: imageURL)
                    .frame(width: 210, height: 210)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .contentShape(Rectangle())
                    .onTapCaptureFrame { frame in
                        onImageTap(imageURL, frame)
                    }
                    .accessibilityLabel("查看大图")
                    .accessibilityAddTraits(.isButton)
            }
        case "paid_media":
            AgentPaidMediaView(
                part: part,
                isUnlocking: part.referenceID.map(unlockingMediaIDs.contains) ?? false,
                onUnlock: onUnlock,
                onImageTap: onImageTap
            )
        default:
            EmptyView()
        }
    }
}

struct AgentPaidMediaView: View {
    let part: AgentMessagePart
    let isUnlocking: Bool
    let onUnlock: (String) -> Void
    let onImageTap: (String, CGRect) -> Void
    @State private var showUnlockConfirmation = false

    private var metadata: AgentPartMetadata { part.metadata }
    private var status: String { metadata.generationStatus ?? "queued" }
    private var isUnlocked: Bool { metadata.access == "unlocked" }
    private var mediaID: String? { part.referenceID }
    private var aspectRatio: CGFloat {
        guard let width = metadata.width, let height = metadata.height, width > 0, height > 0 else {
            return 2 / 3
        }
        return CGFloat(width) / CGFloat(height)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            mediaContent
                .frame(width: 250, height: min(max(250 / aspectRatio, 180), 360))
                .background(AppColors.separator)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

            if isUnlocked, let downloadURL = metadata.downloadURL ?? metadata.contentURL {
                Button {
                    Task { await MediaLibrarySaver.saveImage(mediaPath: downloadURL) }
                } label: {
                    Label("保存原图", systemImage: "square.and.arrow.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                }
                .buttonStyle(.plain)
            }
        }
        .alert("解锁图片", isPresented: $showUnlockConfirmation) {
            Button("取消", role: .cancel) { }
            Button("确认解锁") {
                if let mediaID { onUnlock(mediaID) }
            }
        } message: {
            Text("将消耗 \(metadata.pricePoints ?? 0) 点，解锁后可永久查看和保存原图。")
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
            if let contentURL = AgentGalleryMediaResolver.imageURL(for: part) {
                AgentAuthenticatedImage(path: contentURL)
                    .contentShape(Rectangle())
                    .onTapCaptureFrame { frame in
                        onImageTap(contentURL, frame)
                    }
                    .accessibilityLabel("查看大图")
                    .accessibilityAddTraits(.isButton)
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
                        showUnlockConfirmation = true
                    } label: {
                        HStack(spacing: 6) {
                            if isUnlocking { ProgressView().tint(.white).scaleEffect(0.7) }
                            Text(isUnlocking ? "解锁中…" : "\(metadata.pricePoints ?? 0) 点解锁")
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
            statePlaceholder(icon: "photo", text: "媒体暂不可用")
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
