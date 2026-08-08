import { fireEvent, render, screen } from "@testing-library/react-native";

import { PaidMediaPart } from "@/components/agents/AgentMessageView";

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({}),
}));
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
jest.mock("expo-image", () => ({
  Image: Object.assign(
    (props: Record<string, unknown>) => {
      const { View } = jest.requireActual("react-native") as typeof import("react-native");
      return <View {...props} />;
    },
    { loadAsync: jest.fn() },
  ),
}));
jest.mock("@/components/AuthenticatedImage", () => ({
  AuthenticatedImage: (props: Record<string, unknown>) => {
    const { View } = jest.requireActual("react-native") as typeof import("react-native");
    return <View {...props} />;
  },
}));
jest.mock("@/components/media/ImageGallery", () => ({
  ImageGallery: () => null,
  ImageGallerySource: ({
    accessibilityLabel,
    children,
    onOpen,
    selection,
  }: {
    accessibilityLabel?: string;
    children?: import("react").ReactNode;
    onOpen: (selection: unknown) => void;
    selection: unknown;
  }) => {
    const { Pressable } = jest.requireActual("react-native") as typeof import("react-native");
    return (
      <Pressable accessibilityLabel={accessibilityLabel} onPress={() => onOpen(selection)}>
        {children}
      </Pressable>
    );
  },
}));
jest.mock("@/components/messages/ChatReplyViews", () => ({
  ChatMessageActionOverlay: () => null,
  ChatMessageLongPressSurface: ({ children }: { children?: import("react").ReactNode }) => {
    const { View } = jest.requireActual("react-native") as typeof import("react-native");
    return <View>{children}</View>;
  },
  ChatQuotedMessageView: () => null,
}));
jest.mock("@/components/media/VideoPlayerOverlay", () => ({
  VideoPlayerOverlay: () => null,
}));
jest.mock("@/components/agents/AgentVideoRoleMatchDialog", () => ({
  AgentVideoRoleMatchDialog: () => null,
}));
jest.mock("@/services/media/MediaLibrarySaver", () => ({
  saveImageToLibrary: jest.fn(),
  saveVideoToLibrary: jest.fn(),
}));
jest.mock("@/services/monitoring/MonitoringService", () => ({
  captureException: jest.fn(),
}));
jest.mock("@/services/live/useAgentLiveVideoMatch", () => ({
  useAgentLiveVideoMatch: () => ({ cancel: jest.fn(), reset: jest.fn() }),
}));
jest.mock("@/services/live/LiveLobbyRepository", () => ({
  getCurrentLiveSlot: jest.fn(),
}));

describe("agent paid-media unlock interaction", () => {
  it("exposes the native automatic unlock action for ready image and completed video cards", async () => {
    const onUnlock = jest.fn();
    const image = await render(
      <PaidMediaPart
        isUnlocking={false}
        mediaId="image/a"
        metadata={{ media_type: "image", access: "locked", generation_status: "ready" }}
        onImagePress={jest.fn()}
        onUnlock={onUnlock}
        onVideoPress={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByLabelText("解锁图片"));
    expect(onUnlock).toHaveBeenCalledWith("image/a", "image");
    await image.unmount();

    await render(
      <PaidMediaPart
        isUnlocking={false}
        mediaId="video/a"
        metadata={{ media_type: "video", access: "locked", generation_status: "completed" }}
        onImagePress={jest.fn()}
        onUnlock={onUnlock}
        onVideoPress={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByLabelText("解锁视频"));
    expect(onUnlock).toHaveBeenCalledWith("video/a", "video");
  });

  it("locks duplicate taps while the request is in flight", async () => {
    const onUnlock = jest.fn();
    await render(
      <PaidMediaPart
        isUnlocking
        mediaId="image/a"
        metadata={{ media_type: "image", access: "locked", generation_status: "ready" }}
        onImagePress={jest.fn()}
        onUnlock={onUnlock}
        onVideoPress={jest.fn()}
      />,
    );
    const button = screen.getByLabelText("解锁中…");
    expect(button.props.accessibilityState).toEqual({ busy: true, disabled: true });
    await fireEvent.press(button);
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it("opens authoritative unlocked image and video content", async () => {
    const onImagePress = jest.fn();
    const onVideoPress = jest.fn();
    const image = await render(
      <PaidMediaPart
        isUnlocking={false}
        mediaId="image/a"
        metadata={{
          media_type: "image",
          access: "unlocked",
          generation_status: "ready",
          content_url: "/image",
        }}
        onImagePress={onImagePress}
        onUnlock={jest.fn()}
        onVideoPress={onVideoPress}
      />,
    );
    await fireEvent.press(screen.getByLabelText("预览: [图片]"));
    expect(onImagePress).toHaveBeenCalledWith("http://localhost:8000/api/v1/image");
    await image.unmount();

    await render(
      <PaidMediaPart
        isUnlocking={false}
        mediaId="video/a"
        metadata={{
          media_type: "video",
          access: "unlocked",
          generation_status: "ready",
          download_url: "/video",
        }}
        onImagePress={onImagePress}
        onUnlock={jest.fn()}
        onVideoPress={onVideoPress}
      />,
    );
    await fireEvent.press(screen.getByLabelText("播放视频"));
    expect(onVideoPress).toHaveBeenCalledWith("http://localhost:8000/api/v1/video");
  });

  it("opens an unlocked paid image through the shared gallery with the raw ordered paths", async () => {
    const onImageOpen = jest.fn();
    const onImagePress = jest.fn();
    await render(
      <PaidMediaPart
        galleryImagePaths={["/earlier", "/image", "/later"]}
        imageReplyTarget={{
          messageId: "message-1",
          partId: "part-1",
          imagePath: "/image",
          isFromUser: false,
        }}
        isUnlocking={false}
        mediaId="image/a"
        metadata={{
          media_type: "image",
          access: "unlocked",
          generation_status: "ready",
          content_url: "/image",
        }}
        onImageOpen={onImageOpen}
        onImagePress={onImagePress}
        onUnlock={jest.fn()}
        onVideoPress={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByLabelText("预览: [图片]"));
    expect(onImageOpen).toHaveBeenCalledWith({
      media: { id: "agent-paid-message-1-part-1", type: "image", url: "/image" },
      images: ["/earlier", "/image", "/later"],
      index: 1,
    });
    expect(onImagePress).not.toHaveBeenCalled();
  });

  it("offers the native save action only for unlocked downloadable media", async () => {
    const onSave = jest.fn();
    await render(
      <PaidMediaPart
        isUnlocking={false}
        mediaId="image/a"
        metadata={{
          media_type: "image",
          access: "unlocked",
          generation_status: "ready",
          content_url: "/image",
          download_url: "/download-image",
        }}
        onImagePress={jest.fn()}
        onSave={onSave}
        onUnlock={jest.fn()}
        onVideoPress={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByLabelText("保存原图"));
    expect(onSave).toHaveBeenCalledWith("/download-image", false);
  });
});
