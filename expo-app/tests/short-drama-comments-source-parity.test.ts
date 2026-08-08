import AsyncStorage from "@react-native-async-storage/async-storage";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalizeShortDramaComment, normalizeShortDramaCommentsPage } from "@/api/normalizers";
import type { ShortDramaComment } from "@/models";
import {
  loadCachedShortDramaComments,
  shortDramaCommentsCacheKey,
} from "@/services/short-drama/ShortDramaCommentsRepository";
import {
  appendNewShortDramaComments,
  makeOptimisticShortDramaComment,
  parseShortDramaCommentTimestamp,
  removeOptimisticShortDramaComment,
  replaceOptimisticShortDramaComment,
  shortDramaCommentMetrics,
} from "@/services/short-drama/shortDramaInteractionPolicy";

const root = resolve(__dirname, "..");
const nativeSources = [
  {
    copied: "../BWChat/Views/ShortDramaCommentsSheet.swift",
    original: "../../BWChat-iOS/BWChat/Views/ShortDramaCommentsSheet.swift",
    hash: "bfb9c0703c5690168fdcfe0f602db684476b83f381d47589e70f29842017c0b8",
  },
  {
    copied: "../BWChat/Views/ShortDramaFeedView.swift",
    original: "../../BWChat-iOS/BWChat/Views/ShortDramaFeedView.swift",
    hash: "61bd4af279a5855af0d3ceadce6c94157be754ee29b142e40919b11274fc5f9d",
  },
  {
    copied: "../BWChat/Models/ShortDrama.swift",
    original: "../../BWChat-iOS/BWChat/Models/ShortDrama.swift",
    hash: "13abb0d63f53893bd48eff56fcf6d40f3bb7d570267280bcae276100344d6a11",
  },
  {
    copied: "../BWChat/Services/APIService.swift",
    original: "../../BWChat-iOS/BWChat/Services/APIService.swift",
    hash: "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274",
  },
  {
    copied: "../BWChat/Services/CacheRepository.swift",
    original: "../../BWChat-iOS/BWChat/Services/CacheRepository.swift",
    hash: "530f9734eeb9fdc8aeafc3e5430d5eae876754462372bb3c05c9b830526f0b66",
  },
  {
    copied: "../BWChat/Utils/Extensions.swift",
    original: "../../BWChat-iOS/BWChat/Utils/Extensions.swift",
    hash: "e625dab1ea95cbd63d74c1e8bf33d4bf3f4a85adbd2001c1b0ca27a99bcc5ce5",
  },
] as const;

describe("native ShortDramaCommentsSheet complete code-stage parity", () => {
  beforeEach(async () => AsyncStorage.clear());

  it("locks the sheet, presenter, model, API, cache and timestamp sources", () => {
    for (const native of nativeSources) {
      expect(sha256(resolve(root, native.copied))).toBe(native.hash);
      const original = resolve(root, native.original);
      if (existsSync(original)) expect(sha256(original)).toBe(native.hash);
    }
  });

  it("keeps the complete header, list, composer, row, cache and navigation geometry", () => {
    expect(shortDramaCommentMetrics).toEqual({
      nativeSheetHostTopCompensation: 16,
      headerHorizontalInset: 18,
      headerVerticalInset: 14,
      headerTitleSize: 17,
      headerCountSize: 13,
      listHorizontalInset: 18,
      listVerticalInset: 10,
      loadingTopInset: 40,
      emptyGap: 10,
      emptyIconSize: 30,
      emptyTitleSize: 14,
      emptyTopInset: 48,
      loadMoreVerticalInset: 14,
      composerGap: 10,
      composerHorizontalInset: 16,
      composerVerticalInset: 12,
      composerInputHorizontalInset: 14,
      composerInputVerticalInset: 10,
      composerInputRadius: 18,
      composerInputSize: 15,
      composerInputLineHeight: 18,
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
    const sheet = expo("src/components/short-drama/ShortDramaCommentsSheet.tsx");
    expect(sheet).toContain("nicknameButton: { flexShrink: 1 }");
    expect(sheet).not.toContain('nicknameButton: { maxWidth: "72%" }');
    expect(sheet).toContain('scheme === "dark" ? "#2C2C2E" : colors.background');
    expect(sheet).toContain('PlatformColor("secondarySystemBackgroundColor")');
    expect(sheet).toContain('PlatformColor("systemBackgroundColor")');
    expect(sheet).toContain('PlatformColor("separatorColor")');
    expect(sheet).toContain(
      'Platform.OS === "ios" ? -shortDramaCommentMetrics.nativeSheetHostTopCompensation : 0',
    );
  });

  it("uses the native medium/large sheet and synchronous send/pagination gates", () => {
    const sheet = expo("src/components/short-drama/ShortDramaCommentsSheet.tsx");
    expect(sheet).toContain('from "@expo/ui/community/bottom-sheet"');
    expect(sheet).toContain("enableDynamicSizing={false}");
    expect(sheet).toContain("enablePanDownToClose");
    expect(sheet).toContain("const loadingMoreRef = useRef(false)");
    expect(sheet).toContain("const sendingRef = useRef(false)");
    expect(sheet).toContain("if (!content || sendingRef.current) return");
    expect(sheet).not.toContain('presentationStyle="pageSheet"');
  });

  it("matches optimistic insertion, server replacement and failure removal exactly", () => {
    const existing = comment("existing");
    const temporary = makeOptimisticShortDramaComment({
      content: "你好",
      currentUser: null,
      defaultNickname: "BBchat User",
      temporaryId: "local-id",
      videoId: "video",
    });
    expect(temporary).toEqual({
      id: "local-id",
      video_id: "video",
      user_id: "",
      nickname: "BBchat User",
      avatar_url: "",
      content: "你好",
      created_at: "",
    });
    const optimistic = [temporary, existing];
    const sent = comment("server");
    expect(replaceOptimisticShortDramaComment(optimistic, "local-id", sent)).toEqual([
      sent,
      existing,
    ]);
    expect(removeOptimisticShortDramaComment(optimistic, "local-id")).toEqual([existing]);
  });

  it("keeps native fixed-set de-duplication and UTC parsing for SQL timestamps", () => {
    expect(
      appendNewShortDramaComments([comment("a")], [comment("a"), comment("b"), comment("b")]).map(
        (item) => item.id,
      ),
    ).toEqual(["a", "b", "b"]);
    expect(parseShortDramaCommentTimestamp("2026-08-08 10:11:12")?.toISOString()).toBe(
      "2026-08-08T10:11:12.000Z",
    );
    expect(parseShortDramaCommentTimestamp("2026-08-08T10:11:12.123456")?.toISOString()).toBe(
      "2026-08-08T10:11:12.123Z",
    );
    expect(parseShortDramaCommentTimestamp("2026-08-08T10:11:12+09:00")?.toISOString()).toBe(
      "2026-08-08T01:11:12.000Z",
    );
    expect(parseShortDramaCommentTimestamp("2026-08-08T10:11:12z")?.toISOString()).toBe(
      "2026-08-08T10:11:12.000Z",
    );
    expect(parseShortDramaCommentTimestamp("2026-08-08T10:11:12+0900")?.toISOString()).toBe(
      "2026-08-08T01:11:12.000Z",
    );
    expect(
      parseShortDramaCommentTimestamp("2026-08-08T10:11:12.123456789012Z")?.toISOString(),
    ).toBe("2026-08-08T10:11:12.123Z");
    expect(parseShortDramaCommentTimestamp("2026-02-30 10:11:12")).toBeNull();
    expect(parseShortDramaCommentTimestamp("2026/08/08 10:11:12")).toBeNull();
    expect(parseShortDramaCommentTimestamp("\u00852026-08-08 10:11:12\u0085")?.toISOString()).toBe(
      "2026-08-08T10:11:12.000Z",
    );
  });

  it("preserves native raw comment strings and falls through malformed array aliases", () => {
    expect(
      normalizeShortDramaCommentsPage({
        comments: [false],
        items: [{ comment_id: " raw ", nickname: " ", text: " body " }],
        next_cursor: " cursor ",
      }),
    ).toEqual({
      comments: [
        {
          id: " raw ",
          video_id: "",
          user_id: "",
          nickname: " ",
          avatar_url: "",
          content: " body ",
          created_at: "",
        },
      ],
      has_more: true,
      next_cursor: " cursor ",
    });
  });

  it("rejects malformed account cache snapshots instead of rendering partial rows", async () => {
    const key = shortDramaCommentsCacheKey("owner", "video");
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        value: { comments: [{ id: "broken" }], has_more: true },
        updatedAt: 1,
        expiresAt: 2,
      }),
    );
    await expect(loadCachedShortDramaComments("owner", "video", 1)).resolves.toBeNull();
    expect(await AsyncStorage.getItem(key)).toBeNull();
  });

  it("uses the current app language for a missing server nickname", () => {
    expect(normalizeShortDramaComment({ id: "comment" }).nickname).toBe("BBchat 用户");
  });

  it("ignores non-native camel aliases and uses the native UUID fallback shape", () => {
    const normalized = normalizeShortDramaComment({
      commentID: "camel-comment",
      videoID: "camel-video",
      userID: "camel-user",
      name: "camel-name",
      avatarURL: "camel-avatar",
      createdAt: "camel-time",
    });
    expect(normalized.id).toMatch(
      /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/u,
    );
    expect(normalized).toMatchObject({
      video_id: "",
      user_id: "",
      nickname: "BBchat 用户",
      avatar_url: "",
      content: "",
      created_at: "",
    });
    expect(normalizeShortDramaCommentsPage({ hasMore: true, nextCursor: "camel" })).toEqual({
      comments: [],
      has_more: false,
    });
  });

  it("proves the native sheet has no delete UI or DELETE comment contract", () => {
    const nativeSheet = source(resolve(root, "../BWChat/Views/ShortDramaCommentsSheet.swift"));
    const nativeApi = source(resolve(root, "../BWChat/Services/APIService.swift")).slice(
      source(resolve(root, "../BWChat/Services/APIService.swift")).indexOf(
        "func getShortDramaComments",
      ),
      source(resolve(root, "../BWChat/Services/APIService.swift")).indexOf(
        "func reportShortDramaProgress",
      ),
    );
    const expoSheet = expo("src/components/short-drama/ShortDramaCommentsSheet.tsx");
    const expoApi = expo("src/api/bwchat.ts").slice(
      expo("src/api/bwchat.ts").indexOf("export async function getShortDramaComments"),
      expo("src/api/bwchat.ts").indexOf("export async function getShortDramaSeriesDetail"),
    );
    for (const value of [nativeSheet, nativeApi, expoSheet, expoApi]) {
      expect(value).not.toMatch(/deleteShortDramaComment|onDelete|swipeActions|trash/iu);
    }
  });

  it("locks route, method, auth, query, body, wrapper and required data wiring", () => {
    const api = expo("src/api/bwchat.ts");
    const client = expo("src/api/client.ts");
    const commentApi = api.slice(
      api.indexOf("export async function getShortDramaComments"),
      api.indexOf("export async function getShortDramaSeriesDetail"),
    );
    expect(commentApi).toContain(
      "`/short-drama/videos/${encodeShortDramaPathComponent(videoId)}/comments?${query}`",
    );
    expect(commentApi).toContain("encodeShortDramaQueryValue(String(options.limit ?? 30))");
    expect(commentApi).toContain("encodeShortDramaQueryValue(options.cursor)");
    expect(commentApi).toContain("function encodeShortDramaPathComponent");
    expect(commentApi).toContain("function encodeShortDramaQueryValue");
    expect(commentApi).toContain('method: "POST"');
    expect(commentApi).toContain("body: { content }");
    expect(commentApi.match(/requiredData: true/gu)).toHaveLength(2);
    expect(commentApi.match(/requiredEnvelope: true/gu)).toHaveLength(2);
    expect(client).toContain("const auth = options.auth ?? true");
    expect(client).toContain('headers.set("Authorization", `Bearer ${token}`)');
    expect(client).toContain("response.status === 401 && state.canRefresh");
  });

  it("keeps profile routing account-scoped and exposes all native controls to assistive tech", () => {
    const sheet = expo("src/components/short-drama/ShortDramaCommentsSheet.tsx");
    expect(sheet).toContain("if (activeUser?.user_id !== ownerId) return");
    expect(sheet).toContain("accessibilityViewIsModal");
    expect(sheet).toContain('accessibilityRole="header"');
    expect(sheet).toContain('accessibilityRole="progressbar"');
    expect(sheet).toContain('accessibilityRole="button"');
    expect(sheet).toContain("accessibilityState={{ disabled: !trimmedDraft || isSending");
  });

  it("has every sheet string in all ten native catalogs", () => {
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
        "common.loading",
        "common.operationFailed",
        "common.send",
        "profile.defaultUser",
        "shortDrama.comment.placeholder",
        "shortDrama.comments",
        "shortDrama.comments.empty",
        "time.yesterday",
      ]) {
        expect(catalog[key]).toBeTruthy();
      }
    }
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

function expo(path: string): string {
  return source(resolve(root, path));
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
