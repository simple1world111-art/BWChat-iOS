import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import {
  acceptFriendRequest,
  getFriendList,
  getFriendRequests,
  rejectFriendRequest,
} from "@/api/bwchat";
import FriendRequestsScreen from "@/app/friend-requests";
import type { FriendInfo, FriendRequest, User } from "@/models";
import {
  loadCachedFriendRequests,
  loadFriendRequestsWithNativeCache,
  loadFriendsWithNativeCache,
  markFriendRequestResolved,
} from "@/services/friends/FriendRepository";

let mockAuthUser: User | null = { user_id: "owner-a" } as User;
let mockStackOptions: Record<string, unknown> = {};

jest.mock("expo-router", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");
  return {
    router: { back: jest.fn() },
    Stack: {
      Screen: ({ options }: { options: Record<string, unknown> }) => {
        mockStackOptions = options;
        const headerLeft = options.headerLeft;
        return typeof headerLeft === "function" ? (headerLeft as () => React.ReactNode)() : null;
      },
    },
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(callback, [callback]);
    },
  };
});

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    LinearGradient: ({ children }: { children: React.ReactNode }) => (
      <MockView>{children}</MockView>
    ),
  };
});

jest.mock("@/api/bwchat", () => ({
  acceptFriendRequest: jest.fn(),
  getFriendList: jest.fn(),
  getFriendRequests: jest.fn(),
  rejectFriendRequest: jest.fn(),
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
  useLocalization: () => ({
    t: (key: string, ...args: unknown[]) =>
      args.length > 0 ? `${key}:${args.map(String).join(",")}` : key,
  }),
}));

jest.mock("@/services/friends/FriendRepository", () => ({
  loadCachedFriendRequests: jest.fn(),
  loadFriendRequestsWithNativeCache: jest.fn(),
  loadFriendsWithNativeCache: jest.fn(),
  markFriendRequestResolved: jest.fn(),
}));

const mockAccept = jest.mocked(acceptFriendRequest);
const mockGetFriendList = jest.mocked(getFriendList);
const mockGetFriendRequests = jest.mocked(getFriendRequests);
const mockReject = jest.mocked(rejectFriendRequest);
const mockLoadCached = jest.mocked(loadCachedFriendRequests);
const mockLoadRequests = jest.mocked(loadFriendRequestsWithNativeCache);
const mockLoadFriends = jest.mocked(loadFriendsWithNativeCache);
const mockMarkResolved = jest.mocked(markFriendRequestResolved);

describe("Friend Requests screen interactions", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockStackOptions = {};
    mockAuthUser = { user_id: "owner-a" } as User;
    mockLoadCached.mockResolvedValue([]);
    mockLoadRequests.mockResolvedValue([]);
    mockLoadFriends.mockResolvedValue([]);
    mockMarkResolved.mockResolvedValue();
    mockGetFriendRequests.mockResolvedValue([]);
    mockGetFriendList.mockResolvedValue([]);
    mockAccept.mockResolvedValue();
    mockReject.mockResolvedValue();
  });

  afterEach(() => cleanup());

  it("renders the exact localized 36-point UIKit-style back control", async () => {
    const view = await render(<FriendRequestsScreen />);

    expect(mockStackOptions).toMatchObject({
      headerBackVisible: false,
      headerShadowVisible: false,
      headerTitleAlign: "center",
      title: "contacts.friendRequests",
    });
    const back = view.getByTestId("friend-requests-back");
    expect(back.props).toMatchObject({
      accessibilityLabel: "common.back",
      accessibilityRole: "button",
      hitSlop: 8,
    });

    await fireEvent.press(back);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("shows the native empty state during a cache-miss load without a spinner", async () => {
    const loading = deferred<FriendRequest[]>();
    mockLoadCached.mockReturnValue(loading.promise);
    const view = await render(<FriendRequestsScreen />);

    expect(view.getByText("person.crop.circle.badge.clock")).toBeTruthy();
    expect(view.getByText("friendRequests.empty")).toBeTruthy();
    expect(view.queryByTestId("friend-requests-loading")).toBeNull();
    view.unmount();
    loading.resolve([]);
  });

  it("keeps the seeded account cache and exposes no load-error UI", async () => {
    const alice = friendRequest(20, "Alice");
    mockLoadCached.mockResolvedValue([alice]);
    mockLoadRequests.mockRejectedValue(new Error("offline"));
    const view = await render(<FriendRequestsScreen />);

    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());
    expect(view.queryByLabelText("toast")).toBeNull();
    expect(view.queryByTestId("friend-requests-loading")).toBeNull();
  });

  it("exposes localized row actions, owner hints and idle accessibility state", async () => {
    const alice = friendRequest(21, "Alice");
    mockLoadCached.mockResolvedValue([alice]);
    mockLoadRequests.mockResolvedValue([alice]);
    const view = await render(<FriendRequestsScreen />);
    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());

    expect(view.getByTestId("friend-request-reject-21").props).toMatchObject({
      accessibilityHint: "Alice",
      accessibilityLabel: "common.cancel",
      accessibilityRole: "button",
      accessibilityState: { busy: false, disabled: false },
    });
    expect(view.getByTestId("friend-request-accept-21").props).toMatchObject({
      accessibilityHint: "Alice",
      accessibilityLabel: "common.confirm",
      accessibilityRole: "button",
      accessibilityState: { busy: false, disabled: false },
    });
  });

  it("locks duplicate Accept presses, removes the row, refreshes friends, and toasts", async () => {
    const alice = friendRequest(1, "Alice");
    const pending = deferred<void>();
    mockLoadCached.mockResolvedValue([alice]);
    mockLoadRequests.mockResolvedValue([alice]);
    mockAccept.mockReturnValue(pending.promise);
    const view = await render(<FriendRequestsScreen />);
    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());

    const accept = view.getByTestId("friend-request-accept-1");
    await fireEvent.press(accept);
    await fireEvent.press(accept);
    expect(mockAccept).toHaveBeenCalledTimes(1);
    expect(view.getByTestId("friend-request-accept-1").props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    await waitFor(() => expect(view.queryByText("Alice")).toBeNull());
    expect(mockMarkResolved).toHaveBeenCalledWith("owner-a", 1);
    expect(mockLoadFriends).toHaveBeenCalledWith("owner-a", mockGetFriendList);
    expect(view.getByLabelText("toast").props.children).toBe("friends.added:Alice");
  });

  it("shows the native Accept success toast before a slow friends-cache refresh finishes", async () => {
    const alice = friendRequest(7, "Alice");
    const refreshingFriends = deferred<FriendInfo[]>();
    mockLoadCached.mockResolvedValue([alice]);
    mockLoadRequests.mockResolvedValue([alice]);
    mockLoadFriends.mockReturnValue(refreshingFriends.promise);
    const view = await render(<FriendRequestsScreen />);
    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());

    await fireEvent.press(view.getByTestId("friend-request-accept-7"));

    await waitFor(() => expect(view.queryByText("Alice")).toBeNull());
    expect(view.getByLabelText("toast").props.children).toBe("friends.added:Alice");
    expect(mockLoadFriends).toHaveBeenCalledWith("owner-a", mockGetFriendList);

    await act(async () => {
      refreshingFriends.resolve([]);
      await refreshingFriends.promise;
    });
  });

  it("keeps a failed Reject row with no visible failure toast and releases the lock", async () => {
    const alice = friendRequest(2, "Alice");
    mockLoadCached.mockResolvedValue([alice]);
    mockLoadRequests.mockResolvedValue([alice]);
    mockReject.mockRejectedValue(new Error("offline"));
    const view = await render(<FriendRequestsScreen />);
    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());

    await fireEvent.press(view.getByTestId("friend-request-reject-2"));
    await waitFor(() =>
      expect(view.getByTestId("friend-request-reject-2").props.accessibilityState).toEqual({
        busy: false,
        disabled: false,
      }),
    );
    expect(view.getByText("Alice")).toBeTruthy();
    expect(view.queryByLabelText("toast")).toBeNull();
  });

  it("reconciles independent concurrent rows without resurrecting either completion", async () => {
    const alice = friendRequest(3, "Alice");
    const bob = friendRequest(4, "Bob");
    const accepting = deferred<void>();
    const rejecting = deferred<void>();
    mockLoadCached.mockResolvedValue([alice, bob]);
    mockLoadRequests.mockResolvedValue([alice, bob]);
    mockAccept.mockReturnValue(accepting.promise);
    mockReject.mockReturnValue(rejecting.promise);
    const view = await render(<FriendRequestsScreen />);
    await waitFor(() => expect(view.getByText("Bob")).toBeTruthy());

    await fireEvent.press(view.getByTestId("friend-request-accept-3"));
    await fireEvent.press(view.getByTestId("friend-request-reject-4"));

    await act(async () => {
      accepting.resolve();
      await accepting.promise;
    });
    await waitFor(() => expect(view.queryByText("Alice")).toBeNull());
    expect(view.getByText("Bob")).toBeTruthy();

    await act(async () => {
      rejecting.resolve();
      await rejecting.promise;
    });
    await waitFor(() => expect(view.queryByText("Bob")).toBeNull());
    expect(view.getByText("friendRequests.empty")).toBeTruthy();
  });

  it("filters a successful mutation from an older load response", async () => {
    const alice = friendRequest(5, "Alice");
    const bob = friendRequest(6, "Bob");
    const loading = deferred<FriendRequest[]>();
    mockLoadCached.mockResolvedValue([alice]);
    mockLoadRequests.mockReturnValue(loading.promise);
    const view = await render(<FriendRequestsScreen />);
    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());

    await fireEvent.press(view.getByTestId("friend-request-reject-5"));
    await waitFor(() => expect(view.queryByText("Alice")).toBeNull());

    await act(async () => {
      loading.resolve([alice, bob]);
      await loading.promise;
    });
    await waitFor(() => expect(view.getByText("Bob")).toBeTruthy());
    expect(view.queryByText("Alice")).toBeNull();
  });

  it("ignores the old owner's late cached and network loads after an account switch", async () => {
    const alice = friendRequest(30, "Alice");
    const bob = friendRequest(31, "Bob");
    const oldCached = deferred<FriendRequest[]>();
    const oldNetwork = deferred<FriendRequest[]>();
    mockLoadCached.mockImplementation((ownerId) =>
      ownerId === "owner-a" ? oldCached.promise : Promise.resolve([bob]),
    );
    mockLoadRequests.mockImplementation((ownerId) =>
      ownerId === "owner-a" ? oldNetwork.promise : Promise.resolve([bob]),
    );
    const view = await render(<FriendRequestsScreen />);

    mockAuthUser = { user_id: "owner-b" } as User;
    await view.rerender(<FriendRequestsScreen />);
    await waitFor(() => expect(view.getByText("Bob")).toBeTruthy());

    await act(async () => {
      oldCached.resolve([alice]);
      oldNetwork.resolve([alice]);
      await Promise.all([oldCached.promise, oldNetwork.promise]);
    });
    expect(view.getByText("Bob")).toBeTruthy();
    expect(view.queryByText("Alice")).toBeNull();
  });

  it("does not let an old owner's late mutation alter the new owner or show its toast", async () => {
    const alice = friendRequest(40, "Alice");
    const bob = friendRequest(41, "Bob");
    const accepting = deferred<void>();
    mockLoadCached.mockImplementation((ownerId) =>
      Promise.resolve(ownerId === "owner-a" ? [alice] : [bob]),
    );
    mockLoadRequests.mockImplementation((ownerId) =>
      Promise.resolve(ownerId === "owner-a" ? [alice] : [bob]),
    );
    mockAccept.mockReturnValue(accepting.promise);
    const view = await render(<FriendRequestsScreen />);
    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());
    await fireEvent.press(view.getByTestId("friend-request-accept-40"));

    mockAuthUser = { user_id: "owner-b" } as User;
    await view.rerender(<FriendRequestsScreen />);
    await waitFor(() => expect(view.getByText("Bob")).toBeTruthy());

    await act(async () => {
      accepting.resolve();
      await accepting.promise;
    });
    expect(view.getByText("Bob")).toBeTruthy();
    expect(view.queryByText("Alice")).toBeNull();
    expect(view.queryByLabelText("toast")).toBeNull();
    expect(mockMarkResolved).toHaveBeenCalledWith("owner-a", 40);
    expect(mockLoadFriends).toHaveBeenCalledWith("owner-a", mockGetFriendList);
  });
});

function friendRequest(requestId: number, nickname: string): FriendRequest {
  return {
    request_id: requestId,
    user_id: `user-${requestId}`,
    nickname,
    avatar_url: `/avatar-${requestId}.png`,
    created_at: "2026-08-08T00:00:00Z",
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
