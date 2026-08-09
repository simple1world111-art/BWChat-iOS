import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { authenticatedResourceRequest } from "@/api/client";
import {
  predictedVideoTranslation,
  resolveChatVideoPlaybackUrl,
  shouldDismissVideo,
  VIDEO_DISMISS_DISTANCE,
  VIDEO_MINIMUM_SCALE,
  VIDEO_PAN_MINIMUM_DISTANCE,
  VIDEO_PREDICTED_DISMISS_DISTANCE,
  VIDEO_REST_SCALE_LIMIT,
  videoBackgroundOpacity,
  videoDismissScale,
} from "@/components/media/videoPlayerMath";
import {
  prepareVideoPlaybackSource,
  videoPlaybackRequiresAuthorization,
  videoRangeProbeHeader,
} from "@/services/media/VideoPlaybackSource";
import { readAccessToken } from "@/storage/tokenStorage";

jest.mock("@/api/client", () => ({ authenticatedResourceRequest: jest.fn() }));
jest.mock("@/storage/tokenStorage", () => ({ readAccessToken: jest.fn() }));

const resourceRequest = jest.mocked(authenticatedResourceRequest);
const accessToken = jest.mocked(readAccessToken);
const root = resolve(__dirname, "..");
const copiedNativePath = resolve(root, "../BWChat/Views/VideoPlayerView.swift");
const originalNativePath = resolve(root, "../../BWChat-iOS/BWChat/Views/VideoPlayerView.swift");
const nativeHash = "ab6309d94c607f33317492c1b699896f3f7a2ee455fcb963865a67c3981cf3b2";
const copiedNativeCachePath = resolve(root, "../BWChat/Managers/MediaCacheManager.swift");
const originalNativeCachePath = resolve(
  root,
  "../../BWChat-iOS/BWChat/Managers/MediaCacheManager.swift",
);
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
    expect(player).toContain('presentationStyle="fullScreen"');
    expect(player).toContain("onShow={() => setPresented(true)}");
    expect(player).toContain("if (!videoUrl) return null");
    expect(player).toContain("{isPresented ? (");
    expect(player).toContain("<StatusBar hidden />");
    expect(player).toContain('backdrop: { backgroundColor: "#000000" }');
    expect(player).toContain("useVideoPlayer(null");
    expect(player).toContain("player.replaceAsync(preparedSource)");
    expect(player).toContain("preparedSource && !didFail");
    expect(player).toContain("onFirstFrameRender={() => setHasRenderedFirstFrame(true)}");
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
    expect(player).toContain("if (active) setSourceState");
    expect(player).toContain("active = false");
  });

  it("matches native URL construction for public, absolute and server-relative video shapes", () => {
    const api = "https://api.example.com/api/v1";
    expect(resolveChatVideoPlaybackUrl("/api/v1/images/u/movie.mp4", api)).toBe(
      "https://api.example.com/api/v1/public/images/u/movie.mp4",
    );
    expect(resolveChatVideoPlaybackUrl("https://cdn.example.com/movie.mp4", api)).toBe(
      "https://cdn.example.com/movie.mp4",
    );
    expect(resolveChatVideoPlaybackUrl("/media/movie.mp4", api)).toBe(
      "https://api.example.com/media/movie.mp4",
    );
    expect(resolveChatVideoPlaybackUrl("videos/movie.mp4", api)).toBe(
      "https://api.example.com/api/v1/videos/movie.mp4",
    );
  });

  it("preserves loading, error, close and native controls without a crash-prone display-link graph", () => {
    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    expect(player).toContain('<ActivityIndicator color="#FFFFFF" />');
    expect(player).toContain('name="exclamationmark.triangle" size={40}');
    expect(player).toContain('t("video.loadFailed")');
    expect(player).toContain('name="xmark.circle.fill" size={28}');
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

  it("contains synchronous player exceptions instead of letting Hermes abort the app", () => {
    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    expect(player).toContain("try {\n      playVideoPlayer(player)");
    expect(player).toContain("setActivationErrorIdentity(sourceIdentity)");
    expect(player).toContain('reportVideoPlayerFailure(error, "video_player_play")');
    expect(player).toContain("try {\n      pauseVideoPlayer(player)");
    expect(player).toContain("} finally {\n      onClose()");
    expect(player).toContain('reportVideoPlayerFailure(error, "video_player_pause")');
    expect(player).toContain('reportVideoPlayerFailure(error, "video_player_replace_sync")');
    expect(player).toContain('reportVideoPlayerFailure(error, "video_player_replace")');
    expect(player).toContain("Monitoring must never turn a recoverable media failure");
  });

  it("preserves the exact zoom, intent, dismiss and visual-decay thresholds", () => {
    expect(VIDEO_MINIMUM_SCALE).toBe(0.5);
    expect(VIDEO_REST_SCALE_LIMIT).toBe(1.05);
    expect(VIDEO_PAN_MINIMUM_DISTANCE).toBe(10);
    expect(VIDEO_DISMISS_DISTANCE).toBe(110);
    expect(VIDEO_PREDICTED_DISMISS_DISTANCE).toBe(450);
    expect(videoBackgroundOpacity(320)).toBeCloseTo(0.1);
    expect(videoDismissScale(7.99)).toBe(1);
    expect(videoDismissScale(900)).toBe(0.55);
    expect(predictedVideoTranslation(30, 2_100)).toBe(450);
    expect(
      shouldDismissVideo({ translationX: 0, translationY: 110, predictedTranslationY: 450 }),
    ).toBe(false);
    expect(
      shouldDismissVideo({
        translationX: 0,
        translationY: 110.01,
        predictedTranslationY: 0,
      }),
    ).toBe(true);
    expect(
      shouldDismissVideo({
        translationX: 1,
        translationY: 2,
        predictedTranslationY: 450.01,
      }),
    ).toBe(true);
    expect(
      shouldDismissVideo({ translationX: 3, translationY: 2, predictedTranslationY: 900 }),
    ).toBe(false);
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
    ).toBe(false);
    expect(videoPlaybackRequiresAuthorization("https://cdn.example.com/a.mp4", api)).toBe(false);
    expect(videoPlaybackRequiresAuthorization("file:///cache/a.mp4", api)).toBe(false);
  });

  it("refreshes protected playback with a one-byte Range probe before AVPlayer", async () => {
    const cancel = jest.fn().mockResolvedValue(undefined);
    resourceRequest.mockResolvedValue({ body: { cancel } } as unknown as Response);
    accessToken.mockResolvedValue("fresh-access-token");
    const uri = "https://api.example.com/api/v1/videos/private.mp4";

    await expect(
      prepareVideoPlaybackSource(uri, "https://api.example.com/api/v1"),
    ).resolves.toEqual({
      uri,
      headers: { Authorization: "Bearer fresh-access-token" },
      useCaching: true,
    });
    expect(resourceRequest).toHaveBeenCalledWith(uri, {
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
    resourceRequest.mockResolvedValue({ body: null } as unknown as Response);
    accessToken.mockResolvedValue("fresh-access-token");
    const uri = "https://api.example.com/api/v1/videos/private.mp4";

    await prepareVideoPlaybackSource(uri, "https://api.example.com/api/v1", controller.signal);
    expect(resourceRequest).toHaveBeenCalledWith(uri, {
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

  it("leaves public and cross-origin playback header-free while enabling streaming cache", async () => {
    const api = "https://api.example.com/api/v1";
    for (const uri of [
      "https://api.example.com/api/v1/public/images/a.mp4",
      "https://api.example.com/api/v1/moments/image/u005/a.mov",
      "https://cdn.example.com/a.mp4",
    ]) {
      await expect(prepareVideoPlaybackSource(uri, api)).resolves.toEqual({
        uri,
        useCaching: true,
      });
    }
    await expect(prepareVideoPlaybackSource("file:///cache/a.mp4", api)).resolves.toEqual({
      uri: "file:///cache/a.mp4",
    });
    expect(resourceRequest).not.toHaveBeenCalled();
    expect(accessToken).not.toHaveBeenCalled();
  });

  it("marks HLS explicitly while sharing the refreshed authorization lifecycle", async () => {
    resourceRequest.mockResolvedValue({ body: null } as unknown as Response);
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

  it("starts persistent disk warm-up immediately while retaining the global cache policy", () => {
    const cache = expo("src/services/cache/MediaCacheService.ts");
    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    expect(cache).toContain(
      "prepareVideoAuthorizationHeaders(remoteUrl, undefined, authorizationPolicy)",
    );
    expect(cache).toContain("File.downloadFileAsync(remoteUrl, partial");
    expect(cache).toContain("scheduleDelayMilliseconds: 5_000");
    expect(cache).toContain("minimumFreeSpaceBytes: 2 * 1_024 * 1_024 * 1_024");
    expect(cache).toContain("staleAgeMilliseconds: 30 * 24 * 60 * 60 * 1_000");
    expect(cache).toContain("adaptiveBudgetFraction: 0.15");
    expect(player).toContain("void scheduleMediaCache({");
    expect(player).toContain("remoteUrl: playbackUrl");
    expect(player).toContain("delayMilliseconds: 0");
    expect(player).toContain("the background download should outlive the viewer");
    expect(player).not.toContain("scheduledCacheCancellation");
    expect(player).not.toContain("video_player_cache_cancel");
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
    expect(player).toContain("? { uri: localUri }");
    expect(player).not.toContain("? { uri: localUri, useCaching: true }");
  });
});

function expo(path: string): string {
  return source(resolve(root, path));
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(source(path)).digest("hex");
}
