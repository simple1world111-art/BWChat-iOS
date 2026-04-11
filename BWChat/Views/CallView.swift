// BWChat/Views/CallView.swift
// Voice and video call UI

import SwiftUI
import LiveKit

struct CallView: View {
    @ObservedObject var callManager = CallManager.shared

    var body: some View {
        ZStack {
            if callManager.currentCall?.callType == .video {
                Color.black.ignoresSafeArea()
                videoLayer
            } else {
                LinearGradient(
                    colors: [Color(hex: "1A1A2E"), Color(hex: "16213E"), Color(hex: "0F3460")],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
            }

            VStack(spacing: 0) {
                HStack {
                    Button {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            callManager.minimizeCall()
                        }
                    } label: {
                        Image(systemName: "arrow.down.right.and.arrow.up.left")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white.opacity(0.8))
                            .frame(width: 40, height: 40)
                            .background(.white.opacity(0.15))
                            .clipShape(Circle())
                    }
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.top, 54)

                Spacer().frame(height: 20)

                if let call = callManager.currentCall {
                    if call.callType != .video || call.state != .connected {
                        if call.groupID != nil {
                            ZStack {
                                RoundedRectangle(cornerRadius: 24)
                                    .fill(
                                        LinearGradient(
                                            colors: [Color(hex: "5856D6").opacity(0.8), Color(hex: "764BA2").opacity(0.6)],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                    )
                                    .frame(width: 100, height: 100)
                                Image(systemName: "person.3.fill")
                                    .font(.system(size: 36))
                                    .foregroundColor(.white)
                            }
                            .shadow(color: .white.opacity(0.2), radius: 20)
                        } else {
                            AvatarView(url: call.remoteAvatarURL, size: 100)
                                .shadow(color: .white.opacity(0.2), radius: 20)
                        }

                        Text(call.groupName ?? call.remoteNickname)
                            .font(.system(size: 28, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.top, 20)
                    }

                    statusText(call)
                        .padding(.top, 8)

                    if call.groupID != nil && call.state == .connected {
                        Text("\(callManager.remoteParticipantCount + 1) 人通话中")
                            .font(.system(size: 14))
                            .foregroundColor(.white.opacity(0.6))
                            .padding(.top, 4)
                    }
                }

                Spacer()

                if let call = callManager.currentCall {
                    if call.state == .incoming {
                        incomingCallButtons
                    } else {
                        activeCallButtons(call: call)
                    }
                }

                Spacer().frame(height: 50)
            }
        }
        .statusBarHidden(true)
    }

    @ViewBuilder
    private func statusText(_ call: CallSession) -> some View {
        switch call.state {
        case .outgoing:
            Text("正在呼叫...")
                .font(.system(size: 16))
                .foregroundColor(.white.opacity(0.7))
        case .incoming:
            Text(call.groupID != nil
                 ? (call.callType == .voice ? "群语音通话邀请" : "群视频通话邀请")
                 : (call.callType == .voice ? "语音来电" : "视频来电"))
                .font(.system(size: 16))
                .foregroundColor(.white.opacity(0.7))
        case .connecting:
            Text("连接中...")
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

    // MARK: - Video Layer

    @ViewBuilder
    private var videoLayer: some View {
        ZStack(alignment: .topTrailing) {
            // Remote video (full screen)
            if let remoteTrack = callManager.remoteVideoTrack {
                SwiftUIVideoView(remoteTrack, layoutMode: .fill)
                    .ignoresSafeArea()
            } else {
                Color.black.ignoresSafeArea()
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
            }

            // Local video (PiP) — mirror for front camera only
            if let localTrack = callManager.localVideoTrack {
                SwiftUIVideoView(localTrack, layoutMode: .fill, mirrorMode: callManager.isFrontCamera ? .mirror : .off)
                    .frame(width: 120, height: 160)
                    .cornerRadius(12)
                    .shadow(color: .black.opacity(0.4), radius: 8)
                    .padding(.top, 60)
                    .padding(.trailing, 16)
            }
        }
    }

    // MARK: - Incoming Call Buttons

    private var incomingCallButtons: some View {
        HStack(spacing: 60) {
            VStack(spacing: 8) {
                Button { callManager.rejectCall() } label: {
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 28))
                        .foregroundColor(.white)
                        .frame(width: 64, height: 64)
                        .background(Color.red)
                        .clipShape(Circle())
                }
                Text("拒绝")
                    .font(.system(size: 13))
                    .foregroundColor(.white.opacity(0.7))
            }

            VStack(spacing: 8) {
                Button { callManager.acceptCall() } label: {
                    Image(systemName: "phone.fill")
                        .font(.system(size: 28))
                        .foregroundColor(.white)
                        .frame(width: 64, height: 64)
                        .background(Color.green)
                        .clipShape(Circle())
                }
                Text("接听")
                    .font(.system(size: 13))
                    .foregroundColor(.white.opacity(0.7))
            }
        }
    }

    // MARK: - Active Call Buttons

    private func activeCallButtons(call: CallSession) -> some View {
        HStack(spacing: 40) {
            controlButton(
                icon: callManager.isMuted ? "mic.slash.fill" : "mic.fill",
                label: callManager.isMuted ? "取消静音" : "静音",
                isActive: callManager.isMuted
            ) { callManager.toggleMute() }

            if call.callType == .video {
                controlButton(
                    icon: callManager.isLocalVideoEnabled ? "video.fill" : "video.slash.fill",
                    label: callManager.isLocalVideoEnabled ? "关闭摄像头" : "开启摄像头",
                    isActive: !callManager.isLocalVideoEnabled
                ) { callManager.toggleLocalVideo() }

                controlButton(
                    icon: "camera.rotate.fill",
                    label: "翻转",
                    isActive: false
                ) { callManager.flipCamera() }
            }

            controlButton(
                icon: callManager.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.fill",
                label: callManager.isSpeakerOn ? "关闭扬声器" : "扬声器",
                isActive: callManager.isSpeakerOn
            ) { callManager.toggleSpeaker() }

            VStack(spacing: 8) {
                Button { callManager.endCall() } label: {
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 24))
                        .foregroundColor(.white)
                        .frame(width: 56, height: 56)
                        .background(Color.red)
                        .clipShape(Circle())
                }
                Text("挂断")
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.7))
            }
        }
    }

    private func controlButton(icon: String, label: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        VStack(spacing: 8) {
            Button(action: action) {
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .foregroundColor(isActive ? .black : .white)
                    .frame(width: 50, height: 50)
                    .background(isActive ? Color.white : Color.white.opacity(0.2))
                    .clipShape(Circle())
            }
            Text(label)
                .font(.system(size: 12))
                .foregroundColor(.white.opacity(0.7))
                .lineLimit(1)
        }
    }

    private func formatDuration(_ interval: TimeInterval) -> String {
        let s = Int(interval)
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}

// MARK: - Floating PiP Bubble

struct CallPipBubble: View {
    @ObservedObject private var callManager = CallManager.shared
    @State private var dragOffset: CGSize = .zero

    var body: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.25)) {
                callManager.restoreCall()
            }
        } label: {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: callManager.currentCall?.callType == .video
                                ? [Color(hex: "5856D6"), Color(hex: "764BA2")]
                                : [Color(hex: "34C759"), Color(hex: "30B350")],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 60, height: 60)
                    .shadow(color: .black.opacity(0.3), radius: 6, y: 3)

                VStack(spacing: 2) {
                    Image(systemName: callManager.currentCall?.callType == .video ? "video.fill" : "phone.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(.white)

                    if callManager.currentCall?.state == .connected {
                        Text(pipDuration)
                            .font(.system(size: 9, weight: .medium, design: .monospaced))
                            .foregroundColor(.white.opacity(0.9))
                    } else {
                        Circle()
                            .fill(.white.opacity(0.8))
                            .frame(width: 4, height: 4)
                            .modifier(PulseAnimation())
                    }
                }
            }
        }
        .offset(dragOffset)
        .gesture(
            DragGesture()
                .onChanged { value in
                    dragOffset = value.translation
                }
                .onEnded { _ in
                    withAnimation(.spring(response: 0.3)) {
                        dragOffset = .zero
                    }
                }
        )
        .padding(.top, 100)
        .padding(.trailing, 16)
        .transition(.scale.combined(with: .opacity))
    }

    private var pipDuration: String {
        let s = Int(callManager.callDuration)
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}

private struct PulseAnimation: ViewModifier {
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        content
            .opacity(isPulsing ? 0.3 : 1.0)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
                    isPulsing = true
                }
            }
    }
}
