import {
  normalizeAuthSession,
  normalizeConversation,
  normalizeConversationSnapshot,
  normalizeMessage,
  normalizeMessagesPage,
  normalizeToken,
} from "@/api/normalizers";
import { shouldAcceptConversationSnapshot } from "@/services/conversations/ConversationRepository";

describe("native-compatible API normalizers", () => {
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
});
