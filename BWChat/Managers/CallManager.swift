// BWChat/Managers/CallManager.swift
// Manages call state and LiveKit room connections for 1v1 and group calls

import Foundation
import UIKit
import Combine
import AVFoundation
import AudioToolbox
import LiveKit

private enum CallManagerError: LocalizedError {
    case invalidLiveKitURL

    var errorDescription: String? {
        L10n.tr("call.error.invalidServer")
    }
}

@MainActor
class CallManager: ObservableObject {
    static let shared = CallManager()

    @Published var currentCall: CallSession?
    @Published var isMuted = false
    /// Default speaker (loudspeaker); user can switch to earpiece with the toolbar control.
    @Published var isSpeakerOn = true
    @Published var isLocalVideoEnabled = true
    @Published var callDuration: TimeInterval = 0
    @Published var isMinimized = false
    @Published var isFrontCamera = true
    @Published var isRemotePrimary = true
    @Published var errorMessage: String?

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
    private var connectionTimeoutTask: Task<Void, Never>?
    private var ringTimeoutTask: Task<Void, Never>?

    private let connectionTimeout: UInt64 = 20_000_000_000
    private let outgoingRingTimeout: UInt64 = 45_000_000_000

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

    @discardableResult
    func receiveIncomingCall(
        callerID: String,
        callerName: String,
        callerAvatar: String,
        roomName: String,
        callType: CallType
    ) -> Bool {
        guard currentCall == nil else {
            WebSocketService.shared.sendCallBusy(targetID: callerID)
            return false
        }

        currentCall = CallSession(
            remoteUserID: callerID,
            remoteNickname: callerName,
            remoteAvatarURL: callerAvatar,
            callType: callType,
            isOutgoing: false,
            state: .incoming,
            startedAt: Date(),
            roomName: roomName
        )
        playRingtone(isOutgoing: false)
        return true
    }

    @discardableResult
    func receiveIncomingGroupCall(
        callerID: String,
        groupID: Int,
        groupName: String,
        roomName: String,
        callType: CallType
    ) -> Bool {
        guard currentCall == nil else { return false }

        currentCall = CallSession(
            remoteUserID: callerID,
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
        playRingtone(isOutgoing: false)
        return true
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
        let callID = currentCall?.id

        Task {
            guard await ensureMediaPermissions(for: type),
                  currentCall?.id == callID else { return }
            playRingtone(isOutgoing: true)

            do {
                let resp = try await APIService.shared.startCall(targetID: userID, callType: type.rawValue)
                guard currentCall?.id == callID else { return }
                let livekitURL = try normalizedLiveKitURL(resp.livekitUrl)
                if var call = currentCall {
                    call.roomName = resp.roomName
                    call.livekitToken = resp.token
                    call.livekitURL = livekitURL
                    currentCall = call
                }
                startOutgoingRingTimeout(for: callID)
                await connectToRoom(url: livekitURL, token: resp.token, isVideo: type == .video)
            } catch {
                print("[CallManager] Failed to start call: \(error)")
                failCall(L10n.tr("call.error.start", error.localizedDescription))
            }
        }
    }

    // MARK: - Accept (Incoming — works for both 1v1 and group)

    func acceptCall() {
        guard let call = currentCall, call.state == .incoming else { return }
        dismissKeyboard()
        let callID = call.id

        Task {
            guard await ensureMediaPermissions(for: call.callType) else {
                if call.groupID == nil, !call.remoteUserID.isEmpty {
                    WebSocketService.shared.sendCallReject(
                        targetID: call.remoteUserID,
                        reason: "permission_denied"
                    )
                }
                return
            }
            guard currentCall?.id == callID else { return }
            if var current = currentCall {
                current.state = .connecting
                currentCall = current
            }
            stopRingtone()

            do {
                let resp = try await APIService.shared.joinCall(roomName: call.roomName)
                guard currentCall?.id == callID else { return }
                let livekitURL = try normalizedLiveKitURL(resp.livekitUrl)
                if var current = currentCall {
                    current.roomName = resp.roomName
                    current.livekitToken = resp.token
                    current.livekitURL = livekitURL
                    currentCall = current
                }
                await connectToRoom(url: livekitURL, token: resp.token, isVideo: call.callType == .video)
            } catch {
                print("[CallManager] Failed to join call: \(error)")
                failCall(L10n.tr("call.error.join", error.localizedDescription))
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
        let callID = currentCall?.id

        Task {
            guard await ensureMediaPermissions(for: type),
                  currentCall?.id == callID else { return }
            do {
                let resp = try await APIService.shared.startGroupCall(groupID: groupID, callType: type.rawValue)
                guard currentCall?.id == callID else { return }
                let livekitURL = try normalizedLiveKitURL(resp.livekitUrl)
                if var call = currentCall {
                    call.roomName = resp.roomName
                    call.livekitToken = resp.token
                    call.livekitURL = livekitURL
                    currentCall = call
                }
                await connectToRoom(url: livekitURL, token: resp.token, isVideo: type == .video)
            } catch {
                print("[CallManager] Failed to start group call: \(error)")
                failCall(L10n.tr("call.error.start", error.localizedDescription))
            }
        }
    }

    func joinGroupCall(groupID: Int, groupName: String, roomName: String, callType: CallType) {
        guard currentCall == nil else { return }
        dismissKeyboard()

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
        let callID = currentCall?.id

        Task {
            guard await ensureMediaPermissions(for: callType),
                  currentCall?.id == callID else { return }
            do {
                let resp = try await APIService.shared.joinCall(roomName: roomName)
                guard currentCall?.id == callID else { return }
                let livekitURL = try normalizedLiveKitURL(resp.livekitUrl)
                if var call = currentCall {
                    call.livekitToken = resp.token
                    call.livekitURL = livekitURL
                    currentCall = call
                }
                await connectToRoom(url: livekitURL, token: resp.token, isVideo: callType == .video)
            } catch {
                print("[CallManager] Failed to join group call: \(error)")
                failCall(L10n.tr("call.error.join", error.localizedDescription))
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
        AudioManager.shared.isSpeakerOutputPreferred = isSpeakerOn
        startConnectionTimeout(for: newRoom)

        do {
            let connectOptions = ConnectOptions(autoSubscribe: true)
            try await newRoom.connect(url: url, token: token, connectOptions: connectOptions)
            guard room === newRoom else {
                await newRoom.disconnect()
                return
            }
            connectionTimeoutTask?.cancel()
            connectionTimeoutTask = nil

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

            // Outgoing 1v1 calls: stay "ringing" until the callee actually joins
            // LiveKit and publishes audio — otherwise the green timer starts before
            // the callee has answered. Group outgoing doesn't wait (the caller is
            // already "in" the room even if nobody else has joined yet).
            let isOutgoing1v1 = currentCall?.isOutgoing == true && currentCall?.groupID == nil
            if !isOutgoing1v1 {
                stopRingtone()
                if var call = currentCall {
                    call.state = .connected
                    currentCall = call
                }
                startDurationTimer()
            }
            updateRemoteParticipants()
        } catch {
            print("[CallManager] Room connect failed: \(error)")
            guard room === newRoom else { return }
            failCall(L10n.tr("call.error.connection"))
        }
    }

    // MARK: - Controls

    func rejectCall() {
        guard let call = currentCall else { return }
        if call.groupID == nil, !call.remoteUserID.isEmpty {
            WebSocketService.shared.sendCallReject(targetID: call.remoteUserID)
        }
        endCallLocally()
    }

    func endCall() {
        guard let call = currentCall else { return }

        if let groupID = call.groupID {
            Task { try? await APIService.shared.leaveGroupCall(groupID: groupID) }
        } else if !call.remoteUserID.isEmpty {
            WebSocketService.shared.sendCallEnd(targetID: call.remoteUserID)
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
        // LiveKit 2.x owns AVAudioSession while its audio engine is running.
        // Updating the SDK preference avoids racing its automatic configuration.
        AudioManager.shared.isSpeakerOutputPreferred = isSpeakerOn
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
        Task {
            guard let publication = room?.localParticipant.localVideoTracks.first,
                  let localTrack = publication.track as? LocalVideoTrack,
                  let cameraCapturer = localTrack.capturer as? CameraCapturer else {
                return
            }
            _ = try? await cameraCapturer.switchCameraPosition()
            isFrontCamera.toggle()
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
                    break
                }
            }
            if remoteVideoTrack != nil { break }
        }

        // First remote joined on an outgoing call: now we're truly "connected".
        // Only transition from .outgoing (not .connecting or other states) to avoid
        // premature timer start. For 1v1 calls also verify at least one remote has
        // published an audio track, ensuring the callee actually joined media.
        if currentCall?.isOutgoing == true,
           currentCall?.state == .outgoing,
           !remoteParticipants.isEmpty {
            let hasRemoteAudio = remoteParticipants.contains { p in
                !p.audioTracks.isEmpty
            }
            // For group calls, any participant joining is enough;
            // for 1v1, wait until the remote publishes audio
            let isGroup = currentCall?.groupID != nil
            if isGroup || hasRemoteAudio {
                stopRingtone()
                ringTimeoutTask?.cancel()
                ringTimeoutTask = nil
                if var call = currentCall {
                    call.state = .connected
                    currentCall = call
                }
                startDurationTimer()
                dismissKeyboard()
            }
        }
    }

    // MARK: - Private

    private func normalizedLiveKitURL(_ serverURL: String) throws -> String {
        let value = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else {
            throw CallManagerError.invalidLiveKitURL
        }

        let resolvedValue: String
        if value.hasPrefix("/") {
            guard var base = URLComponents(string: AppConfig.apiBaseURL),
                  base.host != nil else {
                throw CallManagerError.invalidLiveKitURL
            }
            base.path = value
            base.query = nil
            base.fragment = nil
            resolvedValue = base.string ?? ""
        } else {
            resolvedValue = value
        }

        guard var components = URLComponents(string: resolvedValue),
              let scheme = components.scheme?.lowercased(),
              components.host != nil else {
            throw CallManagerError.invalidLiveKitURL
        }

        switch scheme {
        case "wss", "ws":
            break
        case "https":
            components.scheme = "wss"
        case "http":
            components.scheme = "ws"
        default:
            throw CallManagerError.invalidLiveKitURL
        }

        guard let normalized = components.string, !normalized.isEmpty else {
            throw CallManagerError.invalidLiveKitURL
        }
        return normalized
    }

    func endCallLocally() {
        stopRingtone()

        let endedCall = currentCall
        let duration = callDuration

        durationTimer?.cancel()
        durationTimer = nil
        connectionTimeoutTask?.cancel()
        connectionTimeoutTask = nil
        ringTimeoutTask?.cancel()
        ringTimeoutTask = nil
        callDuration = 0
        isMuted = false
        isSpeakerOn = true
        isLocalVideoEnabled = true
        isMinimized = false
        isFrontCamera = true
        isRemotePrimary = true
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

        if let call = endedCall,
           call.groupID == nil,
           !call.remoteUserID.isEmpty,
           !call.isOutgoing || !call.roomName.isEmpty {
            Task { await sendCallRecord(call: call, duration: duration) }
        }
    }

    private func failCall(_ message: String) {
        errorMessage = message
        endCallLocally()
    }

    private func startConnectionTimeout(for targetRoom: Room) {
        connectionTimeoutTask?.cancel()
        let timeout = connectionTimeout
        connectionTimeoutTask = Task { [weak self, weak targetRoom] in
            try? await Task.sleep(nanoseconds: timeout)
            guard !Task.isCancelled,
                  let self,
                  let targetRoom,
                  self.room === targetRoom else { return }
            self.failCall(L10n.tr("call.error.connection"))
        }
    }

    private func startOutgoingRingTimeout(for callID: UUID?) {
        ringTimeoutTask?.cancel()
        let timeout = outgoingRingTimeout
        ringTimeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: timeout)
            guard !Task.isCancelled,
                  let self,
                  self.currentCall?.id == callID,
                  self.currentCall?.state == .outgoing else { return }
            self.endCall()
        }
    }

    private func ensureMediaPermissions(for callType: CallType) async -> Bool {
        guard await requestAccess(for: .audio) else {
            failCall(L10n.tr("call.error.permission.microphone"))
            return false
        }
        if callType == .video, !(await requestAccess(for: .video)) {
            failCall(L10n.tr("call.error.permission.camera"))
            return false
        }
        return true
    }

    private func requestAccess(for mediaType: AVMediaType) async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: mediaType) {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: mediaType) { granted in
                    continuation.resume(returning: granted)
                }
            }
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
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
                guard let callerID = Self.firstString(data, keys: ["caller_id", "from_user_id", "user_id"]),
                      let roomName = Self.firstString(data, keys: ["room_name", "room"]),
                      let callType = Self.callTypeValue(data["call_type"] ?? data["type"]) else { return }

                _ = self.receiveIncomingCall(
                    callerID: callerID,
                    callerName: Self.firstString(data, keys: ["caller_name", "caller_nickname", "nickname"]) ?? callerID,
                    callerAvatar: Self.firstString(data, keys: ["caller_avatar", "avatar_url", "avatar"]) ?? "",
                    roomName: roomName,
                    callType: callType
                )
            }
            .store(in: &cancellables)

        // Call ended by remote
        WebSocketService.shared.callEndPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] senderID in
                guard let self,
                      self.isCurrentOneToOneCall(from: senderID) else { return }
                self.endCallLocally()
            }
            .store(in: &cancellables)

        WebSocketService.shared.callRejectPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self else { return }
                let senderID = Self.firstString(data, keys: ["from_user_id", "caller_id", "user_id"])
                guard self.isCurrentOneToOneCall(from: senderID ?? "") else { return }
                self.endCallLocally()
            }
            .store(in: &cancellables)

        WebSocketService.shared.callBusyPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] senderID in
                guard let self,
                      self.isCurrentOneToOneCall(from: senderID) else { return }
                self.endCallLocally()
            }
            .store(in: &cancellables)

        // Group call invite from WebSocket
        WebSocketService.shared.groupCallInvitePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self = self else { return }
                guard let groupID = Self.intValue(data["group_id"]),
                      let groupName = Self.firstString(data, keys: ["group_name", "name"]),
                      let roomName = Self.firstString(data, keys: ["room_name", "room"]),
                      let callType = Self.callTypeValue(data["call_type"] ?? data["type"]) else { return }

                _ = self.receiveIncomingGroupCall(
                    callerID: Self.firstString(data, keys: ["caller_id", "from_user_id", "user_id"]) ?? "",
                    groupID: groupID,
                    groupName: groupName,
                    roomName: roomName,
                    callType: callType
                )
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

    private static func stringValue(_ value: Any?) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    private static func firstString(_ data: [String: Any], keys: [String]) -> String? {
        keys.lazy.compactMap { stringValue(data[$0]) }.first
    }

    static func callTypeValue(_ value: Any?) -> CallType? {
        guard let value = stringValue(value)?.lowercased() else { return nil }
        switch value {
        case "voice", "audio": return .voice
        case "video": return .video
        default: return nil
        }
    }

    private func isCurrentOneToOneCall(from senderID: String) -> Bool {
        guard let call = currentCall, call.groupID == nil else { return false }
        return senderID.isEmpty || call.remoteUserID == senderID
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) }
        return nil
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
        let typeLabel = call.callType == .video ? L10n.tr("call.video") : L10n.tr("call.voice")
        let content: String
        if call.state == .connected || duration > 0 {
            let mins = Int(duration) / 60
            let secs = Int(duration) % 60
            content = "[\(typeLabel)] \(String(format: "%02d:%02d", mins, secs))"
        } else if call.isOutgoing {
            content = L10n.tr("call.record.remoteMissed", typeLabel)
        } else {
            content = L10n.tr("call.record.missed", typeLabel)
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
