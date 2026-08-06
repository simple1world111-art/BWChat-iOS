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
    case cameraTrackUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidLiveKitURL:
            L10n.tr("call.error.invalidServer")
        case .cameraTrackUnavailable:
            L10n.tr("call.error.cameraUnavailable")
        }
    }
}

/// Shared LiveKit tuning for direct and group calls. Production evidence from
/// Build 7 showed that this self-hosted LiveKit path always discarded the
/// requested simulcast profile and eventually published its 1.7 Mbps fallback.
/// Publish a deterministic 720p layer directly so the call starts faster and
/// has enough bitrate for a noisy front-camera image.
enum CallMediaConfiguration {
    static let cameraCaptureOptions = CameraCaptureOptions(
        position: .front,
        dimensions: .h720_169,
        fps: 30
    )

    static let videoPublishOptions = VideoPublishOptions(
        encoding: VideoEncoding(
            maxBitrate: 3_000_000,
            maxFps: 30,
            bitratePriority: .high,
            networkPriority: .high
        ),
        simulcast: false,
        preferredCodec: .vp8,
        preferredBackupCodec: .none,
        degradationPreference: .balanced
    )

    /// A conservative retry for temporary publication negotiation failures.
    /// It keeps the same 720p/30 source rather than reducing resolution.
    static let compatibilityVideoPublishOptions = VideoPublishOptions(
        encoding: VideoEncoding(
            maxBitrate: 2_200_000,
            maxFps: 30,
            bitratePriority: .medium,
            networkPriority: .medium
        ),
        simulcast: false,
        preferredCodec: .vp8,
        preferredBackupCodec: .none,
        degradationPreference: .balanced
    )

    static func cameraCaptureOptions(position: AVCaptureDevice.Position) -> CameraCaptureOptions {
        CameraCaptureOptions(position: position, dimensions: .h720_169, fps: 30)
    }

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

private struct CallQualityStreamSample {
    var bytes: UInt64?
    var timestamp: Double?
    var width: Int?
    var height: Int?
    var fps: Double?
    var packetsLost: Int?
    var nackCount: Int?
    var pliCount: Int?
    var firCount: Int?
    var framesDropped: Int?
    var freezeCount: Int?
    var rttMs: Double?
    var fractionLost: Double?
    var qualityLimitationReason: String?
}

private struct CallQualityStreamAccumulator {
    private var previousBytes: UInt64?
    private var previousTimestamp: Double?
    private(set) var report = CallQualityStreamReport()

    mutating func record(_ sample: CallQualityStreamSample) {
        report.width = sample.width ?? report.width
        report.height = sample.height ?? report.height
        report.fps = sample.fps ?? report.fps
        report.packetsLost = sample.packetsLost ?? report.packetsLost
        report.nackCount = sample.nackCount ?? report.nackCount
        report.pliCount = sample.pliCount ?? report.pliCount
        report.firCount = sample.firCount ?? report.firCount
        report.framesDropped = sample.framesDropped ?? report.framesDropped
        report.freezeCount = sample.freezeCount ?? report.freezeCount
        report.rttMs = sample.rttMs ?? report.rttMs
        report.fractionLost = sample.fractionLost ?? report.fractionLost
        report.qualityLimitationReason = sample.qualityLimitationReason ?? report.qualityLimitationReason

        if let bytes = sample.bytes,
           let timestamp = sample.timestamp,
           let previousBytes,
           let previousTimestamp,
           bytes >= previousBytes {
            let elapsed = (timestamp - previousTimestamp) / 1_000_000
            if elapsed > 0 {
                let bps = Int((Double(bytes - previousBytes) * 8) / elapsed)
                if bps > 0 {
                    report.bitrateBps = bps
                }
            }
        }
        previousBytes = sample.bytes
        previousTimestamp = sample.timestamp
    }
}

private struct CallQualityAccumulator {
    private(set) var sampleCount = 0
    private var outbound = CallQualityStreamAccumulator()
    private var inbound = CallQualityStreamAccumulator()
    private var hasOutbound = false
    private var hasInbound = false
    private var iceTransport: String?
    private var relay: Bool?

    mutating func record(
        outbound outboundSample: CallQualityStreamSample?,
        inbound inboundSample: CallQualityStreamSample?,
        iceTransport: String?,
        relay: Bool?
    ) {
        guard outboundSample != nil || inboundSample != nil else { return }
        sampleCount += 1
        if let outboundSample {
            hasOutbound = true
            outbound.record(outboundSample)
        }
        if let inboundSample {
            hasInbound = true
            inbound.record(inboundSample)
        }
        self.iceTransport = iceTransport ?? self.iceTransport
        self.relay = relay ?? self.relay
    }

    func makeReport() -> CallQualityReport? {
        guard sampleCount > 0 else { return nil }
        let appBuild = (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "unknown"
        return CallQualityReport(
            appBuild: appBuild,
            sampleCount: sampleCount,
            outbound: hasOutbound ? outbound.report : nil,
            inbound: hasInbound ? inbound.report : nil,
            iceTransport: iceTransport,
            relay: relay
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
    @Published private(set) var liveEndingMessage: String?
    @Published private(set) var liveEndingDetail: String?
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
    private var gracefulLiveEndingTask: Task<Void, Never>?
    private var liveTerminationReconciliationTask: Task<Void, Never>?
    /// A full LiveKit reconnect briefly replaces a remote participant with the
    /// same identity. Keep the call alive while that replacement joins.
    private var remoteDepartureGraceTask: Task<Void, Never>?
    /// Group rooms may start with only the caller. Auto-exit is enabled only
    /// after at least one remote participant has actually joined this session.
    private var hasObservedRemoteParticipant = false
    private var mediaRecoveryTask: Task<Void, Never>?
    private var needsMediaRecoveryAfterReconnect = false
    private var qualitySamplingTask: Task<Void, Never>?
    private var qualityAccumulator = CallQualityAccumulator()
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
    private let directRemoteDepartureGrace: UInt64 = 20_000_000_000
    private let groupRemoteDepartureGrace: UInt64 = 3_000_000_000

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

    func dismissLiveRoleIntroduction() {
        guard var call = currentCall, call.liveRoleContext != nil else { return }
        call.isLiveRoleIntroductionDismissed = true
        currentCall = call
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

    /// Starts media only after a lightweight live invitation was accepted.
    /// This additive path deliberately skips the normal incoming/outgoing
    /// ringtone states; existing friend and group call behavior is unchanged.
    func connectAcceptedLiveCall(
        remoteUserID: String,
        remoteNickname: String,
        remoteAvatarURL: String,
        isOutgoing: Bool,
        response: CallJoinResponse,
        callType: CallType,
        billingPolicy: LiveBillingPolicy,
        liveRoleContext: LiveCallRoleContext?,
        liveExperience: LiveExperienceSnapshot?
    ) {
        guard currentCall == nil else { return }
        dismissKeyboard()

        currentCall = CallSession(
            remoteUserID: remoteUserID,
            remoteNickname: remoteNickname,
            remoteAvatarURL: remoteAvatarURL,
            callType: callType,
            isOutgoing: isOutgoing,
            state: .connecting,
            startedAt: Date(),
            serverCallID: response.callID,
            roomName: response.roomName,
            livekitToken: response.token,
            livekitURL: response.livekitUrl
        )
        currentCall?.isLivePairCall = true
        currentCall?.liveRoleContext = liveRoleContext
        currentCall?.liveBillingPolicy = billingPolicy
        currentCall?.liveExperience = liveExperience
        let localSessionID = currentCall?.id

        Task {
            guard await ensureMediaPermissions(for: callType),
                  currentCall?.id == localSessionID else {
                if currentCall?.id == localSessionID {
                    endCall()
                }
                return
            }

            do {
                let livekitURL = try normalizedLiveKitURL(response.livekitUrl)
                guard currentCall?.id == localSessionID else { return }
                await connectToRoom(
                    url: livekitURL,
                    token: response.token,
                    isVideo: callType == .video
                )
            } catch {
                guard currentCall?.id == localSessionID else { return }
                failCall(L10n.tr("call.error.join", error.localizedDescription))
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

            // Publish local video with higher quality, explicitly using front camera.
            // A single-layer VP8 retry keeps video available on older/self-hosted
            // LiveKit deployments that reject the preferred simulcast profile.
            if isVideo {
                isFrontCamera = true
                do {
                    localVideoTrack = try await publishCamera(in: newRoom, position: .front)
                    isLocalVideoEnabled = true
                } catch {
                    // A missing/busy camera must not tear down an otherwise
                    // healthy call. Keep the room and any available audio alive
                    // so the user can retry camera publishing later.
                    print("[CallManager] Camera unavailable; continuing with audio: \(error)")
                    localVideoTrack = nil
                    isLocalVideoEnabled = false
                    errorMessage = L10n.tr("call.error.cameraUnavailable")
                }
                startQualitySampling()
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

    private func publishCamera(
        in targetRoom: Room,
        position: AVCaptureDevice.Position
    ) async throws -> VideoTrack {
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--call-test-synthetic-camera") {
            return try await publishSyntheticVideo(in: targetRoom)
        }
        #endif

        let preferredCaptureOptions = CallMediaConfiguration.cameraCaptureOptions(position: position)

        do {
            return try await publishCamera(
                in: targetRoom,
                captureOptions: preferredCaptureOptions,
                publishOptions: CallMediaConfiguration.videoPublishOptions
            )
        } catch {
            print("[CallManager] Preferred camera profile failed; retrying compatibility profile: \(error)")
            await removeLocalCameraPublications(from: targetRoom)

            return try await publishCamera(
                in: targetRoom,
                captureOptions: CallMediaConfiguration.cameraCaptureOptions(position: position),
                publishOptions: CallMediaConfiguration.compatibilityVideoPublishOptions
            )
        }
    }

    private func publishCamera(
        in targetRoom: Room,
        captureOptions: CameraCaptureOptions,
        publishOptions: VideoPublishOptions
    ) async throws -> VideoTrack {
        let publication = try await targetRoom.localParticipant.setCamera(
            enabled: true,
            captureOptions: captureOptions,
            publishOptions: publishOptions
        )
        guard let track = (publication?.track as? VideoTrack) ??
            (targetRoom.localParticipant.localVideoTracks.first?.track as? VideoTrack) else {
            throw CallManagerError.cameraTrackUnavailable
        }
        await track.set(reportStatistics: true)
        return track
    }

    private func removeLocalCameraPublications(from targetRoom: Room) async {
        for publication in targetRoom.localParticipant.localVideoTracks {
            try? await targetRoom.localParticipant.unpublish(publication: publication)
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
        await track.set(reportStatistics: true)
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

    // MARK: - Real-device video quality diagnostics

    private func startQualitySampling() {
        qualitySamplingTask?.cancel()
        qualityAccumulator = CallQualityAccumulator()
        collectQualitySample()

        qualitySamplingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard !Task.isCancelled, let self, self.currentCall != nil else { return }
                self.collectQualitySample()
            }
        }
    }

    private func collectQualitySample() {
        let outboundSample = outboundQualitySample()
        let inboundSample = inboundQualitySample()
        let transport = qualityTransport()
        qualityAccumulator.record(
            outbound: outboundSample,
            inbound: inboundSample,
            iceTransport: transport.name,
            relay: transport.relay
        )

        guard outboundSample != nil || inboundSample != nil else { return }
        let callID = currentCall?.serverCallID ?? "-"
        print(
            "[CallQuality] call_id=\(callID) " +
                "out=\(qualityDescription(outboundSample)) " +
                "in=\(qualityDescription(inboundSample))"
        )
    }

    private func outboundQualitySample() -> CallQualityStreamSample? {
        guard let statistics = localVideoTrack?.statistics else { return nil }
        let outbound = statistics.outboundRtpStream.first {
            $0.kind == "video" && $0.active != false
        } ?? statistics.outboundRtpStream.first { $0.kind == "video" }
        let source = statistics.videoSource.first
        let receiverFeedback = statistics.remoteInboundRtpStream.first { $0.kind == "video" }
        guard outbound != nil || source != nil else { return nil }

        let width = outbound?.frameWidth.map { Int($0) } ?? source?.width.map { Int($0) }
        let height = outbound?.frameHeight.map { Int($0) } ?? source?.height.map { Int($0) }
        let packetsLost = receiverFeedback?.packetsLost.map { Int(clamping: $0) }
        let nackCount = outbound?.nackCount.map { Int($0) }
        let pliCount = outbound?.pliCount.map { Int($0) }
        let firCount = outbound?.firCount.map { Int($0) }
        let rttMs = receiverFeedback?.roundTripTime.map { $0 * 1_000 }

        return CallQualityStreamSample(
            bytes: outbound?.bytesSent,
            timestamp: outbound?.timestamp,
            width: width,
            height: height,
            fps: outbound?.framesPerSecond ?? source?.framesPerSecond,
            packetsLost: packetsLost,
            nackCount: nackCount,
            pliCount: pliCount,
            firCount: firCount,
            framesDropped: nil,
            freezeCount: nil,
            rttMs: rttMs,
            fractionLost: receiverFeedback?.fractionLost,
            qualityLimitationReason: outbound?.qualityLimitationReason?.rawValue
        )
    }

    private func inboundQualitySample() -> CallQualityStreamSample? {
        let remoteTrack = remoteVideoTrack ?? remoteParticipants.lazy.compactMap(activeVideoTrack).first
        guard let statistics = remoteTrack?.statistics else { return nil }
        let inbound = statistics.inboundRtpStream.first { $0.kind == "video" }
        let senderFeedback = statistics.remoteOutboundRtpStream.first { $0.kind == "video" }
        guard let inbound else { return nil }

        let width = inbound.frameWidth.map { Int($0) }
        let height = inbound.frameHeight.map { Int($0) }
        let packetsLost = inbound.packetsLost.map { Int(clamping: $0) }
        let nackCount = inbound.nackCount.map { Int($0) }
        let pliCount = inbound.pliCount.map { Int($0) }
        let firCount = inbound.firCount.map { Int($0) }
        let framesDropped = inbound.framesDropped.map { Int($0) }
        let freezeCount = inbound.freezeCount.map { Int($0) }
        let rttMs = senderFeedback?.roundTripTime.map { $0 * 1_000 }

        return CallQualityStreamSample(
            bytes: inbound.bytesReceived,
            timestamp: inbound.timestamp,
            width: width,
            height: height,
            fps: inbound.framesPerSecond,
            packetsLost: packetsLost,
            nackCount: nackCount,
            pliCount: pliCount,
            firCount: firCount,
            framesDropped: framesDropped,
            freezeCount: freezeCount,
            rttMs: rttMs,
            fractionLost: nil,
            qualityLimitationReason: nil
        )
    }

    private func qualityTransport() -> (name: String?, relay: Bool?) {
        let statistics = localVideoTrack?.statistics ?? remoteVideoTrack?.statistics
        guard let candidate = statistics?.localIceCandidate else { return (nil, nil) }
        let isRelay = candidate.candidateType == .relay
        guard isRelay else {
            let transport = candidate.protocol?.lowercased()
            return (["udp", "tcp"].contains(transport ?? "") ? transport : "unknown", false)
        }

        switch candidate.relayProtocol {
        case .udp:
            return ("turn_udp", true)
        case .tcp:
            return ("turn_tcp", true)
        case .tls:
            return ("turn_tls", true)
        case nil:
            let transport = candidate.protocol?.lowercased()
            if transport == "udp" { return ("turn_udp", true) }
            if transport == "tcp" { return ("turn_tcp", true) }
            return ("unknown", true)
        }
    }

    private func qualityDescription(_ sample: CallQualityStreamSample?) -> String {
        guard let sample else { return "-" }
        let dimensions: String
        if let width = sample.width, let height = sample.height {
            dimensions = "\(width)x\(height)"
        } else {
            dimensions = "?x?"
        }
        let fps = sample.fps.map { String(format: "%.1f", $0) } ?? "?"
        return "\(dimensions)@\(fps)"
    }

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
                    let track = try await publishCamera(in: targetRoom, position: position)
                    guard room === targetRoom,
                          currentCall != nil,
                          videoControlGeneration == generation else { return }
                    localVideoTrack = track
                    errorMessage = nil
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

    func isParticipantMuted(_ participant: Participant) -> Bool {
        if participant.sid == room?.localParticipant.sid {
            return isMuted
        }
        let audioTracks = participant.audioTracks
        return audioTracks.isEmpty || audioTracks.allSatisfy(\.isMuted)
    }

    func activeVideoTrack(for participant: Participant) -> VideoTrack? {
        if participant.sid == room?.localParticipant.sid {
            guard isLocalVideoEnabled else { return nil }
            return localVideoTrack
        }

        return participant.videoTracks
            .first { !$0.isMuted && $0.track is VideoTrack }?
            .track as? VideoTrack
    }

    func isParticipantVideoEnabled(_ participant: Participant) -> Bool {
        activeVideoTrack(for: participant) != nil
    }

    // MARK: - Internal: Participant Updates

    func updateRemoteParticipants() {
        guard let room = room else { return }
        remoteParticipants = room.remoteParticipants.values.sorted {
            let lhs = $0.identity?.stringValue ?? String(describing: $0.sid)
            let rhs = $1.identity?.stringValue ?? String(describing: $1.sid)
            return lhs.localizedStandardCompare(rhs) == .orderedAscending
        }
        if !remoteParticipants.isEmpty {
            hasObservedRemoteParticipant = true
        }

        // Muting a LiveKit camera intentionally retains its publication and
        // last decoded frame. Never expose that muted track to SwiftUI, or the
        // UI appears frozen instead of showing that the camera is off.
        remoteVideoTrack = remoteParticipants.lazy.compactMap(activeVideoTrack).first

        // First remote joined on an outgoing call: now we're truly "connected".
        // Ordinary 1v1 calls still wait for remote audio so ringing does not end
        // prematurely. Live-pair calls were already accepted before media starts,
        // so the remote participant joining is enough to leave `.connecting`.
        if let call = currentCall {
            let hasRemoteAudio = remoteParticipants.contains { p in
                !p.audioTracks.isEmpty
            }
            if CallConnectionTransitionPolicy.shouldMarkConnected(
                isOutgoing: call.isOutgoing,
                isGroupCall: call.groupID != nil,
                isLivePairCall: call.isLivePairCall,
                state: call.state,
                remoteParticipantCount: remoteParticipants.count,
                hasRemoteAudio: hasRemoteAudio
            ) {
                stopRingtone()
                ringTimeoutTask?.cancel()
                ringTimeoutTask = nil
                if var connectedCall = currentCall {
                    connectedCall.state = .connected
                    currentCall = connectedCall
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
                    track = try await self.publishCamera(
                        in: targetRoom,
                        position: self.isFrontCamera ? .front : .back
                    )
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
        hasObservedRemoteParticipant = true
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
              liveEndingMessage == nil,
              CallParticipantDeparturePolicy.shouldScheduleAutoExit(
                isGroupCall: call.groupID != nil,
                hasObservedRemoteParticipant: hasObservedRemoteParticipant,
                remoteParticipantCount: disconnectedRoom.remoteParticipants.count
              ) else { return }

        remoteDepartureGraceTask?.cancel()
        let sessionID = call.id
        let grace = call.groupID == nil
            ? directRemoteDepartureGrace
            : groupRemoteDepartureGrace
        remoteDepartureGraceTask = Task { [weak self, weak disconnectedRoom] in
            try? await Task.sleep(nanoseconds: grace)
            guard !Task.isCancelled,
                  let self,
                  let disconnectedRoom,
                  self.room === disconnectedRoom,
                  self.currentCall?.id == sessionID,
                  disconnectedRoom.remoteParticipants.isEmpty else { return }
            print("[CallManager] Last remote participant left; ending local session call_id=\(call.serverCallID ?? "-")")
            self.endCall()
        }
    }

    func handleParticipantMuteUpdate(
        in updatedRoom: Room,
        participant: Participant,
        publication: TrackPublication,
        isMuted: Bool
    ) {
        guard room === updatedRoom else { return }
        if publication.kind == .audio,
           participant.sid == updatedRoom.localParticipant.sid {
            self.isMuted = isMuted
        }
        // Reassigning the roster publishes a SwiftUI update for audio and
        // video publication mute changes, whose participant object is stable.
        updateRemoteParticipants()
    }

    func handleRoomDisconnect(_ disconnectedRoom: Room, error: LiveKitError?) {
        guard room === disconnectedRoom, let call = currentCall else { return }
        if call.isLivePairCall {
            guard liveEndingMessage == nil else { return }
            if let error {
                print("[CallManager] LiveKit live room disconnected; waiting for termination reason: \(error)")
            } else {
                print("[CallManager] LiveKit live room closed; waiting for termination reason")
            }
            scheduleLiveTerminationReconciliation(
                sessionID: call.id,
                showConnectionError: error != nil,
                notifyRemoteOnExpiry: true
            )
            return
        }
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
        if endedCall?.callType == .video {
            collectQualitySample()
        }
        let qualityReport = qualityAccumulator.makeReport()

        durationTimer?.cancel()
        durationTimer = nil
        connectionTimeoutTask?.cancel()
        connectionTimeoutTask = nil
        ringTimeoutTask?.cancel()
        ringTimeoutTask = nil
        gracefulLiveEndingTask?.cancel()
        gracefulLiveEndingTask = nil
        liveTerminationReconciliationTask?.cancel()
        liveTerminationReconciliationTask = nil
        remoteDepartureGraceTask?.cancel()
        remoteDepartureGraceTask = nil
        qualitySamplingTask?.cancel()
        qualitySamplingTask = nil
        qualityAccumulator = CallQualityAccumulator()
        hasObservedRemoteParticipant = false
        #if DEBUG && targetEnvironment(simulator)
        syntheticVideoTask?.cancel()
        syntheticVideoTask = nil
        debugReconnectScheduled = false
        #endif
        callDuration = 0
        liveEndingMessage = nil
        liveEndingDetail = nil
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

        if endedCall?.isLivePairCall == true {
            Task {
                async let wallet: Void = WalletStore.shared.refreshBalanceFromServer(forceRefresh: true)
                async let props: Void = PropInventoryStore.shared.load(forceRefresh: true)
                _ = await (wallet, props)
            }
        }

        Task {
            // Explicitly stop camera and mic before disconnecting to release hardware
            _ = try? await roomToClean?.localParticipant.setCamera(enabled: false)
            _ = try? await roomToClean?.localParticipant.setMicrophone(enabled: false)
            await roomToClean?.disconnect()
            try? await AudioManager.shared.setRecordingAlwaysPreparedMode(false)
        }

        if let callID = endedCall?.serverCallID,
           !callID.isEmpty,
           let qualityReport {
            Task {
                do {
                    try await APIService.shared.reportCallQuality(
                        callID: callID,
                        report: qualityReport
                    )
                } catch {
                    print("[CallQuality] Failed to upload call_id=\(callID): \(error)")
                }
            }
        }

        if endedCall?.isLivePairCall == true {
            NotificationCenter.default.post(name: .conversationListNeedsReload, object: nil)
        }
        if let endedCall,
           LiveHostCallEndPolicy.shouldReturnToLobby(
               isLivePairCall: endedCall.isLivePairCall,
               isOutgoing: endedCall.isOutgoing
           ) {
            NotificationCenter.default.post(name: .liveHostCallDidEnd, object: nil)
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
                    if call.isLivePairCall {
                        await MainActor.run {
                            NotificationCenter.default.post(
                                name: .conversationListNeedsReload,
                                object: nil
                            )
                            if LiveHostCallEndPolicy.shouldReturnToLobby(
                                isLivePairCall: call.isLivePairCall,
                                isOutgoing: call.isOutgoing
                            ) {
                                NotificationCenter.default.post(
                                    name: .liveHostCallDidEnd,
                                    object: nil
                                )
                            }
                        }
                    }
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
                if let call = self.currentCall, call.isLivePairCall {
                    if LiveCallTerminationPolicy.isInsufficientBalance(data) {
                        self.beginGracefulLiveEnding(data: data)
                    } else {
                        self.scheduleLiveTerminationReconciliation(
                            sessionID: call.id,
                            showConnectionError: false,
                            notifyRemoteOnExpiry: false
                        )
                    }
                } else {
                    self.endCallLocally()
                }
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

        WebSocketService.shared.liveCallBillingPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.handleLiveCallBillingUpdate(data)
            }
            .store(in: &cancellables)

        WebSocketService.shared.$isConnected
            .removeDuplicates()
            .dropFirst()
            .filter { $0 }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.requestLiveTerminationStateRecovery()
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.requestLiveTerminationStateRecovery()
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

    private func handleLiveCallBillingUpdate(_ data: [String: Any]) {
        guard var call = currentCall,
              call.isLivePairCall,
              let eventCallID = Self.firstString(data, keys: ["call_id"]),
              call.serverCallID == eventCallID,
              Self.isValidLiveBillingUpdate(data) else { return }

        if let experience = Self.liveExperienceSnapshot(from: data) {
            call.liveExperience = experience
        }

        if call.isOutgoing {
            call.confirmedLiveActivityCatFoodCharge = Self.intValue(
                data["charged_activity_cat_food"]
            ).map { max($0, 0) }
            call.confirmedLiveGoldCoinCharge = Self.intValue(
                data["charged_gold_coins"]
            ).map { max($0, 0) }
            call.confirmedLiveTotalCharge = Self.intValue(
                data["total_charged"]
            ).map { max($0, 0) }
        } else if let earned = Self.intValue(data["earned_gold_coins"]) {
            call.confirmedLiveEarningGoldCoins = max(earned, 0)
        }
        currentCall = call
        if call.isOutgoing {
            if let goldCoins = Self.intValue(data["gold_coin_balance_after"]),
               let activityCatFood = Self.intValue(data["activity_cat_food_balance_after"]),
               let spendable = Self.intValue(data["spendable_balance_after"]) {
                WalletStore.shared.applySpendableBalances(
                    goldCoinBalance: goldCoins,
                    activityCatFoodBalance: activityCatFood,
                    spendableBalance: spendable
                )
                if let chargedActivityCatFood = Self.intValue(data["charged_activity_cat_food"]),
                   let chargedGoldCoins = Self.intValue(data["charged_gold_coins"]),
                   let totalCharged = Self.intValue(data["total_charged"]) {
                    WalletTelemetry.recordLiveBilling(
                        operation: "one_to_one_live",
                        chargedActivityCatFood: chargedActivityCatFood,
                        chargedGoldCoins: chargedGoldCoins,
                        totalCharged: totalCharged,
                        goldCoinBalanceAfter: goldCoins,
                        activityCatFoodBalanceAfter: activityCatFood,
                        spendableBalanceAfter: spendable
                    )
                }
            }
        }
        if LiveCallTerminationPolicy.isInsufficientBalance(data) {
            beginGracefulLiveEnding(data: data)
        }
    }

    private func beginGracefulLiveEnding(data: [String: Any]) {
        guard let call = currentCall, call.isLivePairCall else { return }

        errorMessage = nil
        isMinimized = false
        liveEndingMessage = LiveCallTerminationPolicy.message(
            isPayer: call.isOutgoing,
            callType: call.callType
        )
        liveEndingDetail = liveEndingBillingDetail(call: call, data: data)
        durationTimer?.cancel()
        durationTimer = nil
        connectionTimeoutTask?.cancel()
        connectionTimeoutTask = nil
        remoteDepartureGraceTask?.cancel()
        remoteDepartureGraceTask = nil
        liveTerminationReconciliationTask?.cancel()
        liveTerminationReconciliationTask = nil

        // A second reason event (for example call_end after billing_insufficient)
        // may refine the message, but must not restart the visible grace period.
        guard gracefulLiveEndingTask == nil else { return }
        let sessionID = call.id
        let grace = LiveCallTerminationPolicy.graceNanoseconds(data)
        gracefulLiveEndingTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: grace)
            guard !Task.isCancelled,
                  let self,
                  self.currentCall?.id == sessionID else { return }
            self.endCallLocally()
        }
    }

    private func liveEndingBillingDetail(
        call: CallSession,
        data: [String: Any]
    ) -> String? {
        LiveCallTerminationPresentationPolicy.billingDetail(
            isPayer: call.isOutgoing,
            chargedActivityCatFood: Self.intValue(data["charged_activity_cat_food"])
                ?? call.confirmedLiveActivityCatFoodCharge,
            chargedGoldCoins: Self.intValue(data["charged_gold_coins"])
                ?? call.confirmedLiveGoldCoinCharge,
            totalCharged: Self.intValue(data["total_charged"])
                ?? call.confirmedLiveTotalCharge,
            earnedGoldCoins: Self.intValue(data["earned_gold_coins"])
                ?? call.confirmedLiveEarningGoldCoins,
            goldCoinBalanceAfter: Self.intValue(data["gold_coin_balance_after"]),
            activityCatFoodBalanceAfter: Self.intValue(data["activity_cat_food_balance_after"]),
            spendableBalanceAfter: Self.intValue(data["spendable_balance_after"])
        )
    }

    private func scheduleLiveTerminationReconciliation(
        sessionID: UUID,
        showConnectionError: Bool,
        notifyRemoteOnExpiry: Bool
    ) {
        guard liveEndingMessage == nil,
              liveTerminationReconciliationTask == nil else { return }
        let delay = UInt64(LiveCallTerminationPolicy.reconciliationMilliseconds) * 1_000_000
        let callID = currentCall?.serverCallID
        liveTerminationReconciliationTask = Task { [weak self] in
            let startedAt = Date()
            if let callID, !callID.isEmpty,
               let state = await Self.fetchLiveCallState(
                   callID: callID,
                   timeoutNanoseconds: delay
               ),
               let self,
               self.currentCall?.id == sessionID,
               self.applyRecoveredLiveTerminationState(state) {
                self.liveTerminationReconciliationTask = nil
                return
            }
            let elapsed = Date().timeIntervalSince(startedAt)
            let remaining = max(
                Double(delay) - elapsed * 1_000_000_000,
                0
            )
            if remaining > 0 {
                try? await Task.sleep(nanoseconds: UInt64(remaining))
            }
            guard !Task.isCancelled,
                  let self,
                  self.currentCall?.id == sessionID,
                  self.liveEndingMessage == nil else { return }
            self.liveTerminationReconciliationTask = nil
            if showConnectionError {
                self.errorMessage = L10n.tr("call.error.connection")
            }
            if notifyRemoteOnExpiry {
                self.endCall()
            } else {
                self.endCallLocally()
            }
        }
    }

    private func requestLiveTerminationStateRecovery() {
        guard let call = currentCall,
              call.isLivePairCall,
              let callID = call.serverCallID,
              !callID.isEmpty else { return }
        let sessionID = call.id
        Task { [weak self] in
            guard let state = try? await APIService.shared.getOneToOneLiveCallState(
                callID: callID
            ), let self,
               self.currentCall?.id == sessionID else { return }
            _ = self.applyRecoveredLiveTerminationState(state)
        }
    }

    @discardableResult
    private func applyRecoveredLiveTerminationState(
        _ state: OneToOneLiveCallState
    ) -> Bool {
        guard let call = currentCall,
              call.isLivePairCall,
              call.serverCallID == state.callID else { return false }
        if let billingPolicy = state.billingPolicy {
            currentCall?.liveBillingPolicy = billingPolicy
        }
        if let liveExperience = state.liveExperience {
            currentCall?.liveExperience = liveExperience
        }
        let data = Self.liveTerminationData(from: state)
        guard LiveCallTerminationPolicy.isInsufficientBalance(data) else {
            return false
        }
        handleLiveCallBillingUpdate(data)
        return true
    }

    private static func liveTerminationData(
        from state: OneToOneLiveCallState
    ) -> [String: Any] {
        var data: [String: Any] = [
            "call_id": state.callID,
            "status": state.status
        ]
        if let endReason = state.endReason {
            data["end_reason"] = endReason
            data["reason"] = endReason
        }
        if let grace = state.terminationGraceMilliseconds {
            data["termination_grace_ms"] = grace
        }
        if let finalBilling = state.finalBilling {
            data["charged_units"] = finalBilling.chargedUnits
            data["charged_activity_cat_food"] = finalBilling.chargedActivityCatFood
            data["charged_gold_coins"] = finalBilling.chargedGoldCoins
            data["total_charged"] = finalBilling.totalCharged
            data["earned_gold_coins"] = finalBilling.earnedGoldCoins
            data["gold_coin_balance_after"] = finalBilling.goldCoinBalanceAfter
            data["activity_cat_food_balance_after"] = finalBilling.activityCatFoodBalanceAfter
            data["spendable_balance_after"] = finalBilling.spendableBalanceAfter
            data["billing_status"] = finalBilling.billingStatus
            if state.endReason == nil, let billingStatus = finalBilling.billingStatus {
                data["reason"] = billingStatus
            }
        }
        return data.compactMapValues { $0 }
    }

    private static func fetchLiveCallState(
        callID: String,
        timeoutNanoseconds: UInt64
    ) async -> OneToOneLiveCallState? {
        await withTaskGroup(of: OneToOneLiveCallState?.self) { group in
            group.addTask {
                try? await APIService.shared.getOneToOneLiveCallState(callID: callID)
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: timeoutNanoseconds)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    private static func liveExperienceSnapshot(from data: [String: Any]) -> LiveExperienceSnapshot? {
        let object: [String: Any]?
        if let nested = data["live_experience"] as? [String: Any] {
            object = nested
        } else if let nested = data["experience"] as? [String: Any] {
            object = nested
        } else if data["definition_id"] != nil || data["prop_definition_id"] != nil {
            object = data
        } else {
            object = nil
        }
        guard let object,
              JSONSerialization.isValidJSONObject(object),
              let encoded = try? JSONSerialization.data(withJSONObject: object)
        else { return nil }
        return (try? JSONDecoder().decode(LiveExperienceSnapshot.self, from: encoded))?
            .anchored(serverTime: firstString(data, keys: ["server_time"]))
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

    private static func isValidLiveBillingUpdate(_ data: [String: Any]) -> Bool {
        let chargedActivityCatFood = intValue(data["charged_activity_cat_food"])
        let chargedGoldCoins = intValue(data["charged_gold_coins"])
        let totalCharged = intValue(data["total_charged"])
        let values = [
            chargedActivityCatFood,
            chargedGoldCoins,
            totalCharged,
            intValue(data["earned_gold_coins"]),
            intValue(data["gold_coin_balance_after"]),
            intValue(data["activity_cat_food_balance_after"]),
            intValue(data["spendable_balance_after"])
        ].compactMap { $0 }
        guard values.allSatisfy({ $0 >= 0 }) else { return false }
        if let chargedActivityCatFood, let chargedGoldCoins, let totalCharged {
            return totalCharged == chargedActivityCatFood + chargedGoldCoins
        }
        return true
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

    nonisolated func room(
        _ room: Room,
        participant: Participant,
        trackPublication: TrackPublication,
        didUpdateIsMuted isMuted: Bool
    ) {
        Task { @MainActor in
            manager?.handleParticipantMuteUpdate(
                in: room,
                participant: participant,
                publication: trackPublication,
                isMuted: isMuted
            )
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
