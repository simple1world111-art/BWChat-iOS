import AsyncStorage from "@react-native-async-storage/async-storage";
import { waitFor } from "@testing-library/react-native";

import type { ChatGroup } from "@/models";
import {
  groupListCachePolicy,
  loadCachedGroups,
  loadGroupsWithNativeCache,
  resetGroupRepositoryForAccount,
  saveCachedGroups,
} from "@/services/groups/GroupRepository";

const ownerId = "owner-a";
const cacheKey = "bwchat.groups.v1:owner-a";
const group = (id: number, name = `群${id}`): ChatGroup => ({
  group_id: id,
  name,
  avatar_url: "",
  creator_id: ownerId,
  member_count: 2,
  unread_count: 0,
  is_public: false,
  is_muted: false,
});

describe("native group-list cache used by CreateGroup", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("keeps accounts isolated and preserves empty remote snapshots", async () => {
    await saveCachedGroups(ownerId, []);
    expect(await loadCachedGroups(ownerId)).toEqual([]);
    expect(await loadCachedGroups("owner-b")).toEqual([]);
    const fetchGroups = jest.fn().mockResolvedValue([group(2)]);
    await expect(
      loadGroupsWithNativeCache(ownerId, fetchGroups, { now: Date.now() }),
    ).resolves.toEqual([]);
    expect(fetchGroups).not.toHaveBeenCalled();
  });

  it("promotes a nonempty legacy array into a fresh two-minute snapshot", async () => {
    await AsyncStorage.setItem(cacheKey, JSON.stringify([group(1)]));
    const fetchGroups = jest.fn().mockResolvedValue([group(2)]);
    await expect(
      loadGroupsWithNativeCache(ownerId, fetchGroups, { now: 1_000_000 }),
    ).resolves.toEqual([group(1)]);
    expect(fetchGroups).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem(cacheKey)) ?? "null")).toEqual({
      groups: [group(1)],
      savedAt: 1_000_000,
    });
  });

  it("returns fresh data without a request and refreshes stale data", async () => {
    await seedSnapshot([group(1)], 1_000_000);
    const freshFetch = jest.fn().mockResolvedValue([group(2)]);
    await expect(
      loadGroupsWithNativeCache(ownerId, freshFetch, {
        now: 999_999 + groupListCachePolicy.ttlMilliseconds,
      }),
    ).resolves.toEqual([group(1)]);
    expect(freshFetch).not.toHaveBeenCalled();

    const staleFetch = jest.fn().mockResolvedValue([group(2)]);
    await expect(
      loadGroupsWithNativeCache(ownerId, staleFetch, {
        now: 1_000_000 + groupListCachePolicy.ttlMilliseconds,
      }),
    ).resolves.toEqual([group(2)]);
    expect(staleFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back only while stale data remains inside native retention", async () => {
    await seedSnapshot([group(1)], 1_000_000);
    const failure = new Error("offline");
    await expect(
      loadGroupsWithNativeCache(ownerId, jest.fn().mockRejectedValue(failure), {
        now:
          1_000_000 +
          groupListCachePolicy.ttlMilliseconds +
          groupListCachePolicy.staleRetentionMilliseconds,
      }),
    ).resolves.toEqual([group(1)]);
    await expect(
      loadGroupsWithNativeCache(ownerId, jest.fn().mockRejectedValue(failure), {
        forceRefresh: true,
        now:
          1_000_001 +
          groupListCachePolicy.ttlMilliseconds +
          groupListCachePolicy.staleRetentionMilliseconds,
      }),
    ).rejects.toBe(failure);
    expect(await loadCachedGroups(ownerId)).toEqual([group(1)]);
  });

  it("coalesces same-account refreshes and force refresh bypasses freshness", async () => {
    await seedSnapshot([group(1)], 1_000_000);
    const request = deferred<ChatGroup[]>();
    const fetchGroups = jest.fn().mockReturnValue(request.promise);
    const first = loadGroupsWithNativeCache(ownerId, fetchGroups, {
      forceRefresh: true,
      now: 1_000_010,
    });
    const second = loadGroupsWithNativeCache(ownerId, fetchGroups, {
      forceRefresh: true,
      now: 1_000_010,
    });
    await waitFor(() => expect(fetchGroups).toHaveBeenCalledTimes(1));
    request.resolve([group(2)]);
    await expect(Promise.all([first, second])).resolves.toEqual([[group(2)], [group(2)]]);
  });

  it("returns a successful remote list when first-time persistence fails", async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("disk full"));
    await expect(
      loadGroupsWithNativeCache(ownerId, jest.fn().mockResolvedValue([group(2)]), {
        now: 1_000_000,
      }),
    ).resolves.toEqual([group(2)]);
  });

  it("does not replace a successful remote list with stale data when persistence fails", async () => {
    await seedSnapshot([group(1)], 1_000_000);
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("disk full"));
    await expect(
      loadGroupsWithNativeCache(ownerId, jest.fn().mockResolvedValue([group(2)]), {
        forceRefresh: true,
        now: 1_000_010,
      }),
    ).resolves.toEqual([group(2)]);
    expect(await loadCachedGroups(ownerId)).toEqual([group(1)]);
  });

  it("cancels an account load on reset and prevents a late cache resurrection", async () => {
    await seedSnapshot([group(1)], 1_000_000);
    const request = deferred<ChatGroup[]>();
    const fetchGroups = jest.fn().mockReturnValue(request.promise);
    const pending = loadGroupsWithNativeCache(ownerId, fetchGroups, {
      forceRefresh: true,
      now: 1_000_010,
    });
    await waitFor(() => expect(fetchGroups).toHaveBeenCalledTimes(1));

    await resetGroupRepositoryForAccount(ownerId);
    expect(await loadCachedGroups(ownerId)).toEqual([]);
    request.resolve([group(2)]);
    await expect(pending).rejects.toThrow("Group repository reset while loading");
    expect(await loadCachedGroups(ownerId)).toEqual([]);

    const replacementFetch = jest.fn().mockResolvedValue([group(3)]);
    await expect(
      loadGroupsWithNativeCache(ownerId, replacementFetch, {
        forceRefresh: true,
        now: 1_000_020,
      }),
    ).resolves.toEqual([group(3)]);
    expect(replacementFetch).toHaveBeenCalledTimes(1);
  });

  it("also cancels a load that was still reading the account snapshot", async () => {
    const snapshotRead = deferred<string | null>();
    const getItem = jest.spyOn(AsyncStorage, "getItem").mockReturnValueOnce(snapshotRead.promise);
    const fetchGroups = jest.fn().mockResolvedValue([group(2)]);
    const pending = loadGroupsWithNativeCache(ownerId, fetchGroups, {
      forceRefresh: true,
      now: 1_000_010,
    });
    await waitFor(() => expect(getItem).toHaveBeenCalledWith(cacheKey));

    await resetGroupRepositoryForAccount(ownerId);
    snapshotRead.resolve(JSON.stringify({ groups: [group(1)], savedAt: 1_000_000 }));
    await expect(pending).rejects.toThrow("Group repository reset while loading");
    expect(fetchGroups).not.toHaveBeenCalled();
    getItem.mockRestore();
    expect(await loadCachedGroups(ownerId)).toEqual([]);
  });
});

async function seedSnapshot(groups: ChatGroup[], savedAt: number): Promise<void> {
  await AsyncStorage.setItem(cacheKey, JSON.stringify({ groups, savedAt }));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
