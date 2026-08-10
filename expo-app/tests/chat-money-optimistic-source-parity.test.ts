import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const direct = readFileSync(resolve(__dirname, "../src/app/chat/[id].tsx"), "utf8");
const group = readFileSync(resolve(__dirname, "../src/app/group-chat/[id].tsx"), "utf8");

describe("chat-money optimistic timeline delivery", () => {
  it.each([
    ["direct", direct],
    ["group", group],
  ])("inserts and reconciles the %s money bubble without waiting for the API", (_name, source) => {
    expect(source).toContain("onOptimisticCreated=");
    expect(source).toContain('delivery_status: "sending"');
    expect(source).toContain("client_message_id:");
    expect(source).toContain('delivery_status: "sent"');
    expect(source).toContain("onCreateFailed=");
    expect(source).toContain("current.filter((item) => item.client_message_id !== clientMessageId)");
  });

  it.each([
    ["direct", direct],
    ["group", group],
  ])("starts the %s money modal after the plus panel leaves the current frame", (_name, source) => {
    expect(source).toContain("requestAnimationFrame(() => setMoneyComposerKind(kind))");
    expect(source).toContain("pressed && styles.plusTilePressed");
    expect(source).toContain("plusTilePressed: { opacity: 0.72");
  });

  it("reuses the already loaded group member directory for the first transfer frame", () => {
    expect(group).toContain("const moneyRecipients = useMemo(");
    expect(group).toContain("initialRecipients={moneyRecipients}");
  });
});
