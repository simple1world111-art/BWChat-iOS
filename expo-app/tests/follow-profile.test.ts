import AsyncStorage from "@react-native-async-storage/async-storage";

import { getPublicProfile, getRecommendedUsers } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { normalizePublicProfile } from "@/api/normalizers";
import type { FollowRelationship, FollowUser } from "@/models";
import {
  readCachedFollowList,
  saveCachedFollowList,
} from "@/services/friends/FollowListRepository";
import {
  applyRelationshipToFollowUser,
  publishFollowRelationship,
  reconcileFollowListRelationship,
  subscribeFollowRelationship,
} from "@/services/friends/FollowRelationshipStore";
import {
  publicProfileCachePolicy,
  readCachedPublicProfile,
  readCachedPublicProfileSnapshot,
  saveCachedPublicProfile,
} from "@/services/profile/PublicProfileRepository";
import {
  applyRelationshipToPublicProfile,
  optimisticPublicProfileFollow,
  reconcilePublicProfileRelationship,
} from "@/services/profile/PublicProfileRelationship";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);

describe("native follow lists and public-profile contract", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("decodes the nested native public profile and flexible aliases", () => {
    expect(
      normalizePublicProfile({
        profile: {
          user_id: 7,
          username: "friend",
          nickname: "朋友",
          avatarURL: "/friend.png",
          followerCount: "12",
          following_count: 4,
          followedByMe: 1,
          follows_me: true,
          request_pending: false,
          postsCount: "9",
          websiteURL: "example.com",
          business_email: "friend@example.com",
          isVerified: true,
          is_private: true,
          canViewMoments: false,
          can_message: false,
          mutualFollowers: [{ userID: "8", name: "小八" }],
          highlights: [{ highlight_id: 3, name: "旅行", coverURL: "/trip.png", itemCount: "2" }],
          accountCreatedAt: "2026-08-06",
        },
      }),
    ).toMatchObject({
      user_id: "7",
      username: "friend",
      nickname: "朋友",
      avatar_url: "/friend.png",
      follower_count: 12,
      following_count: 4,
      followed_by_me: true,
      follows_me: true,
      posts_count: 9,
      website_url: "example.com",
      contact_email: "friend@example.com",
      is_verified: true,
      is_private: true,
      can_view_moments: false,
      can_message: false,
      mutual_followers: [{ user_id: "8", nickname: "小八" }],
      highlights: [{ id: "3", title: "旅行", cover_url: "/trip.png", item_count: 2 }],
      account_created_at: "2026-08-06",
    });
  });

  it("matches native wrapper priority and independently recovers malformed profile arrays", () => {
    expect(
      normalizePublicProfile({
        profile: "not-an-object",
        user: { user_id: "nested", nickname: "嵌套用户" },
        user_id: "top-level",
      }),
    ).toMatchObject({ user_id: "nested", nickname: "嵌套用户" });

    expect(
      normalizePublicProfile({
        user_id: "7",
        mutual_followers: [{ user_id: "8", nickname: "小八" }, null],
        highlights: [{ title: "无标识精选" }],
      }),
    ).toMatchObject({
      user_id: "7",
      mutual_followers: [],
      highlights: [{ id: "无标识精选", title: "无标识精选" }],
    });

    expect(
      normalizePublicProfile({
        user_id: "7",
        mutual_followers: [{ user_id: "8", nickname: "小八" }],
        highlights: [{}, null],
      }),
    ).toMatchObject({
      mutual_followers: [{ user_id: "8", nickname: "小八" }],
      highlights: [],
    });
    expect(normalizePublicProfile({ user_id: "7", highlights: [{}] }).highlights).toEqual([
      { id: "", title: "", cover_url: "" },
    ]);
    expect(normalizePublicProfile({ user_id: "7" }).nickname).toBe(
      normalizePublicProfile({ user_id: "8" }).nickname,
    );
  });

  it("uses the exact native recommended-user and public-profile routes", async () => {
    request
      .mockResolvedValueOnce({ users: [{ user_id: "8", nickname: "小八" }] })
      .mockResolvedValueOnce({ profile: { user_id: "user/7", nickname: "朋友" } });

    await expect(getRecommendedUsers(80, "user/7")).resolves.toMatchObject([
      { user_id: "8", nickname: "小八" },
    ]);
    await expect(getPublicProfile("user/7")).resolves.toMatchObject({
      user_id: "user/7",
      nickname: "朋友",
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      "/users/recommended?limit=50&exclude_user_id=user%2F7",
      { requiredData: true, requiredEnvelope: true },
    );
    expect(request).toHaveBeenNthCalledWith(2, "/profile/public/user%2F7", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("publishes one relationship change and applies all server-owned fields", () => {
    const user: FollowUser = {
      user_id: "8",
      username: "eight",
      nickname: "小八",
      avatar_url: "",
      bio: "",
      following_count: 2,
      follower_count: 3,
      followed_by_me: false,
      follows_me: false,
      is_friend: false,
    };
    const relationship: FollowRelationship = {
      user_id: "8",
      followed_by_me: true,
      follows_me: true,
      is_friend: true,
      following_count: 5,
      follower_count: 6,
    };
    const listener = jest.fn();
    const otherOwnerListener = jest.fn();
    const blankOwnerListener = jest.fn();
    const unsubscribe = subscribeFollowRelationship("owner-a", listener);
    const unsubscribeOther = subscribeFollowRelationship("owner-b", otherOwnerListener);
    const unsubscribeBlank = subscribeFollowRelationship("  ", blankOwnerListener);
    publishFollowRelationship({ relationship, user }, "owner-a");
    publishFollowRelationship({ relationship, user }, "  ");
    unsubscribe();
    unsubscribeOther();
    unsubscribeBlank();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(otherOwnerListener).not.toHaveBeenCalled();
    expect(blankOwnerListener).not.toHaveBeenCalled();
    expect(applyRelationshipToFollowUser(user, relationship)).toMatchObject({
      followed_by_me: true,
      follows_me: true,
      is_friend: true,
      following_count: 5,
      follower_count: 6,
    });
    const inserted = reconcileFollowListRelationship(
      [],
      { relationship, user },
      { kind: "following", ownerId: "owner", subjectId: "owner" },
    );
    expect(inserted.map((item) => item.user_id)).toEqual(["8"]);
    expect(
      reconcileFollowListRelationship(
        inserted,
        { relationship: { ...relationship, followed_by_me: false } },
        { kind: "following", ownerId: "owner", subjectId: "owner" },
      ),
    ).toEqual([]);
  });

  it("preserves the native private-account request state until the server resolves it", () => {
    const source = normalizePublicProfile({
      user_id: "7",
      nickname: "朋友",
      is_private: true,
      follower_count: 12,
    });
    const optimistic = optimisticPublicProfileFollow(source);
    expect(optimistic).toMatchObject({
      shouldSendFollow: true,
      profile: {
        followed_by_me: false,
        follow_requested: true,
        follower_count: 12,
      },
    });
    expect(
      applyRelationshipToPublicProfile(optimistic.profile, {
        user_id: "7",
        followed_by_me: false,
        follows_me: false,
        is_friend: false,
      }).follow_requested,
    ).toBe(true);
    expect(
      applyRelationshipToPublicProfile(optimistic.profile, {
        user_id: "7",
        followed_by_me: false,
        follows_me: false,
        is_friend: false,
        follow_requested: false,
      }).follow_requested,
    ).toBe(false);
  });

  it("applies direct route-scoped server fields even when the profile exposes a canonical ID", () => {
    const source = normalizePublicProfile({
      user_id: "canonical-user",
      nickname: "朋友",
      follower_count: 1,
    });
    expect(
      reconcilePublicProfileRelationship(source, {
        user_id: "route-target",
        followed_by_me: true,
        follows_me: true,
        is_friend: true,
        follower_count: 9,
        following_count: 4,
      }),
    ).toMatchObject({
      user_id: "canonical-user",
      followed_by_me: true,
      follows_me: true,
      is_friend: true,
      follower_count: 9,
      following_count: 4,
    });
    expect(
      applyRelationshipToPublicProfile(source, {
        user_id: "another-user",
        followed_by_me: true,
        follows_me: true,
        is_friend: true,
      }),
    ).toBe(source);
  });

  it("isolates follow-list and public-profile caches by the signed-in account", async () => {
    const profile = normalizePublicProfile({ user_id: "7", nickname: "朋友" });
    const users = Array.from({ length: 501 }, (_, index): FollowUser => ({
      user_id: String(index + 1),
      username: "",
      nickname: `用户${index + 1}`,
      avatar_url: "",
      bio: "",
      following_count: 0,
      follower_count: 0,
      followed_by_me: true,
      follows_me: false,
      is_friend: false,
    }));

    await saveCachedPublicProfile("owner-a", profile);
    await saveCachedFollowList("owner-a", "subject-a", "following", {
      users,
      has_more: true,
      next_page: 2,
    });

    await expect(readCachedPublicProfile("owner-a", "7")).resolves.toMatchObject({
      nickname: "朋友",
    });
    await expect(readCachedPublicProfile("owner-b", "7")).resolves.toBeNull();
    const cachedList = await readCachedFollowList("owner-a", "subject-a", "following");
    expect(cachedList?.users[0]).toMatchObject({ user_id: "1", nickname: "用户1" });
    expect(cachedList?.users).toHaveLength(500);
    await expect(readCachedFollowList("owner-b", "subject-a", "following")).resolves.toBeNull();
  });

  it("keys a profile by the requested route and preserves native freshness and retention", async () => {
    const now = 1_800_000_000_000;
    const profile = normalizePublicProfile({ user_id: "canonical-7", nickname: "朋友" });
    await saveCachedPublicProfile("owner-a", profile, "route-alias", now);

    await expect(
      readCachedPublicProfileSnapshot("owner-a", "route-alias", now + 1),
    ).resolves.toMatchObject({
      profile: { user_id: "canonical-7" },
      isStale: false,
      isRetained: true,
      isLegacy: false,
    });
    await expect(
      readCachedPublicProfileSnapshot(
        "owner-a",
        "route-alias",
        now + publicProfileCachePolicy.ttlMilliseconds,
      ),
    ).resolves.toMatchObject({ isStale: true, isRetained: true });
    await expect(
      readCachedPublicProfileSnapshot(
        "owner-a",
        "route-alias",
        now +
          publicProfileCachePolicy.ttlMilliseconds +
          publicProfileCachePolicy.staleRetentionMilliseconds +
          1,
      ),
    ).resolves.toMatchObject({ isStale: true, isRetained: false });
    await expect(readCachedPublicProfile("owner-a", "canonical-7")).resolves.toBeNull();
  });
});
