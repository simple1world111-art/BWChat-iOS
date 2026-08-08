import AsyncStorage from "@react-native-async-storage/async-storage";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type { ShortDramaSeriesFilter, ShortDramaSeriesPage } from "@/models";
import { shortDramaSeriesMetrics } from "@/services/short-drama/shortDramaSeriesPolicy";

interface StoredSeriesPage {
  value: ShortDramaSeriesPage;
  updatedAt: number;
  expiresAt: number;
}

const inFlightInitialLoads = new Map<string, Promise<ShortDramaSeriesPage>>();
const writeQueues = new Map<string, Promise<void>>();
const repositoryGenerations = new Map<string, number>();

class ShortDramaSeriesRepositoryResetError extends Error {
  constructor() {
    super("Short-drama series repository was reset");
    this.name = "ShortDramaSeriesRepositoryResetError";
  }
}

export function isShortDramaSeriesRepositoryResetError(error: unknown): boolean {
  return error instanceof ShortDramaSeriesRepositoryResetError;
}

export interface CachedShortDramaSeriesPage extends StoredSeriesPage {
  isStale: boolean;
}

export function resetShortDramaSeriesRepositoryMemoryForAccount(ownerId: string): void {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!owner) return;
  repositoryGenerations.set(owner, repositoryGeneration(owner) + 1);
  const prefix = shortDramaSeriesOwnerPrefix(owner);
  for (const key of inFlightInitialLoads.keys()) {
    if (key.startsWith(prefix)) inFlightInitialLoads.delete(key);
  }
  for (const key of writeQueues.keys()) {
    if (!key.startsWith(prefix)) continue;
    void enqueueWrite(key, () => AsyncStorage.removeItem(key)).catch(() => undefined);
  }
}

export async function loadCachedShortDramaSeriesPage(
  ownerId: string,
  filter: ShortDramaSeriesFilter,
  now = Date.now(),
): Promise<CachedShortDramaSeriesPage | null> {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  const key = shortDramaSeriesCacheKey(ownerId, filter);
  if (!key) return null;
  const generation = repositoryGeneration(owner);
  const raw = await AsyncStorage.getItem(key);
  if (generation !== repositoryGeneration(owner)) return null;
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredSeriesPage;
    if (
      !stored.value ||
      !Array.isArray(stored.value.series) ||
      !Number.isFinite(stored.updatedAt) ||
      !Number.isFinite(stored.expiresAt)
    ) {
      await removeIfUnchanged(key, raw, owner, generation);
      return null;
    }
    if (now - stored.expiresAt > shortDramaSeriesMetrics.staleRetentionMilliseconds) {
      await removeIfUnchanged(key, raw, owner, generation);
      return null;
    }
    return { ...stored, isStale: now >= stored.expiresAt };
  } catch {
    await removeIfUnchanged(key, raw, owner, generation);
    return null;
  }
}

export async function coalesceShortDramaSeriesInitialLoad(
  ownerId: string,
  filter: ShortDramaSeriesFilter,
  fetch: () => Promise<ShortDramaSeriesPage>,
): Promise<ShortDramaSeriesPage> {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  const key = shortDramaSeriesCacheKey(owner, filter);
  if (!key) return fetch();
  const generation = repositoryGeneration(owner);
  let load = inFlightInitialLoads.get(key);
  if (!load) {
    load = fetch()
      .then((page) => {
        if (generation !== repositoryGeneration(owner)) {
          throw new ShortDramaSeriesRepositoryResetError();
        }
        return page;
      })
      .finally(() => {
        if (inFlightInitialLoads.get(key) === load) inFlightInitialLoads.delete(key);
      });
    inFlightInitialLoads.set(key, load);
  }
  return load;
}

export async function saveCachedShortDramaSeriesPage(
  ownerId: string,
  filter: ShortDramaSeriesFilter,
  page: ShortDramaSeriesPage,
  now = Date.now(),
): Promise<void> {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  const key = shortDramaSeriesCacheKey(ownerId, filter);
  if (!key) return;
  const generation = repositoryGeneration(owner);
  const value = {
    ...page,
    series: page.series.slice(0, shortDramaSeriesMetrics.maximumCachedSeries),
  };
  const encoded = JSON.stringify({
    value,
    updatedAt: now,
    expiresAt: now + shortDramaSeriesMetrics.cacheTtlMilliseconds,
  } satisfies StoredSeriesPage);
  await enqueueWrite(key, async () => {
    if (generation !== repositoryGeneration(owner)) return;
    await AsyncStorage.setItem(key, encoded);
  });
}

export function shortDramaSeriesCacheKey(ownerId: string, filter: ShortDramaSeriesFilter): string {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  return owner
    ? `bwchat.short-drama-series-v1:account:${encodeURIComponent(owner)}:filter:${filter}`
    : "";
}

function shortDramaSeriesOwnerPrefix(ownerId: string): string {
  return `bwchat.short-drama-series-v1:account:${encodeURIComponent(
    trimFoundationWhitespacesAndNewlines(ownerId),
  )}:`;
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
