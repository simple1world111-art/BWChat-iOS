import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("direct and group MessageBubble source integration", () => {
  for (const path of ["src/app/chat/[id].tsx", "src/app/group-chat/[id].tsx"]) {
    it(`${path} preserves native content priority and state coverage`, () => {
      const contents = source(path);
      const rowStart = contents.indexOf("function MessageTimelineRow");
      const groupRowStart = contents.indexOf("function GroupMessageRow");
      const start = Math.max(rowStart, groupRowStart);
      const contentStart = contents.indexOf("function MessageContent", start);
      const row = contents.slice(start, contentStart);
      const body = contents.slice(
        contentStart,
        contents.indexOf("function TimeSeparator", contentStart),
      );

      expect(row).toContain("const moneyReceipt = normalizeChatMoneyReceipt(message.content)");
      expect(row.indexOf("if (moneyReceipt)")).toBeLessThan(
        row.indexOf('if (message.msg_type === "system")'),
      );
      expect(row).not.toContain("if (isChatMoneyReceiptType(message.msg_type))");
      expect(row).toContain("<ChatMessageDeliveryStatus");
      expect(row).toContain("disabled={parseChatCallRecord(message.content) !== null}");
      if (path.includes("group-chat")) {
        expect(contents).toContain("function isAvailableForGroupSelection");
        expect(contents).toContain("parseChatCallRecord(message.content) === null &&");
        expect(contents).toContain(
          "isSelectableChatMessage(message, normalizeChatMoneyReceipt(message.content) !== null)",
        );
      } else {
        expect(contents).toContain("parseChatCallRecord(message.content) !== null ||");
        expect(contents).toContain(
          "!isSelectableChatMessage(message, normalizeChatMoneyReceipt(message.content) !== null)",
        );
      }
      expect(contents).toContain(
        "isChatMoneyReceipt: normalizeChatMoneyReceipt(message.content) !== null",
      );
      expect(contents).toContain("isCallRecord: parseChatCallRecord(message.content) !== null");
      expect(contents).not.toContain("isChatMoneyReceiptType(message.msg_type)");
      expect(contents).not.toContain("isChatCallRecordContent(message.content)");

      const branchOrder = [
        "const forwardBundle",
        '=== "image"',
        '=== "video"',
        '=== "voice"',
        "const moneyPayload",
        '=== "sticker"',
        "const giftPayload",
        "const callRecord",
      ].map((marker) => body.indexOf(marker));
      expect(branchOrder.every((position) => position >= 0)).toBe(true);
      expect(branchOrder).toEqual([...branchOrder].sort((a, b) => a - b));
      expect(body).toContain("isPendingChatVoice(message.delivery_status)");
      expect(body).not.toContain('if (type === "gift")');
      expect(body).not.toContain('if (normalizedType === "gift")');
      expect(body).toContain("<ChatCallRecordBubble");
    });
  }

  it("uses the exact native failed and sending-media symbols", () => {
    const status = source("src/components/messages/ChatMessageDeliveryStatus.tsx");
    expect(status).toContain('name="exclamationmark.circle.fill" size={20}');
    expect(status).toContain('name="clock" size={12} weight="medium"');
    expect(status).toContain('type === "image" || type === "video"');
  });

  it("keeps ImageGallery read-only while guarding the bubble entry callback", () => {
    const imageBubble = source("src/components/messages/ChatImageBubble.tsx");
    const imageGallery = source("src/components/media/ImageGallery.tsx");
    expect(imageBubble).toContain("if (canActivate()) onOpen(nextSelection)");
    expect(imageGallery).toContain("export function ImageGallerySource");
  });

  it("matches native money/card and long-press ownership details", () => {
    const money = source("src/components/messages/ChatMoneyViews.tsx");
    const reply = source("src/components/messages/ChatReplyViews.tsx");
    const gift = source("src/components/messages/ChatGiftViews.tsx");
    const avatar = source("src/components/Avatar.tsx");
    expect(money).not.toContain("BubbleTail");
    expect(money).toContain('symbol: "checkmark.circle.fill"');
    expect(money).toContain('symbol: "arrow.uturn.backward.circle.fill"');
    expect(money).toContain('d="M 0.75 0.75 Q 10.5 6.25 20.25 0.75"');
    expect(money).toContain('<SymbolView name="yensign" size={5} weight="bold"');
    expect(money).not.toContain("<Text style={styles.plusCoinText}>¥</Text>");
    expect(money).toContain("hasViewerClaimedChatMoney(ownerId, payload.asset_id)");
    expect(reply).toContain("menuOwnsTouchSequenceRef.current = true");
    expect(reply).toContain("}, 150)");
    expect(gift).toContain("canActivate={canActivate}");
    expect(gift).toContain("payload.recipient_avatar_url?.trim()");
    expect(avatar).toContain("if (canActivate && !canActivate()) return");
  });

  it("resolves historical group gift recipients from current group member data", () => {
    const group = source("src/app/group-chat/[id].tsx");
    expect(group).toContain("members={groupMembers}");
    expect(group).toContain("members.find((member) => member.user_id === recipientId)");
    expect(group).toContain("recipientMember?.avatar_url || cachedRecipient?.avatar_url");
  });
});
