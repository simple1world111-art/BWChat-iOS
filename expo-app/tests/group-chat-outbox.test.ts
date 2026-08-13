import AsyncStorage from "@react-native-async-storage/async-storage";

import { APIError } from "@/api/client";
import {
  createGroupChatOutboxJob,
  groupChatOutboxFailure,
  groupChatOutboxOfflineWait,
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

describe("native group text/sticker/voice outbox", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("persists before transport and restores only the matching account/group", async () => {
    const text = await createGroupChatOutboxJob(baseJob());
    await createGroupChatOutboxJob({
      ...baseJob(),
      id: "client-sticker",
      client_message_id: "client-sticker",
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

  it("persists a resumable group voice payload with one client identity", async () => {
    const voice = await createGroupChatOutboxJob(voiceJob());
    await expect(readGroupChatOutboxJob("owner-a", "group-client-voice")).resolves.toEqual(voice);
    expect(voice).toMatchObject({
      id: "group-client-voice",
      client_message_id: "group-client-voice",
      msg_type: "voice",
      content: "file:///group-voice.m4a|7.75",
      voice: {
        uri: "file:///group-voice.m4a",
        filename: "group_voice_123.m4a",
        mime_type: "audio/m4a",
        duration: 7.75,
      },
    });
    expect(requireAvailableChatVoiceUpload(voice.voice)).toEqual({
      uri: "file:///group-voice.m4a",
      filename: "group_voice_123.m4a",
      mimeType: "audio/m4a",
      duration: 7.75,
    });
    expect(groupOptimisticOutboxMessage(voice)).toMatchObject({
      client_message_id: "group-client-voice",
      msg_type: "voice",
      delivery_status: "sending",
    });
  });

  it("keeps legacy group text cache rows readable", async () => {
    await AsyncStorage.setItem(
      "bwchat.group-message-outbox.v1:account:owner-a:job:legacy-text",
      JSON.stringify({
        ...baseJob(),
        id: "legacy-text",
        client_message_id: undefined,
        state: "queued",
        attempt_count: 0,
      }),
    );
    await expect(readGroupChatOutboxJob("owner-a", "legacy-text")).resolves.toMatchObject({
      id: "legacy-text",
      client_message_id: "legacy-text",
      msg_type: "text",
    });
  });

  it("fails a missing group voice file permanently and does not schedule a loop", () => {
    const job = {
      ...voiceJob(),
      content: "file:///missing.m4a|7.75",
      voice: { ...voiceJob().voice, uri: "file:///missing.m4a" },
      state: "sending" as const,
      attempt_count: 3,
    };
    let error: unknown;
    try {
      requireAvailableChatVoiceUpload(job.voice);
    } catch (nextError) {
      error = nextError;
    }
    expect(error).toBeInstanceOf(ChatVoiceOutboxFileUnavailableError);
    expect(groupChatOutboxFailure(job, error)).toMatchObject({
      state: "failed",
      attempt_count: 3,
      next_attempt_at: undefined,
    });
  });

  it("waits locally while definitely offline without consuming an attempt", () => {
    const job = { ...voiceJob(), state: "sending" as const, attempt_count: 4 };
    expect(groupChatOutboxOfflineWait(job, 1_000)).toMatchObject({
      id: "group-client-voice",
      client_message_id: "group-client-voice",
      state: "retry_waiting",
      attempt_count: 4,
      next_attempt_at: new Date(6_000).toISOString(),
      retry_reason: "network_offline",
      last_error: undefined,
    });
    expect(groupChatOutboxFailure(job, new APIError("offline", 0), 1_000)).toMatchObject({
      state: "retry_waiting",
      attempt_count: 5,
      client_message_id: "group-client-voice",
    });
  });
});

function baseJob() {
  return {
    id: "client-text",
    client_message_id: "client-text",
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

function voiceJob() {
  return {
    id: "group-client-voice",
    client_message_id: "group-client-voice",
    owner_id: "owner-a",
    group_id: 21,
    msg_type: "voice" as const,
    content: "file:///group-voice.m4a|7.75",
    voice: {
      uri: "file:///group-voice.m4a",
      filename: "group_voice_123.m4a",
      mime_type: "audio/m4a",
      duration: 7.75,
    },
    mention_all: false,
    sender_nickname: "Owner",
    sender_avatar: "avatar",
    created_at: "2026-08-08T00:00:02Z",
  };
}
