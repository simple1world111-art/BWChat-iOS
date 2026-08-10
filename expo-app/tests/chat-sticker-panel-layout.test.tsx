import { render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { ChatStickerPanel } from "@/components/messages/ChatStickerPanel";

jest.mock("expo-symbols", () => ({
  SymbolView: () => null,
}));

jest.mock("@/components/messages/ChatStickerArtwork", () => ({
  ChatStickerArtwork: () => null,
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    activeLanguage: "zh-Hans",
    t: (key: string) => key,
  }),
}));

jest.mock("@/providers/RemoteConfigProvider", () => ({
  useRemoteConfig: () => ({
    config: { stickerPacks: [] },
    refresh: jest.fn(async () => undefined),
    source: "cache",
  }),
}));

describe("chat sticker panel layout", () => {
  it("overrides the horizontal ScrollView flex growth and keeps tabs at 48pt", async () => {
    const view = await render(
      <ChatStickerPanel onInsertEmoji={jest.fn()} onSendSticker={jest.fn()} />,
    );
    const tabs = view.getByTestId("chat-sticker-pack-tabs");

    expect(StyleSheet.flatten(tabs.props.style)).toMatchObject({
      flexGrow: 0,
      flexShrink: 0,
      height: 48,
    });
  });
});
