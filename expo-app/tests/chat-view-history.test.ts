import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Message } from "@/models";
import {
  directChatHistoryKey,
  directChatHistoryPolicy,
  isDirectChatHistoryBackfilled,
  markDirectChatHistoryBackfilled,
  mergeDirectChatMessages,
  pruneDirectChatCachedMessagesThrough,
  readDirectChatCachedMessages,
  readDirectChatCachedPage,
  saveDirectChatMessages,
} from "@/services/messages/DirectChatHistoryRepository";

describe("native direct chat history cache", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("keeps the native 30/100/50/5000 policy and isolates account plus contact", async () => {
    expect(directChatHistoryPolicy).toEqual({
      visiblePageSize: 30,
      syncPageSize: 100,
      maximumBackfillPages: 50,
      maximumCachedMessages: 5_000,
    });
    await saveDirectChatMessages("owner-a", "friend-a", [message(1), message(2)]);
    await saveDirectChatMessages("owner-b", "friend-a", [message(3, "owner-b", "friend-a")]);
    await saveDirectChatMessages("owner-a", "friend-b", [message(4, "owner-a", "friend-b")]);

    await expect(readDirectChatCachedMessages("owner-a", "friend-a")).resolves.toEqual([
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ id: 2 }),
    ]);
    await expect(readDirectChatCachedMessages("owner-b", "friend-a")).resolves.toEqual([
      expect.objectContaining({ id: 3 }),
    ]);
    expect(directChatHistoryKey("owner-a", "friend/a")).toContain("contact:friend%2Fa");
    expect(directChatHistoryKey("", "friend-a")).toBeNull();
  });

  it("serves newest local pages before server pagination and prunes a clear watermark", async () => {
    await saveDirectChatMessages(
      "owner-a",
      "friend-a",
      Array.from({ length: 65 }, (_, index) => message(index + 1)),
    );
    await expect(readDirectChatCachedPage("owner-a", "friend-a")).resolves.toMatchObject({
      messages: Array.from({ length: 30 }, (_, index) =>
        expect.objectContaining({ id: index + 36 }),
      ),
      hasMore: true,
      totalCount: 65,
    });
    await expect(
      readDirectChatCachedPage("owner-a", "friend-a", { beforeId: 36 }),
    ).resolves.toMatchObject({
      messages: Array.from({ length: 30 }, (_, index) =>
        expect.objectContaining({ id: index + 6 }),
      ),
      hasMore: true,
    });

    await pruneDirectChatCachedMessagesThrough("owner-a", "friend-a", 50);
    const remaining = await readDirectChatCachedMessages("owner-a", "friend-a");
    expect(remaining.map((item) => item.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => 51 + index),
    );
  });

  it("merges websocket/API echoes by id or client id and rejects stale versions", () => {
    const optimisticEcho = message(10, "owner-a", "friend-a", 2, "client-10");
    const stale = { ...optimisticEcho, content: "stale", version: 1 };
    const confirmed = message(11, "owner-a", "friend-a", 3, "client-10");
    const merged = mergeDirectChatMessages([optimisticEcho], [stale, confirmed]);
    expect(merged).toEqual([
      expect.objectContaining({ id: 11, version: 3, client_message_id: "client-10" }),
    ]);
  });

  it("pages by canonical server ID even when sender timestamps are skewed", async () => {
    await saveDirectChatMessages("owner-a", "friend-a", [
      { ...message(1), timestamp: "2026-08-08T00:00:40.000Z" },
      { ...message(2), timestamp: "2026-08-08T00:00:30.000Z" },
      { ...message(3), timestamp: "2026-08-08T00:00:20.000Z" },
      { ...message(4), timestamp: "2026-08-08T00:00:10.000Z" },
    ]);
    const latest = await readDirectChatCachedPage("owner-a", "friend-a", { limit: 2 });
    expect(latest.messages.map((item) => item.id).sort((left, right) => left - right)).toEqual([
      3, 4,
    ]);
    const older = await readDirectChatCachedPage("owner-a", "friend-a", {
      beforeId: 3,
      limit: 2,
    });
    expect(older.messages.map((item) => item.id).sort((left, right) => left - right)).toEqual([
      1, 2,
    ]);
  });

  it("fails closed for corrupt cache and scopes the one-time backfill marker", async () => {
    const key = directChatHistoryKey("owner-a", "friend-a")!;
    await AsyncStorage.setItem(key, "{broken");
    await expect(readDirectChatCachedMessages("owner-a", "friend-a")).resolves.toEqual([]);
    await markDirectChatHistoryBackfilled("owner-a", "friend-a");
    await expect(isDirectChatHistoryBackfilled("owner-a", "friend-a")).resolves.toBe(true);
    await expect(isDirectChatHistoryBackfilled("owner-b", "friend-a")).resolves.toBe(false);
    await expect(isDirectChatHistoryBackfilled("owner-a", "friend-b")).resolves.toBe(false);
  });
});

function message(
  id: number,
  senderId = id % 2 === 0 ? "owner-a" : "friend-a",
  receiverId = id % 2 === 0 ? "friend-a" : "owner-a",
  version = 1,
  clientMessageId?: string,
): Message {
  return {
    id,
    sender_id: senderId,
    receiver_id: receiverId,
    msg_type: "text",
    content: `message-${id}`,
    timestamp: new Date(Date.UTC(2026, 7, 8, 0, 0, id)).toISOString(),
    ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
    version,
  };
}
