export interface ChatImageSource {
  content: string;
  thumbnail_url?: string | undefined;
}

/** Uses the lightweight derivative while the image is rendered in the timeline. */
export function chatImageThumbnailUrl(content: string, thumbnailUrl?: string | undefined): string {
  const thumbnail = thumbnailUrl?.trim();
  return thumbnail || content.trim();
}

export function chatImageThumbnailUrlFor(message: ChatImageSource): string {
  return chatImageThumbnailUrl(message.content, message.thumbnail_url);
}

/**
 * Full-screen preview and save actions must use the original image. Falling
 * back to the thumbnail keeps historical/malformed records usable when their
 * original path is missing, without upscaling every valid thumbnail.
 */
export function chatImageOriginalUrl(content: string, thumbnailUrl?: string | undefined): string {
  const original = content.trim();
  return original || thumbnailUrl?.trim() || "";
}

export function chatImageOriginalUrlFor(message: ChatImageSource): string {
  return chatImageOriginalUrl(message.content, message.thumbnail_url);
}
