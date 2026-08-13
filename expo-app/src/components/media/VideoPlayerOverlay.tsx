import { useEvent } from "expo";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import {
  mediaPullContentFadeEndDistance,
  mediaPullDismissDecision,
  mediaPullHasVerticalIntent,
  mediaPullScaleEndDistance,
  mediaPullVisualTranslation,
  MEDIA_PULL_BACKDROP_FADE_DISTANCE,
  MEDIA_PULL_CONTENT_FADE_START_DISTANCE,
  MEDIA_PULL_DIRECTION_LOCK_DISTANCE,
  MEDIA_PULL_DISMISS_DURATION_MS,
  MEDIA_PULL_MINIMUM_BACKDROP_OPACITY,
  MEDIA_PULL_MINIMUM_SCALE,
  MEDIA_PULL_RESTORE_DURATION_MS,
  MEDIA_PULL_SCALE_START_DISTANCE,
} from "@/components/media/mediaPullDismissMath";
import {
  nextChatVideoPlaybackAttempt,
  resolveChatVideoPlaybackCandidates,
} from "@/components/media/videoPlayerMath";
import { env } from "@/config/env";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  cacheMediaFile,
  chatVideoMediaCacheId,
  getCachedMediaUri,
} from "@/services/cache/MediaCacheService";
import { prepareFirstPlayableVideoSource } from "@/services/media/VideoPlaybackSource";
import { pauseVideoPlayer, playVideoPlayer } from "@/services/media/VideoPlayerGuard";
import { captureException } from "@/services/monitoring/MonitoringService";

function reportVideoPlayerFailure(error: unknown, operation: string): void {
  try {
    captureException(error, { operation });
  } catch {
    // Monitoring must never turn a recoverable media failure into a process-level crash.
  }
}

function monitoredVideoPath(uri: string | null): string {
  if (!uri) return "unresolved";
  try {
    return new URL(uri).pathname || "root";
  } catch {
    return uri.startsWith("file:") ? "local-file" : "invalid";
  }
}

export function VideoPlayerOverlay({
  onClose,
  posterUrl,
  videoUrl,
}: {
  onClose: () => void;
  posterUrl?: string | null | undefined;
  videoUrl: string | null;
}) {
  const { user } = useAuth();
  const ownerId = trimFoundationWhitespacesAndNewlines(user?.user_id ?? "");
  if (!videoUrl) return null;
  return (
    <VideoPlayerModal
      key={videoUrl}
      onClose={onClose}
      ownerId={ownerId}
      posterUrl={posterUrl}
      videoUrl={videoUrl}
    />
  );
}

function VideoPlayerModal({
  onClose,
  ownerId,
  posterUrl,
  videoUrl,
}: {
  onClose: () => void;
  ownerId: string;
  posterUrl?: string | null | undefined;
  videoUrl: string;
}) {
  const [isPresented, setPresented] = useState(false);
  return (
    <Modal
      animationType="none"
      onShow={() => setPresented(true)}
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible
    >
      {isPresented ? (
        <VideoPlayerPresentation
          key={videoUrl}
          onClose={onClose}
          ownerId={ownerId}
          posterUrl={posterUrl}
          videoUrl={videoUrl}
        />
      ) : (
        <VideoOpeningPlaceholder posterUrl={posterUrl} />
      )}
    </Modal>
  );
}

function VideoPlayerPresentation({
  onClose,
  ownerId,
  posterUrl,
  videoUrl,
}: {
  onClose: () => void;
  ownerId: string;
  posterUrl?: string | null | undefined;
  videoUrl: string;
}) {
  const [ownerAtOpen] = useState(ownerId);
  const isCurrentOwner = ownerAtOpen === ownerId;
  useEffect(() => {
    if (!isCurrentOwner) onClose();
  }, [isCurrentOwner, onClose]);
  if (!isCurrentOwner) return null;
  return (
    <VideoPlayerContent
      onClose={onClose}
      ownerId={ownerAtOpen}
      posterUrl={posterUrl}
      videoUrl={videoUrl}
    />
  );
}

function VideoPlayerContent({
  onClose,
  ownerId,
  posterUrl,
  videoUrl,
}: {
  onClose: () => void;
  ownerId: string;
  posterUrl?: string | null | undefined;
  videoUrl: string;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { t } = useLocalization();
  const playbackCandidates = useMemo(
    () => resolveChatVideoPlaybackCandidates(videoUrl, env.apiBaseUrl),
    [videoUrl],
  );
  const playbackUrl = playbackCandidates[0] ?? null;
  const mediaId = videoUrl.trim() ? chatVideoMediaCacheId(videoUrl) : "";
  const sourceIdentity = `${ownerId}\u0000${mediaId}\u0000${playbackCandidates.join("\u0001")}`;
  const [attempt, setAttempt] = useState({
    allowCache: true,
    candidateIndex: 0,
    generation: 0,
  });
  const attemptIdentity = `${sourceIdentity}\u0000${attempt.generation}`;
  const [sourceState, setSourceState] = useState<{
    identity: string;
    source: VideoSource | null;
    uri: string | null;
    candidateIndex: number;
    kind: "local" | "remote";
  } | null>(null);
  const preparedSource = sourceState?.identity === attemptIdentity ? sourceState.source : null;
  const preparedUri = sourceState?.identity === attemptIdentity ? sourceState.uri : null;
  const [terminalError, setTerminalError] = useState(false);
  const [activationErrorIdentity, setActivationErrorIdentity] = useState<string | null>(null);
  const [statusArmedIdentity, setStatusArmedIdentity] = useState<string | null>(null);
  const [hasRenderedFirstFrame, setHasRenderedFirstFrame] = useState(false);
  const [verticalDrag] = useState(() => new Animated.Value(0));
  const [backdropBaseOpacity] = useState(() => new Animated.Value(1));
  const isDismissingRef = useRef(false);
  const hasClosedRef = useRef(false);
  const handledFailureIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const candidateIndex = Math.max(0, attempt.candidateIndex);
    if (!playbackUrl || candidateIndex >= playbackCandidates.length) {
      return () => {
        active = false;
        controller.abort();
      };
    }

    void (async () => {
      try {
        setActivationErrorIdentity(null);
        setStatusArmedIdentity(null);
        setTerminalError(false);
        const localUri =
          attempt.allowCache && candidateIndex === 0 && ownerId && mediaId
            ? await getCachedMediaUri(ownerId, mediaId)
            : null;
        if (localUri) {
          if (active) {
            setSourceState({
              identity: attemptIdentity,
              source: { uri: localUri },
              uri: localUri,
              candidateIndex,
              kind: "local",
            });
          }
          return;
        }
        const prepared = await prepareFirstPlayableVideoSource(
          playbackCandidates.slice(candidateIndex),
          env.apiBaseUrl,
          controller.signal,
        );
        if (!active) return;
        const resolvedIndex = playbackCandidates.indexOf(prepared.uri, candidateIndex);
        if (resolvedIndex < candidateIndex) throw new Error("视频候选地址状态异常");
        let source = prepared.source;
        let kind: "local" | "remote" = "remote";
        const requiresLocalAuthenticatedPlayback =
          Boolean(prepared.source.headers) && !prepared.uri.toLowerCase().includes(".m3u8");
        if (attempt.allowCache && requiresLocalAuthenticatedPlayback && ownerId && mediaId) {
          const authenticatedLocalUri = await cacheMediaFile({
            ownerId,
            mediaId,
            remoteUrl: prepared.uri,
            authorizationPolicy: "required",
            signal: controller.signal,
          });
          if (!active) return;
          if (authenticatedLocalUri) {
            source = { uri: authenticatedLocalUri };
            kind = "local";
          }
        }
        if (!active) return;
        setSourceState({
          identity: attemptIdentity,
          source,
          uri: prepared.uri,
          candidateIndex: resolvedIndex,
          kind,
        });
      } catch (error) {
        if (active) {
          setTerminalError(true);
          reportVideoPlayerFailure(error, "video_player_source_prepare");
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    attempt.allowCache,
    attempt.candidateIndex,
    attemptIdentity,
    mediaId,
    ownerId,
    playbackCandidates,
    playbackUrl,
  ]);

  const player = useVideoPlayer(null, (instance) => {
    try {
      instance.audioMixingMode = "doNotMix";
      instance.keepScreenOnWhilePlaying = true;
      instance.staysActiveInBackground = false;
      instance.bufferOptions = {
        preferredForwardBufferDuration: 2,
        waitsToMinimizeStalling: true,
      };
    } catch (error) {
      reportVideoPlayerFailure(error, "video_player_configure");
    }
  });
  const { error: playbackError, status } = useEvent(player, "statusChange", {
    status: player.status,
  });
  const sourceError =
    !playbackUrl ||
    attempt.candidateIndex >= playbackCandidates.length ||
    terminalError ||
    (status === "error" && statusArmedIdentity === attemptIdentity && hasRenderedFirstFrame);
  const lastReportedPlaybackErrorRef = useRef<string | null>(null);

  useEffect(() => {
    const message = playbackError?.message?.trim();
    if (status !== "error" || !message) return;
    const reportIdentity = `${attemptIdentity}\u0000${message}`;
    if (lastReportedPlaybackErrorRef.current === reportIdentity) return;
    lastReportedPlaybackErrorRef.current = reportIdentity;
    try {
      captureException(new Error(message), {
        operation: "video_player_status",
        media_path: monitoredVideoPath(preparedUri),
      });
    } catch {
      // Monitoring must not interfere with the player error UI.
    }
  }, [attemptIdentity, playbackError?.message, preparedUri, status]);

  const advancePlaybackAttempt = useCallback(() => {
    if (!sourceState || sourceState.identity !== attemptIdentity) {
      setTerminalError(true);
      return;
    }
    const nextAttempt = nextChatVideoPlaybackAttempt(
      attempt,
      sourceState.kind,
      sourceState.candidateIndex,
      playbackCandidates.length,
    );
    if (!nextAttempt) {
      setTerminalError(true);
      return;
    }
    setAttempt(nextAttempt);
    setActivationErrorIdentity(null);
    setStatusArmedIdentity(null);
    setHasRenderedFirstFrame(false);
    setTerminalError(false);
  }, [attempt, attemptIdentity, playbackCandidates.length, sourceState]);

  useEffect(() => {
    if (!preparedSource) return;
    let active = true;
    let synchronousFailureTimer: ReturnType<typeof setTimeout> | null = null;
    let statusArmTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      void player
        .replaceAsync(preparedSource)
        .then(() => {
          statusArmTimer = setTimeout(() => {
            if (active) setStatusArmedIdentity(attemptIdentity);
          }, 250);
        })
        .catch((error) => {
          if (active) setActivationErrorIdentity(attemptIdentity);
          reportVideoPlayerFailure(error, "video_player_replace");
        });
    } catch (error) {
      synchronousFailureTimer = setTimeout(() => {
        if (active) setActivationErrorIdentity(attemptIdentity);
      }, 0);
      reportVideoPlayerFailure(error, "video_player_replace_sync");
    }
    return () => {
      active = false;
      if (synchronousFailureTimer) clearTimeout(synchronousFailureTimer);
      if (statusArmTimer) clearTimeout(statusArmTimer);
    };
  }, [attemptIdentity, player, preparedSource]);

  useEffect(() => {
    const activationFailed = activationErrorIdentity === attemptIdentity;
    const playbackFailed =
      status === "error" && statusArmedIdentity === attemptIdentity && !hasRenderedFirstFrame;
    if (!activationFailed && !playbackFailed) return;
    if (handledFailureIdentityRef.current === attemptIdentity) return;
    handledFailureIdentityRef.current = attemptIdentity;
    advancePlaybackAttempt();
  }, [
    activationErrorIdentity,
    advancePlaybackAttempt,
    attemptIdentity,
    hasRenderedFirstFrame,
    status,
    statusArmedIdentity,
  ]);

  useEffect(() => {
    if (!preparedSource || status !== "readyToPlay" || statusArmedIdentity !== attemptIdentity)
      return;
    let active = true;
    let failureTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      playVideoPlayer(player);
    } catch (error) {
      failureTimer = setTimeout(() => {
        if (active) setActivationErrorIdentity(attemptIdentity);
      }, 0);
      reportVideoPlayerFailure(error, "video_player_play");
    }
    return () => {
      active = false;
      if (failureTimer) clearTimeout(failureTimer);
    };
  }, [attemptIdentity, player, preparedSource, status, statusArmedIdentity]);

  const dismiss = useCallback(() => {
    if (hasClosedRef.current) return;
    hasClosedRef.current = true;
    try {
      pauseVideoPlayer(player);
    } catch (error) {
      reportVideoPlayerFailure(error, "video_player_pause");
    } finally {
      onClose();
    }
  }, [onClose, player]);

  const restoreAfterDrag = useCallback(() => {
    Animated.parallel(
      [
        Animated.timing(verticalDrag, {
          duration: MEDIA_PULL_RESTORE_DURATION_MS,
          easing: Easing.out(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(backdropBaseOpacity, {
          duration: MEDIA_PULL_RESTORE_DURATION_MS,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
      ],
      { stopTogether: false },
    ).start(() => {
      isDismissingRef.current = false;
    });
  }, [backdropBaseOpacity, verticalDrag]);

  const finishSwipeDismiss = useCallback(
    (direction: -1 | 1) => {
      if (isDismissingRef.current) return;
      isDismissingRef.current = true;
      Animated.parallel(
        [
          Animated.timing(verticalDrag, {
            duration: MEDIA_PULL_DISMISS_DURATION_MS,
            easing: Easing.out(Easing.cubic),
            toValue: direction * Math.max(height, 1),
            useNativeDriver: true,
          }),
          Animated.timing(backdropBaseOpacity, {
            duration: MEDIA_PULL_DISMISS_DURATION_MS,
            easing: Easing.out(Easing.cubic),
            toValue: 0,
            useNativeDriver: true,
          }),
        ],
        { stopTogether: false },
      ).start(({ finished }) => {
        if (finished) dismiss();
        else restoreAfterDrag();
      });
    },
    [backdropBaseOpacity, dismiss, height, restoreAfterDrag, verticalDrag],
  );

  const updateVerticalDrag = useCallback(
    (translationY: number, activeTouches: number) => {
      if (!isDismissingRef.current && activeTouches === 1) {
        verticalDrag.setValue(mediaPullVisualTranslation(translationY));
      }
    },
    [verticalDrag],
  );

  /* eslint-disable react-hooks/refs -- PanResponder stores these callbacks for later gesture events; it does not invoke them during render. */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !isDismissingRef.current &&
          gesture.numberActiveTouches === 1 &&
          Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) >=
            MEDIA_PULL_DIRECTION_LOCK_DISTANCE &&
          mediaPullHasVerticalIntent(gesture.dx, gesture.dy),
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          !isDismissingRef.current &&
          gesture.numberActiveTouches === 1 &&
          Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) >=
            MEDIA_PULL_DIRECTION_LOCK_DISTANCE &&
          mediaPullHasVerticalIntent(gesture.dx, gesture.dy),
        onPanResponderGrant: () => {
          verticalDrag.stopAnimation();
          backdropBaseOpacity.stopAnimation();
          backdropBaseOpacity.setValue(1);
        },
        onPanResponderMove: (_, gesture) => {
          updateVerticalDrag(gesture.dy, gesture.numberActiveTouches);
        },
        onPanResponderRelease: (_, gesture) => {
          // PanResponder reports velocity in points per millisecond; the shared
          // image/video contract accepts points per second.
          const decision = mediaPullDismissDecision(gesture.dy, gesture.vy * 1_000);
          if (decision !== 0) {
            finishSwipeDismiss(decision);
          } else {
            restoreAfterDrag();
          }
        },
        onPanResponderTerminate: restoreAfterDrag,
        onPanResponderTerminationRequest: () => false,
      }),
    [backdropBaseOpacity, finishSwipeDismiss, restoreAfterDrag, updateVerticalDrag, verticalDrag],
  );
  /* eslint-enable react-hooks/refs */

  const dragBackdropOpacity = verticalDrag.interpolate({
    extrapolate: "clamp",
    inputRange: [-MEDIA_PULL_BACKDROP_FADE_DISTANCE, 0, MEDIA_PULL_BACKDROP_FADE_DISTANCE],
    outputRange: [MEDIA_PULL_MINIMUM_BACKDROP_OPACITY, 1, MEDIA_PULL_MINIMUM_BACKDROP_OPACITY],
  });
  const backdropOpacity = Animated.multiply(backdropBaseOpacity, dragBackdropOpacity);
  const scaleEndDistance = mediaPullScaleEndDistance(height);
  const playerScale = verticalDrag.interpolate({
    extrapolate: "clamp",
    inputRange: [
      -scaleEndDistance,
      -MEDIA_PULL_SCALE_START_DISTANCE,
      MEDIA_PULL_SCALE_START_DISTANCE,
      scaleEndDistance,
    ],
    outputRange: [MEDIA_PULL_MINIMUM_SCALE, 1, 1, MEDIA_PULL_MINIMUM_SCALE],
  });
  const contentFadeEndDistance = mediaPullContentFadeEndDistance(height);
  const playerOpacity = verticalDrag.interpolate({
    extrapolate: "clamp",
    inputRange: [
      -contentFadeEndDistance,
      -MEDIA_PULL_CONTENT_FADE_START_DISTANCE,
      MEDIA_PULL_CONTENT_FADE_START_DISTANCE,
      contentFadeEndDistance,
    ],
    outputRange: [0, 1, 1, 0],
  });
  const closeOpacity = verticalDrag.interpolate({
    extrapolate: "clamp",
    inputRange: [-1, 0, 1],
    outputRange: [0, 1, 0],
  });

  const didFail = sourceError;

  return (
    <View
      accessibilityViewIsModal
      onAccessibilityEscape={dismiss}
      style={styles.root}
      {...panResponder.panHandlers}
    >
      <StatusBar hidden />
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}
      />
      <Animated.View
        style={[
          styles.playerSurface,
          {
            opacity: playerOpacity,
            transform: [{ translateY: verticalDrag }, { scale: playerScale }],
          },
        ]}
      >
        {preparedSource && !didFail ? (
          <VideoView
            key={attemptIdentity}
            allowsPictureInPicture={false}
            allowsVideoFrameAnalysis={false}
            contentFit="contain"
            fullscreenOptions={{ enable: false }}
            nativeControls
            onFirstFrameRender={() => {
              if (sourceState?.identity === attemptIdentity) setHasRenderedFirstFrame(true);
            }}
            player={player}
            startsPictureInPictureAutomatically={false}
            style={styles.player}
            surfaceType="textureView"
          />
        ) : null}
        {!didFail && !hasRenderedFirstFrame && posterUrl ? (
          <VideoPoster posterUrl={posterUrl} />
        ) : null}
        {didFail ? (
          <View style={styles.state}>
            <SymbolView name="exclamationmark.triangle" size={40} tintColor="#8E8E93" />
            <Text style={styles.errorText}>{t("video.loadFailed")}</Text>
          </View>
        ) : !posterUrl && !hasRenderedFirstFrame ? (
          <View style={styles.state}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : null}
      </Animated.View>
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.closeSlot,
          {
            opacity: closeOpacity,
            right: Math.max(insets.right, 0) + 8,
            top: Math.max(insets.top + 8, 44),
          },
        ]}
      >
        <Pressable
          accessibilityLabel={t("common.close")}
          accessibilityRole="button"
          hitSlop={12}
          onPress={dismiss}
          style={styles.closeButton}
          testID="video-preview-close-button"
        >
          <SymbolView name="xmark.circle.fill" size={28} tintColor="rgba(255,255,255,0.8)" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

function VideoOpeningPlaceholder({ posterUrl }: { posterUrl?: string | null | undefined }) {
  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop]} />
      {posterUrl ? <VideoPoster posterUrl={posterUrl} /> : null}
    </View>
  );
}

function VideoPoster({ posterUrl }: { posterUrl: string }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <AuthenticatedImage
        contentFit="contain"
        loadingFallback={<View style={[StyleSheet.absoluteFill, styles.backdrop]} />}
        style={StyleSheet.absoluteFill}
        transition={0}
        uri={posterUrl}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  backdrop: { backgroundColor: "#000000" },
  playerSurface: { flex: 1 },
  player: { flex: 1 },
  state: { flex: 1, alignItems: "center", justifyContent: "center", rowGap: 12 },
  errorText: { color: "#8E8E93", fontSize: 16 },
  closeSlot: { position: "absolute", zIndex: 20, elevation: 20 },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.52)",
  },
});
