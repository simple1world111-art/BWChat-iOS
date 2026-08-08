import type { ShortDramaCreator, ShortDramaSeries, ShortDramaVideo } from "@/models";

export type ShortDramaEpisodeUploadState = "pending" | "uploading" | "uploaded" | "failed";

export interface ShortDramaEpisodeDraft {
  id: string;
  episode_number: number;
  title: string;
  intro: string;
  unlock_price_gold_coins: number;
  local_video_uri?: string | undefined;
  local_video_filename?: string | undefined;
  local_video_mime_type?: string | undefined;
  preview_uri?: string | undefined;
  server_video?: ShortDramaVideo | undefined;
  upload_state: ShortDramaEpisodeUploadState;
  is_dirty: boolean;
}

export interface ShortDramaEditorDraft {
  draft_id: string;
  title: string;
  intro: string;
  cover_uri?: string | undefined;
  source_series?: ShortDramaSeries | undefined;
  episodes: ShortDramaEpisodeDraft[];
}

export const shortDramaEditorMetrics = {
  contentGap: 14,
  contentInset: 16,
  contentBottomInset: 96,
  cardInset: 14,
  cardRadius: 16,
  cardBorderWidth: 1,
  seriesGap: 10,
  fieldGap: 6,
  fieldLabelSize: 12,
  titleMinimumHeight: 44,
  titleHorizontalInset: 12,
  inputRadius: 10,
  focusedBorderWidth: 1.5,
  idleBorderWidth: 1,
  posterHeight: 131,
  posterRadius: 12,
  posterBadgeHorizontalInset: 10,
  posterBadgeVerticalInset: 7,
  posterBadgeOuterInset: 10,
  introInset: 12,
  introMinimumHeight: 76,
  introMinimumLines: 3,
  introMaximumLines: 5,
  episodeSectionGap: 12,
  episodeColumns: 5,
  episodeGap: 8,
  episodeHeight: 44,
  episodeRadius: 8,
  episodeOverlayInset: 5,
  episodePriceGap: 2,
  episodePriceSize: 9,
  episodeNumberHorizontalInset: 6,
  episodeNumberVerticalInset: 3,
  episodeStateSymbolSize: 12,
  maximumLocalEpisodes: 20,
  coverMaximumDimension: 1_280,
  coverInitialQuality: 0.78,
  coverMaximumBytes: 900_000,
  previewMaximumDimension: 720,
  previewQuality: 0.82,
  seriesUploadTimeoutMilliseconds: 180_000,
  episodeUploadTimeoutMilliseconds: 600_000,
  maximumConcurrentEpisodeUploads: 2,
  priceMinimum: 0,
  priceMaximum: 100,
  priceFieldWidth: 70,
  episodeIntroMinimumLines: 3,
  episodeIntroMaximumLines: 6,
  publishButtonMinimumHeight: 48,
  publishButtonRadius: 12,
  publishBarGap: 6,
  publishBarHorizontalInset: 16,
  publishBarTopInset: 10,
  publishBarBottomInset: 8,
} as const;

export function shortDramaDraftFromSeries(
  series: ShortDramaSeries | undefined,
  draftId: string,
  idFactory: () => string,
  videoFallbackTitle: string,
): ShortDramaEditorDraft {
  const episodes = [...(series?.episodes ?? [])]
    .sort((left, right) => {
      const leftNumber = left.episode_number ?? Number.MAX_SAFE_INTEGER;
      const rightNumber = right.episode_number ?? Number.MAX_SAFE_INTEGER;
      return leftNumber - rightNumber || left.id.localeCompare(right.id);
    })
    .map((video, index): ShortDramaEpisodeDraft => {
      const normalizedNumber = index + 1;
      return {
        id: idFactory(),
        episode_number: normalizedNumber,
        title: video.title.trim() || video.drama_title.trim() || videoFallbackTitle,
        intro: video.intro,
        unlock_price_gold_coins: video.unlock_price_gold_coins ?? 0,
        server_video: video,
        upload_state: "uploaded",
        is_dirty: video.episode_number !== normalizedNumber,
      };
    });
  return {
    draft_id: draftId,
    title: series?.title ?? "",
    intro: series?.intro ?? "",
    ...(series ? { source_series: series } : {}),
    episodes,
  };
}

export function canPublishShortDramaDraft(draft: ShortDramaEditorDraft): boolean {
  const numbers = draft.episodes.map((episode) => episode.episode_number);
  return draft.title.trim().length > 0
    && draft.episodes.length > 0
    && draft.episodes.every((episode) => episode.title.trim().length > 0)
    && numbers.every((number) => Number.isInteger(number) && number > 0)
    && new Set(numbers).size === numbers.length
    && Boolean(draft.source_series || draft.cover_uri);
}

export function shortDramaAvailableImportCount(
  episodes: readonly ShortDramaEpisodeDraft[],
): number {
  const localCount = episodes.filter((episode) => episode.local_video_uri).length;
  return Math.max(0, shortDramaEditorMetrics.maximumLocalEpisodes - localCount);
}

export function appendPreparedShortDramaEpisodes(
  current: readonly ShortDramaEpisodeDraft[],
  prepared: readonly Pick<
    ShortDramaEpisodeDraft,
    "id" | "local_video_uri" | "local_video_filename" | "local_video_mime_type" | "preview_uri"
  >[],
  episodeTitle: (number: number) => string,
): ShortDramaEpisodeDraft[] {
  const firstNumber = current.length + 1;
  return [
    ...current,
    ...prepared.map((item, offset): ShortDramaEpisodeDraft => {
      const number = firstNumber + offset;
      return {
        ...item,
        episode_number: number,
        title: episodeTitle(number),
        intro: "",
        unlock_price_gold_coins: 0,
        upload_state: "pending",
        is_dirty: false,
      };
    }),
  ];
}

export function updateShortDramaEpisodeDraft(
  episodes: readonly ShortDramaEpisodeDraft[],
  updated: ShortDramaEpisodeDraft,
): ShortDramaEpisodeDraft[] {
  const index = episodes.findIndex((episode) => episode.id === updated.id);
  if (index < 0) return [...episodes];
  const previous = episodes[index]!;
  const next = [...episodes];
  next[index] = {
    ...updated,
    is_dirty: previous.is_dirty || shortDramaEpisodeMetadataDiffers(updated, previous),
  };
  return sortShortDramaEpisodeDrafts(next);
}

export function renumberShortDramaEpisodeDrafts(
  episodes: readonly ShortDramaEpisodeDraft[],
  episodeTitle: (number: number) => string,
): ShortDramaEpisodeDraft[] {
  return sortShortDramaEpisodeDrafts(episodes).map((episode, index) => {
    const expected = index + 1;
    if (episode.episode_number === expected) return episode;
    const usesDefaultTitle = episode.title === episodeTitle(episode.episode_number);
    return {
      ...episode,
      episode_number: expected,
      title: usesDefaultTitle ? episodeTitle(expected) : episode.title,
      is_dirty: Boolean(episode.server_video) || episode.is_dirty,
    };
  });
}

export function normalizeShortDramaPriceText(value: string): string {
  const digits = Array.from(value).filter((character) => /\p{N}/u.test(character)).join("");
  if (!digits) return "";
  return String(Math.min(Number.parseInt(digits, 10) || 0, shortDramaEditorMetrics.priceMaximum));
}

export function clampShortDramaPrice(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.trunc(parsed) : 0, 0), 100);
}

export function shortDramaVideoMimeType(filename: string, sourceType?: string): string {
  const extension = filename.split(".").at(-1)?.toLocaleLowerCase();
  if (extension === "mov") return "video/quicktime";
  if (extension === "m4v") return "video/x-m4v";
  if (extension === "mp4") return "video/mp4";
  return sourceType?.trim() || "video/mp4";
}

export function shortDramaLocalSeriesProjection(
  draft: ShortDramaEditorDraft,
  creator: ShortDramaCreator,
  now = new Date().toISOString(),
): ShortDramaSeries {
  return {
    series_id: `local:${draft.draft_id}`,
    title: draft.title.trim(),
    intro: draft.intro.trim(),
    cover_url: draft.cover_uri ?? draft.source_series?.cover_url ?? "",
    episode_count: draft.episodes.length,
    status: "draft",
    updated_at: now,
    episodes: [],
    creator,
    resume_position_seconds: 0,
  };
}

function shortDramaEpisodeMetadataDiffers(
  left: ShortDramaEpisodeDraft,
  right: ShortDramaEpisodeDraft,
): boolean {
  return left.episode_number !== right.episode_number
    || left.title !== right.title
    || left.intro !== right.intro
    || left.unlock_price_gold_coins !== right.unlock_price_gold_coins;
}

function sortShortDramaEpisodeDrafts(
  episodes: readonly ShortDramaEpisodeDraft[],
): ShortDramaEpisodeDraft[] {
  return [...episodes].sort((left, right) =>
    left.episode_number - right.episode_number || left.id.localeCompare(right.id));
}
