import { APIError } from "@/api/client";

export const usernameResetPolicy = {
  minimumCharacters: 3,
  maximumCharacters: 20,
  successNavigationDelayMilliseconds: 650,
  heroTopPadding: 84,
  contentBottomPadding: 110,
  horizontalPadding: 16,
  sectionSpacing: 26,
  heroIconSize: 62,
  heroSpacing: 20,
  heroCopySpacing: 14,
  heroTitleSize: 25,
  heroTitleMinimumScale: 0.68,
  heroDescriptionSize: 13,
  heroDescriptionLineHeight: 19,
  fieldSpacing: 12,
  fieldVerticalPadding: 7,
  fieldFontSize: 15,
  bottomHorizontalPadding: 46,
  bottomTopPadding: 12,
  bottomMinimumPadding: 24,
  submitMinimumHeight: 50,
  submitRadius: 8,
  submitFontSize: 17,
} as const;

type Translate = (key: string, ...args: (string | number)[]) => string;

export function usernameSegments(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
      (item) => item.segment,
    );
  }
  return Array.from(value);
}

export function usernameCharacterCount(value: string): number {
  return usernameSegments(value).length;
}

export function usernameValidationMessage(
  value: string,
  currentUsername: string,
  t: Translate,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return t("username.reset.empty");
  if (usernameCharacterCount(trimmed) < usernameResetPolicy.minimumCharacters) {
    return t("username.reset.tooShort");
  }
  if (usernameCharacterCount(trimmed) > usernameResetPolicy.maximumCharacters) {
    return t("username.reset.tooLong");
  }
  if (trimmed === currentUsername) return t("username.reset.same");
  return null;
}

export function usernameResetError(error: unknown, t: Translate, locale: string): string {
  const payload =
    error instanceof APIError ? (parsePayload(error.payload) ?? parsePayload(error.message)) : null;
  const fallbackCode =
    error instanceof APIError ? (typeof error.code === "string" ? error.code : error.message) : "";
  const code = String(payload?.code ?? fallbackCode)
    .trim()
    .toLocaleLowerCase();
  if (code === "invalid_username") return t("username.reset.invalid");
  if (code === "username_already_taken" || code === "username_exists") {
    return t("username.reset.taken");
  }
  if (code === "username_change_too_soon" || code === "username_change_cooldown") {
    const rawDate = payload?.data?.username_next_change_at;
    const date = typeof rawDate === "string" ? new Date(rawDate) : null;
    if (date && Number.isFinite(date.valueOf())) {
      return t(
        "username.reset.cooldownWithDate",
        new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date),
      );
    }
    return t("username.reset.cooldown");
  }
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  return error instanceof Error ? error.message.trim() : t("api.networkUnavailable");
}

function parsePayload(value: unknown): {
  code?: unknown;
  message?: unknown;
  data?: { username_next_change_at?: unknown };
} | null {
  if (typeof value === "object" && value !== null) return value;
  if (typeof value !== "string" || !value.trim().startsWith("{")) return null;
  try {
    return JSON.parse(value) as {
      code?: unknown;
      message?: unknown;
      data?: { username_next_change_at?: unknown };
    };
  } catch {
    return null;
  }
}
