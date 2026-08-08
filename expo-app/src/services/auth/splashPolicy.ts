import { APIError } from "@/api/client";

export const splashMetrics = {
  contentGap: 14,
  logoInitialScale: 0.6,
  logoFinalScale: 1,
  // React Native's private rounded-heavy face rasterizes wider than the
  // SwiftUI 36pt rounded-heavy face. 32pt is the measured visual equivalent
  // on the fixed 3x iOS acceptance pair (351px native vs 355px Expo).
  logoSize: 32,
  logoVerticalOpticalOffset: -2.5,
  enteringSize: 15,
  taglineSize: 13,
  progressTopInset: 6,
  bottomInset: 86,
  springResponseMilliseconds: 800,
  springDampingFraction: 0.6,
  missingTokenDelayMilliseconds: 500,
  validationWatchdogMilliseconds: 20_000,
} as const;

const angularFrequency = (2 * Math.PI) / (splashMetrics.springResponseMilliseconds / 1_000);
export const splashSpringPhysics = {
  stiffness: angularFrequency ** 2,
  damping: 2 * splashMetrics.springDampingFraction * angularFrequency,
  mass: 1,
} as const;

const credentialFailureCodes = new Set([
  "invalid_token",
  "refresh_token_expired",
  "refresh_token_invalid",
  "session_revoked",
]);

export function shouldInvalidateCachedSession(error: unknown): boolean {
  if (!(error instanceof APIError)) return false;
  if (error.status === 401 || error.status === 403) return true;
  const code = readFailureCode(error.payload);
  return code ? credentialFailureCodes.has(code.trim().toLocaleLowerCase()) : false;
}

export function sessionRedirectPath(
  isBootstrapping: boolean,
  hasUser: boolean,
  rootSegment: string,
): "/(tabs)/conversations" | "/(auth)/login" | undefined {
  if (isBootstrapping) return undefined;
  const inAuth = rootSegment === "(auth)";
  if (hasUser && inAuth) return "/(tabs)/conversations";
  if (!hasUser && !inAuth && rootSegment !== "index") return "/(auth)/login";
  return undefined;
}

function readFailureCode(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["code", "error_code", "errorCode"] as const) {
    if (typeof record[key] === "string") return record[key];
  }
  for (const key of ["error", "data", "payload"] as const) {
    const nested = readFailureCode(record[key], depth + 1);
    if (nested) return nested;
  }
  return undefined;
}
