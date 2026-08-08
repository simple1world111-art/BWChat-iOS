import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { getGroupDetail } from "@/api/bwchat";
import { ChatMentionPicker } from "@/components/messages/ChatMentionPicker";
import type { GroupDetail, GroupMember } from "@/models";
import {
  loadCachedGroupDetail,
  saveCachedGroupDetail,
} from "@/services/groups/GroupDetailRepository";

jest.mock("@/api/bwchat", () => ({ getGroupDetail: jest.fn() }));
jest.mock("@/services/groups/GroupDetailRepository", () => ({
  loadCachedGroupDetail: jest.fn(),
  saveCachedGroupDetail: jest.fn(async () => undefined),
}));
jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { user_id: "self", nickname: "Me", avatar_url: "" } }),
}));
const mockTranslate = (key: string) =>
  ({
    "common.cancel": "取消",
    "common.done": "完成",
    "common.retry": "重试",
    "group.loadFailed": "群聊加载失败",
    "mention.all": "所有人",
    "mention.multiSelect": "多选",
    "mention.noResults": "没有找到群成员",
    "mention.search": "搜索群成员",
    "mention.title": "选择提及的人",
  })[key] ?? key;
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockTranslate }),
}));
jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});
jest.mock("@/components/Avatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { Avatar: ({ name }: { name: string }) => <MockText>{`avatar:${name}`}</MockText> };
});

const request = jest.mocked(getGroupDetail);
const readCache = jest.mocked(loadCachedGroupDetail);
const writeCache = jest.mocked(saveCachedGroupDetail);

describe("mention picker UI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readCache.mockResolvedValue(null);
    request.mockRejectedValue(new Error("offline"));
  });

  it("shows mention-all only for an empty search and filters by nickname or user id", async () => {
    const view = await renderPicker({ allowsMentionAll: true });
    expect(view.getByText("所有人")).toBeTruthy();
    expect(view.getByText("Alice")).toBeTruthy();
    expect(view.getByText("bob")).toBeTruthy();
    expect(view.queryByText("Me")).toBeNull();

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText("搜索群成员"), "U2");
    });
    expect(view.queryByText("所有人")).toBeNull();
    expect(view.queryByText("Alice")).toBeNull();
    expect(view.getByText("bob")).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText("搜索群成员"), "missing");
    });
    expect(view.getByText("没有找到群成员")).toBeTruthy();
  });

  it("returns one selection immediately or selected entries in native member order", async () => {
    const onSelect = jest.fn();
    const single = await renderPicker({ onSelect });
    await act(async () => {
      fireEvent.press(single.getByText("Alice"));
    });
    expect(onSelect).toHaveBeenLastCalledWith([
      { kind: "direct", user_id: "u1", nickname: "Alice" },
    ]);
    await single.unmount();

    onSelect.mockClear();
    const multiple = await renderPicker({ allowsMentionAll: true, onSelect });
    await act(async () => {
      fireEvent.press(multiple.getByText("多选"));
    });
    await act(async () => {
      fireEvent.press(multiple.getByText("所有人"));
    });
    await act(async () => {
      fireEvent.press(multiple.getByText("bob"));
    });
    await act(async () => {
      fireEvent.press(multiple.getByText("Alice"));
    });
    await act(async () => {
      fireEvent.press(multiple.getByText("完成"));
    });
    expect(onSelect).toHaveBeenCalledWith([
      { kind: "all", nickname: "所有人" },
      { kind: "direct", user_id: "u1", nickname: "Alice" },
      { kind: "direct", user_id: "u2", nickname: "bob" },
    ]);
  });

  it("shows the native empty error state and retries a forced server refresh", async () => {
    request
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(detail([member({ user_id: "u3", nickname: "Retry User" })]));
    const view = await renderPicker({ initialMembers: [] });
    await waitFor(() => expect(view.getByText("群聊加载失败")).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByText("重试"));
    });
    await waitFor(() => expect(view.getByText("Retry User")).toBeTruthy());
    expect(request).toHaveBeenCalledTimes(2);
    expect(writeCache).toHaveBeenCalled();
  });
});

async function renderPicker(
  options: {
    allowsMentionAll?: boolean;
    initialMembers?: GroupMember[];
    onSelect?: jest.Mock;
  } = {},
) {
  return render(
    <ChatMentionPicker
      allowsMentionAll={options.allowsMentionAll ?? false}
      groupId={7}
      initialMembers={
        options.initialMembers ?? [
          member({ user_id: "self", nickname: "Me" }),
          member({ user_id: "u2", nickname: "bob" }),
          member({ user_id: "u1", nickname: "", avatar_url: "" }),
          member({ user_id: "u1", nickname: "Alice", avatar_url: "/alice.jpg", role: "admin" }),
        ]
      }
      onClose={jest.fn()}
      onSelect={options.onSelect ?? jest.fn()}
    />,
  );
}

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
