import AsyncStorage from "@react-native-async-storage/async-storage";

const keyPrefix = "bwchat.chat-draft.v1";

export interface ChatDraftQuote {
  message_id: number;
  sender_id: string;
  sender_name: string;
  msg_type: string;
  content: string;
  timestamp: string;
}

export interface ChatDraftSnapshot {
  text: string;
  quote?: ChatDraftQuote | undefined;
  mentions?: ChatDraftMentionSpan[] | undefined;
}

export interface ChatDraftMentionSpan {
  user_id?: string | undefined;
  kind: "direct" | "all";
  location_utf16: number;
  length_utf16: number;
}

export async function readChatDraft(
  ownerId: string,
  conversationId: string,
  conversationType: "dm" | "group" = "dm",
): Promise<string> {
  return (await readChatDraftSnapshot(ownerId, conversationId, conversationType)).text;
}

export async function saveChatDraft(
  ownerId: string,
  conversationId: string,
  text: string,
  conversationType: "dm" | "group" = "dm",
): Promise<void> {
  await saveChatDraftSnapshot(ownerId, conversationId, { text }, conversationType);
}

export async function readChatDraftSnapshot(
  ownerId: string,
  conversationId: string,
  conversationType: "dm" | "group" = "dm",
): Promise<ChatDraftSnapshot> {
  const raw = await AsyncStorage.getItem(key(ownerId, conversationType, conversationId));
  if (!raw) return { text: "" };
  try {
    const value: unknown = JSON.parse(raw);
    if (isDraftRecord(value)) {
      const quote = parseQuote(value.quote);
      const mentions = parseMentions(value.mentions, value.text.length);
      return { text: value.text, ...(quote ? { quote } : {}), ...(mentions.length > 0 ? { mentions } : {}) };
    }
  } catch {
    // Older builds stored the draft as a plain string.
  }
  return { text: raw };
}

export async function saveChatDraftSnapshot(
  ownerId: string,
  conversationId: string,
  snapshot: ChatDraftSnapshot,
  conversationType: "dm" | "group" = "dm",
): Promise<void> {
  const storageKey = key(ownerId, conversationType, conversationId);
  if (snapshot.text.length === 0 && !snapshot.quote && !snapshot.mentions?.length) {
    await AsyncStorage.removeItem(storageKey);
  } else {
    await AsyncStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      text: snapshot.text,
      ...(snapshot.quote ? { quote: snapshot.quote } : {}),
      ...(snapshot.mentions?.length ? { mentions: snapshot.mentions } : {}),
    }));
  }
}

function key(ownerId: string, conversationType: "dm" | "group", conversationId: string): string {
  return `${keyPrefix}:${encodeURIComponent(ownerId)}:${conversationType}:${encodeURIComponent(conversationId)}`;
}

function isDraftRecord(value: unknown): value is { version: number; text: string; quote?: unknown; mentions?: unknown } {
  return typeof value === "object" && value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { text?: unknown }).text === "string";
}

function parseMentions(value: unknown, textLength: number): ChatDraftMentionSpan[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const span = item as Partial<ChatDraftMentionSpan>;
    if (
      (span.kind !== "direct" && span.kind !== "all") ||
      !Number.isInteger(span.location_utf16) || (span.location_utf16 ?? -1) < 0 ||
      !Number.isInteger(span.length_utf16) || (span.length_utf16 ?? 0) <= 0 ||
      (span.location_utf16 ?? 0) + (span.length_utf16 ?? 0) > textLength ||
      (span.kind === "direct" && (typeof span.user_id !== "string" || !span.user_id.trim()))
    ) return [];
    return [{
      ...(span.kind === "direct" ? { user_id: span.user_id!.trim() } : {}),
      kind: span.kind,
      location_utf16: span.location_utf16!,
      length_utf16: span.length_utf16!,
    }];
  }).sort((left, right) => left.location_utf16 - right.location_utf16);
}

function parseQuote(value: unknown): ChatDraftQuote | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const quote = value as Partial<ChatDraftQuote>;
  if (
    typeof quote.message_id !== "number" || !Number.isFinite(quote.message_id) ||
    typeof quote.sender_id !== "string" ||
    typeof quote.sender_name !== "string" ||
    typeof quote.msg_type !== "string" ||
    typeof quote.content !== "string" ||
    typeof quote.timestamp !== "string"
  ) return undefined;
  return {
    message_id: quote.message_id,
    sender_id: quote.sender_id,
    sender_name: quote.sender_name,
    msg_type: quote.msg_type,
    content: quote.content,
    timestamp: quote.timestamp,
  };
}
