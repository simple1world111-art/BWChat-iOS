import { conversationListIdentity } from "@/services/conversations/ConversationListPolicy";
import { loadCachedAgentCatalog } from "@/services/agents/AgentCatalogRepository";
import { loadCachedConversationSnapshot } from "@/services/conversations/ConversationRepository";

export type NotificationConversationType = "dm" | "group" | "agent" | "script";

export interface ConversationNotificationReadRoute {
  conversationType: NotificationConversationType;
  conversationId: string;
  senderId?: string | undefined;
  groupId?: number | undefined;
  agentConversationId?: string | undefined;
  scriptRoomId?: string | undefined;
  messageId?: number | undefined;
  messageSequence?: number | undefined;
  unreadCount?: number | undefined;
}

const watermarksByOwner = new Map<string, Map<string, number>>();
const hydrationFlights = new Map<string, Promise<void>>();

export function recordConversationNotificationRead(
  ownerId: string,
  type: string,
  targetId: string,
  throughMessageId: number,
): boolean {
  const owner = ownerId.trim();
  const target = targetId.trim();
  if (!owner || !target || !validMessageId(throughMessageId)) return false;
  const identity = notificationConversationIdentity(type, target);
  if (!identity) return false;
  if (identity === "group:0") return false;
  const ownerWatermarks = watermarksByOwner.get(owner) ?? new Map<string, number>();
  const previous = ownerWatermarks.get(identity) ?? 0;
  ownerWatermarks.set(identity, Math.max(previous, throughMessageId));
  watermarksByOwner.set(owner, ownerWatermarks);
  return throughMessageId > previous;
}

export function conversationNotificationRouteIsRead(
  ownerId: string,
  route: ConversationNotificationReadRoute,
): boolean {
  const owner = ownerId.trim();
  if (!owner) return false;
  if (route.unreadCount === 0) return true;
  const watermark = conversationNotificationReadPosition(route);
  if (!validMessageId(watermark)) return false;
  const ownerWatermarks = watermarksByOwner.get(owner);
  if (!ownerWatermarks) return false;
  return conversationNotificationRouteIdentities(route).some(
    (identity) => (ownerWatermarks.get(identity) ?? 0) >= watermark,
  );
}

export async function hydrateAndCheckConversationNotificationRead(
  ownerId: string,
  route: ConversationNotificationReadRoute,
): Promise<boolean> {
  const owner = ownerId.trim();
  if (!owner || conversationNotificationRouteIsRead(owner, route)) {
    return conversationNotificationRouteIsRead(owner, route);
  }
  await hydrateConversationNotificationReadState(owner);
  return conversationNotificationRouteIsRead(owner, route);
}

export function conversationNotificationRouteIdentities(
  route: Pick<
    ConversationNotificationReadRoute,
    | "conversationType"
    | "conversationId"
    | "senderId"
    | "groupId"
    | "agentConversationId"
    | "scriptRoomId"
  >,
): string[] {
  const targets = routeTargets(route);
  const identities = targets
    .map((target) => target.trim())
    .filter(Boolean)
    .map((target) => notificationConversationIdentity(route.conversationType, target))
    .filter((identity): identity is string => Boolean(identity));
  // Script rooms deliberately reuse the underlying group read API. A read
  // receipt can therefore arrive as group:N while a delayed push is keyed by
  // script:room-id; carry both identities on that route.
  if (route.conversationType === "script" && route.groupId !== undefined) {
    const groupIdentity = notificationConversationIdentity("group", String(route.groupId));
    if (groupIdentity) identities.push(groupIdentity);
  }
  return identities.filter(
    (identity, index, values) => identity !== "group:0" && values.indexOf(identity) === index,
  );
}

export function resetConversationNotificationReadStateForAccount(ownerId: string): void {
  const owner = ownerId.trim();
  if (!owner) return;
  watermarksByOwner.delete(owner);
  hydrationFlights.delete(owner);
}

export function resetConversationNotificationReadStateForTests(): void {
  watermarksByOwner.clear();
  hydrationFlights.clear();
}

async function hydrateConversationNotificationReadState(ownerId: string): Promise<void> {
  const existing = hydrationFlights.get(ownerId);
  if (existing) return existing;
  const flight = (async () => {
    const [snapshot, agentCatalog] = await Promise.all([
      loadCachedConversationSnapshot(ownerId),
      loadCachedAgentCatalog(ownerId).catch(() => null),
    ]);
    for (const conversation of snapshot?.conversations ?? []) {
      const throughMessageId =
        conversation.read_through_message_id ??
        (conversation.unread_count === 0 ? conversation.last_message_id : undefined);
      if (!validMessageId(throughMessageId)) continue;
      recordIdentity(ownerId, conversationListIdentity(conversation), throughMessageId);
      const scriptRoomId = conversation.script_room_id?.trim();
      if (scriptRoomId) recordIdentity(ownerId, `script:${scriptRoomId}`, throughMessageId);
    }
    for (const conversation of agentCatalog?.value.conversations ?? []) {
      if (!validMessageId(conversation.read_through_sequence)) continue;
      recordIdentity(ownerId, `agent:${conversation.id}`, conversation.read_through_sequence);
    }
  })().finally(() => hydrationFlights.delete(ownerId));
  hydrationFlights.set(ownerId, flight);
  return flight;
}

function recordIdentity(ownerId: string, identity: string, throughMessageId: number): void {
  const ownerWatermarks = watermarksByOwner.get(ownerId) ?? new Map<string, number>();
  ownerWatermarks.set(identity, Math.max(ownerWatermarks.get(identity) ?? 0, throughMessageId));
  watermarksByOwner.set(ownerId, ownerWatermarks);
}

function validMessageId(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

export function conversationNotificationReadPosition(
  route: Pick<
    ConversationNotificationReadRoute,
    "conversationType" | "messageId" | "messageSequence"
  >,
): number | undefined {
  // Existing DM/group/script read APIs advance by server message ID. Agent
  // conversations have their own per-conversation sequence watermark.
  return route.conversationType === "agent"
    ? (route.messageSequence ?? route.messageId)
    : (route.messageId ?? route.messageSequence);
}

function notificationConversationIdentity(type: string, id: string): string | null {
  const normalizedType = type.trim().toLocaleLowerCase().replaceAll("-", "_");
  const target = id.trim();
  if (!target) return null;
  if (normalizedType === "group" || normalizedType === "group_chat") {
    return `group:${Number(target) || 0}`;
  }
  if (["agent", "agent_message", "agent_conversation"].includes(normalizedType)) {
    return `agent:${target}`;
  }
  if (["script", "script_room", "script_room_message"].includes(normalizedType)) {
    return `script:${target}`;
  }
  return `dm:${target}`;
}

function routeTargets(
  route: Pick<
    ConversationNotificationReadRoute,
    | "conversationType"
    | "conversationId"
    | "senderId"
    | "groupId"
    | "agentConversationId"
    | "scriptRoomId"
  >,
): string[] {
  if (route.conversationType === "group") {
    return [route.conversationId, route.groupId !== undefined ? String(route.groupId) : ""];
  }
  if (route.conversationType === "agent") {
    return [route.conversationId, route.agentConversationId ?? ""];
  }
  if (route.conversationType === "script") {
    return [route.conversationId, route.scriptRoomId ?? ""];
  }
  return [route.conversationId, route.senderId ?? ""];
}
