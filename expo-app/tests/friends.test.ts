import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  normalizeFollowRelationship,
  normalizeFriendInfo,
  normalizeFriendRequest,
  normalizeSearchUser,
} from "@/api/normalizers";
import {
  loadCachedFriendRequests,
  loadCachedFriends,
  saveCachedFriendRequests,
  saveCachedFriends,
} from "@/services/friends/FriendRepository";

describe("native friends contract", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("decodes search, friend and request fields with the native flexible aliases", () => {
    expect(
      normalizeSearchUser({
        userID: 7,
        name: "小七",
        avatarURL: "/7.png",
        relation: "pending_sent",
        followedByMe: "false",
        requestPending: 1,
      }),
    ).toEqual({
      user_id: "7",
      nickname: "小七",
      avatar_url: "/7.png",
      relation: "pending_sent",
      followed_by_me: false,
      follow_requested: true,
    });
    expect(
      normalizeFriendInfo({ userID: "8", name: "小八", avatar: "/8.png", addedAt: "now" }),
    ).toEqual({ user_id: "8", nickname: "小八", avatar_url: "/8.png", added_at: "now" });
    expect(
      normalizeFriendRequest({ requestID: "9", userID: "8", name: "小八", createdAt: "now" }),
    ).toEqual({
      request_id: 9,
      user_id: "8",
      nickname: "小八",
      avatar_url: "",
      created_at: "now",
    });
  });

  it("decodes nested follow relationship responses and request-pending aliases", () => {
    expect(
      normalizeFollowRelationship(
        {
          relationship: {
            user_id: "friend-1",
            followed_by_me: false,
            follows_me: true,
            is_friend: false,
            request_pending: true,
            follower_count: "12",
          },
        },
        "fallback",
        true,
      ),
    ).toEqual({
      user_id: "friend-1",
      followed_by_me: false,
      follows_me: true,
      is_friend: false,
      follow_requested: true,
      follower_count: 12,
    });
  });

  it("keeps friends and requests isolated by signed-in account", async () => {
    await saveCachedFriends("owner-a", [
      { user_id: "friend-1", nickname: "朋友", avatar_url: "", added_at: "now" },
    ]);
    await saveCachedFriendRequests("owner-a", [
      {
        request_id: 4,
        user_id: "friend-2",
        nickname: "申请者",
        avatar_url: "",
        created_at: "now",
      },
    ]);

    expect(await loadCachedFriends("owner-a")).toHaveLength(1);
    expect(await loadCachedFriendRequests("owner-a")).toHaveLength(1);
    expect(await loadCachedFriends("owner-b")).toEqual([]);
    expect(await loadCachedFriendRequests("owner-b")).toEqual([]);
  });
});
