import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeAgentConversation, normalizeAgentMessage } from "@/api/normalizers";
import type { AgentConversation, AgentMessage } from "@/models";

export const agentChatCachePolicy = Object.freeze({
  ttlMilliseconds: 5 * 60 * 1_000,
  staleRetentionMilliseconds: 365 * 24 * 60 * 60 * 1_000,
});

export interface AgentChatCachedPage {
  conversation?: AgentConversation | undefined;
  messages: AgentMessage[];
  hasMore: boolean;
  updatedAt: number;
  expiresAt: number;
  isStale: boolean;
}

interface StoredAgentChatPage {
  conversation?: unknown;
  messages: unknown[];
  hasMore: boolean;
  updatedAt: number;
  expiresAt: number;
}

export async function loadAgentChatPage(
  ownerId: string,
  conversationId: string,
  now = Date.now(),
): Promise<AgentChatCachedPage | null> {
  const key = agentChatCacheKey(ownerId, conversationId);
  if (!key) return null;
  const encoded = await AsyncStorage.getItem(key);
  if (!encoded) return null;
  try {
    const stored = JSON.parse(encoded) as Partial<StoredAgentChatPage>;
    if (
      !Array.isArray(stored.messages) ||
      typeof stored.hasMore !== "boolean" ||
      typeof stored.updatedAt !== "number" ||
      typeof stored.expiresAt !== "number" ||
      now - stored.expiresAt > agentChatCachePolicy.staleRetentionMilliseconds
    ) {
      return null;
    }
    let conversation: AgentConversation | undefined;
    if (stored.conversation !== undefined) {
      try {
        const normalized = normalizeAgentConversation(stored.conversation);
        if (normalized.id) conversation = normalized;
      } catch {
        // Keep older message-only cache entries readable.
      }
    }
    return {
      ...(conversation ? { conversation } : {}),
      messages: stored.messages.map(normalizeAgentMessage).filter((message) => message.id),
      hasMore: stored.hasMore,
      updatedAt: stored.updatedAt,
      expiresAt: stored.expiresAt,
      isStale: now >= stored.expiresAt,
    };
  } catch {
    return null;
  }
}

export async function saveAgentChatPage(
  ownerId: string,
  conversationId: string,
  messages: readonly AgentMessage[],
  hasMore: boolean,
  conversation: AgentConversation | null = null,
  now = Date.now(),
): Promise<void> {
  const key = agentChatCacheKey(ownerId, conversationId);
  if (!key) return;
  const stored: StoredAgentChatPage = {
    ...(conversation ? { conversation } : {}),
    messages: [...messages],
    hasMore,
    updatedAt: now,
    expiresAt: now + agentChatCachePolicy.ttlMilliseconds,
  };
  await AsyncStorage.setItem(key, JSON.stringify(stored));
}

export async function clearAgentChatPage(ownerId: string, conversationId: string): Promise<void> {
  const key = agentChatCacheKey(ownerId, conversationId);
  if (key) await AsyncStorage.removeItem(key);
}

export function agentChatCacheKey(ownerId: string, conversationId: string): string | null {
  const owner = ownerId.trim();
  const conversation = conversationId.trim();
  return owner && conversation
    ? `bwchat.agent-messages-v1:account:${encodeURIComponent(owner)}:conversation:${encodeURIComponent(conversation)}`
    : null;
}
