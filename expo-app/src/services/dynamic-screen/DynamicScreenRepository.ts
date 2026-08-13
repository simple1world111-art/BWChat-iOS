import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Platform } from "react-native";

import { refreshAccessToken } from "@/api/client";
import { env } from "@/config/env";
import { getActiveLanguageCode } from "@/providers/LocalizationProvider";
import { bundledDynamicScreens } from "@/services/dynamic-screen/DynamicScreenFixtures";
import {
  canonicalLegalDocumentScreenId,
  isLegalDynamicScreenComplete,
  normalizeDynamicToken,
  parseDynamicScreen,
  parseDynamicScreenWire,
  parseLegalDocumentWire,
  type LegalDocumentKind,
  type DynamicScreen,
} from "@/services/dynamic-screen/DynamicScreenModels";
import { readAccessToken } from "@/storage/tokenStorage";

const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const transientDelays = [350, 900] as const;

export interface DynamicScreenRemoteResult {
  screen: DynamicScreen | null;
  etag: string | null;
  notModified: boolean;
}

type DynamicScreenRequestErrorKind = "decoding" | "network" | "server" | "unauthorized";

export class DynamicScreenRequestError extends Error {
  constructor(
    readonly kind: DynamicScreenRequestErrorKind,
    message: string,
    readonly status: number,
    readonly payload?: unknown,
    readonly effectiveCode?: string | number,
  ) {
    super(message);
    this.name = "DynamicScreenRequestError";
  }
}

export function dynamicScreenErrorMessage(
  error: unknown,
  translate: (key: string) => string,
): string {
  if (error instanceof DynamicScreenRequestError) {
    if (error.kind === "decoding") return translate("api.decodingError");
    if (error.kind === "network") return translate("api.networkUnavailable");
    if (error.kind === "unauthorized") return translate("api.unauthorized");
    const symbolicCode = String(error.effectiveCode ?? "")
      .trim()
      .toLowerCase();
    if (symbolicCode === "insufficient_spendable_balance") {
      return translate("wallet.error.insufficientSpendableBalance");
    }
    if (symbolicCode === "insufficient_gold_coins") {
      return translate("wallet.error.insufficientGoldCoins");
    }
    if (symbolicCode === "activity_cat_food_disabled") {
      return translate("wallet.error.activityCatFoodDisabled");
    }
    const numericCode = Number(error.effectiveCode ?? error.status);
    if (!Number.isFinite(Number(error.effectiveCode)) && !error.message.trim()) {
      return translate("api.invalidResponse");
    }
    if (Number.isFinite(numericCode) && numericCode >= 500 && numericCode <= 599) {
      return translate("api.serverUnavailable");
    }
    return error.message;
  }
  if (isAPIErrorLike(error)) {
    if (error.code === "decoding_error" || error.message === "api.decodingError") {
      return translate("api.decodingError");
    }
    if (error.status === 0 || (error.status === 408 && error.payload === undefined)) {
      return translate("api.networkUnavailable");
    }
    if (error.status === 401 || error.message === "api.unauthorized") {
      return translate("api.unauthorized");
    }
    if (error.message.startsWith("api.")) return translate(error.message);
  }
  return error instanceof Error && error.message
    ? error.message
    : translate("api.networkUnavailable");
}

export function embeddedDynamicScreen(
  screenId: string,
  configured: unknown,
  legalKind?: LegalDocumentKind | null,
): DynamicScreen | null {
  const normalized = normalizeDynamicToken(screenId);
  const remoteConfigured: DynamicScreen[] = [];
  if (Array.isArray(configured)) {
    for (const value of configured) {
      const screen = parseDynamicScreen(value);
      if (!screen) {
        remoteConfigured.length = 0;
        break;
      }
      remoteConfigured.push(screen);
    }
  }
  const configuredMatch = remoteConfigured.find(
    (screen) => normalizeDynamicToken(screen.screenId) === normalized,
  );
  if (
    configuredMatch &&
    isLegalDynamicScreenComplete(screenId, configuredMatch, getActiveLanguageCode(), legalKind)
  ) {
    return configuredMatch;
  }
  const fallbackId = legalKind ? canonicalLegalDocumentScreenId(legalKind) : normalized;
  return (
    bundledDynamicScreens.find(
      (screen) => normalizeDynamicToken(screen.screenId) === normalizeDynamicToken(fallbackId),
    ) ?? null
  );
}

export async function readCachedDynamicScreen(
  ownerId: string | undefined,
  screenId: string,
  language: string,
): Promise<{ screen: DynamicScreen | null; etag: string | null }> {
  const [screenJSON, etag] = await Promise.all([
    AsyncStorage.getItem(cacheKey(ownerId, screenId, language)),
    AsyncStorage.getItem(etagKey(ownerId, screenId, language)),
  ]);
  if (!screenJSON) return { screen: null, etag };
  try {
    const screen = parseDynamicScreen(JSON.parse(screenJSON) as unknown);
    // DynamicScreenStore restores a decodable cached page before applying the
    // schema gate to a later remote response. Keep that exact startup behavior.
    return { screen, etag };
  } catch {
    return { screen: null, etag };
  }
}

export async function fetchDynamicScreen(
  screenId: string,
  previousETag?: string | null,
  timeoutMs = 8_000,
): Promise<DynamicScreenRemoteResult> {
  const token = await readAccessToken();
  return requestDynamicScreen(screenId, previousETag, timeoutMs, token, Boolean(token), 0);
}

async function requestDynamicScreen(
  screenId: string,
  previousETag: string | null | undefined,
  timeoutMs: number,
  token: string | null,
  canRefresh: boolean,
  transientAttempt: number,
): Promise<DynamicScreenRemoteResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let receivedResponse = false;
  try {
    const headers = new Headers({
      Accept: "application/json",
      "Accept-Language": getActiveLanguageCode(),
      "X-App-Version": Application.nativeApplicationVersion ?? "0",
      "X-App-Build": Application.nativeBuildVersion ?? "0",
      "X-Platform": Platform.OS === "ios" ? "iOS" : Platform.OS,
      "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (previousETag?.trim()) headers.set("If-None-Match", previousETag);
    const response = await fetch(
      `${env.apiBaseUrl.replace(/\/$/u, "")}/app/screens/${encodeURIComponent(screenId)}`,
      { method: "GET", headers, cache: "no-store", signal: controller.signal },
    );
    receivedResponse = true;
    if (response.status === 401 && token && canRefresh) {
      const refreshedToken = await refreshAccessToken({ invalidateSessionOnUnauthorized: false });
      return requestDynamicScreen(
        screenId,
        previousETag,
        timeoutMs,
        refreshedToken,
        false,
        transientAttempt,
      );
    }
    if (response.status === 304) {
      return { screen: null, etag: response.headers.get("ETag"), notModified: true };
    }
    if (response.status === 401) {
      throw new DynamicScreenRequestError("unauthorized", "api.unauthorized", response.status);
    }
    const responseBody = await response.text();
    const payload = parseResponseBody(responseBody);
    if (!response.ok) {
      if (retryableStatuses.has(response.status) && transientAttempt < transientDelays.length) {
        await delay(retryDelay(response, transientAttempt));
        return requestDynamicScreen(
          screenId,
          previousETag,
          timeoutMs,
          token,
          canRefresh,
          transientAttempt + 1,
        );
      }
      throw nativeHTTPError(payload, response.status, responseBody);
    }
    const wrapped = record(payload);
    const screen =
      parseDynamicScreenWire(wrapped?.data) ??
      parseLegalDocumentWire(wrapped?.data) ??
      parseDynamicScreenWire(payload) ??
      parseLegalDocumentWire(payload);
    if (!screen) {
      throw new DynamicScreenRequestError(
        "decoding",
        "api.decodingError",
        response.status,
        payload,
        "decoding_error",
      );
    }
    return { screen, etag: response.headers.get("ETag"), notModified: false };
  } catch (error) {
    if (error instanceof DynamicScreenRequestError) throw error;
    if (
      !receivedResponse &&
      isRetryableTransportError(error) &&
      transientAttempt < transientDelays.length
    ) {
      await delay(transientDelays[transientAttempt] ?? 900);
      return requestDynamicScreen(
        screenId,
        previousETag,
        timeoutMs,
        token,
        canRefresh,
        transientAttempt + 1,
      );
    }
    throw normalizeRequestError(error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function persistDynamicScreen(
  ownerId: string | undefined,
  screenId: string,
  language: string,
  screen: DynamicScreen,
  etag: string | null,
): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(cacheKey(ownerId, screenId, language), JSON.stringify(screen)),
    etag !== null
      ? AsyncStorage.setItem(etagKey(ownerId, screenId, language), etag)
      : Promise.resolve(),
  ]);
}

export async function persistDynamicScreenETag(
  ownerId: string | undefined,
  screenId: string,
  language: string,
  etag: string,
): Promise<void> {
  await AsyncStorage.setItem(etagKey(ownerId, screenId, language), etag);
}

function parseResponseBody(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function nativeHTTPError(
  value: unknown,
  status: number,
  responseBody: string,
): DynamicScreenRequestError {
  const raw = record(value);
  const detail = record(raw?.detail);
  const detailMessage =
    typeof detail?.message === "string" && detail.message.length > 0 ? detail.message : undefined;
  const rootMessage = typeof raw?.message === "string" ? raw.message.trim() : undefined;
  const fieldErrors = record(record(raw?.data)?.field_errors);
  const structuredMessages = [
    rootMessage,
    ...Object.entries(fieldErrors ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([, message]) => (typeof message === "string" ? [message] : [])),
  ].filter((message): message is string => Boolean(message));
  const structuredMessage = [...new Set(structuredMessages)].join("\n") || undefined;
  const envelopeMessage = typeof raw?.message === "string" ? raw.message : undefined;
  const message =
    detailMessage ??
    (rootMessage || undefined) ??
    structuredMessage ??
    envelopeMessage ??
    (responseBody.length > 0 ? responseBody.slice(0, 240) : `请求失败（${status}）`);
  const symbolicCode = flexibleString(raw?.code);
  const detailCode =
    typeof detail?.code === "number" && Number.isInteger(detail.code) ? detail.code : undefined;
  const envelopeCode = flexibleInteger(raw?.code);
  const effectiveCode = detailCode ?? (envelopeCode === 0 ? undefined : envelopeCode) ?? status;
  return new DynamicScreenRequestError(
    "server",
    message,
    status,
    value,
    symbolicCode && !Number.isFinite(Number(symbolicCode)) ? symbolicCode : effectiveCode,
  );
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1_000, 2_000);
  return transientDelays[attempt] ?? 900;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableTransportError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
}

function normalizeRequestError(error: unknown): Error {
  if (isAPIErrorLike(error)) {
    if (error.status === 401 || error.message === "api.unauthorized") {
      return new DynamicScreenRequestError("unauthorized", "api.unauthorized", 401, error.payload);
    }
    if (error.code === "decoding_error" || error.message === "api.decodingError") {
      return new DynamicScreenRequestError(
        "decoding",
        "api.decodingError",
        error.status,
        error.payload,
        error.code,
      );
    }
    if (error.status === 0 || (error.status === 408 && error.payload === undefined)) {
      return new DynamicScreenRequestError(
        "network",
        "api.networkUnavailable",
        error.status,
        error.payload,
      );
    }
    return error;
  }
  return new DynamicScreenRequestError("network", "api.networkUnavailable", 0, error);
}

function isAPIErrorLike(
  value: unknown,
): value is Error & { status: number; payload?: unknown; code?: string | number } {
  return value instanceof Error && typeof (value as { status?: unknown }).status === "number";
}

function flexibleString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return undefined;
}

function flexibleInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^[-+]?\d+$/u.test(value)) {
    return Number.parseInt(value, 10);
  }
  return undefined;
}

function cacheKey(ownerId: string | undefined, screenId: string, language: string): string {
  return `bbchat.app.dynamicScreen.v2.${scopeId(ownerId)}.${localeScope(language)}.${normalizeDynamicToken(screenId)}`;
}

function etagKey(ownerId: string | undefined, screenId: string, language: string): string {
  return `bbchat.app.dynamicScreen.etag.v2.${scopeId(ownerId)}.${localeScope(language)}.${normalizeDynamicToken(screenId)}`;
}

function scopeId(ownerId: string | undefined): string {
  const normalized = ownerId?.trim();
  return normalized ? `user.${normalized}` : "guest";
}

function localeScope(language: string): string {
  return normalizeDynamicToken(language.replaceAll("_", "-"));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
