import AsyncStorage from "@react-native-async-storage/async-storage";

const keyPrefix = "bwchat.chat-hidden-messages.v1";

export async function readHiddenChatMessageIds(
  ownerId: string,
  scope: "dm" | "group",
  targetId: string,
): Promise<Set<number>> {
  const raw = await AsyncStorage.getItem(key(ownerId, scope, targetId));
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0));
  } catch {
    return new Set();
  }
}

export async function hideChatMessagesLocally(
  ownerId: string,
  scope: "dm" | "group",
  targetId: string,
  messageIds: readonly number[],
): Promise<Set<number>> {
  const hidden = await readHiddenChatMessageIds(ownerId, scope, targetId);
  for (const id of messageIds) {
    if (Number.isSafeInteger(id) && id > 0) hidden.add(id);
  }
  await AsyncStorage.setItem(key(ownerId, scope, targetId), JSON.stringify([...hidden].sort((a, b) => a - b)));
  return hidden;
}

export function filterLocallyHiddenChatMessages<T extends { id: number }>(
  messages: readonly T[],
  hiddenIds: ReadonlySet<number>,
): T[] {
  return messages.filter((message) => message.id <= 0 || !hiddenIds.has(message.id));
}

function key(ownerId: string, scope: "dm" | "group", targetId: string): string {
  return `${keyPrefix}:${encodeURIComponent(ownerId)}:${scope}:${encodeURIComponent(targetId)}`;
}
