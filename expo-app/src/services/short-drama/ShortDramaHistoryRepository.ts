import AsyncStorage from "@react-native-async-storage/async-storage";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";

export interface ShortDramaHistoryRecord {
  series_id: string;
  episode_id: string;
  position_seconds: number;
  watched_at: string;
}

type HistoryListener = (ownerId: string) => void;

const historyListeners = new Set<HistoryListener>();
const writeQueues = new Map<string, Promise<void>>();
const repositoryGenerations = new Map<string, number>();

export function resetShortDramaHistoryRepositoryMemoryForAccount(ownerId: string): void {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  const key = shortDramaHistoryKey(owner);
  if (!key) return;
  repositoryGenerations.set(owner, repositoryGeneration(owner) + 1);
  if (writeQueues.has(key)) {
    void enqueueWrite(key, () => AsyncStorage.removeItem(key)).catch(() => undefined);
  }
}

export async function saveShortDramaHistory(
  ownerId: string,
  seriesId: string,
  episodeId: string,
  positionSeconds: number,
): Promise<void> {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  if (
    !owner ||
    !trimFoundationWhitespacesAndNewlines(seriesId) ||
    !trimFoundationWhitespacesAndNewlines(episodeId)
  )
    return;
  const series = seriesId;
  const episode = episodeId;
  const key = shortDramaHistoryKey(owner);
  const generation = repositoryGeneration(owner);
  let saved = false;
  await enqueueWrite(key, async () => {
    if (generation !== repositoryGeneration(owner)) return;
    const raw = await AsyncStorage.getItem(key);
    if (generation !== repositoryGeneration(owner)) return;
    let records: Record<string, ShortDramaHistoryRecord> = {};
    if (raw) {
      try {
        const decoded = JSON.parse(raw) as unknown;
        if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
          records = Object.fromEntries(
            Object.entries(decoded).filter(([, value]) => isHistoryRecord(value)),
          );
        }
      } catch {
        records = {};
      }
    }
    records[series] = {
      series_id: series,
      episode_id: episode,
      position_seconds: Math.max(0, Number.isFinite(positionSeconds) ? positionSeconds : 0),
      watched_at: new Date().toISOString(),
    };
    if (generation !== repositoryGeneration(owner)) return;
    await AsyncStorage.setItem(key, JSON.stringify(records));
    if (generation === repositoryGeneration(owner)) saved = true;
  });
  if (saved) for (const listener of historyListeners) listener(owner);
}

export async function readShortDramaHistory(
  ownerId: string,
): Promise<Record<string, ShortDramaHistoryRecord>> {
  const key = shortDramaHistoryKey(ownerId);
  if (!key) return {};
  await writeQueues.get(key)?.catch(() => undefined);
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  const generation = repositoryGeneration(owner);
  const raw = await AsyncStorage.getItem(key);
  if (generation !== repositoryGeneration(owner)) return {};
  if (!raw) return {};
  try {
    const decoded = JSON.parse(raw) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return {};
    return Object.fromEntries(
      Object.entries(decoded).filter(([, value]) => isHistoryRecord(value)),
    );
  } catch {
    return {};
  }
}

export function subscribeShortDramaHistory(listener: HistoryListener): () => void {
  historyListeners.add(listener);
  return () => historyListeners.delete(listener);
}

export function shortDramaHistoryKey(ownerId: string): string {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  return owner ? `bwchat.short-drama-history-v1:account:${encodeURIComponent(owner)}` : "";
}

function isHistoryRecord(value: unknown): value is ShortDramaHistoryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ShortDramaHistoryRecord>;
  return (
    typeof record.series_id === "string" &&
    typeof record.episode_id === "string" &&
    typeof record.position_seconds === "number" &&
    Number.isFinite(record.position_seconds) &&
    typeof record.watched_at === "string"
  );
}

function repositoryGeneration(ownerId: string): number {
  return repositoryGenerations.get(trimFoundationWhitespacesAndNewlines(ownerId)) ?? 0;
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
