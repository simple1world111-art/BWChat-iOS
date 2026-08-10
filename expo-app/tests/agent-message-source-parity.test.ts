import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("native AgentMessageView source parity", () => {
  it("locks the complete read-only Swift fact source", () => {
    const native = fs.readFileSync(
      "/Users/wegpt.com/Desktop/BWChat-iOS/BWChat/Views/AgentMessageView.swift",
    );
    expect(createHash("sha256").update(native).digest("hex")).toBe(
      "3f09ac9ddbc109874766ca852045a3d3ca7d9a6921b39395e7c4164dc4f5ba3c",
    );
  });

  it("keeps ordinal parts, reply quote, gallery, long-press ownership and media actions in the extracted view", () => {
    const component = source("src/components/agents/AgentMessageView.tsx");
    const screen = source("src/app/agent-chat.tsx");
    expect(component).toContain("orderedAgentMessageParts(message)");
    expect(component).toContain("resolveAgentHistoryImageReply(message, allMessages)");
    expect(component.match(/<ImageGallerySource/gu)).toHaveLength(2);
    expect(component).toContain("onLongPressStart={onImageMenuTouchSequenceStarted}");
    expect(component).toContain("onTouchSequenceEnded={onImageMenuTouchSequenceEnded}");
    expect(component).toContain("onVideoPress(content)");
    expect(component).toContain("onSave?.(savePath, isVideo)");
    expect(component).toContain("onUnlock(mediaId, metadata.media_type)");
    expect(component).toContain("<View style={styles.saveMediaSlot} />");
    expect(screen).toContain("<AgentMessageView");
    expect(screen).not.toContain("function AgentMessageRow(");
    expect(screen).not.toContain("export function PaidMediaPart(");
  });

  it("uses Swift's explicit 10-point timeline and 7-point part stack rhythm", () => {
    const component = source("src/components/agents/AgentMessageView.tsx");
    const screen = source("src/app/agent-chat.tsx");
    const policy = source("src/services/agents/AgentMessagePresentationPolicy.ts");
    expect(policy).toContain("timelineItemSpacing: 10");
    expect(policy).toContain("partSpacing: 7");
    expect(component).toContain("marginTop: agentMessageLayout.partSpacing");
    expect(component).not.toContain("messageParts: { maxWidth: 290, rowGap: 7 }");
    expect(screen).toContain("ItemSeparatorComponent={AgentMessageTimelineSeparator}");
    expect(screen).toContain("height: agentMessageLayout.timelineItemSpacing");
    expect(screen).toContain("hasHeaderTailContent && styles.headerTailAfterMessage");
    expect(screen).toContain("marginTop: agentMessageLayout.timelineItemSpacing");
    expect(screen).not.toContain("marginBottom: agentMessageLayout.timelineItemSpacing");
  });

  it("reuses authenticated image, gallery, video and saver capabilities without forking them", () => {
    const component = source("src/components/agents/AgentMessageView.tsx");
    const screen = source("src/app/agent-chat.tsx");
    expect(component).toContain('from "@/components/AuthenticatedImage"');
    expect(component).toContain('from "@/components/media/ImageGallery"');
    expect(screen).toContain('from "@/components/media/VideoPlayerOverlay"');
    expect(screen).toContain('from "@/services/media/MediaLibrarySaver"');
  });

  it("localizes media controls through the ten-locale native catalog and exposes a11y states", () => {
    const component = source("src/components/agents/AgentMessageView.tsx");
    for (const key of [
      "common.loading",
      "media.preview.title",
      "mediaUnlock.playVideo",
      "mediaUnlock.save.${kind}",
      "mediaUnlock.title.${kind}",
      "mediaUnlock.unavailable",
      "mediaUnlock.unlocking",
      "message.image",
    ]) {
      expect(component).toContain(key);
    }
    expect(component).toContain('accessibilityRole="progressbar"');
    expect(component).toContain('accessibilityRole="alert"');
    expect(component).toContain('accessibilityRole="button"');
    expect(component).toContain('accessibilityLiveRegion="polite"');
    expect(component).not.toMatch(/[\u4e00-\u9fff]/u);
  });

  it("rejects account/conversation late unlock writes before settlement and timeline mutation", () => {
    const screen = source("src/app/agent-chat.tsx");
    expect(screen).toContain("const requestedScope = agentMessageScope(ownerId, conversationId)");
    expect(screen).toContain("unlockOperationTokensRef.current.get(mediaId) === operationToken");
    expect(screen).toContain("if (!isCurrentUnlock()) return;");
    expect(screen.indexOf("if (!isCurrentUnlock()) return;")).toBeLessThan(
      screen.indexOf("const settlement = settleAgentMediaUnlock(result)"),
    );
    expect(screen).toContain("unlockOperationTokensRef.current.clear()");
    expect(screen).toContain(
      "isCurrentAgentMessageScope(timelineScopeRef.current, requestedScope)",
    );
  });
});
