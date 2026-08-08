import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("agent live match screen source parity", () => {
  const root = process.cwd();
  const screen = readFileSync(resolve(root, "src/app/agent-chat.tsx"), "utf8");
  const hook = readFileSync(
    resolve(root, "src/services/live/useAgentLiveVideoMatch.ts"),
    "utf8",
  );

  it("replaces the migration placeholder with native role and current-live synchronization", () => {
    expect(screen).toContain("await getCurrentLiveSlot()");
    expect(screen).toContain('currentSlot.status.trim().toLocaleLowerCase() !== "ended"');
    expect(screen).toContain("正在直播，无法与其他在直播的人视频");
    expect(screen).toContain("agentVideoDefaultRole(await getAgent(agentId), fallbackRole)");
    expect(screen).toContain("<AgentVideoRoleMatchDialog");
    expect(screen).toContain("useAgentLiveVideoMatch({ onConnected: dismissVideoRoleDialog })");
    expect(screen).not.toContain("智能体视频角色匹配仍在迁移中");
  });

  it("keeps realtime terminal events, CallProvider activation, and lifecycle cancellation wired", () => {
    expect(hook).toContain('event.signal_type === "one_to_one_live.call_accepted"');
    expect(hook).toContain('event.signal_type === "one_to_one_live.match_exhausted"');
    expect(hook).toContain('event.signal_type === "one_to_one_live.match_cancelled"');
    expect(hook).toContain("connectAcceptedLiveCall(");
    expect(hook).toContain("if (shouldCancelAgentLiveMatchForAppState(next)) coordinator.cancel()");
    expect(hook).toContain("coordinator.dispose()");
  });
});
