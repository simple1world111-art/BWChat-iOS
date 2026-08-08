import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type { ShortDramaHistoryRecord } from "@/services/short-drama/ShortDramaHistoryRepository";
import type { ShortDramaSeries, ShortDramaVideo } from "@/models";

export const shortDramaSeriesMetrics = {
  segmentedWidth: 196,
  createButtonSize: 34,
  createSymbolSize: 18,
  listGap: 14,
  listInset: 16,
  cardInset: 14,
  cardRadius: 16,
  cardBorderWidth: 1,
  headerGap: 10,
  titleStatusGap: 7,
  posterHeight: 131,
  posterRadius: 12,
  episodesTopInset: 14,
  episodesGap: 12,
  episodeColumns: 5,
  episodeGap: 8,
  episodeHeight: 44,
  episodeRadius: 8,
  episodePageSize: 15,
  rangeGap: 20,
  rangeCopyGap: 5,
  rangeTitleSize: 16,
  rangeMinimumWidth: 76,
  rangeUnderlineWidth: 38,
  rangeUnderlineHeight: 3,
  rangeBottomInset: 12,
  lockSymbolSize: 9,
  lockInset: 6,
  statusDotSize: 7,
  statusDotInset: 5,
  creatorDividerTopInset: 14,
  creatorTopInset: 10,
  creatorGap: 10,
  creatorAvatarSize: 44,
  creatorCopySize: 14,
  emptyTopInset: 80,
  emptyGap: 12,
  loadingInset: 28,
  errorHorizontalInset: 12,
  errorVerticalInset: 8,
  errorTopInset: 8,
  pageLimit: 12,
  legacyPageLimit: 60,
  maximumCachedSeries: 200,
  cacheTtlMilliseconds: 5 * 60 * 1_000,
  staleRetentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
} as const;

export interface ShortDramaEpisodeSlot {
  number: number;
  episode?: ShortDramaVideo | undefined;
}

export function shortDramaSeriesIsBlank(value: string): boolean {
  return trimFoundationWhitespacesAndNewlines(value).length === 0;
}

export function sortedShortDramaEpisodes(episodes: readonly ShortDramaVideo[]): ShortDramaVideo[] {
  return [...episodes].sort((left, right) => {
    const leftNumber = left.episode_number ?? Number.MAX_SAFE_INTEGER;
    const rightNumber = right.episode_number ?? Number.MAX_SAFE_INTEGER;
    if (leftNumber !== rightNumber) return leftNumber - rightNumber;
    return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
  });
}

export function mergeShortDramaEpisodes(
  current: readonly ShortDramaVideo[],
  incoming: readonly ShortDramaVideo[],
): ShortDramaVideo[] {
  const byId = new Map(current.map((episode) => [episode.id, episode]));
  for (const episode of incoming) byId.set(episode.id, episode);
  return [...byId.values()];
}

export function shortDramaEpisodeSlots(
  episodes: readonly ShortDramaVideo[],
  expectedEpisodeCount: number,
  page: number,
): ShortDramaEpisodeSlot[] {
  const sorted = sortedShortDramaEpisodes(episodes);
  const count = Math.max(expectedEpisodeCount, sorted.length);
  if (count <= 0) return [];
  const start = page * shortDramaSeriesMetrics.episodePageSize + 1;
  const end = Math.min(count, start + shortDramaSeriesMetrics.episodePageSize - 1);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => {
    const number = start + index;
    const episode = sorted[number - 1];
    return { number, ...(episode ? { episode } : {}) };
  });
}

export function shortDramaEpisodePageCount(expectedEpisodeCount: number): number {
  return Math.max(
    1,
    Math.ceil(Math.max(0, expectedEpisodeCount) / shortDramaSeriesMetrics.episodePageSize),
  );
}

export function shortDramaRangeTitle(page: number, episodeCount: number): string {
  const start = page * shortDramaSeriesMetrics.episodePageSize + 1;
  const end = Math.min(episodeCount, start + shortDramaSeriesMetrics.episodePageSize - 1);
  return `${start} – ${end}`;
}

export function mergeUniqueShortDramaSeries(
  current: readonly ShortDramaSeries[],
  incoming: readonly ShortDramaSeries[],
): ShortDramaSeries[] {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((series) => {
    if (seen.has(series.series_id)) return false;
    seen.add(series.series_id);
    return true;
  });
}

export function applyShortDramaHistory(
  series: ShortDramaSeries,
  history: Readonly<Record<string, ShortDramaHistoryRecord>>,
): ShortDramaSeries {
  const record = history[series.series_id];
  if (!record) return series;
  return {
    ...series,
    resume_episode_id: record.episode_id,
    resume_position_seconds: record.position_seconds,
    last_watched_at: record.watched_at,
  };
}

export function groupLegacyShortDramaVideos(
  videos: readonly ShortDramaVideo[],
  noTitle: string,
): ShortDramaSeries[] {
  const grouped = new Map<string, ShortDramaVideo[]>();
  for (const video of videos) {
    const id = shortDramaSeriesIsBlank(video.drama_id) ? video.id : video.drama_id;
    grouped.set(id, [...(grouped.get(id) ?? []), video]);
  }
  return [...grouped.entries()].map(([id, source]) => {
    const episodes = [...source].sort(
      (left, right) =>
        (left.episode_number ?? Number.MAX_SAFE_INTEGER) -
        (right.episode_number ?? Number.MAX_SAFE_INTEGER),
    );
    const first = episodes[0]!;
    return {
      series_id: id,
      title: shortDramaSeriesIsBlank(first.drama_title)
        ? trimFoundationWhitespacesAndNewlines(first.title) || noTitle
        : first.drama_title,
      intro: first.intro,
      cover_url: first.cover_url,
      episode_count: episodes.length,
      status: "published",
      updated_at: "",
      episodes,
      creator: first.creator,
      resume_position_seconds: 0,
    };
  });
}
