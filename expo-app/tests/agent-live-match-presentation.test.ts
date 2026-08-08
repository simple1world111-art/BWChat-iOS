import { agentVideoDefaultRole } from "@/services/live/AgentLiveMatchPresentation";

describe("agent live match presentation", () => {
  it("prefers Agent identity and then matches the native description/tagline/name fallback", () => {
    expect(agentVideoDefaultRole({
      id: "agent-1",
      definition: { identity: "  Detective  " },
      profile: { name: "Name", description: "Description", tagline: "Tagline" },
    }, "Fallback")).toBe("Detective");
    expect(agentVideoDefaultRole({
      id: "agent-1",
      definition: { identity: " " },
      profile: { name: "Name", description: " Description ", tagline: "Tagline" },
    }, "Fallback")).toBe("Description");
    expect(agentVideoDefaultRole(null, "  Agent name  ")).toBe("Agent name");
  });
});
