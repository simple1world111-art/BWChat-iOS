import AsyncStorage from "@react-native-async-storage/async-storage";

import { hideConversation, updateConversationPreference } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import type {
  AgentConversation,
  AgentMessage,
  AgentSummary,
  Conversation,
  ConversationSyncSnapshot,
  FriendInfo,
} from "@/models";
import {
  aggregateConversationUnread,
  applyAgentRealtimeMessage,
  applyConversationLocalState,
  applyServerPinnedRows,
  conversationHiddenSnapshot,
  conversationEventSender,
  conversationListIdentity,
  conversationListTime,
  conversationPreviewText,
  conversationSenderPrefix,
  consumeConversationRealtimeUnreadEvent,
  mergeAgentConversationRows,
  preservingIncompleteConversationRows,
  reconcileLivePairConversationRows,
  reconcileLatestConversationPreviews,
  reconcileRetainedDirectConversationRows,
  resetConversationRealtimeUnreadEventsForTests,
  shouldResolveScriptRoomAvatar,
  shouldShowConversationEventSender,
  shouldApplyConversationPreview,
  shouldApplyRealtimeConversationPreview,
  sortConversationRows,
  visibleChatConversations,
} from "@/services/conversations/ConversationListPolicy";
import {
  applyConversationReadReceipt,
  applyConversationReadReceiptToSnapshot,
  applyDirectConversationCandidate,
  applyDirectConversationPreviewUpdate,
  hideCachedConversation,
  loadCachedConversationSnapshot,
  loadConversationInitiatedDmIds,
  loadConversationListLocalState,
  loadConversationLivePairIds,
  loadConversationSnapshotWithNativeCache,
  publishDirectConversationCandidate,
  reconcileConversationSnapshot,
  resetConversationRepositoryMemoryForAccount,
  saveCachedConversationItemsProjection,
  saveConversationHiddenSnapshots,
  saveConversationInitiatedDmIds,
  saveConversationLivePairIds,
  saveConversationPinnedKeys,
  shouldAcceptConversationSnapshot,
  subscribeDirectConversationCandidates,
  unhideCachedConversation,
} from "@/services/conversations/ConversationRepository";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
const request = jest.mocked(apiRequest);

describe("native conversation-list contract", () => {
  beforeEach(async () => {
    request.mockReset();
    resetConversationRepositoryMemoryForAccount("owner-a");
    resetConversationRepositoryMemoryForAccount("owner-b");
    resetConversationRealtimeUnreadEventsForTests();
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

  it("keeps a followed empty dm across an authoritative snapshot that has not caught up", () => {
    const followed = row({ id: "followed-peer", name: "Followed" });
    expect(
      reconcileRetainedDirectConversationRows(
        [],
        [followed, row({ id: "ordinary" })],
        new Set(["followed-peer"]),
      ),
    ).toEqual([followed]);
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

  it("keeps the highest message ID when a late snapshot has a misleading newer timestamp", () => {
    const reconciled = reconcileLatestConversationPreviews(
      [
        row({
          id: "friend",
          last_message: "message 100",
          last_message_time: "2026-08-08T10:00:02Z",
          last_message_id: 100,
          unread_count: 1,
        }),
      ],
      [
        row({
          id: "friend",
          last_message: "message 101",
          last_message_time: "2026-08-08T10:00:01Z",
          last_message_id: 101,
          unread_count: 2,
        }),
      ],
    );
    expect(reconciled[0]).toMatchObject({
      last_message: "message 101",
      last_message_id: 101,
      unread_count: 2,
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

  it("keeps locally known sender identity for the same group message after refresh", () => {
    const reconciled = reconcileLatestConversationPreviews(
      [
        row({
          type: "group",
          id: "7",
          group_id: 7,
          last_message: "还是没有",
          last_message_time: "2026-08-08T10:00:00Z",
          last_message_id: 41,
          subtitle: "Peter",
        }),
      ],
      [
        row({
          type: "group",
          id: "7",
          group_id: 7,
          last_message: "还是没有",
          last_message_time: "2026-08-08T10:00:00Z",
          last_message_id: 41,
          last_message_sender_id: "owner-a",
          subtitle: undefined,
        }),
      ],
    );

    expect(reconciled[0]?.last_message_sender_id).toBe("owner-a");
    expect(reconciled[0]?.subtitle).toBeUndefined();
    expect(conversationSenderPrefix(reconciled[0]!, undefined, "owner-a")).toBeUndefined();
  });

  it("does not reuse sender metadata after the server changes a same-id preview", () => {
    const reconciled = reconcileLatestConversationPreviews(
      [
        row({
          type: "group",
          id: "7",
          group_id: 7,
          last_message: "Peter撤回了一条消息",
          last_message_time: "2026-08-08T10:00:00Z",
          last_message_id: 41,
          subtitle: undefined,
        }),
      ],
      [
        row({
          type: "group",
          id: "7",
          group_id: 7,
          last_message: "旧内容",
          last_message_time: "2026-08-08T10:00:00Z",
          last_message_id: 41,
          last_message_sender_id: "peter",
          subtitle: "Peter",
        }),
      ],
    );

    expect(reconciled[0]?.subtitle).toBeUndefined();
    expect(reconciled[0]?.last_message_sender_id).toBeUndefined();
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
    expect(shouldApplyRealtimeConversationPreview(current, "2026-08-08T10:00:01Z", 9, true)).toBe(
      false,
    );
    expect(shouldApplyRealtimeConversationPreview(current, "2026-08-08T10:00:01Z", 10, true)).toBe(
      true,
    );
    expect(shouldApplyRealtimeConversationPreview(current, "2026-08-08T09:59:59Z", 11, false)).toBe(
      true,
    );
  });

  it("uses message sequence and version before timestamps for canonical previews", () => {
    const current = row({
      last_message_id: 40,
      last_message_sequence: 100,
      last_message_version: 3,
      last_message_time: "2026-08-08T10:00:00Z",
    });
    expect(
      shouldApplyRealtimeConversationPreview(current, "2026-08-08T11:00:00Z", 40, true, 2, 100),
    ).toBe(false);
    expect(
      shouldApplyRealtimeConversationPreview(current, "2026-08-08T09:00:00Z", 40, true, 4, 100),
    ).toBe(true);
    expect(
      shouldApplyRealtimeConversationPreview(current, "2026-08-08T12:00:00Z", 99, false, 1, 99),
    ).toBe(false);
  });

  it("does not let a late snapshot roll back sequence, version or named revisions", () => {
    const [result] = reconcileLatestConversationPreviews(
      [
        row({
          id: "friend",
          last_message: "stale",
          last_message_id: 9,
          last_message_sequence: 109,
          last_message_version: 1,
          conversation_revision: 7,
          unread_revision: 12,
        }),
      ],
      [
        row({
          id: "friend",
          last_message: "canonical",
          last_message_id: 10,
          last_message_sequence: 110,
          last_message_version: 2,
          conversation_revision: 9,
          unread_revision: 14,
        }),
      ],
    );
    expect(result).toMatchObject({
      last_message: "canonical",
      last_message_id: 10,
      last_message_sequence: 110,
      last_message_version: 2,
      conversation_revision: 9,
      unread_revision: 14,
    });
  });

  it("uses the same monotonic gate for repository-backed detail preview publications", () => {
    const current = row({
      id: "friend",
      last_message: "version 3",
      last_message_id: 40,
      last_message_sequence: 100,
      last_message_version: 3,
      last_message_time: "2026-08-08T10:00:00Z",
    });
    expect(
      applyDirectConversationPreviewUpdate([current], {
        owner_id: "owner",
        contact_id: "friend",
        last_message: "late version 2",
        last_message_id: 40,
        last_message_sequence: 100,
        last_message_version: 2,
        last_message_time: "2026-08-08T11:00:00Z",
      }),
    ).toEqual([current]);
  });

  it("compares V2 snapshot revisions only within the same revision domain", () => {
    const cached: ConversationSyncSnapshot = {
      conversations: [row({ id: "friend" })],
      revision: 9_999,
      conversation_revision: 10,
      event_sequence: 100,
    };
    expect(
      shouldAcceptConversationSnapshot(
        {
          conversations: [row({ id: "friend" })],
          revision: 1,
          conversation_revision: 11,
          event_sequence: 101,
        },
        cached,
      ),
    ).toBe(true);
    expect(
      shouldAcceptConversationSnapshot(
        {
          conversations: [row({ id: "friend" })],
          revision: 99_999,
          conversation_revision: 9,
          event_sequence: 99,
        },
        cached,
      ),
    ).toBe(false);
    expect(
      shouldAcceptConversationSnapshot(
        { conversations: [row({ id: "friend" })], revision: 99_999 },
        cached,
      ),
    ).toBe(false);
  });

  it("applies named unread revisions without comparing them to conversation or legacy revisions", () => {
    const snapshot: ConversationSyncSnapshot = {
      conversations: [
        row({
          id: "friend",
          unread_count: 3,
          unread_revision: 9,
          conversation_revision: 800,
          revision: 8_000,
        }),
      ],
      unread_revision: 9,
      conversation_revision: 800,
      revision: 8_000,
      total_unread_count: 3,
    };
    const updated = applyConversationReadReceiptToSnapshot(snapshot, {
      conversation_type: "dm",
      conversation_id: "friend",
      read_through_message_id: 40,
      unread_count: 0,
      total_unread_count: 0,
      unread_revision: 10,
      revision: 10,
    });
    expect(updated).toMatchObject({
      unread_revision: 10,
      conversation_revision: 800,
      total_unread_count: 0,
      conversations: [
        expect.objectContaining({
          unread_count: 0,
          unread_revision: 10,
          conversation_revision: 800,
        }),
      ],
    });
    const legacyReceiptAgainstV2 = applyConversationReadReceiptToSnapshot(snapshot, {
      conversation_type: "dm",
      conversation_id: "friend",
      read_through_message_id: 40,
      unread_count: 0,
      revision: 10,
    });
    expect(legacyReceiptAgainstV2.revision).toBe(8_000);
    expect(legacyReceiptAgainstV2.conversations[0]?.read_through_message_id).toBe(40);
  });

  it("projects agent realtime previews and increments unread only for a new inactive message", () => {
    const current = row({
      type: "agent",
      id: "thread-1",
      conversation_kind: "agent_conversation",
      agent_conversation_id: "thread-1",
      last_message: "旧回复",
      last_message_time: "2026-08-08T10:00:00Z",
      last_message_id: 10,
      unread_count: 2,
    });
    const incoming = agentMessage({
      id: "message-11",
      sequence_no: 11,
      updated_at: "2026-08-08T10:00:01Z",
      parts: [{ id: "part-1", ordinal: 0, type: "text", text: "新回复", metadata: {} }],
    });
    expect(applyAgentRealtimeMessage(current, incoming, true, (key) => key)).toMatchObject({
      last_message: "新回复",
      last_message_id: 11,
      unread_count: 3,
    });
    expect(applyAgentRealtimeMessage(current, incoming, false, (key) => key)).toMatchObject({
      last_message: "新回复",
      last_message_id: 11,
      unread_count: 2,
    });

    const updatedSameSequence = agentMessage({
      id: "message-10",
      sequence_no: 10,
      updated_at: "2026-08-08T10:00:02Z",
      parts: [{ id: "part-2", ordinal: 0, type: "text", text: "生成完成", metadata: {} }],
    });
    expect(
      applyAgentRealtimeMessage(current, updatedSameSequence, false, (key) => key, true),
    ).toMatchObject({ last_message: "生成完成", last_message_id: 10, unread_count: 2 });
    expect(
      applyAgentRealtimeMessage(
        current,
        agentMessage({
          id: "message-9",
          sequence_no: 9,
          updated_at: "2026-08-08T10:00:03Z",
          parts: [{ id: "part-3", ordinal: 0, type: "text", text: "旧消息更新", metadata: {} }],
        }),
        false,
        (key) => key,
        true,
      ),
    ).toBe(current);
    const afterCreate = applyAgentRealtimeMessage(current, incoming, true, (key) => key);
    expect(
      applyAgentRealtimeMessage(
        afterCreate,
        { ...incoming, updated_at: "2026-08-08T10:00:02Z" },
        false,
        (key) => key,
        true,
      ),
    ).toMatchObject({ last_message_id: 11, unread_count: 3 });
    expect(
      applyAgentRealtimeMessage(
        row({ type: "agent", id: "other", conversation_kind: "agent_conversation" }),
        incoming,
        false,
        (key) => key,
      ),
    ).toMatchObject({ id: "other", unread_count: 0 });
  });

  it("counts distinct out-of-order messages once without regressing the newest preview", () => {
    let current = row({
      id: "friend",
      last_message: "99",
      last_message_time: "2026-08-08T09:59:59Z",
      last_message_id: 99,
      unread_count: 0,
    });
    const count = (messageId: number) =>
      consumeConversationRealtimeUnreadEvent({
        ownerId: "owner-a",
        conversation: current,
        messageId,
        incoming: true,
        isActive: false,
        isUpdate: false,
        alreadyProjected: messageId === current.last_message_id,
      });
    expect(count(101)).toBe(true);
    current = {
      ...current,
      last_message: "101",
      last_message_time: "2026-08-08T10:00:01Z",
      last_message_id: 101,
      unread_count: 1,
    };
    expect(count(100)).toBe(true);
    current = { ...current, unread_count: 2 };
    expect(count(100)).toBe(false);
    expect(current).toMatchObject({ last_message: "101", last_message_id: 101, unread_count: 2 });
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

  it("projects server-owned agent unread and read-through state", () => {
    const merged = mergeAgentConversationRows(
      [],
      [],
      [
        {
          ...agentConversation("thread-1", "agent-1"),
          unread_count: 4,
          read_through_sequence: 8,
          revision: 11,
          latest_message: {
            id: "message-9",
            conversation_id: "thread-1",
            sequence_no: 9,
            sender: { type: "agent", id: "agent-1" },
            source: "agent",
            status: "completed",
            created_at: "2026-08-08T00:00:00Z",
            updated_at: "2026-08-08T00:00:01Z",
            parts: [{ id: "part-1", ordinal: 0, type: "text", text: "新消息", metadata: {} }],
          },
        },
      ],
      [],
      (key) => key,
    );
    expect(merged[0]).toMatchObject({
      unread_count: 4,
      last_message_id: 9,
      read_through_message_id: 8,
      revision: 11,
    });
  });

  it("does not let a stale agent catalog snapshot resurrect unread state", () => {
    const current = row({
      type: "agent",
      id: "thread-1",
      conversation_kind: "agent_conversation",
      agent_conversation_id: "thread-1",
      last_message: "最新回复",
      last_message_time: "2026-08-08T00:00:20Z",
      last_message_id: 20,
      unread_count: 0,
      read_through_message_id: 20,
      revision: 12,
    });
    const stale = {
      ...agentConversation("thread-1", "agent-1"),
      unread_count: 4,
      read_through_sequence: 10,
      revision: 11,
      latest_message: agentMessage({
        id: "message-10",
        conversation_id: "thread-1",
        sequence_no: 10,
        updated_at: "2026-08-08T00:00:30Z",
      }),
      updated_at: "2026-08-08T00:00:30Z",
    };
    expect(mergeAgentConversationRows([], [current], [stale], [], (key) => key)[0]).toMatchObject({
      last_message: "最新回复",
      last_message_id: 20,
      unread_count: 0,
      read_through_message_id: 20,
      revision: 12,
    });
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

  it("never labels the current user's group message as another sender", () => {
    expect(conversationEventSender("text", "还是没有", "owner-a", "Peter", "owner-a")).toBe(
      undefined,
    );
    expect(conversationEventSender("text", "普通消息", "peter", "Peter", "owner-a")).toBe("Peter");
    expect(
      conversationSenderPrefix(
        row({
          type: "group",
          group_id: 7,
          subtitle: "Peter",
          last_message: "还是没有",
          last_message_sender_id: "owner-a",
        }),
        undefined,
        "owner-a",
      ),
    ).toBeUndefined();
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

  it("adds a followed user as an empty dm without disturbing the pinned section", () => {
    const conversations = applyDirectConversationCandidate(
      [row({ id: "pinned", last_message_time: "2020-01-01T00:00:00Z" })],
      {
        owner_id: "owner-a",
        contact_id: "followed",
        name: "Followed User",
        avatar_url: "/followed.png",
      },
    );
    expect(
      sortConversationRows(conversations, new Set(["dm:pinned"]), "owner-a").map(
        conversationListIdentity,
      ),
    ).toEqual(["dm:pinned", "dm:followed"]);
    expect(conversations[1]).toEqual({
      type: "dm",
      id: "followed",
      name: "Followed User",
      avatar_url: "/followed.png",
      unread_count: 0,
      is_muted: false,
    });
  });

  it("restores a followed dm immediately, persists it, and retains an existing pin", async () => {
    const candidate = {
      owner_id: "owner-a",
      contact_id: "followed",
      name: " Followed User ",
      avatar_url: " /followed.png ",
    };
    await saveConversationPinnedKeys("owner-a", new Set(["dm:followed"]));
    await saveConversationHiddenSnapshots("owner-a", { "dm:followed": "\u001f" });
    const listener = jest.fn();
    const unsubscribe = subscribeDirectConversationCandidates("owner-a", listener);

    await publishDirectConversationCandidate(candidate);

    expect(listener).toHaveBeenCalledWith({
      owner_id: "owner-a",
      contact_id: "followed",
      name: "Followed User",
      avatar_url: "/followed.png",
    });
    expect((await loadCachedConversationSnapshot("owner-a"))?.conversations).toEqual([
      expect.objectContaining({ id: "followed", name: "Followed User" }),
    ]);
    expect(await loadConversationInitiatedDmIds("owner-a")).toEqual(new Set(["followed"]));
    const state = await loadConversationListLocalState("owner-a");
    expect(state.hiddenSnapshots).toEqual({});
    expect(state.pinnedKeys).toEqual(new Set(["dm:followed"]));
    unsubscribe();
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

  it("does not let a stale UI projection overwrite a newer cached read receipt", async () => {
    const unread = row({
      id: "friend",
      unread_count: 3,
      last_message_id: 42,
      read_through_message_id: 30,
      revision: 11,
    });
    await reconcileConversationSnapshot(
      "owner-a",
      { conversations: [unread], revision: 11, snapshot_complete: true },
      100,
    );
    await applyConversationReadReceipt("owner-a", {
      conversation_type: "dm",
      conversation_id: "friend",
      read_through_message_id: 42,
      unread_count: 0,
      total_unread_count: 0,
      revision: 12,
    });

    await saveCachedConversationItemsProjection("owner-a", [unread]);

    expect(await loadCachedConversationSnapshot("owner-a")).toMatchObject({
      revision: 12,
      total_unread_count: 0,
      conversations: [
        {
          id: "friend",
          unread_count: 0,
          read_through_message_id: 42,
          revision: 12,
        },
      ],
    });
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
    await expect(
      loadConversationSnapshotWithNativeCache("owner-a", offline, {
        forceRefresh: true,
        allowStaleOnError: false,
        now: 100 + 123_000,
      }),
    ).rejects.toThrow("offline");
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

function agentMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: "message-1",
    conversation_id: "thread-1",
    sequence_no: 1,
    sender: { type: "agent", id: "agent-1" },
    source: "agent",
    status: "completed",
    created_at: "2026-08-08T10:00:00Z",
    updated_at: "2026-08-08T10:00:00Z",
    parts: [],
    ...overrides,
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
