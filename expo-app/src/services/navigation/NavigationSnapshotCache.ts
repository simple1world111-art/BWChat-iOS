const maximumSnapshotCount = 48;

interface NavigationSnapshotEntry {
  ownerId: string;
  value: unknown;
}

const snapshots = new Map<string, NavigationSnapshotEntry>();

/**
 * Keeps the last visible state of native-stack destinations in memory.
 *
 * Expo Router pops and unmounts destination screens when navigating back. The
 * persistent repositories remain the source of truth, while this small,
 * account-scoped LRU lets a remounted screen paint its previous data on the
 * first render and revalidate in the background after the native transition.
 */
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
  snapshots.set(key, { ownerId: owner, value });
  while (snapshots.size > maximumSnapshotCount) {
    const oldestKey = snapshots.keys().next().value as string | undefined;
    if (!oldestKey) break;
    snapshots.delete(oldestKey);
  }
}

export function clearNavigationSnapshotsForOwner(ownerId: string): void {
  const owner = ownerId.trim();
  if (!owner) return;
  for (const [key, entry] of snapshots) {
    if (entry.ownerId === owner) snapshots.delete(key);
  }
}

export function clearNavigationSnapshots(): void {
  snapshots.clear();
}

function snapshotKey(namespace: string, ownerId: string, variant: string): string | undefined {
  const normalizedNamespace = namespace.trim();
  const normalizedOwner = ownerId.trim();
  const normalizedVariant = variant.trim() || "default";
  if (!normalizedNamespace || !normalizedOwner || normalizedOwner === "anonymous") return undefined;
  return `${normalizedNamespace}\u0000${normalizedOwner}\u0000${normalizedVariant}`;
}
