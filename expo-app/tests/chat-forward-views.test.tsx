import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { forwardMessages, getForwardBundle, getFriendList, getGroups } from "@/api/bwchat";
import {
  ChatSelectionToolbar,
  ForwardBundleDetailModal,
  ForwardBundleMessageCard,
  ForwardFlowModal,
} from "@/components/messages/ChatForwardViews";

jest.mock("@/api/bwchat", () => ({
  createIdempotencyKey: jest.fn(() => "op-1"),
  forwardMessages: jest.fn(),
  getForwardBundle: jest.fn(),
  getFriendList: jest.fn(),
  getGroups: jest.fn(),
}));
jest.mock("@/components/messages/ChatReplyViews", () => ({
  useChatMessageActivationGuard: () => () => true,
  useChatMessageLongPressBridge: () => ({
    delayLongPress: 450,
    onLongPress: undefined,
    onPressOut: undefined,
  }),
}));
const mockTranslate = (key: string, ...args: (string | number)[]) =>
  ({
    "chat.action.forward": "转发",
    "chat.action.multiSelect": "多选",
    "common.cancel": "取消",
    "common.close": "关闭",
    "common.delete": "删除",
    "common.done": "完成",
    "common.error": "错误",
    "common.loadFailed": "加载失败",
    "common.retry": "重试",
    "common.send": "发送",
    "forward.chooseChat": "选择一个聊天",
    "forward.maximum9": "最多选择9个聊天",
    "forward.searchChats": "搜索聊天",
    "message.voice": "[语音]",
    "messages.sendFailed": "发送失败",
    "selection.notSelected": "未选择",
    "selection.selected": "已选择",
  })[key] ?? `${key}${args.length ? `:${args.join(",")}` : ""}`;
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockTranslate }),
}));
jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});
jest.mock("react-native-safe-area-context", () => {
  const { View: MockView } = jest.requireActual("react-native");
  const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { bottom: 34, left: 0, right: 0, top: 47 },
  };
  return {
    initialWindowMetrics: metrics,
    SafeAreaProvider: ({
      children,
      initialMetrics,
    }: {
      children: React.ReactNode;
      initialMetrics?: typeof metrics;
    }) => (
      <MockView
        accessibilityLabel={`safe-area-top:${initialMetrics?.insets.top ?? 0}`}
        testID="forward.safeAreaProvider"
      >
        {children}
      </MockView>
    ),
    SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) => (
      <MockView {...props}>{children}</MockView>
    ),
  };
});
jest.mock("@/components/Avatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { Avatar: ({ name }: { name: string }) => <MockText>{`avatar:${name}`}</MockText> };
});
jest.mock("@/components/GroupMemberAvatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    GroupMemberAvatar: ({ groupId }: { groupId: number }) => (
      <MockText>{`group-avatar:${groupId}`}</MockText>
    ),
  };
});
jest.mock("@/components/GroupAvatarIcon", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { GroupAvatarIcon: () => <MockText>group-avatar</MockText> };
});

const friends = jest.mocked(getFriendList);
const groups = jest.mocked(getGroups);
const submitForward = jest.mocked(forwardMessages);
const loadBundle = jest.mocked(getForwardBundle);

describe("batch selection and forwarding UI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    friends.mockResolvedValue([
      { user_id: "u1", nickname: "Alice", avatar_url: "/a.jpg", added_at: "2026-08-07T00:00:00Z" },
    ]);
    groups.mockResolvedValue([
      {
        group_id: 9,
        name: "Study Group",
        avatar_url: "",
        creator_id: "owner",
        member_count: 3,
        unread_count: 0,
        is_public: true,
        is_muted: false,
      },
    ]);
    submitForward.mockResolvedValue({ client_operation_id: "op-1", created_messages: [] });
  });

  it("exposes the original selection toolbar actions and 230pt bundle card tap", async () => {
    const onForward = jest.fn();
    const onDelete = jest.fn();
    const onCard = jest.fn();
    const view = await render(
      <>
        <ChatSelectionToolbar count={2} onDelete={onDelete} onForward={onForward} showsForward />
        <ForwardBundleMessageCard
          isFromMe
          onPress={onCard}
          payload={{ bundle_id: "bundle-1", title: "聊天记录", item_count: 3, summary: "A: hi" }}
        />
      </>,
    );
    await act(async () => {
      fireEvent.press(view.getByText("转发"));
    });
    await act(async () => {
      fireEvent.press(view.getByText("删除"));
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText("聊天记录，3"));
    });
    expect(onForward).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onCard).toHaveBeenCalledTimes(1);
    expect(view.getByText("A: hi")).toBeTruthy();
    await view.unmount();
  });

  it("loads direct/group targets, multi-selects, confirms and sends one operation", async () => {
    const onClose = jest.fn();
    const onCompleted = jest.fn();
    const sources = [
      {
        conversation_type: "dm" as const,
        conversation_id: "source",
        message_id: 7,
        expected_version: 1,
      },
    ];
    const view = await render(
      <ForwardFlowModal
        mode="individual"
        onClose={onClose}
        onCompleted={onCompleted}
        preview="两条消息"
        sources={sources}
        visible
      />,
    );
    expect(view.getByTestId("forward.safeAreaProvider")).toBeTruthy();
    expect(view.getByLabelText("safe-area-top:47")).toBeTruthy();
    expect(view.getByTestId("forward.safeAreaScreen")).toBeTruthy();
    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());
    expect(view.getByText("Study Group")).toBeTruthy();
    expect(view.getByText("group-avatar:9")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText("多选"));
    });
    await act(async () => {
      fireEvent.press(view.getByText("Study Group"));
    });
    await act(async () => {
      fireEvent.press(view.getByText("Alice"));
    });
    await act(async () => {
      fireEvent.press(view.getByText("完成"));
    });
    expect(view.getByText("Alice、Study Group")).toBeTruthy();
    expect(view.getByText("两条消息")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText("发送"));
    });
    await waitFor(() =>
      expect(submitForward).toHaveBeenCalledWith({
        client_operation_id: "op-1",
        mode: "individual",
        sources,
        targets: [
          { conversation_type: "dm", conversation_id: "u1" },
          { conversation_type: "group", conversation_id: "9" },
        ],
      }),
    );
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("shows the load failure state and retries both target sources", async () => {
    friends.mockRejectedValueOnce(new Error("offline"));
    groups.mockRejectedValueOnce(new Error("offline"));
    const view = await render(
      <ForwardFlowModal
        mode="single"
        onClose={jest.fn()}
        onCompleted={jest.fn()}
        preview="hello"
        sources={[]}
        visible
      />,
    );
    await waitFor(() => expect(view.getByText("加载失败")).toBeTruthy());
    expect(view.getByText("offline")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText("重试"));
    });
    await waitFor(() => expect(view.getByText("Alice")).toBeTruthy());
    expect(friends).toHaveBeenCalledTimes(2);
    expect(groups).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  it("loads merged bundle detail, localizes voice rows and closes", async () => {
    loadBundle.mockResolvedValue({
      bundle_id: "bundle-1",
      title: "聊天记录",
      created_at: "2026-08-07T00:00:00Z",
      items: [
        {
          ordinal: 1,
          sender_name: "Alice",
          sent_at: "2026-08-07T10:00:00Z",
          message_type: "text",
          summary: "hello",
        },
        {
          ordinal: 2,
          sender_name: "Bob",
          sent_at: "2026-08-07T10:01:00Z",
          message_type: "voice",
          summary: "2s",
        },
      ],
    });
    const onClose = jest.fn();
    const view = await render(<ForwardBundleDetailModal bundleId="bundle-1" onClose={onClose} />);
    await waitFor(() => expect(view.getByText("hello")).toBeTruthy());
    expect(view.getByText("[语音]")).toBeTruthy();
    expect(view.getByText("Alice")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText("关闭"));
    });
    expect(loadBundle).toHaveBeenCalledWith("bundle-1");
    expect(onClose).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
