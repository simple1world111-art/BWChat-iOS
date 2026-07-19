// BWChat/Views/CallView.swift
// Voice and video call UI

import SwiftUI
import LiveKit
import UIKit

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
                    .accessibilityIdentifier("call.minimize")
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.top, 54)

                Spacer().frame(height: 20)
                    .allowsHitTesting(false)

                if let call = callManager.currentCall {
                    if call.callType != .video || call.state != .connected {
                        if call.groupID != nil {
                            GroupAvatarIcon(size: 100)
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
                        .allowsHitTesting(false)

                    if call.groupID != nil && call.state == .connected {
                        Text(L10n.tr("call.participants.count", callManager.remoteParticipantCount + 1))
                            .font(.system(size: 14))
                            .foregroundColor(.white.opacity(0.6))
                            .padding(.top, 4)
                            .allowsHitTesting(false)
                    }
                }

                Spacer()
                    .allowsHitTesting(false)

                if let call = callManager.currentCall {
                    if call.state == .incoming {
                        incomingCallButtons
                    } else {
                        activeCallButtons(call: call)
                    }
                }

                Spacer().frame(height: 50)
                    .allowsHitTesting(false)
            }
        }
        .statusBarHidden(true)
        .onAppear {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
    }

    @ViewBuilder
    private func statusText(_ call: CallSession) -> some View {
        switch call.state {
        case .outgoing:
            Text(L10n.tr("call.calling"))
                .font(.system(size: 16))
                .foregroundColor(.white.opacity(0.7))
        case .incoming:
            Text(call.groupID != nil
                 ? (call.callType == .voice ? L10n.tr("call.groupVoiceInvite") : L10n.tr("call.groupVideoInvite"))
                 : (call.callType == .voice ? L10n.tr("call.voiceIncoming") : L10n.tr("call.videoIncoming")))
                .font(.system(size: 16))
                .foregroundColor(.white.opacity(0.7))
        case .connecting:
            Text(L10n.tr("call.connecting"))
                .font(.system(size: 16))
                .foregroundColor(.white.opacity(0.7))
        case .connected:
            VStack(spacing: 5) {
                if callManager.mediaConnectionState == .reconnecting {
                    Text(L10n.tr("call.reconnecting"))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(.orange)
                } else {
                    Text(formatDuration(callManager.callDuration))
                        .font(.system(size: 18, weight: .medium, design: .monospaced))
                        .foregroundColor(.green)
                }

                if callManager.localConnectionQuality == .poor ||
                    callManager.localConnectionQuality == .lost {
                    Label(L10n.tr("call.networkPoor"), systemImage: "wifi.exclamationmark")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.orange)
                }
            }
        default:
            EmptyView()
        }
    }

    // MARK: - Video Layer (tap to swap big/small)

    @ViewBuilder
    private var videoLayer: some View {
        ZStack(alignment: .topTrailing) {
            // Primary (full screen)
            if callManager.isRemotePrimary {
                if let remoteTrack = callManager.remoteVideoTrack {
                    SwiftUIVideoView(remoteTrack, layoutMode: .fill)
                        .ignoresSafeArea()
                } else {
                    noVideoPlaceholder(name: callManager.currentCall?.remoteNickname)
                }
            } else {
                if let localTrack = callManager.localVideoTrack {
                    SwiftUIVideoView(localTrack, layoutMode: .fill, mirrorMode: callManager.isFrontCamera ? .mirror : .off)
                        .ignoresSafeArea()
                } else {
                    noVideoPlaceholder(name: L10n.tr("common.me"))
                }
            }

            if isPrimaryParticipantMuted {
                CallMuteBadge(name: primaryParticipantName)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .padding(.leading, 16)
                    .padding(.bottom, 140)
                    .allowsHitTesting(false)
            }

            // Secondary (small corner) — tap to swap
            let secondaryTrack: VideoTrack? = callManager.isRemotePrimary ? callManager.localVideoTrack : callManager.remoteVideoTrack
            let isSecondaryLocal = callManager.isRemotePrimary

            Button {
                withAnimation(.easeInOut(duration: 0.3)) {
                    callManager.isRemotePrimary.toggle()
                }
            } label: {
                ZStack(alignment: .bottomLeading) {
                    if let track = secondaryTrack {
                        SwiftUIVideoView(
                            track,
                            layoutMode: .fill,
                            mirrorMode: (isSecondaryLocal && callManager.isFrontCamera) ? .mirror : .off
                        )
                    } else {
                        CompactCallVideoPlaceholder(name: secondaryParticipantName)
                    }

                    if isSecondaryParticipantMuted {
                        CallMuteBadge()
                            .padding(5)
                    }
                }
                .frame(width: 110, height: 150)
                .compositingGroup()
                .clipShape(.rect(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .shadow(color: .black.opacity(0.4), radius: 8)
            .padding(.top, 60)
            .padding(.trailing, 16)
            .accessibilityLabel(L10n.tr("call.video.swap"))
        }
    }

    private var remoteParticipant: RemoteParticipant? {
        callManager.remoteParticipants.first
    }

    private var primaryParticipantName: String? {
        if callManager.isRemotePrimary {
            return callManager.currentCall?.remoteNickname
        }
        return L10n.tr("common.me")
    }

    private var isPrimaryParticipantMuted: Bool {
        if callManager.isRemotePrimary {
            return remoteParticipant.map(callManager.isParticipantMuted) ?? false
        }
        return callManager.isMuted
    }

    private var isSecondaryParticipantMuted: Bool {
        if callManager.isRemotePrimary {
            return callManager.isMuted
        }
        return remoteParticipant.map(callManager.isParticipantMuted) ?? false
    }

    private var secondaryParticipantName: String {
        if callManager.isRemotePrimary {
            return L10n.tr("common.me")
        }
        return callManager.currentCall?.remoteNickname ?? ""
    }

    @ViewBuilder
    private func noVideoPlaceholder(name: String?) -> some View {
        Color.black.ignoresSafeArea()
        VStack {
            Spacer()
            Image(systemName: "video.slash.fill")
                .font(.system(size: 60))
                .foregroundColor(.white.opacity(0.3))
            if let name, !name.isEmpty {
                Text(name)
                    .font(.headline)
                    .foregroundStyle(.white.opacity(0.75))
                    .padding(.top, 10)
            }
            Text(L10n.tr("call.cameraDisabled"))
                .font(.system(size: 16))
                .foregroundColor(.white.opacity(0.5))
                .padding(.top, 8)
            Spacer()
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
                .accessibilityIdentifier("call.reject")
                Text(L10n.tr("call.decline"))
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
                .accessibilityIdentifier("call.accept")
                Text(L10n.tr("call.answer"))
                    .font(.system(size: 13))
                    .foregroundColor(.white.opacity(0.7))
            }
        }
    }

    // MARK: - Active Call Buttons (compact)

    private func activeCallButtons(call: CallSession) -> some View {
        HStack(spacing: call.callType == .video ? 16 : 32) {
            controlButton(
                icon: callManager.isMuted ? "mic.slash.fill" : "mic.fill",
                label: callManager.isMuted ? L10n.tr("call.unmute") : L10n.tr("call.mute"),
                isActive: callManager.isMuted,
                identifier: "call.mute"
            ) { callManager.toggleMute() }

            if call.callType == .video {
                controlButton(
                    icon: callManager.isLocalVideoEnabled ? "video.fill" : "video.slash.fill",
                    label: callManager.isLocalVideoEnabled ? L10n.tr("call.cameraOff") : L10n.tr("call.cameraOn"),
                    isActive: !callManager.isLocalVideoEnabled,
                    identifier: "call.camera"
                ) { callManager.toggleLocalVideo() }

                controlButton(
                    icon: "camera.rotate.fill",
                    label: L10n.tr("call.flip"),
                    isActive: false,
                    identifier: "call.flip"
                ) { callManager.flipCamera() }
            }

            controlButton(
                icon: callManager.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.slash.fill",
                label: callManager.isSpeakerOn ? L10n.tr("call.speaker") : L10n.tr("call.earpiece"),
                isActive: callManager.isSpeakerOn,
                identifier: "call.speaker"
            ) { callManager.toggleSpeaker() }

            VStack(spacing: 6) {
                Button { callManager.endCall() } label: {
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 20))
                        .foregroundColor(.white)
                        .frame(width: 46, height: 46)
                        .background(Color.red)
                        .clipShape(Circle())
                }
                .accessibilityIdentifier("call.end")
                Text(L10n.tr("call.hangUp"))
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.7))
            }
        }
        .padding(.horizontal, 12)
    }

    private func controlButton(
        icon: String,
        label: String,
        isActive: Bool,
        identifier: String,
        action: @escaping () -> Void
    ) -> some View {
        VStack(spacing: 6) {
            Button(action: action) {
                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundColor(isActive ? .black : .white)
                    .frame(width: 44, height: 44)
                    .background(isActive ? Color.white : Color.white.opacity(0.2))
                    .clipShape(Circle())
            }
            .accessibilityIdentifier(identifier)
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.white.opacity(0.7))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    private func formatDuration(_ interval: TimeInterval) -> String {
        let s = Int(interval)
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}

private struct CompactCallVideoPlaceholder: View {
    let name: String

    var body: some View {
        Color(hex: "2A2A3E")
            .overlay {
                VStack(spacing: 7) {
                    Image(systemName: "video.slash.fill")
                        .font(.title3)
                    Text(name)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                    Text(L10n.tr("call.cameraDisabled"))
                        .font(.caption2)
                }
                .foregroundStyle(.white.opacity(0.68))
                .padding(6)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(name), \(L10n.tr("call.cameraDisabled"))")
    }
}

struct CallMuteBadge: View {
    let name: String?

    init(name: String? = nil) {
        self.name = name
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "mic.slash.fill")
                .accessibilityHidden(true)
            Text(statusText)
                .lineLimit(1)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 7)
        .padding(.vertical, 5)
        .background(.red.opacity(0.88), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(statusText)
    }

    private var statusText: String {
        guard let name, !name.isEmpty else { return L10n.tr("call.muted") }
        return "\(name) · \(L10n.tr("call.muted"))"
    }
}

// MARK: - Floating PiP Bubble

struct CallPipBubble: View {
    @ObservedObject private var callManager = CallManager.shared
    @State private var position: CGPoint = CGPoint(x: UIScreen.main.bounds.width - 80, y: 160)
    @State private var isHidden = false
    @State private var lastEdgeOnLeft = false

    private var isVoiceCall: Bool {
        callManager.currentCall?.callType == .voice
    }

    private let videoPipWidth: CGFloat = 120
    private let videoPipHeight: CGFloat = 170
    private let voicePipSize: CGFloat = 60
    private let edgeMargin: CGFloat = 6

    var body: some View {
        GeometryReader { geo in
            let screenW = geo.size.width
            let screenH = geo.size.height

            ZStack {
                if isHidden {
                    edgeButton(screenW: screenW, screenH: screenH)
                } else {
                    if isVoiceCall {
                        voiceBubble(screenW: screenW)
                            .position(position)
                            .simultaneousGesture(dragGesture(screenW: screenW, screenH: screenH))
                            .onAppear {
                                position = CGPoint(x: screenW - voicePipSize / 2 - edgeMargin, y: 160)
                            }
                    } else {
                        videoBubble(screenW: screenW)
                            .position(position)
                            .simultaneousGesture(dragGesture(screenW: screenW, screenH: screenH))
                            .onAppear {
                                position = CGPoint(x: screenW - videoPipWidth / 2 - edgeMargin, y: 160)
                            }
                    }
                }
            }
        }
        .ignoresSafeArea()
    }

    // MARK: - Voice Bubble (small circle)

    private func voiceBubble(screenW: CGFloat) -> some View {
        ZStack(alignment: .topTrailing) {
            Button {
                withAnimation(.easeInOut(duration: 0.25)) {
                    callManager.restoreCall()
                }
            } label: {
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [Color(hex: "34C759"), Color(hex: "30B350")],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )

                    VStack(spacing: 2) {
                        Image(systemName: "phone.fill")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundColor(.white)

                        if callManager.currentCall?.state == .connected {
                            Text(pipDuration)
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundColor(.white.opacity(0.9))
                        }
                    }
                }
                .frame(width: voicePipSize, height: voicePipSize)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("call.restore")

            // Hide button
            Button {
                lastEdgeOnLeft = position.x < screenW / 2
                withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                    isHidden = true
                }
            } label: {
                Image(systemName: "minus")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 18, height: 18)
                    .background(Color.black.opacity(0.5))
                    .clipShape(Circle())
            }
            .offset(x: 4, y: -4)
            .accessibilityIdentifier("call.pip.hide")
        }
        .shadow(color: .black.opacity(0.3), radius: 6, y: 2)
    }

    // MARK: - Video Bubble (rectangular with video)

    private func videoBubble(screenW: CGFloat) -> some View {
        ZStack(alignment: .topTrailing) {
            Button {
                withAnimation(.easeInOut(duration: 0.25)) {
                    callManager.restoreCall()
                }
            } label: {
                ZStack {
                    let secondaryTrack: VideoTrack? = callManager.isRemotePrimary ? callManager.localVideoTrack : callManager.remoteVideoTrack
                    let isPipLocal = callManager.isRemotePrimary

                    if let track = secondaryTrack {
                        SwiftUIVideoView(track, layoutMode: .fill, mirrorMode: (isPipLocal && callManager.isFrontCamera) ? .mirror : .off)
                    } else {
                        LinearGradient(
                            colors: [Color(hex: "5856D6"), Color(hex: "764BA2")],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    }

                    VStack(spacing: 2) {
                        if callManager.localVideoTrack == nil && callManager.remoteVideoTrack == nil {
                            Image(systemName: "video.fill")
                                .font(.system(size: 22, weight: .semibold))
                                .foregroundColor(.white)
                        }

                        if callManager.currentCall?.state == .connected {
                            Text(pipDuration)
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .foregroundColor(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.black.opacity(0.5))
                                .cornerRadius(6)
                        }
                    }
                }
                .frame(width: videoPipWidth, height: videoPipHeight)
                .cornerRadius(14)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("call.restore")

            // Hide button
            Button {
                lastEdgeOnLeft = position.x < screenW / 2
                withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                    isHidden = true
                }
            } label: {
                Image(systemName: "minus")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 22, height: 22)
                    .background(Color.black.opacity(0.5))
                    .clipShape(Circle())
            }
            .offset(x: -4, y: 4)
            .accessibilityIdentifier("call.pip.hide")
        }
        .shadow(color: .black.opacity(0.35), radius: 8, y: 3)
    }

    // MARK: - Edge Button (when hidden)

    @ViewBuilder
    private func edgeButton(screenW: CGFloat, screenH: CGFloat) -> some View {
        let clampedY = min(max(position.y, 78), screenH - 58)
        let x: CGFloat = lastEdgeOnLeft ? 11 : screenW - 11

        Button {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                isHidden = false
            }
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        isVoiceCall
                            ? LinearGradient(colors: [Color(hex: "34C759"), Color(hex: "30B350")], startPoint: .top, endPoint: .bottom)
                            : LinearGradient(colors: [Color(hex: "5856D6"), Color(hex: "764BA2")], startPoint: .top, endPoint: .bottom)
                    )
                Image(systemName: lastEdgeOnLeft ? "chevron.right" : "chevron.left")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.white)
            }
        }
        .buttonStyle(.plain)
        .frame(width: 22, height: 56)
        .shadow(color: .black.opacity(0.3), radius: 4, y: 2)
        .position(x: x, y: clampedY)
        .accessibilityIdentifier("call.pip.show")
    }

    // MARK: - Gesture & Helpers

    private func dragGesture(screenW: CGFloat, screenH: CGFloat) -> some Gesture {
        DragGesture()
            .onChanged { value in
                position = value.location
            }
            .onEnded { value in
                withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                    position = snapToEdge(value.location, screenW: screenW, screenH: screenH)
                }
            }
    }

    private func snapToEdge(_ point: CGPoint, screenW: CGFloat, screenH: CGFloat) -> CGPoint {
        let halfW = isVoiceCall ? voicePipSize / 2 : videoPipWidth / 2
        let halfH = isVoiceCall ? voicePipSize / 2 : videoPipHeight / 2
        let clampedY = min(max(point.y, halfH + 50), screenH - halfH - 30)
        let onLeft = point.x < screenW / 2
        let x = onLeft ? halfW + edgeMargin : screenW - halfW - edgeMargin
        return CGPoint(x: x, y: clampedY)
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
