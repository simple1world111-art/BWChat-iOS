// BWChat/Views/MessageBubble.swift
// Premium gradient message bubble with avatar

import SwiftUI
import AVFoundation
import UIKit

struct MessageBubble: View {
    let message: Message
    let isFromMe: Bool
    var avatarURL: String = ""
    /// Second arg is the thumbnail's global-coordinate frame at tap time,
    /// so the caller can pass it to the full-screen gallery for a
    /// WeChat-style grow-from-thumbnail animation.
    var onImageTap: ((String, CGRect) -> Void)?
    var onVideoTap: ((String) -> Void)?
    var onReply: ((Message) -> Void)?
    var onQuoteTap: ((Int) -> Void)?
    var peerName: String?
    var peerUserID: String?
    var recipientAvatarURL: String?
    var onChatMoneyTap: ((ChatMoneyPayload) -> Void)?

    @State private var swipeOffset: CGFloat = 0

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
        HStack(alignment: .bottom, spacing: 8) {
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
                if let reply = message.replyTo {
                    let senderName = reply.senderID == AuthManager.shared.currentUser?.userID ? L10n.tr("common.me") : UserCacheManager.shared.getUser(reply.senderID)?.nickname ?? reply.senderID
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
                } else if message.isVoice {
                    VoiceBubbleView(
                        url: message.voiceURL ?? "",
                        duration: message.voiceDuration,
                        isFromMe: isFromMe
                    )
                } else if let moneyPayload = message.chatMoneyPayload {
                    ChatMoneyBubble(
                        payload: moneyPayload,
                        timeText: message.formattedTime,
                        isFromMe: isFromMe,
                        onTap: { onChatMoneyTap?(moneyPayload) }
                    )
                    .onLongPressGesture(minimumDuration: 0.5) {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        showMenu = true
                    }
                    .confirmationDialog("", isPresented: $showMenu, titleVisibility: .hidden) {
                        Button(L10n.tr("common.reply")) { onReply?(message) }
                        Button(L10n.tr("common.cancel"), role: .cancel) {}
                    }
                } else if let stickerPayload = message.stickerPayload {
                    StickerMessageBubble(
                        payload: stickerPayload,
                        timeText: message.formattedTime,
                        isFromMe: isFromMe
                    )
                    .onLongPressGesture(minimumDuration: 0.5) {
                        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                        impactFeedback.impactOccurred()
                        showMenu = true
                    }
                    .confirmationDialog("", isPresented: $showMenu, titleVisibility: .hidden) {
                        Button(L10n.tr("common.reply")) { onReply?(message) }
                        Button(L10n.tr("common.cancel"), role: .cancel) {}
                    }
                } else if let giftPayload = message.giftPayload {
                    giftBubble(giftPayload)
                } else {
                    textBubble
                }
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
        TimestampedTextBubble(
            content: message.content,
            timeText: message.formattedTime,
            isFromMe: isFromMe
        )
            .onLongPressGesture(minimumDuration: 0.5) {
                let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                impactFeedback.impactOccurred()
                showMenu = true
            }
            .confirmationDialog("", isPresented: $showMenu, titleVisibility: .hidden) {
                Button(L10n.tr("common.copy")) { UIPasteboard.general.string = message.content }
                Button(L10n.tr("common.reply")) { onReply?(message) }
                Button(L10n.tr("common.cancel"), role: .cancel) {}
            }
    }

    // MARK: - Image Bubble

    private var imageBubble: some View {
        CachedAsyncImage(url: message.content)
            .shadow(color: .black.opacity(0.06), radius: 4, x: 0, y: 2)
            .onTapCaptureFrame { frame in
                onImageTap?(message.content, frame)
            }
            .longPressToSaveImage(url: message.content)
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
        .longPressToSaveVideo(url: message.content)
    }

    private func giftBubble(_ payload: GiftMessagePayload) -> some View {
        GiftMessageBubble(
            payload: payload,
            timeText: message.formattedTime,
            isFromMe: isFromMe,
            recipientFallback: isFromMe ? peerName : L10n.tr("common.me"),
            recipientIDFallback: isFromMe
                ? peerUserID
                : AuthManager.shared.currentUser?.userID,
            recipientAvatarFallback: recipientAvatarURL
        )
        .onLongPressGesture(minimumDuration: 0.5) {
            let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
            impactFeedback.impactOccurred()
            showMenu = true
        }
        .confirmationDialog("", isPresented: $showMenu, titleVisibility: .hidden) {
            Button(L10n.tr("common.reply")) { onReply?(message) }
            Button(L10n.tr("common.cancel"), role: .cancel) {}
        }
    }
}

struct TimestampedTextBubble: View {
    let content: String
    let timeText: String
    let isFromMe: Bool
    var senderName: String?

    private var textColor: Color {
        isFromMe ? .white : AppColors.primaryText
    }

    private var timeColor: Color {
        isFromMe ? .white.opacity(0.72) : AppColors.secondaryText
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            VStack(alignment: .leading, spacing: senderName == nil ? 0 : 4) {
                if let senderName, !senderName.isEmpty {
                    Text(senderName)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)
                }

                Text(content)
                    .font(.system(size: 16))
                    .foregroundColor(textColor)
                + Text("  \(timeText)")
                    .font(.system(size: 13))
                    .foregroundColor(.clear)
            }
            .fixedSize(horizontal: false, vertical: true)

            Text(timeText)
                .font(.system(size: 13))
                .foregroundColor(timeColor)
                .monospacedDigit()
                .padding(.leading, 8)
        }
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
    @StateObject private var player = VoicePlayerManager()

    var displayDuration: String {
        let d = player.isPlaying ? player.currentTime : duration
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
            if player.isPlaying {
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
                    .frame(width: 2, height: player.isPlaying ? CGFloat([8, 14, 10][i]) : CGFloat([6, 10, 6][i]))
                    .animation(
                        player.isPlaying
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
    @Published var isPlaying = false
    @Published var currentTime: Double = 0
    private var player: AVAudioPlayer?
    private var timer: Timer?
    private var downloadTask: URLSessionDataTask?
    private let delegate = VoicePlayerDelegateHandler()

    func play(urlString: String) {
        stop()

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
    var maxWidth: CGFloat = 160
    @State private var image: UIImage?
    @State private var isLoading = true

    private var thumbCacheKey: String { url + "?thumb=1" }

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
        .onAppear {
            if image == nil, let cached = ImageCacheManager.shared.image(for: thumbCacheKey) {
                image = cached
                isLoading = false
            }
        }
        .task(id: url) {
            if image == nil {
                image = await ImageCacheManager.shared.loadImage(from: url, thumbnail: true)
            }
            isLoading = false
        }
    }
}
