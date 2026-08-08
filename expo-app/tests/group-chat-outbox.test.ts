import AsyncStorage from "@react-native-async-storage/async-storage";

import { APIError } from "@/api/client";
import {
  createGroupChatOutboxJob,
  groupChatOutboxFailure,
  groupChatOutboxPolicy,
  groupOptimisticOutboxMessage,
  isTransientGroupChatOutboxError,
  queuedGroupChatOutboxJob,
  readGroupChatOutboxJob,
  readGroupChatOutboxJobs,
  removeGroupChatOutboxJob,
  saveGroupChatOutboxJob,
  sendingGroupChatOutboxJob,
  temporaryGroupChatOutboxId,
} from "@/services/messages/GroupChatOutboxRepository";

describe("native group text/sticker outbox", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("persists before transport and restores only the matching account/group", async () => {
    const text = await createGroupChatOutboxJob(baseJob());
    await createGroupChatOutboxJob({
      ...baseJob(),
      id: "client-sticker",
      group_id: 22,
      msg_type: "sticker",
      content: "sticker-json",
      sticker_pack_id: "pack-a",
      sticker_id: "sticker-a",
      mentions: undefined,
      mention_all: false,
      created_at: "2026-08-08T00:00:01Z",
    });
    await expect(readGroupChatOutboxJobs("owner-a", 21)).resolves.toEqual([text]);
    await expect(readGroupChatOutboxJobs("owner-b", 21)).resolves.toEqual([]);
    expect(groupOptimisticOutboxMessage(text)).toMatchObject({
      id: temporaryGroupChatOutboxId("client-text"),
      group_id: 21,
      client_message_id: "client-text",
      mentions: ["u1"],
      mention_all: true,
      delivery_status: "sending",
    });
  });

  it("matches native five-attempt exponential transient retry and permanent failure", () => {
    expect(groupChatOutboxPolicy.maximumAutomaticAttempts).toBe(5);
    const initial = { ...baseJob(), state: "queued" as const, attempt_count: 0 };
    const first = groupChatOutboxFailure(initial, new APIError("busy", 503), 1_000);
    expect(first).toMatchObject({
      state: "retry_waiting",
      attempt_count: 1,
      next_attempt_at: new Date(2_000).toISOString(),
    });
    expect(
      groupChatOutboxFailure({ ...first, attempt_count: 5 }, new APIError("busy", 503), 2_000),
    ).toMatchObject({ state: "failed", attempt_count: 5 });
    expect(groupChatOutboxFailure(initial, new APIError("bad", 400))).toMatchObject({
      state: "failed",
      attempt_count: 0,
    });
    expect(isTransientGroupChatOutboxError(new APIError("offline", 0))).toBe(true);
    expect(isTransientGroupChatOutboxError(new APIError("timeout", 408))).toBe(true);
    expect(isTransientGroupChatOutboxError(new APIError("bad", 400))).toBe(false);
  });

  it("keeps one client id across sending, manual retry and exact removal", async () => {
    const created = await createGroupChatOutboxJob(baseJob());
    const sending = sendingGroupChatOutboxJob(created);
    await saveGroupChatOutboxJob(sending);
    await expect(readGroupChatOutboxJob("owner-a", "client-text")).resolves.toMatchObject({
      id: "client-text",
      state: "sending",
    });
    const queued = queuedGroupChatOutboxJob({ ...sending, state: "failed" });
    expect(queued).toMatchObject({ id: "client-text", state: "queued" });
    await removeGroupChatOutboxJob("owner-a", "client-text");
    await expect(readGroupChatOutboxJob("owner-a", "client-text")).resolves.toBeNull();
  });

  it("fails closed for corrupt mention, reply, timestamp and retry fields", async () => {
    await expect(
      saveGroupChatOutboxJob({
        ...baseJob(),
        mentions: [""],
        state: "queued",
        attempt_count: 0,
      }),
    ).rejects.toThrow("Invalid group chat outbox job");
    await AsyncStorage.setItem(
      "bwchat.group-message-outbox.v1:account:owner-a:job:corrupt",
      JSON.stringify({
        ...baseJob(),
        id: "corrupt",
        reply_to: { id: -1 },
        created_at: "not-a-date",
        state: "retry_waiting",
        attempt_count: 99,
      }),
    );
    await expect(readGroupChatOutboxJob("owner-a", "corrupt")).resolves.toBeNull();
    await expect(readGroupChatOutboxJobs("owner-a", 21)).resolves.toEqual([]);
  });
});

function baseJob() {
  return {
    id: "client-text",
    owner_id: "owner-a",
    group_id: 21,
    msg_type: "text" as const,
    content: "hello",
    mentions: ["u1"],
    mention_all: true,
    sender_nickname: "Owner",
    sender_avatar: "avatar",
    created_at: "2026-08-08T00:00:00Z",
  };
}
