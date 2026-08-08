import {
  acceptTransfer,
  claimRedPacket,
  createRedPacketMessage,
  createTransferMessage,
  getChatMoneyConfiguration,
  getChatMoneyDetail,
  returnTransfer,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import type { ChatMoneyDetail, ChatMoneyPayload } from "@/models";
import {
  canShowRedPacketOpenAction,
  chatMoneyBubblePolicy,
  chatMoneyComposerPolicy,
  chatMoneyDetailPolicy,
  chatMoneyTheme,
  encodeChatMoneyPayload,
  localizedChatMoneyReceipt,
  mergeChatMoneyDetail,
  normalizeChatMoneyConfiguration,
  normalizeChatMoneyDetail,
  normalizeChatMoneyReceipt,
  parseChatMoneyPayload,
  sanitizeChatMoneyDigits,
  shouldShowRedPacketEnvelopeFromDetail,
  shouldShowRedPacketEnvelopeFromPayload,
  validateChatMoneyComposer,
} from "@/services/messages/chatMoneyPolicy";
import {
  cachedChatMoneyConfiguration,
  cachedChatMoneyDetail,
  loadChatMoneyConfiguration,
  loadChatMoneyDetail,
  resetChatMoneyMemoryForAccount,
} from "@/services/messages/ChatMoneyRepository";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);
const t = (key: string, ...args: (string | number)[]) => `${key}:${args.join("|")}`;

function redPayload(overrides: Partial<ChatMoneyPayload> = {}): ChatMoneyPayload {
  return {
    schema_version: 1,
    asset_id: "red-1",
    kind: "red_packet",
    scope: "group",
    mode: "lucky",
    sender_id: "sender",
    packet_count: 3,
    claimed_count: 0,
    status: "pending",
    version: 1,
    ...overrides,
  };
}

function redDetail(overrides: Partial<ChatMoneyDetail> = {}): ChatMoneyDetail {
  return {
    ...redPayload(),
    can_claim: true,
    can_accept: false,
    can_return: false,
    claims: [],
    viewer_state: "claimable",
    remaining_count: 3,
    ...overrides,
  };
}

describe("native chat-money contracts", () => {
  beforeEach(() => {
    request.mockReset();
    resetChatMoneyMemoryForAccount("owner-a");
    resetChatMoneyMemoryForAccount("owner-b");
  });

  it("keeps the exact bubble, composer, envelope and color metrics", () => {
    expect(chatMoneyBubblePolicy).toMatchObject({
      width: 245,
      redPacketRadius: 6,
      redPacketTopHeight: 78,
      redPacketFooterHeight: 28,
      transferRadius: 5,
      transferTopHeight: 74,
      transferFooterHeight: 28,
      redPacketGlyphWidth: 44,
      redPacketGlyphHeight: 48,
      transferGlyphSize: 42,
    });
    expect(chatMoneyComposerPolicy).toMatchObject({ inputRowHeight: 64, recipientRowHeight: 56, submitWidth: 188, submitHeight: 48, focusDelayMs: 350 });
    expect(chatMoneyDetailPolicy).toMatchObject({ overlayOpacity: 0.52, envelopeMaximumWidth: 340, envelopeMinimumHeight: 430, envelopeMaximumHeight: 550, openButtonSize: 92, claimMinimumAnimationMs: 750, headerHeight: 182, claimRowHeight: 68 });
    expect(chatMoneyTheme).toMatchObject({ cardOrange: "#FA9D3B", cardMutedOrange: "#F6C58E", envelopeRed: "#D95940", envelopeDarkRed: "#C94B38", gold: "#F4D49B" });
  });

  it("parses aliases strictly and never exposes red-packet amount in encoded message content", () => {
    const payload = parseChatMoneyPayload(JSON.stringify({
      assetId: "red-2",
      kind: "redPacket",
      scope: "private",
      senderId: "me",
      mode: "direct",
      amount: 999,
      packetCount: "1",
      status: "pending",
    }));
    expect(payload).toMatchObject({ asset_id: "red-2", kind: "red_packet", scope: "dm", packet_count: 1 });
    expect(payload?.amount).toBeUndefined();
    expect(JSON.parse(encodeChatMoneyPayload({ ...payload!, amount: 999 }))).not.toHaveProperty("amount");
    expect(parseChatMoneyPayload(JSON.stringify({ data: { asset_id: "nested" } }))).toBeNull();
    const transfer = parseChatMoneyPayload(JSON.stringify({ asset_id: "tr-1", kind: "transfer", scope: "direct", sender_id: "me", amount: "88" }));
    expect(transfer).toMatchObject({ amount: 88, status: "pending", version: 1 });
  });

  it("normalizes fail-closed configuration, flexible detail fields and terminal permissions", () => {
    expect(normalizeChatMoneyConfiguration({
      redPacketEnabled: true,
      transfer_enabled: false,
      limits: { minimumAmount: 2, maximum_amount: 1000, maximumPacketCount: 20 },
      eligibility: { eligible: true, reasonCode: "ok" },
    })).toMatchObject({
      red_packet_enabled: true,
      transfer_enabled: false,
      limits: { minimum_amount: 2, maximum_amount: 1000, maximum_packet_count: 20, red_packet_minimum_amount: 2, transfer_maximum_amount: 1000 },
      eligibility: { eligible: true, reason_code: "ok" },
    });
    expect(normalizeChatMoneyConfiguration({ red_packet_enabled: true })).toBeNull();
    const detail = normalizeChatMoneyDetail({ detail: {
      ...redPayload({ status: "completed", version: 4 }),
      senderName: "Sender",
      canClaim: true,
      claims: [{ userId: "u1", name: "One", amount: "8", claimedAt: "2026-01-01T00:00:00Z", isLuckiest: true }],
    } });
    expect(detail).toMatchObject({ sender_name: "Sender", version: 4, can_claim: true, claims: [{ user_id: "u1", nickname: "One", amount: 8, is_luckiest: true }] });
  });

  it("sanitizes Unicode digits and validates equal/lucky/member/balance boundaries", () => {
    expect(sanitizeChatMoneyDigits("a００12b")).toBe("００12");
    expect(sanitizeChatMoneyDigits("000")).toBe("0");
    const equal = validateChatMoneyComposer({
      kind: "red_packet", scope: "group", mode: "equal", amountText: "5", packetCountText: "3",
      spendableBalance: 20, memberCount: 4,
      limits: { minimum_amount: 1, maximum_amount: 20000, maximum_packet_count: 100, expiry_seconds: 86400, red_packet_minimum_amount: 1, red_packet_maximum_amount: 20000, transfer_minimum_amount: 1, transfer_maximum_amount: 20000, maximum_greeting_length: 60, maximum_transfer_note_length: 20 },
    }, t);
    expect(equal).toMatchObject({ amount: 5, packetCount: 3, totalAmount: 15, canSubmit: true });
    expect(validateChatMoneyComposer({
      kind: "red_packet", scope: "group", mode: "lucky", amountText: "2", packetCountText: "3", spendableBalance: 20, memberCount: 4, limits: { minimum_amount: 1, maximum_amount: 20000, maximum_packet_count: 100, expiry_seconds: 86400, red_packet_minimum_amount: 1, red_packet_maximum_amount: 20000, transfer_minimum_amount: 1, transfer_maximum_amount: 20000, maximum_greeting_length: 60, maximum_transfer_note_length: 20 },
    }, t).canSubmit).toBe(false);
  });

  it("enforces sender/group/local-claim/enforced-server envelope and open-action rules", () => {
    expect(shouldShowRedPacketEnvelopeFromPayload(redPayload(), false, false)).toBe(true);
    expect(shouldShowRedPacketEnvelopeFromPayload(redPayload(), true, false)).toBe(true);
    expect(shouldShowRedPacketEnvelopeFromPayload(redPayload({ scope: "dm", mode: "direct" }), true, false)).toBe(false);
    expect(shouldShowRedPacketEnvelopeFromPayload(redPayload(), false, true)).toBe(false);
    expect(shouldShowRedPacketEnvelopeFromDetail(redDetail(), "viewer", false, false)).toBe(true);
    expect(shouldShowRedPacketEnvelopeFromDetail(redDetail({ can_claim: false }), "viewer", false, false)).toBe(false);
    expect(canShowRedPacketOpenAction(redDetail(), false)).toBe(true);
  });

  it("parses nested receipt envelopes to depth four and localizes by viewer role", () => {
    const receipt = normalizeChatMoneyReceipt(JSON.stringify({ data: { receipt_message: { payload: {
      assetId: "red-1", eventType: "red_packet_claimed", actorId: "me", actorName: "Me", senderId: "sender", senderName: "Sender",
    } } } }));
    expect(receipt).toMatchObject({ event_id: "red-1:red_packet_claimed:me", asset_id: "red-1", event_type: "red_packet_claimed", actor_id: "me" });
    expect(localizedChatMoneyReceipt(receipt!, "me", t)).toBe("chatMoney.receipt.claimedByMe:Sender");
  });

  it("merges red-packet claim history append-only and blocks terminal permissions", () => {
    const merged = mergeChatMoneyDetail(
      redDetail({ claims: [{ user_id: "one", nickname: "One", amount: 3, claimed_at: "a", is_luckiest: false }], version: 2 }),
      redDetail({ claims: [{ user_id: "two", nickname: "Two", amount: 4, claimed_at: "b", is_luckiest: true }], status: "completed", version: 3, can_claim: true }),
    );
    expect(merged.claims.map((claim) => claim.user_id)).toEqual(["one", "two"]);
    expect(merged.can_claim).toBe(false);
  });

  it("posts exact red-packet and transfer creation bodies and normalizes messages", async () => {
    request
      .mockResolvedValueOnce({
        message: { id: 11, sender_id: "me", receiver_id: "friend", msg_type: "red_packet", content: encodeChatMoneyPayload(redPayload({ scope: "dm", mode: "direct" })) },
        asset: redPayload({ scope: "dm", mode: "direct" }),
      })
      .mockResolvedValueOnce({
        group_message: { id: 12, group_id: 7, sender_id: "me", msg_type: "transfer", content: JSON.stringify({ asset_id: "tr-1", kind: "transfer", scope: "group", sender_id: "me", recipient_id: "friend", amount: 88 }) },
        asset: { asset_id: "tr-1", kind: "transfer", scope: "group", sender_id: "me", recipient_id: "friend", amount: 88 },
      });
    const red = await createRedPacketMessage({ clientMessageId: "red-key", scope: "dm", mode: "direct", totalAmount: 10, packetCount: 1, greeting: "Hi", receiverId: "friend" });
    expect(request).toHaveBeenNthCalledWith(1, "/wallet/red-packets", { method: "POST", body: { client_message_id: "red-key", scope: "dm", mode: "direct", total_amount: 10, packet_count: 1, greeting: "Hi", receiver_id: "friend" } });
    expect(red.direct_message).toMatchObject({ id: 11, msg_type: "red_packet" });
    const transfer = await createTransferMessage({ clientMessageId: "tr-key", scope: "group", recipientId: "friend", recipientName: "Friend", amount: 88, note: "Dinner", groupId: 7 });
    expect(request).toHaveBeenNthCalledWith(2, "/wallet/transfers", { method: "POST", body: { client_message_id: "tr-key", scope: "group", recipient_id: "friend", amount: 88, note: "Dinner", group_id: 7, recipient_name: "Friend" } });
    expect(transfer.group_message).toMatchObject({ id: 12, group_id: 7 });
  });

  it("uses exact configuration/detail/claim/accept/return endpoints", async () => {
    request
      .mockResolvedValueOnce({ red_packet_enabled: true, transfer_enabled: true, eligibility: { eligible: true } })
      .mockResolvedValueOnce(redDetail())
      .mockResolvedValueOnce({ detail: redDetail({ status: "completed", version: 2 }), payload: redPayload({ status: "completed", version: 2 }) })
      .mockResolvedValueOnce({ detail: { ...redDetail(), asset_id: "tr", kind: "transfer", status: "accepted", amount: 9 }, payload: { asset_id: "tr", kind: "transfer", scope: "dm", sender_id: "sender", amount: 9, status: "accepted" } })
      .mockResolvedValueOnce({ detail: { ...redDetail(), asset_id: "tr", kind: "transfer", status: "returned", amount: 9 }, payload: { asset_id: "tr", kind: "transfer", scope: "dm", sender_id: "sender", amount: 9, status: "returned" } });
    await getChatMoneyConfiguration();
    await getChatMoneyDetail("a/b");
    await claimRedPacket("a/b");
    await acceptTransfer("a/b");
    await returnTransfer("a/b");
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/wallet/chat-money/config",
      "/wallet/chat-money/a%2Fb",
      "/wallet/red-packets/a%2Fb/claim",
      "/wallet/transfers/a%2Fb/accept",
      "/wallet/transfers/a%2Fb/return",
    ]);
  });

  it("clears only the selected account's in-memory configuration and detail cache", async () => {
    request
      .mockResolvedValueOnce({ red_packet_enabled: true, transfer_enabled: true, eligibility: { eligible: true } })
      .mockResolvedValueOnce({ red_packet_enabled: true, transfer_enabled: true, eligibility: { eligible: true } })
      .mockResolvedValueOnce(redDetail({ asset_id: "asset-a" }))
      .mockResolvedValueOnce(redDetail({ asset_id: "asset-b" }));
    await loadChatMoneyConfiguration("owner-a");
    await loadChatMoneyConfiguration("owner-b");
    await loadChatMoneyDetail({ ownerId: "owner-a", assetId: "asset-a" });
    await loadChatMoneyDetail({ ownerId: "owner-b", assetId: "asset-b" });

    resetChatMoneyMemoryForAccount("owner-a");

    expect(cachedChatMoneyConfiguration("owner-a").red_packet_enabled).toBe(false);
    expect(cachedChatMoneyConfiguration("owner-b").red_packet_enabled).toBe(true);
    expect(cachedChatMoneyDetail("owner-a", "asset-a")).toBeNull();
    expect(cachedChatMoneyDetail("owner-b", "asset-b")).not.toBeNull();
  });
});
