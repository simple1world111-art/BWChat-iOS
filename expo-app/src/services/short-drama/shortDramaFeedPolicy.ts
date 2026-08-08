import type { ShortDramaVideo } from "@/models";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";

export const shortDramaFeedMetrics = {
  topBarButtonSize: 42,
  topBarSymbolSize: 18,
  topBarTitleSize: 17,
  topBarHorizontalInset: 14,
  topBarTopInset: 8,
  pageWindowRadius: 1,
  pageLimit: 12,
  loadMoreThreshold: 3,
  maximumCachedVideos: 200,
  cacheTtlMilliseconds: 5 * 60 * 1_000,
  staleRetentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
  progressMinimumDeltaSeconds: 0.75,
  progressTimeoutMilliseconds: 4_000,
  progressIntervalSeconds: 0.35,
  loopLeadSeconds: 0.25,
  resumeSeekMinimumSeconds: 1,
  firstFrameFadeMilliseconds: 180,
  playButtonSize: 74,
  playButtonSymbolSize: 28,
  playButtonBorderWidth: 1,
  playButtonShadowRadius: 16,
  playButtonShadowOffsetY: 6,
  lockedGap: 9,
  lockedSymbolSize: 24,
  lockedHorizontalInset: 18,
  lockedVerticalInset: 14,
  lockedRadius: 14,
  lockedOuterHorizontalInset: 36,
  bottomGap: 14,
  bottomHorizontalInset: 16,
  bottomInset: 28,
  metadataGap: 8,
  creatorNameSize: 16,
  dramaTitleSize: 17,
  introSize: 14,
  episodePillHorizontalInset: 10,
  episodePillVerticalInset: 5,
  episodePillSize: 12,
  secondaryTitleSize: 12,
  emptyGap: 14,
  emptySymbolSize: 38,
  emptyTitleSize: 15,
} as const;

export function shortDramaFeedScopeIdentity(
  ownerId: string,
  seriesId: string | undefined,
  episodeId: string | undefined,
  initialPositionSeconds: number,
): string {
  const position =
    Number.isFinite(initialPositionSeconds) && initialPositionSeconds > 0
      ? initialPositionSeconds
      : 0;
  return [
    trimFoundationWhitespacesAndNewlines(ownerId),
    seriesId ?? "",
    episodeId ?? "",
    String(position),
  ].join("\u0000");
}

export function shortDramaStreamingUrl(video: ShortDramaVideo): string {
  const hls = trimFoundationWhitespacesAndNewlines(video.hls_url ?? "");
  if (hls) return hls;
  if (video.play_url.toLocaleLowerCase().includes(".m3u8")) return video.play_url;
  const mp4 = trimFoundationWhitespacesAndNewlines(video.mp4_url ?? "");
  if (mp4) return mp4;
  return video.play_url;
}

export function shortDramaRequiresUnlock(video: ShortDramaVideo): boolean {
  return (
    (video.unlock_price_gold_coins ?? 0) > 0 &&
    !video.is_unlocked &&
    !video.is_owned_by_current_user
  );
}

export function normalizeInitialShortDramaVideos(
  source: readonly ShortDramaVideo[],
): ShortDramaVideo[] {
  return [...source]
    .filter((video) => Boolean(shortDramaStreamingUrl(video)) || shortDramaRequiresUnlock(video))
    .sort(compareShortDramaEpisodes);
}

export function appendShortDramaFeedVideos(
  current: readonly ShortDramaVideo[],
  incoming: readonly ShortDramaVideo[],
): ShortDramaVideo[] {
  const existingIds = new Set(current.map((video) => video.id));
  return [
    ...current,
    ...incoming.filter(
      (video) => !existingIds.has(video.id) && Boolean(shortDramaStreamingUrl(video)),
    ),
  ];
}

export function shortDramaWindowIndices(index: number, count: number): number[] {
  if (count <= 0 || index < 0 || index >= count) return [];
  const lower = Math.max(0, index - shortDramaFeedMetrics.pageWindowRadius);
  const upper = Math.min(count - 1, index + shortDramaFeedMetrics.pageWindowRadius);
  return Array.from({ length: upper - lower + 1 }, (_, offset) => lower + offset);
}

export function shouldLoadMoreShortDramaFeed(index: number, count: number): boolean {
  return index >= count - shortDramaFeedMetrics.loadMoreThreshold;
}

export function shortDramaUpcomingPageIndex(
  offsetY: number,
  pageHeight: number,
  selectedIndex: number,
  count: number,
): number {
  if (count <= 0) return 0;
  const selected = Math.max(0, Math.min(count - 1, Math.trunc(selectedIndex)));
  if (!Number.isFinite(offsetY) || !Number.isFinite(pageHeight) || pageHeight <= 0) {
    return selected;
  }
  const selectedOffset = selected * pageHeight;
  if (offsetY > selectedOffset + 0.5) return Math.min(count - 1, selected + 1);
  if (offsetY < selectedOffset - 0.5) return Math.max(0, selected - 1);
  return selected;
}

export function shouldReportShortDramaProgress(
  currentSeconds: number,
  lastReportedSeconds: number | undefined,
): boolean {
  if (!Number.isFinite(currentSeconds) || currentSeconds < 0) return false;
  return (
    lastReportedSeconds === undefined ||
    Math.abs(currentSeconds - lastReportedSeconds) >=
      shortDramaFeedMetrics.progressMinimumDeltaSeconds
  );
}

export function shouldAuthorizeShortDramaMedia(mediaUrl: string, apiBaseUrl: string): boolean {
  try {
    const media = new URL(mediaUrl);
    const api = new URL(apiBaseUrl);
    if (
      media.protocol.toLocaleLowerCase() !== api.protocol.toLocaleLowerCase() ||
      media.hostname.toLocaleLowerCase() !== api.hostname.toLocaleLowerCase() ||
      effectivePort(media) !== effectivePort(api)
    )
      return false;
    const basePath = api.pathname.endsWith("/") ? api.pathname.slice(0, -1) : api.pathname;
    return (
      !basePath ||
      basePath === "/" ||
      media.pathname === basePath ||
      media.pathname.startsWith(`${basePath}/`)
    );
  } catch {
    return false;
  }
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  if (url.protocol.toLocaleLowerCase() === "http:") return "80";
  if (url.protocol.toLocaleLowerCase() === "https:") return "443";
  return "";
}

function compareShortDramaEpisodes(left: ShortDramaVideo, right: ShortDramaVideo): number {
  const leftNumber = left.episode_number ?? Number.MAX_SAFE_INTEGER;
  const rightNumber = right.episode_number ?? Number.MAX_SAFE_INTEGER;
  return leftNumber - rightNumber || left.id.localeCompare(right.id);
}
