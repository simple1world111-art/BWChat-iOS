import AsyncStorage from "@react-native-async-storage/async-storage";

import type { AgentConversation, AgentMessage } from "@/models";
import {
  agentChatCacheKey,
  agentChatCachePolicy,
  loadAgentChatPage,
  saveAgentChatPage,
} from "@/services/agents/AgentChatCache";

function message(id: string): AgentMessage {
  return {
    id,
    conversation_id: "conversation/1",
    sequence_no: 1,
    sender: { type: "user", id: "test1" },
    source: "user",
    status: "completed",
    created_at: "2026-08-08T00:00:00Z",
    updated_at: "2026-08-08T00:00:00Z",
    parts: [],
  };
}

function conversation(): AgentConversation {
  return {
    id: "conversation/1",
    title: "测试智能体",
    status: "active",
    agent_id: "agent-1",
    agent_version_id: "version-1",
    agent_profile: { name: "测试智能体" },
    agent_capabilities: { paid_images: true, paid_videos: false },
    created_at: "2026-08-08T00:00:00Z",
    updated_at: "2026-08-08T00:00:00Z",
  };
}

describe("native account-scoped agent chat cache", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses exact five-minute freshness and one-year stale retention", async () => {
    const now = Date.parse("2026-08-08T00:00:00Z");
    await saveAgentChatPage("test1", "conversation/1", [message("m1")], true, conversation(), now);
    await expect(loadAgentChatPage("test1", "conversation/1", now + 1)).resolves.toMatchObject({
      hasMore: true,
      isStale: false,
      messages: [{ id: "m1" }],
      conversation: { id: "conversation/1", agent_version_id: "version-1" },
    });
    await expect(
      loadAgentChatPage("test1", "conversation/1", now + agentChatCachePolicy.ttlMilliseconds),
    ).resolves.toMatchObject({ isStale: true });
    await expect(
      loadAgentChatPage(
        "test1",
        "conversation/1",
        now +
          agentChatCachePolicy.ttlMilliseconds +
          agentChatCachePolicy.staleRetentionMilliseconds +
          1,
      ),
    ).resolves.toBeNull();
  });

  it("never crosses users or unsafe conversation identifiers", async () => {
    await saveAgentChatPage("test1", "conversation/1", [message("m1")], false, null, 1);
    await expect(loadAgentChatPage("test2", "conversation/1", 2)).resolves.toBeNull();
    expect(agentChatCacheKey("test1", "conversation/1")).toContain(
      "account:test1:conversation:conversation%2F1",
    );
    expect(agentChatCacheKey("", "conversation/1")).toBeNull();
  });

  it("fails closed for corrupt cache without touching another account", async () => {
    const key = agentChatCacheKey("test1", "conversation/1")!;
    await AsyncStorage.setItem(key, "{broken");
    await expect(loadAgentChatPage("test1", "conversation/1", 2)).resolves.toBeNull();
  });

  it("serializes same-conversation writes so a slower old snapshot cannot win", async () => {
    let releaseFirstWrite: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const encodedWrites: string[] = [];
    const setItem = jest.spyOn(AsyncStorage, "setItem").mockImplementation(async (_key, value) => {
      encodedWrites.push(value);
      if (encodedWrites.length === 1) await firstWrite;
    });
    setItem.mockClear();

    const older = saveAgentChatPage("test1", "conversation/1", [message("older")], false, null, 1);
    await Promise.resolve();
    const newer = saveAgentChatPage("test1", "conversation/1", [message("newer")], false, null, 2);
    await Promise.resolve();

    expect(setItem).toHaveBeenCalledTimes(1);
    releaseFirstWrite?.();
    await Promise.all([older, newer]);
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(JSON.parse(encodedWrites[1] ?? "{}")).toMatchObject({
      updatedAt: 2,
      messages: [{ id: "newer" }],
    });
  });
});
