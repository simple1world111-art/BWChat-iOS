import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const composer = readFileSync(
  resolve(__dirname, "../src/components/messages/ChatMoneyComposerViews.tsx"),
  "utf8",
);

describe("chat-money composer native parity", () => {
  it("restores the historical recipient header and segmented group mode control", () => {
    expect(composer).toContain("<RecipientHeader");
    expect(composer).toContain("size={58}");
    expect(composer).toContain('"chatMoney.redPacket.headerHint"');
    expect(composer).toContain('const modes: ChatMoneyRedPacketMode[] = ["lucky", "equal", "exclusive"]');
    expect(composer).toContain("styles.modeOptionSelected");
    expect(composer).not.toContain("<MenuView");
  });

  it("keeps the historical amount-first card hierarchy in direct and group flows", () => {
    expect(composer.indexOf("<AmountCard")).toBeLessThan(composer.indexOf("<MessageCard"));
    expect(composer).toContain("const showsPacketCount");
    expect(composer).toContain("styles.amountCard");
    expect(composer).toContain("styles.packetCountRow");
    expect(composer).toContain('t("chatMoney.availableBalance")');
    expect(composer).toContain('t("chatMoney.amountValue", balance)');
    expect(composer).not.toContain("styles.totalSection");
  });

  it("uses the inline member picker, rounded cards, full-width action and confirmation alert", () => {
    expect(composer).toContain("<InlineRecipientPicker");
    expect(composer).toContain('name="person.crop.circle.badge.checkmark"');
    expect(composer).toContain('name="checkmark.circle.fill"');
    expect(composer).toContain('placeholder="0"');
    expect(composer).toContain('borderRadius: 15');
    expect(composer).toContain('width: "100%"');
    expect(composer).toContain('t("chatMoney.confirm.title")');
    expect(composer).toContain('t("chatMoney.confirm.pay", validation.totalAmount)');
  });

  it("loads the real group avatar for the composer header", () => {
    expect(composer).toContain("setConversationAvatarUrl(groupContext.avatarUrl)");
    expect(composer).toContain("avatarUrl = detail.avatar_url");
  });
});
