import fs from "node:fs";
import path from "node:path";

import {
  sendDirectImageMessage,
  sendDirectVideoMessage,
  sendGroupImageMessage,
  sendGroupVideoMessage,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  chatImageThumbnailSize,
  chatVideoThumbnailPath,
  chatVideoThumbnailSize,
} from "@/components/messages/chatMediaLayout";
import {
  predictedVideoTranslation,
  resolveChatVideoPlaybackUrl,
  shouldDismissVideo,
  videoBackgroundOpacity,
  videoDismissScale,
} from "@/components/media/videoPlayerMath";
import { chatImagePreparationPolicy } from "@/services/messages/ChatImageService";
import {
  chatVideoMimeType,
  chatVideoPreparationPolicy,
  chatVideoThumbnailFilename,
} from "@/services/messages/chatVideoPolicy";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client") as object;
  return { ...actual, apiRequest: jest.fn() };
});

const request = jest.mocked(apiRequest);

describe("native chat image contracts", () => {
  beforeEach(() => request.mockReset());

  it("uses the original landscape, portrait and square footprints", () => {
    expect(chatImageThumbnailSize()).toEqual({ width: 160, height: 110 });
    expect(chatImageThumbnailSize({ width: 849, height: 1_000 })).toEqual({
      width: 110,
      height: 156,
    });
    expect(chatImageThumbnailSize({ width: 850, height: 1_000 })).toEqual({
      width: 140,
      height: 140,
    });
    expect(chatImageThumbnailSize({ width: 1_180, height: 1_000 })).toEqual({
      width: 140,
      height: 140,
    });
    expect(chatImageThumbnailSize({ width: 1_181, height: 1_000 })).toEqual({
      width: 160,
      height: 110,
    });
  });

  it("clips chat images once without drawing a visible frame or double-rounded seam", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/messages/ChatImageBubble.tsx"),
      "utf8",
    );
    const styles = source.slice(source.indexOf("const styles = StyleSheet.create"));
    expect(styles).toContain('frame: {\n    overflow: "hidden",\n    borderRadius: 10,');
    expect(styles).toContain('image: { backgroundColor: "transparent" }');
    expect(styles).not.toContain("borderWidth");
    expect(styles).not.toContain("borderColor");
    expect(styles).not.toContain("image: { borderRadius");
  });

  it("keeps soft compression targets without imposing an upload limit", () => {
    expect(chatImagePreparationPolicy.originalTargetBytes).toBe(2_000_000);
    expect(chatImagePreparationPolicy.originalAttempts[0]).toEqual({
      dimension: 1200,
      quality: 0.7,
    });
    expect(chatImagePreparationPolicy.thumbnailTargetBytes).toBe(140_000);
    expect(chatImagePreparationPolicy.thumbnailAttempts[0]).toEqual({
      dimension: 360,
      quality: 0.58,
    });
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/services/messages/ChatImageService.ts"),
      "utf8",
    );
    expect(source).toContain("Source size never blocks the user from sending");
    expect(source).not.toContain("图片压缩后仍超过");
  });

  it("uploads direct image and thumbnail with the exact native route and timeout", async () => {
    request.mockResolvedValueOnce({
      id: 9,
      sender_id: "me",
      receiver_id: "friend",
      msg_type: "image",
      content: "/images/full.jpg",
      client_message_id: "client-direct",
    });
    await sendDirectImageMessage("friend", imageInput(), "client-direct");

    expect(request).toHaveBeenCalledWith("/chat/messages/image", {
      method: "POST",
      headers: { "Idempotency-Key": "client-direct" },
      body: expect.any(FormData),
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 180_000,
    });
    const form = request.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("receiver_id")).toBe("friend");
    expect(form.get("client_message_id")).toBe("client-direct");
    expect(form.has("image")).toBe(true);
    expect(form.has("thumbnail")).toBe(true);
    const source = fs.readFileSync(path.join(process.cwd(), "src/api/bwchat.ts"), "utf8");
    expect(source).toContain('appendExpoFilePart(form, "image"');
    expect(source).toContain("bytes: () => file.bytes()");
    expect(source).not.toContain('form.append("image", {\n    uri: image.uri');
  });

  it("uploads group image and thumbnail without inventing a receiver field", async () => {
    request.mockResolvedValueOnce({
      id: 10,
      group_id: 31,
      sender_id: "me",
      msg_type: "image",
      content: "/groups/full.jpg",
    });
    await sendGroupImageMessage(31, imageInput(), "client-group");

    expect(request).toHaveBeenCalledWith("/groups/31/messages/image", {
      method: "POST",
      headers: { "Idempotency-Key": "client-group" },
      body: expect.any(FormData),
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 180_000,
    });
    const form = request.mock.calls[0]?.[1]?.body as FormData;
    expect(form.has("receiver_id")).toBe(false);
    expect(form.get("client_message_id")).toBe("client-group");
    expect(form.has("image")).toBe(true);
    expect(form.has("thumbnail")).toBe(true);
  });

  it("does not mark a local image as sent without an authoritative server message", async () => {
    request.mockResolvedValueOnce({ id: 0, msg_type: "image", content: "" });
    await expect(
      sendDirectImageMessage("friend", imageInput(), "client-unconfirmed"),
    ).rejects.toMatchObject({
      status: 502,
      code: "unconfirmed_media_message",
    });

    request.mockResolvedValueOnce({ id: 12, group_id: 31, msg_type: "text", content: "ok" });
    await expect(
      sendGroupImageMessage(31, imageInput(), "group-unconfirmed"),
    ).rejects.toMatchObject({
      status: 502,
      code: "unconfirmed_media_message",
    });
  });

  it("keeps the original landscape, portrait and square video footprints", () => {
    expect(chatVideoThumbnailSize()).toEqual({ width: 200, height: 140 });
    expect(chatVideoThumbnailSize({ width: 899, height: 1_000 })).toEqual({
      width: 112,
      height: 160,
    });
    expect(chatVideoThumbnailSize({ width: 900, height: 1_000 })).toEqual({
      width: 150,
      height: 150,
    });
    expect(chatVideoThumbnailSize({ width: 1_100, height: 1_000 })).toEqual({
      width: 150,
      height: 150,
    });
    expect(chatVideoThumbnailSize({ width: 1_101, height: 1_000 })).toEqual({
      width: 200,
      height: 140,
    });
  });

  it("derives the public thumbnail/playback URL and exact video preparation policy", () => {
    expect(chatVideoThumbnailPath("/api/v1/images/u1/movie.mp4")).toBe(
      "/api/v1/public/images/u1/movie_thumb.jpg",
    );
    expect(chatVideoThumbnailPath("/media/movie.mov?version=2")).toBe("/media/movie_thumb.jpg");
    expect(
      resolveChatVideoPlaybackUrl("/api/v1/images/u1/movie.mp4", "https://example.com/api/v1"),
    ).toBe("https://example.com/api/v1/public/images/u1/movie.mp4");
    expect(chatVideoPreparationPolicy).toMatchObject({
      thumbnailMaximumSize: 480,
      thumbnailQuality: 0.62,
      uploadTimeoutMilliseconds: 600_000,
    });
    expect(chatVideoThumbnailFilename("folder/movie.mov")).toBe("movie_thumb.jpg");
    expect(chatVideoMimeType("movie.mov")).toBe("video/quicktime");
    expect(chatVideoMimeType("movie.m4v")).toBe("video/x-m4v");
    expect(chatVideoMimeType("movie.mp4")).toBe("video/mp4");
  });

  it("matches the original video pull-dismiss and scaling math", () => {
    expect(videoBackgroundOpacity(0)).toBe(1);
    expect(videoBackgroundOpacity(320)).toBeCloseTo(0.1);
    expect(videoBackgroundOpacity(3_200)).toBeCloseTo(0.1);
    expect(videoDismissScale(7.99)).toBe(1);
    expect(videoDismissScale(900)).toBe(0.55);
    expect(predictedVideoTranslation(30, 2_100)).toBe(450);
    expect(
      shouldDismissVideo({ translationX: 0, translationY: 110, predictedTranslationY: 450 }),
    ).toBe(false);
    expect(
      shouldDismissVideo({ translationX: 0, translationY: 110.1, predictedTranslationY: 0 }),
    ).toBe(true);
    expect(
      shouldDismissVideo({ translationX: 20, translationY: 30, predictedTranslationY: 450.1 }),
    ).toBe(true);
    expect(
      shouldDismissVideo({ translationX: 40, translationY: 30, predictedTranslationY: 900 }),
    ).toBe(false);
  });

  it("uploads direct video and thumbnail with the native 600-second contract", async () => {
    request.mockResolvedValueOnce({
      id: 11,
      sender_id: "me",
      receiver_id: "friend",
      msg_type: "video",
      content: "/videos/full.mp4",
    });
    await sendDirectVideoMessage("friend", videoInput(), "client-video-direct");
    expect(request).toHaveBeenCalledWith("/chat/messages/video", {
      method: "POST",
      headers: { "Idempotency-Key": "client-video-direct" },
      body: expect.any(FormData),
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 600_000,
    });
    const form = request.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("receiver_id")).toBe("friend");
    expect(form.get("client_message_id")).toBe("client-video-direct");
    expect(form.has("video")).toBe(true);
    expect(form.has("thumbnail")).toBe(true);
  });

  it("uploads group video without a receiver field", async () => {
    request.mockResolvedValueOnce({
      id: 12,
      group_id: 31,
      sender_id: "me",
      msg_type: "video",
      content: "/videos/group.mp4",
    });
    await sendGroupVideoMessage(31, videoInput(), "client-video-group");
    expect(request).toHaveBeenCalledWith("/groups/31/messages/video", {
      method: "POST",
      headers: { "Idempotency-Key": "client-video-group" },
      body: expect.any(FormData),
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 600_000,
    });
    const form = request.mock.calls[0]?.[1]?.body as FormData;
    expect(form.has("receiver_id")).toBe(false);
    expect(form.get("client_message_id")).toBe("client-video-group");
    expect(form.has("video")).toBe(true);
    expect(form.has("thumbnail")).toBe(true);
  });

  it("does not confirm a video bubble without a canonical server record", async () => {
    request.mockResolvedValueOnce({ id: 0, msg_type: "video", content: "" });
    await expect(
      sendDirectVideoMessage("friend", videoInput(), "client-video-unconfirmed"),
    ).rejects.toMatchObject({ code: "unconfirmed_media_message", status: 502 });

    request.mockResolvedValueOnce({
      id: 15,
      group_id: 31,
      msg_type: "text",
      content: "not-video",
    });
    await expect(
      sendGroupVideoMessage(31, videoInput(), "group-video-unconfirmed"),
    ).rejects.toMatchObject({ code: "unconfirmed_media_message", status: 502 });
  });

  it("retries temporarily unavailable chat image and video thumbnails in place", () => {
    const imageBubble = fs.readFileSync(
      path.join(process.cwd(), "src/components/messages/ChatImageBubble.tsx"),
      "utf8",
    );
    const videoBubble = fs.readFileSync(
      path.join(process.cwd(), "src/components/messages/ChatVideoBubble.tsx"),
      "utf8",
    );
    for (const source of [imageBubble, videoBubble]) {
      expect(source).toContain("chatMediaAvailabilityRetryPolicy.intervalMilliseconds");
      expect(source).toContain("chatMediaAvailabilityRetryPolicy.maximumRetries");
    }
  });
});

function imageInput() {
  return {
    uri: "file:///full.jpg",
    filename: "image.jpg",
    thumbnailUri: "file:///thumb.jpg",
    thumbnailFilename: "image_thumb.jpg",
  };
}

function videoInput() {
  return {
    uri: "file:///full.mov",
    filename: "movie.mov",
    mimeType: "video/quicktime",
    thumbnailUri: "file:///thumb.jpg",
    thumbnailFilename: "movie_thumb.jpg",
  };
}
