import { searchGroupMessages } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  normalizeGroupMessageSearchPage,
  normalizeGroupMessageSearchResult,
} from "@/api/normalizers";
import type { GroupMessage, GroupMessageSearchResult } from "@/models";
import {
  clearGroupMessageLocationRequestsForTests,
  requestGroupMessageLocation,
  subscribeGroupMessageLocation,
} from "@/services/messages/GroupMessageLocatorBus";
import {
  appendUniqueGroupMessageSearchResults,
  groupMessageSearchDateRange,
  groupMessageSearchPreview,
  groupSearchMessageTypes,
  hasActiveGroupMessageSearchFilters,
  hasGroupMessageSearchInput,
  initialGroupMessageSearchFilters,
} from "@/services/messages/groupMessageSearchPolicy";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
const request = jest.mocked(apiRequest);

describe("native group message search contracts", () => {
  beforeEach(() => {
    request.mockReset();
    clearGroupMessageLocationRequestsForTests();
  });

  it("keeps all nine native search types and exact search-input/filter rules", () => {
    expect(groupSearchMessageTypes).toEqual([
      "",
      "text",
      "image",
      "video",
      "voice",
      "sticker",
      "gift",
      "file",
      "system",
    ]);
    const filters = initialGroupMessageSearchFilters(new Date("2026-08-06T12:00:00Z"));
    expect(hasGroupMessageSearchInput("   ", filters)).toBe(false);
    expect(hasActiveGroupMessageSearchFilters(filters)).toBe(false);
    expect(hasGroupMessageSearchInput("cat", filters)).toBe(true);
    expect(hasGroupMessageSearchInput("", { ...filters, senderId: "u1" })).toBe(true);
    expect(hasActiveGroupMessageSearchFilters({ ...filters, messageType: "voice" })).toBe(true);
  });

  it("uses the earlier/later selected dates regardless of picker order", () => {
    const filters = initialGroupMessageSearchFilters();
    const later = new Date("2026-08-06T12:00:00.000Z");
    const earlier = new Date("2026-07-01T12:00:00.000Z");
    expect(
      groupMessageSearchDateRange({ ...filters, usesDateRange: true, from: later, to: earlier }),
    ).toEqual({ from: earlier, to: later });
    expect(groupMessageSearchDateRange(filters)).toEqual({});
  });

  it("normalizes locator fallback, flexible highlighted text and both page collection keys", () => {
    expect(
      normalizeGroupMessageSearchResult({
        message: message({ id: 4, history_sequence: 9 }),
        highlightedText: "hit",
      }),
    ).toEqual({
      message: message({ id: 4, history_sequence: 9 }),
      locator: { message_id: 4, history_sequence: 9 },
      highlighted_text: "hit",
    });
    expect(
      normalizeGroupMessageSearchPage({
        messages: [{ message: message({ id: 5 }), locator: { messageId: 8 } }],
        nextCursor: "next",
      }),
    ).toMatchObject({
      results: [{ locator: { message_id: 8 } }],
      next_cursor: "next",
      has_more: true,
    });
    expect(normalizeGroupMessageSearchPage({ results: [], has_more: false })).toEqual({
      results: [],
      has_more: false,
    });
  });

  it("builds the exact ordered, encoded API query and clamps limit to 1...100", async () => {
    request.mockResolvedValueOnce({ results: [], has_more: false });
    await searchGroupMessages(7, {
      query: "cat & dog",
      limit: 999,
      senderId: " u/1 ",
      messageType: " image ",
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-08-06T00:00:00.000Z"),
      cursor: " next/page ",
    });
    expect(request).toHaveBeenCalledWith(
      "/groups/7/messages/search?q=cat+%26+dog&limit=100&sender_id=+u%2F1+&message_type=+image+&from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-06T00%3A00%3A00.000Z&cursor=+next%2Fpage+",
      { cache: "no-store", requiredData: true, requiredEnvelope: true },
    );
  });

  it("uses Foundation blank checks but preserves nonblank optional query values verbatim", async () => {
    request.mockResolvedValueOnce({ results: [], has_more: false });
    await searchGroupMessages(7, {
      query: "",
      senderId: "\u200B",
      messageType: "\uFEFF",
      cursor: "\u00A0",
    });
    expect(request).toHaveBeenCalledWith(
      "/groups/7/messages/search?q=&limit=30&message_type=%EF%BB%BF",
      { cache: "no-store", requiredData: true, requiredEnvelope: true },
    );
  });

  it("deduplicates paged results by locator id while retaining first-page order", () => {
    expect(
      appendUniqueGroupMessageSearchResults([result(1), result(2)], [result(2), result(3)]).map(
        (item) => item.locator.message_id,
      ),
    ).toEqual([1, 2, 3]);
  });

  it("uses highlighted text, then native media labels, then raw content", () => {
    const t = (key: string) => `[${key}]`;
    expect(groupMessageSearchPreview({ ...result(1), highlighted_text: " hit " }, t)).toBe("hit");
    expect(groupMessageSearchPreview(result(1, { msg_type: "image" }), t)).toBe("[message.image]");
    expect(groupMessageSearchPreview(result(1, { msg_type: "text", content: "hello" }), t)).toBe(
      "hello",
    );
  });

  it("delivers pending and live locate requests once and isolates group ids", async () => {
    const groupSeven: number[] = [];
    const groupEight: number[] = [];
    requestGroupMessageLocation(7, 41);
    const stopSeven = subscribeGroupMessageLocation(7, (id) => groupSeven.push(id));
    const stopEight = subscribeGroupMessageLocation(8, (id) => groupEight.push(id));
    await Promise.resolve();
    expect(groupSeven).toEqual([41]);
    expect(groupEight).toEqual([]);
    requestGroupMessageLocation(7, 42);
    requestGroupMessageLocation(8, 51);
    expect(groupSeven).toEqual([41, 42]);
    expect(groupEight).toEqual([51]);
    stopSeven();
    stopEight();
  });
});

function message(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    id: 1,
    group_id: 7,
    sender_id: "u1",
    msg_type: "text",
    content: "hello",
    timestamp: "2026-08-06T10:00:00Z",
    sender_nickname: "Alice",
    sender_avatar: "",
    mention_all: false,
    version: 1,
    ...overrides,
  };
}

function result(id: number, overrides: Partial<GroupMessage> = {}): GroupMessageSearchResult {
  return { message: message({ id, ...overrides }), locator: { message_id: id } };
}
