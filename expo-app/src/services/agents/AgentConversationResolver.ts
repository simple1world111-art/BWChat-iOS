import {
  createAgentConversation,
  getAgentConversations,
  getInstalledAgents,
  installAgent,
} from "@/api/bwchat";
import { randomUUID } from "expo-crypto";
import type { AgentConversation, AgentSummary } from "@/models";
import { invalidateAgentCatalog } from "@/services/agents/AgentCatalogRepository";
import { latestOpenAgentConversation } from "@/services/agents/agentHubPolicy";

interface AccountResolverMemory {
  generation: number;
  idempotencyKeys: Map<string, string>;
  inFlight: Map<string, { generation: number; promise: Promise<AgentConversation> }>;
}

const accountMemory = new Map<string, AccountResolverMemory>();

export function resetAgentConversationMemoryForAccount(ownerId: string): void {
  const ownerScope = ownerId.trim();
  if (!ownerScope) return;
  const memory = accountMemory.get(ownerScope);
  if (!memory) return;
  memory.generation += 1;
  memory.idempotencyKeys.clear();
  memory.inFlight.clear();
  accountMemory.delete(ownerScope);
}

export async function resolveAgentConversation(
  agent: AgentSummary,
  ownerId: string,
): Promise<AgentConversation> {
  const ownerScope = ownerId.trim();
  const memory = memoryForAccount(ownerScope);
  const generation = memory.generation;
  const current = memory.inFlight.get(agent.id);
  if (current?.generation === generation) return current.promise;
  const operation = resolve(agent, ownerScope, memory, generation).finally(() => {
    const latest = memory.inFlight.get(agent.id);
    if (latest?.generation === generation && latest.promise === operation) {
      memory.inFlight.delete(agent.id);
    }
  });
  memory.inFlight.set(agent.id, { generation, promise: operation });
  return operation;
}

async function resolve(
  agent: AgentSummary,
  ownerScope: string,
  memory: AccountResolverMemory,
  generation: number,
): Promise<AgentConversation> {
  const conversations = await getAgentConversations();
  const existing = latestOpenAgentConversation(conversations, agent.id);
  if (existing) return existing;

  const installed = await getInstalledAgents();
  const resolved =
    installed.find((candidate) => candidate.id === agent.id) ?? (await installAgent(agent.id));
  const key = memory.idempotencyKeys.get(agent.id) ?? randomUUID();
  if (memory.generation === generation) memory.idempotencyKeys.set(agent.id, key);
  const conversation = await createAgentConversation(
    resolved.id,
    resolved.greetings?.[0]?.id ?? agent.greetings?.[0]?.id ?? "default",
    key,
  );
  if (memory.generation === generation) {
    if (memory.idempotencyKeys.get(agent.id) === key) {
      memory.idempotencyKeys.delete(agent.id);
    }
    await invalidateAgentCatalog(ownerScope).catch(() => undefined);
  }
  return conversation;
}

function memoryForAccount(ownerScope: string): AccountResolverMemory {
  const existing = accountMemory.get(ownerScope);
  if (existing) return existing;
  const created: AccountResolverMemory = {
    generation: 0,
    idempotencyKeys: new Map(),
    inFlight: new Map(),
  };
  accountMemory.set(ownerScope, created);
  return created;
}
