import type { GroupMessageSearchResult } from "@/models";

export const groupSearchMessageTypes = [
  "",
  "text",
  "image",
  "video",
  "voice",
  "sticker",
  "gift",
  "file",
  "system",
] as const;

export type GroupSearchMessageType = (typeof groupSearchMessageTypes)[number];

export interface GroupMessageSearchFilters {
  senderId: string;
  messageType: GroupSearchMessageType;
  usesDateRange: boolean;
  from: Date;
  to: Date;
}

export function hasGroupMessageSearchInput(
  query: string,
  filters: GroupMessageSearchFilters,
): boolean {
  return (
    query.trim().length > 0 ||
    filters.senderId.length > 0 ||
    filters.messageType.length > 0 ||
    filters.usesDateRange
  );
}

export function hasActiveGroupMessageSearchFilters(filters: GroupMessageSearchFilters): boolean {
  return filters.senderId.length > 0 || filters.messageType.length > 0 || filters.usesDateRange;
}

export function groupMessageSearchDateRange(filters: GroupMessageSearchFilters): {
  from?: Date;
  to?: Date;
} {
  if (!filters.usesDateRange) return {};
  return filters.from.getTime() <= filters.to.getTime()
    ? { from: filters.from, to: filters.to }
    : { from: filters.to, to: filters.from };
}

export function appendUniqueGroupMessageSearchResults(
  current: readonly GroupMessageSearchResult[],
  next: readonly GroupMessageSearchResult[],
): GroupMessageSearchResult[] {
  const seen = new Set(current.map((item) => item.locator.message_id));
  return [...current, ...next.filter((item) => !seen.has(item.locator.message_id) && seen.add(item.locator.message_id))];
}

export function groupMessageSearchTypeTitleKey(type: GroupSearchMessageType): string {
  switch (type) {
    case "": return "group.search.type.all";
    case "text": return "group.search.type.text";
    case "image": return "message.image";
    case "video": return "message.video";
    case "voice": return "message.voice";
    case "sticker": return "message.sticker";
    case "gift": return "gift.title";
    case "file": return "group.search.type.file";
    case "system": return "group.search.type.system";
  }
}

export function groupMessageSearchPreview(
  result: GroupMessageSearchResult,
  translate: (key: string) => string,
): string {
  if (result.highlighted_text?.trim()) return result.highlighted_text.trim();
  switch (result.message.msg_type.trim().toLocaleLowerCase().replaceAll("-", "_")) {
    case "image": return translate("message.image");
    case "video": return translate("message.video");
    case "voice": return translate("message.voice");
    case "sticker": return translate("message.sticker");
    default: return result.message.content;
  }
}

export function initialGroupMessageSearchFilters(now = new Date()): GroupMessageSearchFilters {
  const from = new Date(now);
  from.setMonth(from.getMonth() - 1);
  return { senderId: "", messageType: "", usesDateRange: false, from, to: new Date(now) };
}
