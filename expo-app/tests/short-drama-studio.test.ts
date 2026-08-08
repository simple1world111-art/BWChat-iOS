import { getMyShortDramaSeries } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import type { ShortDramaCreator, ShortDramaPublishStatus, ShortDramaSeries } from "@/models";
import type { ShortDramaUploadJob } from "@/services/short-drama/ShortDramaUploadQueue";
import {
  appendUniqueShortDramaStudioSeries,
  mergeShortDramaStudioInitial,
  shortDramaSeriesFromUploadJob,
  shortDramaStatusLocalizationKey,
  shortDramaStatusTone,
  shortDramaStudioMetrics,
  upsertShortDramaStudioSeries,
} from "@/services/short-drama/shortDramaStudioPolicy";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);

describe("native ShortDramaStudioView contracts", () => {
  beforeEach(() => request.mockReset());

  it("keeps the source list, loading, empty-card, status-pill and pagination constants", () => {
    expect(shortDramaStudioMetrics).toEqual({
      contentGap: 14,
      cardGap: 12,
      horizontalInset: 16,
      topInset: 16,
      bottomInset: 30,
      loadingTopInset: 92,
      loadingGap: 12,
      loadingTextSize: 14,
      emptyTopInset: 70,
      emptyCardGap: 16,
      emptyCopyGap: 6,
      emptyIconSize: 44,
      emptyTitleSize: 18,
      emptyHintSize: 14,
      emptyButtonTextSize: 15,
      emptyButtonHorizontalInset: 18,
      emptyButtonHeight: 40,
      emptyCardInset: 28,
      emptyCardRadius: 16,
      statusPillTextSize: 11,
      statusPillHorizontalInset: 7,
      statusPillVerticalInset: 3,
      pageLimit: 20,
    });
  });

  it("maps every native publish status to its exact tone and localization key", () => {
    const statuses: ShortDramaPublishStatus[] = [
      "draft",
      "processing",
      "reviewing",
      "published",
      "rejected",
      "failed",
      "unknown",
    ];
    expect(
      statuses.map((status) => [
        status,
        shortDramaStatusTone(status),
        shortDramaStatusLocalizationKey(status),
      ]),
    ).toEqual([
      ["draft", "secondary", "shortDrama.draft"],
      ["processing", "accent", "shortDrama.processing"],
      ["reviewing", "accent", "shortDrama.reviewing"],
      ["published", "success", "shortDrama.published"],
      ["rejected", "danger", "shortDrama.rejected"],
      ["failed", "danger", "shortDrama.failed"],
      ["unknown", "secondary", "shortDrama.status.unknown"],
    ]);
  });

  it("prepends local jobs, hides ones already represented remotely and preserves failed retry metadata", () => {
    const pending = job("pending", "queued");
    const failed = job("failed", "failed_permanent");
    const represented = job("represented", "uploading", "server");
    const remote = series("server");
    expect(shortDramaSeriesFromUploadJob(failed, "重试")).toMatchObject({
      series_id: "local:failed",
      status: "draft",
      status_message: "重试",
    });
    expect(mergeShortDramaStudioInitial([pending, failed, represented], [remote], "重试")).toEqual([
      shortDramaSeriesFromUploadJob(pending, "重试"),
      shortDramaSeriesFromUploadJob(failed, "重试"),
      remote,
    ]);
  });

  it("appends paginated server results without replacing the first occurrence", () => {
    const first = series("first");
    const duplicate = { ...first, title: "后页重复项" };
    const second = series("second");
    expect(appendUniqueShortDramaStudioSeries([first], [duplicate, second])).toEqual([
      first,
      second,
    ]);
  });

  it("upserts server results and removes the matching local upload projection", () => {
    const local = shortDramaSeriesFromUploadJob(job("draft", "uploading", "server"), "重试");
    const untouched = series("untouched");
    const remote = series("server");
    expect(
      upsertShortDramaStudioSeries([local, untouched], remote, [
        { id: "draft", server_id: "server" },
      ]),
    ).toEqual([remote, untouched]);
    expect(upsertShortDramaStudioSeries([untouched], series("new"))).toEqual([
      series("new"),
      untouched,
    ]);
  });

  it("uses the exact mine endpoint, 20-item limit and encoded cursor", async () => {
    request.mockResolvedValueOnce({ series: [], has_more: false });
    await expect(getMyShortDramaSeries({ limit: 20, cursor: "next value" })).resolves.toEqual({
      series: [],
      has_more: false,
      next_cursor: undefined,
    });
    expect(request).toHaveBeenCalledWith("/short-drama/mine?limit=20&cursor=next+value", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });
});

function job(
  id: string,
  state: ShortDramaUploadJob["state"],
  serverId?: string,
): ShortDramaUploadJob {
  return {
    id,
    owner_id: "owner",
    creator: creator(),
    draft: {
      draft_id: id,
      title: `短剧 ${id}`,
      intro: "简介",
      cover_uri: `file:///${id}.jpg`,
      episodes: [],
    },
    state,
    created_at: "2026-08-07T00:00:00Z",
    updated_at: "2026-08-07T01:00:00Z",
    attempt_count: 1,
    generation: 1,
    ...(serverId ? { server_id: serverId } : {}),
  };
}

function series(id: string): ShortDramaSeries {
  return {
    series_id: id,
    title: `短剧 ${id}`,
    intro: "简介",
    cover_url: "/cover.jpg",
    episode_count: 0,
    status: "draft",
    updated_at: "2026-08-07T02:00:00Z",
    episodes: [],
    creator: creator(),
    resume_position_seconds: 0,
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
