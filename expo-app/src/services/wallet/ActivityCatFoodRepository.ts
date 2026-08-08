import { getActivityCatFoodTransactionPage } from "@/api/bwchat";
import { APIError } from "@/api/client";
import { flexBool, flexString, isRecord } from "@/api/normalizers";
import type {
  ActivityCatFoodTransaction,
  ActivityCatFoodTransactionPage,
} from "@/models";

export const activityCatFoodTransactionPageSize = 20;
export const activityCatFoodPaginationThreshold = 160;

export function shouldLoadNextActivityCatFoodPage({
  contentHeight,
  contentOffsetY,
  hasNextPage,
  isLoading,
  viewportHeight,
}: {
  contentHeight: number;
  contentOffsetY: number;
  hasNextPage: boolean;
  isLoading: boolean;
  viewportHeight: number;
}): boolean {
  if (!hasNextPage || isLoading || contentHeight <= 0 || viewportHeight <= 0) return false;
  return contentHeight - (Math.max(0, contentOffsetY) + viewportHeight)
    < activityCatFoodPaginationThreshold;
}

export async function loadActivityCatFoodTransactionPage(
  cursor?: string | undefined,
): Promise<ActivityCatFoodTransactionPage> {
  return getActivityCatFoodTransactionPage({
    ...(cursor?.trim() ? { cursor: cursor.trim() } : {}),
    limit: activityCatFoodTransactionPageSize,
  });
}

export function appendActivityCatFoodTransactionPage(
  current: ActivityCatFoodTransactionPage,
  next: ActivityCatFoodTransactionPage,
): ActivityCatFoodTransactionPage {
  const seen = new Set<string>();
  const items = [...current.items, ...next.items].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const nextCursor = next.next_cursor?.trim();
  return {
    items,
    ...(nextCursor && nextCursor !== current.next_cursor ? { next_cursor: nextCursor } : {}),
  };
}

export function isActivityCatFoodConfigured(walletConfig: unknown): boolean {
  if (!isRecord(walletConfig)) return false;
  const nested = isRecord(walletConfig.activity_cat_food)
    ? walletConfig.activity_cat_food
    : isRecord(walletConfig.activityCatFood)
      ? walletConfig.activityCatFood
      : {};
  return flexBool(nested.enabled) === true || flexBool(
    walletConfig.activity_cat_food_enabled,
    walletConfig.activityCatFoodEnabled,
  ) === true;
}

export function isActivityCatFoodDisabledError(error: unknown): boolean {
  if (!(error instanceof APIError)) return false;
  const payload = isRecord(error.payload) ? error.payload : {};
  const nested = isRecord(payload.error)
    ? payload.error
    : isRecord(payload.data)
      ? payload.data
      : {};
  const embedded = parseEmbeddedError(flexString(payload.message, error.message));
  return flexString(
    payload.code,
    payload.error_code,
    payload.errorCode,
    nested.code,
    nested.error_code,
    nested.errorCode,
    embedded?.code,
    embedded?.error_code,
    embedded?.errorCode,
  )?.trim().toLocaleLowerCase()
    === "activity_cat_food_disabled";
}

export function activityCatFoodLocalizedTitleKey(
  transaction: ActivityCatFoodTransaction,
): string | undefined {
  const value = normalizeActivityText([transaction.source, transaction.title]
    .filter((item): item is string => Boolean(item))
    .join(" "));
  if (!value) return undefined;
  if (value.includes("check in") || value.includes("checkin") || value.includes("sign in")) {
    return "activityCenter.checkIn.title";
  }
  if (["breakfast", "lunch", "dinner", "meal"].some((token) => value.includes(token))) {
    return "activityCenter.meals.title";
  }
  if (value.includes("contact")) return "activityCenter.contacts.title";
  if (value.includes("valid invite") || value.includes("invite reward")) {
    return "activityCenter.invite.title";
  }
  if (value.includes("share")) return "activityCenter.share.title";
  if (value.includes("invite")) return "activityCenter.invite.title";
  return undefined;
}

export function activityCatFoodTransactionPresentation(
  transaction: ActivityCatFoodTransaction,
  translate: (key: string, ...args: (string | number)[]) => string,
): { title: string; source?: string | undefined; signedAmount: string } {
  const localizedKey = activityCatFoodLocalizedTitleKey(transaction);
  return {
    title: localizedKey
      ? translate(localizedKey)
      : transaction.title?.trim() || translate("activityCatFood.transaction.adjust"),
    ...(localizedKey ? { source: translate("activityCatFood.transaction.grant") } : {}),
    signedAmount: `${transaction.delta >= 0 ? "+" : "-"}${Math.abs(transaction.delta)}`,
  };
}

function normalizeActivityText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(/\s+/u)
    .filter(Boolean)
    .join(" ");
}

function parseEmbeddedError(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim().startsWith("{")) return undefined;
  try {
    const decoded: unknown = JSON.parse(value);
    return isRecord(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}
