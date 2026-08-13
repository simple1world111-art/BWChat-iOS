import AsyncStorage from "@react-native-async-storage/async-storage";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  getShortDramaFeed,
  getShortDramaSeriesDetail,
  getShortDramaSeriesFeed,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { normalizeShortDramaSeriesPage } from "@/api/normalizers";
import type { ShortDramaSeries, ShortDramaSeriesPage, ShortDramaVideo } from "@/models";
import {
  readShortDramaHistory,
  resetShortDramaHistoryRepositoryMemoryForAccount,
  saveShortDramaHistory,
  shortDramaHistoryKey,
  subscribeShortDramaHistory,
} from "@/services/short-drama/ShortDramaHistoryRepository";
import {
  coalesceShortDramaSeriesInitialLoad,
  loadCachedShortDramaSeriesPage,
  resetShortDramaSeriesRepositoryMemoryForAccount,
  saveCachedShortDramaSeriesPage,
  shortDramaSeriesCacheKey,
} from "@/services/short-drama/ShortDramaSeriesRepository";
import {
  applyShortDramaHistory,
  groupLegacyShortDramaVideos,
  mergeShortDramaEpisodes,
  mergeUniqueShortDramaSeries,
  shortDramaEpisodePageCount,
  shortDramaEpisodeSlots,
  shortDramaRangeTitle,
  shortDramaSeriesIsBlank,
  shortDramaSeriesMetrics,
  sortedShortDramaEpisodes,
} from "@/services/short-drama/shortDramaSeriesPolicy";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);
const root = resolve(__dirname, "..");
const nativeSources = [
  [
    "../BWChat/Views/ShortDramaSeriesListView.swift",
    "../BWChat/Views/ShortDramaSeriesListView.swift",
    "0290d386ab02d3cfdf41d2ea0c91c6d9943d7e6edba77301e6c2ea751405e8c6",
  ],
  [
    "../BWChat/Models/ShortDrama.swift",
    "../BWChat/Models/ShortDrama.swift",
    "13abb0d63f53893bd48eff56fcf6d40f3bb7d570267280bcae276100344d6a11",
  ],
  [
    "../BWChat/Services/APIService.swift",
    "../BWChat/Services/APIService.swift",
    "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
  ],
  [
    "../BWChat/Services/CacheRepository.swift",
    "../BWChat/Services/CacheRepository.swift",
    "570ed9486b10b8b55ddd6136c04c11a1390a287a14563492c640a6a2f144e117",
  ],
  [
    "../BWChat/Utils/Constants.swift",
    "../BWChat/Utils/Constants.swift",
    "efb8861fbf1461deb01d917c44433516aa2ec7373c11b3dc90e1fede170b16cd",
  ],
  [
    "../BWChat/Utils/Extensions.swift",
    "../BWChat/Utils/Extensions.swift",
    "e625dab1ea95cbd63d74c1e8bf33d4bf3f4a85adbd2001c1b0ca27a99bcc5ce5",
  ],
] as const;

describe("native ShortDramaSeriesListView contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("locks every copied native fact source against the untouched original", () => {
    for (const [copiedPath, originalPath, hash] of nativeSources) {
      expect(sha256(resolve(root, copiedPath))).toBe(hash);
      const original = resolve(root, originalPath);
      if (existsSync(original)) expect(sha256(original)).toBe(hash);
    }
  });

  it("wires the native toolbar, one-shot detail task and exact GET success gates", () => {
    const screen = readFileSync(resolve(root, "src/app/short-drama-series.tsx"), "utf8");
    expect(screen).toContain('colorScheme="light"');
    expect(screen).toContain('PlatformColor("secondarySystemBackgroundColor")');
    expect(screen).toContain('PlatformColor("systemBackgroundColor")');
    expect(screen).toContain("width={shortDramaSeriesMetrics.segmentedWidth}");
    expect(screen).toContain("size={shortDramaSeriesMetrics.createSymbolSize}");
    expect(screen).toContain("initialLoadSeriesIdRef.current = series.series_id");
    expect(screen).toContain("if (detailLoadRef.current) return detailLoadRef.current");
    expect(screen).toContain("testID={`short-drama-episode-${slot.number}`}");

    const api = readFileSync(resolve(root, "src/api/bwchat.ts"), "utf8");
    const start = api.indexOf("export async function getShortDramaSeriesFeed");
    const end = api.indexOf("export async function getShortDramaFeed", start);
    const contract = api.slice(start, end);
    expect(contract).toContain("`/short-drama/series?${query}`");
    expect(contract).toContain("encodeShortDramaQueryValue(options.cursor)");
    expect(contract).toContain("requiredData: true");
    expect(contract).toContain("requiredEnvelope: true");
    expect(contract).not.toContain("new URLSearchParams");
  });

  it("keeps the source navigation, card, episode, cache and pagination constants", () => {
    expect(shortDramaSeriesMetrics).toEqual({
      segmentedWidth: 196,
      createButtonSize: 34,
      createSymbolSize: 18,
      listGap: 14,
      listInset: 16,
      cardInset: 14,
      cardRadius: 16,
      cardBorderWidth: 1,
      headerGap: 10,
      titleStatusGap: 7,
      posterHeight: 131,
      posterRadius: 12,
      episodesTopInset: 14,
      episodesGap: 12,
      episodeColumns: 5,
      episodeGap: 8,
      episodeHeight: 44,
      episodeRadius: 8,
      episodePageSize: 15,
      rangeGap: 20,
      rangeCopyGap: 5,
      rangeTitleSize: 16,
      rangeMinimumWidth: 76,
      rangeUnderlineWidth: 38,
      rangeUnderlineHeight: 3,
      rangeBottomInset: 12,
      lockSymbolSize: 9,
      lockInset: 6,
      statusDotSize: 7,
      statusDotInset: 5,
      creatorDividerTopInset: 14,
      creatorTopInset: 10,
      creatorGap: 10,
      creatorAvatarSize: 44,
      creatorCopySize: 14,
      emptyTopInset: 80,
      emptyGap: 12,
      loadingInset: 28,
      errorHorizontalInset: 12,
      errorVerticalInset: 8,
      errorTopInset: 8,
      pageLimit: 12,
      legacyPageLimit: 60,
      maximumCachedSeries: 200,
      cacheTtlMilliseconds: 300_000,
      staleRetentionMilliseconds: 2_592_000_000,
    });
  });

  it("sorts and merges episodes with source ID replacement semantics", () => {
    const first = video("first", { episode_number: 1, title: "old" });
    const replacement = video("first", { episode_number: 1, title: "new" });
    const second = video("second", { episode_number: 2 });
    const unnumbered = video("z", { episode_number: undefined });
    expect(sortedShortDramaEpisodes([unnumbered, second, first]).map((item) => item.id)).toEqual([
      "first",
      "second",
      "z",
    ]);
    expect(mergeShortDramaEpisodes([first, second], [replacement])).toEqual([replacement, second]);
  });

  it("builds exact 15-episode pages, ranges and unavailable slots", () => {
    const episodes = [video("one", { episode_number: 1 }), video("two", { episode_number: 2 })];
    expect(shortDramaEpisodePageCount(31)).toBe(3);
    expect(shortDramaRangeTitle(0, 31)).toBe("1 – 15");
    expect(shortDramaRangeTitle(2, 31)).toBe("31 – 31");
    const slots = shortDramaEpisodeSlots(episodes, 16, 1);
    expect(slots).toEqual([{ number: 16 }]);
    expect(shortDramaEpisodeSlots(episodes, 0, 0).map((slot) => slot.number)).toEqual([1, 2]);
  });

  it("deduplicates appended series by keeping the first occurrence", () => {
    const original = series("one", [video("one")]);
    const duplicate = { ...original, title: "replacement" };
    const appended = series("two", [video("two")]);
    expect(mergeUniqueShortDramaSeries([original], [duplicate, appended])).toEqual([
      original,
      appended,
    ]);
  });

  it("groups the legacy feed and overlays account-local resume history", () => {
    const first = video("a2", { drama_id: "drama", drama_title: "剧名", episode_number: 2 });
    const second = video("a1", { drama_id: "drama", drama_title: "剧名", episode_number: 1 });
    const standalone = video("solo", { drama_id: "", drama_title: "", title: "单集" });
    const grouped = groupLegacyShortDramaVideos([first, standalone, second], "短剧");
    expect(grouped.map((item) => item.series_id)).toEqual(["drama", "solo"]);
    expect(grouped[0]?.episodes.map((item) => item.id)).toEqual(["a1", "a2"]);
    expect(grouped[1]?.title).toBe("单集");
    expect(
      applyShortDramaHistory(grouped[0]!, {
        drama: {
          series_id: "drama",
          episode_id: "a2",
          position_seconds: 12.5,
          watched_at: "2026-08-07T01:02:03.000Z",
        },
      }),
    ).toMatchObject({
      resume_episode_id: "a2",
      resume_position_seconds: 12.5,
      last_watched_at: "2026-08-07T01:02:03.000Z",
    });
    expect(shortDramaSeriesIsBlank("\u0085\u200B")).toBe(true);
    expect(shortDramaSeriesIsBlank("\uFEFF")).toBe(false);
  });

  it("uses the exact series feed query including encoded cursors", async () => {
    request.mockResolvedValue({ series: [], has_more: false });
    await expect(
      getShortDramaSeriesFeed("watched", { limit: 12, cursor: " next value " }),
    ).resolves.toEqual({ series: [], has_more: false, next_cursor: undefined });
    expect(request).toHaveBeenCalledWith(
      "/short-drama/series?tab=watched&limit=12&cursor=%20next%20value%20",
      { requiredData: true, requiredEnvelope: true },
    );
    await getShortDramaSeriesFeed("recommended", { cursor: "a/b?c&d+=:@,;$" });
    expect(request).toHaveBeenLastCalledWith(
      "/short-drama/series?tab=recommended&limit=12&cursor=a/b?c%26d+%3D:@,;$",
      { requiredData: true, requiredEnvelope: true },
    );
    await getShortDramaSeriesFeed("recommended", { cursor: "\u200B" });
    expect(request).toHaveBeenLastCalledWith("/short-drama/series?tab=recommended&limit=12", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("keeps every list-owned GET route header-auth default, query and required-data contract", async () => {
    request
      .mockResolvedValueOnce({ series: [], has_more: false })
      .mockResolvedValueOnce({ videos: [], has_more: false })
      .mockResolvedValueOnce(series("series/a"));

    await getShortDramaSeriesFeed("recommended", { limit: 12, cursor: "cursor/a?b" });
    await getShortDramaFeed({ limit: 60, cursor: "legacy/a?b" });
    await getShortDramaSeriesDetail("series/a?b");

    // Swift uses authenticated `get` for all three.  No route owns a body,
    // explicit auth override, Idempotency-Key, or success-code gate here.
    expect(request.mock.calls).toEqual([
      [
        "/short-drama/series?tab=recommended&limit=12&cursor=cursor/a?b",
        { requiredData: true, requiredEnvelope: true },
      ],
      [
        "/short-drama/feed?limit=60&cursor=legacy/a?b",
        { requiredData: true, requiredEnvelope: true },
      ],
      ["/short-drama/series/series%2Fa%3Fb", { requiredData: true, requiredEnvelope: true }],
    ]);
  });

  it("decodes only the native ShortDramaStudioPage keys and Foundation cursor semantics", () => {
    expect(
      normalizeShortDramaSeriesPage({
        list: [{ id: "native", creator: { user_id: 7 }, status: "published" }],
        next_cursor: "\u200B",
      }),
    ).toMatchObject({
      series: [{ series_id: "native", creator: { user_id: "7" }, status: "published" }],
      has_more: false,
      next_cursor: "\u200B",
    });
    expect(
      normalizeShortDramaSeriesPage({
        list: [{ id: "camel", creator: { userID: "ignored" }, publishStatus: "published" }],
        hasMore: true,
        nextCursor: "ignored",
      }),
    ).toMatchObject({
      series: [{ series_id: "camel", creator: { user_id: "" }, status: "draft" }],
      has_more: false,
    });
  });

  it("isolates each account and tab cache with 5-minute TTL, 30-day retention and 200 cap", async () => {
    const now = Date.UTC(2026, 7, 7);
    const page: ShortDramaSeriesPage = {
      series: Array.from({ length: 205 }, (_, index) => series(String(index))),
      has_more: true,
      next_cursor: "next",
    };
    await saveCachedShortDramaSeriesPage("owner/a", "watched", page, now);
    expect(shortDramaSeriesCacheKey("owner/a", "watched")).toBe(
      "bwchat.short-drama-series-v1:account:owner%2Fa:filter:watched",
    );
    expect(shortDramaSeriesCacheKey("\u0085owner/a\u200B", "watched")).toBe(
      "bwchat.short-drama-series-v1:account:owner%2Fa:filter:watched",
    );
    expect(
      (await loadCachedShortDramaSeriesPage("owner/a", "watched", now + 299_999))?.isStale,
    ).toBe(false);
    const stale = await loadCachedShortDramaSeriesPage("owner/a", "watched", now + 300_000);
    expect(stale?.isStale).toBe(true);
    expect(stale?.value.series).toHaveLength(200);
    expect(await loadCachedShortDramaSeriesPage("owner/a", "recommended", now)).toBeNull();
    expect(
      await loadCachedShortDramaSeriesPage(
        "owner/a",
        "watched",
        now + 300_000 + shortDramaSeriesMetrics.staleRetentionMilliseconds + 1,
      ),
    ).toBeNull();
  });

  it("coalesces the same account/tab initial request and invalidates it on account reset", async () => {
    const shared = deferred<ShortDramaSeriesPage>();
    const fetch = jest.fn(() => shared.promise);
    const first = coalesceShortDramaSeriesInitialLoad("owner/a", "recommended", fetch);
    const second = coalesceShortDramaSeriesInitialLoad("owner/a", "recommended", fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    shared.resolve({ series: [series("one")], has_more: false });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { series: [series("one")], has_more: false },
      { series: [series("one")], has_more: false },
    ]);

    const obsolete = deferred<ShortDramaSeriesPage>();
    const pending = coalesceShortDramaSeriesInitialLoad(
      "owner/a",
      "watched",
      () => obsolete.promise,
    );
    resetShortDramaSeriesRepositoryMemoryForAccount("owner/a");
    obsolete.resolve({ series: [], has_more: false });
    await expect(pending).rejects.toThrow("repository was reset");
  });

  it("does not let corrupt-cache cleanup delete a newer replacement", async () => {
    const key = shortDramaSeriesCacheKey("owner/a", "recommended");
    const replacement = JSON.stringify({
      value: { series: [series("new")], has_more: false },
      updatedAt: 10,
      expiresAt: 20,
    });
    const get = jest
      .mocked(AsyncStorage.getItem)
      .mockClear()
      .mockResolvedValueOnce("not-json")
      .mockResolvedValueOnce(replacement);
    const remove = jest.mocked(AsyncStorage.removeItem);
    remove.mockClear();

    await expect(loadCachedShortDramaSeriesPage("owner/a", "recommended", 10)).resolves.toBeNull();
    expect(get).toHaveBeenNthCalledWith(1, key);
    expect(get).toHaveBeenNthCalledWith(2, key);
    expect(remove).not.toHaveBeenCalled();
  });

  it("saves validated per-account history and notifies subscribers", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeShortDramaHistory(listener);
    await saveShortDramaHistory("owner/a", "series/b", "episode/c", -2);
    unsubscribe();
    await saveShortDramaHistory("owner/a", "series/b", "episode/d", 3);
    expect(shortDramaHistoryKey("owner/a")).toBe("bwchat.short-drama-history-v1:account:owner%2Fa");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("owner/a");
    expect(await readShortDramaHistory("owner/a")).toMatchObject({
      "series/b": {
        series_id: "series/b",
        episode_id: "episode/d",
        position_seconds: 3,
      },
    });
    expect(await readShortDramaHistory("other")).toEqual({});
  });

  it("serializes concurrent history writes and prevents a cleared account from being revived", async () => {
    await Promise.all([
      saveShortDramaHistory("owner/a", "series/one", "episode/one", 1),
      saveShortDramaHistory("owner/a", "series/two", "episode/two", 2),
    ]);
    await expect(readShortDramaHistory("owner/a")).resolves.toMatchObject({
      "series/one": { episode_id: "episode/one", position_seconds: 1 },
      "series/two": { episode_id: "episode/two", position_seconds: 2 },
    });

    const set = jest.mocked(AsyncStorage.setItem);
    const original = set.getMockImplementation();
    const pendingSet = deferred<void>();
    set.mockImplementationOnce(() => pendingSet.promise);
    const foundationOwner = "\u0085owner-reset\u0085";
    const obsoleteSave = saveShortDramaHistory(foundationOwner, "series/old", "episode/old", 3);
    await Promise.resolve();
    resetShortDramaHistoryRepositoryMemoryForAccount(foundationOwner);
    pendingSet.resolve();
    await obsoleteSave;
    await Promise.resolve();
    await Promise.resolve();
    if (original) set.mockImplementation(original);
    await expect(readShortDramaHistory(foundationOwner)).resolves.toEqual({});
  });
});

function series(id: string, episodes: ShortDramaVideo[] = []): ShortDramaSeries {
  return {
    series_id: id,
    title: `短剧 ${id}`,
    intro: "简介",
    cover_url: "",
    episode_count: episodes.length,
    status: "published",
    updated_at: "",
    episodes,
    creator: creator(),
    resume_position_seconds: 0,
  };
}

function video(id: string, overrides: Partial<ShortDramaVideo> = {}): ShortDramaVideo {
  return {
    id,
    drama_id: "series",
    creator: creator(),
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

function creator() {
  return {
    user_id: "creator",
    username: "creator",
    nickname: "创作者",
    avatar_url: "",
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
