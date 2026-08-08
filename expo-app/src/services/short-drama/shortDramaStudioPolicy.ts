import type { ShortDramaPublishStatus, ShortDramaSeries } from "@/models";
import type { ShortDramaUploadJob } from "@/services/short-drama/ShortDramaUploadQueue";
import { shortDramaLocalSeriesProjection } from "@/services/short-drama/shortDramaEditorPolicy";

export const shortDramaStudioMetrics = {
  contentGap: 14,
  cardGap: 12,
  horizontalInset: 16,
  topInset: 16,
  bottomInset: 30,
  loadingTopInset: 92,
  loadingGap: 12,
  loadingTextSize: 14,
  emptyTopInset: 70,
  emptyCardGap: 16,
  emptyCopyGap: 6,
  emptyIconSize: 44,
  emptyTitleSize: 18,
  emptyHintSize: 14,
  emptyButtonTextSize: 15,
  emptyButtonHorizontalInset: 18,
  emptyButtonHeight: 40,
  emptyCardInset: 28,
  emptyCardRadius: 16,
  statusPillTextSize: 11,
  statusPillHorizontalInset: 7,
  statusPillVerticalInset: 3,
  pageLimit: 20,
} as const;

export type ShortDramaStatusTone = "success" | "accent" | "danger" | "secondary";

export function shortDramaStatusTone(status: ShortDramaPublishStatus): ShortDramaStatusTone {
  if (status === "published") return "success";
  if (status === "processing" || status === "reviewing") return "accent";
  if (status === "rejected" || status === "failed") return "danger";
  return "secondary";
}

export function shortDramaStatusLocalizationKey(status: ShortDramaPublishStatus): string {
  switch (status) {
    case "draft":
      return "shortDrama.draft";
    case "processing":
      return "shortDrama.processing";
    case "reviewing":
      return "shortDrama.reviewing";
    case "published":
      return "shortDrama.published";
    case "rejected":
      return "shortDrama.rejected";
    case "failed":
      return "shortDrama.failed";
    case "unknown":
      return "shortDrama.status.unknown";
  }
}

export function shortDramaSeriesFromUploadJob(
  job: ShortDramaUploadJob,
  retryTitle: string,
): ShortDramaSeries {
  return {
    ...shortDramaLocalSeriesProjection(job.draft, job.creator, job.updated_at),
    ...(job.state === "failed_permanent" || job.state === "confirmation_unknown"
      ? { status_message: retryTitle }
      : {}),
  };
}

export function mergeShortDramaStudioInitial(
  jobs: readonly ShortDramaUploadJob[],
  remote: readonly ShortDramaSeries[],
  retryTitle: string,
): ShortDramaSeries[] {
  const remoteIds = new Set(remote.map((series) => series.series_id));
  const local = jobs
    .filter((job) => !job.server_id || !remoteIds.has(job.server_id))
    .map((job) => shortDramaSeriesFromUploadJob(job, retryTitle));
  return [...local, ...remote];
}

export function appendUniqueShortDramaStudioSeries(
  existing: readonly ShortDramaSeries[],
  incoming: readonly ShortDramaSeries[],
): ShortDramaSeries[] {
  const ids = new Set(existing.map((series) => series.series_id));
  return [...existing, ...incoming.filter((series) => !ids.has(series.series_id))];
}

export function upsertShortDramaStudioSeries(
  existing: readonly ShortDramaSeries[],
  item: ShortDramaSeries,
  jobs: readonly Pick<ShortDramaUploadJob, "id" | "server_id">[] = [],
): ShortDramaSeries[] {
  const localId = item.series_id.startsWith("local:")
    ? undefined
    : jobs.find((job) => job.server_id === item.series_id)?.id;
  const withoutReplacedLocal = localId
    ? existing.filter((series) => series.series_id !== `local:${localId}`)
    : [...existing];
  const index = withoutReplacedLocal.findIndex((series) => series.series_id === item.series_id);
  if (index < 0) return [item, ...withoutReplacedLocal];
  const next = [...withoutReplacedLocal];
  next[index] = item;
  return next;
}
