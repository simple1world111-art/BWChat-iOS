import { apiRequest } from "@/api/client";
import { isRecord, normalizeAgentConversation } from "@/api/normalizers";
import type { AgentConversation } from "@/models";

export async function getAgentConversation(id: string): Promise<AgentConversation> {
  const value = await apiRequest<unknown>(`/agent-conversations/${encodeURIComponent(id)}`, {
    requiredData: true,
  });
  const source = isRecord(value) && isRecord(value.item) ? value.item : value;
  const conversation = normalizeAgentConversation(source);
  if (!conversation.id) throw new Error("智能体会话响应缺少会话");
  return conversation;
}
