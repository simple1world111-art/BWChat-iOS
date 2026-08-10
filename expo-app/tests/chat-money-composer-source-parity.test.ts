import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const composer = readFileSync(
  resolve(__dirname, "../src/components/messages/ChatMoneyComposerViews.tsx"),
  "utf8",
);

describe("chat-money composer native parity", () => {
  it("uses the native lightweight group mode menu instead of a segmented control", () => {
    expect(composer).toContain('MenuView } from "@expo/ui/community/menu"');
    expect(composer).toContain("<MenuView");
    expect(composer).toContain('name="chevron.down"');
    expect(composer).not.toContain("styles.modeSelected");
  });

  it("keeps balance, total amount and submit hierarchy in both direct and group flows", () => {
    expect(composer).toContain('t("chatMoney.availableBalance")');
    expect(composer).toContain('t("chatMoney.amountValue", balance)');
    expect(composer).toContain("<View style={styles.totalSection}>");
    expect(composer).not.toContain('mode === "equal" && validation.totalAmount > 0');
  });

  it("renders the native white greeting row and zero amount placeholders", () => {
    expect(composer).toContain('placeholder="0"');
    expect(composer).toContain('backgroundColor: "#FFFFFF", borderRadius: 4');
    expect(composer).toContain('textAlign: "right"');
  });
});
