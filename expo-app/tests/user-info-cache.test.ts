import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  cacheContactList,
  cacheFriendList,
  cacheUserInfo,
  cachedAvatarUrl,
  cachedNickname,
  clearUserInfoCache,
  getCachedUserInfo,
  hydrateUserInfoCache,
  resetUserInfoCacheForTests,
} from "@/services/cache/UserInfoCache";

describe("UserInfoCache", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetUserInfoCacheForTests();
  });

  it("persists the native user fields and serves nickname/avatar fallbacks", async () => {
    await cacheUserInfo({
      user_id: " u-1 ",
      username: "alice",
      nickname: "Alice",
      avatar_url: "/alice.png",
    });
    expect(await getCachedUserInfo("u-1")).toMatchObject({
      user_id: "u-1",
      username: "alice",
      nickname: "Alice",
      avatar_url: "/alice.png",
    });
    expect(await cachedNickname("u-1")).toBe("Alice");
    expect(await cachedAvatarUrl("u-1")).toBe("/alice.png");
    expect(await cachedNickname("missing")).toBe("missing");
    expect(await cachedAvatarUrl("missing")).toBe("");
  });

  it("batch-caches contacts and friends while preserving a known username", async () => {
    await cacheUserInfo({ user_id: "u-1", username: "alice", nickname: "A", avatar_url: "a" });
    await cacheContactList([{ user_id: "u-1", nickname: "Alice 2", avatar_url: "b", unread_count: 0 }]);
    await cacheFriendList([{ user_id: "u-2", nickname: "Bob", avatar_url: "c", added_at: "" }]);
    expect(await getCachedUserInfo("u-1")).toMatchObject({ username: "alice", nickname: "Alice 2", avatar_url: "b" });
    expect(await getCachedUserInfo("u-2")).toMatchObject({ username: "", nickname: "Bob", avatar_url: "c" });
  });

  it("rehydrates a valid disk snapshot and ignores malformed entries", async () => {
    await AsyncStorage.setItem("bwchat.user-info-cache.v1", JSON.stringify([
      { user_id: "u-1", username: "alice", nickname: "Alice", avatar_url: "a", updated_at: "date" },
      { nickname: "invalid" },
    ]));
    await hydrateUserInfoCache();
    expect(await getCachedUserInfo("u-1")).toMatchObject({ nickname: "Alice" });
    expect(await getCachedUserInfo("")).toBeUndefined();
  });

  it("recovers from corrupted storage and clears memory plus disk", async () => {
    await AsyncStorage.setItem("bwchat.user-info-cache.v1", "not-json");
    await hydrateUserInfoCache();
    expect(await getCachedUserInfo("u-1")).toBeUndefined();
    await cacheUserInfo({ user_id: "u-1", nickname: "Alice", avatar_url: "a" });
    await clearUserInfoCache();
    expect(await getCachedUserInfo("u-1")).toBeUndefined();
    expect(await AsyncStorage.getItem("bwchat.user-info-cache.v1")).toBeNull();
  });
});
