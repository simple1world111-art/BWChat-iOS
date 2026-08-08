import { APIError } from "@/api/client";
import {
  allowsGameBridgeMessage,
  allowsInitialGameURL,
  decodeGameBridgeAction,
  decodeGameProfileMessage,
  decodeRewardedAdRequest,
  decodeRoundStartRequest,
  gameNavigationResolution,
  gameProfileDeepLink,
  gameRoundErrorCodes,
  GameProfileOpenGate,
  isGameSessionID,
  isGameProfileScheme,
  isRoundResumeTokenFailure,
  isSameOrigin,
  isULID,
  isUUIDv4,
  makeRoundResultJavaScript,
  RequestLedger,
  roundBridgeErrorCode,
  roundRequestAddress,
  strictInteger,
  userIDFromGameProfileURL,
} from "@/services/games/GameBridge";
import { gameLaunchPolicy, normalizeWebViewPolicy } from "@/services/web/WebViewPolicy";

const policy = gameLaunchPolicy(normalizeWebViewPolicy({ allowed_domains: ["id7.com"] }));
const initialURL = "https://games.id7.com/api/v1/game-assets/just-clear/index.html";
const uuid = "123e4567-e89b-42d3-a456-426614174000";
const sessionID = "session_Aa-123456789";
const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("game bridge protocol", () => {
  it("accepts only the exact profile version/source/user/deep-link contract", () => {
    const userID = "user:one";
    const body = {
      type: "bwchat.game.open_user_profile",
      version: 1,
      source: "just_clear",
      user_id: userID,
      deep_link: gameProfileDeepLink(userID),
    };
    expect(decodeGameProfileMessage(body).userID).toBe(userID);
    expect(() => decodeGameProfileMessage({ ...body, version: true })).toThrow("invalid_version");
    expect(() => decodeGameProfileMessage({ ...body, source: "Just_Clear" })).toThrow(
      "invalid_source",
    );
    expect(() =>
      decodeGameProfileMessage({ ...body, deep_link: "bwchat://profile/other" }),
    ).toThrow("invalid_deep_link");
  });

  it("round-trips strict percent-encoded profile fallback URLs", () => {
    expect(gameProfileDeepLink("user:one")).toBe("bwchat://profile/user%3Aone");
    expect(userIDFromGameProfileURL("bwchat://profile/user%3Aone")).toBe("user:one");
    expect(userIDFromGameProfileURL("bwchat://profile/user?x=1")).toBeUndefined();
    expect(userIDFromGameProfileURL("bwchat://profile/a/b")).toBeUndefined();
  });

  it("decodes UUIDv4 plus byte-preserved opaque session round requests", () => {
    const body = {
      type: "bwchat.game.request_round_start",
      version: 1,
      source: "just_clear",
      trigger: "tap.start",
      request_id: uuid.toUpperCase(),
      session_id: sessionID,
    };
    const request = decodeRoundStartRequest(body);
    expect(request.requestID).toBe(uuid);
    expect(request.sessionID).toBe(sessionID);
    expect(roundRequestAddress(request)).toBe(`${uuid}\u0000${sessionID}`);
    expect(() =>
      decodeRoundStartRequest({ ...body, session_id: sessionID.toLowerCase().slice(0, 15) }),
    ).toThrow("invalid_session_id");
  });

  it("rejects bool/fractional versions and validates UUID, session and ULID alphabets", () => {
    expect(strictInteger(true)).toBeUndefined();
    expect(strictInteger(1.2)).toBeUndefined();
    expect(strictInteger(1)).toBe(1);
    expect(strictInteger(10_000_000_000_000_000)).toBe(10_000_000_000_000_000);
    expect(isUUIDv4(uuid)).toBe(true);
    expect(isUUIDv4(uuid.replace("-4", "-5"))).toBe(false);
    expect(isGameSessionID(sessionID)).toBe(true);
    expect(isGameSessionID("bad/session-token")).toBe(false);
    expect(isULID(ulid.toLowerCase())).toBe(true);
    expect(isULID(`8${ulid.slice(1)}`)).toBe(false);
  });

  it("validates rewarded requests including SSV bounds and validation-only reward metadata", () => {
    const body = {
      type: "bwchat.game.show_rewarded_ad",
      version: 1,
      source: "just_clear",
      placement: "revive",
      request_id: uuid,
      session_id: ulid,
      ad_unit_id: "ca-app-pub-1877504503518465/1011630693",
      ssv_user_id: "user-1",
      ssv_custom_data: "signed-data",
      reward_item: "revive",
      reward_amount: 1,
    };
    expect(decodeRewardedAdRequest(body)).toMatchObject({ requestID: uuid, sessionID: ulid });
    expect(() => decodeRewardedAdRequest({ ...body, reward_amount: 0 })).toThrow(
      "invalid_reward_amount",
    );
    expect(() => decodeRewardedAdRequest({ ...body, ssv_custom_data: "x\u0000y" })).toThrow(
      "invalid_ssv_custom_data",
    );
    expect(
      decodeRewardedAdRequest({
        ...body,
        ssv_custom_data: "👨‍👩‍👧‍👦".repeat(2_048),
      }).ssvCustomData,
    ).toHaveLength("👨‍👩‍👧‍👦".length * 2_048);
    expect(decodeGameBridgeAction(body).kind).toBe("rewardedAd");
  });

  it("requires HTTPS, no credentials, an allowed host and the exact game-assets prefix", () => {
    expect(allowsInitialGameURL(initialURL, policy)).toBe(true);
    expect(allowsInitialGameURL("https://id7.com/api/v1/game-assets/../private", policy)).toBe(
      false,
    );
    expect(allowsInitialGameURL("http://id7.com/api/v1/game-assets/a", policy)).toBe(false);
    expect(allowsInitialGameURL("https://user:pass@id7.com/api/v1/game-assets/a", policy)).toBe(
      false,
    );
    expect(allowsInitialGameURL("https://evil.test/api/v1/game-assets/a", policy)).toBe(false);
  });

  it("compares scheme, host and effective ports for same origin", () => {
    expect(isSameOrigin("https://ID7.com/a", "https://id7.com:443/b")).toBe(true);
    expect(isSameOrigin("https://id7.com:444/a", "https://id7.com/b")).toBe(false);
    expect(isSameOrigin("http://id7.com/a", "https://id7.com/a")).toBe(false);
  });

  it("rejects subframes and validates current, frame and initial game URLs independently", () => {
    const trusted = {
      currentURL: initialURL,
      frameURL: initialURL,
      initialURL,
      requiresHTTPS: true,
      policy,
    };
    expect(allowsGameBridgeMessage({ ...trusted, isMainFrame: true })).toBe(true);
    expect(allowsGameBridgeMessage({ ...trusted, isMainFrame: false })).toBe(false);
    expect(
      allowsGameBridgeMessage({
        ...trusted,
        isMainFrame: true,
        frameURL: "https://id7.com/private",
      }),
    ).toBe(false);
  });

  it("allows only same-origin web navigation or the exact profile fallback route", () => {
    expect(
      gameNavigationResolution("https://games.id7.com/api/v1/game-assets/x", initialURL),
    ).toEqual({ kind: "allow" });
    expect(gameNavigationResolution("bwchat://profile/user_1", initialURL)).toEqual({
      kind: "profile",
      userID: "user_1",
    });
    expect(gameNavigationResolution("https://id7.com/api/v1/game-assets/x", initialURL)).toEqual({
      kind: "cancel",
    });
    expect(gameNavigationResolution("evil://profile/user_1", initialURL)).toEqual({
      kind: "cancel",
    });
    expect(isGameProfileScheme("bwchat://profile/user?x=1")).toBe(true);
    expect(isGameProfileScheme("evil://profile/user_1")).toBe(false);
  });

  it("debounces only repeated profile opens for 600ms", () => {
    const gate = new GameProfileOpenGate();
    expect(gate.shouldOpen("a", 1_000)).toBe(true);
    expect(gate.shouldOpen("a", 1_599)).toBe(false);
    expect(gate.shouldOpen("b", 1_200)).toBe(true);
    expect(gate.shouldOpen("a", 1_800)).toBe(true);
  });

  it("completes each ledger address exactly once", () => {
    const ledger = new RequestLedger();
    expect(ledger.begin("a")).toBe(true);
    expect(ledger.begin("a")).toBe(false);
    expect(ledger.complete("a")).toBe(true);
    expect(ledger.complete("a")).toBe(false);
    expect(ledger.begin("a")).toBe(false);
  });

  it("classifies server failures and serializes result data without executable interpolation", () => {
    expect(roundBridgeErrorCode(new APIError("x", 400, { code: "INSUFFICIENT_GOLD_COINS" }))).toBe(
      gameRoundErrorCodes.insufficientGoldCoins,
    );
    expect(
      isRoundResumeTokenFailure(new APIError("x", 400, { code: "GAME_ROUND_TOKEN_EXPIRED" })),
    ).toBe(true);
    const script = makeRoundResultJavaScript({
      request_id: uuid,
      session_id: sessionID,
      status: "failed",
      error_code: "</script><script>alert(1)</script>",
    });
    expect(script).not.toContain("</script>");
    expect(script).toContain("\\u003c/script>");
    expect(script).toContain("bwchat:round-start-result");
  });
});
