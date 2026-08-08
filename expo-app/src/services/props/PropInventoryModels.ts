export type LiveExperienceCardKind = "5m" | "10m" | "15m";
export type MediaUnlockKind = "image" | "video";

export interface PropBagItem {
  inventoryId: string;
  definitionId: string;
  type: string;
  name: string;
  description: string;
  iconUrl?: string | undefined;
  theme?: { colors?: string[] | undefined } | undefined;
  quantity: number;
  isEquipped: boolean;
  acquiredAt?: string | undefined;
  expiresAt?: string | undefined;
  availableActions: string[];
  metadata?: { mediaType?: string | undefined; durationSeconds?: number | undefined } | undefined;
}

export interface PropBagSummary { totalQuantity: number; equippedCount: number; expiringCount: number }
export interface PropBagPage { summary: PropBagSummary; items: PropBagItem[]; nextCursor?: string | undefined; serverTime?: string | undefined }
export interface PropConsumption { inventoryId?: string | undefined; definitionId: string; remainingQuantity: number }

export const liveExperienceKinds: LiveExperienceCardKind[] = ["5m", "10m", "15m"];

export function liveExperienceDefinition(kind: LiveExperienceCardKind): string { return `live_experience_card_${kind}`; }
export function liveExperienceMinutes(kind: LiveExperienceCardKind): number { return Number.parseInt(kind, 10); }
export function liveExperienceDuration(kind: LiveExperienceCardKind): number { return liveExperienceMinutes(kind) * 60; }

export function liveExperienceKindFromDefinition(value: string | undefined): LiveExperienceCardKind | undefined {
  return value ? liveExperienceKinds.find((kind) => liveExperienceDefinition(kind) === value) : undefined;
}

export function normalizePropBagPage(value: unknown): PropBagPage {
  const source = unwrap(value);
  const items = arrayValue(source.items).map(normalizePropBagItem).filter(notNull).filter((item) => item.quantity > 0 && item.definitionId !== "game_entry_card");
  return {
    summary: propBagSummary(items),
    items,
    ...optionalString("nextCursor", source.next_cursor, source.nextCursor),
    ...optionalString("serverTime", source.server_time, source.serverTime),
  };
}

export function normalizePropBagItem(value: unknown): PropBagItem | null {
  if (!isRecord(value)) return null;
  const inventoryId = stringValue(value.inventory_id, value.inventoryId);
  const definitionId = stringValue(value.definition_id, value.definitionId);
  if (!inventoryId || !definitionId) return null;
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;
  const theme = isRecord(value.theme) ? value.theme : undefined;
  return {
    inventoryId,
    definitionId,
    type: stringValue(value.type) ?? "utility",
    name: stringValue(value.name) ?? "",
    description: stringValue(value.description) ?? "",
    ...optionalString("iconUrl", value.icon_url, value.iconUrl),
    ...(theme ? { theme: { colors: arrayValue(theme.colors).map((item) => stringValue(item)).filter(notNull) } } : {}),
    quantity: Math.max(0, intValue(value.quantity) ?? 0),
    isEquipped: boolValue(value.is_equipped, value.isEquipped) ?? false,
    ...optionalString("acquiredAt", value.acquired_at, value.acquiredAt),
    ...optionalString("expiresAt", value.expires_at, value.expiresAt),
    availableActions: arrayValue(value.available_actions ?? value.availableActions).map((item) => stringValue(item)).filter(notNull),
    ...(metadata ? { metadata: {
      ...optionalString("mediaType", metadata.media_type, metadata.mediaType),
      ...(intValue(metadata.duration_seconds, metadata.durationSeconds) !== undefined ? { durationSeconds: intValue(metadata.duration_seconds, metadata.durationSeconds) } : {}),
    } } : {}),
  };
}

export function propLiveExperienceKind(item: PropBagItem): LiveExperienceCardKind | undefined {
  const direct = liveExperienceKinds.find((kind) => liveExperienceDefinition(kind) === item.definitionId);
  if (direct) return direct;
  if (item.type !== "live_experience_card") return undefined;
  return liveExperienceKinds.find((kind) => liveExperienceDuration(kind) === item.metadata?.durationSeconds);
}

export function canConsumeLiveExperience(item: PropBagItem): boolean {
  return Boolean(propLiveExperienceKind(item) && item.quantity > 0 && item.availableActions.includes("consume_for_live_experience"));
}

export function propMediaUnlockKind(item: PropBagItem): MediaUnlockKind | undefined {
  if (item.definitionId === "media_unlock_card_image") return "image";
  if (item.definitionId === "media_unlock_card_video") return "video";
  if (item.type !== "media_unlock_card") return undefined;
  return item.metadata?.mediaType?.trim().toLowerCase() === "video" ? "video" : item.metadata?.mediaType ? "image" : undefined;
}

export function mediaUnlockDefinition(kind: MediaUnlockKind): string {
  return `media_unlock_card_${kind}`;
}

export function canConsumeMediaUnlock(item: PropBagItem): boolean {
  return Boolean(
    propMediaUnlockKind(item)
    && item.quantity > 0
    && item.availableActions.includes("consume_for_media_unlock"),
  );
}

export function propBagSummary(items: PropBagItem[], now = Date.now()): PropBagSummary {
  return {
    totalQuantity: items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
    equippedCount: items.filter((item) => item.isEquipped).length,
    expiringCount: items.filter((item) => {
      const expires = item.expiresAt ? Date.parse(item.expiresAt) : Number.NaN;
      return Number.isFinite(expires) && expires >= now && expires - now <= 7 * 24 * 60 * 60 * 1_000;
    }).length,
  };
}

export function applyPropConsumption(items: PropBagItem[], consumption: PropConsumption | undefined, fallbackDefinitionId: string, requiredAction: string): PropBagItem[] {
  const definitionId = consumption?.definitionId || fallbackDefinitionId;
  const receiptInventoryIndex = consumption?.inventoryId
    ? items.findIndex((item) => item.inventoryId === consumption.inventoryId)
    : -1;
  const targetInventoryIndex = receiptInventoryIndex >= 0
    ? receiptInventoryIndex
    : items.findIndex((item) => item.definitionId === definitionId && item.quantity > 0 && item.availableActions.includes(requiredAction));
  if (targetInventoryIndex < 0) return items;
  return items.map((item, index) => {
    if (index !== targetInventoryIndex) return item;
    return {
      ...item,
      quantity: Math.max(0, consumption?.remainingQuantity ?? item.quantity - 1),
    };
  }).filter((item) => item.quantity > 0);
}

export function normalizePropConsumption(value: unknown): PropConsumption | undefined {
  if (!isRecord(value)) return undefined;
  const definitionId = stringValue(value.definition_id, value.definitionId);
  if (!definitionId) return undefined;
  return { ...optionalString("inventoryId", value.inventory_id, value.inventoryId), definitionId, remainingQuantity: Math.max(0, intValue(value.remaining_quantity, value.remainingQuantity) ?? 0) };
}

export function liveExperienceReservation(value: unknown): PropConsumption | undefined {
  if (!isRecord(value)) return undefined;
  const experience = recordValue(value.live_experience, value.liveExperience, value.experience) ?? value;
  return normalizePropConsumption(recordValue(experience.reserved_prop, experience.reservedProp));
}

export function liveExperienceCardKind(value: unknown): LiveExperienceCardKind | undefined {
  if (!isRecord(value)) return undefined;
  const experience = recordValue(value.live_experience, value.liveExperience, value.experience) ?? value;
  const direct = liveExperienceKindFromDefinition(stringValue(experience.definition_id, experience.definitionId, experience.prop_definition_id, experience.propDefinitionId));
  if (direct) return direct;
  const duration = intValue(experience.duration_seconds, experience.durationSeconds);
  return liveExperienceKinds.find((kind) => liveExperienceDuration(kind) === duration);
}

function unwrap(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw new Error("Prop bag response is invalid"); return isRecord(value.data) ? unwrap(value.data) : value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(...values: unknown[]): string | undefined { for (const value of values) if ((typeof value === "string" || typeof value === "number") && String(value).trim()) return String(value).trim(); return undefined; }
function intValue(...values: unknown[]): number | undefined { const value = stringValue(...values); const number = Number(value); return value !== undefined && Number.isFinite(number) ? Math.trunc(number) : undefined; }
function boolValue(...values: unknown[]): boolean | undefined { for (const value of values) { if (typeof value === "boolean") return value; if (value === 1 || value === "1" || value === "true") return true; if (value === 0 || value === "0" || value === "false") return false; } return undefined; }
function recordValue(...values: unknown[]): Record<string, unknown> | undefined { return values.find(isRecord); }
function optionalString<Key extends string>(key: Key, ...values: unknown[]): Partial<Record<Key, string>> { const value = stringValue(...values); return value ? { [key]: value } as Partial<Record<Key, string>> : {}; }
function notNull<T>(value: T | null | undefined): value is T { return value !== null && value !== undefined; }
