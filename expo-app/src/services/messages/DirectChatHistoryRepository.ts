import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Message } from "@/models";

export const directChatHistoryPolicy = Object.freeze({
  visiblePageSize: 30,
  syncPageSize: 100,
  maximumBackfillPages: 50,
  maximumCachedMessages: 5_000,
});

interface StoredDirectChatHistory {
  version: 1;
  messages: Message[];
}

const historyPrefix = "bwchat.direct-message-history.v1";
const backfillPrefix = "bwchat.direct-message-backfilled.v1";
const pendingWrites = new Map<string, Promise<void>>();

export interface DirectChatCachedPage {
  messages: Message[];
  hasMore: boolean;
  totalCount: number;
}

export async function readDirectChatCachedPage(
  ownerId: string,
  contactId: string,
  options: { beforeId?: number; limit?: number } = {},
): Promise<DirectChatCachedPage> {
  const all = await readDirectChatCachedMessages(ownerId, contactId);
  const candidates =
    options.beforeId === undefined ? all : all.filter((message) => message.id < options.beforeId!);
  const byServerId = [...candidates].sort((left, right) => left.id - right.id);
  const limit = Math.max(1, Math.trunc(options.limit ?? directChatHistoryPolicy.visiblePageSize));
  const start = Math.max(0, byServerId.length - limit);
  return {
    messages: byServerId.slice(start).sort(compareMessages),
    hasMore: start > 0,
    totalCount: all.length,
  };
}

export async function readDirectChatCachedMessages(
  ownerId: string,
  contactId: string,
): Promise<Message[]> {
  const key = directChatHistoryKey(ownerId, contactId);
  if (!key) return [];
  const encoded = await AsyncStorage.getItem(key);
  if (!encoded) return [];
  try {
    const value = JSON.parse(encoded) as Partial<StoredDirectChatHistory>;
    if (value.version !== 1 || !Array.isArray(value.messages)) return [];
    return value.messages
      .flatMap((candidate) => (isStoredMessage(candidate) ? [candidate] : []))
      .filter((message) => isDirectParticipant(message, ownerId, contactId))
      .sort(compareMessages)
      .slice(-directChatHistoryPolicy.maximumCachedMessages);
  } catch {
    return [];
  }
}

export async function saveDirectChatMessages(
  ownerId: string,
  contactId: string,
  messages: readonly Message[],
): Promise<void> {
  const key = directChatHistoryKey(ownerId, contactId);
  if (!key) return;
  const accepted = messages.filter(
    (message) => message.id > 0 && isDirectParticipant(message, ownerId, contactId),
  );
  if (accepted.length === 0) return;
  await serializeWrite(key, async () => {
    const current = await readDirectChatCachedMessages(ownerId, contactId);
    const merged = mergeDirectChatMessages(current, accepted).slice(
      -directChatHistoryPolicy.maximumCachedMessages,
    );
    const stored: StoredDirectChatHistory = { version: 1, messages: merged };
    await AsyncStorage.setItem(key, JSON.stringify(stored));
  });
}

export async function pruneDirectChatCachedMessagesThrough(
  ownerId: string,
  contactId: string,
  throughMessageId: number,
): Promise<void> {
  const key = directChatHistoryKey(ownerId, contactId);
  if (!key || !Number.isSafeInteger(throughMessageId) || throughMessageId < 0) return;
  await serializeWrite(key, async () => {
    const remaining = (await readDirectChatCachedMessages(ownerId, contactId)).filter(
      (message) => message.id > throughMessageId,
    );
    const stored: StoredDirectChatHistory = { version: 1, messages: remaining };
    await AsyncStorage.setItem(key, JSON.stringify(stored));
  });
}

export async function isDirectChatHistoryBackfilled(
  ownerId: string,
  contactId: string,
): Promise<boolean> {
  const key = directChatBackfillKey(ownerId, contactId);
  return key ? (await AsyncStorage.getItem(key)) === "1" : false;
}

export async function markDirectChatHistoryBackfilled(
  ownerId: string,
  contactId: string,
): Promise<void> {
  const key = directChatBackfillKey(ownerId, contactId);
  if (key) await AsyncStorage.setItem(key, "1");
}

export function directChatHistoryKey(ownerId: string, contactId: string): string | null {
  const owner = ownerId.trim();
  const contact = contactId.trim();
  return owner && contact
    ? `${historyPrefix}:account:${encodeURIComponent(owner)}:contact:${encodeURIComponent(contact)}`
    : null;
}

export function directChatBackfillKey(ownerId: string, contactId: string): string | null {
  const owner = ownerId.trim();
  const contact = contactId.trim();
  return owner && contact
    ? `${backfillPrefix}:account:${encodeURIComponent(owner)}:contact:${encodeURIComponent(contact)}`
    : null;
}

export function mergeDirectChatMessages(
  current: readonly Message[],
  incoming: readonly Message[],
): Message[] {
  const next = [...current];
  for (const message of incoming) {
    const index = next.findIndex(
      (candidate) =>
        candidate.id === message.id ||
        (Boolean(candidate.client_message_id) &&
          candidate.client_message_id === message.client_message_id),
    );
    if (index < 0) {
      next.push(message);
      continue;
    }
    const existing = next[index]!;
    if (message.version < existing.version) continue;
    next[index] = {
      ...message,
      ...(message.client_message_id || !existing.client_message_id
        ? {}
        : { client_message_id: existing.client_message_id }),
    };
  }
  return next.sort(compareMessages);
}

function isDirectParticipant(message: Message, ownerId: string, contactId: string): boolean {
  return (
    (message.sender_id === ownerId && message.receiver_id === contactId) ||
    (message.sender_id === contactId && message.receiver_id === ownerId)
  );
}

function isStoredMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<Message>;
  return (
    typeof message.id === "number" &&
    Number.isSafeInteger(message.id) &&
    message.id > 0 &&
    typeof message.sender_id === "string" &&
    typeof message.receiver_id === "string" &&
    typeof message.msg_type === "string" &&
    typeof message.content === "string" &&
    typeof message.timestamp === "string" &&
    typeof message.version === "number" &&
    Number.isFinite(message.version)
  );
}

function compareMessages(left: Message, right: Message): number {
  if (left.id > 0 && right.id > 0 && left.id !== right.id) return left.id - right.id;
  const timeDifference = timestampValue(left.timestamp) - timestampValue(right.timestamp);
  return timeDifference !== 0 ? timeDifference : left.id - right.id;
}

function timestampValue(value: string): number {
  const result = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(result) ? result : 0;
}

async function serializeWrite(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  pendingWrites.set(key, current);
  try {
    await current;
  } finally {
    if (pendingWrites.get(key) === current) pendingWrites.delete(key);
  }
}
