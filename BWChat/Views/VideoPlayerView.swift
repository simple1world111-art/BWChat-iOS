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
                    .offset(y: verticalDrag)
                    .scaleEffect(dismissScale)
                    .onAppear {
                        // Ensure audio plays even in silent mode
                        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
                        try? AVAudioSession.sharedInstance().setActive(true)
                        player.play()
                    }
                    // Simultaneous so the VideoPlayer's own horizontal
                    // scrub gesture keeps working; we only react to
                    // clearly-vertical drags (≥45° off horizontal).
                    .simultaneousGesture(dismissDragGesture)
            } else if isLoading {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 40))
                        .foregroundColor(.gray)
                    Text("视频加载失败")
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
        .statusBarHidden(true)
        .task {
            await loadVideo()
        }
        .onDisappear {
            player?.pause()
            player = nil
        }
    }

    private var dismissDragGesture: some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                let h = value.translation.height
                let w = value.translation.width
                // Require clearly-vertical intent so horizontal gestures
                // over the player's scrub area aren't hijacked.
                if abs(h) > abs(w) {
                    verticalDrag = h
                }
            }
            .onEnded { value in
                let h = abs(value.translation.height)
                let w = abs(value.translation.width)
                let predictedH = abs(value.predictedEndTranslation.height)
                if h > w && (h > 110 || predictedH > 450) {
                    // Let the verticalDrag animate a bit further so the
                    // release feels like a continuation; fullScreenCover's
                    // own slide-out covers the final exit.
                    let sign: CGFloat = value.translation.height >= 0 ? 1 : -1
                    withAnimation(.easeOut(duration: 0.2)) {
                        verticalDrag = 260 * sign
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                        dismiss()
                    }
                } else if verticalDrag != 0 {
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                        verticalDrag = 0
                    }
                }
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

        player = AVPlayer(url: url)
        isLoading = false
    }
}
