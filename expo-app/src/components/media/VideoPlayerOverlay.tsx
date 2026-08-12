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
  predictedVideoTranslation,
  resolveChatVideoPlaybackUrl,
  shouldDismissVideo,
  VIDEO_PAN_MINIMUM_DISTANCE,
} from "@/components/media/videoPlayerMath";
import { env } from "@/config/env";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  chatVideoMediaCacheId,
  getCachedMediaUri,
  scheduleMediaCache,
} from "@/services/cache/MediaCacheService";
import { prepareVideoPlaybackSource } from "@/services/media/VideoPlaybackSource";
import { pauseVideoPlayer, playVideoPlayer } from "@/services/media/VideoPlayerGuard";
import { captureException } from "@/services/monitoring/MonitoringService";

function reportVideoPlayerFailure(error: unknown, operation: string): void {
  try {
    captureException(error, { operation });
  } catch {
    // Monitoring must never turn a recoverable media failure into a process-level crash.
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
      presentationStyle="fullScreen"
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
  const playbackUrl = useMemo(
    () => resolveChatVideoPlaybackUrl(videoUrl, env.apiBaseUrl),
    [videoUrl],
  );
  const mediaId = videoUrl.trim() ? chatVideoMediaCacheId(videoUrl) : "";
  const sourceIdentity = `${ownerId}\u0000${mediaId}\u0000${playbackUrl ?? ""}`;
  const [sourceState, setSourceState] = useState<{
    identity: string;
    source: VideoSource | null;
    error: boolean;
  } | null>(null);
  const preparedSource = sourceState?.identity === sourceIdentity ? sourceState.source : null;
  const sourceError =
    !playbackUrl || (sourceState?.identity === sourceIdentity && sourceState.error);
  const [activationErrorIdentity, setActivationErrorIdentity] = useState<string | null>(null);
  const [hasRenderedFirstFrame, setHasRenderedFirstFrame] = useState(false);
  const [verticalDrag] = useState(() => new Animated.Value(0));
  const isDismissingRef = useRef(false);
  const hasClosedRef = useRef(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!playbackUrl) {
      return () => {
        active = false;
        controller.abort();
      };
    }

    void (async () => {
      try {
        const localUri = ownerId && mediaId ? await getCachedMediaUri(ownerId, mediaId) : null;
        if (!active) return;
        const source: VideoSource = localUri
          ? { uri: localUri }
          : await prepareVideoPlaybackSource(playbackUrl, env.apiBaseUrl, controller.signal);
        if (active) setSourceState({ identity: sourceIdentity, source, error: false });
      } catch {
        if (active) setSourceState({ identity: sourceIdentity, source: null, error: true });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [mediaId, ownerId, playbackUrl, sourceIdentity]);

  useEffect(() => {
    if (!ownerId || !mediaId || !playbackUrl) return;
    try {
      // This is an intentional persistent warm-up. Once a user opens a video,
      // the background download should outlive the viewer instead of being
      // cancelled when the modal closes a few seconds later.
      void scheduleMediaCache({
        ownerId,
        mediaId,
        remoteUrl: playbackUrl,
        delayMilliseconds: 0,
      });
    } catch (error) {
      reportVideoPlayerFailure(error, "video_player_cache_schedule");
    }
  }, [mediaId, ownerId, playbackUrl]);

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
  const { status } = useEvent(player, "statusChange", { status: player.status });

  useEffect(() => {
    if (!preparedSource) return;
    let active = true;
    let synchronousFailureTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      void player.replaceAsync(preparedSource).catch((error) => {
        if (active) setActivationErrorIdentity(sourceIdentity);
        reportVideoPlayerFailure(error, "video_player_replace");
      });
    } catch (error) {
      synchronousFailureTimer = setTimeout(() => {
        if (active) setActivationErrorIdentity(sourceIdentity);
      }, 0);
      reportVideoPlayerFailure(error, "video_player_replace_sync");
    }
    return () => {
      active = false;
      if (synchronousFailureTimer) clearTimeout(synchronousFailureTimer);
    };
  }, [player, preparedSource, sourceIdentity]);

  useEffect(() => {
    if (status !== "readyToPlay") return;
    let active = true;
    let failureTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      playVideoPlayer(player);
    } catch (error) {
      failureTimer = setTimeout(() => {
        if (active) setActivationErrorIdentity(sourceIdentity);
      }, 0);
      reportVideoPlayerFailure(error, "video_player_play");
    }
    return () => {
      active = false;
      if (failureTimer) clearTimeout(failureTimer);
    };
  }, [player, sourceIdentity, status]);

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
    Animated.spring(verticalDrag, {
      damping: 20,
      mass: 0.8,
      stiffness: 220,
      toValue: 0,
      useNativeDriver: true,
    }).start(() => {
      isDismissingRef.current = false;
    });
  }, [verticalDrag]);

  const finishSwipeDismiss = useCallback(
    (direction: -1 | 1) => {
      if (isDismissingRef.current) return;
      isDismissingRef.current = true;
      Animated.timing(verticalDrag, {
        duration: 180,
        easing: Easing.out(Easing.cubic),
        toValue: direction * Math.max(height, 1),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) dismiss();
        else restoreAfterDrag();
      });
    },
    [dismiss, height, restoreAfterDrag, verticalDrag],
  );

  const updateVerticalDrag = useCallback(
    (translationY: number, activeTouches: number) => {
      if (!isDismissingRef.current && activeTouches === 1) {
        verticalDrag.setValue(translationY);
      }
    },
    [verticalDrag],
  );

  /* eslint-disable react-hooks/refs -- PanResponder stores these callbacks for later gesture events; it does not invoke them during render. */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.numberActiveTouches === 1 &&
          Math.hypot(gesture.dx, gesture.dy) >= VIDEO_PAN_MINIMUM_DISTANCE &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          gesture.numberActiveTouches === 1 &&
          Math.hypot(gesture.dx, gesture.dy) >= VIDEO_PAN_MINIMUM_DISTANCE &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          verticalDrag.stopAnimation();
        },
        onPanResponderMove: (_, gesture) => {
          updateVerticalDrag(gesture.dy, gesture.numberActiveTouches);
        },
        onPanResponderRelease: (_, gesture) => {
          // PanResponder reports velocity in points per millisecond while the
          // shared native parity helper accepts points per second.
          const predictedY = predictedVideoTranslation(gesture.dy, gesture.vy * 1_000);
          if (
            shouldDismissVideo({
              translationX: gesture.dx,
              translationY: gesture.dy,
              predictedTranslationY: predictedY,
            })
          ) {
            finishSwipeDismiss((predictedY || gesture.dy) < 0 ? -1 : 1);
          } else {
            restoreAfterDrag();
          }
        },
        onPanResponderTerminate: restoreAfterDrag,
        onPanResponderTerminationRequest: () => false,
      }),
    [finishSwipeDismiss, restoreAfterDrag, updateVerticalDrag, verticalDrag],
  );
  /* eslint-enable react-hooks/refs */

  const backdropOpacity = verticalDrag.interpolate({
    extrapolate: "clamp",
    inputRange: [-320, 0, 320],
    outputRange: [0.1, 1, 0.1],
  });
  const playerScale = verticalDrag.interpolate({
    extrapolate: "clamp",
    inputRange: [-900, -8, 8, 900],
    outputRange: [0.55, 1, 1, 0.55],
  });
  const closeOpacity = verticalDrag.interpolate({
    extrapolate: "clamp",
    inputRange: [-1, 0, 1],
    outputRange: [0, 1, 0],
  });

  const didFail = sourceError || activationErrorIdentity === sourceIdentity || status === "error";

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
          { transform: [{ translateY: verticalDrag }, { scale: playerScale }] },
        ]}
      >
        {preparedSource && !didFail ? (
          <VideoView
            allowsPictureInPicture={false}
            allowsVideoFrameAnalysis={false}
            contentFit="contain"
            fullscreenOptions={{ enable: false }}
            nativeControls
            onFirstFrameRender={() => setHasRenderedFirstFrame(true)}
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
  root: { flex: 1, backgroundColor: "#000000" },
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
