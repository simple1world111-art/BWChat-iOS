/* eslint-disable react-hooks/immutability -- Reanimated shared values are UI-thread state used by gesture callbacks. */
import { useEvent } from "expo";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import {
  predictedVideoTranslation,
  resolveChatVideoPlaybackUrl,
  shouldDismissVideo,
  VIDEO_MINIMUM_SCALE,
  VIDEO_PAN_MINIMUM_DISTANCE,
  VIDEO_REST_SCALE_LIMIT,
  videoBackgroundOpacity,
  videoDismissScale,
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

export function VideoPlayerOverlay({
  onClose,
  videoUrl,
}: {
  onClose: () => void;
  videoUrl: string | null;
}) {
  const { user } = useAuth();
  const ownerId = trimFoundationWhitespacesAndNewlines(user?.user_id ?? "");
  if (!videoUrl) return null;
  return (
    <VideoPlayerModal key={videoUrl} onClose={onClose} ownerId={ownerId} videoUrl={videoUrl} />
  );
}

function VideoPlayerModal({
  onClose,
  ownerId,
  videoUrl,
}: {
  onClose: () => void;
  ownerId: string;
  videoUrl: string;
}) {
  const [isPresented, setPresented] = useState(false);
  return (
    <Modal
      animationType="slide"
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
          videoUrl={videoUrl}
        />
      ) : null}
    </Modal>
  );
}

function VideoPlayerPresentation({
  onClose,
  ownerId,
  videoUrl,
}: {
  onClose: () => void;
  ownerId: string;
  videoUrl: string;
}) {
  const [ownerAtOpen] = useState(ownerId);
  const isCurrentOwner = ownerAtOpen === ownerId;
  useEffect(() => {
    if (!isCurrentOwner) onClose();
  }, [isCurrentOwner, onClose]);
  if (!isCurrentOwner) return null;
  return <VideoPlayerContent onClose={onClose} ownerId={ownerAtOpen} videoUrl={videoUrl} />;
}

function VideoPlayerContent({
  onClose,
  ownerId,
  videoUrl,
}: {
  onClose: () => void;
  ownerId: string;
  videoUrl: string;
}) {
  const { width, height } = useWindowDimensions();
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
  const scheduledCacheCancellation = useRef<(() => void) | null>(null);

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

  const player = useVideoPlayer(null, (instance) => {
    instance.audioMixingMode = "doNotMix";
    instance.keepScreenOnWhilePlaying = true;
    instance.staysActiveInBackground = false;
    instance.bufferOptions = {
      preferredForwardBufferDuration: 2,
      waitsToMinimizeStalling: true,
    };
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const scale = useSharedValue(1);
  const scaleAtStart = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const offsetXAtStart = useSharedValue(0);
  const offsetYAtStart = useSharedValue(0);
  const pinchContentX = useSharedValue(0);
  const pinchContentY = useSharedValue(0);
  const verticalDrag = useSharedValue(0);
  const dragMode = useSharedValue(0);
  const pinching = useSharedValue(0);

  useEffect(() => {
    if (!preparedSource) return;
    let active = true;
    void player.replaceAsync(preparedSource).catch(() => {
      if (active) setActivationErrorIdentity(sourceIdentity);
    });
    return () => {
      active = false;
    };
  }, [player, preparedSource, sourceIdentity]);

  useEffect(() => {
    if (status === "readyToPlay") playVideoPlayer(player);
  }, [player, status]);

  useEffect(() => {
    if (
      status !== "readyToPlay" ||
      !ownerId ||
      !mediaId ||
      !playbackUrl ||
      scheduledCacheCancellation.current
    )
      return;
    const cancellation = scheduleMediaCache({ ownerId, mediaId, remoteUrl: playbackUrl });
    scheduledCacheCancellation.current = cancellation;
  }, [mediaId, ownerId, playbackUrl, status]);

  useEffect(
    () => () => {
      scheduledCacheCancellation.current?.();
      scheduledCacheCancellation.current = null;
    },
    [],
  );

  const dismiss = useCallback(() => {
    pauseVideoPlayer(player);
    onClose();
  }, [onClose, player]);

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .enabled(status === "readyToPlay")
        .onBegin((event) => {
          pinching.value = 1;
          verticalDrag.value = 0;
          scaleAtStart.value = Math.max(scale.value, 0.001);
          pinchContentX.value = (event.focalX - width / 2 - offsetX.value) / scaleAtStart.value;
          pinchContentY.value = (event.focalY - height / 2 - offsetY.value) / scaleAtStart.value;
        })
        .onUpdate((event) => {
          const nextScale = Math.max(VIDEO_MINIMUM_SCALE, scaleAtStart.value * event.scale);
          scale.value = nextScale;
          offsetX.value = event.focalX - width / 2 - pinchContentX.value * nextScale;
          offsetY.value = event.focalY - height / 2 - pinchContentY.value * nextScale;
        })
        .onEnd(() => {
          if (scale.value < 1) {
            scale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
            offsetX.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
            offsetY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
          }
          offsetXAtStart.value = offsetX.value;
          offsetYAtStart.value = offsetY.value;
        })
        .onFinalize((_event, success) => {
          pinching.value = 0;
          if (!success && scale.value < 1) {
            scale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
            offsetX.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
            offsetY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
          }
        }),
    [
      height,
      offsetX,
      offsetXAtStart,
      offsetY,
      offsetYAtStart,
      pinchContentX,
      pinchContentY,
      pinching,
      scale,
      scaleAtStart,
      verticalDrag,
      status,
      width,
    ],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(status === "readyToPlay")
        .minDistance(VIDEO_PAN_MINIMUM_DISTANCE)
        .maxPointers(1)
        .onBegin(() => {
          if (pinching.value !== 0) {
            dragMode.value = -1;
            return;
          }
          dragMode.value = scale.value > VIDEO_REST_SCALE_LIMIT ? 1 : 0;
          offsetXAtStart.value = offsetX.value;
          offsetYAtStart.value = offsetY.value;
        })
        .onUpdate((event) => {
          if (pinching.value !== 0 || dragMode.value === -1) return;
          if (dragMode.value === 1 || scale.value > VIDEO_REST_SCALE_LIMIT) {
            dragMode.value = 1;
            offsetX.value = offsetXAtStart.value + event.translationX;
            offsetY.value = offsetYAtStart.value + event.translationY;
            return;
          }
          if (Math.abs(event.translationY) > Math.abs(event.translationX)) {
            dragMode.value = 2;
            verticalDrag.value = event.translationY;
          }
        })
        .onEnd((event) => {
          if (pinching.value !== 0 || dragMode.value === -1) return;
          if (dragMode.value === 1) {
            offsetXAtStart.value = offsetX.value;
            offsetYAtStart.value = offsetY.value;
            return;
          }
          if (dragMode.value !== 2) return;
          const predictedY = predictedVideoTranslation(event.translationY, event.velocityY);
          if (
            shouldDismissVideo({
              translationX: event.translationX,
              translationY: event.translationY,
              predictedTranslationY: predictedY,
            })
          ) {
            runOnJS(dismiss)();
          } else {
            verticalDrag.value = withSpring(0, { duration: 320, dampingRatio: 0.86 });
          }
        })
        .onFinalize((_event, success) => {
          if (!success && dragMode.value === 2) {
            verticalDrag.value = withSpring(0, { duration: 320, dampingRatio: 0.86 });
          }
          dragMode.value = 0;
        }),
    [
      dismiss,
      dragMode,
      offsetX,
      offsetXAtStart,
      offsetY,
      offsetYAtStart,
      pinching,
      scale,
      status,
      verticalDrag,
    ],
  );

  const native = useMemo(() => Gesture.Native(), []);
  const gesture = useMemo(() => Gesture.Simultaneous(native, pinch, pan), [native, pan, pinch]);
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: videoBackgroundOpacity(verticalDrag.value),
  }));
  const mediaStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value + verticalDrag.value },
      { scale: scale.value * videoDismissScale(verticalDrag.value) },
    ],
  }));
  const closeStyle = useAnimatedStyle(() => ({ opacity: verticalDrag.value === 0 ? 1 : 0 }));

  return (
    <View accessibilityViewIsModal onAccessibilityEscape={dismiss} style={styles.root}>
      <StatusBar hidden />
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
      />
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.playerSurface, mediaStyle]}>
          {preparedSource && status === "readyToPlay" ? (
            <VideoView contentFit="contain" nativeControls player={player} style={styles.player} />
          ) : sourceError || activationErrorIdentity === sourceIdentity || status === "error" ? (
            <View style={styles.state}>
              <SymbolView name="exclamationmark.triangle" size={40} tintColor="#8E8E93" />
              <Text style={styles.errorText}>{t("video.loadFailed")}</Text>
            </View>
          ) : (
            <View style={styles.state}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          )}
        </Animated.View>
      </GestureDetector>
      <Animated.View style={[styles.closeSlot, closeStyle]}>
        <Pressable
          accessibilityLabel={t("common.close")}
          hitSlop={12}
          onPress={dismiss}
          style={styles.closeButton}
        >
          <SymbolView name="xmark.circle.fill" size={28} tintColor="rgba(255,255,255,0.8)" />
        </Pressable>
      </Animated.View>
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
  closeSlot: { position: "absolute", right: 0, top: 64 },
  closeButton: { padding: 16 },
});
