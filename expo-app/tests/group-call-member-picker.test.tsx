import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { getGroupDetail } from "@/api/bwchat";
import { GroupCallMemberPicker } from "@/components/calls/GroupCallMemberPicker";
import type { GroupDetail, GroupMember } from "@/models";
import {
  loadCachedGroupDetail,
  saveCachedGroupDetail,
} from "@/services/groups/GroupDetailRepository";

jest.mock("@/api/bwchat", () => ({ getGroupDetail: jest.fn() }));
jest.mock("@/services/groups/GroupDetailRepository", () => ({
  groupMemberDisplayName: (member: GroupMember) =>
    member.group_nickname?.trim() || member.nickname.trim() || member.user_id,
  loadCachedGroupDetail: jest.fn(),
  saveCachedGroupDetail: jest.fn(async (_ownerId: string, detail: GroupDetail) => detail),
}));
jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { user_id: "self", nickname: "Me", avatar_url: "" } }),
}));
const mockTranslate = (key: string, value?: number) =>
  ({
    "call.video": "视频通话",
    "call.voice": "语音通话",
    "common.cancel": "取消",
    "common.confirm": "确定",
    "common.retry": "重试",
    "group.loadFailed": "加载群信息失败",
    "group.members.search": "搜索群成员",
    "mention.noResults": "没有找到群成员",
  })[key] ?? `${key}|${value ?? ""}`;
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockTranslate }),
}));
jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});
jest.mock("react-native-safe-area-context", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    initialWindowMetrics: {
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, right: 0, bottom: 34, left: 0 },
    },
    SafeAreaProvider: MockView,
    SafeAreaView: MockView,
  };
});
jest.mock("@/components/ui/SilentRefreshControl", () => ({
  SilentRefreshControl: () => null,
}));
jest.mock("@/components/Avatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { Avatar: ({ name }: { name: string }) => <MockText>{`avatar:${name}`}</MockText> };
});

const request = jest.mocked(getGroupDetail);
const readCache = jest.mocked(loadCachedGroupDetail);
const writeCache = jest.mocked(saveCachedGroupDetail);

describe("group call member picker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readCache.mockResolvedValue(null);
    request.mockRejectedValue(new Error("offline"));
  });

  it("excludes self, deduplicates members and confirms selected IDs in list order", async () => {
    const onConfirm = jest.fn();
    request.mockResolvedValue(
      detail([
        member({ user_id: "self", nickname: "Me" }),
        member({ user_id: "u2", nickname: "Bob" }),
        member({ user_id: "u1", nickname: "Alice", group_nickname: "队长" }),
      ]),
    );
    const view = await render(
      <GroupCallMemberPicker
        callType="video"
        groupId={7}
        initialMembers={[
          member({ user_id: "self", nickname: "Me" }),
          member({ user_id: "u2", nickname: "Bob" }),
          member({ user_id: "u1", nickname: "" }),
          member({ user_id: "u1", nickname: "Alice", group_nickname: "队长" }),
        ]}
        onClose={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(view.getByText("视频通话")).toBeTruthy();
    expect(view.queryByText("Me")).toBeNull();
    expect(view.getAllByText("u1")).toHaveLength(1);
    await waitFor(() => expect(writeCache).toHaveBeenCalled());

    await act(async () => {
      fireEvent.press(view.getByText("Bob"));
      fireEvent.press(view.getByText("队长"));
    });
    expect(view.getByText("group.selectedMembers.count|2")).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByText("确定"));
    });
    expect(onConfirm).toHaveBeenCalledWith(["u1", "u2"]);
  });

  it("searches by display name or ID and reloads an empty failed member list", async () => {
    request
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(detail([member({ user_id: "u3", nickname: "Retry User" })]));
    const view = await render(
      <GroupCallMemberPicker
        callType="voice"
        groupId={7}
        initialMembers={[]}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText("加载群信息失败")).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByText("重试"));
    });
    await waitFor(() => expect(view.getByText("Retry User")).toBeTruthy());
    expect(writeCache).toHaveBeenCalled();

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText("搜索群成员"), "U3");
    });
    expect(view.getByText("Retry User")).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText("搜索群成员"), "missing");
    });
    expect(view.getByText("没有找到群成员")).toBeTruthy();
  });
});

function member(overrides: Partial<GroupMember>): GroupMember {
  return { user_id: "user", nickname: "User", avatar_url: "", role: "member", ...overrides };
}

function detail(members: GroupMember[]): GroupDetail {
  return {
    group_id: 7,
    name: "Group",
    avatar_url: "",
    creator_id: "owner",
    members,
    is_public: true,
    notification_settings: {
      group_id: 7,
      muted: false,
      notify_mentions_me: true,
      notify_mentions_all: true,
      important_member_ids: [],
      revision: 0,
    },
    viewer_settings: { group_id: 7, remark: "", show_member_nicknames: true, revision: 1 },
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
