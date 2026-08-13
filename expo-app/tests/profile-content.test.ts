import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  addMomentComment,
  createAgentConversation,
  createAgentTextTurn,
  getAgentConversations,
  getAgentMessages,
  getAgentTurn,
  getMomentDetail,
  getPublicAgentsPage,
  getUserMoments,
  getUserShortDramaSeries,
  toggleMomentLike,
  unlockMoment,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  normalizeAgentConversation,
  normalizeAgentMessagePage,
  normalizeAgentSummaryPage,
  normalizeMomentFeedPage,
  normalizeMomentUnlockResult,
  normalizeShortDramaSeriesPage,
} from "@/api/normalizers";
import type { Moment, ShortDramaSeries } from "@/models";
import {
  mergeMoments,
  mergeProfileAgents,
  mergeShortDramaSeries,
  publicProfileContentCachePolicy,
  readCachedProfileAgents,
  readCachedProfileAgentsSnapshot,
  readCachedProfileMoments,
  readCachedProfileMomentsSnapshot,
  readCachedProfileShortDramas,
  readCachedProfileShortDramasSnapshot,
  saveCachedProfileAgents,
  saveCachedProfileMoments,
  saveCachedProfileShortDramas,
  shouldAcceptMomentFirstPage,
  visibleProfileShortDramas,
} from "@/services/profile/PublicProfileContentRepository";
import {
  readCachedMomentDetail,
  saveCachedMomentDetail,
} from "@/services/moments/MomentDetailRepository";
import {
  publishMomentMutation,
  subscribeMomentMutation,
} from "@/services/moments/MomentMutationStore";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);

describe("native public-profile content contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("decodes the strict moments page, media, likes and comments aliases", () => {
    const page = normalizeMomentFeedPage({
      moments: [
        {
          moment_id: "31",
          author: { userID: 7, name: "小七", avatarURL: "/seven.png" },
          text: "旅行",
          images: ["/one.jpg"],
          media: [
            {
              media_id: "m1",
              media_type: "video",
              url: "/one.mp4",
              thumbnailURL: "/one.jpg",
              lockedPreviewURL: "/blur.jpg",
              isLocked: 1,
            },
          ],
          unlockPriceGoldCoins: "8",
          isUnlocked: false,
          likes: [{ user_id: "8", nickname: "小八" }],
          comments: [
            {
              comment_id: 12,
              text: "好看",
              userID: "8",
              name: "小八",
              replyTo: { user_id: "7", nickname: "小七" },
            },
          ],
          likedByMe: true,
          createdAt: "2026-08-06T10:00:00Z",
        },
      ],
      hasMore: true,
      snapshotComplete: false,
    });

    expect(page).toMatchObject({
      has_more: true,
      snapshot_complete: false,
      moments: [
        {
          id: 31,
          author: { user_id: "7", nickname: "小七", avatar_url: "/seven.png" },
          content: "旅行",
          unlock_price_gold_coins: 8,
          liked_by_me: true,
          media: [
            {
              id: "m1",
              type: "video",
              url: "/one.mp4",
              thumbnail_url: "/one.jpg",
              locked_preview_url: "/blur.jpg",
              is_locked: true,
            },
          ],
          comments: [
            {
              id: 12,
              content: "好看",
              user_id: "8",
              reply_to: { user_id: "7", nickname: "小七" },
            },
          ],
        },
      ],
    });
    expect(() => normalizeMomentFeedPage([])).toThrow("朋友圈列表响应格式无效");
  });

  it("preserves a populated moment cache on a non-authoritative empty first page", () => {
    const moment = makeMoment(1);
    expect(
      shouldAcceptMomentFirstPage({ moments: [], has_more: false, snapshot_complete: false }, 1),
    ).toBe(false);
    expect(
      shouldAcceptMomentFirstPage({ moments: [], has_more: false, snapshot_complete: true }, 1),
    ).toBe(true);
    expect(mergeMoments([moment], [moment, makeMoment(2)]).map((item) => item.id)).toEqual([1, 2]);
  });

  it("keeps the first agent and short-drama instance during paginated merging", () => {
    const firstAgent = normalizeAgentSummaryPage({
      agents: [{ id: "agent-1", profile: { name: "第一次" } }],
    }).agents[0]!;
    const duplicateAgent = normalizeAgentSummaryPage({
      agents: [{ id: "agent-1", profile: { name: "重复项" } }],
    }).agents[0]!;
    expect(mergeProfileAgents([firstAgent], [duplicateAgent])[0]?.profile?.name).toBe("第一次");

    const firstSeries = makeShortDrama("series-1");
    const duplicateSeries = { ...firstSeries, title: "重复项" };
    expect(mergeShortDramaSeries([firstSeries], [duplicateSeries])[0]?.title).toBe("series-1");
  });

  it("decodes direct and wrapped native moment-unlock responses with consistent charges", () => {
    expect(
      normalizeMomentUnlockResult({
        id: 31,
        author: { user_id: "7", nickname: "小七" },
        content: "已解锁",
        is_unlocked: true,
      }),
    ).toMatchObject({ moment: { id: 31, is_unlocked: true }, already_unlocked: false });

    expect(
      normalizeMomentUnlockResult({
        moment: {
          id: 31,
          author: { user_id: "7", nickname: "小七" },
          is_unlocked: true,
        },
        charged_activity_cat_food: "2",
        charged_gold_coins: 3,
        total_charged: 5,
        wallet_balance: {
          currency: "gold_coin",
          gold_coin_balance: 8,
          activity_cat_food_balance: 1,
          spendable_balance: 9,
          chat_money_frozen_gold_coin_balance: 0,
        },
        consumed_prop: {
          inventory_id: "inventory-1",
          definition_id: "media_unlock_card_image",
          remaining_quantity: 0,
        },
      }),
    ).toMatchObject({
      moment: { id: 31, is_unlocked: true },
      charge: {
        charged_activity_cat_food: 2,
        charged_gold_coins: 3,
        total_charged: 5,
        wallet_balance: { spendable_balance: 9 },
      },
      consumed_prop: {
        inventory_id: "inventory-1",
        definition_id: "media_unlock_card_image",
        remaining_quantity: 0,
      },
      already_unlocked: false,
    });
    expect(() =>
      normalizeMomentUnlockResult({
        charged_activity_cat_food: 2,
        charged_gold_coins: 3,
        total_charged: 9,
        wallet_balance: {},
      }),
    ).toThrow("混合资产扣款总额不一致");
  });

  it("decodes agent cards, conversations and ordered multipart messages", () => {
    expect(
      normalizeAgentSummaryPage({
        items: [
          {
            agent: {
              agent_id: "agent-1",
              profile: {
                name: "绘画伙伴",
                tagline: "一起画画",
                avatarAssetID: "avatar-1",
                tags: ["绘画", "陪伴"],
              },
              greetings: [{ greeting_id: "hello", content: "你好" }],
            },
          },
        ],
        nextCursor: "next",
      }),
    ).toMatchObject({
      agents: [
        {
          id: "agent-1",
          profile: { name: "绘画伙伴", avatar_asset_id: "avatar-1" },
          greetings: [{ id: "hello", text: "你好" }],
        },
      ],
      has_more: true,
      next_cursor: "next",
    });

    expect(
      normalizeAgentConversation({
        conversation: {
          conversationID: "conversation-1",
          agentID: "agent-1",
          agentProfile: { name: "绘画伙伴" },
          updatedAt: "2026-08-06T10:00:00Z",
        },
      }),
    ).toMatchObject({
      id: "conversation-1",
      agent_id: "agent-1",
      agent_profile: { name: "绘画伙伴" },
    });

    expect(
      normalizeAgentMessagePage({
        messages: [
          {
            messageID: "m2",
            sequenceNo: 2,
            sender: { type: "agent", actorID: "agent-1" },
            parts: [
              { partID: "p2", ordinal: 2, type: "text", text: "第二段" },
              { partID: "p1", ordinal: 1, type: "text", text: "第一段" },
            ],
          },
          {
            messageID: "m1",
            sequenceNo: 1,
            sender: { type: "user", id: "owner" },
            parts: [],
          },
        ],
        hasMore: true,
      }),
    ).toMatchObject({
      has_more: true,
      messages: [
        { id: "m1", sequence_no: 1 },
        {
          id: "m2",
          sequence_no: 2,
          parts: [
            { id: "p1", ordinal: 1 },
            { id: "p2", ordinal: 2 },
          ],
        },
      ],
    });
  });

  it("keeps only the target creator's published short dramas", () => {
    const page = normalizeShortDramaSeriesPage({
      list: [
        {
          id: "published",
          name: "夏日",
          status: "已上线",
          creator: { user_id: "owner", nickname: "作者" },
          videos: [
            {
              video_id: "episode-1",
              episode_no: 1,
              video_url: "/one.mp4",
              duration: "22.5",
            },
          ],
        },
        {
          id: "draft",
          name: "草稿",
          status: "draft",
          creator: { user_id: "owner" },
        },
        {
          id: "other",
          name: "别人",
          status: "published",
          creator: { user_id: "other" },
        },
      ],
    });
    expect(visibleProfileShortDramas(page.series, "owner").map((item) => item.series_id)).toEqual([
      "published",
    ]);
    expect(page.series[0]).toMatchObject({
      status: "published",
      episodes: [
        {
          id: "episode-1",
          episode_number: 1,
          play_url: "/one.mp4",
          duration_seconds: 22.5,
          creator: { user_id: "owner" },
        },
      ],
    });
  });

  it("uses the exact native moments, agents, short-drama and agent-chat routes", async () => {
    request
      .mockResolvedValueOnce({ moments: [], has_more: false })
      .mockResolvedValueOnce({ liked: true })
      .mockResolvedValueOnce({ agents: [], has_more: false })
      .mockResolvedValueOnce({ series: [], has_more: false })
      .mockResolvedValueOnce({ conversations: [] })
      .mockResolvedValueOnce({
        conversation: {
          id: "conversation-1",
          agent_id: "agent-1",
          agent_profile: { name: "伙伴" },
        },
      })
      .mockResolvedValueOnce({ messages: [], has_more: false })
      .mockResolvedValueOnce({
        turn: { id: "turn-1", status: "queued" },
        message: { id: "message-1", sender: { type: "user" }, parts: [] },
      })
      .mockResolvedValueOnce({
        turn: { id: "turn-1", status: "completed" },
        response_message: {
          id: "message-2",
          sender: { type: "agent" },
          parts: [{ id: "part-1", type: "text", text: "你好" }],
        },
      });

    await getUserMoments("user/7", { limit: 24, beforeId: 31 });
    await expect(toggleMomentLike(31)).resolves.toBe(true);
    await getPublicAgentsPage("user/7", { limit: 20, cursor: "next cursor" });
    await getUserShortDramaSeries("user/7", { limit: 12, cursor: "drama cursor" });
    await getAgentConversations();
    await createAgentConversation("agent/1", "hello");
    await getAgentMessages("conversation/1", { limit: 30, beforeSequence: 9 });
    await createAgentTextTurn("conversation/1", "你好", "client-message-1");
    await getAgentTurn("turn/1");

    expect(request).toHaveBeenNthCalledWith(1, "/moments/user/user%2F7?limit=24&before_id=31", {
      requiredData: true,
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/moments/31/like", {
      method: "POST",
      body: {},
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/agents/public?limit=20&owner_user_id=user%2F7&cursor=next+cursor",
      { requiredData: true, requiredEnvelope: true },
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      "/short-drama/series?creator_user_id=user%2F7&limit=12&cursor=drama+cursor",
      { requiredData: true, requiredEnvelope: true },
    );
    expect(request).toHaveBeenNthCalledWith(5, "/agent-conversations", {
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
    });
    expect(request).toHaveBeenNthCalledWith(
      6,
      "/agent-conversations",
      expect.objectContaining({
        method: "POST",
        headers: { "Idempotency-Key": expect.any(String) },
        body: { agent_id: "agent/1", greeting_id: "hello" },
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      7,
      "/agent-conversations/conversation%2F1/messages?limit=30&before_sequence=9",
    );
    expect(request).toHaveBeenNthCalledWith(
      8,
      "/agent-conversations/conversation%2F1/turns",
      expect.objectContaining({
        method: "POST",
        headers: { "Idempotency-Key": expect.any(String) },
        timeoutMs: 30_000,
        body: {
          client_message_id: "client-message-1",
          parts: [{ type: "text", text: "你好" }],
        },
      }),
    );
    expect(request).toHaveBeenNthCalledWith(9, "/agent-turns/turn%2F1");
  });

  it("uses the exact native moment-detail, multipart comment and idempotent unlock routes", async () => {
    request
      .mockResolvedValueOnce({
        id: 31,
        author: { user_id: "7", nickname: "小七" },
        content: "详情",
      })
      .mockResolvedValueOnce({
        id: 12,
        user_id: "8",
        nickname: "小八",
        content: "回复",
      })
      .mockResolvedValueOnce({
        moment: {
          id: 31,
          author: { user_id: "7", nickname: "小七" },
          is_unlocked: true,
        },
        already_unlocked: false,
      });

    await expect(getMomentDetail(31)).resolves.toMatchObject({ id: 31, content: "详情" });
    await expect(
      addMomentComment(31, "回复", {
        replyToUserId: "user/8",
        image: { uri: "file:///comment.jpg", filename: "comment.jpg" },
      }),
    ).resolves.toMatchObject({ id: 12, content: "回复" });
    await expect(unlockMoment(31, "video", "unlock-key-1")).resolves.toMatchObject({
      moment: { id: 31, is_unlocked: true },
    });

    expect(request).toHaveBeenNthCalledWith(1, "/moments/detail/31");
    expect(request).toHaveBeenNthCalledWith(2, "/moments/31/comment", {
      method: "POST",
      body: expect.any(FormData),
      timeoutMs: 90_000,
    });
    expect(request).toHaveBeenNthCalledWith(3, "/moments/31/unlock", {
      method: "POST",
      headers: { "Idempotency-Key": "unlock-key-1" },
      body: {
        payment_method: "auto",
        prop_definition_id: "media_unlock_card_video",
      },
      requiredData: true,
      transientRetries: false,
    });
  });

  it("isolates and caps all three profile content caches per signed-in account", async () => {
    const moments = Array.from({ length: 205 }, (_, index) => makeMoment(index + 1));
    const agents = Array.from(
      { length: 205 },
      (_, index) =>
        normalizeAgentSummaryPage({
          agents: [{ id: `agent-${index + 1}`, profile: { name: `智能体 ${index + 1}` } }],
        }).agents[0]!,
    );
    const series = Array.from({ length: 205 }, (_, index) => makeShortDrama(`series-${index + 1}`));
    await saveCachedProfileMoments("owner-a", "target", {
      moments,
      has_more: true,
    });
    await saveCachedProfileShortDramas("owner-a", "target", {
      series,
      has_more: true,
    });
    await saveCachedProfileAgents("owner-a", "target", {
      agents,
      has_more: true,
      next_cursor: "next",
    });

    await expect(readCachedProfileMoments("owner-a", "target")).resolves.toMatchObject({
      moments: expect.any(Array),
    });
    expect((await readCachedProfileMoments("owner-a", "target"))?.moments).toHaveLength(200);
    expect((await readCachedProfileAgents("owner-a", "target"))?.agents).toHaveLength(200);
    expect((await readCachedProfileShortDramas("owner-a", "target"))?.series).toHaveLength(200);
    await expect(readCachedProfileMoments("owner-b", "target")).resolves.toBeNull();
    await expect(readCachedProfileAgents("owner-b", "target")).resolves.toBeNull();
    await expect(readCachedProfileShortDramas("owner-b", "target")).resolves.toBeNull();
  });

  it("uses per-content freshness with 30-day stale retention", async () => {
    const now = 1_800_000_000_000;
    await saveCachedProfileMoments(
      "owner-a",
      "target",
      { moments: [makeMoment(1)], has_more: false },
      now,
    );
    await saveCachedProfileShortDramas(
      "owner-a",
      "target",
      { series: [makeShortDrama("series-1")], has_more: false },
      now,
    );
    await saveCachedProfileAgents(
      "owner-a",
      "target",
      {
        agents: normalizeAgentSummaryPage({
          agents: [{ id: "agent-1", profile: { name: "缓存智能体" } }],
        }).agents,
        has_more: false,
      },
      now,
    );

    await expect(
      readCachedProfileMomentsSnapshot("owner-a", "target", now + 1),
    ).resolves.toMatchObject({ isStale: false, isRetained: true, isLegacy: false });
    await expect(
      readCachedProfileMomentsSnapshot(
        "owner-a",
        "target",
        now + publicProfileContentCachePolicy.moments.ttlMilliseconds,
      ),
    ).resolves.toMatchObject({ isStale: true, isRetained: true });
    await expect(
      readCachedProfileMomentsSnapshot(
        "owner-a",
        "target",
        now +
          publicProfileContentCachePolicy.moments.ttlMilliseconds +
          publicProfileContentCachePolicy.moments.staleRetentionMilliseconds +
          1,
      ),
    ).resolves.toMatchObject({ isStale: true, isRetained: false });
    await expect(
      readCachedProfileAgentsSnapshot(
        "owner-a",
        "target",
        now + publicProfileContentCachePolicy.agents.ttlMilliseconds - 1,
      ),
    ).resolves.toMatchObject({ isStale: false, isRetained: true });
    await expect(
      readCachedProfileAgentsSnapshot(
        "owner-a",
        "target",
        now + publicProfileContentCachePolicy.agents.ttlMilliseconds,
      ),
    ).resolves.toMatchObject({ isStale: true, isRetained: true });
    await expect(
      readCachedProfileShortDramasSnapshot(
        "owner-a",
        "target",
        now + publicProfileContentCachePolicy.shortDramas.ttlMilliseconds - 1,
      ),
    ).resolves.toMatchObject({ isStale: false, isRetained: true });
    await expect(
      readCachedProfileShortDramasSnapshot(
        "owner-a",
        "target",
        now + publicProfileContentCachePolicy.shortDramas.ttlMilliseconds,
      ),
    ).resolves.toMatchObject({ isStale: true, isRetained: true });
  });

  it("isolates moment-detail snapshots and broadcasts one mutation per subscriber", async () => {
    const moment = makeMoment(31);
    await saveCachedMomentDetail("owner-a", moment);
    await expect(readCachedMomentDetail("owner-a", 31)).resolves.toMatchObject({
      id: 31,
      content: "动态 31",
    });
    await expect(readCachedMomentDetail("owner-b", 31)).resolves.toBeNull();

    const listener = jest.fn();
    const otherOwnerListener = jest.fn();
    const unsubscribe = subscribeMomentMutation("owner-a", listener);
    const unsubscribeOther = subscribeMomentMutation("owner-b", otherOwnerListener);
    publishMomentMutation("owner-a", { kind: "upsert", moment });
    unsubscribe();
    publishMomentMutation("owner-a", { kind: "delete", momentId: 31 });
    unsubscribeOther();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ kind: "upsert", moment });
    expect(otherOwnerListener).not.toHaveBeenCalled();
  });
});

function makeMoment(id: number): Moment {
  return {
    id,
    author: { user_id: "target", nickname: "朋友", avatar_url: "" },
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

function makeShortDrama(id: string): ShortDramaSeries {
  return {
    series_id: id,
    title: id,
    intro: "",
    cover_url: "",
    episode_count: 0,
    status: "published",
    updated_at: "",
    episodes: [],
    creator: {
      user_id: "target",
      username: "",
      nickname: "作者",
      avatar_url: "",
      followed_by_me: false,
      follows_me: false,
      is_friend: false,
    },
    resume_position_seconds: 0,
  };
}
