import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizePublicProfile } from "@/api/normalizers";
import type { PublicProfile } from "@/models";

const keyPrefix = "bwchat.public-profile.v1";
const schemaVersion = 2;

export const publicProfileCachePolicy = {
  ttlMilliseconds: 10 * 60 * 1_000,
  staleRetentionMilliseconds: 90 * 24 * 60 * 60 * 1_000,
} as const;

export interface PublicProfileCacheSnapshot {
  profile: PublicProfile;
  updatedAt: number;
  expiresAt: number;
  isStale: boolean;
  isRetained: boolean;
  isLegacy: boolean;
}

type StoredPublicProfile = {
  schema_version: typeof schemaVersion;
  updated_at: number;
  expires_at: number;
  profile: PublicProfile;
};

export async function readCachedPublicProfile(
  ownerId: string,
  userId: string,
): Promise<PublicProfile | null> {
  return (await readCachedPublicProfileSnapshot(ownerId, userId))?.profile ?? null;
}

export async function readCachedPublicProfileSnapshot(
  ownerId: string,
  userId: string,
  now = Date.now(),
): Promise<PublicProfileCacheSnapshot | null> {
  try {
    const encoded = await AsyncStorage.getItem(cacheKey(ownerId, userId));
    if (!encoded) return null;
    const decoded: unknown = JSON.parse(encoded);
    if (isStoredPublicProfile(decoded)) {
      const profile = normalizePublicProfile(decoded.profile);
      if (!profile.user_id) return null;
      return {
        profile,
        updatedAt: decoded.updated_at,
        expiresAt: decoded.expires_at,
        isStale: now >= decoded.expires_at,
        isRetained: now <= decoded.expires_at + publicProfileCachePolicy.staleRetentionMilliseconds,
        isLegacy: false,
      };
    }
    const profile = normalizePublicProfile(decoded);
    return profile.user_id
      ? {
          profile,
          updatedAt: 0,
          expiresAt: 0,
          isStale: true,
          isRetained: true,
          isLegacy: true,
        }
      : null;
  } catch {
    return null;
  }
}

export async function saveCachedPublicProfile(
  ownerId: string,
  profile: PublicProfile,
  cacheUserId = profile.user_id,
  updatedAt = Date.now(),
): Promise<void> {
  const stored: StoredPublicProfile = {
    schema_version: schemaVersion,
    updated_at: updatedAt,
    expires_at: updatedAt + publicProfileCachePolicy.ttlMilliseconds,
    profile,
  };
  await AsyncStorage.setItem(cacheKey(ownerId, cacheUserId), JSON.stringify(stored));
}

function isStoredPublicProfile(value: unknown): value is StoredPublicProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<StoredPublicProfile>;
  return (
    record.schema_version === schemaVersion &&
    typeof record.updated_at === "number" &&
    Number.isFinite(record.updated_at) &&
    typeof record.expires_at === "number" &&
    Number.isFinite(record.expires_at) &&
    record.profile !== undefined
  );
}

function cacheKey(ownerId: string, userId: string): string {
  return `${keyPrefix}:${encodeURIComponent(ownerId)}:${encodeURIComponent(userId)}`;
}
