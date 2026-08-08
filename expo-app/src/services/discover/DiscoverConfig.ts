import type { DynamicRoute } from "@/services/remote-config/types";

export interface DiscoverConfigMeta {
  refreshIntervalSeconds?: number | undefined;
  generatedAt?: string | undefined;
}

export interface DiscoverItem {
  id: string;
  titleKey?: string | undefined;
  title?: string | undefined;
  titleI18n?: Record<string, string> | undefined;
  systemImage?: string | undefined;
  colors?: string[] | undefined;
  badgeKey?: string | undefined;
  badgeCount?: number | undefined;
  dotKey?: string | undefined;
  showsDot?: boolean | undefined;
  enabled?: boolean | undefined;
  order?: number | undefined;
  route?: DynamicRoute | undefined;
}

export interface DiscoverSection {
  id: string;
  enabled?: boolean | undefined;
  order?: number | undefined;
  items: DiscoverItem[];
}

export interface DiscoverConfigData {
  schemaVersion?: number | undefined;
  sections: DiscoverSection[];
  meta?: DiscoverConfigMeta | undefined;
}

export const defaultDiscoverSections: DiscoverSection[] = [
  {
    id: "social",
    order: 10,
    items: [{
      id: "moments",
      titleKey: "discover.moments",
      systemImage: "camera.fill",
      colors: ["667EEA", "764BA2"],
      badgeKey: "moments_unread",
      dotKey: "moments_new",
      order: 10,
      route: { type: "native", name: "moments" },
    }],
  },
  {
    id: "entertainment",
    order: 20,
    items: [
      { id: "games", titleKey: "discover.games", systemImage: "gamecontroller.fill", colors: ["FF6B6B", "FF8E53"], order: 10, route: { type: "native", name: "game_center" } },
      { id: "stories", titleKey: "discover.stories", systemImage: "book.closed.fill", colors: ["7F5AF0", "FF7A90"], order: 20, route: { type: "native", name: "script_center" } },
      { id: "short_drama", titleKey: "discover.shortDrama", systemImage: "play.rectangle.fill", colors: ["00C6FF", "0072FF"], order: 30, route: { type: "native", name: "short_drama" } },
      { id: "live", titleKey: "discover.live", systemImage: "video.fill", colors: ["FF4D8D", "FF8A3D"], order: 40, route: { type: "coming_soon" } },
    ],
  },
  {
    id: "community",
    order: 30,
    items: [{ id: "groups", titleKey: "discover.groups", systemImage: "person.3.fill", colors: ["34C759", "00B894"], order: 10, route: { type: "native", name: "groups" } }],
  },
  {
    id: "benefits",
    order: 40,
    items: [{ id: "benefits", titleKey: "discover.benefits", systemImage: "gift.fill", colors: ["FFB703", "FB8500"], order: 10, route: { type: "native", name: "activity_center" } }],
  },
];

const defaultSectionIds = ["social", "entertainment", "community", "benefits"] as const;
const defaultSectionOrders: Record<string, number> = { social: 10, entertainment: 20, community: 30, benefits: 40 };
const defaultItemSectionIds: Record<string, string> = {
  moments: "social",
  games: "entertainment",
  stories: "entertainment",
  short_drama: "entertainment",
  live: "entertainment",
  groups: "community",
  benefits: "benefits",
};
const defaultItemOrders: Record<string, number> = { moments: 10, games: 10, stories: 20, short_drama: 30, live: 40, groups: 10, benefits: 10 };
const movedOutOfDiscover = new Set(["nearby", "map", "map_dating"]);

export function parseDiscoverConfig(value: unknown): DiscoverConfigData {
  const root = unwrapDiscover(value);
  const sections = arrayValue(root.sections).map(normalizeSection).filter(notNull);
  return {
    ...(numberValue(root.schema_version, root.schemaVersion) !== undefined
      ? { schemaVersion: numberValue(root.schema_version, root.schemaVersion) }
      : {}),
    sections,
    ...(isRecord(root.meta) ? {
      meta: {
        ...(numberValue(root.meta.refresh_interval_seconds, root.meta.refreshIntervalSeconds) !== undefined
          ? { refreshIntervalSeconds: numberValue(root.meta.refresh_interval_seconds, root.meta.refreshIntervalSeconds) }
          : {}),
        ...(stringValue(root.meta.generated_at, root.meta.generatedAt)
          ? { generatedAt: stringValue(root.meta.generated_at, root.meta.generatedAt) }
          : {}),
      },
    } : {}),
  };
}

export function effectiveDiscoverSections(config: DiscoverConfigData): DiscoverSection[] {
  const normalized = config.sections
    .filter((section) => section.enabled !== false)
    .sort(byOrder)
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => item.enabled !== false && normalizeToken(item.route?.type ?? "coming_soon") !== "disabled")
        .sort(byOrder),
    }))
    .filter((section) => section.items.length > 0);
  return preserveDefaultBlocks(normalized);
}

export function discoverItemTitle(
  item: DiscoverItem,
  language: string,
  translate: (key: string) => string,
): string {
  const preferred = preferredTitleKey(item.id);
  if (preferred) {
    const localized = translate(preferred);
    if (localized !== preferred) return localized;
  }
  const translated = localizedValue(item.titleI18n, language);
  if (translated) return translated;
  const titleKey = item.titleKey?.trim();
  if (titleKey) {
    const localized = translate(titleKey);
    if (localized !== titleKey) return localized;
  }
  return item.title?.trim() || item.id;
}

export function normalizeDiscoverColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().replace(/[^a-fA-F0-9]/g, "");
  if ((cleaned.length !== 6 && cleaned.length !== 8) || !/^[a-fA-F0-9]+$/.test(cleaned)) return undefined;
  return `#${cleaned}`;
}

export function normalizeToken(value: string): string {
  return value.trim().replaceAll("-", "_").toLocaleLowerCase();
}

function preserveDefaultBlocks(sections: DiscoverSection[]): DiscoverSection[] {
  const defaultItems = new Map<string, DiscoverItem[]>();
  const customSections: DiscoverSection[] = [];
  for (const section of sections) {
    const custom: DiscoverItem[] = [];
    for (const item of section.items) {
      const id = normalizeToken(item.id);
      if (movedOutOfDiscover.has(id)) continue;
      const defaultSection = defaultItemSectionIds[id];
      if (defaultSection) {
        const next = { ...item, order: defaultItemOrders[id] ?? item.order };
        defaultItems.set(defaultSection, [...(defaultItems.get(defaultSection) ?? []), next]);
      } else {
        custom.push(item);
      }
    }
    if (custom.length > 0) customSections.push({ ...section, items: custom.sort(byOrder) });
  }
  const stableSections = defaultSectionIds.flatMap((id) => {
    const items = defaultItems.get(id);
    if (!items?.length) return [];
    const source = sections.find((section) => normalizeToken(section.id) === id);
    return [{ id, enabled: true, order: source?.order ?? defaultSectionOrders[id], items: items.sort(byOrder) }];
  });
  return [...stableSections, ...customSections].sort(byOrder);
}

function normalizeSection(value: unknown): DiscoverSection | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  return {
    id,
    ...(boolValue(value.enabled) !== undefined ? { enabled: boolValue(value.enabled) } : {}),
    ...(numberValue(value.order) !== undefined ? { order: numberValue(value.order) } : {}),
    items: arrayValue(value.items).map(normalizeItem).filter(notNull),
  };
}

function normalizeItem(value: unknown): DiscoverItem | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  return {
    id,
    ...optionalString("titleKey", value.title_key, value.titleKey),
    ...optionalString("title", value.title),
    ...optionalStringMap("titleI18n", value.title_i18n, value.titleI18n),
    ...optionalString("systemImage", value.system_image, value.systemImage),
    ...(arrayValue(value.colors).map((color) => stringValue(color)).filter(notNull).length > 0
      ? { colors: arrayValue(value.colors).map((color) => stringValue(color)).filter(notNull) }
      : {}),
    ...optionalString("badgeKey", value.badge_key, value.badgeKey),
    ...(numberValue(value.badge_count, value.badgeCount) !== undefined ? { badgeCount: numberValue(value.badge_count, value.badgeCount) } : {}),
    ...optionalString("dotKey", value.dot_key, value.dotKey),
    ...(boolValue(value.shows_dot, value.showsDot) !== undefined ? { showsDot: boolValue(value.shows_dot, value.showsDot) } : {}),
    ...(boolValue(value.enabled) !== undefined ? { enabled: boolValue(value.enabled) } : {}),
    ...(numberValue(value.order) !== undefined ? { order: numberValue(value.order) } : {}),
    ...(isRecord(value.route) ? { route: normalizeRoute(value.route) } : {}),
  };
}

function normalizeRoute(value: Record<string, unknown>): DynamicRoute {
  return {
    ...optionalString("type", value.type),
    ...optionalString("name", value.name),
    ...optionalString("url", value.url),
    ...optionalString("screenId", value.screen_id, value.screenId),
    ...optionalString("titleKey", value.title_key, value.titleKey),
    ...optionalString("title", value.title),
    ...optionalStringMap("titleI18n", value.title_i18n, value.titleI18n),
    ...optionalString("messageKey", value.message_key, value.messageKey),
    ...optionalString("message", value.message),
    ...optionalStringMap("messageI18n", value.message_i18n, value.messageI18n),
    ...(isRecord(value.params) ? { params: value.params } : {}),
  };
}

function unwrapDiscover(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Discover config payload is invalid");
  if (isRecord(value.data)) return unwrapDiscover(value.data);
  if (isRecord(value.config)) return unwrapDiscover(value.config);
  return value;
}

function localizedValue(values: Record<string, string> | undefined, language: string): string | undefined {
  if (!values) return undefined;
  const normalized = language.replaceAll("_", "-");
  const base = normalized.split("-")[0] ?? "";
  for (const key of [language, normalized, base, "en"]) {
    const value = values[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function preferredTitleKey(id: string): string | undefined {
  switch (normalizeToken(id)) {
    case "live": return "discover.live";
    case "groups":
    case "group":
    case "group_list": return "discover.groups";
    case "benefits": return "discover.benefits";
    default: return undefined;
  }
}

function byOrder<T extends { order?: number | undefined }>(left: T, right: T): number {
  return (left.order ?? 0) - (right.order ?? 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}
function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}
function boolValue(...values: unknown[]): boolean | undefined {
  for (const value of values) if (typeof value === "boolean") return value;
  return undefined;
}
function optionalString<Key extends string>(key: Key, ...values: unknown[]): Partial<Record<Key, string>> {
  const value = stringValue(...values);
  return value ? { [key]: value } as Partial<Record<Key, string>> : {};
}
function optionalStringMap<Key extends string>(key: Key, ...values: unknown[]): Partial<Record<Key, Record<string, string>>> {
  const source = values.find(isRecord);
  if (!source) return {};
  const result = Object.fromEntries(Object.entries(source).flatMap(([entryKey, entryValue]) => {
    const text = stringValue(entryValue);
    return text ? [[entryKey, text]] : [];
  }));
  return Object.keys(result).length > 0 ? { [key]: result } as Partial<Record<Key, Record<string, string>>> : {};
}
function notNull<T>(value: T | null | undefined): value is T { return value !== null && value !== undefined; }
