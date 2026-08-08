import type { GroupMember } from "@/models";

export type ChatMentionKind = "direct" | "all";

export interface ChatMentionSpan {
  user_id?: string | undefined;
  kind: ChatMentionKind;
  location_utf16: number;
  length_utf16: number;
}

export interface ChatMentionSelection {
  user_id?: string | undefined;
  nickname: string;
  kind: ChatMentionKind;
}

export interface ChatComposerDocument {
  text: string;
  mentions: ChatMentionSpan[];
}

export interface ChatTextRange {
  location: number;
  length: number;
}

export function mentionedUserIds(document: ChatComposerDocument): string[] {
  return [...new Set(document.mentions.flatMap((span) => span.kind === "direct" && span.user_id ? [span.user_id] : []))].sort();
}

export function mentionsAll(document: ChatComposerDocument): boolean {
  return document.mentions.some((span) => span.kind === "all");
}

export function insertChatMentions(
  selections: readonly ChatMentionSelection[],
  replacementRange: ChatTextRange | null,
  document: ChatComposerDocument,
  selectedRange: ChatTextRange,
): { document: ChatComposerDocument; selectedRange: ChatTextRange } {
  let next = cloneDocument(document);
  const cursor = { ...selectedRange };
  const firstRange = replacementRange ?? selectedRange;
  selections.forEach((selection, index) => {
    const range = { ...(index === 0 ? firstRange : cursor) };
    const token = `@${selection.nickname} `;
    next = replaceMentionText(range, token, next);
    cursor.location = range.location + token.length;
    cursor.length = 0;
    next.mentions.push({
      ...(selection.user_id ? { user_id: selection.user_id } : {}),
      kind: selection.kind,
      location_utf16: range.location,
      length_utf16: Math.max(token.length - 1, 1),
    });
    next.mentions.sort((left, right) => left.location_utf16 - right.location_utf16);
  });
  return { document: next, selectedRange: { ...cursor } };
}

export function applyChatMentionEdit(
  range: ChatTextRange,
  replacementText: string,
  document: ChatComposerDocument,
): { document: ChatComposerDocument; selectedRange: ChatTextRange; handledAtomically: boolean } {
  const source = document.text;
  const safeRange = clampedRange(range, source.length);
  const deletesOneCharacter = replacementText.length === 0 && safeRange.length === 1;
  const deletedCharacter = safeRange.location < source.length
    ? source.slice(safeRange.location, safeRange.location + safeRange.length)
    : "";
  const deletesMentionSeparator = deletesOneCharacter && /\s/u.test(deletedCharacter);
  const intersecting = document.mentions.filter((span) => {
    const spanRange = mentionRange(span);
    return intersectionLength(spanRange, safeRange) > 0
      || (safeRange.length === 0 && locationInRange(safeRange.location, spanRange))
      || (deletesMentionSeparator && safeRange.location === rangeEnd(spanRange));
  });
  const expanded = intersecting.reduce((partial, span) => unionRange(partial, mentionRange(span)), safeRange);
  const next = replaceMentionText(expanded, replacementText, document);
  return {
    document: next,
    selectedRange: { location: expanded.location + replacementText.length, length: 0 },
    handledAtomically: intersecting.length > 0,
  };
}

export function isStandaloneAtInsertion(text: string, range: ChatTextRange, replacement: string): boolean {
  if (replacement !== "@") return false;
  if (range.location <= 0) return true;
  if (range.location > text.length) return false;
  return /\s/u.test(text.slice(range.location - 1, range.location));
}

export function deriveChatTextEdit(before: string, after: string): { range: ChatTextRange; replacementText: string } {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1)
  ) suffix += 1;
  return {
    range: { location: prefix, length: before.length - prefix - suffix },
    replacementText: after.slice(prefix, after.length - suffix),
  };
}

export function normalizeMentionMembers(members: readonly GroupMember[], excludingUserId?: string): GroupMember[] {
  const excluded = excludingUserId?.trim();
  const byId = new Map<string, GroupMember>();
  for (const member of members) {
    const userId = member.user_id.trim();
    if (!userId || userId === excluded) continue;
    const candidate: GroupMember = {
      user_id: userId,
      nickname: member.nickname.trim() || userId,
      avatar_url: member.avatar_url,
      role: member.role.trim() || "member",
      ...(member.group_nickname?.trim() ? { group_nickname: member.group_nickname.trim() } : {}),
    };
    const existing = byId.get(userId);
    if (!existing) {
      byId.set(userId, candidate);
      continue;
    }
    byId.set(userId, {
      ...existing,
      nickname: existing.nickname === userId && candidate.nickname !== userId ? candidate.nickname : existing.nickname,
      avatar_url: existing.avatar_url.trim() ? existing.avatar_url : candidate.avatar_url,
      role: existing.role === "member" && candidate.role !== "member" ? candidate.role : existing.role,
      ...(existing.group_nickname || candidate.group_nickname ? { group_nickname: existing.group_nickname ?? candidate.group_nickname } : {}),
    });
  }
  return [...byId.values()].sort((left, right) => {
    const name = left.nickname.localeCompare(right.nickname, undefined, { sensitivity: "base" });
    return name !== 0 ? name : left.user_id.localeCompare(right.user_id, undefined, { sensitivity: "base" });
  });
}

export function mentionSelectionId(selection: ChatMentionSelection): string {
  return selection.kind === "all" ? "mention:all" : `mention:${selection.user_id ?? selection.nickname}`;
}

function replaceMentionText(range: ChatTextRange, replacementText: string, document: ChatComposerDocument): ChatComposerDocument {
  const safe = clampedRange(range, document.text.length);
  const delta = replacementText.length - safe.length;
  const mentions = document.mentions.flatMap((span) => {
    const spanRange = mentionRange(span);
    if (intersectionLength(spanRange, safe) > 0 || (safe.length === 0 && locationInRange(safe.location, spanRange))) return [];
    return [{
      ...span,
      location_utf16: span.location_utf16 >= rangeEnd(safe) ? span.location_utf16 + delta : span.location_utf16,
    }];
  });
  return {
    text: document.text.slice(0, safe.location) + replacementText + document.text.slice(rangeEnd(safe)),
    mentions,
  };
}

function cloneDocument(document: ChatComposerDocument): ChatComposerDocument {
  return { text: document.text, mentions: document.mentions.map((span) => ({ ...span })) };
}

function mentionRange(span: ChatMentionSpan): ChatTextRange {
  return { location: span.location_utf16, length: span.length_utf16 };
}

function clampedRange(range: ChatTextRange, textLength: number): ChatTextRange {
  const location = Math.min(Math.max(range.location, 0), textLength);
  return { location, length: Math.min(Math.max(range.length, 0), textLength - location) };
}

function rangeEnd(range: ChatTextRange): number {
  return range.location + range.length;
}

function locationInRange(location: number, range: ChatTextRange): boolean {
  return location >= range.location && location < rangeEnd(range);
}

function intersectionLength(left: ChatTextRange, right: ChatTextRange): number {
  return Math.max(0, Math.min(rangeEnd(left), rangeEnd(right)) - Math.max(left.location, right.location));
}

function unionRange(left: ChatTextRange, right: ChatTextRange): ChatTextRange {
  const location = Math.min(left.location, right.location);
  return { location, length: Math.max(rangeEnd(left), rangeEnd(right)) - location };
}
