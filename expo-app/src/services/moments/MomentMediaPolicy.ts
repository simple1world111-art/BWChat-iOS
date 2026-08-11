import type { Moment, MomentMedia } from "@/models";

/** Uses server-generated previews in scrolling surfaces and keeps originals for the gallery. */
export function momentMediaFeedDisplayUrl(item: MomentMedia, locked: boolean): string {
  if (locked) return item.locked_preview_url || item.thumbnail_url || item.url;
  return item.thumbnail_url || item.url || item.locked_preview_url || "";
}

export function momentFeedPreviewUrls(
  moments: readonly Moment[],
  viewerId: string,
  limit = 6,
): string[] {
  const urls: string[] = [];
  for (const moment of moments) {
    const locked =
      (moment.unlock_price_gold_coins ?? 0) > 0 &&
      !moment.is_unlocked &&
      moment.author.user_id !== viewerId;
    for (const media of moment.media) {
      const url = momentMediaFeedDisplayUrl(media, locked).trim();
      if (url) urls.push(url);
      if (urls.length >= limit) return urls;
    }
  }
  return urls;
}
