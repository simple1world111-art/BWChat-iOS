import type { Conversation } from "@/models";

interface PendingScriptRoomConversation {
  ownerId: string;
  conversation: Conversation;
}

let pendingConversation: PendingScriptRoomConversation | null = null;

export function rememberScriptRoomConversation(conversation: Conversation, ownerId: string): void {
  const owner = ownerId.trim();
  if (!owner) return;
  pendingConversation = { ownerId: owner, conversation };
}

export function pendingScriptRoomConversation(
  roomId: string,
  ownerId: string,
): Conversation | null {
  return pendingConversation?.ownerId === ownerId.trim() &&
    pendingConversation.conversation.script_room_id === roomId
    ? pendingConversation.conversation
    : null;
}

export function clearPendingScriptRoomConversation(roomId: string, ownerId: string): void {
  if (
    pendingConversation?.ownerId === ownerId.trim() &&
    pendingConversation.conversation.script_room_id === roomId
  ) {
    pendingConversation = null;
  }
}
