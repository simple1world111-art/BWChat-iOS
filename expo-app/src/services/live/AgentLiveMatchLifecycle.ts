export type AgentLiveAppState =
  | "active"
  | "background"
  | "inactive"
  | "unknown"
  | "extension";

export function shouldCancelAgentLiveMatchForAppState(state: AgentLiveAppState): boolean {
  return state === "background";
}
