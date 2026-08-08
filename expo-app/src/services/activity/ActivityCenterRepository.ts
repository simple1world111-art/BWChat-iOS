import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Contacts from "expo-contacts/legacy";
import * as Crypto from "expo-crypto";
import { getLocales } from "expo-localization";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

import { apiRequest, APIError } from "@/api/client";
import { createIdempotencyKey } from "@/api/bwchat";
import {
  normalizeActivityCenterGrantResult,
  normalizeActivityCenterSnapshot,
  normalizeActivityContactDiscoverySession,
  normalizeActivityContactMatchResult,
  normalizeActivityInviteShareSession,
  normalizeActivityPhoneVerificationSession,
  normalizeActivityWheelSpinEnvelope,
  redactedActivitySnapshot,
  type ActivityCenterGrantResult,
  type ActivityCenterSnapshot,
  type ActivityContactDiscoverySession,
  type ActivityContactMatchResult,
  type ActivityInviteShareSession,
  type ActivityPhoneVerificationSession,
  type ActivityWheelSpinEnvelope,
} from "@/services/activity/ActivityModels";

const cachePrefix = "bbchat.activity-center.snapshot";
const idempotencyPrefix = "bbchat.activity-center.idempotency";
const cacheWriteQueues = new Map<string, Promise<void>>();
const idempotencyKeyQueues = new Map<string, Promise<string>>();

export class ActivityResponseDecodingError extends Error {
  constructor(readonly decodingCause: unknown) {
    super("api.decodingError");
    this.name = "ActivityResponseDecodingError";
  }
}

export async function getActivityCenter(): Promise<ActivityCenterSnapshot> {
  return decodeActivityResponse(
    await apiRequest<unknown>("/activity-center", {
      cache: "no-store",
      requiredData: true,
    }),
    normalizeActivityCenterSnapshot,
  );
}

export async function claimActivityCheckIn(
  idempotencyKey: string,
): Promise<ActivityCenterGrantResult> {
  return decodeActivityResponse(
    await activityMutation("/activity-center/check-in/claim", {}, idempotencyKey),
    normalizeActivityCenterGrantResult,
  );
}

export async function claimActivityMeal(
  windowID: string,
  idempotencyKey: string,
): Promise<ActivityCenterGrantResult> {
  return decodeActivityResponse(
    await activityMutation(
      `/activity-center/meals/${encodeURIComponent(windowID)}/claim`,
      {},
      idempotencyKey,
    ),
    normalizeActivityCenterGrantResult,
  );
}

export async function spinActivityWheel(
  configVersion: string,
  tierID: string,
  idempotencyKey: string,
): Promise<ActivityWheelSpinEnvelope> {
  return decodeActivityResponse(
    await activityMutation(
      "/activity-center/wheel/spins",
      { expected_config_version: configVersion, tier_id: tierID },
      idempotencyKey,
    ),
    normalizeActivityWheelSpinEnvelope,
  );
}

export async function createActivityContactDiscoverySession(): Promise<ActivityContactDiscoverySession> {
  return decodeActivityResponse(
    await sensitiveActivityPost("/activity-center/contact-discovery/sessions", {}),
    normalizeActivityContactDiscoverySession,
  );
}

export async function matchActivityContacts(
  sessionID: string,
  saltVersion: string,
  phoneHashes: readonly string[],
  idempotencyKey: string,
): Promise<ActivityContactMatchResult> {
  return decodeActivityResponse(
    await activityMutation(
      `/activity-center/contact-discovery/sessions/${encodeURIComponent(sessionID)}/match`,
      { salt_version: saltVersion, phone_hashes: [...phoneHashes] },
      idempotencyKey,
      true,
    ),
    normalizeActivityContactMatchResult,
  );
}

export async function createActivityInviteShareSession(): Promise<ActivityInviteShareSession> {
  return decodeActivityResponse(
    await sensitiveActivityPost("/activity-center/invite-share-sessions", {}),
    normalizeActivityInviteShareSession,
  );
}

export async function completeActivityInviteShareSession(
  sessionID: string,
  idempotencyKey: string,
): Promise<ActivityCenterGrantResult> {
  return decodeActivityResponse(
    await activityMutation(
      `/activity-center/invite-share-sessions/${encodeURIComponent(sessionID)}/complete`,
      {},
      idempotencyKey,
      true,
    ),
    normalizeActivityCenterGrantResult,
  );
}

export async function redeemActivityInvite(
  codeOrToken: string,
  idempotencyKey: string,
): Promise<ActivityCenterSnapshot> {
  return decodeActivityResponse(
    await activityMutation(
      "/activity-center/invites/redeem",
      { code_or_token: codeOrToken },
      idempotencyKey,
      true,
    ),
    normalizeActivityCenterSnapshot,
  );
}

export async function createActivityPhoneVerificationSession(
  e164Phone: string,
): Promise<ActivityPhoneVerificationSession> {
  return decodeActivityResponse(
    await sensitiveActivityPost("/account/phone/verification-sessions", { phone_e164: e164Phone }),
    normalizeActivityPhoneVerificationSession,
  );
}

export async function verifyActivityPhone(
  sessionID: string,
  code: string,
  idempotencyKey: string,
): Promise<ActivityCenterSnapshot> {
  return decodeActivityResponse(
    await activityMutation(
      "/account/phone/verify",
      { session_id: sessionID, code },
      idempotencyKey,
      true,
    ),
    normalizeActivityCenterSnapshot,
  );
}

export async function sendActivityFriendRequest(targetUserID: string): Promise<void> {
  await apiRequest<unknown>("/friends/request", {
    method: "POST",
    body: { target_user_id: targetUserID },
  });
}

export async function loadCachedActivitySnapshot(
  ownerID: string,
): Promise<ActivityCenterSnapshot | undefined> {
  const raw = await AsyncStorage.getItem(activityCacheKey(ownerID));
  if (!raw) return undefined;
  try {
    return normalizeActivityCenterSnapshot(JSON.parse(raw) as unknown);
  } catch {
    await AsyncStorage.removeItem(activityCacheKey(ownerID));
    return undefined;
  }
}

export async function saveCachedActivitySnapshot(
  ownerID: string,
  snapshot: ActivityCenterSnapshot,
): Promise<void> {
  const key = activityCacheKey(ownerID);
  const serialized = JSON.stringify(activitySnapshotWire(redactedActivitySnapshot(snapshot)));
  const queued = (cacheWriteQueues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(key, serialized));
  cacheWriteQueues.set(key, queued);
  try {
    await queued;
  } finally {
    if (cacheWriteQueues.get(key) === queued) cacheWriteQueues.delete(key);
  }
}

export async function activityIdempotencyKey(ownerID: string, operation: string): Promise<string> {
  const key = activityOperationKey(ownerID, operation);
  const queued = (idempotencyKeyQueues.get(key) ?? Promise.resolve(""))
    .catch(() => "")
    .then(async () => {
      const existing = await AsyncStorage.getItem(key);
      if (existing && isActivityUUID(existing)) return existing;
      const created = createIdempotencyKey();
      await AsyncStorage.setItem(key, created);
      return created;
    });
  idempotencyKeyQueues.set(key, queued);
  try {
    return await queued;
  } finally {
    if (idempotencyKeyQueues.get(key) === queued) idempotencyKeyQueues.delete(key);
  }
}

export async function clearActivityIdempotencyKey(
  ownerID: string,
  operation: string,
): Promise<void> {
  await AsyncStorage.removeItem(activityOperationKey(ownerID, operation));
}

export function isAmbiguousActivityError(error: unknown): boolean {
  const responseCode = error instanceof APIError ? Number(error.code) : Number.NaN;
  return (
    error instanceof ActivityResponseDecodingError ||
    (error instanceof APIError &&
      (error.status === 0 ||
        (error.status === 408 && error.payload === undefined) ||
        error.status >= 500 ||
        responseCode >= 500 ||
        (error.status >= 200 && error.status < 300 && error.code == null)))
  );
}

export function normalizeActivityPhone(rawPhone: string, region?: string): string {
  const clean = rawPhone.trim();
  if (!clean) throw new Error("activityCenter.error.invalidPhone");
  const parsed = parsePhoneNumberFromString(clean, normalizedCountry(region));
  if (!parsed?.isValid()) throw new Error("activityCenter.error.invalidPhone");
  return parsed.number;
}

export async function activityPhoneHash(salt: string, e164: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}\u0000${e164}`, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

export async function activityContactPhoneHashes(
  session: ActivityContactDiscoverySession,
): Promise<string[]> {
  const permission = await Contacts.getPermissionsAsync();
  const resolvedPermission =
    permission.status === "undetermined" ? await Contacts.requestPermissionsAsync() : permission;
  if (resolvedPermission.status !== "granted")
    throw new Error("activityCenter.error.contactsDenied");

  const response = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
  const hashes = new Set<string>();
  const maxContacts = Math.max(0, session.maxContacts);
  outer: for (const contact of response.data) {
    for (const phone of contact.phoneNumbers ?? []) {
      if (hashes.size >= maxContacts) break outer;
      try {
        const e164 = normalizeActivityPhone(phone.number ?? "", session.defaultRegion);
        hashes.add(await activityPhoneHash(session.salt, e164));
      } catch {
        // Invalid local numbers are deliberately skipped, matching PhoneNumberKit.
      }
    }
  }
  return [...hashes].slice(0, maxContacts).sort();
}

export function activityInviteToken(value: string): string | undefined {
  try {
    const url = new URL(value);
    const components = decodedActivityPathComponents(url.pathname);
    if (!components) return undefined;
    let candidate: string | undefined;
    if (url.protocol.toLowerCase() === "bwchat:" && url.hostname.toLowerCase() === "invite") {
      candidate = components[0];
    } else if (url.protocol === "http:" || url.protocol === "https:") {
      const marker = components.findIndex(
        (component) => component.toLowerCase() === "i" || component.toLowerCase() === "invite",
      );
      if (marker >= 0) candidate = components[marker + 1];
    }
    return validActivityInviteToken(candidate);
  } catch {
    return undefined;
  }
}

function decodedActivityPathComponents(pathname: string): string[] | undefined {
  try {
    return pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return undefined;
  }
}

export function validActivityInviteToken(value: string | undefined): string | undefined {
  const clean = value?.trim();
  const characterCount = clean ? [...clean].length : 0;
  return clean && characterCount >= 6 && characterCount <= 256 && /^[\p{L}\p{N}._~-]+$/u.test(clean)
    ? clean
    : undefined;
}

function activityMutation(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
  sensitiveResponse = false,
): Promise<unknown> {
  return apiRequest<unknown>(path, {
    method: "POST",
    headers: {
      "Idempotency-Key": idempotencyKey,
      ...(sensitiveResponse ? { "Cache-Control": "no-store" } : {}),
    },
    body,
    requiredData: true,
    transientRetries: false,
    ...(sensitiveResponse ? { cache: "no-store" as const } : {}),
  });
}

function sensitiveActivityPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  return apiRequest<unknown>(path, {
    method: "POST",
    headers: { "Cache-Control": "no-store" },
    body,
    cache: "no-store",
    requiredData: true,
  });
}

function decodeActivityResponse<T>(input: unknown, normalize: (value: unknown) => T): T {
  try {
    return normalize(input);
  } catch (error) {
    throw new ActivityResponseDecodingError(error);
  }
}

function isActivityUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function activityCacheKey(ownerID: string): string {
  return `${cachePrefix}.${encodeURIComponent(ownerID)}`;
}

function activityOperationKey(ownerID: string, operation: string): string {
  return `${idempotencyPrefix}.${encodeURIComponent(ownerID)}.${operation}`;
}

function normalizedCountry(region?: string): CountryCode {
  const clean = region?.trim().toUpperCase();
  if (clean && /^[A-Z]{2}$/.test(clean)) return clean as CountryCode;
  const localeRegion = getLocales()[0]?.regionCode?.toUpperCase();
  return localeRegion && /^[A-Z]{2}$/.test(localeRegion) ? (localeRegion as CountryCode) : "US";
}

function activitySnapshotWire(snapshot: ActivityCenterSnapshot): Record<string, unknown> {
  return {
    config_version: snapshot.configVersion,
    server_time: snapshot.serverTime,
    business_timezone: snapshot.businessTimezone,
    activity_cat_food_balance: snapshot.activityCatFoodBalance,
    gold_coin_balance: snapshot.goldCoinBalance,
    phone_binding: {
      is_verified: snapshot.phoneBinding.isVerified,
      masked_phone: snapshot.phoneBinding.maskedPhone ?? null,
      default_region: snapshot.phoneBinding.defaultRegion ?? null,
    },
    check_in: {
      activity_id: snapshot.checkIn.activityID,
      claimed_days: snapshot.checkIn.claimedDays,
      completed: snapshot.checkIn.completed,
      can_claim: snapshot.checkIn.canClaim,
      days: snapshot.checkIn.days.map((day) => ({
        day: day.day,
        reward_activity_cat_food: day.rewardActivityCatFood,
        status: day.status,
      })),
    },
    meal_rewards: snapshot.mealRewards.map((meal) => ({
      window_id: meal.id,
      title_key: meal.titleKey ?? null,
      start_local: meal.startLocal,
      end_local: meal.endLocal,
      reward_activity_cat_food: meal.rewardActivityCatFood,
      status: meal.status,
      next_transition_at: meal.nextTransitionAt ?? null,
      claimed_at: meal.claimedAt ?? null,
    })),
    tasks: snapshot.tasks.map((task) => ({
      id: task.id,
      kind: task.kind,
      status: task.status,
      reward_activity_cat_food: task.rewardActivityCatFood,
      daily_limit: task.dailyLimit ?? null,
      completed_count: task.completedCount,
      credited_count: task.creditedCount,
    })),
    invitation: {
      invite_code: snapshot.invitation.inviteCode,
      share_url: snapshot.invitation.shareURL,
      pending_invites: snapshot.invitation.pendingInvites,
      credited_invites: snapshot.invitation.creditedInvites,
      can_redeem: snapshot.invitation.canRedeem,
    },
    wheel: {
      enabled: snapshot.wheel.enabled,
      currency: snapshot.wheel.currency,
      current_tier: snapshot.wheel.currentTier.id
        ? {
            id: snapshot.wheel.currentTier.id,
            sequence: snapshot.wheel.currentTier.sequence,
            cost_gold_coins: snapshot.wheel.currentTier.costGoldCoins,
            next_tier_id: snapshot.wheel.currentTier.nextTierID,
            segments: snapshot.wheel.currentTier.segments.map((segment) => ({
              id: segment.id,
              payout_gold_coins: segment.payoutGoldCoins,
              probability_ppm: segment.probabilityPPM,
              display_order: segment.displayOrder,
            })),
          }
        : null,
      recent_winners: snapshot.wheel.recentWinners.map((winner) => ({
        id: winner.id,
        display_name: winner.displayName,
        avatar_url: winner.avatarURL,
        payout_gold_coins: winner.payoutGoldCoins,
      })),
    },
  };
}
