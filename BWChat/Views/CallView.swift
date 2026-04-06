// BWChat/Views/CallView.swift
// Voice and video call UI

import SwiftUI

struct CallView: View {
    @ObservedObject var callManager = CallManager.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            // Background
            if callManager.currentCall?.callType == .video {
                Color.black.ignoresSafeArea()
                // Remote video placeholder
                VStack {
                    Spacer()
                    Image(systemName: "video.slash.fill")
                        .font(.system(size: 60))
                        .foregroundColor(.white.opacity(0.3))
                    Text("等待视频连接...")
                        .font(.system(size: 16))
                        .foregroundColor(.white.opacity(0.5))
                        .padding(.top, 8)
                    Spacer()
                }
            } else {
                LinearGradient(
                    colors: [Color(hex: "1A1A2E"), Color(hex: "16213E"), Color(hex: "0F3460")],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
            }

            VStack(spacing: 0) {
                Spacer().frame(height: 80)

                if let call = callManager.currentCall {
                    // Avatar + Name
                    AvatarView(url: call.remoteAvatarURL, size: 100)
                        .shadow(color: .white.opacity(0.2), radius: 20)

                    Text(call.remoteNickname)
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.top, 20)

                    // Status
                    Group {
                        switch call.state {
                        case .outgoing:
                            Text("正在呼叫...")
                                .font(.system(size: 16))
                                .foregroundColor(.white.opacity(0.7))
                        case .incoming:
                            Text(call.callType == .voice ? "语音来电" : "视频来电")
                                .font(.system(size: 16))
                                .foregroundColor(.white.opacity(0.7))
                        case .connected:
                            Text(formatDuration(callManager.callDuration))
                                .font(.system(size: 18, weight: .medium, design: .monospaced))
                                .foregroundColor(.green)
                        default:
                            EmptyView()
                        }
                    }
                    .padding(.top, 8)
                }

                Spacer()

                // Control Buttons
                if let call = callManager.currentCall {
                    if call.state == .incoming {
                        incomingCallButtons
                    } else {
                        activeCallButtons(call: call)
                    }
                }

                Spacer().frame(height: 60)
            }

            // Local video preview (top-right corner for video calls)
            if callManager.currentCall?.callType == .video,
               callManager.currentCall?.state == .connected {
                VStack {
                    HStack {
                        Spacer()
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.gray.opacity(0.5))
                            .frame(width: 120, height: 160)
                            .overlay {
                                Image(systemName: callManager.isLocalVideoEnabled ? "person.fill" : "video.slash")
                                    .font(.system(size: 30))
                                    .foregroundColor(.white.opacity(0.5))
                            }
                            .padding(.trailing, 16)
                            .padding(.top, 60)
                    }
                    Spacer()
                }
            }
        }
        .onChange(of: callManager.currentCall == nil) { isNil in
            if isNil { dismiss() }
        }
    }

    // MARK: - Incoming Call Buttons

    private var incomingCallButtons: some View {
        HStack(spacing: 60) {
            // Reject
            Button {
                callManager.rejectCall()
            } label: {
                ZStack {
                    Circle()
                        .fill(Color.red)
                        .frame(width: 70, height: 70)
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 28))
                        .foregroundColor(.white)
                }
            }

            // Accept
            Button {
                callManager.acceptCall()
            } label: {
                ZStack {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 70, height: 70)
                    Image(systemName: callManager.currentCall?.callType == .video ? "video.fill" : "phone.fill")
                        .font(.system(size: 28))
                        .foregroundColor(.white)
                }
            }
        }
    }

    // MARK: - Active Call Buttons

    private func activeCallButtons(call: CallSession) -> some View {
        VStack(spacing: 30) {
            HStack(spacing: 40) {
                // Mute
                callButton(
                    icon: callManager.isMuted ? "mic.slash.fill" : "mic.fill",
                    label: callManager.isMuted ? "已静音" : "静音",
                    isActive: callManager.isMuted
                ) {
                    callManager.toggleMute()
                }

                // Speaker
                callButton(
                    icon: callManager.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.fill",
                    label: callManager.isSpeakerOn ? "已开启" : "扬声器",
                    isActive: callManager.isSpeakerOn
                ) {
                    callManager.toggleSpeaker()
                }

                // Video toggle (only for video calls)
                if call.callType == .video {
                    callButton(
                        icon: callManager.isLocalVideoEnabled ? "video.fill" : "video.slash.fill",
                        label: callManager.isLocalVideoEnabled ? "摄像头" : "已关闭",
                        isActive: !callManager.isLocalVideoEnabled
                    ) {
                        callManager.toggleLocalVideo()
                    }
                }
            }

            // End call
            Button {
                callManager.endCall()
            } label: {
                ZStack {
                    Circle()
                        .fill(Color.red)
                        .frame(width: 70, height: 70)
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 28))
                        .foregroundColor(.white)
                }
            }
        }
    }

    private func callButton(icon: String, label: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(isActive ? Color.white.opacity(0.3) : Color.white.opacity(0.1))
                        .frame(width: 56, height: 56)
                    Image(systemName: icon)
                        .font(.system(size: 22))
                        .foregroundColor(.white)
                }
                Text(label)
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.7))
            }
        }
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        let m = Int(seconds) / 60
        let s = Int(seconds) % 60
        return String(format: "%02d:%02d", m, s)
    }
}
