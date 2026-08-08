import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { APIError } from "@/api/client";

export type AuthTranslator = (key: string, ...args: (string | number)[]) => string;

export interface AuthSubmissionLock {
  current: boolean;
}

const invalidCredentialMessages = new Set([
  "user_not_found",
  "invalid_credentials",
  "invalid_username_or_password",
  "incorrect_username_or_password",
]);
export function isBlank(value: string): boolean {
  return trimFoundationWhitespacesAndNewlines(value).length === 0;
}

export function acquireAuthSubmission(lock: AuthSubmissionLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseAuthSubmission(lock: AuthSubmissionLock): void {
  lock.current = false;
}

export function isLoginFormEnabled(
  username: string,
  password: string,
  isSubmitting: boolean,
): boolean {
  return !isBlank(username) && !isBlank(password) && !isSubmitting;
}

export function isRegisterFormEnabled(
  username: string,
  password: string,
  confirmPassword: string,
  isSubmitting: boolean,
): boolean {
  return (
    !isBlank(username) &&
    swiftCharacterCount(username) >= 3 &&
    swiftCharacterCount(password) >= 6 &&
    password === confirmPassword &&
    !isSubmitting
  );
}

export function registerValidationHint(
  username: string,
  password: string,
  confirmPassword: string,
  t: AuthTranslator,
): string | null {
  if (isBlank(username)) return null;
  if (swiftCharacterCount(username) < 3) return t("auth.validation.usernameTooShort");
  if (isBlank(password)) return null;
  if (swiftCharacterCount(password) < 6) return t("auth.validation.passwordTooShort");
  if (!isBlank(confirmPassword) && password !== confirmPassword) {
    return t("auth.validation.passwordMismatch");
  }
  return null;
}

/** Swift `String.count` counts extended grapheme clusters, not UTF-16 units. */
function swiftCharacterCount(value: string): number {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value))
      .length;
  }
  // Hermes builds used by the app expose Segmenter. This fallback still
  // avoids splitting surrogate pairs on older JavaScript runtimes.
  return Array.from(value).length;
}

export function localizedLoginError(error: unknown, t: AuthTranslator): string {
  if (!(error instanceof APIError)) return t("auth.login.failed");
  const rawMessage = nativeServerMessage(error);
  const normalizedMessage = trimNativeWhitespaceAndNewlines(rawMessage).toLowerCase();
  if (error.status === 401) {
    return t("auth.login.invalidCredentials");
  }
  // AuthViewModel handles every native `.serverError` by returning its raw
  // message, even for 5xx. Only non-server categories use errorDescription.
  const localized = localizedTransportAPIError(error, t);
  if (localized) return localized;
  if (invalidCredentialMessages.has(normalizedMessage)) {
    return t("auth.login.invalidCredentials");
  }
  if (error.status < 400 && rawMessage.startsWith("api.")) return t(rawMessage);
  return rawMessage;
}

export function localizedRegisterError(error: unknown, t: AuthTranslator): string {
  if (!(error instanceof APIError)) return t("auth.register.failed");
  const transport = localizedTransportAPIError(error, t);
  if (transport) return transport;
  if (error.status === 401) return t("api.unauthorized");

  const symbolicCode = nativeSymbolicBusinessCode(error.payload);
  if (symbolicCode) return localizedBusinessAPIError(symbolicCode, nativeServerMessage(error), t);

  const numericCode = nativeInt(error.code ?? nativeNumericErrorCode(error.payload));
  if (
    (error.status >= 500 && error.status <= 599) ||
    (numericCode !== undefined && numericCode >= 500 && numericCode <= 599)
  ) {
    return t("api.serverUnavailable");
  }
  if (error.message.startsWith("api.")) return t(error.message);
  return nativeServerMessage(error);
}

function trimNativeWhitespaceAndNewlines(value: string): string {
  return trimFoundationWhitespacesAndNewlines(value);
}

function nativeServerMessage(error: APIError): string {
  // `APIResponseWrapper.requiredData()` replaces a blank wrapper message with
  // the localized invalid-response error before AuthViewModel sees it and
  // otherwise preserves the wrapper's raw, nonblank message byte-for-byte.
  if (error.status >= 200 && error.status < 300) {
    return error.message;
  }
  const payloadMessage = nativePayloadErrorMessage(error.payload);
  return payloadMessage ?? error.message;
}

function nativePayloadErrorMessage(payload: unknown): string | undefined {
  if (typeof payload === "string") return JSON.stringify(payload);
  if (typeof payload !== "object" || payload === null) return undefined;
  const root = payload as Record<string, unknown>;
  const detail = root.detail;
  if (typeof detail === "object" && detail !== null) {
    const detailMessage = (detail as Record<string, unknown>).message;
    if (typeof detailMessage === "string" && detailMessage.length > 0) return detailMessage;
  }

  const rawMessage = typeof root.message === "string" ? root.message : undefined;
  const normalizedMessage =
    rawMessage === undefined ? undefined : trimNativeWhitespaceAndNewlines(rawMessage);
  const data = root.data;
  const fieldErrors =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>).field_errors
      : undefined;
  const fieldMessages =
    typeof fieldErrors === "object" && fieldErrors !== null
      ? Object.entries(fieldErrors as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .flatMap(([, value]) => (typeof value === "string" ? [value] : []))
      : [];
  const messages = [...(normalizedMessage ? [normalizedMessage] : []), ...fieldMessages].filter(
    (value, index, values) => values.indexOf(value) === index,
  );
  if (messages.length > 0) return messages.join("\n");
  return rawMessage;
}

function nativeNumericErrorCode(payload: unknown): string | number | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const root = payload as Record<string, unknown>;
  const direct = root.code;
  if (typeof direct === "string" || typeof direct === "number") return direct;
  const detail = root.detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  const nested = (detail as Record<string, unknown>).code;
  return typeof nested === "string" || typeof nested === "number" ? nested : undefined;
}

function nativeSymbolicBusinessCode(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const root = payload as Record<string, unknown>;
  const direct = nativeFlexibleCodeString(root.code);
  const data =
    typeof root.data === "object" && root.data !== null
      ? (root.data as Record<string, unknown>)
      : undefined;
  const structured = typeof data?.error_code === "string" ? data.error_code : undefined;
  const candidate = direct ?? structured;
  if (!candidate || isBlank(candidate) || nativeInt(candidate) !== undefined) return undefined;
  return candidate;
}

function nativeFlexibleCodeString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function nativeInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value !== "string" || !/^[+-]?\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function localizedBusinessAPIError(code: string, serverMessage: string, t: AuthTranslator): string {
  switch (trimNativeWhitespaceAndNewlines(code).toLowerCase()) {
    case "insufficient_spendable_balance":
      return t("wallet.error.insufficientSpendableBalance");
    case "insufficient_gold_coins":
      return t("wallet.error.insufficientGoldCoins");
    case "activity_cat_food_disabled":
      return t("wallet.error.activityCatFoodDisabled");
    default: {
      const clean = trimNativeWhitespaceAndNewlines(serverMessage);
      return clean || t("api.invalidResponse");
    }
  }
}

function localizedTransportAPIError(error: APIError, t: AuthTranslator): string | undefined {
  if (error.code === "decoding_error" || error.message === "api.decodingError") {
    return t("api.decodingError");
  }
  if (error.status === 0 || (error.status === 408 && error.payload === undefined)) {
    return t("api.networkUnavailable");
  }
  return undefined;
}
