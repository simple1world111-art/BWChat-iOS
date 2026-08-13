import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  chatRealtimeService,
  chatRealtimeReconnectDelay,
  jitteredChatRealtimeReconnectDelay,
  nextPersistedRealtimeEventSequence,
  directMessageContactId,
  makeChatWebSocketURL,
  parseChatRealtimeEnvelope,
  parseChatRealtimeEnvelopeMetadata,
  persistChatRealtimeMessage,
} from "@/services/realtime/ChatRealtimeService";
import {
  directChatHistoryKey,
  readDirectChatCachedMessages,
} from "@/services/messages/DirectChatHistoryRepository";
import { readGroupChatCachedMessages } from "@/services/messages/GroupChatHistoryRepository";

describe("native WebSocket event contracts", () => {
  it("builds the exact token query without retaining a stale token", () => {
    expect(makeChatWebSocketURL("ws://52.193.78.191/ws?token=old&client=ios", "a/b +c")).toBe(
      "ws://52.193.78.191/ws?client=ios&token=a%2Fb+%2Bc",
    );
  });

  it("uses native 1, 2, 4...30 second bounded reconnect backoff", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(chatRealtimeReconnectDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });

  it("adds a resume cursor and uses bounded full-jitter without changing legacy backoff", () => {
    expect(makeChatWebSocketURL("wss://example.test/ws?after_event_seq=1", "token", 42)).toBe(
      "wss://example.test/ws?token=token&after_event_seq=42",
    );
    expect(jitteredChatRealtimeReconnectDelay(3, () => 0)).toBe(0);
    expect(jitteredChatRealtimeReconnectDelay(3, () => 0.5)).toBe(4_000);
    expect(jitteredChatRealtimeReconnectDelay(9, () => 1)).toBe(30_000);
  });

  it("reads replay metadata independently from message payload normalization", () => {
    expect(
      parseChatRealtimeEnvelopeMetadata({
        type: "new_message",
        event_id: "event-77",
        event_sequence: "77",
        server_time: "2026-08-13T10:00:00Z",
        data: { id: 8 },
      }),
    ).toEqual({
      event_id: "event-77",
      event_sequence: 77,
      server_time: "2026-08-13T10:00:00Z",
    });
  });

  it("never advances a durable cursor across a gap or failed side-effect persistence", () => {
    expect(
      nextPersistedRealtimeEventSequence(40, 42, {
        hasGap: true,
        persistenceSucceeded: true,
      }),
    ).toBe(40);
    expect(
      nextPersistedRealtimeEventSequence(40, 41, {
        hasGap: false,
        persistenceSucceeded: false,
      }),
    ).toBe(40);
    expect(
      nextPersistedRealtimeEventSequence(40, 41, {
        hasGap: false,
        persistenceSucceeded: true,
      }),
    ).toBe(41);
  });

  it("does not let a stale screen cleanup clear the newer active conversation lease", () => {
    chatRealtimeService.stop();
    const releaseFirst = chatRealtimeService.activateConversation("dm", "friend-a");
    const releaseSecond = chatRealtimeService.activateConversation("dm", "friend-b");

    releaseFirst();
    expect(chatRealtimeService.isConversationActive("dm", "friend-b")).toBe(true);
    releaseSecond();
    expect(chatRealtimeService.hasActiveConversation()).toBe(false);

    const releaseDirect = chatRealtimeService.activateConversation("dm", "friend-a");
    const releaseGroup = chatRealtimeService.activateConversation("group", "7");
    expect(chatRealtimeService.isConversationActive("dm", "friend-a")).toBe(false);
    expect(chatRealtimeService.isConversationActive("group", "7")).toBe(true);
    releaseDirect();
    expect(chatRealtimeService.isConversationActive("group", "7")).toBe(true);
    expect(chatRealtimeService.isConversationActive("agent", "thread-1")).toBe(false);
    releaseGroup();
  });

  it("pauses focused-conversation suppression outside the active app state", () => {
    const release = chatRealtimeService.activateConversation("dm", "friend-a");
    expect(chatRealtimeService.isConversationActive("dm", "friend-a")).toBe(true);

    chatRealtimeService.setApplicationActive(false);
    expect(chatRealtimeService.hasActiveConversation()).toBe(false);
    expect(chatRealtimeService.isConversationActive("dm", "friend-a")).toBe(false);

    chatRealtimeService.setApplicationActive(true);
    expect(chatRealtimeService.isConversationActive("dm", "friend-a")).toBe(true);
    release();
  });

  it("tracks agent/script surfaces and script aliases under one cleanup lease", () => {
    chatRealtimeService.stop();
    const releaseAgent = chatRealtimeService.activateConversation("agent", "thread-1");
    expect(chatRealtimeService.isConversationActive("agent", "thread-1")).toBe(true);

    const releaseScript = chatRealtimeService.activateConversation("script", "room-7");
    const releaseGroupAlias = chatRealtimeService.addActiveConversationAlias(
      "script",
      "room-7",
      "group",
      "7",
    );
    releaseAgent();
    expect(chatRealtimeService.isConversationActive("script", "room-7")).toBe(true);
    expect(chatRealtimeService.isConversationActive("group", "7")).toBe(true);

    releaseGroupAlias();
    expect(chatRealtimeService.isConversationActive("group", "7")).toBe(false);
    expect(chatRealtimeService.isConversationActive("script", "room-7")).toBe(true);
    releaseScript();
    expect(chatRealtimeService.hasActiveConversation()).toBe(false);
  });

  it("parses direct and group messages through canonical normalizers", () => {
    expect(
      parseChatRealtimeEnvelope(
        JSON.stringify({
          type: "new_message",
          data: {
            message_id: "41",
            from_user_id: "u1",
            receiver_id: "me",
            message_type: "text",
            content: "hi",
            created_at: "2026-08-06T10:00:00Z",
          },
        }),
      ),
    ).toMatchObject([
      {
        type: "direct_message",
        message: { id: 41, sender_id: "u1", receiver_id: "me", msg_type: "text", content: "hi" },
      },
    ]);
    expect(
      parseChatRealtimeEnvelope({
        type: "new-group-message",
        data: {
          id: 51,
          groupId: 7,
          senderId: "u2",
          type: "image",
          content: "/i.jpg",
          timestamp: "2026-08-06T10:01:00Z",
        },
      }),
    ).toMatchObject([
      {
        type: "group_message",
        message: { id: 51, group_id: 7, sender_id: "u2", msg_type: "image" },
      },
    ]);
  });

  it("accepts wrapped create/update events without dropping the canonical message", () => {
    expect(
      parseChatRealtimeEnvelope({
        type: "message_updated",
        data: { message: directMessage(61) },
      }),
    ).toMatchObject([{ type: "direct_message", message: { id: 61 }, is_update: true }]);
    expect(
      parseChatRealtimeEnvelope({
        type: "group_message_updated",
        data: { message: groupMessage(62) },
      }),
    ).toMatchObject([{ type: "group_message", message: { id: 62, group_id: 7 }, is_update: true }]);
  });

  it("parses canonical and legacy agent-message realtime aliases", () => {
    for (const type of ["agent_message", "new-agent-message", "agent_message_updated"]) {
      expect(
        parseChatRealtimeEnvelope({
          type,
          data: {
            message: {
              id: "message-1",
              conversation_id: "thread-1",
              sequence_no: 9,
              sender: { type: "agent", id: "agent-1" },
              parts: [{ id: "part-1", ordinal: 0, type: "text", text: "你好" }],
            },
          },
        }),
      ).toMatchObject([
        {
          type: "agent_message",
          message: { id: "message-1", conversation_id: "thread-1", sequence_no: 9 },
        },
      ]);
    }
    expect(
      parseChatRealtimeEnvelope({
        type: "agent_message_updated",
        data: {
          message: {
            id: "message-update",
            conversation_id: "thread-1",
            sequence_no: 9,
            sender: { type: "agent", id: "agent-1" },
            parts: [],
          },
        },
      }),
    ).toMatchObject([{ type: "agent_message", is_update: true }]);
    expect(
      parseChatRealtimeEnvelope({
        type: "agent_message",
        data: {
          conversation_id: "thread-outer",
          message: {
            id: "message-outer",
            sequence_no: 10,
            sender: { type: "agent", id: "agent-1" },
            parts: [],
          },
        },
      }),
    ).toMatchObject([
      {
        type: "agent_message",
        message: { id: "message-outer", conversation_id: "thread-outer", sequence_no: 10 },
      },
    ]);
    expect(
      parseChatRealtimeEnvelope({
        type: "agent_message",
        data: {
          surface_type: "agent",
          surface_id: "thread-v2",
          message: {
            message_id: "message-v2",
            message_sequence: "11",
            sender: { type: "agent", id: "agent-1" },
            parts: [],
          },
        },
      }),
    ).toMatchObject([
      {
        type: "agent_message",
        message: { id: "message-v2", conversation_id: "thread-v2", sequence_no: 11 },
      },
    ]);
  });

  it("resolves only account-scoped direct-message cache identities", () => {
    expect(directMessageContactId("me", directMessage(1))).toBe("u1");
    expect(
      directMessageContactId("me", {
        ...directMessage(2),
        sender_id: "u1",
        receiver_id: "me",
      }),
    ).toBe("u1");
    expect(
      directMessageContactId("me", {
        ...directMessage(3),
        sender_id: "u1",
        receiver_id: "u2",
      }),
    ).toBeNull();
  });

  it("persists direct and group events before pages consume their broadcasts", async () => {
    await AsyncStorage.clear();
    await persistChatRealtimeMessage("me", {
      type: "direct_message",
      message: {
        ...directMessage(10),
        sender_id: "u1",
        receiver_id: "me",
      },
    });
    await persistChatRealtimeMessage("me", {
      type: "group_message",
      message: groupMessage(11),
    });

    await expect(readDirectChatCachedMessages("me", "u1")).resolves.toEqual([
      expect.objectContaining({ id: 10, content: "{}" }),
    ]);
    await expect(readGroupChatCachedMessages("me", 7)).resolves.toEqual([
      expect.objectContaining({ id: 11, content: "{}" }),
    ]);
  });

  it("atomically ingests a 100-event delta page through the canonical realtime lane", async () => {
    await AsyncStorage.clear();
    chatRealtimeService.stop();
    chatRealtimeService.start("sync-owner-100");
    const received: number[] = [];
    const unsubscribe = chatRealtimeService.subscribe((event) => {
      if (event.type === "direct_message_hint") received.push(event.message_id);
    });
    const events = Array.from({ length: 100 }, (_, index) => ({
      event_id: `event-${index + 1}`,
      event_sequence: index + 1,
      type: "contact_update",
      server_time: "2026-08-13T10:00:00Z",
      data: {
        sender_id: "friend",
        receiver_id: "sync-owner-100",
        message_id: index + 1,
      },
    }));

    await expect(chatRealtimeService.ingestCatchUpPage("sync-owner-100", events)).resolves.toBe(
      100,
    );
    await expect(chatRealtimeService.persistedEventSequence("sync-owner-100")).resolves.toBe(100);
    expect(received).toHaveLength(100);
    unsubscribe();
    chatRealtimeService.stop();
  });

  it("does not advance a delta cursor across a gap or failed message persistence", async () => {
    await AsyncStorage.clear();
    chatRealtimeService.stop();
    chatRealtimeService.start("sync-owner-failure");
    await expect(
      chatRealtimeService.ingestCatchUpPage("sync-owner-failure", [
        {
          event_sequence: 2,
          type: "contact_update",
          data: { sender_id: "friend", receiver_id: "sync-owner-failure", message_id: 2 },
        },
      ]),
    ).rejects.toThrow("chat_sync_sequence_gap");
    await expect(chatRealtimeService.persistedEventSequence("sync-owner-failure")).resolves.toBe(0);

    const storageWrite = jest
      .spyOn(AsyncStorage, "setItem")
      .mockRejectedValueOnce(new Error("disk unavailable"));
    const event = {
      event_id: "event-1",
      event_sequence: 1,
      type: "new_message",
      data: {
        id: 1,
        sender_id: "friend",
        receiver_id: "sync-owner-failure",
        msg_type: "text",
        content: "retry me",
        timestamp: "2026-08-13T10:00:00Z",
        version: 1,
      },
    } as const;
    await expect(
      chatRealtimeService.ingestCatchUpPage("sync-owner-failure", [event]),
    ).rejects.toThrow("chat_sync_persistence_failed");
    await expect(chatRealtimeService.persistedEventSequence("sync-owner-failure")).resolves.toBe(0);
    expect(
      (chatRealtimeService as unknown as { ingestedMessageVersions: Map<string, number> })
        .ingestedMessageVersions.size,
    ).toBe(0);

    await expect(
      chatRealtimeService.ingestCatchUpPage("sync-owner-failure", [event]),
    ).resolves.toBe(1);
    await expect(chatRealtimeService.persistedEventSequence("sync-owner-failure")).resolves.toBe(1);
    await expect(
      AsyncStorage.getItem(directChatHistoryKey("sync-owner-failure", "friend")!),
    ).resolves.toContain("retry me");
    await expect(readDirectChatCachedMessages("sync-owner-failure", "friend")).resolves.toEqual([
      expect.objectContaining({ id: 1, content: "retry me" }),
    ]);
    storageWrite.mockRestore();
    chatRealtimeService.stop();
  });

  it("parses meaningful read, history, preference, rename and removal events", () => {
    expect(
      parseChatRealtimeEnvelope({
        type: "conversation_read_state",
        data: {
          conversation_type: "dm",
          conversation_id: "u1",
          read_through_message_id: 41,
          unread_count: 0,
        },
      }),
    ).toMatchObject([
      {
        type: "conversation_read",
        receipt: { conversation_id: "u1", read_through_message_id: 41 },
      },
    ]);
    expect(
      parseChatRealtimeEnvelope({
        type: "group_history_cleared",
        data: { group_id: 7, cleared_before_sequence: 80, revision: 3 },
      }),
    ).toMatchObject([
      { type: "group_history_cleared", receipt: { group_id: 7, cleared_before_sequence: 80 } },
    ]);
    expect(
      parseChatRealtimeEnvelope({
        type: "conversation_preferences_updated",
        data: { conversation_type: "group", target_id: 7, is_pinned: true },
      }),
    ).toMatchObject([
      { type: "conversation_preference", preference: { target_id: "7", is_pinned: true } },
    ]);
    expect(
      parseChatRealtimeEnvelope({ type: "group_renamed", data: { groupID: "7", name: "New" } }),
    ).toEqual([{ type: "group_renamed", group_id: 7, name: "New" }]);
    expect(parseChatRealtimeEnvelope({ type: "group_removed", data: { group_id: 7 } })).toEqual([
      { type: "group_removed", group_id: 7 },
    ]);
  });

  it("parses every native GroupInfo v2 realtime event and member alias", () => {
    expect(
      parseChatRealtimeEnvelope({
        type: "group_notification_settings_updated",
        data: { group_id: 7, muted: true, revision: 4 },
      }),
    ).toMatchObject([
      {
        type: "group_notification_settings_updated",
        settings: { group_id: 7, muted: true, revision: 4 },
      },
    ]);
    expect(
      parseChatRealtimeEnvelope({
        type: "group_viewer_settings_updated",
        data: { group_id: 7, remark: "周末", show_member_nicknames: false, revision: 5 },
      }),
    ).toMatchObject([
      {
        type: "group_viewer_settings_updated",
        settings: { group_id: 7, remark: "周末", show_member_nicknames: false, revision: 5 },
      },
    ]);
    expect(
      parseChatRealtimeEnvelope({
        type: "group_announcement_updated",
        data: { group_id: 7, announcement_id: "a1", title: "规则", content: "友好", revision: 6 },
      }),
    ).toMatchObject([
      {
        type: "group_announcement_updated",
        announcement: { group_id: 7, announcement_id: "a1", revision: 6 },
      },
    ]);
    for (const type of ["group_member_updated", "group_member_profile_updated"]) {
      expect(
        parseChatRealtimeEnvelope({
          type,
          data: { group_id: 7, member: { user_id: "u1", nickname: "小七" }, revision: 8 },
        }),
      ).toMatchObject([
        {
          type: "group_member_updated",
          update: { group_id: 7, member: { user_id: "u1", nickname: "小七" }, revision: 8 },
        },
      ]);
    }
  });

  it("projects all chat-money replacement and receipt messages onto normal timelines", () => {
    const events = parseChatRealtimeEnvelope({
      type: "chat_money_updated",
      data: {
        message: directMessage(1),
        receipt_message: directMessage(2),
        group_message: groupMessage(3),
        receipt_group_message: groupMessage(4),
      },
    });
    expect(events.map((event) => event.type)).toEqual([
      "direct_message",
      "direct_message",
      "group_message",
      "group_message",
    ]);
  });

  it("routes call signaling and conversation refresh events without treating ping/pong as data", () => {
    expect(parseChatRealtimeEnvelope({ type: "call_offer", data: { call_id: "c1" } })).toEqual([
      { type: "call_signal", signal_type: "call_offer", data: { call_id: "c1" } },
    ]);
    expect(parseChatRealtimeEnvelope({ type: "friend_request", data: {} })).toEqual([
      { type: "refresh_conversations", reason: "friend_request" },
    ]);
    expect(
      parseChatRealtimeEnvelope({
        type: "group_contact_update",
        data: { groupId: 7, lastMessageId: 52, messageVersion: 4 },
      }),
    ).toEqual([{ type: "group_message_hint", group_id: 7, message_id: 52, message_version: 4 }]);
    expect(
      parseChatRealtimeEnvelope({ type: "group_contact_update", data: { groupId: 7 } }),
    ).toEqual([{ type: "refresh_conversations", reason: "group_contact_update" }]);
    expect(parseChatRealtimeEnvelope({ type: "pong" })).toEqual([]);
  });

  it("retains the canonical direct message ID from contact previews for timeline reconciliation", () => {
    expect(
      parseChatRealtimeEnvelope({
        type: "contact_update",
        data: {
          senderId: "u1",
          receiver_id: "me",
          lastMessageID: "53",
          message_version: "5",
          last_message: "[图片]",
        },
      }),
    ).toEqual([
      {
        type: "direct_message_hint",
        sender_id: "u1",
        receiver_id: "me",
        message_id: 53,
        message_version: 5,
      },
    ]);
    expect(parseChatRealtimeEnvelope({ type: "contact_update", data: {} })).toEqual([
      { type: "refresh_conversations", reason: "contact_update" },
    ]);
  });

  it("separates canonical and legacy live events from ordinary friend calls", () => {
    expect(
      parseChatRealtimeEnvelope({
        type: "one_to_one_live.slot.created",
        data: { slot: { id: "s1" } },
      }),
    ).toEqual([
      {
        type: "live_signal",
        signal_type: "one_to_one_live.slot.created",
        data: { slot: { id: "s1" } },
      },
    ]);
    expect(
      parseChatRealtimeEnvelope({
        type: "one_to_one_live.call_invite",
        data: { call_id: "c1", caller_id: "u1" },
      }),
    ).toEqual([
      {
        type: "live_signal",
        signal_type: "one_to_one_live.call_invite",
        data: { call_id: "c1", caller_id: "u1" },
      },
    ]);
    expect(
      parseChatRealtimeEnvelope({
        type: "call_invite",
        data: { call_id: "c1", slot_id: "s1", caller_id: "u1" },
      })[0]?.type,
    ).toBe("live_signal");
    expect(
      parseChatRealtimeEnvelope({
        type: "call_invite",
        data: { call_id: "c1", room_name: "r1", caller_id: "u1" },
      })[0]?.type,
    ).toBe("call_signal");
  });

  it("drops malformed, unknown and meaningless receipts safely", () => {
    expect(parseChatRealtimeEnvelope("not-json")).toEqual([]);
    expect(parseChatRealtimeEnvelope({ type: "unknown", data: {} })).toEqual([]);
    expect(parseChatRealtimeEnvelope({ type: "conversation_read_state", data: {} })).toEqual([]);
  });

  it("publishes a local group preview only for the active account and valid group messages", () => {
    chatRealtimeService.stop();
    const received: unknown[] = [];
    const unsubscribe = chatRealtimeService.subscribe((event) => received.push(event));
    expect(chatRealtimeService.publishLocalGroupMessage("owner-a", groupMessage(10))).toBe(false);
    chatRealtimeService.start("owner-a");
    expect(chatRealtimeService.publishLocalGroupMessage("owner-b", groupMessage(11))).toBe(false);
    expect(
      chatRealtimeService.publishLocalGroupMessage("owner-a", {
        ...groupMessage(12),
        group_id: 0,
      }),
    ).toBe(false);
    expect(chatRealtimeService.publishLocalGroupMessage("owner-a", groupMessage(13))).toBe(true);
    expect(received).toEqual([{ type: "group_message", message: groupMessage(13) }]);
    unsubscribe();
    chatRealtimeService.stop();
  });
});

function directMessage(id: number) {
  return {
    id,
    sender_id: "me",
    receiver_id: "u1",
    msg_type: "chat_money",
    content: "{}",
    timestamp: "2026-08-06T10:00:00Z",
    version: 1,
  };
}

function groupMessage(id: number) {
  return {
    id,
    group_id: 7,
    sender_id: "me",
    msg_type: "chat_money",
    content: "{}",
    timestamp: "2026-08-06T10:00:00Z",
    sender_nickname: "我",
    sender_avatar: "",
    mention_all: false,
    version: 1,
  };
}
