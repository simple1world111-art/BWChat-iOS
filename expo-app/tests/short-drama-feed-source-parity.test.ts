import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const nativeSources = [
  [
    "Views/ShortDramaFeedView.swift",
    "61bd4af279a5855af0d3ceadce6c94157be754ee29b142e40919b11274fc5f9d",
  ],
  [
    "ViewModels/ShortDramaFeedViewModel.swift",
    "747f33afea7bc8ea2178172baf136fba0872b535677498e72d2d8a6b741624c8",
  ],
  [
    "Views/ShortDramaVideoPage.swift",
    "48b5a6c5dc9962d6118652bd8994998eeba6bcf4ba9108a5bfe6e6b1f41ce662",
  ],
  [
    "Views/ShortDramaActionRail.swift",
    "8fa2a398c06c2297fa215185653cccca8afcacc9a20d540d956e83100f0b70cc",
  ],
  ["Models/ShortDrama.swift", "13abb0d63f53893bd48eff56fcf6d40f3bb7d570267280bcae276100344d6a11"],
  ["Services/APIService.swift", "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274"],
  [
    "Services/CacheRepository.swift",
    "530f9734eeb9fdc8aeafc3e5430d5eae876754462372bb3c05c9b830526f0b66",
  ],
  [
    "Services/WalletStore.swift",
    "cbc20644b9619fd707cf3372265af42e13528f5dcc2d3924455351af66b3cbe6",
  ],
  [
    "Views/ShortDramaSeriesListView.swift",
    "0290d386ab02d3cfdf41d2ea0c91c6d9943d7e6edba77301e6c2ea751405e8c6",
  ],
] as const;

describe("ShortDramaFeedView read-only native source lock", () => {
  it.each(nativeSources)(
    "keeps %s identical in the original and desktop Swift copy",
    (path, hash) => {
      const copied = resolve(root, "../BWChat", path);
      const original = resolve(root, "../../BWChat-iOS/BWChat", path);
      expect(sha256(copied)).toBe(hash);
      if (existsSync(original)) expect(sha256(original)).toBe(hash);
    },
  );

  it("keeps the Expo feed wired to native paging, lifecycle, history and unlock state", () => {
    const page = source("src/app/short-drama-player.tsx");
    expect(page).toContain("seriesId !== undefined");
    expect(page).toContain("requestedEpisodeId !== undefined");
    expect(page).toContain("recordFocusedVideoHistory(videos[index]!)");
    expect(page).toContain("progressAbortControllersRef.current.get(video.id)?.abort()");
    expect(page).toContain("unlockKeysRef.current.get(video.id) ?? createIdempotencyKey()");
    expect(page).toContain("incrementCommentCount(videosRef.current, commentTarget.id)");
  });

  it("keeps every feed backend route on the required native envelope/data gates", () => {
    const api = source("src/api/bwchat.ts");
    expect(api).toContain("`/short-drama/feed?${query}`");
    expect(api).toContain("`/short-drama/series/${encodeShortDramaPathComponent(seriesId)}`");
    expect(api).toContain(
      "`/short-drama/videos/${encodeShortDramaPathComponent(videoId)}/progress`",
    );
    expect(api).toContain("`/short-drama/videos/${encodeShortDramaPathComponent(videoId)}/unlock`");
    expect(api).toContain('headers: { "Idempotency-Key": idempotencyKey }');
    expect(api).toContain("body: { idempotency_key: idempotencyKey }");
    expect(api).toContain("requiredData: true");
    expect(api).toContain("requiredEnvelope: true");
  });
});

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
