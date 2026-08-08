import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  createAgentConversation,
  getAgentConversations,
  getAgentRuntimeConfig,
  getConversationSyncSnapshot,
  getInstalledAgents,
  getWalletBalance,
  uninstallAgent,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { normalizeAgentRuntimeConfig } from "@/api/normalizers";
import type { AgentConversation, AgentMessage, Conversation } from "@/models";
import {
  agentCatalogCacheKey,
  agentCatalogCachePolicy,
  loadCachedAgentCatalog,
  saveAgentCatalog,
  upsertCachedAgentConversation,
} from "@/services/agents/AgentCatalogRepository";
import {
  agentConversationPreview,
  agentHubErrorMessage,
  agentHubMetrics,
  compareMessageTimes,
  formatAgentHubListTime,
  isAgentCapabilityError,
  latestOpenAgentConversation,
  resolveJoinedScriptRooms,
  scriptRoomPreview,
  upsertInstalledAgent,
} from "@/services/agents/agentHubPolicy";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);

describe("native AgentHubView contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("keeps the source row, section, empty-state, banner and refresh constants", () => {
    expect(agentHubMetrics).toMatchObject({
      contentInset: 16,
      contentSpacing: 12,
      contentBottomInset: 60,
      sectionTitleSize: 13,
      sectionTitleTopInset: 4,
      cardInset: 14,
      cardRadius: 14,
      agentAvatarSize: 54,
      conversationAvatarSize: 50,
      scriptAvatarSize: 54,
      scriptAvatarRadius: 11,
      emptyVerticalInset: 70,
      createButtonHeight: 44,
      errorInset: 12,
      errorOuterInset: 16,
      errorRadius: 12,
      runtimeRefreshMilliseconds: 300_000,
    });
  });

  it("matches latest-message media precedence before text fallback", () => {
    const conversation = makeAgentConversation({
      latest_message: makeMessage([
        { id: "text", ordinal: 0, type: "text", text: "先生成中", metadata: {} },
        {
          id: "media",
          ordinal: 1,
          type: "paid_media",
          text: "",
          metadata: { media_type: "video", generation_status: "completed", access: "locked" },
        },
      ]),
    });
    expect(agentConversationPreview(conversation, translate)).toBe("[视频]");
    expect(agentConversationPreview(makeAgentConversation({ title: "默认标题" }), translate)).toBe(
      "默认标题",
    );
  });

  it("rejects a malformed runtime config instead of replacing cached flags with defaults", () => {
    expect(() => normalizeAgentRuntimeConfig({ features: {}, vision: {} })).toThrow(
      "智能体运行配置缺少必需功能开关",
    );
    expect(() => normalizeAgentRuntimeConfig({ features: {} })).toThrow(
      "智能体运行配置缺少 features/vision",
    );
  });

  it("deduplicates joined script rooms by parsed message time and sorts newest first", () => {
    const rows = resolveJoinedScriptRooms([
      makeConversation("old", "room-1", "2026-08-06 10:00:00"),
      makeConversation("new", "room-1", "2026-08-06T11:00:00Z"),
      makeConversation("second", "room-2", "2026-08-05T12:00:00Z"),
      {
        ...makeConversation("ignored", "room-3", "2026-08-07T12:00:00Z"),
        conversation_kind: "group",
      },
    ]);
    expect(rows.map((row) => row.id)).toEqual(["new", "second"]);
    expect(compareMessageTimes("2026-08-06 10:00:00", "2026-08-06T09:59:59Z")).toBeGreaterThan(0);
    expect(compareMessageTimes("2026-08-06 10:00:00", "2026-08-06T10:00:00Z")).toBe(0);
    expect(
      formatAgentHubListTime("2026-08-06T11:05:00Z", new Date("2026-08-07T08:00:00Z"), "昨天"),
    ).toBe("昨天");
  });

  it("matches Foundation whitespace semantics for previews, room guards and timestamps", () => {
    const foundationOnly = "\u0085";
    const conversation = makeAgentConversation({
      latest_message: makeMessage([
        { id: "blank", ordinal: 0, type: "text", text: foundationOnly, metadata: {} },
      ]),
      title: "默认标题",
    });
    expect(agentConversationPreview(conversation, translate)).toBe("默认标题");
    expect(
      scriptRoomPreview({
        ...makeConversation("script", "room-1", "2026-08-07T00:00:00Z"),
        last_message: foundationOnly,
      }),
    ).toBe("继续你的剧情");
    expect(
      resolveJoinedScriptRooms([
        makeConversation("ignored", foundationOnly, "2026-08-07T00:00:00Z"),
      ]),
    ).toEqual([]);
    expect(
      compareMessageTimes(
        `${foundationOnly}2026-08-06 10:00:00${foundationOnly}`,
        "2026-08-06T09:59:59Z",
      ),
    ).toBeGreaterThan(0);
  });

  it("uses the account-scoped 5-minute cache with 90-day stale retention", async () => {
    const now = Date.UTC(2026, 7, 7, 0, 0, 0);
    const snapshot = {
      installedAgents: [{ id: "agent-1", profile: { name: "伙伴" } }],
      conversations: [],
      joinedScriptRooms: [],
      spendableBalance: 42,
    };
    await saveAgentCatalog("owner-a", snapshot, now);
    expect(agentCatalogCacheKey("owner-a")).toBe(
      "bwchat.agent-catalog-v1:account:owner-a:overview",
    );
    expect(agentCatalogCacheKey("\u0085owner-a\u0085")).toBe(
      "bwchat.agent-catalog-v1:account:owner-a:overview",
    );
    expect((await loadCachedAgentCatalog("owner-a", now + 299_999))?.isStale).toBe(false);
    expect((await loadCachedAgentCatalog("owner-a", now + 300_000))?.isStale).toBe(true);
    expect(await loadCachedAgentCatalog("owner-b", now)).toBeNull();
    expect(
      await loadCachedAgentCatalog(
        "owner-a",
        now +
          agentCatalogCachePolicy.ttlMilliseconds +
          agentCatalogCachePolicy.staleRetentionMilliseconds +
          1,
      ),
    ).toBeNull();
  });

  it("reads native legacy snapshots with missing lists and walletBalance", async () => {
    const now = Date.UTC(2026, 7, 7, 0, 0, 0);
    await AsyncStorage.setItem(
      agentCatalogCacheKey("owner-legacy"),
      JSON.stringify({
        value: { walletBalance: 27 },
        updatedAt: now,
        expiresAt: now + agentCatalogCachePolicy.ttlMilliseconds,
      }),
    );

    await expect(loadCachedAgentCatalog("owner-legacy", now + 1)).resolves.toMatchObject({
      value: {
        installedAgents: [],
        conversations: [],
        joinedScriptRooms: [],
        spendableBalance: 27,
      },
      isStale: false,
    });
  });

  it("updates the cached list preview and inserts a latest-version conversation immediately", async () => {
    const now = Date.UTC(2026, 7, 7, 0, 0, 0);
    const oldConversation = makeAgentConversation({
      id: "old",
      updated_at: "2026-08-07T00:00:00Z",
    });
    await saveAgentCatalog(
      "owner-a",
      { installedAgents: [], conversations: [oldConversation], joinedScriptRooms: [] },
      now,
    );
    const latestMessage = makeMessage([
      { id: "text", ordinal: 0, type: "text", text: "刚刚回复", metadata: {} },
    ]);
    const latestConversation = makeAgentConversation({
      id: "latest",
      latest_message: latestMessage,
      updated_at: "2026-08-08T00:00:00Z",
    });

    await expect(
      upsertCachedAgentConversation("owner-a", latestConversation, now + 1),
    ).resolves.toBe(true);
    await expect(loadCachedAgentCatalog("owner-a", now + 2)).resolves.toMatchObject({
      value: {
        conversations: [{ id: "latest", latest_message: { id: latestMessage.id } }, { id: "old" }],
      },
    });
    await expect(
      upsertCachedAgentConversation("owner-without-cache", latestConversation, now + 1),
    ).resolves.toBe(false);
  });

  it("selects the newest open thread and recognizes direct or wrapped capability codes", () => {
    const rows = [
      makeAgentConversation({ id: "older", updated_at: "2026-08-05T00:00:00Z" }),
      makeAgentConversation({ id: "closed", status: "closed", updated_at: "2026-08-08T00:00:00Z" }),
      makeAgentConversation({ id: "newest", updated_at: "2026-08-07T00:00:00Z" }),
    ];
    expect(latestOpenAgentConversation(rows, "agent-1")?.id).toBe("newest");
    expect(
      isAgentCapabilityError(
        Object.assign(new Error("unsupported"), {
          name: "APIError",
          code: "6002",
        }),
      ),
    ).toBe(true);
    expect(
      isAgentCapabilityError(
        Object.assign(new Error("unsupported"), {
          name: "APIError",
          payload: { code: 6399 },
        }),
      ),
    ).toBe(true);
    expect(
      isAgentCapabilityError(
        Object.assign(new Error("unsupported"), {
          name: "APIError",
          payload: { detail: { code: "6201" } },
        }),
      ),
    ).toBe(true);
    expect(
      isAgentCapabilityError(
        Object.assign(new Error("unsupported"), {
          name: "APIError",
          payload: { data: { error_code: 6301 } },
        }),
      ),
    ).toBe(true);
    expect(
      isAgentCapabilityError(
        Object.assign(new Error("other"), {
          name: "APIError",
          code: 6400,
        }),
      ),
    ).toBe(false);
    expect(
      upsertInstalledAgent([{ id: "agent-1", profile: { name: "旧名称" } }, { id: "agent-2" }], {
        id: "agent-1",
        profile: { name: "新名称" },
      }),
    ).toEqual([{ id: "agent-2" }, { id: "agent-1", profile: { name: "新名称" } }]);
  });

  it("surfaces native detail messages but keeps 5xx infrastructure text masked", () => {
    expect(
      agentHubErrorMessage(
        Object.assign(new Error("请求失败（400）"), {
          name: "APIError",
          status: 400,
          payload: { detail: { code: 6201, message: "当前智能体能力不可用" } },
        }),
      ),
    ).toBe("当前智能体能力不可用");
    expect(
      agentHubErrorMessage(
        Object.assign(new Error("服务暂时不可用，请稍后重试"), {
          name: "APIError",
          status: 502,
          payload: { detail: { message: "502 Bad Gateway" } },
        }),
      ),
    ).toBe("服务暂时不可用，请稍后重试");
    expect(
      agentHubErrorMessage(
        Object.assign(new Error("回退错误"), {
          name: "APIError",
          payload: { detail: { message: "\u0085" }, message: "\u0085有效错误\u0085" },
        }),
      ),
    ).toBe("有效错误");
  });

  it("uses all exact native Agent Hub request envelopes, timeouts and mutation routes", async () => {
    request
      .mockResolvedValueOnce({
        features: {
          agents_enabled: true,
          image_input_enabled: true,
          paid_images_enabled: true,
          paid_videos_enabled: false,
        },
        vision: { max_images_per_turn: 2 },
        paid_media: { image: { price_points: 6 } },
      })
      .mockResolvedValueOnce({
        agents: [
          {
            agent_id: "agent-1",
            profile: { name: "伙伴" },
            capabilities: { paid_images: true, paid_videos: false },
          },
        ],
      })
      .mockResolvedValueOnce({ conversations: [makeAgentConversation()] })
      .mockResolvedValueOnce({
        conversations: [makeConversation("script", "room-1", "2026-08-07T00:00:00Z")],
      })
      .mockResolvedValueOnce({
        currency: "gold_coin",
        gold_coin_balance: 42,
        activity_cat_food_balance: 0,
        spendable_balance: 42,
        recharge_gold_coin_balance: 42,
        gift_income_gold_coin_balance: 0,
        withdraw_frozen_gold_coin_balance: 0,
        withdrawable_gold_coin_balance: 0,
        chat_money_frozen_gold_coin_balance: 0,
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(makeAgentConversation());

    await expect(getAgentRuntimeConfig()).resolves.toMatchObject({
      agents_enabled: true,
      vision: { max_images_per_turn: 2 },
      image_price_points: 6,
    });
    await expect(getInstalledAgents()).resolves.toMatchObject([
      { id: "agent-1", capabilities: { paid_images: true, paid_videos: false } },
    ]);
    await expect(getAgentConversations()).resolves.toMatchObject([{ id: "conversation-1" }]);
    await expect(getConversationSyncSnapshot()).resolves.toMatchObject({
      conversations: [{ id: "script" }],
    });
    await expect(getWalletBalance()).resolves.toMatchObject({ spendable_balance: 42 });
    await uninstallAgent("agent/1");
    await createAgentConversation("agent-1", "hello", "stable-key");

    expect(request.mock.calls).toEqual([
      ["/agents/runtime-config", { requiredData: true, requiredEnvelope: true, timeoutMs: 60_000 }],
      ["/agents/installed", { requiredData: true, requiredEnvelope: true, timeoutMs: 60_000 }],
      ["/agent-conversations", { requiredData: true, requiredEnvelope: true, timeoutMs: 60_000 }],
      [
        "/chat/conversations",
        {
          cache: "no-store",
          requiredData: true,
          requiredEnvelope: true,
          timeoutMs: 60_000,
        },
      ],
      ["/wallet/balance", { requiredData: true, requiredEnvelope: true, timeoutMs: 60_000 }],
      [
        "/agents/agent%2F1/install",
        { method: "DELETE", requiredEnvelope: true, timeoutMs: 60_000 },
      ],
      [
        "/agent-conversations",
        {
          method: "POST",
          headers: { "Idempotency-Key": "stable-key" },
          body: { agent_id: "agent-1", greeting_id: "hello" },
          requiredData: true,
          timeoutMs: 15_000,
          transientRetries: false,
        },
      ],
    ]);
  });
});

function translate(key: string): string {
  return key === "message.video" ? "[视频]" : "[图片]";
}

function makeAgentConversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: "conversation-1",
    title: "伙伴",
    status: "active",
    agent_id: "agent-1",
    agent_version_id: "version-1",
    agent_profile: { name: "伙伴" },
    agent_capabilities: { paid_images: false, paid_videos: false },
    created_at: "2026-08-07T00:00:00Z",
    updated_at: "2026-08-07T00:00:00Z",
    ...overrides,
  };
}

function makeMessage(parts: AgentMessage["parts"]): AgentMessage {
  return {
    id: "message-1",
    conversation_id: "conversation-1",
    sequence_no: 1,
    sender: { type: "agent", id: "agent-1" },
    source: "agent",
    status: "completed",
    created_at: "2026-08-07T00:00:00Z",
    updated_at: "2026-08-07T00:00:00Z",
    parts,
  };
}

function makeConversation(id: string, roomId: string, time: string): Conversation {
  return {
    type: "group",
    id,
    name: id,
    avatar_url: "",
    last_message: `preview-${id}`,
    last_message_time: time,
    unread_count: 0,
    conversation_kind: "script-room",
    script_room_id: roomId,
    is_muted: false,
  };
}
