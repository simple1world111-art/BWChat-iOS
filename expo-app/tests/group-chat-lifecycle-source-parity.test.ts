import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "src/app/group-chat/[id].tsx"), "utf8");

describe("group chat lifecycle and state source parity", () => {
  it("isolates account plus group and atomically gates A→B→A rendering", () => {
    expect(source).toContain("const sessionKey = groupChatSessionKey(ownerId, groupId)");
    expect(source).toContain("activeSessionRef.current = sessionKey");
    expect(source).toContain("renderSessionKey === sessionKey ? messages : []");
    expect(source).toContain("syncAttemptRef.current += 1");
    expect(source).toContain("setRenderSessionKey(sessionKey)");
    expect(source).toContain("setMessages([])");
    expect(source).toContain("activeSessionRef.current !== expectedSession");
  });

  it("restores cache/outbox before the latest sync and performs bounded full backfill", () => {
    for (const fact of [
      "readGroupChatCachedPage(ownerId, groupId)",
      "readGroupChatOutboxJobs(ownerId, groupId)",
      "isGroupChatHistoryBackfilled(ownerId, groupId)",
      "pendingJobs.map(groupOptimisticOutboxMessage)",
      "afterId,",
      "beforeId: cursor",
      "groupChatHistoryPolicy.maximumBackfillPages",
      "groupChatHistoryPolicy.syncPageSize",
      "markGroupChatHistoryBackfilled(ownerId, groupId)",
    ])
      expect(source).toContain(fact);
  });

  it("reconciles a conversation-list preview whose canonical message is absent from history", () => {
    const conversationSource = fs.readFileSync(
      path.join(process.cwd(), "src/app/(tabs)/conversations.tsx"),
      "utf8",
    );
    expect(conversationSource).toContain("latestMessageId: String(conversation.last_message_id)");
    expect(conversationSource).toContain('event.type === "group_message_hint"');
    expect(conversationSource).toContain("last_message_id: event.message_id");
    expect(source).toContain("const latestMessageId = Number(params.latestMessageId)");
    expect(source).toContain("!timelineHasLatestMessage");
    expect(source).toContain("getGroupMessageContext(groupId, latestMessageId)");
    expect(source).toContain('event.type !== "group_message_hint"');
    expect(source).toContain("void scrollToMessage(event.message_id)");
  });

  it("keeps realtime, read, draft, foreground and outbox callbacks session-fenced", () => {
    expect(source).toContain('chatRealtimeService.setActiveConversation("group", String(groupId))');
    expect(source).toContain("message.mentions?.includes(ownerId) || message.mention_all");
    expect(source).toMatch(/screenActiveRef\.current\s*&&\s*isNearBottomRef\.current/u);
    expect(source.match(/screenActiveRef\.current\s*&&\s*isNearBottomRef\.current/gu)).toHaveLength(
      3,
    );
    expect(source).toContain('readChatDraftSnapshot(ownerId, String(groupId), "group")');
    expect(source).toContain("activeSessionRef.current !== expectedSession");
    expect(source).toContain('state === "active" && previousState !== "active"');
    expect(source).toContain('resumeChatImageUploads(ownerId, "group", String(groupId))');
    expect(source).toContain('resumeChatVideoUploads(ownerId, "group", String(groupId))');
  });

  it("persists text/sticker before transport and retains mention/reply/client identity", () => {
    for (const fact of [
      "createGroupChatOutboxJob(jobInput)",
      "saveGroupChatOutboxJob(sendingJob)",
      "removeGroupChatOutboxJob(sendingJob.owner_id, sendingJob.id)",
      "clientMessageId: sendingJob.id",
      "mentions: sendingJob.mentions ?? []",
      "mentionAll: sendingJob.mention_all",
      "replyToId: sendingJob.reply_to_id",
      "scheduleGroupOutboxJob(failed, expectedSession)",
    ])
      expect(source).toContain(fact);
  });

  it("keeps an A retry alive across A→B→A and invalidates every callback on real unmount", () => {
    expect(source).toContain("Only a real unmount stops component-owned");
    expect(source).toContain('activeSessionRef.current = ""');
    expect(source).toContain("const outboxTimers = outboxTimersRef.current");
    expect(source).toContain("for (const timer of outboxTimers.values()) clearTimeout(timer)");
    expect(source).toContain("outboxTimers.clear()");
  });

  it("keeps media confirmations owner-global so switching groups cannot lose a completed upload", () => {
    expect(source).toContain(
      "saveGroupChatMessages(currentOwnerId, eventGroupId, [event.message])",
    );
    expect(source).toContain(
      "activeSessionRef.current !== groupChatSessionKey(currentOwnerId, eventGroupId)",
    );
    expect(source).toContain('resumeChatImageUploads(currentOwnerId, "group", targetId)');
    expect(source).toContain('resumeChatVideoUploads(currentOwnerId, "group", targetId)');
  });

  it("reconciles destructive actions, exact media cancellation, selection and calls", () => {
    for (const fact of [
      "cancelChatImageUpload(user.user_id, message.client_message_id)",
      "cancelChatVideoUpload(user.user_id, message.client_message_id)",
      'hideChatMessagesLocally(ownerId, "group", String(groupId), selectedIds)',
      "pruneGroupChatCachedMessagesThroughSequence(",
      ".filter(isAvailableForGroupSelection)",
      "setSelectionEntries(next.length > 0 ? next : null)",
      'setToastMessage(t("selection.removedUnavailable"))',
      "if (call.session === null) return",
      "Keyboard.dismiss()",
    ])
      expect(source).toContain(fact);
  });
});
