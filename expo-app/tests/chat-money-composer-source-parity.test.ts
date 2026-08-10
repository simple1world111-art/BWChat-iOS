import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const composer = readFileSync(
  resolve(__dirname, "../src/components/messages/ChatMoneyComposerViews.tsx"),
  "utf8",
);
const chinese = readFileSync(
  resolve(__dirname, "../src/localization/generated/zh-Hans.json"),
  "utf8",
);

describe("chat-money composer reference parity", () => {
  it("routes private and group red packets through the reference layout", () => {
    expect(composer).toContain('if (kind === "red_packet")');
    expect(composer).toContain("<ReferenceRedPacketComposer");
    expect(composer).toContain("isGroup={isGroup}");
  });

  it("implements the lucky, equal and exclusive group field matrix", () => {
    expect(composer).toContain('const isExclusive = isGroup && mode === "exclusive"');
    expect(composer).toContain("const showsPacketCount = isGroup && !isExclusive");
    expect(composer).toContain('mode === "lucky"');
    expect(composer).toContain('mode === "equal"');
    expect(composer).toContain("<RedPacketGlyph />");
    expect(composer).toContain("<LuckyBadge />");
    expect(composer).toContain('t("chatMoney.redPacket.exclusiveRecipient")');
    expect(composer).toContain("<RecipientSelectionModal");
  });

  it("uses an iOS bottom action sheet for the three full red-packet mode names", () => {
    expect(composer).toContain("ActionSheetIOS.showActionSheetWithOptions");
    expect(composer).toContain('const modes: ChatMoneyRedPacketMode[] = ["lucky", "equal", "exclusive"]');
    expect(composer).toContain('t(`chatMoney.redPacket.mode.${mode}Full`)');
    expect(chinese).toContain('"chatMoney.redPacket.mode.luckyFull": "拼手气红包"');
    expect(chinese).toContain('"chatMoney.redPacket.mode.equalFull": "普通红包"');
    expect(chinese).toContain('"chatMoney.redPacket.mode.exclusiveFull": "专属红包"');
  });

  it("matches the reference card, total, button and footer hierarchy using Gold Coins", () => {
    expect(composer).toContain("styles.referenceGreetingCard");
    expect(composer).not.toContain("styles.referenceCoverCard");
    expect(composer).not.toContain('t("chatMoney.redPacket.cover")');
    expect(composer).toContain("styles.referenceTotalNumber");
    expect(composer).toContain("styles.referenceSubmitButton");
    expect(composer).toContain('t("wallet.currency.goldCoins")');
    expect(composer).toContain("nativeAssets.walletGoldCoinBadge");
    expect(composer).toContain("<GoldCoinIcon");
    expect(composer).toContain('"chatMoney.redPacket.refundNotice"');
    expect(composer).toContain('"chatMoney.redPacket.exclusiveVisibility"');
    expect(composer).not.toContain("¥");
    expect(composer).not.toContain("￥");
  });

  it("uses the reference private transfer recipient and amount panel", () => {
    expect(composer).toContain("<ReferenceTransferComposer");
    expect(composer).toContain('accountId={source.kind === "fixed" ? source.recipient.id : undefined}');
    expect(composer).toContain('t("chatMoney.transfer.to", recipient.name)');
    expect(composer).toContain('t("chatMoney.transfer.account", accountId)');
    expect(composer).toContain('t("chatMoney.transfer.amountTitle")');
    expect(composer).toContain('t("chatMoney.transfer.noteAction")');
    expect(composer).toContain("const dismissTransferNoteInput = () =>");
    expect(composer).toContain("noteInputRef.current?.blur()");
    expect(composer).toContain("onPress={dismissTransferNoteInput}");
    expect(composer).toContain('<Pressable accessible={false} onPress={dismissTransferNoteInput}');
    expect(composer).toContain('transferRecipientArea: { backgroundColor: "#EFEFEF", height: 126 }');
    expect(composer).toContain("top: 52");
  });

  it("shows group recipient selection before the group transfer amount page", () => {
    expect(composer).toContain('const showGroupRecipientSelection = source.kind === "group" && !transferRecipient');
    expect(composer).toContain("<TransferRecipientSelectionScreen");
    expect(composer).toContain('t("chatMoney.transfer.chooseRecipientTitle")');
    expect(composer).toContain('t("chatMoney.transfer.recipientSearch")');
    expect(composer).toContain('"ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("")');
    expect(composer).toContain('new Intl.Collator("zh-Hans-u-co-pinyin")');
  });

  it("uses an integer Gold Coin keypad with delete and transfer actions", () => {
    expect(composer).toContain("<TransferCoinKeypad");
    expect(composer).toContain('const rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]]');
    expect(composer).toContain('onAppendDigit("0")');
    expect(composer).toContain('name="delete.left.fill"');
    expect(composer).toContain('t("wallet.currency.goldCoins")');
    expect(composer).toContain("styles.transferCoinIcon");
    expect(composer).not.toContain('onAppendDigit(".")');
  });

  it("applies inherited safe-area insets to full-screen money modals", () => {
    expect(composer).toContain("const insets = useSafeAreaInsets()");
    expect(composer).toContain("paddingTop: insets.top");
    expect(composer).toContain("paddingBottom: insets.bottom");
    expect(composer).not.toContain("<SafeAreaView");
  });

  it("dismisses money keyboards from page backgrounds without blocking input switching", () => {
    expect(composer).toContain('<Pressable accessible={false} onPress={Keyboard.dismiss}');
    expect(composer).toContain('keyboardShouldPersistTaps="handled"');
    expect(composer).toContain('style={styles.transferSelectionPage}');
    expect(composer).toContain('styles.recipientSelectionSafeArea');
  });

  it("submits directly with a stable button and the existing Gold Coin creation API", () => {
    expect(composer).toContain("validateChatMoneyComposer");
    expect(composer).toContain("createChatMoneyRedPacket");
    expect(composer).toContain("submissionInFlightRef.current");
    expect(composer).toContain("void submit()");
    expect(composer).toContain("onOptimisticCreated({");
    expect(composer).toContain("asset_id: `pending:${clientMessageId}`");
    expect(composer).toContain("onClose();\n    void submit();");
    expect(composer).toContain("onCreateFailed(clientMessageIdRef.current, message)");
    expect(composer).not.toContain("requestAnimationFrame(() => onCreated(result))");
    expect(composer).not.toContain('t("chatMoney.confirm.title")');
    expect(composer).not.toContain('t("chatMoney.confirm.pay", validation.totalAmount)');
    expect(composer).not.toContain("<ActivityIndicator");
    expect(composer).not.toContain("styles.submitBusy");
  });

  it("gives red-packet and transfer submit actions immediate stable press feedback", () => {
    expect(composer).toContain("onPressIn={triggerMoneyActionPressFeedback}");
    expect(composer).toContain("isSubmitting && styles.moneyActionPending");
    expect(composer).toContain("pressed && styles.moneyActionPressed");
    expect(composer).toContain("isSubmitting={isSubmitting}");
  });
});
