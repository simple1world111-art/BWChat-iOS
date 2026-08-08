import type { Conversation, GroupMessage, ScriptRole, ScriptRoom, ScriptTurnState } from "@/models";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";

export const scriptRoomMetrics = {
  rosterGap: 10,
  rosterHorizontalInset: 14,
  rosterVerticalInset: 8,
  rosterRoleWidth: 52,
  rosterRoleGap: 4,
  rosterAvatarSize: 40,
  rosterBadgeSize: 12,
  rosterBadgeStroke: 1.5,
  rosterBadgeIconSize: 6,
  rosterNameSize: 10,
  timelineGap: 13,
  timelineHorizontalInset: 14,
  timelineVerticalInset: 14,
  storyGap: 10,
  storyCoverWidth: 96,
  storyCoverHeight: 72,
  storyCoverRadius: 12,
  storyTextSize: 13,
  storyInset: 12,
  storyRadius: 14,
  stateGap: 9,
  stateInset: 12,
  stateTextSize: 13,
  failedGap: 8,
  failedRadius: 12,
  endedHorizontalInset: 14,
  endedVerticalInset: 8,
  composerGap: 10,
  composerHorizontalInset: 12,
  composerVerticalInset: 9,
  inputHorizontalInset: 13,
  inputVerticalInset: 10,
  inputRadius: 18,
  inputMaximumCharacters: 1000,
  sendSize: 38,
  sendIconSize: 16,
  messageGap: 8,
  messageSideSpacer: 52,
  messageNameSize: 11,
  messageBadgeSize: 8,
  messageBadgeHorizontalInset: 4,
  messageBadgeVerticalInset: 1,
  messageContentSize: 15,
  messageHorizontalInset: 13,
  messageVerticalInset: 10,
  messageRadius: 16,
  messageAvatarSize: 32,
  roomTtlMilliseconds: 5 * 60 * 1_000,
  roomStaleRetentionMilliseconds: 365 * 24 * 60 * 60 * 1_000,
  toastMilliseconds: 3_000,
  scrollDelayMilliseconds: 50,
  scrollAnimationMilliseconds: 200,
} as const;

export function scriptText(
  selectedLanguage: string,
  simplifiedChinese: string,
  english: string,
): string {
  return selectedLanguage === "system" ||
    selectedLanguage === "zh-Hans" ||
    selectedLanguage === "zh-Hant"
    ? simplifiedChinese
    : english;
}

export function provisionalScriptRoom(conversation: Conversation): ScriptRoom | null {
  const roomId = conversation.script_room_id ?? "";
  const groupId = resolvedNativeScriptGroupId(conversation);
  const kind = trimFoundationWhitespacesAndNewlines(conversation.conversation_kind ?? "")
    .toLowerCase()
    .replaceAll("-", "_");
  if (
    !trimFoundationWhitespacesAndNewlines(roomId) ||
    kind !== "script_room" ||
    groupId === undefined
  ) {
    return null;
  }
  return {
    room_id: roomId,
    script_id: conversation.script_id ?? "",
    group_id: groupId,
    status: "active",
    player_role_id: "",
    assignments: [],
    script_snapshot: {
      title: conversation.name,
      synopsis: "",
      cover_url: conversation.avatar_url,
      roles: [],
    },
  };
}

export function isCompleteScriptRoom(room: ScriptRoom | null | undefined): boolean {
  return Boolean(
    room &&
    (trimFoundationWhitespacesAndNewlines(room.player_role_id) ||
      room.assignments.length > 0 ||
      room.script_snapshot.roles.length > 0),
  );
}

export function mergeScriptMessages(
  current: readonly GroupMessage[],
  incoming: readonly GroupMessage[],
  _groupId?: number,
): GroupMessage[] {
  const keyed = new Map<number, GroupMessage>();
  for (const message of [...current, ...incoming]) {
    keyed.set(message.id, message);
  }
  return [...keyed.values()].sort(
    (left, right) => left.id - right.id || left.timestamp.localeCompare(right.timestamp),
  );
}

export function mergeCachedScriptMessages(
  current: readonly GroupMessage[],
  incoming: readonly GroupMessage[],
  groupId?: number,
): GroupMessage[] {
  return mergeScriptMessages(current, incoming)
    .filter((message) => groupId === undefined || message.group_id === groupId)
    .slice(-100);
}

export function roleForScriptMessage(
  message: GroupMessage,
  room: ScriptRoom,
): ScriptRole | undefined {
  const roleId = message.script_context?.role_id;
  return roleId !== undefined
    ? room.script_snapshot.roles.find((role) => role.role_id === roleId)
    : undefined;
}

export function isCurrentScriptPlayer(message: GroupMessage, currentUserId?: string): boolean {
  if (message.script_context?.actor_type) return message.script_context.actor_type === "user";
  return Boolean(currentUserId && message.sender_id === currentUserId);
}

export function scriptMessageAvatar(
  message: GroupMessage,
  role: ScriptRole | undefined,
  currentPlayer: boolean,
): string | null {
  if (!message.sender_id.startsWith("script-role:") && !message.script_context) return null;
  if (currentPlayer && trimFoundationWhitespacesAndNewlines(role?.avatar_url ?? "")) {
    return role?.avatar_url ?? "";
  }
  if (trimFoundationWhitespacesAndNewlines(message.sender_avatar)) return message.sender_avatar;
  if (trimFoundationWhitespacesAndNewlines(role?.avatar_url ?? "")) return role?.avatar_url ?? "";
  return "";
}

function resolvedNativeScriptGroupId(conversation: Conversation): number | undefined {
  const rawType = trimFoundationWhitespacesAndNewlines(conversation.type)
    .toLowerCase()
    .replaceAll("-", "_");
  let type: "dm" | "group" | "agent";
  if (["group", "group_chat", "groupchat", "room"].includes(rawType)) {
    type = "group";
  } else if (["dm", "direct", "direct_message", "private", "private_chat"].includes(rawType)) {
    type = "dm";
  } else if (["agent", "agent_chat", "agent_conversation", "agent_profile"].includes(rawType)) {
    type = "agent";
  } else {
    type =
      conversation.group_id !== undefined ||
      conversation.id.startsWith("group_") ||
      conversation.id.startsWith("group:")
        ? "group"
        : "dm";
  }
  if (type !== "group") return undefined;
  if (conversation.group_id !== undefined) return conversation.group_id;
  if (/^[+-]?\d+$/u.test(conversation.id)) {
    const direct = Number(conversation.id);
    return Number.isSafeInteger(direct) ? direct : undefined;
  }
  const digitRuns = conversation.id.match(/\d+/gu);
  const trailingRun = digitRuns?.at(-1);
  if (trailingRun === undefined) return undefined;
  const parsed = Number(trailingRun);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function isScriptGenerating(
  turnState: ScriptTurnState | null | undefined,
  isSending: boolean,
): boolean {
  return isSending || turnState?.status === "queued" || turnState?.status === "generating";
}

export function canSendScriptTurn(input: {
  room?: ScriptRoom | null;
  hasAuthoritativeRoom: boolean;
  isGenerating: boolean;
  text: string;
}): boolean {
  return (
    input.hasAuthoritativeRoom &&
    input.room?.status === "active" &&
    !input.isGenerating &&
    scriptTurnContent(input.text).length > 0
  );
}

export function scriptTurnContent(value: string): string {
  return trimFoundationWhitespacesAndNewlines(value);
}

export function cappedScriptInput(value: string): string {
  return scriptGraphemes(value).slice(0, scriptRoomMetrics.inputMaximumCharacters).join("");
}

function scriptGraphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
      ({ segment }) => segment,
    );
  }
  return Array.from(value);
}
