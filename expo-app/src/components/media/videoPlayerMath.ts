export const VIDEO_MINIMUM_SCALE = 0.5;
export const VIDEO_REST_SCALE_LIMIT = 1.05;
export const VIDEO_PAN_MINIMUM_DISTANCE = 10;
export const VIDEO_DISMISS_DISTANCE = 110;
export const VIDEO_PREDICTED_DISMISS_DISTANCE = 450;
export const VIDEO_PREDICTION_SECONDS = 0.2;

export function videoBackgroundOpacity(verticalDrag: number): number {
  return 1 - Math.min(Math.abs(verticalDrag) / 320, 0.9);
}

export function videoDismissScale(verticalDrag: number): number {
  const distance = Math.abs(verticalDrag);
  if (distance < 8) return 1;
  return Math.max(1 - distance / 900, 0.55);
}

export function predictedVideoTranslation(translation: number, velocity: number): number {
  return translation + velocity * VIDEO_PREDICTION_SECONDS;
}

export function shouldDismissVideo(input: {
  translationX: number;
  translationY: number;
  predictedTranslationY: number;
}): boolean {
  const vertical = Math.abs(input.translationY);
  return vertical > Math.abs(input.translationX) && (
    vertical > VIDEO_DISMISS_DISTANCE ||
    Math.abs(input.predictedTranslationY) > VIDEO_PREDICTED_DISMISS_DISTANCE
  );
}

export function resolveChatVideoPlaybackUrl(videoUrl: string, apiBaseUrl: string): string | null {
  let path = videoUrl.trim();
  if (!path) return null;
  if (path.startsWith("/api/v1/images/")) {
    path = path.replace("/api/v1/images/", "/api/v1/public/images/");
  }
  try {
    const parsed = new URL(path);
    if (["http:", "https:", "file:", "content:", "ph:"].includes(parsed.protocol)) {
      return parsed.toString();
    }
  } catch {
    // Resolve the original server-relative shapes below.
  }
  try {
    const api = new URL(apiBaseUrl);
    if (path.startsWith("/")) return new URL(path, api.origin).toString();
    return `${apiBaseUrl.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`;
  } catch {
    return null;
  }
}
