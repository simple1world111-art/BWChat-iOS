import { fireEvent, render, screen } from "@testing-library/react-native";

import { AgentMessageView, PaidMediaPart } from "@/components/agents/AgentMessageView";
import type { AgentMessage, AgentMessagePart } from "@/models";

jest.mock("expo-symbols", () => ({
  SymbolView: ({ name }: { name: string }) => {
    const { Text } = jest.requireActual("react-native") as typeof import("react-native");
    return <Text>{name}</Text>;
  },
}));
jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children: import("react").ReactNode }) => {
    const { View } = jest.requireActual("react-native") as typeof import("react-native");
    return <View>{children}</View>;
  },
}));
jest.mock("@/components/AuthenticatedImage", () => ({
  AuthenticatedImage: (props: Record<string, unknown>) => {
    const { View } = jest.requireActual("react-native") as typeof import("react-native");
    return <View {...props} />;
  },
}));
jest.mock("@/components/media/ImageGallery", () => ({
  ImageGallerySource: ({
    accessibilityLabel,
    onOpen,
    selection,
  }: {
    accessibilityLabel?: string;
    onOpen: (selection: unknown) => void;
    selection: unknown;
  }) => {
    const { Pressable } = jest.requireActual("react-native") as typeof import("react-native");
    return <Pressable accessibilityLabel={accessibilityLabel} onPress={() => onOpen(selection)} />;
  },
}));
jest.mock("@/components/messages/ChatReplyViews", () => ({
  ChatMessageLongPressSurface: ({ children }: { children: import("react").ReactNode }) => {
    const { View } = jest.requireActual("react-native") as typeof import("react-native");
    return <View>{children}</View>;
  },
  ChatQuotedMessageView: ({ onPress }: { onPress?: () => void }) => {
    const { Pressable } = jest.requireActual("react-native") as typeof import("react-native");
    return <Pressable accessibilityLabel="quote-preview" onPress={onPress} />;
  },
}));
jest.mock("@/providers/LocalizationProvider", () => ({
  getActiveLanguageCode: () => "zh-Hans",
  localizedString: (_language: string, key: string) => key,
  useLocalization: () => ({ t: (key: string) => key }),
}));

const zh: Record<string, string> = {
  "common.loading": "加载中",
  "media.preview.title": "预览",
  "mediaUnlock.playVideo": "播放视频",
  "mediaUnlock.save.image": "保存原图",
  "mediaUnlock.save.video": "保存视频",
  "mediaUnlock.title.image": "解锁图片",
  "mediaUnlock.title.video": "解锁视频",
  "mediaUnlock.unavailable": "媒体暂不可用",
  "mediaUnlock.unlocking": "解锁中…",
  "message.image": "[图片]",
};
const translate = (key: string) => zh[key] ?? key;

function part(overrides: Partial<AgentMessagePart>): AgentMessagePart {
  return { id: "part", ordinal: 0, type: "text", text: "", metadata: {}, ...overrides };
}

function message(parts: AgentMessagePart[], overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: "message",
    conversation_id: "conversation",
    sequence_no: 1,
    sender: { type: "user", id: "test1" },
    source: "turn",
    status: "completed",
    created_at: "",
    updated_at: "",
    parts,
    ...overrides,
  };
}

describe("AgentMessageView interaction parity", () => {
  it("shows inline optimistic delivery state and retries a failed send from the message row", async () => {
    const commonProps = {
      allMessages: [],
      avatarUrl: null,
      galleryImagePaths: [],
      isUnlockingMedia: () => false,
      name: "智能体",
      onImageMenuRequested: jest.fn(),
      onImageMenuTouchSequenceEnded: jest.fn(),
      onImageMenuTouchSequenceStarted: jest.fn(),
      onImageOpen: jest.fn(),
      onImagePress: jest.fn(),
      onSaveMedia: jest.fn(),
      onUnlockMedia: jest.fn(),
      onVideoPress: jest.fn(),
    };
    const sending = await render(
      <AgentMessageView
        {...commonProps}
        message={message([part({ text: "马上出现" })], {
          client_message_id: "client-1",
          source: "local_optimistic",
          status: "sending",
        })}
      />,
    );
    expect(screen.getByLabelText("common.loading")).toBeTruthy();
    await sending.unmount();

    const onRetrySend = jest.fn();
    await render(
      <AgentMessageView
        {...commonProps}
        message={message([part({ text: "马上出现" })], {
          client_message_id: "client-1",
          source: "local_optimistic",
          status: "failed",
        })}
        onRetrySend={onRetrySend}
      />,
    );
    await fireEvent.press(screen.getByLabelText("messages.sendFailed, common.retry"));
    expect(onRetrySend).toHaveBeenCalledTimes(1);
  });

  it("renders visible text in ordinal order and hides the internal transform instruction", async () => {
    await render(
      <AgentMessageView
        allMessages={[]}
        avatarUrl={null}
        galleryImagePaths={[]}
        isUnlockingMedia={() => false}
        message={message([
          part({ id: "second", ordinal: 2, text: "第二段" }),
          part({ id: "first", ordinal: 1, text: "第一段" }),
          part({
            id: "internal",
            ordinal: 3,
            text: "请基于我上传的图片进行调整并生成一张新的图片。请实际调用图片生成工具，不要只用文字描述。调整要求：换成蓝色",
          }),
        ])}
        name="智能体"
        onImageMenuRequested={jest.fn()}
        onImageMenuTouchSequenceEnded={jest.fn()}
        onImageMenuTouchSequenceStarted={jest.fn()}
        onImageOpen={jest.fn()}
        onImagePress={jest.fn()}
        onSaveMedia={jest.fn()}
        onUnlockMedia={jest.fn()}
        onVideoPress={jest.fn()}
      />,
    );
    expect(
      screen.getAllByText(/第一段|第二段|换成蓝色/u).map((node) => node.props.children),
    ).toEqual(["第一段", "第二段", "换成蓝色"]);
    expect(screen.queryByText(/请实际调用图片生成工具/u)).toBeNull();
  });

  it("uses localized labels and opens the authoritative unlocked video", async () => {
    const onVideoPress = jest.fn();
    await render(
      <PaidMediaPart
        isUnlocking={false}
        mediaId="video-1"
        metadata={{
          media_type: "video",
          generation_status: "completed",
          access: "unlocked",
          preview_url: "/poster",
          download_url: "/video",
        }}
        onImagePress={jest.fn()}
        onUnlock={jest.fn()}
        onVideoPress={onVideoPress}
        translate={translate}
      />,
    );
    await fireEvent.press(screen.getByLabelText("播放视频"));
    expect(onVideoPress).toHaveBeenCalledWith("http://localhost:8000/api/v1/video");
    expect(screen.getByLabelText("保存视频").props.accessibilityRole).toBe("button");
  });

  it("announces generation and terminal media states with explicit accessibility roles", async () => {
    const loading = await render(
      <PaidMediaPart
        isUnlocking={false}
        mediaId="image-1"
        metadata={{ media_type: "image", generation_status: "generating", access: "locked" }}
        onImagePress={jest.fn()}
        onUnlock={jest.fn()}
        onVideoPress={jest.fn()}
        translate={translate}
      />,
    );
    expect(screen.getByLabelText("加载中").props.accessibilityRole).toBe("progressbar");
    await loading.unmount();

    await render(
      <PaidMediaPart
        isUnlocking={false}
        mediaId="image-1"
        metadata={{ media_type: "image", generation_status: "failed", access: "locked" }}
        onImagePress={jest.fn()}
        onUnlock={jest.fn()}
        onVideoPress={jest.fn()}
        translate={translate}
      />,
    );
    expect(screen.getByText("媒体暂不可用").parent?.props.accessibilityRole).toBe("alert");
  });
});
