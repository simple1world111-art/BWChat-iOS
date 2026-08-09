import fs from "node:fs";
import path from "node:path";

const expoRoot = process.cwd();
const nativeRoot = path.resolve(expoRoot, "..");

describe("native cache manager source parity", () => {
  it("preserves the native image cache dimensions and selects memory-disk rendering", () => {
    const swift = native("BWChat/Managers/ImageCacheManager.swift");
    const service = expo("src/services/cache/ImageCacheService.ts");
    const image = expo("src/components/AuthenticatedImage.tsx");
    const outbox = expo("src/services/messages/ChatImageOutbox.ts");
    expect(swift).toContain("memoryCache.countLimit = 200");
    expect(swift).toContain("80 * 1024 * 1024");
    expect(swift).toContain("maxPixelSize: 720");
    expect(swift).toContain("maxPixelSize: 2048");
    expect(service).toContain('cachePolicy: "memory-disk"');
    expect(service).toContain("adoptLocalImageFile");
    expect(service).toContain('new Directory(Paths.cache, "bwchat-images", "authenticated")');
    expect(service).toContain("authenticatedImageLoads.get(normalized)");
    expect(service).toContain("authenticatedResourceRequest(remoteUrl)");
    expect(service).toContain("partial.write(bytes)");
    expect(image).toContain("imageCachePolicy.cachePolicy");
    expect(image).toContain("peekAdoptedImageUri(cacheIdentity)");
    expect(image).toContain("peekAuthenticatedImageUri(cacheIdentity)");
    expect(image).toContain("await getAuthenticatedImageUri(uri, cacheIdentity)");
    expect(outbox).toContain("await adoptConfirmedImage(uploading, confirmed)");
  });

  it("preserves the MP4 media delay, account scope, disk gate, retention and LRU budget", () => {
    const swift = native("BWChat/Managers/MediaCacheManager.swift");
    const service = expo("src/services/cache/MediaCacheService.ts");
    expect(swift).toContain("delay: TimeInterval = 5");
    expect(swift).toContain('let scope = "account:\\(userID)"');
    expect(swift).toContain("available > 2 * 1024 * 1024 * 1024");
    expect(swift).toContain("-30 * 24 * 60 * 60");
    expect(swift).toContain("0.15");
    expect(service).toContain("scheduleDelayMilliseconds: 5_000");
    expect(service).toContain("minimumFreeSpaceBytes: 2 * 1_024 * 1_024 * 1_024");
    expect(service).toContain("staleAgeMilliseconds: 30 * 24 * 60 * 60 * 1_000");
    expect(service).toContain("adaptiveBudgetFraction: 0.15");
    expect(service).toContain("sha256(`account:${owner}`)");
  });

  it("preserves user persistence, batch caching, fallback and logout retention", () => {
    const swift = native("BWChat/Managers/UserCacheManager.swift");
    const service = expo("src/services/cache/UserInfoCache.ts");
    const auth = expo("src/providers/AuthProvider.tsx");
    expect(swift).toContain('appendingPathComponent("UserInfoCache.json")');
    expect(swift).toContain("func cacheFriends");
    expect(swift).toContain("func cacheContacts");
    expect(swift).toContain("users[userID]?.nickname ?? userID");
    expect(service).toContain('const storageKey = "bwchat.user-info-cache.v1"');
    expect(service).toContain("cacheFriendList");
    expect(service).toContain("cacheContactList");
    expect(service).toContain("?.nickname || userId");
    expect(auth).not.toContain("clearUserInfoCache()");
    expect(auth).toContain("keeps account-scoped offline caches");
    expect(expo("src/services/cache/AppCacheService.ts")).toContain("clearUserInfoCache()");
  });

  it("connects chat playback and settings clearing to the account media cache", () => {
    const player = expo("src/components/media/VideoPlayerOverlay.tsx");
    const settings = expo("src/services/cache/AppCacheService.ts");
    const outbox = expo("src/services/messages/ChatVideoOutbox.ts");
    expect(player).toContain("getCachedMediaUri(ownerId, mediaId)");
    expect(player).toContain("void scheduleMediaCache({");
    expect(player).toContain("delayMilliseconds: 0");
    expect(player).not.toContain("scheduledCacheCancellation");
    expect(settings).toContain("clearMediaCacheForAccount(ownerId)");
    expect(settings).toContain("clearAllMediaCache()");
    expect(outbox).toContain("await adoptConfirmedVideo(uploading, response)");
    expect(outbox).toContain("adoptLocalMediaFile({");
    expect(outbox).toContain("adoptLocalImageFile(thumbnailSource, keys)");
  });
});

function native(file: string): string {
  return fs.readFileSync(path.join(nativeRoot, file), "utf8");
}

function expo(file: string): string {
  return fs.readFileSync(path.join(expoRoot, file), "utf8");
}
