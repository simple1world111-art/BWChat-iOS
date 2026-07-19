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

/// Shared LiveKit tuning for direct and group calls. Simulcast + adaptive
/// subscriptions keep multi-person video bandwidth proportional to the grid
/// cell size, while dynacast stops publishing layers nobody is watching.
enum CallMediaConfiguration {
    static let cameraCaptureOptions = CameraCaptureOptions(
        position: .front,
        dimensions: .h720_169,
        fps: 30
    )

    static let videoPublishOptions = VideoPublishOptions(
        encoding: VideoEncoding(
            maxBitrate: 1_700_000,
            maxFps: 30,
            bitratePriority: .medium,
            networkPriority: .medium
        ),
        simulcast: true,
        degradationPreference: .balanced
    )

    static let audioCaptureOptions = AudioCaptureOptions(
        highpassFilter: true,
        typingNoiseDetection: true
    )

    static let audioPublishOptions = AudioPublishOptions(
        encoding: AudioEncoding(
            maxBitrate: 48_000,
            bitratePriority: .high,
            networkPriority: .high
        ),
        dtx: true,
        red: true
    )

    static var roomOptions: RoomOptions {
        RoomOptions(
            defaultCameraCaptureOptions: cameraCaptureOptions,
            defaultAudioCaptureOptions: audioCaptureOptions,
            defaultVideoPublishOptions: videoPublishOptions,
            defaultAudioPublishOptions: audioPublishOptions,
            adaptiveStream: true,
            dynacast: true,
            reportRemoteTrackStatistics: true,
            // LiveKit's single-peer-connection path is still less reliable on
            // self-hosted deployments. Keep the proven publisher/subscriber
            // transports while retaining adaptive streaming and dynacast.
            singlePeerConnection: false
        )
    }

    static var connectOptions: ConnectOptions {
        ConnectOptions(
            autoSubscribe: true,
            reconnectAttempts: 12,
            reconnectAttemptDelay: 0.3,
            reconnectMaxDelay: 5,
            isDscpEnabled: true,
            // Publish after the transport is ready so permission and capture
            // setup cannot delay the signaling/ICE connection sequence.
            enableMicrophone: false
        )
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
    @Published private(set) var mediaConnectionState: ConnectionState = .disconnected
    @Published private(set) var localConnectionQuality: ConnectionQuality = .unknown
    @Published private(set) var activeSpeakerIDs: Set<String> = []

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
    /// A full LiveKit reconnect briefly replaces a remote participant with the
    /// same identity. Keep the direct call alive while that replacement joins.
    private var remoteDepartureGraceTask: Task<Void, Never>?
    private var mediaRecoveryTask: Task<Void, Never>?
    private var needsMediaRecoveryAfterReconnect = false
    #if DEBUG && targetEnvironment(simulator)
    /// Opt-in synthetic 720p camera used only by automated simulator media
    /// tests. App Store/device builds cannot compile or enable this path.
    private var syntheticVideoTask: Task<Void, Never>?
    private var debugReconnectScheduled = false
    #endif
    /// Invalidates late media-control completions after a call ends or a newer
    /// request supersedes them. LiveKit serializes publication changes, but the
    /// UI still needs to ignore results that belong to an old room.
    private var microphoneControlGeneration = 0
    private var videoControlGeneration = 0

    private let connectionTimeout: UInt64 = 20_000_000_000
    private let outgoingRingTimeout: UInt64 = 45_000_000_000
    private let remoteDepartureGrace: UInt64 = 20_000_000_000

    private init() {
        // Keep mute/unmute and reconnect paths from restarting AVAudioEngine.
        // The prepared recording pipeline itself is enabled only while a call
        // is active, so normal app use does not retain microphone resources.
        try? AudioManager.shared.set(microphoneMuteMode: .inputMixer)
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
        serverCallID: String? = nil,
        roomName: String,
        callType: CallType
    ) -> Bool {
        let incomingIdentity = CallSignalIdentity(callID: serverCallID, roomName: roomName)
        if let currentCall {
            let isDuplicate = currentCall.groupID == nil &&
                currentCall.remoteUserID == callerID &&
                currentCall.signalIdentity.matches(incomingIdentity)
            if isDuplicate {
                print("[CallManager] Ignoring duplicate invite call_id=\(incomingIdentity.callID ?? "-") room=\(incomingIdentity.roomName ?? "-")")
                return true
            }

            print("[CallManager] Busy for different invite call_id=\(incomingIdentity.callID ?? "-") room=\(incomingIdentity.roomName ?? "-")")
            WebSocketService.shared.sendCallBusy(
                targetID: callerID,
                callID: incomingIdentity.callID,
                roomName: incomingIdentity.roomName
            )
            if let callID = incomingIdentity.callID, !callID.isEmpty {
                Task {
                    do {
                        try await APIService.shared.markCallBusy(callID: callID)
                    } catch {
                        print("[CallManager] HTTP busy fallback failed call_id=\(callID): \(error)")
                    }
                }
            }
            return false
        }

        print("[CallManager] Incoming invite call_id=\(incomingIdentity.callID ?? "-") room=\(incomingIdentity.roomName ?? "-")")
        currentCall = CallSession(
            remoteUserID: callerID,
            remoteNickname: callerName,
            remoteAvatarURL: callerAvatar,
            callType: callType,
            isOutgoing: false,
            state: .incoming,
            startedAt: Date(),
            serverCallID: incomingIdentity.callID,
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
        serverCallID: String? = nil,
        roomName: String,
        callType: CallType
    ) -> Bool {
        let incomingIdentity = CallSignalIdentity(callID: serverCallID, roomName: roomName)
        if let currentCall {
            let isDuplicate = currentCall.groupID == groupID &&
                currentCall.signalIdentity.matches(incomingIdentity)
            if isDuplicate {
                print("[CallManager] Ignoring duplicate group invite call_id=\(incomingIdentity.callID ?? "-") room=\(incomingIdentity.roomName ?? "-")")
                return true
            }
            return false
        }

        currentCall = CallSession(
            remoteUserID: callerID,
            remoteNickname: groupName,
            remoteAvatarURL: "",
            callType: callType,
            isOutgoing: false,
            state: .incoming,
            startedAt: Date(),
            serverCallID: incomingIdentity.callID,
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
                    call.serverCallID = resp.callID
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

        // Claim the invitation synchronously. Permission prompts and API work
        // run asynchronously, so leaving the state as `.incoming` here allows
        // a rapid double tap (or duplicate accessibility activation) to create
        // two competing Room connections; the later one cancels the first.
        if var current = currentCall {
            current.state = .connecting
            currentCall = current
        }
        stopRingtone()

        Task {
            guard await ensureMediaPermissions(for: call.callType) else {
                if call.groupID == nil, !call.remoteUserID.isEmpty {
                    WebSocketService.shared.sendCallReject(
                        targetID: call.remoteUserID,
                        reason: "permission_denied",
                        callID: call.serverCallID,
                        roomName: call.roomName
                    )
                }
                return
            }
            guard currentCall?.id == callID else { return }

            do {
                let resp = try await APIService.shared.joinCall(roomName: call.roomName)
                guard currentCall?.id == callID else { return }
                let livekitURL = try normalizedLiveKitURL(resp.livekitUrl)
                if var current = currentCall {
                    current.serverCallID = resp.callID ?? current.serverCallID
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
                    call.serverCallID = resp.callID
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
                    call.serverCallID = resp.callID ?? call.serverCallID
                    call.roomName = resp.roomName
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
        let connectOptions = CallMediaConfiguration.connectOptions
        let newRoom = Room(
            connectOptions: connectOptions,
            roomOptions: CallMediaConfiguration.roomOptions
        )
        let handler = RoomDelegateHandler(manager: self)
        self.roomDelegate = handler
        newRoom.add(delegate: handler)
        self.room = newRoom
        AudioManager.shared.isSpeakerOutputPreferred = isSpeakerOn
        startConnectionTimeout(for: newRoom)

        do {
            do {
                try await AudioManager.shared.setRecordingAlwaysPreparedMode(true)
            } catch {
                // This is a latency/reconnect optimization. A normal microphone
                // publication below remains the functional fallback.
                print("[CallManager] Could not prewarm microphone pipeline: \(error)")
            }
            try await newRoom.connect(url: url, token: token, connectOptions: connectOptions)
            guard room === newRoom else {
                await newRoom.disconnect()
                return
            }
            connectionTimeoutTask?.cancel()
            connectionTimeoutTask = nil
            print("[CallManager] LiveKit connected call_id=\(currentCall?.serverCallID ?? "-") room=\(currentCall?.roomName ?? "-")")

            // A busy/unavailable input device must not tear down an otherwise
            // healthy room. Keep receiving remote audio and let the user retry
            // microphone publishing from the mute control.
            do {
                try await newRoom.localParticipant.setMicrophone(enabled: true)
                isMuted = false
            } catch {
                print("[CallManager] Microphone unavailable; continuing receive-only: \(error)")
                isMuted = true
                errorMessage = L10n.tr("call.error.microphoneUnavailable")
            }

            // Publish local video with higher quality, explicitly using front camera
            if isVideo {
                isFrontCamera = true
                do {
                    #if DEBUG && targetEnvironment(simulator)
                    if ProcessInfo.processInfo.arguments.contains("--call-test-synthetic-camera") {
                        localVideoTrack = try await publishSyntheticVideo(in: newRoom)
                    } else {
                        let publication = try await newRoom.localParticipant.setCamera(
                            enabled: true,
                            captureOptions: CallMediaConfiguration.cameraCaptureOptions,
                            publishOptions: CallMediaConfiguration.videoPublishOptions
                        )
                        localVideoTrack = (publication?.track as? VideoTrack) ??
                            (newRoom.localParticipant.localVideoTracks.first?.track as? VideoTrack)
                    }
                    #else
                    let publication = try await newRoom.localParticipant.setCamera(
                        enabled: true,
                        captureOptions: CallMediaConfiguration.cameraCaptureOptions,
                        publishOptions: CallMediaConfiguration.videoPublishOptions
                    )
                    localVideoTrack = (publication?.track as? VideoTrack) ??
                        (newRoom.localParticipant.localVideoTracks.first?.track as? VideoTrack)
                    #endif
                    isLocalVideoEnabled = localVideoTrack != nil
                } catch {
                    // A missing/busy camera must not tear down an otherwise
                    // healthy call. Keep the room and any available audio alive
                    // so the user can retry camera publishing later.
                    print("[CallManager] Camera unavailable; continuing with audio: \(error)")
                    localVideoTrack = nil
                    isLocalVideoEnabled = false
                    errorMessage = L10n.tr("call.error.cameraUnavailable")
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
            #if DEBUG && targetEnvironment(simulator)
            scheduleDebugReconnectIfRequested(for: newRoom)
            #endif
        } catch {
            print("[CallManager] Room connect failed: \(error)")
            guard room === newRoom else { return }
            failCall(L10n.tr("call.error.connection"))
        }
    }

    #if DEBUG && targetEnvironment(simulator)
    private func publishSyntheticVideo(in targetRoom: Room) async throws -> LocalVideoTrack {
        let track = LocalVideoTrack.createBufferTrack(
            name: "camera",
            source: .camera,
            options: BufferCaptureOptions(dimensions: .h720_169, fps: 30)
        )
        guard let capturer = track.capturer as? BufferCapturer else {
            throw CallManagerError.invalidLiveKitURL
        }

        // LiveKit needs dimensions before publication can complete.
        if let firstFrame = Self.makeSyntheticVideoFrame(sequence: 0) {
            capturer.capture(firstFrame)
        }
        // Buffer tracks need an explicit codec before SDP negotiation. Keep
        // this simulator-only track single-layer, matching LiveKit's own
        // BufferCapturer integration test; production camera tracks still use
        // the three-layer simulcast configuration above.
        let publishOptions = VideoPublishOptions(
            simulcast: false,
            preferredCodec: .vp8,
            preferredBackupCodec: .none,
            degradationPreference: .maintainResolution
        )
        try await targetRoom.localParticipant.publish(
            videoTrack: track,
            options: publishOptions
        )

        syntheticVideoTask?.cancel()
        syntheticVideoTask = Task.detached(priority: .userInitiated) { [weak capturer] in
            var sequence = 1
            while !Task.isCancelled, let capturer {
                if let frame = Self.makeSyntheticVideoFrame(sequence: sequence) {
                    capturer.capture(frame)
                }
                sequence &+= 1
                try? await Task.sleep(nanoseconds: 33_333_333)
            }
        }
        print("[CallManager] Synthetic 720p camera published for simulator test")
        return track
    }

    nonisolated private static func makeSyntheticVideoFrame(sequence: Int) -> CVPixelBuffer? {
        let width = 1280
        let height = 720
        let attributes: [CFString: Any] = [
            kCVPixelBufferIOSurfacePropertiesKey: [:],
            kCVPixelBufferMetalCompatibilityKey: true
        ]
        var pixelBuffer: CVPixelBuffer?
        guard CVPixelBufferCreate(
            kCFAllocatorDefault,
            width,
            height,
            kCVPixelFormatType_32BGRA,
            attributes as CFDictionary,
            &pixelBuffer
        ) == kCVReturnSuccess, let pixelBuffer else { return nil }

        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let movingBand = (sequence * 12) % width

        for y in 0 ..< height {
            let row = baseAddress.advanced(by: y * bytesPerRow).assumingMemoryBound(to: UInt8.self)
            for x in 0 ..< width {
                let offset = x * 4
                let inBand = abs(x - movingBand) < 90
                row[offset] = UInt8((x + sequence * 3) & 0xff)
                row[offset + 1] = UInt8((y * 2) & 0xff)
                row[offset + 2] = inBand ? 255 : UInt8((x / 5 + y / 3) & 0xff)
                row[offset + 3] = 255
            }
        }
        return pixelBuffer
    }

    private func scheduleDebugReconnectIfRequested(for targetRoom: Room) {
        guard !debugReconnectScheduled else { return }
        let arguments = ProcessInfo.processInfo.arguments
        let scenario: SimulateScenario
        if arguments.contains("--call-test-full-reconnect") {
            scenario = .fullReconnect
        } else if arguments.contains("--call-test-quick-reconnect") {
            scenario = .quickReconnect
        } else {
            return
        }
        debugReconnectScheduled = true

        Task { [weak self, weak targetRoom] in
            try? await Task.sleep(nanoseconds: 12_000_000_000)
            guard let self, let targetRoom, self.room === targetRoom else { return }
            print("[CallManager] Starting simulator reconnect test: \(scenario)")
            do {
                try await targetRoom.debug_simulate(scenario: scenario)
                print("[CallManager] Simulator reconnect test completed: \(scenario)")
            } catch {
                print("[CallManager] Simulator reconnect test failed: \(error)")
            }
        }
    }
    #endif

    // MARK: - Controls

    func rejectCall() {
        guard let call = currentCall else { return }
        if call.groupID == nil, !call.remoteUserID.isEmpty {
            WebSocketService.shared.sendCallReject(
                targetID: call.remoteUserID,
                callID: call.serverCallID,
                roomName: call.roomName
            )
            if let callID = call.serverCallID, !callID.isEmpty {
                Task {
                    do {
                        try await APIService.shared.rejectCall(callID: callID)
                    } catch {
                        print("[CallManager] HTTP reject fallback failed call_id=\(callID): \(error)")
                    }
                }
            }
        }
        endCallLocally()
    }

    func endCall() {
        guard let call = currentCall else { return }

        if let groupID = call.groupID {
            Task {
                try? await APIService.shared.leaveGroupCall(
                    groupID: groupID,
                    callID: call.serverCallID,
                    roomName: call.roomName
                )
            }
        } else if !call.remoteUserID.isEmpty {
            sendCallEndSignal(for: call)
        }

        endCallLocally()
    }

    func toggleMute() {
        guard let targetRoom = room, mediaConnectionState == .connected else { return }
        let targetMuted = !isMuted
        microphoneControlGeneration += 1
        let generation = microphoneControlGeneration

        Task {
            do {
                _ = try await targetRoom.localParticipant.setMicrophone(enabled: !targetMuted)
                guard room === targetRoom,
                      currentCall != nil,
                      microphoneControlGeneration == generation else { return }
                isMuted = targetMuted
            } catch {
                guard room === targetRoom,
                      microphoneControlGeneration == generation else { return }
                print("[CallManager] Failed to update microphone: \(error)")
                errorMessage = L10n.tr("call.error.microphoneUnavailable")
            }
        }
    }

    func toggleSpeaker() {
        isSpeakerOn.toggle()
        // LiveKit 2.x owns AVAudioSession while its audio engine is running.
        // Updating the SDK preference avoids racing its automatic configuration.
        AudioManager.shared.isSpeakerOutputPreferred = isSpeakerOn
    }

    func toggleLocalVideo() {
        guard let targetRoom = room,
              mediaConnectionState == .connected,
              currentCall?.callType == .video else { return }
        let targetEnabled = !isLocalVideoEnabled
        videoControlGeneration += 1
        let generation = videoControlGeneration

        Task {
            do {
                if targetEnabled {
                    let position: AVCaptureDevice.Position = isFrontCamera ? .front : .back
                    let captureOptions = CameraCaptureOptions(
                        position: position,
                        dimensions: .h720_169,
                        fps: 30
                    )
                    let publication = try await targetRoom.localParticipant.setCamera(
                        enabled: true,
                        captureOptions: captureOptions,
                        publishOptions: CallMediaConfiguration.videoPublishOptions
                    )
                    guard room === targetRoom,
                          currentCall != nil,
                          videoControlGeneration == generation else { return }
                    localVideoTrack = (publication?.track as? VideoTrack) ??
                        (targetRoom.localParticipant.localVideoTracks.first?.track as? VideoTrack)
                } else {
                    _ = try await targetRoom.localParticipant.setCamera(enabled: false)
                    guard room === targetRoom,
                          currentCall != nil,
                          videoControlGeneration == generation else { return }
                    localVideoTrack = nil
                }
                isLocalVideoEnabled = targetEnabled
            } catch {
                guard room === targetRoom,
                      videoControlGeneration == generation else { return }
                print("[CallManager] Failed to update camera: \(error)")
                errorMessage = L10n.tr("call.error.cameraUnavailable")
            }
        }
    }

    func flipCamera() {
        guard let targetRoom = room,
              mediaConnectionState == .connected,
              currentCall?.callType == .video,
              isLocalVideoEnabled else { return }
        videoControlGeneration += 1
        let generation = videoControlGeneration

        Task {
            guard let publication = targetRoom.localParticipant.localVideoTracks.first,
                  let localTrack = publication.track as? LocalVideoTrack,
                  let cameraCapturer = localTrack.capturer as? CameraCapturer else {
                return
            }
            do {
                let didSwitch = try await cameraCapturer.switchCameraPosition()
                guard didSwitch,
                      room === targetRoom,
                      currentCall != nil,
                      videoControlGeneration == generation else { return }
                isFrontCamera.toggle()
            } catch {
                guard room === targetRoom,
                      videoControlGeneration == generation else { return }
                print("[CallManager] Failed to flip camera: \(error)")
                errorMessage = L10n.tr("call.error.cameraUnavailable")
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

    func isParticipantSpeaking(_ participant: Participant) -> Bool {
        let identity = participant.identity?.stringValue ?? participant.sid?.stringValue
        return identity.map(activeSpeakerIDs.contains) ?? false
    }

    // MARK: - Internal: Participant Updates

    func updateRemoteParticipants() {
        guard let room = room else { return }
        remoteParticipants = room.remoteParticipants.values.sorted {
            let lhs = $0.identity?.stringValue ?? String(describing: $0.sid)
            let rhs = $1.identity?.stringValue ?? String(describing: $1.sid)
            return lhs.localizedStandardCompare(rhs) == .orderedAscending
        }

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

    func updateMediaConnectionState(
        in updatedRoom: Room,
        state: ConnectionState,
        from oldState: ConnectionState
    ) {
        guard room === updatedRoom else { return }
        mediaConnectionState = state
        print("[CallManager] LiveKit state=\(state) call_id=\(currentCall?.serverCallID ?? "-")")

        if state == .reconnecting {
            needsMediaRecoveryAfterReconnect = true
            mediaRecoveryTask?.cancel()
            mediaRecoveryTask = nil
        } else if state == .connected, needsMediaRecoveryAfterReconnect {
            needsMediaRecoveryAfterReconnect = false
            scheduleMediaRecovery(afterReconnectIn: updatedRoom)
        } else if oldState == .connected, state == .disconnected {
            mediaRecoveryTask?.cancel()
            mediaRecoveryTask = nil
        }
    }

    private func scheduleMediaRecovery(afterReconnectIn targetRoom: Room) {
        guard let call = currentCall else { return }
        let callID = call.serverCallID
        let shouldRestoreMicrophone = !isMuted
        let shouldRestoreVideo = call.callType == .video && isLocalVideoEnabled
        let microphoneGeneration = microphoneControlGeneration
        let videoGeneration = videoControlGeneration

        mediaRecoveryTask?.cancel()
        mediaRecoveryTask = Task { [weak self, weak targetRoom] in
            // The SDK starts its own republish pass after a full reconnect. Give
            // it a brief chance to finish, then repair only publications that
            // are still absent.
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard !Task.isCancelled,
                  let self,
                  let targetRoom,
                  self.room === targetRoom,
                  self.currentCall?.serverCallID == callID,
                  self.mediaConnectionState == .connected else { return }

            var restoredMicrophone = false
            if shouldRestoreMicrophone,
               self.microphoneControlGeneration == microphoneGeneration,
               targetRoom.localParticipant.localAudioTracks.isEmpty {
                var lastMicrophoneError: Error?
                for attempt in 1 ... 3 {
                    do {
                        _ = try await targetRoom.localParticipant.setMicrophone(
                            enabled: true,
                            captureOptions: CallMediaConfiguration.audioCaptureOptions,
                            publishOptions: CallMediaConfiguration.audioPublishOptions
                        )
                        restoredMicrophone = true
                        break
                    } catch {
                        lastMicrophoneError = error
                        guard attempt < 3 else { break }
                        try? await Task.sleep(nanoseconds: 500_000_000)
                        guard !Task.isCancelled,
                              self.room === targetRoom,
                              self.microphoneControlGeneration == microphoneGeneration else { return }
                    }
                }
                if !restoredMicrophone {
                    guard self.room === targetRoom else { return }
                    self.isMuted = true
                    self.errorMessage = L10n.tr("call.error.microphoneUnavailable")
                    print(
                        "[CallManager] Failed to restore microphone after reconnect: " +
                        "\(String(describing: lastMicrophoneError))"
                    )
                }
            }

            var restoredVideo = false
            if shouldRestoreVideo,
               self.videoControlGeneration == videoGeneration,
               targetRoom.localParticipant.localVideoTracks.isEmpty {
                do {
                    let track: VideoTrack?
                    #if DEBUG && targetEnvironment(simulator)
                    if ProcessInfo.processInfo.arguments.contains("--call-test-synthetic-camera") {
                        track = try await self.publishSyntheticVideo(in: targetRoom)
                    } else {
                        let publication = try await targetRoom.localParticipant.setCamera(
                            enabled: true,
                            captureOptions: CallMediaConfiguration.cameraCaptureOptions,
                            publishOptions: CallMediaConfiguration.videoPublishOptions
                        )
                        track = (publication?.track as? VideoTrack) ??
                            (targetRoom.localParticipant.localVideoTracks.first?.track as? VideoTrack)
                    }
                    #else
                    let publication = try await targetRoom.localParticipant.setCamera(
                        enabled: true,
                        captureOptions: CallMediaConfiguration.cameraCaptureOptions,
                        publishOptions: CallMediaConfiguration.videoPublishOptions
                    )
                    track = (publication?.track as? VideoTrack) ??
                        (targetRoom.localParticipant.localVideoTracks.first?.track as? VideoTrack)
                    #endif
                    guard self.room === targetRoom,
                          self.currentCall?.serverCallID == callID,
                          self.videoControlGeneration == videoGeneration else { return }
                    self.localVideoTrack = track
                    self.isLocalVideoEnabled = track != nil
                    restoredVideo = track != nil
                } catch {
                    guard self.room === targetRoom else { return }
                    self.localVideoTrack = nil
                    self.isLocalVideoEnabled = false
                    self.errorMessage = L10n.tr("call.error.cameraUnavailable")
                    print("[CallManager] Failed to restore camera after reconnect: \(error)")
                }
            }

            print(
                "[CallManager] Media recovery completed call_id=\(callID ?? "-") " +
                "microphone_restored=\(restoredMicrophone) video_restored=\(restoredVideo)"
            )
        }
    }

    func updateConnectionQuality(in updatedRoom: Room, participant: Participant, quality: ConnectionQuality) {
        guard room === updatedRoom else { return }
        if participant.sid == updatedRoom.localParticipant.sid {
            localConnectionQuality = quality
        }
        updateRemoteParticipants()
    }

    func updateActiveSpeakers(in updatedRoom: Room, participants: [Participant]) {
        guard room === updatedRoom else { return }
        activeSpeakerIDs = Set(participants.compactMap { participant in
            participant.identity?.stringValue ?? participant.sid?.stringValue
        })
    }

    func handleRemoteParticipantConnect(in connectedRoom: Room) {
        guard room === connectedRoom else { return }
        remoteDepartureGraceTask?.cancel()
        remoteDepartureGraceTask = nil
        mediaRecoveryTask?.cancel()
        mediaRecoveryTask = nil
        needsMediaRecoveryAfterReconnect = false
        updateRemoteParticipants()
    }

    func handleRemoteParticipantDisconnect(in disconnectedRoom: Room) {
        guard room === disconnectedRoom else { return }
        updateRemoteParticipants()
        guard let call = currentCall,
              call.groupID == nil,
              disconnectedRoom.remoteParticipants.isEmpty else { return }

        remoteDepartureGraceTask?.cancel()
        let callID = call.serverCallID
        remoteDepartureGraceTask = Task { [weak self, weak disconnectedRoom] in
            try? await Task.sleep(nanoseconds: self?.remoteDepartureGrace ?? 0)
            guard !Task.isCancelled,
                  let self,
                  let disconnectedRoom,
                  self.room === disconnectedRoom,
                  self.currentCall?.serverCallID == callID,
                  disconnectedRoom.remoteParticipants.isEmpty else { return }
            print("[CallManager] Remote participant reconnect grace expired call_id=\(callID ?? "-")")
            self.endCall()
        }
    }

    func handleRoomDisconnect(_ disconnectedRoom: Room, error: LiveKitError?) {
        guard room === disconnectedRoom, currentCall != nil else { return }
        if let error {
            print("[CallManager] LiveKit disconnected unexpectedly: \(error)")
            errorMessage = L10n.tr("call.error.connection")
        } else {
            print("[CallManager] LiveKit room disconnected by server")
        }
        endCall()
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
        remoteDepartureGraceTask?.cancel()
        remoteDepartureGraceTask = nil
        #if DEBUG && targetEnvironment(simulator)
        syntheticVideoTask?.cancel()
        syntheticVideoTask = nil
        debugReconnectScheduled = false
        #endif
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
        mediaConnectionState = .disconnected
        localConnectionQuality = .unknown
        activeSpeakerIDs = []
        microphoneControlGeneration += 1
        videoControlGeneration += 1

        let roomToClean = room
        room = nil
        roomDelegate = nil
        currentCall = nil

        Task {
            // Explicitly stop camera and mic before disconnecting to release hardware
            _ = try? await roomToClean?.localParticipant.setCamera(enabled: false)
            _ = try? await roomToClean?.localParticipant.setMicrophone(enabled: false)
            await roomToClean?.disconnect()
            try? await AudioManager.shared.setRecordingAlwaysPreparedMode(false)
        }

        if let call = endedCall,
           call.groupID == nil,
           !call.remoteUserID.isEmpty,
           !call.isOutgoing || !call.roomName.isEmpty {
            Task { await sendCallRecord(call: call, duration: duration) }
        }
    }

    private func failCall(_ message: String, notifyRemote: Bool = true) {
        if notifyRemote, let call = currentCall, !call.signalIdentity.isEmpty {
            if let groupID = call.groupID {
                Task {
                    try? await APIService.shared.leaveGroupCall(
                        groupID: groupID,
                        callID: call.serverCallID,
                        roomName: call.roomName
                    )
                }
            } else {
                sendCallEndSignal(for: call)
            }
        }
        errorMessage = message
        endCallLocally()
    }

    private func sendCallEndSignal(for call: CallSession) {
        guard call.groupID == nil, !call.remoteUserID.isEmpty else { return }
        WebSocketService.shared.sendCallEnd(
            targetID: call.remoteUserID,
            callID: call.serverCallID,
            roomName: call.roomName
        )
        if let callID = call.serverCallID, !callID.isEmpty {
            Task {
                do {
                    try await APIService.shared.endCall(callID: callID)
                } catch {
                    print("[CallManager] HTTP end fallback failed call_id=\(callID): \(error)")
                }
            }
        }
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
            failCall(L10n.tr("call.error.permission.microphone"), notifyRemote: false)
            return false
        }
        if callType == .video, !(await requestAccess(for: .video)) {
            failCall(L10n.tr("call.error.permission.camera"), notifyRemote: false)
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
                    serverCallID: Self.firstString(data, keys: ["call_id"]),
                    roomName: roomName,
                    callType: callType
                )
            }
            .store(in: &cancellables)

        // Call ended by remote
        WebSocketService.shared.callEndPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self,
                      self.isCurrentOneToOneCall(matching: data) else { return }
                self.endCallLocally()
            }
            .store(in: &cancellables)

        WebSocketService.shared.callRejectPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self else { return }
                guard self.isCurrentOneToOneCall(matching: data) else { return }
                self.endCallLocally()
            }
            .store(in: &cancellables)

        WebSocketService.shared.callBusyPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self,
                      self.isCurrentOneToOneCall(matching: data) else { return }
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
                    serverCallID: Self.firstString(data, keys: ["call_id"]),
                    roomName: roomName,
                    callType: callType
                )
            }
            .store(in: &cancellables)

        // Group call ended
        WebSocketService.shared.groupCallEndedPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self = self else { return }
                guard let groupID = Self.intValue(data["group_id"]),
                      let call = self.currentCall,
                      call.groupID == groupID else { return }
                let signalIdentity = CallSignalIdentity(
                    callID: Self.firstString(data, keys: ["call_id"]),
                    roomName: Self.firstString(data, keys: ["room_name", "room"])
                )
                guard !call.signalIdentity.hasComparableKey(with: signalIdentity) ||
                        call.signalIdentity.matches(signalIdentity) else { return }
                self.endCallLocally()
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

    private func isCurrentOneToOneCall(matching data: [String: Any]) -> Bool {
        guard let call = currentCall, call.groupID == nil else { return false }

        let senderID = Self.firstString(data, keys: ["from_user_id", "caller_id", "user_id"])
        if let senderID, !senderID.isEmpty, call.remoteUserID != senderID {
            return false
        }

        let signalIdentity = CallSignalIdentity(
            callID: Self.firstString(data, keys: ["call_id"]),
            roomName: Self.firstString(data, keys: ["room_name", "room"])
        )
        if call.signalIdentity.hasComparableKey(with: signalIdentity) {
            return call.signalIdentity.matches(signalIdentity)
        }

        // Compatibility fallback for a lifecycle event from an older backend
        // that did not include call_id/room_name. New servers always include at
        // least one stable identity key.
        return senderID.map { $0.isEmpty || call.remoteUserID == $0 } ?? true
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

    nonisolated func room(
        _ room: Room,
        didUpdateConnectionState connectionState: ConnectionState,
        from oldConnectionState: ConnectionState
    ) {
        Task { @MainActor in
            manager?.updateMediaConnectionState(
                in: room,
                state: connectionState,
                from: oldConnectionState
            )
        }
    }

    nonisolated func room(
        _ room: Room,
        participant: Participant,
        didUpdateConnectionQuality quality: ConnectionQuality
    ) {
        Task { @MainActor in
            manager?.updateConnectionQuality(in: room, participant: participant, quality: quality)
        }
    }

    nonisolated func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) {
        Task { @MainActor in
            manager?.updateActiveSpeakers(in: room, participants: participants)
        }
    }

    nonisolated func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        Task { @MainActor in
            manager?.handleRemoteParticipantConnect(in: room)
        }
    }

    nonisolated func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        Task { @MainActor in
            manager?.handleRemoteParticipantDisconnect(in: room)
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
            manager?.handleRoomDisconnect(room, error: error)
        }
    }
}
