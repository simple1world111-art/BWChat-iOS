// BWChat/Views/VideoPlayerView.swift
// Full-screen video player with dismiss support

import SwiftUI
import AVKit
import AVFoundation

struct VideoPlayerView: View {
    let videoURL: String
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?
    @State private var isLoading = true
    @State private var errorOccurred = false
    @State private var verticalDrag: CGFloat = 0
    @State private var resolvedRemoteURL: URL?
    @State private var mediaScale: CGFloat = 1
    @State private var mediaOffset: CGSize = .zero
    @State private var lastMediaOffset: CGSize = .zero
    @State private var isPinching: Bool = false
    @State private var pinchStartScale: CGFloat = 1
    @State private var pinchContentPoint: CGPoint = .zero

    private var backgroundOpacity: Double {
        1.0 - min(abs(verticalDrag) / 320, 0.9)
    }

    private var dismissScale: CGFloat {
        let d = abs(verticalDrag)
        if d < 8 { return 1.0 }
        return max(1.0 - d / 900, 0.55)
    }

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()
                .opacity(backgroundOpacity)

            if let player = player {
                VideoPlayer(player: player)
                    .ignoresSafeArea()
                    .scaleEffect(mediaScale, anchor: .center)
                    .offset(
                        x: mediaOffset.width,
                        y: mediaOffset.height + verticalDrag
                    )
                    .scaleEffect(dismissScale)
                    .onAppear {
                        player.play()
                        if let resolvedRemoteURL {
                            MediaCacheManager.shared.scheduleCache(
                                mediaID: "chat-video:\(videoURL)",
                                remoteURL: resolvedRemoteURL
                            )
                        }
                    }
                    // Simultaneous so the VideoPlayer's own horizontal
                    // scrub gesture keeps working; we only react to
                    // clearly-vertical drags (≥45° off horizontal).
                    .simultaneousGesture(dismissDragGesture)
                    .simultaneousGesture(
                        mediaScale > 1.05 && !isPinching ? mediaPanGesture : nil
                    )
            } else if isLoading {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 40))
                        .foregroundColor(.gray)
                    Text(L10n.tr("video.loadFailed"))
                        .foregroundColor(.gray)
                }
            }

            // Close button — fades out as user drags so it doesn't
            // awkwardly float in place during the dismiss animation.
            VStack {
                HStack {
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 28))
                            .foregroundColor(.white.opacity(0.8))
                    }
                    .padding()
                }
                Spacer()
            }
            .opacity(verticalDrag == 0 ? 1 : 0)
        }
        .background {
            LocationAwarePinchGesture(
                isEnabled: player != nil && verticalDrag == 0,
                onEvent: { event in
                    handlePinch(event)
                }
            )
        }
        .statusBarHidden(true)
        .task {
            await loadVideo()
        }
        .onDisappear {
            MediaCacheManager.shared.cancelScheduledCache(mediaID: "chat-video:\(videoURL)")
            player?.pause()
            player = nil
        }
    }

    private var dismissDragGesture: some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                guard mediaScale <= 1.05, !isPinching else { return }
                let h = value.translation.height
                let w = value.translation.width
                // Require clearly-vertical intent so horizontal gestures
                // over the player's scrub area aren't hijacked.
                if abs(h) > abs(w) {
                    verticalDrag = h
                }
            }
            .onEnded { value in
                guard mediaScale <= 1.05, !isPinching, verticalDrag != 0 else { return }
                let h = abs(value.translation.height)
                let w = abs(value.translation.width)
                let predictedH = abs(value.predictedEndTranslation.height)
                if h > w && (h > 110 || predictedH > 450) {
                    // Dismiss directly. fullScreenCover's own slide-out
                    // animates the view FROM its current visual state
                    // (current verticalDrag / scale) off the bottom —
                    // that's smooth on its own. Running another
                    // withAnimation on verticalDrag in parallel made the
                    // two animations fight and produced the hitch the
                    // user was seeing.
                    dismiss()
                } else if verticalDrag != 0 {
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                        verticalDrag = 0
                    }
                }
            }
    }

    private var mediaPanGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                guard !isPinching else { return }
                mediaOffset = CGSize(
                    width: lastMediaOffset.width + value.translation.width,
                    height: lastMediaOffset.height + value.translation.height
                )
            }
            .onEnded { _ in
                guard !isPinching else { return }
                lastMediaOffset = mediaOffset
            }
    }

    private func handlePinch(_ event: LocationAwarePinchEvent) {
        let viewportCenter = CGPoint(
            x: event.viewportSize.width / 2,
            y: event.viewportSize.height / 2
        )
        let locationFromCenter = CGPoint(
            x: event.location.x - viewportCenter.x,
            y: event.location.y - viewportCenter.y
        )

        switch event.state {
        case .began:
            isPinching = true
            verticalDrag = 0
            pinchStartScale = max(mediaScale, 0.001)
            pinchContentPoint = LocationAwareZoomMath.contentPoint(
                under: locationFromCenter,
                scale: pinchStartScale,
                offset: mediaOffset
            )

        case .changed:
            guard isPinching else { return }
            let newScale = max(pinchStartScale * event.magnification, 0.5)
            mediaScale = newScale
            mediaOffset = LocationAwareZoomMath.offset(
                keeping: pinchContentPoint,
                under: locationFromCenter,
                scale: newScale
            )

        case .ended, .cancelled, .failed:
            guard isPinching else { return }
            isPinching = false
            if mediaScale < 1 {
                withAnimation(.easeOut(duration: 0.2)) {
                    mediaScale = 1
                    mediaOffset = .zero
                }
            }
            lastMediaOffset = mediaOffset

        default:
            break
        }
    }

    private func loadVideo() async {
        // Build the video URL, using the public (no-auth) endpoint.
        // AVPlayer doesn't reliably send custom Authorization headers
        // on all Range requests, so we must use the public endpoint.
        var path = videoURL
        if path.hasPrefix("/api/v1/images/") {
            path = path.replacingOccurrences(of: "/api/v1/images/", with: "/api/v1/public/images/")
        }

        let urlString: String
        if path.hasPrefix("http") {
            urlString = path
        } else if path.hasPrefix("/") {
            urlString = AppConfig.apiBaseURL.replacingOccurrences(of: "/api/v1", with: "") + path
        } else {
            urlString = AppConfig.apiBaseURL + "/" + path
        }

        guard let url = URL(string: urlString) else {
            isLoading = false
            errorOccurred = true
            return
        }

        resolvedRemoteURL = url
        let playbackURL = MediaCacheManager.shared.localURL(mediaID: "chat-video:\(videoURL)") ?? url
        let asset = AVURLAsset(url: playbackURL)

        do {
            // Resolve playability before installing AVPlayer into the render
            // tree. This avoids presenting controls around an unprepared item
            // and then hitching as its first metadata request completes.
            guard try await asset.load(.isPlayable) else {
                isLoading = false
                errorOccurred = true
                return
            }
            guard !Task.isCancelled else { return }

            await configurePlaybackAudioSession()
            guard !Task.isCancelled else { return }

            let item = AVPlayerItem(asset: asset)
            item.preferredForwardBufferDuration = 2
            let preparedPlayer = AVPlayer(playerItem: item)
            preparedPlayer.automaticallyWaitsToMinimizeStalling = true
            preparedPlayer.preventsDisplaySleepDuringVideoPlayback = true
            player = preparedPlayer
            isLoading = false
        } catch is CancellationError {
            return
        } catch {
            isLoading = false
            errorOccurred = true
        }
    }

    private func configurePlaybackAudioSession() async {
        await Task.detached(priority: .userInitiated) {
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.playback, mode: .moviePlayback)
            try? session.setActive(true)
        }.value
    }
}
