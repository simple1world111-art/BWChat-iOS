import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  getGroupMessageContext,
  getMessageContext,
  recallDirectMessage,
  recallGroupMessage,
  sendGroupStickerMessage,
  sendGroupTextMessage,
  sendDirectStickerMessage,
  sendTextMessage,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import type { GroupMessage, Message } from "@/models";
import {
  readChatDraft,
  readChatDraftSnapshot,
  saveChatDraftSnapshot,
} from "@/services/messages/ChatDraftRepository";
import {
  filterLocallyHiddenChatMessages,
  hideChatMessagesLocally,
  readHiddenChatMessageIds,
} from "@/services/messages/ChatLocalDeleteRepository";
import {
  actionsForChatMessage,
  calculateChatMessageMenuLayout,
  canRecallChatMessage,
  chatRecallNotice,
  chatReplyGeometry,
  createChatMessageMenuTarget,
  isRecalledChatMessage,
  normalizeChatMessageType,
  resolveChatMessageMenuTarget,
  resolveChatTimelineLocator,
  resolveDirectReply,
  resolveGroupReply,
} from "@/services/messages/chatReplyPolicy";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);
const t = (key: string, ...args: (string | number)[]) => `${key}:${args.join("|")}`;

describe("native reply, recall and message-menu contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("keeps every source-derived long-press, menu, quote and locator metric", () => {
    expect(chatReplyGeometry).toMatchObject({
      long_press_seconds: 0.45,
      long_press_movement: 20,
      menu_item_width: 58,
      menu_item_height: 56,
      menu_padding: 6,
      menu_columns: 4,
      menu_pointer_width: 14,
      menu_pointer_height: 7,
      composer_indicator_width: 3,
      composer_indicator_height: 36,
      composer_image_thumbnail: 44,
      bubble_image_indicator_height: 75,
      bubble_image_thumbnail: 56,
      locator_height: 36,
      highlight_seconds: 1.5,
      highlight_fade_seconds: 0.5,
    });
  });

  it("places a four-column source menu above or below and clamps its pointer", () => {
    const above = calculateChatMessageMenuLayout({ x: 300, y: 500, width: 80, height: 40 }, 6, {
      width: 390,
      height: 844,
      topInset: 47,
      bottomInset: 34,
    });
    expect(above).toMatchObject({
      column_count: 4,
      row_count: 2,
      menu_width: 244,
      menu_body_height: 124,
      total_height: 131,
      opens_above: true,
    });
    expect(above.pointer_x).toBeGreaterThanOrEqual(18);
    expect(above.pointer_x).toBeLessThanOrEqual(226);
    const below = calculateChatMessageMenuLayout({ x: 12, y: 60, width: 50, height: 30 }, 2, {
      width: 390,
      height: 844,
      topInset: 47,
      bottomInset: 34,
    });
    expect(below).toMatchObject({
      column_count: 2,
      row_count: 1,
      menu_width: 128,
      opens_above: false,
    });
  });

  it("anchors the pointer to the pressed point and resolves a fresh message snapshot", () => {
    const layout = calculateChatMessageMenuLayout(
      { x: 40, y: 400, width: 240, height: 80, press_x: 250, press_y: 430 },
      5,
      { width: 390, height: 844, itemWidth: 82, itemHeight: 68 },
    );
    expect(layout).toMatchObject({
      column_count: 4,
      row_count: 2,
      item_width: 82,
      item_height: 68,
    });
    expect(layout.pointer_x).toBeGreaterThan(layout.menu_width / 2);

    const original = direct({ id: 7, content: "old" });
    const refreshed = direct({ id: 7, content: "new" });
    const target = createChatMessageMenuTarget(
      original,
      "owner:dm:peer",
      { x: 0, y: 0, width: 10, height: 10 },
      ["copy"],
    );
    expect(resolveChatMessageMenuTarget([refreshed], target)?.content).toBe("new");
  });

  it("prioritizes mention, reply, new-message and bottom locators exactly like Swift", () => {
    expect(
      resolveChatTimelineLocator({
        mentionMessageIds: [7],
        replyMessageIds: [8],
        newMessagesBelowCount: 2,
        isNearBottom: false,
      }),
    ).toEqual({ kind: "mention" });
    expect(
      resolveChatTimelineLocator({
        mentionMessageIds: [],
        replyMessageIds: [8],
        newMessagesBelowCount: 2,
        isNearBottom: false,
      }),
    ).toEqual({ kind: "reply" });
    expect(
      resolveChatTimelineLocator({
        replyMessageIds: [],
        newMessagesBelowCount: 2,
        isNearBottom: false,
      }),
    ).toEqual({ kind: "newMessages", count: 2 });
    expect(
      resolveChatTimelineLocator({
        replyMessageIds: [],
        newMessagesBelowCount: 0,
        isNearBottom: false,
      }),
    ).toEqual({ kind: "bottom" });
    expect(
      resolveChatTimelineLocator({
        replyMessageIds: [],
        newMessagesBelowCount: 0,
        isNearBottom: true,
      }),
    ).toBeNull();
  });

  it("normalizes every recall alias and enforces owner/type/-300...120 second eligibility", () => {
    expect(normalizeChatMessageType("text", { isRecalled: true })).toBe("recalled");
    expect(normalizeChatMessageType("text", { status: "message-recalled" })).toBe("recalled");
    expect(normalizeChatMessageType("withdrawn")).toBe("recalled");
    expect(isRecalledChatMessage({ msg_type: "system", content: "" })).toBe(true);
    const now = Date.parse("2026-08-06T10:02:00Z");
    expect(canRecallChatMessage(direct({ timestamp: "2026-08-06T10:00:00Z" }), "me", now)).toBe(
      true,
    );
    expect(canRecallChatMessage(direct({ timestamp: "2026-08-06T09:59:59Z" }), "me", now)).toBe(
      false,
    );
    expect(canRecallChatMessage(direct({ msg_type: "gift" }), "me", now)).toBe(false);
    expect(canRecallChatMessage(direct({ sender_id: "other" }), "me", now)).toBe(false);
    expect(canRecallChatMessage(direct({ timestamp: "2026-08-06T10:07:00Z" }), "me", now)).toBe(
      true,
    );
    expect(canRecallChatMessage(direct({ timestamp: "2026-08-06T10:07:01Z" }), "me", now)).toBe(
      false,
    );
  });

  it("matches the native action order for text, media, voice, sticker and blocked rows", () => {
    const now = Date.parse("2026-08-06T10:01:00Z");
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      expect(
        actionsForChatMessage(direct(), {
          viewerId: "me",
          forwardingEnabled: true,
          multiselectEnabled: true,
        }),
      ).toEqual(["copy", "forward", "quote", "recall", "delete", "multiSelect"]);
      expect(
        actionsForChatMessage(direct({ msg_type: "image" }), {
          viewerId: "other",
          forwardingEnabled: true,
        }),
      ).toEqual(["forward", "save", "quote", "delete"]);
      expect(actionsForChatMessage(direct({ msg_type: "voice" }), { viewerId: "other" })).toEqual([
        "quote",
        "delete",
      ]);
      expect(
        actionsForChatMessage(direct({ msg_type: "sticker" }), { forwardingEnabled: true }),
      ).toEqual(["forward", "quote", "delete"]);
      expect(actionsForChatMessage(direct(), { isCallRecord: true })).toEqual(["delete"]);
      expect(
        actionsForChatMessage(direct(), { isCallRecord: true, localDeleteEnabled: false }),
      ).toEqual([]);
      expect(actionsForChatMessage(direct({ msg_type: "system" }))).toEqual([]);
      expect(actionsForChatMessage(direct(), { isChatMoneyReceipt: true })).toEqual([]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("prefers embedded replies and restores reply_to_id-only history from the timeline", () => {
    const source = direct({ id: 11, sender_id: "other", msg_type: "image", content: "/image.jpg" });
    const reply = direct({ id: 12, reply_to_id: 11 });
    expect(resolveDirectReply(reply, [source, reply])).toEqual({
      id: 11,
      sender_id: "other",
      msg_type: "image",
      content: "/image.jpg",
    });
    const embedded = { id: 7, sender_id: "embedded", msg_type: "voice", content: "/voice|2" };
    expect(resolveDirectReply({ ...reply, reply_to: embedded }, [source])).toBe(embedded);

    const groupSource = group({ id: 21, sender_id: "member", msg_type: "sticker", content: "{}" });
    const groupReply = group({ id: 22, reply_to_id: 21 });
    expect(resolveGroupReply(groupReply, [groupSource, groupReply])).toMatchObject({
      id: 21,
      sender_id: "member",
      msg_type: "sticker",
    });
  });

  it("persists text and quote together, reads old plain drafts, and isolates DM/group keys", async () => {
    const quote = {
      message_id: 9,
      sender_id: "friend",
      sender_name: "朋友",
      msg_type: "image",
      content: "/a.jpg",
      timestamp: "2026-08-06T10:00:00Z",
    };
    await saveChatDraftSnapshot("owner", "7", { text: "回复", quote }, "dm");
    await saveChatDraftSnapshot("owner", "7", { text: "群回复" }, "group");
    expect(await readChatDraftSnapshot("owner", "7", "dm")).toEqual({ text: "回复", quote });
    expect(await readChatDraft("owner", "7", "group")).toBe("群回复");
    await AsyncStorage.setItem("bwchat.chat-draft.v1:owner:dm:legacy", "旧草稿");
    expect(await readChatDraft("owner", "legacy", "dm")).toBe("旧草稿");
  });

  it("stores local deletion by account/scope/target and never hides optimistic rows", async () => {
    await hideChatMessagesLocally("owner-a", "dm", "7", [4, 2, 4, -1]);
    expect([...(await readHiddenChatMessageIds("owner-a", "dm", "7"))]).toEqual([2, 4]);
    expect(await readHiddenChatMessageIds("owner-b", "dm", "7")).toEqual(new Set());
    expect(await readHiddenChatMessageIds("owner-a", "group", "7")).toEqual(new Set());
    expect(
      filterLocallyHiddenChatMessages(
        [direct({ id: -1 }), direct({ id: 2 }), direct({ id: 3 })],
        new Set([2]),
      ).map((item) => item.id),
    ).toEqual([-1, 3]);
  });

  it("uses exact reply, context and recall wire contracts for direct and group chat", async () => {
    request
      .mockResolvedValueOnce(direct({ id: 31 }))
      .mockResolvedValueOnce(direct({ id: 32, msg_type: "sticker" }))
      .mockResolvedValueOnce(group({ id: 41 }))
      .mockResolvedValueOnce(group({ id: 42, msg_type: "sticker" }))
      .mockResolvedValueOnce({ messages: [direct({ id: 33 })], has_more: false })
      .mockResolvedValueOnce({ messages: [group({ id: 43 })], has_more: false })
      .mockResolvedValueOnce(direct({ id: 31, msg_type: "recalled" }))
      .mockResolvedValueOnce(group({ id: 41, msg_type: "recalled" }));

    await sendTextMessage("a/b", "reply", { replyToId: 9, clientMessageId: "dm-client" });
    await sendDirectStickerMessage("a/b", "pack", "sticker", {
      replyToId: 9,
      clientMessageId: "dm-sticker",
    });
    await sendGroupTextMessage(7, "reply", {
      replyToId: 8,
      mentions: ["u1"],
      mentionAll: true,
      clientMessageId: "group-client",
    });
    await sendGroupStickerMessage(7, "pack", "sticker", {
      replyToId: 8,
      clientMessageId: "group-sticker",
    });
    await getMessageContext("a/b", 33);
    await getGroupMessageContext(7, 43);
    await recallDirectMessage("a/b", 31);
    await recallGroupMessage(7, 41);

    expect(request.mock.calls).toEqual([
      [
        "/chat/messages/text",
        {
          method: "POST",
          headers: { "Idempotency-Key": "dm-client" },
          requiredData: true,
          requiredEnvelope: true,
          body: {
            receiver_id: "a/b",
            content: "reply",
            reply_to_id: 9,
            client_message_id: "dm-client",
          },
        },
      ],
      [
        "/chat/messages/sticker",
        {
          method: "POST",
          headers: { "Idempotency-Key": "dm-sticker" },
          requiredData: true,
          requiredEnvelope: true,
          body: {
            receiver_id: "a/b",
            pack_id: "pack",
            sticker_id: "sticker",
            reply_to_id: 9,
            client_message_id: "dm-sticker",
          },
        },
      ],
      [
        "/groups/7/messages/text",
        {
          method: "POST",
          headers: { "Idempotency-Key": "group-client" },
          requiredData: true,
          requiredEnvelope: true,
          body: {
            content: "reply",
            reply_to_id: 8,
            mentions: ["u1"],
            mention_all: true,
            client_message_id: "group-client",
          },
        },
      ],
      [
        "/groups/7/messages/sticker",
        {
          method: "POST",
          headers: { "Idempotency-Key": "group-sticker" },
          requiredData: true,
          requiredEnvelope: true,
          body: {
            pack_id: "pack",
            sticker_id: "sticker",
            reply_to_id: 8,
            client_message_id: "group-sticker",
          },
        },
      ],
      [
        "/chat/messages/a%2Fb/33/context?before=20&after=20",
        { requiredData: true, requiredEnvelope: true },
      ],
      [
        "/groups/7/messages/43/context?before=20&after=20",
        { requiredData: true, requiredEnvelope: true },
      ],
      [
        "/chat/messages/a%2Fb/31/recall",
        { method: "POST", body: {}, requiredData: true, requiredEnvelope: true },
      ],
      [
        "/groups/7/messages/41/recall",
        { method: "POST", body: {}, requiredData: true, requiredEnvelope: true },
      ],
    ]);
  });

  it("localizes self and other recall notices by viewer role", () => {
    expect(chatRecallNotice("me", "me", "Me", t)).toBe("chat.recall.selfNotice:");
    expect(chatRecallNotice("other", "me", "Friend", t)).toBe("chat.recall.otherNotice:Friend");
    expect(chatRecallNotice("other", "me", " ", t)).toBe(
      "chat.recall.otherNotice:chat.recall.someone:",
    );
  });
});

function direct(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    sender_id: "me",
    receiver_id: "other",
    msg_type: "text",
    content: "hello",
    timestamp: "2026-08-06T10:00:00Z",
    version: 1,
    ...overrides,
  };
}

function group(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    id: 1,
    group_id: 7,
    sender_id: "me",
    msg_type: "text",
    content: "hello",
    timestamp: "2026-08-06T10:00:00Z",
    sender_nickname: "Me",
    sender_avatar: "",
    mention_all: false,
    version: 1,
    ...overrides,
  };
}
