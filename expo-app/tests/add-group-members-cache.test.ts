import AsyncStorage from "@react-native-async-storage/async-storage";

import type { FriendInfo } from "@/models";
import {
  friendListCachePolicy,
  loadFriendsWithNativeCache,
  saveCachedFriends,
} from "@/services/friends/FriendRepository";

const ownerId = "owner-a";
const alice: FriendInfo = {
  user_id: "friend-a",
  nickname: "Alice",
  avatar_url: "/alice.png",
  added_at: "2026-08-08T00:00:00Z",
};

describe("native add-group-members friend cache", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it("uses a fresh list for two minutes without touching the backend", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    await saveCachedFriends(ownerId, [alice]);
    const fetchFriends = jest.fn();

    await expect(
      loadFriendsWithNativeCache(ownerId, fetchFriends, {
        now: 1_000_000 + friendListCachePolicy.ttlMilliseconds,
      }),
    ).resolves.toEqual([alice]);
    expect(fetchFriends).not.toHaveBeenCalled();
  });

  it("refreshes stale data and falls back to it for the native 30-day retention", async () => {
    jest.spyOn(Date, "now").mockReturnValue(2_000_000);
    await saveCachedFriends(ownerId, [alice]);
    const fetchFriends = jest.fn().mockRejectedValue(new Error("offline"));

    await expect(
      loadFriendsWithNativeCache(ownerId, fetchFriends, {
        now: 2_000_000 + friendListCachePolicy.ttlMilliseconds + 1,
      }),
    ).resolves.toEqual([alice]);
    expect(fetchFriends).toHaveBeenCalledTimes(1);
  });

  it("does not use an expired list as the repository result", async () => {
    jest.spyOn(Date, "now").mockReturnValue(3_000_000);
    await saveCachedFriends(ownerId, [alice]);
    const failure = new Error("offline");
    const fetchFriends = jest.fn().mockRejectedValue(failure);

    await expect(
      loadFriendsWithNativeCache(ownerId, fetchFriends, {
        now:
          3_000_000 +
          friendListCachePolicy.ttlMilliseconds +
          friendListCachePolicy.staleRetentionMilliseconds +
          1,
      }),
    ).rejects.toBe(failure);
  });

  it("migrates the legacy account-scoped array as a fresh native snapshot", async () => {
    await AsyncStorage.setItem("bwchat.friends.v1:owner-a", JSON.stringify([alice]));
    const fetchFriends = jest.fn();
    await expect(
      loadFriendsWithNativeCache(ownerId, fetchFriends, { now: 4_000_000 }),
    ).resolves.toEqual([alice]);
    expect(fetchFriends).not.toHaveBeenCalled();
  });

  it("returns a successful refresh even when persistence fails", async () => {
    const bob = { ...alice, user_id: "friend-b", nickname: "Bob" };
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValue(new Error("disk full"));
    await expect(
      loadFriendsWithNativeCache(ownerId, jest.fn().mockResolvedValue([bob]), {
        forceRefresh: true,
        now: 5_000_000,
      }),
    ).resolves.toEqual([bob]);
  });
});
