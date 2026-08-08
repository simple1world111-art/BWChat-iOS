import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import {
  followUser,
  getFollowers,
  getFollowing,
  getRecommendedUsers,
  unfollowUser,
} from "@/api/bwchat";
import FollowListScreen from "@/app/follow-list";
import type { FollowRelationship, FollowUser, FollowUsersPage, User } from "@/models";
import {
  loadCachedFollowListPage,
  readCachedFollowListSnapshot,
  saveCachedFollowList,
} from "@/services/friends/FollowListRepository";
import { publishFollowRelationship } from "@/services/friends/FollowRelationshipStore";

let mockParams: Record<string, string | undefined> = { kind: "following" };
let mockAuthUser: User | null = { user_id: "owner-a" } as User;
const mockRelationshipListeners = new Set<(event: unknown) => void>();

jest.mock("expo-router", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");
  return {
    router: { push: jest.fn() },
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

jest.mock("@/api/bwchat", () => ({
  followUser: jest.fn(),
  getFollowers: jest.fn(),
  getFollowing: jest.fn(),
  getRecommendedUsers: jest.fn(),
  unfollowUser: jest.fn(),
}));

jest.mock("@/components/Avatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { Avatar: ({ name }: { name: string }) => <MockText>{`avatar:${name}`}</MockText> };
});

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    TopToast: ({ message }: { message: string | null }) =>
      message ? <MockText accessibilityLabel="toast">{message}</MockText> : null,
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockAuthUser }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

jest.mock("@/services/friends/FollowListRepository", () => ({
  loadCachedFollowListPage: jest.fn(),
  readCachedFollowListSnapshot: jest.fn(),
  saveCachedFollowList: jest.fn(),
}));

jest.mock("@/services/friends/FollowRelationshipStore", () => ({
  publishFollowRelationship: jest.fn((event: unknown, _ownerId: string) => {
    for (const listener of [...mockRelationshipListeners]) listener(event);
  }),
  reconcileFollowListRelationship: jest.requireActual("@/services/friends/FollowRelationshipStore")
    .reconcileFollowListRelationship,
  subscribeFollowRelationship: jest.fn((_ownerId: string, listener: (event: unknown) => void) => {
    mockRelationshipListeners.add(listener);
    return () => mockRelationshipListeners.delete(listener);
  }),
}));

const mockFollowUser = jest.mocked(followUser);
const mockGetFollowers = jest.mocked(getFollowers);
const mockGetFollowing = jest.mocked(getFollowing);
const mockGetRecommended = jest.mocked(getRecommendedUsers);
const mockUnfollowUser = jest.mocked(unfollowUser);
const mockLoadCached = jest.mocked(loadCachedFollowListPage);
const mockReadCached = jest.mocked(readCachedFollowListSnapshot);
const mockSaveCached = jest.mocked(saveCachedFollowList);
const mockPublish = jest.mocked(publishFollowRelationship);

describe("Follow List screen state machine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRelationshipListeners.clear();
    mockParams = { kind: "following" };
    mockAuthUser = { user_id: "owner-a" } as User;
    mockReadCached.mockResolvedValue(null);
    mockSaveCached.mockResolvedValue();
    mockLoadCached.mockImplementation((_owner, _subject, _kind, _force, fetchPage) => fetchPage());
    mockGetFollowing.mockResolvedValue(page([]));
    mockGetFollowers.mockResolvedValue(page([]));
    mockGetRecommended.mockResolvedValue([]);
    mockFollowUser.mockResolvedValue(relationship("alice", true));
    mockUnfollowUser.mockResolvedValue(relationship("alice", false));
  });

  afterEach(() => cleanup());

  it("renders filtered initial recommendations immediately and retains them for empty remote data", async () => {
    const pending = deferred<FollowUser[]>();
    mockParams = {
      kind: "recommended",
      excludeUserId: "viewed",
      initialUsers: JSON.stringify([
        user("owner-a", "Owner"),
        user("viewed", "Viewed"),
        user("alice", "Alice"),
        user("alice", "Duplicate"),
      ]),
    };
    mockGetRecommended.mockReturnValueOnce(pending.promise);
    const view = await render(<FollowListScreen />);

    expect(view.getByText("Alice")).toBeTruthy();
    expect(view.queryByText("Owner")).toBeNull();
    expect(view.queryByText("Viewed")).toBeNull();
    expect(view.queryByText("Duplicate")).toBeNull();
    expect(mockGetRecommended).toHaveBeenCalledWith(50, "viewed");

    await act(async () => {
      pending.resolve([]);
      await pending.promise;
    });
    expect(view.getByText("Alice")).toBeTruthy();
    expect(view.queryByLabelText("toast")).toBeNull();
  });

  it("locks duplicate presses synchronously and broadcasts server-owned state for the owner", async () => {
    const pending = deferred<FollowRelationship>();
    mockGetFollowing.mockResolvedValueOnce(page([user("alice", "Alice")]));
    mockFollowUser.mockReturnValueOnce(pending.promise);
    const view = await render(<FollowListScreen />);
    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());
    mockSaveCached.mockClear();

    const toggle = view.getByTestId("follow-list-toggle-alice");
    await fireEvent.press(toggle);
    await fireEvent.press(toggle);
    expect(mockFollowUser).toHaveBeenCalledTimes(1);
    expect(view.getByTestId("follow-list-toggle-alice").props.accessibilityState).toEqual({
      disabled: true,
      selected: true,
    });

    const server = {
      ...relationship("alice", true),
      follows_me: true,
      is_friend: true,
      follower_count: 10,
    };
    await act(async () => {
      pending.resolve(server);
      await pending.promise;
    });
    await waitFor(() =>
      expect(view.getByTestId("follow-list-toggle-alice").props.accessibilityState).toEqual({
        disabled: false,
        selected: true,
      }),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      {
        relationship: server,
        user: expect.objectContaining({
          user_id: "alice",
          followed_by_me: true,
          follower_count: 1,
        }),
      },
      "owner-a",
    );
    await waitFor(() =>
      expect(mockSaveCached).toHaveBeenLastCalledWith(
        "owner-a",
        "owner-a",
        "following",
        expect.objectContaining({
          users: [
            expect.objectContaining({
              user_id: "alice",
              followed_by_me: true,
              follows_me: true,
              is_friend: true,
              follower_count: 10,
            }),
          ],
          has_more: false,
        }),
      ),
    );
  });

  it("loads a next page once while overlapping end-reached events share the screen lock", async () => {
    const nextPage = deferred<FollowUsersPage>();
    mockGetFollowing
      .mockResolvedValueOnce(page([user("alice", "Alice")], 2))
      .mockReturnValueOnce(nextPage.promise);
    const view = await render(<FollowListScreen />);
    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());

    await fireEvent(view.getByTestId("follow-list"), "onEndReached");
    await fireEvent(view.getByTestId("follow-list"), "onEndReached");
    await waitFor(() => expect(mockGetFollowing).toHaveBeenCalledTimes(2));
    expect(mockGetFollowing).toHaveBeenLastCalledWith({ page: 2, limit: 30 });

    await act(async () => {
      nextPage.resolve(page([user("bob", "Bob")]));
      await nextPage.promise;
    });
    await waitFor(() => expect(view.getByText("Bob")).toBeTruthy());
    expect(mockGetFollowing).toHaveBeenCalledTimes(2);
  });

  it("restores the exact followed row and error when unfollow fails", async () => {
    mockGetFollowing.mockResolvedValueOnce(page([user("alice", "Alice", true, 7)]));
    mockUnfollowUser.mockRejectedValueOnce(new Error("无法取消关注"));
    const view = await render(<FollowListScreen />);
    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());

    await fireEvent.press(view.getByTestId("follow-list-toggle-alice"));
    await waitFor(() => expect(view.getByLabelText("toast").props.children).toBe("无法取消关注"));
    expect(mockUnfollowUser).toHaveBeenCalledWith("alice");
    expect(view.getByTestId("follow-list-toggle-alice").props.accessibilityState).toEqual({
      disabled: false,
      selected: true,
    });
  });

  it("ignores an old-account page after the route identity changes", async () => {
    const oldPage = deferred<FollowUsersPage>();
    mockLoadCached
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce(page([user("bob", "Bob")]));
    const view = await render(<FollowListScreen />);

    mockAuthUser = { user_id: "owner-b" } as User;
    await act(async () => {
      view.rerender(<FollowListScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("Bob")).toBeTruthy());

    await act(async () => {
      oldPage.resolve(page([user("alice", "Old Alice")]));
      await oldPage.promise;
    });
    expect(view.queryByText("Old Alice")).toBeNull();
    expect(view.getByText("Bob")).toBeTruthy();
  });

  it("opens the exact profile route from row identity", async () => {
    mockGetFollowers.mockResolvedValueOnce(page([user("alice", "Alice")]));
    mockParams = { kind: "followers", userId: "subject" };
    const view = await render(<FollowListScreen />);
    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());
    await fireEvent.press(view.getByText("Alice"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/user-profile",
      params: { id: "alice" },
    });
  });
});

function page(users: FollowUser[], nextPage: number | null = null): FollowUsersPage {
  return {
    users,
    has_more: nextPage !== null,
    ...(nextPage !== null ? { next_page: nextPage } : {}),
  };
}

function user(
  userId: string,
  nickname: string,
  followedByMe = false,
  followerCount = 0,
): FollowUser {
  return {
    user_id: userId,
    username: userId,
    nickname,
    avatar_url: "",
    bio: "",
    following_count: 0,
    follower_count: followerCount,
    followed_by_me: followedByMe,
    follows_me: false,
    is_friend: false,
  };
}

function relationship(userId: string, followedByMe: boolean): FollowRelationship {
  return {
    user_id: userId,
    followed_by_me: followedByMe,
    follows_me: false,
    is_friend: false,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
