import AsyncStorage from "@react-native-async-storage/async-storage";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type { ShortDramaFeedPage } from "@/models";
import { shortDramaFeedMetrics } from "@/services/short-drama/shortDramaFeedPolicy";

interface StoredFeed {
  value: ShortDramaFeedPage;
  updatedAt: number;
  expiresAt: number;
}

const inFlightLoads = new Map<string, Promise<ShortDramaFeedPage>>();
const writeQueues = new Map<string, Promise<void>>();
const repositoryGenerations = new Map<string, number>();

class ShortDramaFeedRepositoryResetError extends Error {
  constructor() {
    super("Short-drama feed repository was reset");
    this.name = "ShortDramaFeedRepositoryResetError";
  }
}

export interface CachedShortDramaFeed extends StoredFeed {
  isRetained: boolean;
  isStale: boolean;
}

export function resetShortDramaFeedRepositoryMemoryForAccount(ownerId: string): void {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!owner) return;
  repositoryGenerations.set(owner, repositoryGeneration(owner) + 1);
  const prefix = shortDramaFeedOwnerPrefix(owner);
  for (const key of inFlightLoads.keys()) {
    if (key.startsWith(prefix)) inFlightLoads.delete(key);
  }
  for (const key of writeQueues.keys()) {
    if (!key.startsWith(prefix)) continue;
    void enqueueWrite(key, () => AsyncStorage.removeItem(key)).catch(() => undefined);
  }
}

export async function loadShortDramaFeedCache(
  ownerId: string,
  seriesId?: string | undefined,
  now = Date.now(),
): Promise<CachedShortDramaFeed | null> {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  const key = shortDramaFeedCacheKey(ownerId, seriesId);
  if (!key) return null;
  const generation = repositoryGeneration(owner);
  const raw = await AsyncStorage.getItem(key);
  if (generation !== repositoryGeneration(owner)) return null;
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredFeed;
    if (
      !stored.value ||
      !Array.isArray(stored.value.videos) ||
      !Number.isFinite(stored.updatedAt) ||
      !Number.isFinite(stored.expiresAt)
    ) {
      await removeIfUnchanged(key, raw, owner, generation);
      return null;
    }
    return {
      ...stored,
      isRetained: now - stored.expiresAt <= shortDramaFeedMetrics.staleRetentionMilliseconds,
      isStale: now >= stored.expiresAt,
    };
  } catch {
    await removeIfUnchanged(key, raw, owner, generation);
    return null;
  }
}

export async function loadShortDramaFeed(
  ownerId: string,
  seriesId: string | undefined,
  fetch: () => Promise<ShortDramaFeedPage>,
): Promise<ShortDramaFeedPage> {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  const key = shortDramaFeedCacheKey(owner, seriesId);
  if (!key) return fetch();
  const generation = repositoryGeneration(owner);
  const cached = await loadShortDramaFeedCache(ownerId, seriesId);
  if (generation !== repositoryGeneration(owner)) {
    throw new ShortDramaFeedRepositoryResetError();
  }
  if (cached && !cached.isStale) return cached.value;
  let load = inFlightLoads.get(key);
  if (!load) {
    load = fetch()
      .then(async (page) => {
        if (generation !== repositoryGeneration(owner)) {
          throw new ShortDramaFeedRepositoryResetError();
        }
        await saveShortDramaFeedCache(owner, seriesId, page);
        if (generation !== repositoryGeneration(owner)) {
          throw new ShortDramaFeedRepositoryResetError();
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
    if (error instanceof ShortDramaFeedRepositoryResetError) throw error;
    if (cached?.isRetained) return cached.value;
    throw error;
  }
}

export async function saveShortDramaFeedCache(
  ownerId: string,
  seriesId: string | undefined,
  page: ShortDramaFeedPage,
  now = Date.now(),
): Promise<void> {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  const key = shortDramaFeedCacheKey(ownerId, seriesId);
  if (!key) return;
  const generation = repositoryGeneration(owner);
  const value = {
    ...page,
    videos: page.videos.slice(0, shortDramaFeedMetrics.maximumCachedVideos),
  };
  const encoded = JSON.stringify({
    value,
    updatedAt: now,
    expiresAt: now + shortDramaFeedMetrics.cacheTtlMilliseconds,
  } satisfies StoredFeed);
  await enqueueWrite(key, async () => {
    if (generation !== repositoryGeneration(owner)) return;
    await AsyncStorage.setItem(key, encoded);
  });
}

export function shortDramaFeedCacheKey(ownerId: string, seriesId?: string | undefined): string {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!owner) return "";
  const scope = seriesId !== undefined ? `series:${encodeURIComponent(seriesId)}` : "recommended";
  return `bwchat.short-drama-feed-v1:account:${encodeURIComponent(owner)}:${scope}`;
}

function shortDramaFeedOwnerPrefix(ownerId: string): string {
  return `bwchat.short-drama-feed-v1:account:${encodeURIComponent(trimFoundationWhitespacesAndNewlines(ownerId))}:`;
}

function repositoryGeneration(ownerId: string): number {
  return repositoryGenerations.get(trimFoundationWhitespacesAndNewlines(ownerId)) ?? 0;
}

async function removeIfUnchanged(
  key: string,
  encoded: string,
  ownerId: string,
  generation: number,
): Promise<void> {
  await enqueueWrite(key, async () => {
    if (generation !== repositoryGeneration(ownerId)) return;
    if ((await AsyncStorage.getItem(key)) === encoded) await AsyncStorage.removeItem(key);
  });
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
