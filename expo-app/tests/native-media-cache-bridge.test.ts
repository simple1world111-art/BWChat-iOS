import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  adoptLocalMediaFile,
  cancelScheduledMediaCache,
  clearAllMediaCache,
  clearMediaCacheForAccount,
  getCachedMediaUri,
  mediaCacheUsageBytes,
  scheduleMediaCache,
} from "@/services/cache/MediaCacheService";
import { prepareVideoAuthorizationHeaders } from "@/services/media/VideoPlaybackSource";

const mockNativeGet = jest.fn<Promise<string | null>, [string, string]>();
const mockNativeStart = jest.fn<Promise<boolean>, [Record<string, unknown>]>();
const mockNativeAdopt = jest.fn<Promise<string | null>, [Record<string, unknown>]>();
const mockNativeUsage = jest.fn<Promise<number>, [string]>();
const mockNativeClearAccount = jest.fn<Promise<void>, [string]>();
const mockNativeClearAll = jest.fn<Promise<void>, []>();
let mockNativeMediaCacheAvailable = true;

jest.mock("expo-file-system", () => {
  class MockDirectory {
    exists = false;
    uri = "file:///mock-directory";
    create() {
      this.exists = true;
    }
    delete() {
      this.exists = false;
    }
  }
  class MockFile {
    exists: boolean;
    size = 0;
    uri = "file:///mock-file";
    constructor(...parts: unknown[]) {
      this.exists = parts.some((part) => String(part).includes("/tmp/video.mp4"));
    }
    delete() {
      this.exists = false;
    }
  }
  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { availableDiskSpace: 10_000_000_000, cache: "file:///cache" },
  };
});

jest.mock("../modules/bwchat-media-cache/src", () => ({
  adoptNativeLocalMediaFile: (options: Record<string, unknown>) => mockNativeAdopt(options),
  clearAllNativeMediaCache: () => mockNativeClearAll(),
  clearNativeMediaCacheAccount: (ownerId: string) => mockNativeClearAccount(ownerId),
  getNativeCachedMediaUri: (ownerId: string, mediaId: string) => mockNativeGet(ownerId, mediaId),
  hasNativeMediaCache: () => mockNativeMediaCacheAvailable,
  nativeMediaCacheUsageBytes: (ownerId: string) => mockNativeUsage(ownerId),
  startNativeMediaCache: (options: Record<string, unknown>) => mockNativeStart(options),
}));

jest.mock("@/services/media/VideoPlaybackSource", () => ({
  prepareVideoAuthorizationHeaders: jest.fn(),
}));

const prepareHeaders = jest.mocked(prepareVideoAuthorizationHeaders);

describe("Apple native media cache bridge", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockNativeMediaCacheAvailable = true;
    await AsyncStorage.clear();
    mockNativeGet.mockResolvedValue(null);
    mockNativeStart.mockResolvedValue(true);
    mockNativeAdopt.mockResolvedValue("file:///native/adopted.mp4");
    mockNativeUsage.mockResolvedValue(123);
    mockNativeClearAccount.mockResolvedValue(undefined);
    mockNativeClearAll.mockResolvedValue(undefined);
    prepareHeaders.mockResolvedValue({ Authorization: "Bearer refreshed" });
  });

  afterEach(() => {
    cancelScheduledMediaCache("owner", "video");
    jest.useRealTimers();
  });

  it("starts HLS only after the native five-second delay and forwards refreshed headers", async () => {
    scheduleMediaCache({
      ownerId: "owner",
      mediaId: "video",
      remoteUrl: "https://api.test/private/master.m3u8",
    });
    await jest.advanceTimersByTimeAsync(4_999);
    expect(mockNativeStart).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(prepareHeaders).toHaveBeenCalledWith(
      "https://api.test/private/master.m3u8",
      undefined,
      "auto",
    );
    expect(mockNativeStart).toHaveBeenCalledWith({
      ownerId: "owner",
      mediaId: "video",
      remoteUrl: "https://api.test/private/master.m3u8",
      authorizationHeaders: { Authorization: "Bearer refreshed" },
    });
  });

  it("cancels only the not-yet-started warm-up", async () => {
    scheduleMediaCache({
      ownerId: "owner",
      mediaId: "video",
      remoteUrl: "https://cdn.test/video.mp4",
    });
    cancelScheduledMediaCache("owner", "video");
    await jest.advanceTimersByTimeAsync(5_000);
    expect(mockNativeStart).not.toHaveBeenCalled();
  });

  it("can start an explicitly opened video's persistent warm-up immediately", async () => {
    scheduleMediaCache({
      ownerId: "owner",
      mediaId: "video",
      remoteUrl: "https://cdn.test/video.mp4",
      delayMilliseconds: 0,
    });

    await jest.advanceTimersByTimeAsync(0);

    expect(mockNativeStart).toHaveBeenCalledWith({
      ownerId: "owner",
      mediaId: "video",
      remoteUrl: "https://cdn.test/video.mp4",
      authorizationHeaders: { Authorization: "Bearer refreshed" },
    });
  });

  it("keeps the same media ID isolated by owner when starting native HLS downloads", async () => {
    scheduleMediaCache({
      ownerId: "owner-a",
      mediaId: "short-drama:episode",
      remoteUrl: "https://api.test/private/master.m3u8",
    });
    scheduleMediaCache({
      ownerId: "owner-b",
      mediaId: "short-drama:episode",
      remoteUrl: "https://api.test/private/master.m3u8",
    });

    await jest.advanceTimersByTimeAsync(5_000);

    expect(mockNativeStart).toHaveBeenCalledTimes(2);
    expect(mockNativeStart.mock.calls.map(([options]) => options.ownerId)).toEqual([
      "owner-a",
      "owner-b",
    ]);
    expect(mockNativeStart.mock.calls.map(([options]) => options.mediaId)).toEqual([
      "short-drama:episode",
      "short-drama:episode",
    ]);
  });

  it("uses the intentional Android/web HLS downgrade instead of trying a non-persistent file download", async () => {
    mockNativeMediaCacheAvailable = false;

    const cancel = scheduleMediaCache({
      ownerId: "owner",
      mediaId: "hls-video",
      remoteUrl: "https://cdn.test/master.m3u8",
    });
    await jest.advanceTimersByTimeAsync(5_000);
    cancel();

    expect(mockNativeStart).not.toHaveBeenCalled();
    expect(prepareHeaders).not.toHaveBeenCalled();
  });

  it("prefers an owner-scoped native movpkg hit", async () => {
    mockNativeGet.mockResolvedValue("file:///Application Support/BWChat/Media/offline.movpkg");
    await expect(getCachedMediaUri("owner", "video")).resolves.toBe(
      "file:///Application Support/BWChat/Media/offline.movpkg",
    );
    expect(mockNativeGet).toHaveBeenCalledWith("owner", "video");
  });

  it("adopts uploaded local media without materializing it in JS", async () => {
    await expect(
      adoptLocalMediaFile({
        ownerId: "owner",
        mediaId: "video",
        remoteUrl: "https://cdn.test/video.mp4",
        sourceUri: "file:///tmp/video.mp4",
      }),
    ).resolves.toBe("file:///native/adopted.mp4");
    expect(mockNativeAdopt).toHaveBeenCalledWith({
      ownerId: "owner",
      mediaId: "video",
      remoteUrl: "https://cdn.test/video.mp4",
      sourceUri: "file:///tmp/video.mp4",
    });
  });

  it("includes native bytes and clears both native cache scopes", async () => {
    await expect(mediaCacheUsageBytes("owner")).resolves.toBe(123);
    await clearMediaCacheForAccount("owner");
    await clearAllMediaCache();
    expect(mockNativeUsage).toHaveBeenCalledWith("owner");
    expect(mockNativeClearAccount).toHaveBeenCalledWith("owner");
    expect(mockNativeClearAll).toHaveBeenCalledTimes(1);
  });
});
