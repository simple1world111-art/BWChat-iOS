import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeFollowUsersPage } from "@/api/normalizers";
import type { FollowUsersPage } from "@/models";

const keyPrefix = "bwchat.follow-list.v1";
const schemaVersion = 2;

export const followListCachePolicy = {
  ttlMilliseconds: 10 * 60 * 1_000,
  staleRetentionMilliseconds: 90 * 24 * 60 * 60 * 1_000,
} as const;

export type FollowListKind = "following" | "followers";

export interface FollowListCacheSnapshot {
  page: FollowUsersPage;
  updatedAt: number;
  expiresAt: number;
  isStale: boolean;
  isRetained: boolean;
  isLegacy: boolean;
}

type StoredFollowList = {
  schema_version: typeof schemaVersion;
  updated_at: number;
  expires_at: number;
  page: FollowUsersPage;
};

export type FollowListCacheMutation = FollowUsersPage | "invalidate" | null;

const inFlightLoads = new Map<string, Promise<FollowUsersPage>>();
const writeQueues = new Map<string, Promise<void>>();
const repositoryGenerations = new Map<string, number>();

class FollowListRepositoryResetError extends Error {
  constructor() {
    super("Follow-list repository was reset");
    this.name = "FollowListRepositoryResetError";
  }
}

export function resetFollowListRepositoryMemoryForAccount(ownerId: string): void {
  const normalizedOwnerId = ownerId.trim();
  if (!normalizedOwnerId) return;
  repositoryGenerations.set(normalizedOwnerId, repositoryGeneration(normalizedOwnerId) + 1);
  const ownerPrefix = `${keyPrefix}:${encodeURIComponent(normalizedOwnerId)}:`;
  for (const key of inFlightLoads.keys()) {
    if (key.startsWith(ownerPrefix)) inFlightLoads.delete(key);
  }
  for (const key of writeQueues.keys()) {
    if (key.startsWith(ownerPrefix)) writeQueues.delete(key);
  }
}

export function isFollowListRepositoryResetError(
  error: unknown,
): error is FollowListRepositoryResetError {
  return error instanceof FollowListRepositoryResetError;
}

export async function readCachedFollowList(
  ownerId: string,
  subjectId: string,
  kind: FollowListKind,
): Promise<FollowUsersPage | null> {
  return (await readCachedFollowListSnapshot(ownerId, subjectId, kind))?.page ?? null;
}

export async function readCachedFollowListSnapshot(
  ownerId: string,
  subjectId: string,
  kind: FollowListKind,
  now = Date.now(),
): Promise<FollowListCacheSnapshot | null> {
  try {
    return decodeSnapshot(await AsyncStorage.getItem(cacheKey(ownerId, subjectId, kind)), now);
  } catch {
    return null;
  }
}

export async function saveCachedFollowList(
  ownerId: string,
  subjectId: string,
  kind: FollowListKind,
  page: FollowUsersPage,
  updatedAt = Date.now(),
): Promise<void> {
  const key = cacheKey(ownerId, subjectId, kind);
  const generation = repositoryGeneration(ownerId);
  await enqueueWrite(key, async () => {
    if (generation !== repositoryGeneration(ownerId)) return;
    await writePage(key, page, updatedAt);
  });
}

export async function mutateCachedFollowList(
  ownerId: string,
  subjectId: string,
  kind: FollowListKind,
  mutation: (page: FollowUsersPage) => FollowListCacheMutation,
  updatedAt = Date.now(),
): Promise<void> {
  const key = cacheKey(ownerId, subjectId, kind);
  const generation = repositoryGeneration(ownerId);
  await enqueueWrite(key, async () => {
    if (generation !== repositoryGeneration(ownerId)) return;
    const snapshot = decodeSnapshot(await AsyncStorage.getItem(key), updatedAt);
    if (generation !== repositoryGeneration(ownerId)) return;
    if (!snapshot) return;
    const next = mutation(snapshot.page);
    if (next === null) return;
    if (next === "invalidate") {
      const stored = storedPage(snapshot.page, snapshot.updatedAt || updatedAt);
      stored.expires_at = 0;
      await AsyncStorage.setItem(key, JSON.stringify(stored));
      return;
    }
    await writePage(key, next, updatedAt);
  });
}

export async function loadCachedFollowListPage(
  ownerId: string,
  subjectId: string,
  kind: FollowListKind,
  forceRefresh: boolean,
  fetchPage: () => Promise<FollowUsersPage>,
  now = Date.now(),
): Promise<FollowUsersPage> {
  const key = cacheKey(ownerId, subjectId, kind);
  const generation = repositoryGeneration(ownerId);
  const cached = await readCachedFollowListSnapshot(ownerId, subjectId, kind, now);
  if (generation !== repositoryGeneration(ownerId)) {
    throw new FollowListRepositoryResetError();
  }
  if (cached && !cached.isStale && !forceRefresh) return cached.page;

  let load = inFlightLoads.get(key);
  if (!load) {
    load = fetchPage()
      .then(async (page) => {
        if (generation !== repositoryGeneration(ownerId)) {
          throw new FollowListRepositoryResetError();
        }
        await saveCachedFollowList(ownerId, subjectId, kind, page).catch(() => undefined);
        if (generation !== repositoryGeneration(ownerId)) {
          throw new FollowListRepositoryResetError();
        }
        return page;
      })
      .finally(() => {
        if (inFlightLoads.get(key) === load) inFlightLoads.delete(key);
      });
    inFlightLoads.set(key, load);
  }
  try {
    return await load;
  } catch (error) {
    if (isFollowListRepositoryResetError(error)) throw error;
    if (cached?.isRetained) return cached.page;
    throw error;
  }
}

function cacheKey(ownerId: string, subjectId: string, kind: FollowListKind): string {
  return `${keyPrefix}:${encodeURIComponent(ownerId)}:${encodeURIComponent(subjectId)}:${kind}`;
}

function decodeSnapshot(encoded: string | null, now: number): FollowListCacheSnapshot | null {
  if (!encoded) return null;
  try {
    const decoded: unknown = JSON.parse(encoded);
    if (isStoredFollowList(decoded)) {
      const page = normalizeFollowUsersPage(decoded.page);
      return {
        page,
        updatedAt: decoded.updated_at,
        expiresAt: decoded.expires_at,
        isStale: now >= decoded.expires_at,
        isRetained: now <= decoded.expires_at + followListCachePolicy.staleRetentionMilliseconds,
        isLegacy: false,
      };
    }
    return {
      page: normalizeFollowUsersPage(decoded),
      updatedAt: 0,
      expiresAt: 0,
      isStale: true,
      isRetained: false,
      isLegacy: true,
    };
  } catch {
    return null;
  }
}

function isStoredFollowList(value: unknown): value is StoredFollowList {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<StoredFollowList>;
  return (
    record.schema_version === schemaVersion &&
    typeof record.updated_at === "number" &&
    Number.isFinite(record.updated_at) &&
    typeof record.expires_at === "number" &&
    Number.isFinite(record.expires_at) &&
    record.page !== undefined
  );
}

function storedPage(page: FollowUsersPage, updatedAt: number): StoredFollowList {
  return {
    schema_version: schemaVersion,
    updated_at: updatedAt,
    expires_at: updatedAt + followListCachePolicy.ttlMilliseconds,
    page: { ...page, users: page.users.slice(0, 500) },
  };
}

async function writePage(key: string, page: FollowUsersPage, updatedAt: number): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(storedPage(page, updatedAt)));
}

async function enqueueWrite(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  writeQueues.set(key, current);
  try {
    await current;
  } finally {
    if (writeQueues.get(key) === current) writeQueues.delete(key);
  }
}

function repositoryGeneration(ownerId: string): number {
  return repositoryGenerations.get(ownerId.trim()) ?? 0;
}
