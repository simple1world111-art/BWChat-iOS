export interface MediaNaturalSize {
  width: number;
  height: number;
}

export interface MediaDisplaySize {
  width: number;
  height: number;
}

export { chatVideoThumbnailPath } from "@/services/messages/chatVideoPolicy";

export function chatImageThumbnailSize(size?: MediaNaturalSize): MediaDisplaySize {
  if (!size || size.width <= 0 || size.height <= 0) return { width: 160, height: 110 };
  const ratio = size.width / size.height;
  if (ratio < 0.85) return { width: 110, height: 156 };
  if (ratio > 1.18) return { width: 160, height: 110 };
  return { width: 140, height: 140 };
}

export function chatVideoThumbnailSize(size?: MediaNaturalSize): MediaDisplaySize {
  if (!size || size.width <= 0 || size.height <= 0) return { width: 200, height: 140 };
  const ratio = size.width / size.height;
  if (ratio < 0.9) return { width: 112, height: 160 };
  if (ratio > 1.1) return { width: 200, height: 140 };
  return { width: 150, height: 150 };
}
