import AsyncStorage from "@react-native-async-storage/async-storage";

import { markDirectMessagesRead, markGroupMessagesRead } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { normalizeConversationReadReceipt } from "@/api/normalizers";
import type { Conversation, ConversationReadReceipt, ConversationSyncSnapshot } from "@/models";
import {
  applyConversationReadReceipt,
  applyConversationReadReceiptToSnapshot,
  clearConversationUnreadLocally,
  conversationReadIdentity,
  loadCachedConversationSnapshot,
  reconcileConversationSnapshot,
  subscribeConversationReadReceipts,
} from "@/services/conversations/ConversationRepository";
import {
  markConversationRead,
  resetConversationReadSubmissionForAccount,
  resetConversationReadSubmissionForTests,
} from "@/services/conversations/ConversationReadService";
import { dismissReadConversationNotifications } from "@/services/push/PushService";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
jest.mock("@/services/push/PushService", () => ({
  dismissReadConversationNotifications: jest.fn(async () => 0),
}));
const request = jest.mocked(apiRequest);
const dismissReadNotifications = jest.mocked(dismissReadConversationNotifications);

describe("native conversation read-state contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    resetConversationReadSubmissionForTests();
    await AsyncStorage.clear();
  });

  it("normalizes flexible read receipts and clamps unread counts", () => {
    expect(
      normalizeConversationReadReceipt({
        conversationType: "group_chat",
        conversationID: 7,
        readThroughMessageID: "41",
        unreadCount: -2,
        totalUnreadCount: "5",
        revision: "9",
        serverTime: "2026-08-06T10:00:00Z",
      }),
    ).toEqual({
      conversation_type: "group_chat",
      conversation_id: "7",
      read_through_message_id: 41,
      unread_count: 0,
      total_unread_count: 5,
      revision: 9,
      server_time: "2026-08-06T10:00:00Z",
    });
  });

  it("sends the exact direct/group read routes and idempotency fields in the body", async () => {
    request
      .mockResolvedValueOnce(receipt({ conversation_id: "friend-1" }))
      .mockResolvedValueOnce(receipt({ conversation_type: "group", conversation_id: "7" }));
    await markDirectMessagesRead("friend-1", { throughMessageId: 41, idempotencyKey: "read-dm" });
    await markGroupMessagesRead(7, { throughMessageId: 51, idempotencyKey: "read-group" });
    expect(request).toHaveBeenNthCalledWith(1, "/chat/messages/friend-1/read", {
      method: "POST",
      requiredEnvelope: true,
      body: { idempotency_key: "read-dm", through_message_id: 41 },
    });
    expect(request).toHaveBeenNthCalledWith(2, "/groups/7/messages/read", {
      method: "POST",
      requiredEnvelope: true,
      body: { idempotency_key: "read-group", through_message_id: 51 },
    });
  });

  it("maps dm/group identities and rejects stale receipt revisions", () => {
    expect(conversationReadIdentity("direct", "u1")).toBe("dm:u1");
    expect(conversationReadIdentity("group_chat", "7")).toBe("group:7");
    const snapshot = makeSnapshot([
      conversation({ id: "u1", revision: 8, unread_count: 3 }),
      conversation({ type: "group", id: "group-7", group_id: 7, revision: 2, unread_count: 4 }),
    ]);
    const stale = applyConversationReadReceiptToSnapshot(snapshot, receipt({ revision: 7 }));
    expect(stale.conversations[0]?.unread_count).toBe(3);
    const applied = applyConversationReadReceiptToSnapshot(
      stale,
      receipt({
        conversation_type: "group_chat",
        conversation_id: "7",
        read_through_message_id: 52,
        unread_count: 1,
        total_unread_count: 6,
        revision: 3,
      }),
    );
    expect(applied.conversations[1]).toMatchObject({
      unread_count: 1,
      read_through_message_id: 52,
      revision: 3,
    });
    expect(applied.total_unread_count).toBe(6);
  });

  it("persists account-isolated receipt projection and publishes it to the visible list", async () => {
    await reconcileConversationSnapshot("owner-a", makeSnapshot([conversation()]));
    await reconcileConversationSnapshot(
      "owner-b",
      makeSnapshot([conversation({ unread_count: 9 })]),
    );
    const received: ConversationReadReceipt[] = [];
    const stop = subscribeConversationReadReceipts("owner-a", (value) => received.push(value));
    await applyConversationReadReceipt(
      "owner-a",
      receipt({ read_through_message_id: 42, unread_count: 0 }),
    );
    stop();
    expect((await loadCachedConversationSnapshot("owner-a"))?.conversations[0]).toMatchObject({
      unread_count: 0,
      read_through_message_id: 42,
    });
    expect((await loadCachedConversationSnapshot("owner-b"))?.conversations[0]?.unread_count).toBe(
      9,
    );
    expect(received).toHaveLength(1);
  });

  it("clears a visible script room locally before the best-effort server receipt", async () => {
    await reconcileConversationSnapshot("owner-a", {
      ...makeSnapshot([
        conversation({
          type: "group",
          id: "group-7",
          group_id: 7,
          unread_count: 4,
          read_through_message_id: 39,
        }),
      ]),
      total_unread_count: 9,
    });
    const received: ConversationReadReceipt[] = [];
    const stop = subscribeConversationReadReceipts("owner-a", (value) => received.push(value));
    await clearConversationUnreadLocally("owner-a", "group", "7");
    stop();

    expect(await loadCachedConversationSnapshot("owner-a")).toMatchObject({
      total_unread_count: 5,
      conversations: [{ unread_count: 0, read_through_message_id: 39 }],
    });
    expect(received).toEqual([
      expect.objectContaining({
        conversation_type: "group",
        conversation_id: "7",
        unread_count: 0,
        read_through_message_id: 39,
      }),
    ]);
  });

  it("never projects another account's late read receipt into the current list", async () => {
    const received: ConversationReadReceipt[] = [];
    const stop = subscribeConversationReadReceipts("owner-b", (value) => received.push(value));
    await applyConversationReadReceipt(
      "owner-a",
      receipt({
        conversation_id: "same-contact",
        read_through_message_id: 42,
        unread_count: 0,
      }),
    );
    expect(received).toEqual([]);
    stop();
  });

  it("submits each read-through only once, advances monotonically and retries failure", async () => {
    request
      .mockResolvedValueOnce(receipt({ read_through_message_id: 41 }))
      .mockResolvedValueOnce(receipt({ read_through_message_id: 42 }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(receipt({ conversation_id: "u2", read_through_message_id: 9 }));
    await markConversationRead("owner", "dm", "u1", 41);
    await markConversationRead("owner", "dm", "u1", 41);
    await markConversationRead("owner", "dm", "u1", 40);
    await markConversationRead("owner", "dm", "u1", 42);
    await markConversationRead("owner", "dm", "u2", 9);
    await markConversationRead("owner", "dm", "u2", 9);
    expect(request).toHaveBeenCalledTimes(4);
    expect(dismissReadNotifications).toHaveBeenCalledTimes(6);
    expect(dismissReadNotifications).toHaveBeenCalledWith("dm", "u1", 41);
    expect(dismissReadNotifications).toHaveBeenCalledWith("dm", "u1", 42);
    expect(dismissReadNotifications).toHaveBeenCalledWith("dm", "u2", 9);
  });

  it("supports the native script-room read request when no through-message id is known", async () => {
    request.mockResolvedValueOnce(receipt({ conversation_type: "group", conversation_id: "7" }));
    await markConversationRead("owner", "group", "7", undefined);
    expect(request).toHaveBeenCalledWith("/groups/7/messages/read", {
      method: "POST",
      requiredEnvelope: true,
      body: { idempotency_key: expect.any(String) },
    });
    expect(dismissReadNotifications).toHaveBeenCalledWith("group", "7", 41);
  });

  it("clears submitted read watermarks for only the selected account", async () => {
    request.mockResolvedValue(receipt());
    await markConversationRead("owner-a", "dm", "u1", 41);
    await markConversationRead("owner-b", "dm", "u1", 41);

    resetConversationReadSubmissionForAccount("owner-a");

    await markConversationRead("owner-a", "dm", "u1", 40);
    await markConversationRead("owner-b", "dm", "u1", 40);
    expect(request).toHaveBeenCalledTimes(3);
  });
});

function receipt(overrides: Partial<ConversationReadReceipt> = {}): ConversationReadReceipt {
  return {
    conversation_type: "dm",
    conversation_id: "u1",
    read_through_message_id: 41,
    unread_count: 0,
    revision: 1,
    ...overrides,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    type: "dm",
    id: "u1",
    name: "Alice",
    avatar_url: "",
    unread_count: 3,
    is_muted: false,
    ...overrides,
  };
}

function makeSnapshot(conversations: Conversation[]): ConversationSyncSnapshot {
  return { conversations, revision: 1, snapshot_complete: true };
}
