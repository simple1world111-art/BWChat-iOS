import {
  mediaPullDismissDecision,
  MEDIA_PULL_DISMISS_DISTANCE,
  MEDIA_PULL_FLICK_VELOCITY,
  MEDIA_PULL_MINIMUM_FLICK_DISTANCE,
  MEDIA_PULL_VERTICAL_DIRECTION_RATIO,
  MEDIA_PULL_VISUAL_DEAD_ZONE,
} from "@/components/media/mediaPullDismissMath";

export const GALLERY_MAXIMUM_SCALE = 5;
export const GALLERY_MINIMUM_SCALE = 0.5;
export const GALLERY_REST_SCALE_LIMIT = 1.05;
export const GALLERY_DOUBLE_TAP_SCALE = 2.5;
export const GALLERY_VERTICAL_DIRECTION_RATIO = MEDIA_PULL_VERTICAL_DIRECTION_RATIO;
export const GALLERY_VISUAL_DEAD_ZONE = MEDIA_PULL_VISUAL_DEAD_ZONE;
export const GALLERY_DISMISS_DISTANCE = MEDIA_PULL_DISMISS_DISTANCE;
export const GALLERY_MINIMUM_FLICK_DISTANCE = MEDIA_PULL_MINIMUM_FLICK_DISTANCE;
export const GALLERY_FLICK_VELOCITY = MEDIA_PULL_FLICK_VELOCITY;

export interface GalleryFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GallerySize {
  width: number;
  height: number;
}

export interface GalleryPanBounds {
  x: number;
  y: number;
}

export function dedupeGalleryUrls(urls: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const normalized = url.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function prependUniqueGalleryUrls(
  current: readonly string[],
  older: readonly string[],
): { images: string[]; added: number } {
  const seen = new Set(current);
  const additions = dedupeGalleryUrls(older).filter((url) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  return { images: [...additions, ...current], added: additions.length };
}

export function prependGalleryUrlsAtLatestIndex(
  current: readonly string[],
  older: readonly string[],
  latestIndex: number,
): { images: string[]; added: number; currentIndex: number } {
  const prepended = prependUniqueGalleryUrls(current, older);
  return {
    ...prepended,
    currentIndex: Math.max(0, latestIndex) + prepended.added,
  };
}

export function galleryOwnerCacheKey(ownerId: string, uri: string): string {
  const normalizedUri = uri.trim();
  if (!normalizedUri) return "";
  const owner = ownerId.trim() || "anonymous";
  const separator = normalizedUri.includes("?") ? "&" : "?";
  return `${normalizedUri}${separator}bwchat_gallery_owner=${encodeURIComponent(owner)}`;
}

export function galleryOwnerSourceId(ownerId: string, sourceId: string): string {
  return `${ownerId.trim() || "anonymous"}\u0000${sourceId}`;
}

export function isCurrentGalleryOperation(
  currentOwnerId: string,
  requestedOwnerId: string,
  currentGeneration: number,
  requestedGeneration: number,
  currentOperation: number,
  requestedOperation: number,
): boolean {
  return (
    currentOwnerId === requestedOwnerId &&
    currentGeneration === requestedGeneration &&
    currentOperation === requestedOperation
  );
}

/** Matches the native gallery's current-page plus immediate-neighbour decode window. */
export function shouldLoadGalleryPage(index: number, currentIndex: number): boolean {
  return Math.abs(index - currentIndex) <= 1;
}

export function initialGalleryIndex(
  original: readonly string[],
  deduped: readonly string[],
  requestedIndex: number,
): number {
  if (deduped.length === 0) return 0;
  const selected =
    requestedIndex >= 0 && requestedIndex < original.length
      ? original[requestedIndex]
      : original[0];
  const remapped = selected ? deduped.indexOf(selected.trim()) : -1;
  return remapped >= 0 ? remapped : 0;
}

export function galleryDismissDecision(translationY: number, velocityY: number): -1 | 0 | 1 {
  "worklet";
  return mediaPullDismissDecision(translationY, velocityY);
}

/**
 * Returns the maximum centered translation for an aspect-fit image at a
 * particular zoom. The page itself fills the viewport, so bounds must be
 * derived from the visible image rect rather than from the page dimensions.
 */
export function galleryPanBounds(
  fittedImage: GalleryFrame,
  viewport: GallerySize,
  scale: number,
): GalleryPanBounds {
  "worklet";
  const safeScale = Math.max(scale, 1);
  return {
    x: Math.max((fittedImage.width * safeScale - viewport.width) / 2, 0),
    y: Math.max((fittedImage.height * safeScale - viewport.height) / 2, 0),
  };
}

export function clampGalleryOffset(value: number, limit: number): number {
  "worklet";
  const safeLimit = Math.max(limit, 0);
  return Math.max(-safeLimit, Math.min(value, safeLimit));
}

/** Adds UIScrollView-like resistance while the finger is beyond an edge. */
export function rubberBandGalleryOffset(value: number, limit: number, resistance = 0.32): number {
  "worklet";
  const safeLimit = Math.max(limit, 0);
  const magnitude = Math.abs(value);
  if (magnitude <= safeLimit) return value;
  const resisted = safeLimit + (magnitude - safeLimit) * Math.max(0, Math.min(resistance, 1));
  return value < 0 ? -resisted : resisted;
}

export function aspectFitRect(size: GallerySize, container: GalleryFrame): GalleryFrame {
  if (size.width <= 0 || size.height <= 0 || container.width <= 0 || container.height <= 0)
    return container;
  const scale = Math.min(container.width / size.width, container.height / size.height);
  const width = size.width * scale;
  const height = size.height * scale;
  return {
    x: container.x + (container.width - width) / 2,
    y: container.y + (container.height - height) / 2,
    width,
    height,
  };
}
