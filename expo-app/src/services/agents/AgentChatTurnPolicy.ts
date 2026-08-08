import type { AgentMessage, AgentMessagePart, AgentTurn } from "@/models";
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

export function isAgentTurnTerminal(status: string | null | undefined): boolean {
  return terminalStatuses.has(status?.trim().toLowerCase() ?? "");
}

export function agentGeneratedMediaPollingDecision(
  expectsGeneratedMedia: boolean,
  mediaParts: readonly AgentMessagePart[],
): AgentGeneratedMediaPollingDecision {
  if (!expectsGeneratedMedia) return "stop";
  if (mediaParts.length === 0) return "waitForMediaPart";

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
  const bySequence = new Map<number, AgentMessage>();
  for (const message of current) bySequence.set(message.sequence_no, message);
  for (const message of incoming) {
    const existing = bySequence.get(message.sequence_no);
    if (existing && existing.updated_at > message.updated_at) continue;
    bySequence.set(message.sequence_no, message);
  }
  return [...bySequence.values()].sort(
    (left, right) => left.sequence_no - right.sequence_no || left.id.localeCompare(right.id),
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
