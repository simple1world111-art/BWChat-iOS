import AsyncStorage from "@react-native-async-storage/async-storage";

import type { GroupMessage } from "@/models";
import {
  groupChatHistoryKey,
  groupChatHistoryPolicy,
  isGroupChatHistoryBackfilled,
  markGroupChatHistoryBackfilled,
  mergeGroupChatMessages,
  pruneGroupChatCachedMessagesThroughSequence,
  readGroupChatCachedMessages,
  readGroupChatCachedPage,
  saveGroupChatMessages,
} from "@/services/messages/GroupChatHistoryRepository";

describe("native group chat history cache", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("keeps the native 30/100/50/5000 policy and isolates account plus group", async () => {
    expect(groupChatHistoryPolicy).toEqual({
      visiblePageSize: 30,
      syncPageSize: 100,
      maximumBackfillPages: 50,
      maximumCachedMessages: 5_000,
    });
    await saveGroupChatMessages("owner-a", 21, [message(1), message(2)]);
    await saveGroupChatMessages("owner-b", 21, [message(3)]);
    await saveGroupChatMessages("owner-a", 22, [message(4, 22)]);

    expect((await readGroupChatCachedMessages("owner-a", 21)).map((item) => item.id)).toEqual([
      1, 2,
    ]);
    expect((await readGroupChatCachedMessages("owner-b", 21)).map((item) => item.id)).toEqual([3]);
    expect((await readGroupChatCachedMessages("owner-a", 22)).map((item) => item.id)).toEqual([4]);
    expect(groupChatHistoryKey("owner/a", 21)).toContain("account:owner%2Fa:group:21");
    expect(groupChatHistoryKey("", 21)).toBeNull();
  });

  it("serves newest local pages before server pagination and prunes a clear sequence", async () => {
    await saveGroupChatMessages(
      "owner-a",
      21,
      Array.from({ length: 65 }, (_, index) => message(index + 1)),
    );
    await expect(readGroupChatCachedPage("owner-a", 21)).resolves.toMatchObject({
      messages: Array.from({ length: 30 }, (_, index) =>
        expect.objectContaining({ id: index + 36 }),
      ),
      hasMore: true,
      totalCount: 65,
    });
    await expect(readGroupChatCachedPage("owner-a", 21, { beforeId: 36 })).resolves.toMatchObject({
      messages: Array.from({ length: 30 }, (_, index) =>
        expect.objectContaining({ id: index + 6 }),
      ),
      hasMore: true,
    });

    await pruneGroupChatCachedMessagesThroughSequence("owner-a", 21, 50);
    expect((await readGroupChatCachedMessages("owner-a", 21)).map((item) => item.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => 51 + index),
    );
  });

  it("merges websocket/API echoes by id or client id and rejects stale versions", () => {
    const optimisticEcho = message(10, 21, 2, "client-10");
    const stale = { ...optimisticEcho, content: "stale", version: 1 };
    const confirmed = message(11, 21, 3, "client-10");
    expect(mergeGroupChatMessages([optimisticEcho], [stale, confirmed])).toEqual([
      expect.objectContaining({ id: 11, version: 3, client_message_id: "client-10" }),
    ]);
  });

  it("advances before/after cursors by server id even when server timestamps are skewed", async () => {
    await saveGroupChatMessages("owner-a", 21, [
      { ...message(1), timestamp: "2026-08-08T00:00:40.000Z" },
      { ...message(2), timestamp: "2026-08-08T00:00:30.000Z" },
      { ...message(3), timestamp: "2026-08-08T00:00:20.000Z" },
      { ...message(4), timestamp: "2026-08-08T00:00:10.000Z" },
    ]);
    const latest = await readGroupChatCachedPage("owner-a", 21, { limit: 2 });
    expect(latest.messages.map((item) => item.id).sort((left, right) => left - right)).toEqual([
      3, 4,
    ]);
    const older = await readGroupChatCachedPage("owner-a", 21, { beforeId: 3, limit: 2 });
    expect(older.messages.map((item) => item.id).sort((left, right) => left - right)).toEqual([
      1, 2,
    ]);
  });

  it("fails closed for corrupt or cross-group cache and scopes the backfill marker", async () => {
    const key = groupChatHistoryKey("owner-a", 21)!;
    await AsyncStorage.setItem(key, "{broken");
    await expect(readGroupChatCachedMessages("owner-a", 21)).resolves.toEqual([]);
    await saveGroupChatMessages("owner-a", 21, [message(9, 22)]);
    await expect(readGroupChatCachedMessages("owner-a", 21)).resolves.toEqual([]);
    await markGroupChatHistoryBackfilled("owner-a", 21);
    await expect(isGroupChatHistoryBackfilled("owner-a", 21)).resolves.toBe(true);
    await expect(isGroupChatHistoryBackfilled("owner-b", 21)).resolves.toBe(false);
    await expect(isGroupChatHistoryBackfilled("owner-a", 22)).resolves.toBe(false);
  });
});

function message(id: number, groupId = 21, version = 1, clientMessageId?: string): GroupMessage {
  return {
    id,
    group_id: groupId,
    sender_id: id % 2 === 0 ? "owner-a" : "member-a",
    msg_type: "text",
    content: `message-${id}`,
    timestamp: new Date(Date.UTC(2026, 7, 8, 0, 0, id)).toISOString(),
    sender_nickname: "Member",
    sender_avatar: "",
    mention_all: false,
    history_sequence: id,
    ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
    version,
  };
}
