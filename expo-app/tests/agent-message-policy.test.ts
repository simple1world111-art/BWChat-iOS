import type { AgentMessage, AgentMessagePart } from "@/models";
import {
  agentImageThumbnailSize,
  agentMessageLayout,
  agentMessageScope,
  agentVideoThumbnailSize,
  isCurrentAgentMessageScope,
  orderedAgentMessageParts,
  presentAgentPaidMedia,
} from "@/services/agents/AgentMessagePresentationPolicy";

function part(id: string, ordinal: number): AgentMessagePart {
  return { id, ordinal, type: "text", text: id, metadata: {} };
}

function message(parts: AgentMessagePart[]): AgentMessage {
  return {
    id: "message-1",
    conversation_id: "conversation-1",
    sequence_no: 1,
    sender: { type: "agent", id: "agent-1" },
    source: "turn",
    status: "completed",
    created_at: "2026-08-08T00:00:00Z",
    updated_at: "2026-08-08T00:00:00Z",
    parts,
  };
}

describe("native AgentMessage presentation policy", () => {
  it("uses the exact Swift stack spacing for message cells and their parts", () => {
    expect(agentMessageLayout).toEqual({ timelineItemSpacing: 10, partSpacing: 7 });
  });

  it("renders parts by ordinal while retaining server order for equal ordinals", () => {
    const source = message([
      part("third", 3),
      part("first-a", 1),
      part("first-b", 1),
      part("second", 2),
    ]);
    expect(orderedAgentMessageParts(source).map(({ id }) => id)).toEqual([
      "first-a",
      "first-b",
      "second",
      "third",
    ]);
    expect(source.parts.map(({ id }) => id)).toEqual(["third", "first-a", "first-b", "second"]);
  });

  it("matches native image and video history card breakpoints", () => {
    expect(agentImageThumbnailSize()).toEqual({ width: 160, height: 110 });
    expect(agentImageThumbnailSize(600, 1_000)).toEqual({ width: 110, height: 156 });
    expect(agentImageThumbnailSize(1_600, 900)).toEqual({ width: 160, height: 110 });
    expect(agentImageThumbnailSize(1_000, 1_000)).toEqual({ width: 140, height: 140 });
    expect(agentVideoThumbnailSize()).toEqual({ width: 200, height: 140 });
    expect(agentVideoThumbnailSize(900, 1_600)).toEqual({ width: 112, height: 160 });
    expect(agentVideoThumbnailSize(1_600, 900)).toEqual({ width: 200, height: 140 });
    expect(agentVideoThumbnailSize(1_000, 1_000)).toEqual({ width: 150, height: 150 });
  });

  it("derives authoritative locked image and unlocked video paths without exposing locked content", () => {
    expect(
      presentAgentPaidMedia({
        media_type: "image",
        generation_status: "completed",
        access: "locked",
        preview_url: " /preview ",
        content_url: "/hidden-original",
        download_url: "/hidden-download",
        width: 1_600,
        height: 900,
      }),
    ).toEqual({
      kind: "image",
      status: "ready_locked",
      isUnlocked: false,
      previewPath: "/preview",
      size: { width: 160, height: 110 },
    });

    expect(
      presentAgentPaidMedia({
        media_type: "video",
        generation_status: "ready",
        access: "unlocked",
        preview_url: "/poster",
        download_url: "/video-download",
        width: 900,
        height: 1_600,
      }),
    ).toEqual({
      kind: "video",
      status: "ready_locked",
      isUnlocked: true,
      contentPath: "/video-download",
      previewPath: "/poster",
      savePath: "/video-download",
      size: { width: 112, height: 160 },
    });
  });

  it("isolates every async write by the exact account and conversation scope", () => {
    const requested = agentMessageScope(" owner-1 ", " conversation-1 ");
    expect(requested).toBe("owner-1:conversation-1");
    expect(isCurrentAgentMessageScope("owner-1:conversation-1", requested)).toBe(true);
    expect(isCurrentAgentMessageScope("owner-2:conversation-1", requested)).toBe(false);
    expect(isCurrentAgentMessageScope("owner-1:conversation-2", requested)).toBe(false);
    expect(isCurrentAgentMessageScope("", "")).toBe(false);
  });
});
