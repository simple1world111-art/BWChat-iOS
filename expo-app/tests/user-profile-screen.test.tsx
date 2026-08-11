import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import {
  followUser,
  getFollowers,
  getFollowing,
  getPublicProfile,
  getRecommendedUsers,
  unfollowUser,
} from "@/api/bwchat";
import UserProfileScreen from "@/app/user-profile";
import type { FollowRelationship, PublicProfile, User } from "@/models";
import {
  type FollowRelationshipEvent,
  subscribeFollowRelationship,
} from "@/services/friends/FollowRelationshipStore";
import {
  readCachedPublicProfileSnapshot,
  saveCachedPublicProfile,
} from "@/services/profile/PublicProfileRepository";

let mockParams: { id?: string; name?: string; avatar?: string } = { id: "route-target" };
let mockAuthUser: User | null = { user_id: "owner-a", nickname: "Owner" } as User;
const mockT = (key: string) => key;
const mockRelationshipListeners = new Set<(event: FollowRelationshipEvent) => void>();
const mockReadNavigationSnapshot = jest.fn();
const mockWriteNavigationSnapshot = jest.fn();

jest.mock("expo-router", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");
  return {
    router: { back: jest.fn(), push: jest.fn() },
    Stack: { Screen: () => null },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(callback, [callback]);
    },
  };
});

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));

jest.mock("@/api/bwchat", () => ({
  followUser: jest.fn(),
  getFollowers: jest.fn(),
  getFollowing: jest.fn(),
  getPublicProfile: jest.fn(),
  getRecommendedUsers: jest.fn(),
  unfollowUser: jest.fn(),
}));

jest.mock("@/components/Avatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { Avatar: ({ name }: { name: string }) => <MockText>{`avatar:${name}`}</MockText> };
});

jest.mock("@/components/AuthenticatedImage", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { AuthenticatedImage: () => <MockView /> };
});

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    TopToast: ({ message }: { message: string | null }) =>
      message ? <MockText accessibilityLabel="toast">{message}</MockText> : null,
  };
});

jest.mock("@/components/profile/PublicProfileContent", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    PublicProfileContent: ReactModule.forwardRef(
      (
        {
          isVisible,
          onMomentCountChange,
        }: { isVisible: boolean; onMomentCountChange: (count: number) => void },
        ref,
      ) => {
        ReactModule.useImperativeHandle(ref, () => ({
          loadMore: jest.fn(),
          refresh: async () => undefined,
        }));
        ReactModule.useEffect(() => onMomentCountChange(3), [onMomentCountChange]);
        return <MockText testID="profile-content-visible">{String(isVisible)}</MockText>;
      },
    ),
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockAuthUser }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockT }),
}));

jest.mock("@/services/agents/AgentConversationResolver", () => ({
  resolveAgentConversation: jest.fn(),
}));

jest.mock("@/services/profile/PublicProfileRepository", () => ({
  readCachedPublicProfileSnapshot: jest.fn(),
  saveCachedPublicProfile: jest.fn(),
}));

jest.mock("@/services/navigation/NavigationSnapshotCache", () => ({
  readNavigationSnapshot: (...args: unknown[]) => mockReadNavigationSnapshot(...args),
  writeNavigationSnapshot: (...args: unknown[]) => mockWriteNavigationSnapshot(...args),
}));

jest.mock("@/services/friends/FollowRelationshipStore", () => ({
  applyRelationshipToFollowUser: jest.requireActual("@/services/friends/FollowRelationshipStore")
    .applyRelationshipToFollowUser,
  publishFollowRelationship: jest.fn(),
  subscribeFollowRelationship: jest.fn(
    (_ownerId: string, listener: (event: FollowRelationshipEvent) => void) => {
      mockRelationshipListeners.add(listener);
      return () => mockRelationshipListeners.delete(listener);
    },
  ),
}));

const mockFollow = jest.mocked(followUser);
const mockFollowers = jest.mocked(getFollowers);
const mockFollowing = jest.mocked(getFollowing);
const mockProfile = jest.mocked(getPublicProfile);
const mockRecommended = jest.mocked(getRecommendedUsers);
const mockUnfollow = jest.mocked(unfollowUser);
const mockReadCache = jest.mocked(readCachedPublicProfileSnapshot);
const mockSaveCache = jest.mocked(saveCachedPublicProfile);
const mockSubscribeRelationship = jest.mocked(subscribeFollowRelationship);

describe("User Profile screen state machine", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockRelationshipListeners.clear();
    mockSubscribeRelationship.mockImplementation((_ownerId, listener) => {
      mockRelationshipListeners.add(listener);
      return () => mockRelationshipListeners.delete(listener);
    });
    mockParams = { id: "route-target" };
    mockAuthUser = { user_id: "owner-a", nickname: "Owner" } as User;
    mockReadNavigationSnapshot.mockReturnValue(undefined);
    mockReadCache.mockResolvedValue(null);
    mockSaveCache.mockResolvedValue();
    mockProfile.mockResolvedValue(profile("canonical-target", "朋友"));
    mockRecommended.mockResolvedValue([]);
    mockFollowers.mockResolvedValue({ users: [], has_more: false });
    mockFollowing.mockResolvedValue({ users: [], has_more: false });
    mockFollow.mockResolvedValue(relationship("route-target", true));
    mockUnfollow.mockResolvedValue(relationship("route-target", false));
  });

  afterEach(() => cleanup());

  it("shows route identity on the first frame while cache and network refresh silently", async () => {
    const pendingProfile = deferred<PublicProfile>();
    mockParams = {
      id: "route-target",
      name: "即时用户",
      avatar: "/avatars/instant.jpg",
    };
    mockProfile.mockReturnValueOnce(pendingProfile.promise);

    const view = await render(<UserProfileScreen />);
    expect(view.getByText("即时用户")).toBeTruthy();

    pendingProfile.resolve(profile("canonical-target", "网络用户"));
    await waitFor(() => expect(view.getByText("网络用户")).toBeTruthy());
  });

  it("restores the account-scoped navigation snapshot before asynchronous cache reads", async () => {
    const pendingProfile = deferred<PublicProfile>();
    mockProfile.mockReturnValueOnce(pendingProfile.promise);
    mockReadNavigationSnapshot.mockReturnValueOnce({
      profile: profile("snapshot-target", "快照用户"),
      suggestions: [],
      selectedTab: "agents",
      loadedMomentCount: 7,
    });

    const view = await render(<UserProfileScreen />);
    expect(view.getByText("快照用户")).toBeTruthy();
    expect(mockReadNavigationSnapshot).toHaveBeenCalledWith(
      "user-profile",
      "owner-a",
      "route-target",
    );
    expect(mockWriteNavigationSnapshot).toHaveBeenCalledWith(
      "user-profile",
      "owner-a",
      expect.objectContaining({
        profile: expect.objectContaining({ user_id: "snapshot-target" }),
        selectedTab: "agents",
      }),
      "route-target",
    );

    pendingProfile.resolve(profile("canonical-target", "网络用户"));
    await waitFor(() => expect(view.getByText("网络用户")).toBeTruthy());
  });

  it("uses the route target for follow while direct chat uses the canonical profile user ID", async () => {
    mockFollow.mockResolvedValueOnce({
      ...relationship("route-target", true),
      follows_me: true,
      is_friend: true,
      follower_count: 9,
      following_count: 4,
    });
    const view = await render(<UserProfileScreen />);
    await waitFor(() => expect(view.getByText("朋友")).toBeTruthy());
    expect(view.getByTestId("profile-content-visible").props.children).toBe("true");

    await fireEvent.press(view.getByText("follow.followButton"));
    await waitFor(() => expect(mockFollow).toHaveBeenCalledWith("route-target"));
    expect(mockSaveCache).toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({
        user_id: "canonical-target",
        followed_by_me: true,
        follows_me: true,
        is_friend: true,
        follower_count: 9,
        following_count: 4,
      }),
      "route-target",
    );

    await fireEvent.press(view.getByText("profile.message"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/chat/[id]",
      params: { id: "canonical-target", name: "朋友", avatar: "" },
    });
  });

  it("ignores the old profile completion after changing the target, including route reuse", async () => {
    const oldProfile = deferred<PublicProfile>();
    mockProfile
      .mockReturnValueOnce(oldProfile.promise)
      .mockResolvedValueOnce(profile("canonical-b", "用户 B"))
      .mockResolvedValueOnce(profile("canonical-a-new", "用户 A 新请求"));
    const view = await render(<UserProfileScreen />);

    mockParams = { id: "target-b" };
    await act(async () => {
      view.rerender(<UserProfileScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("用户 B")).toBeTruthy());

    mockParams = { id: "route-target" };
    await act(async () => {
      view.rerender(<UserProfileScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("用户 A 新请求")).toBeTruthy());

    await act(async () => {
      oldProfile.resolve(profile("canonical-old", "旧请求"));
      await oldProfile.promise;
    });
    expect(view.queryByText("旧请求")).toBeNull();
    expect(view.getByText("用户 A 新请求")).toBeTruthy();
  });

  it("uses a fresh account-scoped route cache without refetching the profile", async () => {
    mockReadCache.mockResolvedValueOnce({
      profile: profile("canonical-cache", "缓存用户"),
      updatedAt: 10,
      expiresAt: 20,
      isStale: false,
      isRetained: true,
      isLegacy: false,
    });
    const view = await render(<UserProfileScreen />);
    await waitFor(() => expect(view.getByText("缓存用户")).toBeTruthy());
    expect(mockProfile).not.toHaveBeenCalled();
  });

  it("applies a route-scoped relationship event to a canonical profile", async () => {
    const view = await render(<UserProfileScreen />);
    await waitFor(() => expect(view.getByText("朋友")).toBeTruthy());

    await act(async () => {
      for (const listener of mockRelationshipListeners) {
        listener({
          relationship: {
            ...relationship("route-target", true),
            follows_me: true,
            is_friend: true,
            follower_count: 7,
          },
        });
      }
      await Promise.resolve();
    });

    await waitFor(() => expect(view.getByText("follow.followingButton")).toBeTruthy());
    expect(mockSaveCache).toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({
        user_id: "canonical-target",
        followed_by_me: true,
        follows_me: true,
        is_friend: true,
        follower_count: 7,
      }),
      "route-target",
    );
  });

  it("publishes the profile without waiting for a slow recommendation request", async () => {
    const recommendations = deferred<[]>();
    mockRecommended.mockReturnValueOnce(recommendations.promise);
    const view = await render(<UserProfileScreen />);

    await waitFor(() => expect(view.getByText("朋友")).toBeTruthy());
    expect(mockRecommended).toHaveBeenCalledWith(18, "route-target");

    recommendations.resolve([]);
    await waitFor(() => expect(view.getByText("profile.suggestions.unavailable")).toBeTruthy());
  });

  it("shows recommendation nicknames without login accounts or dismiss controls", async () => {
    mockRecommended.mockResolvedValueOnce([
      {
        user_id: "suggested-user",
        username: "gray-login-account",
        nickname: "推荐昵称",
        avatar_url: "",
        bio: "",
        following_count: 0,
        follower_count: 0,
        followed_by_me: false,
        follows_me: false,
        is_friend: false,
      },
    ]);

    const view = await render(<UserProfileScreen />);
    await waitFor(() => expect(view.getByText("推荐昵称")).toBeTruthy());

    expect(view.queryByText("gray-login-account")).toBeNull();
    expect(view.queryByText("xmark")).toBeNull();
  });

  it("starts all four recommendation fallbacks without waiting for a slow profile", async () => {
    const pendingProfile = deferred<PublicProfile>();
    mockProfile.mockReturnValueOnce(pendingProfile.promise);
    const view = await render(<UserProfileScreen />);

    await waitFor(() => {
      expect(mockFollowing).toHaveBeenCalledTimes(2);
      expect(mockFollowers).toHaveBeenCalledTimes(2);
    });
    expect(mockFollowing).toHaveBeenNthCalledWith(1, {
      userId: "route-target",
      page: 1,
      limit: 18,
    });
    expect(mockFollowers).toHaveBeenNthCalledWith(1, {
      userId: "route-target",
      page: 1,
      limit: 18,
    });
    expect(mockFollowing).toHaveBeenNthCalledWith(2, { page: 1, limit: 18 });
    expect(mockFollowers).toHaveBeenNthCalledWith(2, { page: 1, limit: 18 });

    pendingProfile.resolve(profile("canonical-target", "慢资料"));
    await waitFor(() => expect(view.getByText("慢资料")).toBeTruthy());
  });

  it("optimistically requests a private follow, blocks a duplicate press and rolls back failure", async () => {
    const privateProfile = profile("route-target", "私密朋友");
    privateProfile.is_private = true;
    const pendingFollow = deferred<FollowRelationship>();
    mockProfile.mockResolvedValueOnce(privateProfile);
    mockFollow.mockReturnValueOnce(pendingFollow.promise);
    const view = await render(<UserProfileScreen />);
    await waitFor(() => expect(view.getByText("私密朋友")).toBeTruthy());

    await fireEvent.press(view.getByText("follow.followButton"));
    await fireEvent.press(view.getByText("follow.requestedButton"));

    expect(mockFollow).toHaveBeenCalledTimes(1);
    expect(view.getByText("follow.requestedButton")).toBeTruthy();

    pendingFollow.reject(new Error("request denied"));
    await waitFor(() => expect(view.getByText("follow.followButton")).toBeTruthy());
    expect(view.getByLabelText("toast").props.children).toBe("request denied");
  });

  it("shows the native unavailable toast instead of opening a chat for a blank profile ID", async () => {
    mockProfile.mockResolvedValueOnce(profile("", "无效用户"));
    const view = await render(<UserProfileScreen />);
    await waitFor(() => expect(view.getByText("无效用户")).toBeTruthy());
    await fireEvent.press(view.getByText("profile.message"));
    await waitFor(() =>
      expect(view.getByLabelText("toast").props.children).toBe("profile.message.unavailable"),
    );
    expect(router.push).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/chat/[id]" }),
    );
  });
});

function profile(userId: string, nickname: string): PublicProfile {
  return {
    user_id: userId,
    username: "friend",
    nickname,
    avatar_url: "",
    bio: "",
    gender: "",
    birthday: "",
    location: "",
    following_count: 0,
    follower_count: 0,
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
    follow_requested: false,
    is_verified: false,
    category: "",
    pronouns: "",
    is_private: false,
    can_view_moments: true,
    can_message: true,
    mutual_followers: [],
    highlights: [],
  };
}

function relationship(userId: string, followedByMe: boolean): FollowRelationship {
  return {
    user_id: userId,
    followed_by_me: followedByMe,
    follows_me: false,
    is_friend: false,
    follower_count: followedByMe ? 1 : 0,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, reject, resolve };
}
