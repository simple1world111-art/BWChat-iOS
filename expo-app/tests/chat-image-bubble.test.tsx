import { act, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { ChatImageBubble } from "@/components/messages/ChatImageBubble";

interface MockImageGallerySourceProps {
  loadingFallback?: unknown;
  onNaturalSize?: ((size: { width: number; height: number }) => void) | undefined;
  selection: {
    media: { url: string };
    images: string[];
  };
  sourceId: string;
  style: unknown;
  uri: string;
}

let mockSourceProps: MockImageGallerySourceProps | undefined;

jest.mock("@/components/media/ImageGallery", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    ImageGallerySource: (props: MockImageGallerySourceProps) => {
      mockSourceProps = props;
      return <MockView style={props.style} testID="chat-image-source" />;
    },
  };
});

jest.mock("@/components/messages/ChatReplyViews", () => ({
  useChatMessageActivationGuard: () => () => true,
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

describe("ChatImageBubble stable presentation", () => {
  beforeEach(() => {
    mockSourceProps = undefined;
  });

  it("locks the picker-known frame and gallery identity across upload source changes", async () => {
    const screen = await render(
      <ChatImageBubble
        imageUrls={["file:///picker/portrait.jpg"]}
        initialSize={{ width: 800, height: 1_200 }}
        index={0}
        messageId="client:stable-image"
        onOpen={jest.fn()}
        thumbnailUrl="file:///picker/portrait.jpg"
        url="file:///picker/portrait.jpg"
      />,
    );

    expect(StyleSheet.flatten(mockSourceProps?.style)).toMatchObject({ width: 110, height: 156 });
    expect(mockSourceProps).toMatchObject({
      sourceId: "chat-image-client:stable-image",
      uri: "file:///picker/portrait.jpg",
      onNaturalSize: undefined,
    });
    expect(mockSourceProps?.loadingFallback).toBeTruthy();

    await screen.rerender(
      <ChatImageBubble
        imageUrls={["/media/confirmed.jpg"]}
        initialSize={{ width: 1_600, height: 900 }}
        index={0}
        messageId="client:stable-image"
        onOpen={jest.fn()}
        thumbnailUrl="/media/confirmed-thumbnail.jpg"
        url="/media/confirmed.jpg"
      />,
    );

    expect(StyleSheet.flatten(mockSourceProps?.style)).toMatchObject({ width: 110, height: 156 });
    expect(mockSourceProps?.sourceId).toBe("chat-image-client:stable-image");
  });

  it("still learns the aspect ratio for historical images without stored dimensions", async () => {
    const screen = await render(
      <ChatImageBubble
        imageUrls={["/media/history.jpg"]}
        index={0}
        messageId="server:91"
        onOpen={jest.fn()}
        url="/media/history.jpg"
      />,
    );

    expect(StyleSheet.flatten(mockSourceProps?.style)).toMatchObject({ width: 160, height: 110 });
    await act(async () => mockSourceProps?.onNaturalSize?.({ width: 800, height: 1_200 }));
    expect(StyleSheet.flatten(mockSourceProps?.style)).toMatchObject({ width: 110, height: 156 });
    await screen.unmount();
  });

  it("renders the thumbnail in the timeline but opens the original image", async () => {
    await render(
      <ChatImageBubble
        imageUrls={["/media/original.jpg"]}
        index={0}
        messageId="server:92"
        onOpen={jest.fn()}
        thumbnailUrl="/media/thumbnail.jpg"
        url="/media/original.jpg"
      />,
    );

    expect(mockSourceProps).toMatchObject({
      uri: expect.stringContaining("/media/thumbnail.jpg"),
      selection: {
        media: { url: "/media/original.jpg" },
        images: ["/media/original.jpg"],
      },
    });
  });
});
