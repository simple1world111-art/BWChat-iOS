import {
  getMessageContext,
  getMessages,
  markDirectMessagesRead,
  recallDirectMessage,
  sendDirectGiftMessage,
  sendDirectImageMessage,
  sendDirectStickerMessage,
  sendDirectVideoMessage,
  sendDirectVoiceMessage,
  sendTextMessage,
} from "@/api/bwchat";
import { APIError, apiRequest, decodeSuccessfulPayload } from "@/api/client";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client") as object;
  return { ...actual, apiRequest: jest.fn() };
});

const request = jest.mocked(apiRequest);

describe("direct ChatView API wrapper contract", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("requires native non-null data envelopes for history, context and mutations", async () => {
    request.mockResolvedValue({ messages: [], has_more: false });
    await getMessages("friend/one", { beforeId: 90, afterId: 10, limit: 100 });
    expect(request).toHaveBeenLastCalledWith(
      "/chat/messages/friend%2Fone?before_id=90&after_id=10&limit=100",
      expect.objectContaining({ requiredData: true, requiredEnvelope: true }),
    );

    request.mockResolvedValue({ messages: [], has_more: false });
    await getMessageContext("friend/one", 22);
    expect(request).toHaveBeenLastCalledWith(
      "/chat/messages/friend%2Fone/22/context?before=20&after=20",
      expect.objectContaining({ requiredData: true, requiredEnvelope: true }),
    );

    for (const operation of directMutationOperations()) {
      request.mockResolvedValueOnce(message());
      await operation.run();
      expect(request).toHaveBeenLastCalledWith(
        operation.path,
        expect.objectContaining({ requiredData: true, requiredEnvelope: true }),
      );
    }
  });

  it("rejects a naked object or missing data when the direct endpoint requires data", () => {
    for (const payload of [message(), { code: 200, message: "ok" }, { data: null }]) {
      expect(() => decodeSuccessfulPayload(payload, 200, true, true)).toThrow(APIError);
    }
    expect(decodeSuccessfulPayload({ data: message() }, 200, true, true)).toEqual(message());
  });

  it("encodes the read path but keeps its native optional receipt envelope", async () => {
    request.mockResolvedValueOnce(null);
    await expect(
      markDirectMessagesRead("friend/one", { throughMessageId: 42 }),
    ).resolves.toBeNull();
    expect(request).toHaveBeenCalledWith(
      "/chat/messages/friend%2Fone/read",
      expect.objectContaining({
        method: "POST",
        requiredEnvelope: true,
        body: expect.objectContaining({
          through_message_id: 42,
          idempotency_key: expect.any(String),
        }),
      }),
    );
    expect(request.mock.calls[0]?.[1]).not.toHaveProperty("requiredData");
  });

  it("keeps mutation retry identity in the request contract", async () => {
    request.mockResolvedValue(message());
    await sendTextMessage("friend-a", "hello", { clientMessageId: "client-text" });
    expect(request).toHaveBeenLastCalledWith(
      "/chat/messages/text",
      expect.objectContaining({
        body: expect.objectContaining({ client_message_id: "client-text" }),
      }),
    );

    await sendDirectGiftMessage("friend-a", "gift-a", "gift-key");
    expect(request).toHaveBeenLastCalledWith(
      "/chat/messages/gift",
      expect.objectContaining({
        headers: { "Idempotency-Key": "gift-key" },
        body: expect.objectContaining({ idempotency_key: "gift-key" }),
      }),
    );
  });
});

function directMutationOperations(): { path: string; run: () => Promise<unknown> }[] {
  return [
    {
      path: "/chat/messages/friend%2Fone/22/recall",
      run: () => recallDirectMessage("friend/one", 22),
    },
    { path: "/chat/messages/text", run: () => sendTextMessage("friend/one", "hello") },
    {
      path: "/chat/messages/sticker",
      run: () => sendDirectStickerMessage("friend/one", "pack-a", "sticker-a"),
    },
    {
      path: "/chat/messages/gift",
      run: () => sendDirectGiftMessage("friend/one", "gift-a", "gift-key"),
    },
    {
      path: "/chat/messages/image",
      run: () =>
        sendDirectImageMessage(
          "friend/one",
          {
            uri: "file:///image.jpg",
            filename: "image.jpg",
            thumbnailUri: "file:///thumb.jpg",
            thumbnailFilename: "thumb.jpg",
          },
          "client-image",
        ),
    },
    {
      path: "/chat/messages/video",
      run: () =>
        sendDirectVideoMessage(
          "friend/one",
          {
            uri: "file:///video.mp4",
            filename: "video.mp4",
            mimeType: "video/mp4",
            thumbnailUri: "file:///thumb.jpg",
            thumbnailFilename: "thumb.jpg",
          },
          "client-video",
        ),
    },
    {
      path: "/chat/messages/voice",
      run: () =>
        sendDirectVoiceMessage("friend/one", {
          uri: "file:///voice.m4a",
          filename: "voice.m4a",
          duration: 2,
        }),
    },
  ];
}

function message() {
  return {
    id: 22,
    sender_id: "owner-a",
    receiver_id: "friend/one",
    msg_type: "text",
    content: "hello",
    timestamp: "2026-08-08T00:00:00Z",
    version: 1,
  };
}
