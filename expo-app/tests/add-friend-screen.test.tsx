import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import { followUser, searchUsers, unfollowUser } from "@/api/bwchat";
import AddFriendScreen from "@/app/add-friend";
import type { FollowRelationship, FollowUser, SearchUser } from "@/models";
import {
  followUserFromSearch,
  publishFollowRelationship,
} from "@/services/friends/FollowRelationshipStore";

let mockOwnerId = "owner-a";

jest.mock("expo-router", () => ({
  router: {
    back: jest.fn(),
    dismiss: jest.fn(),
    push: jest.fn(),
  },
  Stack: {
    Screen: ({ options }: { options?: { headerLeft?: () => React.ReactNode } }) =>
      options?.headerLeft?.() ?? null,
  },
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@/api/bwchat", () => ({
  followUser: jest.fn(),
  searchUsers: jest.fn(),
  unfollowUser: jest.fn(),
}));

jest.mock("@/components/Avatar", () => {
  const { Pressable: MockPressable, Text: MockText } = jest.requireActual("react-native");
  return {
    UserAvatarButton: ({ userId }: { userId: string }) => (
      <MockPressable accessibilityLabel={`avatar:${userId}`} accessibilityRole="button">
        <MockText>{`avatar:${userId}`}</MockText>
      </MockPressable>
    ),
  };
});

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    TopToast: ({ message }: { message: string | null }) =>
      message ? <MockText accessibilityLabel="toast">{message}</MockText> : null,
  };
});

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { user_id: mockOwnerId } }),
}));

jest.mock("@/services/friends/FollowRelationshipStore", () => ({
  followUserFromSearch: jest.fn((user: SearchUser): FollowUser => ({
    user_id: user.user_id,
    username: "",
    nickname: user.nickname,
    avatar_url: user.avatar_url,
    bio: "",
    following_count: 0,
    follower_count: 0,
    followed_by_me: user.followed_by_me,
    follows_me: false,
    is_friend: false,
  })),
  publishFollowRelationship: jest.fn(),
  subscribeFollowRelationship: jest.fn(() => () => undefined),
}));

const mockSearchUsers = jest.mocked(searchUsers);
const mockFollowUser = jest.mocked(followUser);
const mockUnfollowUser = jest.mocked(unfollowUser);
const mockPublishFollowRelationship = jest.mocked(publishFollowRelationship);
const mockFollowUserFromSearch = jest.mocked(followUserFromSearch);

describe("Add Friend screen interactions", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockOwnerId = "owner-a";
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("matches initial, whitespace, loading, clear and stale-response search states", async () => {
    const pending = deferred<SearchUser[]>();
    mockSearchUsers.mockReturnValueOnce(pending.promise);
    const view = await render(<AddFriendScreen />);
    const input = view.getByLabelText("addFriend.search.placeholder");

    expect(view.getByText("addFriend.searchHint")).toBeTruthy();
    await fireEvent.changeText(input, "  ");
    await act(() => jest.advanceTimersByTime(400));
    expect(mockSearchUsers).not.toHaveBeenCalled();
    expect(view.getByText("addFriend.noResults")).toBeTruthy();

    await fireEvent.changeText(input, "  Alice  ");
    await act(() => jest.advanceTimersByTime(400));
    expect(mockSearchUsers).toHaveBeenCalledWith("Alice");
    expect(view.getByTestId("add-friend-search-loading")).toBeTruthy();

    await fireEvent.press(view.getByLabelText("common.clear"));
    expect(view.getByLabelText("addFriend.search.placeholder").props.value).toBe("");
    expect(view.queryByTestId("add-friend-search-loading")).toBeNull();
    expect(view.getByText("addFriend.searchHint")).toBeTruthy();

    await act(async () => {
      pending.resolve([searchUser({ nickname: "过期结果" })]);
      await pending.promise;
    });
    expect(view.queryByText("过期结果")).toBeNull();
  });

  it("silently maps a failed search to the native no-results state", async () => {
    mockSearchUsers.mockRejectedValueOnce(new Error("network"));
    const view = await render(<AddFriendScreen />);
    await fireEvent.changeText(view.getByLabelText("addFriend.search.placeholder"), "missing");
    await advanceSearch();
    expect(view.getByText("addFriend.noResults")).toBeTruthy();
    expect(view.queryByLabelText("toast")).toBeNull();
  });

  it("opens profiles and dismisses the modal 250 ms before direct chat", async () => {
    mockSearchUsers.mockResolvedValueOnce([
      searchUser({ user_id: "user/7", nickname: "小七", avatar_url: "/seven.png" }),
    ]);
    const view = await render(<AddFriendScreen />);
    await fireEvent.changeText(view.getByLabelText("addFriend.search.placeholder"), "seven");
    await advanceSearch();

    await fireEvent.press(view.getByLabelText("小七"));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/user-profile",
      params: { id: "user/7" },
    });

    jest.mocked(router.push).mockClear();
    await fireEvent.press(view.getByLabelText("profile.message"));
    expect(router.dismiss).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTime(249));
    expect(router.push).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/chat/[id]",
      params: { id: "user/7", name: "小七", avatar: "/seven.png" },
    });

    await fireEvent.press(view.getByLabelText("common.cancel"));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("reconciles an optimistic follow into a private-account request", async () => {
    const pending = deferred<FollowRelationship>();
    mockSearchUsers.mockResolvedValueOnce([searchUser()]);
    mockFollowUser.mockReturnValueOnce(pending.promise);
    const view = await render(<AddFriendScreen />);
    await fireEvent.changeText(view.getByLabelText("addFriend.search.placeholder"), "user");
    await advanceSearch();

    const follow = view.getByLabelText("follow.followButton");
    await fireEvent.press(follow);
    expect(mockFollowUser).toHaveBeenCalledTimes(1);
    expect(mockFollowUser).toHaveBeenCalledWith("user");
    expect(view.getByLabelText("follow.followingButton").props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });

    const relationship: FollowRelationship = {
      user_id: "user",
      followed_by_me: false,
      follows_me: false,
      is_friend: false,
      follow_requested: true,
    };
    await act(async () => {
      pending.resolve(relationship);
      await pending.promise;
    });
    await waitFor(() => expect(view.getByLabelText("follow.requestedButton")).toBeTruthy());
    expect(mockPublishFollowRelationship).toHaveBeenCalledWith(
      {
        relationship,
        user: expect.objectContaining({ user_id: "user", followed_by_me: false }),
      },
      "owner-a",
    );
    expect(mockFollowUserFromSearch).toHaveBeenCalledTimes(1);
  });

  it("drops an old account follow completion after switching owners", async () => {
    const pending = deferred<FollowRelationship>();
    mockSearchUsers.mockResolvedValueOnce([searchUser()]);
    mockFollowUser.mockReturnValueOnce(pending.promise);
    const view = await render(<AddFriendScreen />);
    await fireEvent.changeText(view.getByLabelText("addFriend.search.placeholder"), "user");
    await advanceSearch();
    await fireEvent.press(view.getByLabelText("follow.followButton"));

    mockOwnerId = "owner-b";
    await act(async () => {
      view.rerender(<AddFriendScreen />);
      await Promise.resolve();
    });
    await act(async () => {
      pending.resolve({
        user_id: "user",
        followed_by_me: true,
        follows_me: false,
        is_friend: false,
      });
      await pending.promise;
    });

    expect(mockPublishFollowRelationship).not.toHaveBeenCalled();
    expect(view.getByText("addFriend.searchHint")).toBeTruthy();
  });

  it("uses DELETE for followed/requested rows and rolls back with the exact error toast", async () => {
    mockSearchUsers.mockResolvedValueOnce([
      searchUser({ followed_by_me: true, follow_requested: false }),
    ]);
    mockUnfollowUser.mockRejectedValueOnce(new Error("无法取消关注"));
    const view = await render(<AddFriendScreen />);
    await fireEvent.changeText(view.getByLabelText("addFriend.search.placeholder"), "user");
    await advanceSearch();

    await fireEvent.press(view.getByLabelText("follow.followingButton"));
    await waitFor(() => expect(view.getByLabelText("toast").props.children).toBe("无法取消关注"));
    expect(mockUnfollowUser).toHaveBeenCalledWith("user");
    expect(view.getByLabelText("follow.followingButton")).toBeTruthy();
  });
});

async function advanceSearch(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(400);
    await Promise.resolve();
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function searchUser(change: Partial<SearchUser> = {}): SearchUser {
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
