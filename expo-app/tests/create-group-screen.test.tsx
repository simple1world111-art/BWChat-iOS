import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import CreateGroupScreen from "@/app/create-group";
import type { FollowUser, FollowUsersPage } from "@/models";
import type { CreateGroupInput } from "@/services/groups/CreateGroupCoordinator";

let mockParams: Record<string, string> = {};
let mockUserId = "owner-a";
const mockBack = jest.fn();
const mockGetFollowing = jest.fn();
const mockGetFollowers = jest.fn();
const mockCreateGroupWithNativeRefresh = jest.fn();
const mockT = (key: string, ...args: (string | number)[]) => [key, ...args].join("|");

jest.mock("expo-router", () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  Stack: {
    Screen: ({
      options,
    }: {
      options?: { headerLeft?: () => ReactNode; headerRight?: () => ReactNode };
    }) => (
      <>
        {options?.headerLeft?.()}
        {options?.headerRight?.()}
      </>
    ),
  },
  useLocalSearchParams: () => mockParams,
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@/components/Avatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { Avatar: ({ name }: { name: string }) => <MockText>{`avatar:${name}`}</MockText> };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { user_id: mockUserId } }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockT }),
}));

jest.mock("@/api/bwchat", () => ({
  getFollowing: (...args: unknown[]) => mockGetFollowing(...args),
  getFollowers: (...args: unknown[]) => mockGetFollowers(...args),
}));

jest.mock("@/services/groups/CreateGroupCoordinator", () => ({
  createGroupWithNativeRefresh: (...args: unknown[]) => mockCreateGroupWithNativeRefresh(...args),
}));

const self = followUser("owner-a", "Self", true, true);
const mutual = followUser("mutual", "Mutual", true, true);
const oneWay = followUser("one-way", "One Way", true, false);
const follower = followUser("follower", "Follower", false, true);

describe("CreateGroup native screen parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockUserId = "owner-a";
    mockGetFollowing.mockResolvedValue(page([self, mutual, oneWay]));
    mockGetFollowers.mockResolvedValue(page([self, oneWay, follower]));
    mockCreateGroupWithNativeRefresh.mockResolvedValue(true);
  });

  afterEach(() => cleanup());

  it("starts mutual and follower loads independently and filters native eligibility", async () => {
    await render(<CreateGroupScreen />);

    await waitFor(() => {
      expect(mockGetFollowing).toHaveBeenCalledWith({ page: 1 });
      expect(mockGetFollowers).toHaveBeenCalledWith({ page: 1 });
    });

    await waitFor(() => expect(screen.getByText("Mutual")).toBeTruthy());
    expect(screen.queryByText("Self")).toBeNull();
    expect(screen.queryByText("One Way")).toBeNull();
    await fireEvent.press(screen.getByLabelText("follow.followers"));
    await waitFor(() => expect(screen.getByText("Follower")).toBeTruthy());
    expect(screen.getByText("One Way")).toBeTruthy();
    expect(screen.queryByText("Self")).toBeNull();
  });

  it("continues across a sparse mutual page and deduplicates the next visible page", async () => {
    const mutualTwo = followUser("mutual-2", "Mutual Two", true, true);
    mockGetFollowing
      .mockResolvedValueOnce({ users: [oneWay], has_more: true, next_page: 2 })
      .mockResolvedValueOnce({ users: [mutual], has_more: true, next_page: 3 })
      .mockResolvedValueOnce(page([mutual, mutualTwo]));
    await render(<CreateGroupScreen />);

    await waitFor(() => expect(screen.getByText("Mutual")).toBeTruthy());
    expect(mockGetFollowing.mock.calls.slice(0, 2)).toEqual([[{ page: 1 }], [{ page: 2 }]]);

    await fireEvent.scroll(screen.getByTestId("create-group-mutual-scroll"), {
      nativeEvent: {
        contentOffset: { x: 0, y: 400 },
        contentSize: { width: 400, height: 620 },
        layoutMeasurement: { width: 400, height: 300 },
      },
    });
    await waitFor(() => expect(screen.getByText("Mutual Two")).toBeTruthy());
    expect(mockGetFollowing).toHaveBeenNthCalledWith(3, { page: 3 });
    expect(screen.getAllByText("Mutual")).toHaveLength(1);
  });

  it("shares selection across both pages and submits trimmed native input", async () => {
    mockParams = { isPublic: "true" };
    await render(<CreateGroupScreen />);
    await waitFor(() => expect(screen.getByText("Mutual")).toBeTruthy());

    await fireEvent.press(screen.getByLabelText("Mutual"));
    await waitFor(() => expect(screen.getByText("GROUP.SELECTMEMBERS.COUNT|1")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("follow.followers"));
    await waitFor(() => expect(screen.getByText("group.selectedMembers.count|1")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("Follower"));
    await waitFor(() => expect(screen.getByText("group.selectedMembers.count|2")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("common.back"));

    const nameField = await screen.findByPlaceholderText("group.create.name.placeholder");
    await fireEvent.changeText(nameField, "  周末群  ");
    await waitFor(() => expect(screen.getByDisplayValue("  周末群  ")).toBeTruthy());
    expect(screen.getByText("GROUP.SELECTMEMBERS.COUNT|2")).toBeTruthy();
    expect(screen.getByLabelText("group.isPublic").props.value).toBe(true);
    await fireEvent.press(screen.getByText("common.create"));

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockCreateGroupWithNativeRefresh).toHaveBeenCalledWith({
      name: "周末群",
      memberIds: ["mutual", "follower"],
      isPublic: true,
      ownerId: "owner-a",
      isOwnerCurrent: expect.any(Function),
    });
    const submitted = mockCreateGroupWithNativeRefresh.mock.calls[0]?.[0] as CreateGroupInput;
    expect(submitted.isOwnerCurrent?.()).toBe(true);
  });

  it("keeps Create disabled until both trimmed name and a member exist", async () => {
    await render(<CreateGroupScreen />);
    await waitFor(() => expect(screen.getByText("Mutual")).toBeTruthy());
    const createText = screen.getByText("common.create");
    await fireEvent.press(createText);
    expect(mockCreateGroupWithNativeRefresh).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByPlaceholderText("group.create.name.placeholder"), "   ");
    await fireEvent.press(screen.getByLabelText("Mutual"));
    await waitFor(() => expect(screen.getByText("GROUP.SELECTMEMBERS.COUNT|1")).toBeTruthy());
    await fireEvent.press(screen.getByText("common.create"));
    expect(mockCreateGroupWithNativeRefresh).not.toHaveBeenCalled();
  });

  it("renders the native empty states without inventing an error alert when both sources fail", async () => {
    mockGetFollowing.mockRejectedValue(new Error("mutual offline"));
    mockGetFollowers.mockRejectedValue(new Error("followers offline"));
    await render(<CreateGroupScreen />);

    await waitFor(() => expect(screen.getByText("group.create.noMutualFollows")).toBeTruthy());
    expect(screen.getByLabelText("group.isPublic").props.value).toBe(false);
    await fireEvent.press(screen.getByLabelText("follow.followers"));
    await waitFor(() => expect(screen.getByText("follow.followers.empty")).toBeTruthy());
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("keeps the page open after create failure", async () => {
    mockCreateGroupWithNativeRefresh.mockResolvedValue(false);
    await render(<CreateGroupScreen />);
    await waitFor(() => expect(screen.getByText("Mutual")).toBeTruthy());
    await fireEvent.changeText(
      screen.getByPlaceholderText("group.create.name.placeholder"),
      "失败群",
    );
    await waitFor(() => expect(screen.getByDisplayValue("失败群")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("Mutual"));
    await waitFor(() => expect(screen.getByText("GROUP.SELECTMEMBERS.COUNT|1")).toBeTruthy());
    await fireEvent.press(screen.getByText("common.create"));

    await waitFor(() => expect(mockCreateGroupWithNativeRefresh).toHaveBeenCalledTimes(1));
    expect(mockBack).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("common.create")).toBeTruthy());
  });

  it("does not pop a second page when cancel wins a pending create", async () => {
    const request = deferred<boolean>();
    mockCreateGroupWithNativeRefresh.mockReturnValue(request.promise);
    await render(<CreateGroupScreen />);
    await waitFor(() => expect(screen.getByText("Mutual")).toBeTruthy());
    await fireEvent.changeText(
      screen.getByPlaceholderText("group.create.name.placeholder"),
      "稍后群",
    );
    await waitFor(() => expect(screen.getByDisplayValue("稍后群")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("Mutual"));
    await waitFor(() => expect(screen.getByText("GROUP.SELECTMEMBERS.COUNT|1")).toBeTruthy());
    const createButton = screen.getByLabelText("common.create");
    await fireEvent.press(createButton);
    await fireEvent.press(createButton);
    expect(mockCreateGroupWithNativeRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("common.create").props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    await fireEvent.press(screen.getByText("common.cancel"));
    expect(mockBack).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.resolve(true);
      await request.promise;
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("clears account-owned selection and ignores a late create after an account switch", async () => {
    const oldCreate = deferred<boolean>();
    mockCreateGroupWithNativeRefresh
      .mockReturnValueOnce(oldCreate.promise)
      .mockResolvedValueOnce(true);
    const view = await render(<CreateGroupScreen />);
    await waitFor(() => expect(screen.getByText("Mutual")).toBeTruthy());
    await fireEvent.changeText(
      screen.getByPlaceholderText("group.create.name.placeholder"),
      "旧账号群",
    );
    await fireEvent.press(screen.getByLabelText("Mutual"));
    await fireEvent.press(screen.getByText("common.create"));
    await waitFor(() => expect(mockCreateGroupWithNativeRefresh).toHaveBeenCalledTimes(1));
    const oldInput = mockCreateGroupWithNativeRefresh.mock.calls[0]?.[0] as CreateGroupInput;
    expect(oldInput.isOwnerCurrent?.()).toBe(true);

    mockUserId = "owner-b";
    const ownerB = followUser("owner-b", "Self B", true, true);
    const mutualB = followUser("mutual-b", "Mutual B", true, true);
    mockGetFollowing.mockResolvedValue(page([ownerB, mutualB]));
    mockGetFollowers.mockResolvedValue(page([ownerB]));
    await act(async () => {
      view.rerender(<CreateGroupScreen />);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText("Mutual B")).toBeTruthy());
    expect(oldInput.isOwnerCurrent?.()).toBe(false);
    expect(screen.getByPlaceholderText("group.create.name.placeholder").props.value).toBe("");
    expect(screen.getByText("GROUP.SELECTMEMBERS.COUNT|0")).toBeTruthy();

    await act(async () => {
      oldCreate.resolve(true);
      await oldCreate.promise;
    });
    expect(mockBack).not.toHaveBeenCalled();

    await fireEvent.changeText(
      screen.getByPlaceholderText("group.create.name.placeholder"),
      "新账号群",
    );
    await fireEvent.press(screen.getByLabelText("Mutual B"));
    await fireEvent.press(screen.getByText("common.create"));
    await waitFor(() => expect(mockCreateGroupWithNativeRefresh).toHaveBeenCalledTimes(2));
    expect(mockCreateGroupWithNativeRefresh.mock.calls[1]?.[0]).toMatchObject({
      name: "新账号群",
      memberIds: ["mutual-b"],
      ownerId: "owner-b",
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });

  it("ignores late member-source responses from the previous account", async () => {
    const oldFollowing = deferred<FollowUsersPage>();
    const oldFollowers = deferred<FollowUsersPage>();
    mockGetFollowing.mockReturnValueOnce(oldFollowing.promise);
    mockGetFollowers.mockReturnValueOnce(oldFollowers.promise);
    const view = await render(<CreateGroupScreen />);
    await waitFor(() => {
      expect(mockGetFollowing).toHaveBeenCalledTimes(1);
      expect(mockGetFollowers).toHaveBeenCalledTimes(1);
    });

    mockUserId = "owner-b";
    const ownerB = followUser("owner-b", "Self B", true, true);
    const mutualB = followUser("mutual-b", "Mutual B", true, true);
    const followerB = followUser("follower-b", "Follower B", false, true);
    mockGetFollowing.mockResolvedValue(page([ownerB, mutualB]));
    mockGetFollowers.mockResolvedValue(page([ownerB, followerB]));
    await act(async () => {
      view.rerender(<CreateGroupScreen />);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText("Mutual B")).toBeTruthy());
    await act(async () => {
      oldFollowing.resolve(page([followUser("old-mutual", "Old Mutual", true, true)]));
      oldFollowers.resolve(page([followUser("old-follower", "Old Follower", false, true)]));
      await Promise.all([oldFollowing.promise, oldFollowers.promise]);
    });
    expect(screen.queryByText("Old Mutual")).toBeNull();
    await fireEvent.press(screen.getByLabelText("follow.followers"));
    await waitFor(() => expect(screen.getByText("Follower B")).toBeTruthy());
    expect(screen.queryByText("Old Follower")).toBeNull();
  });

  it("refreshes sources in native order and preserves shared selection", async () => {
    await render(<CreateGroupScreen />);
    await waitFor(() => expect(screen.getByText("Mutual")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("Mutual"));
    await waitFor(() => expect(screen.getByText("GROUP.SELECTMEMBERS.COUNT|1")).toBeTruthy());

    const refreshedFollowing = deferred<FollowUsersPage>();
    const refreshedFollowers = deferred<FollowUsersPage>();
    mockGetFollowing.mockReturnValueOnce(refreshedFollowing.promise);
    mockGetFollowers.mockReturnValueOnce(refreshedFollowers.promise);
    const mutualScroll = screen.getByTestId("create-group-mutual-scroll");
    await act(async () => {
      mutualScroll.props.refreshControl.props.onRefresh();
      await Promise.resolve();
    });
    expect(mockGetFollowing).toHaveBeenCalledTimes(2);
    expect(mockGetFollowers).toHaveBeenCalledTimes(1);

    await act(async () => {
      refreshedFollowing.resolve(page([mutual]));
      await refreshedFollowing.promise;
    });
    await waitFor(() => expect(mockGetFollowers).toHaveBeenCalledTimes(2));
    await act(async () => {
      refreshedFollowers.resolve(page([follower]));
      await refreshedFollowers.promise;
    });
    await waitFor(() => expect(screen.getByText("GROUP.SELECTMEMBERS.COUNT|1")).toBeTruthy());

    await fireEvent.press(screen.getByLabelText("follow.followers"));
    await waitFor(() => expect(screen.getByText("Follower")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("Follower"));
    await waitFor(() => expect(screen.getByText("group.selectedMembers.count|2")).toBeTruthy());
    mockGetFollowing.mockClear();
    mockGetFollowers.mockClear();
    mockGetFollowers.mockResolvedValue(page([follower]));
    const followersScroll = screen.getByTestId("create-group-followers-scroll");
    await act(async () => {
      followersScroll.props.refreshControl.props.onRefresh();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockGetFollowers).toHaveBeenCalledWith({ page: 1 }));
    expect(mockGetFollowing).not.toHaveBeenCalled();
    expect(screen.getByText("group.selectedMembers.count|2")).toBeTruthy();
  });
});

function followUser(
  userId: string,
  nickname: string,
  followedByMe: boolean,
  followsMe: boolean,
): FollowUser {
  return {
    user_id: userId,
    username: userId,
    nickname,
    avatar_url: "",
    bio: "",
    following_count: 0,
    follower_count: 0,
    followed_by_me: followedByMe,
    follows_me: followsMe,
    is_friend: false,
  };
}

function page(users: FollowUser[]): FollowUsersPage {
  return { users, has_more: false };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
