import AsyncStorage from "@react-native-async-storage/async-storage";
import fs from "node:fs";
import path from "node:path";

import type { Conversation } from "@/models";
import {
  applyDirectConversationPreviewUpdate,
  loadCachedConversationSnapshot,
  publishDirectConversationPreviewUpdate,
  reconcileConversationSnapshot,
  subscribeDirectConversationPreviewUpdates,
} from "@/services/conversations/ConversationRepository";

describe("owner-scoped direct local-delete conversation preview", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("falls back after deleting the current preview and preserves unrelated rows", () => {
    const rows = [conversation("friend-a", "deleted", 20), conversation("friend-b", "keep", 30)];
    expect(
      applyDirectConversationPreviewUpdate(rows, {
        owner_id: "owner-a",
        contact_id: "friend-a",
        last_message: "previous",
        last_message_time: "2026-08-08T00:00:10Z",
        last_message_id: 10,
        authoritative_fallback_from_message_id: 20,
      }),
    ).toEqual([
      expect.objectContaining({ id: "friend-a", last_message: "previous", last_message_id: 10 }),
      rows[1],
    ]);
  });

  it("keeps the current preview when deleting a non-current row and clears when none remain", () => {
    const rows = [conversation("friend-a", "latest", 20)];
    expect(
      applyDirectConversationPreviewUpdate(rows, {
        owner_id: "owner-a",
        contact_id: "friend-a",
        last_message: "latest",
        last_message_time: rows[0]!.last_message_time,
        last_message_id: 20,
      }),
    ).toEqual(rows);
    expect(
      applyDirectConversationPreviewUpdate(rows, {
        owner_id: "owner-a",
        contact_id: "friend-a",
        authoritative_fallback_from_message_id: 20,
      }),
    ).toEqual([
      expect.not.objectContaining({
        last_message: expect.anything(),
        last_message_time: expect.anything(),
        last_message_id: expect.anything(),
      }),
    ]);
  });

  it("rejects the same older preview when no authoritative delete tombstone is supplied", () => {
    const rows = [conversation("friend-a", "latest", 20)];
    expect(
      applyDirectConversationPreviewUpdate(rows, {
        owner_id: "owner-a",
        contact_id: "friend-a",
        last_message: "stale",
        last_message_id: 10,
      }),
    ).toEqual(rows);
  });

  it("persists and publishes only to the matching owner, with late writes serialized", async () => {
    await reconcileConversationSnapshot("owner-a", {
      conversations: [conversation("friend-a", "old", 1)],
    });
    await reconcileConversationSnapshot("owner-b", {
      conversations: [conversation("friend-a", "other", 2)],
    });
    const ownerA = jest.fn();
    const ownerB = jest.fn();
    const unsubscribeA = subscribeDirectConversationPreviewUpdates("owner-a", ownerA);
    const unsubscribeB = subscribeDirectConversationPreviewUpdates("owner-b", ownerB);

    const first = publishDirectConversationPreviewUpdate({
      owner_id: "owner-a",
      contact_id: "friend-a",
      last_message: "first",
      last_message_id: 3,
    });
    const second = publishDirectConversationPreviewUpdate({
      owner_id: "owner-a",
      contact_id: "friend-a",
      last_message: "second",
      last_message_id: 4,
    });
    await Promise.all([first, second]);
    expect(ownerA).toHaveBeenCalledTimes(2);
    expect(ownerB).not.toHaveBeenCalled();
    await expect(loadCachedConversationSnapshot("owner-a")).resolves.toMatchObject({
      conversations: [expect.objectContaining({ last_message: "second", last_message_id: 4 })],
    });
    await expect(loadCachedConversationSnapshot("owner-b")).resolves.toMatchObject({
      conversations: [expect.objectContaining({ last_message: "other", last_message_id: 2 })],
    });
    unsubscribeA();
    unsubscribeB();
  });

  it("notifies the mounted list synchronously before persistence finishes", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeDirectConversationPreviewUpdates("owner-a", listener);

    const persistence = publishDirectConversationPreviewUpdate({
      owner_id: "owner-a",
      contact_id: "friend-a",
      last_message: "just sent",
      last_message_time: "2026-08-08T00:01:00Z",
      last_message_id: -1,
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ last_message: "just sent", last_message_id: -1 }),
    );
    await persistence;
    unsubscribe();
  });

  it("does not notify a listener after teardown", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeDirectConversationPreviewUpdates("owner-a", listener);
    unsubscribe();
    await publishDirectConversationPreviewUpdate({
      owner_id: "owner-a",
      contact_id: "friend-a",
      last_message: "late",
      last_message_id: 9,
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it("projects pending sends from the chat timeline and excludes terminal failures", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/chat/[id].tsx"), "utf8");
    expect(source).toContain('message.delivery_status !== "failed"');
    expect(source).toContain('operation: "direct_message_live_preview"');
  });
});

function conversation(id: string, preview: string, messageId: number): Conversation {
  return {
    type: "dm",
    id,
    name: id,
    avatar_url: "",
    last_message: preview,
    last_message_time: `2026-08-08T00:00:${String(messageId).padStart(2, "0")}Z`,
    last_message_id: messageId,
    unread_count: 0,
    is_muted: false,
  };
}
