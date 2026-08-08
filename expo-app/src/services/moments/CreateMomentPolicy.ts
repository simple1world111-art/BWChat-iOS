import type { MomentUploadAsset } from "@/models";

export const createMomentPolicy = {
  maximumContentLength: 200,
  maximumImageCount: 9,
  maximumVideoCount: 1,
  unlockPrices: [10, 50, 100, 200, 500, 1000] as const,
} as const;

export function momentContentCharacters(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), ({ segment }) => segment);
  }
  return Array.from(value);
}

export function momentContentLength(value: string): number {
  return momentContentCharacters(value).length;
}

export function truncateMomentContent(value: string): string {
  return momentContentCharacters(value).slice(0, createMomentPolicy.maximumContentLength).join("");
}

export function validateMomentSelection(media: MomentUploadAsset[]): void {
  const images = media.filter((item) => item.kind === "image").length;
  const videos = media.filter((item) => item.kind === "video").length;
  if (images > 0 && videos > 0) throw new Error("mixed-media");
  if (images > createMomentPolicy.maximumImageCount) throw new Error("too-many-images");
  if (videos > createMomentPolicy.maximumVideoCount) throw new Error("too-many-videos");
}

export function canPublishMoment(
  content: string,
  media: MomentUploadAsset[],
  busy: boolean,
): boolean {
  if (busy || (!content.trim() && media.length === 0)) return false;
  try {
    validateMomentSelection(media);
    return true;
  } catch {
    return false;
  }
}
