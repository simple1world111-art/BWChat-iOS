import { APIError } from "@/api/client";
import { isRecord } from "@/api/normalizers";
import type { GameRoundStart } from "@/services/games/GameModels";
import { policyAllowsURL, type WebViewPolicy } from "@/services/web/WebViewPolicy";

export const gameBridgeTypes = {
  profile: "bwchat.game.open_user_profile",
  rewardedAd: "bwchat.game.show_rewarded_ad",
  roundStart: "bwchat.game.request_round_start",
} as const;

export const gameRoundErrorCodes = {
  invalidMessage: "native_invalid_message",
  untrustedGameOrigin: "native_untrusted_game_origin",
  contextMismatch: "native_game_context_mismatch",
  paymentAlreadyShowing: "native_payment_already_showing",
  paymentFailed: "native_payment_failed",
  resumeTokenFailure: "native_round_resume_token_failure",
  insufficientGoldCoins: "INSUFFICIENT_GOLD_COINS",
} as const;

export const rewardedAdErrorCodes = {
  alreadyShowing: "native_ad_already_showing",
  adUnitNotAllowed: "native_ad_unit_not_allowed",
  invalidMessage: "native_invalid_message",
  untrustedGameOrigin: "native_untrusted_game_origin",
  sdkNotInitialized: "native_sdk_not_initialized",
  loadFailed: "native_ad_load_failed",
  noFill: "native_ad_no_fill",
  presentFailed: "native_ad_present_failed",
  presenterUnavailable: "native_presenter_unavailable",
} as const;

export interface GameProfileMessage {
  type: typeof gameBridgeTypes.profile;
  version: 1;
  source: "just_clear";
  userID: string;
  deepLink: string;
}

export interface GameRoundStartRequest {
  type: typeof gameBridgeTypes.roundStart;
  version: 1;
  source: string;
  trigger: string;
  requestID: string;
  sessionID: string;
}

export interface GameRewardedAdRequest {
  type: typeof gameBridgeTypes.rewardedAd;
  version: 1;
  source: string;
  placement: string;
  requestID: string;
  sessionID: string;
  adUnitID: string;
  ssvUserID: string;
  ssvCustomData: string;
}

export type GameBridgeAction =
  | { kind: "profile"; message: GameProfileMessage }
  | { kind: "rewardedAd"; request: GameRewardedAdRequest }
  | { kind: "roundStart"; request: GameRoundStartRequest };

export type GameRoundStartResult = {
  request_id: string;
  session_id: string;
  status: "started" | "cancelled" | "failed";
  round_id?: string | undefined;
  round_token?: string | undefined;
  expires_at?: string | undefined;
  payment_method?: string | undefined;
  entry_price_gold_coins?: number | undefined;
  error_code?: string | undefined;
};

export type GameRewardedAdResult = {
  request_id: string;
  session_id: string;
  status: "completed" | "dismissed" | "failed" | "unavailable";
  error_code?: string | undefined;
};

export type GameNavigationResolution =
  { kind: "allow" } | { kind: "profile"; userID: string } | { kind: "cancel" };

export class GameBridgeValidationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "GameBridgeValidationError";
  }
}

export class RequestLedger {
  private readonly pending = new Set<string>();
  private readonly completed = new Set<string>();

  begin(address: string): boolean {
    if (this.pending.has(address) || this.completed.has(address)) return false;
    this.pending.add(address);
    return true;
  }

  complete(address: string): boolean {
    if (!this.pending.delete(address) || this.completed.has(address)) return false;
    this.completed.add(address);
    return true;
  }

  hasCompleted(address: string): boolean {
    return this.completed.has(address);
  }
}

export class GameProfileOpenGate {
  private lastUserID?: string;
  private lastOpenAt = Number.NEGATIVE_INFINITY;

  shouldOpen(userID: string, now = Date.now()): boolean {
    if (this.lastUserID === userID && now - this.lastOpenAt < 600) return false;
    this.lastUserID = userID;
    this.lastOpenAt = now;
    return true;
  }
}

export function parseBridgeBody(value: string | unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function decodeGameBridgeAction(body: Record<string, unknown>): GameBridgeAction {
  switch (body.type) {
    case gameBridgeTypes.profile:
      return { kind: "profile", message: decodeGameProfileMessage(body) };
    case gameBridgeTypes.rewardedAd:
      return { kind: "rewardedAd", request: decodeRewardedAdRequest(body) };
    case gameBridgeTypes.roundStart:
      return { kind: "roundStart", request: decodeRoundStartRequest(body) };
    default:
      throw new GameBridgeValidationError("unsupported_type");
  }
}

export function decodeGameProfileMessage(body: Record<string, unknown>): GameProfileMessage {
  if (body.type !== gameBridgeTypes.profile) invalid("invalid_type");
  if (strictInteger(body.version) !== 1) invalid("invalid_version");
  if (body.source !== "just_clear") invalid("invalid_source");
  const userID = typeof body.user_id === "string" ? body.user_id : "";
  if (!isValidGameUserID(userID)) invalid("invalid_user_id");
  const deepLink = typeof body.deep_link === "string" ? body.deep_link : "";
  if (deepLink !== gameProfileDeepLink(userID)) invalid("invalid_deep_link");
  return {
    type: gameBridgeTypes.profile,
    version: 1,
    source: "just_clear",
    userID,
    deepLink,
  };
}

export function decodeRoundStartRequest(body: Record<string, unknown>): GameRoundStartRequest {
  if (body.type !== gameBridgeTypes.roundStart) invalid("invalid_type");
  if (strictInteger(body.version) !== 1) invalid("invalid_version");
  const source = typeof body.source === "string" ? body.source : "";
  const trigger = typeof body.trigger === "string" ? body.trigger : "";
  const requestID = typeof body.request_id === "string" ? body.request_id : "";
  const sessionID = typeof body.session_id === "string" ? body.session_id : "";
  if (!isGameSlug(source)) invalid("invalid_source");
  if (!isGameSlug(trigger)) invalid("invalid_trigger");
  if (!isUUIDv4(requestID)) invalid("invalid_request_id");
  if (!isGameSessionID(sessionID)) invalid("invalid_session_id");
  return {
    type: gameBridgeTypes.roundStart,
    version: 1,
    source,
    trigger,
    requestID: requestID.toLowerCase(),
    sessionID,
  };
}

export function decodeRewardedAdRequest(body: Record<string, unknown>): GameRewardedAdRequest {
  if (body.type !== gameBridgeTypes.rewardedAd) invalid("invalid_type");
  if (strictInteger(body.version) !== 1) invalid("invalid_version");
  const source = typeof body.source === "string" ? body.source : "";
  const placement = typeof body.placement === "string" ? body.placement : "";
  const requestID = typeof body.request_id === "string" ? body.request_id : "";
  const sessionID = typeof body.session_id === "string" ? body.session_id : "";
  const adUnitID = typeof body.ad_unit_id === "string" ? body.ad_unit_id : "";
  const ssvUserID = typeof body.ssv_user_id === "string" ? body.ssv_user_id : "";
  const ssvCustomData = typeof body.ssv_custom_data === "string" ? body.ssv_custom_data : "";
  if (!isGameSlug(source)) invalid("invalid_source");
  if (!isGameSlug(placement)) invalid("invalid_placement");
  if (!isUUIDv4(requestID)) invalid("invalid_request_id");
  if (!isULID(sessionID)) invalid("invalid_session_id");
  if (!isBoundedText(adUnitID, 128)) invalid("invalid_ad_unit_id");
  if (!isBoundedText(ssvUserID, 256)) invalid("invalid_ssv_user_id");
  if (!isBoundedText(ssvCustomData, 2_048)) invalid("invalid_ssv_custom_data");
  if (body.reward_item !== undefined) {
    if (typeof body.reward_item !== "string" || !isBoundedText(body.reward_item, 128)) {
      invalid("invalid_reward_item");
    }
  }
  const rewardAmount = strictInteger(body.reward_amount);
  if (rewardAmount === undefined || rewardAmount <= 0) invalid("invalid_reward_amount");
  return {
    type: gameBridgeTypes.rewardedAd,
    version: 1,
    source,
    placement,
    requestID: requestID.toLowerCase(),
    sessionID: sessionID.toUpperCase(),
    adUnitID,
    ssvUserID,
    ssvCustomData,
  };
}

export function roundRequestAddress(
  request: Pick<GameRoundStartRequest, "requestID" | "sessionID">,
): string {
  return `${request.requestID}\u0000${request.sessionID}`;
}

export function roundAddressFromBody(body: Record<string, unknown>): string | undefined {
  const identity = roundIdentityFromBody(body);
  return identity ? roundRequestAddress(identity) : undefined;
}

export function roundIdentityFromBody(
  body: Record<string, unknown>,
): { requestID: string; sessionID: string } | undefined {
  const requestID = typeof body.request_id === "string" ? body.request_id : "";
  const sessionID = typeof body.session_id === "string" ? body.session_id : "";
  return isUUIDv4(requestID) && isGameSessionID(sessionID)
    ? { requestID: requestID.toLowerCase(), sessionID }
    : undefined;
}

export function rewardedAddressFromBody(
  body: Record<string, unknown>,
): { requestID: string; sessionID: string } | undefined {
  const requestID = typeof body.request_id === "string" ? body.request_id : "";
  const sessionID = typeof body.session_id === "string" ? body.session_id : "";
  return isUUIDv4(requestID) && isULID(sessionID)
    ? { requestID: requestID.toLowerCase(), sessionID: sessionID.toUpperCase() }
    : undefined;
}

export function startedRoundResult(
  request: GameRoundStartRequest,
  round: GameRoundStart,
): GameRoundStartResult {
  return {
    request_id: request.requestID,
    session_id: request.sessionID,
    status: "started",
    round_id: round.roundID,
    round_token: round.roundToken,
    expires_at: round.expiresAt,
    payment_method: round.paymentMethod,
    entry_price_gold_coins: round.entryPriceGoldCoins,
  };
}

export function failedRoundResult(
  address: Pick<GameRoundStartRequest, "requestID" | "sessionID">,
  errorCode: string,
): GameRoundStartResult {
  return {
    request_id: address.requestID,
    session_id: address.sessionID,
    status: "failed",
    error_code: errorCode,
  };
}

export function roundBridgeErrorCode(error: unknown): string {
  const candidates = apiErrorCandidates(error);
  if (
    candidates.some((value) => {
      const normalized = value.toUpperCase();
      return normalized.includes("INSUFFICIENT_GOLD_COINS") || value.includes("金币余额不足");
    })
  )
    return gameRoundErrorCodes.insufficientGoldCoins;
  return gameRoundErrorCodes.paymentFailed;
}

export function isRoundResumeTokenFailure(error: unknown): boolean {
  const candidates = apiErrorCandidates(error).map((value) => value.toUpperCase());
  return candidates.some(
    (value) =>
      value.includes("GAME_ROUND_TOKEN_INVALID") || value.includes("GAME_ROUND_TOKEN_EXPIRED"),
  );
}

export function allowsInitialGameURL(value: string | URL, policy: WebViewPolicy): boolean {
  const url = toURL(value);
  if (
    !url ||
    url.protocol !== "https:" ||
    !url.hostname ||
    Boolean(url.username) ||
    Boolean(url.password) ||
    !policyAllowsURL(url, policy)
  )
    return false;
  return url.pathname.startsWith("/api/v1/game-assets/");
}

export function isSameOrigin(leftValue: string | URL, rightValue: string | URL): boolean {
  const left = toURL(leftValue);
  const right = toURL(rightValue);
  return Boolean(
    left &&
    right &&
    left.protocol.toLowerCase() === right.protocol.toLowerCase() &&
    left.hostname.toLowerCase() === right.hostname.toLowerCase() &&
    effectivePort(left) === effectivePort(right),
  );
}

export function allowsGameBridgeMessage(input: {
  isMainFrame: boolean;
  currentURL?: string | undefined;
  frameURL?: string | undefined;
  initialURL: string;
  requiresHTTPS: boolean;
  policy: WebViewPolicy;
}): boolean {
  if (!input.isMainFrame || !input.currentURL || !input.frameURL) return false;
  if (
    !allowsInitialGameURL(input.currentURL, input.policy) ||
    !allowsInitialGameURL(input.frameURL, input.policy) ||
    !isSameOrigin(input.currentURL, input.initialURL) ||
    !isSameOrigin(input.frameURL, input.initialURL)
  )
    return false;
  if (!input.requiresHTTPS) return true;
  return (
    toURL(input.currentURL)?.protocol === "https:" && toURL(input.frameURL)?.protocol === "https:"
  );
}

export function gameNavigationResolution(
  candidateValue: string | URL,
  initialValue: string | URL,
): GameNavigationResolution {
  const profileUserID = userIDFromGameProfileURL(candidateValue);
  if (profileUserID) return { kind: "profile", userID: profileUserID };
  const candidate = toURL(candidateValue);
  if (!candidate || !["http:", "https:"].includes(candidate.protocol)) return { kind: "cancel" };
  return isSameOrigin(candidate, initialValue) ? { kind: "allow" } : { kind: "cancel" };
}

export function isGameProfileScheme(value: string | URL): boolean {
  return toURL(value)?.protocol.toLowerCase() === "bwchat:";
}

export function shouldShowBlockingNavigationError(hasFinishedInitialDocument: boolean): boolean {
  return !hasFinishedInitialDocument;
}

export function gameProfileDeepLink(userID: string): string | undefined {
  if (!isValidGameUserID(userID)) return undefined;
  return `bwchat://profile/${encodeURIComponent(userID)}`;
}

export function userIDFromGameProfileURL(value: string | URL): string | undefined {
  const url = toURL(value);
  if (
    !url ||
    url.protocol.toLowerCase() !== "bwchat:" ||
    url.hostname.toLowerCase() !== "profile" ||
    Boolean(url.username) ||
    Boolean(url.password) ||
    Boolean(url.port) ||
    Boolean(url.search) ||
    Boolean(url.hash) ||
    !url.pathname.startsWith("/")
  )
    return undefined;
  const encoded = url.pathname.slice(1);
  if (!encoded || encoded.includes("/")) return undefined;
  try {
    const userID = decodeURIComponent(encoded);
    return isValidGameUserID(userID) ? userID : undefined;
  } catch {
    return undefined;
  }
}

export function isValidGameUserID(value: string): boolean {
  return value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/u.test(value);
}

export function isGameSlug(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && /^[a-z0-9._-]+$/u.test(value);
}

export function isUUIDv4(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/u.test(
    value,
  );
}

export function isULID(value: string): boolean {
  return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value.toUpperCase());
}

export function isGameSessionID(value: string): boolean {
  return value.length >= 16 && value.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(value);
}

export function strictInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)
    ? value
    : undefined;
}

export function makeRoundResultJavaScript(result: GameRoundStartResult): string {
  return resultDeliveryJavaScript("round-start", "__bwchatRoundStartResult", result);
}

export function makeRewardedResultJavaScript(result: GameRewardedAdResult): string {
  return resultDeliveryJavaScript("rewarded-ad", "__bwchatRewardedAdResult", result);
}

function resultDeliveryJavaScript(
  event: "round-start" | "rewarded-ad",
  callback: "__bwchatRoundStartResult" | "__bwchatRewardedAdResult",
  result: GameRoundStartResult | GameRewardedAdResult,
): string {
  const payload = JSON.stringify(result).replaceAll("<", "\\u003c");
  return `(() => { const result = ${payload}; window.dispatchEvent(new CustomEvent("bwchat:${event}-result", { detail: result })); if (typeof window.${callback} === "function") window.${callback}(result); window.postMessage({ type: "bwchat:${event}-result", payload: result }, window.location.origin); return true; })(); true;`;
}

function apiErrorCandidates(error: unknown): string[] {
  if (error instanceof APIError) {
    const payload = isRecord(error.payload) ? error.payload : {};
    return [String(payload.code ?? ""), String(payload.message ?? ""), error.message];
  }
  return error instanceof Error ? [error.message] : [String(error ?? "")];
}

function isBoundedText(value: string, maximum: number): boolean {
  return (
    Boolean(value.trim()) &&
    graphemeCount(value) <= maximum &&
    !/[\u0000-\u001F\u007F-\u009F]/u.test(value)
  );
}

function graphemeCount(value: string): number {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value))
      .length;
  }
  return Array.from(value).length;
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  if (url.protocol === "http:") return "80";
  if (url.protocol === "https:") return "443";
  return "";
}

function toURL(value: string | URL): URL | undefined {
  if (value instanceof URL) return value;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function invalid(reason: string): never {
  throw new GameBridgeValidationError(reason);
}
