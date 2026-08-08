import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeMomentFeedPage, normalizeShortDramaSeriesPage } from "@/api/normalizers";
import type {
  AgentSummary,
  Moment,
  MomentFeedPage,
  ShortDramaSeries,
  ShortDramaSeriesPage,
} from "@/models";

const momentKeyPrefix = "bwchat.profile-moments.v1";
const shortDramaKeyPrefix = "bwchat.profile-short-dramas.v1";
const schemaVersion = 2;

export const publicProfileContentCachePolicy = {
  moments: {
    ttlMilliseconds: 2 * 60 * 1_000,
    staleRetentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
  },
  shortDramas: {
    ttlMilliseconds: 5 * 60 * 1_000,
    staleRetentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
  },
} as const;

export interface ProfileContentCacheSnapshot<T> {
  page: T;
  updatedAt: number;
  expiresAt: number;
  isStale: boolean;
  isRetained: boolean;
  isLegacy: boolean;
}

type StoredProfileContent<T> = {
  schema_version: typeof schemaVersion;
  updated_at: number;
  expires_at: number;
  page: T;
};

export async function readCachedProfileMoments(
  ownerId: string,
  targetId: string,
): Promise<MomentFeedPage | null> {
  return (await readCachedProfileMomentsSnapshot(ownerId, targetId))?.page ?? null;
}

export async function readCachedProfileMomentsSnapshot(
  ownerId: string,
  targetId: string,
  now = Date.now(),
): Promise<ProfileContentCacheSnapshot<MomentFeedPage> | null> {
  try {
    const encoded = await AsyncStorage.getItem(cacheKey(momentKeyPrefix, ownerId, targetId));
    if (!encoded) return null;
    return decodeSnapshot(
      JSON.parse(encoded) as unknown,
      normalizeMomentFeedPage,
      publicProfileContentCachePolicy.moments.staleRetentionMilliseconds,
      now,
    );
  } catch {
    return null;
  }
}

export async function saveCachedProfileMoments(
  ownerId: string,
  targetId: string,
  page: MomentFeedPage,
  updatedAt = Date.now(),
): Promise<void> {
  const stored: StoredProfileContent<MomentFeedPage> = {
    schema_version: schemaVersion,
    updated_at: updatedAt,
    expires_at: updatedAt + publicProfileContentCachePolicy.moments.ttlMilliseconds,
    page: { ...page, moments: page.moments.slice(0, 200) },
  };
  await AsyncStorage.setItem(cacheKey(momentKeyPrefix, ownerId, targetId), JSON.stringify(stored));
}

export async function readCachedProfileShortDramas(
  ownerId: string,
  targetId: string,
): Promise<ShortDramaSeriesPage | null> {
  return (await readCachedProfileShortDramasSnapshot(ownerId, targetId))?.page ?? null;
}

export async function readCachedProfileShortDramasSnapshot(
  ownerId: string,
  targetId: string,
  now = Date.now(),
): Promise<ProfileContentCacheSnapshot<ShortDramaSeriesPage> | null> {
  try {
    const encoded = await AsyncStorage.getItem(cacheKey(shortDramaKeyPrefix, ownerId, targetId));
    if (!encoded) return null;
    return decodeSnapshot(
      JSON.parse(encoded) as unknown,
      normalizeShortDramaSeriesPage,
      publicProfileContentCachePolicy.shortDramas.staleRetentionMilliseconds,
      now,
    );
  } catch {
    return null;
  }
}

export async function saveCachedProfileShortDramas(
  ownerId: string,
  targetId: string,
  page: ShortDramaSeriesPage,
  updatedAt = Date.now(),
): Promise<void> {
  const stored: StoredProfileContent<ShortDramaSeriesPage> = {
    schema_version: schemaVersion,
    updated_at: updatedAt,
    expires_at: updatedAt + publicProfileContentCachePolicy.shortDramas.ttlMilliseconds,
    page: { ...page, series: page.series.slice(0, 200) },
  };
  await AsyncStorage.setItem(
    cacheKey(shortDramaKeyPrefix, ownerId, targetId),
    JSON.stringify(stored),
  );
}

export function shouldAcceptMomentFirstPage(
  page: MomentFeedPage,
  replacingLocalCount: number,
): boolean {
  if (page.moments.length > 0 || replacingLocalCount === 0) return true;
  return page.snapshot_complete === true;
}

export function mergeMoments(current: readonly Moment[], incoming: readonly Moment[]): Moment[] {
  const seen = new Set<number>();
  return [...current, ...incoming].filter((moment) => {
    if (seen.has(moment.id)) return false;
    seen.add(moment.id);
    return true;
  });
}

export function mergeProfileAgents(
  current: readonly AgentSummary[],
  incoming: readonly AgentSummary[],
): AgentSummary[] {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function visibleProfileShortDramas(
  series: readonly ShortDramaSeries[],
  targetId: string,
): ShortDramaSeries[] {
  const seen = new Set<string>();
  return series.filter(
    (item) =>
      item.status === "published" &&
      item.creator.user_id === targetId &&
      !seen.has(item.series_id) &&
      Boolean(seen.add(item.series_id)),
  );
}

export function mergeShortDramaSeries(
  current: readonly ShortDramaSeries[],
  incoming: readonly ShortDramaSeries[],
): ShortDramaSeries[] {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((item) => {
    if (seen.has(item.series_id)) return false;
    seen.add(item.series_id);
    return true;
  });
}

function decodeSnapshot<T>(
  decoded: unknown,
  normalize: (value: unknown) => T,
  staleRetentionMilliseconds: number,
  now: number,
): ProfileContentCacheSnapshot<T> {
  if (isStoredProfileContent(decoded)) {
    return {
      page: normalize(decoded.page),
      updatedAt: decoded.updated_at,
      expiresAt: decoded.expires_at,
      isStale: now >= decoded.expires_at,
      isRetained: now <= decoded.expires_at + staleRetentionMilliseconds,
      isLegacy: false,
    };
  }
  return {
    page: normalize(decoded),
    updatedAt: 0,
    expiresAt: 0,
    isStale: true,
    isRetained: true,
    isLegacy: true,
  };
}

function isStoredProfileContent(value: unknown): value is StoredProfileContent<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<StoredProfileContent<unknown>>;
  return (
    record.schema_version === schemaVersion &&
    typeof record.updated_at === "number" &&
    Number.isFinite(record.updated_at) &&
    typeof record.expires_at === "number" &&
    Number.isFinite(record.expires_at) &&
    record.page !== undefined
  );
}

function cacheKey(prefix: string, ownerId: string, targetId: string): string {
  return `${prefix}:${encodeURIComponent(ownerId)}:${encodeURIComponent(targetId)}`;
}
