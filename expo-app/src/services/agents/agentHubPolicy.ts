import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type {
  AgentConversation,
  AgentMessage,
  AgentMessagePart,
  AgentSummary,
  Conversation,
} from "@/models";

export const agentHubMetrics = {
  contentInset: 16,
  contentSpacing: 12,
  contentBottomInset: 60,
  sectionTitleSize: 13,
  sectionTitleTopInset: 4,
  cardInset: 14,
  cardRadius: 14,
  rowSpacing: 12,
  copySpacing: 5,
  agentAvatarSize: 54,
  conversationAvatarSize: 50,
  scriptAvatarSize: 54,
  scriptAvatarRadius: 11,
  rowTitleSize: 16,
  rowBodySize: 13,
  rowTimeSize: 11,
  chevronSize: 12,
  tagSize: 10,
  tagHorizontalInset: 7,
  tagVerticalInset: 3,
  emptySpacing: 10,
  emptySymbolSize: 34,
  emptyVerticalInset: 70,
  createButtonHeight: 44,
  createButtonHorizontalInset: 22,
  errorInset: 12,
  errorOuterInset: 16,
  errorRadius: 12,
  runtimeRefreshMilliseconds: 5 * 60 * 1_000,
} as const;

export function agentDisplayName(agent: AgentSummary): string {
  return agent.profile?.name ?? "智能体";
}

export function agentAvatarAssetId(agent: AgentSummary): string | undefined {
  return agent.avatar_asset_id ?? agent.profile?.avatar_asset_id;
}

export function agentDescription(agent: AgentSummary): string {
  return agent.profile?.tagline ?? agent.profile?.description ?? "开始一段新对话";
}

export function agentConversationPreview(
  conversation: AgentConversation,
  translate: (key: string) => string,
): string {
  return agentMessagePreview(conversation.latest_message, conversation.title, translate);
}

export function agentMessagePreview(
  message: AgentMessage | undefined,
  fallback: string,
  translate: (key: string) => string,
): string {
  if (!message) return fallback;
  const parts = [...message.parts].sort((left, right) => left.ordinal - right.ordinal);
  for (const part of parts) {
    const preview = mediaPreview(part, translate);
    if (preview) return preview;
  }
  return (
    parts.find(
      (part) => part.type === "text" && trimFoundationWhitespacesAndNewlines(part.text).length > 0,
    )?.text ?? fallback
  );
}

function mediaPreview(
  part: AgentMessagePart,
  translate: (key: string) => string,
): string | undefined {
  if (part.type === "input_image") return translate("message.image");
  if (part.type !== "paid_media" || paidMediaDisplayStatus(part) !== "ready_locked") {
    return undefined;
  }
  return part.metadata.media_type?.toLowerCase() === "video"
    ? translate("message.video")
    : translate("message.image");
}

function paidMediaDisplayStatus(part: AgentMessagePart): string {
  const status = part.metadata.generation_status
    ? trimFoundationWhitespacesAndNewlines(part.metadata.generation_status).toLowerCase()
    : undefined;
  switch (status) {
    case undefined:
    case "":
    case "queued":
    case "pending":
      return "queued";
    case "processing":
    case "generating":
      return "generating";
    case "ready":
    case "completed":
      return part.metadata.access === "locked" || part.metadata.access === "unlocked"
        ? "ready_locked"
        : "generating";
    default:
      return status;
  }
}

export function resolveJoinedScriptRooms(conversations: readonly Conversation[]): Conversation[] {
  const latestByRoomId = new Map<string, Conversation>();
  for (const conversation of conversations) {
    const roomId = conversation.script_room_id ?? "";
    if (
      !trimFoundationWhitespacesAndNewlines(roomId) ||
      normalizedKind(conversation.conversation_kind) !== "script_room"
    ) {
      continue;
    }
    const existing = latestByRoomId.get(roomId);
    if (
      !existing ||
      compareMessageTimes(conversation.last_message_time, existing.last_message_time) > 0
    ) {
      latestByRoomId.set(roomId, conversation);
    }
  }
  return [...latestByRoomId.values()].sort((left, right) => {
    const timeOrder = compareMessageTimes(right.last_message_time, left.last_message_time);
    return timeOrder || conversationIdentity(left).localeCompare(conversationIdentity(right));
  });
}

export function compareMessageTimes(
  leftValue: string | undefined,
  rightValue: string | undefined,
): number {
  const left = trimFoundationWhitespacesAndNewlines(leftValue ?? "");
  const right = trimFoundationWhitespacesAndNewlines(rightValue ?? "");
  if (left === right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  const leftTime = parseServerTimestamp(left)?.getTime();
  const rightTime = parseServerTimestamp(right)?.getTime();
  if (leftTime !== undefined && rightTime !== undefined) {
    if (leftTime === rightTime) return 0;
    return leftTime < rightTime ? -1 : 1;
  }
  return left.localeCompare(right, "en", { numeric: true });
}

export function parseServerTimestamp(value: string): Date | undefined {
  const trimmed = trimFoundationWhitespacesAndNewlines(value);
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)
    ? `${trimmed.replace(" ", "T")}Z`
    : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function formatAgentHubListTime(
  value: string | undefined,
  now = new Date(),
  yesterdayLabel = "昨天",
): string {
  if (!value) return "";
  const date = parseServerTimestamp(value);
  if (!date) return "";
  if (sameCalendarDay(date, now)) return twoDigitTime(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameCalendarDay(date, yesterday)) return yesterdayLabel;
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

export function scriptRoomPreview(conversation: Conversation): string {
  return trimFoundationWhitespacesAndNewlines(conversation.last_message ?? "") || "继续你的剧情";
}

export function latestOpenAgentConversation(
  conversations: readonly AgentConversation[],
  agentId: string,
): AgentConversation | undefined {
  return conversations
    .filter((conversation) => conversation.agent_id === agentId && conversation.status !== "closed")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
}

export function upsertInstalledAgent(
  agents: readonly AgentSummary[],
  incoming: AgentSummary,
): AgentSummary[] {
  return [...agents.filter((agent) => agent.id !== incoming.id), incoming];
}

export function isAgentCapabilityError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "APIError") return false;
  const apiError = error as Error & { code?: unknown; payload?: unknown };
  const payload = recordValue(apiError.payload);
  const detail = recordValue(payload?.detail);
  const nestedError = recordValue(payload?.error);
  const data = recordValue(payload?.data);
  return [
    apiError.code,
    payload?.code,
    detail?.code,
    nestedError?.code,
    data?.code,
    data?.error_code,
  ].some((value) => {
    const code = Number(value);
    return Number.isFinite(code) && code >= 6000 && code <= 6399;
  });
}

export function agentHubErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "请求失败，请稍后重试";
  const apiError = error as Error & { status?: unknown; payload?: unknown };
  const status = Number(apiError.status);
  if (Number.isFinite(status) && status >= 500 && status <= 599) {
    return trimFoundationWhitespacesAndNewlines(apiError.message) || "服务暂时不可用，请稍后重试";
  }
  const payload = recordValue(apiError.payload);
  const detail = recordValue(payload?.detail);
  for (const value of [detail?.message, payload?.message, apiError.message]) {
    if (typeof value !== "string") continue;
    const trimmed = trimFoundationWhitespacesAndNewlines(value);
    if (trimmed) return trimmed;
  }
  return "请求失败，请稍后重试";
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizedKind(value: string | undefined): string {
  return trimFoundationWhitespacesAndNewlines(value ?? "")
    .toLowerCase()
    .replaceAll("-", "_");
}

function conversationIdentity(conversation: Conversation): string {
  const type = normalizedConversationType(conversation);
  if (type === "group") {
    const id =
      conversation.group_id ??
      (/^\d+$/.test(conversation.id) ? Number(conversation.id) : trailingInteger(conversation.id));
    return `group:${id ?? conversation.id}`;
  }
  if (type === "agent") {
    if (conversation.agent_conversation_id) {
      return `agent:${conversation.agent_conversation_id}`;
    }
    return normalizedKind(conversation.conversation_kind) === "agent_conversation"
      ? `agent:${conversation.id}`
      : `agent-profile:${conversation.agent_id ?? conversation.id}`;
  }
  return `dm:${conversation.id}`;
}

function normalizedConversationType(conversation: Conversation): "dm" | "group" | "agent" {
  const type = normalizedKind(conversation.type);
  if (["group", "group_chat", "groupchat", "room"].includes(type)) return "group";
  if (["agent", "agent_chat", "agent_conversation", "agent_profile"].includes(type)) {
    return "agent";
  }
  if (
    conversation.group_id !== undefined ||
    conversation.id.startsWith("group_") ||
    conversation.id.startsWith("group:")
  ) {
    return "group";
  }
  return "dm";
}

function trailingInteger(value: string): number | undefined {
  const matched = value.match(/(\d+)\D*$/);
  if (!matched?.[1]) return undefined;
  const parsed = Number(matched[1]);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function sameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function twoDigitTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
