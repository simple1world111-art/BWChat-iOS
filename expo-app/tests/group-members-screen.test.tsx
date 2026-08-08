import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Alert } from "react-native";

import GroupMembersScreen from "@/app/group-members";
import type { GroupCapabilities, GroupDetail, GroupMember } from "@/models";
import { executeGroupMemberRemoval } from "@/services/groups/GroupMembersRemoval";
import { notifyGroupMembersAdded } from "@/services/groups/GroupMembersUpdates";

interface MockFlatListProps {
  alwaysBounceVertical?: boolean;
  contentInsetAdjustmentBehavior?: string;
  data: unknown[];
  keyExtractor: (item: unknown, index: number) => string;
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  [key: string]: unknown;
}

let mockFlatListProps: MockFlatListProps | undefined;

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  const MockFlatList = (props: MockFlatListProps) => {
    mockFlatListProps = props;
    const { data, keyExtractor, renderItem } = props;
    return React.createElement(
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
  };
  return new Proxy(actual, {
    get(target, property, receiver) {
      return property === "FlatList" ? MockFlatList : Reflect.get(target, property, receiver);
    },
  });
});

let mockParams: Record<string, string> = { id: "21" };
let mockUserId = "owner-a";
let mockHeaderOptions: {
  title?: string;
  headerRight?: () => ReactNode;
  headerSearchBarOptions?: {
    allowToolbarIntegration?: boolean;
    hideWhenScrolling?: boolean;
    placement?: string;
    onCancelButtonPress?: () => void;
    onChangeText?: (event: { nativeEvent: { text: string } }) => void;
    onClose?: () => void;
  };
} = {};
const mockPush = jest.fn();
const mockGetGroupDetail = jest.fn();
const mockLoadCachedGroupDetail = jest.fn();
const mockSaveCachedGroupDetail = jest.fn();
let mockGroupDetailGeneration = 0;
const mockT = (key: string, ...args: (string | number)[]) => [key, ...args].join("|");

jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Stack: {
    Screen: ({ options }: { options?: typeof mockHeaderOptions }) => {
      mockHeaderOptions = options ?? {};
      return mockHeaderOptions.headerRight?.() ?? null;
    },
    SearchBar: (options: NonNullable<typeof mockHeaderOptions.headerSearchBarOptions>) => {
      const { TextInput: MockTextInput } = jest.requireActual("react-native");
      mockHeaderOptions.headerSearchBarOptions = options;
      return (
        <MockTextInput
          onChangeText={(text: string) => options.onChangeText?.({ nativeEvent: { text } })}
          testID="header-search"
        />
      );
    },
  },
  useLocalSearchParams: () => mockParams,
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@/components/Avatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    UserAvatarButton: ({ accessibilityName }: { accessibilityName: string }) => (
      <MockText>{`avatar:${accessibilityName}`}</MockText>
    ),
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { user_id: mockUserId } }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockT }),
}));

jest.mock("@/api/bwchat", () => ({
  getGroupDetail: (...args: unknown[]) => mockGetGroupDetail(...args),
}));

jest.mock("@/services/groups/GroupMembersRemoval", () => ({
  executeGroupMemberRemoval: jest.fn(),
}));

const mockExecuteGroupMemberRemoval = jest.mocked(executeGroupMemberRemoval);

jest.mock("@/services/groups/GroupDetailRepository", () => ({
  effectiveGroupCapabilities: (detail: GroupDetail) => detail.capabilities,
  groupDetailGeneration: () => mockGroupDetailGeneration,
  groupMemberDisplayName: (member: GroupMember) =>
    member.group_nickname?.trim() || member.nickname.trim() || member.user_id,
  loadCachedGroupDetail: (...args: unknown[]) => mockLoadCachedGroupDetail(...args),
  saveCachedGroupDetail: (...args: unknown[]) => mockSaveCachedGroupDetail(...args),
}));

const managerCapabilities: GroupCapabilities = {
  can_manage_members: true,
  can_edit_group: true,
  can_edit_announcement: true,
  can_create_invite: true,
  can_change_visibility: true,
  can_dismiss_group: true,
};
const alice = groupMember("alice-id", "Alice");
const bob = groupMember("bob-id", "Bobby", "member", "小波");
const owner = groupMember("owner-a", "Owner", "owner");

describe("GroupMembers native screen parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: "21" };
    mockUserId = "owner-a";
    mockHeaderOptions = {};
    mockFlatListProps = undefined;
    mockGroupDetailGeneration = 0;
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    mockLoadCachedGroupDetail.mockResolvedValue(groupDetail([owner, alice, bob]));
    mockGetGroupDetail.mockResolvedValue(groupDetail([owner, alice, bob]));
    mockSaveCachedGroupDetail.mockImplementation(async (_ownerId, detail) => detail);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it("renders the account-scoped parent snapshot with no initial GET", async () => {
    await render(<GroupMembersScreen />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());

    expect(mockLoadCachedGroupDetail).toHaveBeenCalledWith("owner-a", 21);
    expect(mockGetGroupDetail).not.toHaveBeenCalled();
    expect(mockHeaderOptions.title).toBe("group.info.title.count|3");
    expect(screen.getByLabelText("group.addMembers")).toBeTruthy();
    expect(mockHeaderOptions.headerSearchBarOptions).toBeUndefined();
    expect(mockFlatListProps?.alwaysBounceVertical).toBe(true);
    expect(mockFlatListProps?.contentInsetAdjustmentBehavior).toBe("automatic");
    expect(mockFlatListProps?.data).toEqual([owner, alice, bob]);
    expect(mockFlatListProps?.initialScrollIndex).toBeUndefined();
    expect(mockFlatListProps?.contentOffset).toBeUndefined();
  });

  it("keeps a missing parent snapshot empty without adding a non-native detail GET", async () => {
    mockLoadCachedGroupDetail.mockResolvedValue(null);

    await render(<GroupMembersScreen />);
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith("common.error", "group.loadFailed"),
    );

    expect(mockGetGroupDetail).not.toHaveBeenCalled();
    expect(mockHeaderOptions.title).toBe("group.info.title.count|0");
    expect(screen.queryByLabelText("group.addMembers")).toBeNull();
    expect(screen.queryByText("Alice")).toBeNull();
  });

  it("uses the pull-down search over display name, nickname and user id", async () => {
    await render(<GroupMembersScreen />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());

    await act(() =>
      (
        mockFlatListProps?.onTouchStart as
          ((event: { nativeEvent: { pageY: number } }) => void) | undefined
      )?.({ nativeEvent: { pageY: 240 } }),
    );
    await act(() =>
      (
        mockFlatListProps?.onTouchEnd as
          ((event: { nativeEvent: { pageY: number } }) => void) | undefined
      )?.({ nativeEvent: { pageY: 280 } }),
    );
    await waitFor(() => expect(screen.getByTestId("group-members-search")).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId("group-members-search"), "  BOB-ID ");

    await waitFor(() => expect(screen.queryByText("Alice")).toBeNull());
    expect(screen.getByText("小波")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("common.cancel"));
    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());
    expect(mockHeaderOptions.headerSearchBarOptions).toBeUndefined();
    expect(screen.queryByTestId("group-members-search")).toBeNull();
    expect(mockFlatListProps?.data).toEqual([owner, alice, bob]);
  });

  it("opens AddMembers with a scoped success callback source", async () => {
    await render(<GroupMembersScreen />);
    await waitFor(() => expect(screen.getByLabelText("group.addMembers")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("group.addMembers"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/add-group-members",
      params: { id: "21", source: "group-members" },
    });
  });

  it("performs one child GET plus one parent GET only after successful add", async () => {
    const reloaded = groupDetail([owner, bob], { can_manage_members: false });
    const parentSnapshot = groupDetail([owner, bob]);
    mockGetGroupDetail.mockResolvedValueOnce(reloaded).mockResolvedValueOnce(parentSnapshot);

    await render(<GroupMembersScreen />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());
    await act(() => notifyGroupMembersAdded(21));

    await waitFor(() => expect(mockGetGroupDetail).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.getByLabelText("group.addMembers")).toBeTruthy();
    expect(mockSaveCachedGroupDetail).toHaveBeenCalledTimes(1);
    expect(mockSaveCachedGroupDetail).toHaveBeenCalledWith("owner-a", parentSnapshot, 0);
  });

  it("keeps a failed child add reload silent and skips the parent refresh", async () => {
    mockGetGroupDetail.mockRejectedValueOnce(new Error("offline"));
    await render(<GroupMembersScreen />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());
    await act(() => notifyGroupMembersAdded(21));

    await waitFor(() => expect(mockGetGroupDetail).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(mockSaveCachedGroupDetail).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("discards a completed old-account reload after the active account changes", async () => {
    let resolveReload!: (detail: GroupDetail) => void;
    const pendingReload = new Promise<GroupDetail>((resolve) => {
      resolveReload = resolve;
    });
    mockGetGroupDetail.mockReturnValueOnce(pendingReload);
    mockLoadCachedGroupDetail.mockImplementation(async (ownerId: string) =>
      ownerId === "owner-b"
        ? groupDetail([bob], { can_manage_members: false })
        : groupDetail([owner, alice]),
    );

    const view = await render(<GroupMembersScreen />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());
    await act(() => notifyGroupMembersAdded(21));
    await waitFor(() => expect(mockGetGroupDetail).toHaveBeenCalledTimes(1));

    mockUserId = "owner-b";
    await view.rerender(<GroupMembersScreen />);
    await waitFor(() => expect(screen.getByText("小波")).toBeTruthy());

    await act(async () => {
      resolveReload(groupDetail([groupMember("stale", "Stale")]));
      await pendingReload;
    });

    expect(screen.queryByText("Stale")).toBeNull();
    expect(screen.getByText("小波")).toBeTruthy();
    expect(mockGetGroupDetail).toHaveBeenCalledTimes(1);
    expect(mockSaveCachedGroupDetail).not.toHaveBeenCalled();
  });

  it("drops an add reload when the account cache generation advances in flight", async () => {
    let resolveReload!: (detail: GroupDetail) => void;
    const pendingReload = new Promise<GroupDetail>((resolve) => {
      resolveReload = resolve;
    });
    mockGetGroupDetail.mockReturnValueOnce(pendingReload);

    await render(<GroupMembersScreen />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());
    await act(() => notifyGroupMembersAdded(21));
    await waitFor(() => expect(mockGetGroupDetail).toHaveBeenCalledTimes(1));

    mockGroupDetailGeneration = 1;
    await act(async () => {
      resolveReload(groupDetail([groupMember("stale", "Stale")]));
      await pendingReload;
    });

    expect(screen.queryByText("Stale")).toBeNull();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(mockGetGroupDetail).toHaveBeenCalledTimes(1);
    expect(mockSaveCachedGroupDetail).not.toHaveBeenCalled();
  });

  it("never renders the previous account snapshot while the next account cache is loading", async () => {
    let resolveOwnerB!: (detail: GroupDetail) => void;
    const ownerBCache = new Promise<GroupDetail>((resolve) => {
      resolveOwnerB = resolve;
    });
    mockLoadCachedGroupDetail.mockImplementation((ownerId: string) =>
      ownerId === "owner-b" ? ownerBCache : Promise.resolve(groupDetail([owner, alice])),
    );

    const view = await render(<GroupMembersScreen />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());

    mockUserId = "owner-b";
    await view.rerender(<GroupMembersScreen />);

    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.queryByText("小波")).toBeNull();

    await act(async () => {
      resolveOwnerB(groupDetail([bob], { can_manage_members: false }));
      await ownerBCache;
    });
    await waitFor(() => expect(screen.getByText("小波")).toBeTruthy());
  });

  it("drops stale removal callbacks after an account change", async () => {
    let removalCallbacks!: Parameters<typeof executeGroupMemberRemoval>[2];
    let finishRemoval!: () => void;
    mockExecuteGroupMemberRemoval.mockImplementation(
      async (_groupId, _userId, callbacks) =>
        new Promise<void>((resolve) => {
          removalCallbacks = callbacks;
          finishRemoval = resolve;
        }),
    );
    mockLoadCachedGroupDetail.mockImplementation(async (ownerId: string) =>
      ownerId === "owner-b"
        ? groupDetail([bob], { can_manage_members: false })
        : groupDetail([owner, alice]),
    );

    const view = await render(<GroupMembersScreen />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("group.removeMember.title"));
    const confirmation = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    await act(() => {
      void confirmation?.[1]?.onPress?.();
    });
    await waitFor(() => expect(mockExecuteGroupMemberRemoval).toHaveBeenCalledTimes(1));

    mockUserId = "owner-b";
    await view.rerender(<GroupMembersScreen />);
    await waitFor(() => expect(screen.getByText("小波")).toBeTruthy());

    await act(async () => {
      removalCallbacks.onRemoved();
      removalCallbacks.onChanged();
      finishRemoval();
    });

    expect(screen.getByText("小波")).toBeTruthy();
    expect(mockGetGroupDetail).not.toHaveBeenCalled();
    expect(mockSaveCachedGroupDetail).not.toHaveBeenCalled();
  });

  it("uses the exact native remove confirmation and leaves non-member roles gated", async () => {
    const paddedRole = groupMember("padded", "Padded", " member ");
    mockLoadCachedGroupDetail.mockResolvedValue(groupDetail([owner, alice, paddedRole]));
    await render(<GroupMembersScreen />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());

    const removeButtons = screen.getAllByLabelText("group.removeMember.title");
    expect(removeButtons).toHaveLength(1);
    await fireEvent.press(removeButtons[0]!);
    expect(Alert.alert).toHaveBeenCalledWith(
      "group.removeMember.title",
      "group.removeMember.message|Alice",
      [
        { text: "common.cancel", style: "cancel" },
        expect.objectContaining({ text: "group.removeMember.confirm", style: "destructive" }),
      ],
    );
    expect(mockGetGroupDetail).not.toHaveBeenCalled();
    expect(mockSaveCachedGroupDetail).not.toHaveBeenCalled();
  });
});

function groupMember(
  userId: string,
  nickname: string,
  role = "member",
  groupNickname?: string,
): GroupMember {
  return {
    user_id: userId,
    nickname,
    avatar_url: "",
    role,
    ...(groupNickname === undefined ? {} : { group_nickname: groupNickname }),
  };
}

function groupDetail(
  members: GroupMember[],
  capabilityOverride: Partial<GroupCapabilities> = {},
): GroupDetail {
  return {
    group_id: 21,
    name: "周末群",
    avatar_url: "",
    creator_id: "owner-a",
    members,
    is_public: false,
    notification_settings: {
      group_id: 21,
      muted: false,
      notify_mentions_me: true,
      notify_mentions_all: true,
      important_member_ids: [],
      revision: 0,
    },
    viewer_settings: {
      group_id: 21,
      remark: "",
      show_member_nicknames: true,
      revision: 0,
    },
    current_member: owner,
    capabilities: { ...managerCapabilities, ...capabilityOverride },
  };
}
