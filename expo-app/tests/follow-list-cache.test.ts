import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizePublicProfile } from "@/api/normalizers";
import type { FollowRelationship, FollowUser, FollowUsersPage } from "@/models";
import {
  followListCachePolicy,
  loadCachedFollowListPage,
  mutateCachedFollowList,
  readCachedFollowList,
  readCachedFollowListSnapshot,
  resetFollowListRepositoryMemoryForAccount,
  saveCachedFollowList,
} from "@/services/friends/FollowListRepository";
import { applyFollowRelationshipToCaches } from "@/services/friends/FollowRelationshipStore";
import {
  readCachedPublicProfile,
  saveCachedPublicProfile,
} from "@/services/profile/PublicProfileRepository";

const ownerId = "follow-owner";
const alice = followUser("alice", false, 3);

describe("native follow-list cache and relationship reconciliation", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    await AsyncStorage.clear();
  });

  it("uses a fresh ten-minute snapshot without a backend request", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    await saveCachedFollowList(ownerId, ownerId, "following", page([alice], 2));
    const fetchPage = jest.fn<Promise<FollowUsersPage>, []>();

    await expect(
      loadCachedFollowListPage(
        ownerId,
        ownerId,
        "following",
        false,
        fetchPage,
        1_000_000 + followListCachePolicy.ttlMilliseconds - 1,
      ),
    ).resolves.toEqual(page([alice], 2));
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("refreshes stale data and falls back inside the native 90-day retention", async () => {
    jest.spyOn(Date, "now").mockReturnValue(2_000_000);
    await saveCachedFollowList(ownerId, ownerId, "followers", page([alice], null));
    const fetchPage = jest.fn().mockRejectedValue(new Error("offline"));

    await expect(
      loadCachedFollowListPage(
        ownerId,
        ownerId,
        "followers",
        false,
        fetchPage,
        2_000_000 + followListCachePolicy.ttlMilliseconds + 1,
      ),
    ).resolves.toEqual(page([alice], null));
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("retains the native snapshot at the exact inclusive 90-day boundary", async () => {
    jest.spyOn(Date, "now").mockReturnValue(2_500_000);
    await saveCachedFollowList(ownerId, ownerId, "followers", page([alice], null));
    const fetchPage = jest.fn().mockRejectedValue(new Error("offline"));

    await expect(
      loadCachedFollowListPage(
        ownerId,
        ownerId,
        "followers",
        false,
        fetchPage,
        2_500_000 +
          followListCachePolicy.ttlMilliseconds +
          followListCachePolicy.staleRetentionMilliseconds,
      ),
    ).resolves.toEqual(page([alice], null));
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("continues to the backend when native-style cache decoding cannot read storage", async () => {
    jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("disk unavailable"));
    const remote = page([followUser("bob")], null);
    const fetchPage = jest.fn().mockResolvedValue(remote);

    await expect(
      loadCachedFollowListPage(
        "read-failure-owner",
        "read-failure-owner",
        "following",
        false,
        fetchPage,
      ),
    ).resolves.toEqual(remote);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("throws after retention while the independently seeded raw snapshot stays readable", async () => {
    jest.spyOn(Date, "now").mockReturnValue(3_000_000);
    await saveCachedFollowList(ownerId, ownerId, "following", page([alice], null));
    const failure = new Error("offline");

    await expect(
      loadCachedFollowListPage(
        ownerId,
        ownerId,
        "following",
        false,
        jest.fn().mockRejectedValue(failure),
        3_000_000 +
          followListCachePolicy.ttlMilliseconds +
          followListCachePolicy.staleRetentionMilliseconds +
          1,
      ),
    ).rejects.toBe(failure);
    await expect(readCachedFollowList(ownerId, ownerId, "following")).resolves.toEqual(
      page([alice], null),
    );
  });

  it("coalesces same-key page-one misses and keeps remote success on storage failure", async () => {
    const pending = deferred<FollowUsersPage>();
    const fetchPage = jest.fn(() => pending.promise);
    const first = loadCachedFollowListPage(
      "coalesced-owner",
      "coalesced-owner",
      "following",
      false,
      fetchPage,
    );
    const second = loadCachedFollowListPage(
      "coalesced-owner",
      "coalesced-owner",
      "following",
      false,
      fetchPage,
    );
    await Promise.resolve();
    pending.resolve(page([alice], null));
    await expect(Promise.all([first, second])).resolves.toEqual([
      page([alice], null),
      page([alice], null),
    ]);
    expect(fetchPage).toHaveBeenCalledTimes(1);

    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));
    const bobPage = page([followUser("bob")], null);
    await expect(
      loadCachedFollowListPage(
        "disk-owner",
        "disk-owner",
        "following",
        true,
        jest.fn().mockResolvedValue(bobPage),
      ),
    ).resolves.toEqual(bobPage);
  });

  it("clears owner loads and rejects a pre-reset late response before it can write", async () => {
    const resetOwner = "follow-reset-owner";
    const oldLoad = deferred<FollowUsersPage>();
    const newLoad = deferred<FollowUsersPage>();
    const first = loadCachedFollowListPage(
      resetOwner,
      resetOwner,
      "following",
      true,
      jest.fn(() => oldLoad.promise),
    );
    await Promise.resolve();

    resetFollowListRepositoryMemoryForAccount(resetOwner);
    const second = loadCachedFollowListPage(
      resetOwner,
      resetOwner,
      "following",
      true,
      jest.fn(() => newLoad.promise),
    );
    const oldPage = page([followUser("old")], null);
    oldLoad.resolve(oldPage);
    await expect(first).rejects.toMatchObject({ name: "FollowListRepositoryResetError" });
    await expect(readCachedFollowList(resetOwner, resetOwner, "following")).resolves.toBeNull();

    const currentPage = page([followUser("current")], null);
    newLoad.resolve(currentPage);
    await expect(second).resolves.toEqual(currentPage);
    await expect(readCachedFollowList(resetOwner, resetOwner, "following")).resolves.toEqual(
      currentPage,
    );
  });

  it("cancels a queued pre-reset cache mutation after its read resumes", async () => {
    const resetOwner = "follow-write-reset-owner";
    const baseline = page([followUser("baseline")], null);
    await saveCachedFollowList(resetOwner, resetOwner, "following", baseline);
    const encoded = await AsyncStorage.getItem(
      `bwchat.follow-list.v1:${resetOwner}:${resetOwner}:following`,
    );
    const delayedRead = deferred<string | null>();
    jest.spyOn(AsyncStorage, "getItem").mockReturnValueOnce(delayedRead.promise);
    const mutation = mutateCachedFollowList(resetOwner, resetOwner, "following", (cached) => ({
      ...cached,
      users: [followUser("changed")],
    }));
    await Promise.resolve();

    resetFollowListRepositoryMemoryForAccount(resetOwner);
    delayedRead.resolve(encoded);
    await mutation;
    jest.restoreAllMocks();
    await expect(readCachedFollowList(resetOwner, resetOwner, "following")).resolves.toEqual(
      baseline,
    );
  });

  it("updates cached profile and current-user lists with native count fallback", async () => {
    await saveCachedPublicProfile(
      ownerId,
      normalizePublicProfile({
        user_id: "alice",
        nickname: "Alice",
        follower_count: 3,
        followed_by_me: false,
      }),
    );
    await saveCachedFollowList(ownerId, ownerId, "followers", page([alice], null));
    await saveCachedFollowList(ownerId, ownerId, "following", page([], 2));
    const relationship: FollowRelationship = {
      user_id: "alice",
      followed_by_me: true,
      follows_me: true,
      is_friend: true,
    };

    await applyFollowRelationshipToCaches(ownerId, { relationship });

    await expect(readCachedPublicProfile(ownerId, "alice")).resolves.toMatchObject({
      followed_by_me: true,
      follows_me: true,
      is_friend: true,
      follower_count: 4,
    });
    await expect(readCachedFollowList(ownerId, ownerId, "followers")).resolves.toMatchObject({
      users: [expect.objectContaining({ user_id: "alice", follower_count: 4 })],
    });
    await expect(
      readCachedFollowListSnapshot(ownerId, ownerId, "following"),
    ).resolves.toMatchObject({
      isStale: false,
      page: { users: [expect.objectContaining({ user_id: "alice", follower_count: 4 })] },
    });
  });

  it("invalidates a current-user following snapshot when no insertion user is available", async () => {
    await saveCachedFollowList(ownerId, ownerId, "following", page([], 2));
    await applyFollowRelationshipToCaches(ownerId, {
      relationship: {
        user_id: "unknown",
        followed_by_me: true,
        follows_me: false,
        is_friend: false,
      },
    });
    await expect(
      readCachedFollowListSnapshot(ownerId, ownerId, "following"),
    ).resolves.toMatchObject({ isStale: true, page: { users: [] } });
  });

  it("inserts a supplied followed user first and removes it on unfollow", async () => {
    await saveCachedFollowList(ownerId, ownerId, "following", page([], 2));
    const followed: FollowRelationship = {
      user_id: "alice",
      followed_by_me: true,
      follows_me: false,
      is_friend: false,
    };
    await applyFollowRelationshipToCaches(ownerId, {
      relationship: followed,
      user: alice,
    });
    await expect(readCachedFollowList(ownerId, ownerId, "following")).resolves.toMatchObject({
      users: [expect.objectContaining({ user_id: "alice", follower_count: 4 })],
      next_page: 2,
    });

    await applyFollowRelationshipToCaches(ownerId, {
      relationship: { ...followed, followed_by_me: false },
    });
    await expect(readCachedFollowList(ownerId, ownerId, "following")).resolves.toMatchObject({
      users: [],
      next_page: 2,
    });
  });
});

function page(users: FollowUser[], nextPage: number | null): FollowUsersPage {
  return {
    users,
    has_more: nextPage !== null,
    ...(nextPage !== null ? { next_page: nextPage } : {}),
  };
}

function followUser(userId: string, followedByMe = false, followerCount = 0): FollowUser {
  return {
    user_id: userId,
    username: userId,
    nickname: userId === "alice" ? "Alice" : userId,
    avatar_url: "",
    bio: "",
    following_count: 0,
    follower_count: followerCount,
    followed_by_me: followedByMe,
    follows_me: false,
    is_friend: false,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
