// BWChat/Views/GroupCallView.swift
// Multi-person group call UI with grid layout for video participants

import SwiftUI
import LiveKit

struct GroupCallView: View {
    @ObservedObject var callManager = CallManager.shared

    private var participantIdentities: [String] {
        guard let room = callManager.room else { return [] }
        var ids = [room.localParticipant.identity?.stringValue ?? "local"]
        for rp in room.remoteParticipants.values {
            ids.append(rp.identity?.stringValue ?? rp.sid?.stringValue ?? UUID().uuidString)
        }
        return ids
    }

    private var localParticipant: LocalParticipant? {
        callManager.room?.localParticipant
    }

    private var allRemoteParticipants: [RemoteParticipant] {
        guard let room = callManager.room else { return [] }
        return Array(room.remoteParticipants.values)
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
                        Text("\(participantIdentities.count) 人通话中 · \(formatDuration(callManager.callDuration))")
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
        .statusBarHidden(true)
    }

    // MARK: - Video Grid

    @ViewBuilder
    private var videoGrid: some View {
        let totalCount = 1 + allRemoteParticipants.count
        let cols = gridColumns(for: totalCount)
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: cols), spacing: 4) {
                // Local participant
                if let local = localParticipant {
                    localVideoCell(local)
                        .aspectRatio(3/4, contentMode: .fill)
                        .cornerRadius(8)
                }
                // Remote participants
                ForEach(allRemoteParticipants, id: \.sid) { remote in
                    remoteVideoCell(remote)
                        .aspectRatio(3/4, contentMode: .fill)
                        .cornerRadius(8)
                }
            }
            .padding(.horizontal, 4)
        }
    }

    @ViewBuilder
    private func localVideoCell(_ participant: LocalParticipant) -> some View {
        ZStack(alignment: .bottomLeading) {
            if let pub = participant.localVideoTracks.first, let track = pub.track as? VideoTrack {
                SwiftUIVideoView(track, layoutMode: .fill)
            } else {
                Color(hex: "2A2A3E")
                    .overlay(
                        Text(String(participant.name?.prefix(1) ?? "我"))
                            .font(.system(size: 32, weight: .bold))
                            .foregroundColor(.white.opacity(0.5))
                    )
            }
            participantLabel(name: participant.name ?? "我", micEnabled: participant.isMicrophoneEnabled())
        }
    }

    @ViewBuilder
    private func remoteVideoCell(_ participant: RemoteParticipant) -> some View {
        ZStack(alignment: .bottomLeading) {
            if let pub = participant.videoTracks.first, let track = pub.track as? VideoTrack {
                SwiftUIVideoView(track, layoutMode: .fill)
            } else {
                Color(hex: "2A2A3E")
                    .overlay(
                        Text(String(participant.name?.prefix(1) ?? "?"))
                            .font(.system(size: 32, weight: .bold))
                            .foregroundColor(.white.opacity(0.5))
                    )
            }
            participantLabel(name: participant.name ?? participant.identity?.stringValue ?? "", micEnabled: participant.isMicrophoneEnabled())
        }
    }

    private func participantLabel(name: String, micEnabled: Bool) -> some View {
        HStack(spacing: 4) {
            if !micEnabled {
                Image(systemName: "mic.slash.fill")
                    .font(.system(size: 10))
                    .foregroundColor(.red)
            }
            Text(name)
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

    // MARK: - Voice Grid (audio-only)

    @ViewBuilder
    private var voiceGrid: some View {
        let totalCount = 1 + allRemoteParticipants.count
        let cols = gridColumns(for: totalCount)
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: cols), spacing: 12) {
                if let local = localParticipant {
                    voiceCell(name: local.name ?? "我", micEnabled: local.isMicrophoneEnabled())
                }
                ForEach(allRemoteParticipants, id: \.sid) { remote in
                    voiceCell(name: remote.name ?? remote.identity?.stringValue ?? "", micEnabled: remote.isMicrophoneEnabled())
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
        }
    }

    @ViewBuilder
    private func voiceCell(name: String, micEnabled: Bool) -> some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(Color(hex: "2A2A3E"))
                    .frame(width: 64, height: 64)

                Text(String(name.prefix(1)))
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.white.opacity(0.7))

                if !micEnabled {
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
