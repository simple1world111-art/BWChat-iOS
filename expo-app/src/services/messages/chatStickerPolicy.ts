export type StickerLocalizedText = Record<string, string>;

export interface ChatEmojiItem {
  id: string;
  emoji?: string | undefined;
  value?: string | undefined;
  name?: StickerLocalizedText | undefined;
  order?: number | undefined;
}

export interface ChatStickerItem {
  id: string;
  packId?: string | undefined;
  assetKey?: string | undefined;
  name?: StickerLocalizedText | undefined;
  width?: number | undefined;
  height?: number | undefined;
  order?: number | undefined;
}

export interface ChatStickerPack {
  id: string;
  name?: StickerLocalizedText | undefined;
  order?: number | undefined;
  enabled?: boolean | undefined;
  coverAssetKey?: string | undefined;
  packType?: string | undefined;
  inputMode?: string | undefined;
  coverEmoji?: string | undefined;
  insertsIntoText?: boolean | undefined;
  sendAsSticker?: boolean | undefined;
  emojiCount?: number | undefined;
  emojis: ChatEmojiItem[];
  stickers: ChatStickerItem[];
}

export interface ChatStickerMessagePayload {
  stickerId: string;
  packId: string;
  assetKey: string;
  name?: StickerLocalizedText | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

export interface ChatRemoteAsset {
  key: string;
  url: string;
  sha256?: string | undefined;
  contentType?: string | undefined;
  byteSize?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  cachePolicy?: string | undefined;
  fallbackAssetName?: string | undefined;
}

export interface ChatRemoteAssetManifest {
  version?: string | undefined;
  generatedAt?: string | undefined;
  assets: ChatRemoteAsset[];
}

export interface ComposerTextSelection {
  start: number;
  end: number;
}

export const chatStickerPanelPolicy = {
  preferredHeight: 250,
  minimumHeight: 220,
  backgroundOpacity: 0.98,
  tabSpacing: 8,
  tabHorizontalPadding: 14,
  tabVerticalPadding: 8,
  tabContentSpacing: 5,
  tabItemHorizontalPadding: 12,
  tabHeight: 32,
  tabEmojiFontSize: 20,
  tabArtworkSize: 22,
  tabNameFontSize: 13,
  selectedTabOpacity: 0.12,
  emojiColumns: 8,
  emojiColumnSpacing: 2,
  emojiRowSpacing: 4,
  emojiHorizontalPadding: 10,
  emojiVerticalPadding: 8,
  emojiFontSize: 28,
  emojiMinimumHeight: 44,
  stickerColumns: 4,
  stickerColumnSpacing: 10,
  stickerRowSpacing: 12,
  stickerPadding: 14,
  stickerArtworkSize: 54,
  stickerLabelSpacing: 4,
  stickerLabelFontSize: 10,
  stickerMinimumHeight: 76,
  emptySpacing: 10,
  emptyIconSize: 28,
  emptyTextFontSize: 13,
} as const;

export const chatComposerSurfacePolicy = {
  transitionDurationMs: 250,
  actionButtonWidth: 42,
  actionButtonHeight: 54,
  toggleSymbolSize: 28,
  plusColumns: 4,
  plusColumnSpacing: 12,
  plusItemHeight: 76,
  plusRowSpacing: 18,
  plusVerticalPadding: 16,
} as const;

export function chatComposerPlusPanelHeight(itemCount: number): number {
  const rows = Math.max(
    1,
    Math.ceil(Math.max(0, itemCount) / chatComposerSurfacePolicy.plusColumns),
  );
  return (
    chatComposerSurfacePolicy.plusVerticalPadding * 2 +
    rows * chatComposerSurfacePolicy.plusItemHeight +
    Math.max(0, rows - 1) * chatComposerSurfacePolicy.plusRowSpacing
  );
}

export function chatComposerPlusItemWidth(panelWidth: number): number {
  if (!Number.isFinite(panelWidth) || panelWidth <= 0) return 0;
  return Math.max(
    0,
    (panelWidth -
      chatComposerSurfacePolicy.plusColumnSpacing * (chatComposerSurfacePolicy.plusColumns - 1)) /
      chatComposerSurfacePolicy.plusColumns,
  );
}

export const chatStickerBubblePolicy = {
  maximumArtworkSide: 148,
  artworkPadding: 8,
  cornerRadius: 14,
  outgoingBackgroundOpacity: 0.18,
  incomingBackgroundOpacity: 0.72,
  shadowOpacity: 0.06,
  shadowRadius: 4,
  shadowOffsetY: 2,
  senderSpacing: 4,
  senderFontSize: 12,
  fallbackCornerRadius: 12,
  fallbackFillOpacity: 0.08,
  fallbackBorderOpacity: 0.18,
  fallbackBorderWidth: 1,
  fallbackFontSize: 12,
  fallbackMinimumScale: 0.65,
  fallbackPadding: 6,
} as const;

export const chatRemoteAssetPolicy = {
  maximumSingleFileBytes: 8 * 1024 * 1024,
  allowedImageContentTypes: ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"],
  bannedExtensions: ["dylib", "framework", "ipa", "swiftbundle", "jsbundle", "wasm", "lua", "js"],
} as const;

export const fallbackChatEmojiValues = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😆",
  "😅",
  "😂",
  "🤣",
  "😊",
  "🙂",
  "🙃",
  "😉",
  "😍",
  "🥰",
  "😘",
  "😋",
  "😎",
  "🤩",
  "🥳",
  "😏",
  "😔",
  "😢",
  "😭",
  "😤",
  "😡",
  "🤯",
  "😱",
  "😳",
  "🥺",
  "😴",
  "🤔",
  "🤗",
  "🤭",
  "🤫",
  "🙄",
  "😬",
  "👍",
  "👎",
  "👏",
  "🙏",
  "💪",
  "👌",
  "✌️",
  "🤝",
  "❤️",
  "💛",
  "💚",
  "💙",
  "💜",
  "🖤",
  "💯",
  "🎉",
  "🔥",
  "✨",
  "🌟",
  "🐱",
  "🐾",
] as const;

export const fallbackChatEmojiPack: ChatStickerPack = {
  id: "emoji_default",
  name: { "zh-Hans": "表情", "zh-Hant": "表情", en: "Emoji", ja: "絵文字" },
  order: 0,
  enabled: true,
  coverAssetKey: "",
  packType: "emoji",
  inputMode: "insert_text",
  coverEmoji: "😀",
  insertsIntoText: true,
  sendAsSticker: false,
  emojiCount: fallbackChatEmojiValues.length,
  emojis: fallbackChatEmojiValues.map((value, index) => ({
    id: `fallback_${index}`,
    emoji: value,
    value,
    order: (index + 1) * 10,
  })),
  stickers: [],
};

export function normalizeChatStickerPacks(value: unknown): ChatStickerPack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const id = stringValue(record.id, record.pack_id);
    if (id === undefined) return [];
    const pack: ChatStickerPack = {
      id,
      emojis: normalizeEmojiItems(record.emojis),
      stickers: normalizeStickerItems(record.stickers),
    };
    assignOptional(pack, "name", localizedText(record.name, record.title));
    assignOptional(pack, "order", integerValue(record.order, record.sort_order));
    assignOptional(pack, "enabled", booleanValue(record.enabled));
    assignOptional(
      pack,
      "coverAssetKey",
      stringValue(record.cover_asset_key, record.coverAssetKey),
    );
    assignOptional(pack, "packType", stringValue(record.pack_type, record.packType));
    assignOptional(pack, "inputMode", stringValue(record.input_mode, record.inputMode));
    assignOptional(pack, "coverEmoji", stringValue(record.cover_emoji, record.coverEmoji));
    assignOptional(
      pack,
      "insertsIntoText",
      booleanValue(record.inserts_into_text, record.insertsIntoText),
    );
    assignOptional(
      pack,
      "sendAsSticker",
      booleanValue(record.send_as_sticker, record.sendAsSticker),
    );
    assignOptional(pack, "emojiCount", integerValue(record.emoji_count, record.emojiCount));
    return [pack];
  });
}

export function effectiveChatStickerPacks(value: unknown): ChatStickerPack[] {
  const packs = normalizeChatStickerPacks(value).filter(
    (pack) =>
      pack.id.trim().length > 0 &&
      pack.enabled !== false &&
      (isChatEmojiPack(pack) ? pack.emojis.length > 0 : pack.stickers.length > 0),
  );
  const emojiIndex = packs.findIndex((pack) => pack.id === "emoji_default");
  if (emojiIndex > 0) {
    const [emoji] = packs.splice(emojiIndex, 1);
    if (emoji) packs.unshift(emoji);
  } else if (emojiIndex < 0) {
    packs.unshift(fallbackChatEmojiPack);
  }
  return packs;
}

export function isChatEmojiPack(pack: ChatStickerPack): boolean {
  return (
    pack.packType?.toLocaleLowerCase() === "emoji" ||
    pack.inputMode?.toLocaleLowerCase() === "insert_text" ||
    pack.id.toLocaleLowerCase() === "emoji_default" ||
    pack.insertsIntoText === true
  );
}

export function sortedChatEmojiItems(pack: ChatStickerPack): ChatEmojiItem[] {
  return pack.emojis
    .filter((item) => item.id.trim().length > 0 && chatEmojiInsertionValue(item) !== null)
    .sort(compareOrderedStickerItems);
}

export function sortedChatStickerItems(pack: ChatStickerPack): ChatStickerItem[] {
  return pack.stickers
    .filter((item) => item.id.trim().length > 0 && (item.assetKey ?? "").trim().length > 0)
    .sort(compareOrderedStickerItems);
}

export function chatEmojiInsertionValue(item: ChatEmojiItem): string | null {
  const emoji = item.emoji?.trim();
  if (emoji) return item.emoji ?? null;
  const value = item.value?.trim();
  return value ? (item.value ?? null) : null;
}

export function localizedChatStickerText(
  value: StickerLocalizedText | undefined,
  language: string,
): string | null {
  if (!value) return null;
  const candidates = [language, language, language.split("-")[0] ?? "", "en", "zh-Hans"];
  for (const key of candidates) {
    const candidate = value[key]?.trim();
    if (candidate) return value[key] ?? null;
  }
  return null;
}

export function chatStickerPackName(pack: ChatStickerPack, language: string): string {
  return localizedChatStickerText(pack.name, language) ?? pack.id;
}

export function chatStickerItemName(item: ChatStickerItem, language: string): string {
  return localizedChatStickerText(item.name, language) ?? item.id;
}

export function chatEmojiItemName(item: ChatEmojiItem, language: string): string {
  return localizedChatStickerText(item.name, language) ?? item.id;
}

export function makeChatStickerMessagePayload(
  pack: ChatStickerPack,
  sticker: ChatStickerItem,
): ChatStickerMessagePayload {
  const payload: ChatStickerMessagePayload = {
    stickerId: sticker.id,
    packId: pack.id,
    assetKey: sticker.assetKey ?? sticker.id,
  };
  assignOptional(payload, "name", sticker.name);
  assignOptional(payload, "width", sticker.width);
  assignOptional(payload, "height", sticker.height);
  return payload;
}

export function encodeChatStickerMessagePayload(payload: ChatStickerMessagePayload): string {
  const encoded: Record<string, unknown> = {
    sticker_id: payload.stickerId,
    pack_id: payload.packId,
    asset_key: payload.assetKey,
  };
  if (payload.name !== undefined) encoded.name = payload.name;
  if (payload.width !== undefined) encoded.width = payload.width;
  if (payload.height !== undefined) encoded.height = payload.height;
  try {
    return JSON.stringify(encoded);
  } catch {
    return payload.assetKey;
  }
}

export function parseChatStickerMessagePayload(content: string): ChatStickerMessagePayload | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const record = asRecord(JSON.parse(trimmed) as unknown);
      const stickerId = stringValue(record?.sticker_id);
      const packId = stringValue(record?.pack_id);
      const assetKey = stringValue(record?.asset_key);
      if (record && stickerId !== undefined && packId !== undefined && assetKey !== undefined) {
        const payload: ChatStickerMessagePayload = { stickerId, packId, assetKey };
        assignOptional(payload, "name", localizedText(record.name));
        assignOptional(payload, "width", integerValue(record.width));
        assignOptional(payload, "height", integerValue(record.height));
        return payload;
      }
    } catch {
      // Swift falls through to the legacy single-key payload when JSON decoding fails.
    }
  }
  return { stickerId: trimmed, packId: "", assetKey: trimmed };
}

export function chatStickerArtworkSize(
  payload: Pick<ChatStickerMessagePayload, "width" | "height">,
): { width: number; height: number } {
  const maximum = chatStickerBubblePolicy.maximumArtworkSide;
  const width = payload.width;
  const height = payload.height;
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return { width: maximum, height: maximum };
  }
  const scale = Math.min(maximum / width, maximum / height, 1);
  return { width: width * scale, height: height * scale };
}

export function insertChatComposerText(
  text: string,
  selection: ComposerTextSelection,
  value: string,
): { text: string; selection: ComposerTextSelection } {
  if (!value) return { text, selection };
  const location = Math.min(Math.max(selection.start, 0), text.length);
  const selectedEnd = Math.min(Math.max(selection.end, location), text.length);
  const nextText = `${text.slice(0, location)}${value}${text.slice(selectedEnd)}`;
  const cursor = location + value.length;
  return { text: nextText, selection: { start: cursor, end: cursor } };
}

export function normalizeChatRemoteAssetManifest(value: unknown): ChatRemoteAssetManifest | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.assets)) return null;
  const assets = record.assets.flatMap((item) => {
    const asset = asRecord(item);
    const key = stringValue(asset?.key);
    const url = stringValue(asset?.url);
    if (!asset || key === undefined || url === undefined) return [];
    const normalized: ChatRemoteAsset = { key, url };
    assignOptional(normalized, "sha256", stringValue(asset.sha256));
    assignOptional(normalized, "contentType", stringValue(asset.content_type, asset.contentType));
    assignOptional(normalized, "byteSize", integerValue(asset.byte_size, asset.byteSize));
    assignOptional(normalized, "width", integerValue(asset.width));
    assignOptional(normalized, "height", integerValue(asset.height));
    assignOptional(normalized, "cachePolicy", stringValue(asset.cache_policy, asset.cachePolicy));
    assignOptional(
      normalized,
      "fallbackAssetName",
      stringValue(asset.fallback_asset_name, asset.fallbackAssetName),
    );
    return [normalized];
  });
  const manifest: ChatRemoteAssetManifest = { assets };
  assignOptional(manifest, "version", stringValue(record.version));
  assignOptional(manifest, "generatedAt", stringValue(record.generated_at, record.generatedAt));
  return manifest;
}

export function trustedChatStickerRemoteAsset(
  assetKey: string | undefined,
  manifestValue: unknown,
): ChatRemoteAsset | null {
  if (!assetKey?.trim()) return null;
  const asset = normalizeChatRemoteAssetManifest(manifestValue)?.assets.find(
    (item) => item.key === assetKey,
  );
  if (!asset || !isAllowedChatRemoteAsset(asset)) return null;
  return asset;
}

export function isAllowedChatRemoteAsset(asset: ChatRemoteAsset): boolean {
  let parsed: URL;
  try {
    parsed = new URL(asset.url);
  } catch {
    return false;
  }
  if (parsed.protocol.toLocaleLowerCase() !== "https:") return false;
  const extension = parsed.pathname.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (chatRemoteAssetPolicy.bannedExtensions.includes(extension as never)) return false;
  if (asset.byteSize !== undefined && asset.byteSize > chatRemoteAssetPolicy.maximumSingleFileBytes)
    return false;
  const contentType = normalizedRemoteAssetContentType(asset.contentType);
  return (
    contentType !== null &&
    chatRemoteAssetPolicy.allowedImageContentTypes.includes(contentType as never)
  );
}

export function normalizedRemoteAssetContentType(value: string | undefined): string | null {
  const normalized = value?.split(";", 1)[0]?.trim().toLocaleLowerCase();
  return normalized || null;
}

function normalizeEmojiItems(value: unknown): ChatEmojiItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const id = stringValue(record?.id, record?.emoji_id);
    if (!record || id === undefined) return [];
    const normalized: ChatEmojiItem = { id };
    assignOptional(normalized, "emoji", stringValue(record.emoji));
    assignOptional(normalized, "value", stringValue(record.value));
    assignOptional(normalized, "name", localizedText(record.name));
    assignOptional(normalized, "order", integerValue(record.order, record.sort_order));
    return [normalized];
  });
}

function normalizeStickerItems(value: unknown): ChatStickerItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const id = stringValue(record?.id, record?.sticker_id);
    if (!record || id === undefined) return [];
    const normalized: ChatStickerItem = { id };
    assignOptional(normalized, "packId", stringValue(record.pack_id, record.packId));
    assignOptional(normalized, "assetKey", stringValue(record.asset_key, record.assetKey));
    assignOptional(normalized, "name", localizedText(record.name));
    assignOptional(normalized, "width", integerValue(record.width));
    assignOptional(normalized, "height", integerValue(record.height));
    assignOptional(normalized, "order", integerValue(record.order, record.sort_order));
    return [normalized];
  });
}

function compareOrderedStickerItems(
  left: { id: string; order?: number | undefined },
  right: { id: string; order?: number | undefined },
): number {
  const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: "base" });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function integerValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number)) return Math.trunc(number);
  }
  return undefined;
}

function booleanValue(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function localizedText(...values: unknown[]): StickerLocalizedText | undefined {
  for (const value of values) {
    const record = asRecord(value);
    if (!record) continue;
    const entries = Object.entries(record).flatMap(([key, item]) =>
      typeof item === "string" ? [[key, item] as const] : [],
    );
    if (entries.length > 0) return Object.fromEntries(entries);
  }
  return undefined;
}

function assignOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}
