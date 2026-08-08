import {
  createShortDramaSeries,
  deleteShortDramaEpisode,
  submitShortDramaSeries,
  updateShortDramaEpisode,
  updateShortDramaSeries,
  uploadShortDramaEpisode,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { normalizeShortDramaEpisodeUploadResult } from "@/api/normalizers";
import type { ShortDramaCreator, ShortDramaSeries, ShortDramaVideo } from "@/models";
import {
  shortDramaCoverFilename,
  shortDramaEpisodeCoverFilename,
  shortDramaEpisodeVideoFilename,
} from "@/services/short-drama/ShortDramaMediaService";
import {
  appendPreparedShortDramaEpisodes,
  canPublishShortDramaDraft,
  clampShortDramaPrice,
  normalizeShortDramaPriceText,
  renumberShortDramaEpisodeDrafts,
  shortDramaAvailableImportCount,
  shortDramaDraftFromSeries,
  shortDramaEditorMetrics,
  shortDramaLocalSeriesProjection,
  shortDramaVideoMimeType,
  updateShortDramaEpisodeDraft,
  type ShortDramaEpisodeDraft,
} from "@/services/short-drama/shortDramaEditorPolicy";

jest.mock("expo-video", () => ({ createVideoPlayer: jest.fn() }));

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);

describe("native ShortDramaUnifiedEditorView contracts", () => {
  beforeEach(() => request.mockReset());

  it("keeps the complete source card, grid, media, price and publish constants", () => {
    expect(shortDramaEditorMetrics).toMatchObject({
      contentGap: 14,
      contentInset: 16,
      contentBottomInset: 96,
      cardInset: 14,
      cardRadius: 16,
      seriesGap: 10,
      fieldGap: 6,
      titleMinimumHeight: 44,
      titleHorizontalInset: 12,
      inputRadius: 10,
      focusedBorderWidth: 1.5,
      posterHeight: 131,
      posterRadius: 12,
      posterBadgeHorizontalInset: 10,
      posterBadgeVerticalInset: 7,
      posterBadgeOuterInset: 10,
      introInset: 12,
      introMinimumHeight: 76,
      episodeColumns: 5,
      episodeGap: 8,
      episodeHeight: 44,
      episodeRadius: 8,
      episodeOverlayInset: 5,
      episodePriceSize: 9,
      episodeNumberHorizontalInset: 6,
      episodeNumberVerticalInset: 3,
      episodeStateSymbolSize: 12,
      maximumLocalEpisodes: 20,
      coverMaximumDimension: 1_280,
      coverInitialQuality: 0.78,
      coverMaximumBytes: 900_000,
      previewMaximumDimension: 720,
      previewQuality: 0.82,
      seriesUploadTimeoutMilliseconds: 180_000,
      episodeUploadTimeoutMilliseconds: 600_000,
      maximumConcurrentEpisodeUploads: 2,
      priceMinimum: 0,
      priceMaximum: 100,
      priceFieldWidth: 70,
      episodeIntroMinimumLines: 3,
      episodeIntroMaximumLines: 6,
      publishButtonMinimumHeight: 48,
      publishButtonRadius: 12,
    });
  });

  it("normalizes edit episodes to consecutive order and marks changed server numbers dirty", () => {
    const source = series("series", [
      video("third", { episode_number: 3, title: "" }),
      video("first", { episode_number: 1, title: "第一集" }),
    ]);
    let index = 0;
    const draft = shortDramaDraftFromSeries(source, "draft", () => `local-${index++}`, "短剧");
    expect(
      draft.episodes.map((episode) => ({
        id: episode.server_video?.id,
        number: episode.episode_number,
        title: episode.title,
        dirty: episode.is_dirty,
      })),
    ).toEqual([
      { id: "first", number: 1, title: "第一集", dirty: false },
      { id: "third", number: 2, title: "短剧", dirty: true },
    ]);
  });

  it("matches publish validation and the source local-video-only selection limit", () => {
    const create = shortDramaDraftFromSeries(undefined, "draft", () => "id", "短剧");
    expect(canPublishShortDramaDraft(create)).toBe(false);
    const episode = localEpisode("one", 1);
    expect(
      canPublishShortDramaDraft({
        ...create,
        title: "剧名",
        cover_uri: "file:///cover.jpg",
        episodes: [episode],
      }),
    ).toBe(true);
    expect(
      canPublishShortDramaDraft({
        ...create,
        title: "剧名",
        cover_uri: "file:///cover.jpg",
        episodes: [{ ...episode, title: "" }],
      }),
    ).toBe(false);
    const serverEpisodes = Array.from({ length: 30 }, (_, number) =>
      serverEpisode(`s${number}`, number + 1),
    );
    expect(shortDramaAvailableImportCount(serverEpisodes)).toBe(20);
    expect(
      shortDramaAvailableImportCount([
        ...serverEpisodes,
        ...Array.from({ length: 7 }, (_, number) => localEpisode(`l${number}`, number + 31)),
      ]),
    ).toBe(13);
  });

  it("preserves picker order, default titles and delete renumber dirty semantics", () => {
    const appended = appendPreparedShortDramaEpisodes(
      [serverEpisode("server", 1)],
      [prepared("picked-two", "file:///two.mp4"), prepared("picked-one", "file:///one.mov")],
      (number) => `第${number}集`,
    );
    expect(appended.map((episode) => [episode.id, episode.episode_number, episode.title])).toEqual([
      ["server", 1, "服务端"],
      ["picked-two", 2, "第2集"],
      ["picked-one", 3, "第3集"],
    ]);
    const renumbered = renumberShortDramaEpisodeDrafts(
      [appended[0]!, appended[2]!],
      (number) => `第${number}集`,
    );
    expect(renumbered[1]).toMatchObject({ episode_number: 2, title: "第2集", is_dirty: false });
    const serverMoved = renumberShortDramaEpisodeDrafts(
      [serverEpisode("server-2", 2)],
      (number) => `第${number}集`,
    );
    expect(serverMoved[0]).toMatchObject({ episode_number: 1, is_dirty: true });
  });

  it("tracks metadata dirtiness and clamps digit-only price input to 0–100", () => {
    const original = serverEpisode("server", 1);
    const unchanged = updateShortDramaEpisodeDraft([original], { ...original });
    expect(unchanged[0]?.is_dirty).toBe(false);
    const changed = updateShortDramaEpisodeDraft(unchanged, { ...original, intro: "新版" });
    expect(changed[0]?.is_dirty).toBe(true);
    expect(normalizeShortDramaPriceText("a1-2猫3")).toBe("100");
    expect(normalizeShortDramaPriceText("abc")).toBe("");
    expect(clampShortDramaPrice(-3)).toBe(0);
    expect(clampShortDramaPrice("999")).toBe(100);
  });

  it("keeps native filenames, video MIME rules and local projection", () => {
    expect(shortDramaCoverFilename(1_780_000_001_999)).toBe("short_drama_cover_1780000001.jpg");
    expect(shortDramaEpisodeCoverFilename("cover-id")).toBe(
      "short_drama_episode_cover_cover-id.jpg",
    );
    expect(shortDramaEpisodeVideoFilename("file:///draft/movie.MOV?x=1", "video-id")).toBe(
      "short_drama_episode_video-id.mov",
    );
    expect(shortDramaVideoMimeType("a.mov")).toBe("video/quicktime");
    expect(shortDramaVideoMimeType("a.m4v")).toBe("video/x-m4v");
    expect(shortDramaVideoMimeType("a.unknown", "video/custom")).toBe("video/custom");
    const draft = {
      ...shortDramaDraftFromSeries(undefined, "draft", () => "id", "短剧"),
      title: "  标题  ",
      intro: "  简介  ",
      cover_uri: "file:///cover.jpg",
      episodes: [localEpisode("one", 1)],
    };
    expect(shortDramaLocalSeriesProjection(draft, creator(), "2026-08-07T00:00:00Z")).toMatchObject(
      {
        series_id: "local:draft",
        title: "标题",
        intro: "简介",
        cover_url: "file:///cover.jpg",
        episode_count: 1,
        status: "draft",
        updated_at: "2026-08-07T00:00:00Z",
      },
    );
  });

  it("normalizes nested and direct upload responses with all status-message aliases", () => {
    expect(
      normalizeShortDramaEpisodeUploadResult({
        episode: { video_id: 7, play_url: "/seven.mp4" },
        publish_status: "reviewing",
        rejection_reason: "等待审核",
      }),
    ).toMatchObject({
      video: { id: "7", play_url: "/seven.mp4" },
      status: "reviewing",
      status_message: "等待审核",
    });
    expect(
      normalizeShortDramaEpisodeUploadResult({
        video_id: "direct",
        play_url: "/direct.mp4",
        status: "published",
      }),
    ).toMatchObject({ video: { id: "direct" }, status: "published" });
  });

  it("uses exact create/update/episode/delete/submit routes, fields and timeouts", async () => {
    request
      .mockResolvedValueOnce(series("created"))
      .mockResolvedValueOnce(series("updated"))
      .mockResolvedValueOnce({ episode: video("uploaded"), status: "processing" })
      .mockResolvedValueOnce(video("patched"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(series("submitted"));
    const append = jest.spyOn(FormData.prototype, "append");
    await createShortDramaSeries({
      title: "标题",
      intro: "简介",
      coverUri: "file:///cover.jpg",
      coverFilename: "cover.jpg",
    });
    expect(request.mock.calls[0]).toEqual([
      "/short-drama/series",
      {
        method: "POST",
        body: expect.any(FormData),
        timeoutMs: 180_000,
      },
    ]);
    expect(append.mock.calls.slice(0, 3)).toEqual([
      ["title", "标题"],
      ["intro", "简介"],
      ["cover", { uri: "file:///cover.jpg", name: "cover.jpg", type: "image/jpeg" }],
    ]);

    await updateShortDramaSeries("series/1", { title: "新版", intro: "新版简介" });
    expect(request.mock.calls[1]).toEqual([
      "/short-drama/series/series%2F1",
      {
        method: "PATCH",
        body: expect.any(FormData),
        timeoutMs: 180_000,
      },
    ]);

    const appendStart = append.mock.calls.length;
    await uploadShortDramaEpisode({
      seriesId: "series/1",
      clientSeriesId: "client-series",
      clientEpisodeId: "client-episode",
      title: "第一集",
      intro: "分集简介",
      episodeNumber: 1,
      unlockPriceGoldCoins: 200,
      videoUri: "file:///one.mov",
      videoFilename: "one.mov",
      videoMimeType: "video/quicktime",
      coverUri: "file:///one.jpg",
      coverFilename: "one.jpg",
    });
    expect(request.mock.calls[2]).toEqual([
      "/short-drama/series/series%2F1/episodes",
      {
        method: "POST",
        body: expect.any(FormData),
        timeoutMs: 600_000,
      },
    ]);
    expect(append.mock.calls.slice(appendStart)).toEqual([
      ["title", "第一集"],
      ["intro", "分集简介"],
      ["episode_number", "1"],
      ["client_episode_id", "client-episode"],
      ["client_series_id", "client-series"],
      ["unlock_price_gold_coins", "100"],
      ["video", { uri: "file:///one.mov", name: "one.mov", type: "video/quicktime" }],
      ["cover", { uri: "file:///one.jpg", name: "one.jpg", type: "image/jpeg" }],
    ]);

    await updateShortDramaEpisode("video/1", {
      title: "改名",
      intro: "改简介",
      episodeNumber: 2,
      unlockPriceGoldCoins: -4,
    });
    await deleteShortDramaEpisode("video/1");
    await submitShortDramaSeries("series/1", "client-series");
    expect(request.mock.calls.slice(3)).toEqual([
      [
        "/short-drama/videos/video%2F1",
        {
          method: "PATCH",
          body: {
            title: "改名",
            intro: "改简介",
            episode_number: 2,
            unlock_price_gold_coins: 0,
          },
        },
      ],
      ["/short-drama/videos/video%2F1", { method: "DELETE" }],
      [
        "/short-drama/series/series%2F1/submit",
        {
          method: "POST",
          body: { client_request_id: "client-series" },
        },
      ],
    ]);
    append.mockRestore();
  });
});

function prepared(id: string, uri: string) {
  return {
    id,
    local_video_uri: uri,
    local_video_filename: uri.split("/").at(-1)!,
    local_video_mime_type: shortDramaVideoMimeType(uri),
    preview_uri: `${uri}.jpg`,
  };
}

function localEpisode(id: string, number: number): ShortDramaEpisodeDraft {
  return {
    ...prepared(id, `file:///${id}.mp4`),
    episode_number: number,
    title: `第${number}集`,
    intro: "",
    unlock_price_gold_coins: 0,
    upload_state: "pending",
    is_dirty: false,
  };
}

function serverEpisode(id: string, number: number): ShortDramaEpisodeDraft {
  return {
    id,
    episode_number: number,
    title: "服务端",
    intro: "",
    unlock_price_gold_coins: 0,
    server_video: video(id, { episode_number: number }),
    upload_state: "uploaded",
    is_dirty: false,
  };
}

function series(id: string, episodes: ShortDramaVideo[] = []): ShortDramaSeries {
  return {
    series_id: id,
    title: `短剧 ${id}`,
    intro: "简介",
    cover_url: "/cover.jpg",
    episode_count: episodes.length,
    status: "draft",
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
    cover_url: "/episode.jpg",
    play_url: "/episode.mp4",
    playback_position_seconds: 0,
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    is_unlocked: false,
    is_owned_by_current_user: true,
    ...overrides,
  };
}

function creator(): ShortDramaCreator {
  return {
    user_id: "owner",
    username: "owner",
    nickname: "作者",
    avatar_url: "",
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
  };
}
