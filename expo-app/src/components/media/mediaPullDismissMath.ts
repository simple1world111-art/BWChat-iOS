export const MEDIA_PULL_DIRECTION_LOCK_DISTANCE = 4;
export const MEDIA_PULL_VERTICAL_DIRECTION_RATIO = 1.12;
export const MEDIA_PULL_VISUAL_DEAD_ZONE = 18;
export const MEDIA_PULL_DISMISS_DISTANCE = 72;
export const MEDIA_PULL_MINIMUM_FLICK_DISTANCE = 28;
export const MEDIA_PULL_FLICK_VELOCITY = 900;

export const MEDIA_PULL_BACKDROP_FADE_DISTANCE = 320;
export const MEDIA_PULL_MINIMUM_BACKDROP_OPACITY = 0.25;
export const MEDIA_PULL_SCALE_START_DISTANCE = 32;
export const MEDIA_PULL_MINIMUM_SCALE = 0.78;
export const MEDIA_PULL_CONTENT_FADE_START_DISTANCE = 40;
export const MEDIA_PULL_CONTENT_FADE_END_VIEWPORT_RATIO = 0.72;

export const MEDIA_PULL_RESTORE_DURATION_MS = 160;
export const MEDIA_PULL_DISMISS_DURATION_MS = 240;

export function mediaPullHasVerticalIntent(translationX: number, translationY: number): boolean {
  "worklet";
  return Math.abs(translationY) > Math.abs(translationX) * MEDIA_PULL_VERTICAL_DIRECTION_RATIO;
}

export function mediaPullVisualTranslation(rawTranslation: number): number {
  "worklet";
  const magnitude = Math.abs(rawTranslation);
  if (magnitude <= MEDIA_PULL_VISUAL_DEAD_ZONE) return 0;
  const visibleMagnitude = magnitude - MEDIA_PULL_VISUAL_DEAD_ZONE;
  return rawTranslation < 0 ? -visibleMagnitude : visibleMagnitude;
}

export function mediaPullDismissDecision(translationY: number, velocityY: number): -1 | 0 | 1 {
  "worklet";
  const distance = Math.abs(translationY);
  const shouldDismiss =
    distance >= MEDIA_PULL_DISMISS_DISTANCE ||
    (distance >= MEDIA_PULL_MINIMUM_FLICK_DISTANCE &&
      Math.abs(velocityY) >= MEDIA_PULL_FLICK_VELOCITY);
  if (!shouldDismiss) return 0;
  const direction = translationY !== 0 ? translationY : velocityY;
  return direction < 0 ? -1 : 1;
}

export function mediaPullBackdropOpacity(visualTranslationY: number): number {
  "worklet";
  return Math.max(
    MEDIA_PULL_MINIMUM_BACKDROP_OPACITY,
    1 - Math.abs(visualTranslationY) / MEDIA_PULL_BACKDROP_FADE_DISTANCE,
  );
}

export function mediaPullScaleEndDistance(viewportHeight: number): number {
  "worklet";
  return Math.max(viewportHeight, MEDIA_PULL_SCALE_START_DISTANCE + 1);
}

export function mediaPullDismissScale(visualTranslationY: number, viewportHeight: number): number {
  "worklet";
  const distance = Math.abs(visualTranslationY);
  if (distance <= MEDIA_PULL_SCALE_START_DISTANCE) return 1;
  const endDistance = mediaPullScaleEndDistance(viewportHeight);
  const progress = Math.min(
    (distance - MEDIA_PULL_SCALE_START_DISTANCE) / (endDistance - MEDIA_PULL_SCALE_START_DISTANCE),
    1,
  );
  return 1 - progress * (1 - MEDIA_PULL_MINIMUM_SCALE);
}

export function mediaPullContentFadeEndDistance(viewportHeight: number): number {
  "worklet";
  return Math.max(
    viewportHeight * MEDIA_PULL_CONTENT_FADE_END_VIEWPORT_RATIO,
    MEDIA_PULL_CONTENT_FADE_START_DISTANCE + 1,
  );
}

export function mediaPullContentOpacity(
  visualTranslationY: number,
  viewportHeight: number,
): number {
  "worklet";
  const distance = Math.abs(visualTranslationY);
  if (distance <= MEDIA_PULL_CONTENT_FADE_START_DISTANCE) return 1;
  const endDistance = mediaPullContentFadeEndDistance(viewportHeight);
  return Math.max(
    1 -
      (distance - MEDIA_PULL_CONTENT_FADE_START_DISTANCE) /
        (endDistance - MEDIA_PULL_CONTENT_FADE_START_DISTANCE),
    0,
  );
}
