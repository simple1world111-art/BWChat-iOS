import AsyncStorage from "@react-native-async-storage/async-storage";
import fs from "node:fs";
import path from "node:path";

import type { Conversation } from "@/models";
import {
  applyGroupConversationPreviewUpdate,
  loadCachedConversationSnapshot,
  publishGroupConversationPreviewUpdate,
  reconcileConversationSnapshot,
  subscribeGroupConversationPreviewUpdates,
} from "@/services/conversations/ConversationRepository";

describe("owner-scoped group local conversation preview", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("falls back after deleting the current preview and preserves unrelated rows", () => {
    const rows = [conversation(21, "deleted", 20), conversation(22, "keep", 30)];
    expect(
      applyGroupConversationPreviewUpdate(rows, {
        owner_id: "owner-a",
        group_id: 21,
        last_message: "previous",
        last_message_time: "2026-08-08T00:00:10Z",
        last_message_id: 10,
        authoritative_fallback_from_message_id: 20,
      }),
    ).toEqual([
      expect.objectContaining({ group_id: 21, last_message: "previous", last_message_id: 10 }),
      rows[1],
    ]);
  });

  it("clears a stale sender when the latest preview belongs to the current user", () => {
    const rows = [{ ...conversation(21, "previous", 20), subtitle: "Peter" }];
    const updated = applyGroupConversationPreviewUpdate(rows, {
      owner_id: "owner-a",
      group_id: 21,
      last_message: "还是没有",
      last_message_time: "2026-08-08T00:00:21Z",
      last_message_id: 21,
      last_message_sender_id: "owner-a",
    });

    expect(updated[0]).toMatchObject({
      last_message: "还是没有",
      last_message_sender_id: "owner-a",
    });
    expect(updated[0]?.subtitle).toBeUndefined();
  });

  it("keeps the preview for a non-current delete, projects recall, and clears no remainder", () => {
    const rows = [conversation(21, "latest", 20)];
    expect(
      applyGroupConversationPreviewUpdate(rows, {
        owner_id: "owner-a",
        group_id: 21,
        last_message: "latest",
        last_message_time: rows[0]!.last_message_time,
        last_message_id: 20,
      }),
    ).toEqual(rows);
    expect(
      applyGroupConversationPreviewUpdate(rows, {
        owner_id: "owner-a",
        group_id: 21,
        last_message: "你撤回了一条消息",
        last_message_time: rows[0]!.last_message_time,
        last_message_id: 20,
      }),
    ).toEqual([expect.objectContaining({ last_message: "你撤回了一条消息" })]);
    expect(
      applyGroupConversationPreviewUpdate(rows, {
        owner_id: "owner-a",
        group_id: 21,
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

  it("rejects the same older preview without an authoritative delete tombstone", () => {
    const rows = [conversation(21, "latest", 20)];
    expect(
      applyGroupConversationPreviewUpdate(rows, {
        owner_id: "owner-a",
        group_id: 21,
        last_message: "stale",
        last_message_id: 10,
      }),
    ).toEqual(rows);
  });

  it("persists only to the matching owner and serializes concurrent preview writes", async () => {
    await reconcileConversationSnapshot("owner-a", {
      conversations: [conversation(21, "old", 1)],
    });
    await reconcileConversationSnapshot("owner-b", {
      conversations: [conversation(21, "other", 2)],
    });
    const ownerA = jest.fn();
    const ownerB = jest.fn();
    const unsubscribeA = subscribeGroupConversationPreviewUpdates("owner-a", ownerA);
    const unsubscribeB = subscribeGroupConversationPreviewUpdates("owner-b", ownerB);

    await Promise.all([
      publishGroupConversationPreviewUpdate({
        owner_id: "owner-a",
        group_id: 21,
        last_message: "first",
        last_message_id: 3,
      }),
      publishGroupConversationPreviewUpdate({
        owner_id: "owner-a",
        group_id: 21,
        last_message: "second",
        last_message_id: 4,
      }),
    ]);
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

  it("notifies the mounted list synchronously for an optimistic outgoing message", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeGroupConversationPreviewUpdates("owner-a", listener);

    const persistence = publishGroupConversationPreviewUpdate({
      owner_id: "owner-a",
      group_id: 21,
      last_message: "just sent",
      last_message_time: "2026-08-08T00:01:00Z",
      last_message_id: -1,
      last_message_sender_id: "owner-a",
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        last_message: "just sent",
        last_message_id: -1,
        last_message_sender_id: "owner-a",
      }),
    );
    await persistence;
    unsubscribe();
  });

  it("drops an event after teardown and keeps the screen subscription account-ticketed", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeGroupConversationPreviewUpdates("owner-a", listener);
    unsubscribe();
    await publishGroupConversationPreviewUpdate({
      owner_id: "owner-a",
      group_id: 21,
      last_message: "late",
      last_message_id: 9,
    });
    expect(listener).not.toHaveBeenCalled();

    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/(tabs)/conversations.tsx"),
      "utf8",
    );
    expect(source).toContain("subscribeGroupConversationPreviewUpdates(ownerId");
    expect(source).toContain("accountScopeRef.current.isCurrent(ticket)");
  });

  it("connects delete, recall and history-clear fallback projection to the group screen", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/group-chat/[id].tsx"), "utf8");
    expect(
      source.match(/publishGroupConversationPreviewUpdate\(/gu)?.length,
    ).toBeGreaterThanOrEqual(4);
    expect(source).toContain("groupConversationPreviewFields(filtered, ownerId, t)");
    expect(source).toContain("groupConversationPreviewFields(merged, user.user_id, t)");
    expect(source).toContain("groupConversationPreviewFields(next, user.user_id, t)");
    expect(source).toContain('message.delivery_status !== "failed"');
    expect(source).toContain('operation: "group_message_live_preview"');
  });
});

function conversation(groupId: number, preview: string, messageId: number): Conversation {
  return {
    type: "group",
    id: String(groupId),
    group_id: groupId,
    name: `group-${groupId}`,
    avatar_url: "",
    last_message: preview,
    last_message_time: `2026-08-08T00:00:${String(messageId).padStart(2, "0")}Z`,
    last_message_id: messageId,
    unread_count: 0,
    is_muted: false,
  };
}
