import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  loadCachedConversationSnapshot,
  setCachedConversationPinned,
} from "@/services/conversations/ConversationRepository";

const keyPrefix = "bwchat.group-pinned.v1";

export async function readGroupPinned(ownerId: string, groupId: number): Promise<boolean> {
  const stored = await AsyncStorage.getItem(cacheKey(ownerId, groupId));
  if (stored !== null) return stored === "true";
  const snapshot = await loadCachedConversationSnapshot(ownerId);
  return (
    snapshot?.conversations.find(
      (conversation) =>
        conversation.type === "group" &&
        String(conversation.group_id ?? conversation.id) === String(groupId),
    )?.is_pinned ?? false
  );
}

export async function saveGroupPinned(
  ownerId: string,
  groupId: number,
  isPinned: boolean,
): Promise<void> {
  await AsyncStorage.setItem(cacheKey(ownerId, groupId), String(isPinned));
  await setCachedConversationPinned(ownerId, "group", String(groupId), isPinned);
}

function cacheKey(ownerId: string, groupId: number): string {
  return `${keyPrefix}:${encodeURIComponent(ownerId)}:${groupId}`;
}
