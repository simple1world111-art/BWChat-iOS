export interface ChatImageSource {
  content: string;
  thumbnail_url?: string | undefined;
}

/**
 * The thumbnail is the image already presented in the message timeline. Keep
 * gallery and save actions on that same server-projected asset when one is
 * available so a mismatched original URL cannot replace it after activation.
 */
export function chatImagePresentationUrl(
  content: string,
  thumbnailUrl?: string | undefined,
): string {
  const thumbnail = thumbnailUrl?.trim();
  return thumbnail || content.trim();
}

export function chatImagePresentationUrlFor(message: ChatImageSource): string {
  return chatImagePresentationUrl(message.content, message.thumbnail_url);
}
