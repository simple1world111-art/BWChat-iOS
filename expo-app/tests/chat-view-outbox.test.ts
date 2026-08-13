import AsyncStorage from "@react-native-async-storage/async-storage";

import { APIError } from "@/api/client";
import {
  createDirectChatOutboxJob,
  directChatOutboxFailure,
  directChatOutboxOfflineWait,
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
import {
  ChatVoiceOutboxFileUnavailableError,
  requireAvailableChatVoiceUpload,
} from "@/services/messages/ChatVoiceOutboxPayload";

jest.mock("expo-file-system", () => ({
  File: class MockFile {
    readonly exists: boolean;

    constructor(uri: string) {
      this.exists = !uri.includes("missing");
    }
  },
}));

describe("native direct text/sticker/voice outbox", () => {
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

  it("persists a resumable voice payload and restores the same idempotency identity", async () => {
    const voice = await createDirectChatOutboxJob(voiceJob());
    await expect(readDirectChatOutboxJob("owner-a", "client-voice")).resolves.toEqual(voice);
    expect(voice).toMatchObject({
      id: "client-voice",
      client_message_id: "client-voice",
      msg_type: "voice",
      content: "file:///voice.m4a|4.25",
      voice: {
        uri: "file:///voice.m4a",
        filename: "voice_123.m4a",
        mime_type: "audio/m4a",
        duration: 4.25,
      },
    });
    expect(requireAvailableChatVoiceUpload(voice.voice)).toEqual({
      uri: "file:///voice.m4a",
      filename: "voice_123.m4a",
      mimeType: "audio/m4a",
      duration: 4.25,
    });
    expect(directOptimisticOutboxMessage(voice)).toMatchObject({
      client_message_id: "client-voice",
      msg_type: "voice",
      delivery_status: "sending",
    });
  });

  it("keeps legacy text cache rows readable by deriving their client identity from id", async () => {
    await AsyncStorage.setItem(
      "bwchat.direct-message-outbox.v1:account:owner-a:job:legacy-text",
      JSON.stringify({
        ...baseJob(),
        id: "legacy-text",
        client_message_id: undefined,
      }),
    );
    await expect(readDirectChatOutboxJob("owner-a", "legacy-text")).resolves.toMatchObject({
      id: "legacy-text",
      client_message_id: "legacy-text",
      msg_type: "text",
    });
  });

  it("fails a missing voice file permanently without an automatic retry loop", () => {
    const job = {
      ...voiceJob(),
      content: "file:///missing.m4a|4.25",
      voice: { ...voiceJob().voice, uri: "file:///missing.m4a" },
      state: "sending" as const,
      attempt_count: 2,
    };
    let error: unknown;
    try {
      requireAvailableChatVoiceUpload(job.voice);
    } catch (nextError) {
      error = nextError;
    }
    expect(error).toBeInstanceOf(ChatVoiceOutboxFileUnavailableError);
    expect(directChatOutboxFailure(job, error)).toMatchObject({
      state: "failed",
      attempt_count: 2,
      next_attempt_at: undefined,
    });
  });

  it("waits locally while definitely offline without consuming an attempt", () => {
    const job = { ...voiceJob(), state: "sending" as const, attempt_count: 4 };
    expect(directChatOutboxOfflineWait(job, 1_000)).toMatchObject({
      id: "client-voice",
      client_message_id: "client-voice",
      state: "retry_waiting",
      attempt_count: 4,
      next_attempt_at: new Date(6_000).toISOString(),
      retry_reason: "network_offline",
      last_error: undefined,
    });
    expect(directChatOutboxFailure(job, new APIError("offline", 0), 1_000)).toMatchObject({
      state: "retry_waiting",
      attempt_count: 5,
      client_message_id: "client-voice",
    });
  });
});

function baseJob() {
  return {
    id: "client-text",
    client_message_id: "client-text",
    owner_id: "owner-a",
    target_id: "friend-a",
    msg_type: "text" as const,
    content: "hello",
    created_at: "2026-08-08T00:00:00Z",
    state: "queued" as const,
    attempt_count: 0,
  };
}

function voiceJob() {
  return {
    id: "client-voice",
    client_message_id: "client-voice",
    owner_id: "owner-a",
    target_id: "friend-a",
    msg_type: "voice" as const,
    content: "file:///voice.m4a|4.25",
    voice: {
      uri: "file:///voice.m4a",
      filename: "voice_123.m4a",
      mime_type: "audio/m4a",
      duration: 4.25,
    },
    created_at: "2026-08-08T00:00:02Z",
  };
}
