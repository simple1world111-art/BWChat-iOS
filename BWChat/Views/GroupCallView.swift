// BWChat/Views/GroupCallView.swift
// Multi-person group call UI with grid layout for video participants

import SwiftUI
import LiveKit

struct GroupCallView: View {
    @ObservedObject var callManager = CallManager.shared
    @Environment(\.dismiss) private var dismiss

    private var participants: [Participant] {
        var list: [Participant] = []
        if let room = callManager.room {
            list.append(room.localParticipant)
            list.append(contentsOf: room.remoteParticipants.values)
        }
        return list
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(callManager.currentCall?.groupName ?? "群通话")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.white)
                        Text("\(participants.count) 人通话中 · \(formatDuration(callManager.callDuration))")
                            .font(.system(size: 13))
                            .foregroundColor(.white.opacity(0.6))
                    }
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 8)

                // Video grid
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
        .onChange(of: callManager.currentCall == nil) { isNil in
            if isNil { dismiss() }
        }
        .statusBarHidden(true)
    }

    // MARK: - Video Grid

    @ViewBuilder
    private var videoGrid: some View {
        let cols = gridColumns(for: participants.count)
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: cols), spacing: 4) {
                ForEach(Array(participants.enumerated()), id: \.element.identity) { _, participant in
                    videoCell(for: participant)
                        .aspectRatio(3/4, contentMode: .fill)
                        .cornerRadius(8)
                }
            }
            .padding(.horizontal, 4)
        }
    }

    @ViewBuilder
    private func videoCell(for participant: Participant) -> some View {
        ZStack(alignment: .bottomLeading) {
            if let videoTrack = participant.videoTracks.first?.track as? VideoTrack {
                SwiftUIVideoView(videoTrack, layoutMode: .fill)
            } else {
                Color(hex: "2A2A3E")
                    .overlay(
                        Text(String(participant.name?.prefix(1) ?? "?"))
                            .font(.system(size: 32, weight: .bold))
                            .foregroundColor(.white.opacity(0.5))
                    )
            }

            HStack(spacing: 4) {
                if participant.isMicrophoneEnabled() == false {
                    Image(systemName: "mic.slash.fill")
                        .font(.system(size: 10))
                        .foregroundColor(.red)
                }
                Text(participant.name ?? participant.identity?.stringValue ?? "")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.white)
                    .lineLimit(1)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Color.black.opacity(0.5))
            .cornerRadius(4)
            .padding(4)
        }
    }

    // MARK: - Voice Grid (audio-only)

    @ViewBuilder
    private var voiceGrid: some View {
        let cols = gridColumns(for: participants.count)
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: cols), spacing: 12) {
                ForEach(Array(participants.enumerated()), id: \.element.identity) { _, participant in
                    voiceCell(for: participant)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
        }
    }

    @ViewBuilder
    private func voiceCell(for participant: Participant) -> some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(Color(hex: "2A2A3E"))
                    .frame(width: 64, height: 64)

                Text(String(participant.name?.prefix(1) ?? "?"))
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.white.opacity(0.7))

                if participant.isMicrophoneEnabled() == false {
                    Circle()
                        .fill(Color.red.opacity(0.8))
                        .frame(width: 20, height: 20)
                        .overlay(
                            Image(systemName: "mic.slash.fill")
                                .font(.system(size: 10))
                                .foregroundColor(.white)
                        )
                        .offset(x: 22, y: 22)
                }
            }

            Text(participant.name ?? participant.identity?.stringValue ?? "")
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
            ) {
                callManager.toggleMute()
            }

            if callManager.currentCall?.callType == .video {
                controlButton(
                    icon: callManager.isLocalVideoEnabled ? "video.fill" : "video.slash.fill",
                    isActive: !callManager.isLocalVideoEnabled
                ) {
                    callManager.toggleLocalVideo()
                }
            }

            controlButton(
                icon: callManager.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.fill",
                isActive: callManager.isSpeakerOn
            ) {
                callManager.toggleSpeaker()
            }

            Button {
                callManager.endCall()
            } label: {
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

    private func gridColumns(for count: Int) -> Int {
        switch count {
        case 1: return 1
        case 2: return 2
        case 3...4: return 2
        default: return 3
        }
    }

    private func formatDuration(_ interval: TimeInterval) -> String {
        let total = Int(interval)
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}
