import AsyncStorage from "@react-native-async-storage/async-storage";

import { getShortDramaComments, sendShortDramaComment, setShortDramaLiked } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  normalizeShortDramaComment,
  normalizeShortDramaCommentsPage,
  normalizeShortDramaInteractionResult,
} from "@/api/normalizers";
import type { ShortDramaComment } from "@/models";
import {
  loadCachedShortDramaComments,
  saveCachedShortDramaComments,
  shortDramaCommentsCacheKey,
} from "@/services/short-drama/ShortDramaCommentsRepository";
import {
  appendNewShortDramaComments,
  compactShortDramaCount,
  formatShortDramaCommentTime,
  shortDramaActionMetrics,
  shortDramaCommentMetrics,
} from "@/services/short-drama/shortDramaInteractionPolicy";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);

describe("native ShortDramaActionRail and ShortDramaCommentsSheet contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("keeps the complete action rail geometry", () => {
    expect(shortDramaActionMetrics).toEqual({
      railGap: 18,
      creatorGap: 6,
      creatorAvatarSize: 48,
      creatorAvatarRadius: 11,
      creatorAvatarStroke: 2,
      followButtonSize: 26,
      followSymbolSize: 13,
      railWidth: 58,
      shadowOpacity: 0.45,
      shadowRadius: 8,
      shadowOffsetY: 2,
      buttonCopyGap: 5,
      buttonIconSize: 27,
      buttonIconWidth: 44,
      buttonIconHeight: 34,
      buttonCountSize: 11,
      buttonCountWidth: 54,
      buttonCountMinimumScale: 0.72,
    });
  });

  it("uses the source K/W/M count thresholds and one-decimal stripping", () => {
    expect([
      compactShortDramaCount(-1),
      compactShortDramaCount(999),
      compactShortDramaCount(1_000),
      compactShortDramaCount(1_500),
      compactShortDramaCount(9_999),
      compactShortDramaCount(10_000),
      compactShortDramaCount(25_000),
      compactShortDramaCount(1_000_000),
      compactShortDramaCount(1_250_000),
    ]).toEqual(["-1", "999", "1K", "1.5K", "10K", "1W", "2.5W", "1M", "1.3M"]);
  });

  it("keeps every sheet, composer, row, pagination and cache metric", () => {
    expect(shortDramaCommentMetrics).toMatchObject({
      headerHorizontalInset: 18,
      headerVerticalInset: 14,
      headerTitleSize: 17,
      headerCountSize: 13,
      listHorizontalInset: 18,
      listVerticalInset: 10,
      loadingTopInset: 40,
      emptyGap: 10,
      emptyIconSize: 30,
      emptyTopInset: 48,
      composerGap: 10,
      composerHorizontalInset: 16,
      composerVerticalInset: 12,
      composerInputHorizontalInset: 14,
      composerInputVerticalInset: 10,
      composerInputRadius: 18,
      composerInputSize: 15,
      composerMaximumLines: 4,
      sendButtonWidth: 44,
      sendButtonHeight: 38,
      sendSymbolSize: 16,
      rowGap: 10,
      rowAvatarSize: 36,
      rowCopyGap: 4,
      rowHeaderGap: 8,
      rowNicknameSize: 13,
      rowTimestampSize: 11,
      rowContentSize: 14,
      rowVerticalInset: 10,
      pageLimit: 30,
      maximumCachedComments: 200,
      cacheTtlMilliseconds: 60_000,
      staleRetentionMilliseconds: 2_592_000_000,
      profileNavigationDelayMilliseconds: 220,
      toastMilliseconds: 2_000,
    });
  });

  it("normalizes all native comment aliases, wrapper shapes and interaction fields", () => {
    expect(
      normalizeShortDramaComment({
        comment_id: 12,
        video_id: 8,
        user_id: 4,
        nickname: "林夏",
        avatar_url: "/a.jpg",
        text: "好看",
        created_at: "2026-08-07 10:00:00",
      }),
    ).toEqual({
      id: "12",
      video_id: "8",
      user_id: "4",
      nickname: "林夏",
      avatar_url: "/a.jpg",
      content: "好看",
      created_at: "2026-08-07 10:00:00",
    });
    expect(
      normalizeShortDramaCommentsPage({
        items: [{ id: "c1", content: "一" }],
        cursor: "next",
      }),
    ).toMatchObject({ has_more: true, next_cursor: "next" });
    expect(normalizeShortDramaCommentsPage([{ id: "c2", text: "二" }])).toMatchObject({
      has_more: false,
      comments: [{ id: "c2", content: "二" }],
    });
    expect(
      normalizeShortDramaCommentsPage({
        comments: [7],
        items: [{ id: " raw-id ", nickname: " ", content: " raw content " }],
        cursor: " next ",
      }),
    ).toEqual({
      comments: [
        {
          id: " raw-id ",
          video_id: "",
          user_id: "",
          nickname: " ",
          avatar_url: "",
          content: " raw content ",
          created_at: "",
        },
      ],
      has_more: true,
      next_cursor: " next ",
    });
    expect(normalizeShortDramaInteractionResult({ liked: 1, likeCount: "42" })).toEqual({
      liked: true,
    });
    expect(normalizeShortDramaInteractionResult({ liked: 1, like_count: "42" })).toEqual({
      liked: true,
      like_count: 42,
    });
    expect(normalizeShortDramaInteractionResult(null)).toEqual({});
    expect(() => normalizeShortDramaInteractionResult(7)).toThrow("短剧互动响应格式无效");
  });

  it("matches native pagination de-duplication and timestamp display", () => {
    const current = [comment("a")];
    expect(
      appendNewShortDramaComments(current, [comment("a"), comment("b"), comment("b")]).map(
        (item) => item.id,
      ),
    ).toEqual(["a", "b", "b"]);

    const now = new Date(2026, 7, 7, 12, 0, 0);
    expect(formatShortDramaCommentTime(new Date(2026, 7, 7, 9, 5).toISOString(), now)).toMatch(
      /09:05/u,
    );
    expect(
      formatShortDramaCommentTime(new Date(2026, 7, 6, 18, 0).toISOString(), now, "Yesterday"),
    ).toBe("Yesterday");
    expect(formatShortDramaCommentTime(new Date(2026, 6, 2, 18, 0).toISOString(), now)).toBe(
      "07/02",
    );
    expect(formatShortDramaCommentTime("invalid", now)).toBe("");
  });

  it("uses account/video isolation, 60-second TTL, 30-day retention and 200-item cap", async () => {
    const now = Date.UTC(2026, 7, 7);
    const comments = Array.from({ length: 205 }, (_, index) => comment(String(index)));
    await saveCachedShortDramaComments(
      "owner/a",
      "video/b",
      {
        comments,
        has_more: true,
        next_cursor: "next",
      },
      now,
    );
    expect(shortDramaCommentsCacheKey("owner/a", "video/b")).toBe(
      "bwchat.short-drama-comments-v1:account:owner%2Fa:video:video%2Fb",
    );
    expect((await loadCachedShortDramaComments("owner/a", "video/b", now + 59_999))?.isStale).toBe(
      false,
    );
    const stale = await loadCachedShortDramaComments("owner/a", "video/b", now + 60_000);
    expect(stale?.isStale).toBe(true);
    expect(stale?.value.comments).toHaveLength(200);
    expect(await loadCachedShortDramaComments("other", "video/b", now)).toBeNull();
    const expired = await loadCachedShortDramaComments(
      "owner/a",
      "video/b",
      now + 60_000 + shortDramaCommentMetrics.staleRetentionMilliseconds + 1,
    );
    expect(expired).toMatchObject({ isRetained: false, isStale: true });
    expect(expired?.value.comments).toHaveLength(200);
    expect(shortDramaCommentsCacheKey("\u0085owner\u0085", " video ")).toBe(
      "bwchat.short-drama-comments-v1:account:owner:video:%20video%20",
    );
  });

  it("uses exact POST/DELETE like routes and source fallback state", async () => {
    request.mockResolvedValueOnce(null).mockResolvedValueOnce({ liked: 0, like_count: 9 });
    await expect(setShortDramaLiked("video/1", true)).resolves.toEqual({ liked: true });
    await expect(setShortDramaLiked("video/1", false)).resolves.toEqual({
      liked: false,
      like_count: 9,
    });
    expect(request.mock.calls).toEqual([
      ["/short-drama/videos/video%2F1/like", { method: "POST", body: {}, requiredEnvelope: true }],
      ["/short-drama/videos/video%2F1/like", { method: "DELETE", requiredEnvelope: true }],
    ]);
  });

  it("uses exact ordered comment pagination and send requests", async () => {
    request
      .mockResolvedValueOnce({ comments: [], has_more: false })
      .mockResolvedValueOnce({ comment_id: "sent", video_id: "video:1@x", text: " hello " });
    await getShortDramaComments("video:1@x", {
      limit: 30,
      cursor: "a b+c&d=e/f?:@",
    });
    await expect(sendShortDramaComment("video:1@x", "hello")).resolves.toMatchObject({
      id: "sent",
      video_id: "video:1@x",
      content: " hello ",
    });
    expect(request.mock.calls).toEqual([
      [
        "/short-drama/videos/video:1@x/comments?limit=30&cursor=a%20b+c%26d%3De/f?:@",
        { requiredData: true, requiredEnvelope: true },
      ],
      [
        "/short-drama/videos/video:1@x/comments",
        {
          method: "POST",
          body: { content: "hello" },
          requiredData: true,
          requiredEnvelope: true,
        },
      ],
    ]);
  });
});

function comment(id: string): ShortDramaComment {
  return {
    id,
    video_id: "video",
    user_id: "user",
    nickname: "用户",
    avatar_url: "",
    content: id,
    created_at: "",
  };
}
