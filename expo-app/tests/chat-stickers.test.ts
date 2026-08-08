import { sendDirectStickerMessage, sendGroupStickerMessage } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  chatStickerArtworkSize,
  chatStickerBubblePolicy,
  chatComposerPlusPanelHeight,
  chatComposerPlusItemWidth,
  chatComposerSurfacePolicy,
  chatStickerPanelPolicy,
  effectiveChatStickerPacks,
  encodeChatStickerMessagePayload,
  fallbackChatEmojiValues,
  insertChatComposerText,
  makeChatStickerMessagePayload,
  parseChatStickerMessagePayload,
  sortedChatStickerItems,
  trustedChatStickerRemoteAsset,
  type ChatStickerPack,
} from "@/services/messages/chatStickerPolicy";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);

describe("native chat sticker contracts", () => {
  beforeEach(() => request.mockReset());

  it("keeps the exact 57-item native emoji fallback and panel metrics", () => {
    expect(fallbackChatEmojiValues).toHaveLength(57);
    expect(fallbackChatEmojiValues).toEqual([
      "😀",
      "😃",
      "😄",
      "😁",
      "😆",
      "😅",
      "😂",
      "🤣",
      "😊",
      "🙂",
      "🙃",
      "😉",
      "😍",
      "🥰",
      "😘",
      "😋",
      "😎",
      "🤩",
      "🥳",
      "😏",
      "😔",
      "😢",
      "😭",
      "😤",
      "😡",
      "🤯",
      "😱",
      "😳",
      "🥺",
      "😴",
      "🤔",
      "🤗",
      "🤭",
      "🤫",
      "🙄",
      "😬",
      "👍",
      "👎",
      "👏",
      "🙏",
      "💪",
      "👌",
      "✌️",
      "🤝",
      "❤️",
      "💛",
      "💚",
      "💙",
      "💜",
      "🖤",
      "💯",
      "🎉",
      "🔥",
      "✨",
      "🌟",
      "🐱",
      "🐾",
    ]);
    expect(chatStickerPanelPolicy).toMatchObject({
      preferredHeight: 250,
      minimumHeight: 220,
      emojiColumns: 8,
      emojiColumnSpacing: 2,
      emojiRowSpacing: 4,
      emojiFontSize: 28,
      emojiMinimumHeight: 44,
      stickerColumns: 4,
      stickerColumnSpacing: 10,
      stickerRowSpacing: 12,
      stickerArtworkSize: 54,
      stickerMinimumHeight: 76,
    });
  });

  it("preserves the native composer panel heights and 250ms transition", () => {
    expect(chatComposerSurfacePolicy).toEqual({
      transitionDurationMs: 250,
      actionButtonWidth: 42,
      actionButtonHeight: 54,
      toggleSymbolSize: 28,
      plusColumns: 4,
      plusColumnSpacing: 12,
      plusItemHeight: 76,
      plusRowSpacing: 18,
      plusVerticalPadding: 16,
    });
    expect(chatComposerPlusPanelHeight(1)).toBe(108);
    expect(chatComposerPlusPanelHeight(6)).toBe(202);
    expect(chatComposerPlusPanelHeight(0)).toBe(108);
    expect(chatComposerPlusItemWidth(393)).toBe(89.25);
    expect(chatComposerPlusItemWidth(0)).toBe(0);
  });

  it("filters packs, moves the configured emoji pack first and preserves server tab order", () => {
    const packs = effectiveChatStickerPacks([
      stickerPack("animals", 90),
      { id: "disabled", enabled: false, stickers: [{ id: "x", asset_key: "x" }] },
      { id: "empty", enabled: true, stickers: [] },
      {
        pack_id: "emoji_default",
        pack_type: "emoji",
        emojis: [{ emoji_id: "smile", value: "🙂", sort_order: 10 }],
      },
      stickerPack("faces", 10),
    ]);
    expect(packs.map((pack) => pack.id)).toEqual(["emoji_default", "animals", "faces"]);
    expect(effectiveChatStickerPacks([stickerPack("animals", 10)])[0]?.id).toBe("emoji_default");
    expect(effectiveChatStickerPacks([stickerPack("animals", 10)])[0]?.emojis).toHaveLength(57);
  });

  it("sorts sticker cells by order then native-style identifier and rejects missing assets", () => {
    const pack = effectiveChatStickerPacks([
      {
        id: "pack",
        stickers: [
          { id: "s10", asset_key: "asset10", order: 20 },
          { id: "bad", asset_key: "" },
          { id: "s2", asset_key: "asset2", order: 20 },
          { id: "first", asset_key: "first", order: 10 },
        ],
      },
    ])[1] as ChatStickerPack;
    expect(sortedChatStickerItems(pack).map((item) => item.id)).toEqual(["first", "s2", "s10"]);
  });

  it("inserts emoji at the UTF-16 selection and replaces the selected range", () => {
    expect(insertChatComposerText("A😀B", { start: 1, end: 3 }, "❤️")).toEqual({
      text: "A❤️B",
      selection: { start: 3, end: 3 },
    });
    expect(insertChatComposerText("hello", { start: 99, end: 120 }, "🙂")).toEqual({
      text: "hello🙂",
      selection: { start: 7, end: 7 },
    });
  });

  it("encodes the six-field JSON payload and preserves the legacy plain asset form", () => {
    const pack = effectiveChatStickerPacks([stickerPack("animals", 10)])[1] as ChatStickerPack;
    const sticker = pack.stickers[0];
    expect(sticker).toBeDefined();
    const payload = makeChatStickerMessagePayload(pack, sticker!);
    expect(payload).toEqual({
      stickerId: "cat",
      packId: "animals",
      assetKey: "stickers/cat",
      name: { en: "Cat", "zh-Hans": "猫" },
      width: 300,
      height: 200,
    });
    const encoded = encodeChatStickerMessagePayload(payload);
    expect(JSON.parse(encoded)).toEqual({
      sticker_id: "cat",
      pack_id: "animals",
      asset_key: "stickers/cat",
      name: { en: "Cat", "zh-Hans": "猫" },
      width: 300,
      height: 200,
    });
    expect(parseChatStickerMessagePayload(encoded)).toEqual(payload);
    expect(parseChatStickerMessagePayload(" legacy-key ")).toEqual({
      stickerId: "legacy-key",
      packId: "",
      assetKey: "legacy-key",
    });
  });

  it("uses the exact 148pt no-upscale sticker bubble policy", () => {
    expect(chatStickerArtworkSize({})).toEqual({ width: 148, height: 148 });
    expect(chatStickerArtworkSize({ width: 300, height: 200 })).toEqual({
      width: 148,
      height: 296 / 3,
    });
    expect(chatStickerArtworkSize({ width: 50, height: 40 })).toEqual({ width: 50, height: 40 });
    expect(chatStickerBubblePolicy).toMatchObject({
      artworkPadding: 8,
      cornerRadius: 14,
      outgoingBackgroundOpacity: 0.18,
      incomingBackgroundOpacity: 0.72,
      shadowOpacity: 0.06,
      shadowRadius: 4,
      shadowOffsetY: 2,
      fallbackCornerRadius: 12,
      fallbackFillOpacity: 0.08,
      fallbackBorderOpacity: 0.18,
      fallbackMinimumScale: 0.65,
    });
  });

  it("accepts only HTTPS manifest images within the native 8 MiB limit", () => {
    const manifest = {
      assets: [
        {
          key: "cat",
          url: "https://cdn.example.com/cat.webp",
          content_type: "image/webp",
          byte_size: 1024,
          sha256: "a".repeat(64),
        },
        { key: "http", url: "http://cdn.example.com/a.png", content_type: "image/png" },
        { key: "script", url: "https://cdn.example.com/a.js", content_type: "image/png" },
        {
          key: "huge",
          url: "https://cdn.example.com/a.png",
          content_type: "image/png",
          byte_size: 8 * 1024 * 1024 + 1,
        },
      ],
    };
    expect(trustedChatStickerRemoteAsset("cat", manifest)).toMatchObject({
      key: "cat",
      contentType: "image/webp",
      byteSize: 1024,
    });
    expect(trustedChatStickerRemoteAsset("http", manifest)).toBeNull();
    expect(trustedChatStickerRemoteAsset("script", manifest)).toBeNull();
    expect(trustedChatStickerRemoteAsset("huge", manifest)).toBeNull();
  });

  it("posts the exact direct sticker route and identity fields", async () => {
    request.mockResolvedValueOnce({
      id: 41,
      sender_id: "me",
      receiver_id: "friend",
      msg_type: "sticker",
      content: "asset",
    });
    await sendDirectStickerMessage("friend", "animals", "cat", {
      replyToId: 9,
      clientMessageId: "client-direct",
    });
    expect(request).toHaveBeenCalledWith("/chat/messages/sticker", {
      method: "POST",
      requiredData: true,
      requiredEnvelope: true,
      body: {
        receiver_id: "friend",
        pack_id: "animals",
        sticker_id: "cat",
        reply_to_id: 9,
        client_message_id: "client-direct",
      },
    });
  });

  it("posts the exact group sticker route without inventing receiver fields", async () => {
    request.mockResolvedValueOnce({
      id: 42,
      group_id: 31,
      sender_id: "me",
      msg_type: "sticker",
      content: "asset",
    });
    await sendGroupStickerMessage(31, "animals", "cat", { clientMessageId: "client-group" });
    expect(request).toHaveBeenCalledWith("/groups/31/messages/sticker", {
      method: "POST",
      requiredData: true,
      requiredEnvelope: true,
      body: {
        pack_id: "animals",
        sticker_id: "cat",
        client_message_id: "client-group",
      },
    });
    expect(request.mock.calls[0]?.[1]?.body).not.toHaveProperty("receiver_id");
  });
});

function stickerPack(id: string, order: number) {
  return {
    id,
    order,
    stickers: [
      {
        sticker_id: "cat",
        asset_key: "stickers/cat",
        name: { en: "Cat", "zh-Hans": "猫" },
        width: 300,
        height: 200,
        sort_order: 10,
      },
    ],
  };
}
