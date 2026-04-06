// BWChat/Managers/CallManager.swift
// Manages call state and WebRTC signaling

import Foundation
import Combine
import AVFoundation

@MainActor
class CallManager: ObservableObject {
    static let shared = CallManager()

    @Published var currentCall: CallSession?
    @Published var isMuted = false
    @Published var isSpeakerOn = false
    @Published var isLocalVideoEnabled = true
    @Published var callDuration: TimeInterval = 0

    private var cancellables = Set<AnyCancellable>()
    private var durationTimer: Task<Void, Never>?

    private init() {
        setupSignalingListeners()
    }

    // MARK: - Outgoing Call

    func startCall(to userID: String, nickname: String, avatarURL: String, type: CallType) {
        guard currentCall == nil else { return }

        currentCall = CallSession(
            remoteUserID: userID,
            remoteNickname: nickname,
            remoteAvatarURL: avatarURL,
            callType: type,
            isOutgoing: true,
            state: .outgoing,
            startedAt: Date()
        )

        configureAudioSession()

        // In a full implementation, create WebRTC offer SDP here
        // For now, send a placeholder offer to signal the call
        WebSocketService.shared.sendCallOffer(
            targetID: userID,
            callType: type,
            sdp: "placeholder_sdp"
        )
    }

    // MARK: - Incoming Call

    func handleIncomingCall(from userID: String, callType: CallType, sdp: String) {
        if currentCall != nil {
            WebSocketService.shared.sendCallBusy(targetID: userID)
            return
        }

        let user = UserCacheManager.shared.getUser(userID: userID)
        currentCall = CallSession(
            remoteUserID: userID,
            remoteNickname: user?.nickname ?? userID,
            remoteAvatarURL: user?.avatarURL ?? "",
            callType: callType,
            isOutgoing: false,
            state: .incoming,
            startedAt: Date()
        )
    }

    func acceptCall() {
        guard var call = currentCall, call.state == .incoming else { return }

        call.state = .connected
        currentCall = call

        configureAudioSession()
        startDurationTimer()

        // Send answer SDP
        WebSocketService.shared.sendCallAnswer(
            targetID: call.remoteUserID,
            sdp: "placeholder_answer_sdp"
        )
    }

    func rejectCall() {
        guard let call = currentCall else { return }
        WebSocketService.shared.sendCallReject(targetID: call.remoteUserID)
        endCallLocally()
    }

    func endCall() {
        guard let call = currentCall else { return }
        WebSocketService.shared.sendCallEnd(targetID: call.remoteUserID)
        endCallLocally()
    }

    func toggleMute() {
        isMuted.toggle()
    }

    func toggleSpeaker() {
        isSpeakerOn.toggle()
        let session = AVAudioSession.sharedInstance()
        try? session.overrideOutputAudioRoute(isSpeakerOn ? .speaker : .none)
    }

    func toggleLocalVideo() {
        isLocalVideoEnabled.toggle()
    }

    // MARK: - Private

    private func endCallLocally() {
        durationTimer?.cancel()
        durationTimer = nil
        callDuration = 0
        isMuted = false
        isSpeakerOn = false
        isLocalVideoEnabled = true
        currentCall = nil
        deactivateAudioSession()
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
        try? session.setActive(true)
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func startDurationTimer() {
        durationTimer?.cancel()
        let startTime = Date()
        durationTimer = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled else { break }
                callDuration = Date().timeIntervalSince(startTime)
            }
        }
    }

    private func setupSignalingListeners() {
        WebSocketService.shared.callOfferPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let fromUser = data["from_user_id"] as? String,
                      let typeStr = data["call_type"] as? String,
                      let callType = CallType(rawValue: typeStr),
                      let sdp = data["sdp"] as? String else { return }
                self?.handleIncomingCall(from: fromUser, callType: callType, sdp: sdp)
            }
            .store(in: &cancellables)

        WebSocketService.shared.callAnswerPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self = self, var call = self.currentCall,
                      call.state == .outgoing else { return }
                call.state = .connected
                self.currentCall = call
                self.startDurationTimer()
            }
            .store(in: &cancellables)

        WebSocketService.shared.callEndPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.endCallLocally()
            }
            .store(in: &cancellables)

        WebSocketService.shared.callRejectPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.endCallLocally()
            }
            .store(in: &cancellables)

        WebSocketService.shared.callBusyPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.endCallLocally()
            }
            .store(in: &cancellables)
    }
}
