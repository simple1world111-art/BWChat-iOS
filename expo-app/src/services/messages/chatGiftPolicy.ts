import type {
  GiftCatalogItem,
  GiftMessagePayload,
  GiftRecipient,
} from "@/models";

type UnknownRecord = Record<string, unknown>;

export const chatGiftPickerPolicy = {
  recipientTitleFontSize: 17,
  recipientTitleHorizontalPadding: 16,
  recipientTitleTopPadding: 18,
  recipientTitleBottomPadding: 10,
  emptySpacing: 12,
  emptyIconSize: 34,
  emptyTextFontSize: 15,
  recipientRowSpacing: 10,
  recipientListPadding: 16,
  recipientContentSpacing: 12,
  recipientAvatarSize: 42,
  recipientNameFontSize: 16,
  recipientChevronSize: 13,
  recipientRowPadding: 14,
  recipientRowCornerRadius: 14,
  balanceHeaderSpacing: 10,
  balanceIconCircleSize: 34,
  balanceIconSize: 31,
  balanceLabelFontSize: 12,
  balanceValueFontSize: 22,
  balanceLoadingFontSize: 16,
  balanceBreakdownFontSize: 11,
  refreshButtonSize: 32,
  refreshIconSize: 14,
  balanceHeaderHorizontalPadding: 16,
  balanceHeaderVerticalPadding: 18,
  recipientSummarySpacing: 10,
  recipientSummaryAvatarSize: 30,
  recipientSummaryLabelFontSize: 13,
  recipientSummaryNameFontSize: 15,
  recipientSummaryChangeFontSize: 13,
  recipientSummaryHorizontalPadding: 16,
  recipientSummaryBottomPadding: 12,
  recipientSummaryMinimumHeight: 52,
  gridColumns: 3,
  gridColumnSpacing: 10,
  gridRowSpacing: 10,
  gridHorizontalPadding: 16,
  gridBottomPadding: 16,
  cardCornerRadius: 16,
  cardSpacing: 8,
  cardIconSize: 52,
  unaffordableIconOpacity: 0.46,
  cardNameFontSize: 13,
  cardNameMinimumScale: 0.8,
  priceSpacing: 4,
  priceIconSize: 10,
  priceFontSize: 12,
  cardMinimumHeight: 116,
  cardVerticalPadding: 12,
  selectedBorderWidth: 1.6,
  selectedInnerBorderWidth: 0.8,
  selectedInnerInset: 2,
  selectedScale: 1.012,
  sendButtonSpacing: 8,
  sendButtonIconSize: 14,
  sendButtonFontSize: 16,
  sendButtonHeight: 48,
  sendButtonCornerRadius: 24,
  sendBarHorizontalPadding: 16,
  sendBarTopPadding: 10,
  sendBarBottomPadding: 14,
  disabledOpacity: 0.76,
  localAnimationLifetimeMs: 1_200,
  walletOpenDelayMs: 250,
} as const;

export const chatGiftBubblePolicy = {
  contentSpacing: 6,
  topSpacing: 4,
  giftColumnSpacing: 5,
  giftIconSize: 68,
  giftNameFontSize: 13,
  giftNameMinimumScale: 0.72,
  giftColumnWidth: 80,
  middleColumnSpacing: 7,
  arrowWidth: 44,
  arrowHeight: 30,
  toFontSize: 11,
  middleTopPadding: 20,
  recipientColumnSpacing: 6,
  recipientAvatarSize: 54,
  recipientNameFontSize: 13,
  recipientNameMinimumScale: 0.72,
  recipientColumnWidth: 74,
  recipientTopPadding: 11,
  valueSpacing: 3,
  valueIconSize: 13,
  valueFontSize: 11,
  horizontalPadding: 8,
  verticalPadding: 9,
  width: 232,
  cornerRadius: 18,
  borderWidth: 1,
  avatarCornerRadius: 12,
  avatarBorderWidth: 2,
  avatarShadowOpacity: 0.08,
  avatarShadowRadius: 4,
  avatarShadowOffsetY: 2,
} as const;

export const chatGiftAnimationPolicy = {
  backdropOpacity: 0.22,
  particleCount: 6,
  iconSize: 96,
  initialScale: 0.62,
  finalScale: 1.05,
  treeFinalOffsetY: -8,
  initialParticleDistance: 18,
  finalParticleDistance: 76,
  evenParticleSize: 15,
  oddParticleSize: 11,
  initialParticleScale: 0.5,
  finalParticleScale: 1.35,
  particleDurationMs: 950,
  particleDelayStepMs: 40,
  particleColors: ["#FFD54A", "#FF8AC8", "#67D6B3", "#9B7CFF"] as const,
} as const;

export const fixedGiftCatalog: readonly GiftCatalogItem[] = [
  fixedGift("fish_10", "Dried Fish", 10, "gift_fish"),
  fixedGift("wand_20", "Teaser Wand", 20, "gift_wand"),
  fixedGift("yarn_50", "Yarn Ball", 50, "gift_yarn"),
  fixedGift("can_100", "Cat Can", 100, "gift_can"),
  fixedGift("tree_200", "Cat Tree", 200, "gift_tree"),
  fixedGift("bell_500", "Golden Bell", 500, "gift_bell"),
] as const;

export const giftAssetColors: Record<string, { halo: string; outline: string }> = {
  gift_fish: { halo: "#FF8A5B", outline: "#D85D34" },
  gift_wand: { halo: "#9B7CFF", outline: "#7557D8" },
  gift_yarn: { halo: "#FF7AAE", outline: "#D94E83" },
  gift_can: { halo: "#67D6B3", outline: "#2FAE88" },
  gift_tree: { halo: "#62C96B", outline: "#319244" },
  gift_bell: { halo: "#FFC94A", outline: "#B96A18" },
};

const giftLocalizationKeys: Record<string, string> = {
  fish_10: "gift.item.fish",
  wand_20: "gift.item.wand",
  yarn_50: "gift.item.yarn",
  can_100: "gift.item.can",
  tree_200: "gift.item.tree",
  bell_500: "gift.item.bell",
};

const retiredGiftIdentifiers = new Set(["game_entry_card", "prop_game_entry_card"]);
const idempotencyKeys = new Map<string, string>();

export function normalizeGiftCatalog(value: unknown): GiftCatalogItem[] {
  const record = asRecord(value);
  const raw = Array.isArray(value)
    ? value
    : [record?.gifts, record?.items, record?.catalog].find(Array.isArray) ?? [];
  return raw.flatMap((item) => {
    const normalized = normalizeGiftCatalogItem(item);
    return normalized && normalized.active !== false && isSupportedGift(normalized)
      ? [normalized]
      : [];
  }).sort((left, right) => {
    const leftOrder = left.sort_order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sort_order ?? Number.MAX_SAFE_INTEGER;
    return leftOrder === rightOrder
      ? left.gift_id.localeCompare(right.gift_id, undefined, { numeric: true })
      : leftOrder - rightOrder;
  });
}

export function normalizeGiftCatalogItem(value: unknown): GiftCatalogItem | null {
  const record = asRecord(value);
  if (!record) return null;
  const giftId = stringValue(record.gift_id, record.giftId, record.id) ?? "";
  const fixed = fixedGiftCatalog.find((item) => item.gift_id === giftId);
  const receiverCurrency = normalizedCurrency(
    stringValue(record.receiver_currency, record.receiverCurrency, record.currency),
  );
  if (receiverCurrency && receiverCurrency !== "gold_coin") return null;
  const item: GiftCatalogItem = {
    gift_id: giftId,
    name: stringValue(record.name, record.title) ?? fixed?.name ?? localizedFallbackTitle(),
    price: integerValue(record.price, record.amount, record.gold_coin_amount) ?? fixed?.price ?? 0,
    asset_key: stringValue(record.asset_key, record.assetKey) ?? fixed?.asset_key ?? "gift_fish",
    receiver_currency: "gold_coin",
  };
  assignOptional(item, "localized_name", localizedText(record.localized_name, record.localizedName));
  assignOptional(item, "remote_asset_key", stringValue(record.remote_asset_key, record.remoteAssetKey));
  assignOptional(item, "image_url", stringValue(record.image_url, record.imageUrl));
  assignOptional(item, "animation_asset_key", stringValue(record.animation_asset_key, record.animationAssetKey));
  assignOptional(item, "sort_order", integerValue(record.sort_order, record.sortOrder));
  assignOptional(item, "active", booleanValue(record.active));
  assignOptional(item, "badge_i18n", localizedText(record.badge_i18n));
  assignOptional(item, "min_app_version", stringValue(record.min_app_version));
  return item;
}

export function effectiveGiftCatalog(value: unknown): GiftCatalogItem[] {
  const normalized = normalizeGiftCatalog(value);
  return normalized.length > 0 ? normalized : [...fixedGiftCatalog];
}

export function giftDisplayAssetKey(gift: GiftCatalogItem): string {
  return gift.remote_asset_key?.trim() || gift.asset_key;
}

export function localizedGiftCatalogName(
  gift: GiftCatalogItem,
  language: string,
  translate: (key: string, ...args: (string | number)[]) => string,
): string {
  const localized = localizedDynamicValue(gift.localized_name, language);
  if (localized) return localized;
  const key = giftLocalizationKeys[gift.gift_id];
  return key ? translate(key) : gift.name;
}

export function parseGiftMessagePayload(content: string): GiftMessagePayload | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const fixed = fixedGiftCatalog.find((item) => item.gift_id === trimmed);
  if (fixed) return payloadFromFixed(fixed);
  try {
    const decoded: unknown = JSON.parse(trimmed);
    const record = asRecord(decoded);
    if (!record) return null;
    for (const key of ["gift", "payload", "data", "item", "content", "message"] as const) {
      const candidate = normalizeGiftMessagePayload(record[key]);
      if (candidate && isRenderableGiftPayload(candidate)) return candidate;
      const nestedId = stringValue(record[key]);
      const nestedFixed = fixedGiftCatalog.find((item) => item.gift_id === nestedId);
      if (nestedFixed) return payloadFromFixed(nestedFixed);
    }
    const direct = normalizeGiftMessagePayload(record);
    return direct && isRenderableGiftPayload(direct) ? direct : null;
  } catch {
    return null;
  }
}

export function normalizeGiftMessagePayload(value: unknown): GiftMessagePayload | null {
  const record = typeof value === "string" ? parseJSONRecord(value) : asRecord(value);
  if (!record) return null;
  const giftId = stringValue(record.gift_id, record.giftId, record.id) ?? "";
  const fixed = fixedGiftCatalog.find((item) => item.gift_id === giftId);
  const receiverCurrency = normalizedCurrency(
    stringValue(record.receiver_currency, record.receiverCurrency, record.currency),
  );
  if (receiverCurrency && receiverCurrency !== "gold_coin") return null;
  const payload: GiftMessagePayload = {
    gift_id: giftId,
    gift_name: stringValue(record.gift_name, record.giftName, record.name, record.title)
      ?? fixed?.name
      ?? localizedFallbackTitle(),
    asset_key: stringValue(record.asset_key, record.assetKey) ?? fixed?.asset_key ?? "gift_fish",
    gold_coin_amount: integerValue(record.gold_coin_amount, record.price) ?? fixed?.price ?? 0,
    receiver_currency: "gold_coin",
  };
  assignOptional(payload, "recipient_id", stringValue(
    record.recipient_id,
    record.recipientId,
    record.receiver_id,
    record.receiverId,
    record.to_user_id,
  ));
  assignOptional(payload, "recipient_name", stringValue(
    record.recipient_name,
    record.recipientName,
    record.receiver_name,
    record.receiver_nickname,
    record.to_nickname,
  ));
  assignOptional(payload, "sender_id", stringValue(record.sender_id, record.senderId));
  assignOptional(payload, "sender_name", stringValue(record.sender_name, record.sender_nickname));
  return payload;
}

export function encodeGiftMessagePayload(payload: GiftMessagePayload): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return payload.gift_id;
  }
}

export function makeGiftMessagePayload(
  gift: GiftCatalogItem,
  recipient: GiftRecipient,
  sender?: { id: string; name: string } | undefined,
): GiftMessagePayload {
  return {
    gift_id: gift.gift_id,
    gift_name: gift.name,
    asset_key: gift.asset_key,
    gold_coin_amount: gift.price,
    receiver_currency: "gold_coin",
    recipient_id: recipient.id,
    recipient_name: recipient.name,
    ...(sender ? { sender_id: sender.id, sender_name: sender.name } : {}),
  };
}

export function localizedGiftPayloadName(
  payload: GiftMessagePayload,
  translate: (key: string, ...args: (string | number)[]) => string,
): string {
  const fixed = fixedGiftCatalog.find((item) => item.gift_id === payload.gift_id);
  if (fixed) {
    const key = giftLocalizationKeys[fixed.gift_id];
    return key ? translate(key) : fixed.name;
  }
  return payload.gift_name === "礼物" ? translate("gift.title") : payload.gift_name;
}

export function giftMessagePreview(
  content: string,
  translate: (key: string, ...args: (string | number)[]) => string,
): string {
  const payload = parseGiftMessagePayload(content);
  return payload ? translate("message.giftWithName", localizedGiftPayloadName(payload, translate)) : content;
}

export function giftIdempotencyKey(recipientId: string, giftId: string): string {
  const scope = giftIdempotencyScope(recipientId, giftId);
  const existing = idempotencyKeys.get(scope);
  if (existing) return existing;
  const key = makeUUID();
  idempotencyKeys.set(scope, key);
  return key;
}

export function completeGiftIdempotency(recipientId: string, giftId: string): void {
  idempotencyKeys.delete(giftIdempotencyScope(recipientId, giftId));
}

export function giftAnimationRotation(assetKey: string): { initial: number; final: number } {
  switch (assetKey) {
    case "gift_fish": return { initial: -12, final: 10 };
    case "gift_wand": return { initial: -18, final: 8 };
    case "gift_yarn": return { initial: -35, final: 360 };
    case "gift_bell": return { initial: -14, final: 14 };
    default: return { initial: 0, final: 0 };
  }
}

export function giftParticleSymbol(assetKey: string): "heart.fill" | "pawprint.fill" | "dot.radiowaves.left.and.right" | "sparkle" {
  switch (assetKey) {
    case "gift_can": return "heart.fill";
    case "gift_tree": return "pawprint.fill";
    case "gift_bell": return "dot.radiowaves.left.and.right";
    default: return "sparkle";
  }
}

function fixedGift(giftId: string, name: string, price: number, assetKey: string): GiftCatalogItem {
  return {
    gift_id: giftId,
    name,
    price,
    asset_key: assetKey,
    active: true,
    receiver_currency: "gold_coin",
  };
}

function payloadFromFixed(gift: GiftCatalogItem): GiftMessagePayload {
  return {
    gift_id: gift.gift_id,
    gift_name: gift.name,
    asset_key: gift.asset_key,
    gold_coin_amount: gift.price,
    receiver_currency: "gold_coin",
  };
}

function isRenderableGiftPayload(payload: GiftMessagePayload): boolean {
  return payload.gift_id.trim().length > 0
    || (payload.gift_name.trim().length > 0 && payload.gift_name !== localizedFallbackTitle())
    || payload.gold_coin_amount > 0
    || (payload.asset_key.trim().length > 0 && payload.asset_key !== "gift_fish");
}

function isSupportedGift(gift: GiftCatalogItem): boolean {
  return [gift.gift_id, gift.asset_key, gift.remote_asset_key, gift.animation_asset_key]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLocaleLowerCase().replaceAll("-", "_"))
    .every((value) => !retiredGiftIdentifiers.has(value));
}

function localizedDynamicValue(value: Record<string, string> | undefined, language: string): string | null {
  if (!value) return null;
  for (const key of [language, language.split("-")[0] ?? "", "en", "zh-Hans"]) {
    const candidate = value[key]?.trim();
    if (candidate) return value[key] ?? null;
  }
  return null;
}

function localizedText(...values: unknown[]): Record<string, string> | undefined {
  const record = values.map(asRecord).find((item) => item !== null);
  if (!record) return undefined;
  const result = Object.entries(record).flatMap(([key, value]) => {
    const text = stringValue(value);
    return text ? [[key, text] as const] : [];
  });
  return result.length > 0 ? Object.fromEntries(result) : undefined;
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function integerValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.replaceAll(",", "")) : Number.NaN;
    if (Number.isFinite(numeric)) return Math.trunc(numeric);
  }
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (["true", "1", "yes"].includes(value.trim().toLocaleLowerCase())) return true;
    if (["false", "0", "no"].includes(value.trim().toLocaleLowerCase())) return false;
  }
  return undefined;
}

function normalizedCurrency(value: string | undefined): string | undefined {
  return value?.trim().toLocaleLowerCase().replaceAll("-", "_");
}

function parseJSONRecord(value: string): UnknownRecord | null {
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function assignOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function localizedFallbackTitle(): string {
  return "礼物";
}

function giftIdempotencyScope(recipientId: string, giftId: string): string {
  return `${recipientId}|${giftId}`;
}

function makeUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/gu, (token) => {
    const random = Math.floor(Math.random() * 16);
    return (token === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}
