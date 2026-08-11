import { conversationListIdentity } from "@/services/conversations/ConversationListPolicy";
import {
  conversationReadIdentity,
  loadCachedConversationSnapshot,
} from "@/services/conversations/ConversationRepository";

export interface ConversationNotificationReadRoute {
  conversationType: "dm" | "group";
  conversationId: string;
  senderId?: string | undefined;
  groupId?: number | undefined;
  messageId?: number | undefined;
  unreadCount?: number | undefined;
}

const watermarksByOwner = new Map<string, Map<string, number>>();
const hydrationFlights = new Map<string, Promise<void>>();
const hydratedOwners = new Set<string>();

export function recordConversationNotificationRead(
  ownerId: string,
  type: string,
  targetId: string,
  throughMessageId: number,
): boolean {
  const owner = ownerId.trim();
  const target = targetId.trim();
  if (!owner || !target || !validMessageId(throughMessageId)) return false;
  const identity = conversationReadIdentity(type, target);
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
  if (!validMessageId(route.messageId)) return false;
  const ownerWatermarks = watermarksByOwner.get(owner);
  if (!ownerWatermarks) return false;
  return conversationNotificationRouteIdentities(route).some(
    (identity) => (ownerWatermarks.get(identity) ?? 0) >= route.messageId!,
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
    "conversationType" | "conversationId" | "senderId" | "groupId"
  >,
): string[] {
  const targets =
    route.conversationType === "group"
      ? [route.conversationId, route.groupId !== undefined ? String(route.groupId) : ""]
      : [route.conversationId, route.senderId ?? ""];
  return targets
    .map((target) => target.trim())
    .filter(Boolean)
    .map((target) => conversationReadIdentity(route.conversationType, target))
    .filter(
      (identity, index, values) => identity !== "group:0" && values.indexOf(identity) === index,
    );
}

export function resetConversationNotificationReadStateForAccount(ownerId: string): void {
  const owner = ownerId.trim();
  if (!owner) return;
  watermarksByOwner.delete(owner);
  hydrationFlights.delete(owner);
  hydratedOwners.delete(owner);
}

export function resetConversationNotificationReadStateForTests(): void {
  watermarksByOwner.clear();
  hydrationFlights.clear();
  hydratedOwners.clear();
}

async function hydrateConversationNotificationReadState(ownerId: string): Promise<void> {
  if (hydratedOwners.has(ownerId)) return;
  const existing = hydrationFlights.get(ownerId);
  if (existing) return existing;
  const flight = (async () => {
    const snapshot = await loadCachedConversationSnapshot(ownerId);
    for (const conversation of snapshot?.conversations ?? []) {
      const throughMessageId =
        conversation.read_through_message_id ??
        (conversation.unread_count === 0 ? conversation.last_message_id : undefined);
      if (!validMessageId(throughMessageId)) continue;
      recordIdentity(ownerId, conversationListIdentity(conversation), throughMessageId);
    }
    hydratedOwners.add(ownerId);
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
