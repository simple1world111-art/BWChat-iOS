// BWChat/Views/MessageBubble.swift
// Premium gradient message bubble with avatar

import SwiftUI
import AVFoundation
import UIKit

struct MessageBubble: View {
    let message: Message
    let isFromMe: Bool
    var avatarURL: String = ""
    var onImageTap: ((String, UnitPoint) -> Void)?
    var onVideoTap: ((String, UnitPoint) -> Void)?
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
                } else if message.isVoice {
                    VoiceBubbleView(
                        url: message.voiceURL ?? "",
                        duration: message.voiceDuration,
                        isFromMe: isFromMe
                    )
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
            .onTapWithNormalizedAnchor { anchor in
                onImageTap?(message.content, anchor)
            }
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.5)
                    .onEnded { _ in
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        Task { await MediaLibrarySaver.saveImage(mediaPath: message.content) }
                    }
            )
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
        .onTapWithNormalizedAnchor { anchor in
            onVideoTap?(message.content, anchor)
        }
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.5)
                .onEnded { _ in
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    Task { await MediaLibrarySaver.saveVideo(mediaPath: message.content) }
                }
        )
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
        if let token = AuthManager.shared.token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

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
