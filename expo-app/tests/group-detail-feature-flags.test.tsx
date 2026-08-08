import { act, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import GroupDetailScreen from "@/app/group-detail";

const mockDismissTo = jest.fn();
const mockPush = jest.fn();
const mockGetGroupDetail = jest.fn();
const mockLoadCachedGroupDetailSnapshot = jest.fn();
const mockReadGroupPinned = jest.fn();
const mockSaveCachedGroupDetail = jest.fn();
let mockFeatureFlags: { key: string; enabled: boolean }[] = [];
let mockOwnerId = "owner-a";
const mockT = (key: string, ...args: (string | number)[]) => [key, ...args].join("|");

jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    router: { dismissTo: mockDismissTo, push: mockPush },
    Stack: {
      Screen: ({ options }: { options?: { headerRight?: () => ReactNode } }) =>
        options?.headerRight?.() ?? null,
    },
    useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, [effect]),
    useLocalSearchParams: () => ({ id: "21" }),
  };
});

jest.mock("expo-symbols", () => {
  const { Text } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock("@/components/Avatar", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    UserAvatarButton: ({ accessibilityName }: { accessibilityName: string }) => (
      <Text>{`avatar:${accessibilityName}`}</Text>
    ),
  };
});

jest.mock("@/components/TopToast", () => ({ TopToast: () => null }));

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { user_id: mockOwnerId } }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockT }),
}));

jest.mock("@/providers/RemoteConfigProvider", () => ({
  useRemoteConfig: () => ({
    config: {
      featureFlags: mockFeatureFlags,
    },
  }),
}));

jest.mock("@/api/bwchat", () => ({
  clearGroupMessageHistory: jest.fn(),
  dismissGroup: jest.fn(),
  getGroupDetail: (...args: unknown[]) => mockGetGroupDetail(...args),
  leaveGroup: jest.fn(),
  updateConversationPreference: jest.fn(),
  updateGroupVisibility: jest.fn(),
}));

jest.mock("@/services/groups/GroupDetailRepository", () => ({
  effectiveGroupCapabilities: (detail: { capabilities: unknown }) => detail.capabilities,
  groupDetailGeneration: jest.fn(() => 0),
  groupMemberDisplayName: (member: { group_nickname?: string; nickname: string }) =>
    member.group_nickname || member.nickname,
  loadCachedGroupDetailSnapshot: (...args: unknown[]) => mockLoadCachedGroupDetailSnapshot(...args),
  removeCachedGroupDetail: jest.fn(),
  saveCachedGroupDetail: (...args: unknown[]) => mockSaveCachedGroupDetail(...args),
  subscribeGroupDetail: jest.fn(() => () => undefined),
}));

jest.mock("@/services/groups/GroupInfoV2Repository", () => ({
  updateGroupNotificationSettings: jest.fn(),
  updateGroupViewerSettings: jest.fn(),
}));

jest.mock("@/services/groups/GroupPreferenceRepository", () => ({
  readGroupPinned: (...args: unknown[]) => mockReadGroupPinned(...args),
  saveGroupPinned: jest.fn(),
}));

jest.mock("@/services/groups/GroupRepository", () => ({ removeCachedGroup: jest.fn() }));
jest.mock("@/services/messages/GroupHistoryClearRepository", () => ({
  applyGroupHistoryClear: jest.fn(),
}));
jest.mock("@/services/realtime/ChatRealtimeService", () => ({
  chatRealtimeService: { subscribe: jest.fn(() => () => undefined) },
}));

describe("Group detail feature-flag behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOwnerId = "owner-a";
    mockLoadCachedGroupDetailSnapshot.mockResolvedValue(null);
    mockReadGroupPinned.mockResolvedValue(false);
    mockSaveCachedGroupDetail.mockImplementation(
      async (_ownerId: string, detail: unknown) => detail,
    );
    mockGetGroupDetail.mockResolvedValue(groupDetailFixture());
  });

  it("hides every GroupInfo v2 child flow when the native parent flag is off", async () => {
    mockFeatureFlags = [
      { key: "group_info_v2", enabled: false },
      { key: "group_invite_qr_v1", enabled: true },
      { key: "group_announcement_v1", enabled: true },
      { key: "group_viewer_settings_v1", enabled: true },
      { key: "group_reporting_v1", enabled: true },
      { key: "group_message_search_v1", enabled: true },
      { key: "group_notification_settings_v1", enabled: false },
    ];

    await act(async () => {
      render(<GroupDetailScreen />);
    });
    await waitFor(() => expect(screen.getByText("group.name.title")).toBeTruthy());

    for (const hidden of [
      "group.invite.title",
      "group.announcement.title",
      "group.remark.title",
      "group.search.title",
      "group.myNickname.title",
      "group.showMemberNicknames",
      "group.report.title",
      "group.notifications.mute",
    ]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    for (const retained of [
      "group.name.title",
      "group.pin.title",
      "chatBackground.currentChat",
      "group.clear.action",
      "group.leave.action",
    ]) {
      expect(screen.getByText(retained)).toBeTruthy();
    }
  });

  it("keeps the native notification flag independent while GroupInfo v2 is off", async () => {
    mockFeatureFlags = [
      { key: "group_info_v2", enabled: false },
      { key: "group_notification_settings_v1", enabled: true },
    ];

    await act(async () => {
      render(<GroupDetailScreen />);
    });

    await waitFor(() => expect(screen.getByText("group.notifications.mute")).toBeTruthy());
    expect(screen.queryByText("group.invite.title")).toBeNull();
    expect(screen.queryByText("group.announcement.title")).toBeNull();
  });

  it("uses the fresh native profile snapshot without repeating the detail request", async () => {
    mockFeatureFlags = [];
    mockLoadCachedGroupDetailSnapshot.mockResolvedValue({
      detail: groupDetailFixture("十分钟缓存群"),
      savedAt: Date.now(),
      isFresh: true,
    });

    await render(<GroupDetailScreen />);
    await waitFor(() => expect(screen.getByText("十分钟缓存群")).toBeTruthy());
    expect(mockGetGroupDetail).not.toHaveBeenCalled();
  });

  it("discards an old account response after the signed-in owner changes", async () => {
    mockFeatureFlags = [];
    const ownerARequest = deferred<ReturnType<typeof groupDetailFixture>>();
    mockGetGroupDetail
      .mockReturnValueOnce(ownerARequest.promise)
      .mockResolvedValueOnce(groupDetailFixture("乙账号群"));

    const rendered = await render(<GroupDetailScreen />);
    await waitFor(() => expect(mockGetGroupDetail).toHaveBeenCalledTimes(1));

    await act(async () => {
      mockOwnerId = "owner-b";
      await rendered.rerender(<GroupDetailScreen />);
    });
    await waitFor(() => expect(screen.getByText("乙账号群")).toBeTruthy());

    await act(async () => ownerARequest.resolve(groupDetailFixture("甲账号旧响应")));
    expect(screen.queryByText("甲账号旧响应")).toBeNull();
    expect(mockSaveCachedGroupDetail).not.toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({ name: "甲账号旧响应" }),
    );
  });
});

function groupDetailFixture(name = "周末群") {
  return {
    group_id: 21,
    name,
    avatar_url: "",
    creator_id: "creator-a",
    members: [
      {
        user_id: "owner-a",
        nickname: "测试用户",
        avatar_url: "",
        role: "member",
      },
    ],
    is_public: false,
    notification_settings: {
      group_id: 21,
      muted: false,
      notify_mentions_me: true,
      notify_mentions_all: true,
      important_member_ids: [],
      revision: 1,
    },
    viewer_settings: {
      group_id: 21,
      remark: "",
      show_member_nicknames: true,
      revision: 1,
    },
    announcement: {
      announcement_id: "announcement-a",
      group_id: 21,
      title: "规则",
      content: "友好聊天",
      revision: 1,
    },
    current_member: {
      user_id: "owner-a",
      nickname: "测试用户",
      avatar_url: "",
      role: "member",
      group_nickname: "群昵称",
    },
    capabilities: {
      can_manage_members: false,
      can_edit_group: false,
      can_edit_announcement: false,
      can_create_invite: false,
      can_change_visibility: false,
      can_dismiss_group: false,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
