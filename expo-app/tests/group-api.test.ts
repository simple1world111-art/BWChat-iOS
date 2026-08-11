import {
  addGroupMembers,
  clearGroupMessageHistory,
  createGroup,
  dismissGroup,
  getFollowers,
  getFriendList,
  getFollowing,
  getGroups,
  getGroupDetail,
  leaveGroup,
  removeGroupMember,
  renameGroup,
  updateConversationPreference,
  updateGroupVisibility,
} from "@/api/bwchat";
import { APIError, apiRequest } from "@/api/client";
import { normalizeFollowUser, normalizeFollowUsersPage } from "@/api/normalizers";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, apiRequest: jest.fn() };
});

const request = jest.mocked(apiRequest);

describe("native create-group API contract", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("posts the exact native create payload", async () => {
    request.mockResolvedValueOnce(undefined);
    await createGroup("周末群", ["7", "8"], true);
    expect(request).toHaveBeenCalledWith("/groups/create", {
      method: "POST",
      body: { name: "周末群", member_ids: ["7", "8"], is_public: true },
      requiredEnvelope: true,
      requiredSuccessCode: true,
    });
  });

  it("requires the exact native group-list data envelope", async () => {
    request.mockResolvedValueOnce({ groups: [] });
    await expect(getGroups()).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith("/groups/list", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("rejects a successful envelope whose data omits the native groups array", async () => {
    request.mockResolvedValueOnce({});
    await expect(getGroups()).rejects.toThrow("群列表响应格式无效");
  });

  it("posts the exact native add-members payload", async () => {
    request.mockResolvedValueOnce(undefined);
    await addGroupMembers(21, ["7", "8"]);
    expect(request).toHaveBeenCalledWith("/groups/21/members/add", {
      method: "POST",
      body: { user_ids: ["7", "8"] },
      requiredEnvelope: true,
    });
  });

  it("accepts any optional data because native EmptyData has no decodable fields", async () => {
    request.mockResolvedValueOnce({}).mockResolvedValueOnce([]);
    await expect(addGroupMembers(21, ["7"])).resolves.toBeUndefined();
    await expect(addGroupMembers(21, ["7"])).resolves.toBeUndefined();
  });

  it("requires the exact native friend-list data envelope", async () => {
    request.mockResolvedValueOnce({ friends: [] });
    await expect(getFriendList()).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith("/friends/list", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("maps malformed native friend data to APIError.decodingError", async () => {
    request
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ friends: [{ user_id: "7", nickname: "小七" }] });

    await expect(getFriendList()).rejects.toEqual(
      expect.objectContaining<Partial<APIError>>({ code: "decoding_error" }),
    );
    await expect(getFriendList()).rejects.toEqual(
      expect.objectContaining<Partial<APIError>>({ code: "decoding_error" }),
    );
  });

  it("requests both paged member sources and normalizes their list aliases", async () => {
    request
      .mockResolvedValueOnce({
        following: [{ user_id: "7", nickname: "小七", followed_by_me: true, follows_me: true }],
        page: 2,
        has_more: true,
        next_page: 3,
      })
      .mockResolvedValueOnce({
        followers: [{ user_id: "8", nickname: "小八" }],
        has_more: false,
      });

    await expect(getFollowing({ page: 2, limit: 30 })).resolves.toMatchObject({
      users: [{ user_id: "7", nickname: "小七" }],
      has_more: true,
      next_page: 3,
    });
    await expect(getFollowers({ userId: "owner", page: 1, limit: 20 })).resolves.toMatchObject({
      users: [{ user_id: "8", nickname: "小八" }],
      has_more: false,
    });
    expect(request).toHaveBeenNthCalledWith(1, "/follows/following?page=2&limit=30", {
      requiredData: true,
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/follows/followers?page=1&limit=20&user_id=owner", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("falls through malformed keyed member arrays like the native decoder", () => {
    expect(
      normalizeFollowUsersPage({
        users: [null],
        followers: [{ user_id: "8", nickname: "小八" }],
      }),
    ).toMatchObject({ users: [{ user_id: "8", nickname: "小八" }] });
    expect(
      normalizeFollowUser({
        profile: "malformed",
        user: { user_id: "9", nickname: "小九" },
      }),
    ).toMatchObject({ user_id: "9", nickname: "小九" });
  });

  it("uses the exact native group-detail mutation paths and payloads", async () => {
    request
      .mockResolvedValueOnce({
        group_id: 21,
        name: "周末群",
        avatar_url: "",
        creator_id: "owner",
        members: [],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ group_id: 21, cleared_before_sequence: 12, revision: 3 })
      .mockResolvedValueOnce({
        conversation_type: "group",
        target_id: "21",
        is_pinned: true,
        is_hidden: false,
        revision: 4,
      });

    await expect(getGroupDetail(21)).resolves.toMatchObject({ group_id: 21, name: "周末群" });
    await renameGroup(21, "新群名");
    await updateGroupVisibility(21, true);
    await removeGroupMember(21, "user/7");
    await leaveGroup(21);
    await dismissGroup(21);
    await expect(clearGroupMessageHistory(21)).resolves.toMatchObject({
      group_id: 21,
      cleared_before_sequence: 12,
    });
    await expect(updateConversationPreference("group", "21", true)).resolves.toMatchObject({
      is_pinned: true,
      is_hidden: false,
    });

    expect(request).toHaveBeenNthCalledWith(1, "/groups/21", {
      requiredData: true,
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/groups/21/rename", {
      method: "POST",
      body: { name: "新群名" },
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(3, "/groups/21/visibility", {
      method: "POST",
      body: { is_public: true },
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(4, "/groups/21/members/remove", {
      method: "POST",
      body: { user_id: "user/7" },
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(5, "/groups/21/leave", {
      method: "POST",
      body: {},
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(6, "/groups/21/dismiss", {
      method: "POST",
      body: {},
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(
      7,
      "/groups/21/messages/history",
      expect.objectContaining({
        method: "DELETE",
        headers: { "Idempotency-Key": expect.any(String) },
        requiredData: true,
        requiredEnvelope: true,
      }),
    );
    expect(request).toHaveBeenNthCalledWith(8, "/chat/conversations/group/21/preferences", {
      method: "PUT",
      body: { is_pinned: true, is_hidden: false },
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("requires the native GroupDetail core and preserves flexible GroupMember fields", async () => {
    request
      .mockResolvedValueOnce({
        group_id: 21,
        name: "周末群",
        avatar_url: "",
        creator_id: "owner",
        members: [{ user_id: 7, nickname: "", avatar_url: 9, role: 1 }],
      })
      .mockResolvedValueOnce({ group_id: 21, name: "缺字段", members: [] });

    await expect(getGroupDetail(21)).resolves.toMatchObject({
      members: [{ user_id: "7", nickname: "", avatar_url: "9", role: "1" }],
    });
    await expect(getGroupDetail(21)).rejects.toEqual(
      expect.objectContaining<Partial<APIError>>({ code: "decoding_error" }),
    );
  });
});
