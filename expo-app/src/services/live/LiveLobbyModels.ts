import type {
  CallConnectionCredentials,
  CallType,
  LiveBillingPolicy,
  PropConsumptionResult,
} from "@/models";
import { env } from "@/config/env";
import { normalizeLiveExperienceSnapshot } from "@/services/live/LiveCallExperience";

export type { LiveBillingPolicy } from "@/models";

export const fallbackLiveBillingPolicy: LiveBillingPolicy = {
  currency: "spendable_balance",
  freeSeconds: 10,
  unitSeconds: 60,
  amountPerUnit: 100,
  minimumStartingBalance: 100,
  rounding: "started_unit",
};

export interface OneToOneLiveSlotUser {
  userId: string;
  username: string;
  nickname: string;
  avatarUrl: string;
  gender: string;
}

export interface OneToOneLiveSlot {
  id: string;
  status: string;
  characterSetting: string;
  liveAvatarUrl: string;
  allowedCallTypes?: CallType[] | undefined;
  createdAt?: string | undefined;
  user: OneToOneLiveSlotUser;
}

export interface OneToOneLiveSlotPage {
  items: OneToOneLiveSlot[];
  nextCursor?: string | undefined;
  billingPolicy: LiveBillingPolicy;
  supportedCallTypes: CallType[];
  liveAvatarUploadSupported: boolean;
}

export type LiveLobbyAvailability = "available" | "inviting" | "busy" | "unknown" | "ended";
export type LiveLobbyGender = "male" | "female" | "other" | "unspecified";

export interface LiveLobbyParticipant {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string;
  roleSetting: string;
  allowedCallTypes?: CallType[] | undefined;
  gender: LiveLobbyGender;
  availability: LiveLobbyAvailability;
  hasChatted: boolean;
  paletteIndex: number;
  isCurrentUser: boolean;
}

export interface LiveCallInvitationResponse {
  callId: string;
  expiresAt?: string | undefined;
  callType: CallType;
  billingPolicy?: LiveBillingPolicy | undefined;
  liveExperience?: Record<string, unknown> | undefined;
}

export interface AgentLiveMatchResponse {
  matchId: string;
  createdAt?: string | undefined;
}

export interface OneToOneLiveCallState extends LiveCallInvitationResponse {
  slotId?: string | undefined;
  status: string;
  phase: "pending" | "accepted" | "terminal";
  join?: CallConnectionCredentials | undefined;
  acceptedAt?: string | undefined;
  endReason?: string | undefined;
  endedAt?: string | undefined;
  terminationGraceMilliseconds?: number | undefined;
  finalBilling?: OneToOneLiveFinalBilling | undefined;
  serverTime?: string | undefined;
}

export interface OneToOneLiveFinalBilling {
  chargedUnits?: number | undefined;
  chargedActivityCatFood?: number | undefined;
  chargedGoldCoins?: number | undefined;
  totalCharged?: number | undefined;
  earnedActivityCatFood?: number | undefined;
  earnedGoldCoins?: number | undefined;
  goldCoinBalanceAfter?: number | undefined;
  activityCatFoodBalanceAfter?: number | undefined;
  spendableBalanceAfter?: number | undefined;
  billingStatus?: string | undefined;
  experienceSecondsUsed?: number | undefined;
  overageUnits?: number | undefined;
  consumedProp?: PropConsumptionResult | undefined;
}

export interface LiveLobbySlotEvent {
  eventId?: string | undefined;
  occurredAt?: number | undefined;
  slotId?: string | undefined;
  userId?: string | undefined;
  status?: string | undefined;
  slot: OneToOneLiveSlot | null;
}

export type LiveCurrentSlotResult =
  { kind: "value"; slot: OneToOneLiveSlot | null } | { kind: "unsupported" } | { kind: "failure" };

export interface LiveLobbyUpdateLock {
  current: boolean;
}

export function normalizeLiveSlotPage(value: unknown): OneToOneLiveSlotPage {
  const source = unwrapRecord(value);
  const types = normalizeCallTypes(source.supported_call_types ?? source.supportedCallTypes);
  return {
    items: arrayValue(source.items ?? source.slots)
      .map(normalizeLiveSlot)
      .filter(notNull),
    ...optionalString("nextCursor", source.next_cursor, source.nextCursor),
    billingPolicy: normalizeLiveBillingPolicy(source.billing_policy ?? source.billingPolicy),
    supportedCallTypes: types.length > 0 ? types : ["video"],
    liveAvatarUploadSupported:
      boolValue(source.live_avatar_upload_supported, source.liveAvatarUploadSupported) ?? false,
  };
}

export function normalizeCurrentLiveSlot(value: unknown): OneToOneLiveSlot | null {
  if (value === null || value === undefined) return null;
  const source = unwrapRecord(value);
  const candidate =
    source.slot ?? source.item ?? source.current_slot ?? source.currentSlot ?? source;
  return normalizeLiveSlot(candidate);
}

export function normalizeLiveSlot(value: unknown): OneToOneLiveSlot | null {
  if (!isRecord(value)) return null;
  const userSource = isRecord(value.user)
    ? value.user
    : isRecord(value.host)
      ? value.host
      : undefined;
  if (!userSource) return null;
  const userId = stringValue(userSource.user_id, userSource.userId, userSource.id) ?? "";
  return {
    id: stringValue(value.id, value.slot_id, value.slotId) ?? "",
    status: stringValue(value.status) ?? "waiting",
    characterSetting: stringValue(value.character_setting, value.characterSetting) ?? "",
    liveAvatarUrl: stringValue(value.live_avatar_url, value.liveAvatarUrl) ?? "",
    ...(arrayValue(value.allowed_call_types ?? value.allowedCallTypes).length > 0
      ? { allowedCallTypes: normalizeCallTypes(value.allowed_call_types ?? value.allowedCallTypes) }
      : {}),
    ...optionalString("createdAt", value.created_at, value.createdAt),
    user: {
      userId,
      username: stringValue(userSource.username) ?? "",
      nickname: stringValue(userSource.nickname) ?? "",
      avatarUrl: stringValue(userSource.avatar_url, userSource.avatarUrl) ?? "",
      gender: stringValue(userSource.gender) ?? "",
    },
  };
}

export function normalizeLiveBillingPolicy(value: unknown): LiveBillingPolicy {
  const source = isRecord(value) ? value : {};
  const currency = stringValue(source.currency) ?? fallbackLiveBillingPolicy.currency;
  const freeSeconds = Math.max(
    0,
    intValue(source.free_seconds, source.freeSeconds) ?? fallbackLiveBillingPolicy.freeSeconds,
  );
  const unit =
    intValue(source.unit_seconds, source.unitSeconds) ?? fallbackLiveBillingPolicy.unitSeconds;
  const amount =
    intValue(source.amount_per_unit, source.amountPerUnit) ??
    fallbackLiveBillingPolicy.amountPerUnit;
  const minimum =
    intValue(source.minimum_starting_balance, source.minimumStartingBalance) ??
    fallbackLiveBillingPolicy.minimumStartingBalance;
  return {
    currency,
    freeSeconds,
    unitSeconds: unit > 0 ? unit : fallbackLiveBillingPolicy.unitSeconds,
    amountPerUnit: amount > 0 ? amount : fallbackLiveBillingPolicy.amountPerUnit,
    minimumStartingBalance:
      minimum > 0 ? minimum : amount > 0 ? amount : fallbackLiveBillingPolicy.amountPerUnit,
    rounding: stringValue(source.rounding) ?? fallbackLiveBillingPolicy.rounding,
  };
}

export function normalizeLiveCallInvitation(value: unknown): LiveCallInvitationResponse {
  const source = unwrapRecord(value);
  const experience = normalizeLiveExperienceSnapshot(
    source.live_experience ?? source.liveExperience ?? source.experience,
  );
  return {
    callId: stringValue(source.call_id, source.callId, source.id) ?? "",
    ...optionalString("expiresAt", source.expires_at, source.expiresAt),
    callType: normalizeCallType(source.call_type ?? source.callType) ?? "video",
    ...(source.billing_policy !== undefined || source.billingPolicy !== undefined
      ? { billingPolicy: normalizeLiveBillingPolicy(source.billing_policy ?? source.billingPolicy) }
      : {}),
    ...(experience ? { liveExperience: { ...experience } } : {}),
  };
}

export function normalizeAgentLiveMatchResponse(value: unknown): AgentLiveMatchResponse {
  const source = unwrapRecord(value);
  const matchId = stringValue(source.match_id, source.matchId);
  if (!matchId) throw new Error("Agent live match response is invalid");
  return {
    matchId,
    ...optionalString("createdAt", source.created_at, source.createdAt),
  };
}

export function normalizeLiveCallState(value: unknown): OneToOneLiveCallState {
  const source = unwrapRecord(value);
  const invitation = normalizeLiveCallInvitation(source);
  const status = normalizeToken(stringValue(source.status, source.state) ?? "pending");
  const serverTime = stringValue(source.server_time, source.serverTime);
  const liveExperience = invitation.liveExperience
    ? {
        ...invitation.liveExperience,
        ...(serverTime &&
        invitation.liveExperience.server_time === undefined &&
        invitation.liveExperience.serverTime === undefined
          ? { server_time: serverTime }
          : {}),
      }
    : undefined;
  const finalCandidate = source.final_billing ?? source.finalBilling;
  const finalSource = isRecord(finalCandidate) ? finalCandidate : undefined;
  const finalBilling = finalSource ? normalizeFinalBilling(finalSource) : undefined;
  return {
    ...invitation,
    ...(liveExperience ? { liveExperience } : {}),
    ...optionalString("slotId", source.slot_id, source.slotId),
    status,
    phase: ["accepted", "in_call"].includes(status)
      ? "accepted"
      : ["rejected", "cancelled", "canceled", "expired", "ended"].includes(status)
        ? "terminal"
        : "pending",
    ...(isRecord(source.join) ? { join: normalizeCallJoin(source.join) } : {}),
    ...optionalString("acceptedAt", source.accepted_at, source.acceptedAt),
    ...optionalString("endReason", source.end_reason, source.endReason),
    ...optionalString("endedAt", source.ended_at, source.endedAt),
    ...optionalInt(
      "terminationGraceMilliseconds",
      source.termination_grace_ms,
      source.terminationGraceMilliseconds,
    ),
    ...(finalBilling ? { finalBilling } : {}),
    ...(serverTime ? { serverTime } : {}),
  };
}

export function normalizeCallJoin(value: unknown): CallConnectionCredentials {
  const source = unwrapRecord(value);
  const roomName = stringValue(source.room_name, source.roomName) ?? "";
  const token = stringValue(source.token) ?? "";
  const livekitUrl =
    stringValue(source.livekit_url, source.livekitUrl, source.server_url, source.serverUrl) ??
    env.liveKitUrl;
  const liveExperience = normalizeLiveExperienceSnapshot(
    source.live_experience ?? source.liveExperience ?? source.experience,
    stringValue(source.server_time, source.serverTime),
  );
  if (!roomName || !token) throw new Error("Live call join payload is invalid");
  return {
    ...optionalString("call_id", source.call_id, source.callId),
    room_name: roomName,
    token,
    livekit_url: livekitUrl,
    ...(normalizeCallType(source.call_type ?? source.callType)
      ? { call_type: normalizeCallType(source.call_type ?? source.callType) }
      : {}),
    ...(isRecord(source.billing_policy ?? source.billingPolicy)
      ? {
          billing_policy: normalizeLiveBillingPolicy(source.billing_policy ?? source.billingPolicy),
        }
      : {}),
    ...(liveExperience ? { live_experience: liveExperience } : {}),
  };
}

export function liveAvailability(status: string): LiveLobbyAvailability {
  switch (normalizeToken(status)) {
    case "waiting":
    case "available":
    case "idle":
      return "available";
    case "inviting":
    case "pending":
      return "inviting";
    case "connecting":
    case "accepted":
    case "in_call":
    case "busy":
      return "busy";
    case "ended":
    case "closed":
    case "cancelled":
    case "canceled":
      return "ended";
    default:
      return "unknown";
  }
}

export function isVisibleLiveSlot(slot: OneToOneLiveSlot): boolean {
  return Boolean(slot.id && slot.user.userId && liveAvailability(slot.status) !== "ended");
}

export function sortLiveSlots(slots: OneToOneLiveSlot[]): OneToOneLiveSlot[] {
  const rank: Record<LiveLobbyAvailability, number> = {
    available: 0,
    inviting: 1,
    unknown: 1,
    busy: 2,
    ended: 3,
  };
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((left, right) => {
      const difference =
        rank[liveAvailability(left.slot.status)] - rank[liveAvailability(right.slot.status)];
      return difference || left.index - right.index;
    })
    .map(({ slot }) => slot);
}

export function mergeLiveSlotSnapshot(
  snapshot: OneToOneLiveSlot[],
  current: OneToOneLiveSlot[],
  slotMutationSequence: ReadonlyMap<string, number>,
  requestStartingMutation: number,
): OneToOneLiveSlot[] {
  const newer = new Set(
    [...slotMutationSequence].flatMap(([id, sequence]) =>
      sequence > requestStartingMutation ? [id] : [],
    ),
  );
  const merged = snapshot.filter((slot) => isVisibleLiveSlot(slot) && !newer.has(slot.id));
  for (const slot of current.filter((item) => newer.has(item.id))) {
    const index = merged.findIndex(
      (item) => item.id === slot.id || item.user.userId === slot.user.userId,
    );
    if (index >= 0) merged.splice(index, 1);
    merged.push(slot);
  }
  const ids = new Set<string>();
  const users = new Set<string>();
  return sortLiveSlots(
    merged.filter((slot) => {
      if (ids.has(slot.id) || users.has(slot.user.userId)) return false;
      ids.add(slot.id);
      users.add(slot.user.userId);
      return true;
    }),
  );
}

export function normalizeLiveLobbySlotEvent(value: unknown): LiveLobbySlotEvent {
  const data = isRecord(value) ? value : {};
  const nestedSlot = isRecord(data.slot) ? data.slot : undefined;
  const slotSource: Record<string, unknown> = { ...(nestedSlot ?? data) };
  if (slotSource.id === undefined) {
    const rootSlotId = stringValue(data.slot_id, data.slotId);
    if (rootSlotId) slotSource.id = rootSlotId;
  }
  const slot = normalizeLiveSlot(slotSource);
  const nestedUser = isRecord(slotSource.user)
    ? slotSource.user
    : isRecord(slotSource.host)
      ? slotSource.host
      : isRecord(data.user)
        ? data.user
        : isRecord(data.host)
          ? data.host
          : undefined;
  const occurredAtText = stringValue(data.occurred_at, data.updated_at);
  const occurredAt = occurredAtText ? Date.parse(occurredAtText) : Number.NaN;
  const slotId = stringValue(slotSource.id, slotSource.slot_id, data.slot_id, slot?.id);
  const userId = stringValue(
    slot?.user.userId,
    nestedUser?.user_id,
    nestedUser?.id,
    slotSource.user_id,
    slotSource.host_user_id,
    slotSource.host_id,
    data.user_id,
    data.host_user_id,
    data.host_id,
  );
  const status = stringValue(
    slotSource.status,
    slotSource.slot_status,
    data.status,
    data.slot_status,
    slot?.status,
  )?.toLocaleLowerCase();
  return {
    ...optionalString("eventId", data.event_id),
    ...(Number.isFinite(occurredAt) ? { occurredAt } : {}),
    ...(slotId ? { slotId } : {}),
    ...(userId ? { userId } : {}),
    ...(status ? { status } : {}),
    slot,
  };
}

export class LiveLobbyEventCursor {
  private readonly latestOccurredAtBySlot = new Map<string, number>();
  private readonly processedEventIds = new Set<string>();
  private readonly processedEventOrder: string[] = [];

  shouldApply(event: LiveLobbySlotEvent): boolean {
    if (event.eventId && this.processedEventIds.has(event.eventId)) return false;
    if (event.slotId && event.occurredAt !== undefined) {
      const latest = this.latestOccurredAtBySlot.get(event.slotId);
      if (latest !== undefined && event.occurredAt < latest) {
        this.remember(event.eventId);
        return false;
      }
      this.latestOccurredAtBySlot.set(event.slotId, event.occurredAt);
    }
    this.remember(event.eventId);
    return true;
  }

  reset(): void {
    this.latestOccurredAtBySlot.clear();
    this.processedEventIds.clear();
    this.processedEventOrder.splice(0);
  }

  private remember(eventId: string | undefined): void {
    if (!eventId || this.processedEventIds.has(eventId)) return;
    this.processedEventIds.add(eventId);
    this.processedEventOrder.push(eventId);
    if (this.processedEventOrder.length > 256) {
      const removed = this.processedEventOrder.shift();
      if (removed) this.processedEventIds.delete(removed);
    }
  }
}

export function reconcileCurrentLiveSlot(
  result: LiveCurrentSlotResult,
  previous: OneToOneLiveSlot | null,
  fallbackSlots: readonly OneToOneLiveSlot[],
  ownerId: string,
): OneToOneLiveSlot | null {
  if (result.kind === "value") {
    return result.slot && isVisibleLiveSlot(result.slot) ? result.slot : null;
  }
  const fallback = fallbackSlots.find(
    (slot) => slot.user.userId === ownerId && isVisibleLiveSlot(slot),
  );
  if (result.kind === "failure") return previous ?? fallback ?? null;
  return fallback ?? previous;
}

export function acquireLiveLobbyUpdate(lock: LiveLobbyUpdateLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseLiveLobbyUpdate(lock: LiveLobbyUpdateLock): void {
  lock.current = false;
}

export function liveParticipant(
  slot: OneToOneLiveSlot,
  ownerId: string,
  hasChatted: boolean,
): LiveLobbyParticipant {
  const displayName =
    [slot.user.nickname, slot.user.username, slot.user.userId]
      .map((value) => value.trim())
      .find(Boolean) ?? slot.user.userId;
  return {
    id: slot.id,
    userId: slot.user.userId,
    displayName,
    avatarUrl: slot.liveAvatarUrl.trim() || slot.user.avatarUrl,
    roleSetting: slot.characterSetting,
    ...(slot.allowedCallTypes ? { allowedCallTypes: slot.allowedCallTypes } : {}),
    gender: liveGender(slot.user.gender),
    availability: liveAvailability(slot.status),
    hasChatted,
    paletteIndex: [...slot.user.userId].reduce(
      (sum, character) => sum + (character.codePointAt(0) ?? 0),
      0,
    ),
    isCurrentUser: slot.user.userId === ownerId,
  };
}

export function effectiveLiveCallTypes(
  globalTypes: CallType[],
  hostTypes?: CallType[],
): CallType[] {
  return (["voice", "video"] as CallType[]).filter(
    (type) => globalTypes.includes(type) && (hostTypes?.includes(type) ?? true),
  );
}

export function liveGender(value: string): LiveLobbyGender {
  switch (normalizeToken(value)) {
    case "male":
    case "man":
    case "m":
    case "男":
      return "male";
    case "female":
    case "woman":
    case "f":
    case "女":
      return "female";
    case "other":
    case "non_binary":
      return "other";
    default:
      return "unspecified";
  }
}

export function liveBillingFullRule(policy: LiveBillingPolicy): string {
  return policy.unitSeconds === 60
    ? `前 ${policy.freeSeconds} 秒免费，之后每开始 1 分钟收取 ${policy.amountPerUnit} 可消费余额`
    : `前 ${policy.freeSeconds} 秒免费，之后每开始 ${policy.unitSeconds} 秒收取 ${policy.amountPerUnit} 可消费余额`;
}

export function normalizeCallTypes(value: unknown): CallType[] {
  const raw = Array.isArray(value) ? value : [];
  return (["voice", "video"] as CallType[]).filter((type) =>
    raw.some((item) => normalizeCallType(item) === type),
  );
}

function normalizeCallType(value: unknown): CallType | undefined {
  const type = normalizeToken(stringValue(value) ?? "");
  if (type === "voice" || type === "audio") return "voice";
  if (["video", "audio_video", "audiovideo"].includes(type)) return "video";
  return undefined;
}
function normalizeToken(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll("-", "_");
}
function unwrapRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Live payload is invalid");
  if (isRecord(value.data)) return unwrapRecord(value.data);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}
function intValue(...values: unknown[]): number | undefined {
  const value = stringValue(...values);
  if (value === undefined) return undefined;
  const number = Number(value.replaceAll(",", ""));
  return Number.isFinite(number) ? Math.trunc(number) : undefined;
}
function boolValue(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isInteger(value)) return value !== 0;
    if (typeof value === "string") {
      const normalized = value.toLocaleLowerCase();
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
    }
  }
  return undefined;
}
function optionalString<Key extends string>(
  key: Key,
  ...values: unknown[]
): Partial<Record<Key, string>> {
  const value = stringValue(...values);
  return value ? ({ [key]: value } as Partial<Record<Key, string>>) : {};
}
function optionalInt<Key extends string>(
  key: Key,
  ...values: unknown[]
): Partial<Record<Key, number>> {
  const value = intValue(...values);
  return value !== undefined ? ({ [key]: value } as Partial<Record<Key, number>>) : {};
}
function normalizeFinalBilling(source: Record<string, unknown>): OneToOneLiveFinalBilling {
  const result: OneToOneLiveFinalBilling = {
    ...optionalInt("chargedUnits", source.charged_units, source.chargedUnits),
    ...optionalInt(
      "chargedActivityCatFood",
      source.charged_activity_cat_food,
      source.chargedActivityCatFood,
    ),
    ...optionalInt("chargedGoldCoins", source.charged_gold_coins, source.chargedGoldCoins),
    ...optionalInt("totalCharged", source.total_charged, source.totalCharged),
    ...optionalInt(
      "earnedActivityCatFood",
      source.earned_activity_cat_food,
      source.earnedActivityCatFood,
    ),
    ...optionalInt("earnedGoldCoins", source.earned_gold_coins, source.earnedGoldCoins),
    ...optionalInt(
      "goldCoinBalanceAfter",
      source.gold_coin_balance_after,
      source.goldCoinBalanceAfter,
    ),
    ...optionalInt(
      "activityCatFoodBalanceAfter",
      source.activity_cat_food_balance_after,
      source.activityCatFoodBalanceAfter,
    ),
    ...optionalInt(
      "spendableBalanceAfter",
      source.spendable_balance_after,
      source.spendableBalanceAfter,
    ),
    ...optionalString("billingStatus", source.billing_status, source.billingStatus),
    ...optionalInt(
      "experienceSecondsUsed",
      source.experience_seconds_used,
      source.experienceSecondsUsed,
    ),
    ...optionalInt("overageUnits", source.overage_units, source.overageUnits),
    ...(isRecord(source.consumed_prop ?? source.consumedProp)
      ? { consumedProp: normalizePropConsumption(source.consumed_prop ?? source.consumedProp) }
      : {}),
  };
  const nonNegativeValues = [
    result.chargedUnits,
    result.chargedActivityCatFood,
    result.chargedGoldCoins,
    result.totalCharged,
    result.earnedActivityCatFood,
    result.earnedGoldCoins,
    result.goldCoinBalanceAfter,
    result.activityCatFoodBalanceAfter,
    result.spendableBalanceAfter,
  ].filter((item): item is number => item !== undefined);
  if (nonNegativeValues.some((item) => item < 0)) {
    throw new Error("Live billing amounts and balances must be non-negative");
  }
  if (
    result.chargedActivityCatFood !== undefined &&
    result.chargedGoldCoins !== undefined &&
    result.totalCharged !== undefined &&
    result.totalCharged !== result.chargedActivityCatFood + result.chargedGoldCoins
  ) {
    throw new Error("Live total_charged must equal both charged asset amounts");
  }
  return result;
}
function normalizePropConsumption(value: unknown): PropConsumptionResult {
  if (!isRecord(value)) throw new Error("Live consumed_prop is invalid");
  const definitionId = stringValue(value.definition_id, value.definitionId);
  const remainingQuantity = intValue(value.remaining_quantity, value.remainingQuantity);
  if (!definitionId || remainingQuantity === undefined) {
    throw new Error("Live consumed_prop is invalid");
  }
  const inventoryId = stringValue(value.inventory_id, value.inventoryId);
  return {
    ...(inventoryId ? { inventory_id: inventoryId } : {}),
    definition_id: definitionId,
    remaining_quantity: remainingQuantity,
  };
}
function notNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
