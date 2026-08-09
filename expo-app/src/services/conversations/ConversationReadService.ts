import { markDirectMessagesRead, markGroupMessagesRead } from "@/api/bwchat";
import type { ConversationReadReceipt } from "@/models";
import {
  applyConversationReadReceipt,
  conversationReadIdentity,
} from "@/services/conversations/ConversationRepository";
import { dismissReadConversationNotifications } from "@/services/push/PushService";

const submittedThrough = new Map<string, number>();

export async function markConversationRead(
  ownerId: string,
  type: "dm" | "group",
  targetId: string,
  throughMessageId: number | undefined,
): Promise<ConversationReadReceipt | null> {
  if (
    !ownerId.trim() ||
    !targetId.trim() ||
    (throughMessageId !== undefined && !validMessageId(throughMessageId))
  ) {
    return null;
  }
  const identity = `${encodeURIComponent(ownerId)}:${conversationReadIdentity(type, targetId)}`;
  if (throughMessageId === undefined) {
    try {
      const receipt =
        type === "group"
          ? await markGroupMessagesRead(Number(targetId))
          : await markDirectMessagesRead(targetId);
      if (receipt?.conversation_id.trim()) {
        await applyConversationReadReceipt(ownerId, receipt);
        await dismissReadConversationNotifications(type, targetId, receipt.read_through_message_id);
      }
      return receipt;
    } catch {
      return null;
    }
  }
  const previous = submittedThrough.get(identity);
  if (previous !== undefined && throughMessageId <= previous) return null;
  submittedThrough.set(identity, throughMessageId);
  try {
    const receipt =
      type === "group"
        ? await markGroupMessagesRead(Number(targetId), { throughMessageId })
        : await markDirectMessagesRead(targetId, { throughMessageId });
    if (receipt?.conversation_id.trim()) {
      await applyConversationReadReceipt(ownerId, receipt);
      await dismissReadConversationNotifications(type, targetId, receipt.read_through_message_id);
    }
    return receipt;
  } catch {
    if (submittedThrough.get(identity) === throughMessageId) {
      if (previous === undefined) submittedThrough.delete(identity);
      else submittedThrough.set(identity, previous);
    }
    return null;
  }
}

export function resetConversationReadSubmissionForAccount(ownerId: string): void {
  const ownerPrefix = `${encodeURIComponent(ownerId.trim())}:`;
  if (ownerPrefix === ":") return;
  for (const identity of submittedThrough.keys()) {
    if (identity.startsWith(ownerPrefix)) submittedThrough.delete(identity);
  }
}

export function resetConversationReadSubmissionForTests(): void {
  submittedThrough.clear();
}

function validMessageId(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}
