// BWChat/Views/ShortDramaVideoPage.swift
// A single full-screen short drama video page.

import AVFoundation
import SwiftUI
import UIKit

struct ShortDramaVideoPage: View {
    let video: ShortDramaVideo
    let player: AVPlayer?
    let isActive: Bool
    let isPlaybackPaused: Bool
    let isPlaybackTarget: Bool
    let onTogglePlayback: () -> Void
    let onToggleLike: () -> Void
    let onToggleFavorite: () -> Void
    let onToggleFollow: () -> Void
    let onOpenComments: () -> Void
    let onOpenCreator: () -> Void

    @State private var hasRenderedFirstFrame = false

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black
                    .ignoresSafeArea()

                ShortDramaPlayerSurface(player: player) {
                    hasRenderedFirstFrame = true
                }
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .clipped()
                    .ignoresSafeArea()

                ShortDramaCoverBackdrop(url: video.coverURL)
                    .opacity(shouldShowCover ? 1 : 0)
                    .animation(.easeOut(duration: 0.18), value: shouldShowCover)
                    .frame(width: proxy.size.width, height: proxy.size.height)

                LinearGradient(
                    colors: [.clear, .black.opacity(0.66)],
                    startPoint: .center,
                    endPoint: .bottom
                )
                .ignoresSafeArea()

                videoTapTarget

                playbackButton

                if video.requiresUnlock {
                    VStack(spacing: 9) {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 24, weight: .bold))
                        Text(L10n.tr("shortDrama.unlock.confirmMessage", video.unlockPriceCatFood ?? 0))
                            .font(.subheadline.weight(.bold))
                            .multilineTextAlignment(.center)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                    .background(Color.black.opacity(0.58))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.horizontal, 36)
                }

                HStack(alignment: .bottom, spacing: 14) {
                    bottomMetadata

                    ShortDramaActionRail(
                        video: video,
                        onToggleFollow: onToggleFollow,
                        onToggleLike: onToggleLike,
                        onToggleFavorite: onToggleFavorite,
                        onOpenComments: onOpenComments,
                        onOpenCreator: onOpenCreator
                    )
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .bottom)

                if shouldShowLoadingIndicator {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(1.1)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .background(Color.black)
        .ignoresSafeArea()
        .onChange(of: video.id) { _ in
            hasRenderedFirstFrame = false
        }
        .onChange(of: player == nil) { isNil in
            if isNil {
                hasRenderedFirstFrame = false
            }
        }
    }

    private var shouldShowCover: Bool {
        player == nil || !hasRenderedFirstFrame
    }

    private var shouldShowLoadingIndicator: Bool {
        !video.requiresUnlock && (player == nil || (isPlaybackTarget && !hasRenderedFirstFrame))
    }

    private var videoTapTarget: some View {
        Color.clear
            .contentShape(Rectangle())
            .ignoresSafeArea()
            .onTapGesture {
                guard isPlaybackTarget, !video.requiresUnlock else { return }
                onTogglePlayback()
            }
    }

    private var playbackButton: some View {
        Button(action: onTogglePlayback) {
            Image(systemName: "play.fill")
                .font(.system(size: 28, weight: .bold))
                .foregroundColor(.white)
                .frame(width: 74, height: 74)
                .background(Color.black.opacity(0.42))
                .clipShape(Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.18), lineWidth: 1))
                .shadow(color: .black.opacity(0.45), radius: 16, x: 0, y: 6)
        }
        .buttonStyle(.plain)
        .opacity(isPlaybackTarget && isPlaybackPaused ? 1 : 0)
        .allowsHitTesting(isPlaybackTarget && isPlaybackPaused)
        .animation(.easeInOut(duration: 0.18), value: isPlaybackPaused)
        .accessibilityLabel(L10n.tr("common.play"))
    }

    private var bottomMetadata: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("@\(video.creator.nickname)")
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(.white)
                .lineLimit(1)

            Text(video.dramaTitle.isBlank ? video.displayTitle : video.dramaTitle)
                .font(.system(size: 17, weight: .bold))
                .foregroundColor(.white)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            Text(video.displayIntro)
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.white.opacity(0.88))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                Text(video.episodeText)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.white.opacity(0.16))
                    .clipShape(Capsule())

                if !video.title.isBlank, video.title != video.dramaTitle {
                    Text(video.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white.opacity(0.84))
                        .lineLimit(1)
                }
            }
        }
        .shadow(color: .black.opacity(0.5), radius: 8, x: 0, y: 2)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

}

private struct ShortDramaPlayerSurface: UIViewRepresentable {
    let player: AVPlayer?
    let onReadyForDisplay: () -> Void

    func makeUIView(context: Context) -> PlayerSurfaceView {
        let view = PlayerSurfaceView()
        view.playerLayer.videoGravity = .resizeAspectFill
        view.onReadyForDisplay = onReadyForDisplay
        view.setPlayer(player)
        return view
    }

    func updateUIView(_ uiView: PlayerSurfaceView, context: Context) {
        uiView.onReadyForDisplay = onReadyForDisplay
        uiView.setPlayer(player)
    }

    final class PlayerSurfaceView: UIView {
        var onReadyForDisplay: (() -> Void)?
        private var readyForDisplayObservation: NSKeyValueObservation?
        private var hasNotifiedReadyForDisplay = false

        override static var layerClass: AnyClass {
            AVPlayerLayer.self
        }

        var playerLayer: AVPlayerLayer {
            layer as! AVPlayerLayer
        }

        func setPlayer(_ player: AVPlayer?) {
            if playerLayer.player === player {
                notifyIfReady()
                return
            }

            readyForDisplayObservation?.invalidate()
            readyForDisplayObservation = nil
            hasNotifiedReadyForDisplay = false
            playerLayer.player = player
            observeReadyForDisplay()
        }

        private func observeReadyForDisplay() {
            guard playerLayer.player != nil else { return }
            readyForDisplayObservation = playerLayer.observe(\.isReadyForDisplay, options: [.initial, .new]) { [weak self] layer, _ in
                guard layer.isReadyForDisplay else { return }
                DispatchQueue.main.async {
                    self?.notifyIfReady()
                }
            }
        }

        private func notifyIfReady() {
            guard playerLayer.player != nil,
                  playerLayer.isReadyForDisplay,
                  !hasNotifiedReadyForDisplay else { return }
            hasNotifiedReadyForDisplay = true
            let callback = onReadyForDisplay
            readyForDisplayObservation?.invalidate()
            readyForDisplayObservation = nil
            DispatchQueue.main.async {
                callback?()
            }
        }

        deinit {
            readyForDisplayObservation?.invalidate()
        }
    }
}

private struct ShortDramaCoverBackdrop: View {
    let url: String
    @State private var image: UIImage?

    private var resolvedPath: String {
        if url.isEmpty { return "" }
        if url.hasPrefix("/") || url.hasPrefix("http") { return url }
        return "/api/v1/" + url
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                LinearGradient(
                    colors: [Color(hex: "171725"), Color.black],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .task(id: url) {
            let path = resolvedPath
            guard !path.isEmpty else {
                image = nil
                return
            }
            image = await ImageCacheManager.shared.loadImage(from: path)
        }
    }
}
