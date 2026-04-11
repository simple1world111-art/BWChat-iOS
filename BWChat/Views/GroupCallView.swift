// BWChat/Views/GroupCallView.swift
// Multi-person group call UI

import SwiftUI
import LiveKit

struct GroupCallView: View {
    @ObservedObject var callManager = CallManager.shared

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(callManager.currentCall?.groupName ?? "群通话")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.white)
                        Text("\(callManager.remoteParticipantCount + 1) 人通话中 · \(formatDuration(callManager.callDuration))")
                            .font(.system(size: 13))
                            .foregroundColor(.white.opacity(0.6))
                    }
                    Spacer()
                    Button {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            callManager.minimizeCall()
                        }
                    } label: {
                        Image(systemName: "arrow.down.right.and.arrow.up.left")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white.opacity(0.8))
                            .frame(width: 36, height: 36)
                            .background(.white.opacity(0.15))
                            .clipShape(Circle())
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 8)

                // Participant grid
                if callManager.currentCall?.callType == .video {
                    videoGrid
                } else {
                    voiceGrid
                }

                Spacer()

                // Controls
                controlBar
                    .padding(.bottom, 40)
            }
        }
        .statusBarHidden(true)
    }

    // MARK: - Video Grid

    @ViewBuilder
    private var videoGrid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 4), GridItem(.flexible(), spacing: 4)], spacing: 4) {
                if let localParticipant = callManager.room?.localParticipant {
                    videoCell(
                        name: "我",
                        videoTrack: localParticipant.localVideoTracks.first?.track as? VideoTrack,
                        isLocal: true
                    )
                }

                ForEach(Array(callManager.remoteParticipants.enumerated()), id: \.element.sid) { _, participant in
                    videoCell(
                        name: participant.name ?? participant.identity?.stringValue ?? "",
                        videoTrack: participant.videoTracks.first?.track as? VideoTrack,
                        isLocal: false
                    )
                }
            }
            .padding(.horizontal, 4)
        }
    }

    private func videoCell(name: String, videoTrack: VideoTrack?, isLocal: Bool = false) -> some View {
        ZStack(alignment: .bottomLeading) {
            if let track = videoTrack {
                SwiftUIVideoView(track, layoutMode: .fill, mirrorMode: (isLocal && callManager.isFrontCamera) ? .mirror : .off)
                    .aspectRatio(3/4, contentMode: .fill)
                    .clipped()
                    .cornerRadius(8)
            } else {
                Color(hex: "2A2A3E")
                    .aspectRatio(3/4, contentMode: .fill)
                    .overlay(
                        Text(String(name.prefix(1)))
                            .font(.system(size: 32, weight: .bold))
                            .foregroundColor(.white.opacity(0.5))
                    )
                    .cornerRadius(8)
            }

            Text(name)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(Color.black.opacity(0.5))
                .cornerRadius(4)
                .padding(4)
        }
    }

    // MARK: - Voice Grid

    @ViewBuilder
    private var voiceGrid: some View {
        let names = ["我"] + callManager.remoteParticipantNames
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(Array(names.enumerated()), id: \.offset) { _, name in
                    voiceCell(name: name)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
        }
    }

    private func voiceCell(name: String) -> some View {
        VStack(spacing: 8) {
            Circle()
                .fill(Color(hex: "2A2A3E"))
                .frame(width: 64, height: 64)
                .overlay(
                    Text(String(name.prefix(1)))
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.white.opacity(0.7))
                )

            Text(name)
                .font(.system(size: 12))
                .foregroundColor(.white.opacity(0.8))
                .lineLimit(1)
        }
    }

    // MARK: - Control Bar

    private var controlBar: some View {
        HStack(spacing: 36) {
            controlButton(
                icon: callManager.isMuted ? "mic.slash.fill" : "mic.fill",
                isActive: callManager.isMuted
            ) { callManager.toggleMute() }

            if callManager.currentCall?.callType == .video {
                controlButton(
                    icon: callManager.isLocalVideoEnabled ? "video.fill" : "video.slash.fill",
                    isActive: !callManager.isLocalVideoEnabled
                ) { callManager.toggleLocalVideo() }

                controlButton(
                    icon: "camera.rotate.fill",
                    isActive: false
                ) { callManager.flipCamera() }
            }

            controlButton(
                icon: callManager.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.fill",
                isActive: callManager.isSpeakerOn
            ) { callManager.toggleSpeaker() }

            Button { callManager.endCall() } label: {
                Image(systemName: "phone.down.fill")
                    .font(.system(size: 22))
                    .foregroundColor(.white)
                    .frame(width: 52, height: 52)
                    .background(Color.red)
                    .clipShape(Circle())
            }
        }
    }

    private func controlButton(icon: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundColor(isActive ? .black : .white)
                .frame(width: 48, height: 48)
                .background(isActive ? Color.white : Color.white.opacity(0.2))
                .clipShape(Circle())
        }
    }

    private func formatDuration(_ interval: TimeInterval) -> String {
        let s = Int(interval)
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}
