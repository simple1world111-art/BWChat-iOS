import type { ShortDramaSeries } from "@/models";

let pendingSeries: ShortDramaSeries | null = null;

export function rememberShortDramaSeriesForEditing(series: ShortDramaSeries): void {
  pendingSeries = series;
}

export function pendingShortDramaSeriesForEditing(seriesId: string): ShortDramaSeries | null {
  return pendingSeries?.series_id === seriesId ? pendingSeries : null;
}

export function clearPendingShortDramaSeriesForEditing(seriesId: string): void {
  if (pendingSeries?.series_id === seriesId) pendingSeries = null;
}
