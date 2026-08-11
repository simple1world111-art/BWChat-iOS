import {
  canPublishMoment,
  createMomentPolicy,
  momentContentLength,
  truncateMomentContent,
  validateMomentSelection,
} from "@/services/moments/CreateMomentPolicy";
import {
  assertMomentUploadOwner,
  decodeMomentBackgroundUploadResponse,
  momentBackgroundUploadRuntimeKey,
  MomentUploadConfirmationUnknownError,
  MomentUploadOwnerChangedError,
  momentMultipartBoundary,
  momentMultipartFields,
  momentMultipartTextField,
  momentUploadRequestHeaders,
  momentUploadTimeoutMilliseconds,
} from "@/services/moments/MomentBackgroundUpload";
import { mergeMomentFeed } from "@/services/moments/MomentFeedRepository";
import {
  momentMediaPreparationPolicy,
  momentVideoFilename,
  momentVideoMimeType,
  shouldPrepareImage,
} from "@/services/moments/MomentMediaPreparation";
import {
  createOptimisticMoment,
  momentUploadConfirmationCandidate,
  momentRetryDelayMilliseconds,
  momentUploadOwnerChangedPatch,
  momentUploadRuntimeKey,
  restoredMomentUploadState,
} from "@/services/moments/MomentUploadQueue";
import type { Moment, MomentUploadAsset } from "@/models";

jest.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: "jpeg" },
}));

jest.mock("expo-video", () => ({ createVideoPlayer: jest.fn() }));

jest.mock("expo-file-system", () => ({
  Directory: class Directory {
    uri = "file:///documents/mock";
    exists = false;
    list() {
      return [];
    }
  },
  File: class File {},
  FileMode: { ReadOnly: "r", Truncate: "wt" },
  Paths: { cache: "file:///cache", document: "file:///documents" },
  UploadType: { BINARY_CONTENT: 0 },
}));

describe("CreateMoment native parity", () => {
  it("counts and truncates Swift-style extended grapheme clusters at 200", () => {
    expect(momentContentLength("👨‍👩‍👧‍👦")).toBe(1);
    const source = `${"动态".repeat(100)}额外`;
    expect(momentContentLength(truncateMomentContent(source))).toBe(200);
    expect(truncateMomentContent(source)).toBe("动态".repeat(100));
  });

  it("enforces exactly nine images or one video and refuses mixed media", () => {
    const images = Array.from({ length: createMomentPolicy.maximumImageCount }, (_, index) =>
      asset("image", `${index}.jpg`),
    );
    expect(() => validateMomentSelection(images)).not.toThrow();
    expect(() => validateMomentSelection([...images, asset("image", "10.jpg")])).toThrow(
      "too-many-images",
    );
    expect(() => validateMomentSelection([asset("video", "one.mp4")])).not.toThrow();
    expect(() =>
      validateMomentSelection([asset("video", "one.mp4"), asset("video", "two.mp4")]),
    ).toThrow("too-many-videos");
    expect(() =>
      validateMomentSelection([asset("image", "one.jpg"), asset("video", "one.mp4")]),
    ).toThrow("mixed-media");
    expect(canPublishMoment("  ", [], false)).toBe(false);
    expect(canPublishMoment("文字", [], false)).toBe(true);
    expect(canPublishMoment("", [asset("image", "one.jpg")], false)).toBe(true);
    expect(canPublishMoment("文字", [], true)).toBe(false);
  });

  it("keeps native image bounds and video filename/MIME rules", () => {
    expect(momentMediaPreparationPolicy).toMatchObject({
      uploadMaximumDimension: 1_200,
      uploadJPEGQuality: 0.7,
      uploadTargetBytes: 2_000_000,
      imagePreviewMaximumDimension: 360,
      videoPreviewMaximumDimension: 320,
      previewJPEGQuality: 0.82,
    });
    expect(
      shouldPrepareImage({
        fileSize: 1_500_000,
        width: 1_200,
        height: 900,
        mimeType: "image/jpeg",
      }),
    ).toBe(false);
    expect(
      shouldPrepareImage({
        fileSize: 2_000_001,
        width: 1_200,
        height: 900,
        mimeType: "image/jpeg",
      }),
    ).toBe(true);
    expect(
      shouldPrepareImage({
        fileSize: 1_500_000,
        width: 0,
        height: 0,
        mimeType: "image/jpeg",
      }),
    ).toBe(true);
    expect(momentVideoFilename("clip.MOV")).toMatch(/^moment_video_\d+_0\.mov$/u);
    expect(momentVideoFilename("file:///var/mobile/clip")).toMatch(/^moment_video_\d+_0\.mp4$/u);
    expect(momentVideoFilename("file:///var/mobile/clip.MOV?token=one")).toMatch(
      /^moment_video_\d+_0\.mov$/u,
    );
    expect(momentVideoFilename("clip.bad/ext")).toMatch(/^moment_video_\d+_0\.mp4$/u);
    expect(momentVideoMimeType("clip.mov")).toBe("video/quicktime");
    expect(momentVideoMimeType("clip.m4v")).toBe("video/x-m4v");
    expect(momentVideoMimeType("clip.mp4")).toBe("video/mp4");
    expect(momentVideoMimeType("clip.webm")).toBe("video/mp4");
  });

  it("builds the exact multipart field framing and stable client boundary", () => {
    const requestId = "aabbccdd-eeff-0011-2233-445566778899";
    expect(momentMultipartBoundary(requestId)).toBe(
      "BWChatMoment-aabbccddeeff00112233445566778899",
    );
    expect(momentMultipartTextField("boundary", "client_request_id", requestId)).toBe(
      `--boundary\r\nContent-Disposition: form-data; name="client_request_id"\r\n\r\n${requestId}\r\n`,
    );
    expect(
      momentMultipartFields({
        clientRequestId: requestId,
        ownerId: "owner-a",
        content: "旅行",
        media: [asset("image", "one.jpg")],
        unlockPriceGoldCoins: 50,
      }),
    ).toEqual([
      { name: "content", value: "旅行" },
      { name: "client_request_id", value: requestId },
      { name: "unlock_price_gold_coins", value: "50" },
    ]);
    expect(
      momentMultipartFields({
        clientRequestId: requestId,
        ownerId: "owner-a",
        content: "纯文字",
        media: [],
        unlockPriceGoldCoins: 50,
      }),
    ).toEqual([
      { name: "content", value: "纯文字" },
      { name: "client_request_id", value: requestId },
    ]);
  });

  it("sends the native idempotency header beside the matching multipart request id", () => {
    const requestId = "aabbccdd-eeff-0011-2233-445566778899";
    expect(momentUploadRequestHeaders(requestId, "token-a", "zh-Hans")).toEqual({
      Accept: "application/json",
      "Accept-Language": "zh-Hans",
      Authorization: "Bearer token-a",
      "Content-Type": "multipart/form-data; boundary=BWChatMoment-aabbccddeeff00112233445566778899",
      "Idempotency-Key": requestId,
    });
  });

  it("requires the native response wrapper while separating missing data from unknown confirmation", () => {
    const confirmed = moment(31, "request-31");
    expect(
      decodeMomentBackgroundUploadResponse(
        { code: 7, message: "ignored when data exists", data: confirmed },
        200,
      ),
    ).toEqual(confirmed);
    expect(() => decodeMomentBackgroundUploadResponse(confirmed, 200)).toThrow(
      "api.invalidResponse",
    );
    expect(() =>
      decodeMomentBackgroundUploadResponse({ code: 0, message: "", data: null }, 200),
    ).toThrow("api.invalidResponse");
    expect(() => decodeMomentBackgroundUploadResponse("not-json", 200)).toThrow(
      MomentUploadConfirmationUnknownError,
    );
    expect(() => decodeMomentBackgroundUploadResponse({ code: 0, data: { id: 31 } }, 200)).toThrow(
      MomentUploadConfirmationUnknownError,
    );
  });

  it("keeps optimistic moments pending when the server confirms the wrong owner or media", () => {
    const confirmed = moment(31, "request-31");
    expect(() =>
      decodeMomentBackgroundUploadResponse({ code: 0, data: confirmed }, 200, {
        ownerId: "owner-b",
        clientRequestId: "request-31",
        expectedMediaCount: confirmed.media.length,
      }),
    ).toThrow(MomentUploadConfirmationUnknownError);
    expect(() =>
      decodeMomentBackgroundUploadResponse({ code: 0, data: confirmed }, 200, {
        ownerId: confirmed.author.user_id,
        clientRequestId: "request-31",
        expectedMediaCount: confirmed.media.length + 1,
      }),
    ).toThrow(MomentUploadConfirmationUnknownError);
  });

  it("retains a partial server moment id for safe feed reconciliation", () => {
    try {
      decodeMomentBackgroundUploadResponse({ code: 0, data: { id: 31 } }, 200);
      throw new Error("expected confirmation unknown");
    } catch (error) {
      expect(error).toBeInstanceOf(MomentUploadConfirmationUnknownError);
      expect((error as MomentUploadConfirmationUnknownError).serverMomentId).toBe(31);
    }
  });

  it("matches a unique recent server row when the feed omits client_request_id", () => {
    const requestId = "fallback-request";
    const optimistic = createOptimisticMoment({
      owner: { user_id: "owner", nickname: "我", avatar_url: "" },
      clientRequestId: requestId,
      content: "旅行",
      media: [asset("image", "one.jpg")],
      createdAt: "2026-08-11T10:00:00Z",
    });
    const job = {
      id: requestId,
      owner_id: "owner",
      content: "旅行",
      media: [asset("image", "one.jpg")],
      temp_moment: optimistic,
      state: "confirmation_unknown" as const,
      attempt_count: 1,
      upload_timeout_ms: 180_000 as const,
    };
    const confirmed = {
      ...moment(31, requestId),
      content: "旅行",
      media: [
        {
          id: "remote-one",
          type: "image" as const,
          url: "/media/one.jpg",
          is_locked: false,
        },
      ],
      client_request_id: undefined,
      created_at: "2026-08-11T10:00:03Z",
    };

    expect(momentUploadConfirmationCandidate(job, [confirmed])).toEqual(confirmed);
    expect(momentUploadConfirmationCandidate(job, [confirmed, { ...confirmed, id: 32 }])).toBe(
      undefined,
    );
  });

  it("parks an old-owner upload before it can use the current account token", () => {
    expect(() => assertMomentUploadOwner("owner-a", "owner-a")).not.toThrow();
    expect(() => assertMomentUploadOwner("owner-a", "owner-b")).toThrow(
      MomentUploadOwnerChangedError,
    );
    expect(() => assertMomentUploadOwner("owner-a", null)).toThrow(MomentUploadOwnerChangedError);
    expect(momentUploadOwnerChangedPatch(3)).toEqual({
      state: "queued",
      attempt_count: 3,
      uploaded_bytes: undefined,
      expected_bytes: undefined,
      last_error: undefined,
    });
    expect(momentUploadRuntimeKey(" owner-a ", "same-request")).toBe("owner-a\u0000same-request");
    expect(momentUploadRuntimeKey("owner-b", "same-request")).not.toBe(
      momentUploadRuntimeKey("owner-a", "same-request"),
    );
    expect(momentBackgroundUploadRuntimeKey("owner-a", "same-request")).toBe(
      momentUploadRuntimeKey("owner-a", "same-request"),
    );
  });

  it("derives native upload timeout from selected media, not stale draft directory files", () => {
    expect(momentUploadTimeoutMilliseconds(false)).toBe(180_000);
    expect(momentUploadTimeoutMilliseconds(true)).toBe(600_000);
  });

  it("keeps native retry timing and restores interrupted commits as confirmation unknown", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(momentRetryDelayMilliseconds)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
    expect(restoredMomentUploadState("preparing")).toBe("queued");
    expect(restoredMomentUploadState("uploading")).toBe("confirmation_unknown");
    expect(restoredMomentUploadState("committing")).toBe("confirmation_unknown");
    expect(restoredMomentUploadState("retry_waiting")).toBe("retry_waiting");
  });

  it("uses durable first-frame previews for optimistic video and replaces it by request id", () => {
    const requestId = "aabbccdd-eeff-0011-2233-445566778899";
    const optimistic = createOptimisticMoment({
      owner: { user_id: "owner", nickname: "我", avatar_url: "" },
      clientRequestId: requestId,
      content: "视频",
      media: [
        {
          ...asset("video", "one.mp4"),
          uri: "file:///documents/video.mp4",
          preview_uri: "file:///documents/preview_video.jpg",
        },
      ],
    });
    expect(optimistic.media[0]).toMatchObject({
      url: "file:///documents/video.mp4",
      thumbnail_url: "file:///documents/preview_video.jpg",
    });
    const confirmed = moment(31, requestId);
    expect(mergeMomentFeed([optimistic], [confirmed])).toEqual([confirmed]);
  });
});

function asset(kind: "image" | "video", filename: string): MomentUploadAsset {
  return {
    kind,
    uri: `file:///documents/${filename}`,
    filename,
    mime_type: kind === "image" ? "image/jpeg" : "video/mp4",
  };
}

function moment(id: number, clientRequestId: string): Moment {
  return {
    id,
    author: { user_id: "owner", nickname: "我", avatar_url: "" },
    content: "已发布",
    images: [],
    media: [],
    is_unlocked: true,
    created_at: "2026-08-08T00:00:00Z",
    likes: [],
    comments: [],
    liked_by_me: false,
    client_request_id: clientRequestId,
  };
}
