import {
  followUser,
  getFollowers,
  getFollowing,
  getRecommendedUsers,
  unfollowUser,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { normalizeFollowUser, normalizeFollowUsersPage } from "@/api/normalizers";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);

describe("native follow-list API and decoding contracts", () => {
  beforeEach(() => request.mockReset());

  it("uses exact following/follower query order and strict required-data wrappers", async () => {
    request
      .mockResolvedValueOnce({ users: [{ user_id: "one", nickname: "One" }] })
      .mockResolvedValueOnce({ followers: [{ userID: "two", name: "Two" }] });

    await expect(getFollowing({ userId: " user/一 ", page: 2, limit: 40 })).resolves.toMatchObject({
      users: [{ user_id: "one" }],
    });
    await expect(getFollowers({ page: 3 })).resolves.toMatchObject({
      users: [{ user_id: "two" }],
    });
    expect(request.mock.calls).toEqual([
      [
        "/follows/following?page=2&limit=40&user_id=user%2F%E4%B8%80",
        { requiredData: true, requiredEnvelope: true },
      ],
      ["/follows/followers?page=3&limit=30", { requiredData: true, requiredEnvelope: true }],
    ]);
  });

  it("clamps recommended limits, encodes the explicit exclusion and requires data", async () => {
    request.mockResolvedValueOnce({ items: [{ id: 8, name: "Eight" }] });
    await expect(getRecommendedUsers(80, " user/七 ")).resolves.toMatchObject([
      { user_id: "8", nickname: "Eight" },
    ]);
    expect(request).toHaveBeenCalledWith(
      "/users/recommended?limit=50&exclude_user_id=user%2F%E4%B8%83",
      { requiredData: true, requiredEnvelope: true },
    );
  });

  it("normalizes mutation output to the requested path target and keeps native fallback", async () => {
    request
      .mockResolvedValueOnce({ user_id: "wrong", followed_by_me: false, follows_me: true })
      .mockResolvedValueOnce(undefined);

    await expect(followUser("user/七")).resolves.toMatchObject({
      user_id: "user/七",
      followed_by_me: false,
      follows_me: true,
    });
    await expect(unfollowUser("user/八")).resolves.toMatchObject({
      user_id: "user/八",
      followed_by_me: false,
    });
  });

  it("matches nested flexible FollowUser and FollowUsersPage inference", () => {
    expect(
      normalizeFollowUser({
        profile: {
          userID: 7,
          username: 99,
          name: "Seven",
          avatarURL: "/seven.png",
          followingCount: "4",
          follower_count: 5,
          followedByMe: 1,
          follows_me: "true",
          isFriend: true,
        },
      }),
    ).toMatchObject({
      user_id: "7",
      username: "99",
      nickname: "Seven",
      avatar_url: "/seven.png",
      following_count: 4,
      follower_count: 5,
      followed_by_me: true,
      follows_me: true,
      is_friend: true,
    });
    expect(
      normalizeFollowUsersPage({
        list: [{ user_id: "one" }],
        page: "4",
        total: "3",
      }),
    ).toMatchObject({ has_more: true, next_page: 5 });
    expect(
      normalizeFollowUsersPage({ users: [{ user_id: "one" }], nextPage: 9, hasMore: false }),
    ).toMatchObject({ has_more: false, next_page: 9 });
  });
});
