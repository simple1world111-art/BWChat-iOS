import AsyncStorage from "@react-native-async-storage/async-storage";

const maximumSnapshotCount = 48;
const maximumSnapshotAgeMilliseconds = 30 * 24 * 60 * 60 * 1_000;
const storageKey = "bwchat.navigation-snapshots.v2";

interface NavigationSnapshotEntry {
  ownerId: string;
  value: unknown;
  savedAt: number;
}

interface StoredNavigationSnapshotEntry extends NavigationSnapshotEntry {
  key: string;
}

let snapshots = new Map<string, NavigationSnapshotEntry>();
let hydrated = false;
let hydration: Promise<void> | undefined;
let writeQueue = Promise.resolve();

/**
 * Restores the account-scoped LRU before route screens mount. Repositories
 * remain the source of truth and revalidate these display snapshots silently.
 */
export async function hydrateNavigationSnapshots(now = Date.now()): Promise<void> {
  if (hydrated) return;
  hydration ??= (async () => {
    const writtenWhileHydrating = snapshots;
    try {
      const encoded = await AsyncStorage.getItem(storageKey);
      const decoded: unknown = encoded ? JSON.parse(encoded) : [];
      const restored = decodeStoredEntries(decoded, now);
      for (const [key, entry] of writtenWhileHydrating) {
        restored.delete(key);
        restored.set(key, entry);
      }
      snapshots = restored;
      trimSnapshots();
      if (Array.isArray(decoded) && restored.size !== decoded.length) schedulePersistence();
    } catch {
      snapshots = new Map(writtenWhileHydrating);
    } finally {
      hydrated = true;
    }
  })();
  await hydration;
}

export function readNavigationSnapshot<T>(
  namespace: string,
  ownerId: string,
  variant = "default",
): T | undefined {
  const key = snapshotKey(namespace, ownerId, variant);
  if (!key) return undefined;
  const entry = snapshots.get(key);
  if (!entry) return undefined;
  snapshots.delete(key);
  snapshots.set(key, entry);
  schedulePersistence();
  return entry.value as T;
}

export function writeNavigationSnapshot<T>(
  namespace: string,
  ownerId: string,
  value: T,
  variant = "default",
): void {
  const owner = ownerId.trim();
  const key = snapshotKey(namespace, owner, variant);
  if (!key) return;
  snapshots.delete(key);
  snapshots.set(key, { ownerId: owner, value, savedAt: Date.now() });
  trimSnapshots();
  schedulePersistence();
}

export function clearNavigationSnapshotsForOwner(ownerId: string): void {
  const owner = ownerId.trim();
  if (!owner) return;
  let changed = false;
  for (const [key, entry] of snapshots) {
    if (entry.ownerId !== owner) continue;
    snapshots.delete(key);
    changed = true;
  }
  if (changed) schedulePersistence();
}

export function clearNavigationSnapshots(): void {
  snapshots.clear();
  schedulePersistence();
}

export async function waitForNavigationSnapshotPersistence(): Promise<void> {
  await writeQueue;
}

export function resetNavigationSnapshotCacheForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  snapshots = new Map();
  hydrated = false;
  hydration = undefined;
  writeQueue = Promise.resolve();
}

function decodeStoredEntries(input: unknown, now: number): Map<string, NavigationSnapshotEntry> {
  if (!Array.isArray(input)) return new Map();
  const restored = new Map<string, NavigationSnapshotEntry>();
  for (const value of input) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as Partial<StoredNavigationSnapshotEntry>;
    if (
      typeof candidate.key !== "string" ||
      typeof candidate.ownerId !== "string" ||
      typeof candidate.savedAt !== "number" ||
      candidate.ownerId.trim() === "" ||
      candidate.key.split("\u0000")[1] !== candidate.ownerId ||
      now - candidate.savedAt > maximumSnapshotAgeMilliseconds
    ) {
      continue;
    }
    restored.set(candidate.key, {
      ownerId: candidate.ownerId,
      value: candidate.value,
      savedAt: candidate.savedAt,
    });
  }
  return restored;
}

function trimSnapshots(): void {
  while (snapshots.size > maximumSnapshotCount) {
    const oldestKey = snapshots.keys().next().value as string | undefined;
    if (!oldestKey) break;
    snapshots.delete(oldestKey);
  }
}

function schedulePersistence(): void {
  const isEmpty = snapshots.size === 0;
  let encoded: string;
  try {
    encoded = JSON.stringify(
      [...snapshots].map(([key, entry]): StoredNavigationSnapshotEntry => ({ key, ...entry })),
    );
  } catch {
    return;
  }
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() =>
      isEmpty ? AsyncStorage.removeItem(storageKey) : AsyncStorage.setItem(storageKey, encoded),
    )
    .catch(() => undefined);
}

function snapshotKey(namespace: string, ownerId: string, variant: string): string | undefined {
  const normalizedNamespace = namespace.trim();
  const normalizedOwner = ownerId.trim();
  const normalizedVariant = variant.trim() || "default";
  if (!normalizedNamespace || !normalizedOwner || normalizedOwner === "anonymous") return undefined;
  return `${normalizedNamespace}\u0000${normalizedOwner}\u0000${normalizedVariant}`;
}
