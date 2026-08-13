import {
  normalizeAgentConversation,
  normalizeAgentConversationReadReceipt,
  normalizeAgentMessage,
  normalizeAuthSession,
  normalizeChatSyncEvent,
  normalizeChatSyncPage,
  normalizeConversation,
  normalizeConversationSnapshot,
  normalizeGroupMessage,
  normalizeMessage,
  normalizeMessagesPage,
  normalizeToken,
} from "@/api/normalizers";
import { shouldAcceptConversationSnapshot } from "@/services/conversations/ConversationRepository";

describe("native-compatible API normalizers", () => {
  it("strictly normalizes ordered messaging sync-v2 pages while retaining opaque event data", () => {
    const opaqueData = {
      message: { id: 91, content: "hello" },
      extension: ["kept", { future: true }],
    };
    expect(
      normalizeChatSyncPage({
        events: [
          {
            event_id: "event-90",
            event_sequence: "90",
            type: "new_message",
            server_time: "2026-08-13T01:00:00Z",
            data: opaqueData,
          },
          {
            event_id: "event-91",
            event_sequence: 91,
            type: "conversation_read_state",
            data: {},
          },
        ],
        next_event_seq: "91",
        has_more: "false",
        snapshot_revision: "12",
        server_time: "2026-08-13T01:00:01Z",
        full_sync_required: 0,
      }),
    ).toEqual({
      events: [
        {
          event_id: "event-90",
          event_sequence: 90,
          type: "new_message",
          server_time: "2026-08-13T01:00:00Z",
          data: opaqueData,
        },
        {
          event_id: "event-91",
          event_sequence: 91,
          type: "conversation_read_state",
          data: {},
        },
      ],
      next_event_seq: 91,
      has_more: false,
      snapshot_revision: 12,
      server_time: "2026-08-13T01:00:01Z",
      full_sync_required: false,
    });
  });

  it("rejects incomplete, unordered or impossible messaging sync-v2 events", () => {
    expect(() => normalizeChatSyncEvent({ type: "new_message", data: {} })).toThrow(
      "event_sequence",
    );
    expect(() => normalizeChatSyncEvent({ event_sequence: 1, data: {} })).toThrow("type");
    expect(() => normalizeChatSyncEvent({ type: "new_message", event_sequence: 1 })).toThrow(
      "data",
    );
    expect(() =>
      normalizeChatSyncEvent({ type: "new_message", event_sequence: 1, data: null }),
    ).toThrow("data");
    expect(() =>
      normalizeChatSyncPage({
        events: [
          { type: "new_message", event_sequence: 2, data: {} },
          { type: "new_message", event_sequence: 1, data: {} },
        ],
        next_event_seq: 2,
        has_more: false,
        snapshot_revision: 1,
        server_time: "2026-08-13T01:00:00Z",
        full_sync_required: false,
      }),
    ).toThrow("严格递增");
    expect(() =>
      normalizeChatSyncPage({
        events: [{ type: "new_message", event_sequence: 3, data: {} }],
        next_event_seq: 2,
        has_more: false,
        snapshot_revision: 1,
        server_time: "2026-08-13T01:00:00Z",
        full_sync_required: false,
      }),
    ).toThrow("水位");
  });

  it("decodes notification-v2 agent message identity aliases", () => {
    expect(
      normalizeAgentMessage({
        message_id: "message-9",
        agent_conversation_id: "thread-agent",
        message_sequence: "9",
        sender: { type: "agent", id: "agent-1" },
        parts: [],
      }),
    ).toMatchObject({
      id: "message-9",
      conversation_id: "thread-agent",
      sequence_no: 9,
    });
    expect(
      normalizeAgentMessage({
        message_id: "message-10",
        surface_id: "thread-surface",
        messageSequence: 10,
        sender: { type: "agent", id: "agent-1" },
        parts: [],
      }),
    ).toMatchObject({
      id: "message-10",
      conversation_id: "thread-surface",
      sequence_no: 10,
    });
  });

  it("decodes notification-v2 unread aliases for agent conversations and receipts", () => {
    expect(
      normalizeAgentConversation({
        id: "thread-1",
        title: "Agent",
        conversation_unread: "3",
        total_unread: "7",
        read_through_sequence: "8",
        unread_revision: "11",
      }),
    ).toMatchObject({
      id: "thread-1",
      unread_count: 3,
      total_unread_count: 7,
      read_through_sequence: 8,
      revision: 11,
    });
    expect(
      normalizeAgentConversationReadReceipt({
        conversation_id: "thread-1",
        through_sequence: "9",
        through_message_id: "message-9",
        conversation_unread: "2",
        total_unread: "6",
        unread_revision: "12",
      }),
    ).toEqual({
      conversation_id: "thread-1",
      read_through_sequence: 9,
      read_through_message_id: "message-9",
      unread_count: 2,
      total_unread_count: 6,
      revision: 12,
    });
  });

  it("requires the native token fields and removes a stale Bearer prefix", () => {
    const session = normalizeAuthSession({
      token: " Bearer access-token ",
      refresh_token: "refresh-token",
      user: { user_id: 42, username: "friend", nickname: "朋友" },
    });
    expect(session.token).toBe("access-token");
    expect(session.refresh_token).toBe("refresh-token");
    expect(session.user.user_id).toBe("42");
    expect(normalizeToken("   ")).toBeNull();
    expect(() =>
      normalizeAuthSession({
        access_token: "access-token",
        refreshToken: "refresh-token",
        user: { user_id: 42 },
      }),
    ).toThrow("登录响应缺少令牌");
    expect(() =>
      normalizeAuthSession({
        token: 7,
        refresh_token: "refresh-token",
        user: { user_id: 42 },
      }),
    ).toThrow("登录响应缺少令牌");
  });

  it("decodes Swift-compatible flexible conversation keys", () => {
    const conversation = normalizeConversation({
      type: "group_chat",
      conversation_id: 31,
      title: "周末群",
      avatarURL: "/avatar.png",
      lastMessage: { text: "集合" },
      lastMessageTime: "2026-08-06T10:00:00Z",
      lastMessageSenderID: "owner-a",
      unread: "8",
      groupID: "31",
      lastMessageId: "44",
      readThroughMessageId: "42",
      memberCount: "4",
      isMuted: 1,
    });
    expect(conversation).toMatchObject({
      type: "group",
      id: "31",
      name: "周末群",
      last_message: "集合",
      unread_count: 8,
      group_id: 31,
      member_count: 4,
      last_message_id: 44,
      last_message_sender_id: "owner-a",
      read_through_message_id: 42,
      is_muted: true,
    });
  });

  it("preserves a populated cache when the server returns an untrusted empty snapshot", () => {
    const cached = normalizeConversationSnapshot({
      revision: 8,
      snapshot_complete: true,
      conversations: [{ id: "friend", name: "朋友" }],
    });
    const degraded = normalizeConversationSnapshot({ revision: 9, conversations: [] });
    const authoritative = normalizeConversationSnapshot({
      revision: 9,
      snapshot_complete: true,
      conversations: [],
    });
    const stale = normalizeConversationSnapshot({
      revision: 7,
      snapshot_complete: true,
      conversations: [{ id: "old" }],
    });
    expect(shouldAcceptConversationSnapshot(degraded, cached)).toBe(false);
    expect(shouldAcceptConversationSnapshot(authoritative, cached)).toBe(true);
    expect(shouldAcceptConversationSnapshot(stale, cached)).toBe(false);
  });

  it("decodes flexible message identities, recall state and pagination", () => {
    const recalled = normalizeMessage({
      messageId: "19",
      fromUserId: 7,
      toUserId: "9",
      type: "text",
      payload: { text: "撤回内容" },
      createdAt: "2026-08-06T10:00:00Z",
      clientMessageId: "client-19",
      isRecalled: true,
      replyTo: { message_id: "2", senderId: "9", message_type: "image", content: "/a.jpg" },
    });
    expect(recalled).toMatchObject({
      id: 19,
      sender_id: "7",
      receiver_id: "9",
      msg_type: "recalled",
      content: "撤回内容",
      client_message_id: "client-19",
      reply_to: { id: 2, sender_id: "9", msg_type: "image", content: "/a.jpg" },
    });

    const page = normalizeMessagesPage({
      has_more: "true",
      messages: [
        { id: 2, sender_id: "a", content: "later", timestamp: "2026-08-06 10:01:00" },
        { id: 1, sender_id: "a", content: "first", timestamp: "2026-08-06 10:00:00" },
      ],
    });
    expect(page.hasMore).toBe(true);
    expect(page.messages.map((message) => message.id)).toEqual([1, 2]);
  });

  it("normalizes missing message clocks deterministically without inventing device time", () => {
    const directPayload = {
      id: 71,
      sender_id: "friend",
      receiver_id: "owner",
      msg_type: "text",
      content: "direct",
    };
    const groupPayload = {
      id: 72,
      group_id: 9,
      sender_id: "member",
      msg_type: "text",
      content: "group",
    };

    const direct = normalizeMessage(directPayload);
    const group = normalizeGroupMessage(groupPayload);
    expect(direct.timestamp).toBe("");
    expect(group.timestamp).toBe("");
    expect(normalizeMessage(directPayload)).toEqual(direct);
    expect(normalizeGroupMessage(groupPayload)).toEqual(group);
    expect(
      normalizeMessage({ ...directPayload, server_time: "2026-08-13T01:02:03Z" }).timestamp,
    ).toBe("2026-08-13T01:02:03Z");
    expect(
      normalizeGroupMessage({ ...groupPayload, updated_at: "2026-08-13T04:05:06Z" }).timestamp,
    ).toBe("2026-08-13T04:05:06Z");
  });
});
