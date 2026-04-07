// BWChat/Managers/CallManager.swift
// Manages call state and LiveKit room connections for 1v1 and group calls

import Foundation
import Combine
import AVFoundation
import LiveKit

@MainActor
class CallManager: ObservableObject {
    static let shared = CallManager()

    @Published var currentCall: CallSession?
    @Published var isMuted = false
    @Published var isSpeakerOn = false
    @Published var isLocalVideoEnabled = true
    @Published var callDuration: TimeInterval = 0

    // LiveKit room & participants
    @Published var room: Room?
    @Published var remoteVideoTrack: VideoTrack?
    @Published var localVideoTrack: VideoTrack?
    @Published var remoteParticipants: [RemoteParticipant] = []

    private var cancellables = Set<AnyCancellable>()
    private var durationTimer: Task<Void, Never>?
    private var roomDelegate: RoomDelegateHandler?

    private init() {
        setupSignalingListeners()
    }

    // MARK: - 1v1 Call: Start (Outgoing)

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

        Task {
            do {
                let resp = try await APIService.shared.startCall(targetID: userID, callType: type.rawValue)
                currentCall?.roomName = resp.roomName
                currentCall?.livekitToken = resp.token
                currentCall?.livekitURL = resp.livekitUrl
                await connectToRoom(url: resp.livekitUrl, token: resp.token, isVideo: type == .video)
            } catch {
                print("[CallManager] Failed to start call: \(error)")
                endCallLocally()
            }
        }
    }

    // MARK: - 1v1 Call: Accept (Incoming)

    func acceptCall() {
        guard var call = currentCall, call.state == .incoming else { return }
        call.state = .connecting
        currentCall = call

        Task {
            do {
                let resp = try await APIService.shared.joinCall(roomName: call.roomName)
                currentCall?.livekitToken = resp.token
                currentCall?.livekitURL = resp.livekitUrl
                await connectToRoom(url: resp.livekitUrl, token: resp.token, isVideo: call.callType == .video)
            } catch {
                print("[CallManager] Failed to join call: \(error)")
                endCallLocally()
            }
        }
    }

    // MARK: - Group Call: Start or Join

    func startGroupCall(groupID: Int, groupName: String, type: CallType) {
        guard currentCall == nil else { return }

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
                currentCall?.roomName = resp.roomName
                currentCall?.livekitToken = resp.token
                currentCall?.livekitURL = resp.livekitUrl
                await connectToRoom(url: resp.livekitUrl, token: resp.token, isVideo: type == .video)
            } catch {
                print("[CallManager] Failed to start group call: \(error)")
                endCallLocally()
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
                currentCall?.livekitToken = resp.token
                currentCall?.livekitURL = resp.livekitUrl
                await connectToRoom(url: resp.livekitUrl, token: resp.token, isVideo: callType == .video)
            } catch {
                print("[CallManager] Failed to join group call: \(error)")
                endCallLocally()
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

            // Publish local tracks
            try await newRoom.localParticipant.setMicrophone(enabled: true)
            if isVideo {
                try await newRoom.localParticipant.setCamera(enabled: true)
                if let pub = newRoom.localParticipant.localVideoTracks.first,
                   let track = pub.track as? VideoTrack {
                    localVideoTrack = track
                }
            }

            currentCall?.state = .connected
            startDurationTimer()
            updateRemoteParticipants()
        } catch {
            print("[CallManager] Room connect failed: \(error)")
            endCallLocally()
        }
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

        Task {
            await room?.disconnect()
        }
        endCallLocally()
    }

    func toggleMute() {
        isMuted.toggle()
        Task {
            try? await room?.localParticipant.setMicrophone(enabled: !isMuted)
        }
    }

    func toggleSpeaker() {
        isSpeakerOn.toggle()
        let session = AVAudioSession.sharedInstance()
        let port: AVAudioSession.PortOverride = isSpeakerOn ? .speaker : .none
        try? session.overrideOutputAudioPort(port)
    }

    func toggleLocalVideo() {
        isLocalVideoEnabled.toggle()
        Task {
            try? await room?.localParticipant.setCamera(enabled: isLocalVideoEnabled)
            if isLocalVideoEnabled {
                if let pub = room?.localParticipant.localVideoTracks.first,
                   let track = pub.track as? VideoTrack {
                    localVideoTrack = track
                }
            } else {
                localVideoTrack = nil
            }
        }
    }

    // MARK: - Internal: Participant Updates

    func updateRemoteParticipants() {
        guard let room = room else { return }
        remoteParticipants = Array(room.remoteParticipants.values)

        if let firstRemote = remoteParticipants.first,
           let pub = firstRemote.videoTracks.first,
           let track = pub.track as? VideoTrack {
            remoteVideoTrack = track
        }
    }

    // MARK: - Private

    func endCallLocally() {
        durationTimer?.cancel()
        durationTimer = nil
        callDuration = 0
        isMuted = false
        isSpeakerOn = false
        isLocalVideoEnabled = true
        localVideoTrack = nil
        remoteVideoTrack = nil
        remoteParticipants = []

        Task {
            await room?.disconnect()
        }
        room = nil
        roomDelegate = nil
        currentCall = nil

        deactivateAudioSession()
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
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
    }
}

// MARK: - LiveKit Room Delegate

class RoomDelegateHandler: RoomDelegate {
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
