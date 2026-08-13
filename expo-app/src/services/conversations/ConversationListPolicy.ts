import type {
  AgentConversation,
  AgentMessage,
  AgentSummary,
  Conversation,
  FriendInfo,
} from "@/models";
import {
  agentAvatarAssetId,
  agentConversationPreview,
  agentDisplayName,
  agentMessagePreview,
  compareMessageTimes,
  formatAgentHubListTime,
} from "@/services/agents/agentHubPolicy";
import { giftMessagePreview } from "@/services/messages/chatGiftPolicy";
import {
  chatMoneyMessagePreview,
  isChatMoneyReceiptType,
  normalizeChatMoneyReceipt,
  parseChatMoneyPayload,
} from "@/services/messages/chatMoneyPolicy";
import {
  localizedChatStickerText,
  parseChatStickerMessagePayload,
} from "@/services/messages/chatStickerPolicy";

export interface ConversationListLocalState {
  hiddenSnapshots: Record<string, string>;
  pinnedKeys: Set<string>;
}

const realtimeUnreadEventBuckets = new Map<string, Set<string>>();
const maxRealtimeUnreadConversations = 256;
const maxRealtimeUnreadEventsPerConversation = 512;

export function conversationListIdentity(conversation: Conversation): string {
  if (normalizedConversationType(conversation) === "agent") {
    const kind = normalizedKind(conversation.conversation_kind);
    const conversationId = conversation.agent_conversation_id?.trim();
    if (conversationId) return `agent:${conversationId}`;
    if (kind === "agent_conversation" && conversation.id.trim()) {
      return `agent:${conversation.id.trim()}`;
    }
    return `agent-profile:${conversation.agent_id?.trim() || conversation.id.trim()}`;
  }
  if (normalizedConversationType(conversation) === "group") {
    return `group:${resolvedGroupId(conversation) ?? conversation.id.trim()}`;
  }
  return `dm:${conversation.id.trim()}`;
}

export function conversationPreferenceTarget(conversation: Conversation): {
  type: "dm" | "group" | "agent";
  targetId: string;
} {
  const type = normalizedConversationType(conversation);
  return {
    type,
    targetId:
      type === "group"
        ? String(resolvedGroupId(conversation) ?? conversation.id.trim())
        : conversation.id.trim(),
  };
}

export function isScriptRoomConversation(conversation: Conversation): boolean {
  return (
    normalizedKind(conversation.conversation_kind) === "script_room" &&
    Boolean(conversation.script_room_id?.trim())
  );
}

export function shouldResolveScriptRoomAvatar(conversation: Conversation): boolean {
  return isScriptRoomConversation(conversation) && Boolean(conversation.script_room_id?.trim());
}

export function isAgentConversation(conversation: Conversation): boolean {
  return normalizedConversationType(conversation) === "agent";
}

export function resolvedGroupId(conversation: Conversation): number | undefined {
  if (normalizedConversationType(conversation) !== "group") return undefined;
  if (conversation.group_id !== undefined && conversation.group_id > 0) {
    return conversation.group_id;
  }
  if (/^\d+$/.test(conversation.id.trim())) return Number(conversation.id.trim());
  const match = conversation.id.match(/(\d+)\D*$/);
  return match ? Number(match[1]) : undefined;
}

export function conversationHiddenSnapshot(conversation: Conversation): string {
  return `${conversation.last_message_time ?? ""}\u001f${conversation.last_message ?? ""}`;
}

export function applyConversationLocalState(
  conversations: readonly Conversation[],
  state: ConversationListLocalState,
  currentUserId?: string,
): { conversations: Conversation[]; hiddenSnapshots: Record<string, string> } {
  const hiddenSnapshots = { ...state.hiddenSnapshots };
  const visible = conversations.filter((conversation) => {
    const identity = conversationListIdentity(conversation);
    const hidden = hiddenSnapshots[identity];
    if (hidden === undefined) return true;
    if (hiddenSnapshotMatches(hidden, conversation)) return false;
    delete hiddenSnapshots[identity];
    return true;
  });
  return {
    conversations: sortConversationRows(visible, state.pinnedKeys, currentUserId),
    hiddenSnapshots,
  };
}

export function sortConversationRows(
  conversations: readonly Conversation[],
  pinnedKeys: ReadonlySet<string>,
  currentUserId?: string,
): Conversation[] {
  return [...conversations].sort((left, right) => {
    const leftSelf = normalizedConversationType(left) === "dm" && left.id === currentUserId;
    const rightSelf = normalizedConversationType(right) === "dm" && right.id === currentUserId;
    if (leftSelf !== rightSelf) return leftSelf ? -1 : 1;
    const leftPinned = pinnedKeys.has(conversationListIdentity(left));
    const rightPinned = pinnedKeys.has(conversationListIdentity(right));
    if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
    const timeOrder = compareMessageTimes(right.last_message_time, left.last_message_time);
    return (
      timeOrder || conversationListIdentity(left).localeCompare(conversationListIdentity(right))
    );
  });
}

export function visibleChatConversations(
  conversations: readonly Conversation[],
  friends: readonly FriendInfo[],
  currentUserId: string,
  locallyInitiatedDmIds: ReadonlySet<string> = new Set(),
): Conversation[] {
  const friendIds = new Set(friends.map((friend) => friend.user_id));
  return conversations.filter((conversation) => {
    if (normalizedConversationType(conversation) !== "dm") return true;
    if (conversation.id === currentUserId) return true;
    if (
      conversation.last_message !== undefined ||
      conversation.last_message_time !== undefined ||
      conversation.unread_count > 0
    ) {
      return true;
    }
    return friendIds.has(conversation.id) || locallyInitiatedDmIds.has(conversation.id);
  });
}

export function preservingIncompleteConversationRows(
  incoming: readonly Conversation[],
  current: readonly Conversation[],
  snapshotComplete: boolean | undefined,
): Conversation[] {
  if (snapshotComplete === true) return [...incoming];
  const rows = new Map(incoming.map((row) => [conversationListIdentity(row), row]));
  for (const row of current) {
    if (isAgentConversation(row)) continue;
    const identity = conversationListIdentity(row);
    if (!rows.has(identity)) rows.set(identity, row);
  }
  return [...rows.values()];
}

export function reconcileLivePairConversationRows(
  incoming: readonly Conversation[],
  current: readonly Conversation[],
  registeredPeerIds: ReadonlySet<string>,
): Conversation[] {
  return reconcileRetainedDirectConversationRows(incoming, current, registeredPeerIds);
}

export function reconcileRetainedDirectConversationRows(
  incoming: readonly Conversation[],
  current: readonly Conversation[],
  retainedPeerIds: ReadonlySet<string>,
): Conversation[] {
  const rows = new Map(incoming.map((row) => [conversationListIdentity(row), row]));
  for (const row of current) {
    if (normalizedConversationType(row) !== "dm" || !retainedPeerIds.has(row.id)) continue;
    const identity = conversationListIdentity(row);
    if (!rows.has(identity)) rows.set(identity, row);
  }
  return [...rows.values()];
}

export function reconcileLatestConversationPreviews(
  incoming: readonly Conversation[],
  current: readonly Conversation[],
): Conversation[] {
  const currentRows = new Map(current.map((row) => [conversationListIdentity(row), row]));
  return incoming.map((row) => {
    const live = currentRows.get(conversationListIdentity(row));
    if (!live) return row;
    const timeOrder = compareMessageTimes(live.last_message_time, row.last_message_time);
    const liveSequence = live.last_message_sequence ?? live.last_message_id;
    const rowSequence = row.last_message_sequence ?? row.last_message_id;
    const versionOrder = (live.last_message_version ?? 0) - (row.last_message_version ?? 0);
    const liveMessageIsNewer =
      liveSequence !== undefined && rowSequence !== undefined
        ? liveSequence > rowSequence ||
          (liveSequence === rowSequence &&
            (versionOrder > 0 || (versionOrder === 0 && timeOrder > 0)))
        : timeOrder > 0 ||
          (timeOrder === 0 &&
            live.last_message_id !== undefined &&
            row.last_message_id === undefined);
    const liveKnowsSameMessageSender =
      timeOrder === 0 &&
      live.last_message_id !== undefined &&
      live.last_message_id === row.last_message_id &&
      live.last_message === row.last_message &&
      Boolean(live.last_message_sender_id?.trim());
    const readThrough = Math.max(
      live.read_through_message_id ?? 0,
      row.read_through_message_id ?? 0,
    );
    const incomingLastMessageId = row.last_message_id ?? 0;
    const liveReadCoversIncoming =
      live.unread_count === 0 && readThrough > 0 && readThrough >= incomingLastMessageId;
    const unreadCount = liveReadCoversIncoming
      ? 0
      : liveMessageIsNewer
        ? live.unread_count
        : timeOrder === 0 && row.revision !== undefined
          ? row.unread_count
          : Math.max(live.unread_count, row.unread_count);
    return {
      ...row,
      ...(liveMessageIsNewer
        ? {
            last_message: live.last_message,
            last_message_time: live.last_message_time,
            last_message_id: live.last_message_id,
            last_message_version: live.last_message_version,
            last_message_sequence: live.last_message_sequence,
            last_message_sender_id: live.last_message_sender_id,
            subtitle: live.subtitle,
          }
        : liveKnowsSameMessageSender
          ? {
              last_message_sender_id: live.last_message_sender_id,
              subtitle: live.subtitle,
            }
          : {}),
      unread_count: unreadCount,
      ...(readThrough > 0 ? { read_through_message_id: readThrough } : {}),
      ...(live.conversation_revision !== undefined || row.conversation_revision !== undefined
        ? {
            conversation_revision: Math.max(
              live.conversation_revision ?? 0,
              row.conversation_revision ?? 0,
            ),
          }
        : {}),
      ...(live.unread_revision !== undefined || row.unread_revision !== undefined
        ? { unread_revision: Math.max(live.unread_revision ?? 0, row.unread_revision ?? 0) }
        : {}),
    };
  });
}

export function mergeAgentConversationRows(
  chatRows: readonly Conversation[],
  currentRows: readonly Conversation[],
  agentConversations: readonly AgentConversation[] | undefined,
  installedAgents: readonly AgentSummary[] | undefined,
  translate: (key: string) => string,
): Conversation[] {
  const activeRows =
    agentConversations === undefined
      ? currentRows.filter(isAgentConversation)
      : agentConversations.map((conversation) => {
          const incoming = agentConversationRow(conversation, translate);
          const current = currentRows.find(
            (row) => conversationListIdentity(row) === conversationListIdentity(incoming),
          );
          return current ? mergeAgentConversationRowState(current, incoming) : incoming;
        });
  const activeAgentIds = new Set(
    activeRows
      .map((row) => row.agent_id?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  const profileRows =
    installedAgents === undefined
      ? currentRows.filter(
          (row) =>
            isAgentConversation(row) && conversationListIdentity(row).startsWith("agent-profile:"),
        )
      : installedAgents
          .filter((agent) => agent.is_owner !== false && !activeAgentIds.has(agent.id))
          .map(installedAgentRow);
  const rows = new Map<string, Conversation>();
  for (const row of [...chatRows, ...activeRows, ...profileRows]) {
    const identity = conversationListIdentity(row);
    const existing = rows.get(identity);
    if (!existing || compareMessageTimes(row.last_message_time, existing.last_message_time) >= 0) {
      rows.set(identity, row);
    }
  }
  return [...rows.values()];
}

export function applyServerPinnedRows(
  previous: ReadonlySet<string>,
  conversations: readonly Conversation[],
): Set<string> {
  const next = new Set(previous);
  for (const conversation of conversations) {
    if (conversation.is_pinned === undefined) continue;
    const identity = conversationListIdentity(conversation);
    if (conversation.is_pinned) next.add(identity);
    else next.delete(identity);
  }
  return next;
}

export function conversationListTime(
  value: string | undefined,
  now: Date,
  yesterdayLabel: string,
): string {
  return formatAgentHubListTime(value, now, yesterdayLabel);
}

export function conversationPreviewText(
  conversation: Conversation,
  context: {
    activeLanguage: string;
    viewerId?: string | undefined;
    translate: (key: string, ...args: (string | number)[]) => string;
  },
): string | undefined {
  const content = conversation.last_message;
  if (content === undefined) return undefined;
  return conversationContentPreviewText(content, context);
}

export function conversationContentPreviewText(
  content: string,
  context: {
    activeLanguage: string;
    viewerId?: string | undefined;
    translate: (key: string, ...args: (string | number)[]) => string;
  },
): string {
  const sticker = parseConversationStickerJSON(content);
  if (sticker) {
    const name = localizedChatStickerText(sticker.name, context.activeLanguage)?.trim();
    return name ? `[${name}]` : context.translate("message.sticker");
  }
  const money = nativeConversationMoneyPreview(content, context.viewerId, context.translate);
  if (money !== undefined) return money;
  return giftMessagePreview(content, context.translate);
}

function parseConversationStickerJSON(
  content: string,
): ReturnType<typeof parseChatStickerMessagePayload> {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.sticker_id !== "string" ||
      typeof record.pack_id !== "string" ||
      typeof record.asset_key !== "string"
    ) {
      return null;
    }
    return parseChatStickerMessagePayload(trimmed);
  } catch {
    return null;
  }
}

export function conversationSenderPrefix(
  conversation: Conversation,
  translate?: (key: string, ...args: (string | number)[]) => string,
  viewerId?: string,
): string | undefined {
  if (
    normalizedConversationType(conversation) === "group" &&
    sameNonEmptyUserId(conversation.last_message_sender_id, viewerId)
  ) {
    return undefined;
  }
  return conversationSenderPrefixText(
    conversation.subtitle,
    conversation.last_message ?? "",
    translate,
  );
}

export function conversationEventSender(
  messageType: string,
  content: string,
  senderId: string | undefined,
  senderName: string | undefined,
  viewerId: string | undefined,
  translate?: (key: string, ...args: (string | number)[]) => string,
): string | undefined {
  if (sameNonEmptyUserId(senderId, viewerId)) return undefined;
  if (!shouldShowConversationEventSender(messageType, content)) return undefined;
  return conversationSenderPrefixText(senderName, content, translate);
}

export function conversationSenderPrefixText(
  senderValue: string | undefined,
  content: string,
  translate?: (key: string, ...args: (string | number)[]) => string,
): string | undefined {
  const sender = senderValue?.trim();
  if (!sender || ["未知", "unknown", "null", "nil"].includes(sender.toLocaleLowerCase())) {
    return undefined;
  }
  if (
    normalizeChatMoneyReceipt(content) ||
    (translate && isReceiptDisplayText(content, translate))
  ) {
    return undefined;
  }
  return sender;
}

export function shouldShowConversationEventSender(messageType: string, content: string): boolean {
  const type = messageType.trim().toLocaleLowerCase().replaceAll("-", "_");
  if (["recall", "recalled", "withdrawn", "revoked", "message_recalled"].includes(type)) {
    return false;
  }
  return !isChatMoneyReceiptType(type) && normalizeChatMoneyReceipt(content) === null;
}

function sameNonEmptyUserId(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = left?.trim();
  const normalizedRight = right?.trim();
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function aggregateConversationUnread(conversations: readonly Conversation[]): number {
  return conversations.reduce(
    (total, conversation) =>
      total + (conversation.is_muted ? 0 : Math.max(0, conversation.unread_count)),
    0,
  );
}

export function shouldApplyConversationPreview(
  conversation: Conversation,
  timestamp: string | undefined,
  messageId: number | undefined,
): boolean {
  const timeOrder = compareMessageTimes(timestamp, conversation.last_message_time);
  if (timeOrder !== 0) return timeOrder > 0;
  if (messageId === undefined || conversation.last_message_id === undefined) return true;
  return messageId > conversation.last_message_id;
}

export function shouldApplyRealtimeConversationPreview(
  conversation: Conversation,
  timestamp: string | undefined,
  messageId: number | undefined,
  isUpdate: boolean,
  messageVersion?: number | undefined,
  messageSequence?: number | undefined,
): boolean {
  const currentMessageId = conversation.last_message_id;
  const currentSequence = conversation.last_message_sequence ?? currentMessageId;
  const incomingSequence = messageSequence ?? messageId;
  if (incomingSequence !== undefined && currentSequence !== undefined) {
    if (incomingSequence !== currentSequence) return incomingSequence > currentSequence;
    if (messageVersion !== undefined || conversation.last_message_version !== undefined) {
      return (messageVersion ?? 0) > (conversation.last_message_version ?? 0);
    }
    if (isUpdate) {
      return (
        messageId === currentMessageId &&
        compareMessageTimes(timestamp, conversation.last_message_time) >= 0
      );
    }
    return false;
  }
  return shouldApplyConversationPreview(conversation, timestamp, messageId);
}

export function applyAgentRealtimeMessage(
  conversation: Conversation,
  message: AgentMessage,
  incrementUnread: boolean,
  translate: (key: string) => string,
  isUpdate = false,
): Conversation {
  if (conversationListIdentity(conversation) !== `agent:${message.conversation_id.trim()}`) {
    return conversation;
  }
  const timestamp = message.updated_at.trim() || message.created_at.trim();
  const sequence = message.sequence_no > 0 ? message.sequence_no : undefined;
  const shouldApply = shouldApplyRealtimeConversationPreview(
    conversation,
    timestamp || undefined,
    sequence,
    isUpdate,
    undefined,
    sequence,
  );
  if (!shouldApply) {
    return incrementUnread
      ? { ...conversation, unread_count: conversation.unread_count + 1 }
      : conversation;
  }
  const preview = agentMessagePreview(message, conversation.name, translate).trim();
  return {
    ...conversation,
    ...(preview ? { last_message: preview } : {}),
    ...(timestamp ? { last_message_time: timestamp } : {}),
    ...(sequence !== undefined ? { last_message_id: sequence } : {}),
    ...(sequence !== undefined ? { last_message_sequence: sequence } : {}),
    unread_count: incrementUnread ? conversation.unread_count + 1 : conversation.unread_count,
  };
}

export function consumeConversationRealtimeUnreadEvent(input: {
  ownerId: string;
  conversation: Conversation;
  messageId: string | number;
  incoming: boolean;
  isActive: boolean;
  isUpdate: boolean;
  alreadyProjected: boolean;
}): boolean {
  const owner = input.ownerId.trim();
  const messageId = String(input.messageId).trim();
  if (!owner || !messageId) return false;
  const bucketIdentity = `${encodeURIComponent(owner)}:${conversationListIdentity(
    input.conversation,
  )}`;
  let bucket = realtimeUnreadEventBuckets.get(bucketIdentity);
  if (!bucket) {
    bucket = new Set();
    realtimeUnreadEventBuckets.set(bucketIdentity, bucket);
    while (realtimeUnreadEventBuckets.size > maxRealtimeUnreadConversations) {
      const oldestIdentity = realtimeUnreadEventBuckets.keys().next().value;
      if (oldestIdentity === undefined) break;
      realtimeUnreadEventBuckets.delete(oldestIdentity);
    }
  }
  if (bucket.has(messageId)) return false;
  bucket.add(messageId);
  while (bucket.size > maxRealtimeUnreadEventsPerConversation) {
    const oldestMessageId = bucket.values().next().value;
    if (oldestMessageId === undefined) break;
    bucket.delete(oldestMessageId);
  }
  return input.incoming && !input.isActive && !input.isUpdate && !input.alreadyProjected;
}

export function resetConversationRealtimeUnreadEventsForTests(): void {
  realtimeUnreadEventBuckets.clear();
}

function agentConversationRow(
  conversation: AgentConversation,
  translate: (key: string) => string,
): Conversation {
  const preview = agentConversationPreview(conversation, translate).trim();
  const latestSequence = conversation.latest_message?.sequence_no;
  const readThroughSequence = conversation.read_through_sequence;
  return {
    type: "agent",
    id: conversation.id,
    name: conversation.agent_profile.name,
    avatar_url: "",
    ...(preview ? { last_message: preview } : {}),
    last_message_time: conversation.latest_message?.updated_at || conversation.updated_at,
    ...(latestSequence !== undefined && latestSequence > 0
      ? { last_message_id: latestSequence }
      : {}),
    unread_count: Math.max(0, conversation.unread_count ?? 0),
    ...(readThroughSequence !== undefined && readThroughSequence > 0
      ? { read_through_message_id: readThroughSequence }
      : {}),
    ...(conversation.revision !== undefined ? { revision: conversation.revision } : {}),
    conversation_kind: "agent_conversation",
    agent_conversation_id: conversation.id,
    agent_id: conversation.agent_id,
    ...(conversation.agent_profile.avatar_asset_id
      ? { agent_avatar_asset_id: conversation.agent_profile.avatar_asset_id }
      : {}),
    is_muted: false,
  };
}

function mergeAgentConversationRowState(
  current: Conversation,
  incoming: Conversation,
): Conversation {
  const incomingPreviewIsNewer =
    incoming.last_message_id !== undefined && current.last_message_id !== undefined
      ? incoming.last_message_id > current.last_message_id ||
        (incoming.last_message_id === current.last_message_id &&
          compareMessageTimes(incoming.last_message_time, current.last_message_time) >= 0)
      : shouldApplyConversationPreview(
          current,
          incoming.last_message_time,
          incoming.last_message_id,
        );
  const currentRevision = current.revision;
  const incomingRevision = incoming.revision;
  const incomingRevisionIsNewer =
    incomingRevision !== undefined &&
    (currentRevision === undefined || incomingRevision > currentRevision);
  const currentRevisionIsNewer =
    currentRevision !== undefined &&
    (incomingRevision === undefined || currentRevision > incomingRevision);
  const unreadCount = incomingRevisionIsNewer
    ? incoming.unread_count
    : currentRevisionIsNewer
      ? current.unread_count
      : currentRevision !== undefined || incomingRevision !== undefined
        ? Math.min(current.unread_count, incoming.unread_count)
        : incomingPreviewIsNewer
          ? incoming.unread_count
          : current.unread_count;
  const readThrough = Math.max(
    current.read_through_message_id ?? 0,
    incoming.read_through_message_id ?? 0,
  );
  return {
    ...incoming,
    ...(!incomingPreviewIsNewer
      ? {
          last_message: current.last_message,
          last_message_time: current.last_message_time,
          last_message_id: current.last_message_id,
        }
      : {}),
    unread_count: unreadCount,
    ...(readThrough > 0 ? { read_through_message_id: readThrough } : {}),
    ...(currentRevision !== undefined || incomingRevision !== undefined
      ? { revision: Math.max(currentRevision ?? 0, incomingRevision ?? 0) }
      : {}),
  };
}

function installedAgentRow(agent: AgentSummary): Conversation {
  const preview = (agent.profile?.tagline ?? agent.profile?.description ?? "").trim();
  const avatarId = agentAvatarAssetId(agent);
  return {
    type: "agent",
    id: agent.id,
    name: agentDisplayName(agent),
    avatar_url: "",
    ...(preview ? { last_message: preview } : {}),
    unread_count: 0,
    conversation_kind: "agent_profile",
    agent_id: agent.id,
    ...(avatarId ? { agent_avatar_asset_id: avatarId } : {}),
    ...(agent.greetings?.[0]?.id ? { agent_greeting_id: agent.greetings[0].id } : {}),
    is_muted: false,
  };
}

function nativeConversationMoneyPreview(
  content: string,
  viewerId: string | undefined,
  translate: (key: string, ...args: (string | number)[]) => string,
): string | undefined {
  if (normalizeChatMoneyReceipt(content)) {
    return chatMoneyMessagePreview("", content, viewerId, translate);
  }
  const payload = parseChatMoneyPayload(content);
  if (!payload) return undefined;
  const base =
    payload.kind === "transfer"
      ? translate("chatMoney.preview.transfer")
      : translate("chatMoney.preview.redPacket");
  if (!viewerId) return base;
  return `${base} ${nativeChatMoneyPrompt(payload, viewerId, translate)}`;
}

function nativeChatMoneyPrompt(
  payload: NonNullable<ReturnType<typeof parseChatMoneyPayload>>,
  viewerId: string,
  translate: (key: string) => string,
): string {
  const viewerIsSender = payload.sender_id === viewerId;
  const viewerIsRecipient = payload.recipient_id === viewerId;
  if (payload.status !== "pending" && payload.status !== "partial") {
    if (payload.kind === "transfer") {
      if (payload.status === "accepted") {
        if (viewerIsSender) return translate("chatMoney.transfer.card.acceptedByRecipient");
        if (viewerIsRecipient) return translate("chatMoney.transfer.card.receivedByMe");
      } else if (payload.status === "returned") {
        if (viewerIsSender) return translate("chatMoney.transfer.card.returnedToMe");
        if (viewerIsRecipient) return translate("chatMoney.transfer.card.returnedByMe");
      } else if (payload.status === "expired_refunded") {
        return translate("chatMoney.transfer.card.expiredRefunded");
      }
    }
    return translate(chatMoneyStatusKey(payload.status));
  }
  if (payload.kind === "transfer") {
    if (viewerIsRecipient) return translate("chatMoney.transfer.receivePrompt");
    if (viewerIsSender) return translate("chatMoney.transfer.waitingForRecipient");
    return translate("chatMoney.transfer.pendingReceipt");
  }
  const viewerCanClaim =
    (payload.scope === "group" && ["lucky", "equal"].includes(payload.mode ?? "")) ||
    (payload.mode === "exclusive" && viewerIsRecipient) ||
    (payload.scope === "dm" && viewerIsRecipient);
  if (viewerCanClaim) return translate("chatMoney.redPacket.claimPrompt");
  if (viewerIsSender) {
    return translate(
      payload.mode === "exclusive"
        ? "chatMoney.redPacket.waitingForExclusiveRecipient"
        : "chatMoney.redPacket.waitingForRecipient",
    );
  }
  return translate(chatMoneyStatusKey(payload.status));
}

function chatMoneyStatusKey(status: string): string {
  return status === "expired_refunded"
    ? "chatMoney.status.expiredRefunded"
    : `chatMoney.status.${status}`;
}

function isReceiptDisplayText(content: string, translate: (key: string) => string): boolean {
  return [
    "chatMoney.receipt.claimedByMe",
    "chatMoney.receipt.claimedMine",
    "chatMoney.receipt.claimed",
    "chatMoney.receipt.transferAccepted",
    "chatMoney.receipt.transferAcceptedByMe",
    "chatMoney.receipt.transferAcceptedMine",
    "chatMoney.receipt.transferAcceptedBetween",
    "chatMoney.receipt.transferReturned",
    "chatMoney.receipt.transferReturnedByMe",
    "chatMoney.receipt.transferReturnedMine",
    "chatMoney.receipt.transferReturnedBetween",
    "chatMoney.receipt.redPacketExpiredRefunded",
    "chatMoney.receipt.transferExpiredRefunded",
    "chatMoney.receipt.expiredRefunded",
    "chatMoney.receipt.activity",
  ].some((key) => matchesLocalizedTemplate(content, translate(key), key));
}

function matchesLocalizedTemplate(content: string, template: string, key: string): boolean {
  if (template === key) return false;
  const parts = template.split("%@").filter(Boolean);
  if (parts.length === 0) return false;
  if (!template.includes("%@")) return content === template;
  let offset = 0;
  for (const part of parts) {
    const index = content.indexOf(part, offset);
    if (index < 0) return false;
    offset = index + part.length;
  }
  return true;
}

function hiddenSnapshotMatches(stored: string, conversation: Conversation): boolean {
  const separator = stored.indexOf("\u001f");
  if (separator < 0) {
    return compareMessageTimes(stored, conversation.last_message_time) === 0;
  }
  return (
    compareMessageTimes(stored.slice(0, separator), conversation.last_message_time) === 0 &&
    stored.slice(separator + 1) === (conversation.last_message ?? "")
  );
}

function normalizedConversationType(conversation: Conversation): "dm" | "group" | "agent" {
  const type = conversation.type.trim().toLocaleLowerCase().replaceAll("-", "_");
  if (["group", "group_chat", "groupchat", "room"].includes(type)) return "group";
  if (["agent", "agent_chat", "agent_conversation", "agent_profile"].includes(type)) {
    return "agent";
  }
  if (conversation.group_id !== undefined || /^group[_:]/.test(conversation.id)) return "group";
  return "dm";
}

function normalizedKind(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase().replaceAll("-", "_") ?? "";
}
