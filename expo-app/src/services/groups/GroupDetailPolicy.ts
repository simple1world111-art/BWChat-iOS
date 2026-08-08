import { APIError } from "@/api/client";

type Translator = (key: string, ...args: (string | number)[]) => string;

export function groupDetailErrorMessage(error: unknown, t: Translator, fallback: string): string {
  if (!(error instanceof APIError)) return fallback;
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
  const message = error.message.trim();
  if (message.startsWith("api.")) return t(message);
  return message || fallback;
}
