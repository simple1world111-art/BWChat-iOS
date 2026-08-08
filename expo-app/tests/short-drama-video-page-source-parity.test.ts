import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { authenticatedResourceRequest } from "@/api/client";
import type { ShortDramaVideo } from "@/models";
import { getCachedMediaUri } from "@/services/cache/MediaCacheService";
import {
  prepareShortDramaPlaybackSource,
  resolveShortDramaMediaUrl,
  shortDramaMediaCacheId,
  shortDramaMediaCandidates,
  shouldLoopShortDramaPlayback,
} from "@/services/short-drama/ShortDramaPlaybackSource";
import { readAccessToken } from "@/storage/tokenStorage";

jest.mock("@/api/client", () => ({ authenticatedResourceRequest: jest.fn() }));
jest.mock("@/storage/tokenStorage", () => ({ readAccessToken: jest.fn() }));
jest.mock("@/services/cache/MediaCacheService", () => ({
  getCachedMediaUri: jest.fn(),
  isHlsMediaUrl: (url: string) => url.toLocaleLowerCase().includes(".m3u8"),
}));

const resourceRequest = jest.mocked(authenticatedResourceRequest);
const accessToken = jest.mocked(readAccessToken);
const cachedMediaUri = jest.mocked(getCachedMediaUri);
const root = resolve(__dirname, "..");

const nativeSources = [
  {
    copied: "../BWChat/Views/ShortDramaVideoPage.swift",
    original: "../../BWChat-iOS/BWChat/Views/ShortDramaVideoPage.swift",
    hash: "48b5a6c5dc9962d6118652bd8994998eeba6bcf4ba9108a5bfe6e6b1f41ce662",
  },
  {
    copied: "../BWChat/Views/ShortDramaFeedView.swift",
    original: "../../BWChat-iOS/BWChat/Views/ShortDramaFeedView.swift",
    hash: "61bd4af279a5855af0d3ceadce6c94157be754ee29b142e40919b11274fc5f9d",
  },
  {
    copied: "../BWChat/ViewModels/ShortDramaFeedViewModel.swift",
    original: "../../BWChat-iOS/BWChat/ViewModels/ShortDramaFeedViewModel.swift",
    hash: "747f33afea7bc8ea2178172baf136fba0872b535677498e72d2d8a6b741624c8",
  },
] as const;

describe("native ShortDramaVideoPage complete code-stage parity", () => {
  beforeEach(() => {
    resourceRequest.mockReset();
    accessToken.mockReset();
    cachedMediaUri.mockReset();
    cachedMediaUri.mockResolvedValue(null);
  });

  it("locks the page, pager and playback view model to the audited read-only Swift sources", () => {
    for (const native of nativeSources) {
      expect(sha256(resolve(root, native.copied))).toBe(native.hash);
      const original = resolve(root, native.original);
      if (existsSync(original)) expect(sha256(original)).toBe(native.hash);
    }
  });

  it("matches native candidate order, URL resolution and exact URL de-duplication", () => {
    const api = "https://api.example.com/api/v1";
    expect(resolveShortDramaMediaUrl("/api/v1/media/a.m3u8", api)).toBe(
      "https://api.example.com/api/v1/media/a.m3u8",
    );
    expect(resolveShortDramaMediaUrl("/media/a.mp4", api)).toBe(
      "https://api.example.com/api/v1/media/a.mp4",
    );
    expect(resolveShortDramaMediaUrl("media/a.mp4", api)).toBe(
      "https://api.example.com/api/v1/media/a.mp4",
    );

    expect(
      shortDramaMediaCandidates(
        video({
          hls_url: "/api/v1/media/master.m3u8",
          mp4_url: "/media/fallback.mp4",
          play_url: "/media/fallback.mp4",
        }),
        api,
      ),
    ).toEqual([
      { label: "primary", url: "https://api.example.com/api/v1/media/master.m3u8" },
      { label: "mp4_url", url: "https://api.example.com/api/v1/media/fallback.mp4" },
    ]);
    expect(shortDramaMediaCacheId(" episode/1 ")).toBe("short-drama: episode/1 ");
  });

  it("prefers the account-scoped disk copy for the primary source without leaking auth", async () => {
    cachedMediaUri.mockResolvedValue("file:///cache/episode.mp4");
    const candidate = { label: "primary" as const, url: "https://api.example.com/api/v1/e.mp4" };
    await expect(
      prepareShortDramaPlaybackSource({
        apiBaseUrl: "https://api.example.com/api/v1",
        candidate,
        ownerId: "owner",
        videoId: "episode",
        useLocalPrimary: true,
      }),
    ).resolves.toEqual({ uri: "file:///cache/episode.mp4", useCaching: true });
    expect(cachedMediaUri).toHaveBeenCalledWith("owner", "short-drama:episode");
    expect(resourceRequest).not.toHaveBeenCalled();
  });

  it("refreshes only API-path media auth and marks HLS before native playback", async () => {
    resourceRequest.mockResolvedValue({ body: null } as unknown as Response);
    accessToken.mockResolvedValue("fresh-token");
    const protectedUrl = "https://api.example.com/api/v1/media/master.m3u8?version=2";
    await expect(
      prepareShortDramaPlaybackSource({
        apiBaseUrl: "https://api.example.com/api/v1",
        candidate: { label: "primary", url: protectedUrl },
        ownerId: "owner",
        videoId: "episode",
        useLocalPrimary: true,
      }),
    ).resolves.toEqual({
      uri: protectedUrl,
      useCaching: true,
      contentType: "hls",
      headers: { Authorization: "Bearer fresh-token" },
    });
    expect(resourceRequest).toHaveBeenCalledWith(protectedUrl, {
      headers: { Range: "bytes=0-0" },
      timeoutMs: 30_000,
      transientRetries: false,
    });

    resourceRequest.mockClear();
    accessToken.mockClear();
    const sameHostOutsideApi = "https://api.example.com/private/video.mp4";
    await expect(
      prepareShortDramaPlaybackSource({
        apiBaseUrl: "https://api.example.com/api/v1",
        candidate: { label: "primary", url: sameHostOutsideApi },
        ownerId: "owner",
        videoId: "episode",
        useLocalPrimary: false,
      }),
    ).resolves.toEqual({ uri: sameHostOutsideApi, useCaching: true });
    expect(resourceRequest).not.toHaveBeenCalled();
    expect(accessToken).not.toHaveBeenCalled();
  });

  it("matches the end notification plus 0.35-second near-end loop guards", () => {
    const base = {
      currentTime: 9.75,
      duration: 10,
      isActive: true,
      isManuallyPaused: false,
      isPlaying: true,
      requireNearEnd: true,
    };
    expect(shouldLoopShortDramaPlayback(base)).toBe(true);
    expect(shouldLoopShortDramaPlayback({ ...base, currentTime: 9.749 })).toBe(false);
    expect(shouldLoopShortDramaPlayback({ ...base, duration: 0.5 })).toBe(false);
    expect(shouldLoopShortDramaPlayback({ ...base, isPlaying: false })).toBe(false);
    expect(shouldLoopShortDramaPlayback({ ...base, isManuallyPaused: true })).toBe(false);
    expect(shouldLoopShortDramaPlayback({ ...base, isActive: false })).toBe(false);
    expect(
      shouldLoopShortDramaPlayback({
        ...base,
        currentTime: 0,
        duration: 0,
        isPlaying: false,
        requireNearEnd: false,
      }),
    ).toBe(true);
  });

  it("preserves the first-frame, cover, loading, lock, metadata and no-error-page UI", () => {
    const page = expo("src/app/short-drama-player.tsx");
    expect(page).toContain('contentFit="cover"');
    expect(page).toContain("onFirstFrameRender={markFirstFrame}");
    expect(page).toContain('colors={["#171725", "#000000"]}');
    expect(page).toContain('colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.66)"]}');
    expect(page).toContain("duration: shortDramaFeedMetrics.firstFrameFadeMilliseconds");
    expect(page).toContain("const showLoading =");
    expect(page).toContain("!source || (isPlaybackTarget && !hasFirstFrame)");
    expect(page).not.toContain('status !== "error"');
    expect(page).not.toContain("video.loadFailed");
    expect(page).toContain("shortDramaFeedMetrics.playButtonSize");
    expect(page).toContain("shortDramaFeedMetrics.lockedOuterHorizontalInset");
    expect(page).toContain("shortDramaFeedMetrics.bottomHorizontalInset");
    expect(page).toContain("numberOfLines={3}");
    expect(page).toContain("<ShortDramaActionRail");
  });

  it("preserves audio fallback, explicit double-loop, lifecycle, cache and progress cancellation", () => {
    const page = expo("src/app/short-drama-player.tsx");
    const api = expo("src/api/bwchat.ts");
    const client = expo("src/api/client.ts");
    expect(page).toContain("instance.loop = false");
    expect(page).toContain('useEventListener(player, "sourceLoad"');
    expect(page).toContain("availableAudioTracks.length > 0");
    expect(page).toContain("fallbackPositionRef.current");
    expect(page).toContain('useEventListener(player, "playToEnd"');
    expect(page).toContain("loopPlayback(true, currentTime)");
    expect(page).toContain("progressIntervalSeconds");
    expect(page).toContain("instance.staysActiveInBackground = false");
    expect(page).toContain('AppState.addEventListener("change"');
    expect(page).toContain("shortDramaUpcomingPageIndex(");
    expect(page).toContain("playbackTargetIndexRef.current = index");
    expect(page).toContain("isPlaybackTarget={playbackTargetIndex === index}");
    expect(page).toContain("scheduleMediaCache({");
    expect(page).toContain("cancelScheduledMediaCache(ownerId, shortDramaMediaCacheId(video.id))");
    expect(page).toContain("progressAbortControllersRef.current.get(video.id)?.abort()");
    expect(api).toContain("signal?: AbortSignal | undefined");
    expect(client).toContain('externalSignal?.addEventListener("abort"');
  });

  it("keeps unlock idempotency, shared-wallet reconciliation and accessible ten-language controls", () => {
    const page = expo("src/app/short-drama-player.tsx");
    const rail = expo("src/components/short-drama/ShortDramaActionRail.tsx");
    expect(page).toContain("const wallet = useWallet()");
    expect(page).toContain("unlockKeysRef.current.get(video.id) ?? createIdempotencyKey()");
    expect(page).toContain("await wallet.applyBalance(result.charge.wallet_balance)");
    expect(page).toContain('accessibilityRole="button"');
    expect(page).toContain('accessibilityRole="header"');
    expect(page).toContain("accessibilityElementsHidden={!isPlaybackTarget}");
    expect(page).toContain('accessibilityLiveRegion="polite"');
    expect(rail).toContain("accessibilityState={{ selected: video.creator.followed_by_me }}");
    expect(rail).toContain("accessibilitySelected={video.liked_by_me}");
    for (const language of [
      "de",
      "en",
      "es",
      "fr",
      "ja",
      "ko",
      "pt-BR",
      "ru",
      "zh-Hans",
      "zh-Hant",
    ]) {
      const catalog = JSON.parse(
        source(resolve(root, `src/localization/generated/${language}.json`)),
      ) as Record<string, string>;
      for (const key of [
        "common.back",
        "common.pause",
        "common.play",
        "shortDrama.title",
        "shortDrama.unlock.confirmMessage",
      ])
        expect(catalog[key]).toBeTruthy();
    }
  });

  it("routes HLS persistence through the Apple asset downloader while retaining online fallback", () => {
    const cache = expo("src/services/cache/MediaCacheService.ts");
    expect(cache).toContain("isHlsMediaUrl(remoteUrl)");
    expect(cache).toContain("return () => undefined");
    expect(expo("tests/media-cache-policy.test.ts")).toContain(
      "HLS sources that require the Apple asset downloader",
    );
  });
});

function video(overrides: Partial<ShortDramaVideo> = {}): ShortDramaVideo {
  return {
    id: "episode",
    drama_id: "series",
    creator: {
      user_id: "creator",
      username: "creator",
      nickname: "Creator",
      avatar_url: "",
      followed_by_me: false,
      follows_me: false,
      is_friend: false,
    },
    drama_title: "Drama",
    title: "Episode",
    intro: "Intro",
    cover_url: "",
    play_url: "/video.mp4",
    playback_position_seconds: 0,
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    is_unlocked: true,
    is_owned_by_current_user: false,
    ...overrides,
  };
}

function expo(path: string): string {
  return source(resolve(root, path));
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(source(path)).digest("hex");
}
