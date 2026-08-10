import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  createMoment,
  deleteMoment,
  getMomentsFollowing,
  getMomentsNotifications,
  getMomentsUnreadInfo,
  getMomentsWorld,
  markMomentsFeedViewed,
  markMomentsNotificationsRead,
  validateMomentUploadAssets,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { normalizeMomentsNotifications, normalizeMomentsUnreadInfo } from "@/api/normalizers";
import type { Moment } from "@/models";
import {
  isMomentFeedCacheFresh,
  mergeMomentFeed,
  momentFeedCachePolicy,
  momentMutationTabs,
  readCachedMomentFeed,
  saveCachedMomentFeed,
  shouldAcceptMomentFeedFirstPage,
  upsertMomentInFeed,
} from "@/services/moments/MomentFeedRepository";
import {
  readCachedMomentsNotifications,
  saveCachedMomentsNotifications,
} from "@/services/moments/MomentsNotificationRepository";
import { createOptimisticMoment, temporaryMomentId } from "@/services/moments/MomentUploadQueue";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
jest.mock("expo-file-system", () => ({
  Directory: class Directory {},
  File: class File {},
  Paths: { document: "file:///documents" },
}));

const request = jest.mocked(apiRequest);

describe("native moments feed contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("uses the exact world/following pagination and notification routes", async () => {
    request
      .mockResolvedValueOnce({ moments: [], has_more: false })
      .mockResolvedValueOnce({ moments: [], has_more: false })
      .mockResolvedValueOnce({ unread_count: 3, has_new_moments: true })
      .mockResolvedValueOnce({ notifications: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await getMomentsWorld({ limit: 20, beforeId: 91 });
    await getMomentsFollowing({ limit: 20, beforeId: 81 });
    await expect(getMomentsUnreadInfo()).resolves.toEqual({
      unread_count: 3,
      has_new_moments: true,
    });
    await getMomentsNotifications(50);
    await markMomentsNotificationsRead();
    await markMomentsFeedViewed();
    await deleteMoment(31);

    expect(request).toHaveBeenNthCalledWith(1, "/moments/world?limit=20&before_id=91");
    expect(request).toHaveBeenNthCalledWith(2, "/moments/feed?limit=20&before_id=81");
    expect(request).toHaveBeenNthCalledWith(3, "/moments/notifications/unread", {
      requiredData: true,
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(4, "/moments/notifications/list?limit=50");
    expect(request).toHaveBeenNthCalledWith(5, "/moments/notifications/read", {
      method: "POST",
      body: {},
    });
    expect(request).toHaveBeenNthCalledWith(6, "/moments/feed/viewed", {
      method: "POST",
      body: {},
    });
    expect(request).toHaveBeenNthCalledWith(7, "/moments/31", {
      method: "DELETE",
    });
  });

  it("validates and uploads the native create-moment multipart shape", async () => {
    request.mockResolvedValueOnce({
      id: 31,
      author: { user_id: "owner", nickname: "我" },
      content: "旅行",
      media: [],
    });

    await expect(
      createMoment(
        "旅行",
        [
          {
            kind: "image",
            uri: "file:///one.jpg",
            filename: "moment_image_1_0.jpg",
            mime_type: "image/jpeg",
          },
        ],
        { unlockPriceGoldCoins: 50, clientRequestId: "draft-key" },
      ),
    ).resolves.toMatchObject({ id: 31, content: "旅行" });

    expect(request).toHaveBeenCalledWith("/moments/create", {
      method: "POST",
      body: expect.any(FormData),
      timeoutMs: 180_000,
    });
    expect(() =>
      validateMomentUploadAssets([
        { kind: "image", uri: "i", filename: "i.jpg", mime_type: "image/jpeg" },
        { kind: "video", uri: "v", filename: "v.mp4", mime_type: "video/mp4" },
      ]),
    ).toThrow("不能同时包含图片和视频");
    expect(() =>
      validateMomentUploadAssets(
        Array.from({ length: 10 }, (_, index) => ({
          kind: "image" as const,
          uri: String(index),
          filename: `${index}.jpg`,
          mime_type: "image/jpeg",
        })),
      ),
    ).toThrow("最多只能选择 9 张图片");
  });

  it("decodes notification aliases without inventing invalid rows", () => {
    expect(normalizeMomentsUnreadInfo({ unreadCount: "4", hasNewMoments: 1 })).toEqual({
      unread_count: 4,
      has_new_moments: true,
    });
    expect(
      normalizeMomentsNotifications({
        notifications: [
          {
            notificationID: 9,
            type: "comment",
            momentID: "31",
            userID: "friend",
            content: "真好看",
            momentContent: "旅行",
            momentImages: ["/one.jpg", null],
            createdAt: "2026-08-06T10:00:00Z",
            user: { userID: "friend", name: "朋友", avatarURL: "/avatar.jpg" },
          },
          {
            id: "broken",
            moment_id: 0,
            user: { user_id: "friend" },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "9",
        moment_id: 31,
        user_id: "friend",
        moment_images: ["/one.jpg"],
        user: {
          user_id: "friend",
          nickname: "朋友",
          avatar_url: "/avatar.jpg",
        },
      }),
    ]);
  });

  it("isolates feed and notification caches by account and caps snapshots", async () => {
    const moments = Array.from({ length: 205 }, (_, index) => makeMoment(index + 1));
    await saveCachedMomentFeed("owner-a", "recommended", {
      moments,
      has_more: true,
    });
    await saveCachedMomentsNotifications("owner-a", [
      {
        id: "notification-1",
        type: "like",
        moment_id: 31,
        user_id: "friend",
        created_at: "2026-08-06T10:00:00Z",
        user: { user_id: "friend", nickname: "朋友", avatar_url: "" },
      },
    ]);

    expect((await readCachedMomentFeed("owner-a", "recommended"))?.moments).toHaveLength(200);
    await expect(readCachedMomentFeed("owner-a", "following")).resolves.toBeNull();
    await expect(readCachedMomentFeed("owner-b", "recommended")).resolves.toBeNull();
    await expect(readCachedMomentsNotifications("owner-b")).resolves.toBeNull();
    await expect(readCachedMomentsNotifications("owner-a")).resolves.toHaveLength(1);
  });

  it("treats a persisted feed as fresh until the automatic refresh interval expires", () => {
    const now = Date.parse("2026-08-10T10:00:00.000Z");
    expect(isMomentFeedCacheFresh({ cached_at: new Date(now - 1_000).toISOString() }, now)).toBe(
      true,
    );
    expect(
      isMomentFeedCacheFresh(
        { cached_at: new Date(now - momentFeedCachePolicy.ttlMilliseconds).toISOString() },
        now,
      ),
    ).toBe(false);
    expect(isMomentFeedCacheFresh({ cached_at: "invalid" }, now)).toBe(false);
  });

  it("preserves a non-empty cache until the backend confirms an empty snapshot", () => {
    expect(shouldAcceptMomentFeedFirstPage({ moments: [], has_more: false }, 2)).toBe(false);
    expect(
      shouldAcceptMomentFeedFirstPage({ moments: [], has_more: false, snapshot_complete: true }, 2),
    ).toBe(true);
    expect(mergeMomentFeed([makeMoment(1)], [makeMoment(1), makeMoment(2)])).toHaveLength(2);
    expect(upsertMomentInFeed([makeMoment(1)], makeMoment(2))).toHaveLength(1);
    expect(upsertMomentInFeed([makeMoment(1)], makeMoment(2), true).map((item) => item.id)).toEqual(
      [2, 1],
    );
  });

  it("inserts a newly created moment only into the native recommended context", () => {
    expect(momentMutationTabs(false, { kind: "created" })).toEqual(["recommended"]);
    expect(momentMutationTabs(true, { kind: "created" })).toEqual(["recommended"]);
    expect(momentMutationTabs(false, { kind: "upsert" })).toEqual(["recommended", "following"]);
    expect(momentMutationTabs(false, { kind: "delete" })).toEqual(["recommended", "following"]);
  });

  it("builds the native deterministic optimistic moment identity and local media", () => {
    const requestId = "aabbccdd-eeff-0011-2233-445566778899";
    expect(temporaryMomentId(requestId)).toBe(-Number.parseInt("aabbccddeeff", 16));
    expect(
      createOptimisticMoment({
        owner: { user_id: "owner", nickname: "我", avatar_url: "/me.jpg" },
        clientRequestId: requestId,
        content: "正在发布",
        media: [
          {
            kind: "image",
            uri: "file:///documents/outbox/one.jpg",
            filename: "one.jpg",
            mime_type: "image/jpeg",
          },
        ],
        unlockPriceGoldCoins: 50,
        createdAt: "2026-08-06T10:00:00Z",
      }),
    ).toMatchObject({
      id: -Number.parseInt("aabbccddeeff", 16),
      content: "正在发布",
      client_request_id: requestId,
      unlock_price_gold_coins: 50,
      is_unlocked: true,
      media: [
        {
          type: "image",
          url: "file:///documents/outbox/one.jpg",
          thumbnail_url: "file:///documents/outbox/one.jpg",
          is_locked: false,
        },
      ],
    });
  });
});

function makeMoment(id: number): Moment {
  return {
    id,
    author: { user_id: "owner", nickname: "我", avatar_url: "" },
    content: `动态 ${id}`,
    images: [],
    media: [],
    is_unlocked: true,
    created_at: "2026-08-06T10:00:00Z",
    likes: [],
    comments: [],
    liked_by_me: false,
  };
}
