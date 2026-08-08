import type {
  ChatConversationType,
  ForwardBundleMessagePayload,
  ForwardMessageSource,
  ForwardMode,
  ForwardTarget,
  GroupMessage,
  Message,
} from "@/models";
import { isRecalledChatMessage } from "@/services/messages/chatReplyPolicy";

type ChatMessageLike = Message | GroupMessage;

export interface ChatSelectionDescriptor {
  timestamp: number;
  message_type: string;
  can_forward_individually: boolean;
  can_merge: boolean;
  can_delete: boolean;
}

export interface ChatSelectionEntry {
  reference: string;
  message_id: number;
  descriptor: ChatSelectionDescriptor;
}

export const chatForwardGeometry = Object.freeze({
  maximum_selected_messages: 99,
  maximum_forward_targets: 9,
  selection_indicator_size: 24,
  selection_indicator_hit_size: 44,
  selection_toolbar_height: 58,
  selection_toolbar_icon_size: 20,
  selection_toolbar_label_size: 12,
  target_avatar_size: 42,
  target_row_minimum_height: 52,
  target_check_size: 22,
  confirmation_height: 310,
  confirmation_handle_width: 36,
  confirmation_handle_height: 5,
  confirmation_spacing: 16,
  confirmation_horizontal_padding: 20,
  confirmation_preview_padding: 12,
  confirmation_preview_radius: 10,
  bundle_card_width: 230,
  bundle_card_padding: 12,
  bundle_card_radius: 12,
  bundle_card_spacing: 10,
});

export function chatMessageReference(
  accountId: string,
  conversationType: ChatConversationType,
  conversationId: string,
  messageId: number,
): string {
  return `${encodeURIComponent(accountId)}:${conversationType}:${encodeURIComponent(conversationId)}:${messageId}`;
}

export function chatSelectionDescriptor(message: ChatMessageLike): ChatSelectionDescriptor {
  const type = message.msg_type.trim().toLocaleLowerCase();
  const individual = ["text", "image", "video", "sticker", "chat_history", "forward_bundle"].includes(type);
  const paymentLike = ["gift", "red_packet", "transfer"].includes(type);
  return {
    timestamp: timestampValue(message.timestamp),
    message_type: type,
    can_forward_individually: individual,
    can_merge: !paymentLike && type !== "system" && !["chat_history", "forward_bundle"].includes(type),
    can_delete: true,
  };
}

export function isSelectableChatMessage(message: ChatMessageLike, isChatMoneyReceipt = false): boolean {
  const type = message.msg_type.trim().toLocaleLowerCase();
  return message.id > 0
    && message.delivery_status !== "sending"
    && message.delivery_status !== "failed"
    && type !== "system"
    && !isRecalledChatMessage(message)
    && !isChatMoneyReceipt
    && !isChatCallRecordContent(message.content);
}

export function isChatCallRecordContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("[")) return false;
  const closeBracket = trimmed.indexOf("]");
  if (closeBracket <= 1) return false;
  const label = trimmed.slice(1, closeBracket).trim().toLocaleLowerCase();
  const detail = trimmed.slice(closeBracket + 1).trim().toLocaleLowerCase();
  if (!detail || !containsAny(label, ["视频", "視訊", "影片", "video", "vídeo", "ビデオ", "영상", "видео", "语音", "語音", "音频", "音訊", "audio", "voice", "audio", "音声", "음성", "голос"])) return false;
  return /\b\d{1,3}:\d{2}(?::\d{2})?\b/u.test(detail)
    || containsAny(detail, [
      "已取消", "對方已取消", "对方已取消", "cancelled", "canceled",
      "已拒绝", "已拒絕", "reject", "declined", "忙线", "忙線", "busy",
      "未接听", "未接聽", "无应答", "無應答", "no answer", "missed", "unanswered",
      "keine antwort", "sin respuesta", "pas de réponse", "応答", "不在着信",
      "받지 않", "부재중", "sem resposta", "нет ответа", "пропущ",
    ]);
}

export function toggleChatSelection(
  selected: readonly ChatSelectionEntry[],
  entry: ChatSelectionEntry,
): { entries: ChatSelectionEntry[]; accepted: boolean } {
  const existing = selected.findIndex((item) => item.reference === entry.reference);
  if (existing >= 0) return { entries: selected.filter((_, index) => index !== existing), accepted: true };
  if (selected.length >= chatForwardGeometry.maximum_selected_messages) return { entries: [...selected], accepted: false };
  return {
    entries: [...selected, entry].sort((left, right) => {
      const difference = left.descriptor.timestamp - right.descriptor.timestamp;
      return difference !== 0 ? difference : left.message_id - right.message_id;
    }),
    accepted: true,
  };
}

export function canForwardSelection(entries: readonly ChatSelectionEntry[], mode: ForwardMode): boolean {
  if (entries.length === 0) return false;
  if (mode === "single") return entries.length === 1;
  return mode === "individual"
    ? entries.every((entry) => entry.descriptor.can_forward_individually)
    : entries.every((entry) => entry.descriptor.can_merge);
}

export function forwardSource(
  conversationType: ChatConversationType,
  conversationId: string,
  message: Pick<ChatMessageLike, "id" | "version">,
): ForwardMessageSource {
  return {
    conversation_type: conversationType,
    conversation_id: conversationId,
    message_id: message.id,
    expected_version: message.version,
  };
}

export function sortForwardTargets(targets: readonly ForwardTarget[]): ForwardTarget[] {
  return [...targets].sort((left, right) => left.display_name.localeCompare(right.display_name));
}

export function toggleForwardTarget(
  selected: readonly ForwardTarget[],
  target: ForwardTarget,
): { targets: ForwardTarget[]; accepted: boolean } {
  const key = forwardTargetKey(target);
  if (selected.some((item) => forwardTargetKey(item) === key)) {
    return { targets: selected.filter((item) => forwardTargetKey(item) !== key), accepted: true };
  }
  if (selected.length >= chatForwardGeometry.maximum_forward_targets) return { targets: [...selected], accepted: false };
  return { targets: [...selected, target], accepted: true };
}

export function parseForwardBundleMessage(
  content: string,
  messageType: string,
): ForwardBundleMessagePayload | null {
  const type = messageType.trim().toLocaleLowerCase();
  if (type !== "chat_history" && type !== "forward_bundle") return null;
  try {
    const value: unknown = JSON.parse(content);
    if (!isRecord(value)) return null;
    const bundleId = stringValue(value.bundle_id);
    const title = stringValue(value.title);
    const itemCount = numberValue(value.item_count);
    const summary = stringValue(value.summary);
    if (!bundleId || !title || itemCount === null || !Number.isInteger(itemCount) || itemCount < 0 || summary === null) return null;
    return { bundle_id: bundleId, title, item_count: itemCount, summary };
  } catch {
    return null;
  }
}

export function chatForwardMessagePreview(
  message: Pick<ChatMessageLike, "msg_type" | "content">,
  translate: (key: string, ...args: (string | number)[]) => string,
): string {
  switch (message.msg_type.trim().toLocaleLowerCase()) {
    case "image": return translate("message.image");
    case "video": return translate("message.video");
    case "voice": return translate("message.voice");
    case "sticker": return translate("message.sticker");
    default: return message.content;
  }
}

export function forwardTargetKey(target: Pick<ForwardTarget, "conversation_type" | "conversation_id">): string {
  return `${target.conversation_type}:${target.conversation_id}`;
}

function timestampValue(value: string): number {
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function containsAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}
