// BWChat/Views/MessageBubble.swift
// Premium gradient message bubble with avatar

import SwiftUI
import AVFoundation
import UIKit

struct MessageBubble: View {
    let message: Message
    let isFromMe: Bool
    let resolvedReply: ReplyPreview?
    var avatarURL: String = ""
    /// Second arg is the thumbnail's global-coordinate frame at tap time,
    /// so the caller can pass it to the full-screen gallery for a
    /// WeChat-style grow-from-thumbnail animation.
    var onImageTap: ((String, CGRect) -> Void)?
    var onVideoTap: ((String) -> Void)?
    var onQuoteTap: ((Int) -> Void)?
    var onMenuRequested: ((CGRect) -> Void)?
    var onMenuTouchSequenceEnded: (() -> Void)?
    var recalledEditableText: String?
    var onReeditRecalledText: ((String) -> Void)?
    var peerName: String?
    var peerUserID: String?
    var recipientAvatarURL: String?
    var hasViewerClaimedRedPacket = false
    /// Pass the enclosing message direction with the payload. The row direction
    /// remains reliable while HTTP, history and WebSocket snapshots are merging.
    var onChatMoneyTap: ((ChatMoneyPayload, Bool) -> Void)?
    var onForwardBundleTap: ((String) -> Void)?
    @ObservedObject private var appConfig = AppRemoteConfigStore.shared
    @State private var menuOwnsTouchSequence = false

    private var avatarUserID: String {
        if isFromMe {
            return AuthManager.shared.currentUser?.userID ?? message.senderID
        }
        return message.senderID
    }

    private var avatarAccessibilityName: String {
        isFromMe ? L10n.tr("common.me") : (peerName ?? message.senderID)
    }

    var body: some View {
        if message.isRecalled {
            RecalledMessageTip(
                senderName: peerName ?? message.senderID,
                isFromMe: isFromMe,
                canReedit: isFromMe && recalledEditableText != nil,
                onReedit: {
                    guard let recalledEditableText else { return }
                    onReeditRecalledText?(recalledEditableText)
                }
            )
        } else if let receipt = message.chatMoneyReceiptPayload {
            ChatMoneyReceiptTip(payload: receipt)
        } else if message.isSystem {
            HStack {
                Spacer()
                Text(message.content)
                    .font(.system(size: 12))
                    .foregroundColor(AppColors.secondaryText)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 5)
                    .background(AppColors.separator.opacity(0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                Spacer()
            }
            .padding(.vertical, 4)
        } else {
        HStack(alignment: .top, spacing: 8) {
            if isFromMe { Spacer(minLength: 40) }

            if !isFromMe {
                UserAvatarButton(
                    userID: avatarUserID,
                    avatarURL: avatarURL,
                    size: 36,
                    accessibilityName: avatarAccessibilityName
                )
            }

            VStack(alignment: isFromMe ? .trailing : .leading, spacing: 2) {
                if let reply = resolvedReply {
                    let senderName = reply.senderID == AuthManager.shared.currentUser?.userID ? L10n.tr("common.me") : UserCacheManager.shared.getUser(reply.senderID)?.nickname ?? reply.senderID
                    QuotedMessageView(
                        senderName: senderName,
                        content: reply.content,
                        msgType: reply.msgType,
                        isFromMe: isFromMe,
                        onTap: { onQuoteTap?(reply.id) }
                    )
                }

                messageContent
                    .messageMenuLongPress(
                        onLongPress: { frame in
                            menuOwnsTouchSequence = true
                            onMenuRequested?(frame)
                        },
                        onTouchSequenceEnded: releaseMenuTouchOwnership
                    )
            }

            if isFromMe {
                UserAvatarButton(
                    userID: avatarUserID,
                    avatarURL: avatarURL,
                    size: 36,
                    accessibilityName: avatarAccessibilityName
                )
            }

            if !isFromMe { Spacer(minLength: 40) }
        }
        .padding(.vertical, 2)
        }
    }

    @ViewBuilder
    private var messageContent: some View {
        if appConfig.featureFlags.isEnabled("message_forward_merged_render_v1", default: true),
           let bundle = ForwardBundleMessagePayload.parse(message.content, messageType: message.msgType) {
            ForwardBundleMessageCard(payload: bundle, isFromMe: isFromMe) {
                guard !menuOwnsTouchSequence else { return }
                onForwardBundleTap?(bundle.bundleID)
            }
        } else if message.isImage {
            imageBubble
        } else if message.isVideo {
            videoBubble
        } else if message.isVoice {
            VoiceBubbleView(
                url: message.voiceURL ?? "",
                duration: message.voiceDuration,
                isFromMe: isFromMe
            )
        } else if let moneyPayload = message.chatMoneyPayload {
            ChatMoneyBubble(
                payload: moneyPayload,
                isFromMe: isFromMe,
                hasViewerClaimedRedPacket: hasViewerClaimedRedPacket,
                onTap: {
                    guard !menuOwnsTouchSequence else { return }
                    onChatMoneyTap?(moneyPayload, isFromMe)
                }
            )
        } else if let stickerPayload = message.stickerPayload {
            StickerMessageBubble(
                payload: stickerPayload,
                isFromMe: isFromMe
            )
        } else if let giftPayload = message.giftPayload {
            giftBubble(giftPayload)
        } else if let callRecord = message.callRecord {
            CallRecordBubble(
                record: callRecord,
                isFromMe: isFromMe
            )
        } else {
            textBubble
        }
    }

    private func releaseMenuTouchOwnership() {
        onMenuTouchSequenceEnded?()
        // Keep the gate through the touch-up delivery pass. SwiftUI Button can
        // otherwise commit its action after UILongPressGestureRecognizer ended.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            menuOwnsTouchSequence = false
        }
    }

    // MARK: - Gradient Text Bubble

    private var textBubble: some View {
        TimestampedTextBubble(
            content: message.content,
            isFromMe: isFromMe
        )
    }

    // MARK: - Image Bubble

    private var imageBubble: some View {
        CachedAsyncImage(
            url: message.content,
            previewURL: message.thumbnailURL
        )
            .onTapCaptureFrame(sourceID: message.content) { frame in
                guard !menuOwnsTouchSequence else { return }
                onImageTap?(message.content, frame)
            }
    }

    // MARK: - Video Bubble

    private var videoBubble: some View {
        VideoThumbnailView(
            videoURL: message.content,
            thumbnailURL: message.thumbnailURL,
            showsPlayIndicator: true
        )
        .onTapGesture {
            guard !menuOwnsTouchSequence else { return }
            onVideoTap?(message.content)
        }
    }

    private func giftBubble(_ payload: GiftMessagePayload) -> some View {
        GiftMessageBubble(
            payload: payload,
            isFromMe: isFromMe,
            recipientFallback: isFromMe ? peerName : L10n.tr("common.me"),
            recipientIDFallback: isFromMe
                ? peerUserID
                : AuthManager.shared.currentUser?.userID,
            recipientAvatarFallback: recipientAvatarURL
        )
    }
}

struct RecalledMessageTip: View {
    let senderName: String
    let isFromMe: Bool
    let canReedit: Bool
    let onReedit: () -> Void

    var body: some View {
        HStack(spacing: 5) {
            Text(isFromMe
                ? L10n.tr("chat.recall.selfNotice")
                : L10n.tr("chat.recall.otherNotice", senderName))
                .foregroundColor(AppColors.secondaryText)

            if canReedit {
                Button(L10n.tr("chat.recall.reedit"), action: onReedit)
                    .buttonStyle(.plain)
                    .foregroundColor(AppColors.accent)
            }
        }
        .font(.system(size: 12))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 7)
        .accessibilityElement(children: .combine)
    }
}

struct CallRecordBubble: View {
    let record: CallRecordContent
    let isFromMe: Bool

    private var foregroundColor: Color {
        isFromMe ? .white : AppColors.primaryText
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Text(record.localizedDetail(isFromMe: isFromMe))
                .font(.system(size: 16))
                .foregroundStyle(foregroundColor)
                .lineLimit(2)

            Image(systemName: record.systemImage)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(foregroundColor)
                .frame(width: 28, height: 28)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background {
            if isFromMe {
                AppColors.sentBubbleGradient
            } else {
                AppColors.receivedBubble
            }
        }
        .cornerRadius(
            18,
            corners: isFromMe
                ? [.topLeft, .topRight, .bottomLeft]
                : [.topLeft, .topRight, .bottomRight]
        )
        .accessibilityElement(children: .combine)
    }
}

struct TimestampedTextBubble: View {
    let content: String
    let isFromMe: Bool
    var senderName: String?

    private var textColor: Color {
        isFromMe ? .white : AppColors.primaryText
    }

    var body: some View {
        VStack(alignment: .leading, spacing: senderName == nil ? 0 : 4) {
            if let senderName, !senderName.isEmpty {
                Text(senderName)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(1)
            }

            Text(content.trimmingTrailingLineBreaks)
                .font(.system(size: 16))
                .foregroundColor(textColor)
        }
        .fixedSize(horizontal: false, vertical: true)
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

// MARK: - Voice Bubble

struct VoiceBubbleView: View {
    let url: String
    let duration: Double
    let isFromMe: Bool
    @ObservedObject private var player = VoicePlayerManager.shared

    private var isPlaying: Bool {
        player.isPlaying(urlString: url)
    }

    var displayDuration: String {
        let d = isPlaying ? player.currentTime : duration
        let secs = Int(d)
        return "\(secs)\""
    }

    private var bubbleWidth: CGFloat {
        let minW: CGFloat = 80
        let maxW: CGFloat = 200
        let perSec: CGFloat = 8
        return min(max(minW, minW + CGFloat(duration) * perSec), maxW)
    }

    var body: some View {
        HStack(spacing: 6) {
            if !isFromMe {
                voiceWaveIcon
                Spacer()
                Text(displayDuration)
                    .font(.system(size: 14))
                    .foregroundColor(isFromMe ? .white : AppColors.primaryText)
            } else {
                Text(displayDuration)
                    .font(.system(size: 14))
                    .foregroundColor(isFromMe ? .white : AppColors.primaryText)
                Spacer()
                voiceWaveIcon
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(width: bubbleWidth)
        .background(
            Group {
                if isFromMe {
                    AppColors.sentBubbleGradient
                } else {
                    LinearGradient(
                        colors: [AppColors.receivedBubble, AppColors.receivedBubble],
                        startPoint: .top, endPoint: .bottom
                    )
                }
            }
        )
        .cornerRadius(18, corners: isFromMe ? [.topLeft, .topRight, .bottomLeft] : [.topLeft, .topRight, .bottomRight])
        .contentShape(Rectangle())
        .onTapGesture {
            if isPlaying {
                player.stop()
            } else {
                player.play(urlString: url)
            }
        }
    }

    private var voiceWaveIcon: some View {
        HStack(spacing: 2) {
            ForEach(0..<3, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1)
                    .fill(isFromMe ? Color.white : AppColors.primaryText)
                    .frame(width: 2, height: isPlaying ? CGFloat([8, 14, 10][i]) : CGFloat([6, 10, 6][i]))
                    .animation(
                        isPlaying
                            ? .easeInOut(duration: 0.4).repeatForever(autoreverses: true).delay(Double(i) * 0.15)
                            : .default,
                        value: player.isPlaying
                    )
            }
        }
    }
}

@MainActor
class VoicePlayerManager: ObservableObject {
    static let shared = VoicePlayerManager()

    @Published var isPlaying = false
    @Published var currentTime: Double = 0
    @Published private(set) var currentURL: String?
    private var player: AVAudioPlayer?
    private var timer: Timer?
    private var downloadTask: URLSessionDataTask?
    private let delegate = VoicePlayerDelegateHandler()

    func play(urlString: String) {
        stop()
        currentURL = urlString

        let fullURLString: String
        if urlString.hasPrefix("http") {
            fullURLString = urlString
        } else if let baseURL = URL(string: APIService.shared.baseURL),
                  let scheme = baseURL.scheme, let host = baseURL.host {
            let port = baseURL.port.map { ":\($0)" } ?? ""
            fullURLString = "\(scheme)://\(host)\(port)\(urlString)"
        } else {
            return
        }
        guard let url = URL(string: fullURLString) else { return }

        var request = URLRequest(url: url)
        AuthRequestAuthorizer.addAuthHeader(&request, token: AuthManager.shared.token)
        AuthRequestAuthorizer.logFinalRequest(request, expectsAuthorization: true)

        downloadTask = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let data = data, error == nil else { return }
            DispatchQueue.main.async {
                self?.playData(data)
            }
        }
        downloadTask?.resume()
    }

    private func playData(_ data: Data) {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            player = try AVAudioPlayer(data: data)
            delegate.onFinish = { [weak self] in
                DispatchQueue.main.async { self?.stop() }
            }
            player?.delegate = delegate
            player?.play()
            isPlaying = true
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                DispatchQueue.main.async {
                    self?.currentTime = self?.player?.currentTime ?? 0
                }
            }
        } catch { }
    }

    func stop() {
        player?.stop()
        player = nil
        timer?.invalidate()
        timer = nil
        downloadTask?.cancel()
        downloadTask = nil
        isPlaying = false
        currentTime = 0
        currentURL = nil
    }

    func isPlaying(urlString: String) -> Bool {
        isPlaying && currentURL == urlString
    }
}

class VoicePlayerDelegateHandler: NSObject, AVAudioPlayerDelegate {
    var onFinish: (() -> Void)?

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        onFinish?()
    }
}

// MARK: - Cached Async Image

struct CachedAsyncImage: View {
    let url: String
    let previewURL: String?
    var fixedSize: CGSize?
    @State private var image: UIImage?

    private var thumbCacheKey: String {
        previewURL?.chatMediaNonEmpty ?? url + "?thumb=1"
    }

    init(url: String, previewURL: String? = nil, size: CGSize? = nil) {
        self.url = url
        self.previewURL = previewURL
        self.fixedSize = size
        let key = previewURL?.chatMediaNonEmpty ?? url + "?thumb=1"
        _image = State(initialValue: ImageCacheManager.shared.image(for: key))
    }

    private var displaySize: CGSize {
        fixedSize ?? ChatMediaLayout.imageThumbnailSize(for: image?.size)
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: ChatMediaLayout.mediaCornerRadius)
                .fill(AppColors.separator)

            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "photo")
                    .foregroundColor(AppColors.secondaryText)
            }
        }
        .frame(width: displaySize.width, height: displaySize.height)
        .clipped()
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
        .transaction { transaction in
            transaction.animation = nil
        }
        .task(id: thumbCacheKey) {
            let requestedKey = thumbCacheKey
            if let cached = ImageCacheManager.shared.image(for: requestedKey) {
                image = cached
                return
            }

            // SwiftUI can reuse this view for another message while preserving
            // @State. Never let the previous message's pixels stand in for the
            // new URL while its thumbnail is loading.
            image = nil
            let loaded: UIImage?
            if let previewURL = previewURL?.chatMediaNonEmpty {
                loaded = await ImageCacheManager.shared.loadImage(from: previewURL)
            } else {
                loaded = await ImageCacheManager.shared.loadImage(from: url, thumbnail: true)
            }
            guard !Task.isCancelled, requestedKey == thumbCacheKey else { return }
            image = loaded
        }
    }
}
