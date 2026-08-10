import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const detail = readFileSync(
  resolve(__dirname, "../src/components/messages/ChatMoneyDetailViews.tsx"),
  "utf8",
);

describe("chat-money detail presentation parity", () => {
  it("opens red packets directly over the current chat without a gray backdrop", () => {
    expect(detail).toContain('presentationStyle={isRedPacket ? "overFullScreen" : "fullScreen"}');
    expect(detail).toContain("transparent={isRedPacket}");
    expect(detail).toContain("const presentsEnvelope = isRedPacket");
    expect(detail).toContain('envelopeBackdrop: { alignItems: "center", backgroundColor: "transparent"');
    expect(detail).toContain('overlayLoading: { alignItems: "center", backgroundColor: "transparent"');
  });

  it("extends the red detail header behind the Dynamic Island", () => {
    expect(detail).toContain('edges={isRedPacket ? ["bottom"] : ["top", "bottom"]}');
    expect(detail).toContain("const headerHeight = chatMoneyDetailPolicy.headerHeight + insets.top");
    expect(detail).toContain("const headerCurveStart = 115 + insets.top");
    expect(detail).toContain("{ top: insets.top + 4 }");
    expect(detail).toContain('<StatusBar style="light" />');
  });

  it("does not render stale detail from a previously selected money message", () => {
    expect(detail).toContain("detail?.asset_id === initialPayload.asset_id ? detail : null");
  });

  it("gives claim actions immediate feedback without replacing their labels with spinners", () => {
    expect(detail).toContain("onPressIn={triggerMoneyActionPressFeedback}");
    expect(detail).toContain("claimInFlightRef.current");
    expect(detail).toContain("transferInFlightRef.current");
    expect(detail).toContain("pressed && styles.moneyActionPressed");
    expect(detail).not.toContain("isOpening ? <ActivityIndicator");
    expect(detail).not.toContain("isProcessing ? <ActivityIndicator");
  });
});
