import {
  preloadChatImagePreview,
  preloadPreferredChatImagePreview,
  resetChatMediaPreviewPreloaderForTests,
} from "@/services/media/ChatMediaPreviewPreloader";

const mockGetAdoptedImageUri = jest.fn<Promise<string | undefined>, [string]>();
const mockGetAuthenticatedImageUri = jest.fn<Promise<string | undefined>, [string, string?]>();
const mockPrefetchImage = jest.fn<Promise<boolean>, [string]>();

jest.mock("@/services/cache/ImageCacheService", () => ({
  getAdoptedImageUri: (key: string) => mockGetAdoptedImageUri(key),
  getAuthenticatedImageUri: (uri: string, key?: string) => mockGetAuthenticatedImageUri(uri, key),
  peekAdoptedImageUri: () => undefined,
  peekAuthenticatedImageUri: () => undefined,
  prefetchImage: (uri: string) => mockPrefetchImage(uri),
}));

describe("chat media preview preloader", () => {
  beforeEach(() => {
    resetChatMediaPreviewPreloaderForTests();
    mockGetAdoptedImageUri.mockReset().mockResolvedValue(undefined);
    mockGetAuthenticatedImageUri.mockReset().mockResolvedValue("file:///cache/thumbnail.jpg");
    mockPrefetchImage.mockReset().mockResolvedValue(true);
  });

  it("downloads the exact owner-scoped thumbnail before the message is rendered", async () => {
    await expect(
      preloadChatImagePreview("owner-a", imageMessage(41), { retry: false }),
    ).resolves.toBe(true);

    expect(mockGetAuthenticatedImageUri).toHaveBeenCalledWith(
      expect.stringContaining("/media/thumbnail-41.jpg"),
      expect.stringContaining("bwchat_gallery_owner=owner-a"),
    );
  });

  it("preloads the routed canonical image rather than a different historical image", async () => {
    await expect(
      preloadPreferredChatImagePreview("owner-a", [imageMessage(40), imageMessage(41)], [40]),
    ).resolves.toBe(true);
    expect(mockGetAuthenticatedImageUri).toHaveBeenCalledWith(
      expect.stringContaining("/media/thumbnail-40.jpg"),
      expect.any(String),
    );
    expect(mockGetAuthenticatedImageUri).toHaveBeenCalledTimes(1);
  });

  it("does not block non-image messages", async () => {
    await expect(
      preloadPreferredChatImagePreview(
        "owner-a",
        [{ ...imageMessage(42), msg_type: "text" }],
        [42],
      ),
    ).resolves.toBe(true);
    expect(mockGetAuthenticatedImageUri).not.toHaveBeenCalled();
  });
});

function imageMessage(id: number) {
  return {
    id,
    msg_type: "image",
    content: `/media/original-${id}.jpg`,
    thumbnail_url: `/media/thumbnail-${id}.jpg`,
  };
}
