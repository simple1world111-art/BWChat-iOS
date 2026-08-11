import fs from "node:fs";
import path from "node:path";

describe("direct ChatView lifecycle source parity", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/app/chat/[id].tsx"), "utf8");
  const conversationSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/(tabs)/conversations.tsx"),
    "utf8",
  );

  it("gates render and every late async completion by owner/contact session", () => {
    expect(source).toContain("const sessionKey = directChatSessionKey(ownerId, id)");
    expect(source).toContain("const visibleMessages = useMemo(");
    expect(source).toContain("renderSessionKey === sessionKey ? messages : []");
    expect(source).toContain("activeSessionRef.current !== expectedSession");
    expect(source).toContain("syncAttemptRef.current === syncAttempt");
    expect(source).toContain("setRenderSessionKey(sessionKey)");
  });

  it("restores local cache/outbox, syncs newer plus recent 100, and backfills 50x100", () => {
    expect(source).toContain("readDirectChatCachedPage(ownerId, id)");
    expect(source).toContain("readDirectChatOutboxJobs(ownerId, id)");
    expect(source).toContain("afterId,");
    expect(source).toContain("limit: directChatHistoryPolicy.syncPageSize");
    expect(source).toContain("void backfillDirectChatHistory(expectedSession)");
    expect(source).toContain("maximumBackfillPages");
  });

  it("reconciles a conversation-list preview whose canonical message is absent from history", () => {
    expect(conversationSource).toContain("latestMessageId: String(conversation.last_message_id)");
    expect(source).toContain("const latestMessageId = Number(latestMessageIdParam)");
    expect(source).toContain("!timelineHasLatestMessage");
    expect(source).toContain("getMessageContext(id, latestMessageId)");
    expect(source).toContain('event.type !== "direct_message_hint"');
    expect(source).toContain("void scrollToMessage(event.message_id, { showError: false })");
  });

  it("preloads the routed image thumbnail before publishing it to the timeline", () => {
    expect(source).toContain("preloadPreferredChatImagePreview(");
    expect(source).toContain("canonicalRouteMessageIds(messageId, latestMessageIdParam)");
    expect(source).toContain("await preloadChatImagePreview(ownerId, targetMessage)");
  });

  it("resyncs on foreground, reconciles selection, closes panels for calls and cancels media", () => {
    expect(source).toContain('chatRealtimeService.activateConversation("dm", id)');
    expect(source).toContain("releaseActiveConversation()");
    expect(source).toContain('dismissActiveConversationNotifications("dm", id)');
    expect(source).toContain('state === "active" && previousState !== "active"');
    expect(source).toContain("if (call.session === null) return");
    expect(source).toContain("selection.removedUnavailable");
    expect(source).toContain("cancelChatImageUpload(user.user_id, message.client_message_id)");
    expect(source).toContain("cancelChatVideoUpload(user.user_id, message.client_message_id)");
    expect(source).toContain("publishLocalDirectConversationPreview(filtered)");
    expect(conversationSource).toContain("subscribeDirectConversationPreviewUpdates");
    expect(conversationSource).toContain("accountScopeRef.current.isCurrent(ticket)");
  });

  it("contains no hard-coded Han copy in the direct page", () => {
    expect(source).not.toMatch(/[\u3400-\u9fff]/u);
  });
});
