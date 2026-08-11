import { act, fireEvent, render } from "@testing-library/react-native";

import {
  ChatMessageActionOverlay,
  ChatQuotedMessageView,
  ChatReplyPreviewBar,
  ChatTimelineLocatorButton,
} from "@/components/messages/ChatReplyViews";

jest.mock("expo-blur", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    BlurView: ({ children, ...props }: { children: React.ReactNode }) => (
      <MockView {...props}>{children}</MockView>
    ),
  };
});
jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Medium: "medium" },
  impactAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-image", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Image: (props: object) => <MockView accessibilityLabel="image-thumbnail" {...props} /> };
});
jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 47 }),
}));
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    activeLanguage: "zh-Hans",
    t: (key: string, ...args: (string | number)[]) =>
      ({
        "chat.action.forward": "转发",
        "chat.action.menu": "消息操作",
        "chat.action.multiSelect": "多选",
        "chat.action.recall": "撤回",
        "common.cancel": "取消",
        "common.copy": "复制",
        "common.delete": "删除",
        "common.reply": "回复",
        "common.retry": "重试",
        "common.save": "保存",
        "message.image": "[图片]",
        "message.video": "[视频]",
        "message.voice": "[语音]",
        "reply.to": `回复 ${args[0] ?? ""}`,
        "timeline.backToLatest": "回到最新消息",
        "timeline.mentionedMe": "有人@我",
        "timeline.newMessages": `${args[0] ?? 0}条新消息`,
        "timeline.repliedMe": "有人回复我",
      })[key] ?? key,
  }),
}));
jest.mock("@/services/cache/ImageCacheService", () => ({
  imageCachePolicy: { cachePolicy: "memory-disk" },
  peekAdoptedImageUri: () => undefined,
  peekAuthenticatedImageUri: () => undefined,
  getAdoptedImageUri: async () => undefined,
  getAuthenticatedImageUri: async (_uri: string, cacheKey: string) =>
    `file:///authenticated/${encodeURIComponent(cacheKey)}.img`,
}));

describe("reply and locator UI", () => {
  it("renders and cancels the native text and image composer references", async () => {
    const cancelText = jest.fn();
    const text = await render(
      <ChatReplyPreviewBar
        onCancel={cancelText}
        value={{ senderName: "Alice", content: "voice", msgType: "voice" }}
      />,
    );
    expect(text.getByText("回复 Alice")).toBeTruthy();
    expect(text.getByText("[语音]")).toBeTruthy();
    await act(async () => {
      fireEvent.press(text.getByLabelText("取消"));
    });
    expect(cancelText).toHaveBeenCalledTimes(1);
    await text.unmount();

    const cancelImage = jest.fn();
    const image = await render(
      <ChatReplyPreviewBar
        onCancel={cancelImage}
        value={{ senderName: "Bob", content: "/image.jpg", msgType: "image" }}
      />,
    );
    expect(image.getByText("回复 Bob")).toBeTruthy();
    expect(image.getByText("[图片]")).toBeTruthy();
    expect(await image.findByLabelText("image-thumbnail")).toBeTruthy();
    await act(async () => {
      fireEvent.press(image.getByLabelText("取消"));
    });
    expect(cancelImage).toHaveBeenCalledTimes(1);
    await image.unmount();
  });

  it("opens both text and image quoted references", async () => {
    const openText = jest.fn();
    const text = await render(
      <ChatQuotedMessageView
        isFromMe={false}
        onPress={openText}
        value={{ senderName: "Alice", content: "hello", msgType: "text" }}
      />,
    );
    expect(text.getByText("hello")).toBeTruthy();
    await act(async () => {
      fireEvent.press(text.getByRole("button"));
    });
    expect(openText).toHaveBeenCalledTimes(1);
    await text.unmount();

    const openImage = jest.fn();
    const image = await render(
      <ChatQuotedMessageView
        isFromMe
        onPress={openImage}
        value={{ senderName: "Me", content: "/image.jpg", msgType: "image" }}
      />,
    );
    expect(image.getByText("Me")).toBeTruthy();
    expect(await image.findByLabelText("image-thumbnail")).toBeTruthy();
    const imageButton = image.getByLabelText("Me，[图片]");
    expect(imageButton.props.accessibilityHint).toBeUndefined();
    await act(async () => {
      fireEvent.press(imageButton);
    });
    expect(openImage).toHaveBeenCalledTimes(1);
    await image.unmount();
  });

  it("renders all four locator priorities with source icons and labels", async () => {
    const cases = [
      [{ kind: "mention" as const }, "有人@我", "at"],
      [{ kind: "reply" as const }, "有人回复我", "quote.bubble"],
      [{ kind: "newMessages" as const, count: 3 }, "3条新消息", "arrow.down"],
      [{ kind: "bottom" as const }, "回到最新消息", "arrow.down"],
    ] as const;
    for (const [kind, label, icon] of cases) {
      const onPress = jest.fn();
      const view = await render(<ChatTimelineLocatorButton kind={kind} onPress={onPress} />);
      expect(view.getByText(icon)).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByLabelText(label));
      });
      expect(onPress).toHaveBeenCalledTimes(1);
      await view.unmount();
    }
  });

  it("keeps menu action order, labels and selection callback", async () => {
    const onSelect = jest.fn();
    const view = await render(
      <ChatMessageActionOverlay
        actions={["copy", "forward", "quote", "delete", "multiSelect"]}
        anchor={{ height: 40, width: 80, x: 150, y: 500 }}
        onDismiss={jest.fn()}
        onSelect={onSelect}
      />,
    );
    expect(
      view.getAllByText(/复制|转发|回复|删除|多选/u).map((node) => node.props.children),
    ).toEqual(["复制", "转发", "回复", "删除", "多选"]);
    const menu = view.getByLabelText("消息操作");
    expect(menu.props.accessibilityRole).toBe("menu");
    expect(menu.props.onAccessibilityEscape).toEqual(expect.any(Function));
    await act(async () => {
      fireEvent.press(view.getByLabelText("回复"));
    });
    expect(onSelect).toHaveBeenCalledWith("quote");
    await view.unmount();
  });
});
