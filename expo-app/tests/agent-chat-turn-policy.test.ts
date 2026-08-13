import fs from "node:fs";
import path from "node:path";

import type { AgentMessage, AgentMessagePart, AgentTurn } from "@/models";
import { agentTransformOutboundText } from "@/services/agents/AgentImageReplyPolicy";
import {
  agentGeneratedMediaPollingDecision,
  agentMessageIdentity,
  agentMessageTimelinesEqual,
  agentTerminalTurnNotice,
  agentTurnExpectsGeneratedMedia,
  agentTurnProgressStatus,
  isAgentTurnTerminal,
  makeAgentOptimisticMessage,
  mergeAgentTimeline,
  newestAgentTurnIds,
  shouldWaitForAgentTerminalResponse,
} from "@/services/agents/AgentChatTurnPolicy";

function part(overrides: Partial<AgentMessagePart> = {}): AgentMessagePart {
  return { id: "p", ordinal: 0, type: "text", text: "", metadata: {}, ...overrides };
}

function message(id: string, sequence: number, parts: AgentMessagePart[] = []): AgentMessage {
  return {
    id,
    conversation_id: "c",
    sequence_no: sequence,
    sender: { type: "user", id: "test1" },
    source: "user",
    status: "completed",
    created_at: "2026-08-08T00:00:00Z",
    updated_at: "2026-08-08T00:00:00Z",
    parts,
  };
}

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    id: "turn-1",
    conversation_id: "c",
    trigger_message_id: "trigger",
    status: "completed",
    interaction_mode: "chat",
    chat_model: "chat",
    vision_model: "vision",
    error_code: "",
    error_detail: "",
    created_at: "2026-08-08T00:00:00Z",
    updated_at: "2026-08-08T00:00:00Z",
    ...overrides,
  };
}

describe("native agent turn lifecycle policy", () => {
  it("waits for missing or unsettled generated media but stops on usable/failed media", () => {
    expect(agentGeneratedMediaPollingDecision(true, [])).toBe("waitForMediaPart");
    expect(
      agentGeneratedMediaPollingDecision(true, [
        part({ type: "paid_media", metadata: { generation_status: "generating" } }),
      ]),
    ).toBe("waitForGeneration");
    expect(
      agentGeneratedMediaPollingDecision(true, [
        part({
          type: "paid_media",
          metadata: { generation_status: "ready", access: "locked", preview_url: "/preview" },
        }),
      ]),
    ).toBe("stop");
    expect(
      agentGeneratedMediaPollingDecision(true, [
        part({ type: "paid_media", metadata: { generation_status: "failed" } }),
      ]),
    ).toBe("stop");
    expect(
      agentGeneratedMediaPollingDecision(false, [
        part({ type: "paid_media", metadata: { generation_status: "generating" } }),
      ]),
    ).toBe("waitForGeneration");
    expect(
      agentGeneratedMediaPollingDecision(false, [
        part({
          type: "paid_media",
          metadata: { generation_status: "ready", access: "locked", preview_url: "/preview" },
        }),
      ]),
    ).toBe("stop");
  });

  it("derives transform expectation from the accepted trigger message", () => {
    const trigger = message("trigger", 1, [
      part({ type: "text", text: agentTransformOutboundText("换颜色") }),
      part({ id: "image", ordinal: 1, type: "input_image", asset_id: "asset" }),
    ]);
    expect(agentTurnExpectsGeneratedMedia(turn(), [trigger])).toBe(true);
    expect(agentTurnExpectsGeneratedMedia(turn(), [])).toBe(false);
  });

  it("matches standalone progress and terminal response grace decisions", () => {
    expect(
      agentTurnProgressStatus({
        turnStatus: "completed",
        isAwaitingGeneratedMedia: true,
        isAwaitingTerminalResponse: false,
        mediaDecision: "waitForMediaPart",
      }),
    ).toBe("waiting_image");
    expect(
      agentTurnProgressStatus({
        turnStatus: "completed",
        isAwaitingGeneratedMedia: true,
        isAwaitingTerminalResponse: false,
        mediaDecision: "waitForGeneration",
      }),
    ).toBeNull();
    expect(shouldWaitForAgentTerminalResponse("completed", false)).toBe(true);
    expect(shouldWaitForAgentTerminalResponse("failed", false)).toBe(false);
    expect(isAgentTurnTerminal("completed_with_errors")).toBe(true);
    expect(isAgentTurnTerminal("cancelled")).toBe(false);
    expect(isAgentTurnTerminal("expired")).toBe(false);
  });

  it("produces the original terminal notices", () => {
    expect(agentTerminalTurnNotice(turn({ status: "failed" }), [], false, true)).toEqual({
      message: "智能体回复失败，点击重试",
      allowsRetry: true,
      isFailure: true,
    });
    expect(agentTerminalTurnNotice(turn(), [], true, true)?.message).toContain(
      "没有返回调整后的图片",
    );
  });

  it("merges by sequence with updated-at freshness and resumes five unique newest turns", () => {
    const old = { ...message("old", 1), updated_at: "2026-08-08T00:00:02Z", turn_id: "t1" };
    const stale = { ...message("stale", 1), updated_at: "2026-08-08T00:00:01Z" };
    const latest = Array.from({ length: 7 }, (_, index) => ({
      ...message(`m${index + 2}`, index + 2),
      turn_id: `t${index + 2}`,
    }));
    expect(mergeAgentTimeline([old], [stale])[0]?.id).toBe("old");
    expect(newestAgentTurnIds([old, ...latest])).toEqual(["t8", "t7", "t6", "t5", "t4"]);
  });

  it("keeps optimistic messages stable and replaces them with the accepted server message", () => {
    const optimistic = makeAgentOptimisticMessage({
      clientMessageId: "client-1",
      conversationId: "c",
      createdAt: "2026-08-08T00:00:03Z",
      ownerId: "test1",
      sequenceNo: 2,
      text: "立即显示",
    });
    const accepted = {
      ...message("server-2", 2, [part({ text: "立即显示" })]),
      client_message_id: "client-1",
    };
    const merged = mergeAgentTimeline([message("server-1", 1), optimistic], [accepted]);

    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ id: "server-2", status: "completed" });
    expect(agentMessageIdentity(optimistic)).toBe("client:client-1");

    const repeated = mergeAgentTimeline(merged, [
      { ...accepted, parts: [{ ...accepted.parts[0]! }] },
    ]);
    expect(repeated[1]).toBe(merged[1]);
    expect(agentMessageTimelinesEqual(merged, repeated)).toBe(true);
  });

  it("does not collapse unrelated messages with a missing sequence and preserves local unlocks", () => {
    const first = message("zero-a", 0);
    const second = message("zero-b", 0);
    expect(mergeAgentTimeline([first], [second]).map(({ id }) => id)).toEqual(["zero-a", "zero-b"]);

    const unlocked = message("media", 4, [
      part({
        type: "paid_media",
        reference_id: "media-1",
        metadata: { access: "unlocked", content_url: "/content", generation_status: "ready" },
      }),
    ]);
    const staleLocked = {
      ...unlocked,
      updated_at: "2026-08-08T00:00:01Z",
      parts: [
        part({
          type: "paid_media",
          reference_id: "media-1",
          metadata: { access: "locked", preview_url: "/preview", generation_status: "ready" },
        }),
      ],
    };
    const refreshed = mergeAgentTimeline([unlocked], [staleLocked]);
    expect(refreshed[0]?.parts[0]?.metadata).toMatchObject({
      access: "unlocked",
      content_url: "/content",
    });
  });

  it("wires cache hydration, unfinished-turn recovery and all native polling grace gates", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/agent-chat.tsx"), "utf8");
    expect(source).toContain("loadAgentChatPage(ownerId, conversationId)");
    expect(source).toContain("saveAgentChatPage(");
    expect(source).toContain("newestAgentTurnIds(messagesRef.current)");
    expect(source).toContain("terminalResponseAppearanceGraceMilliseconds");
    expect(source).toContain("terminalMediaAppearanceGraceMilliseconds");
    expect(source).toContain("maximumDurationMilliseconds");
    expect(source).toContain("await delay(agentTurnPollingPolicy.intervalMilliseconds)");
    expect(source).toContain("mergeAgentTimeline(current, incoming)");
    expect(source).toContain("isAwaitingGeneratedMedia ||");
    expect(source).toContain("void load().finally(() => {");
    expect(source).toContain("markLatestMessageRead(latest);");
    expect(source).toContain("void resumeUnfinishedTurnIfNeeded();");
    expect(source).toContain("Native keeps polling through transient reload failures");
    expect(source).toContain('message: "发送失败，点击重试"');
    expect(source).toContain("upsertCachedAgentConversation(ownerId, cachedConversation)");
    expect(source).toContain("upsertCachedAgentConversation(ownerId, latest)");
    expect(source).toContain("balance === null");
    expect(source).toContain("sendingRef.current");
    expect(source).toContain("Math.min(...sequences)");
    expect(source).not.toContain("onEndReached=");
    expect(source).toContain("expectedMediaTurnIdsRef.current.has(result.turn.id)");
    expect(source).toContain("syncLatestAgentMessages");
    expect(source).toContain("makeAgentOptimisticMessage");
    expect(source).toContain("keyExtractor={agentMessageIdentity}");
    expect(source).toContain("agentMessageTimelinesEqual(previous, next)");
  });
});
