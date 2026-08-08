import type {
  ChatMoneyClaimRecord,
  ChatMoneyConfiguration,
  ChatMoneyDetail,
  ChatMoneyKind,
  ChatMoneyLimits,
  ChatMoneyPayload,
  ChatMoneyReceiptEventType,
  ChatMoneyReceiptPayload,
  ChatMoneyRedPacketMode,
  ChatMoneyScope,
  ChatMoneyStatus,
  ChatMoneyUnavailableReason,
  ChatMoneyViewerState,
} from "@/models";

export type ChatMoneyTranslator = (key: string, ...args: (string | number)[]) => string;

export const chatMoneyTheme = {
  pageBackground: "#F7F7F7",
  cardOrange: "#FA9D3B",
  cardMutedOrange: "#F6C58E",
  accepted: "#078A45",
  returned: "#7F7F7F",
  actionRed: "#FA5151",
  disabledRed: "#F3B5B5",
  actionGreen: "#07C160",
  envelopeRed: "#D95940",
  envelopeDarkRed: "#C94B38",
  gold: "#F4D49B",
  secondary: "#7F7F7F",
  separator: "#E5E5E5",
  link: "#576B95",
} as const;

export const chatMoneyBubblePolicy = {
  width: 245,
  redPacketRadius: 6,
  redPacketTopHeight: 78,
  redPacketFooterHeight: 28,
  redPacketHorizontalPadding: 13,
  redPacketGap: 13,
  transferRadius: 5,
  transferTopHeight: 74,
  transferFooterHeight: 28,
  transferHorizontalPadding: 13,
  transferGap: 12,
  redPacketGlyphWidth: 44,
  redPacketGlyphHeight: 48,
  transferGlyphSize: 42,
} as const;

export const chatMoneyComposerPolicy = {
  pageHorizontalPadding: 16,
  inputRowHeight: 64,
  recipientRowHeight: 56,
  recipientAvatarSize: 30,
  transferHeaderAvatarSize: 56,
  submitWidth: 188,
  submitHeight: 48,
  submitRadius: 5,
  amountFontSize: 28,
  packetCountFontSize: 20,
  transferAmountFontSize: 30,
  totalFontSize: 46,
  recipientPickerAvatarSize: 42,
  recipientPickerMinimumHeight: 220,
  focusDelayMs: 350,
} as const;

export const chatMoneyDetailPolicy = {
  overlayOpacity: 0.52,
  envelopeHorizontalMargin: 21,
  envelopeMaximumWidth: 340,
  envelopeMinimumHeight: 430,
  envelopeMaximumHeight: 550,
  envelopeHeightRatio: 0.66,
  envelopeRadius: 12,
  envelopeFoldRatio: 0.41,
  envelopeContentTopRatio: 0.22,
  openButtonSize: 92,
  waitingButtonSize: 82,
  claimMinimumAnimationMs: 750,
  headerHeight: 182,
  headerCurveRatio: 0.63,
  claimedAmountFontSize: 58,
  claimRowHeight: 68,
  transferSymbolTop: 110,
  transferStatusIconSize: 62,
  transferAmountFontSize: 48,
  transferActionHeight: 52,
} as const;

export const defaultChatMoneyLimits: ChatMoneyLimits = {
  minimum_amount: 1,
  maximum_amount: 20_000,
  maximum_packet_count: 100,
  expiry_seconds: 86_400,
  red_packet_minimum_amount: 1,
  red_packet_maximum_amount: 20_000,
  transfer_minimum_amount: 1,
  transfer_maximum_amount: 20_000,
  maximum_greeting_length: 60,
  maximum_transfer_note_length: 20,
};

export const unavailableChatMoneyConfiguration: ChatMoneyConfiguration = {
  red_packet_enabled: false,
  transfer_enabled: false,
  limits: defaultChatMoneyLimits,
  eligibility: {
    eligible: false,
    reason_code: "service_unavailable",
  },
};

export interface ChatMoneyComposerValidationInput {
  kind: ChatMoneyKind;
  scope: ChatMoneyScope;
  mode: ChatMoneyRedPacketMode;
  amountText: string;
  packetCountText: string;
  recipientId?: string | undefined;
  spendableBalance: number;
  memberCount: number;
  limits: ChatMoneyLimits;
}

export interface ChatMoneyComposerValidation {
  amount: number;
  packetCount: number;
  totalAmount: number;
  amountError?: string | undefined;
  packetCountError?: string | undefined;
  recipientError?: string | undefined;
  canSubmit: boolean;
}

export function sanitizeChatMoneyDigits(value: string): string {
  const digits = Array.from(value)
    .filter((character) => /\p{Number}/u.test(character))
    .join("");
  if (!digits) return "";
  const normalized = digits.replace(/^0+(?=\d)/u, "");
  return /^0+$/u.test(normalized) ? "0" : normalized;
}

export function validateChatMoneyComposer(
  input: ChatMoneyComposerValidationInput,
  t: ChatMoneyTranslator,
): ChatMoneyComposerValidation {
  const amount = positiveInteger(input.amountText) ?? 0;
  const requestedCount = positiveInteger(input.packetCountText) ?? 0;
  const packetCount =
    input.kind === "transfer"
      ? 0
      : input.scope === "dm" || input.mode === "direct" || input.mode === "exclusive"
        ? 1
        : requestedCount;
  const needsRecipient = input.kind === "transfer" || input.mode === "exclusive";
  const maximumRecipients = Math.max(input.memberCount, 1);
  let packetCountError: string | undefined;
  if (input.kind === "red_packet" && packetCount <= 0) {
    packetCountError = t("chatMoney.validation.count", input.limits.maximum_packet_count);
  } else if (packetCount > input.limits.maximum_packet_count) {
    packetCountError = t("chatMoney.validation.count", input.limits.maximum_packet_count);
  } else if (packetCount > maximumRecipients) {
    packetCountError = t("chatMoney.validation.memberCount", maximumRecipients);
  }

  const multiplication =
    input.kind === "red_packet" && input.mode === "equal"
      ? safeProduct(amount, packetCount)
      : amount;
  const totalAmount = multiplication ?? 0;
  const minimum =
    input.kind === "red_packet"
      ? input.limits.red_packet_minimum_amount
      : input.limits.transfer_minimum_amount;
  const maximum =
    input.kind === "red_packet"
      ? input.limits.red_packet_maximum_amount
      : input.limits.transfer_maximum_amount;
  let amountError: string | undefined;
  if (amount <= 0) {
    amountError = t("chatMoney.validation.invalidNumber");
  } else if (multiplication === null) {
    amountError = t("chatMoney.validation.amount", minimum, maximum);
  } else if (input.kind === "red_packet" && input.mode === "lucky" && totalAmount < packetCount) {
    amountError = t("chatMoney.validation.minimumPerPacket");
  } else if (totalAmount < minimum) {
    amountError = t("chatMoney.validation.amount", minimum, maximum);
  } else if (totalAmount > maximum) {
    amountError = t("chatMoney.validation.amount", minimum, maximum);
  } else if (totalAmount > input.spendableBalance) {
    amountError = t("wallet.error.insufficientSpendableBalance");
  }
  const recipientError =
    needsRecipient && !input.recipientId ? t("chatMoney.chooseRecipient") : undefined;
  return {
    amount,
    packetCount,
    totalAmount,
    ...(amountError ? { amountError } : {}),
    ...(packetCountError ? { packetCountError } : {}),
    ...(recipientError ? { recipientError } : {}),
    canSubmit: !amountError && !packetCountError && !recipientError,
  };
}

export function parseChatMoneyPayload(content: string): ChatMoneyPayload | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return normalizeChatMoneyPayload(JSON.parse(trimmed) as unknown);
  } catch {
    return null;
  }
}

export function normalizeChatMoneyPayload(value: unknown): ChatMoneyPayload | null {
  const record = objectValue(value);
  if (!record) return null;
  const assetId = stringValue(record.asset_id, record.assetId);
  const kind = chatMoneyKind(record.kind, record.asset_kind, record.assetKind);
  const scope = chatMoneyScope(record.scope, record.conversation_scope, record.conversationScope);
  const senderId = stringValue(record.sender_id, record.senderId);
  if (!assetId || !kind || !scope || !senderId) return null;
  const status = chatMoneyStatus(record.status) ?? "pending";
  const mode = kind === "red_packet" ? chatMoneyMode(record.mode) : undefined;
  const amount = kind === "transfer" ? nonnegativeInteger(record.amount) : undefined;
  return {
    schema_version: positiveIntegerValue(record.schema_version, record.schemaVersion) ?? 1,
    asset_id: assetId,
    kind,
    scope,
    ...(mode ? { mode } : {}),
    sender_id: senderId,
    ...optionalString("recipient_id", record.recipient_id, record.recipientId, record.receiver_id),
    ...optionalString("recipient_name", record.recipient_name, record.recipientName),
    ...optionalString("greeting", record.greeting),
    ...optionalString("note", record.note),
    ...(amount !== undefined ? { amount } : {}),
    ...optionalInteger("packet_count", record.packet_count, record.packetCount),
    ...optionalInteger("claimed_count", record.claimed_count, record.claimedCount),
    status,
    ...optionalString("expires_at", record.expires_at, record.expiresAt),
    version: positiveIntegerValue(record.version) ?? 1,
  };
}

export function encodeChatMoneyPayload(payload: ChatMoneyPayload): string {
  const encoded: Record<string, unknown> = {
    schema_version: payload.schema_version,
    asset_id: payload.asset_id,
    kind: payload.kind,
    scope: payload.scope,
    sender_id: payload.sender_id,
    status: payload.status,
    version: payload.version,
  };
  for (const key of [
    "mode",
    "recipient_id",
    "recipient_name",
    "greeting",
    "note",
    "packet_count",
    "claimed_count",
    "expires_at",
  ] as const) {
    if (payload[key] !== undefined) encoded[key] = payload[key];
  }
  if (payload.kind === "transfer" && payload.amount !== undefined) encoded.amount = payload.amount;
  return JSON.stringify(encoded);
}

export function normalizeChatMoneyDetail(value: unknown): ChatMoneyDetail | null {
  const source = unwrapObject(value, ["detail", "chat_money", "chatMoney", "asset", "data"]);
  const payload = normalizeChatMoneyPayload(source);
  if (!source || !payload) return null;
  const claimsSource = arrayValue(
    source.claims,
    source.records,
    source.claim_records,
    source.claimRecords,
  );
  return {
    ...payload,
    ...optionalString("sender_name", source.sender_name, source.senderName),
    ...optionalString(
      "sender_avatar_url",
      source.sender_avatar_url,
      source.senderAvatarUrl,
      source.sender_avatar,
    ),
    ...optionalInteger("total_amount", source.total_amount, source.totalAmount),
    ...optionalInteger("claimed_amount", source.claimed_amount, source.claimedAmount),
    can_claim: booleanValue(source.can_claim, source.canClaim) ?? false,
    can_accept: booleanValue(source.can_accept, source.canAccept) ?? false,
    can_return: booleanValue(source.can_return, source.canReturn) ?? false,
    ...optionalInteger("viewer_claim_amount", source.viewer_claim_amount, source.viewerClaimAmount),
    claims: claimsSource
      .map(normalizeClaimRecord)
      .filter((claim): claim is ChatMoneyClaimRecord => claim !== null),
    ...optionalString("created_at", source.created_at, source.createdAt),
    ...optionalString("finalized_at", source.finalized_at, source.finalizedAt),
    ...optionalEnum("viewer_state", chatMoneyViewerState(source.viewer_state, source.viewerState)),
    ...optionalEnum(
      "unavailable_reason",
      chatMoneyUnavailableReason(source.unavailable_reason, source.unavailableReason),
    ),
    ...optionalInteger("remaining_amount", source.remaining_amount, source.remainingAmount),
    ...optionalInteger("remaining_count", source.remaining_count, source.remainingCount),
  };
}

export function normalizeChatMoneyConfiguration(value: unknown): ChatMoneyConfiguration | null {
  const source = unwrapObject(value, [
    "configuration",
    "config",
    "chat_money",
    "chatMoney",
    "data",
  ]);
  if (!source) return null;
  const limitsSource = objectValue(source.limits) ?? source;
  const eligibilitySource = objectValue(source.eligibility) ?? {};
  const redPacketEnabled = booleanValue(source.red_packet_enabled, source.redPacketEnabled);
  const transferEnabled = booleanValue(source.transfer_enabled, source.transferEnabled);
  if (redPacketEnabled === undefined || transferEnabled === undefined) return null;
  const genericMin =
    positiveIntegerValue(limitsSource.minimum_amount, limitsSource.minimumAmount) ??
    defaultChatMoneyLimits.minimum_amount;
  const genericMax =
    positiveIntegerValue(limitsSource.maximum_amount, limitsSource.maximumAmount) ??
    defaultChatMoneyLimits.maximum_amount;
  return {
    red_packet_enabled: redPacketEnabled,
    transfer_enabled: transferEnabled,
    limits: {
      minimum_amount: genericMin,
      maximum_amount: genericMax,
      maximum_packet_count:
        positiveIntegerValue(limitsSource.maximum_packet_count, limitsSource.maximumPacketCount) ??
        defaultChatMoneyLimits.maximum_packet_count,
      expiry_seconds:
        positiveIntegerValue(limitsSource.expiry_seconds, limitsSource.expirySeconds) ??
        defaultChatMoneyLimits.expiry_seconds,
      red_packet_minimum_amount:
        positiveIntegerValue(
          limitsSource.red_packet_minimum_amount,
          limitsSource.redPacketMinimumAmount,
        ) ?? genericMin,
      red_packet_maximum_amount:
        positiveIntegerValue(
          limitsSource.red_packet_maximum_amount,
          limitsSource.redPacketMaximumAmount,
        ) ?? genericMax,
      transfer_minimum_amount:
        positiveIntegerValue(
          limitsSource.transfer_minimum_amount,
          limitsSource.transferMinimumAmount,
        ) ?? genericMin,
      transfer_maximum_amount:
        positiveIntegerValue(
          limitsSource.transfer_maximum_amount,
          limitsSource.transferMaximumAmount,
        ) ?? genericMax,
      maximum_greeting_length:
        positiveIntegerValue(
          limitsSource.maximum_greeting_length,
          limitsSource.maximumGreetingLength,
        ) ?? defaultChatMoneyLimits.maximum_greeting_length,
      maximum_transfer_note_length:
        positiveIntegerValue(
          limitsSource.maximum_transfer_note_length,
          limitsSource.maximumTransferNoteLength,
        ) ?? defaultChatMoneyLimits.maximum_transfer_note_length,
    },
    eligibility: {
      eligible: booleanValue(eligibilitySource.eligible) ?? false,
      ...optionalString("reason_code", eligibilitySource.reason_code, eligibilitySource.reasonCode),
      ...optionalString("message", eligibilitySource.message),
      ...optionalString("action_url", eligibilitySource.action_url, eligibilitySource.actionUrl),
    },
  };
}

export function normalizeChatMoneyReceipt(content: string): ChatMoneyReceiptPayload | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return findReceipt(JSON.parse(trimmed) as unknown, 0);
  } catch {
    return null;
  }
}

export function isChatMoneyReceiptType(type: string): boolean {
  return new Set([
    "chat_money_receipt",
    "chat_money_event",
    "money_receipt",
    "red_packet_receipt",
  ]).has(type.trim().toLocaleLowerCase());
}

export function isTerminalChatMoneyStatus(status: ChatMoneyStatus): boolean {
  return (
    status === "completed" ||
    status === "accepted" ||
    status === "returned" ||
    status === "expired_refunded"
  );
}

export function isMutedChatMoneyBubble(
  payload: ChatMoneyPayload,
  hasViewerClaimedRedPacket: boolean,
): boolean {
  return (
    isTerminalChatMoneyStatus(payload.status) ||
    (payload.kind === "red_packet" && hasViewerClaimedRedPacket)
  );
}

export function senderCanClaimOwnRedPacket(
  scope: ChatMoneyScope,
  mode?: ChatMoneyRedPacketMode,
): boolean {
  return scope === "group" && (mode === "lucky" || mode === "equal");
}

export function shouldShowRedPacketEnvelopeFromPayload(
  payload: ChatMoneyPayload,
  isSender: boolean,
  hasLocalClaim: boolean,
): boolean {
  if (payload.kind !== "red_packet" || hasLocalClaim || isTerminalChatMoneyStatus(payload.status))
    return false;
  if (payload.status !== "pending" && payload.status !== "partial") return false;
  const isFull =
    payload.packet_count !== undefined &&
    payload.claimed_count !== undefined &&
    payload.claimed_count >= payload.packet_count;
  if (isFull) return false;
  return !isSender || senderCanClaimOwnRedPacket(payload.scope, payload.mode);
}

export function shouldShowRedPacketEnvelopeFromDetail(
  detail: ChatMoneyDetail,
  viewerId: string | undefined,
  isSender: boolean,
  hasLocalClaim: boolean,
): boolean {
  if (!shouldShowRedPacketEnvelopeFromPayload(detail, isSender, hasLocalClaim)) return false;
  if ((detail.remaining_count ?? 1) <= 0) return false;
  if (detail.viewer_claim_amount !== undefined) return false;
  if (viewerId && detail.claims.some((claim) => claim.user_id === viewerId)) return false;
  if (detail.unavailable_reason) return false;
  if (isSender) return senderCanClaimOwnRedPacket(detail.scope, detail.mode);
  if (!detail.can_claim) return false;
  return detail.viewer_state === undefined || detail.viewer_state === "claimable";
}

export function canShowRedPacketOpenAction(detail: ChatMoneyDetail, isSender: boolean): boolean {
  if (!detail.can_claim || isTerminalChatMoneyStatus(detail.status)) return false;
  return !isSender || senderCanClaimOwnRedPacket(detail.scope, detail.mode);
}

export function chatMoneyBubblePrimary(payload: ChatMoneyPayload, t: ChatMoneyTranslator): string {
  if (payload.kind === "transfer") return t("chatMoney.amountValue", payload.amount ?? 0);
  if (payload.mode === "exclusive" && payload.recipient_name) {
    return t("chatMoney.redPacket.for", payload.recipient_name);
  }
  return payload.greeting?.trim() || t("chatMoney.redPacket.defaultGreeting");
}

export function chatMoneyBubbleSecondary(
  payload: ChatMoneyPayload,
  viewerId: string | undefined,
  t: ChatMoneyTranslator,
  isFromMe?: boolean,
): string {
  if (payload.kind === "red_packet") {
    if (payload.status === "completed") return t("chatMoney.status.completed");
    if (payload.status === "expired_refunded") return t("chatMoney.status.expiredRefunded");
    return payload.recipient_name?.trim() || t("chatMoney.status.pending");
  }
  const viewerIsSender = payload.sender_id === viewerId || isFromMe === true;
  const viewerIsRecipient =
    payload.recipient_id === viewerId ||
    (payload.scope === "dm" && !viewerIsSender && isFromMe === false);
  if (payload.status === "accepted") {
    return viewerIsRecipient
      ? t("chatMoney.transfer.card.receivedByMe")
      : t("chatMoney.transfer.card.acceptedByRecipient");
  }
  if (payload.status === "returned") {
    return viewerIsSender
      ? t("chatMoney.transfer.card.returnedToMe")
      : t("chatMoney.transfer.card.returnedByMe");
  }
  if (payload.status === "expired_refunded") return t("chatMoney.transfer.card.expiredRefunded");
  return (
    payload.note?.trim() || payload.recipient_name?.trim() || t("chatMoney.transfer.pendingReceipt")
  );
}

export function chatMoneyBubbleFooterPrompt(
  payload: ChatMoneyPayload,
  viewerId: string | undefined,
  t: ChatMoneyTranslator,
  isFromMe?: boolean,
): { text: string; actionable: boolean } {
  if (payload.kind === "red_packet")
    return { text: t("chatMoney.redPacket.brand"), actionable: false };
  if (isTerminalChatMoneyStatus(payload.status)) {
    return { text: chatMoneyBubbleSecondary(payload, viewerId, t, isFromMe), actionable: false };
  }
  const viewerIsSender = payload.sender_id === viewerId || isFromMe === true;
  const viewerIsRecipient =
    payload.recipient_id === viewerId ||
    (payload.scope === "dm" && !viewerIsSender && isFromMe === false);
  if (viewerIsRecipient) return { text: t("chatMoney.transfer.receivePrompt"), actionable: true };
  if (viewerIsSender)
    return { text: t("chatMoney.transfer.waitingForRecipient"), actionable: false };
  return { text: t("chatMoney.transfer.pendingReceipt"), actionable: false };
}

export function chatMoneyMessagePreview(
  type: string,
  content: string,
  viewerId: string | undefined,
  t: ChatMoneyTranslator,
): string {
  const receipt = normalizeChatMoneyReceipt(content);
  if (receipt && (isChatMoneyReceiptType(type) || receipt.event_type)) {
    return localizedChatMoneyReceipt(receipt, viewerId, t);
  }
  const payload = parseChatMoneyPayload(content);
  if (!payload) return content;
  return payload.kind === "transfer"
    ? t("chatMoney.preview.transfer")
    : t("chatMoney.preview.redPacket");
}

export function localizedChatMoneyReceipt(
  receipt: ChatMoneyReceiptPayload,
  viewerId: string | undefined,
  t: ChatMoneyTranslator,
): string {
  const actor = receipt.actor_name?.trim() || receipt.actor_id || "";
  const sender = receipt.sender_name?.trim() || receipt.sender_id || "";
  if (receipt.event_type === "red_packet_claimed") {
    if (receipt.actor_id === viewerId) return t("chatMoney.receipt.claimedByMe", sender);
    if (receipt.sender_id === viewerId) return t("chatMoney.receipt.claimedMine", actor);
    return t("chatMoney.receipt.claimed", actor, sender);
  }
  if (receipt.event_type === "transfer_accepted") {
    const senderName = validReceiptDisplayName(sender, receipt.sender_id);
    const actorName = validReceiptDisplayName(actor, receipt.actor_id);
    if (receipt.actor_id === viewerId && senderName)
      return t("chatMoney.receipt.transferAcceptedByMe", senderName);
    if (receipt.sender_id === viewerId && actorName)
      return t("chatMoney.receipt.transferAcceptedMine", actorName);
    if (actorName && senderName)
      return t("chatMoney.receipt.transferAcceptedBetween", actorName, senderName);
    return t("chatMoney.receipt.transferAccepted");
  }
  if (receipt.event_type === "transfer_returned") {
    const senderName = validReceiptDisplayName(sender, receipt.sender_id);
    const actorName = validReceiptDisplayName(actor, receipt.actor_id);
    if (receipt.actor_id === viewerId && senderName)
      return t("chatMoney.receipt.transferReturnedByMe", senderName);
    if (receipt.sender_id === viewerId && actorName)
      return t("chatMoney.receipt.transferReturnedMine", actorName);
    if (actorName && senderName)
      return t("chatMoney.receipt.transferReturnedBetween", actorName, senderName);
    return t("chatMoney.receipt.transferReturned");
  }
  const kind = receipt.kind ?? inferredChatMoneyKind(receipt.asset_id);
  if (!kind) return t("chatMoney.receipt.expiredRefunded");
  return kind === "red_packet"
    ? t("chatMoney.receipt.redPacketExpiredRefunded")
    : t("chatMoney.receipt.transferExpiredRefunded");
}

export function mergeChatMoneyDetail(
  existing: ChatMoneyDetail | undefined,
  incoming: ChatMoneyDetail,
): ChatMoneyDetail {
  if (!existing || incoming.version < existing.version) return existing ?? incoming;
  if (incoming.kind !== "red_packet") return terminalPermissions(incoming);
  const byUserId = new Map(existing.claims.map((claim) => [claim.user_id, claim]));
  incoming.claims.forEach((claim) => byUserId.set(claim.user_id, claim));
  return terminalPermissions({ ...incoming, claims: [...byUserId.values()] });
}

export function normalizeChatMoneyErrorCode(
  code: string | undefined,
  t: ChatMoneyTranslator,
): string | null {
  if (!code) return null;
  const keys: Record<string, string> = {
    chat_money_disabled: "chatMoney.featureDisabled",
    chat_money_not_eligible: "chatMoney.notEligible",
    insufficient_balance: "wallet.error.insufficientSpendableBalance",
    invalid_amount: "chatMoney.validation.invalidNumber",
    invalid_packet_count: "chatMoney.validation.invalidNumber",
    red_packet_already_claimed: "chatMoney.redPacket.alreadyClaimed",
    red_packet_empty: "chatMoney.redPacket.empty",
    red_packet_expired: "chatMoney.redPacket.expired",
    red_packet_recipient_only: "chatMoney.redPacket.exclusiveOnly",
    not_conversation_member: "chatMoney.redPacket.notConversationMember",
    transfer_recipient_only: "chatMoney.transfer.readOnly",
    transfer_already_finalized: "chatMoney.transfer.alreadyFinalized",
    operation_in_progress: "chatMoney.operationInProgress",
  };
  return keys[code] ? t(keys[code]) : null;
}

function normalizeClaimRecord(value: unknown): ChatMoneyClaimRecord | null {
  const record = objectValue(value);
  if (!record) return null;
  const userId = stringValue(record.user_id, record.userId, record.actor_id, record.actorId);
  const amount = nonnegativeInteger(record.amount, record.claimed_amount, record.claimedAmount);
  if (!userId || amount === undefined) return null;
  return {
    user_id: userId,
    nickname:
      stringValue(record.nickname, record.name, record.user_name, record.userName) ?? userId,
    ...optionalString("avatar_url", record.avatar_url, record.avatarUrl, record.avatar),
    amount,
    claimed_at:
      stringValue(record.claimed_at, record.claimedAt, record.created_at, record.createdAt) ?? "",
    is_luckiest: booleanValue(record.is_luckiest, record.isLuckiest, record.luckiest) ?? false,
  };
}

function findReceipt(value: unknown, depth: number): ChatMoneyReceiptPayload | null {
  if (depth >= 4) return null;
  const record = objectValue(value);
  if (!record) return null;
  const assetId = stringValue(record.asset_id, record.assetId, record.chat_money_asset_id);
  const eventType = chatMoneyReceiptEventType(record.event_type, record.eventType, record.type);
  if (assetId && eventType) {
    const actor = objectValue(record.actor) ?? {};
    const sender = objectValue(record.sender) ?? {};
    const asset = objectValue(record.asset) ?? {};
    const actorId =
      stringValue(
        record.actor_id,
        record.actorId,
        record.user_id,
        actor.id,
        actor.user_id,
        actor.userId,
      ) ?? "";
    const senderId =
      stringValue(record.sender_id, record.senderId, sender.id, sender.user_id, sender.userId) ??
      "";
    const actorName =
      stringValue(
        record.actor_name,
        record.actorName,
        record.nickname,
        actor.name,
        actor.nickname,
      ) ?? actorId;
    const senderName =
      stringValue(record.sender_name, record.senderName, sender.name, sender.nickname) ?? senderId;
    return {
      event_id:
        stringValue(record.event_id, record.eventId, record.id) ??
        `${assetId}:${eventType}:${actorId}`,
      asset_id: assetId,
      event_type: eventType,
      ...optionalEnum(
        "kind",
        chatMoneyKind(
          record.kind,
          record.asset_kind,
          asset.kind,
          asset.asset_kind,
          asset.assetKind,
        ),
      ),
      scope: receiptScope(record.scope),
      actor_id: actorId,
      actor_name: actorName,
      sender_id: senderId,
      sender_name: senderName,
      ...optionalString(
        "recipient_id",
        record.recipient_id,
        record.recipientId,
        record.receiver_id,
      ),
      ...optionalString("recipient_name", record.recipient_name, record.recipientName),
      ...optionalInteger("amount", record.amount),
      ...optionalString("created_at", record.created_at, record.createdAt, record.timestamp),
    };
  }
  for (const key of [
    "content",
    "payload",
    "data",
    "receipt",
    "receipt_message",
    "receiptMessage",
    "event",
  ] as const) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      try {
        const nested = findReceipt(JSON.parse(candidate) as unknown, depth + 1);
        if (nested) return nested;
      } catch {
        // Continue through the remaining supported envelopes.
      }
    } else {
      const nested = findReceipt(candidate, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function terminalPermissions(detail: ChatMoneyDetail): ChatMoneyDetail {
  return isTerminalChatMoneyStatus(detail.status)
    ? { ...detail, can_claim: false, can_accept: false, can_return: false }
    : detail;
}

function chatMoneyKind(...values: unknown[]): ChatMoneyKind | undefined {
  const value = stringValue(...values)
    ?.toLocaleLowerCase()
    .replaceAll("-", "_");
  if (value === "red_packet" || value === "redpacket" || value === "packet") return "red_packet";
  if (value === "transfer") return "transfer";
  return undefined;
}

function chatMoneyScope(...values: unknown[]): ChatMoneyScope | undefined {
  const value = stringValue(...values)?.toLocaleLowerCase();
  if (value === "dm" || value === "direct" || value === "private") return "dm";
  if (value === "group") return "group";
  return undefined;
}

function chatMoneyMode(...values: unknown[]): ChatMoneyRedPacketMode | undefined {
  const value = stringValue(...values)?.toLocaleLowerCase();
  return value === "direct" || value === "lucky" || value === "equal" || value === "exclusive"
    ? value
    : undefined;
}

function chatMoneyStatus(...values: unknown[]): ChatMoneyStatus | undefined {
  const value = stringValue(...values)
    ?.toLocaleLowerCase()
    .replaceAll("-", "_");
  if (value === "expired" || value === "refunded") return "expired_refunded";
  return value === "pending" ||
    value === "partial" ||
    value === "completed" ||
    value === "accepted" ||
    value === "returned" ||
    value === "expired_refunded"
    ? value
    : undefined;
}

function chatMoneyViewerState(...values: unknown[]): ChatMoneyViewerState | undefined {
  const value = stringValue(...values)
    ?.toLocaleLowerCase()
    .replaceAll("-", "_");
  const allowed: ChatMoneyViewerState[] = [
    "claimable",
    "claimed",
    "empty",
    "expired",
    "not_designated",
    "sender_view",
    "transfer_receivable",
    "transfer_sender_waiting",
    "transfer_observer",
    "accepted",
    "returned",
    "expired_refunded",
  ];
  return allowed.find((item) => item === value);
}

function chatMoneyUnavailableReason(...values: unknown[]): ChatMoneyUnavailableReason | undefined {
  const value = stringValue(...values)
    ?.toLocaleLowerCase()
    .replaceAll("-", "_");
  const allowed: ChatMoneyUnavailableReason[] = [
    "red_packet_already_claimed",
    "red_packet_empty",
    "red_packet_expired",
    "red_packet_recipient_only",
    "not_conversation_member",
    "transfer_recipient_only",
    "transfer_already_finalized",
  ];
  return allowed.find((item) => item === value);
}

function chatMoneyReceiptEventType(...values: unknown[]): ChatMoneyReceiptEventType | undefined {
  const value = stringValue(...values)
    ?.toLocaleLowerCase()
    .replaceAll("-", "_");
  const allowed: ChatMoneyReceiptEventType[] = [
    "red_packet_claimed",
    "transfer_accepted",
    "transfer_returned",
    "asset_expired_refunded",
  ];
  return allowed.find((item) => item === value);
}

function receiptScope(value: unknown): ChatMoneyScope {
  const normalized = stringValue(value)?.toLocaleLowerCase();
  return normalized === "group" || normalized === "group_chat" || normalized === "groupchat"
    ? "group"
    : "dm";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  let current = objectValue(value);
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (normalizeChatMoneyPayload(current)) return current;
    const nested = keys.map((key) => objectValue(current?.[key])).find(Boolean);
    if (!nested) return current;
    current = nested;
  }
  return current;
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function positiveInteger(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function positiveIntegerValue(...values: unknown[]): number | undefined {
  const value = nonnegativeInteger(...values);
  return value !== undefined && value > 0 ? value : undefined;
}

function nonnegativeInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function booleanValue(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true") return true;
    if (value === 0 || value === "0" || value === "false") return false;
  }
  return undefined;
}

function arrayValue(...values: unknown[]): unknown[] {
  return values.find(Array.isArray) ?? [];
}

function safeProduct(left: number, right: number): number | null {
  const result = left * right;
  return Number.isSafeInteger(result) ? result : null;
}

function optionalString<K extends string>(key: K, ...values: unknown[]): { [P in K]?: string } {
  const value = stringValue(...values);
  return value ? ({ [key]: value } as { [P in K]?: string }) : {};
}

function optionalInteger<K extends string>(key: K, ...values: unknown[]): { [P in K]?: number } {
  const value = nonnegativeInteger(...values);
  return value !== undefined ? ({ [key]: value } as { [P in K]?: number }) : {};
}

function optionalEnum<K extends string, V extends string>(
  key: K,
  value: V | undefined,
): { [P in K]?: V } {
  return value ? ({ [key]: value } as { [P in K]?: V }) : {};
}

function validReceiptDisplayName(name: string, id: string | undefined): string | null {
  const normalized = name.trim();
  if (!normalized || normalized === id) return null;
  return ["未知", "unknown", "null", "nil", "system"].includes(normalized.toLocaleLowerCase())
    ? null
    : normalized;
}

function inferredChatMoneyKind(assetId: string): ChatMoneyKind | undefined {
  const normalized = assetId.trim().toLocaleLowerCase().replaceAll("-", "_");
  if (
    normalized.startsWith("red_packet") ||
    normalized.startsWith("redpacket") ||
    normalized.startsWith("rp_")
  )
    return "red_packet";
  if (normalized.startsWith("transfer") || normalized.startsWith("tr_")) return "transfer";
  return undefined;
}
