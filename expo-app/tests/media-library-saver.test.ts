import {
  isDeviceLocalUri,
  saveImageWithDependencies,
  type MediaLibrarySaveDependencies,
} from "@/services/media/MediaLibrarySaveCoordinator";

function dependencies(overrides: Partial<MediaLibrarySaveDependencies> = {}) {
  const cleanup = jest.fn();
  const value: MediaLibrarySaveDependencies = {
    getAddPermission: jest.fn().mockResolvedValue(true),
    requestAddPermission: jest.fn().mockResolvedValue(true),
    download: jest.fn().mockResolvedValue({ uri: "file:///cache/download.jpg", cleanup }),
    validateImage: jest.fn().mockResolvedValue(undefined),
    createAsset: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { value, cleanup };
}

describe("MediaLibrarySaver", () => {
  it("requests add-only permission after an undecided/denied current status", async () => {
    const requestAddPermission = jest.fn().mockResolvedValue(false);
    const { value } = dependencies({
      getAddPermission: jest.fn().mockResolvedValue(false),
      requestAddPermission,
    });
    await expect(saveImageWithDependencies("https://cdn.example.com/a.jpg", value)).resolves.toBe(
      "permissionDenied",
    );
    expect(requestAddPermission).toHaveBeenCalledTimes(1);
    expect(value.download).not.toHaveBeenCalled();
  });

  it("downloads, validates, saves and removes a remote temporary file", async () => {
    const { value, cleanup } = dependencies();
    await expect(saveImageWithDependencies("https://api.example.com/a.jpg", value)).resolves.toBe(
      "saved",
    );
    expect(value.download).toHaveBeenCalledWith("https://api.example.com/a.jpg");
    expect(value.validateImage).toHaveBeenCalledWith("file:///cache/download.jpg");
    expect(value.createAsset).toHaveBeenCalledWith("file:///cache/download.jpg");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("uses local files directly and distinguishes invalid image data", async () => {
    const validateImage = jest.fn().mockRejectedValue(new Error("decode failed"));
    const { value } = dependencies({ validateImage });
    await expect(saveImageWithDependencies("file:///documents/bad.jpg", value)).resolves.toBe(
      "invalidImage",
    );
    expect(value.download).not.toHaveBeenCalled();
    expect(value.createAsset).not.toHaveBeenCalled();
  });

  it("keeps the native save result when best-effort temporary cleanup fails", async () => {
    const cleanup = jest.fn(() => {
      throw new Error("cache file already reclaimed");
    });
    const { value } = dependencies({
      download: jest.fn().mockResolvedValue({ uri: "file:///cache/download.jpg", cleanup }),
    });

    await expect(saveImageWithDependencies("https://api.example.com/a.jpg", value)).resolves.toBe(
      "saved",
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("recognizes iOS file and Android content URIs as local", () => {
    expect(isDeviceLocalUri("file:///documents/a.jpg")).toBe(true);
    expect(isDeviceLocalUri("content://picker/a.jpg")).toBe(true);
    expect(isDeviceLocalUri("https://cdn.example.com/a.jpg")).toBe(false);
  });
});
