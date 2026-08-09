import { useEvent } from "expo";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
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
    try {
      pauseVideoPlayer(player);
    } catch (error) {
      reportVideoPlayerFailure(error, "video_player_pause");
    } finally {
      onClose();
    }
  }, [onClose, player]);

  const didFail = sourceError || activationErrorIdentity === sourceIdentity || status === "error";

  return (
    <View accessibilityViewIsModal onAccessibilityEscape={dismiss} style={styles.root}>
      <StatusBar hidden />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop]} />
      <View style={styles.playerSurface}>
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
  closeSlot: { position: "absolute", right: 0, top: 64 },
  closeButton: { padding: 16 },
});
