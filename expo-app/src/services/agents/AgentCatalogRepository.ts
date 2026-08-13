import AsyncStorage from "@react-native-async-storage/async-storage";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type {
  AgentConversation,
  AgentConversationReadReceipt,
  AgentRuntimeConfig,
  AgentSummary,
  Conversation,
} from "@/models";
import {
  mergeAgentConversationSnapshots,
  mergeAgentConversationState,
} from "@/services/agents/AgentConversationState";

export const agentCatalogCachePolicy = {
  ttlMilliseconds: 5 * 60 * 1_000,
  staleRetentionMilliseconds: 90 * 24 * 60 * 60 * 1_000,
} as const;

export interface AgentCatalogSnapshot {
  runtimeConfig?: AgentRuntimeConfig | undefined;
  installedAgents: AgentSummary[];
  conversations: AgentConversation[];
  joinedScriptRooms: Conversation[];
  spendableBalance?: number | undefined;
}

interface StoredAgentCatalogSnapshot {
  value: AgentCatalogSnapshot;
  updatedAt: number;
  expiresAt: number;
}

const agentCatalogMutations = new Map<string, Promise<void>>();

type LegacyAgentCatalogSnapshot = Partial<AgentCatalogSnapshot> & {
  walletBalance?: unknown;
};

export interface CachedAgentCatalogSnapshot extends StoredAgentCatalogSnapshot {
  isStale: boolean;
}

export async function loadCachedAgentCatalog(
  ownerId: string,
  now = Date.now(),
): Promise<CachedAgentCatalogSnapshot | null> {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!owner) return null;
  const key = cacheKey(owner);
  await agentCatalogMutations.get(key)?.catch(() => undefined);
  return loadCachedAgentCatalogUnlocked(key, now);
}

async function loadCachedAgentCatalogUnlocked(
  key: string,
  now: number,
): Promise<CachedAgentCatalogSnapshot | null> {
  const encoded = await AsyncStorage.getItem(key);
  if (!encoded) return null;
  try {
    const stored = normalizeStoredSnapshot(JSON.parse(encoded));
    if (!stored) return null;
    if (now - stored.expiresAt > agentCatalogCachePolicy.staleRetentionMilliseconds) {
      return null;
    }
    return { ...stored, isStale: now >= stored.expiresAt };
  } catch {
    return null;
  }
}

export async function saveAgentCatalog(
  ownerId: string,
  value: AgentCatalogSnapshot,
  now = Date.now(),
): Promise<void> {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!owner) return;
  const key = cacheKey(owner);
  await enqueueAgentCatalogMutation(key, async () => {
    const cached = await loadCachedAgentCatalogUnlocked(key, now);
    const merged = cached
      ? {
          ...value,
          conversations: mergeAgentConversationSnapshots(
            cached.value.conversations,
            value.conversations,
          ),
        }
      : value;
    await saveAgentCatalogUnlocked(key, merged, now);
  });
}

async function saveAgentCatalogUnlocked(
  key: string,
  value: AgentCatalogSnapshot,
  now: number,
): Promise<void> {
  const stored: StoredAgentCatalogSnapshot = {
    value,
    updatedAt: now,
    expiresAt: now + agentCatalogCachePolicy.ttlMilliseconds,
  };
  await AsyncStorage.setItem(key, JSON.stringify(stored));
}

export async function invalidateAgentCatalog(ownerId: string): Promise<void> {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!owner) return;
  const key = cacheKey(owner);
  await enqueueAgentCatalogMutation(key, () => AsyncStorage.removeItem(key));
}

export async function upsertCachedAgentConversation(
  ownerId: string,
  conversation: AgentConversation,
  now = Date.now(),
): Promise<boolean> {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!owner) return false;
  const key = cacheKey(owner);
  return enqueueAgentCatalogMutation(key, async () => {
    const cached = await loadCachedAgentCatalogUnlocked(key, now);
    if (!cached) return false;
    const existing = cached.value.conversations.find(
      (candidate) => candidate.id === conversation.id,
    );
    const conversations = [
      mergeAgentConversationState(existing, conversation),
      ...cached.value.conversations.filter((candidate) => candidate.id !== conversation.id),
    ].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    await saveAgentCatalogUnlocked(key, { ...cached.value, conversations }, now);
    return true;
  });
}

export async function applyCachedAgentConversationReadReceipt(
  ownerId: string,
  receipt: AgentConversationReadReceipt,
  now = Date.now(),
): Promise<boolean> {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  const conversationId = receipt.conversation_id.trim();
  if (!owner || !conversationId) return false;
  const key = cacheKey(owner);
  return enqueueAgentCatalogMutation(key, async () => {
    const cached = await loadCachedAgentCatalogUnlocked(key, now);
    if (!cached) return false;
    let changed = false;
    const conversations = cached.value.conversations.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const currentRevision = conversation.revision;
      const receiptRevision = receipt.revision;
      if (
        receiptRevision !== undefined &&
        currentRevision !== undefined &&
        receiptRevision < currentRevision
      ) {
        return conversation;
      }
      const advancesRevision =
        receiptRevision !== undefined &&
        (currentRevision === undefined || receiptRevision > currentRevision);
      const currentThrough = conversation.read_through_sequence ?? 0;
      if (!advancesRevision && receipt.read_through_sequence < currentThrough) {
        return conversation;
      }
      const unreadCount = advancesRevision
        ? receipt.unread_count
        : Math.min(conversation.unread_count ?? receipt.unread_count, receipt.unread_count);
      const totalUnreadCount =
        receipt.total_unread_count === undefined
          ? conversation.total_unread_count
          : advancesRevision
            ? receipt.total_unread_count
            : Math.min(
                conversation.total_unread_count ?? receipt.total_unread_count,
                receipt.total_unread_count,
              );
      const next: AgentConversation = {
        ...conversation,
        unread_count: unreadCount,
        read_through_sequence: Math.max(currentThrough, receipt.read_through_sequence),
        ...(totalUnreadCount !== undefined ? { total_unread_count: totalUnreadCount } : {}),
        ...(receiptRevision !== undefined
          ? { revision: Math.max(currentRevision ?? 0, receiptRevision) }
          : {}),
      };
      changed = changed || !agentConversationReadStateEqual(conversation, next);
      return next;
    });
    if (!changed) return false;
    await saveAgentCatalogUnlocked(key, { ...cached.value, conversations }, now);
    return true;
  });
}

export function agentCatalogCacheKey(ownerId: string): string {
  return cacheKey(ownerId);
}

function cacheKey(ownerId: string): string {
  return `bwchat.agent-catalog-v1:account:${trimFoundationWhitespacesAndNewlines(ownerId)}:overview`;
}

async function enqueueAgentCatalogMutation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = agentCatalogMutations.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const barrier = result.then(
    () => undefined,
    () => undefined,
  );
  agentCatalogMutations.set(key, barrier);
  try {
    return await result;
  } finally {
    if (agentCatalogMutations.get(key) === barrier) agentCatalogMutations.delete(key);
  }
}

function agentConversationReadStateEqual(
  left: AgentConversation,
  right: AgentConversation,
): boolean {
  return (
    left.unread_count === right.unread_count &&
    left.read_through_sequence === right.read_through_sequence &&
    left.total_unread_count === right.total_unread_count &&
    left.revision === right.revision
  );
}

function normalizeStoredSnapshot(value: unknown): StoredAgentCatalogSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<StoredAgentCatalogSnapshot>;
  if (
    typeof candidate.updatedAt !== "number" ||
    typeof candidate.expiresAt !== "number" ||
    !candidate.value ||
    typeof candidate.value !== "object"
  ) {
    return null;
  }
  const legacy = candidate.value as LegacyAgentCatalogSnapshot;
  const spendableBalance =
    typeof legacy.spendableBalance === "number"
      ? legacy.spendableBalance
      : typeof legacy.walletBalance === "number"
        ? legacy.walletBalance
        : undefined;
  return {
    updatedAt: candidate.updatedAt,
    expiresAt: candidate.expiresAt,
    value: {
      ...(legacy.runtimeConfig ? { runtimeConfig: legacy.runtimeConfig } : {}),
      installedAgents: Array.isArray(legacy.installedAgents) ? legacy.installedAgents : [],
      conversations: Array.isArray(legacy.conversations) ? legacy.conversations : [],
      joinedScriptRooms: Array.isArray(legacy.joinedScriptRooms) ? legacy.joinedScriptRooms : [],
      ...(spendableBalance !== undefined ? { spendableBalance } : {}),
    },
  };
}
