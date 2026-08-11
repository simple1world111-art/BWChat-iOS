import AsyncStorage from "@react-native-async-storage/async-storage";

import { APIError } from "@/api/client";
import type { ChatImageOutboxEvent } from "@/services/messages/ChatImageOutbox";
import {
  cancelChatImageUpload,
  directOptimisticImageMessage,
  enqueueDirectChatImage,
  enqueueGroupChatImage,
  groupOptimisticImageMessage,
  isTransientChatImageError,
  readChatImageJobs,
  resumeChatImageUploads,
  retryChatImageUpload,
  subscribeChatImageOutbox,
  temporaryChatImageId,
} from "@/services/messages/ChatImageOutbox";
import { sendDirectImageMessage, sendGroupImageMessage } from "@/api/bwchat";

const mockExistingDirectories = new Set<string>();
let mockManipulationIndex = 0;

jest.mock("@/api/bwchat", () => ({
  sendDirectImageMessage: jest.fn(),
  sendGroupImageMessage: jest.fn(),
}));

jest.mock("expo-file-system", () => {
  class MockDirectory {
    readonly uri: string;

    constructor(...parts: unknown[]) {
      this.uri = parts
        .map((part) =>
          typeof part === "object" && part !== null && "uri" in part
            ? String((part as { uri: unknown }).uri)
            : String(part),
        )
        .join("/")
        .replaceAll(/\/+/g, "/")
        .replace("file:/", "file:///");
    }

    get exists() {
      return mockExistingDirectories.has(this.uri);
    }

    create() {
      mockExistingDirectories.add(this.uri);
    }

    delete() {
      mockExistingDirectories.delete(this.uri);
    }
  }

  class MockFile {
    readonly uri: string;
    readonly size = 80_000;

    constructor(...parts: unknown[]) {
      this.uri = parts
        .map((part) =>
          typeof part === "object" && part !== null && "uri" in part
            ? String((part as { uri: unknown }).uri)
            : String(part),
        )
        .join("/")
        .replaceAll(/\/+/g, "/")
        .replace("file:/", "file:///");
    }

    async copy(_destination: MockFile) {}
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { document: "file:///documents" },
  };
});

jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  manipulateAsync: jest.fn(async () => ({
    uri: `file:///cache/prepared-${(mockManipulationIndex += 1)}.jpg`,
    width: 1_200,
    height: 800,
  })),
}));

const directSend = jest.mocked(sendDirectImageMessage);
const groupSend = jest.mocked(sendGroupImageMessage);

describe("durable chat image outbox", () => {
  beforeEach(async () => {
    directSend.mockReset();
    groupSend.mockReset();
    mockExistingDirectories.clear();
    mockManipulationIndex = 0;
    await AsyncStorage.clear();
  });

  it("persists staging before upload, confirms by client ID, then removes durable state", async () => {
    const events: ChatImageOutboxEvent[] = [];
    const unsubscribe = subscribeChatImageOutbox((event) => events.push(event));
    directSend.mockResolvedValueOnce({
      id: 91,
      sender_id: "owner-a",
      receiver_id: "friend-a",
      msg_type: "image",
      content: "/chat/confirmed.jpg",
      timestamp: "2026-08-06T10:00:01Z",
      client_message_id: "direct-client",
      version: 1,
    });

    await enqueueDirectChatImage({
      owner: owner("owner-a"),
      targetId: "friend-a",
      clientMessageId: "direct-client",
      createdAt: "2026-08-06T10:00:00Z",
      asset: source("file:///picker/original.jpg"),
    });
    await waitUntil(() => events.some((event) => event.kind === "confirmed"));

    expect(directSend).toHaveBeenCalledWith(
      "friend-a",
      expect.objectContaining({
        uri: expect.stringContaining("/chat-images/owner-a/direct-client/upload.jpg"),
        thumbnailUri: expect.stringContaining("/chat-images/owner-a/direct-client/thumbnail.jpg"),
      }),
      "direct-client",
    );
    expect(
      events.filter((event) => event.kind === "updated").map((event) => event.job.state),
    ).toEqual(["staging", "queued", "preparing", "queued", "uploading"]);
    const confirmed = events.find((event) => event.kind === "confirmed");
    expect(confirmed?.message).toMatchObject({
      id: 91,
      client_message_id: "direct-client",
      delivery_status: "sent",
    });
    await expect(readChatImageJobs("owner-a")).resolves.toEqual([]);
    unsubscribe();
  });

  it("restores only the matching account/conversation and keeps permanent failures retryable", async () => {
    groupSend.mockRejectedValueOnce(new APIError("图片格式错误", 400));
    await enqueueGroupChatImage({
      owner: owner("owner-a"),
      targetId: "31",
      clientMessageId: "group-client",
      createdAt: "2026-08-06T10:00:00Z",
      asset: source("file:///picker/group.jpg"),
    });
    await waitUntil(async () => (await readChatImageJobs("owner-a"))[0]?.state === "failed");

    await expect(readChatImageJobs("owner-b")).resolves.toEqual([]);
    const restoredEvents: ChatImageOutboxEvent[] = [];
    const unsubscribe = subscribeChatImageOutbox((event) => restoredEvents.push(event));
    await resumeChatImageUploads("owner-b", "group", "31");
    await resumeChatImageUploads("owner-a", "group", "99");
    expect(restoredEvents).toEqual([]);
    await resumeChatImageUploads("owner-a", "group", "31");
    expect(restoredEvents).toHaveLength(1);
    expect(restoredEvents[0]).toMatchObject({ kind: "updated", scope: "group" });
    expect(groupSend).toHaveBeenCalledTimes(1);

    groupSend.mockResolvedValueOnce({
      id: 92,
      group_id: 31,
      sender_id: "owner-a",
      msg_type: "image",
      content: "/groups/confirmed.jpg",
      timestamp: "2026-08-06T10:00:02Z",
      sender_nickname: "我",
      sender_avatar: "/me.jpg",
      mention_all: false,
      version: 1,
    });
    await expect(retryChatImageUpload("owner-b", "group-client")).resolves.toBe(false);
    await expect(retryChatImageUpload("owner-a", "group-client")).resolves.toBe(true);
    await waitUntil(() => restoredEvents.some((event) => event.kind === "confirmed"));
    expect(groupSend).toHaveBeenCalledTimes(2);
    await expect(readChatImageJobs("owner-a")).resolves.toEqual([]);
    unsubscribe();
  });

  it("keeps the outbox pending when the server confirms a different authenticated sender", async () => {
    const events: ChatImageOutboxEvent[] = [];
    const unsubscribe = subscribeChatImageOutbox((event) => events.push(event));
    directSend.mockResolvedValueOnce({
      id: 93,
      sender_id: "owner-b",
      receiver_id: "friend-a",
      msg_type: "image",
      content: "/chat/wrong-owner.jpg",
      timestamp: "2026-08-06T10:00:03Z",
      version: 1,
    });

    await enqueueDirectChatImage({
      owner: owner("owner-a"),
      targetId: "friend-a",
      clientMessageId: "wrong-owner-client",
      asset: source("file:///picker/wrong-owner.jpg"),
    });
    await waitUntil(async () => (await readChatImageJobs("owner-a"))[0]?.state === "failed");

    await expect(readChatImageJobs("owner-a")).resolves.toEqual([
      expect.objectContaining({
        id: "wrong-owner-client",
        state: "failed",
        last_error: expect.stringContaining("账号确认不一致"),
      }),
    ]);
    expect(events.some((event) => event.kind === "confirmed")).toBe(false);
    unsubscribe();
  });

  it("reconstructs deterministic optimistic bubbles and classifies retryable failures", () => {
    const directJob = {
      id: "stable-client-id",
      owner_id: "owner-a",
      target_id: "friend-a",
      sender_nickname: "我",
      sender_avatar: "/me.jpg",
      source: source("file:///picker/a.jpg"),
      created_at: "2026-08-06T10:00:00Z",
      scope: "direct" as const,
      state: "failed" as const,
      attempt_count: 5,
    };
    const groupJob = { ...directJob, scope: "group" as const, target_id: "31" };

    expect(temporaryChatImageId("stable-client-id")).toBeLessThan(0);
    expect(temporaryChatImageId("stable-client-id")).toBe(temporaryChatImageId("stable-client-id"));
    expect(directOptimisticImageMessage(directJob)).toMatchObject({
      receiver_id: "friend-a",
      client_message_id: "stable-client-id",
      delivery_status: "failed",
    });
    expect(groupOptimisticImageMessage(groupJob)).toMatchObject({
      group_id: 31,
      client_message_id: "stable-client-id",
      delivery_status: "failed",
    });
    expect(isTransientChatImageError(new APIError("busy", 503))).toBe(true);
    expect(isTransientChatImageError(new APIError("bad", 400))).toBe(false);
  });

  it("cancels only the exact durable task and never restores or retries it", async () => {
    directSend.mockRejectedValueOnce(new APIError("bad image", 400));
    await enqueueDirectChatImage({
      owner: owner("owner-a"),
      targetId: "friend-a",
      clientMessageId: "cancel-image",
      asset: source("file:///picker/cancel.jpg"),
    });
    await waitUntil(async () => (await readChatImageJobs("owner-a"))[0]?.state === "failed");
    expect([...mockExistingDirectories].some((uri) => uri.includes("cancel-image"))).toBe(true);

    await expect(cancelChatImageUpload("owner-b", "cancel-image")).resolves.toBe(false);
    await expect(cancelChatImageUpload("owner-a", "cancel-image")).resolves.toBe(true);
    await expect(cancelChatImageUpload("owner-a", "cancel-image")).resolves.toBe(false);
    await expect(readChatImageJobs("owner-a")).resolves.toEqual([]);
    expect([...mockExistingDirectories].some((uri) => uri.includes("cancel-image"))).toBe(false);

    await resumeChatImageUploads("owner-a", "direct", "friend-a");
    await expect(retryChatImageUpload("owner-a", "cancel-image")).resolves.toBe(false);
    expect(directSend).toHaveBeenCalledTimes(1);
  });

  it("persists the native bounded retry count and resumes at its not-before time", async () => {
    jest.useFakeTimers();
    const random = jest.spyOn(Math, "random").mockReturnValue(0);
    try {
      directSend.mockRejectedValueOnce(new APIError("busy", 503)).mockResolvedValueOnce({
        id: 93,
        sender_id: "owner-a",
        receiver_id: "friend-a",
        msg_type: "image",
        content: "/chat/retried.jpg",
        timestamp: "2026-08-06T10:00:01Z",
        version: 1,
      });
      await enqueueDirectChatImage({
        owner: owner("owner-a"),
        targetId: "friend-a",
        clientMessageId: "retry-client",
        asset: source("file:///picker/retry.jpg"),
      });
      await flushMicrotasks();

      await expect(readChatImageJobs("owner-a")).resolves.toEqual([
        expect.objectContaining({
          state: "retry_waiting",
          attempt_count: 1,
          next_attempt_at: expect.any(String),
        }),
      ]);
      expect(directSend).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1_000);
      await flushMicrotasks();
      expect(directSend).toHaveBeenCalledTimes(2);
      await expect(readChatImageJobs("owner-a")).resolves.toEqual([]);
    } finally {
      random.mockRestore();
      jest.useRealTimers();
    }
  });
});

function owner(userId: string) {
  return { user_id: userId, nickname: "我", avatar_url: "/me.jpg" };
}

function source(uri: string) {
  return { uri, width: 1_600, height: 1_000, filename: "original.jpg" };
}

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for outbox state");
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}
