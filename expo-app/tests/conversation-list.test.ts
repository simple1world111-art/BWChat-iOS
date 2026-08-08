import AsyncStorage from "@react-native-async-storage/async-storage";

import { hideConversation, updateConversationPreference } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import type {
  AgentConversation,
  AgentSummary,
  Conversation,
  ConversationSyncSnapshot,
  FriendInfo,
} from "@/models";
import {
  aggregateConversationUnread,
  applyConversationLocalState,
  applyServerPinnedRows,
  conversationHiddenSnapshot,
  conversationListIdentity,
  conversationListTime,
  conversationPreviewText,
  conversationSenderPrefix,
  mergeAgentConversationRows,
  preservingIncompleteConversationRows,
  reconcileLivePairConversationRows,
  reconcileLatestConversationPreviews,
  shouldResolveScriptRoomAvatar,
  shouldShowConversationEventSender,
  shouldApplyConversationPreview,
  sortConversationRows,
  visibleChatConversations,
} from "@/services/conversations/ConversationListPolicy";
import {
  hideCachedConversation,
  loadCachedConversationSnapshot,
  loadConversationInitiatedDmIds,
  loadConversationListLocalState,
  loadConversationLivePairIds,
  loadConversationSnapshotWithNativeCache,
  reconcileConversationSnapshot,
  resetConversationRepositoryMemoryForAccount,
  saveCachedConversationItemsProjection,
  saveConversationHiddenSnapshots,
  saveConversationInitiatedDmIds,
  saveConversationLivePairIds,
  saveConversationPinnedKeys,
  unhideCachedConversation,
} from "@/services/conversations/ConversationRepository";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
const request = jest.mocked(apiRequest);

describe("native conversation-list contract", () => {
  beforeEach(async () => {
    request.mockReset();
    resetConversationRepositoryMemoryForAccount("owner-a");
    resetConversationRepositoryMemoryForAccount("owner-b");
    await AsyncStorage.clear();
  });

  it("uses the exact native preference route and pin/hide bodies", async () => {
    request.mockResolvedValue({
      conversation_type: "dm",
      target_id: "friend",
      is_pinned: true,
      is_hidden: false,
      revision: 2,
    });
    await updateConversationPreference("dm", "friend", true);
    request.mockResolvedValue({
      conversation_type: "group",
      target_id: "7",
      is_pinned: false,
      is_hidden: true,
      revision: 3,
    });
    await hideConversation("group", "7");
    expect(request).toHaveBeenNthCalledWith(1, "/chat/conversations/dm/friend/preferences", {
      method: "PUT",
      body: { is_pinned: true, is_hidden: false },
      requiredData: true,
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/chat/conversations/group/7/preferences", {
      method: "PUT",
      body: { is_pinned: false, is_hidden: true },
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("uses native-stable identities for dm, group, agent threads, profiles and script rows", () => {
    expect(conversationListIdentity(row({ id: "friend" }))).toBe("dm:friend");
    expect(conversationListIdentity(row({ type: "group_chat", id: "group_7" }))).toBe("group:7");
    expect(
      conversationListIdentity(
        row({
          type: "agent",
          id: "legacy-thread",
          conversation_kind: "agent_conversation",
        }),
      ),
    ).toBe("agent:legacy-thread");
    expect(
      conversationListIdentity(
        row({ type: "agent", id: "a1", conversation_kind: "agent_profile", agent_id: "a1" }),
      ),
    ).toBe("agent-profile:a1");
    expect(
      conversationListIdentity(
        row({ type: "group", id: "9", group_id: 9, conversation_kind: "script_room" }),
      ),
    ).toBe("group:9");
  });

  it("keeps only meaningful non-friend dm rows while preserving self and non-dm rows", () => {
    const friends: FriendInfo[] = [
      { user_id: "friend", nickname: "Friend", avatar_url: "", added_at: "" },
    ];
    const result = visibleChatConversations(
      [
        row({ id: "owner-a" }),
        row({ id: "friend" }),
        row({ id: "stranger" }),
        row({ id: "incoming", unread_count: 1 }),
        row({ type: "group", id: "7", group_id: 7 }),
      ],
      friends,
      "owner-a",
    );
    expect(result.map(conversationListIdentity)).toEqual([
      "dm:owner-a",
      "dm:friend",
      "dm:incoming",
      "group:7",
    ]);
  });

  it("keeps a locally initiated empty dm even before the friend list or snapshot catches up", () => {
    const result = visibleChatConversations(
      [row({ id: "outgoing-peer" }), row({ id: "unrelated-peer" })],
      [],
      "owner-a",
      new Set(["outgoing-peer"]),
    );
    expect(result.map(conversationListIdentity)).toEqual(["dm:outgoing-peer"]);
  });

  it("keeps a registered live-pair row across an authoritative snapshot that has not caught up", () => {
    const livePair = row({ id: "live-peer", conversation_kind: "live_call" });
    expect(
      reconcileLivePairConversationRows(
        [],
        [livePair, row({ id: "ordinary" })],
        new Set(["live-peer"]),
      ),
    ).toEqual([livePair]);
  });

  it("preserves live rows for incomplete snapshots but accepts authoritative deletion", () => {
    const incoming = [row({ id: "new" })];
    const current = [row({ id: "old" }), row({ type: "agent", id: "agent" })];
    expect(
      preservingIncompleteConversationRows(incoming, current, false).map(conversationListIdentity),
    ).toEqual(["dm:new", "dm:old"]);
    expect(
      preservingIncompleteConversationRows(incoming, current, true).map(conversationListIdentity),
    ).toEqual(["dm:new"]);
  });

  it("keeps a newer realtime preview and unread floor when a late HTTP snapshot arrives", () => {
    const reconciled = reconcileLatestConversationPreviews(
      [
        row({
          id: "friend",
          last_message: "older server",
          last_message_time: "2026-08-08T10:00:00Z",
          last_message_id: 40,
          unread_count: 2,
        }),
      ],
      [
        row({
          id: "friend",
          last_message: "new realtime",
          last_message_time: "2026-08-08T10:01:00Z",
          last_message_id: 41,
          unread_count: 3,
          subtitle: "Sender",
        }),
      ],
    );
    expect(reconciled[0]).toMatchObject({
      last_message: "new realtime",
      last_message_time: "2026-08-08T10:01:00Z",
      last_message_id: 41,
      unread_count: 3,
      subtitle: "Sender",
    });
  });

  it("does not resurrect unread state already covered by a local read-through watermark", () => {
    const reconciled = reconcileLatestConversationPreviews(
      [row({ id: "friend", last_message_id: 41, unread_count: 4 })],
      [row({ id: "friend", last_message_id: 41, read_through_message_id: 41, unread_count: 0 })],
    );
    expect(reconciled[0]).toMatchObject({ unread_count: 0, read_through_message_id: 41 });
  });

  it("lets an authoritative same-preview revision replace an older local unread count", () => {
    const reconciled = reconcileLatestConversationPreviews(
      [
        row({
          id: "friend",
          last_message_time: "2026-08-08T10:00:00Z",
          last_message_id: 41,
          unread_count: 1,
          revision: 9,
        }),
      ],
      [
        row({
          id: "friend",
          last_message_time: "2026-08-08T10:00:00Z",
          last_message_id: 41,
          unread_count: 4,
          revision: 8,
        }),
      ],
    );
    expect(reconciled[0]?.unread_count).toBe(1);
  });

  it("rejects stale or duplicate realtime previews and accepts monotonic messages", () => {
    const current = row({
      last_message_time: "2026-08-08T10:00:00Z",
      last_message_id: 10,
    });
    expect(shouldApplyConversationPreview(current, "2026-08-08T09:59:59Z", 11)).toBe(false);
    expect(shouldApplyConversationPreview(current, "2026-08-08T10:00:00Z", 10)).toBe(false);
    expect(shouldApplyConversationPreview(current, "2026-08-08T10:00:00Z", 11)).toBe(true);
    expect(shouldApplyConversationPreview(current, "2026-08-08T10:00:01Z", 1)).toBe(true);
  });

  it("merges active agent threads with only unmatched owned installed agents", () => {
    const merged = mergeAgentConversationRows(
      [row({ id: "friend" })],
      [],
      [agentConversation("thread-1", "agent-1")],
      [agentSummary("agent-1"), agentSummary("agent-2"), agentSummary("foreign", false)],
      (key) => key,
    );
    expect(merged.map(conversationListIdentity)).toEqual([
      "dm:friend",
      "agent:thread-1",
      "agent-profile:agent-2",
    ]);
  });

  it("does not invent a preview for an installed agent without native profile copy", () => {
    const profileOnlyAgent: AgentSummary = {
      ...agentSummary("agent-empty"),
      profile: { name: "agent-empty" },
    };
    const merged = mergeAgentConversationRows([], [], [], [profileOnlyAgent], (key) => key);
    expect(merged).toHaveLength(1);
    expect(merged[0]).not.toHaveProperty("last_message");
  });

  it("always refreshes a script-room avatar from its authoritative room cover", () => {
    expect(
      shouldResolveScriptRoomAvatar(
        row({
          type: "group",
          id: "7",
          group_id: 7,
          conversation_kind: "script_room",
          script_room_id: "room-7",
          avatar_url: "https://stale.example/old.png",
        }),
      ),
    ).toBe(true);
    expect(shouldResolveScriptRoomAvatar(row({ type: "group", id: "7", group_id: 7 }))).toBe(false);
  });

  it("renders native sticker, gift and money previews instead of raw payload JSON", () => {
    const translate = (key: string, ...args: (string | number)[]) =>
      args.length ? `${key}:${args.join(",")}` : key;
    expect(
      conversationPreviewText(
        row({
          last_message: JSON.stringify({
            sticker_id: "sticker-1",
            pack_id: "pack-1",
            asset_key: "happy",
            name: { "zh-Hans": "开心" },
          }),
        }),
        { activeLanguage: "zh-Hans", viewerId: "owner-a", translate },
      ),
    ).toBe("[开心]");
    expect(
      conversationPreviewText(
        row({
          last_message: JSON.stringify({
            gift_id: "fish_10",
            gift_name: "Dried Fish",
            asset_key: "gift_fish",
            gold_coin_amount: 10,
            receiver_currency: "gold_coin",
          }),
        }),
        { activeLanguage: "zh-Hans", viewerId: "owner-a", translate },
      ),
    ).toBe("message.giftWithName:gift.item.fish");
    expect(
      conversationPreviewText(
        row({
          last_message: JSON.stringify({
            asset_id: "transfer-1",
            kind: "transfer",
            scope: "dm",
            sender_id: "sender",
            recipient_id: "owner-a",
            amount: 1,
            status: "pending",
          }),
        }),
        { activeLanguage: "zh-Hans", viewerId: "owner-a", translate },
      ),
    ).toBe("chatMoney.preview.transfer chatMoney.transfer.receivePrompt");
  });

  it("keeps ordinary sender prefixes but suppresses recall and money-receipt senders", () => {
    const translatedReceipt = "转账已收款";
    const translate = (key: string) =>
      key === "chatMoney.receipt.transferAccepted" ? translatedReceipt : key;
    expect(
      conversationSenderPrefix(row({ subtitle: "Alice", last_message: "给你一个红包" }), translate),
    ).toBe("Alice");
    expect(
      conversationSenderPrefix(
        row({ subtitle: "Alice", last_message: translatedReceipt }),
        translate,
      ),
    ).toBeUndefined();
    expect(shouldShowConversationEventSender("recalled", "原消息")).toBe(false);
    expect(
      shouldShowConversationEventSender(
        "text",
        JSON.stringify({
          data: {
            receipt_message: {
              payload: {
                assetId: "transfer-1",
                eventType: "transfer_accepted",
                actorId: "friend",
              },
            },
          },
        }),
      ),
    ).toBe(false);
    expect(shouldShowConversationEventSender("text", "普通消息")).toBe(true);
  });

  it("sorts self first, then pinned rows, then real timestamps and deterministic identity", () => {
    const result = sortConversationRows(
      [
        row({ id: "older", last_message_time: "2026-08-06 09:00:00" }),
        row({ id: "owner-a" }),
        row({ id: "newer", last_message_time: "2026-08-06T10:00:00Z" }),
        row({ id: "pinned", last_message_time: "2020-01-01T00:00:00Z" }),
      ],
      new Set(["dm:pinned"]),
      "owner-a",
    );
    expect(result.map((item) => item.id)).toEqual(["owner-a", "pinned", "newer", "older"]);
  });

  it("hides an unchanged deleted row and restores it when new content arrives", () => {
    const original = row({
      id: "friend",
      last_message: "old",
      last_message_time: "2026-08-06T10:00:00Z",
    });
    const hidden = { "dm:friend": conversationHiddenSnapshot(original) };
    expect(
      applyConversationLocalState([original], { pinnedKeys: new Set(), hiddenSnapshots: hidden })
        .conversations,
    ).toEqual([]);
    const incoming = { ...original, last_message: "new" };
    const applied = applyConversationLocalState(
      [incoming],
      { pinnedKeys: new Set(), hiddenSnapshots: hidden },
      "owner-a",
    );
    expect(applied.conversations).toEqual([incoming]);
    expect(applied.hiddenSnapshots).toEqual({});
  });

  it("applies server pin values, excludes muted unread and matches native list-time buckets", () => {
    const pinned = applyServerPinnedRows(new Set(["dm:old"]), [
      row({ id: "old", is_pinned: false }),
      row({ id: "new", is_pinned: true }),
    ]);
    expect([...pinned]).toEqual(["dm:new"]);
    expect(
      aggregateConversationUnread([
        row({ id: "visible", unread_count: 4 }),
        row({ id: "muted", unread_count: 9, is_muted: true }),
      ]),
    ).toBe(4);
    const now = new Date("2026-08-08T12:00:00+09:00");
    expect(conversationListTime("2026-08-08T10:15:00+09:00", now, "昨天")).toBe("10:15");
    expect(conversationListTime("2026-08-07T10:15:00+09:00", now, "昨天")).toBe("昨天");
    expect(conversationListTime("2026-07-31T10:15:00+09:00", now, "昨天")).toBe("07/31");
  });

  it("persists account-isolated pins and hidden snapshots and deletes cached projection", async () => {
    const conversation = row({ id: "friend", last_message: "old" });
    await reconcileConversationSnapshot("owner-a", snapshot([conversation]), 100);
    await reconcileConversationSnapshot("owner-b", snapshot([conversation]), 100);
    await saveConversationPinnedKeys("owner-a", new Set(["dm:friend"]));
    await saveConversationHiddenSnapshots("owner-a", {});
    const hidden = await hideCachedConversation("owner-a", conversation);
    expect(hidden["dm:friend"]).toBe(conversationHiddenSnapshot(conversation));
    expect((await loadConversationListLocalState("owner-a")).pinnedKeys).toEqual(new Set());
    expect((await loadCachedConversationSnapshot("owner-a"))?.conversations).toEqual([]);
    expect((await loadCachedConversationSnapshot("owner-b"))?.conversations).toEqual([
      conversation,
    ]);
  });

  it("serializes concurrent hide and unhide mutations without losing sibling rows", async () => {
    const first = row({ id: "first", last_message: "one" });
    const second = row({ id: "second", last_message: "two" });
    await Promise.all([
      hideCachedConversation("owner-a", first),
      hideCachedConversation("owner-a", second),
    ]);
    expect((await loadConversationListLocalState("owner-a")).hiddenSnapshots).toEqual({
      "dm:first": conversationHiddenSnapshot(first),
      "dm:second": conversationHiddenSnapshot(second),
    });
    await Promise.all([
      unhideCachedConversation("owner-a", first),
      unhideCachedConversation("owner-a", second),
    ]);
    expect((await loadConversationListLocalState("owner-a")).hiddenSnapshots).toEqual({});
  });

  it("persists an empty live-pair seed and its account-scoped peer registration", async () => {
    const livePair = row({ id: "live-peer", conversation_kind: "live_call" });
    await saveCachedConversationItemsProjection("owner-a", [livePair]);
    await saveConversationLivePairIds("owner-a", new Set(["live-peer"]));
    expect((await loadCachedConversationSnapshot("owner-a"))?.conversations).toEqual([livePair]);
    expect(await loadConversationLivePairIds("owner-a")).toEqual(new Set(["live-peer"]));
    expect(await loadConversationLivePairIds("owner-b")).toEqual(new Set());
  });

  it("persists locally initiated dm visibility separately and per account", async () => {
    await saveConversationInitiatedDmIds("owner-a", new Set(["outgoing-peer"]));
    expect(await loadConversationInitiatedDmIds("owner-a")).toEqual(new Set(["outgoing-peer"]));
    expect(await loadConversationInitiatedDmIds("owner-b")).toEqual(new Set());
    expect(await loadConversationLivePairIds("owner-a")).toEqual(new Set());

    resetConversationRepositoryMemoryForAccount("owner-a");
    expect(await loadConversationInitiatedDmIds("owner-a")).toEqual(new Set(["outgoing-peer"]));
  });

  it("uses the two-minute native cache, single-flights stale refresh and falls back offline", async () => {
    const cached = snapshot([row({ id: "cached" })]);
    await reconcileConversationSnapshot("owner-a", cached, 100);
    const fetch = jest.fn(async () => snapshot([row({ id: "network" })]));
    expect(
      await loadConversationSnapshotWithNativeCache("owner-a", fetch, { now: 100 + 119_000 }),
    ).toEqual(cached);
    expect(fetch).not.toHaveBeenCalled();
    const first = loadConversationSnapshotWithNativeCache("owner-a", fetch, { now: 100 + 121_000 });
    const second = loadConversationSnapshotWithNativeCache("owner-a", fetch, {
      now: 100 + 121_000,
    });
    expect(await first).toEqual(snapshot([row({ id: "network" })]));
    expect(await second).toEqual(snapshot([row({ id: "network" })]));
    expect(fetch).toHaveBeenCalledTimes(1);

    resetConversationRepositoryMemoryForAccount("owner-a");
    const offline = jest.fn(async () => {
      throw new Error("offline");
    });
    expect(
      await loadConversationSnapshotWithNativeCache("owner-a", offline, {
        forceRefresh: true,
        now: 100 + 122_000,
      }),
    ).toEqual(snapshot([row({ id: "network" })]));
  });
});

function row(overrides: Partial<Conversation> = {}): Conversation {
  return {
    type: "dm",
    id: "friend",
    name: "Friend",
    avatar_url: "",
    unread_count: 0,
    is_muted: false,
    ...overrides,
  };
}

function snapshot(conversations: Conversation[]): ConversationSyncSnapshot {
  return { conversations, revision: 1, snapshot_complete: true };
}

function agentConversation(id: string, agentId: string): AgentConversation {
  return {
    id,
    title: "Agent",
    status: "active",
    agent_id: agentId,
    agent_version_id: "version",
    agent_profile: { name: "Agent" },
    agent_capabilities: { paid_images: false, paid_videos: false },
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-08T00:00:00Z",
  };
}

function agentSummary(id: string, isOwner = true): AgentSummary {
  return {
    id,
    is_owner: isOwner,
    profile: { name: id, description: `About ${id}` },
    greetings: [{ id: "hello", text: "Hello" }],
  };
}
