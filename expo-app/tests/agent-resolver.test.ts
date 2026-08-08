import {
  createAgentConversation,
  getAgentConversations,
  getInstalledAgents,
  installAgent,
} from "@/api/bwchat";
import { randomUUID } from "expo-crypto";
import type { AgentConversation, AgentSummary } from "@/models";
import { invalidateAgentCatalog } from "@/services/agents/AgentCatalogRepository";
import {
  resetAgentConversationMemoryForAccount,
  resolveAgentConversation,
} from "@/services/agents/AgentConversationResolver";

jest.mock("@/api/bwchat", () => ({
  createAgentConversation: jest.fn(),
  getAgentConversations: jest.fn(),
  getInstalledAgents: jest.fn(),
  installAgent: jest.fn(),
}));
jest.mock("@/services/agents/AgentCatalogRepository", () => ({
  invalidateAgentCatalog: jest.fn(),
}));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "stable-key") }));

const conversations = jest.mocked(getAgentConversations);
const installedAgents = jest.mocked(getInstalledAgents);
const install = jest.mocked(installAgent);
const createConversation = jest.mocked(createAgentConversation);
const invalidateCatalog = jest.mocked(invalidateAgentCatalog);
const uuid = jest.mocked(randomUUID);

describe("native agent conversation resolver", () => {
  beforeEach(() => {
    conversations.mockReset();
    installedAgents.mockReset();
    install.mockReset();
    createConversation.mockReset();
    invalidateCatalog.mockReset();
    invalidateCatalog.mockResolvedValue();
    uuid.mockReset();
    uuid.mockReturnValue("stable-key");
    for (const ownerId of ["owner-1", "owner-retry", "owner-reset"]) {
      resetAgentConversationMemoryForAccount(ownerId);
    }
  });

  it("reuses the newest active conversation without installing again", async () => {
    conversations.mockResolvedValue([
      makeConversation("older", "2026-08-05T10:00:00Z"),
      makeConversation("closed", "2026-08-06T11:00:00Z", "closed"),
      makeConversation("newest", "2026-08-06T10:00:00Z"),
    ]);

    await expect(resolveAgentConversation(makeAgent(), "owner-1")).resolves.toMatchObject({
      id: "newest",
    });
    expect(installedAgents).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(createConversation).not.toHaveBeenCalled();
    expect(invalidateCatalog).not.toHaveBeenCalled();
  });

  it("creates a conversation from the matching installed agent and first greeting", async () => {
    const agent = makeAgent();
    conversations.mockResolvedValue([]);
    installedAgents.mockResolvedValue([agent]);
    createConversation.mockResolvedValue(makeConversation("created", ""));

    await expect(resolveAgentConversation(agent, "owner-1")).resolves.toMatchObject({
      id: "created",
    });
    expect(install).not.toHaveBeenCalled();
    expect(createConversation).toHaveBeenCalledWith("agent-1", "hello", "stable-key");
    expect(invalidateCatalog).toHaveBeenCalledWith("owner-1");
  });

  it("installs a missing agent before creating its conversation", async () => {
    const agent = makeAgent();
    const resolved = { ...agent, greetings: [{ id: "installed-greeting", text: "欢迎" }] };
    conversations.mockResolvedValue([]);
    installedAgents.mockResolvedValue([]);
    install.mockResolvedValue(resolved);
    createConversation.mockResolvedValue(makeConversation("created", ""));

    await expect(resolveAgentConversation(agent, "owner-1")).resolves.toMatchObject({
      id: "created",
    });
    expect(install).toHaveBeenCalledWith("agent-1");
    expect(createConversation).toHaveBeenCalledWith("agent-1", "installed-greeting", "stable-key");
  });

  it("retains the idempotency key after failure and coalesces concurrent opens", async () => {
    const agent = makeAgent();
    conversations.mockResolvedValue([]);
    installedAgents.mockResolvedValue([agent]);
    createConversation
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(makeConversation("created", ""));

    await expect(resolveAgentConversation(agent, "owner-retry")).rejects.toThrow("temporary");
    const first = resolveAgentConversation(agent, "owner-retry");
    const second = resolveAgentConversation(agent, "owner-retry");
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { id: "created" },
      { id: "created" },
    ]);

    expect(createConversation).toHaveBeenNthCalledWith(1, "agent-1", "hello", "stable-key");
    expect(createConversation).toHaveBeenNthCalledWith(2, "agent-1", "hello", "stable-key");
    expect(conversations).toHaveBeenCalledTimes(2);
    expect(invalidateCatalog).toHaveBeenCalledTimes(1);
  });

  it("resets one account without allowing an old in-flight operation to repopulate memory", async () => {
    const agent = makeAgent();
    const oldConversationList = deferred<AgentConversation[]>();
    const oldCreation = deferred<AgentConversation>();
    const freshCreation = deferred<AgentConversation>();
    conversations
      .mockImplementationOnce(() => oldConversationList.promise)
      .mockResolvedValueOnce([]);
    installedAgents.mockResolvedValue([agent]);
    uuid.mockReturnValueOnce("old-key").mockReturnValueOnce("fresh-key");
    createConversation.mockImplementation((_agentId, _greetingId, key) =>
      key === "old-key" ? oldCreation.promise : freshCreation.promise,
    );

    const oldRequest = resolveAgentConversation(agent, " owner-reset ");
    resetAgentConversationMemoryForAccount("owner-reset");
    oldConversationList.resolve([]);
    await flushUntil(() => createConversation.mock.calls.length === 1);

    const freshRequest = resolveAgentConversation(agent, "owner-reset");
    await flushUntil(() => createConversation.mock.calls.length === 2);
    expect(createConversation).toHaveBeenNthCalledWith(1, "agent-1", "hello", "old-key");
    expect(createConversation).toHaveBeenNthCalledWith(2, "agent-1", "hello", "fresh-key");

    oldCreation.resolve(makeConversation("old-created", ""));
    await expect(oldRequest).resolves.toMatchObject({ id: "old-created" });
    const coalescedFreshRequest = resolveAgentConversation(agent, "owner-reset");
    expect(conversations).toHaveBeenCalledTimes(2);

    freshCreation.resolve(makeConversation("fresh-created", ""));
    await expect(Promise.all([freshRequest, coalescedFreshRequest])).resolves.toMatchObject([
      { id: "fresh-created" },
      { id: "fresh-created" },
    ]);
    expect(createConversation).toHaveBeenCalledTimes(2);
    expect(invalidateCatalog).toHaveBeenCalledTimes(1);
    expect(invalidateCatalog).toHaveBeenCalledWith("owner-reset");
  });
});

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flushUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error("异步测试条件未满足");
}

function makeAgent(): AgentSummary {
  return {
    id: "agent-1",
    profile: { name: "伙伴" },
    greetings: [{ id: "hello", text: "你好" }],
  };
}

function makeConversation(id: string, updatedAt: string, status = "active"): AgentConversation {
  return {
    id,
    title: "伙伴",
    status,
    agent_id: "agent-1",
    agent_version_id: "version-1",
    agent_profile: { name: "伙伴" },
    agent_capabilities: { paid_images: false, paid_videos: false },
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}
