import {
  getGiftCatalog,
  getWalletBalance,
  sendDirectGiftMessage,
  sendGroupGiftMessage,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  chatGiftAnimationPolicy,
  chatGiftBubblePolicy,
  chatGiftPickerPolicy,
  completeGiftIdempotency,
  effectiveGiftCatalog,
  encodeGiftMessagePayload,
  fixedGiftCatalog,
  giftAnimationRotation,
  giftIdempotencyKey,
  giftParticleSymbol,
  localizedGiftPayloadName,
  makeGiftMessagePayload,
  normalizeGiftCatalog,
  parseGiftMessagePayload,
  withGiftMessageRecipient,
} from "@/services/messages/chatGiftPolicy";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);

describe("native gift contracts", () => {
  beforeEach(() => request.mockReset());

  it("keeps the exact six fixed gifts and picker metrics", () => {
    expect(fixedGiftCatalog).toEqual([
      expect.objectContaining({
        gift_id: "fish_10",
        name: "Dried Fish",
        price: 10,
        asset_key: "gift_fish",
        receiver_currency: "gold_coin",
      }),
      expect.objectContaining({
        gift_id: "wand_20",
        name: "Teaser Wand",
        price: 20,
        asset_key: "gift_wand",
        receiver_currency: "gold_coin",
      }),
      expect.objectContaining({
        gift_id: "yarn_50",
        name: "Yarn Ball",
        price: 50,
        asset_key: "gift_yarn",
        receiver_currency: "gold_coin",
      }),
      expect.objectContaining({
        gift_id: "can_100",
        name: "Cat Can",
        price: 100,
        asset_key: "gift_can",
        receiver_currency: "gold_coin",
      }),
      expect.objectContaining({
        gift_id: "tree_200",
        name: "Cat Tree",
        price: 200,
        asset_key: "gift_tree",
        receiver_currency: "gold_coin",
      }),
      expect.objectContaining({
        gift_id: "bell_500",
        name: "Golden Bell",
        price: 500,
        asset_key: "gift_bell",
        receiver_currency: "gold_coin",
      }),
    ]);
    expect(chatGiftPickerPolicy).toMatchObject({
      modalBackdropColor: "transparent",
      gridColumns: 3,
      gridColumnSpacing: 10,
      cardCornerRadius: 16,
      cardIconSize: 52,
      cardMinimumHeight: 116,
      selectedBorderWidth: 1.6,
      selectedInnerBorderWidth: 0.8,
      selectedScale: 1.012,
      sendButtonHeight: 48,
      sendButtonCornerRadius: 24,
      localAnimationLifetimeMs: 1_200,
    });
  });

  it("normalizes aliases, filters retired/disabled gifts, rejects non-gold receiver currency and sorts", () => {
    const gifts = normalizeGiftCatalog({
      catalog: [
        { giftId: "z", title: "Z", amount: "8", assetKey: "z", sortOrder: 20 },
        { id: "a", name: "A", gold_coin_amount: 4, asset_key: "a", sort_order: 10 },
        { id: "disabled", name: "D", amount: 1, asset_key: "d", active: false },
        { id: "game_entry_card", amount: 1, asset_key: "gift" },
        { id: "wrong", amount: 1, asset_key: "wrong", receiver_currency: "activity_cat_food" },
      ],
    });
    expect(gifts.map((gift) => gift.gift_id)).toEqual(["a", "z"]);
    expect(gifts[1]).toMatchObject({ name: "Z", price: 8, asset_key: "z" });
    expect(effectiveGiftCatalog({ gifts: [] })).toEqual(fixedGiftCatalog);
  });

  it("parses fixed, nested and direct payload aliases while enforcing gold_coin", () => {
    expect(parseGiftMessagePayload("fish_10")).toMatchObject({
      gift_id: "fish_10",
      asset_key: "gift_fish",
      gold_coin_amount: 10,
    });
    const nested = parseGiftMessagePayload(
      JSON.stringify({
        data: {
          giftId: "custom",
          giftName: "Rose",
          assetKey: "gift_rose",
          price: "88",
          receiverCurrency: "gold_coin",
          receiverId: "friend",
          receiver_nickname: "朋友",
          receiver: { avatarUrl: "/friend.jpg" },
          senderId: "me",
          sender_nickname: "我",
        },
      }),
    );
    expect(nested).toEqual({
      gift_id: "custom",
      gift_name: "Rose",
      asset_key: "gift_rose",
      gold_coin_amount: 88,
      receiver_currency: "gold_coin",
      recipient_id: "friend",
      recipient_name: "朋友",
      recipient_avatar_url: "/friend.jpg",
      sender_id: "me",
      sender_name: "我",
    });
    expect(
      parseGiftMessagePayload(
        JSON.stringify({ gift_id: "x", name: "X", currency: "activity_cat_food" }),
      ),
    ).toBeNull();
  });

  it("encodes the complete payload and localizes fixed and legacy Chinese names", () => {
    const gift = fixedGiftCatalog[2]!;
    const payload = makeGiftMessagePayload(
      gift,
      { id: "friend", name: "朋友", avatar_url: "/friend.jpg" },
      { id: "me", name: "我" },
    );
    expect(JSON.parse(encodeGiftMessagePayload(payload))).toEqual({
      gift_id: "yarn_50",
      gift_name: "Yarn Ball",
      asset_key: "gift_yarn",
      gold_coin_amount: 50,
      receiver_currency: "gold_coin",
      recipient_id: "friend",
      recipient_name: "朋友",
      recipient_avatar_url: "/friend.jpg",
      sender_id: "me",
      sender_name: "我",
    });
    const t = (key: string) => ({ "gift.item.yarn": "毛线球", "gift.title": "礼物" })[key] ?? key;
    expect(localizedGiftPayloadName(payload, t)).toBe("毛线球");
    expect(localizedGiftPayloadName({ ...payload, gift_id: "custom", gift_name: "礼物" }, t)).toBe(
      "礼物",
    );
  });

  it("hydrates legacy gift payloads with the selected recipient avatar without replacing server data", () => {
    const legacy = parseGiftMessagePayload("fish_10")!;
    expect(
      withGiftMessageRecipient(legacy, {
        id: "friend",
        name: "朋友",
        avatar_url: "/friend.jpg",
      }),
    ).toMatchObject({
      recipient_id: "friend",
      recipient_name: "朋友",
      recipient_avatar_url: "/friend.jpg",
    });

    expect(
      withGiftMessageRecipient(
        { ...legacy, recipient_avatar_url: "/server.jpg" },
        { id: "friend", name: "朋友", avatar_url: "/picker.jpg" },
      ).recipient_avatar_url,
    ).toBe("/server.jpg");
  });

  it("retains a per-recipient/gift idempotency key until success", () => {
    const first = giftIdempotencyKey("friend", "fish_10");
    expect(giftIdempotencyKey("friend", "fish_10")).toBe(first);
    expect(giftIdempotencyKey("friend", "wand_20")).not.toBe(first);
    completeGiftIdempotency("friend", "fish_10");
    expect(giftIdempotencyKey("friend", "fish_10")).not.toBe(first);
  });

  it("keeps exact gift bubble and animation geometry", () => {
    expect(chatGiftBubblePolicy).toMatchObject({
      giftIconSize: 68,
      giftColumnWidth: 80,
      arrowWidth: 44,
      arrowHeight: 30,
      recipientAvatarSize: 54,
      recipientColumnWidth: 74,
      width: 232,
      cornerRadius: 18,
      horizontalPadding: 8,
      verticalPadding: 9,
    });
    expect(chatGiftAnimationPolicy).toMatchObject({
      backdropOpacity: 0.22,
      particleCount: 6,
      iconSize: 96,
      initialScale: 0.62,
      finalScale: 1.05,
      initialParticleDistance: 18,
      finalParticleDistance: 76,
      particleDurationMs: 950,
      particleDelayStepMs: 40,
    });
    expect(giftAnimationRotation("gift_yarn")).toEqual({ initial: -35, final: 360 });
    expect(giftParticleSymbol("gift_can")).toBe("heart.fill");
  });

  it("posts the direct gift route with the same key in header and body, then normalizes payload fallback", async () => {
    request.mockResolvedValueOnce({
      message: { id: 41, sender_id: "me", receiver_id: "friend", msg_type: "gift", content: "" },
    });
    const message = await sendDirectGiftMessage("friend", "fish_10", "direct-key");
    expect(request).toHaveBeenCalledWith("/chat/messages/gift", {
      method: "POST",
      requiredData: true,
      requiredEnvelope: true,
      headers: { "Idempotency-Key": "direct-key" },
      body: {
        receiver_id: "friend",
        recipient_id: "friend",
        gift_id: "fish_10",
        idempotency_key: "direct-key",
      },
    });
    expect(message).toMatchObject({ id: 41, msg_type: "gift", receiver_id: "friend" });
    expect(parseGiftMessagePayload(message.content)).toMatchObject({
      gift_id: "fish_10",
      recipient_id: "friend",
    });
  });

  it("posts the group gift route with the exact recipient aliases and normalizes a nested response", async () => {
    request.mockResolvedValueOnce({
      group_message: {
        id: 42,
        group_id: 31,
        sender_id: "me",
        msg_type: "gift",
        gift: { gift_id: "bell_500", recipient_id: "friend" },
      },
    });
    const message = await sendGroupGiftMessage(31, "friend", "bell_500", "group-key");
    expect(request).toHaveBeenCalledWith("/groups/31/messages/gift", {
      method: "POST",
      headers: { "Idempotency-Key": "group-key" },
      requiredData: true,
      requiredEnvelope: true,
      body: {
        recipient_id: "friend",
        receiver_id: "friend",
        gift_id: "bell_500",
        idempotency_key: "group-key",
      },
    });
    expect(message).toMatchObject({ id: 42, group_id: 31, msg_type: "gift" });
    expect(parseGiftMessagePayload(message.content)).toMatchObject({
      gift_id: "bell_500",
      recipient_id: "friend",
    });
  });

  it("fetches and normalizes gift catalog plus the mixed spendable wallet balance", async () => {
    request.mockResolvedValueOnce({ gifts: [{ gift_id: "fish_10" }] }).mockResolvedValueOnce({
      currency: "gold_coin",
      gold_coin_balance: "20",
      activity_cat_food_balance: 5,
      spendable_balance: 25,
      chat_money_frozen_gold_coin_balance: 0,
    });
    expect(await getGiftCatalog()).toEqual([
      expect.objectContaining({ gift_id: "fish_10", price: 10 }),
    ]);
    expect(await getWalletBalance()).toMatchObject({
      gold_coin_balance: 20,
      activity_cat_food_balance: 5,
      spendable_balance: 25,
    });
  });
});
