// BWChat/Views/VideoPlayerView.swift
// Full-screen video player with dismiss support

import SwiftUI
import AVKit

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
                    .onAppear { player.play() }
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
        let urlString: String
        if videoURL.hasPrefix("http") {
            urlString = videoURL
        } else if videoURL.hasPrefix("/") {
            urlString = AppConfig.apiBaseURL.replacingOccurrences(of: "/api/v1", with: "") + videoURL
        } else {
            urlString = AppConfig.apiBaseURL + "/" + videoURL
        }

        guard let url = URL(string: urlString) else {
            isLoading = false
            errorOccurred = true
            return
        }

        // Build a request with auth header
        if let token = AuthManager.shared.token {
            let headers = ["Authorization": "Bearer \(token)"]
            let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
            let playerItem = AVPlayerItem(asset: asset)
            player = AVPlayer(playerItem: playerItem)
        } else {
            player = AVPlayer(url: url)
        }
        isLoading = false
    }
}
