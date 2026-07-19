// BWChat/Views/GroupCallView.swift
// Multi-person group call UI

import SwiftUI
import LiveKit
import UIKit

struct GroupCallView: View {
    @ObservedObject var callManager = CallManager.shared

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(callManager.currentCall?.groupName ?? L10n.tr("call.groupCall"))
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.white)
                        Text("\(L10n.tr("call.participants.count", callManager.remoteParticipantCount + 1)) · \(formatDuration(callManager.callDuration))")
                            .font(.system(size: 13))
                            .foregroundColor(.white.opacity(0.6))
                        if callManager.mediaConnectionState == .reconnecting {
                            Label(L10n.tr("call.reconnecting"), systemImage: "arrow.triangle.2.circlepath")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.orange)
                        } else if callManager.localConnectionQuality == .poor ||
                                    callManager.localConnectionQuality == .lost {
                            Label(L10n.tr("call.networkPoor"), systemImage: "wifi.exclamationmark")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.orange)
                        }
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
                    .accessibilityIdentifier("call.minimize")
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
        .onAppear {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
    }

    // MARK: - Video Grid

    @ViewBuilder
    private var videoGrid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 4), GridItem(.flexible(), spacing: 4)], spacing: 4) {
                if let localParticipant = callManager.room?.localParticipant {
                    videoCell(
                        name: L10n.tr("common.me"),
                        videoTrack: localParticipant.localVideoTracks.first?.track as? VideoTrack,
                        isLocal: true,
                        isSpeaking: callManager.isParticipantSpeaking(localParticipant)
                    )
                }

                ForEach(Array(callManager.remoteParticipants.enumerated()), id: \.element.sid) { _, participant in
                    videoCell(
                        name: participant.name ?? participant.identity?.stringValue ?? "",
                        videoTrack: participant.videoTracks.first?.track as? VideoTrack,
                        isLocal: false,
                        isSpeaking: callManager.isParticipantSpeaking(participant)
                    )
                }
            }
            .padding(.horizontal, 4)
        }
    }

    private func videoCell(
        name: String,
        videoTrack: VideoTrack?,
        isLocal: Bool = false,
        isSpeaking: Bool
    ) -> some View {
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
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(isSpeaking ? Color.green : Color.clear, lineWidth: 3)
        )
    }

    // MARK: - Voice Grid

    @ViewBuilder
    private var voiceGrid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                if let localParticipant = callManager.room?.localParticipant {
                    voiceCell(
                        name: L10n.tr("common.me"),
                        isSpeaking: callManager.isParticipantSpeaking(localParticipant)
                    )
                }
                ForEach(callManager.remoteParticipants, id: \.sid) { participant in
                    voiceCell(
                        name: participant.name ?? participant.identity?.stringValue ?? "",
                        isSpeaking: callManager.isParticipantSpeaking(participant)
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
        }
    }

    private func voiceCell(name: String, isSpeaking: Bool) -> some View {
        VStack(spacing: 8) {
            Circle()
                .fill(Color(hex: "2A2A3E"))
                .frame(width: 64, height: 64)
                .overlay(
                    Text(String(name.prefix(1)))
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.white.opacity(0.7))
                )
                .overlay(
                    Circle()
                        .stroke(isSpeaking ? Color.green : Color.clear, lineWidth: 3)
                )

            Text(name)
                .font(.system(size: 12))
                .foregroundColor(.white.opacity(0.8))
                .lineLimit(1)
        }
    }

    // MARK: - Control Bar

    private var controlBar: some View {
        HStack(spacing: callManager.currentCall?.callType == .video ? 16 : 28) {
            controlButton(
                icon: callManager.isMuted ? "mic.slash.fill" : "mic.fill",
                isActive: callManager.isMuted,
                identifier: "call.mute"
            ) { callManager.toggleMute() }

            if callManager.currentCall?.callType == .video {
                controlButton(
                    icon: callManager.isLocalVideoEnabled ? "video.fill" : "video.slash.fill",
                    isActive: !callManager.isLocalVideoEnabled,
                    identifier: "call.camera"
                ) { callManager.toggleLocalVideo() }

                controlButton(
                    icon: "camera.rotate.fill",
                    isActive: false,
                    identifier: "call.flip"
                ) { callManager.flipCamera() }
            }

            controlButton(
                icon: callManager.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.slash.fill",
                isActive: callManager.isSpeakerOn,
                identifier: "call.speaker"
            ) { callManager.toggleSpeaker() }

            Button { callManager.endCall() } label: {
                Image(systemName: "phone.down.fill")
                    .font(.system(size: 18))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(Color.red)
                    .clipShape(Circle())
            }
            .accessibilityIdentifier("call.end")
        }
        .padding(.horizontal, 12)
    }

    private func controlButton(
        icon: String,
        isActive: Bool,
        identifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundColor(isActive ? .black : .white)
                .frame(width: 44, height: 44)
                .background(isActive ? Color.white : Color.white.opacity(0.2))
                .clipShape(Circle())
        }
        .accessibilityIdentifier(identifier)
    }

    private func formatDuration(_ interval: TimeInterval) -> String {
        let s = Int(interval)
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}
