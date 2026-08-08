import type { ImagePickerAsset } from "expo-image-picker";
import { act, fireEvent, render } from "@testing-library/react-native";
import { useState } from "react";

import {
  ChatMediaPickerPreview,
  chatMediaPreviewMetrics,
} from "@/components/messages/ChatMediaPickerPreview";

jest.mock("expo", () => ({ useEvent: () => ({ status: "idle" }) }));
jest.mock("expo-image", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Image: (props: object) => <MockView {...props} /> };
});
jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { LinearGradient: ({ children, ...props }: { children: React.ReactNode }) => <MockView {...props}>{children}</MockView> };
});
jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});
jest.mock("expo-video", () => ({
  useVideoPlayer: () => ({
    generateThumbnailsAsync: jest.fn(),
    status: "idle",
  }),
}));
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    t: (key: string, count?: number) => ({
      "common.cancel": "取消",
      "common.delete": "删除",
      "media.preview.title": "预览",
      "media.selected.count": `${count ?? 0} 项已选择`,
      "media.send.count": `发送 (${count ?? 0})`,
    }[key] ?? key),
  }),
}));

describe("media picker preview", () => {
  it("keeps the native three-column geometry and thumbnail limits", () => {
    expect(chatMediaPreviewMetrics).toEqual({
      columns: 3,
      gridSpacing: 8,
      gridPadding: 16,
      cellRadius: 10,
      videoThumbnailMaximumSize: 300,
      videoBadgeIconSize: 11,
      videoBadgeHorizontalPadding: 6,
      videoBadgeVerticalPadding: 3,
      videoBadgeInset: 6,
      removeIconSize: 22,
      removeInset: 4,
      removeAnimationDurationMs: 200,
      bottomHorizontalPadding: 16,
      bottomVerticalPadding: 12,
      sendHorizontalPadding: 24,
      sendVerticalPadding: 10,
      sendRadius: 20,
    });
  });

  it("removes media without changing order and sends a defensive copy", async () => {
    const onCancel = jest.fn();
    const onSend = jest.fn();
    const startingItems = fixtures();
    const view = await render(<ControlledPreview initialItems={startingItems} onCancel={onCancel} onSend={onSend} />);

    expect(view.getByText("3 项已选择")).toBeTruthy();
    expect(view.getByText("发送 (3)")).toBeTruthy();
    expect(view.getAllByText("video.fill")).toHaveLength(2);
    await act(async () => { fireEvent.press(view.getByLabelText("b.mp4，删除")); });
    expect(view.getByText("2 项已选择")).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByText("发送 (2)")); });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith([expect.objectContaining({ uri: "file:///a.jpg" }), expect.objectContaining({ uri: "file:///c.jpg" })]);
    expect(onSend.mock.calls[0]?.[0]).not.toBe(startingItems);
    await view.unmount();
  });

  it("dismisses after removing the final item and supports explicit cancel", async () => {
    const onCancel = jest.fn();
    const single = await render(<ControlledPreview initialItems={[asset("file:///a.jpg", "image", "a.jpg")]} onCancel={onCancel} onSend={jest.fn()} />);
    await act(async () => { fireEvent.press(single.getByLabelText("a.jpg，删除")); });
    expect(onCancel).toHaveBeenCalledTimes(1);
    await single.unmount();

    const cancel = jest.fn();
    const multiple = await render(<ControlledPreview initialItems={fixtures()} onCancel={cancel} onSend={jest.fn()} />);
    await act(async () => { fireEvent.press(multiple.getByText("取消")); });
    expect(cancel).toHaveBeenCalledTimes(1);
    await multiple.unmount();
  });
});

function ControlledPreview({
  initialItems,
  onCancel,
  onSend,
}: {
  initialItems: ImagePickerAsset[];
  onCancel: () => void;
  onSend: (items: ImagePickerAsset[]) => void;
}) {
  const [items, setItems] = useState(initialItems);
  return <ChatMediaPickerPreview items={items} visible onCancel={onCancel} onChange={setItems} onSend={onSend} />;
}

function fixtures(): ImagePickerAsset[] {
  return [
    asset("file:///a.jpg", "image", "a.jpg"),
    asset("file:///b.mp4", "video", "b.mp4"),
    asset("file:///c.jpg", "image", "c.jpg"),
  ];
}

function asset(uri: string, type: "image" | "video", fileName: string): ImagePickerAsset {
  return { assetId: fileName, fileName, height: 900, type, uri, width: 1200 };
}
