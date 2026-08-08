import AsyncStorage from "@react-native-async-storage/async-storage";

import { APIError } from "@/api/client";
import {
  createDirectChatOutboxJob,
  directChatOutboxFailure,
  directChatOutboxPolicy,
  directOptimisticOutboxMessage,
  isTransientDirectChatOutboxError,
  queuedDirectChatOutboxJob,
  readDirectChatOutboxJob,
  readDirectChatOutboxJobs,
  removeDirectChatOutboxJob,
  saveDirectChatOutboxJob,
  sendingDirectChatOutboxJob,
  temporaryDirectChatOutboxId,
} from "@/services/messages/DirectChatOutboxRepository";

describe("native direct text/sticker outbox", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("persists before transport and restores only the matching account/conversation", async () => {
    const text = await createDirectChatOutboxJob({
      id: "client-text",
      owner_id: "owner-a",
      target_id: "friend-a",
      msg_type: "text",
      content: "hello",
      created_at: "2026-08-08T00:00:00Z",
    });
    await createDirectChatOutboxJob({
      id: "client-sticker",
      owner_id: "owner-a",
      target_id: "friend-b",
      msg_type: "sticker",
      content: "sticker-json",
      sticker_pack_id: "pack-a",
      sticker_id: "sticker-a",
      created_at: "2026-08-08T00:00:01Z",
    });
    await expect(readDirectChatOutboxJobs("owner-a", "friend-a")).resolves.toEqual([text]);
    await expect(readDirectChatOutboxJobs("owner-b", "friend-a")).resolves.toEqual([]);
    expect(directOptimisticOutboxMessage(text)).toMatchObject({
      id: temporaryDirectChatOutboxId("client-text"),
      receiver_id: "friend-a",
      client_message_id: "client-text",
      delivery_status: "sending",
    });
  });

  it("matches native five-attempt exponential transient retry and permanent failure", () => {
    expect(directChatOutboxPolicy.maximumAutomaticAttempts).toBe(5);
    const initial = baseJob();
    const first = directChatOutboxFailure(initial, new APIError("busy", 503), 1_000);
    expect(first).toMatchObject({
      state: "retry_waiting",
      attempt_count: 1,
      next_attempt_at: new Date(2_000).toISOString(),
    });
    const exhausted = directChatOutboxFailure(
      { ...first, attempt_count: 5 },
      new APIError("busy", 503),
      2_000,
    );
    expect(exhausted).toMatchObject({ state: "failed", attempt_count: 5 });
    expect(directChatOutboxFailure(initial, new APIError("bad", 400))).toMatchObject({
      state: "failed",
      attempt_count: 0,
    });
    expect(isTransientDirectChatOutboxError(new APIError("offline", 0))).toBe(true);
    expect(isTransientDirectChatOutboxError(new APIError("timeout", 408))).toBe(true);
    expect(isTransientDirectChatOutboxError(new APIError("bad", 400))).toBe(false);
  });

  it("keeps one client id across sending, manual retry and exact removal", async () => {
    const created = await createDirectChatOutboxJob(baseJob());
    const sending = sendingDirectChatOutboxJob(created);
    await saveDirectChatOutboxJob(sending);
    await expect(readDirectChatOutboxJob("owner-a", "client-text")).resolves.toMatchObject({
      id: "client-text",
      state: "sending",
    });
    const queued = queuedDirectChatOutboxJob({ ...sending, state: "failed" });
    expect(queued).toMatchObject({ id: "client-text", state: "queued" });
    await removeDirectChatOutboxJob("owner-a", "client-text");
    await expect(readDirectChatOutboxJob("owner-a", "client-text")).resolves.toBeNull();
  });
});

function baseJob() {
  return {
    id: "client-text",
    owner_id: "owner-a",
    target_id: "friend-a",
    msg_type: "text" as const,
    content: "hello",
    created_at: "2026-08-08T00:00:00Z",
    state: "queued" as const,
    attempt_count: 0,
  };
}
