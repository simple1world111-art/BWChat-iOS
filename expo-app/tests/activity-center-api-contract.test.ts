import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

describe("ActivityCenter native API contract guard", () => {
  const repository = fs.readFileSync(
    path.join(root, "src/services/activity/ActivityCenterRepository.ts"),
    "utf8",
  );

  it("keeps the complete native route surface without inventing a list-pagination endpoint", () => {
    for (const route of [
      '"/activity-center"',
      '"/activity-center/check-in/claim"',
      "`/activity-center/meals/${encodeURIComponent(windowID)}/claim`",
      '"/activity-center/wheel/spins"',
      '"/activity-center/contact-discovery/sessions"',
      "`/activity-center/contact-discovery/sessions/${encodeURIComponent(sessionID)}/match`",
      '"/activity-center/invite-share-sessions"',
      "`/activity-center/invite-share-sessions/${encodeURIComponent(sessionID)}/complete`",
      '"/activity-center/invites/redeem"',
      '"/account/phone/verification-sessions"',
      '"/account/phone/verify"',
      '"/friends/request"',
    ]) {
      expect(repository).toContain(route);
    }
    expect(repository).not.toMatch(/activity-center[^"`\n]*(?:cursor|page|limit|offset)/i);
  });

  it("keeps native path escaping, body fields, required envelopes and retry policy", () => {
    expect(repository).toContain("encodeURIComponent(windowID)");
    expect(repository).toContain("encodeURIComponent(sessionID)");
    expect(repository).toContain("{ expected_config_version: configVersion, tier_id: tierID }");
    expect(repository).toContain("{ salt_version: saltVersion, phone_hashes: [...phoneHashes] }");
    expect(repository).toContain("{ code_or_token: codeOrToken }");
    expect(repository).toContain("{ phone_e164: e164Phone }");
    expect(repository).toContain("{ session_id: sessionID, code }");
    expect(repository).toContain("body: { target_user_id: targetUserID }");
    expect(repository).toContain("requiredData: true");
    expect(repository).toContain("transientRetries: false");
  });

  it("keeps sensitive responses uncached and mutation confirmation errors idempotent", () => {
    expect(repository).toContain('{ "Cache-Control": "no-store" }');
    expect(repository).toContain('cache: "no-store"');
    expect(repository).toContain('"Idempotency-Key": idempotencyKey');
    expect(repository).toContain("error instanceof ActivityResponseDecodingError");
    expect(repository).toContain("error.status === 0");
    expect(repository).toContain("error.status === 408 && error.payload === undefined");
    expect(repository).toContain("error.status >= 500");
    expect(repository).toContain("responseCode >= 500");
  });
});
