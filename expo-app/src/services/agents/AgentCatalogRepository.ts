import AsyncStorage from "@react-native-async-storage/async-storage";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type { AgentConversation, AgentRuntimeConfig, AgentSummary, Conversation } from "@/models";

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
  if (!trimFoundationWhitespacesAndNewlines(ownerId)) return null;
  const encoded = await AsyncStorage.getItem(cacheKey(ownerId));
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
  if (!trimFoundationWhitespacesAndNewlines(ownerId)) return;
  const stored: StoredAgentCatalogSnapshot = {
    value,
    updatedAt: now,
    expiresAt: now + agentCatalogCachePolicy.ttlMilliseconds,
  };
  await AsyncStorage.setItem(cacheKey(ownerId), JSON.stringify(stored));
}

export async function invalidateAgentCatalog(ownerId: string): Promise<void> {
  if (trimFoundationWhitespacesAndNewlines(ownerId)) {
    await AsyncStorage.removeItem(cacheKey(ownerId));
  }
}

export async function upsertCachedAgentConversation(
  ownerId: string,
  conversation: AgentConversation,
  now = Date.now(),
): Promise<boolean> {
  const cached = await loadCachedAgentCatalog(ownerId, now);
  if (!cached) return false;
  const conversations = [
    conversation,
    ...cached.value.conversations.filter((candidate) => candidate.id !== conversation.id),
  ].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  await saveAgentCatalog(ownerId, { ...cached.value, conversations }, now);
  return true;
}

export function agentCatalogCacheKey(ownerId: string): string {
  return cacheKey(ownerId);
}

function cacheKey(ownerId: string): string {
  return `bwchat.agent-catalog-v1:account:${trimFoundationWhitespacesAndNewlines(ownerId)}:overview`;
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
