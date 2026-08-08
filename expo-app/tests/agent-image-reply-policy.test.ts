import type { AgentMessage, AgentMessagePart } from "@/models";
import {
  agentGalleryImagePaths,
  agentImageGenerationBlockReason,
  agentImagePath,
  agentImageReplySenderLabel,
  agentImageReplyTarget,
  agentTransformOutboundText,
  agentUserVisibleText,
  resolveAgentHistoryImageReply,
} from "@/services/agents/AgentImageReplyPolicy";

function part(overrides: Partial<AgentMessagePart> = {}): AgentMessagePart {
  return {
    id: "part-1",
    ordinal: 0,
    type: "text",
    text: "",
    metadata: {},
    ...overrides,
  };
}

function message(
  id: string,
  parts: AgentMessagePart[],
  overrides: Partial<AgentMessage> = {},
): AgentMessage {
  return {
    id,
    conversation_id: "conversation-1",
    sequence_no: Number(id.replace(/\D/gu, "")) || 1,
    sender: { type: "user", id: "test1" },
    source: "user",
    status: "completed",
    created_at: "2026-08-08T00:00:00Z",
    updated_at: "2026-08-08T00:00:00Z",
    parts,
    ...overrides,
  };
}

describe("native agent image reply and gallery policy", () => {
  it("resolves only visible input images and unlocked non-video paid originals", () => {
    expect(agentImagePath(part({ type: "input_image", asset_id: "asset/a" }))).toBe(
      "/agent-assets/asset%2Fa/content",
    );
    expect(
      agentImagePath(
        part({
          type: "paid_media",
          metadata: { media_type: "image", access: "unlocked", content_url: "/original" },
        }),
      ),
    ).toBe("/original");
    expect(
      agentImagePath(
        part({
          type: "paid_media",
          metadata: { media_type: "video", access: "unlocked", content_url: "/video" },
        }),
      ),
    ).toBeNull();
    expect(
      agentImagePath(
        part({
          type: "paid_media",
          metadata: { media_type: "image", access: "locked", content_url: "/hidden" },
        }),
      ),
    ).toBeNull();
  });

  it("keeps ordered unique gallery paths and original sender identity", () => {
    const first = message("m1", [
      part({ id: "p1", ordinal: 1, type: "input_image", asset_id: "a" }),
    ]);
    const second = message(
      "m2",
      [
        part({ id: "p2", ordinal: 2, type: "input_image", asset_id: "b" }),
        part({ id: "p3", ordinal: 1, type: "input_image", asset_id: "a" }),
      ],
      { sender: { type: "agent", id: "agent" } },
    );
    expect(agentGalleryImagePaths([first, second])).toEqual([
      "/agent-assets/a/content",
      "/agent-assets/b/content",
    ]);
    const target = agentImageReplyTarget(second.parts[0]!, second)!;
    expect(agentImageReplySenderLabel(target)).toBe("智能体");
  });

  it("restores a history quote from reply_to_id and falls back to the copied input image", () => {
    const source = message("m1", [
      part({ id: "source-image", type: "input_image", asset_id: "source" }),
    ]);
    const directReply = message("m2", [part({ id: "reply-text", type: "text", text: "调整" })], {
      reply_to_id: "m1",
    });
    expect(resolveAgentHistoryImageReply(directReply, [source, directReply])).toMatchObject({
      messageId: "m1",
      partId: "source-image",
      imagePath: "/agent-assets/source/content",
    });

    const copiedReply = message("m3", [
      part({ id: "transform", type: "text", text: agentTransformOutboundText("换成蓝色") }),
      part({ id: "copied-image", ordinal: 1, type: "input_image", asset_id: "copied" }),
    ]);
    expect(resolveAgentHistoryImageReply(copiedReply, [copiedReply])).toMatchObject({
      messageId: "m3",
      partId: "copied-image",
    });
  });

  it("never exposes the internal transform tool instruction in history", () => {
    expect(agentUserVisibleText(agentTransformOutboundText("换成蓝色"))).toBe("换成蓝色");
    expect(agentUserVisibleText(agentTransformOutboundText(""))).toBe("");
    expect(agentUserVisibleText("普通消息")).toBe("普通消息");
  });

  it("matches the native runtime, version and locked-media image generation gates", () => {
    const runtime = {
      agents_enabled: true,
      image_input_enabled: true,
      paid_images_enabled: true,
      paid_videos_enabled: true,
      vision: { max_images_per_turn: 1 },
    };
    const capabilities = { paid_images: true, paid_videos: true };
    expect(agentImageGenerationBlockReason(null, capabilities, [])).toBe(
      "正在加载图片生成能力，请稍后再试",
    );
    expect(
      agentImageGenerationBlockReason({ ...runtime, paid_images_enabled: false }, capabilities, []),
    ).toBe("图片生成功能当前未开放");
    expect(
      agentImageGenerationBlockReason(runtime, { ...capabilities, paid_images: false }, []),
    ).toBe("当前会话使用的智能体版本未开启图片能力");
    const locked = message("m4", [
      part({
        id: "locked",
        type: "paid_media",
        metadata: { media_type: "image", access: "locked", generation_status: "ready" },
      }),
    ]);
    expect(agentImageGenerationBlockReason(runtime, capabilities, [locked])).toBe(
      "请先解锁上一张图片，再继续调整图片",
    );
    expect(agentImageGenerationBlockReason(runtime, capabilities, [])).toBeNull();
  });
});
