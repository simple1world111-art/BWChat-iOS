import type { AgentSummary } from "@/models";

let pendingAgent: { agent: AgentSummary; ownerId?: string | undefined } | null = null;
const updateListeners = new Set<(agent: AgentSummary) => void>();

export function rememberAgentForEditing(agent: AgentSummary, ownerId?: string): void {
  pendingAgent = { agent, ...(ownerId ? { ownerId } : {}) };
}

export function pendingAgentForEditing(agentId: string, ownerId?: string): AgentSummary | null {
  if (pendingAgent?.agent.id !== agentId) return null;
  if (ownerId !== undefined && pendingAgent.ownerId !== ownerId) return null;
  return pendingAgent.agent;
}

export function clearPendingAgentForEditing(agentId: string, ownerId?: string): void {
  if (pendingAgent?.agent.id !== agentId) return;
  if (ownerId !== undefined && pendingAgent.ownerId !== ownerId) return;
  pendingAgent = null;
}

export function notifyAgentUpdated(agent: AgentSummary): void {
  for (const listener of updateListeners) listener(agent);
}

export function subscribeAgentUpdates(listener: (agent: AgentSummary) => void): () => void {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}
