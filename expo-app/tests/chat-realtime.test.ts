import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  chatRealtimeService,
  chatRealtimeReconnectDelay,
  directMessageContactId,
  makeChatWebSocketURL,
  parseChatRealtimeEnvelope,
  persistChatRealtimeMessage,
} from "@/services/realtime/ChatRealtimeService";
import { readDirectChatCachedMessages } from "@/services/messages/DirectChatHistoryRepository";
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
    releaseGroup();
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
    ).toMatchObject([{ type: "direct_message", message: { id: 61 } }]);
    expect(
      parseChatRealtimeEnvelope({
        type: "group_message_updated",
        data: { message: groupMessage(62) },
      }),
    ).toMatchObject([{ type: "group_message", message: { id: 62, group_id: 7 } }]);
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
        data: { groupId: 7, lastMessageId: 52 },
      }),
    ).toEqual([
      { type: "refresh_conversations", reason: "group_contact_update" },
      { type: "group_message_hint", group_id: 7, message_id: 52 },
    ]);
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
          last_message: "[图片]",
        },
      }),
    ).toEqual([
      { type: "refresh_conversations", reason: "contact_update" },
      {
        type: "direct_message_hint",
        sender_id: "u1",
        receiver_id: "me",
        message_id: 53,
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
