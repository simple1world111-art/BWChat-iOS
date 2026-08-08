import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type {
  ShortDramaComment,
  ShortDramaInteractionResult,
  ShortDramaVideo,
  User,
} from "@/models";

export const shortDramaActionMetrics = {
  railGap: 18,
  creatorGap: 6,
  creatorAvatarSize: 48,
  creatorAvatarRadius: 11,
  creatorAvatarStroke: 2,
  followButtonSize: 26,
  followSymbolSize: 13,
  railWidth: 58,
  shadowOpacity: 0.45,
  shadowRadius: 8,
  shadowOffsetY: 2,
  buttonCopyGap: 5,
  buttonIconSize: 27,
  buttonIconWidth: 44,
  buttonIconHeight: 34,
  buttonCountSize: 11,
  buttonCountWidth: 54,
  buttonCountMinimumScale: 0.72,
} as const;

export const shortDramaCommentMetrics = {
  // Expo UI's iOS sheet host adds a fixed 16pt inset below the native drag indicator.
  // SwiftUI `.sheet` does not inset this view's root, so the screen cancels it while
  // retaining the native handle and medium/large detents.
  nativeSheetHostTopCompensation: 16,
  headerHorizontalInset: 18,
  headerVerticalInset: 14,
  headerTitleSize: 17,
  headerCountSize: 13,
  listHorizontalInset: 18,
  listVerticalInset: 10,
  loadingTopInset: 40,
  emptyGap: 10,
  emptyIconSize: 30,
  emptyTitleSize: 14,
  emptyTopInset: 48,
  loadMoreVerticalInset: 14,
  composerGap: 10,
  composerHorizontalInset: 16,
  composerVerticalInset: 12,
  composerInputHorizontalInset: 14,
  composerInputVerticalInset: 10,
  composerInputRadius: 18,
  composerInputSize: 15,
  composerInputLineHeight: 18,
  composerMaximumLines: 4,
  sendButtonWidth: 44,
  sendButtonHeight: 38,
  sendSymbolSize: 16,
  rowGap: 10,
  rowAvatarSize: 36,
  rowCopyGap: 4,
  rowHeaderGap: 8,
  rowNicknameSize: 13,
  rowTimestampSize: 11,
  rowContentSize: 14,
  rowVerticalInset: 10,
  pageLimit: 30,
  maximumCachedComments: 200,
  cacheTtlMilliseconds: 60_000,
  staleRetentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
  profileNavigationDelayMilliseconds: 220,
  toastMilliseconds: 2_000,
} as const;

export function compactShortDramaCount(value: number): string {
  const count = Math.trunc(value);
  if (count >= 1_000_000) return compactDecimal(count / 1_000_000, "M");
  if (count >= 10_000) return compactDecimal(count / 10_000, "W");
  if (count >= 1_000) return compactDecimal(count / 1_000, "K");
  return String(count);
}

export function optimisticShortDramaLike(video: ShortDramaVideo): {
  next: ShortDramaVideo;
  target: boolean;
} {
  const target = !video.liked_by_me;
  return {
    target,
    next: {
      ...video,
      liked_by_me: target,
      like_count: Math.max(0, video.like_count + (target ? 1 : -1)),
    },
  };
}

export function reconcileShortDramaLike(
  video: ShortDramaVideo,
  result: ShortDramaInteractionResult,
): ShortDramaVideo {
  return {
    ...video,
    ...(result.liked !== undefined ? { liked_by_me: result.liked } : {}),
    ...(result.like_count !== undefined ? { like_count: Math.max(0, result.like_count) } : {}),
  };
}

export function updateShortDramaCreatorFollow(
  videos: readonly ShortDramaVideo[],
  userId: string,
  followed: boolean,
): ShortDramaVideo[] {
  return videos.map((video) =>
    video.creator.user_id === userId
      ? { ...video, creator: { ...video.creator, followed_by_me: followed } }
      : video,
  );
}

export function appendNewShortDramaComments<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const existing = new Set(current.map((comment) => comment.id));
  return [...current, ...incoming.filter((comment) => !existing.has(comment.id))];
}

export function makeOptimisticShortDramaComment(input: {
  content: string;
  currentUser: Pick<User, "avatar_url" | "nickname" | "user_id"> | null;
  defaultNickname: string;
  temporaryId: string;
  videoId: string;
}): ShortDramaComment {
  return {
    id: input.temporaryId,
    video_id: input.videoId,
    user_id: input.currentUser?.user_id ?? "",
    nickname: input.currentUser?.nickname ?? input.defaultNickname,
    avatar_url: input.currentUser?.avatar_url ?? "",
    content: input.content,
    created_at: "",
  };
}

export function replaceOptimisticShortDramaComment(
  comments: readonly ShortDramaComment[],
  temporaryId: string,
  sent: ShortDramaComment,
): ShortDramaComment[] {
  return comments.map((comment) => (comment.id === temporaryId ? sent : comment));
}

export function removeOptimisticShortDramaComment(
  comments: readonly ShortDramaComment[],
  temporaryId: string,
): ShortDramaComment[] {
  return comments.filter((comment) => comment.id !== temporaryId);
}

export function formatShortDramaCommentTime(
  value: string,
  now = new Date(),
  yesterdayText = "昨天",
): string {
  const date = parseShortDramaCommentTimestamp(value);
  if (!date) return "";
  if (sameLocalDay(date, now)) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameLocalDay(date, yesterday)) return yesterdayText;
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

export function parseShortDramaCommentTimestamp(value: string): Date | null {
  const trimmed = trimFoundationWhitespacesAndNewlines(value);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})?$/u.exec(
      trimmed,
    );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = "", zone = ""] = match;
  if (trimmed.includes(" ") && zone) return null;
  const normalizedZone =
    zone.toUpperCase() === "Z"
      ? "Z"
      : /^[+-]\d{4}$/u.test(zone)
        ? `${zone.slice(0, 3)}:${zone.slice(3)}`
        : zone;
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${normalizedZone || "Z"}`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  if (!zone) {
    if (
      date.getUTCFullYear() !== Number(year) ||
      date.getUTCMonth() + 1 !== Number(month) ||
      date.getUTCDate() !== Number(day) ||
      date.getUTCHours() !== Number(hour) ||
      date.getUTCMinutes() !== Number(minute) ||
      date.getUTCSeconds() !== Number(second)
    ) {
      return null;
    }
  }
  return date;
}

function compactDecimal(value: number, suffix: string): string {
  const fixed = value.toFixed(1).replace(/\.0$/u, "");
  return `${fixed}${suffix}`;
}

function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
