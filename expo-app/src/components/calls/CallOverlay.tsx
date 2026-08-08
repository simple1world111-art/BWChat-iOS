import {
  AndroidAudioTypePresets,
  AudioSession,
  isTrackReference,
  LiveKitRoom,
  type TrackReference,
  VideoTrack,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useSpeakingParticipants,
  useTracks,
} from "@livekit/react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SymbolView, type SFSymbol } from "expo-symbols";
import {
  ConnectionQuality,
  ConnectionState,
  DefaultReconnectPolicy,
  MediaDeviceFailure,
  Track,
  type Participant,
} from "livekit-client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar } from "@/components/Avatar";
import type { CallSession } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useCall } from "@/providers/CallProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CALL_CONNECTION_TIMEOUT_MS,
  DIRECT_REMOTE_DEPARTURE_GRACE_MS,
  formatCallDuration,
  GROUP_REMOTE_DEPARTURE_GRACE_MS,
  shouldMarkCallConnected,
  shouldScheduleCallAutoExit,
} from "@/services/calls/callPolicy";
import {
  callQualityService,
  collectCallQualitySample,
  type CallQualityTrack,
} from "@/services/calls/CallQualityService";
import { retryCallMediaPublication } from "@/services/calls/CallMediaRecovery";
import {
  liveBillingAccruedAmount,
  liveBillingFreeSecondsRemaining,
  liveBillingPolicyOrFallback,
  liveExperienceAccruedOverageAmount,
  liveExperienceRemainingSeconds,
} from "@/services/live/LiveCallExperience";

const CALL_VIDEO_CAPTURE_OPTIONS = {
  facingMode: "user" as const,
  resolution: { width: 1280, height: 720, frameRate: 30 },
};

const CALL_ROOM_OPTIONS = {
  adaptiveStream: { pixelDensity: "screen" as const },
  dynacast: true,
  singlePeerConnection: false,
  reconnectPolicy: new DefaultReconnectPolicy([
    300, 600, 1_200, 2_400, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000,
  ]),
  audioCaptureDefaults: {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
  },
  videoCaptureDefaults: CALL_VIDEO_CAPTURE_OPTIONS,
  publishDefaults: {
    audioPreset: { maxBitrate: 48_000, priority: "high" as const },
    dtx: true,
    red: true,
    videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30, priority: "high" as const },
    simulcast: false,
    videoCodec: "vp8" as const,
    backupCodec: false,
    degradationPreference: "balanced" as const,
  },
};

export function CallOverlay() {
  const call = useCall();
  const { session } = call;
  if (!session) return null;
  if (session.token !== undefined && session.livekit_url !== undefined) {
    return <CallMediaHost key={session.id} session={session} />;
  }
  return call.isMinimized ? <CallPipBubble session={session} /> : <CallModal session={session} />;
}

function CallMediaHost({ session }: { session: CallSession }) {
  const {
    failMedia,
    isMinimized,
    isSpeakerOn,
    markMediaConnected,
    setCameraEnabled,
    setMuted,
    showError,
  } = useCall();
  const { t } = useLocalization();
  const [audioReady, setAudioReady] = useState(false);
  const connectedRef = useRef(false);
  const initialSpeakerOnRef = useRef(isSpeakerOn);

  useEffect(() => {
    const generation = { active: true };
    const timeout = setTimeout(() => {
      if (generation.active && !connectedRef.current) {
        failMedia(new Error("LiveKit room connection timed out"));
      }
    }, CALL_CONNECTION_TIMEOUT_MS);
    return () => {
      generation.active = false;
      clearTimeout(timeout);
    };
  }, [failMedia, session.id]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await AudioSession.configureAudio({
          android: {
            audioTypeOptions: AndroidAudioTypePresets.communication,
            preferredOutputList: ["bluetooth", "headset", "speaker", "earpiece"],
          },
          ios: { defaultOutput: initialSpeakerOnRef.current ? "speaker" : "earpiece" },
        });
        await AudioSession.startAudioSession();
        if (active) setAudioReady(true);
      } catch (error) {
        if (active) failMedia(error);
      }
    })();
    return () => {
      active = false;
      void AudioSession.stopAudioSession();
    };
  }, [failMedia]);

  if (!audioReady) {
    return isMinimized ? <CallPipBubble session={session} /> : <CallModal session={session} />;
  }

  return (
    <LiveKitRoom
      audio
      connect
      onConnected={() => {
        connectedRef.current = true;
        markMediaConnected(0, false);
      }}
      onDisconnected={() => failMedia()}
      onError={(error) => {
        if (MediaDeviceFailure.getFailure(error)) return;
        failMedia(error);
      }}
      onMediaDeviceFailure={(_failure, kind?: "audioinput" | "audiooutput" | "videoinput") => {
        if (kind === "audioinput") {
          setMuted(true);
          showError(t("call.error.microphoneUnavailable"));
        } else if (kind === "videoinput") {
          setCameraEnabled(false);
          showError(t("call.error.cameraUnavailable"));
        }
      }}
      connectOptions={{ maxRetries: 12 }}
      options={CALL_ROOM_OPTIONS}
      serverUrl={session.livekit_url}
      token={session.token}
      video={session.call_type === "video" ? CALL_VIDEO_CAPTURE_OPTIONS : false}
    >
      <CallRoomContent session={session} />
    </LiveKitRoom>
  );
}

function CallRoomContent({ session }: { session: CallSession }) {
  const call = useCall();
  const { t } = useLocalization();
  const unsortedRemoteParticipants = useRemoteParticipants();
  const remoteParticipants = useMemo(
    () =>
      [...unsortedRemoteParticipants].sort((left, right) =>
        participantSortKey(left).localeCompare(participantSortKey(right), undefined, {
          numeric: true,
        }),
      ),
    [unsortedRemoteParticipants],
  );
  const speakingParticipants = useSpeakingParticipants();
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera]);
  const trackReferences = tracks.filter(isTrackReference);
  const localQualityTrack = localParticipant.getTrackPublication(Track.Source.Camera)?.track as
    CallQualityTrack | undefined;
  const remoteQualityTrack = remoteParticipants
    .map((participant) => participant.getTrackPublication(Track.Source.Camera)?.track)
    .find((track) => track !== undefined) as CallQualityTrack | undefined;
  const qualityTracksRef = useRef<{
    local?: CallQualityTrack | undefined;
    remote?: CallQualityTrack | undefined;
  }>({});
  const remoteCountRef = useRef(remoteParticipants.length);
  const hasObservedRemoteParticipantRef = useRef(remoteParticipants.length > 0);
  const departureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const departureGenerationRef = useRef(0);
  useLayoutEffect(() => {
    remoteCountRef.current = remoteParticipants.length;
    if (remoteParticipants.length > 0) hasObservedRemoteParticipantRef.current = true;
  }, [remoteParticipants.length]);
  useEffect(() => {
    qualityTracksRef.current = { local: localQualityTrack, remote: remoteQualityTrack };
  }, [localQualityTrack, remoteQualityTrack]);

  useEffect(() => {
    if (session.call_type !== "video" || !session.call_id) return;
    callQualityService.start(session.id, session.call_id, () =>
      collectCallQualitySample(qualityTracksRef.current.local, qualityTracksRef.current.remote),
    );
    return () => {
      void callQualityService.finish(session.id);
    };
  }, [session.call_id, session.call_type, session.id]);
  const hasRemoteAudio = remoteParticipants.some((participant) => {
    const publication = participant.getTrackPublication(Track.Source.Microphone);
    return Boolean(publication);
  });
  const activeCallSessionId = call.session?.id;
  const endCall = call.endCall;

  useEffect(() => {
    departureGenerationRef.current += 1;
    const generation = departureGenerationRef.current;
    if (departureTimerRef.current) clearTimeout(departureTimerRef.current);
    departureTimerRef.current = null;
    if (
      !shouldScheduleCallAutoExit(
        session.group_id !== undefined,
        hasObservedRemoteParticipantRef.current,
        remoteParticipants.length,
      ) ||
      session.live_ending_message ||
      (session.group_id === undefined && session.state !== "connected")
    ) {
      return;
    }
    departureTimerRef.current = setTimeout(
      () => {
        if (
          departureGenerationRef.current === generation &&
          remoteCountRef.current === 0 &&
          activeCallSessionId === session.id
        ) {
          endCall();
        }
      },
      session.group_id === undefined
        ? DIRECT_REMOTE_DEPARTURE_GRACE_MS
        : GROUP_REMOTE_DEPARTURE_GRACE_MS,
    );
    return () => {
      if (departureTimerRef.current) clearTimeout(departureTimerRef.current);
      departureTimerRef.current = null;
    };
  }, [
    activeCallSessionId,
    endCall,
    remoteParticipants.length,
    session.group_id,
    session.id,
    session.live_ending_message,
    session.state,
  ]);

  useMediaRecoveryAfterInterruption({
    call,
    connectionState,
    localParticipant,
    session,
    t,
  });

  useEffect(() => {
    if (shouldMarkCallConnected(session, remoteParticipants.length, hasRemoteAudio)) {
      call.markMediaConnected(remoteParticipants.length, hasRemoteAudio);
    }
  }, [call, hasRemoteAudio, remoteParticipants.length, session]);

  const toggleMute = useCallback(async () => {
    const next = !call.isMuted;
    try {
      await localParticipant.setMicrophoneEnabled(!next);
      call.setMuted(next);
    } catch {
      call.showError(t("call.error.microphoneUnavailable"));
    }
  }, [call, localParticipant, t]);

  const toggleCamera = useCallback(async () => {
    const next = !call.isCameraEnabled;
    try {
      if (next) {
        await localParticipant.setCameraEnabled(true, {
          facingMode: call.isFrontCamera ? "user" : "environment",
          resolution: CALL_VIDEO_CAPTURE_OPTIONS.resolution,
        });
      } else {
        await localParticipant.setCameraEnabled(false);
      }
      call.setCameraEnabled(next);
    } catch {
      call.showError(t("call.error.cameraUnavailable"));
    }
  }, [call, localParticipant, t]);

  const toggleSpeaker = useCallback(async () => {
    const next = !call.isSpeakerOn;
    try {
      const outputs = await AudioSession.getAudioOutputs();
      const desired =
        Platform.OS === "ios"
          ? next
            ? "force_speaker"
            : "default"
          : next
            ? "speaker"
            : "earpiece";
      if (outputs.includes(desired)) await AudioSession.selectAudioOutput(desired);
      call.setSpeakerOn(next);
    } catch (error) {
      call.showError(error instanceof Error ? error.message : String(error));
    }
  }, [call]);

  const flipCamera = useCallback(() => {
    const publication = localParticipant.getTrackPublication(Track.Source.Camera);
    const mediaStreamTrack = publication?.track?.mediaStreamTrack as
      { _switchCamera?: () => void } | undefined;
    if (!mediaStreamTrack?._switchCamera) return;
    mediaStreamTrack._switchCamera();
    call.setFrontCamera(!call.isFrontCamera);
  }, [call, localParticipant]);

  const controls: RoomControls = {
    toggleMute,
    toggleSpeaker,
    toggleCamera,
    flipCamera,
  };
  const roomState: CallRoomState = {
    localParticipant,
    remoteParticipants,
    speakingParticipants,
    tracks: trackReferences,
    isReconnecting: connectionState === ConnectionState.Reconnecting,
    networkPoor:
      localParticipant.connectionQuality === ConnectionQuality.Poor ||
      localParticipant.connectionQuality === ConnectionQuality.Lost,
  };
  return call.isMinimized ? (
    <CallPipBubble roomState={roomState} session={session} />
  ) : (
    <CallModal controls={controls} roomState={roomState} session={session} />
  );
}

interface RoomControls {
  toggleMute(): Promise<void>;
  toggleSpeaker(): Promise<void>;
  toggleCamera(): Promise<void>;
  flipCamera(): void;
}

interface CallRoomState {
  localParticipant: Participant;
  remoteParticipants: Participant[];
  speakingParticipants: Participant[];
  tracks: TrackReference[];
  isReconnecting: boolean;
  networkPoor: boolean;
}

function useMediaRecoveryAfterInterruption({
  call,
  connectionState,
  localParticipant,
  session,
  t,
}: {
  call: ReturnType<typeof useCall>;
  connectionState: ConnectionState;
  localParticipant: ReturnType<typeof useLocalParticipant>["localParticipant"];
  session: CallSession;
  t: (key: string, ...args: (string | number)[]) => string;
}) {
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryGenerationRef = useRef(0);
  const activeSessionIdRef = useRef(session.id);
  const previousConnectionStateRef = useRef(connectionState);
  const previousAppStateRef = useRef(AppState.currentState);
  const desiredMediaRef = useRef({
    muted: call.isMuted,
    cameraEnabled: call.isCameraEnabled,
    frontCamera: call.isFrontCamera,
  });
  useLayoutEffect(() => {
    activeSessionIdRef.current = session.id;
    desiredMediaRef.current = {
      muted: call.isMuted,
      cameraEnabled: call.isCameraEnabled,
      frontCamera: call.isFrontCamera,
    };
  }, [call.isCameraEnabled, call.isFrontCamera, call.isMuted, session.id]);

  const scheduleRecovery = useCallback(() => {
    recoveryGenerationRef.current += 1;
    const generation = recoveryGenerationRef.current;
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = setTimeout(() => {
      recoveryTimerRef.current = null;
      const isCurrent = () =>
        recoveryGenerationRef.current === generation &&
        activeSessionIdRef.current === session.id &&
        call.session?.id === session.id;
      void (async () => {
        if (!isCurrent()) return;
        const microphonePublication = localParticipant.getTrackPublication(Track.Source.Microphone);
        if (!desiredMediaRef.current.muted && !microphonePublication?.track) {
          const restored = await retryCallMediaPublication(
            () => localParticipant.setMicrophoneEnabled(true),
            isCurrent,
          );
          if (!restored && isCurrent() && !desiredMediaRef.current.muted) {
            call.setMuted(true);
            call.showError(t("call.error.microphoneUnavailable"));
          }
        }
        if (!isCurrent()) return;
        const cameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
        if (
          session.call_type === "video" &&
          desiredMediaRef.current.cameraEnabled &&
          !cameraPublication?.track
        ) {
          try {
            await localParticipant.setCameraEnabled(true, {
              facingMode: desiredMediaRef.current.frontCamera ? "user" : "environment",
              resolution: CALL_VIDEO_CAPTURE_OPTIONS.resolution,
            });
          } catch {
            if (isCurrent() && desiredMediaRef.current.cameraEnabled) {
              call.setCameraEnabled(false);
              call.showError(t("call.error.cameraUnavailable"));
            }
          }
        }
      })();
    }, 1_500);
  }, [call, localParticipant, session.call_type, session.id, t]);

  useEffect(() => {
    const previous = previousConnectionStateRef.current;
    previousConnectionStateRef.current = connectionState;
    if (
      previous === ConnectionState.Reconnecting &&
      connectionState === ConnectionState.Connected
    ) {
      scheduleRecovery();
    }
  }, [connectionState, scheduleRecovery]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previous = previousAppStateRef.current;
      previousAppStateRef.current = nextState;
      if (
        nextState === "active" &&
        previous !== "active" &&
        connectionState === ConnectionState.Connected
      ) {
        scheduleRecovery();
      }
    });
    return () => subscription.remove();
  }, [connectionState, scheduleRecovery]);

  useEffect(
    () => () => {
      activeSessionIdRef.current = "";
      recoveryGenerationRef.current += 1;
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    },
    [session.id],
  );
}

function CallModal({
  session,
  roomState,
  controls,
}: {
  session: CallSession;
  roomState?: CallRoomState | undefined;
  controls?: RoomControls | undefined;
}) {
  const call = useCall();
  const duration = useCallDuration(session);
  const connectedGroup = session.group_id !== undefined && session.state === "connected";
  return (
    <Modal
      animationType="slide"
      onRequestClose={call.minimizeCall}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible
    >
      {connectedGroup ? (
        <GroupCallStage
          controls={controls}
          duration={duration}
          roomState={roomState}
          session={session}
        />
      ) : (
        <DirectCallStage
          controls={controls}
          duration={duration}
          onSwap={() => call.setRemotePrimary(!call.isRemotePrimary)}
          remotePrimary={call.isRemotePrimary}
          roomState={roomState}
          session={session}
        />
      )}
    </Modal>
  );
}

function DirectCallStage({
  session,
  roomState,
  controls,
  duration,
  remotePrimary,
  onSwap,
}: {
  session: CallSession;
  roomState?: CallRoomState | undefined;
  controls?: RoomControls | undefined;
  duration: number;
  remotePrimary: boolean;
  onSwap(): void;
}) {
  const call = useCall();
  const { user } = useAuth();
  const { t } = useLocalization();
  const [showsRoleIntroduction, setShowsRoleIntroduction] = useState(
    Boolean(session.is_live_pair && session.live_role_setting),
  );
  const localTrack = roomState?.tracks.find((track) => track.participant.isLocal);
  const remoteTrack = roomState?.tracks.find((track) => !track.participant.isLocal);
  const isConnectedVideo = session.call_type === "video" && session.state === "connected";
  const primaryTrack = remotePrimary ? remoteTrack : localTrack;
  const secondaryTrack = remotePrimary ? localTrack : remoteTrack;
  const primaryIsLocal = !remotePrimary;
  const secondaryIsLocal = remotePrimary;
  const primaryMuted = primaryIsLocal
    ? call.isMuted
    : isParticipantMuted(roomState?.remoteParticipants[0]);
  const secondaryMuted = secondaryIsLocal
    ? call.isMuted
    : isParticipantMuted(roomState?.remoteParticipants[0]);
  const localAvatarUrl = user?.avatar_url ?? "";

  return (
    <View style={styles.callRoot}>
      {session.call_type === "video" ? (
        isConnectedVideo ? (
          <View style={StyleSheet.absoluteFill}>
            {primaryTrack && (!primaryIsLocal || call.isCameraEnabled) ? (
              <VideoTrack
                mirror={primaryIsLocal && call.isFrontCamera}
                objectFit="cover"
                style={StyleSheet.absoluteFill}
                trackRef={primaryTrack}
                zOrder={0}
              />
            ) : (
              <AvatarStage
                avatarUrl={primaryIsLocal ? localAvatarUrl : session.remote_avatar_url}
                name={primaryIsLocal ? t("common.me") : session.remote_nickname}
                size={190}
              />
            )}
            {primaryMuted ? (
              <View style={styles.primaryMutePosition}>
                <MuteBadge name={primaryIsLocal ? t("common.me") : session.remote_nickname} />
              </View>
            ) : null}
            <Pressable
              accessibilityLabel={t("call.video.swap")}
              onPress={onSwap}
              style={styles.secondaryVideo}
            >
              {secondaryTrack && (!secondaryIsLocal || call.isCameraEnabled) ? (
                <VideoTrack
                  mirror={secondaryIsLocal && call.isFrontCamera}
                  objectFit="cover"
                  style={StyleSheet.absoluteFill}
                  trackRef={secondaryTrack}
                  zOrder={1}
                />
              ) : (
                <VideoAvatarPlaceholder
                  avatarUrl={secondaryIsLocal ? localAvatarUrl : session.remote_avatar_url}
                  name={secondaryIsLocal ? t("common.me") : session.remote_nickname}
                />
              )}
              {secondaryMuted ? (
                <View style={styles.pipMute}>
                  <MuteBadge />
                </View>
              ) : null}
            </Pressable>
          </View>
        ) : localTrack && session.is_outgoing && call.isCameraEnabled ? (
          <VideoTrack
            mirror={call.isFrontCamera}
            objectFit="cover"
            style={StyleSheet.absoluteFill}
            trackRef={localTrack}
          />
        ) : (
          <DarkStage />
        )
      ) : (
        <DarkStage />
      )}

      <View style={styles.directOverlay}>
        <View style={styles.directMinimizeRow}>
          <CircleSymbolButton
            accessibilityLabel="call.minimize"
            background="rgba(255,255,255,0.15)"
            diameter={40}
            onPress={call.minimizeCall}
            symbol="arrow.down.right.and.arrow.up.left"
            symbolSize={16}
          />
        </View>
        <View style={{ height: 20 }} />
        {session.call_type !== "video" || session.state !== "connected" ? (
          <View style={styles.identityBlock}>
            {session.group_id !== undefined ? (
              <GroupFallbackAvatar size={100} />
            ) : (
              <View style={styles.identityAvatarShadow}>
                <Avatar
                  cornerRadius={999}
                  name={session.remote_nickname}
                  size={session.call_type === "voice" && session.state === "connected" ? 156 : 100}
                  uri={session.remote_avatar_url}
                />
              </View>
            )}
            <Text style={styles.callName}>{session.group_name ?? session.remote_nickname}</Text>
            {!session.is_live_pair || session.state !== "connected" ? (
              <StatusText duration={duration} roomState={roomState} session={session} />
            ) : null}
            {session.group_id !== undefined && session.state === "connected" ? (
              <Text style={styles.groupCount}>
                {t("call.participants.count", (roomState?.remoteParticipants.length ?? 0) + 1)}
              </Text>
            ) : null}
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        {session.is_live_pair && session.state === "connected" ? (
          <View pointerEvents="none" style={styles.liveStatusBlock}>
            <StatusText duration={duration} roomState={roomState} session={session} />
            <LiveBillingBadge duration={duration} session={session} />
          </View>
        ) : null}
        {session.state === "incoming" ? (
          <View style={styles.incomingRow}>
            <LabeledCallButton
              accessibilityLabel="call.reject"
              background="#FF3B30"
              diameter={76}
              label={t("call.decline")}
              onPress={call.rejectCall}
              symbol="phone.down.fill"
              symbolSize={31}
            />
            <LabeledCallButton
              accessibilityLabel="call.accept"
              background="#34C759"
              diameter={76}
              label={t("call.answer")}
              onPress={() => void call.acceptCall()}
              symbol="phone.fill"
              symbolSize={31}
            />
          </View>
        ) : (
          <DirectControlBar controls={controls} session={session} />
        )}
        <View style={{ height: 50 }} />
      </View>
      {showsRoleIntroduction && session.state === "connected" && session.live_role_setting ? (
        <LiveRoleIntroductionCard
          isOutgoing={session.is_outgoing}
          onDismiss={() => setShowsRoleIntroduction(false)}
          roleSetting={session.live_role_setting}
        />
      ) : null}
      {session.live_ending_message ? (
        <LiveGracefulEndingCard
          detail={session.live_ending_detail}
          message={session.live_ending_message}
        />
      ) : null}
    </View>
  );
}

function LiveBillingBadge({ session, duration }: { session: CallSession; duration: number }) {
  const { t } = useLocalization();
  const policy = liveBillingPolicyOrFallback(session.live_billing_policy);
  const experience = session.live_experience;
  const experienceRemaining = experience
    ? liveExperienceRemainingSeconds(experience, duration)
    : undefined;
  const projected = experience
    ? liveExperienceAccruedOverageAmount(experience, policy, duration)
    : liveBillingAccruedAmount(policy, duration);
  const freeRemaining = liveBillingFreeSecondsRemaining(policy, duration);
  const endingSoon =
    experienceRemaining !== undefined && experienceRemaining > 0 && experienceRemaining <= 60;
  const lines: string[] = [];
  if (experienceRemaining !== undefined && experienceRemaining > 0) {
    lines.push(
      t(
        session.is_outgoing ? "live.experience.remaining.viewer" : "live.experience.remaining.host",
        formatCallDuration(experienceRemaining),
      ),
    );
  } else if (session.is_outgoing) {
    if (freeRemaining > 0)
      lines.push(
        experience
          ? t("live.experience.overage.viewer")
          : t("live.billing.freePayer", freeRemaining),
      );
    else if (session.confirmed_live_total_charge !== undefined) {
      if ((session.confirmed_live_activity_cat_food_charge ?? 0) > 0)
        lines.push(
          t(
            "live.billing.chargedActivityCatFood",
            session.confirmed_live_activity_cat_food_charge!,
          ),
        );
      if ((session.confirmed_live_gold_coin_charge ?? 0) > 0)
        lines.push(t("live.billing.chargedGoldCoins", session.confirmed_live_gold_coin_charge!));
      lines.push(t("live.billing.totalCharged", session.confirmed_live_total_charge));
    } else if (projected > 0) lines.push(t("live.billing.estimatedSpendable", projected));
    else lines.push(t("live.experience.overage.viewer"));
  } else if (freeRemaining > 0 && !experience)
    lines.push(t("live.billing.freeHost", freeRemaining));
  else if (session.confirmed_live_earning_gold_coins !== undefined)
    lines.push(t("live.billing.earnedGoldCoins", session.confirmed_live_earning_gold_coins));
  else if (projected > 0) lines.push(t("live.billing.estimatedEarning", projected));
  else lines.push(t("live.experience.overage.host"));
  return (
    <View
      accessibilityLabel={lines.join("，")}
      style={[styles.liveBillingBadge, endingSoon && styles.liveBillingEndingSoon]}
    >
      <SymbolView
        name={experience ? "ticket.fill" : "pawprint.fill"}
        size={12}
        tintColor="#FFFFFF"
      />
      <View>
        {lines.map((line, index) => (
          <Text key={`${index}-${line}`} style={styles.liveBillingText}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

function LiveRoleIntroductionCard({
  roleSetting,
  isOutgoing,
  onDismiss,
}: {
  roleSetting: string;
  isOutgoing: boolean;
  onDismiss(): void;
}) {
  return (
    <View style={styles.liveRoleBackdrop}>
      <View style={styles.liveRoleCard}>
        <View style={styles.liveRoleHeader}>
          <SymbolView name="theatermasks.fill" size={22} weight="semibold" tintColor="#667EEA" />
          <View style={styles.liveRoleHeading}>
            <Text style={styles.liveRoleEyebrow}>本次直播角色</Text>
            <Text style={styles.liveRoleTitle}>{isOutgoing ? "对方正在扮演" : "我正在扮演"}</Text>
          </View>
          <Pressable
            accessibilityLabel="关闭角色介绍"
            onPress={onDismiss}
            style={styles.liveRoleClose}
          >
            <SymbolView name="xmark" size={13} weight="bold" tintColor="#9E9EB8" />
          </Pressable>
        </View>
        <ScrollView style={styles.liveRoleScroll}>
          <Text style={styles.liveRoleDetail}>{roleSetting}</Text>
        </ScrollView>
        <Pressable onPress={onDismiss} style={styles.liveRoleConfirm}>
          <LinearGradient
            colors={["#667EEA", "#764BA2"]}
            end={{ x: 1, y: 1 }}
            start={{ x: 0, y: 0 }}
            style={styles.liveRoleConfirmFill}
          >
            <Text style={styles.liveRoleConfirmText}>我知道了</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

function LiveGracefulEndingCard({
  message,
  detail,
}: {
  message: string;
  detail?: string | undefined;
}) {
  return (
    <View
      accessibilityLabel={[message, detail, "正在为你结束本次视频"].filter(Boolean).join("，")}
      style={styles.liveEndingBackdrop}
    >
      <View style={styles.liveEndingCard}>
        <View style={styles.liveEndingIcon}>
          <SymbolView name="pawprint.fill" size={28} weight="semibold" tintColor="#667EEA" />
        </View>
        <Text style={styles.liveEndingMessage}>{message}</Text>
        {detail ? <Text style={styles.liveEndingDetail}>{detail}</Text> : null}
        <Text style={styles.liveEndingProgressText}>正在为你结束本次视频</Text>
        <ActivityIndicator color="#667EEA" size="small" />
      </View>
    </View>
  );
}

function GroupCallStage({
  session,
  roomState,
  controls,
  duration,
}: {
  session: CallSession;
  roomState?: CallRoomState | undefined;
  controls?: RoomControls | undefined;
  duration: number;
}) {
  const call = useCall();
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const allParticipants = roomState
    ? [roomState.localParticipant, ...roomState.remoteParticipants]
    : [];
  const speakingIds = new Set(roomState?.speakingParticipants.map(participantId) ?? []);
  const localName = t("common.me");
  return (
    <View style={styles.groupRoot}>
      <View style={[styles.groupHeader, { paddingTop: insets.top + 16 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.groupTitle}>{session.group_name ?? t("call.groupCall")}</Text>
          <Text style={styles.groupSubtitle}>
            {t("call.participants.count", allParticipants.length || 1)} ·{" "}
            {formatCallDuration(duration)}
          </Text>
          {roomState?.isReconnecting ? (
            <StatusBadge symbol="arrow.triangle.2.circlepath" text={t("call.reconnecting")} />
          ) : roomState?.networkPoor ? (
            <StatusBadge symbol="wifi.exclamationmark" text={t("call.networkPoor")} />
          ) : null}
        </View>
        <CircleSymbolButton
          accessibilityLabel="call.minimize"
          background="rgba(255,255,255,0.15)"
          diameter={36}
          onPress={call.minimizeCall}
          symbol="arrow.down.right.and.arrow.up.left"
          symbolSize={14}
        />
      </View>
      <ScrollView
        contentContainerStyle={session.call_type === "video" ? styles.videoGrid : styles.voiceGrid}
      >
        {allParticipants.length > 0
          ? allParticipants.map((participant) => {
              const local = participant.isLocal;
              const name = local ? localName : participantName(participant);
              const track = roomState?.tracks.find(
                (item) => participantId(item.participant) === participantId(participant),
              );
              const muted = local ? call.isMuted : isParticipantMuted(participant);
              const speaking = speakingIds.has(participantId(participant));
              const hasActiveVideoTrack = Boolean(
                track?.publication.track && !track.publication.isMuted,
              );
              return session.call_type === "video" ? (
                <GroupVideoParticipant
                  cameraEnabled={hasActiveVideoTrack && (!local || call.isCameraEnabled)}
                  key={participantId(participant)}
                  muted={muted}
                  name={name}
                  speaking={speaking}
                  track={hasActiveVideoTrack ? track : undefined}
                  mirrorsVideo={local && call.isFrontCamera}
                />
              ) : (
                <GroupVoiceParticipant
                  key={participantId(participant)}
                  muted={muted}
                  name={name}
                  speaking={speaking}
                />
              );
            })
          : null}
      </ScrollView>
      <GroupControlBar bottomInset={insets.bottom} controls={controls} session={session} />
    </View>
  );
}

function DirectControlBar({
  controls,
  session,
}: {
  controls?: RoomControls | undefined;
  session: CallSession;
}) {
  const call = useCall();
  const { t } = useLocalization();
  if (session.call_type === "video") {
    return (
      <View style={styles.videoControls}>
        <ControlButton
          accessibilityLabel="call.mute"
          active={call.isMuted}
          diameter={50}
          label={call.isMuted ? t("call.unmute") : t("call.mute")}
          onPress={() => void controls?.toggleMute()}
          symbol={call.isMuted ? "mic.slash.fill" : "mic.fill"}
        />
        <ControlButton
          accessibilityLabel="call.speaker"
          active={call.isSpeakerOn}
          diameter={50}
          label={call.isSpeakerOn ? t("call.speaker") : t("call.earpiece")}
          onPress={() => {
            if (controls) void controls.toggleSpeaker();
            else call.setSpeakerOn(!call.isSpeakerOn);
          }}
          symbol={call.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.slash.fill"}
        />
        <ControlButton
          accessibilityLabel="call.camera"
          active={!call.isCameraEnabled}
          diameter={50}
          label={call.isCameraEnabled ? t("call.cameraOff") : t("call.cameraOn")}
          onPress={() => void controls?.toggleCamera()}
          symbol={call.isCameraEnabled ? "video.fill" : "video.slash.fill"}
        />
        <ControlButton
          accessibilityLabel="call.end"
          background="#FF3B30"
          diameter={54}
          label={t("call.hangUp")}
          onPress={call.endCall}
          symbol="phone.down.fill"
        />
        <ControlButton
          accessibilityLabel="call.flip"
          diameter={50}
          label={t("call.flip")}
          onPress={controls?.flipCamera}
          symbol="camera.rotate.fill"
        />
      </View>
    );
  }
  return (
    <View style={styles.voiceControls}>
      <ControlButton
        accessibilityLabel="call.mute"
        active={call.isMuted}
        diameter={68}
        label={call.isMuted ? t("call.unmute") : t("call.mute")}
        onPress={() => void controls?.toggleMute()}
        symbol={call.isMuted ? "mic.slash.fill" : "mic.fill"}
      />
      <ControlButton
        accessibilityLabel="call.speaker"
        active={call.isSpeakerOn}
        diameter={68}
        label={call.isSpeakerOn ? t("call.speaker") : t("call.earpiece")}
        onPress={() => {
          if (controls) void controls.toggleSpeaker();
          else call.setSpeakerOn(!call.isSpeakerOn);
        }}
        symbol={call.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.slash.fill"}
      />
      <ControlButton
        accessibilityLabel="call.end"
        background="#FF3B30"
        diameter={68}
        label={t("call.hangUp")}
        onPress={call.endCall}
        symbol="phone.down.fill"
      />
    </View>
  );
}

function GroupControlBar({
  bottomInset,
  controls,
  session,
}: {
  bottomInset: number;
  controls?: RoomControls | undefined;
  session: CallSession;
}) {
  const call = useCall();
  if (session.call_type === "video") {
    return (
      <View style={[styles.groupVideoControlWrap, { paddingBottom: bottomInset + 40 }]}>
        <View style={styles.groupControlRow}>
          <BareControl
            accessibilityLabel="call.mute"
            active={call.isMuted}
            diameter={64}
            onPress={() => void controls?.toggleMute()}
            symbol={call.isMuted ? "mic.slash.fill" : "mic.fill"}
          />
          <BareControl
            accessibilityLabel="call.speaker"
            active={call.isSpeakerOn}
            diameter={64}
            onPress={() => {
              if (controls) void controls.toggleSpeaker();
              else call.setSpeakerOn(!call.isSpeakerOn);
            }}
            symbol={call.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.slash.fill"}
          />
          <BareControl
            accessibilityLabel="call.camera"
            active={!call.isCameraEnabled}
            diameter={64}
            onPress={() => void controls?.toggleCamera()}
            symbol={call.isCameraEnabled ? "video.fill" : "video.slash.fill"}
          />
        </View>
        <View style={styles.groupControlRow}>
          <View style={{ width: 64, height: 68 }} />
          <BareControl
            accessibilityLabel="call.end"
            background="#FF3B30"
            diameter={68}
            onPress={call.endCall}
            symbol="phone.down.fill"
          />
          <BareControl
            accessibilityLabel="call.flip"
            diameter={64}
            onPress={controls?.flipCamera}
            symbol="camera.rotate.fill"
          />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.groupVoiceControls, { paddingBottom: bottomInset + 40 }]}>
      <BareControl
        accessibilityLabel="call.mute"
        active={call.isMuted}
        diameter={68}
        onPress={() => void controls?.toggleMute()}
        symbol={call.isMuted ? "mic.slash.fill" : "mic.fill"}
      />
      <BareControl
        accessibilityLabel="call.speaker"
        active={call.isSpeakerOn}
        diameter={68}
        onPress={() => {
          if (controls) void controls.toggleSpeaker();
          else call.setSpeakerOn(!call.isSpeakerOn);
        }}
        symbol={call.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.slash.fill"}
      />
      <BareControl
        accessibilityLabel="call.end"
        background="#FF3B30"
        diameter={68}
        onPress={call.endCall}
        symbol="phone.down.fill"
      />
    </View>
  );
}

function StatusText({
  session,
  duration,
  roomState,
}: {
  session: CallSession;
  duration: number;
  roomState?: CallRoomState | undefined;
}) {
  const { t } = useLocalization();
  if (session.state === "outgoing")
    return <Text style={styles.callStatus}>{t("call.calling")}</Text>;
  if (session.state === "incoming") {
    const key =
      session.group_id !== undefined
        ? session.call_type === "voice"
          ? "call.groupVoiceInvite"
          : "call.groupVideoInvite"
        : session.call_type === "voice"
          ? "call.voiceIncoming"
          : "call.videoIncoming";
    return <Text style={styles.callStatus}>{t(key)}</Text>;
  }
  if (session.state === "connecting")
    return <Text style={styles.callStatus}>{t("call.connecting")}</Text>;
  if (session.state === "connected") {
    return (
      <View style={styles.connectedStatus}>
        <Text style={roomState?.isReconnecting ? styles.reconnectingText : styles.durationText}>
          {roomState?.isReconnecting ? t("call.reconnecting") : formatCallDuration(duration)}
        </Text>
        {roomState?.networkPoor ? (
          <StatusBadge symbol="wifi.exclamationmark" text={t("call.networkPoor")} />
        ) : null}
      </View>
    );
  }
  return null;
}

function CallPipBubble({
  session,
  roomState,
}: {
  session: CallSession;
  roomState?: CallRoomState | undefined;
}) {
  const call = useCall();
  const [hidden, setHidden] = useState(false);
  const [leftEdge, setLeftEdge] = useState(false);
  const [edgeTop, setEdgeTop] = useState(132);
  const duration = useCallDuration(session);
  const screen = Dimensions.get("window");
  const size =
    session.call_type === "voice" ? { width: 60, height: 60 } : { width: 120, height: 170 };
  const [position] = useState(
    () =>
      new Animated.ValueXY({
        x: screen.width - size.width - 6,
        y: session.call_type === "voice" ? 130 : 75,
      }),
  );
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) + Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => position.extractOffset(),
        onPanResponderMove: Animated.event([null, { dx: position.x, dy: position.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, gesture) => {
          position.flattenOffset();
          const x = gesture.moveX < screen.width / 2 ? 6 : screen.width - size.width - 6;
          const y = Math.max(
            40,
            Math.min(gesture.moveY - size.height / 2, screen.height - size.height - 40),
          );
          setLeftEdge(x === 6);
          setEdgeTop(Math.max(50, Math.min(gesture.moveY - 28, screen.height - 86)));
          Animated.spring(position, { toValue: { x, y }, useNativeDriver: false }).start();
        },
      }),
    [position, screen.height, screen.width, size.height, size.width],
  );
  const localTrack = roomState?.tracks.find((track) => track.participant.isLocal);
  const remoteTrack = roomState?.tracks.find((track) => !track.participant.isLocal);
  const videoTrack = call.isRemotePrimary ? localTrack : remoteTrack;

  if (hidden) {
    return (
      <View pointerEvents="box-none" style={styles.pipOverlay}>
        <Pressable
          accessibilityLabel="call.pip.show"
          onPress={() => setHidden(false)}
          style={[
            styles.edgeRestore,
            { top: edgeTop },
            leftEdge ? styles.edgeLeft : styles.edgeRight,
          ]}
        >
          <LinearGradient
            colors={session.call_type === "voice" ? ["#34C759", "#30B350"] : ["#5856D6", "#764BA2"]}
            style={styles.edgeRestoreFill}
          >
            <SymbolView
              name={leftEdge ? "chevron.right" : "chevron.left"}
              size={14}
              tintColor="#FFFFFF"
            />
          </LinearGradient>
        </Pressable>
      </View>
    );
  }
  return (
    <View pointerEvents="box-none" style={styles.pipOverlay}>
      <Animated.View
        style={[styles.pipPosition, size, position.getLayout()]}
        {...panResponder.panHandlers}
      >
        <Pressable
          accessibilityLabel="call.restore"
          onPress={call.restoreCall}
          style={styles.pipContent}
        >
          {session.call_type === "video" ? (
            videoTrack ? (
              <VideoTrack
                mirror={videoTrack.participant.isLocal && call.isFrontCamera}
                objectFit="cover"
                style={StyleSheet.absoluteFill}
                trackRef={videoTrack}
              />
            ) : (
              <LinearGradient colors={["#5856D6", "#764BA2"]} style={StyleSheet.absoluteFill} />
            )
          ) : (
            <LinearGradient colors={["#34C759", "#30B350"]} style={StyleSheet.absoluteFill} />
          )}
          <View style={styles.pipCenter}>
            {session.call_type === "voice" ? (
              <SymbolView name="phone.fill" size={20} tintColor="#FFFFFF" />
            ) : !videoTrack ? (
              <SymbolView name="video.fill" size={22} tintColor="#FFFFFF" />
            ) : null}
            {session.state === "connected" ? (
              <Text
                style={
                  session.call_type === "voice" ? styles.voicePipDuration : styles.videoPipDuration
                }
              >
                {formatCallDuration(duration)}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          accessibilityLabel="call.pip.hide"
          onPress={() => setHidden(true)}
          style={session.call_type === "voice" ? styles.pipHideVoice : styles.pipHideVideo}
        >
          <SymbolView
            name="minus"
            size={session.call_type === "voice" ? 8 : 10}
            weight="bold"
            tintColor="#FFFFFF"
          />
        </Pressable>
      </Animated.View>
    </View>
  );
}

function GroupVideoParticipant({
  name,
  track,
  muted,
  speaking,
  cameraEnabled,
  mirrorsVideo,
}: {
  name: string;
  track?: TrackReference | undefined;
  muted: boolean;
  speaking: boolean;
  cameraEnabled: boolean;
  mirrorsVideo: boolean;
}) {
  const { t } = useLocalization();
  return (
    <View
      accessible
      accessibilityLabel={[
        name,
        !cameraEnabled ? t("call.cameraDisabled") : "",
        muted ? t("call.muted") : "",
      ]
        .filter(Boolean)
        .join(", ")}
      style={[styles.groupVideoCell, speaking && styles.speakingBorder]}
    >
      {track && cameraEnabled ? (
        <VideoTrack
          mirror={mirrorsVideo}
          objectFit="cover"
          style={StyleSheet.absoluteFill}
          trackRef={track}
        />
      ) : (
        <View style={styles.videoPlaceholder}>
          <Initial name={name} size={72} />
        </View>
      )}
      <View style={styles.participantLabel}>
        {muted ? (
          <MuteBadge name={name} />
        ) : (
          <Text numberOfLines={1} style={styles.participantName}>
            {name}
          </Text>
        )}
      </View>
    </View>
  );
}

function GroupVoiceParticipant({
  name,
  muted,
  speaking,
}: {
  name: string;
  muted: boolean;
  speaking: boolean;
}) {
  const { t } = useLocalization();
  return (
    <View
      accessible
      accessibilityLabel={muted ? `${name}, ${t("call.muted")}` : name}
      style={styles.groupVoiceCell}
    >
      <View style={[styles.voiceAvatar, speaking && styles.speakingBorder]}>
        <Initial name={name} size={64} />
        {muted ? (
          <View style={styles.voiceMutedDot}>
            <SymbolView name="mic.slash.fill" size={11} tintColor="#FFFFFF" />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.voiceParticipantName}>
        {name}
      </Text>
    </View>
  );
}

function ControlButton({
  symbol,
  label,
  accessibilityLabel,
  diameter,
  onPress,
  active = false,
  background,
}: {
  symbol: SFSymbol;
  label: string;
  accessibilityLabel?: string | undefined;
  diameter: number;
  onPress?: (() => void) | undefined;
  active?: boolean;
  background?: string;
}) {
  return (
    <View style={{ width: diameter, alignItems: "center", gap: 6 }}>
      <CircleSymbolButton
        {...(accessibilityLabel ? { accessibilityLabel } : {})}
        {...(onPress ? { onPress } : {})}
        background={background ?? (active ? "#FFFFFF" : "rgba(255,255,255,0.2)")}
        diameter={diameter}
        symbol={symbol}
        symbolColor={active && !background ? "#000000" : "#FFFFFF"}
        symbolSize={diameter * 0.4}
      />
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.68}
        numberOfLines={1}
        style={styles.controlLabel}
      >
        {label}
      </Text>
    </View>
  );
}

function BareControl({
  symbol,
  diameter,
  accessibilityLabel,
  onPress,
  active = false,
  background,
}: {
  symbol: SFSymbol;
  diameter: number;
  accessibilityLabel?: string | undefined;
  onPress?: (() => void) | undefined;
  active?: boolean;
  background?: string;
}) {
  return (
    <CircleSymbolButton
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      {...(onPress ? { onPress } : {})}
      background={background ?? (active ? "#FFFFFF" : "rgba(255,255,255,0.2)")}
      diameter={diameter}
      symbol={symbol}
      symbolColor={active && !background ? "#000000" : "#FFFFFF"}
      symbolSize={diameter * 0.4}
    />
  );
}

function LabeledCallButton({
  symbol,
  label,
  accessibilityLabel,
  diameter,
  symbolSize,
  background,
  onPress,
}: {
  symbol: SFSymbol;
  label: string;
  accessibilityLabel?: string | undefined;
  diameter: number;
  symbolSize: number;
  background: string;
  onPress(): void;
}) {
  return (
    <View style={styles.incomingButtonWrap}>
      <CircleSymbolButton
        {...(accessibilityLabel ? { accessibilityLabel } : {})}
        background={background}
        diameter={diameter}
        onPress={onPress}
        symbol={symbol}
        symbolSize={symbolSize}
      />
      <Text style={styles.incomingLabel}>{label}</Text>
    </View>
  );
}

function CircleSymbolButton({
  symbol,
  diameter,
  symbolSize,
  onPress,
  background,
  symbolColor = "#FFFFFF",
  accessibilityLabel,
}: {
  symbol: SFSymbol;
  diameter: number;
  symbolSize: number;
  onPress?: (() => void) | undefined;
  background: string;
  symbolColor?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: background,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <SymbolView name={symbol} size={symbolSize} tintColor={symbolColor} />
    </Pressable>
  );
}

function StatusBadge({ symbol, text }: { symbol: SFSymbol; text: string }) {
  return (
    <View style={styles.statusBadge}>
      <SymbolView name={symbol} size={12} tintColor="#FF9500" />
      <Text style={styles.statusBadgeText}>{text}</Text>
    </View>
  );
}

function MuteBadge({ name }: { name?: string }) {
  const { t } = useLocalization();
  return (
    <View style={styles.muteBadge}>
      <SymbolView name="mic.slash.fill" size={11} tintColor="#FFFFFF" />
      <Text numberOfLines={1} style={styles.muteBadgeText}>
        {name ? `${name} · ${t("call.muted")}` : t("call.muted")}
      </Text>
    </View>
  );
}

function DarkStage() {
  return (
    <LinearGradient
      colors={["#171923", "#101522", "#000000"]}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

function AvatarStage({ avatarUrl, name, size }: { avatarUrl: string; name: string; size: number }) {
  return (
    <View style={styles.avatarStage}>
      <DarkStage />
      <View style={styles.primaryAvatarShadow}>
        <Avatar name={name} size={size} uri={avatarUrl} />
      </View>
    </View>
  );
}

function VideoAvatarPlaceholder({ avatarUrl, name }: { avatarUrl: string; name: string }) {
  return (
    <View style={styles.videoAvatarPlaceholder}>
      <View style={styles.secondaryAvatarShadow}>
        <Avatar name={name} size={92} uri={avatarUrl} />
      </View>
    </View>
  );
}

function GroupFallbackAvatar({ size }: { size: number }) {
  return (
    <LinearGradient
      colors={["#667EEA", "#764BA2"]}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <SymbolView name="person.3.fill" size={size * 0.45} tintColor="rgba(255,255,255,0.85)" />
    </LinearGradient>
  );
}

function Initial({ name, size }: { name: string; size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "rgba(255,255,255,0.1)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "rgba(255,255,255,0.7)", fontWeight: "700", fontSize: size / 2 }}>
        {name.trim().slice(0, 1) || "B"}
      </Text>
    </View>
  );
}

function useCallDuration(session: CallSession): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (session.state !== "connected") return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [session.state]);
  return session.connected_at ? Math.max(0, (now - session.connected_at) / 1_000) : 0;
}

function participantId(participant: Participant): string {
  return String(participant.sid ?? participant.identity);
}

function participantSortKey(participant: Participant): string {
  return String(participant.identity ?? participant.sid);
}

function participantName(participant: Participant): string {
  return participant.name || String(participant.identity || participant.sid);
}

function isParticipantMuted(participant?: Participant): boolean {
  if (!participant) return false;
  const publication = participant.getTrackPublication(Track.Source.Microphone);
  return !publication || publication.isMuted;
}

const styles = StyleSheet.create({
  callRoot: { flex: 1, backgroundColor: "#000000" },
  directOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  directMinimizeRow: { paddingHorizontal: 16, paddingTop: 54, alignItems: "flex-start" },
  identityBlock: { alignItems: "center" },
  identityAvatarShadow: {
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.2,
    shadowRadius: 20,
  },
  callName: { color: "#FFFFFF", fontSize: 28, fontWeight: "600", marginTop: 20 },
  callStatus: { color: "rgba(255,255,255,0.7)", fontSize: 16, marginTop: 8 },
  groupCount: { color: "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 4 },
  connectedStatus: { marginTop: 8, alignItems: "center", gap: 5 },
  durationText: {
    color: "#34C759",
    fontSize: 18,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  reconnectingText: { color: "#FF9500", fontSize: 15, fontWeight: "500" },
  liveStatusBlock: { alignItems: "center", rowGap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  liveBillingBadge: {
    maxWidth: "94%",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.48)",
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
  },
  liveBillingEndingSoon: { backgroundColor: "rgba(255,149,0,0.82)" },
  liveBillingText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  liveRoleBackdrop: {
    position: "absolute",
    inset: 0,
    zIndex: 20,
    paddingHorizontal: 24,
    backgroundColor: "rgba(0,0,0,0.38)",
    alignItems: "center",
    justifyContent: "center",
  },
  liveRoleCard: {
    width: "100%",
    maxWidth: 340,
    padding: 20,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000000",
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    rowGap: 14,
  },
  liveRoleHeader: { flexDirection: "row", alignItems: "flex-start", columnGap: 12 },
  liveRoleHeading: { flex: 1, rowGap: 4 },
  liveRoleEyebrow: { color: "#9E9EB8", fontSize: 13, fontWeight: "500" },
  liveRoleTitle: { color: "#1A1A2E", fontSize: 20, fontWeight: "600" },
  liveRoleClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F2F2F7",
    alignItems: "center",
    justifyContent: "center",
  },
  liveRoleScroll: { maxHeight: 180 },
  liveRoleDetail: { color: "#1A1A2E", fontSize: 16, lineHeight: 24 },
  liveRoleConfirm: { height: 44, borderRadius: 12, overflow: "hidden" },
  liveRoleConfirmFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  liveRoleConfirmText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  liveEndingBackdrop: {
    position: "absolute",
    inset: 0,
    zIndex: 40,
    paddingHorizontal: 32,
    backgroundColor: "rgba(0,0,0,0.34)",
    alignItems: "center",
    justifyContent: "center",
  },
  liveEndingCard: {
    width: "100%",
    maxWidth: 310,
    paddingHorizontal: 24,
    paddingVertical: 22,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.94)",
    alignItems: "center",
    rowGap: 12,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  liveEndingIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "rgba(102,126,234,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  liveEndingMessage: { color: "#1A1A2E", fontSize: 18, fontWeight: "600", textAlign: "center" },
  liveEndingDetail: {
    color: "rgba(26,26,46,0.82)",
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
    textAlign: "center",
  },
  liveEndingProgressText: { color: "#9E9EB8", fontSize: 14 },
  incomingRow: { flexDirection: "row", justifyContent: "center", gap: 88 },
  incomingButtonWrap: { alignItems: "center", gap: 8 },
  incomingLabel: { color: "rgba(255,255,255,0.7)", fontSize: 13 },
  voiceControls: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 28 },
  videoControls: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  controlLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    width: "140%",
    textAlign: "center",
  },
  avatarStage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryAvatarShadow: {
    shadowColor: "#000000",
    shadowOpacity: 0.38,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
  },
  videoAvatarPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2A2A3E",
  },
  secondaryAvatarShadow: {
    shadowColor: "#000000",
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  secondaryVideo: {
    position: "absolute",
    width: 110,
    height: 150,
    top: 60,
    right: 16,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#2A2A3E",
    shadowColor: "#000000",
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  primaryMutePosition: { position: "absolute", left: 16, bottom: 160 },
  pipMute: { position: "absolute", left: 5, bottom: 5 },
  muteBadge: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 5,
    backgroundColor: "rgba(255,59,48,0.88)",
    borderRadius: 999,
  },
  muteBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "600", maxWidth: 120 },
  statusBadge: { flexDirection: "row", gap: 4, alignItems: "center", marginTop: 3 },
  statusBadgeText: { color: "#FF9500", fontSize: 12, fontWeight: "500" },
  groupRoot: { flex: 1, backgroundColor: "#000000" },
  groupHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  groupTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "600" },
  groupSubtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  videoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    paddingHorizontal: 4,
    paddingBottom: 20,
  },
  voiceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 20,
  },
  groupVideoCell: {
    width: "49%",
    aspectRatio: 3 / 4,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#2A2A3E",
    borderWidth: 3,
    borderColor: "transparent",
  },
  speakingBorder: { borderColor: "#34C759" },
  videoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2A2A3E",
  },
  participantLabel: { position: "absolute", left: 4, bottom: 4 },
  participantName: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "500",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.5)",
    maxWidth: 130,
  },
  groupVoiceCell: { width: "47%", alignItems: "center", gap: 8, paddingVertical: 8 },
  voiceAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "transparent",
  },
  voiceMutedDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: "#FF3B30",
    alignItems: "center",
    justifyContent: "center",
  },
  voiceParticipantName: { color: "rgba(255,255,255,0.8)", fontSize: 12, maxWidth: 130 },
  groupVideoControlWrap: { gap: 20, paddingHorizontal: 28 },
  groupControlRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  groupVoiceControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 28,
  },
  pipOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 200,
    elevation: 30,
  },
  pipPosition: {
    position: "absolute",
    borderRadius: 14,
    overflow: "visible",
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  pipContent: {
    flex: 1,
    borderRadius: 14,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  pipCenter: { alignItems: "center", gap: 2 },
  voicePipDuration: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 9,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  videoPipDuration: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pipHideVoice: {
    position: "absolute",
    right: -4,
    top: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  pipHideVideo: {
    position: "absolute",
    right: 4,
    top: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  edgeRestore: {
    position: "absolute",
    width: 22,
    height: 56,
    overflow: "hidden",
  },
  edgeRestoreFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  edgeLeft: { left: 0, borderTopRightRadius: 12, borderBottomRightRadius: 12 },
  edgeRight: { right: 0, borderTopLeftRadius: 12, borderBottomLeftRadius: 12 },
});
