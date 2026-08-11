import { APIError } from "@/api/client";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";

type Translator = (key: string, ...args: (string | number)[]) => string;

export function createGroupErrorMessage(error: unknown, t: Translator): string {
  if (!(error instanceof APIError)) return t("group.createFailed");
  const numericCode = Number(error.code);
  if (error.code === "decoding_error" || error.message === "api.decodingError") {
    return t("api.decodingError");
  }
  if (error.status === 0 || (error.status === 408 && error.payload === undefined)) {
    return t("api.networkUnavailable");
  }
  if (error.status >= 500 || (Number.isFinite(numericCode) && numericCode >= 500)) {
    return t("api.serverUnavailable");
  }
  if (error.status === 401) return t("api.unauthorized");
  for (const message of apiErrorMessages(error)) {
    const normalized = trimFoundationWhitespacesAndNewlines(message);
    if (!normalized) continue;
    if (normalized.startsWith("api.")) return t(normalized);
    return normalized;
  }
  return t("group.createFailed");
}

function apiErrorMessages(error: APIError): string[] {
  const payload = record(error.payload);
  const detail = record(payload?.detail);
  const data = record(payload?.data);
  return [detail?.message, data?.message, payload?.message, error.message].filter(
    (value): value is string => typeof value === "string",
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
