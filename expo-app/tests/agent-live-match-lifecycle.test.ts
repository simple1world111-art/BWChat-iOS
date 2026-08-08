import { shouldCancelAgentLiveMatchForAppState } from "@/services/live/AgentLiveMatchLifecycle";

describe("agent live match app lifecycle", () => {
  it("does not cancel for an iOS permission prompt inactive transition", () => {
    expect(shouldCancelAgentLiveMatchForAppState("inactive")).toBe(false);
    expect(shouldCancelAgentLiveMatchForAppState("active")).toBe(false);
  });

  it("cancels only after the app actually enters the background", () => {
    expect(shouldCancelAgentLiveMatchForAppState("background")).toBe(true);
    expect(shouldCancelAgentLiveMatchForAppState("unknown")).toBe(false);
    expect(shouldCancelAgentLiveMatchForAppState("extension")).toBe(false);
  });
});
