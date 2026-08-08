import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  normalizeFriendInfo,
  normalizeRequiredFriendRequest,
  trimFoundationWhitespacesAndNewlines,
} from "@/api/normalizers";
import type { FriendInfo, FriendRequest } from "@/models";

const friendsPrefix = "bwchat.friends.v1";
const friendsMetadataPrefix = "bwchat.friends-metadata.v1";
const requestsPrefix = "bwchat.friend-requests.v1";
const requestsMetadataPrefix = "bwchat.friend-requests-metadata.v1";

export const friendListCachePolicy = Object.freeze({
  ttlMilliseconds: 2 * 60 * 1_000,
  staleRetentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
});

export const friendRequestCachePolicy = friendListCachePolicy;

type FriendListCacheSnapshot = {
  friends: FriendInfo[];
  savedAt?: number | undefined;
};

type LoadFriendsOptions = {
  forceRefresh?: boolean | undefined;
  now?: number | undefined;
};

type FriendRequestCacheSnapshot = {
  requests: FriendRequest[];
  savedAt?: number | undefined;
};

const friendListLoads = new Map<string, Promise<FriendInfo[]>>();
const friendRequestLoads = new Map<string, Promise<FriendRequest[]>>();
const friendCacheWrites = new Map<string, Promise<void>>();
const resolvedFriendRequestIds = new Map<string, Set<number>>();
const friendRepositoryGenerations = new Map<string, number>();

export function resetFriendRepositoryMemoryForAccount(ownerId: string): void {
  const normalizedOwnerId = normalizeOwnerId(ownerId);
  if (!normalizedOwnerId) return;
  friendRepositoryGenerations.set(
    normalizedOwnerId,
    friendRepositoryGeneration(normalizedOwnerId) + 1,
  );
  friendListLoads.delete(cacheKey(friendsPrefix, normalizedOwnerId));
  friendRequestLoads.delete(cacheKey(requestsPrefix, normalizedOwnerId));
  resolvedFriendRequestIds.delete(normalizedOwnerId);
}

export async function waitForFriendRepositoryPersistenceForAccount(ownerId: string): Promise<void> {
  const normalizedOwnerId = normalizeOwnerId(ownerId);
  if (!normalizedOwnerId) return;
  const writes = [
    friendCacheWrites.get(cacheKey(friendsPrefix, normalizedOwnerId)),
    friendCacheWrites.get(cacheKey(requestsPrefix, normalizedOwnerId)),
  ].filter((write): write is Promise<void> => write !== undefined);
  await Promise.allSettled(writes);
}

export async function waitForAllFriendRepositoryPersistence(): Promise<void> {
  await Promise.allSettled([...friendCacheWrites.values()]);
}

export async function loadCachedFriends(ownerId: string): Promise<FriendInfo[]> {
  const owner = normalizeOwnerId(ownerId);
  if (!owner) return [];
  return readArray(
    cacheKey(friendsPrefix, owner),
    normalizeFriendInfo,
    (item) => item.user_id.length > 0,
  );
}

export async function saveCachedFriends(
  ownerId: string,
  friends: readonly FriendInfo[],
): Promise<void> {
  const owner = normalizeOwnerId(ownerId);
  if (!owner) return;
  await saveCachedFriendsAt(owner, friends, Date.now(), friendRepositoryGeneration(owner));
}

export async function loadFriendsWithNativeCache(
  ownerId: string,
  fetchFriends: () => Promise<FriendInfo[]>,
  options: LoadFriendsOptions = {},
): Promise<FriendInfo[]> {
  const owner = normalizeOwnerId(ownerId);
  if (!owner) return [];
  const generation = friendRepositoryGeneration(owner);
  const now = options.now ?? Date.now();
  const snapshot = await readFriendListSnapshot(owner);
  if (!options.forceRefresh && snapshot && snapshot.savedAt === undefined) {
    // Native migrates its legacy array into the snapshot repository as a fresh list.
    await saveFriendListMetadata(owner, now, generation).catch(() => undefined);
    return snapshot.friends;
  }
  if (
    !options.forceRefresh &&
    snapshot?.savedAt !== undefined &&
    now - snapshot.savedAt <= friendListCachePolicy.ttlMilliseconds
  ) {
    return snapshot.friends;
  }

  const loadKey = cacheKey(friendsPrefix, owner);
  const inFlight = friendListLoads.get(loadKey);
  if (inFlight) return inFlight;

  const load = (async () => {
    try {
      const fetched = await fetchFriends();
      // Cache persistence must never turn a successful native network response into a UI error.
      if (generation === friendRepositoryGeneration(owner)) {
        await saveCachedFriendsAt(owner, fetched, now, generation).catch(() => undefined);
      }
      return fetched;
    } catch (error) {
      if (
        snapshot?.savedAt !== undefined &&
        now - snapshot.savedAt <=
          friendListCachePolicy.ttlMilliseconds + friendListCachePolicy.staleRetentionMilliseconds
      ) {
        return snapshot.friends;
      }
      throw error;
    }
  })().finally(() => {
    if (friendListLoads.get(loadKey) === load) friendListLoads.delete(loadKey);
  });
  friendListLoads.set(loadKey, load);
  return load;
}

export async function loadCachedFriendRequests(ownerId: string): Promise<FriendRequest[]> {
  const owner = normalizeOwnerId(ownerId);
  if (!owner) return [];
  return readFriendRequestArray(cacheKey(requestsPrefix, owner));
}

export async function saveCachedFriendRequests(
  ownerId: string,
  requests: readonly FriendRequest[],
): Promise<void> {
  const owner = normalizeOwnerId(ownerId);
  if (!owner) return;
  await saveCachedFriendRequestsAt(owner, requests, Date.now(), friendRepositoryGeneration(owner));
}

export async function loadFriendRequestsWithNativeCache(
  ownerId: string,
  fetchRequests: () => Promise<FriendRequest[]>,
  options: LoadFriendsOptions = {},
): Promise<FriendRequest[]> {
  const owner = normalizeOwnerId(ownerId);
  if (!owner) return [];
  const generation = friendRepositoryGeneration(owner);
  const now = options.now ?? Date.now();
  const snapshot = await readFriendRequestSnapshot(owner);
  if (
    !options.forceRefresh &&
    snapshot &&
    snapshot.savedAt === undefined &&
    snapshot.requests.length > 0
  ) {
    // Native promotes only a non-empty legacy request array into a fresh list snapshot.
    const migrated = reconcileResolvedFriendRequests(owner, snapshot.requests);
    await saveCachedFriendRequestsAt(owner, migrated, now, generation).catch(() => undefined);
    return migrated;
  }
  if (
    !options.forceRefresh &&
    snapshot?.savedAt !== undefined &&
    now - snapshot.savedAt <= friendRequestCachePolicy.ttlMilliseconds
  ) {
    return reconcileResolvedFriendRequests(owner, snapshot.requests);
  }

  const loadKey = cacheKey(requestsPrefix, owner);
  const inFlight = friendRequestLoads.get(loadKey);
  if (inFlight) return inFlight;

  const load = (async () => {
    try {
      const fetched = reconcileResolvedFriendRequests(owner, await fetchRequests());
      if (generation === friendRepositoryGeneration(owner)) {
        await saveCachedFriendRequestsAt(owner, fetched, now, generation).catch(() => undefined);
      }
      return fetched;
    } catch (error) {
      if (
        snapshot?.savedAt !== undefined &&
        now - snapshot.savedAt <=
          friendRequestCachePolicy.ttlMilliseconds +
            friendRequestCachePolicy.staleRetentionMilliseconds
      ) {
        return reconcileResolvedFriendRequests(owner, snapshot.requests);
      }
      throw error;
    }
  })().finally(() => {
    if (friendRequestLoads.get(loadKey) === load) friendRequestLoads.delete(loadKey);
  });
  friendRequestLoads.set(loadKey, load);
  return load;
}

export async function markFriendRequestResolved(ownerId: string, requestId: number): Promise<void> {
  const owner = normalizeOwnerId(ownerId);
  if (!owner) return;
  const generation = friendRepositoryGeneration(owner);
  const writeKey = cacheKey(requestsPrefix, owner);
  const resolved = resolvedFriendRequestIds.get(owner) ?? new Set<number>();
  resolved.add(requestId);
  resolvedFriendRequestIds.set(owner, resolved);
  let persisted = false;
  try {
    await enqueueFriendCacheWrite(writeKey, async () => {
      if (generation !== friendRepositoryGeneration(owner)) return;
      const snapshot = await readFriendRequestSnapshot(owner);
      if (generation !== friendRepositoryGeneration(owner)) return;
      const requests = (snapshot?.requests ?? []).filter(
        (request) => request.request_id !== requestId,
      );
      await writeFriendRequestSnapshot(owner, requests, Date.now());
      persisted = true;
    });
  } finally {
    if (!persisted || generation !== friendRepositoryGeneration(owner)) return;
    const inFlight = friendRequestLoads.get(writeKey);
    if (inFlight) {
      void inFlight
        .finally(() => clearResolvedFriendRequestId(owner, requestId, generation))
        .catch(() => undefined);
    } else {
      clearResolvedFriendRequestId(owner, requestId, generation);
    }
  }
}

async function readArray<T>(
  key: string,
  normalize: (value: unknown) => T,
  include: (value: T) => boolean,
): Promise<T[]> {
  try {
    const encoded = await AsyncStorage.getItem(key);
    if (!encoded) return [];
    const decoded: unknown = JSON.parse(encoded);
    return Array.isArray(decoded) ? decoded.map(normalize).filter(include) : [];
  } catch {
    return [];
  }
}

async function readFriendRequestArray(key: string): Promise<FriendRequest[]> {
  try {
    const encoded = await AsyncStorage.getItem(key);
    if (!encoded) return [];
    const decoded: unknown = JSON.parse(encoded);
    if (!Array.isArray(decoded)) return [];
    return decoded.map(normalizeRequiredFriendRequest);
  } catch {
    // Native Codable rejects the complete cached array when any required row is malformed.
    return [];
  }
}

function cacheKey(prefix: string, ownerId: string): string {
  return `${prefix}:${encodeURIComponent(ownerId)}`;
}

async function saveCachedFriendsAt(
  ownerId: string,
  friends: readonly FriendInfo[],
  savedAt: number,
  generation: number,
): Promise<void> {
  const writeKey = cacheKey(friendsPrefix, ownerId);
  await enqueueFriendCacheWrite(writeKey, async () => {
    if (generation !== friendRepositoryGeneration(ownerId)) return;
    await Promise.all([
      AsyncStorage.setItem(writeKey, JSON.stringify(friends)),
      AsyncStorage.setItem(cacheKey(friendsMetadataPrefix, ownerId), JSON.stringify({ savedAt })),
    ]);
  });
}

async function saveCachedFriendRequestsAt(
  ownerId: string,
  requests: readonly FriendRequest[],
  savedAt: number,
  generation: number,
): Promise<void> {
  const writeKey = cacheKey(requestsPrefix, ownerId);
  await enqueueFriendCacheWrite(writeKey, async () => {
    if (generation !== friendRepositoryGeneration(ownerId)) return;
    await writeFriendRequestSnapshot(ownerId, requests, savedAt);
  });
}

async function enqueueFriendCacheWrite(
  writeKey: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = friendCacheWrites.get(writeKey) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(operation);
  friendCacheWrites.set(writeKey, write);
  try {
    await write;
  } finally {
    if (friendCacheWrites.get(writeKey) === write) {
      friendCacheWrites.delete(writeKey);
    }
  }
}

async function writeFriendRequestSnapshot(
  ownerId: string,
  requests: readonly FriendRequest[],
  savedAt: number,
): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(cacheKey(requestsPrefix, ownerId), JSON.stringify(requests)),
    AsyncStorage.setItem(cacheKey(requestsMetadataPrefix, ownerId), JSON.stringify({ savedAt })),
  ]);
}

async function saveFriendListMetadata(
  ownerId: string,
  savedAt: number,
  generation: number,
): Promise<void> {
  await enqueueFriendCacheWrite(cacheKey(friendsPrefix, ownerId), async () => {
    if (generation !== friendRepositoryGeneration(ownerId)) return;
    await AsyncStorage.setItem(
      cacheKey(friendsMetadataPrefix, ownerId),
      JSON.stringify({ savedAt }),
    );
  });
}

async function readFriendListSnapshot(ownerId: string): Promise<FriendListCacheSnapshot | null> {
  try {
    const [encodedFriends, encodedMetadata] = await Promise.all([
      AsyncStorage.getItem(cacheKey(friendsPrefix, ownerId)),
      AsyncStorage.getItem(cacheKey(friendsMetadataPrefix, ownerId)),
    ]);
    if (!encodedFriends) return null;
    const decoded: unknown = JSON.parse(encodedFriends);
    if (!Array.isArray(decoded)) return null;
    const friends = decoded.map(normalizeFriendInfo).filter((item) => item.user_id.length > 0);
    return { friends, savedAt: parseSavedAt(encodedMetadata) };
  } catch {
    return null;
  }
}

async function readFriendRequestSnapshot(
  ownerId: string,
): Promise<FriendRequestCacheSnapshot | null> {
  try {
    const [encodedRequests, encodedMetadata] = await Promise.all([
      AsyncStorage.getItem(cacheKey(requestsPrefix, ownerId)),
      AsyncStorage.getItem(cacheKey(requestsMetadataPrefix, ownerId)),
    ]);
    if (!encodedRequests) return null;
    const decoded: unknown = JSON.parse(encodedRequests);
    if (!Array.isArray(decoded)) return null;
    const requests = decoded.map(normalizeRequiredFriendRequest);
    return { requests, savedAt: parseSavedAt(encodedMetadata) };
  } catch {
    return null;
  }
}

function reconcileResolvedFriendRequests(
  ownerId: string,
  requests: readonly FriendRequest[],
): FriendRequest[] {
  const resolved = resolvedFriendRequestIds.get(ownerId);
  if (!resolved || resolved.size === 0) return [...requests];
  return requests.filter((request) => !resolved.has(request.request_id));
}

function clearResolvedFriendRequestId(
  ownerId: string,
  requestId: number,
  generation: number,
): void {
  if (generation !== friendRepositoryGeneration(ownerId)) return;
  const resolved = resolvedFriendRequestIds.get(ownerId);
  resolved?.delete(requestId);
  if (resolved?.size === 0) resolvedFriendRequestIds.delete(ownerId);
}

function parseSavedAt(encoded: string | null): number | undefined {
  if (!encoded) return undefined;
  try {
    const decoded: unknown = JSON.parse(encoded);
    if (typeof decoded !== "object" || decoded === null || !("savedAt" in decoded)) {
      return undefined;
    }
    const savedAt = Number(decoded.savedAt);
    return Number.isFinite(savedAt) ? savedAt : undefined;
  } catch {
    return undefined;
  }
}

function friendRepositoryGeneration(ownerId: string): number {
  return friendRepositoryGenerations.get(ownerId) ?? 0;
}

function normalizeOwnerId(ownerId: string): string {
  return trimFoundationWhitespacesAndNewlines(ownerId);
}
