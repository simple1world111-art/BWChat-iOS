import fs from "node:fs";
import path from "node:path";

import { createAgentTurn, uploadAgentChatImage } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { agentComposerImagePolicy } from "@/services/agents/AgentComposerImagePolicy";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);

describe("native agent chat image contracts", () => {
  beforeEach(() => request.mockReset());

  it("uploads the exact authenticated JPEG field with a stable idempotency key", async () => {
    request.mockResolvedValueOnce({ asset_id: "asset-1" });

    await expect(
      uploadAgentChatImage("file:///prepared.jpg", "upload-key", "agent_uuid.jpg"),
    ).resolves.toBe("asset-1");

    expect(request).toHaveBeenCalledWith("/agent-assets/images", {
      method: "POST",
      headers: { "Idempotency-Key": "upload-key" },
      body: expect.any(FormData),
      timeoutMs: 90_000,
    });
    const form = request.mock.calls[0]?.[1]?.body as FormData;
    expect(form.has("image")).toBe(true);
  });

  it("keeps the native picker and upload JPEG bounds", () => {
    expect(agentComposerImagePolicy).toEqual({
      jpegQuality: 0.9,
      uploadMaximumBytes: 2_000_000,
      uploadMaximumDimension: 1_200,
      uploadDimensions: [1_200, 900, 675, 640],
      uploadQualities: [0.7, 0.65, 0.55, 0.45, 0.35],
    });
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/services/agents/AgentComposerImageService.ts"),
      "utf8",
    );
    expect(source).toContain("candidateSize <= agentComposerImagePolicy.uploadMaximumBytes");
    expect(source).toContain("resizeAction(sourceWidth, sourceHeight, maximumDimension)");
  });

  it("creates a mixed text/input-image turn with exact body and retained keys", async () => {
    request.mockResolvedValueOnce({
      turn: { id: "turn-1", conversation_id: "conversation/1", status: "queued" },
      message: {
        id: "message-1",
        conversation_id: "conversation/1",
        sender: { type: "user", id: "owner-1" },
        parts: [],
      },
      events_url: "/events/turn-1",
    });

    await expect(
      createAgentTurn(
        "conversation/1",
        [
          { type: "text", text: "调整要求" },
          { type: "input_image", asset_id: "asset-1" },
        ],
        {
          clientMessageId: "client-key",
          replyToId: "reply-1",
          idempotencyKey: "turn-key",
        },
      ),
    ).resolves.toMatchObject({ turn: { id: "turn-1" }, message: { id: "message-1" } });

    expect(request).toHaveBeenCalledWith("/agent-conversations/conversation%2F1/turns", {
      method: "POST",
      headers: { "Idempotency-Key": "turn-key" },
      timeoutMs: 30_000,
      body: {
        client_message_id: "client-key",
        parts: [
          { type: "text", text: "调整要求" },
          { type: "input_image", asset_id: "asset-1" },
        ],
        reply_to_id: "reply-1",
      },
    });
  });

  it("rejects upload envelopes that omit the required asset id", async () => {
    request.mockResolvedValueOnce({});
    await expect(uploadAgentChatImage("file:///prepared.jpg", "upload-key")).rejects.toThrow(
      "智能体聊天图片响应缺少资源 ID",
    );
  });

  it("routes owned-agent settings into the real editor and removes the migration placeholder", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/agent-chat.tsx"), "utf8");
    expect(source).toContain("const agent = await getAgent(agentId)");
    expect(source).toContain("if (agent.is_owner === false)");
    expect(source).toContain("rememberAgentForEditing(agent, ownerId)");
    expect(source).toContain('pathname: "/agent-creator"');
    expect(source).not.toContain("编辑智能体配置仍在按原生流程迁移中");
  });

  it("wires native image reply history, quote menu, gallery, save and reply_to_id", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/agent-chat.tsx"), "utf8");
    const message = fs.readFileSync(
      path.join(process.cwd(), "src/components/agents/AgentMessageView.tsx"),
      "utf8",
    );
    expect(message).toContain("resolveAgentHistoryImageReply(message, allMessages)");
    expect(source).toContain("agentGalleryImagePaths(messages)");
    expect(source).toContain("<ImageGallery onClose=");
    expect(source).toContain("<ChatMessageActionOverlay");
    expect(source).toContain('actions={imageMenuTarget ? ["quote"] : []}');
    expect(source).toContain("replyToId: submission.replyToId");
    expect(source).toContain("saveImageToLibrary(mediaPath)");
    expect(source).toContain("saveVideoToLibrary(mediaPath)");
    expect(message).toContain('accessibilityHint={translate("message.image")}');
    expect(source).toContain("onImageMenuTouchSequenceEnded={releaseImageMenuTouchOwnership}");
    expect(source).toContain("onImageMenuTouchSequenceStarted={claimImageMenuTouchOwnership}");
    expect(message).toContain("onLongPressStart={onImageMenuTouchSequenceStarted}");
    expect(source).toContain("if (imageMenuOwnsTouchRef.current) return");
    expect(source).toContain("}, 150)");
    expect(message).toContain("measureAgentImageSource(replySourceRef");
    expect(message).toContain("measureAgentImageSource(mediaCardRef");
    expect(source).toContain("sourceFrame, sourceContentMode:");
    expect(source).toContain("galleryImagePaths={galleryImagePaths}");
    expect(message).toContain("onImageOpen={onImageOpen}");
    expect(message).toContain("images: galleryImages");
    expect(source).not.toContain("setPreviewUrl");
  });

  it("routes image reply copies and paid-media saves through refresh-aware binary auth", () => {
    const loader = fs.readFileSync(
      path.join(process.cwd(), "src/services/media/AuthenticatedMediaLoader.ts"),
      "utf8",
    );
    const composer = fs.readFileSync(
      path.join(process.cwd(), "src/services/agents/AgentComposerImageService.ts"),
      "utf8",
    );
    const saver = fs.readFileSync(
      path.join(process.cwd(), "src/services/media/MediaLibrarySaver.ts"),
      "utf8",
    );
    expect(loader).toContain("authenticatedResourceRequest(remoteUrl)");
    expect(loader).toContain("destination.write(bytes)");
    expect(composer).toContain("downloadAuthenticatedMediaToFile(resolved, destination)");
    expect(saver.match(/downloadAuthenticatedMediaToFile/gu)).toHaveLength(3);
    expect(saver).toContain('return "downloadFailed"');
    expect(saver).toContain('return "saveFailed"');
    expect(composer).not.toContain("readAccessToken");
    expect(saver).not.toContain("readAccessToken");
  });
});
