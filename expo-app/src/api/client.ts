import { normalizeAuthSession, trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { env } from "@/config/env";
import type { APIEnvelope, User } from "@/models";
import { getActiveLanguageCode } from "@/providers/LocalizationProvider";
import { cacheUser } from "@/services/cache/UserInfoCache";
import { saveCachedUser } from "@/storage/authStorage";
import { clearTokens, readAccessToken, readRefreshToken, saveTokens } from "@/storage/tokenStorage";

export class APIError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
    readonly code?: string | number,
    readonly retryAfterMilliseconds?: number,
  ) {
    super(message);
    this.name = "APIError";
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: Record<string, unknown> | FormData;
  auth?: boolean;
  refreshAuth?: boolean;
  timeoutMs?: number;
  requiredData?: boolean;
  requiredEnvelope?: boolean;
  requiredSuccessCode?: boolean;
  transientRetries?: boolean;
  invalidateSessionOnUnauthorized?: boolean;
};

type AuthenticatedResourceOptions = Omit<RequestInit, "body" | "method"> & {
  auth?: boolean;
  timeoutMs?: number;
  refreshAuth?: boolean;
  transientRetries?: boolean;
  invalidateSessionOnUnauthorized?: boolean;
};

export type RefreshAccessTokenOptions = {
  invalidateSessionOnUnauthorized?: boolean;
};

export type AuthSessionEvent = { type: "refreshed"; user: User } | { type: "invalidated" };

const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const transientDelays = [350, 900] as const;
let refreshInFlight: Promise<string> | null = null;
let sessionInvalidationInFlight: Promise<void> | null = null;
const authSessionListeners = new Set<(event: AuthSessionEvent) => void>();

function isEnvelope<T>(value: unknown): value is APIEnvelope<T> {
  return typeof value === "object" && value !== null && "data" in value;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const auth = options.auth ?? true;
  return execute<T>(path, options, {
    auth,
    canRefresh: auth && options.refreshAuth !== false,
    didRefresh: false,
    transientAttempt: 0,
    isIdempotent:
      method === "GET" || method === "HEAD" || new Headers(options.headers).has("Idempotency-Key"),
  });
}

/**
 * Authenticated binary GET with the same refresh, invalidation, timeout and
 * transient-retry lifecycle as `apiRequest`. Media callers keep the Response
 * body binary instead of forcing it through the JSON envelope decoder.
 */
export async function authenticatedResourceRequest(
  resource: string,
  options: AuthenticatedResourceOptions = {},
): Promise<Response> {
  const requestUrl = makeResourceURL(resource);
  const authenticated = options.auth ?? isSameOrigin(requestUrl, env.apiBaseUrl);
  return executeResource(requestUrl, options, {
    authenticated,
    canRefresh: authenticated && options.refreshAuth !== false,
    didRefresh: false,
    transientAttempt: 0,
  });
}

async function executeResource(
  requestUrl: string,
  options: AuthenticatedResourceOptions,
  state: {
    authenticated: boolean;
    canRefresh: boolean;
    didRefresh: boolean;
    transientAttempt: number;
  },
): Promise<Response> {
  const { timeoutMs = 60_000 } = options;
  const controller = new AbortController();
  const requestInit = nativeAuthenticatedResourceInit(options);
  const externalSignal = requestInit.signal;
  const abortFromExternalSignal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(requestInit.headers);
    headers.set("Accept", "*/*");
    headers.set("Accept-Language", getActiveLanguageCode());
    const token = state.authenticated ? await readAccessToken() : null;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    else headers.delete("Authorization");

    const response = await fetch(requestUrl, {
      ...requestInit,
      cache: requestInit.cache ?? "no-store",
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (response.status === 401 && state.canRefresh) {
      await refreshAccessToken({
        invalidateSessionOnUnauthorized: options.invalidateSessionOnUnauthorized !== false,
      });
      return executeResource(requestUrl, options, {
        ...state,
        canRefresh: false,
        didRefresh: true,
      });
    }

    if (
      response.status === 401 &&
      state.didRefresh &&
      options.invalidateSessionOnUnauthorized !== false
    ) {
      await invalidateAuthSession();
    }

    if (!response.ok) {
      if (
        options.transientRetries !== false &&
        retryableStatuses.has(response.status) &&
        state.transientAttempt < transientDelays.length
      ) {
        await delay(retryDelay(response, state.transientAttempt));
        return executeResource(requestUrl, options, {
          ...state,
          transientAttempt: state.transientAttempt + 1,
        });
      }
      const payload: unknown = await response.json().catch(() => null);
      throw new APIError(
        serverMessage(payload, response.status),
        response.status,
        payload,
        apiResponseCode(payload),
        responseRetryAfterMilliseconds(response),
      );
    }

    return response;
  } catch (error) {
    if (error instanceof APIError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new APIError("请求超时，请稍后重试", 408);
    }
    if (options.transientRetries !== false && state.transientAttempt < transientDelays.length) {
      await delay(transientDelays[state.transientAttempt] ?? 900);
      return executeResource(requestUrl, options, {
        ...state,
        transientAttempt: state.transientAttempt + 1,
      });
    }
    throw new APIError(error instanceof Error ? error.message : "网络请求失败", 0, error);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

function nativeAuthenticatedResourceInit(options: AuthenticatedResourceOptions): RequestInit {
  const result = { ...options } as Record<string, unknown>;
  delete result.auth;
  delete result.timeoutMs;
  delete result.refreshAuth;
  delete result.transientRetries;
  delete result.invalidateSessionOnUnauthorized;
  return result as RequestInit;
}

async function execute<T>(
  path: string,
  options: RequestOptions,
  state: {
    auth: boolean;
    canRefresh: boolean;
    didRefresh: boolean;
    transientAttempt: number;
    isIdempotent: boolean;
  },
): Promise<T> {
  const { body: inputBody, timeoutMs = 15_000 } = options;
  const requestInit = nativeRequestInit(options);
  const controller = new AbortController();
  const externalSignal = requestInit.signal;
  const abortFromExternalSignal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(requestInit.headers);
    headers.set("Accept", "application/json");
    headers.set("Accept-Language", getActiveLanguageCode());
    const token = state.auth ? await readAccessToken() : null;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    else headers.delete("Authorization");

    let body: BodyInit | undefined;
    if (inputBody instanceof FormData) {
      body = inputBody;
    } else if (inputBody) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(inputBody);
    }

    const response = await fetch(makeURL(path), {
      ...requestInit,
      headers,
      ...(body ? { body } : {}),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);

    if (response.status === 401 && state.canRefresh) {
      await refreshAccessToken({
        invalidateSessionOnUnauthorized: options.invalidateSessionOnUnauthorized !== false,
      });
      return execute<T>(path, options, { ...state, canRefresh: false, didRefresh: true });
    }

    if (
      response.status === 401 &&
      state.didRefresh &&
      options.invalidateSessionOnUnauthorized !== false
    ) {
      await invalidateAuthSession();
    }

    if (!response.ok) {
      if (
        options.transientRetries !== false &&
        state.isIdempotent &&
        retryableStatuses.has(response.status) &&
        state.transientAttempt < transientDelays.length
      ) {
        await delay(retryDelay(response, state.transientAttempt));
        return execute<T>(path, options, {
          ...state,
          transientAttempt: state.transientAttempt + 1,
        });
      }
      throw new APIError(
        serverMessage(payload, response.status),
        response.status,
        payload,
        apiResponseCode(payload),
        responseRetryAfterMilliseconds(response),
      );
    }

    return decodeSuccessfulPayload<T>(
      payload,
      response.status,
      options.requiredData === true,
      options.requiredEnvelope === true,
      options.requiredSuccessCode === true,
    );
  } catch (error) {
    if (error instanceof APIError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new APIError("请求超时，请稍后重试", 408);
    }
    if (
      options.transientRetries !== false &&
      state.isIdempotent &&
      state.transientAttempt < transientDelays.length
    ) {
      await delay(transientDelays[state.transientAttempt] ?? 900);
      return execute<T>(path, options, {
        ...state,
        transientAttempt: state.transientAttempt + 1,
      });
    }
    throw new APIError(error instanceof Error ? error.message : "网络请求失败", 0, error);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

function nativeRequestInit(options: RequestOptions): RequestInit {
  const result = { ...options } as Record<string, unknown>;
  delete result.body;
  delete result.auth;
  delete result.refreshAuth;
  delete result.timeoutMs;
  delete result.requiredData;
  delete result.requiredEnvelope;
  delete result.requiredSuccessCode;
  delete result.transientRetries;
  delete result.invalidateSessionOnUnauthorized;
  return result as RequestInit;
}

export async function refreshAccessToken(options: RefreshAccessTokenOptions = {}): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = await readRefreshToken();
      if (!refreshToken) throw new APIError("api.unauthorized", 401);
      const session = normalizeAuthResponse(
        await apiRequest<unknown>("/auth/refresh", {
          method: "POST",
          auth: false,
          requiredData: true,
          requiredEnvelope: true,
          body: { refresh_token: refreshToken },
        }),
      );
      await saveTokens({ accessToken: session.token, refreshToken: session.refresh_token });
      emitAuthSessionEvent({ type: "refreshed", user: session.user });
      await Promise.allSettled([saveCachedUser(session.user), cacheUser(session.user)]);
      return session.token;
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  try {
    return await refreshInFlight;
  } catch (error) {
    if (
      options.invalidateSessionOnUnauthorized !== false &&
      error instanceof APIError &&
      error.status === 401
    ) {
      await invalidateAuthSession();
    }
    throw error;
  }
}

export function subscribeAuthSessionEvents(
  listener: (event: AuthSessionEvent) => void,
): () => void {
  authSessionListeners.add(listener);
  return () => authSessionListeners.delete(listener);
}

function emitAuthSessionEvent(event: AuthSessionEvent): void {
  for (const listener of authSessionListeners) listener(event);
}

async function invalidateAuthSession(): Promise<void> {
  if (!sessionInvalidationInFlight) {
    sessionInvalidationInFlight = (async () => {
      await clearTokens();
      emitAuthSessionEvent({ type: "invalidated" });
    })().finally(() => {
      sessionInvalidationInFlight = null;
    });
  }
  await sessionInvalidationInFlight;
}

function normalizeAuthResponse(value: unknown) {
  try {
    return normalizeAuthSession(value);
  } catch {
    throw new APIError("api.decodingError", 200, undefined, "decoding_error");
  }
}

function makeURL(path: string): string {
  return `${env.apiBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function makeResourceURL(resource: string): string {
  const normalized = resource.trim();
  try {
    return new URL(normalized).toString();
  } catch {
    return makeURL(normalized);
  }
}

function isSameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function serverMessage(payload: unknown, status: number): string {
  if (status >= 500 && status <= 599) return "服务暂时不可用，请稍后重试";
  if (typeof payload === "object" && payload !== null && "message" in payload) {
    const message = String(payload.message).trim();
    if (message) return message;
  }
  return `请求失败（${status}）`;
}

export function decodeSuccessfulPayload<T>(
  payload: unknown,
  httpStatus: number,
  requiredData = false,
  requiredEnvelope = false,
  requiredSuccessCode = false,
): T {
  if (
    requiredSuccessCode &&
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload)
  ) {
    assertNativeSuccessCode(payload, httpStatus);
  }
  if (!isEnvelope<T>(payload)) {
    if (requiredEnvelope) {
      const isWrapperObject =
        typeof payload === "object" && payload !== null && !Array.isArray(payload);
      if (!isWrapperObject) {
        throw new APIError("api.decodingError", httpStatus, undefined, "decoding_error");
      }
      if (requiredData) throw nativeMissingWrapperDataError(payload, httpStatus);
      // Native APIResponseWrapper permits a missing `data` key for EmptyData responses.
      return undefined as T;
    }
    if (requiredData && payload == null) {
      throw new APIError(serverMessage(payload, httpStatus), httpStatus, payload);
    }
    return payload as T;
  }
  const data = payload.data;
  if (requiredData && data == null) {
    if (requiredEnvelope) throw nativeMissingWrapperDataError(payload, httpStatus);
    const code = apiResponseCode(payload);
    const numericCode = Number(code);
    throw new APIError(
      serverMessage(payload, Number.isFinite(numericCode) ? numericCode : httpStatus),
      httpStatus,
      payload,
      code,
    );
  }
  return data as T;
}

function assertNativeSuccessCode(payload: object, httpStatus: number): void {
  const record = payload as Record<string, unknown>;
  const rawCode = record.code;
  const code =
    typeof rawCode === "number" && Number.isSafeInteger(rawCode)
      ? rawCode
      : typeof rawCode === "string" && /^[+-]?\d+$/u.test(rawCode)
        ? Number(rawCode)
        : undefined;
  if (code === undefined || !Number.isSafeInteger(code)) {
    const rawMessage = typeof record.message === "string" ? record.message : "";
    throw new APIError(
      trimFoundationWhitespacesAndNewlines(rawMessage) ? rawMessage : "api.invalidResponse",
      httpStatus,
      payload,
      typeof rawCode === "string" ? rawCode : "decoding_error",
    );
  }
  if (code === 0) return;
  const rawMessage = typeof record.message === "string" ? record.message : "";
  const message = code >= 500 && code <= 599 ? "服务暂时不可用，请稍后重试" : rawMessage;
  throw new APIError(message, httpStatus, payload, code);
}

function nativeMissingWrapperDataError(payload: object, httpStatus: number): APIError {
  const record = payload as Record<string, unknown>;
  const rawMessage = typeof record.message === "string" ? record.message : "";
  const message = trimFoundationWhitespacesAndNewlines(rawMessage)
    ? rawMessage
    : "api.invalidResponse";
  return new APIError(message, httpStatus, payload, nativeAPIResponseCode(record.code));
}

function nativeAPIResponseCode(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value !== "string" || !/^[+-]?\d+$/u.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function apiResponseCode(payload: unknown): string | number | undefined {
  if (typeof payload !== "object" || payload === null || !("code" in payload)) return undefined;
  const code = payload.code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = responseRetryAfterMilliseconds(response);
  if (retryAfter !== undefined) return Math.min(retryAfter, 2_000);
  return transientDelays[attempt] ?? 900;
}

export function parseRetryAfterMilliseconds(
  value: string | null,
  now = Date.now(),
): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 5 * 60_000);
  const date = Date.parse(normalized);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(0, date - now), 5 * 60_000);
}

function responseRetryAfterMilliseconds(response: Response): number | undefined {
  return parseRetryAfterMilliseconds(response.headers.get("Retry-After"));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
