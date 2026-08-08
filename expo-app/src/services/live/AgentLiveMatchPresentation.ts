import type { AgentSummary } from "@/models";

export function agentVideoDefaultRole(
  agent: AgentSummary | null | undefined,
  fallbackName: string,
): string {
  const candidates = [
    agent?.definition?.identity,
    agent?.profile?.description,
    agent?.profile?.tagline,
    agent?.profile?.name,
    fallbackName,
    "智能体",
  ];
  return candidates
    .map((value) => value?.trim() ?? "")
    .find((value) => value.length > 0) ?? "智能体";
}
