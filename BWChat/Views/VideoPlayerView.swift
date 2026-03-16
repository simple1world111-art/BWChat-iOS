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

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let player = player {
                VideoPlayer(player: player)
                    .ignoresSafeArea()
                    .onAppear {
                        // Ensure audio plays even in silent mode
                        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
                        try? AVAudioSession.sharedInstance().setActive(true)
                        player.play()
                    }
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

            // Close button
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
