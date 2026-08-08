import { getFollowing } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { cacheUserInfoBatch } from "@/services/cache/UserInfoCache";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
jest.mock("@/services/cache/UserInfoCache", () => ({
  cacheUserInfoBatch: jest.fn(),
  cacheContactList: jest.fn(),
  cacheFriendList: jest.fn(),
  cachePublicProfile: jest.fn(),
  cacheSearchUsers: jest.fn(),
}));

const request = jest.mocked(apiRequest);
const cacheUsers = jest.mocked(cacheUserInfoBatch);

describe("CreateGroup follow-source cache resilience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    request.mockResolvedValue({
      users: [{ user_id: "7", nickname: "小七" }],
      has_more: false,
    });
  });

  it("does not downgrade a successful member-source response when local user caching fails", async () => {
    cacheUsers.mockRejectedValue(new Error("disk full"));
    await expect(getFollowing({ page: 1 })).resolves.toMatchObject({
      users: [{ user_id: "7", nickname: "小七" }],
      has_more: false,
    });
    expect(cacheUsers).toHaveBeenCalledWith([expect.objectContaining({ user_id: "7" })]);
  });
});
