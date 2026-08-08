import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Alert } from "react-native";

import AddGroupMembersScreen from "@/app/add-group-members";
import { APIError } from "@/api/client";

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  const MockFlatList = ({
    data,
    keyExtractor,
    renderItem,
  }: {
    data: unknown[];
    keyExtractor: (item: unknown, index: number) => string;
    renderItem: (info: { item: unknown; index: number }) => ReactNode;
  }) =>
    React.createElement(
      actual.View,
      null,
      data.map((item, index) =>
        React.createElement(
          actual.View,
          { key: keyExtractor(item, index) },
          renderItem({ item, index }),
        ),
      ),
    );
  return new Proxy(actual, {
    get(target, property, receiver) {
      return property === "FlatList" ? MockFlatList : Reflect.get(target, property, receiver);
    },
  });
});

let mockParams: Record<string, string> = { id: "21" };
const mockBack = jest.fn();
const mockAddGroupMembers = jest.fn();
const mockGetFriendList = jest.fn();
const mockGetGroupDetail = jest.fn();
const mockLoadCachedFriends = jest.fn();
const mockLoadFriendsWithNativeCache = jest.fn();
const mockNotifyGroupMembersAdded = jest.fn();
const mockSaveCachedGroupDetail = jest.fn();
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
  useAuth: () => ({ user: { user_id: "owner-a" } }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockT }),
}));

jest.mock("@/api/bwchat", () => ({
  addGroupMembers: (...args: unknown[]) => mockAddGroupMembers(...args),
  getFriendList: (...args: unknown[]) => mockGetFriendList(...args),
  getGroupDetail: (...args: unknown[]) => mockGetGroupDetail(...args),
}));

jest.mock("@/services/friends/FriendRepository", () => ({
  loadCachedFriends: (...args: unknown[]) => mockLoadCachedFriends(...args),
  loadFriendsWithNativeCache: (...args: unknown[]) => mockLoadFriendsWithNativeCache(...args),
}));

jest.mock("@/services/groups/GroupMembersUpdates", () => ({
  notifyGroupMembersAdded: (...args: unknown[]) => mockNotifyGroupMembersAdded(...args),
}));

jest.mock("@/services/groups/GroupDetailRepository", () => ({
  saveCachedGroupDetail: (...args: unknown[]) => mockSaveCachedGroupDetail(...args),
}));

const alice = {
  user_id: "friend-a",
  nickname: "Alice",
  avatar_url: "/alice.png",
  added_at: "now",
};
const bob = {
  user_id: "friend-b",
  nickname: "Bob",
  avatar_url: "/bob.png",
  added_at: "now",
};

describe("AddGroupMembers native screen parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: "21" };
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    mockGetGroupDetail.mockResolvedValue({ members: [] });
    mockLoadCachedFriends.mockResolvedValue([]);
    mockLoadFriendsWithNativeCache.mockResolvedValue([alice, bob]);
    mockAddGroupMembers.mockResolvedValue(undefined);
    mockSaveCachedGroupDetail.mockImplementation(async (_ownerId, detail) => detail);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it("runs detail and friends independently and blocks cached rows until both settle", async () => {
    const detail = deferred<{ members: { user_id: string }[] }>();
    const friends = deferred<(typeof alice)[]>();
    mockGetGroupDetail.mockReturnValue(detail.promise);
    mockLoadCachedFriends.mockResolvedValue([alice, bob]);
    mockLoadFriendsWithNativeCache.mockReturnValue(friends.promise);

    await render(<AddGroupMembersScreen />);
    await waitFor(() => {
      expect(mockGetGroupDetail).toHaveBeenCalledWith(21);
      expect(mockLoadFriendsWithNativeCache).toHaveBeenCalledWith("owner-a", expect.any(Function));
    });
    expect(screen.queryByText("Alice")).toBeNull();

    detail.resolve({ members: [{ user_id: "friend-b" }] });
    friends.resolve([alice, bob]);

    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());
    expect(screen.queryByText("Bob")).toBeNull();
  });

  it("shows only the fixed group-detail error while keeping a successful friend result", async () => {
    mockGetGroupDetail.mockRejectedValue(new APIError("raw backend detail", 503));
    await render(<AddGroupMembersScreen />);

    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());
    expect(Alert.alert).toHaveBeenCalledWith("common.error", "group.loadFailed", [
      { text: "common.confirm", style: "cancel" },
    ]);
  });

  it("silently keeps seeded friends when friend refresh fails", async () => {
    mockLoadCachedFriends.mockResolvedValue([alice, bob]);
    mockLoadFriendsWithNativeCache.mockRejectedValue(new Error("offline"));
    mockGetGroupDetail.mockResolvedValue({ members: [{ user_id: "friend-b" }] });
    await render(<AddGroupMembersScreen />);

    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());
    expect(screen.queryByText("Bob")).toBeNull();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("filters all existing friends into the native all-added empty state", async () => {
    mockGetGroupDetail.mockResolvedValue({
      members: [{ user_id: "friend-a" }, { user_id: "friend-b" }],
    });
    await render(<AddGroupMembersScreen />);
    await waitFor(() => expect(screen.getByText("group.addMembers.allAdded")).toBeTruthy());
  });

  it("toggles selection and locks rapid duplicate submissions", async () => {
    const request = deferred<void>();
    mockAddGroupMembers.mockReturnValue(request.promise);
    await render(<AddGroupMembersScreen />);
    await waitFor(() => expect(screen.getByLabelText("Alice")).toBeTruthy());

    fireEvent.press(screen.getByLabelText("Alice"));
    await waitFor(() => expect(screen.getByText("GROUP.ADDMEMBERS.SELECTCOUNT|1")).toBeTruthy());
    const addButton = screen.getByText("common.add");
    fireEvent.press(addButton);
    await waitFor(() => expect(screen.queryByText("common.add")).toBeNull());
    fireEvent.press(addButton);
    expect(mockAddGroupMembers).toHaveBeenCalledTimes(1);
    expect(mockAddGroupMembers).toHaveBeenCalledWith(21, ["friend-a"]);
    await act(async () => {
      request.resolve();
      await request.promise;
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });

  it("notifies only a successful group-members parent before dismissing", async () => {
    mockParams = { id: "21", source: "group-members" };
    await render(<AddGroupMembersScreen />);
    await waitFor(() => expect(screen.getByLabelText("Alice")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Alice"));
    await waitFor(() => expect(screen.getByText("GROUP.ADDMEMBERS.SELECTCOUNT|1")).toBeTruthy());
    fireEvent.press(screen.getByText("common.add"));

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockNotifyGroupMembersAdded).toHaveBeenCalledWith(21);
  });

  it("refreshes a direct GroupDetail parent without sending the GroupMembers callback", async () => {
    const refreshed = { group_id: 21, members: [alice] };
    mockGetGroupDetail.mockResolvedValueOnce({ members: [] }).mockResolvedValueOnce(refreshed);
    await render(<AddGroupMembersScreen />);
    await waitFor(() => expect(screen.getByLabelText("Alice")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Alice"));
    await waitFor(() => expect(screen.getByText("GROUP.ADDMEMBERS.SELECTCOUNT|1")).toBeTruthy());
    fireEvent.press(screen.getByText("common.add"));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockSaveCachedGroupDetail).toHaveBeenCalledWith("owner-a", refreshed),
    );
    expect(mockNotifyGroupMembersAdded).not.toHaveBeenCalled();
  });

  it("marks a pending submission dismissed when cancel wins", async () => {
    const request = deferred<void>();
    mockAddGroupMembers.mockReturnValue(request.promise);
    const view = await render(<AddGroupMembersScreen />);
    await waitFor(() => expect(screen.getByLabelText("Alice")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("Alice"));
    await waitFor(() => expect(screen.getByText("GROUP.ADDMEMBERS.SELECTCOUNT|1")).toBeTruthy());
    await fireEvent.press(screen.getByText("common.add"));
    await waitFor(() => expect(screen.queryByText("common.add")).toBeNull());
    await fireEvent.press(screen.getByText("common.cancel"));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();

    await view.unmount();
    request.resolve();
    await request.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockNotifyGroupMembersAdded).not.toHaveBeenCalled();
    expect(mockSaveCachedGroupDetail).not.toHaveBeenCalled();
  });

  it("localizes API failures and leaves the selection available for retry", async () => {
    const request = deferred<void>();
    const failure = new APIError("gateway", 503);
    mockAddGroupMembers.mockReturnValue(request.promise);
    await render(<AddGroupMembersScreen />);
    await waitFor(() => expect(screen.getByLabelText("Alice")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Alice"));
    await waitFor(() => expect(screen.getByText("GROUP.ADDMEMBERS.SELECTCOUNT|1")).toBeTruthy());
    fireEvent.press(screen.getByText("common.add"));
    await waitFor(() => expect(screen.queryByText("common.add")).toBeNull());
    await act(async () => {
      request.reject(failure);
      await request.promise.catch(() => undefined);
    });

    expect(Alert.alert).toHaveBeenCalledWith("common.error", "api.serverUnavailable", [
      { text: "common.confirm", style: "cancel" },
    ]);
    expect(screen.getByText("common.add")).toBeTruthy();
    expect(screen.getByLabelText("Alice").props.accessibilityState).toEqual({ selected: true });
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
