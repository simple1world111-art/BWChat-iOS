import { markAgentMessagesRead, markDirectMessagesRead, markGroupMessagesRead } from "@/api/bwchat";
import type { AgentConversationReadReceipt, ConversationReadReceipt } from "@/models";
import { applyCachedAgentConversationReadReceipt } from "@/services/agents/AgentCatalogRepository";
import {
  applyConversationReadReceipt,
  conversationReadIdentity,
} from "@/services/conversations/ConversationRepository";
import {
  recordConversationNotificationRead,
  resetConversationNotificationReadStateForAccount,
  resetConversationNotificationReadStateForTests,
} from "@/services/conversations/ConversationNotificationReadState";
import { dismissReadConversationNotifications } from "@/services/push/PushService";

const submittedThrough = new Map<string, number>();
const submittedAgentThrough = new Map<string, number>();
const appliedAgentReceipts = new Map<
  string,
  { throughSequence: number; revision?: number | undefined }
>();
const agentReceiptApplications = new Map<string, Promise<void>>();

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
        recordConversationNotificationRead(
          ownerId,
          type,
          targetId,
          receipt.read_through_message_id,
        );
        await applyConversationReadReceipt(ownerId, receipt);
        await dismissReadConversationNotifications(type, targetId, receipt.read_through_message_id);
      }
      return receipt;
    } catch {
      return null;
    }
  }
  recordConversationNotificationRead(ownerId, type, targetId, throughMessageId);
  const notificationCleanup = dismissReadConversationNotifications(
    type,
    targetId,
    throughMessageId,
  );
  const previous = submittedThrough.get(identity);
  if (previous !== undefined && throughMessageId <= previous) {
    await notificationCleanup;
    return null;
  }
  submittedThrough.set(identity, throughMessageId);
  try {
    const receipt =
      type === "group"
        ? await markGroupMessagesRead(Number(targetId), { throughMessageId })
        : await markDirectMessagesRead(targetId, { throughMessageId });
    if (receipt?.conversation_id.trim()) {
      recordConversationNotificationRead(ownerId, type, targetId, receipt.read_through_message_id);
      await applyConversationReadReceipt(ownerId, receipt);
      await notificationCleanup;
      if (receipt.read_through_message_id > throughMessageId) {
        await dismissReadConversationNotifications(type, targetId, receipt.read_through_message_id);
      }
    }
    return receipt;
  } catch {
    await notificationCleanup;
    if (submittedThrough.get(identity) === throughMessageId) {
      if (previous === undefined) submittedThrough.delete(identity);
      else submittedThrough.set(identity, previous);
    }
    return null;
  }
}

export async function markAgentConversationRead(
  ownerId: string,
  conversationId: string,
  throughSequence: number | undefined,
  throughMessageId?: string | undefined,
): Promise<AgentConversationReadReceipt | null> {
  const owner = ownerId.trim();
  const target = conversationId.trim();
  if (!owner || !target || (throughSequence !== undefined && !validMessageId(throughSequence))) {
    return null;
  }
  const identity = `${encodeURIComponent(owner)}:agent:${encodeURIComponent(target)}`;
  if (throughSequence !== undefined) {
    recordConversationNotificationRead(owner, "agent", target, throughSequence);
    const notificationCleanup = dismissReadConversationNotifications(
      "agent",
      target,
      throughSequence,
    );
    const previous = submittedAgentThrough.get(identity);
    if (previous !== undefined && throughSequence <= previous) {
      await notificationCleanup;
      return null;
    }
    submittedAgentThrough.set(identity, throughSequence);
    try {
      const receipt = await markAgentMessagesRead(target, {
        throughSequence,
        ...(throughMessageId?.trim() ? { throughMessageId: throughMessageId.trim() } : {}),
      });
      if (!receipt?.conversation_id.trim()) {
        await notificationCleanup;
        return receipt;
      }
      return applyAgentReadReceiptResponse(
        identity,
        owner,
        target,
        receipt,
        notificationCleanup,
        throughSequence,
      );
    } catch {
      await notificationCleanup;
      if (submittedAgentThrough.get(identity) === throughSequence) {
        if (previous === undefined) submittedAgentThrough.delete(identity);
        else submittedAgentThrough.set(identity, previous);
      }
      return null;
    }
  }
  try {
    const receipt = await markAgentMessagesRead(target);
    if (!receipt?.conversation_id.trim()) return receipt;
    return applyAgentReadReceiptResponse(identity, owner, target, receipt);
  } catch {
    return null;
  }
}

export function resetConversationReadSubmissionForAccount(ownerId: string): void {
  const ownerPrefix = `${encodeURIComponent(ownerId.trim())}:`;
  if (ownerPrefix === ":") return;
  for (const identity of submittedThrough.keys()) {
    if (identity.startsWith(ownerPrefix)) submittedThrough.delete(identity);
  }
  for (const identity of submittedAgentThrough.keys()) {
    if (identity.startsWith(ownerPrefix)) submittedAgentThrough.delete(identity);
  }
  for (const identity of appliedAgentReceipts.keys()) {
    if (identity.startsWith(ownerPrefix)) appliedAgentReceipts.delete(identity);
  }
  for (const identity of agentReceiptApplications.keys()) {
    if (identity.startsWith(ownerPrefix)) agentReceiptApplications.delete(identity);
  }
  resetConversationNotificationReadStateForAccount(ownerId);
}

export function resetConversationReadSubmissionForTests(): void {
  submittedThrough.clear();
  submittedAgentThrough.clear();
  appliedAgentReceipts.clear();
  agentReceiptApplications.clear();
  resetConversationNotificationReadStateForTests();
}

async function applyAgentReadReceiptResponse(
  identity: string,
  ownerId: string,
  conversationId: string,
  receipt: AgentConversationReadReceipt,
  notificationCleanup?: Promise<number>,
  requestedThroughSequence?: number,
): Promise<AgentConversationReadReceipt | null> {
  return enqueueAgentReceiptApplication(identity, async () => {
    if (receipt.conversation_id.trim() !== conversationId) {
      await notificationCleanup;
      return null;
    }
    const current = appliedAgentReceipts.get(identity);
    if (!shouldApplyAgentReadReceipt(current, receipt)) {
      await notificationCleanup;
      return null;
    }
    recordConversationNotificationRead(
      ownerId,
      "agent",
      conversationId,
      receipt.read_through_sequence,
    );
    await Promise.all([
      applyCachedAgentConversationReadReceipt(ownerId, receipt),
      notificationCleanup ??
        dismissReadConversationNotifications(
          "agent",
          conversationId,
          receipt.read_through_sequence,
        ),
    ]);
    if (
      notificationCleanup !== undefined &&
      requestedThroughSequence !== undefined &&
      receipt.read_through_sequence > requestedThroughSequence
    ) {
      await dismissReadConversationNotifications(
        "agent",
        conversationId,
        receipt.read_through_sequence,
      );
    }
    appliedAgentReceipts.set(identity, {
      throughSequence: Math.max(current?.throughSequence ?? 0, receipt.read_through_sequence),
      ...(receipt.revision !== undefined
        ? { revision: Math.max(current?.revision ?? 0, receipt.revision) }
        : current?.revision !== undefined
          ? { revision: current.revision }
          : {}),
    });
    return receipt;
  });
}

function shouldApplyAgentReadReceipt(
  current: { throughSequence: number; revision?: number | undefined } | undefined,
  receipt: AgentConversationReadReceipt,
): boolean {
  if (!current) return true;
  if (receipt.revision !== undefined && current.revision !== undefined) {
    if (receipt.revision !== current.revision) return receipt.revision > current.revision;
  } else if (receipt.revision !== undefined && current.revision === undefined) {
    return true;
  }
  return receipt.read_through_sequence > current.throughSequence;
}

async function enqueueAgentReceiptApplication<T>(
  identity: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = agentReceiptApplications.get(identity) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const barrier = result.then(
    () => undefined,
    () => undefined,
  );
  agentReceiptApplications.set(identity, barrier);
  try {
    return await result;
  } finally {
    if (agentReceiptApplications.get(identity) === barrier) {
      agentReceiptApplications.delete(identity);
    }
  }
}

function validMessageId(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}
