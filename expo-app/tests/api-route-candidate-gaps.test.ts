import { apiRequest } from "@/api/client";
import { getAgentConversation } from "@/services/agents/AgentConversationRepository";
import { getFollowRelationship } from "@/services/friends/FollowRelationshipRepository";
import { subscribeFollowRelationship } from "@/services/friends/FollowRelationshipStore";
import {
  blockMapUser,
  getFriendMapUsers,
  getMapUserDetail,
  getNearbyMapUsers,
  reportMapUser,
  unblockMapUser,
} from "@/services/location/MapDatingRepository";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);

describe("remaining native API route candidates", () => {
  beforeEach(() => request.mockReset());

  it("loads one escaped agent conversation and rejects a missing conversation", async () => {
    request.mockResolvedValueOnce({
      conversation: {
        id: "conversation/1",
        agent_id: "agent-1",
        agent_version_id: "version-1",
        agent_profile: { name: "伙伴" },
      },
    });
    await expect(getAgentConversation("conversation/1")).resolves.toMatchObject({
      id: "conversation/1",
      agent_id: "agent-1",
    });
    expect(request).toHaveBeenCalledWith("/agent-conversations/conversation%2F1", {
      requiredData: true,
    });
  });

  it("loads the exact follow relationship route and publishes the normalized server state", async () => {
    request.mockResolvedValueOnce({
      relationship: { userID: "user/7", followedByMe: true, followsMe: true, isFriend: true },
    });
    const events: string[] = [];
    const unsubscribe = subscribeFollowRelationship("owner-a", ({ relationship }) => {
      events.push(`${relationship.user_id}:${relationship.is_friend}`);
    });
    await expect(getFollowRelationship("owner-a", "user/7")).resolves.toMatchObject({
      user_id: "user/7",
      followed_by_me: true,
      is_friend: true,
    });
    unsubscribe();
    expect(request).toHaveBeenCalledWith("/follows/user%2F7/relationship", {
      requiredEnvelope: true,
    });
    expect(events).toEqual(["user/7:true"]);
  });

  it("matches nearby and friend map query ordering, no-cache, and viewer ownership", async () => {
    request
      .mockResolvedValueOnce({ viewer_id: "owner", users: [{ user_id: "7" }] })
      .mockResolvedValueOnce({ viewer_id: "owner", friends: [{ user_id: "8" }] });
    await getNearbyMapUsers({
      coordinate: { latitude: 35.6, longitude: 139.7 },
      viewerId: "owner",
      radiusM: 5000,
      limit: 40,
      gender: "female",
      minAge: 20,
      maxAge: 30,
      includeFriends: true,
    });
    await getFriendMapUsers({
      coordinate: { latitude: 35.6, longitude: 139.7 },
      viewerId: "owner",
      radiusM: 5000,
      limit: 40,
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/map/nearby?lat=35.6&lng=139.7&limit=40&include_friends=true&radius_m=5000&gender=female&min_age=20&max_age=30",
      { cache: "no-store" },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/map/friends?limit=40&lat=35.6&lng=139.7&radius_m=5000",
      { cache: "no-store" },
    );
  });

  it("rejects a map list snapshot owned by another account", async () => {
    request.mockResolvedValueOnce({ viewer_id: "other", users: [] });
    await expect(getFriendMapUsers({ viewerId: "owner" })).rejects.toThrow("another viewer");
  });

  it("loads escaped map-user detail and accepts nested user envelopes", async () => {
    request.mockResolvedValueOnce({ user: { user_id: "user/7", nickname: "小七" } });
    await expect(
      getMapUserDetail("user/7", { latitude: 35.6, longitude: 139.7 }),
    ).resolves.toMatchObject({ userId: "user/7", nickname: "小七" });
    expect(request).toHaveBeenCalledWith("/map/users/user%2F7?lat=35.6&lng=139.7", {
      cache: "no-store",
    });
  });

  it("matches map block, unblock and report mutation contracts without retries", async () => {
    request.mockResolvedValue(undefined);
    await blockMapUser("user/7");
    await unblockMapUser("user/7");
    await reportMapUser("user/7", "harassment", "  证据  ");
    expect(request).toHaveBeenNthCalledWith(1, "/map/users/user%2F7/block", {
      method: "POST",
      body: {},
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/map/users/user%2F7/block", {
      method: "DELETE",
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(3, "/map/users/user%2F7/report", {
      method: "POST",
      body: { reason: "harassment", detail: "证据" },
      transientRetries: false,
    });
  });
});
