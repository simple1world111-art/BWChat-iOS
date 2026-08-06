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
                voiceLayer
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
                            AvatarView(
                                url: call.remoteAvatarURL,
                                size: call.callType == .voice && call.state == .connected ? 156 : 100
                            )
                                .shadow(color: .white.opacity(0.2), radius: 20)
                        }

                        Text(call.groupName ?? call.remoteNickname)
                            .font(.system(size: 28, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.top, 20)
                    }

                    if !call.isLivePairCall || call.state != .connected {
                        statusText(call)
                            .padding(.top, 8)
                            .allowsHitTesting(false)
                    }

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
                    if call.isLivePairCall, call.state == .connected {
                        VStack(spacing: 8) {
                            statusText(call)
                            liveBillingBadge(call)
                        }
                            .padding(.horizontal, 16)
                            .padding(.bottom, 14)
                            .allowsHitTesting(false)
                    }

                    if call.state == .incoming {
                        incomingCallButtons
                    } else {
                        activeCallButtons(call: call)
                    }
                }

                Spacer().frame(height: 50)
                    .allowsHitTesting(false)
            }

            if let call = callManager.currentCall,
               call.state == .connected,
               let roleContext = call.liveRoleContext,
               !call.isLiveRoleIntroductionDismissed {
                LiveCallRoleIntroductionCard(
                    introduction: roleContext.introduction(isOutgoing: call.isOutgoing),
                    onDismiss: callManager.dismissLiveRoleIntroduction
                )
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
                .zIndex(20)
            }

            if let message = callManager.liveEndingMessage {
                LiveCallGracefulEndingCard(
                    message: message,
                    detail: callManager.liveEndingDetail
                )
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
                    .zIndex(40)
            }
        }
        .animation(.easeInOut(duration: 0.22), value: callManager.liveEndingMessage)
        .animation(.easeInOut(duration: 0.3), value: callManager.currentCall?.state)
        .statusBarHidden(true)
        .onAppear {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
    }

    private func liveBillingBadge(_ call: CallSession) -> some View {
        let policy = call.liveBillingPolicy ?? .fallback
        let experienceRemaining = call.liveExperience?.displayRemainingSeconds(
            connectedDuration: callManager.callDuration
        )
        let projectedCharge: Int
        if let experience = call.liveExperience {
            projectedCharge = LiveExperienceBillingPolicy.accruedOverageAmount(
                durationSeconds: experience.durationSeconds,
                connectedDuration: callManager.callDuration,
                policy: policy
            )
        } else {
            projectedCharge = policy.accruedAmount(for: callManager.callDuration)
        }
        let remainingFreeSeconds = policy.freeSecondsRemaining(
            for: callManager.callDuration
        )
        let isExperienceEndingSoon = experienceRemaining.map { $0 > 0 && $0 <= 60 } ?? false

        return HStack(spacing: 6) {
            Image(systemName: call.liveExperience == nil ? "pawprint.fill" : "ticket.fill")
            VStack(alignment: .leading, spacing: 2) {
                if let experienceRemaining, experienceRemaining > 0 {
                    Text(L10n.tr(
                        call.isOutgoing
                            ? "live.experience.remaining.viewer"
                            : "live.experience.remaining.host",
                        formatDuration(TimeInterval(experienceRemaining))
                    ))
                    .monospacedDigit()
                } else if call.isOutgoing {
                    if remainingFreeSeconds > 0 {
                        if call.liveExperience == nil {
                            Text(L10n.tr("live.billing.freePayer", remainingFreeSeconds))
                        } else {
                            Text(L10n.tr("live.experience.overage.viewer"))
                        }
                    } else if let total = call.confirmedLiveTotalCharge {
                        if let activityCatFood = call.confirmedLiveActivityCatFoodCharge,
                           activityCatFood > 0 {
                            Text(L10n.tr("live.billing.chargedActivityCatFood", activityCatFood))
                        }
                        if let goldCoins = call.confirmedLiveGoldCoinCharge, goldCoins > 0 {
                            Text(L10n.tr("live.billing.chargedGoldCoins", goldCoins))
                        }
                        Text(L10n.tr("live.billing.totalCharged", total))
                    } else if projectedCharge > 0 {
                        Text(L10n.tr("live.billing.estimatedSpendable", projectedCharge))
                    } else {
                        Text(L10n.tr("live.experience.overage.viewer"))
                    }
                } else if remainingFreeSeconds > 0, call.liveExperience == nil {
                    Text(L10n.tr("live.billing.freeHost", remainingFreeSeconds))
                } else if let confirmedEarning = call.confirmedLiveEarningGoldCoins {
                    Text(L10n.tr("live.billing.earnedGoldCoins", confirmedEarning))
                } else if projectedCharge > 0 {
                    Text(L10n.tr("live.billing.estimatedEarning", projectedCharge))
                } else {
                    Text(L10n.tr("live.experience.overage.host"))
                }
            }
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundColor(.white)
        .padding(.horizontal, 11)
        .padding(.vertical, 7)
        .background(
            isExperienceEndingSoon
                ? Color.orange.opacity(0.82)
                : Color.black.opacity(0.48),
            in: Capsule()
        )
        .accessibilityElement(children: .combine)
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

    // MARK: - Call Stages

    private var localAvatarURL: String {
        AuthManager.shared.currentUser?.avatarURL ?? ""
    }

    private var voiceLayer: some View {
        CallDarkStage()
    }

    // MARK: - Video Layer (tap to swap big/small after connecting)

    @ViewBuilder
    private var videoLayer: some View {
        if callManager.currentCall?.state == .connected {
            connectedVideoLayer
                .transition(.opacity)
        } else {
            preConnectedVideoLayer
                .transition(.opacity)
        }
    }

    @ViewBuilder
    private var preConnectedVideoLayer: some View {
        if callManager.currentCall?.isOutgoing == true,
           let localTrack = callManager.localVideoTrack,
           callManager.isLocalVideoEnabled {
            SwiftUIVideoView(
                localTrack,
                layoutMode: .fill,
                mirrorMode: callManager.isFrontCamera ? .mirror : .off
            )
            .ignoresSafeArea()
        } else {
            CallDarkStage()
        }
    }

    private var connectedVideoLayer: some View {
        ZStack(alignment: .topTrailing) {
            primaryVideoContent

            if isPrimaryParticipantMuted {
                CallMuteBadge(name: primaryParticipantName)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .padding(.leading, 16)
                    .padding(.bottom, 160)
                    .allowsHitTesting(false)
            }

            secondaryVideoButton
        }
    }

    @ViewBuilder
    private var primaryVideoContent: some View {
        if callManager.isRemotePrimary {
            if let remoteTrack = callManager.remoteVideoTrack {
                SwiftUIVideoView(remoteTrack, layoutMode: .fill)
                    .ignoresSafeArea()
            } else {
                CallAvatarStage(
                    avatarURL: callManager.currentCall?.remoteAvatarURL ?? "",
                    avatarSize: 190
                )
            }
        } else if let localTrack = callManager.localVideoTrack,
                  callManager.isLocalVideoEnabled {
            SwiftUIVideoView(
                localTrack,
                layoutMode: .fill,
                mirrorMode: callManager.isFrontCamera ? .mirror : .off
            )
            .ignoresSafeArea()
        } else {
            CallAvatarStage(avatarURL: localAvatarURL, avatarSize: 190)
        }
    }

    private var secondaryVideoButton: some View {
        let secondaryTrack: VideoTrack? = callManager.isRemotePrimary
            ? callManager.localVideoTrack
            : callManager.remoteVideoTrack
        let isSecondaryLocal = callManager.isRemotePrimary
        let secondaryAvatarURL = isSecondaryLocal
            ? localAvatarURL
            : (callManager.currentCall?.remoteAvatarURL ?? "")

        return Button {
            withAnimation(.easeInOut(duration: 0.3)) {
                callManager.isRemotePrimary.toggle()
            }
        } label: {
            ZStack(alignment: .bottomLeading) {
                if let track = secondaryTrack,
                   !isSecondaryLocal || callManager.isLocalVideoEnabled {
                    SwiftUIVideoView(
                        track,
                        layoutMode: .fill,
                        mirrorMode: (isSecondaryLocal && callManager.isFrontCamera) ? .mirror : .off
                    )
                } else {
                    CallVideoAvatarPlaceholder(avatarURL: secondaryAvatarURL)
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

    // MARK: - Incoming Call Buttons

    private var incomingCallButtons: some View {
        HStack(spacing: 88) {
            VStack(spacing: 8) {
                Button { callManager.rejectCall() } label: {
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 31))
                        .foregroundColor(.white)
                        .frame(width: 76, height: 76)
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
                        .font(.system(size: 31))
                        .foregroundColor(.white)
                        .frame(width: 76, height: 76)
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

    // MARK: - Active Call Buttons

    @ViewBuilder
    private func activeCallButtons(call: CallSession) -> some View {
        if call.callType == .video {
            HStack(spacing: 0) {
                controlButton(
                    icon: callManager.isMuted ? "mic.slash.fill" : "mic.fill",
                    label: callManager.isMuted ? L10n.tr("call.unmute") : L10n.tr("call.mute"),
                    isActive: callManager.isMuted,
                    identifier: "call.mute",
                    buttonDiameter: 50
                ) { callManager.toggleMute() }

                Spacer(minLength: 6)

                controlButton(
                    icon: callManager.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.slash.fill",
                    label: callManager.isSpeakerOn ? L10n.tr("call.speaker") : L10n.tr("call.earpiece"),
                    isActive: callManager.isSpeakerOn,
                    identifier: "call.speaker",
                    buttonDiameter: 50
                ) { callManager.toggleSpeaker() }

                Spacer(minLength: 6)

                controlButton(
                    icon: callManager.isLocalVideoEnabled ? "video.fill" : "video.slash.fill",
                    label: callManager.isLocalVideoEnabled ? L10n.tr("call.cameraOff") : L10n.tr("call.cameraOn"),
                    isActive: !callManager.isLocalVideoEnabled,
                    identifier: "call.camera",
                    buttonDiameter: 50
                ) { callManager.toggleLocalVideo() }

                Spacer(minLength: 6)

                endCallButton(buttonDiameter: 54)

                Spacer(minLength: 6)

                controlButton(
                    icon: "camera.rotate.fill",
                    label: L10n.tr("call.flip"),
                    isActive: false,
                    identifier: "call.flip",
                    buttonDiameter: 50
                ) { callManager.flipCamera() }
            }
            .padding(.horizontal, 12)
        } else {
            HStack(spacing: 0) {
                controlButton(
                    icon: callManager.isMuted ? "mic.slash.fill" : "mic.fill",
                    label: callManager.isMuted ? L10n.tr("call.unmute") : L10n.tr("call.mute"),
                    isActive: callManager.isMuted,
                    identifier: "call.mute",
                    buttonDiameter: 68
                ) { callManager.toggleMute() }

                Spacer(minLength: 28)

                controlButton(
                    icon: callManager.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.slash.fill",
                    label: callManager.isSpeakerOn ? L10n.tr("call.speaker") : L10n.tr("call.earpiece"),
                    isActive: callManager.isSpeakerOn,
                    identifier: "call.speaker",
                    buttonDiameter: 68
                ) { callManager.toggleSpeaker() }

                Spacer(minLength: 28)

                endCallButton(buttonDiameter: 68)
            }
            .padding(.horizontal, 28)
        }
    }

    private func endCallButton(buttonDiameter: CGFloat) -> some View {
        VStack(spacing: 6) {
            Button { callManager.endCall() } label: {
                Image(systemName: "phone.down.fill")
                    .font(.system(size: buttonDiameter * 0.4))
                    .foregroundColor(.white)
                    .frame(width: buttonDiameter, height: buttonDiameter)
                    .background(Color.red)
                    .clipShape(Circle())
            }
            .accessibilityIdentifier("call.end")
            Text(L10n.tr("call.hangUp"))
                .font(.system(size: 12))
                .foregroundColor(.white.opacity(0.7))
                .lineLimit(1)
                .minimumScaleFactor(0.68)
        }
        .frame(width: buttonDiameter)
    }

    private func controlButton(
        icon: String,
        label: String,
        isActive: Bool,
        identifier: String,
        buttonDiameter: CGFloat,
        action: @escaping () -> Void
    ) -> some View {
        VStack(spacing: 6) {
            Button(action: action) {
                Image(systemName: icon)
                    .font(.system(size: buttonDiameter * 0.4))
                    .foregroundColor(isActive ? .black : .white)
                    .frame(width: buttonDiameter, height: buttonDiameter)
                    .background(isActive ? Color.white : Color.white.opacity(0.2))
                    .clipShape(Circle())
            }
            .accessibilityIdentifier(identifier)
            Text(label)
                .font(.system(size: 12))
                .foregroundColor(.white.opacity(0.7))
                .lineLimit(1)
                .minimumScaleFactor(0.68)
        }
        .frame(width: buttonDiameter)
    }

    private func formatDuration(_ interval: TimeInterval) -> String {
        let s = Int(interval)
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}

private struct LiveCallGracefulEndingCard: View {
    let message: String
    let detail: String?

    var body: some View {
        ZStack {
            Color.black.opacity(0.34)
                .ignoresSafeArea()

            VStack(spacing: 12) {
                Image(systemName: "pawprint.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundColor(AppColors.accent)
                    .frame(width: 54, height: 54)
                    .background(AppColors.accent.opacity(0.12))
                    .clipShape(Circle())

                Text(message)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .multilineTextAlignment(.center)

                if let detail {
                    Text(detail)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(AppColors.primaryText.opacity(0.82))
                        .multilineTextAlignment(.center)
                }

                Text("正在为你结束本次视频")
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.secondaryText)

                ProgressView()
                    .tint(AppColors.accent)
                    .padding(.top, 2)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 22)
            .frame(maxWidth: 310)
            .background(.ultraThinMaterial)
            .background(AppColors.cardBackground.opacity(0.9))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .shadow(color: .black.opacity(0.2), radius: 24, x: 0, y: 12)
            .padding(.horizontal, 32)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            [message, detail, "正在为你结束本次视频"]
                .compactMap { $0 }
                .joined(separator: "，")
        )
    }
}

private struct LiveCallRoleIntroductionCard: View {
    let introduction: LiveCallRoleIntroduction
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.38)
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "theatermasks.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundColor(AppColors.accent)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("本次直播角色")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                        Text(introduction.title)
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundColor(AppColors.primaryText)
                    }

                    Spacer(minLength: 8)

                    Button(action: onDismiss) {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(AppColors.secondaryText)
                            .frame(width: 32, height: 32)
                            .background(AppColors.secondaryBackground)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("关闭角色介绍")
                }

                ScrollView {
                    Text(introduction.detail)
                        .font(.system(size: 16))
                        .foregroundColor(AppColors.primaryText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .lineSpacing(4)
                }
                .frame(maxHeight: 180)

                Button("我知道了", action: onDismiss)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(AppColors.accentGradient)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .buttonStyle(.plain)
            }
            .padding(20)
            .frame(maxWidth: 340)
            .background(AppColors.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .shadow(color: .black.opacity(0.24), radius: 24, x: 0, y: 12)
            .padding(.horizontal, 24)
        }
        .accessibilityElement(children: .contain)
    }
}

private struct CallDarkStage: View {
    var body: some View {
        LinearGradient(
            colors: [Color(hex: "171923"), Color(hex: "101522"), Color.black],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

private struct CallAvatarStage: View {
    let avatarURL: String
    let avatarSize: CGFloat

    var body: some View {
        ZStack {
            CallDarkStage()

            AvatarView(url: avatarURL, size: avatarSize)
                .shadow(color: .black.opacity(0.38), radius: 26, y: 12)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

private struct CallVideoAvatarPlaceholder: View {
    let avatarURL: String

    var body: some View {
        GeometryReader { proxy in
            let size = max(44, min(proxy.size.width, proxy.size.height) - 18)

            ZStack {
                Color(hex: "2A2A3E")

                AvatarView(url: avatarURL, size: size)
                    .shadow(color: .black.opacity(0.24), radius: 8, y: 4)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .accessibilityHidden(true)
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
