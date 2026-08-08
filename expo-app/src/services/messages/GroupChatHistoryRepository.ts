import AsyncStorage from "@react-native-async-storage/async-storage";

import type { GroupMessage } from "@/models";

export const groupChatHistoryPolicy = Object.freeze({
  visiblePageSize: 30,
  syncPageSize: 100,
  maximumBackfillPages: 50,
  maximumCachedMessages: 5_000,
});

interface StoredGroupChatHistory {
  version: 1;
  messages: GroupMessage[];
}

const historyPrefix = "bwchat.group-message-history.v1";
const backfillPrefix = "bwchat.group-message-backfilled.v1";
const pendingWrites = new Map<string, Promise<void>>();

export interface GroupChatCachedPage {
  messages: GroupMessage[];
  hasMore: boolean;
  totalCount: number;
}

export async function readGroupChatCachedPage(
  ownerId: string,
  groupId: number,
  options: { beforeId?: number; limit?: number } = {},
): Promise<GroupChatCachedPage> {
  const all = await readGroupChatCachedMessages(ownerId, groupId);
  const candidates =
    options.beforeId === undefined ? all : all.filter((message) => message.id < options.beforeId!);
  const byServerId = [...candidates].sort((left, right) => left.id - right.id);
  const limit = Math.max(1, Math.trunc(options.limit ?? groupChatHistoryPolicy.visiblePageSize));
  const start = Math.max(0, byServerId.length - limit);
  return {
    messages: byServerId.slice(start).sort(compareMessages),
    hasMore: start > 0,
    totalCount: all.length,
  };
}

export async function readGroupChatCachedMessages(
  ownerId: string,
  groupId: number,
): Promise<GroupMessage[]> {
  const key = groupChatHistoryKey(ownerId, groupId);
  if (!key) return [];
  const encoded = await AsyncStorage.getItem(key);
  if (!encoded) return [];
  try {
    const value = JSON.parse(encoded) as Partial<StoredGroupChatHistory>;
    if (value.version !== 1 || !Array.isArray(value.messages)) return [];
    return value.messages
      .flatMap((candidate) => (isStoredGroupMessage(candidate) ? [candidate] : []))
      .filter((message) => message.group_id === groupId)
      .sort((left, right) => left.id - right.id)
      .slice(-groupChatHistoryPolicy.maximumCachedMessages)
      .sort(compareMessages);
  } catch {
    return [];
  }
}

export async function saveGroupChatMessages(
  ownerId: string,
  groupId: number,
  messages: readonly GroupMessage[],
): Promise<void> {
  const key = groupChatHistoryKey(ownerId, groupId);
  if (!key) return;
  const accepted = messages.filter((message) => message.id > 0 && message.group_id === groupId);
  if (accepted.length === 0) return;
  await serializeWrite(key, async () => {
    const current = await readGroupChatCachedMessages(ownerId, groupId);
    const merged = mergeGroupChatMessages(current, accepted)
      .sort((left, right) => left.id - right.id)
      .slice(-groupChatHistoryPolicy.maximumCachedMessages)
      .sort(compareMessages);
    const stored: StoredGroupChatHistory = { version: 1, messages: merged };
    await AsyncStorage.setItem(key, JSON.stringify(stored));
  });
}

export async function pruneGroupChatCachedMessagesThroughSequence(
  ownerId: string,
  groupId: number,
  throughSequence: number,
): Promise<void> {
  const key = groupChatHistoryKey(ownerId, groupId);
  if (!key || !Number.isSafeInteger(throughSequence) || throughSequence < 0) return;
  await serializeWrite(key, async () => {
    const remaining = (await readGroupChatCachedMessages(ownerId, groupId)).filter(
      (message) =>
        message.history_sequence === undefined || message.history_sequence > throughSequence,
    );
    const stored: StoredGroupChatHistory = { version: 1, messages: remaining };
    await AsyncStorage.setItem(key, JSON.stringify(stored));
  });
}

export async function isGroupChatHistoryBackfilled(
  ownerId: string,
  groupId: number,
): Promise<boolean> {
  const key = groupChatBackfillKey(ownerId, groupId);
  return key ? (await AsyncStorage.getItem(key)) === "1" : false;
}

export async function markGroupChatHistoryBackfilled(
  ownerId: string,
  groupId: number,
): Promise<void> {
  const key = groupChatBackfillKey(ownerId, groupId);
  if (key) await AsyncStorage.setItem(key, "1");
}

export function groupChatHistoryKey(ownerId: string, groupId: number): string | null {
  const owner = ownerId.trim();
  return owner && Number.isSafeInteger(groupId) && groupId > 0
    ? `${historyPrefix}:account:${encodeURIComponent(owner)}:group:${groupId}`
    : null;
}

export function groupChatBackfillKey(ownerId: string, groupId: number): string | null {
  const owner = ownerId.trim();
  return owner && Number.isSafeInteger(groupId) && groupId > 0
    ? `${backfillPrefix}:account:${encodeURIComponent(owner)}:group:${groupId}`
    : null;
}

export function mergeGroupChatMessages(
  current: readonly GroupMessage[],
  incoming: readonly GroupMessage[],
): GroupMessage[] {
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

function isStoredGroupMessage(value: unknown): value is GroupMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<GroupMessage>;
  return (
    typeof message.id === "number" &&
    Number.isSafeInteger(message.id) &&
    message.id > 0 &&
    typeof message.group_id === "number" &&
    Number.isSafeInteger(message.group_id) &&
    message.group_id > 0 &&
    typeof message.sender_id === "string" &&
    typeof message.msg_type === "string" &&
    typeof message.content === "string" &&
    typeof message.timestamp === "string" &&
    typeof message.sender_nickname === "string" &&
    typeof message.sender_avatar === "string" &&
    typeof message.mention_all === "boolean" &&
    typeof message.version === "number" &&
    Number.isFinite(message.version)
  );
}

function compareMessages(left: GroupMessage, right: GroupMessage): number {
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
