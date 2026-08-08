import * as ImageManipulator from "expo-image-manipulator";

import { apiRequest } from "@/api/client";
import {
  backgroundImageCacheKey,
  cacheUploadedBackgroundImage,
  deleteChatBackground,
  getChatBackgrounds,
  removeCachedBackgroundImage,
  resolvedBackgroundImageUri,
  uploadChatBackground,
  type ChatBackground,
} from "@/services/chat-appearance/ChatAppearanceService";
import {
  adoptLocalImageFile,
  removeAdoptedImageCacheEntries,
  removeAuthenticatedImageCacheEntries,
} from "@/services/cache/ImageCacheService";

const mockFileSizes = new Map<string, number>();

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, apiRequest: jest.fn() };
});
jest.mock("@/services/cache/ImageCacheService", () => ({
  adoptLocalImageFile: jest.fn(),
  removeAdoptedImageCacheEntries: jest.fn(),
  removeAuthenticatedImageCacheEntries: jest.fn(),
}));
jest.mock("expo-image", () => ({
  Image: { getCachePathAsync: jest.fn() },
}));
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  manipulateAsync: jest.fn(),
}));
jest.mock("expo-file-system", () => ({
  FileMode: { ReadOnly: "r" },
  File: jest.fn().mockImplementation((uri: string) => ({
    uri,
    exists: true,
    size: mockFileSizes.get(uri) ?? 0,
    delete: jest.fn(),
    open: () => ({
      readBytes: () =>
        uri.endsWith(".jpg") ? new Uint8Array([0xff, 0xd8, 0xff]) : new Uint8Array([0, 0, 0]),
      close: jest.fn(),
    }),
  })),
}));

const mockedApiRequest = jest.mocked(apiRequest);
const mockedManipulator = jest.mocked(ImageManipulator.manipulateAsync);

describe("chat background API and image contract", () => {
  const background: ChatBackground = {
    target_type: "dm",
    target_id: "friend/1",
    image_url: "backgrounds/friend.jpg",
    updated_at: "revision 2",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedApiRequest.mockReset();
    mockedManipulator.mockReset();
    mockFileSizes.clear();
  });

  it("loads the strict native envelope and required backgrounds payload", async () => {
    mockedApiRequest.mockResolvedValueOnce({ backgrounds: [background] });

    await expect(getChatBackgrounds()).resolves.toEqual([background]);
    expect(mockedApiRequest).toHaveBeenCalledWith("/chat/backgrounds", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("posts multipart image with the original 90 second timeout", async () => {
    mockFileSizes.set("file:///photo.jpg", 800_000);
    mockedApiRequest.mockResolvedValueOnce({ background });

    const result = await uploadChatBackground("dm", "friend/1", {
      uri: "file:///photo.jpg",
      width: 1_000,
      height: 500,
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
    });

    expect(result).toEqual({
      background,
      preparedUri: "file:///photo.jpg",
    });
    expect(mockedManipulator).not.toHaveBeenCalled();
    expect(mockedApiRequest).toHaveBeenCalledWith(
      "/chat/backgrounds/dm/friend%2F1",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
        timeoutMs: 90_000,
        requiredEnvelope: true,
        transientRetries: false,
      }),
    );
  });

  it("rejects malformed or camel-case background payloads like native Decodable", async () => {
    mockedApiRequest
      .mockResolvedValueOnce({ backgrounds: [background, { ...background, target_id: 7 }] })
      .mockResolvedValueOnce({
        backgrounds: [
          {
            targetType: "dm",
            targetId: "friend/1",
            imageUrl: "backgrounds/friend.jpg",
          },
        ],
      })
      .mockResolvedValueOnce([background]);

    await expect(getChatBackgrounds()).rejects.toMatchObject({ code: "decoding_error" });
    await expect(getChatBackgrounds()).rejects.toMatchObject({ code: "decoding_error" });
    await expect(getChatBackgrounds()).rejects.toMatchObject({ code: "decoding_error" });
  });

  it("rejects a malformed native upload background instead of accepting its fallback", async () => {
    mockFileSizes.set("file:///photo.jpg", 100_000);
    mockedApiRequest.mockResolvedValueOnce({
      background: { ...background, image_url: 7 },
      image_url: "/backgrounds/fallback.jpg",
    });

    await expect(
      uploadChatBackground("dm", "friend/1", {
        uri: "file:///photo.jpg",
        width: 400,
        height: 400,
        mimeType: "image/jpeg",
        fileName: "photo.jpg",
      }),
    ).rejects.toMatchObject({ code: "decoding_error" });
  });

  it("uses the native resize and JPEG quality ladder until the 900 KB gate passes", async () => {
    mockFileSizes.set("file:///large.heic", 4_000_000);
    mockFileSizes.set("file:///q72.jpg", 950_000);
    mockFileSizes.set("file:///q65.jpg", 880_000);
    mockedManipulator
      .mockResolvedValueOnce({ uri: "file:///q72.jpg", width: 1_280, height: 960 })
      .mockResolvedValueOnce({ uri: "file:///q65.jpg", width: 1_280, height: 960 });
    mockedApiRequest.mockResolvedValueOnce({ image_url: "/backgrounds/new.jpg" });

    const result = await uploadChatBackground("group", "42", {
      uri: "file:///large.heic",
      width: 4_000,
      height: 3_000,
      mimeType: "image/heic",
      fileName: "large.heic",
    });

    expect(mockedManipulator).toHaveBeenNthCalledWith(
      1,
      "file:///large.heic",
      [{ resize: { width: 1_280 } }],
      { compress: 0.72, format: "jpeg" },
    );
    expect(mockedManipulator).toHaveBeenNthCalledWith(
      2,
      "file:///large.heic",
      [{ resize: { width: 1_280 } }],
      { compress: 0.65, format: "jpeg" },
    );
    expect(result.preparedUri).toBe("file:///q65.jpg");
    expect(result.background).toEqual(
      expect.objectContaining({
        target_type: "group",
        target_id: "42",
        image_url: "/backgrounds/new.jpg",
      }),
    );
  });

  it("returns a reload signal when a successful upload has no background payload", async () => {
    mockFileSizes.set("file:///photo.jpg", 100_000);
    mockedApiRequest.mockResolvedValueOnce({});

    await expect(
      uploadChatBackground("global", "global", {
        uri: "file:///photo.jpg",
        width: 400,
        height: 400,
        mimeType: "image/jpeg",
        fileName: "photo.jpg",
      }),
    ).resolves.toEqual({ background: null, preparedUri: "file:///photo.jpg" });
  });

  it("deletes the exact encoded native route with a strict envelope", async () => {
    mockedApiRequest.mockResolvedValueOnce(undefined);

    await deleteChatBackground("dm", "friend/1");

    expect(mockedApiRequest).toHaveBeenCalledWith("/chat/backgrounds/dm/friend%2F1", {
      method: "DELETE",
      requiredEnvelope: true,
      transientRetries: false,
    });
  });

  it("versions image identity and adopts or invalidates every cache layer", async () => {
    const cacheKey = backgroundImageCacheKey(background);
    expect(cacheKey).toBe("/api/v1/backgrounds/friend.jpg?bg_updated_at=revision%202");
    expect(resolvedBackgroundImageUri(background)).toBe(
      "http://localhost:8000/api/v1/backgrounds/friend.jpg",
    );

    await cacheUploadedBackgroundImage(background, "file:///prepared.jpg");
    expect(adoptLocalImageFile).toHaveBeenCalledWith("file:///prepared.jpg", [cacheKey]);

    await removeCachedBackgroundImage(background);
    expect(removeAdoptedImageCacheEntries).toHaveBeenCalledWith([cacheKey]);
    expect(removeAuthenticatedImageCacheEntries).toHaveBeenCalledWith([cacheKey]);
  });
});
