import fs from "node:fs";
import path from "node:path";

const api = fs.readFileSync(path.join(process.cwd(), "src/api/bwchat.ts"), "utf8");

describe("Swift group message API response contract", () => {
  it("requires wrapper data for every non-null group message response", () => {
    const functions = [
      "getGroupMessageContext",
      "recallGroupMessage",
      "sendGroupTextMessage",
      "sendGroupStickerMessage",
      "sendGroupGiftMessage",
      "sendGroupImageMessage",
      "sendGroupVideoMessage",
      "sendGroupVoiceMessage",
    ];
    for (let index = 0; index < functions.length; index += 1) {
      const start = api.indexOf(`export async function ${functions[index]}`);
      const end =
        index + 1 < functions.length
          ? api.indexOf(`export async function ${functions[index + 1]}`, start + 1)
          : api.length;
      const body = api.slice(start, end);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(body).toContain("requiredData: true");
      expect(body).toContain("requiredEnvelope: true");
    }
  });

  it("keeps group read envelope-only because Swift accepts a null data receipt", () => {
    const start = api.indexOf("export async function markGroupMessagesRead");
    const end = api.indexOf("export async function getGroupMessageContext", start);
    const body = api.slice(start, end);
    expect(body).toContain("requiredEnvelope: true");
    expect(body).not.toContain("requiredData: true");
    expect(body).toContain("value === null || value === undefined ? null");
  });
});
