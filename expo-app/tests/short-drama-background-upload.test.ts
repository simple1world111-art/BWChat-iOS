import { APIError } from "@/api/client";
import {
  shortDramaEpisodeIdempotencyKey,
  shortDramaEpisodeUploadPath,
  ShortDramaUploadConfirmationUnknownError,
  ShortDramaUploadOwnerChangedError,
  shortDramaUploadRetryDelayMilliseconds,
  uploadShortDramaEpisodeDurably,
} from "@/services/short-drama/ShortDramaBackgroundUpload";
import { readCachedUser } from "@/storage/authStorage";
import { readAccessToken } from "@/storage/tokenStorage";
import {
  enqueueNativeShortDramaEpisodeUpload,
  getNativeShortDramaEpisodeUpload,
  markNativeShortDramaUploadConfirmationUnknown,
  removeNativeShortDramaEpisodeUpload,
  type NativeShortDramaUploadRecord,
} from "../modules/bwchat-background-upload/src";

jest.mock("@/api/bwchat", () => ({
  uploadShortDramaEpisode: jest.fn(),
}));

jest.mock("@/api/client", () => {
  const actual = jest.requireActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, refreshAccessToken: jest.fn() };
});

jest.mock("@/storage/authStorage", () => ({ readCachedUser: jest.fn() }));
jest.mock("@/storage/tokenStorage", () => ({ readAccessToken: jest.fn() }));

jest.mock("../modules/bwchat-background-upload/src", () => ({
  enqueueNativeShortDramaEpisodeUpload: jest.fn(),
  getNativeShortDramaEpisodeUpload: jest.fn(),
  hasNativeShortDramaBackgroundUpload: jest.fn(() => true),
  markNativeShortDramaUploadConfirmationUnknown: jest.fn(),
  removeNativeShortDramaEpisodeUpload: jest.fn(),
}));

const cachedUser = jest.mocked(readCachedUser);
const accessToken = jest.mocked(readAccessToken);
const enqueueNative = jest.mocked(enqueueNativeShortDramaEpisodeUpload);
const getNative = jest.mocked(getNativeShortDramaEpisodeUpload);
const markUnknown = jest.mocked(markNativeShortDramaUploadConfirmationUnknown);
const removeNative = jest.mocked(removeNativeShortDramaEpisodeUpload);

describe("short-drama native background upload transport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cachedUser.mockResolvedValue({ user_id: "owner" } as never);
    accessToken.mockResolvedValue("token");
    getNative.mockResolvedValue(null);
    markUnknown.mockResolvedValue(null);
    removeNative.mockResolvedValue(undefined);
  });

  it("locks native path encoding, stable idempotency identity and bounded retry delays", () => {
    expect(shortDramaEpisodeUploadPath("series/a+b&c")).toBe(
      "/short-drama/series/series%2Fa+b&c/episodes",
    );
    expect(shortDramaEpisodeIdempotencyKey("draft\r\nkey")).toBe("draft__key");
    expect([0, 1, 5, 20].map(shortDramaUploadRetryDelayMilliseconds)).toEqual([
      1_000, 2_000, 32_000, 300_000,
    ]);
  });

  it("consumes a kill-restored successful native response without sending a duplicate request", async () => {
    getNative.mockResolvedValue(
      record("succeeded", {
        http_status: 200,
        response_body_base64: base64(
          JSON.stringify({
            code: 0,
            data: { video: { id: "video", play_url: "/video.mp4" } },
          }),
        ),
      }),
    );

    await expect(uploadShortDramaEpisodeDurably(input())).resolves.toMatchObject({
      video: { id: "video", play_url: "/video.mp4" },
    });
    expect(enqueueNative).not.toHaveBeenCalled();
    expect(removeNative).toHaveBeenCalledWith("owner", "draft", "episode");
  });

  it("marks a 2xx malformed wrapper confirmation-unknown and preserves its durable task", async () => {
    getNative.mockResolvedValue(
      record("succeeded", {
        http_status: 200,
        response_body_base64: base64("not-json"),
      }),
    );

    await expect(uploadShortDramaEpisodeDurably(input())).rejects.toBeInstanceOf(
      ShortDramaUploadConfirmationUnknownError,
    );
    expect(markUnknown).toHaveBeenCalledWith("owner", "draft", "episode", "response-decode-failed");
    expect(removeNative).not.toHaveBeenCalled();
  });

  it("passes the exact route/auth/multipart metadata to a new native task", async () => {
    enqueueNative.mockResolvedValue(
      record("retry_waiting", {
        http_status: 503,
        last_error_code: "http:503",
      }),
    );

    await expect(uploadShortDramaEpisodeDurably(input())).rejects.toMatchObject({
      status: 503,
    });
    expect(enqueueNative).toHaveBeenCalledWith({
      owner_id: "owner",
      job_id: "draft",
      episode_id: "episode",
      generation: 3,
      request_url: "http://localhost:8000/api/v1/short-drama/series/series/episodes",
      authorization: "Bearer token",
      title: "第1集",
      intro: "简介",
      episode_number: 1,
      unlock_price_gold_coins: 100,
      video_uri: "file:///video.mov",
      video_filename: "video.mov",
      video_mime_type: "video/quicktime",
      cover_uri: "file:///cover.jpg",
      cover_filename: "cover.jpg",
    });
  });

  it("parks the old owner's JS consumer without cancelling its native system task", async () => {
    cachedUser.mockResolvedValue({ user_id: "other" } as never);

    await expect(uploadShortDramaEpisodeDurably(input())).rejects.toBeInstanceOf(
      ShortDramaUploadOwnerChangedError,
    );
    expect(getNative).not.toHaveBeenCalled();
    expect(enqueueNative).not.toHaveBeenCalled();
  });

  it("maps native retry-waiting to the shared transient API error contract", async () => {
    getNative.mockResolvedValue(record("uploading"));
    getNative.mockResolvedValueOnce(record("retry_waiting", { last_error_code: "offline" }));
    enqueueNative.mockResolvedValue(record("retry_waiting", { last_error_code: "offline" }));

    await expect(uploadShortDramaEpisodeDurably(input())).rejects.toBeInstanceOf(APIError);
  });
});

function input() {
  return {
    ownerId: "owner",
    jobId: "draft",
    generation: 3,
    seriesId: "series",
    episodeId: "episode",
    title: "第1集",
    intro: "简介",
    episodeNumber: 1,
    unlockPriceGoldCoins: 100,
    videoUri: "file:///video.mov",
    videoFilename: "video.mov",
    videoMimeType: "video/quicktime",
    coverUri: "file:///cover.jpg",
    coverFilename: "cover.jpg",
  };
}

function record(
  state: NativeShortDramaUploadRecord["state"],
  patch: Partial<NativeShortDramaUploadRecord> = {},
): NativeShortDramaUploadRecord {
  return {
    id: "native-record",
    owner_id: "owner",
    job_id: "draft",
    episode_id: "episode",
    generation: 3,
    state,
    uploaded_bytes: 10,
    expected_bytes: 10,
    updated_at: 1,
    ...patch,
  };
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
