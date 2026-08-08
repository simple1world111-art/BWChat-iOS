import { forwardMessages, getForwardBundle } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import type { Message } from "@/models";
import {
  canForwardSelection,
  chatForwardGeometry,
  chatMessageReference,
  chatSelectionDescriptor,
  forwardSource,
  isChatCallRecordContent,
  isSelectableChatMessage,
  parseForwardBundleMessage,
  sortForwardTargets,
  toggleChatSelection,
  toggleForwardTarget,
} from "@/services/messages/chatForwardPolicy";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);

describe("native multi-select and forwarding contracts", () => {
  beforeEach(() => request.mockReset());

  it("keeps all source-derived selection, target, confirmation and bundle metrics", () => {
    expect(chatForwardGeometry).toEqual({
      maximum_selected_messages: 99,
      maximum_forward_targets: 9,
      selection_indicator_size: 24,
      selection_indicator_hit_size: 44,
      selection_toolbar_height: 58,
      selection_toolbar_icon_size: 20,
      selection_toolbar_label_size: 12,
      target_avatar_size: 42,
      target_row_minimum_height: 52,
      target_check_size: 22,
      confirmation_height: 310,
      confirmation_handle_width: 36,
      confirmation_handle_height: 5,
      confirmation_spacing: 16,
      confirmation_horizontal_padding: 20,
      confirmation_preview_padding: 12,
      confirmation_preview_radius: 10,
      bundle_card_width: 230,
      bundle_card_padding: 12,
      bundle_card_radius: 12,
      bundle_card_spacing: 10,
    });
  });

  it("selects chronologically, breaks ties by id, toggles, and enforces 99", () => {
    const entry = (id: number, timestamp: number) => ({
      reference: `dm:7:${id}`,
      message_id: id,
      descriptor: { timestamp, message_type: "text", can_forward_individually: true, can_merge: true, can_delete: true },
    });
    let selected = toggleChatSelection([], entry(4, 20)).entries;
    selected = toggleChatSelection(selected, entry(3, 10)).entries;
    selected = toggleChatSelection(selected, entry(2, 10)).entries;
    expect(selected.map((item) => item.message_id)).toEqual([2, 3, 4]);
    expect(toggleChatSelection(selected, entry(3, 10)).entries.map((item) => item.message_id)).toEqual([2, 4]);
    const maximum = Array.from({ length: 99 }, (_, index) => entry(index + 1, index));
    expect(toggleChatSelection(maximum, entry(100, 100))).toEqual({ entries: maximum, accepted: false });
  });

  it("matches individual and merged eligibility for source message types", () => {
    const entry = (id: number, type: string) => ({
      reference: String(id),
      message_id: id,
      descriptor: chatSelectionDescriptor(message({ id, msg_type: type })),
    });
    expect(canForwardSelection([entry(1, "text")], "single")).toBe(true);
    expect(canForwardSelection([entry(1, "text"), entry(2, "image")], "individual")).toBe(true);
    expect(canForwardSelection([entry(1, "voice")], "individual")).toBe(false);
    expect(canForwardSelection([entry(1, "voice"), entry(2, "text")], "merged")).toBe(true);
    expect(canForwardSelection([entry(1, "gift")], "merged")).toBe(false);
    expect(canForwardSelection([entry(1, "chat_history")], "merged")).toBe(false);
  });

  it("excludes native call records, receipts, system/recalled and optimistic rows from selection", () => {
    expect(isChatCallRecordContent("[视频通话] 通话时长 01:24")).toBe(true);
    expect(isChatCallRecordContent("[Voice Call] missed")).toBe(true);
    expect(isChatCallRecordContent("[普通文本] missed")).toBe(false);
    expect(isSelectableChatMessage(message())).toBe(true);
    expect(isSelectableChatMessage(message({ id: -1, delivery_status: "sending" }))).toBe(false);
    expect(isSelectableChatMessage(message({ msg_type: "system" }))).toBe(false);
    expect(isSelectableChatMessage(message({ msg_type: "recalled" }))).toBe(false);
    expect(isSelectableChatMessage(message(), true)).toBe(false);
    expect(isSelectableChatMessage(message({ content: "[视频通话] 对方已取消" }))).toBe(false);
  });

  it("creates stable references and forwards the source expected version", () => {
    expect(chatMessageReference("a/b", "dm", "c d", 7)).toBe("a%2Fb:dm:c%20d:7");
    expect(forwardSource("group", "12", message({ id: 8, version: 4 }))).toEqual({
      conversation_type: "group",
      conversation_id: "12",
      message_id: 8,
      expected_version: 4,
    });
  });

  it("sorts confirmation targets by display name and enforces nine targets", () => {
    const a = { conversation_type: "dm" as const, conversation_id: "1", display_name: "阿明", avatar_url: "" };
    const b = { conversation_type: "group" as const, conversation_id: "2", display_name: "Bella", avatar_url: "" };
    expect(sortForwardTargets([a, b]).map((item) => item.display_name)).toEqual(["Bella", "阿明"]);
    const nine = Array.from({ length: 9 }, (_, index) => ({ conversation_type: "dm" as const, conversation_id: String(index), display_name: String(index), avatar_url: "" }));
    expect(toggleForwardTarget(nine, { conversation_type: "group", conversation_id: "10", display_name: "10", avatar_url: "" })).toEqual({ targets: nine, accepted: false });
    expect(toggleForwardTarget(nine, nine[0]!).targets).toHaveLength(8);
  });

  it("strictly parses only valid chat-history and forward-bundle payloads", () => {
    const content = JSON.stringify({ bundle_id: "bundle/7", title: "群聊记录", item_count: 3, summary: "A: hi" });
    expect(parseForwardBundleMessage(content, "chat_history")).toEqual({ bundle_id: "bundle/7", title: "群聊记录", item_count: 3, summary: "A: hi" });
    expect(parseForwardBundleMessage(content, "forward_bundle")).not.toBeNull();
    expect(parseForwardBundleMessage(content, "text")).toBeNull();
    expect(parseForwardBundleMessage(JSON.stringify({ bundle_id: "x", title: "x", item_count: -1, summary: "" }), "chat_history")).toBeNull();
    expect(parseForwardBundleMessage("not-json", "chat_history")).toBeNull();
  });

  it("uses the exact forwarding POST body/header and normalizes created messages", async () => {
    request.mockResolvedValueOnce({
      clientOperationId: "op-1",
      bundleId: "bundle-1",
      createdMessages: [
        { conversationType: "dm", conversationId: "friend/1", messageId: 51 },
        { conversation_type: "invalid", conversation_id: "x", message_id: 52 },
      ],
    });
    const body = {
      client_operation_id: "op-1",
      mode: "merged" as const,
      sources: [{ conversation_type: "group" as const, conversation_id: "9", message_id: 4, expected_version: 2 }],
      targets: [{ conversation_type: "dm" as const, conversation_id: "friend/1" }],
    };
    await expect(forwardMessages(body)).resolves.toEqual({
      client_operation_id: "op-1",
      bundle_id: "bundle-1",
      created_messages: [{ conversation_type: "dm", conversation_id: "friend/1", message_id: 51 }],
    });
    expect(request).toHaveBeenCalledWith("/chat/forwards", {
      method: "POST",
      headers: { "Idempotency-Key": "op-1" },
      body,
    });
  });

  it("encodes the bundle route and sorts normalized detail items by ordinal", async () => {
    request.mockResolvedValueOnce({
      bundleId: "bundle/7",
      title: "聊天记录",
      createdAt: "2026-08-06T10:00:00Z",
      items: [
        { ordinal: 2, senderName: "B", sentAt: "2026-08-06T10:01:00Z", messageType: "voice", summary: "2s", assetId: "asset-2" },
        { ordinal: 1, sender_name: "A", sent_at: "2026-08-06T10:00:00Z", message_type: "text", summary: "hi" },
      ],
    });
    await expect(getForwardBundle("bundle/7")).resolves.toMatchObject({
      bundle_id: "bundle/7",
      title: "聊天记录",
      items: [{ ordinal: 1, sender_name: "A" }, { ordinal: 2, sender_name: "B", asset_id: "asset-2" }],
    });
    expect(request).toHaveBeenCalledWith("/chat/forward-bundles/bundle%2F7");
  });
});

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    sender_id: "me",
    receiver_id: "friend",
    msg_type: "text",
    content: "hello",
    timestamp: "2026-08-06T10:00:00Z",
    version: 1,
    ...overrides,
  };
}
