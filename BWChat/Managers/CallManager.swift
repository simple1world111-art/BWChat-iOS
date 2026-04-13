// BWChat/Managers/CallManager.swift
// Manages call state and LiveKit room connections for 1v1 and group calls

import Foundation
import UIKit
import Combine
import AVFoundation
import AudioToolbox
import LiveKit

@MainActor
class CallManager: ObservableObject {
    static let shared = CallManager()

    @Published var currentCall: CallSession?
    @Published var isMuted = false
    @Published var isSpeakerOn = false
    @Published var isLocalVideoEnabled = true
    @Published var callDuration: TimeInterval = 0
    @Published var isMinimized = false
    @Published var isFrontCamera = true

    // LiveKit room & participants
    @Published var room: Room?
    @Published var remoteVideoTrack: VideoTrack?
    @Published var localVideoTrack: VideoTrack?
    @Published var remoteParticipants: [RemoteParticipant] = []

    private var cancellables = Set<AnyCancellable>()
    private var durationTimer: Task<Void, Never>?
    private var roomDelegate: RoomDelegateHandler?
    private var ringtonePlayer: AVAudioPlayer?
    private var ringtoneTimer: Task<Void, Never>?

    private init() {
        setupSignalingListeners()
    }

    // MARK: - 1v1 Call: Start (Outgoing)

    func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    func minimizeCall() {
        isMinimized = true
    }

    func restoreCall() {
        isMinimized = false
    }

    func startCall(to userID: String, nickname: String, avatarURL: String, type: CallType) {
        guard currentCall == nil else { return }
        dismissKeyboard()

        currentCall = CallSession(
            remoteUserID: userID,
            remoteNickname: nickname,
            remoteAvatarURL: avatarURL,
            callType: type,
            isOutgoing: true,
            state: .outgoing,
            startedAt: Date()
        )

        playRingtone(isOutgoing: true)

        Task {
            do {
                let resp = try await APIService.shared.startCall(targetID: userID, callType: type.rawValue)
                if var call = currentCall {
                    call.roomName = resp.roomName
                    call.livekitToken = resp.token
                    call.livekitURL = resp.livekitUrl
                    currentCall = call
                }
                await connectToRoom(url: resp.livekitUrl, token: resp.token, isVideo: type == .video)
            } catch {
                print("[CallManager] Failed to start call: \(error)")
                await safeEndCall()
            }
        }
    }

    // MARK: - Accept (Incoming — works for both 1v1 and group)

    func acceptCall() {
        guard var call = currentCall, call.state == .incoming else { return }
        call.state = .connecting
        currentCall = call
        stopRingtone()

        Task {
            do {
                if let groupID = call.groupID {
                    let resp = try await APIService.shared.startGroupCall(groupID: groupID, callType: call.callType.rawValue)
                    if var c = currentCall {
                        c.roomName = resp.roomName
                        c.livekitToken = resp.token
                        c.livekitURL = resp.livekitUrl
                        currentCall = c
                    }
                    await connectToRoom(url: resp.livekitUrl, token: resp.token, isVideo: call.callType == .video)
                } else {
                    let resp = try await APIService.shared.joinCall(roomName: call.roomName)
                    if var c = currentCall {
                        c.livekitToken = resp.token
                        c.livekitURL = resp.livekitUrl
                        currentCall = c
                    }
                    await connectToRoom(url: resp.livekitUrl, token: resp.token, isVideo: call.callType == .video)
                }
            } catch {
                print("[CallManager] Failed to join call: \(error)")
                await safeEndCall()
            }
        }
    }

    // MARK: - Group Call: Start or Join

    func startGroupCall(groupID: Int, groupName: String, type: CallType) {
        guard currentCall == nil else { return }
        dismissKeyboard()

        currentCall = CallSession(
            remoteUserID: "",
            remoteNickname: groupName,
            remoteAvatarURL: "",
            callType: type,
            isOutgoing: true,
            state: .connecting,
            startedAt: Date(),
            groupID: groupID,
            groupName: groupName
        )

        Task {
            do {
                let resp = try await APIService.shared.startGroupCall(groupID: groupID, callType: type.rawValue)
                if var call = currentCall {
                    call.roomName = resp.roomName
                    call.livekitToken = resp.token
                    call.livekitURL = resp.livekitUrl
                    currentCall = call
                }
                await connectToRoom(url: resp.livekitUrl, token: resp.token, isVideo: type == .video)
            } catch {
                print("[CallManager] Failed to start group call: \(error)")
                await safeEndCall()
            }
        }
    }

    func joinGroupCall(groupID: Int, groupName: String, roomName: String, callType: CallType) {
        guard currentCall == nil else { return }

        currentCall = CallSession(
            remoteUserID: "",
            remoteNickname: groupName,
            remoteAvatarURL: "",
            callType: callType,
            isOutgoing: false,
            state: .connecting,
            startedAt: Date(),
            roomName: roomName,
            groupID: groupID,
            groupName: groupName
        )

        Task {
            do {
                let resp = try await APIService.shared.joinCall(roomName: roomName)
                if var call = currentCall {
                    call.livekitToken = resp.token
                    call.livekitURL = resp.livekitUrl
                    currentCall = call
                }
                await connectToRoom(url: resp.livekitUrl, token: resp.token, isVideo: callType == .video)
            } catch {
                print("[CallManager] Failed to join group call: \(error)")
                await safeEndCall()
            }
        }
    }

    // MARK: - LiveKit Room Connection

    private func connectToRoom(url: String, token: String, isVideo: Bool) async {
        let newRoom = Room()
        let handler = RoomDelegateHandler(manager: self)
        self.roomDelegate = handler
        newRoom.add(delegate: handler)
        self.room = newRoom

        do {
            let connectOptions = ConnectOptions(autoSubscribe: true)
            try await newRoom.connect(url: url, token: token, connectOptions: connectOptions)

            configureAudioSession()

            // Publish local audio
            try await newRoom.localParticipant.setMicrophone(enabled: true)

            // Publish local video with higher quality, explicitly using front camera
            if isVideo {
                isFrontCamera = true
                let videoCaptureOptions = CameraCaptureOptions(
                    position: .front,
                    dimensions: .h720_169,
                    fps: 30
                )
                let videoPublishOptions = VideoPublishOptions(
                    encoding: VideoEncoding(maxBitrate: 1_500_000, maxFps: 30)
                )
                try await newRoom.localParticipant.setCamera(
                    enabled: true,
                    captureOptions: videoCaptureOptions,
                    publishOptions: videoPublishOptions
                )
                if let pub = newRoom.localParticipant.localVideoTracks.first,
                   let track = pub.track as? VideoTrack {
                    localVideoTrack = track
                }
            }

            stopRingtone()
            if var call = currentCall {
                call.state = .connected
                currentCall = call
            }
            startDurationTimer()
            updateRemoteParticipants()
        } catch {
            print("[CallManager] Room connect failed: \(error)")
            await safeEndCall()
        }
    }

    private func safeEndCall() async {
        try? await Task.sleep(nanoseconds: 600_000_000)
        endCallLocally()
    }

    // MARK: - Controls

    func rejectCall() {
        guard let call = currentCall else { return }
        if call.roomName.isEmpty {
            WebSocketService.shared.sendCallReject(targetID: call.remoteUserID)
        }
        endCallLocally()
    }

    func endCall() {
        guard let call = currentCall else { return }

        if let groupID = call.groupID {
            Task { try? await APIService.shared.leaveGroupCall(groupID: groupID) }
        }

        endCallLocally()
    }

    func toggleMute() {
        isMuted.toggle()
        Task {
            _ = try? await room?.localParticipant.setMicrophone(enabled: !isMuted)
        }
    }

    func toggleSpeaker() {
        isSpeakerOn.toggle()
        let session = AVAudioSession.sharedInstance()
        let port: AVAudioSession.PortOverride = isSpeakerOn ? .speaker : .none
        _ = try? session.overrideOutputAudioPort(port)
    }

    func toggleLocalVideo() {
        isLocalVideoEnabled.toggle()
        Task {
            if isLocalVideoEnabled {
                let position: AVCaptureDevice.Position = isFrontCamera ? .front : .back
                let captureOpts = CameraCaptureOptions(position: position, dimensions: .h720_169, fps: 30)
                let publishOpts = VideoPublishOptions(encoding: VideoEncoding(maxBitrate: 1_500_000, maxFps: 30))
                _ = try? await room?.localParticipant.setCamera(
                    enabled: true, captureOptions: captureOpts, publishOptions: publishOpts
                )
                if let pub = room?.localParticipant.localVideoTracks.first,
                   let track = pub.track as? VideoTrack {
                    localVideoTrack = track
                }
            } else {
                _ = try? await room?.localParticipant.setCamera(enabled: false)
                localVideoTrack = nil
            }
        }
    }

    func flipCamera() {
        isFrontCamera.toggle()
        Task {
            let position: AVCaptureDevice.Position = isFrontCamera ? .front : .back
            let captureOpts = CameraCaptureOptions(position: position, dimensions: .h720_169, fps: 30)
            let publishOpts = VideoPublishOptions(encoding: VideoEncoding(maxBitrate: 1_500_000, maxFps: 30))
            _ = try? await room?.localParticipant.setCamera(enabled: false)
            _ = try? await room?.localParticipant.setCamera(
                enabled: true, captureOptions: captureOpts, publishOptions: publishOpts
            )
            if let pub = room?.localParticipant.localVideoTracks.first,
               let track = pub.track as? VideoTrack {
                localVideoTrack = track
            }
        }
    }

    // MARK: - View Helpers (no LiveKit types exposed)

    var remoteParticipantCount: Int {
        remoteParticipants.count
    }

    var remoteParticipantNames: [String] {
        remoteParticipants.map { $0.name ?? $0.identity?.stringValue ?? "" }
    }

    var hasRemoteVideo: Bool {
        remoteVideoTrack != nil
    }

    var hasLocalVideo: Bool {
        localVideoTrack != nil
    }

    // MARK: - Internal: Participant Updates

    func updateRemoteParticipants() {
        guard let room = room else { return }
        remoteParticipants = Array(room.remoteParticipants.values)

        // Find the first available remote video track
        remoteVideoTrack = nil
        for participant in remoteParticipants {
            for pub in participant.videoTracks {
                if let track = pub.track as? VideoTrack {
                    remoteVideoTrack = track
                    return
                }
            }
        }
    }

    // MARK: - Private

    func endCallLocally() {
        stopRingtone()

        let endedCall = currentCall
        let duration = callDuration

        durationTimer?.cancel()
        durationTimer = nil
        callDuration = 0
        isMuted = false
        isSpeakerOn = false
        isLocalVideoEnabled = true
        isMinimized = false
        isFrontCamera = true
        localVideoTrack = nil
        remoteVideoTrack = nil
        remoteParticipants = []

        let roomToClean = room
        room = nil
        roomDelegate = nil
        currentCall = nil

        Task {
            // Explicitly stop camera and mic before disconnecting to release hardware
            _ = try? await roomToClean?.localParticipant.setCamera(enabled: false)
            _ = try? await roomToClean?.localParticipant.setMicrophone(enabled: false)
            await roomToClean?.disconnect()
        }

        deactivateAudioSession()

        if let call = endedCall, call.groupID == nil, !call.remoteUserID.isEmpty {
            Task { await sendCallRecord(call: call, duration: duration) }
        }
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        _ = try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
        _ = try? session.setActive(true)
    }

    private func deactivateAudioSession() {
        _ = try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
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

    // MARK: - WebSocket Signaling (for incoming call invitations)

    private func setupSignalingListeners() {
        // 1v1 call invite from WebSocket
        WebSocketService.shared.callOfferPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self = self else { return }
                guard let callerID = data["caller_id"] as? String,
                      let callerName = data["caller_name"] as? String,
                      let roomName = data["room_name"] as? String,
                      let typeStr = data["call_type"] as? String,
                      let callType = CallType(rawValue: typeStr) else { return }

                let callerAvatar = data["caller_avatar"] as? String ?? ""

                if self.currentCall != nil { return }

                self.currentCall = CallSession(
                    remoteUserID: callerID,
                    remoteNickname: callerName,
                    remoteAvatarURL: callerAvatar,
                    callType: callType,
                    isOutgoing: false,
                    state: .incoming,
                    startedAt: Date(),
                    roomName: roomName
                )
                self.playRingtone(isOutgoing: false)
            }
            .store(in: &cancellables)

        // Call ended by remote
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

        // Group call invite from WebSocket
        WebSocketService.shared.groupCallInvitePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self = self else { return }
                guard let groupID = data["group_id"] as? Int,
                      let groupName = data["group_name"] as? String,
                      let roomName = data["room_name"] as? String,
                      let typeStr = data["call_type"] as? String,
                      let callType = CallType(rawValue: typeStr) else { return }

                if self.currentCall != nil { return }

                self.currentCall = CallSession(
                    remoteUserID: data["caller_id"] as? String ?? "",
                    remoteNickname: groupName,
                    remoteAvatarURL: "",
                    callType: callType,
                    isOutgoing: false,
                    state: .incoming,
                    startedAt: Date(),
                    roomName: roomName,
                    groupID: groupID,
                    groupName: groupName
                )
                self.playRingtone(isOutgoing: false)
            }
            .store(in: &cancellables)

        // Group call ended
        WebSocketService.shared.groupCallEndedPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] groupID in
                guard let self = self else { return }
                if self.currentCall?.groupID == groupID {
                    self.endCallLocally()
                }
            }
            .store(in: &cancellables)
    }
    // MARK: - Ringtone

    private func playRingtone(isOutgoing: Bool) {
        stopRingtone()
        ringtoneTimer = Task {
            while !Task.isCancelled {
                if isOutgoing {
                    AudioServicesPlaySystemSound(1151)
                } else {
                    AudioServicesPlaySystemSound(1005)
                    AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
                }
                try? await Task.sleep(nanoseconds: isOutgoing ? 3_000_000_000 : 2_000_000_000)
            }
        }
    }

    private func stopRingtone() {
        ringtoneTimer?.cancel()
        ringtoneTimer = nil
        ringtonePlayer?.stop()
        ringtonePlayer = nil
    }

    // MARK: - Call Record Message

    private func sendCallRecord(call: CallSession, duration: TimeInterval) async {
        let typeLabel = call.callType == .video ? "视频通话" : "语音通话"
        let content: String
        if call.state == .connected || duration > 0 {
            let mins = Int(duration) / 60
            let secs = Int(duration) % 60
            content = "[\(typeLabel)] \(String(format: "%02d:%02d", mins, secs))"
        } else if call.isOutgoing {
            content = "[\(typeLabel)] 对方未接听"
        } else {
            content = "[\(typeLabel)] 未接听"
        }

        do {
            _ = try await APIService.shared.sendTextMessage(
                receiverID: call.remoteUserID,
                content: content
            )
        } catch {
            print("[CallManager] Failed to send call record: \(error)")
        }
    }
}

// MARK: - LiveKit Room Delegate

final class RoomDelegateHandler: RoomDelegate, @unchecked Sendable {
    weak var manager: CallManager?

    init(manager: CallManager) {
        self.manager = manager
    }

    nonisolated func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        Task { @MainActor in
            manager?.updateRemoteParticipants()
        }
    }

    nonisolated func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        Task { @MainActor in
            manager?.updateRemoteParticipants()
            // For 1v1: if all remote participants left, end call
            if manager?.currentCall?.groupID == nil && room.remoteParticipants.isEmpty {
                manager?.endCallLocally()
            }
        }
    }

    nonisolated func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        Task { @MainActor in
            manager?.updateRemoteParticipants()
        }
    }

    nonisolated func room(_ room: Room, participant: RemoteParticipant, didUnsubscribeTrack publication: RemoteTrackPublication) {
        Task { @MainActor in
            manager?.updateRemoteParticipants()
        }
    }

    nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        Task { @MainActor in
            manager?.endCallLocally()
        }
    }
}
