import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  getShortDramaFeed,
  getShortDramaSeriesDetail,
  reportShortDramaProgress,
  unlockShortDramaEpisode,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { normalizeShortDramaFeedPage, normalizeShortDramaUnlockResult } from "@/api/normalizers";
import type { ShortDramaFeedPage, ShortDramaVideo } from "@/models";
import {
  loadShortDramaFeed,
  loadShortDramaFeedCache,
  resetShortDramaFeedRepositoryMemoryForAccount,
  saveShortDramaFeedCache,
  shortDramaFeedCacheKey,
} from "@/services/short-drama/ShortDramaFeedRepository";
import {
  appendShortDramaFeedVideos,
  normalizeInitialShortDramaVideos,
  shortDramaFeedMetrics,
  shortDramaFeedScopeIdentity,
  shortDramaRequiresUnlock,
  shortDramaStreamingUrl,
  shortDramaUpcomingPageIndex,
  shortDramaWindowIndices,
  shouldAuthorizeShortDramaMedia,
  shouldLoadMoreShortDramaFeed,
  shouldReportShortDramaProgress,
} from "@/services/short-drama/shortDramaFeedPolicy";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);

describe("native ShortDramaFeedView and ShortDramaVideoPage contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("keeps the source pager, playback, overlay, cache and progress constants", () => {
    expect(shortDramaFeedMetrics).toMatchObject({
      topBarButtonSize: 42,
      topBarSymbolSize: 18,
      topBarTitleSize: 17,
      topBarHorizontalInset: 14,
      topBarTopInset: 8,
      pageWindowRadius: 1,
      pageLimit: 12,
      loadMoreThreshold: 3,
      maximumCachedVideos: 200,
      cacheTtlMilliseconds: 300_000,
      staleRetentionMilliseconds: 2_592_000_000,
      progressMinimumDeltaSeconds: 0.75,
      progressTimeoutMilliseconds: 4_000,
      progressIntervalSeconds: 0.35,
      loopLeadSeconds: 0.25,
      resumeSeekMinimumSeconds: 1,
      firstFrameFadeMilliseconds: 180,
      playButtonSize: 74,
      playButtonSymbolSize: 28,
      lockedGap: 9,
      lockedSymbolSize: 24,
      lockedHorizontalInset: 18,
      lockedVerticalInset: 14,
      lockedRadius: 14,
      lockedOuterHorizontalInset: 36,
      bottomGap: 14,
      bottomHorizontalInset: 16,
      bottomInset: 28,
      metadataGap: 8,
      creatorNameSize: 16,
      dramaTitleSize: 17,
      introSize: 14,
      episodePillHorizontalInset: 10,
      episodePillVerticalInset: 5,
      episodePillSize: 12,
      secondaryTitleSize: 12,
      emptyGap: 14,
      emptySymbolSize: 38,
      emptyTitleSize: 15,
    });
  });

  it("matches source URL precedence, lock predicate, initial filtering and ordering", () => {
    const hls = video("hls", { hls_url: " hls.m3u8 ", play_url: "play.mp4" });
    const playHls = video("play-hls", { play_url: "server/video.M3U8", mp4_url: "fallback.mp4" });
    const mp4 = video("mp4", { play_url: "", mp4_url: "fallback.mp4" });
    expect(shortDramaStreamingUrl(hls)).toBe("hls.m3u8");
    expect(shortDramaStreamingUrl(playHls)).toBe("server/video.M3U8");
    expect(shortDramaStreamingUrl(mp4)).toBe("fallback.mp4");
    expect(shortDramaStreamingUrl(video("raw-play", { play_url: " raw/video.M3U8 " }))).toBe(
      " raw/video.M3U8 ",
    );
    expect(
      shortDramaStreamingUrl(
        video("foundation-blank", { hls_url: "\u0085", play_url: "play.mp4" }),
      ),
    ).toBe("play.mp4");

    const locked = video("locked", {
      episode_number: 1,
      play_url: "",
      unlock_price_gold_coins: 3,
      is_unlocked: false,
    });
    expect(shortDramaRequiresUnlock(locked)).toBe(true);
    expect(
      normalizeInitialShortDramaVideos([
        video("empty", { play_url: "" }),
        video("second", { episode_number: 2 }),
        locked,
      ]).map((item) => item.id),
    ).toEqual(["locked", "second"]);
  });

  it("keeps the source three-player window and general-feed pagination rules", () => {
    expect(shortDramaWindowIndices(0, 5)).toEqual([0, 1]);
    expect(shortDramaWindowIndices(2, 5)).toEqual([1, 2, 3]);
    expect(shortDramaWindowIndices(4, 5)).toEqual([3, 4]);
    expect(shouldLoadMoreShortDramaFeed(6, 10)).toBe(false);
    expect(shouldLoadMoreShortDramaFeed(7, 10)).toBe(true);
    expect(shouldLoadMoreShortDramaFeed(0, 3)).toBe(true);
    expect(
      appendShortDramaFeedVideos(
        [video("a")],
        [
          video("a"),
          video("locked-empty", { play_url: "", unlock_price_gold_coins: 2 }),
          video("b"),
          video("b"),
        ],
      ).map((item) => item.id),
    ).toEqual(["a", "b", "b"]);
    expect(shortDramaUpcomingPageIndex(2 * 800, 800, 2, 5)).toBe(2);
    expect(shortDramaUpcomingPageIndex(2 * 800 + 1, 800, 2, 5)).toBe(3);
    expect(shortDramaUpcomingPageIndex(2 * 800 - 1, 800, 2, 5)).toBe(1);
    expect(shortDramaUpcomingPageIndex(1, 800, 0, 5)).toBe(1);
    expect(shortDramaUpcomingPageIndex(4 * 800 + 20, 800, 4, 5)).toBe(4);
  });

  it("keys the player lifetime by account and every native route input", () => {
    const baseline = shortDramaFeedScopeIdentity(" owner-a ", " series ", " episode ", 1.5);
    expect(baseline).toBe("owner-a\u0000 series \u0000 episode \u00001.5");
    expect(shortDramaFeedScopeIdentity("owner-b", " series ", " episode ", 1.5)).not.toBe(baseline);
    expect(shortDramaFeedScopeIdentity("owner-a", "other", " episode ", 1.5)).not.toBe(baseline);
    expect(shortDramaFeedScopeIdentity("owner-a", " series ", "other", 1.5)).not.toBe(baseline);
    expect(shortDramaFeedScopeIdentity("owner-a", " series ", " episode ", 2)).not.toBe(baseline);
    expect(shortDramaFeedScopeIdentity("owner-a", undefined, undefined, Number.NaN)).toBe(
      "owner-a\u0000\u0000\u00000",
    );
  });

  it("uses a 0.75-second progress delta and only authorizes same-origin API-path media", () => {
    expect(shouldReportShortDramaProgress(1, undefined)).toBe(true);
    expect(shouldReportShortDramaProgress(1.74, 1)).toBe(false);
    expect(shouldReportShortDramaProgress(1.75, 1)).toBe(true);
    expect(shouldReportShortDramaProgress(-1, undefined)).toBe(false);
    expect(
      shouldAuthorizeShortDramaMedia(
        "https://api.example.com/api/v1/video.mp4",
        "https://api.example.com/api/v1",
      ),
    ).toBe(true);
    expect(
      shouldAuthorizeShortDramaMedia(
        "https://api.example.com/api/v10/video.mp4",
        "https://api.example.com/api/v1",
      ),
    ).toBe(false);
    expect(
      shouldAuthorizeShortDramaMedia(
        "https://cdn.example.com/api/v1/video.mp4",
        "https://api.example.com/api/v1",
      ),
    ).toBe(false);
  });

  it("normalizes all native feed aliases plus episode/charge unlock responses", () => {
    expect(
      normalizeShortDramaFeedPage({
        feed: [{ video_id: 7, play_url: "/seven.mp4" }],
        cursor: "next",
      }),
    ).toMatchObject({
      videos: [{ id: "7", play_url: "/seven.mp4" }],
      has_more: true,
      next_cursor: "next",
    });
    expect(normalizeShortDramaFeedPage([{ id: "one", play_url: "/one.mp4" }])).toMatchObject({
      videos: [{ id: "one" }],
      has_more: false,
    });
    expect(
      normalizeShortDramaUnlockResult({
        episode: { id: "paid", play_url: "/paid.mp4", is_unlocked: true },
        charged_activity_cat_food: "\u00852\u0085",
        charged_gold_coins: 3,
        total_charged: 5,
        wallet_balance: walletBalance(),
      }),
    ).toMatchObject({
      video: { id: "paid", is_unlocked: true },
      charge: { charged_activity_cat_food: 2, charged_gold_coins: 3, total_charged: 5 },
    });
    expect(
      normalizeShortDramaUnlockResult({
        video: 7,
        episode: { id: "fallback-episode", play_url: "/fallback.mp4" },
        chargedActivityCatFood: 2,
        chargedGoldCoins: 3,
        totalCharged: 5,
        walletBalance: walletBalance(),
      }),
    ).toEqual({ video: expect.objectContaining({ id: "fallback-episode" }) });
    expect(() =>
      normalizeShortDramaUnlockResult({
        video: { id: "partial-charge", play_url: "/partial.mp4" },
        charged_activity_cat_food: 2,
        wallet_balance: walletBalance(),
      }),
    ).toThrow("钱包余额缺少必需字段");
  });

  it("uses exact feed, four-second progress and idempotent unlock requests", async () => {
    request
      .mockResolvedValueOnce({ videos: [], has_more: false })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ episode: { id: "v/1", play_url: "/v.mp4", is_unlocked: true } });
    await expect(getShortDramaFeed({ limit: 12, cursor: "next value" })).resolves.toEqual({
      videos: [],
      has_more: false,
    });
    await reportShortDramaProgress("v/1", -2, 9.5);
    await expect(unlockShortDramaEpisode("v/1", "same-key")).resolves.toMatchObject({
      video: { id: "v/1", is_unlocked: true },
    });
    expect(request.mock.calls).toEqual([
      [
        "/short-drama/feed?limit=12&cursor=next%20value",
        { requiredData: true, requiredEnvelope: true },
      ],
      [
        "/short-drama/videos/v%2F1/progress",
        {
          method: "POST",
          requiredEnvelope: true,
          timeoutMs: 4_000,
          body: { position_seconds: 0, duration_seconds: 9.5 },
        },
      ],
      [
        "/short-drama/videos/v%2F1/unlock",
        {
          method: "POST",
          headers: { "Idempotency-Key": "same-key" },
          body: { idempotency_key: "same-key" },
          requiredData: true,
          requiredEnvelope: true,
        },
      ],
    ]);
  });

  it("requires the native wrapper and data for a series-backed feed", async () => {
    request.mockResolvedValueOnce({
      id: "series/one",
      title: "Series",
      intro: "",
      cover_url: "",
      creator: { user_id: "creator" },
      episodes: [],
    });
    await expect(getShortDramaSeriesDetail("series/one")).resolves.toMatchObject({
      series_id: "series/one",
      episodes: [],
    });
    expect(request).toHaveBeenCalledWith("/short-drama/series/series%2Fone", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("passes the latest progress cancellation signal into the four-second request", async () => {
    request.mockResolvedValueOnce(null);
    const controller = new AbortController();
    await reportShortDramaProgress("episode", 2.5, undefined, controller.signal);
    expect(request).toHaveBeenCalledWith("/short-drama/videos/episode/progress", {
      method: "POST",
      requiredEnvelope: true,
      timeoutMs: 4_000,
      signal: controller.signal,
      body: { position_seconds: 2.5 },
    });
  });

  it("isolates feed cache by account and series with 5-minute TTL, 30-day retention and 200 cap", async () => {
    const now = Date.UTC(2026, 7, 7);
    const page: ShortDramaFeedPage = {
      videos: Array.from({ length: 205 }, (_, index) => video(String(index))),
      has_more: true,
      next_cursor: "next",
    };
    await saveShortDramaFeedCache("owner/a", "series/b", page, now);
    expect(shortDramaFeedCacheKey("owner/a", "series/b")).toBe(
      "bwchat.short-drama-feed-v1:account:owner%2Fa:series:series%2Fb",
    );
    expect((await loadShortDramaFeedCache("owner/a", "series/b", now + 299_999))?.isStale).toBe(
      false,
    );
    const stale = await loadShortDramaFeedCache("owner/a", "series/b", now + 300_000);
    expect(stale?.isStale).toBe(true);
    expect(stale?.value.videos).toHaveLength(200);
    expect(await loadShortDramaFeedCache("other", "series/b", now)).toBeNull();
    const rawExpired = await loadShortDramaFeedCache(
      "owner/a",
      "series/b",
      now + 300_000 + shortDramaFeedMetrics.staleRetentionMilliseconds + 1,
    );
    expect(rawExpired).toMatchObject({ isRetained: false, isStale: true });
    expect(rawExpired?.value.videos).toHaveLength(200);
  });

  it("does not let stale corrupt-cache cleanup delete a concurrently replaced snapshot", async () => {
    const key = shortDramaFeedCacheKey("owner", undefined);
    const replacement = JSON.stringify({
      value: { videos: [video("replacement")], has_more: false },
      updatedAt: 1,
      expiresAt: 2,
    });
    const get = jest.mocked(AsyncStorage.getItem);
    const originalGet = get.getMockImplementation();
    get.mockClear();
    get.mockResolvedValueOnce("not-json").mockResolvedValueOnce(replacement);
    const remove = jest.mocked(AsyncStorage.removeItem);
    remove.mockClear();

    await expect(loadShortDramaFeedCache("owner", undefined, 1)).resolves.toBeNull();
    expect(get).toHaveBeenNthCalledWith(1, key);
    expect(get).toHaveBeenNthCalledWith(2, key);
    expect(remove).not.toHaveBeenCalled();
    if (originalGet) get.mockImplementation(originalGet);
  });

  it("returns fresh cache without fetching and falls back to retained stale cache", async () => {
    const now = Date.now();
    const page = { videos: [video("cached")], has_more: false };
    await saveShortDramaFeedCache("owner", undefined, page, now);
    const freshFetch = jest.fn(async () => ({ videos: [video("remote")], has_more: false }));
    await expect(loadShortDramaFeed("owner", undefined, freshFetch)).resolves.toEqual(page);
    expect(freshFetch).not.toHaveBeenCalled();

    await saveShortDramaFeedCache(
      "owner",
      undefined,
      page,
      now - shortDramaFeedMetrics.cacheTtlMilliseconds,
    );
    const failingFetch = jest.fn(async (): Promise<ShortDramaFeedPage> => {
      throw new Error("offline");
    });
    await expect(loadShortDramaFeed("owner", undefined, failingFetch)).resolves.toEqual(page);
    expect(failingFetch).toHaveBeenCalledTimes(1);

    await saveShortDramaFeedCache(
      "expired-owner",
      undefined,
      page,
      now -
        shortDramaFeedMetrics.cacheTtlMilliseconds -
        shortDramaFeedMetrics.staleRetentionMilliseconds -
        1,
    );
    await expect(loadShortDramaFeed("expired-owner", undefined, failingFetch)).rejects.toThrow(
      "offline",
    );
  });

  it("coalesces same-account feed refreshes and rejects a pre-reset completion", async () => {
    const sharedPage = { videos: [video("shared")], has_more: false };
    const sharedFetch = jest.fn(async () => sharedPage);
    const [first, second] = await Promise.all([
      loadShortDramaFeed("coalesced-owner", undefined, sharedFetch),
      loadShortDramaFeed("coalesced-owner", undefined, sharedFetch),
    ]);
    expect(first).toEqual(sharedPage);
    expect(second).toEqual(sharedPage);
    expect(sharedFetch).toHaveBeenCalledTimes(1);

    const pending = deferred<ShortDramaFeedPage>();
    const resetFetch = jest.fn(() => pending.promise);
    const oldLoad = loadShortDramaFeed("reset-owner", undefined, resetFetch);
    while (resetFetch.mock.calls.length === 0) await Promise.resolve();
    resetShortDramaFeedRepositoryMemoryForAccount("reset-owner");
    pending.resolve({ videos: [video("old")], has_more: false });
    await expect(oldLoad).rejects.toThrow("repository was reset");
    expect(await loadShortDramaFeedCache("reset-owner", undefined)).toBeNull();
  });
});

function video(id: string, overrides: Partial<ShortDramaVideo> = {}): ShortDramaVideo {
  return {
    id,
    drama_id: "series",
    creator: {
      user_id: "creator",
      username: "creator",
      nickname: "创作者",
      avatar_url: "",
      followed_by_me: false,
      follows_me: false,
      is_friend: false,
    },
    drama_title: "短剧",
    title: "分集",
    intro: "简介",
    cover_url: "",
    play_url: "/video.mp4",
    playback_position_seconds: 0,
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    is_unlocked: false,
    is_owned_by_current_user: false,
    ...overrides,
  };
}

function walletBalance() {
  return {
    currency: "GOLD_COIN",
    gold_coin_balance: 10,
    activity_cat_food_balance: 2,
    spendable_balance: 12,
    chat_money_frozen_gold_coin_balance: 0,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
