import {
  isHlsMediaUrl,
  mediaCacheBudgetBytes,
  mediaCacheIndexKey,
  mediaCachePolicy,
  mediaCachePruneIds,
  type MediaCacheEntry,
} from "@/services/cache/MediaCacheService";

const gib = 1_024 * 1_024 * 1_024;
const mib = 1_024 * 1_024;
const now = Date.parse("2026-08-07T00:00:00.000Z");

describe("MediaCacheService policy", () => {
  it("keeps the native delay, disk gate, retention and adaptive budget constants", () => {
    expect(mediaCachePolicy).toEqual({
      scheduleDelayMilliseconds: 5_000,
      minimumFreeSpaceBytes: 2 * gib,
      staleAgeMilliseconds: 30 * 24 * 60 * 60 * 1_000,
      minimumBudgetBytes: 512 * mib,
      maximumBudgetBytes: 5 * gib,
      adaptiveBudgetFraction: 0.15,
    });
  });

  it("detects HLS sources that require the Apple asset downloader", () => {
    expect(isHlsMediaUrl("https://cdn.test/master.M3U8?token=1")).toBe(true);
    expect(isHlsMediaUrl("https://cdn.test/video.mp4")).toBe(false);
  });

  it("clamps the adaptive budget between 512MB and 5GB", () => {
    expect(mediaCacheBudgetBytes(100 * mib, 0)).toBe(512 * mib);
    expect(mediaCacheBudgetBytes(10 * gib, 0)).toBe(Math.floor(1.5 * gib));
    expect(mediaCacheBudgetBytes(100 * gib, 0)).toBe(5 * gib);
  });

  it("removes 30-day stale entries before oldest-accessed LRU entries", () => {
    const stale = entry("stale", 100 * mib, now - mediaCachePolicy.staleAgeMilliseconds - 1);
    const oldest = entry("oldest", 400 * mib, now - 10_000);
    const newest = entry("newest", 400 * mib, now - 1_000);
    expect(mediaCachePruneIds([stale, oldest, newest], 0, now)).toEqual(["stale", "oldest"]);
  });

  it("keeps indexes account-scoped and URL-encodes the owner", () => {
    expect(mediaCacheIndexKey(" owner/a ")).toBe("bwchat.media-cache.v1:owner%2Fa");
  });
});

function entry(id: string, byteCount: number, lastAccessedAt: number): MediaCacheEntry {
  return {
    id,
    remote_url: `https://cdn.test/${id}.mp4`,
    relative_path: `${id}.mp4`,
    byte_count: byteCount,
    created_at: now,
    last_accessed_at: lastAccessedAt,
  };
}
