import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeChatGroup, trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type { ChatGroup, GroupDetail } from "@/models";

const keyPrefix = "bwchat.groups.v1";
const groupListLoads = new Map<string, GroupListLoad>();
const groupListOperations = new Map<string, Set<GroupListOperation>>();

type GroupListLoad = {
  cancelled: boolean;
  promise: Promise<ChatGroup[]>;
};

type GroupListOperation = {
  cancelled: boolean;
};

export const groupListCachePolicy = {
  ttlMilliseconds: 2 * 60 * 1_000,
  staleRetentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
} as const;

type GroupListSnapshot = {
  groups: ChatGroup[];
  savedAt?: number | undefined;
};

type LoadGroupsOptions = {
  forceRefresh?: boolean | undefined;
  now?: number | undefined;
};

export async function loadCachedGroups(ownerId: string): Promise<ChatGroup[]> {
  return (await readGroupListSnapshot(ownerId))?.groups ?? [];
}

export async function saveCachedGroups(
  ownerId: string,
  groups: readonly ChatGroup[],
): Promise<void> {
  await saveCachedGroupsAt(ownerId, groups, Date.now());
}

export async function loadGroupsWithNativeCache(
  ownerId: string,
  fetchGroups: () => Promise<ChatGroup[]>,
  options: LoadGroupsOptions = {},
): Promise<ChatGroup[]> {
  const normalizedOwnerId = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!normalizedOwnerId) return [];
  const now = options.now ?? Date.now();
  const loadKey = cacheKey(normalizedOwnerId);
  const operation = { cancelled: false };
  const operations = groupListOperations.get(loadKey) ?? new Set<GroupListOperation>();
  operations.add(operation);
  groupListOperations.set(loadKey, operations);

  try {
    const snapshot = await readGroupListSnapshot(normalizedOwnerId);
    if (operation.cancelled) throw new GroupRepositoryResetError();

    if (
      !options.forceRefresh &&
      snapshot &&
      snapshot.savedAt === undefined &&
      snapshot.groups.length > 0
    ) {
      await saveCachedGroupsAt(normalizedOwnerId, snapshot.groups, now).catch(() => undefined);
      if (operation.cancelled) {
        await AsyncStorage.removeItem(loadKey);
        throw new GroupRepositoryResetError();
      }
      return snapshot.groups;
    }
    if (
      !options.forceRefresh &&
      snapshot?.savedAt !== undefined &&
      now - snapshot.savedAt < groupListCachePolicy.ttlMilliseconds
    ) {
      return snapshot.groups;
    }

    const inFlight = groupListLoads.get(loadKey);
    if (inFlight) {
      const result = await inFlight.promise;
      if (operation.cancelled) throw new GroupRepositoryResetError();
      return result;
    }

    const loadState = { cancelled: false } as GroupListLoad;
    const promise = (async () => {
      try {
        const fetched = normalizeGroups(await fetchGroups());
        if (loadState.cancelled) throw new GroupRepositoryResetError();
        await saveCachedGroupsAt(normalizedOwnerId, fetched, now).catch(() => undefined);
        if (loadState.cancelled) {
          await AsyncStorage.removeItem(loadKey);
          throw new GroupRepositoryResetError();
        }
        return fetched;
      } catch (error) {
        if (loadState.cancelled || error instanceof GroupRepositoryResetError) throw error;
        if (
          snapshot?.savedAt !== undefined &&
          now - snapshot.savedAt <=
            groupListCachePolicy.ttlMilliseconds + groupListCachePolicy.staleRetentionMilliseconds
        ) {
          return snapshot.groups;
        }
        throw error;
      }
    })().finally(() => {
      if (groupListLoads.get(loadKey) === loadState) groupListLoads.delete(loadKey);
    });
    loadState.promise = promise;
    groupListLoads.set(loadKey, loadState);
    return await promise;
  } finally {
    operations.delete(operation);
    if (groupListOperations.get(loadKey) === operations && operations.size === 0) {
      groupListOperations.delete(loadKey);
    }
  }
}

export async function resetGroupRepositoryForAccount(ownerId: string): Promise<void> {
  const normalizedOwnerId = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!normalizedOwnerId) return;
  const key = cacheKey(normalizedOwnerId);
  const operations = groupListOperations.get(key);
  if (operations) {
    for (const operation of operations) operation.cancelled = true;
    groupListOperations.delete(key);
  }
  const inFlight = groupListLoads.get(key);
  if (inFlight) {
    inFlight.cancelled = true;
    groupListLoads.delete(key);
  }
  await AsyncStorage.removeItem(key);
}

export async function removeCachedGroup(ownerId: string, groupId: number): Promise<void> {
  const groups = await loadCachedGroups(ownerId);
  await saveCachedGroups(
    ownerId,
    groups.filter((group) => group.group_id !== groupId),
  );
}

export async function updateCachedGroupSummary(
  ownerId: string,
  detail: GroupDetail,
): Promise<void> {
  const groups = await loadCachedGroups(ownerId);
  if (!groups.some((group) => group.group_id === detail.group_id)) return;
  await saveCachedGroups(
    ownerId,
    groups.map((group) =>
      group.group_id === detail.group_id
        ? {
            ...group,
            name: detail.name,
            avatar_url: detail.avatar_url,
            creator_id: detail.creator_id,
            member_count: detail.members.length,
            is_public: detail.is_public,
          }
        : group,
    ),
  );
}

async function readGroupListSnapshot(ownerId: string): Promise<GroupListSnapshot | null> {
  const normalizedOwnerId = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!normalizedOwnerId) return null;
  const encoded = await AsyncStorage.getItem(cacheKey(normalizedOwnerId));
  if (!encoded) return null;
  try {
    const decoded: unknown = JSON.parse(encoded);
    if (Array.isArray(decoded)) return { groups: normalizeGroups(decoded) };
    if (typeof decoded !== "object" || decoded === null || !("groups" in decoded)) return null;
    const groups = "groups" in decoded && Array.isArray(decoded.groups) ? decoded.groups : [];
    const savedAt = "savedAt" in decoded ? Number(decoded.savedAt) : Number.NaN;
    return {
      groups: normalizeGroups(groups),
      ...(Number.isFinite(savedAt) ? { savedAt } : {}),
    };
  } catch {
    return null;
  }
}

async function saveCachedGroupsAt(
  ownerId: string,
  groups: readonly ChatGroup[],
  savedAt: number,
): Promise<void> {
  const normalizedOwnerId = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!normalizedOwnerId) return;
  await AsyncStorage.setItem(
    cacheKey(normalizedOwnerId),
    JSON.stringify({ groups: normalizeGroups(groups), savedAt }),
  );
}

function normalizeGroups(groups: readonly unknown[]): ChatGroup[] {
  return groups.map(normalizeChatGroup).filter((group) => group.group_id > 0);
}

function cacheKey(ownerId: string): string {
  return `${keyPrefix}:${encodeURIComponent(ownerId)}`;
}

class GroupRepositoryResetError extends Error {
  constructor() {
    super("Group repository reset while loading");
    this.name = "GroupRepositoryResetError";
  }
}
