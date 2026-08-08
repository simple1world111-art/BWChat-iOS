import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeDirectHistoryClearReceipt } from "@/api/normalizers";
import type { Message } from "@/models";
import { clearDirectConversationPreview } from "@/services/conversations/ConversationRepository";
import {
  applyDirectHistoryClear,
  filterClearedDirectMessages,
  readDirectHistoryClearWatermark,
  subscribeDirectHistoryClear,
} from "@/services/messages/DirectHistoryClearRepository";

describe("native direct-history clear contract", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("decodes the original flexible receipt and restores a missing conversation ID", () => {
    expect(
      normalizeDirectHistoryClearReceipt(
        {
          contact_id: "friend-1",
          cleared_before_id: "42",
          cleared_at: "2026-08-06T10:00:00Z",
          revision: "8",
        },
        "fallback",
      ),
    ).toEqual({
      conversation_id: "friend-1",
      cleared_before_message_id: 42,
      cleared_at: "2026-08-06T10:00:00Z",
      revision: 8,
    });
    expect(
      normalizeDirectHistoryClearReceipt(
        { conversation_id: " ", cleared_before_message_id: 7 },
        "fallback",
      ).conversation_id,
    ).toBe("fallback");
  });

  it("keeps an account-scoped monotonic watermark and emits the effective receipt", async () => {
    const events: number[] = [];
    const unsubscribe = subscribeDirectHistoryClear((event) => {
      if (event.owner_id === "owner-a") events.push(event.cleared_before_message_id);
    });
    await applyDirectHistoryClear("owner-a", receipt(12));
    await applyDirectHistoryClear("owner-a", receipt(7));
    unsubscribe();

    expect(await readDirectHistoryClearWatermark("owner-a", "friend-1")).toBe(12);
    expect(await readDirectHistoryClearWatermark("owner-b", "friend-1")).toBe(-1);
    expect(events).toEqual([12, 12]);
  });

  it("filters cleared server rows without dropping the separate optimistic queue", () => {
    const messages = [message(-1), message(4), message(8), message(13)];
    expect(filterClearedDirectMessages(messages, 8).map((item) => item.id)).toEqual([-1, 13]);
    expect(filterClearedDirectMessages(messages, -1)).toEqual(messages);
  });

  it("clears the direct-list preview and unread count without changing other rows", () => {
    const conversations = [
      {
        type: "dm",
        id: "friend-1",
        name: "朋友",
        avatar_url: "",
        last_message: "旧消息",
        last_message_time: "2026-08-06T10:00:00Z",
        unread_count: 3,
        is_muted: false,
      },
      {
        type: "dm",
        id: "friend-2",
        name: "另一个朋友",
        avatar_url: "",
        last_message: "保留",
        unread_count: 1,
        is_muted: false,
      },
    ];
    const cleared = clearDirectConversationPreview(conversations, "friend-1");
    expect(cleared[0]).toEqual({
      type: "dm",
      id: "friend-1",
      name: "朋友",
      avatar_url: "",
      unread_count: 0,
      is_muted: false,
    });
    expect(cleared[1]).toEqual(conversations[1]);
  });
});

function receipt(clearedBeforeMessageId: number) {
  return {
    conversation_id: "friend-1",
    cleared_before_message_id: clearedBeforeMessageId,
    revision: 1,
  };
}

function message(id: number): Message {
  return {
    id,
    sender_id: "owner-a",
    receiver_id: "friend-1",
    msg_type: "text",
    content: String(id),
    timestamp: "2026-08-06T10:00:00Z",
    version: 1,
  };
}
