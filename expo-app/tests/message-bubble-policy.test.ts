import type { ChatMoneyPayload } from "@/models";
import { isPendingChatVoice } from "@/components/messages/ChatMessageDeliveryStatus";
import {
  localizedChatCallRecord,
  parseChatCallRecord,
} from "@/services/messages/chatCallRecordPolicy";
import { parseGiftMessagePayload } from "@/services/messages/chatGiftPolicy";
import {
  isMutedChatMoneyBubble,
  normalizeChatMoneyReceipt,
} from "@/services/messages/chatMoneyPolicy";

const t = (key: string, ...args: (string | number)[]) => `${key}:${args.join("|")}`;

function redPacket(overrides: Partial<ChatMoneyPayload> = {}): ChatMoneyPayload {
  return {
    schema_version: 1,
    asset_id: "red-1",
    kind: "red_packet",
    scope: "group",
    mode: "lucky",
    sender_id: "sender",
    status: "pending",
    version: 1,
    ...overrides,
  };
}

describe("MessageBubble presentation policy", () => {
  it("parses the native multilingual call-record grammar and duration boundary", () => {
    expect(parseChatCallRecord("[视频通话] 通话时长 05:09")).toEqual({
      callType: "video",
      duration: "05:09",
      status: "completed",
    });
    expect(parseChatCallRecord("[Sprachanruf] Keine Antwort")).toEqual({
      callType: "voice",
      status: "missed",
    });
    expect(parseChatCallRecord("[appel vocal] busy")).toEqual({
      callType: "voice",
      status: "busy",
    });
    expect(parseChatCallRecord("[voice] 1234:56")).toBeNull();
    expect(parseChatCallRecord("[unknown] missed")).toBeNull();
  });

  it("uses native direction-sensitive call-record localization", () => {
    expect(localizedChatCallRecord({ callType: "voice", status: "cancelled" }, true, t)).toBe(
      "call.record.cancelled.self:",
    );
    expect(localizedChatCallRecord({ callType: "video", status: "rejected" }, true, t)).toBe(
      "call.record.rejected.peer:",
    );
    expect(localizedChatCallRecord({ callType: "voice", status: "missed" }, false, t)).toBe(
      "call.record.missed.self:",
    );
    expect(
      localizedChatCallRecord(
        { callType: "video", duration: "01:02:03", status: "completed" },
        false,
        t,
      ),
    ).toBe("call.record.duration:01:02:03");
  });

  it("does not mark acknowledged history with an undefined delivery status as pending", () => {
    expect(isPendingChatVoice(undefined)).toBe(false);
    expect(isPendingChatVoice("sent")).toBe(false);
    expect(isPendingChatVoice("sending")).toBe(true);
    expect(isPendingChatVoice("failed")).toBe(true);
  });

  it("mutes money bubbles only for terminal state or an owner-scoped local red-packet claim", () => {
    expect(isMutedChatMoneyBubble(redPacket(), false)).toBe(false);
    expect(isMutedChatMoneyBubble(redPacket(), true)).toBe(true);
    expect(isMutedChatMoneyBubble(redPacket({ status: "completed" }), false)).toBe(true);
    expect(
      isMutedChatMoneyBubble(
        { ...redPacket(), kind: "transfer", amount: 8, status: "pending" },
        true,
      ),
    ).toBe(false);
  });

  it("recognizes legacy text-wrapped receipts and gift content independently of msg_type", () => {
    const receiptContent = JSON.stringify({
      event_id: "event-1",
      asset_id: "asset-1",
      event_type: "transfer_accepted",
      actor_id: "friend",
      sender_id: "me",
    });
    expect(normalizeChatMoneyReceipt(receiptContent)).toMatchObject({
      event_id: "event-1",
      event_type: "transfer_accepted",
    });
    expect(normalizeChatMoneyReceipt("not a receipt")).toBeNull();

    const giftContent = JSON.stringify({
      gift_id: "gift-fish",
      asset_key: "gift_fish",
      name: "Fish",
      price: 20,
      recipient_id: "friend",
    });
    expect(parseGiftMessagePayload(giftContent)).toMatchObject({ asset_key: "gift_fish" });
  });
});
