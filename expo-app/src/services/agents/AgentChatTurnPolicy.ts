import type { AgentMessage, AgentMessagePart, AgentPartMetadata, AgentTurn } from "@/models";
import { isAgentTransformRequest } from "@/services/agents/AgentImageReplyPolicy";

export type AgentGeneratedMediaPollingDecision = "stop" | "waitForMediaPart" | "waitForGeneration";

export interface AgentTurnNotice {
  message: string;
  allowsRetry: boolean;
  isFailure: boolean;
}

export const agentTurnPollingPolicy = Object.freeze({
  intervalMilliseconds: 1_000,
  maximumDurationMilliseconds: 20 * 60 * 1_000,
  terminalMediaAppearanceGraceMilliseconds: 45_000,
  terminalResponseAppearanceGraceMilliseconds: 45_000,
  resumeTurnLimit: 5,
});

const terminalStatuses = new Set(["completed", "completed_with_errors", "failed"]);
const optimisticAgentMessageSource = "local_optimistic";

export interface AgentOptimisticMessageInput {
  clientMessageId: string;
  conversationId: string;
  createdAt: string;
  imageUri?: string | null | undefined;
  ownerId: string;
  replyToId?: string | null | undefined;
  sequenceNo: number;
  text: string;
}

export function isAgentTurnTerminal(status: string | null | undefined): boolean {
  return terminalStatuses.has(status?.trim().toLowerCase() ?? "");
}

export function makeAgentOptimisticMessage(input: AgentOptimisticMessageInput): AgentMessage {
  const parts: AgentMessagePart[] = [];
  if (input.text) {
    parts.push({
      id: `${input.clientMessageId}:text`,
      ordinal: 0,
      type: "text",
      text: input.text,
      metadata: {},
    });
  }
  if (input.imageUri) {
    parts.push({
      id: `${input.clientMessageId}:image`,
      ordinal: parts.length,
      type: "input_image",
      text: "",
      metadata: { content_url: input.imageUri },
    });
  }
  return {
    id: `local:${input.clientMessageId}`,
    conversation_id: input.conversationId,
    sequence_no: input.sequenceNo,
    sender: { type: "user", id: input.ownerId },
    source: optimisticAgentMessageSource,
    status: "sending",
    ...(input.replyToId ? { reply_to_id: input.replyToId } : {}),
    client_message_id: input.clientMessageId,
    created_at: input.createdAt,
    updated_at: input.createdAt,
    parts,
  };
}

export function isAgentOptimisticMessage(message: AgentMessage): boolean {
  return message.source === optimisticAgentMessageSource;
}

export function agentMessageIdentity(message: AgentMessage): string {
  const clientMessageId = message.client_message_id?.trim();
  if (clientMessageId) return `client:${clientMessageId}`;
  const messageId = message.id.trim();
  return messageId ? `server:${messageId}` : `sequence:${message.sequence_no}`;
}

export function nextAgentOptimisticSequence(messages: readonly AgentMessage[]): number {
  return (
    messages.reduce(
      (maximum, message) =>
        Math.max(maximum, Number.isFinite(message.sequence_no) ? message.sequence_no : 0),
      0,
    ) + 1
  );
}

export function agentGeneratedMediaPollingDecision(
  expectsGeneratedMedia: boolean,
  mediaParts: readonly AgentMessagePart[],
): AgentGeneratedMediaPollingDecision {
  if (mediaParts.length === 0) return expectsGeneratedMedia ? "waitForMediaPart" : "stop";

  const hasUnsettledPart = mediaParts.some((part) => {
    const status = part.metadata.generation_status?.trim().toLowerCase();
    if (["queued", "pending", "processing", "generating"].includes(status ?? "")) return true;
    if (status === "failed" || status === "expired") return false;

    if (["ready", "ready_locked", "completed"].includes(status ?? "")) {
      if (part.metadata.access === "unlocked") {
        return !part.metadata.content_url && !part.metadata.download_url;
      }
      if (part.metadata.access === "locked") {
        return !part.metadata.preview_url && !part.metadata.content_url;
      }
      return true;
    }

    return !part.metadata.preview_url && !part.metadata.content_url && !part.metadata.download_url;
  });
  return hasUnsettledPart ? "waitForGeneration" : "stop";
}

export function agentTurnProgressStatus(input: {
  turnStatus: string | null;
  isAwaitingGeneratedMedia: boolean;
  isAwaitingTerminalResponse: boolean;
  mediaDecision: AgentGeneratedMediaPollingDecision | null;
}): string | null {
  if (input.isAwaitingGeneratedMedia) {
    return input.mediaDecision === "waitForGeneration" ? null : "waiting_image";
  }
  if (input.isAwaitingTerminalResponse) return "waiting_response";
  return isAgentTurnTerminal(input.turnStatus) ? null : input.turnStatus;
}

export function shouldWaitForAgentTerminalResponse(
  turnStatus: string,
  hasRenderableResponse: boolean,
): boolean {
  return ["completed", "completed_with_errors"].includes(turnStatus) && !hasRenderableResponse;
}

export function agentTurnExpectsGeneratedMedia(
  turn: AgentTurn,
  messages: readonly AgentMessage[],
  expectedMediaTurnIds: ReadonlySet<string> = new Set(),
): boolean {
  if (expectedMediaTurnIds.has(turn.id)) return true;
  const trigger = messages.find((message) => message.id === turn.trigger_message_id);
  if (!trigger?.parts.some((part) => part.type === "input_image")) return false;
  return trigger.parts.some((part) => part.type === "text" && isAgentTransformRequest(part.text));
}

export function agentTurnResponseMessages(
  turn: AgentTurn,
  messages: readonly AgentMessage[],
): AgentMessage[] {
  return messages.filter(
    (message) =>
      message.sender.type === "agent" &&
      (message.turn_id === turn.id || message.id === turn.response_message_id),
  );
}

export function isRenderableAgentMessage(message: AgentMessage): boolean {
  return message.parts.some((part) => {
    if (part.type === "text") return Boolean(part.text.trim());
    return part.type === "input_image" || part.type === "paid_media";
  });
}

export function agentTerminalTurnNotice(
  turn: AgentTurn,
  responseMessages: readonly AgentMessage[],
  expectsGeneratedMedia: boolean,
  allowsRetry: boolean,
): AgentTurnNotice | null {
  const mediaParts = responseMessages
    .flatMap((message) => message.parts)
    .filter(
      (part) => part.type === "paid_media" && part.metadata.media_type?.toLowerCase() !== "video",
    );
  const hasFailedMedia = mediaParts.some(
    (part) => part.metadata.generation_status?.toLowerCase() === "failed",
  );
  const hasRenderableResponse = responseMessages.some(isRenderableAgentMessage);

  if (turn.status === "failed") {
    return {
      message: turn.error_detail.trim() || "智能体回复失败，点击重试",
      allowsRetry,
      isFailure: true,
    };
  }
  if (turn.status === "completed_with_errors") {
    return {
      message:
        turn.error_detail.trim() ||
        (expectsGeneratedMedia ? "图片调整失败，请重试" : "部分内容生成失败"),
      allowsRetry: expectsGeneratedMedia && allowsRetry,
      isFailure: expectsGeneratedMedia,
    };
  }
  if (turn.status === "completed" && expectsGeneratedMedia && mediaParts.length === 0) {
    return {
      message:
        "后端已完成回复，但没有返回调整后的图片。请重试；若持续出现，请检查该会话的图片能力。",
      allowsRetry,
      isFailure: true,
    };
  }
  if (turn.status === "completed" && expectsGeneratedMedia && hasFailedMedia) {
    return { message: "图片生成失败，请重试", allowsRetry, isFailure: true };
  }
  if (turn.status === "completed" && !expectsGeneratedMedia && !hasRenderableResponse) {
    return {
      message: "后端已完成处理，但回复消息尚未返回，请重试",
      allowsRetry,
      isFailure: true,
    };
  }
  return null;
}

export function mergeAgentTimeline(
  current: readonly AgentMessage[],
  incoming: readonly AgentMessage[],
): AgentMessage[] {
  const next = [...current];
  for (const message of incoming) {
    const index = next.findIndex((candidate) => sameAgentTimelineSlot(candidate, message));
    if (index < 0) {
      next.push(message);
      continue;
    }
    const existing = next[index]!;
    if (!shouldReplaceAgentMessage(existing, message)) continue;
    const serverReplacement =
      message.client_message_id || !existing.client_message_id
        ? message
        : { ...message, client_message_id: existing.client_message_id };
    const replacement = preserveAgentMediaAdvancements(existing, serverReplacement);
    if (!agentMessagesEqual(existing, replacement)) next[index] = replacement;
  }
  return next.sort(
    (left, right) => left.sequence_no - right.sequence_no || left.id.localeCompare(right.id),
  );
}

export function agentMessageTimelinesEqual(
  left: readonly AgentMessage[],
  right: readonly AgentMessage[],
): boolean {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((message, index) => agentMessagesEqual(message, right[index]!)))
  );
}

export function newestAgentTurnIds(
  messages: readonly AgentMessage[],
  limit = agentTurnPollingPolicy.resumeTurnLimit,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const message of [...messages].sort((left, right) => right.sequence_no - left.sequence_no)) {
    const turnId = message.turn_id?.trim();
    if (turnId && !seen.has(turnId)) {
      seen.add(turnId);
      ids.push(turnId);
      if (ids.length >= limit) break;
    }
  }
  return ids;
}

function sameAgentTimelineSlot(left: AgentMessage, right: AgentMessage): boolean {
  const leftClientId = left.client_message_id?.trim();
  const rightClientId = right.client_message_id?.trim();
  if (leftClientId && rightClientId && leftClientId === rightClientId) return true;
  if (left.id && right.id && left.id === right.id) return true;
  return (
    !isAgentOptimisticMessage(left) &&
    !isAgentOptimisticMessage(right) &&
    left.sequence_no > 0 &&
    left.sequence_no === right.sequence_no
  );
}

function shouldReplaceAgentMessage(existing: AgentMessage, incoming: AgentMessage): boolean {
  if (isAgentOptimisticMessage(existing) !== isAgentOptimisticMessage(incoming)) {
    return isAgentOptimisticMessage(existing);
  }
  const existingTime = Date.parse(existing.updated_at);
  const incomingTime = Date.parse(incoming.updated_at);
  if (Number.isFinite(existingTime) && Number.isFinite(incomingTime)) {
    return incomingTime >= existingTime;
  }
  return incoming.updated_at >= existing.updated_at;
}

function agentMessagesEqual(left: AgentMessage, right: AgentMessage): boolean {
  return (
    left === right ||
    (left.id === right.id &&
      left.conversation_id === right.conversation_id &&
      left.sequence_no === right.sequence_no &&
      left.sender.type === right.sender.type &&
      left.sender.id === right.sender.id &&
      left.turn_id === right.turn_id &&
      left.source === right.source &&
      left.status === right.status &&
      left.reply_to_id === right.reply_to_id &&
      left.client_message_id === right.client_message_id &&
      left.created_at === right.created_at &&
      left.updated_at === right.updated_at &&
      left.parts.length === right.parts.length &&
      left.parts.every((part, index) => agentPartsEqual(part, right.parts[index]!)))
  );
}

function agentPartsEqual(left: AgentMessagePart, right: AgentMessagePart): boolean {
  return (
    left === right ||
    (left.id === right.id &&
      left.ordinal === right.ordinal &&
      left.type === right.type &&
      left.text === right.text &&
      left.asset_id === right.asset_id &&
      left.reference_id === right.reference_id &&
      agentMetadataEqual(left.metadata, right.metadata))
  );
}

function agentMetadataEqual(left: AgentPartMetadata, right: AgentPartMetadata): boolean {
  return (
    left === right ||
    (left.media_type === right.media_type &&
      left.generation_status === right.generation_status &&
      left.price_points === right.price_points &&
      left.access === right.access &&
      left.preview_url === right.preview_url &&
      left.content_url === right.content_url &&
      left.download_url === right.download_url &&
      left.width === right.width &&
      left.height === right.height &&
      left.error_code === right.error_code)
  );
}

function preserveAgentMediaAdvancements(
  existing: AgentMessage,
  incoming: AgentMessage,
): AgentMessage {
  let changed = false;
  const parts = incoming.parts.map((part) => {
    if (part.type !== "paid_media") return part;
    const previous = existing.parts.find(
      (candidate) =>
        candidate.type === "paid_media" &&
        candidate.reference_id &&
        candidate.reference_id === part.reference_id &&
        candidate.metadata.access === "unlocked",
    );
    if (!previous) return part;
    const replacement = {
      ...part,
      metadata: {
        ...part.metadata,
        access: "unlocked",
        ...(!part.metadata.content_url && previous.metadata.content_url
          ? { content_url: previous.metadata.content_url }
          : {}),
        ...(!part.metadata.download_url && previous.metadata.download_url
          ? { download_url: previous.metadata.download_url }
          : {}),
      },
    };
    if (agentPartsEqual(part, replacement)) return part;
    changed = true;
    return replacement;
  });
  return changed ? { ...incoming, parts } : incoming;
}
