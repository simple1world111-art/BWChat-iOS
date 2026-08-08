import AsyncStorage from "@react-native-async-storage/async-storage";

import { apiRequest, APIError } from "@/api/client";
import {
  ActivityResponseDecodingError,
  activityIdempotencyKey,
  activityInviteToken,
  activityPhoneHash,
  claimActivityCheckIn,
  claimActivityMeal,
  clearActivityIdempotencyKey,
  completeActivityInviteShareSession,
  createActivityContactDiscoverySession,
  createActivityInviteShareSession,
  createActivityPhoneVerificationSession,
  getActivityCenter,
  isAmbiguousActivityError,
  loadCachedActivitySnapshot,
  matchActivityContacts,
  normalizeActivityPhone,
  redeemActivityInvite,
  saveCachedActivitySnapshot,
  sendActivityFriendRequest,
  spinActivityWheel,
  validActivityInviteToken,
  verifyActivityPhone,
} from "@/services/activity/ActivityCenterRepository";
import { normalizeActivityCenterSnapshot } from "@/services/activity/ActivityModels";
import { activitySnapshotWire } from "./fixtures/activityCenterFixture";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, apiRequest: jest.fn() };
});

jest.mock("expo-crypto", () => {
  const { createHash } = jest.requireActual<typeof import("node:crypto")>("node:crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { HEX: "hex" },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash("sha256").update(value).digest("hex"),
  };
});

const request = jest.mocked(apiRequest);

describe("ActivityCenter repository", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("uses every exact native route, request field, escaped component, and idempotency header", async () => {
    request
      .mockResolvedValueOnce(activitySnapshotWire)
      .mockResolvedValueOnce({ granted_activity_cat_food: 20, snapshot: activitySnapshotWire })
      .mockResolvedValueOnce({ granted_activity_cat_food: 15, snapshot: activitySnapshotWire })
      .mockResolvedValueOnce({
        result: {
          spin_id: "spin",
          tier_id: "tier/10",
          cost_gold_coins: 10,
          prize_id: "p20",
          payout_gold_coins: 20,
          net_delta_gold_coins: 10,
          next_tier_id: "tier100",
        },
        snapshot: activitySnapshotWire,
      })
      .mockResolvedValueOnce({
        session_id: "contacts",
        salt: "salt",
        salt_version: "v1",
        default_region: "JP",
        max_contacts: 100,
        expires_at: "later",
      })
      .mockResolvedValueOnce({
        matches: [],
        granted_activity_cat_food: 0,
        snapshot: activitySnapshotWire,
      })
      .mockResolvedValueOnce({
        session_id: "share/1",
        share_url: "https://example.com/i/t",
        invite_code: "MEOW88",
        message: "Join",
        expires_at: "later",
      })
      .mockResolvedValueOnce({ granted_activity_cat_food: 10, snapshot: activitySnapshotWire })
      .mockResolvedValueOnce(activitySnapshotWire)
      .mockResolvedValueOnce({
        session_id: "phone/1",
        expires_at: "later",
        retry_after_seconds: 30,
      })
      .mockResolvedValueOnce(activitySnapshotWire)
      .mockResolvedValueOnce({});

    await getActivityCenter();
    await claimActivityCheckIn("check-key");
    await claimActivityMeal("lunch/1", "meal-key");
    await spinActivityWheel("cfg", "tier/10", "spin-key");
    await createActivityContactDiscoverySession();
    await matchActivityContacts("contacts/a", "v1", ["hash"], "contacts-key");
    await createActivityInviteShareSession();
    await completeActivityInviteShareSession("share/1", "share-key");
    await redeemActivityInvite("token", "redeem-key");
    await createActivityPhoneVerificationSession("+819012345678");
    await verifyActivityPhone("phone/1", "123456", "phone-key");
    await sendActivityFriendRequest("user/1");

    expect(request).toHaveBeenNthCalledWith(1, "/activity-center", {
      cache: "no-store",
      requiredData: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/activity-center/check-in/claim", {
      method: "POST",
      headers: { "Idempotency-Key": "check-key" },
      body: {},
      requiredData: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(3, "/activity-center/meals/lunch%2F1/claim", {
      method: "POST",
      headers: { "Idempotency-Key": "meal-key" },
      body: {},
      requiredData: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(4, "/activity-center/wheel/spins", {
      method: "POST",
      headers: { "Idempotency-Key": "spin-key" },
      body: { expected_config_version: "cfg", tier_id: "tier/10" },
      requiredData: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(5, "/activity-center/contact-discovery/sessions", {
      method: "POST",
      headers: { "Cache-Control": "no-store" },
      body: {},
      cache: "no-store",
      requiredData: true,
    });
    expect(request).toHaveBeenNthCalledWith(
      6,
      "/activity-center/contact-discovery/sessions/contacts%2Fa/match",
      {
        method: "POST",
        headers: { "Idempotency-Key": "contacts-key", "Cache-Control": "no-store" },
        body: { salt_version: "v1", phone_hashes: ["hash"] },
        cache: "no-store",
        requiredData: true,
        transientRetries: false,
      },
    );
    expect(request).toHaveBeenNthCalledWith(7, "/activity-center/invite-share-sessions", {
      method: "POST",
      headers: { "Cache-Control": "no-store" },
      body: {},
      cache: "no-store",
      requiredData: true,
    });
    expect(request).toHaveBeenNthCalledWith(
      8,
      "/activity-center/invite-share-sessions/share%2F1/complete",
      {
        method: "POST",
        headers: { "Idempotency-Key": "share-key", "Cache-Control": "no-store" },
        body: {},
        cache: "no-store",
        requiredData: true,
        transientRetries: false,
      },
    );
    expect(request).toHaveBeenNthCalledWith(9, "/activity-center/invites/redeem", {
      method: "POST",
      headers: { "Idempotency-Key": "redeem-key", "Cache-Control": "no-store" },
      body: { code_or_token: "token" },
      cache: "no-store",
      requiredData: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(10, "/account/phone/verification-sessions", {
      method: "POST",
      headers: { "Cache-Control": "no-store" },
      body: { phone_e164: "+819012345678" },
      cache: "no-store",
      requiredData: true,
    });
    expect(request).toHaveBeenNthCalledWith(11, "/account/phone/verify", {
      method: "POST",
      headers: { "Idempotency-Key": "phone-key", "Cache-Control": "no-store" },
      body: { session_id: "phone/1", code: "123456" },
      cache: "no-store",
      requiredData: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(12, "/friends/request", {
      method: "POST",
      body: { target_user_id: "user/1" },
    });
  });

  it("keeps account caches isolated and redacts the sensitive share URL", async () => {
    const snapshot = normalizeActivityCenterSnapshot(activitySnapshotWire);
    await saveCachedActivitySnapshot("owner/a", snapshot);
    expect(await loadCachedActivitySnapshot("owner/a")).toMatchObject({
      invitation: { inviteCode: "MEOW88", shareURL: "" },
    });
    expect(await loadCachedActivitySnapshot("owner/b")).toBeUndefined();
  });

  it("persists one idempotency UUID per account/operation until explicitly cleared", async () => {
    const first = await activityIdempotencyKey("owner", "meal.lunch");
    expect(await activityIdempotencyKey("owner", "meal.lunch")).toBe(first);
    expect(await activityIdempotencyKey("owner-2", "meal.lunch")).not.toBe(first);
    await clearActivityIdempotencyKey("owner", "meal.lunch");
    expect(await activityIdempotencyKey("owner", "meal.lunch")).not.toBe(first);
  });

  it("replaces structurally invalid retained UUIDs instead of sending them to the backend", async () => {
    const malformed = "12345678-1234a4234-8234-123456789ab-";
    await AsyncStorage.setItem("bbchat.activity-center.idempotency.owner.check-in", malformed);
    const replacement = await activityIdempotencyKey("owner", "check-in");
    expect(replacement).not.toBe(malformed);
    expect(replacement).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  });

  it("serializes cache writes so a slower old snapshot cannot overwrite a newer one", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const setItem = jest
      .spyOn(AsyncStorage, "setItem")
      .mockImplementationOnce(async () => firstWrite)
      .mockResolvedValue(undefined);
    setItem.mockClear();
    const oldSnapshot = normalizeActivityCenterSnapshot(activitySnapshotWire);
    const newSnapshot = normalizeActivityCenterSnapshot({
      ...activitySnapshotWire,
      activity_cat_food_balance: 999,
    });

    const oldWrite = saveCachedActivitySnapshot("owner", oldSnapshot);
    await Promise.resolve();
    const newWrite = saveCachedActivitySnapshot("owner", newSnapshot);
    await Promise.resolve();
    expect(setItem).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await Promise.all([oldWrite, newWrite]);

    expect(setItem).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(setItem.mock.calls[1]?.[1]))).toMatchObject({
      activity_cat_food_balance: 999,
    });
    setItem.mockRestore();
  });

  it("treats a malformed successful mutation response as confirmation-ambiguous", async () => {
    request.mockResolvedValueOnce({ granted_activity_cat_food: 20 });
    const failure = await claimActivityCheckIn("retained-key").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ActivityResponseDecodingError);
    expect(isAmbiguousActivityError(failure)).toBe(true);
  });

  it("classifies transport, timeout, 5xx and malformed 2xx outcomes as confirmation-ambiguous", () => {
    expect(isAmbiguousActivityError(new APIError("offline", 0))).toBe(true);
    expect(isAmbiguousActivityError(new APIError("timeout", 408))).toBe(true);
    expect(isAmbiguousActivityError(new APIError("server timeout", 408, {}))).toBe(false);
    expect(isAmbiguousActivityError(new APIError("server", 503))).toBe(true);
    expect(isAmbiguousActivityError(new APIError("envelope server", 200, undefined, 503))).toBe(
      true,
    );
    expect(isAmbiguousActivityError(new APIError("envelope server", 200, undefined, "503"))).toBe(
      true,
    );
    expect(isAmbiguousActivityError(new APIError("empty successful body", 204, null))).toBe(true);
    expect(isAmbiguousActivityError(new APIError("envelope bad", 200, undefined, 400))).toBe(false);
    expect(isAmbiguousActivityError(new APIError("bad", 400))).toBe(false);
  });

  it("normalizes international/local phones and hashes salt-NUL-E164 without raw phone leakage", async () => {
    expect(normalizeActivityPhone("090-1234-5678", "JP")).toBe("+819012345678");
    expect(normalizeActivityPhone("+81 90 1234 5678", "US")).toBe("+819012345678");
    expect(() => normalizeActivityPhone("12", "JP")).toThrow("activityCenter.error.invalidPhone");
    expect(() => normalizeActivityPhone("100000000", "JP")).toThrow(
      "activityCenter.error.invalidPhone",
    );
    const digest = await activityPhoneHash("rotation-v1", "+819012345678");
    expect(digest).toBe("6f1af43767e0a0903637546111604caf0a8ab5b2792c319475258f74991087b5");
    expect(digest).not.toContain("819012345678");
  });

  it("accepts only the native invitation URL forms and token alphabet", () => {
    expect(activityInviteToken("bwchat://invite/abcDEF_123-xyz")).toBe("abcDEF_123-xyz");
    expect(activityInviteToken("https://invite.example.com/i/abcDEF_123-xyz")).toBe(
      "abcDEF_123-xyz",
    );
    expect(activityInviteToken("https://invite.example.com/I/abcDEF_123-xyz")).toBe(
      "abcDEF_123-xyz",
    );
    expect(activityInviteToken("https://invite.example.com/%69/%E6%B5%8B%E8%AF%95ABC123")).toBe(
      "测试ABC123",
    );
    expect(activityInviteToken("bwchat://group-invite/abcDEF_123-xyz")).toBeUndefined();
    expect(activityInviteToken("bwchat://invite/a%2Fb")).toBeUndefined();
    const astralLetter = "𐐀";
    expect(validActivityInviteToken(astralLetter.repeat(6))).toBe(astralLetter.repeat(6));
    expect(validActivityInviteToken(astralLetter.repeat(256))).toBe(astralLetter.repeat(256));
    expect(validActivityInviteToken(astralLetter.repeat(257))).toBeUndefined();
  });
});
