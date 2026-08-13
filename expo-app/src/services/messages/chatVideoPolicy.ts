export const chatVideoPreparationPolicy = {
  thumbnailMaximumSize: 480,
  thumbnailQuality: 0.62,
  readyTimeoutMilliseconds: 30_000,
  uploadTimeoutMilliseconds: 600_000,
} as const;

export function chatVideoThumbnailPath(videoUrl: string): string {
  const dot = videoUrl.lastIndexOf(".");
  return `${dot >= 0 ? videoUrl.slice(0, dot) : videoUrl}_thumb.jpg`;
}

export function chatVideoThumbnailFilename(filename: string): string {
  const withoutQuery = filename.split("?")[0] ?? filename;
  const slash = Math.max(withoutQuery.lastIndexOf("/"), withoutQuery.lastIndexOf("\\"));
  const leaf = withoutQuery.slice(slash + 1);
  const dot = leaf.lastIndexOf(".");
  return `${dot > 0 ? leaf.slice(0, dot) : leaf}_thumb.jpg`;
}

export function chatVideoMimeType(filename: string, explicit?: string): string {
  const normalized = explicit?.trim().toLocaleLowerCase();
  if (normalized?.startsWith("video/")) return normalized;
  const extension = filename.split(".").pop()?.toLocaleLowerCase();
  if (extension === "mov") return "video/quicktime";
  if (extension === "m4v") return "video/x-m4v";
  return "video/mp4";
}
