import { useSyncExternalStore } from "react";

import type { Conversation } from "@/models";
import {
  aggregateConversationUnread,
  conversationListIdentity,
} from "@/services/conversations/ConversationListPolicy";

type Listener = () => void;

const countsByOwner = new Map<string, number>();
const conversationCountsByOwner = new Map<string, ReadonlyMap<string, number>>();
const listeners = new Set<Listener>();

export function publishConversationUnread(
  ownerId: string,
  conversations: readonly Conversation[],
): number {
  const owner = ownerId.trim();
  if (!owner) return 0;
  const count = aggregateConversationUnread(conversations);
  const conversationCounts = new Map(
    conversations.map((conversation) => [
      conversationListIdentity(conversation),
      Math.max(0, Math.trunc(conversation.unread_count)),
    ]),
  );
  const rowsChanged = !conversationCountMapsEqual(
    conversationCountsByOwner.get(owner),
    conversationCounts,
  );
  if (countsByOwner.get(owner) === count && !rowsChanged) return count;
  countsByOwner.set(owner, count);
  conversationCountsByOwner.set(owner, conversationCounts);
  for (const listener of listeners) listener();
  return count;
}

export function conversationUnreadSnapshot(ownerId: string): number {
  const owner = ownerId.trim();
  return owner ? (countsByOwner.get(owner) ?? 0) : 0;
}

export function subscribeConversationUnread(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useConversationUnread(ownerId: string): number {
  return useSyncExternalStore(
    subscribeConversationUnread,
    () => conversationUnreadSnapshot(ownerId),
    () => 0,
  );
}

export function conversationUnreadCountSnapshot(
  ownerId: string,
  identity: string,
): number | undefined {
  const owner = ownerId.trim();
  const normalizedIdentity = identity.trim();
  if (!owner || !normalizedIdentity) return undefined;
  return conversationCountsByOwner.get(owner)?.get(normalizedIdentity);
}

export function useConversationUnreadCount(ownerId: string, identity: string): number | undefined {
  return useSyncExternalStore(
    subscribeConversationUnread,
    () => conversationUnreadCountSnapshot(ownerId, identity),
    () => undefined,
  );
}

export function conversationUnreadBadgeText(count: number): string | null {
  const normalized = Math.max(0, Math.trunc(count));
  if (normalized === 0) return null;
  return normalized > 99 ? "99+" : String(normalized);
}

export function resetConversationUnreadStoreForTests(): void {
  countsByOwner.clear();
  conversationCountsByOwner.clear();
  listeners.clear();
}

function conversationCountMapsEqual(
  current: ReadonlyMap<string, number> | undefined,
  next: ReadonlyMap<string, number>,
): boolean {
  if (!current || current.size !== next.size) return false;
  for (const [identity, count] of next) {
    if (current.get(identity) !== count) return false;
  }
  return true;
}
