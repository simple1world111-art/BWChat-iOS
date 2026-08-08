import {
  acceptFriendRequest,
  getFriendList,
  getFriendRequests,
  rejectFriendRequest,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { normalizeRequiredFriendInfo, normalizeRequiredFriendRequest } from "@/api/normalizers";
import type { FriendRequest } from "@/models";
import {
  acquireFriendRequestOperation,
  friendRequestsMetrics,
  releaseFriendRequestOperation,
  withoutFriendRequest,
  withoutResolvedFriendRequests,
} from "@/services/friends/FriendRequestsPolicy";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);

describe("native FriendRequestsView contracts", () => {
  beforeEach(() => request.mockReset());

  it("locks the native empty, row, avatar, action, divider and toast geometry", () => {
    expect(friendRequestsMetrics).toEqual({
      backButtonSize: 36,
      backSymbolSize: 17,
      emptyGap: 14,
      emptyIconSize: 40,
      emptyTextSize: 15,
      rowHorizontalInset: 16,
      rowVerticalInset: 10,
      rowGap: 12,
      rowSpacerMinWidth: 4,
      rowResolvedHeight: 64,
      avatarSize: 44,
      copyGap: 3,
      nameSize: 16,
      subtitleSize: 13,
      actionsGap: 8,
      actionSize: 38,
      actionRadius: 19,
      actionSymbolSize: 14,
      dividerLeadingInset: 72,
      toastMilliseconds: 2_000,
    });
  });

  it("requires the exact list envelope and preserves native server order", async () => {
    request.mockResolvedValueOnce({
      requests: [friendRequest(2, "二"), friendRequest(1, "一")],
    });

    await expect(getFriendRequests()).resolves.toEqual([
      friendRequest(2, "二"),
      friendRequest(1, "一"),
    ]);
    expect(request).toHaveBeenCalledWith("/friends/requests", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("rejects aliases, missing fields, and non-integer request identifiers", async () => {
    expect(() =>
      normalizeRequiredFriendRequest({
        requestID: 1,
        userID: "one",
        nickname: "一",
        avatarURL: "",
        createdAt: "now",
      }),
    ).toThrow("好友请求数据格式无效");
    expect(() => normalizeRequiredFriendRequest({ ...friendRequest(1), request_id: 1.5 })).toThrow(
      "好友请求数据格式无效",
    );

    request.mockResolvedValueOnce({ requests: [{ request_id: 1, user_id: "one" }] });
    await expect(getFriendRequests()).rejects.toThrow("好友请求数据格式无效");

    request.mockResolvedValueOnce({ users: [] });
    await expect(getFriendRequests()).rejects.toThrow("好友请求响应格式无效");
  });

  it("strictly decodes the accepted-request friend refresh envelope and rows", async () => {
    const friend = {
      user_id: "friend-1",
      nickname: "朋友",
      avatar_url: "/friend.png",
      added_at: "2026-08-08T00:00:00Z",
    };
    request.mockResolvedValueOnce({ friends: [friend] });
    await expect(getFriendList()).resolves.toEqual([friend]);
    expect(request).toHaveBeenLastCalledWith("/friends/list", {
      requiredData: true,
      requiredEnvelope: true,
    });

    expect(() =>
      normalizeRequiredFriendInfo({
        user_id: friend.user_id,
        nickname: friend.nickname,
        avatar_url: friend.avatar_url,
        addedAt: friend.added_at,
      }),
    ).toThrow("好友数据格式无效");
    request.mockResolvedValueOnce({ users: [] });
    await expect(getFriendList()).rejects.toThrow("api.decodingError");
    request.mockResolvedValueOnce({ friends: [{ user_id: "friend-1" }] });
    await expect(getFriendList()).rejects.toThrow("api.decodingError");
  });

  it("uses exact non-idempotent Accept and Reject wrappers", async () => {
    request.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);

    await acceptFriendRequest(17);
    await rejectFriendRequest(23);

    expect(request.mock.calls).toEqual([
      ["/friends/requests/17/accept", { method: "POST", body: {}, requiredEnvelope: true }],
      ["/friends/requests/23/reject", { method: "POST", body: {}, requiredEnvelope: true }],
    ]);
  });

  it("locks one request synchronously while allowing independent rows", () => {
    const active = new Set<number>();
    expect(acquireFriendRequestOperation(active, 1)).toBe(true);
    expect(acquireFriendRequestOperation(active, 1)).toBe(false);
    expect(acquireFriendRequestOperation(active, 2)).toBe(true);
    releaseFriendRequestOperation(active, 1);
    expect(acquireFriendRequestOperation(active, 1)).toBe(true);
  });

  it("removes only resolved identities without reordering the remaining rows", () => {
    const requests = [friendRequest(3), friendRequest(1), friendRequest(2)];
    expect(withoutFriendRequest(requests, 1).map((item) => item.request_id)).toEqual([3, 2]);
    expect(
      withoutResolvedFriendRequests(requests, new Set([3, 2])).map((item) => item.request_id),
    ).toEqual([1]);
  });
});

function friendRequest(requestId: number, nickname = `用户${requestId}`): FriendRequest {
  return {
    request_id: requestId,
    user_id: `user-${requestId}`,
    nickname,
    avatar_url: `/avatar-${requestId}.png`,
    created_at: "2026-08-08T00:00:00Z",
  };
}
