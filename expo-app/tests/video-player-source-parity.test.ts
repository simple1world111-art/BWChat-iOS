import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { authenticatedResourceRequest } from "@/api/client";
import {
  mediaPullBackdropOpacity,
  mediaPullContentFadeEndDistance,
  mediaPullContentOpacity,
  mediaPullDismissDecision,
  mediaPullDismissScale,
  mediaPullHasVerticalIntent,
  mediaPullScaleEndDistance,
  mediaPullVisualTranslation,
  MEDIA_PULL_DIRECTION_LOCK_DISTANCE,
  MEDIA_PULL_DISMISS_DISTANCE,
  MEDIA_PULL_DISMISS_DURATION_MS,
  MEDIA_PULL_FLICK_VELOCITY,
  MEDIA_PULL_MINIMUM_BACKDROP_OPACITY,
  MEDIA_PULL_MINIMUM_FLICK_DISTANCE,
  MEDIA_PULL_MINIMUM_SCALE,
  MEDIA_PULL_RESTORE_DURATION_MS,
  MEDIA_PULL_VERTICAL_DIRECTION_RATIO,
  MEDIA_PULL_VISUAL_DEAD_ZONE,
} from "@/components/media/mediaPullDismissMath";
import {
  nextChatVideoPlaybackAttempt,
  resolveChatVideoPlaybackCandidates,
  resolveChatVideoPlaybackUrl,
} from "@/components/media/videoPlayerMath";
import {
  prepareFirstPlayableVideoSource,
  prepareVideoPlaybackSource,
  videoPlaybackRequiresAuthorization,
  videoRangeProbeHeader,
} from "@/services/media/VideoPlaybackSource";
import {
  chatVideoMediaCacheId,
  mediaCacheDownloadByteLimit,
  mediaCachePolicy,
  mediaFileHeaderLooksPlayable,
} from "@/services/cache/MediaCacheService";
import { readAccessToken } from "@/storage/tokenStorage";

jest.mock("@/api/client", () => ({ authenticatedResourceRequest: jest.fn() }));
jest.mock("@/storage/tokenStorage", () => ({ readAccessToken: jest.fn() }));

const resourceRequest = jest.mocked(authenticatedResourceRequest);
const accessToken = jest.mocked(readAccessToken);
const root = resolve(__dirname, "..");
const copiedNativePath = resolve(root, "../BWChat/Views/VideoPlayerView.swift");
const originalNativePath = resolve(root, "../BWChat/Views/VideoPlayerView.swift");
const nativeHash = "ab6309d94c607f33317492c1b699896f3f7a2ee455fcb963865a67c3981cf3b2";
const copiedNativeCachePath = resolve(root, "../BWChat/Managers/MediaCacheManager.swift");
const originalNativeCachePath = resolve(root, "../BWChat/Managers/MediaCacheManager.swift");
const nativeCacheHash = "36b2e02606eb8ae3ba817931c3cd99b95e98b233b01d2d2e36a8f1884b483c93";

describe("native VideoPlayerView parity", () => {
  beforeEach(() => {
    resourceRequest.mockReset();
    accessToken.mockReset();
  });

  it("locks both the read-only original and the branch copy to the audited Swift source", () => {
    expect(sha256(copiedNativePath)).toBe(nativeHash);
    if (existsSync(originalNativePath)) expect(sha256(originalNativePath)).toBe(nativeHash);
    expect(sha256(copiedNativeCachePath)).toBe(nativeCacheHash);
    if (existsSync(originalNativeCachePath))
      expect(sha256(originalNativeCachePath)).toBe(nativeCacheHash);
  });

  it("uses one shared full-screen player across all six native entry contexts", () => {
    for (const path of [
      "BWChat/Views/ChatView.swift",
      "BWChat/Views/GroupChatView.swift",
      "BWChat/Views/AgentMessageView.swift",
      "BWChat/Views/UserProfileView.swift",
    ]) {
      expect(source(resolve(root, `../${path}`))).toContain("VideoPlayerView(videoURL:");
    }
    expect(
      source(resolve(root, "../BWChat/Views/MomentsView.swift")).match(
        /VideoPlayerView\(videoURL:/gu,
      ),
    ).toHaveLength(2);

    for (const path of [
      "src/app/chat/[id].tsx",
      "src/app/group-chat/[id].tsx",
      "src/app/agent-chat.tsx",
    ]) {
      expect(expo(path)).toContain("<VideoPlayerOverlay");
    }

    const profile = expo("src/components/profile/PublicProfileContent.tsx");
    expect(profile).toContain("<VideoPlayerOverlay");
    expect(profile).toContain("posterUrl={selection.sourceUri}");
    expect(profile).toContain("videoUrl={selection.media.url}");
    expect(profile).not.toContain("function MomentVideo");
    expect(expo("src/app/user-profile.tsx")).toContain("<PublicProfileContent");
    expect(expo("src/app/moments.tsx")).toContain("<MediaViewer");
    expect(expo("src/app/moment-detail.tsx")).toContain("<MediaViewer");
  });

  it("waits for full-screen presentation and keeps one player through async source activation", () => {
    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    const config = expo("app.config.ts");
    expect(player).toContain('presentationStyle="overFullScreen"');
    expect(player).toContain("statusBarTranslucent");
    expect(player).toContain("transparent");
    expect(player).toContain('root: { flex: 1, backgroundColor: "transparent" }');
    expect(player).toContain("onShow={() => setPresented(true)}");
    expect(player).toContain("if (!videoUrl) return null");
    expect(player).toContain("{isPresented ? (");
    expect(player).toContain("<StatusBar hidden />");
    expect(player).toContain('backdrop: { backgroundColor: "#000000" }');
    expect(player).toContain("useVideoPlayer(null");
    expect(player).toContain(".replaceAsync(preparedSource)");
    expect(player).toContain("preparedSource && !didFail");
    expect(player).toContain("setHasRenderedFirstFrame(true)");
    expect(player).toContain("<VideoOpeningPlaceholder posterUrl={posterUrl} />");
    expect(player).toContain("<VideoPoster posterUrl={posterUrl} />");
    expect(player).toContain('status !== "readyToPlay"');
    expect(player).toContain("playVideoPlayer(player)");
    expect(player).toContain("pauseVideoPlayer(player)");
    expect(player).not.toContain("useEffect(() => () => pauseVideoPlayer(player)");
    expect(player).toContain("preferredForwardBufferDuration: 2");
    expect(player).toContain("waitsToMinimizeStalling: true");
    expect(player).toContain("keepScreenOnWhilePlaying = true");
    expect(player).toContain("staysActiveInBackground = false");
    expect(player).toContain('audioMixingMode = "doNotMix"');
    expect(config).toContain('UIBackgroundModes: ["remote-notification", "audio"]');
    expect(config).toContain('["expo-video", { supportsBackgroundPlayback: true }]');
    expect(player).not.toContain("AppState");
  });

  it("keeps playback instance-local: native controls scrub, but reopen starts a new player", () => {
    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    expect(player).toContain("nativeControls");
    expect(player).toContain("<VideoPlayerPresentation");
    expect(player).toContain("key={videoUrl}");
    expect(player).not.toContain("currentTime");
    expect(player).not.toContain("AsyncStorage");
    expect(player).not.toContain("seekBy");
  });

  it("closes the presentation on an owner generation change and rejects stale source work", () => {
    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    expect(player).toContain('trimFoundationWhitespacesAndNewlines(user?.user_id ?? "")');
    expect(player).toContain("const [ownerAtOpen] = useState(ownerId)");
    expect(player).toContain("const isCurrentOwner = ownerAtOpen === ownerId");
    expect(player).toContain("if (!isCurrentOwner) onClose()");
    expect(player).toContain("if (!isCurrentOwner) return null");
    expect(player).toContain("let active = true");
    expect(player).toContain("if (active) {");
    expect(player).toContain("setSourceState({");
    expect(player).toContain("active = false");
  });

  it("matches native URL construction for public, absolute and server-relative video shapes", () => {
    const api = "https://api.example.com/api/v1";
    expect(resolveChatVideoPlaybackUrl("/api/v1/images/u/movie.mp4", api)).toBe(
      "https://api.example.com/api/v1/images/u/movie.mp4",
    );
    expect(resolveChatVideoPlaybackCandidates("/api/v1/images/u/movie.mp4", api)).toEqual([
      "https://api.example.com/api/v1/images/u/movie.mp4",
      "https://api.example.com/api/v1/public/images/u/movie.mp4",
    ]);
    expect(resolveChatVideoPlaybackUrl("https://cdn.example.com/movie.mp4", api)).toBe(
      "https://cdn.example.com/movie.mp4",
    );
    expect(
      resolveChatVideoPlaybackUrl("http://52.193.78.191/api/v1/images/u/movie.mp4?revision=2", api),
    ).toBe("https://api.example.com/api/v1/images/u/movie.mp4?revision=2");
    expect(resolveChatVideoPlaybackUrl("http://untrusted.example/movie.mp4", api)).toBeNull();
    expect(resolveChatVideoPlaybackUrl("/media/movie.mp4", api)).toBe(
      "https://api.example.com/media/movie.mp4",
    );
    expect(resolveChatVideoPlaybackUrl("videos/movie.mp4", api)).toBe(
      "https://api.example.com/api/v1/videos/movie.mp4",
    );
  });

  it("preserves loading, error, native controls and a reliably layered close action", () => {
    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    expect(player).toContain('<ActivityIndicator color="#FFFFFF" />');
    expect(player).toContain('name="exclamationmark.triangle" size={40}');
    expect(player).toContain('t("video.loadFailed")');
    expect(player).toContain('name="xmark.circle.fill" size={28}');
    expect(player).toContain('testID="video-preview-close-button"');
    expect(player).toContain('accessibilityRole="button"');
    expect(player).toContain("useSafeAreaInsets()");
    expect(player).toContain("zIndex: 20, elevation: 20");
    expect(player).toContain('backgroundColor: "rgba(0,0,0,0.52)"');
    expect(player).toContain('surfaceType="textureView"');
    expect(player).toContain("nativeControls");
    expect(player).toContain('animationType="none"');
    expect(player).toContain("allowsVideoFrameAnalysis={false}");
    expect(player).toContain("allowsPictureInPicture={false}");
    expect(player).toContain("startsPictureInPictureAutomatically={false}");
    expect(player).toContain("fullscreenOptions={{ enable: false }}");
    expect(player).not.toContain("react-native-reanimated");
    expect(player).not.toContain("react-native-gesture-handler");
    expect(player).not.toContain("useSharedValue");
    expect(player).not.toContain("useAnimatedStyle");
    expect(player).not.toContain("runOnJS");
    expect(player).not.toContain("GestureDetector");
    expect(player).not.toContain('t("common.retry")');
    expect(player).not.toContain("onRetry");
  });

  it("dismisses on a clearly vertical drag without taking horizontal native scrubbing", () => {
    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    expect(player).toContain("PanResponder.create({");
    expect(player).toContain("onMoveShouldSetPanResponderCapture");
    expect(player).toContain("MEDIA_PULL_DIRECTION_LOCK_DISTANCE");
    expect(player).toContain("mediaPullHasVerticalIntent(gesture.dx, gesture.dy)");
    expect(player).toContain("mediaPullVisualTranslation(translationY)");
    expect(player).toContain("mediaPullDismissDecision(gesture.dy, gesture.vy * 1_000)");
    expect(player).toContain("Animated.timing(verticalDrag");
    expect(player).toContain("duration: MEDIA_PULL_RESTORE_DURATION_MS");
    expect(player).toContain("duration: MEDIA_PULL_DISMISS_DURATION_MS");
    expect(player).toContain("Animated.multiply(backdropBaseOpacity, dragBackdropOpacity)");
    expect(player).toContain("useNativeDriver: true");
    expect(player).not.toContain("Animated.spring(");
    expect(player).not.toContain("react-native-reanimated");
    expect(player).not.toContain("react-native-gesture-handler");
  });

  it("contains synchronous player exceptions instead of letting Hermes abort the app", () => {
    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    expect(player).toContain("try {\n      playVideoPlayer(player)");
    expect(player).toContain("setActivationErrorIdentity(attemptIdentity)");
    expect(player).toContain('reportVideoPlayerFailure(error, "video_player_play")');
    expect(player).toContain("try {\n      pauseVideoPlayer(player)");
    expect(player).toContain("} finally {\n      onClose()");
    expect(player).toContain('reportVideoPlayerFailure(error, "video_player_pause")');
    expect(player).toContain('reportVideoPlayerFailure(error, "video_player_replace_sync")');
    expect(player).toContain('reportVideoPlayerFailure(error, "video_player_replace")');
    expect(player).toContain("Monitoring must never turn a recoverable media failure");
  });

  it("shares the image gallery's direction, dead-zone, dismiss and visual-decay contract", () => {
    expect(MEDIA_PULL_DIRECTION_LOCK_DISTANCE).toBe(4);
    expect(MEDIA_PULL_VERTICAL_DIRECTION_RATIO).toBe(1.12);
    expect(MEDIA_PULL_VISUAL_DEAD_ZONE).toBe(18);
    expect(MEDIA_PULL_DISMISS_DISTANCE).toBe(72);
    expect(MEDIA_PULL_MINIMUM_FLICK_DISTANCE).toBe(28);
    expect(MEDIA_PULL_FLICK_VELOCITY).toBe(900);
    expect(MEDIA_PULL_RESTORE_DURATION_MS).toBe(160);
    expect(MEDIA_PULL_DISMISS_DURATION_MS).toBe(240);
    expect(mediaPullHasVerticalIntent(10, 11.2)).toBe(false);
    expect(mediaPullHasVerticalIntent(10, 11.21)).toBe(true);
    expect(mediaPullVisualTranslation(18)).toBe(0);
    expect(mediaPullVisualTranslation(19)).toBe(1);
    expect(mediaPullVisualTranslation(-19)).toBe(-1);
    expect(mediaPullDismissDecision(71, 2_000)).toBe(1);
    expect(mediaPullDismissDecision(27, 2_000)).toBe(0);
    expect(mediaPullDismissDecision(28, 899)).toBe(0);
    expect(mediaPullDismissDecision(28, 900)).toBe(1);
    expect(mediaPullDismissDecision(-72, 0)).toBe(-1);
    expect(mediaPullBackdropOpacity(0)).toBe(1);
    expect(mediaPullBackdropOpacity(320)).toBe(MEDIA_PULL_MINIMUM_BACKDROP_OPACITY);
    expect(mediaPullBackdropOpacity(3_200)).toBe(MEDIA_PULL_MINIMUM_BACKDROP_OPACITY);
    expect(mediaPullDismissScale(32, 800)).toBe(1);
    expect(mediaPullDismissScale(800, 800)).toBe(MEDIA_PULL_MINIMUM_SCALE);
    expect(mediaPullContentOpacity(40, 800)).toBe(1);
    expect(mediaPullContentOpacity(576, 800)).toBe(0);
    expect(mediaPullScaleEndDistance(0)).toBe(33);
    expect(mediaPullContentFadeEndDistance(0)).toBe(41);
  });

  it("adds authorization only to protected same-origin playback", () => {
    const api = "https://api.example.com/api/v1";
    expect(
      videoPlaybackRequiresAuthorization("https://api.example.com/api/v1/videos/a.mp4", api),
    ).toBe(true);
    expect(
      videoPlaybackRequiresAuthorization("https://api.example.com/api/v1/public/images/a.mp4", api),
    ).toBe(false);
    expect(
      videoPlaybackRequiresAuthorization(
        "https://api.example.com/api/v1/moments/image/u005/a.mov",
        api,
      ),
    ).toBe(true);
    expect(videoPlaybackRequiresAuthorization("https://cdn.example.com/a.mp4", api)).toBe(false);
    expect(videoPlaybackRequiresAuthorization("file:///cache/a.mp4", api)).toBe(false);
  });

  it("refreshes protected playback with a one-byte Range probe before AVPlayer", async () => {
    const { cancel, response } = videoProbeResponse();
    resourceRequest.mockResolvedValue(response);
    accessToken.mockResolvedValue("fresh-access-token");
    const uri = "https://api.example.com/api/v1/videos/private.mp4";

    await expect(
      prepareVideoPlaybackSource(uri, "https://api.example.com/api/v1"),
    ).resolves.toEqual({
      uri,
      headers: { Authorization: "Bearer fresh-access-token" },
    });
    expect(resourceRequest).toHaveBeenCalledWith(uri, {
      auth: true,
      headers: { Range: "bytes=0-0" },
      timeoutMs: 30_000,
      transientRetries: false,
    });
    expect(videoRangeProbeHeader).toBe("bytes=0-0");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(accessToken).toHaveBeenCalledTimes(1);
  });

  it("forwards lifecycle cancellation to the protected Range probe", async () => {
    const controller = new AbortController();
    resourceRequest.mockResolvedValue(videoProbeResponse().response);
    accessToken.mockResolvedValue("fresh-access-token");
    const uri = "https://api.example.com/api/v1/videos/private.mp4";

    await prepareVideoPlaybackSource(uri, "https://api.example.com/api/v1", controller.signal);
    expect(resourceRequest).toHaveBeenCalledWith(uri, {
      auth: true,
      headers: { Range: "bytes=0-0" },
      timeoutMs: 30_000,
      transientRetries: false,
      signal: controller.signal,
    });

    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    expect(player).toContain("const controller = new AbortController()");
    expect(player).toContain("if (!active) return");
    expect(player).toContain("controller.abort()");
  });

  it("probes public and cross-origin playback without exposing the account token", async () => {
    const api = "https://api.example.com/api/v1";
    resourceRequest.mockResolvedValue(videoProbeResponse().response);
    for (const uri of [
      "https://api.example.com/api/v1/public/images/a.mp4",
      "https://cdn.example.com/a.mp4",
    ]) {
      await expect(prepareVideoPlaybackSource(uri, api)).resolves.toEqual({
        uri,
      });
    }
    await expect(prepareVideoPlaybackSource("file:///cache/a.mp4", api)).resolves.toEqual({
      uri: "file:///cache/a.mp4",
    });
    expect(resourceRequest).toHaveBeenCalledTimes(2);
    for (const call of resourceRequest.mock.calls) expect(call[1]).toMatchObject({ auth: false });
    expect(accessToken).not.toHaveBeenCalled();
    expect(expo("src/services/media/VideoPlaybackSource.ts")).not.toContain("useCaching");
  });

  it("falls back from an explicit missing public alias to the authenticated original path", async () => {
    const api = "https://api.example.com/api/v1";
    const candidates = resolveChatVideoPlaybackCandidates("/api/v1/public/images/u/a.mp4", api);
    resourceRequest
      .mockRejectedValueOnce(new Error("public alias returned 404"))
      .mockResolvedValueOnce(videoProbeResponse().response);
    accessToken.mockResolvedValue("fallback-token");

    await expect(prepareFirstPlayableVideoSource(candidates, api)).resolves.toEqual({
      uri: "https://api.example.com/api/v1/images/u/a.mp4",
      source: {
        uri: "https://api.example.com/api/v1/images/u/a.mp4",
        headers: { Authorization: "Bearer fallback-token" },
      },
    });
    expect(resourceRequest.mock.calls[0]?.[1]).toMatchObject({ auth: false });
    expect(resourceRequest.mock.calls[1]?.[1]).toMatchObject({ auth: true });
  });

  it("retries a failed local file as authenticated streaming before advancing candidates", () => {
    const initial = { allowCache: true, candidateIndex: 0, generation: 0 };
    expect(nextChatVideoPlaybackAttempt(initial, "local", 0, 2)).toEqual({
      allowCache: false,
      candidateIndex: 0,
      generation: 1,
    });
    expect(
      nextChatVideoPlaybackAttempt(
        { allowCache: false, candidateIndex: 0, generation: 1 },
        "remote",
        0,
        2,
      ),
    ).toEqual({ allowCache: false, candidateIndex: 1, generation: 2 });
    expect(
      nextChatVideoPlaybackAttempt(
        { allowCache: false, candidateIndex: 1, generation: 2 },
        "remote",
        1,
        2,
      ),
    ).toBeNull();

    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    expect(player).toContain("nextChatVideoPlaybackAttempt(");
    expect(player).toContain("playbackCandidates.slice(candidateIndex)");
    expect(player).toContain('kind: "local"');
    expect(player).toContain('let kind: "local" | "remote" = "remote"');
    expect(player).toContain("handledFailureIdentityRef.current === attemptIdentity");
    expect(player).toContain("!hasRenderedFirstFrame");
  });

  it("rejects JSON error bodies even when a proxy returns a successful status", async () => {
    resourceRequest.mockResolvedValue(videoProbeResponse("application/json").response);
    await expect(
      prepareVideoPlaybackSource(
        "https://api.example.com/api/v1/public/images/not-a-video.mp4",
        "https://api.example.com/api/v1",
      ),
    ).rejects.toThrow("非媒体内容");
  });

  it("rejects malformed partial responses before they reach AVPlayer", async () => {
    resourceRequest.mockResolvedValue(
      videoProbeResponse("video/mp4", 206, { "content-range": null }).response,
    );
    await expect(
      prepareVideoPlaybackSource(
        "https://api.example.com/api/v1/public/images/broken.mp4",
        "https://api.example.com/api/v1",
      ),
    ).rejects.toThrow("Content-Range");
  });

  it("accepts standard application MP4 MIME aliases", async () => {
    const api = "https://api.example.com/api/v1";
    accessToken.mockResolvedValue("token");
    for (const contentType of ["application/mp4", "application/x-mp4"]) {
      resourceRequest.mockResolvedValueOnce(videoProbeResponse(contentType).response);
      await expect(
        prepareVideoPlaybackSource("https://api.example.com/api/v1/images/u/a.mp4", api),
      ).resolves.toMatchObject({ uri: "https://api.example.com/api/v1/images/u/a.mp4" });
    }
  });

  it("marks HLS explicitly while sharing the refreshed authorization lifecycle", async () => {
    resourceRequest.mockResolvedValue(videoProbeResponse("application/vnd.apple.mpegurl").response);
    accessToken.mockResolvedValue("hls-token");
    const uri = "https://api.example.com/api/v1/videos/master.M3U8?version=2";
    await expect(
      prepareVideoPlaybackSource(uri, "https://api.example.com/api/v1"),
    ).resolves.toEqual({
      uri,
      contentType: "hls",
      headers: { Authorization: "Bearer hls-token" },
    });
  });

  it("uses a fresh cache namespace and downloads protected MP4 before AVPlayer", () => {
    const cache = expo("src/services/cache/MediaCacheService.ts");
    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    expect(cache).toContain(
      "prepareVideoAuthorizationHeaders(remoteUrl, undefined, authorizationPolicy, signal)",
    );
    expect(cache).toContain("File.downloadFileAsync(remoteUrl, partial");
    expect(cache).toContain("scheduleDelayMilliseconds: 5_000");
    expect(cache).toContain("minimumFreeSpaceBytes: 2 * 1_024 * 1_024 * 1_024");
    expect(cache).toContain("maximumSingleFileBytes: 512 * 1_024 * 1_024");
    expect(cache).toContain("staleAgeMilliseconds: 30 * 24 * 60 * 60 * 1_000");
    expect(cache).toContain("adaptiveBudgetFraction: 0.15");
    expect(player).toContain("const authenticatedLocalUri = await cacheMediaFile({");
    expect(player).toContain('authorizationPolicy: "required"');
    expect(player).toContain("signal: controller.signal");
    expect(player).toContain("Boolean(prepared.source.headers)");
    expect(player).toContain('authorizationPolicy: "required"');
    expect(player).toContain("if (!active) return;");
    expect(player).not.toContain("scheduleMediaCache");
    expect(player).not.toContain("scheduleResolvedMediaCache");
    expect(player).not.toContain("scheduledCacheCancellation");
    expect(chatVideoMediaCacheId(" /api/v1/images/u/movie.mp4 ")).toBe(
      "chat-video:v4:/api/v1/images/u/movie.mp4",
    );
  });

  it("keeps the 2 GiB reserve and caps one cached video at 512 MiB", () => {
    const reserve = mediaCachePolicy.minimumFreeSpaceBytes;
    const maximum = mediaCachePolicy.maximumSingleFileBytes;
    expect(mediaCacheDownloadByteLimit(Number.NaN)).toBe(0);
    expect(mediaCacheDownloadByteLimit(reserve)).toBe(0);
    expect(mediaCacheDownloadByteLimit(reserve + 123)).toBe(123);
    expect(mediaCacheDownloadByteLimit(reserve + maximum + 1_000_000)).toBe(maximum);

    const cache = expo("src/services/cache/MediaCacheService.ts");
    expect(cache).toContain("bytesWritten > byteLimit");
    expect(cache).toContain("downloaded.size > byteLimit");
    expect(cache).toContain("download.controller.abort");
    expect(cache).toContain("await Promise.allSettled(activeDownloads");
    expect(cache).toContain("const generation = currentMediaCacheGeneration(owner)");
    expect(cache).toContain("ownerGenerations.set(owner");
    expect(cache).toContain("globalGeneration += 1");
    expect(cache).toContain("mediaCacheGenerationIsCurrent(owner, generation)");
  });

  it("rejects cached HTTP error bodies and accepts supported video containers", () => {
    const mp4 = Uint8Array.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ]);
    const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]);
    const json = Uint8Array.from([0x20, 0x0a, 0x7b, 0x22, 0x65, 0x72, 0x72, 0x6f, 0x72, 0x22]);
    const html = Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]);

    expect(mediaFileHeaderLooksPlayable("https://api.example.com/video.mp4", mp4, 8_000_000)).toBe(
      true,
    );
    expect(mediaFileHeaderLooksPlayable("https://signed.example/object", mp4, 8_000_000)).toBe(
      true,
    );
    expect(mediaFileHeaderLooksPlayable("https://cdn.example.com/video.webm", webm, 4_000)).toBe(
      true,
    );
    expect(mediaFileHeaderLooksPlayable("https://api.example.com/video.mp4", json, 512)).toBe(
      false,
    );
    expect(mediaFileHeaderLooksPlayable("https://signed.example/object", html, 512)).toBe(false);
    expect(mediaFileHeaderLooksPlayable("https://api.example.com/video.mp4", mp4, 8)).toBe(false);
    expect(expo("src/services/cache/MediaCacheService.ts")).toContain(
      "Downloaded media failed container validation",
    );
  });

  it("implements the native background MP4 and offline HLS movpkg cache instead of claiming online HLS caching", () => {
    const native = expo("modules/bwchat-media-cache/ios/BWChatMediaCacheModule.swift");
    const moduleConfig = expo("modules/bwchat-media-cache/expo-module.config.json");
    const bridge = expo("modules/bwchat-media-cache/src/index.ts");
    const cache = expo("src/services/cache/MediaCacheService.ts");
    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    const expoVideoTypes = source(
      resolve(root, "node_modules/expo-video/src/VideoPlayer.types.ts"),
    );

    expect(expoVideoTypes).toContain("the cache cannot be used with HLS video sources on iOS");
    expect(native).toContain("URLSessionConfiguration.background(withIdentifier: identifier)");
    expect(native).toContain("AVAssetDownloadURLSession(");
    expect(native).toContain('pending.isHLS ? "movpkg"');
    expect(native).toContain("task.taskDescription = taskDescription");
    expect(native).toContain("session.getAllTasks");
    expect(native).toContain("handleEventsForBackgroundURLSession identifier");
    expect(native).toContain("urlSessionDidFinishEvents(forBackgroundURLSession");
    expect(native).toContain('["AVURLAssetHTTPHeaderFieldsKey": $0]');
    expect(native).toContain("configuration.waitsForConnectivity = true");
    expect(native).toContain("configuration.isDiscretionary = false");
    expect(native).toContain("FileProtectionType.completeUntilFirstUserAuthentication");
    expect(native).toContain("return available > 2 * 1_024 * 1_024 * 1_024");
    expect(native).toContain("now.addingTimeInterval(-30 * 24 * 60 * 60)");
    expect(native).toContain("5 * 1_024 * 1_024 * 1_024");
    expect(native).toContain("512 * 1_024 * 1_024");
    expect(native).toContain("Double(max(available + totalBytes, 0)) * 0.15");
    expect(moduleConfig).toContain('"BWChatMediaCacheAppDelegateSubscriber"');
    expect(bridge).toContain(
      'requireOptionalNativeModule<BWChatMediaCacheNativeModule>("BWChatMediaCache")',
    );
    expect(cache).toContain("isHlsMediaUrl(remoteUrl) && !hasNativeMediaCache()");
    expect(cache).toContain("startNativeMediaCache({");
    expect(player).toContain("source: { uri: localUri }");
    expect(player).not.toContain("? { uri: localUri, useCaching: true }");
  });
});

function expo(path: string): string {
  return source(resolve(root, path));
}

function videoProbeResponse(
  contentType = "video/mp4",
  status = 206,
  overrides: Record<string, string | null> = {},
) {
  const cancel = jest.fn().mockResolvedValue(undefined);
  const headers: Record<string, string | null> = {
    "content-type": contentType,
    "content-length": status === 206 ? "1" : "8000000",
    "content-range": status === 206 ? "bytes 0-0/8000000" : null,
    ...overrides,
  };
  const response = {
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    body: { cancel },
  } as unknown as Response;
  return { cancel, response };
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(source(path)).digest("hex");
}
