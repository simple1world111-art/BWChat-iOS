export const activityClaimStatuses = [
  "locked",
  "available",
  "claimable",
  "claimed",
  "completed",
  "unavailable",
] as const;

export type ActivityClaimStatus = (typeof activityClaimStatuses)[number];
export type ActivityTaskKind = "contact_sync" | "invite_share" | "valid_invite";

export interface ActivityPhoneBindingState {
  isVerified: boolean;
  maskedPhone?: string;
  defaultRegion?: string;
}

export interface ActivityCheckInDay {
  day: number;
  rewardActivityCatFood: number;
  status: ActivityClaimStatus;
}

export interface ActivityCheckInState {
  activityID: string;
  claimedDays: number;
  completed: boolean;
  canClaim: boolean;
  days: ActivityCheckInDay[];
}

export interface ActivityMealReward {
  id: string;
  titleKey?: string;
  startLocal: string;
  endLocal: string;
  rewardActivityCatFood: number;
  status: ActivityClaimStatus;
  nextTransitionAt?: string;
  claimedAt?: string;
}

export interface ActivityCenterTask {
  id: string;
  kind: ActivityTaskKind;
  status: ActivityClaimStatus;
  rewardActivityCatFood: number;
  dailyLimit?: number;
  completedCount: number;
  creditedCount: number;
}

export interface ActivityInvitationState {
  inviteCode: string;
  shareURL: string;
  pendingInvites: number;
  creditedInvites: number;
  canRedeem: boolean;
}

export interface ActivityWheelSegment {
  id: string;
  payoutGoldCoins: number;
  probabilityPPM: number;
  displayOrder: number;
}

export interface ActivityWheelTier {
  id: string;
  sequence: number;
  costGoldCoins: number;
  nextTierID: string;
  segments: ActivityWheelSegment[];
}

export interface ActivityWheelWinner {
  id: string;
  displayName: string;
  avatarURL: string;
  payoutGoldCoins: number;
}

export interface ActivityWheelState {
  enabled: boolean;
  currency: string;
  currentTier: ActivityWheelTier;
  recentWinners: ActivityWheelWinner[];
}

export interface ActivityCenterSnapshot {
  configVersion: string;
  serverTime: string;
  businessTimezone: string;
  activityCatFoodBalance: number;
  goldCoinBalance: number;
  phoneBinding: ActivityPhoneBindingState;
  checkIn: ActivityCheckInState;
  mealRewards: ActivityMealReward[];
  tasks: ActivityCenterTask[];
  invitation: ActivityInvitationState;
  wheel: ActivityWheelState;
}

export interface ActivityCenterGrantResult {
  grantedActivityCatFood: number;
  snapshot: ActivityCenterSnapshot;
}

export interface ActivityWheelSpinResult {
  spinID: string;
  tierID: string;
  costGoldCoins: number;
  prizeID: string;
  payoutGoldCoins: number;
  netDeltaGoldCoins: number;
  nextTierID: string;
}

export interface ActivityWheelSpinEnvelope {
  result: ActivityWheelSpinResult;
  snapshot: ActivityCenterSnapshot;
}

export interface ActivityContactDiscoverySession {
  id: string;
  salt: string;
  saltVersion: string;
  defaultRegion: string;
  maxContacts: number;
  expiresAt: string;
}

export interface ActivityMatchedUser {
  userID: string;
  nickname: string;
  avatarURL: string;
  relation: string;
}

export interface ActivityContactMatchResult {
  matches: ActivityMatchedUser[];
  grantedActivityCatFood: number;
  snapshot: ActivityCenterSnapshot;
}

export interface ActivityInviteShareSession {
  id: string;
  shareURL: string;
  inviteCode: string;
  message: string;
  expiresAt: string;
}

export interface ActivityPhoneVerificationSession {
  id: string;
  expiresAt: string;
  retryAfterSeconds: number;
}

export const unavailableActivityWheelTier: ActivityWheelTier = {
  id: "",
  sequence: 0,
  costGoldCoins: 0,
  nextTierID: "",
  segments: [],
};

export const unavailableActivityWheel: ActivityWheelState = {
  enabled: false,
  currency: "gold_coin",
  currentTier: unavailableActivityWheelTier,
  recentWinners: [],
};

export function normalizeActivityCenterSnapshot(input: unknown): ActivityCenterSnapshot {
  const value = unwrapData(input);
  const record = requiredRecord(value, "activity center snapshot");
  return {
    configVersion: optionalString(record.config_version) ?? "",
    serverTime: requiredString(record.server_time, "server_time"),
    businessTimezone: requiredString(record.business_timezone, "business_timezone"),
    activityCatFoodBalance: requiredInteger(
      record.activity_cat_food_balance,
      "activity_cat_food_balance",
    ),
    goldCoinBalance: requiredInteger(record.gold_coin_balance, "gold_coin_balance"),
    phoneBinding:
      record.phone_binding == null
        ? { isVerified: false }
        : normalizePhoneBinding(record.phone_binding),
    checkIn:
      record.check_in == null
        ? { activityID: "", claimedDays: 0, completed: false, canClaim: false, days: [] }
        : normalizeCheckIn(record.check_in),
    mealRewards: optionalArray(record.meal_rewards).map(normalizeMeal),
    tasks: optionalArray(record.tasks).map(normalizeTask),
    invitation:
      record.invitation == null
        ? { inviteCode: "", shareURL: "", pendingInvites: 0, creditedInvites: 0, canRedeem: false }
        : normalizeInvitation(record.invitation),
    wheel: record.wheel == null ? unavailableActivityWheel : normalizeWheel(record.wheel),
  };
}

export function normalizeActivityCenterGrantResult(input: unknown): ActivityCenterGrantResult {
  const record = requiredRecord(unwrapData(input), "activity center grant");
  return {
    grantedActivityCatFood: decodedInteger(
      record.granted_activity_cat_food,
      "granted_activity_cat_food",
    ),
    snapshot: normalizeActivityCenterSnapshot(record.snapshot),
  };
}

export function normalizeActivityWheelSpinEnvelope(input: unknown): ActivityWheelSpinEnvelope {
  const record = requiredRecord(unwrapData(input), "activity wheel spin envelope");
  return {
    result: normalizeSpinResult(record.result),
    snapshot: normalizeActivityCenterSnapshot(record.snapshot),
  };
}

export function normalizeActivityContactDiscoverySession(
  input: unknown,
): ActivityContactDiscoverySession {
  const record = requiredRecord(unwrapData(input), "activity contact session");
  return {
    id: decodedString(record.session_id, "session_id"),
    salt: decodedString(record.salt, "salt"),
    saltVersion: decodedString(record.salt_version, "salt_version"),
    defaultRegion: decodedString(record.default_region, "default_region"),
    maxContacts: decodedInteger(record.max_contacts, "max_contacts"),
    expiresAt: decodedString(record.expires_at, "expires_at"),
  };
}

export function normalizeActivityContactMatchResult(input: unknown): ActivityContactMatchResult {
  const record = requiredRecord(unwrapData(input), "activity contact match");
  return {
    matches: decodedArray(record.matches, "matches").map((item) => {
      const match = requiredRecord(item, "activity contact match user");
      return {
        userID: decodedString(match.user_id, "user_id"),
        nickname: decodedString(match.nickname, "nickname"),
        avatarURL: decodedString(match.avatar_url, "avatar_url"),
        relation: decodedString(match.relation, "relation"),
      };
    }),
    grantedActivityCatFood: decodedInteger(
      record.granted_activity_cat_food,
      "granted_activity_cat_food",
    ),
    snapshot: normalizeActivityCenterSnapshot(record.snapshot),
  };
}

export function normalizeActivityInviteShareSession(input: unknown): ActivityInviteShareSession {
  const record = requiredRecord(unwrapData(input), "activity invite share session");
  return {
    id: decodedString(record.session_id, "session_id"),
    shareURL: decodedString(record.share_url, "share_url"),
    inviteCode: decodedString(record.invite_code, "invite_code"),
    message: decodedString(record.message, "message"),
    expiresAt: decodedString(record.expires_at, "expires_at"),
  };
}

export function normalizeActivityPhoneVerificationSession(
  input: unknown,
): ActivityPhoneVerificationSession {
  const record = requiredRecord(unwrapData(input), "activity phone verification session");
  return {
    id: decodedString(record.session_id, "session_id"),
    expiresAt: decodedString(record.expires_at, "expires_at"),
    retryAfterSeconds: decodedInteger(record.retry_after_seconds, "retry_after_seconds"),
  };
}

export function canClaimActivity(status: ActivityClaimStatus): boolean {
  return status === "available" || status === "claimable";
}

export function activityTask(
  snapshot: ActivityCenterSnapshot,
  kind: ActivityTaskKind,
): ActivityCenterTask | undefined {
  return snapshot.tasks.find((task) => task.kind === kind);
}

export function displayWheelSegments(tier: ActivityWheelTier): ActivityWheelSegment[] {
  return [...tier.segments].sort((left, right) => left.displayOrder - right.displayOrder);
}

export function hasValidWheelProbability(tier: ActivityWheelTier): boolean {
  const segments = displayWheelSegments(tier);
  return (
    segments.length === 4 &&
    segments.reduce((sum, segment) => sum + segment.probabilityPPM, 0) === 1_000_000
  );
}

export function nextClaimableActivityDay(
  state: ActivityCheckInState,
): ActivityCheckInDay | undefined {
  return [...state.days]
    .sort((left, right) => left.day - right.day)
    .find((day) => canClaimActivity(day.status));
}

export function optimisticallyClaimActivityCheckIn(
  snapshot: ActivityCenterSnapshot,
): ActivityCenterSnapshot | undefined {
  const claimable = nextClaimableActivityDay(snapshot.checkIn);
  if (!claimable) return undefined;
  const days = snapshot.checkIn.days.map((day) =>
    day.day === claimable.day ? { ...day, status: "claimed" as const } : day,
  );
  return {
    ...snapshot,
    activityCatFoodBalance: snapshot.activityCatFoodBalance + claimable.rewardActivityCatFood,
    checkIn: {
      ...snapshot.checkIn,
      claimedDays: Math.min(snapshot.checkIn.claimedDays + 1, days.length),
      completed:
        days.length > 0 &&
        days.every((day) => day.status === "claimed" || day.status === "completed"),
      canClaim: false,
      days,
    },
  };
}

export function optimisticallyClaimActivityMeal(
  snapshot: ActivityCenterSnapshot,
  mealID: string,
): ActivityCenterSnapshot | undefined {
  const meal = snapshot.mealRewards.find(
    (candidate) => candidate.id === mealID && canClaimActivity(candidate.status),
  );
  if (!meal) return undefined;
  return {
    ...snapshot,
    activityCatFoodBalance: snapshot.activityCatFoodBalance + meal.rewardActivityCatFood,
    mealRewards: snapshot.mealRewards.map((candidate) =>
      candidate.id === mealID
        ? { ...candidate, status: "claimed" as const, claimedAt: snapshot.serverTime }
        : candidate,
    ),
  };
}

export function redactedActivitySnapshot(snapshot: ActivityCenterSnapshot): ActivityCenterSnapshot {
  return { ...snapshot, invitation: { ...snapshot.invitation, shareURL: "" } };
}

export function orderedActivityMeals(
  meals: readonly ActivityMealReward[],
  serverDate: Date,
  timezoneID: string,
): ActivityMealReward[] {
  let currentMinute: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezoneID,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(serverDate);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return [...meals];
    currentMinute = hour * 60 + minute;
  } catch {
    return [...meals];
  }
  return meals
    .map((meal, index) => ({ meal, index, key: activityMealSortKey(meal, currentMinute, index) }))
    .sort((left, right) => compareTuple(left.key, right.key))
    .map(({ meal }) => meal);
}

export function activityWheelLandingRotation(
  currentRotation: number,
  segmentIndex: number,
  turns = 6,
): number {
  const index = Math.max(0, Math.min(Math.trunc(segmentIndex), 3));
  const segmentCenter = -90 + (index + 0.5) * 90;
  const alignment = -90 - segmentCenter;
  const forwardArc = positiveModulo(
    positiveModulo(alignment, 360) - positiveModulo(currentRotation, 360),
    360,
  );
  return currentRotation + Math.max(Math.trunc(turns), 1) * 360 + forwardArc;
}

export function activityWheelLandingProgress(rawProgress: number): number {
  const progress = Math.min(Math.max(rawProgress, 0), 1);
  if (progress <= 0.6) return (0.75 * progress) / 0.6;
  const deceleration = (progress - 0.6) / 0.4;
  return 0.75 + 0.25 * (1 - Math.pow(1 - deceleration, 2));
}

export function activityDuration(seconds: number): string {
  const clamped = Math.max(0, Math.trunc(seconds));
  return [Math.trunc(clamped / 3600), Math.trunc(clamped / 60) % 60, clamped % 60]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function normalizePhoneBinding(input: unknown): ActivityPhoneBindingState {
  const record = requiredRecord(input, "phone_binding");
  const maskedPhone = optionalString(record.masked_phone);
  const defaultRegion = optionalString(record.default_region);
  return {
    isVerified: optionalBoolean(record.is_verified) ?? false,
    ...(maskedPhone ? { maskedPhone } : {}),
    ...(defaultRegion ? { defaultRegion } : {}),
  };
}

function normalizeCheckIn(input: unknown): ActivityCheckInState {
  const record = requiredRecord(input, "check_in");
  const days = optionalArray(record.days).map((item) => {
    const day = requiredRecord(item, "check-in day");
    return {
      day: requiredInteger(day.day, "day"),
      rewardActivityCatFood: requiredInteger(
        day.reward_activity_cat_food,
        "reward_activity_cat_food",
      ),
      status: requiredClaimStatus(day.status),
    };
  });
  const completedCount = days.filter(
    (day) => day.status === "claimed" || day.status === "completed",
  ).length;
  return {
    activityID: optionalString(record.activity_id) ?? "",
    claimedDays: optionalInteger(record.claimed_days) ?? completedCount,
    completed:
      optionalBoolean(record.completed) ?? (days.length > 0 && completedCount === days.length),
    canClaim: optionalBoolean(record.can_claim) ?? days.some((day) => canClaimActivity(day.status)),
    days,
  };
}

function normalizeMeal(input: unknown): ActivityMealReward {
  const record = requiredRecord(input, "meal reward");
  const titleKey = optionalString(record.title_key);
  const nextTransitionAt = optionalString(record.next_transition_at);
  const claimedAt = optionalString(record.claimed_at);
  return {
    id: requiredString(record.window_id, "window_id"),
    ...(titleKey ? { titleKey } : {}),
    startLocal: requiredString(record.start_local, "start_local"),
    endLocal: requiredString(record.end_local, "end_local"),
    rewardActivityCatFood: requiredInteger(
      record.reward_activity_cat_food,
      "reward_activity_cat_food",
    ),
    status: requiredClaimStatus(record.status),
    ...(nextTransitionAt ? { nextTransitionAt } : {}),
    ...(claimedAt ? { claimedAt } : {}),
  };
}

function normalizeTask(input: unknown): ActivityCenterTask {
  const record = requiredRecord(input, "activity task");
  const kind = requiredString(record.kind, "kind");
  if (kind !== "contact_sync" && kind !== "invite_share" && kind !== "valid_invite") {
    throw new Error(`Invalid activity task kind: ${kind}`);
  }
  // Swift's `activityOptionalInt` accepts a missing/null limit, but rejects a
  // present malformed value instead of silently treating it as unlimited.
  const dailyLimit = strictOptionalInteger(record.daily_limit, "daily_limit");
  return {
    id: requiredString(record.id, "id"),
    kind,
    status: requiredClaimStatus(record.status),
    rewardActivityCatFood: requiredInteger(
      record.reward_activity_cat_food,
      "reward_activity_cat_food",
    ),
    ...(dailyLimit !== undefined ? { dailyLimit } : {}),
    completedCount: optionalInteger(record.completed_count) ?? 0,
    creditedCount: optionalInteger(record.credited_count) ?? 0,
  };
}

function normalizeInvitation(input: unknown): ActivityInvitationState {
  const record = requiredRecord(input, "activity invitation");
  return {
    inviteCode: optionalString(record.invite_code) ?? "",
    shareURL: optionalString(record.share_url) ?? "",
    pendingInvites: optionalInteger(record.pending_invites) ?? 0,
    creditedInvites: optionalInteger(record.credited_invites) ?? 0,
    canRedeem: optionalBoolean(record.can_redeem) ?? false,
  };
}

function normalizeWheel(input: unknown): ActivityWheelState {
  const record = requiredRecord(input, "activity wheel");
  return {
    enabled: optionalBoolean(record.enabled) ?? false,
    currency: optionalString(record.currency) ?? "gold_coin",
    currentTier:
      record.current_tier == null
        ? unavailableActivityWheelTier
        : normalizeWheelTier(record.current_tier),
    recentWinners: optionalArray(record.recent_winners).map((item, index) => {
      const winner = requiredRecord(item, "wheel winner");
      const payout = requiredInteger(winner.payout_gold_coins, "payout_gold_coins");
      return {
        id: optionalString(winner.id) ?? `winner-${index}-${payout}`,
        displayName: requiredString(winner.display_name, "display_name"),
        avatarURL: optionalString(winner.avatar_url) ?? "",
        payoutGoldCoins: payout,
      };
    }),
  };
}

function normalizeWheelTier(input: unknown): ActivityWheelTier {
  const record = requiredRecord(input, "wheel tier");
  return {
    id: requiredString(record.id ?? record.tier_id, "id/tier_id"),
    sequence: requiredInteger(record.sequence, "sequence"),
    costGoldCoins: requiredInteger(record.cost_gold_coins, "cost_gold_coins"),
    nextTierID: optionalString(record.next_tier_id) ?? "",
    segments: optionalArray(record.segments).map((item) => {
      const segment = requiredRecord(item, "wheel segment");
      return {
        id: requiredString(segment.id ?? segment.prize_id, "id/prize_id"),
        payoutGoldCoins: requiredInteger(segment.payout_gold_coins, "payout_gold_coins"),
        probabilityPPM: requiredInteger(segment.probability_ppm, "probability_ppm"),
        displayOrder: requiredInteger(segment.display_order, "display_order"),
      };
    }),
  };
}

function normalizeSpinResult(input: unknown): ActivityWheelSpinResult {
  const record = requiredRecord(input, "wheel spin result");
  return {
    spinID: requiredString(record.spin_id, "spin_id"),
    tierID: requiredString(record.tier_id, "tier_id"),
    costGoldCoins: requiredInteger(record.cost_gold_coins, "cost_gold_coins"),
    prizeID: requiredString(record.prize_id, "prize_id"),
    payoutGoldCoins: requiredInteger(record.payout_gold_coins, "payout_gold_coins"),
    netDeltaGoldCoins: requiredInteger(record.net_delta_gold_coins, "net_delta_gold_coins"),
    nextTierID: optionalString(record.next_tier_id) ?? "",
  };
}

function requiredClaimStatus(value: unknown): ActivityClaimStatus {
  const status = requiredString(value, "status");
  if (!(activityClaimStatuses as readonly string[]).includes(status))
    throw new Error(`Invalid activity claim status: ${status}`);
  return status as ActivityClaimStatus;
}

function activityMealSortKey(
  meal: ActivityMealReward,
  currentMinute: number,
  fallbackIndex: number,
): [number, number, number] {
  const start = minuteOfDay(meal.startLocal);
  const end = minuteOfDay(meal.endLocal);
  if (start === undefined || end === undefined || start >= end)
    return [Number.MAX_SAFE_INTEGER, fallbackIndex, fallbackIndex];
  const until =
    currentMinute < start
      ? start - currentMinute
      : currentMinute < end
        ? 0
        : 24 * 60 - currentMinute + start;
  return [until, start, fallbackIndex];
}

function minuteOfDay(value: string): number | undefined {
  const parts = value.split(":");
  if (parts.length !== 2 || !parts.every((part) => /^[+-]?\d+$/.test(part))) return undefined;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : undefined;
}

function compareTuple(left: [number, number, number], right: [number, number, number]): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function unwrapData(value: unknown): unknown {
  const record = asRecord(value);
  return record && Object.hasOwn(record, "data") ? record.data : value;
}

function optionalArray(value: unknown): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("Expected activity array");
  return value;
}

function decodedArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Missing or invalid array field ${label}`);
  return value;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) throw new Error(`Invalid ${label}`);
  return record;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(value: unknown, label: string): string {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`Missing required string field ${label}`);
  return parsed;
}

function decodedString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Missing or invalid string field ${label}`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return undefined;
}

function requiredInteger(value: unknown, label: string): number {
  const parsed = optionalInteger(value);
  if (parsed === undefined) throw new Error(`Missing or invalid integer field ${label}`);
  return parsed;
}

function decodedInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error(`Missing or invalid integer field ${label}`);
  return value === 0 ? 0 : value;
}

function strictOptionalInteger(value: unknown, label: string): number | undefined {
  return value == null ? undefined : requiredInteger(value, label);
}

function optionalInteger(value: unknown): number | undefined {
  if (value == null) return undefined;
  const clean = typeof value === "string" ? value.trim() : value;
  if (clean === "") return undefined;
  if (typeof clean === "string" && !/^[+-]?\d+$/.test(clean)) return undefined;
  const parsed =
    typeof clean === "number" ? clean : typeof clean === "string" ? Number(clean) : Number.NaN;
  return Number.isSafeInteger(parsed) ? (parsed === 0 ? 0 : parsed) : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (clean === "1" || clean === "true") return true;
    if (clean === "0" || clean === "false") return false;
  }
  return undefined;
}
