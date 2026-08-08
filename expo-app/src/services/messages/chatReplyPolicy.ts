import type { GroupMessage, GroupReplyPreview, Message, ReplyPreview } from "@/models";

export type ChatMessageLike = Message | GroupMessage;
export type ChatReplyPreview = ReplyPreview | GroupReplyPreview;
export type ChatMessageMenuAction =
  | "copy"
  | "retry"
  | "forward"
  | "save"
  | "quote"
  | "recall"
  | "delete"
  | "multiSelect";

export interface ChatMessageAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChatMessageMenuLayout {
  column_count: number;
  row_count: number;
  menu_width: number;
  menu_body_height: number;
  total_height: number;
  left: number;
  top: number;
  pointer_x: number;
  opens_above: boolean;
}

export type ChatTimelineLocatorKind =
  | { kind: "mention" }
  | { kind: "reply" }
  | { kind: "newMessages"; count: number }
  | { kind: "bottom" };

export function resolveChatTimelineLocator(options: {
  mentionMessageIds?: readonly number[];
  replyMessageIds: readonly number[];
  newMessagesBelowCount: number;
  isNearBottom: boolean;
}): ChatTimelineLocatorKind | null {
  if ((options.mentionMessageIds?.length ?? 0) > 0) return { kind: "mention" };
  if (options.replyMessageIds.length > 0) return { kind: "reply" };
  if (options.newMessagesBelowCount > 0) return { kind: "newMessages", count: options.newMessagesBelowCount };
  return options.isNearBottom ? null : { kind: "bottom" };
}

export const chatReplyGeometry = Object.freeze({
  long_press_seconds: 0.45,
  long_press_movement: 20,
  menu_item_width: 58,
  menu_item_height: 56,
  menu_padding: 6,
  menu_columns: 4,
  menu_corner_radius: 8,
  menu_pointer_width: 14,
  menu_pointer_height: 7,
  menu_bubble_gap: 4,
  menu_horizontal_inset: 10,
  menu_edge_padding: 6,
  composer_indicator_width: 3,
  composer_indicator_height: 36,
  composer_image_thumbnail: 44,
  bubble_indicator_width: 2.5,
  bubble_image_indicator_height: 75,
  bubble_image_thumbnail: 56,
  quote_corner_radius: 8,
  locator_height: 36,
  highlight_seconds: 1.5,
  highlight_fade_seconds: 0.5,
});

const recalledValues = new Set(["recall", "recalled", "withdrawn", "revoked", "message_recalled"]);

export function normalizeChatMessageType(
  messageType: string,
  options: { status?: string; isRecalled?: boolean; recalledAt?: string } = {},
): string {
  const normalizedType = normalizeToken(messageType);
  const status = options.status ? normalizeToken(options.status) : "";
  return options.isRecalled === true || Boolean(options.recalledAt) || recalledValues.has(normalizedType) || recalledValues.has(status)
    ? "recalled"
    : messageType;
}

export function isRecalledChatMessage(message: Pick<ChatMessageLike, "msg_type" | "content">): boolean {
  const type = normalizeToken(message.msg_type);
  return type === "recalled" || (type === "system" && message.content.trim().length === 0);
}

export function chatRecallNotice(
  senderId: string | undefined,
  viewerId: string | undefined,
  senderName: string | undefined,
  translate: (key: string, ...args: (string | number)[]) => string,
): string {
  if (senderId && senderId === viewerId) return translate("chat.recall.selfNotice");
  return translate("chat.recall.otherNotice", senderName?.trim() || translate("chat.recall.someone"));
}

export function canRecallChatMessage(
  message: Pick<ChatMessageLike, "sender_id" | "msg_type" | "timestamp" | "content">,
  viewerId: string | undefined,
  now = Date.now(),
): boolean {
  if (!viewerId || message.sender_id !== viewerId) return false;
  const type = effectiveMessageType(message);
  if (!["text", "image", "video", "voice", "sticker"].includes(type)) return false;
  const sentAt = chatTimestampValue(message.timestamp);
  if (!Number.isFinite(sentAt)) return false;
  const elapsedSeconds = (now - sentAt) / 1_000;
  return elapsedSeconds >= -300 && elapsedSeconds <= 120;
}

export function actionsForChatMessage(
  message: Pick<ChatMessageLike, "sender_id" | "msg_type" | "timestamp" | "content">,
  options: {
    viewerId?: string | undefined;
    isChatMoney?: boolean;
    isChatMoneyReceipt?: boolean;
    isCallRecord?: boolean;
    forwardingEnabled?: boolean;
    localDeleteEnabled?: boolean;
    multiselectEnabled?: boolean;
    recallEnabled?: boolean;
  } = {},
): ChatMessageMenuAction[] {
  if (
    normalizeToken(message.msg_type) === "system" ||
    isRecalledChatMessage(message) ||
    options.isChatMoneyReceipt ||
    options.isCallRecord
  ) return [];

  const type = effectiveMessageType(message);
  let actions: ChatMessageMenuAction[];
  if (type === "text" && !options.isChatMoney) {
    actions = ["copy"];
    if (options.forwardingEnabled) actions.push("forward");
    actions.push("quote");
  } else if (type === "image" || type === "video") {
    actions = [];
    if (options.forwardingEnabled) actions.push("forward");
    actions.push("save", "quote");
  } else if (type === "voice") {
    actions = ["quote"];
  } else if (type === "sticker") {
    actions = [];
    if (options.forwardingEnabled) actions.push("forward");
    actions.push("quote");
  } else if (type === "chat_history" || type === "forward_bundle") {
    actions = options.forwardingEnabled ? ["forward"] : [];
  } else {
    actions = ["quote"];
  }

  if (options.recallEnabled !== false && canRecallChatMessage(message, options.viewerId)) actions.push("recall");
  if (options.localDeleteEnabled !== false) actions.push("delete");
  if (options.multiselectEnabled) actions.push("multiSelect");
  return actions;
}

export function resolveDirectReply(
  message: Pick<Message, "reply_to" | "reply_to_id">,
  messages: readonly Message[],
): ReplyPreview | null {
  if (message.reply_to) return message.reply_to;
  const source = message.reply_to_id === undefined
    ? undefined
    : messages.find((item) => item.id === message.reply_to_id);
  return source ? replyPreviewFromMessage(source) : null;
}

export function resolveGroupReply(
  message: Pick<GroupMessage, "reply_to" | "reply_to_id">,
  messages: readonly GroupMessage[],
): GroupReplyPreview | null {
  if (message.reply_to) return message.reply_to;
  const source = message.reply_to_id === undefined
    ? undefined
    : messages.find((item) => item.id === message.reply_to_id);
  return source ? replyPreviewFromMessage(source) : null;
}

export function replyPreviewFromMessage<T extends ChatMessageLike>(message: T): ChatReplyPreview {
  return {
    id: message.id,
    sender_id: message.sender_id,
    msg_type: message.msg_type,
    content: message.content,
  };
}

export function chatReplyPreviewText(
  msgType: string,
  content: string,
  translate: (key: string, ...args: (string | number)[]) => string,
  stickerPreview?: (content: string) => string | null,
  giftPreview?: (content: string) => string | null,
): string {
  switch (effectiveMessageType({ msg_type: msgType, content })) {
    case "image": return translate("message.image");
    case "video": return translate("message.video");
    case "voice": return translate("message.voice");
    case "sticker": return stickerPreview?.(content) ?? translate("message.sticker");
    case "gift": return giftPreview?.(content) ?? translate("message.gift");
    default: return content;
  }
}

export function calculateChatMessageMenuLayout(
  anchor: ChatMessageAnchor,
  actionCount: number,
  viewport: { width: number; height: number; topInset?: number; bottomInset?: number },
): ChatMessageMenuLayout {
  const count = Math.max(actionCount, 1);
  const columnCount = Math.min(count, chatReplyGeometry.menu_columns);
  const rowCount = Math.max(1, Math.ceil(count / chatReplyGeometry.menu_columns));
  const menuWidth = columnCount * chatReplyGeometry.menu_item_width + chatReplyGeometry.menu_padding * 2;
  const menuBodyHeight = rowCount * chatReplyGeometry.menu_item_height + chatReplyGeometry.menu_padding * 2;
  const totalHeight = menuBodyHeight + chatReplyGeometry.menu_pointer_height;
  const topLimit = Math.max(viewport.topInset ?? 0, 8) + chatReplyGeometry.menu_edge_padding;
  const bottomLimit = viewport.height - Math.max(viewport.bottomInset ?? 0, 8) - chatReplyGeometry.menu_edge_padding;
  const anchorMiddleX = anchor.x + anchor.width / 2;
  const horizontalCenter = clamp(
    anchorMiddleX,
    menuWidth / 2 + chatReplyGeometry.menu_horizontal_inset,
    viewport.width - menuWidth / 2 - chatReplyGeometry.menu_horizontal_inset,
  );
  const roomAbove = anchor.y - topLimit;
  const roomBelow = bottomLimit - (anchor.y + anchor.height);
  const opensAbove = roomAbove >= totalHeight + chatReplyGeometry.menu_bubble_gap || roomAbove >= roomBelow;
  const idealCenterY = opensAbove
    ? anchor.y - totalHeight / 2 - chatReplyGeometry.menu_bubble_gap
    : anchor.y + anchor.height + totalHeight / 2 + chatReplyGeometry.menu_bubble_gap;
  const centerY = clamp(idealCenterY, topLimit + totalHeight / 2, bottomLimit - totalHeight / 2);
  const left = horizontalCenter - menuWidth / 2;
  return {
    column_count: columnCount,
    row_count: rowCount,
    menu_width: menuWidth,
    menu_body_height: menuBodyHeight,
    total_height: totalHeight,
    left,
    top: centerY - totalHeight / 2,
    pointer_x: clamp(anchorMiddleX - left, 18, menuWidth - 18),
    opens_above: opensAbove,
  };
}

export function chatTimestampValue(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  const parsed = Date.parse(trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`);
  return parsed;
}

function effectiveMessageType(message: Pick<ChatMessageLike, "msg_type" | "content">): string {
  const type = normalizeToken(message.msg_type);
  if (type === "emoji") return "text";
  return type;
}

function normalizeToken(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll("-", "_");
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}
