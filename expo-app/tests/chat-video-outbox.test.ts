import AsyncStorage from "@react-native-async-storage/async-storage";

import { sendDirectVideoMessage, sendGroupVideoMessage } from "@/api/bwchat";
import { APIError } from "@/api/client";
import { adoptLocalImageFile } from "@/services/cache/ImageCacheService";
import type { ChatVideoOutboxEvent } from "@/services/messages/ChatVideoOutbox";
import {
  cancelChatVideoUpload,
  directOptimisticVideoMessage,
  enqueueDirectChatVideo,
  enqueueGroupChatVideo,
  groupOptimisticVideoMessage,
  isTransientChatVideoError,
  readChatVideoJobs,
  resumeChatVideoUploads,
  retryChatVideoUpload,
  subscribeChatVideoOutbox,
} from "@/services/messages/ChatVideoOutbox";

const mockExistingDirectories = new Set<string>();

jest.mock("@/api/bwchat", () => ({
  sendDirectImageMessage: jest.fn(),
  sendGroupImageMessage: jest.fn(),
  sendDirectVideoMessage: jest.fn(),
  sendGroupVideoMessage: jest.fn(),
}));

jest.mock("@/services/messages/ChatVideoService", () => ({
  prepareChatVideo: jest.fn(
    async (asset: { uri: string; filename: string; width: number; height: number }) => ({
      uri: asset.uri,
      thumbnail_uri: "file:///cache/generated-thumbnail.jpg",
      filename: asset.filename,
      thumbnail_filename: "movie_thumb.jpg",
      mime_type: "video/mp4",
      width: asset.width,
      height: asset.height,
    }),
  ),
}));

jest.mock("@/services/cache/ImageCacheService", () => ({
  adoptLocalImageFile: jest.fn(async () => undefined),
}));

jest.mock("expo-file-system", () => {
  class MockDirectory {
    readonly uri: string;
    constructor(...parts: unknown[]) {
      this.uri = joinUri(parts);
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
    constructor(...parts: unknown[]) {
      this.uri = joinUri(parts);
    }
    async copy(_destination: MockFile) {}
  }
  function joinUri(parts: unknown[]) {
    return parts
      .map((part) =>
        typeof part === "object" && part !== null && "uri" in part
          ? String((part as { uri: unknown }).uri)
          : String(part),
      )
      .join("/")
      .replaceAll(/\/+/g, "/")
      .replace("file:/", "file:///");
  }
  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { document: "file:///documents" },
  };
});

const directSend = jest.mocked(sendDirectVideoMessage);
const groupSend = jest.mocked(sendGroupVideoMessage);
const adoptThumbnail = jest.mocked(adoptLocalImageFile);

describe("durable chat video outbox", () => {
  beforeEach(async () => {
    directSend.mockReset();
    groupSend.mockReset();
    adoptThumbnail.mockClear();
    mockExistingDirectories.clear();
    await AsyncStorage.clear();
  });

  it("stages video and thumbnail, confirms by client ID and cleans durable state", async () => {
    const events: ChatVideoOutboxEvent[] = [];
    const unsubscribe = subscribeChatVideoOutbox((event) => events.push(event));
    directSend.mockResolvedValueOnce({
      id: 101,
      sender_id: "owner-a",
      receiver_id: "friend-a",
      msg_type: "video",
      content: "/videos/confirmed.mp4",
      timestamp: "2026-08-06T11:00:01Z",
      version: 1,
    });

    await enqueueDirectChatVideo({
      owner: owner("owner-a"),
      targetId: "friend-a",
      clientMessageId: "video-direct",
      createdAt: "2026-08-06T11:00:00Z",
      asset: videoSource("file:///picker/movie.mp4"),
    });
    await waitUntil(() => events.some((event) => event.kind === "confirmed"));

    expect(directSend).toHaveBeenCalledWith(
      "friend-a",
      expect.objectContaining({
        uri: expect.stringContaining("/chat-videos/owner-a/video-direct/video-movie.mp4"),
        thumbnailUri: expect.stringContaining("/chat-videos/owner-a/video-direct/thumbnail.jpg"),
      }),
      "video-direct",
    );
    expect(
      events.filter((event) => event.kind === "updated").map((event) => event.job.state),
    ).toEqual(["staging", "queued", "preparing", "queued", "uploading"]);
    expect(events.find((event) => event.kind === "confirmed")?.message).toMatchObject({
      id: 101,
      client_message_id: "video-direct",
      delivery_status: "sent",
    });
    expect(adoptThumbnail).toHaveBeenCalledWith(
      expect.stringContaining("/chat-videos/owner-a/video-direct/thumbnail.jpg"),
      expect.arrayContaining([
        "/videos/confirmed_thumb.jpg",
        expect.stringContaining("/videos/confirmed_thumb.jpg"),
      ]),
    );
    await expect(readChatVideoJobs("owner-a")).resolves.toEqual([]);
    unsubscribe();
  });

  it("isolates permanent failures by account and conversation, then allows manual retry", async () => {
    groupSend.mockRejectedValueOnce(new APIError("视频格式错误", 400));
    await enqueueGroupChatVideo({
      owner: owner("owner-a"),
      targetId: "31",
      clientMessageId: "video-group",
      asset: videoSource("file:///picker/group.mov"),
    });
    await waitUntil(async () => (await readChatVideoJobs("owner-a"))[0]?.state === "failed");
    await expect(readChatVideoJobs("owner-b")).resolves.toEqual([]);

    const events: ChatVideoOutboxEvent[] = [];
    const unsubscribe = subscribeChatVideoOutbox((event) => events.push(event));
    await resumeChatVideoUploads("owner-a", "group", "99");
    expect(events).toEqual([]);
    await resumeChatVideoUploads("owner-a", "group", "31");
    expect(events).toHaveLength(1);
    expect(groupSend).toHaveBeenCalledTimes(1);

    groupSend.mockResolvedValueOnce({
      id: 102,
      group_id: 31,
      sender_id: "owner-a",
      msg_type: "video",
      content: "/videos/retried.mp4",
      timestamp: "2026-08-06T11:00:02Z",
      sender_nickname: "我",
      sender_avatar: "/me.jpg",
      mention_all: false,
      version: 1,
    });
    await expect(retryChatVideoUpload("owner-b", "video-group")).resolves.toBe(false);
    await expect(retryChatVideoUpload("owner-a", "video-group")).resolves.toBe(true);
    await waitUntil(() => events.some((event) => event.kind === "confirmed"));
    await expect(readChatVideoJobs("owner-a")).resolves.toEqual([]);
    unsubscribe();
  });

  it("reconstructs direct/group optimistic video rows and classifies only network failures", () => {
    const directJob = {
      id: "video-client",
      owner_id: "owner-a",
      target_id: "friend-a",
      sender_nickname: "我",
      sender_avatar: "/me.jpg",
      source: videoSource("file:///picker/movie.mp4"),
      created_at: "2026-08-06T11:00:00Z",
      scope: "direct" as const,
      state: "failed" as const,
      attempt_count: 5,
    };
    const groupJob = { ...directJob, scope: "group" as const, target_id: "31" };
    expect(directOptimisticVideoMessage(directJob)).toMatchObject({
      receiver_id: "friend-a",
      msg_type: "video",
      delivery_status: "failed",
    });
    expect(groupOptimisticVideoMessage(groupJob)).toMatchObject({
      group_id: 31,
      msg_type: "video",
      delivery_status: "failed",
    });
    expect(isTransientChatVideoError(new APIError("busy", 503))).toBe(true);
    expect(isTransientChatVideoError(new APIError("bad", 400))).toBe(false);
    expect(isTransientChatVideoError(new Error("programmer error"))).toBe(false);
  });

  it("cancels only the exact durable task and never restores or retries it", async () => {
    directSend.mockRejectedValueOnce(new APIError("bad video", 400));
    await enqueueDirectChatVideo({
      owner: owner("owner-a"),
      targetId: "friend-a",
      clientMessageId: "cancel-video",
      asset: videoSource("file:///picker/cancel.mp4"),
    });
    await waitUntil(async () => (await readChatVideoJobs("owner-a"))[0]?.state === "failed");
    expect([...mockExistingDirectories].some((uri) => uri.includes("cancel-video"))).toBe(true);

    await expect(cancelChatVideoUpload("owner-b", "cancel-video")).resolves.toBe(false);
    await expect(cancelChatVideoUpload("owner-a", "cancel-video")).resolves.toBe(true);
    await expect(cancelChatVideoUpload("owner-a", "cancel-video")).resolves.toBe(false);
    await expect(readChatVideoJobs("owner-a")).resolves.toEqual([]);
    expect([...mockExistingDirectories].some((uri) => uri.includes("cancel-video"))).toBe(false);

    await resumeChatVideoUploads("owner-a", "direct", "friend-a");
    await expect(retryChatVideoUpload("owner-a", "cancel-video")).resolves.toBe(false);
    expect(directSend).toHaveBeenCalledTimes(1);
  });
});

function owner(userId: string) {
  return { user_id: userId, nickname: "我", avatar_url: "/me.jpg" };
}

function videoSource(uri: string) {
  return {
    uri,
    width: 1_920,
    height: 1_080,
    filename: "movie.mp4",
    mime_type: "video/mp4",
  };
}

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for video outbox state");
}
