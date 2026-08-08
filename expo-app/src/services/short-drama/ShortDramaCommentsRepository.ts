import AsyncStorage from "@react-native-async-storage/async-storage";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type { ShortDramaCommentsPage } from "@/models";
import { shortDramaCommentMetrics } from "@/services/short-drama/shortDramaInteractionPolicy";

interface StoredComments {
  value: ShortDramaCommentsPage;
  updatedAt: number;
  expiresAt: number;
}

export interface CachedShortDramaComments extends StoredComments {
  isRetained: boolean;
  isStale: boolean;
}

export async function loadCachedShortDramaComments(
  ownerId: string,
  videoId: string,
  now = Date.now(),
): Promise<CachedShortDramaComments | null> {
  const key = shortDramaCommentsCacheKey(ownerId, videoId);
  if (!key) return null;
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const decoded: unknown = JSON.parse(raw);
    if (!isStoredComments(decoded)) {
      await removeInvalidCache(key);
      return null;
    }
    const stored = decoded;
    return {
      ...stored,
      isRetained: now - stored.expiresAt <= shortDramaCommentMetrics.staleRetentionMilliseconds,
      isStale: now >= stored.expiresAt,
    };
  } catch {
    await removeInvalidCache(key);
    return null;
  }
}

export async function saveCachedShortDramaComments(
  ownerId: string,
  videoId: string,
  page: ShortDramaCommentsPage,
  now = Date.now(),
): Promise<void> {
  const key = shortDramaCommentsCacheKey(ownerId, videoId);
  if (!key) return;
  const value = {
    ...page,
    comments: page.comments.slice(0, shortDramaCommentMetrics.maximumCachedComments),
  };
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        value,
        updatedAt: now,
        expiresAt: now + shortDramaCommentMetrics.cacheTtlMilliseconds,
      } satisfies StoredComments),
    );
  } catch {
    // Native snapshot persistence is fire-and-forget and cannot turn a successful comment into a failure.
  }
}

export function shortDramaCommentsCacheKey(ownerId: string, videoId: string): string {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  return owner
    ? `bwchat.short-drama-comments-v1:account:${encodeURIComponent(owner)}:video:${encodeURIComponent(videoId)}`
    : "";
}

function isStoredComments(value: unknown): value is StoredComments {
  if (!isRecord(value) || !isRecord(value.value)) return false;
  const page = value.value;
  return (
    Array.isArray(page.comments) &&
    page.comments.every(isStoredComment) &&
    typeof page.has_more === "boolean" &&
    (page.next_cursor === undefined || typeof page.next_cursor === "string") &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt) &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt)
  );
}

function isStoredComment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [
    value.id,
    value.video_id,
    value.user_id,
    value.nickname,
    value.avatar_url,
    value.content,
    value.created_at,
  ].every((field) => typeof field === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function removeInvalidCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // A failed cleanup must not block the network fallback.
  }
}
