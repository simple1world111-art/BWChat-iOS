import type { FollowUser } from "@/models";
import {
  acquireFollowListOperation,
  decodeInitialRecommendedUsers,
  filterRecommendedFollowUsers,
  followListMetrics,
  mergeFollowPageUsers,
  nextFollowListPage,
  optimisticFollowUser,
  releaseFollowListOperation,
} from "@/services/friends/FollowListPolicy";

describe("native FollowListViewModel policies", () => {
  it("locks every source-visible FollowListViews geometry constant", () => {
    expect(followListMetrics).toEqual({
      navigationButton: 36,
      navigationSymbol: 17,
      contentHorizontalInset: 16,
      contentTopInset: 12,
      contentBottomInset: 28,
      rowGap: 10,
      rowMinimumHeight: 76,
      rowPadding: 14,
      rowRadius: 14,
      rowHorizontalGap: 12,
      identityGap: 12,
      avatarSize: 48,
      copyGap: 4,
      nameSize: 16,
      bioSize: 13,
      followButtonHeight: 32,
      followButtonHorizontalInset: 14,
      followButtonRadius: 16,
      followButtonTitleSize: 13,
      initialStateTopInset: 80,
      loadingMoreVerticalInset: 16,
      emptyGap: 12,
      emptyIconSize: 34,
      emptyTitleSize: 15,
    });
  });

  it("filters recommendations by explicit profile/current user and first occurrence", () => {
    const duplicate = user("duplicate");
    expect(
      filterRecommendedFollowUsers(
        [user(""), user("viewed"), user("owner"), duplicate, duplicate, user("last")],
        "viewed",
        "owner",
      ).map((item) => item.user_id),
    ).toEqual(["duplicate", "last"]);
  });

  it("decodes valid initial route users without allowing one malformed row to erase the rest", () => {
    expect(
      decodeInitialRecommendedUsers(
        JSON.stringify([{ userID: "one", name: "One" }, null, { user_id: "two" }]),
      ),
    ).toMatchObject([
      { user_id: "one", nickname: "One" },
      { user_id: "two", nickname: "BBchat 用户" },
    ]);
    expect(decodeInitialRecommendedUsers("not-json")).toEqual([]);
  });

  it("matches native page merging and next-page fallback", () => {
    const existing = user("existing");
    const duplicateIncoming = user("new");
    expect(
      mergeFollowPageUsers([existing], [existing, duplicateIncoming, duplicateIncoming]).map(
        (item) => item.user_id,
      ),
    ).toEqual(["existing", "new", "new"]);
    expect(nextFollowListPage({ users: [], has_more: true }, 3)).toBe(4);
    expect(nextFollowListPage({ users: [], has_more: true, next_page: 9 }, 3)).toBe(9);
    expect(nextFollowListPage({ users: [], has_more: false, next_page: 9 }, 3)).toBeNull();
  });

  it("uses an immediate per-user lock and exact optimistic follower-count floor", () => {
    const active = new Set<string>();
    expect(acquireFollowListOperation(active, "one")).toBe(true);
    expect(acquireFollowListOperation(active, "one")).toBe(false);
    expect(acquireFollowListOperation(active, "two")).toBe(true);
    releaseFollowListOperation(active, "one");
    expect(acquireFollowListOperation(active, "one")).toBe(true);

    expect(optimisticFollowUser(user("one"))).toMatchObject({
      followed_by_me: true,
      follower_count: 1,
    });
    expect(optimisticFollowUser({ ...user("one"), followed_by_me: true })).toMatchObject({
      followed_by_me: false,
      follower_count: 0,
    });
  });
});

function user(userId: string): FollowUser {
  return {
    user_id: userId,
    username: "",
    nickname: userId,
    avatar_url: "",
    bio: "",
    following_count: 0,
    follower_count: 0,
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
  };
}
