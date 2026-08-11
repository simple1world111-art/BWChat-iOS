import { followUser, searchUsers, unfollowUser } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import type { FollowRelationship, SearchUser } from "@/models";
import {
  acquireAddFriendOperation,
  addFriendPolicy,
  applyRelationshipToSearchUsers,
  normalizedAddFriendQuery,
  optimisticSearchUserFollow,
  reconcileSearchUsersWithKnownFollowing,
  releaseAddFriendOperation,
  shouldFollowSearchUser,
} from "@/services/friends/AddFriendPolicy";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);

describe("native AddFriendView contracts", () => {
  beforeEach(() => request.mockReset());

  it("keeps the native debounce, navigation delay and trimmed-query policy", () => {
    expect(addFriendPolicy).toEqual({
      searchDebounceMilliseconds: 400,
      messageNavigationDelayMilliseconds: 250,
    });
    expect(normalizedAddFriendQuery("  Alice 七  ")).toBe("Alice 七");
    expect(normalizedAddFriendQuery(" \n\t ")).toBe("");
  });

  it("matches the native optimistic follow, requested and unfollow branches", () => {
    const none = user({ followed_by_me: false, follow_requested: false });
    const requested = user({ followed_by_me: false, follow_requested: true });
    const followed = user({ followed_by_me: true, follow_requested: false });

    expect(shouldFollowSearchUser(none)).toBe(true);
    expect(optimisticSearchUserFollow(none)).toMatchObject({
      followed_by_me: true,
      follow_requested: false,
    });
    expect(shouldFollowSearchUser(requested)).toBe(false);
    expect(optimisticSearchUserFollow(requested)).toMatchObject({
      followed_by_me: false,
      follow_requested: false,
    });
    expect(shouldFollowSearchUser(followed)).toBe(false);
    expect(optimisticSearchUserFollow(followed)).toMatchObject({
      followed_by_me: false,
      follow_requested: false,
    });
  });

  it("acquires each user operation synchronously before React can rerender", () => {
    const active = new Set<string>();
    expect(acquireAddFriendOperation(active, "one")).toBe(true);
    expect(acquireAddFriendOperation(active, "one")).toBe(false);
    expect(acquireAddFriendOperation(active, "two")).toBe(true);
    releaseAddFriendOperation(active, "one");
    expect(acquireAddFriendOperation(active, "one")).toBe(true);
  });

  it("reconciles only the matching search row and treats omitted request state as false", () => {
    const users = [user({ user_id: "one" }), user({ user_id: "two", follow_requested: true })];
    const relationship: FollowRelationship = {
      user_id: "two",
      followed_by_me: true,
      follows_me: false,
      is_friend: false,
    };
    const next = applyRelationshipToSearchUsers(users, relationship);
    expect(next[0]).toBe(users[0]);
    expect(next[1]).toMatchObject({
      user_id: "two",
      followed_by_me: true,
      follow_requested: false,
    });
  });

  it("promotes a false search relationship from known following state without demoting server truth", () => {
    const users = [
      user({ user_id: "dex", follow_requested: true }),
      user({ user_id: "server-true", followed_by_me: true }),
      user({ user_id: "unknown" }),
    ];
    const next = reconcileSearchUsersWithKnownFollowing(users, [
      { user_id: "dex", followed_by_me: true },
      { user_id: "unknown", followed_by_me: false },
    ]);

    expect(next).toMatchObject([
      { user_id: "dex", followed_by_me: true, follow_requested: false },
      { user_id: "server-true", followed_by_me: true },
      { user_id: "unknown", followed_by_me: false },
    ]);
  });

  it("uses the exact required-data search route and preserves server order", async () => {
    request.mockResolvedValueOnce({
      users: [
        { user_id: "two", nickname: "小二" },
        { userID: "one", name: "小一", requestPending: true },
      ],
    });

    await expect(searchUsers("Alice/七")).resolves.toMatchObject([
      { user_id: "two", nickname: "小二" },
      { user_id: "one", nickname: "小一", follow_requested: true },
    ]);
    expect(request).toHaveBeenCalledWith("/friends/search?keyword=Alice%2F%E4%B8%83", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("uses the exact encoded follow/unfollow methods and native fallback relationships", async () => {
    request.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);

    await expect(followUser("user/七")).resolves.toMatchObject({
      user_id: "user/七",
      followed_by_me: true,
    });
    await expect(unfollowUser("user/七")).resolves.toMatchObject({
      user_id: "user/七",
      followed_by_me: false,
    });
    expect(request.mock.calls).toEqual([
      [
        "/follows/user%2F%E4%B8%83",
        {
          method: "POST",
          body: {},
          requiredEnvelope: true,
        },
      ],
      [
        "/follows/user%2F%E4%B8%83",
        {
          method: "DELETE",
          requiredEnvelope: true,
        },
      ],
    ]);
  });
});

function user(change: Partial<SearchUser> = {}): SearchUser {
  return {
    user_id: "user",
    nickname: "用户",
    avatar_url: "/avatar.png",
    relation: "none",
    followed_by_me: false,
    follow_requested: false,
    ...change,
  };
}
