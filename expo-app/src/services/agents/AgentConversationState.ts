import type { AgentConversation, AgentMessage } from "@/models";
import { compareMessageTimes } from "@/services/agents/agentHubPolicy";

export function mergeAgentConversationState(
  current: AgentConversation | null | undefined,
  incoming: AgentConversation,
): AgentConversation {
  if (!current || current.id !== incoming.id) return incoming;

  const currentRevision = current.revision;
  const incomingRevision = incoming.revision;
  const revisionOrder = compareOptionalNumbers(incomingRevision, currentRevision);
  const incomingLatestIsNewer = agentMessageIsNewer(
    incoming.latest_message,
    current.latest_message,
  );
  const incomingReadStateIsAuthoritative =
    revisionOrder > 0 ||
    (currentRevision === undefined && incomingRevision !== undefined) ||
    (currentRevision === undefined &&
      incomingRevision === undefined &&
      incomingLatestIsNewer);
  const currentReadStateIsAuthoritative =
    revisionOrder < 0 || (currentRevision !== undefined && incomingRevision === undefined);
  const readThroughSequence = optionalMax(
    current.read_through_sequence,
    incoming.read_through_sequence,
  );
  const unreadCount = incomingReadStateIsAuthoritative
    ? incoming.unread_count ?? current.unread_count
    : currentReadStateIsAuthoritative
      ? current.unread_count ?? incoming.unread_count
      : optionalMin(current.unread_count, incoming.unread_count);
  const totalUnreadCount = incomingReadStateIsAuthoritative
    ? incoming.total_unread_count ?? current.total_unread_count
    : currentReadStateIsAuthoritative
      ? current.total_unread_count ?? incoming.total_unread_count
      : optionalMin(current.total_unread_count, incoming.total_unread_count);
  const revision = optionalMax(currentRevision, incomingRevision);
  const latestMessage = incomingLatestIsNewer
    ? incoming.latest_message
    : current.latest_message ?? incoming.latest_message;
  const merged: AgentConversation = {
    ...incoming,
    ...(latestMessage ? { latest_message: latestMessage } : {}),
    updated_at:
      compareMessageTimes(incoming.updated_at, current.updated_at) >= 0
        ? incoming.updated_at
        : current.updated_at,
  };
  assignOptionalNumber(merged, "unread_count", unreadCount);
  assignOptionalNumber(merged, "read_through_sequence", readThroughSequence);
  assignOptionalNumber(merged, "total_unread_count", totalUnreadCount);
  assignOptionalNumber(merged, "revision", revision);
  return merged;
}

export function mergeAgentConversationSnapshots(
  current: readonly AgentConversation[],
  incoming: readonly AgentConversation[],
): AgentConversation[] {
  const currentById = new Map(current.map((conversation) => [conversation.id, conversation]));
  return incoming.map((conversation) =>
    mergeAgentConversationState(currentById.get(conversation.id), conversation),
  );
}

function agentMessageIsNewer(
  incoming: AgentMessage | undefined,
  current: AgentMessage | undefined,
): boolean {
  if (!incoming) return false;
  if (!current) return true;
  if (incoming.sequence_no !== current.sequence_no) {
    return incoming.sequence_no > current.sequence_no;
  }
  return (
    compareMessageTimes(
      incoming.updated_at || incoming.created_at,
      current.updated_at || current.created_at,
    ) >= 0
  );
}

function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
  if (left === undefined || right === undefined) return 0;
  return left === right ? 0 : left > right ? 1 : -1;
}

function optionalMax(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

function optionalMin(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function assignOptionalNumber<K extends keyof AgentConversation>(
  target: AgentConversation,
  key: K,
  value: number | undefined,
): void {
  if (value === undefined) delete target[key];
  else target[key] = value as AgentConversation[K];
}
