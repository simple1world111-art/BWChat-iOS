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

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black
                    .ignoresSafeArea()

                ShortDramaCoverBackdrop(url: video.coverURL)
                    .opacity(player == nil ? 1 : 0)
                    .frame(width: proxy.size.width, height: proxy.size.height)

                ShortDramaPlayerSurface(player: player)
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .clipped()
                    .ignoresSafeArea()

                LinearGradient(
                    colors: [.clear, .black.opacity(0.66)],
                    startPoint: .center,
                    endPoint: .bottom
                )
                .ignoresSafeArea()

                videoTapTarget

                playbackButton

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

                if player == nil {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(1.1)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .background(Color.black)
        .ignoresSafeArea()
        .onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemDidPlayToEndTime)) { notification in
            guard isPlaybackTarget,
                  !isPlaybackPaused,
                  let item = notification.object as? AVPlayerItem,
                  item === player?.currentItem else { return }
            player?.seek(to: .zero)
            player?.playImmediately(atRate: 1)
        }
    }

    private var videoTapTarget: some View {
        Color.clear
            .contentShape(Rectangle())
            .ignoresSafeArea()
            .onTapGesture {
                guard isPlaybackTarget else { return }
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

    func makeUIView(context: Context) -> PlayerSurfaceView {
        let view = PlayerSurfaceView()
        view.playerLayer.videoGravity = .resizeAspectFill
        view.playerLayer.player = player
        return view
    }

    func updateUIView(_ uiView: PlayerSurfaceView, context: Context) {
        uiView.playerLayer.player = player
    }

    final class PlayerSurfaceView: UIView {
        override static var layerClass: AnyClass {
            AVPlayerLayer.self
        }

        var playerLayer: AVPlayerLayer {
            layer as! AVPlayerLayer
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
