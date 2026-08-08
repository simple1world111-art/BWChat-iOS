import { isRecord } from "@/api/normalizers";
import type { DynamicRoute } from "@/services/remote-config/types";

export interface AppBridgeInfo {
  appVersion: string;
  build: string;
  platform: string;
}

/**
 * Mirrors JSONDecoder's DynamicRoute handling for the WKScriptMessage bridge.
 * Bridge payloads intentionally accept only the native snake_case keys and
 * fail as a whole when a present field has the wrong JSON type.
 */
export function decodeAppBridgeRoute(value: unknown): DynamicRoute | undefined {
  const candidate = bridgeJSONValue(value);
  if (!isRecord(candidate)) return undefined;

  const type = optionalString(candidate, "type");
  const name = optionalString(candidate, "name");
  const url = optionalString(candidate, "url");
  const screenId = optionalString(candidate, "screen_id");
  const titleKey = optionalString(candidate, "title_key");
  const title = optionalString(candidate, "title");
  const titleI18n = optionalStringMap(candidate, "title_i18n");
  const messageKey = optionalString(candidate, "message_key");
  const message = optionalString(candidate, "message");
  const messageI18n = optionalStringMap(candidate, "message_i18n");
  const params = optionalJSONRecord(candidate, "params");
  const fields = [
    type,
    name,
    url,
    screenId,
    titleKey,
    title,
    titleI18n,
    messageKey,
    message,
    messageI18n,
    params,
  ];
  if (fields.some((field) => field === invalidField)) return undefined;

  return {
    ...(typeof type === "string" ? { type } : {}),
    ...(typeof name === "string" ? { name } : {}),
    ...(typeof url === "string" ? { url } : {}),
    ...(typeof screenId === "string" ? { screenId } : {}),
    ...(typeof titleKey === "string" ? { titleKey } : {}),
    ...(typeof title === "string" ? { title } : {}),
    ...(isRecord(titleI18n) ? { titleI18n: titleI18n as Record<string, string> } : {}),
    ...(typeof messageKey === "string" ? { messageKey } : {}),
    ...(typeof message === "string" ? { message } : {}),
    ...(isRecord(messageI18n) ? { messageI18n: messageI18n as Record<string, string> } : {}),
    ...(isRecord(params) ? { params } : {}),
  };
}

/** Swift String.prefix counts extended grapheme clusters and preserves bytes. */
export function bridgeNavigationTitle(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return graphemes(value).slice(0, 40).join("");
}

export function appBridgeInfo(
  appVersion: string | null | undefined,
  nativeBuildVersion: string | null | undefined,
  platform = "iOS",
): AppBridgeInfo {
  return {
    appVersion: appVersion ?? "0",
    build: normalizedNativeBuild(nativeBuildVersion),
    platform,
  };
}

const invalidField = Symbol("invalid-app-bridge-field");
type OptionalField<T> = T | typeof invalidField | undefined;

function bridgeJSONValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function optionalString(record: Record<string, unknown>, key: string): OptionalField<string> {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : invalidField;
}

function optionalStringMap(
  record: Record<string, unknown>,
  key: string,
): OptionalField<Record<string, string>> {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
    return invalidField;
  }
  return value as Record<string, string>;
}

function optionalJSONRecord(
  record: Record<string, unknown>,
  key: string,
): OptionalField<Record<string, unknown>> {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  return isRecord(value) && isJSONValue(value) ? value : invalidField;
}

function isJSONValue(value: unknown): boolean {
  if (value === null || ["string", "boolean"].includes(typeof value)) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJSONValue);
  return isRecord(value) && Object.values(value).every(isJSONValue);
}

function normalizedNativeBuild(value: string | null | undefined): string {
  if (!value || !/^[+-]?\d+$/u.test(value)) return "0";
  try {
    const build = BigInt(value);
    const minimum = -(2n ** 63n);
    const maximum = 2n ** 63n - 1n;
    return build >= minimum && build <= maximum ? build.toString() : "0";
  } catch {
    return "0";
  }
}

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
      (item) => item.segment,
    );
  }
  return Array.from(value);
}
