import AsyncStorage from "@react-native-async-storage/async-storage";

import type { FriendRequest } from "@/models";
import {
  friendRequestCachePolicy,
  loadCachedFriendRequests,
  loadFriendRequestsWithNativeCache,
  markFriendRequestResolved,
  resetFriendRepositoryMemoryForAccount,
  saveCachedFriendRequests,
  waitForFriendRepositoryPersistenceForAccount,
} from "@/services/friends/FriendRepository";

const ownerId = "friend-request-owner";
const alice = friendRequest(11, "Alice");

describe("native friend-request cache", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it("uses a fresh account snapshot for two minutes without a backend request", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    await saveCachedFriendRequests(ownerId, [alice]);
    const fetchRequests = jest.fn();

    await expect(
      loadFriendRequestsWithNativeCache(ownerId, fetchRequests, {
        now: 1_000_000 + friendRequestCachePolicy.ttlMilliseconds,
      }),
    ).resolves.toEqual([alice]);
    expect(fetchRequests).not.toHaveBeenCalled();
  });

  it("refreshes stale data and falls back for the native 30-day retention", async () => {
    jest.spyOn(Date, "now").mockReturnValue(2_000_000);
    await saveCachedFriendRequests(ownerId, [alice]);
    const fetchRequests = jest.fn().mockRejectedValue(new Error("offline"));

    await expect(
      loadFriendRequestsWithNativeCache(ownerId, fetchRequests, {
        now: 2_000_000 + friendRequestCachePolicy.ttlMilliseconds + 1,
      }),
    ).resolves.toEqual([alice]);
    expect(fetchRequests).toHaveBeenCalledTimes(1);
  });

  it("throws after retention while the independently seeded raw cache remains readable", async () => {
    jest.spyOn(Date, "now").mockReturnValue(3_000_000);
    await saveCachedFriendRequests(ownerId, [alice]);
    const failure = new Error("offline");

    await expect(
      loadFriendRequestsWithNativeCache(ownerId, jest.fn().mockRejectedValue(failure), {
        now:
          3_000_000 +
          friendRequestCachePolicy.ttlMilliseconds +
          friendRequestCachePolicy.staleRetentionMilliseconds +
          1,
      }),
    ).rejects.toBe(failure);
    await expect(loadCachedFriendRequests(ownerId)).resolves.toEqual([alice]);
  });

  it("promotes non-empty legacy arrays but fetches for an empty legacy array", async () => {
    await AsyncStorage.setItem("bwchat.friend-requests.v1:legacy-owner", JSON.stringify([alice]));
    const legacyFetch = jest.fn();
    await expect(
      loadFriendRequestsWithNativeCache("legacy-owner", legacyFetch, { now: 4_000_000 }),
    ).resolves.toEqual([alice]);
    expect(legacyFetch).not.toHaveBeenCalled();

    await AsyncStorage.setItem("bwchat.friend-requests.v1:empty-owner", "[]");
    const fetched = [friendRequest(12, "Bob")];
    const emptyFetch = jest.fn().mockResolvedValue(fetched);
    await expect(
      loadFriendRequestsWithNativeCache("empty-owner", emptyFetch, { now: 4_000_000 }),
    ).resolves.toEqual(fetched);
    expect(emptyFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects the complete cached array when one native Codable row is malformed", async () => {
    await AsyncStorage.setItem(
      "bwchat.friend-requests.v1:strict-cache-owner",
      JSON.stringify([alice, { requestID: 99, userID: "alias" }]),
    );
    await expect(loadCachedFriendRequests("strict-cache-owner")).resolves.toEqual([]);
  });

  it("uses Foundation whitespace/newline owner normalization for the account cache key", async () => {
    const decoratedOwner = "\u0085foundation-owner\u2028";
    await saveCachedFriendRequests(decoratedOwner, [alice]);

    await expect(loadCachedFriendRequests("foundation-owner")).resolves.toEqual([alice]);
    await expect(
      AsyncStorage.getItem("bwchat.friend-requests.v1:foundation-owner"),
    ).resolves.not.toBeNull();
  });

  it("coalesces concurrent cache misses by account", async () => {
    const pending = deferred<FriendRequest[]>();
    const fetchRequests = jest.fn(() => pending.promise);
    const first = loadFriendRequestsWithNativeCache("coalesced-owner", fetchRequests, {
      now: 5_000_000,
    });
    const second = loadFriendRequestsWithNativeCache("coalesced-owner", fetchRequests, {
      now: 5_000_000,
    });
    await Promise.resolve();
    pending.resolve([alice]);

    await expect(Promise.all([first, second])).resolves.toEqual([[alice], [alice]]);
    expect(fetchRequests).toHaveBeenCalledTimes(1);
  });

  it("prevents an older in-flight list from resurrecting a resolved request", async () => {
    jest.spyOn(Date, "now").mockReturnValue(6_000_000);
    await saveCachedFriendRequests("late-owner", [alice]);
    const pending = deferred<FriendRequest[]>();
    const load = loadFriendRequestsWithNativeCache("late-owner", () => pending.promise, {
      forceRefresh: true,
      now: 6_000_001,
    });
    await Promise.resolve();

    await markFriendRequestResolved("late-owner", alice.request_id);
    pending.resolve([alice]);

    await expect(load).resolves.toEqual([]);
    await expect(loadCachedFriendRequests("late-owner")).resolves.toEqual([]);
  });

  it("keeps resolved IDs active across repeated fresh reads until their cache write finishes", async () => {
    const raceOwner = "fresh-read-race-owner";
    jest.spyOn(Date, "now").mockReturnValue(6_500_000);
    await saveCachedFriendRequests(raceOwner, [alice]);
    const originalSetItem = jest.mocked(AsyncStorage.setItem).getMockImplementation();
    const writeStarted = deferred<void>();
    const allowWrite = deferred<void>();
    let shouldDelay = true;
    jest.spyOn(AsyncStorage, "setItem").mockImplementation(async (key, value) => {
      if (key === `bwchat.friend-requests.v1:${raceOwner}` && shouldDelay) {
        shouldDelay = false;
        writeStarted.resolve(undefined);
        await allowWrite.promise;
      }
      await originalSetItem?.(key, value);
    });

    const mark = markFriendRequestResolved(raceOwner, alice.request_id);
    await writeStarted.promise;
    await expect(
      loadFriendRequestsWithNativeCache(raceOwner, jest.fn(), { now: 6_500_001 }),
    ).resolves.toEqual([]);
    await expect(
      loadFriendRequestsWithNativeCache(raceOwner, jest.fn(), { now: 6_500_002 }),
    ).resolves.toEqual([]);

    allowWrite.resolve(undefined);
    await mark;
  });

  it("retains the resolved guard when persistence fails so a fresh cache cannot revive the row", async () => {
    const failureOwner = "resolved-write-failure-owner";
    jest.spyOn(Date, "now").mockReturnValue(6_700_000);
    await saveCachedFriendRequests(failureOwner, [alice]);
    const failedWrites = jest.mocked(AsyncStorage.setItem);
    const originalSetItem = failedWrites.getMockImplementation();
    failedWrites.mockImplementation(() => Promise.reject(new Error("disk full")));

    await expect(
      markFriendRequestResolved(failureOwner, alice.request_id),
    ).resolves.toBeUndefined();
    if (originalSetItem) failedWrites.mockImplementation(originalSetItem);
    await expect(
      loadFriendRequestsWithNativeCache(failureOwner, jest.fn(), { now: 6_700_001 }),
    ).resolves.toEqual([]);
  });

  it("keeps a successful network result authoritative when persistence fails", async () => {
    const bob = friendRequest(13, "Bob");
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));
    await expect(
      loadFriendRequestsWithNativeCache("disk-owner", jest.fn().mockResolvedValue([bob]), {
        forceRefresh: true,
        now: 7_000_000,
      }),
    ).resolves.toEqual([bob]);
  });

  it("clears resolved IDs and in-flight account keys for an explicit account cache reset", async () => {
    const resetOwner = "reset-owner";
    const oldLoad = deferred<FriendRequest[]>();
    const newLoad = deferred<FriendRequest[]>();
    const oldFetch = jest.fn(() => oldLoad.promise);
    const newFetch = jest.fn(() => newLoad.promise);
    const first = loadFriendRequestsWithNativeCache(resetOwner, oldFetch, {
      forceRefresh: true,
      now: 8_000_000,
    });
    await Promise.resolve();
    await markFriendRequestResolved(resetOwner, alice.request_id);

    resetFriendRepositoryMemoryForAccount(resetOwner);
    const second = loadFriendRequestsWithNativeCache(resetOwner, newFetch, {
      forceRefresh: true,
      now: 8_000_001,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(oldFetch).toHaveBeenCalledTimes(1);
    expect(newFetch).toHaveBeenCalledTimes(1);

    newLoad.resolve([alice]);
    await expect(second).resolves.toEqual([alice]);
    oldLoad.resolve([alice]);
    await expect(first).resolves.toEqual([alice]);
  });

  it("keeps ordinary account-switch reset memory-only", async () => {
    const switchOwner = "switch-owner";
    await saveCachedFriendRequests(switchOwner, [alice]);

    resetFriendRepositoryMemoryForAccount(`\n${switchOwner}\u0085`);

    await expect(loadCachedFriendRequests(switchOwner)).resolves.toEqual([alice]);
  });

  it("exposes a persistence barrier so account clearing cannot be followed by an old write", async () => {
    const clearOwner = "clear-race-owner";
    const originalSetItem = jest.mocked(AsyncStorage.setItem).getMockImplementation();
    const writeStarted = deferred<void>();
    const allowWrite = deferred<void>();
    let shouldDelay = true;
    jest.spyOn(AsyncStorage, "setItem").mockImplementation(async (key, value) => {
      if (key === `bwchat.friend-requests.v1:${clearOwner}` && shouldDelay) {
        shouldDelay = false;
        writeStarted.resolve(undefined);
        await allowWrite.promise;
      }
      await originalSetItem?.(key, value);
    });

    const oldWrite = saveCachedFriendRequests(clearOwner, [alice]);
    await writeStarted.promise;
    resetFriendRepositoryMemoryForAccount(clearOwner);
    const persistenceBarrier = waitForFriendRepositoryPersistenceForAccount(clearOwner);
    let barrierFinished = false;
    void persistenceBarrier.then(() => {
      barrierFinished = true;
    });
    await Promise.resolve();
    expect(barrierFinished).toBe(false);

    allowWrite.resolve(undefined);
    await Promise.all([oldWrite, persistenceBarrier]);
    await AsyncStorage.multiRemove([
      `bwchat.friend-requests.v1:${clearOwner}`,
      `bwchat.friend-requests-metadata.v1:${clearOwner}`,
    ]);
    await expect(loadCachedFriendRequests(clearOwner)).resolves.toEqual([]);
  });
});

function friendRequest(requestId: number, nickname: string): FriendRequest {
  return {
    request_id: requestId,
    user_id: `user-${requestId}`,
    nickname,
    avatar_url: `/avatar-${requestId}.png`,
    created_at: "2026-08-08T00:00:00Z",
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
