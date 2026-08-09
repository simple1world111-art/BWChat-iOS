import { useEvent } from "expo";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { resolveChatVideoPlaybackUrl } from "@/components/media/videoPlayerMath";
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

  useEffect(() => {
    if (
      status !== "readyToPlay" ||
      !ownerId ||
      !mediaId ||
      !playbackUrl ||
      scheduledCacheCancellation.current
    )
      return;
    try {
      const cancellation = scheduleMediaCache({ ownerId, mediaId, remoteUrl: playbackUrl });
      scheduledCacheCancellation.current = cancellation;
    } catch (error) {
      reportVideoPlayerFailure(error, "video_player_cache_schedule");
    }
  }, [mediaId, ownerId, playbackUrl, status]);

  useEffect(
    () => () => {
      try {
        scheduledCacheCancellation.current?.();
      } catch (error) {
        reportVideoPlayerFailure(error, "video_player_cache_cancel");
      }
      scheduledCacheCancellation.current = null;
    },
    [],
  );

  const dismiss = useCallback(() => {
    try {
      pauseVideoPlayer(player);
    } catch (error) {
      reportVideoPlayerFailure(error, "video_player_pause");
    } finally {
      onClose();
    }
  }, [onClose, player]);

  return (
    <View accessibilityViewIsModal onAccessibilityEscape={dismiss} style={styles.root}>
      <StatusBar hidden />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop]} />
      <View style={styles.playerSurface}>
        {preparedSource && status === "readyToPlay" ? (
          <VideoView
            allowsPictureInPicture={false}
            allowsVideoFrameAnalysis={false}
            contentFit="contain"
            fullscreenOptions={{ enable: false }}
            nativeControls
            player={player}
            startsPictureInPictureAutomatically={false}
            style={styles.player}
          />
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
      </View>
      <View style={styles.closeSlot}>
        <Pressable
          accessibilityLabel={t("common.close")}
          hitSlop={12}
          onPress={dismiss}
          style={styles.closeButton}
        >
          <SymbolView name="xmark.circle.fill" size={28} tintColor="rgba(255,255,255,0.8)" />
        </Pressable>
      </View>
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
