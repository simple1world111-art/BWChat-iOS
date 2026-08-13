import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { apiRequest } from "@/api/client";
import { conversationListIdentity } from "@/services/conversations/ConversationListPolicy";
import { loadCachedConversationSnapshot } from "@/services/conversations/ConversationRepository";
import { conversationSyncCoordinator } from "@/services/conversations/ConversationSyncCoordinator";
import {
  conversationNotificationReadPosition,
  conversationNotificationRouteIdentities,
  conversationNotificationRouteIsRead,
  hydrateAndCheckConversationNotificationRead,
  resetConversationNotificationReadStateForTests,
} from "@/services/conversations/ConversationNotificationReadState";
import { loadCachedGroupDetail } from "@/services/groups/GroupDetailRepository";
import { captureException } from "@/services/monitoring/MonitoringService";
import { incrementMomentsUnread } from "@/services/moments/MomentsUnreadStore";
import {
  readCachedNativePushToken,
  writeCachedNativePushToken,
} from "@/services/push/PushTokenStore";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";
import {
  featureFlagEnabled,
  readCachedRemoteConfig,
} from "@/services/remote-config/RemoteConfigService";
import type { GroupNotificationSettings } from "@/models";

export { readCachedNativePushToken } from "@/services/push/PushTokenStore";

export type NotificationConversationType = "dm" | "group" | "agent" | "script";

export interface NotificationRoute {
  eventId: string;
  conversationType: NotificationConversationType;
  conversationId: string;
  conversationKey: string;
  messageKey?: string | undefined;
  messageSequence?: number | undefined;
  messageVersion?: number | undefined;
  senderId?: string | undefined;
  groupId?: number | undefined;
  agentId?: string | undefined;
  scriptRoomId?: string | undefined;
  scriptId?: string | undefined;
  agentAvatarAssetId?: string | undefined;
  messageId?: number | undefined;
  conversationRevision?: number | undefined;
  unreadRevision?: number | undefined;
  unreadCount?: number | undefined;
  totalUnreadCount?: number | undefined;
  senderName?: string | undefined;
  senderAvatar?: string | undefined;
  groupName?: string | undefined;
  groupAvatar?: string | undefined;
  conversationName?: string | undefined;
  conversationAvatar?: string | undefined;
  messageType?: string | undefined;
  contentPreview?: string | undefined;
  sentAt?: string | undefined;
  isDirectMention: boolean;
  isMentionAll: boolean;
  notificationMode?: string | undefined;
}

export type PushOpenTarget =
  | { kind: "conversation"; eventId: string; route: NotificationRoute }
  | { kind: "moments"; eventId: string };

export interface PushPresentationPolicy {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
}

const legacyPendingOpenKey = "bwchat.push.pending-open.v1";
const pendingOpenQueueKey = "bwchat.push.pending-open.v2";
const processedEventIdsKey = "bwchat.push.processed-event-ids.v1";
const receivedSideEffectIdsKey = "bwchat.push.received-side-effect-ids.v1";
const unreadRevisionsKey = "bwchat.push.unread-revisions.v1";
const groupPushTypes = new Set([
  "group",
  "group_message",
  "new_group_message",
  "group_chat",
  "groupchat",
]);
const callPushTypes = new Set(["call", "call_invite", "group_call", "group_call_invite"]);
const securityPushTypes = new Set([
  "account_security",
  "safety_alert",
  "security",
  "security_alert",
]);
const directPushTypes = new Set([
  "chat",
  "chat_message",
  "direct_message",
  "dm",
  "dm_message",
  "message",
  "new_message",
]);
const agentPushTypes = new Set([
  "agent",
  "agent_chat",
  "agent_message",
  "agent_conversation",
  "new_agent_message",
]);
const scriptPushTypes = new Set([
  "script",
  "script_chat",
  "script_message",
  "script_room",
  "script_room_message",
  "new_script_message",
]);
const maximumPendingOpenCount = 16;
const uploadFlights = new Map<string, Promise<void>>();
const uploadedSessions = new Set<string>();
const uploadSessionGenerations = new Map<string, number>();
let initialized = false;
let processedEventIdsPromise: Promise<Set<string>> | null = null;
let receivedSideEffectIdsPromise: Promise<Set<string>> | null = null;
let unreadRevisionsPromise: Promise<Map<string, number>> | null = null;
let activePushOwnerId = "";
let pendingOpenMutationChain: Promise<unknown> = Promise.resolve();
let receivedSideEffectMutationChain: Promise<unknown> = Promise.resolve();
let unreadRevisionMutationChain: Promise<unknown> = Promise.resolve();
const claimedPushEventIds = new Set<string>();
const claimedReceivedSideEffectIds = new Set<string>();
const lastForegroundPresentationByConversation = new Map<string, number>();
const foregroundPresentationWindowMilliseconds = 1_500;

export function initializePushNotifications(): void {
  if (initialized) return;
  initialized = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const input = notification.request.content.data;
      const route = parseNotificationRoute(input);
      const policy = presentationPolicyForPush(input, {
        isConversationActive: (type, id) =>
          (
            chatRealtimeService.isConversationActive as (
              surface: NotificationConversationType,
              surfaceId: string,
            ) => boolean
          )(type, id),
        coalesce: false,
      });
      if (!policy.shouldShowBanner || !activePushOwnerId) return policy;
      if (foregroundChatPushWasRead(input, activePushOwnerId)) return behavior(false, false);
      if (
        route &&
        (await hydrateAndCheckConversationNotificationRead(activePushOwnerId, readRoute(route)))
      ) {
        return behavior(false, false);
      }
      if (
        (route?.conversationType !== "group" && route?.conversationType !== "script") ||
        !route.groupId
      )
        return coalesceForegroundPresentation(input, policy);
      try {
        const config = await readCachedRemoteConfig(activePushOwnerId);
        if (
          !config ||
          !featureFlagEnabled(config, "group_notification_settings_v1", activePushOwnerId, false)
        )
          return coalesceForegroundPresentation(input, policy);
        const detail = await loadCachedGroupDetail(activePushOwnerId, route.groupId);
        return detail && !shouldAlertForGroupSettings(detail.notification_settings, route)
          ? behavior(false, false)
          : coalesceForegroundPresentation(input, policy);
      } catch (error) {
        captureException(error, { operation: "push_group_foreground_policy" });
        return coalesceForegroundPresentation(input, policy);
      }
    },
    handleError: (_notificationId, error) =>
      captureException(error, { operation: "push_foreground_handler" }),
  });
  if (Platform.OS === "android") {
    const channels = [
      ["messages", "消息", Notifications.AndroidImportance.HIGH, "default"],
      ["mentions", "提及与重要消息", Notifications.AndroidImportance.MAX, "default"],
      ["calls", "通话", Notifications.AndroidImportance.MAX, "default"],
      ["silent", "静默同步", Notifications.AndroidImportance.LOW, null],
      ["default", "消息（兼容）", Notifications.AndroidImportance.HIGH, "default"],
    ] as const;
    for (const [id, name, importance, sound] of channels) {
      void Notifications.setNotificationChannelAsync(id, { importance, name, sound }).catch(
        (error) => captureException(error, { channel_id: id, operation: "push_android_channel" }),
      );
    }
  }
  void refreshNativePushToken().catch(() => undefined);
}

export function setActivePushOwnerId(ownerId: string): void {
  const nextOwnerId = ownerId.trim();
  if (nextOwnerId !== activePushOwnerId) lastForegroundPresentationByConversation.clear();
  activePushOwnerId = nextOwnerId;
}

export function shouldAlertForGroupSettings(
  settings: GroupNotificationSettings,
  route: Pick<NotificationRoute, "senderId" | "isDirectMention" | "isMentionAll">,
): boolean {
  if (!settings.muted) return true;
  if (route.isDirectMention && settings.notify_mentions_me) return true;
  if (route.isMentionAll && settings.notify_mentions_all) return true;
  return Boolean(route.senderId && settings.important_member_ids.includes(route.senderId));
}

export function flattenNotificationPayload(input: unknown): Record<string, unknown> {
  const root = recordValue(input) ?? {};
  const result: Record<string, unknown> = { ...root };
  for (const key of ["data", "payload", "notification_data"]) {
    const nested = recordValue(root[key]);
    if (!nested) continue;
    for (const [nestedKey, value] of Object.entries(nested)) {
      if (!Object.prototype.hasOwnProperty.call(result, nestedKey)) result[nestedKey] = value;
    }
  }
  return result;
}

export function parseNotificationRoute(input: unknown): NotificationRoute | null {
  const payload = flattenNotificationPayload(input);
  const aps = recordValue(payload.aps);
  const suppliedConversationKey =
    firstString(payload, ["conversation_key", "conversationKey", "thread_id", "threadId"]) ??
    firstString(aps ?? {}, ["thread-id", "thread_id", "threadId"]);
  const keyIdentity = parseConversationKey(suppliedConversationKey);
  const groupIdText = firstString(payload, [
    "group_id",
    "groupId",
    "groupID",
    "chat_group_id",
    "target_group_id",
  ]);
  const groupId = integerValue(groupIdText);
  const agentConversationId = firstString(payload, [
    "agent_conversation_id",
    "agentConversationId",
    "agent_chat_id",
  ]);
  const scriptRoomId = firstString(payload, [
    "script_room_id",
    "scriptRoomId",
    "room_id",
    "roomId",
  ]);
  const explicitSurfaceType = normalizeNotificationConversationType(
    firstString(payload, ["surface_type", "surfaceType", "surface_kind", "surfaceKind"]),
  );
  const rawType = firstString(payload, [
    "conversation_type",
    "conversationType",
    "push_type",
    "pushType",
    "type",
  ])?.toLocaleLowerCase();
  const senderId = firstString(payload, [
    "sender_id",
    "senderId",
    "from_user_id",
    "fromUserId",
    "from_id",
    "peer_id",
    "peer_user_id",
    "contact_id",
  ]);
  const inferredType = agentConversationId
    ? "agent"
    : scriptRoomId
      ? "script"
      : groupIdText !== undefined
        ? "group"
        : normalizeNotificationConversationType(rawType);
  const conversationType: NotificationConversationType =
    explicitSurfaceType ?? keyIdentity?.type ?? inferredType ?? "dm";
  const explicitSurfaceId = firstString(payload, ["surface_id", "surfaceId"]);
  const explicitConversationId = firstString(payload, [
    "conversation_id",
    "conversationId",
    "chat_id",
    "chatId",
  ]);
  const agentId = firstString(payload, ["agent_id", "agentId"]);
  const scriptId = firstString(payload, ["script_id", "scriptId"]);
  const conversationId = firstDefinedString([
    explicitSurfaceId,
    keyIdentity?.id,
    conversationType === "agent" ? agentConversationId : undefined,
    conversationType === "script" ? scriptRoomId : undefined,
    explicitConversationId,
    conversationType === "group" ? groupIdText : undefined,
    conversationType === "agent" ? agentId : undefined,
    senderId,
  ]);
  if (!conversationId) return null;
  const conversationKey = `${conversationType}:${conversationId}`;
  const resolvedGroupId =
    groupId ??
    (conversationType === "group" || conversationType === "script"
      ? integerValue(conversationId)
      : undefined);
  // A bare `id` is frequently a notification, sender or group identity. Only
  // message-specific keys are safe for timeline reconciliation.
  const messageKey = firstString(payload, ["message_id", "messageId", "msg_id", "msgId"]);
  const messageId = firstInteger(payload, ["message_id", "messageId", "msg_id", "msgId"]);
  const messageSequence = firstInteger(payload, [
    "message_sequence",
    "messageSequence",
    "sequence",
  ]);
  const messageVersion =
    messageKey || messageSequence !== undefined
      ? firstInteger(payload, ["message_version", "messageVersion", "version"])
      : undefined;
  const suppliedEventId = firstString(payload, ["event_id", "eventId"]);
  const sentAt = firstString(payload, ["sent_at", "timestamp", "last_message_time"]);
  const eventId =
    suppliedEventId ??
    (messageKey
      ? `${conversationKey}:message:${messageKey}`
      : messageSequence !== undefined
        ? `${conversationKey}:sequence:${messageSequence}`
        : [conversationKey, "", sentAt ?? ""].join(":"));
  const totalUnreadCount =
    firstInteger(payload, ["total_unread", "total_unread_count", "totalUnreadCount", "badge"]) ??
    integerValue(aps?.badge);
  const conversationName = notificationDisplayText(
    firstString(payload, [
      "conversation_name",
      "conversationName",
      "agent_name",
      "agentName",
      "script_name",
      "scriptName",
      "group_name",
      "groupName",
    ]),
  );
  const conversationAvatar = firstString(payload, [
    "conversation_avatar_url",
    "conversation_avatar",
    "conversationAvatarURL",
    "conversationAvatarUrl",
    "agent_avatar_url",
    "agentAvatarUrl",
    "script_avatar_url",
    "scriptAvatarUrl",
    "script_cover_url",
    "cover_url",
    "group_avatar_url",
    "group_avatar",
    "groupAvatarURL",
    "groupAvatarUrl",
    "groupAvatar",
  ]);
  return {
    eventId,
    conversationType,
    conversationId,
    conversationKey,
    ...(messageKey ? { messageKey } : {}),
    ...(messageSequence !== undefined ? { messageSequence } : {}),
    ...(messageVersion !== undefined ? { messageVersion } : {}),
    ...(senderId ? { senderId } : {}),
    ...(resolvedGroupId !== undefined ? { groupId: resolvedGroupId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(conversationType === "script" ? { scriptRoomId: conversationId } : {}),
    ...(scriptId ? { scriptId } : {}),
    ...optionalString(
      "agentAvatarAssetId",
      firstString(payload, ["agent_avatar_asset_id", "agentAvatarAssetId", "avatar_asset_id"]),
    ),
    ...(messageId !== undefined ? { messageId } : {}),
    ...optionalNumber(
      "conversationRevision",
      firstInteger(payload, ["conversation_revision", "conversationRevision", "revision"]),
    ),
    ...optionalNumber(
      "unreadRevision",
      firstInteger(payload, ["unread_revision", "unreadRevision"]),
    ),
    ...optionalNumber(
      "unreadCount",
      firstInteger(payload, [
        "conversation_unread",
        "conversationUnread",
        "unread_count",
        "unreadCount",
        "unread",
      ]),
    ),
    ...optionalNumber("totalUnreadCount", totalUnreadCount),
    ...optionalString(
      "senderName",
      notificationDisplayText(
        firstString(payload, ["sender_name", "senderName", "sender_nickname", "nickname"]),
      ),
    ),
    ...optionalString(
      "senderAvatar",
      firstString(payload, [
        "sender_avatar_url",
        "sender_avatar",
        "senderAvatarURL",
        "senderAvatarUrl",
        "senderAvatar",
        "avatar_url",
        "avatar",
      ]),
    ),
    ...optionalString(
      "groupName",
      notificationDisplayText(firstString(payload, ["group_name", "groupName"])) ??
        (conversationType === "group" || conversationType === "script"
          ? conversationName
          : undefined),
    ),
    ...optionalString(
      "groupAvatar",
      firstString(payload, [
        "group_avatar_url",
        "group_avatar",
        "groupAvatarURL",
        "groupAvatarUrl",
        "groupAvatar",
      ]) ??
        (conversationType === "group" || conversationType === "script"
          ? conversationAvatar
          : undefined),
    ),
    ...optionalString("conversationName", conversationName),
    ...optionalString("conversationAvatar", conversationAvatar),
    ...optionalString(
      "messageType",
      firstString(payload, ["msg_type", "message_type", "last_message_type"]),
    ),
    ...optionalString(
      "contentPreview",
      firstString(payload, ["content_preview", "content", "message", "last_message"]),
    ),
    ...optionalString("sentAt", sentAt),
    isDirectMention:
      firstBoolean(payload, ["is_direct_mention", "isDirectMention", "is_mention"]) ?? false,
    isMentionAll: firstBoolean(payload, ["is_mention_all", "isMentionAll", "mention_all"]) ?? false,
    ...optionalString(
      "notificationMode",
      firstString(payload, ["notification_mode", "notificationMode"])?.toLocaleLowerCase(),
    ),
  };
}

export function presentationPolicyForPush(
  input: unknown,
  context: {
    isConversationActive: (type: NotificationConversationType, id: string) => boolean;
    now?: (() => number) | undefined;
    coalesce?: boolean | undefined;
  },
): PushPresentationPolicy {
  const payload = flattenNotificationPayload(input);
  const type = firstString(payload, [
    "push_type",
    "pushType",
    "event_type",
    "type",
  ])?.toLocaleLowerCase();
  if (type && callPushTypes.has(type)) return behavior(false, true);
  if (type === "moments_update") return behavior(true, true);
  if (type && securityPushTypes.has(type)) return behavior(true, true);
  const route = parseNotificationRoute(payload);
  if (route?.notificationMode === "badge_only") return behavior(false, false);
  if (
    route &&
    notificationRouteIdentities(route).some((identity) => {
      const separator = identity.indexOf(":");
      return context.isConversationActive(
        identity.slice(0, separator) as NotificationConversationType,
        identity.slice(separator + 1),
      );
    })
  )
    return behavior(false, false);
  const policy = behavior(true, true);
  return context.coalesce === false
    ? policy
    : coalesceForegroundPresentation(payload, policy, context.now?.() ?? Date.now());
}

export function pushOpenTarget(input: unknown, fallbackEventId: string): PushOpenTarget | null {
  const payload = flattenNotificationPayload(input);
  const type = firstString(payload, [
    "push_type",
    "pushType",
    "event_type",
    "type",
  ])?.toLocaleLowerCase();
  if (type && callPushTypes.has(type)) return null;
  if (type && securityPushTypes.has(type)) return null;
  if (type === "moments_update") {
    return {
      kind: "moments",
      eventId: firstString(payload, ["event_id", "eventId"]) ?? `moments:${fallbackEventId}`,
    };
  }
  if (type && !isMessagePushType(type)) return null;
  const route = parseNotificationRoute(payload);
  return route ? { kind: "conversation", eventId: route.eventId, route } : null;
}

export async function refreshNativePushToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const token = await Notifications.getDevicePushTokenAsync();
  const value = typeof token.data === "string" ? token.data.trim() : "";
  if (!value) return null;
  return writeCachedNativePushToken(value);
}

export async function cacheNativePushToken(
  token: Notifications.DevicePushToken,
): Promise<string | null> {
  const value = typeof token.data === "string" ? token.data.trim() : "";
  if (!value) return null;
  return writeCachedNativePushToken(value);
}

export async function requestPushPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return requested.granted;
}

export async function ensureNativePushTokenUploaded(
  ownerId: string,
  options: { token?: string | null; signal?: AbortSignal; sessionGeneration?: number } = {},
): Promise<void> {
  const normalizedOwner = ownerId.trim();
  if (!normalizedOwner || options.signal?.aborted) return;
  const refreshed = options.token?.trim() ? null : await refreshNativePushToken().catch(() => null);
  const token = options.token?.trim() || refreshed || (await readCachedNativePushToken());
  if (!token || options.signal?.aborted) return;
  const sessionGeneration =
    options.sessionGeneration ?? uploadSessionGenerations.get(normalizedOwner) ?? 0;
  const sessionKey = `${normalizedOwner}:${sessionGeneration}:${token}`;
  if (uploadedSessions.has(sessionKey)) return;
  const existing = uploadFlights.get(sessionKey);
  if (existing) return existing;
  const flight = uploadTokenWithRetry(token, options.signal)
    .then(() => {
      uploadedSessions.add(sessionKey);
    })
    .finally(() => uploadFlights.delete(sessionKey));
  uploadFlights.set(sessionKey, flight);
  return flight;
}

/** Swift resets `tokenUploaded` after every successful login. */
export function beginNativePushUploadSession(ownerId: string): number {
  const normalizedOwner = ownerId.trim();
  if (!normalizedOwner) return 0;
  const generation = (uploadSessionGenerations.get(normalizedOwner) ?? 0) + 1;
  uploadSessionGenerations.set(normalizedOwner, generation);
  return generation;
}

/**
 * Applies notification receive side effects at most once for a logical event. Both the
 * foreground listener and the background task call this entry point. An in-memory lease prevents
 * concurrent work; the event is persisted only after all effects complete so a process death or
 * failed badge write remains retryable on the next delivery.
 * Returns false when this delivery was already handled.
 */
export async function applyPushSideEffects(input: unknown, ownerId = ""): Promise<boolean> {
  const receiptIdentity = pushReceiveIdentity(input);
  const receiptKey = receiptIdentity
    ? `${ownerId.trim() || "device"}:${receiptIdentity}`
    : undefined;
  if (receiptKey && !(await claimReceivedSideEffect(receiptKey))) return false;
  try {
    if (pushOpenTarget(input, "received")?.kind === "moments") {
      incrementMomentsUnread(ownerId);
    }
    const route = parseNotificationRoute(input);
    const alreadyRead = route
      ? await hydrateAndCheckConversationNotificationRead(ownerId, readRoute(route))
      : false;
    const readPosition = route ? conversationNotificationReadPosition(readRoute(route)) : undefined;
    if (alreadyRead && route) {
      if (readPosition !== undefined) {
        await dismissReadConversationNotifications(
          route.conversationType,
          route.conversationId,
          readPosition,
        );
      }
      await commitUnreadRevisionIfFresh(ownerId, route.unreadRevision);
    } else if (route?.totalUnreadCount !== undefined) {
      await applyBadgeForUnreadRevision(
        ownerId,
        route.unreadRevision,
        Math.max(0, route.totalUnreadCount),
      );
    }
    const normalizedOwner = ownerId.trim();
    if (normalizedOwner) {
      await conversationSyncCoordinator.request(
        normalizedOwner,
        "push_notification",
        route
          ? {
              conversation_type: route.conversationType,
              conversation_id: route.conversationId,
              message_id: route.messageSequence ?? route.messageId,
              message_version: route.messageVersion,
            }
          : undefined,
      );
    }
    if (receiptKey) await completeReceivedSideEffect(receiptKey);
    return true;
  } catch (error) {
    if (receiptKey) await releaseReceivedSideEffect(receiptKey);
    throw error;
  }
}

export function foregroundChatPushWasRead(input: unknown, ownerId: string): boolean {
  const route = parseNotificationRoute(input);
  return route ? conversationNotificationRouteIsRead(ownerId, readRoute(route)) : false;
}

/** Removes delivered notifications covered by a locally visible or server-confirmed read. */
export async function dismissReadConversationNotifications(
  conversationType: NotificationConversationType,
  conversationId: string,
  throughMessageId: number,
): Promise<number> {
  const normalizedId = conversationId.trim();
  if (!normalizedId || !Number.isInteger(throughMessageId) || throughMessageId < 0) return 0;
  return dismissNotificationsCoveredByConversationReads([
    { conversationId: normalizedId, conversationType, throughMessageId },
  ]);
}

/** Cancels delivered/presenting notifications as soon as their conversation gains focus. */
export async function dismissActiveConversationNotifications(
  conversationType: NotificationConversationType,
  conversationId: string,
): Promise<number> {
  const normalizedId = conversationId.trim();
  if (!normalizedId) return 0;
  const activeIdentity = `${conversationType}:${normalizedId}`;
  return dismissPresentedNotifications("active_chat_notification_cleanup", (notification) => {
    const route = parseNotificationRoute(notification.request.content.data);
    return Boolean(route && notificationRouteIdentities(route).includes(activeIdentity));
  });
}

export async function dismissCachedReadConversationNotifications(ownerId: string): Promise<number> {
  const owner = ownerId.trim();
  if (!owner) return 0;
  try {
    const snapshot = await loadCachedConversationSnapshot(owner);
    const watermarks = (snapshot?.conversations ?? []).flatMap((conversation) => {
      if (conversation.unread_count !== 0) return [];
      const identity = conversationListIdentity(conversation);
      const separator = identity.indexOf(":");
      const type = identity.slice(0, separator);
      const conversationId = identity.slice(separator + 1);
      if ((type !== "dm" && type !== "group") || !conversationId) return [];
      const throughMessageId =
        conversation.read_through_message_id ?? conversation.last_message_id ?? 0;
      return throughMessageId > 0
        ? [
            {
              conversationId,
              conversationType: type,
              throughMessageId,
            } satisfies ConversationReadWatermark,
          ]
        : [];
    });
    return dismissNotificationsCoveredByConversationReads(watermarks);
  } catch (error) {
    captureException(error, { operation: "cached_read_notification_cleanup" });
    return 0;
  }
}

/** Moments read is an all-at-once server contract, so all delivered Moments pushes are covered. */
export async function dismissReadMomentsNotifications(): Promise<number> {
  return dismissPresentedNotifications(
    "moments_read_notification_cleanup",
    (notification) =>
      pushOpenTarget(notification.request.content.data, notification.request.identifier)?.kind ===
      "moments",
  );
}

export async function savePendingPushOpen(target: PushOpenTarget): Promise<void> {
  await mutatePendingOpenQueue((current) => {
    const deduplicated = current.filter((item) => item.eventId !== target.eventId);
    return [...deduplicated, target].slice(-maximumPendingOpenCount);
  });
}

export async function takePendingPushOpen(): Promise<PushOpenTarget | null> {
  const target = await claimPendingPushOpen();
  if (target) await acknowledgePendingPushOpen(target.eventId);
  return target;
}

export async function claimPendingPushOpen(): Promise<PushOpenTarget | null> {
  await pendingOpenMutationChain;
  const queue = await readPendingOpenQueue();
  const target = queue.find((item) => !claimedPushEventIds.has(item.eventId)) ?? null;
  if (target) claimedPushEventIds.add(target.eventId);
  return target;
}

export async function acknowledgePendingPushOpen(eventId: string): Promise<void> {
  const normalized = eventId.trim();
  if (!normalized) return;
  try {
    await mutatePendingOpenQueue((current) =>
      current.filter((target) => target.eventId !== normalized),
    );
  } finally {
    claimedPushEventIds.delete(normalized);
  }
}

export function releasePendingPushOpen(eventId: string): void {
  claimedPushEventIds.delete(eventId.trim());
}

export async function wasPushEventProcessed(eventId: string): Promise<boolean> {
  return (await processedEventIds()).has(eventId);
}

export async function markPushEventProcessed(eventId: string): Promise<void> {
  const ids = await processedEventIds();
  ids.delete(eventId);
  ids.add(eventId);
  while (ids.size > 256) ids.delete(ids.values().next().value as string);
  await AsyncStorage.setItem(processedEventIdsKey, JSON.stringify([...ids]));
}

export function resetPushServiceForTests(): void {
  initialized = false;
  processedEventIdsPromise = null;
  receivedSideEffectIdsPromise = null;
  unreadRevisionsPromise = null;
  uploadedSessions.clear();
  uploadFlights.clear();
  uploadSessionGenerations.clear();
  activePushOwnerId = "";
  pendingOpenMutationChain = Promise.resolve();
  receivedSideEffectMutationChain = Promise.resolve();
  unreadRevisionMutationChain = Promise.resolve();
  claimedPushEventIds.clear();
  claimedReceivedSideEffectIds.clear();
  lastForegroundPresentationByConversation.clear();
  resetConversationNotificationReadStateForTests();
}

async function readPendingOpenQueue(): Promise<PushOpenTarget[]> {
  const [encodedQueue, legacyEncoded] = await AsyncStorage.multiGet([
    pendingOpenQueueKey,
    legacyPendingOpenKey,
  ]);
  const queue = parsePendingOpenQueue(encodedQueue?.[1] ?? null);
  const legacy = parsePendingOpenQueue(legacyEncoded?.[1] ?? null);
  return [...legacy, ...queue]
    .filter(
      (target, index, values) =>
        values.findIndex((candidate) => candidate.eventId === target.eventId) === index,
    )
    .slice(-maximumPendingOpenCount);
}

function mutatePendingOpenQueue(
  mutation: (current: PushOpenTarget[]) => PushOpenTarget[],
): Promise<void> {
  const task = pendingOpenMutationChain.then(async () => {
    const next = mutation(await readPendingOpenQueue()).slice(-maximumPendingOpenCount);
    await AsyncStorage.multiSet([[pendingOpenQueueKey, JSON.stringify(next)]]);
    await AsyncStorage.removeItem(legacyPendingOpenKey);
  });
  pendingOpenMutationChain = task.catch(() => undefined);
  return task;
}

function parsePendingOpenQueue(encoded: string | null): PushOpenTarget[] {
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(encoded) as unknown;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.filter(validOpenTarget);
  } catch {
    return [];
  }
}

async function dismissPresentedNotifications(
  operation: string,
  shouldDismiss: (notification: Notifications.Notification) => boolean,
): Promise<number> {
  if (Platform.OS === "web") return 0;
  let presented: Notifications.Notification[];
  try {
    presented = await Notifications.getPresentedNotificationsAsync();
  } catch (error) {
    captureException(error, { operation: `${operation}_list` });
    return 0;
  }
  const identifiers = presented
    .filter(shouldDismiss)
    .map((notification) => notification.request.identifier)
    .filter((identifier) => identifier.trim().length > 0);
  const dismissed = await Promise.all(
    identifiers.map(async (identifier) => {
      try {
        await Notifications.dismissNotificationAsync(identifier);
        return true;
      } catch (error) {
        captureException(error, { notification_id: identifier, operation });
        return false;
      }
    }),
  );
  return dismissed.filter(Boolean).length;
}

interface ConversationReadWatermark {
  conversationType: NotificationConversationType;
  conversationId: string;
  throughMessageId: number;
}

async function dismissNotificationsCoveredByConversationReads(
  watermarks: readonly ConversationReadWatermark[],
): Promise<number> {
  const maximumReadThrough = new Map<string, number>();
  for (const watermark of watermarks) {
    const key = `${watermark.conversationType}:${watermark.conversationId}`;
    maximumReadThrough.set(
      key,
      Math.max(maximumReadThrough.get(key) ?? 0, watermark.throughMessageId),
    );
  }
  if (maximumReadThrough.size === 0) return 0;
  return dismissPresentedNotifications("chat_read_notification_cleanup", (notification) => {
    const route = parseNotificationRoute(notification.request.content.data);
    const routePosition = route
      ? conversationNotificationReadPosition(readRoute(route))
      : undefined;
    if (!route || routePosition === undefined) return false;
    const throughMessageId = Math.max(
      ...notificationRouteIdentities(route).map(
        (identity) => maximumReadThrough.get(identity) ?? Number.NEGATIVE_INFINITY,
      ),
    );
    return throughMessageId !== undefined && routePosition <= throughMessageId;
  });
}

async function uploadTokenWithRetry(token: string, signal?: AbortSignal): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    if (signal?.aborted) return;
    try {
      await apiRequest<unknown>("/push/device-token", {
        method: "POST",
        body: { device_token: token },
        requiredEnvelope: true,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= 3) break;
      await abortableDelay(2 ** (attempt + 1) * 1_000, signal);
    }
  }
  throw lastError;
}

async function processedEventIds(): Promise<Set<string>> {
  processedEventIdsPromise ??= AsyncStorage.getItem(processedEventIdsKey).then((encoded) => {
    if (!encoded) return new Set<string>();
    try {
      const parsed = JSON.parse(encoded) as unknown;
      return new Set(
        Array.isArray(parsed)
          ? parsed.filter((value): value is string => typeof value === "string").slice(-256)
          : [],
      );
    } catch {
      return new Set<string>();
    }
  });
  return processedEventIdsPromise;
}

function pushReceiveIdentity(input: unknown): string | null {
  const payload = flattenNotificationPayload(input);
  const suppliedEventId = firstString(payload, ["event_id", "eventId"]);
  if (suppliedEventId) return `event:${suppliedEventId}`;
  const route = parseNotificationRoute(payload);
  if (route?.messageKey) return `message:${route.conversationKey}:${route.messageKey}`;
  if (route?.messageSequence !== undefined) {
    return `sequence:${route.conversationKey}:${route.messageSequence}`;
  }
  return null;
}

async function claimReceivedSideEffect(key: string): Promise<boolean> {
  const task = receivedSideEffectMutationChain.then(async () => {
    if (claimedReceivedSideEffectIds.has(key)) return false;
    const ids = await receivedSideEffectIds();
    if (ids.has(key)) return false;
    claimedReceivedSideEffectIds.add(key);
    return true;
  });
  receivedSideEffectMutationChain = task.catch(() => undefined);
  return task;
}

async function completeReceivedSideEffect(key: string): Promise<void> {
  const task = receivedSideEffectMutationChain.then(async () => {
    const ids = await receivedSideEffectIds();
    const next = new Set(ids);
    next.delete(key);
    next.add(key);
    while (next.size > 512) next.delete(next.values().next().value as string);
    await AsyncStorage.setItem(receivedSideEffectIdsKey, JSON.stringify([...next]));
    ids.clear();
    for (const id of next) ids.add(id);
    claimedReceivedSideEffectIds.delete(key);
  });
  receivedSideEffectMutationChain = task.catch(() => undefined);
  return task;
}

async function releaseReceivedSideEffect(key: string): Promise<void> {
  const task = receivedSideEffectMutationChain.then(async () => {
    claimedReceivedSideEffectIds.delete(key);
  });
  receivedSideEffectMutationChain = task.catch(() => undefined);
  return task;
}

async function receivedSideEffectIds(): Promise<Set<string>> {
  receivedSideEffectIdsPromise ??= AsyncStorage.getItem(receivedSideEffectIdsKey).then(
    (encoded) => {
      if (!encoded) return new Set<string>();
      try {
        const parsed = JSON.parse(encoded) as unknown;
        return new Set(
          Array.isArray(parsed)
            ? parsed.filter((value): value is string => typeof value === "string").slice(-512)
            : [],
        );
      } catch {
        return new Set<string>();
      }
    },
  );
  return receivedSideEffectIdsPromise;
}

async function commitUnreadRevisionIfFresh(
  ownerId: string,
  revision: number | undefined,
): Promise<boolean> {
  return mutateUnreadRevision(ownerId, revision);
}

async function applyBadgeForUnreadRevision(
  ownerId: string,
  revision: number | undefined,
  totalUnread: number,
): Promise<boolean> {
  return mutateUnreadRevision(ownerId, revision, async () =>
    Notifications.setBadgeCountAsync(totalUnread),
  );
}

async function mutateUnreadRevision(
  ownerId: string,
  revision: number | undefined,
  effect?: (() => Promise<boolean>) | undefined,
): Promise<boolean> {
  const owner = ownerId.trim() || "device";
  const task = unreadRevisionMutationChain.then(async () => {
    const revisions = await unreadRevisions();
    const previous = revisions.get(owner);
    // Unversioned deliveries can never safely mutate the absolute badge because their ordering
    // is unknowable. The requested conversation refresh supplies the authoritative local total.
    if (revision === undefined) return false;
    if (previous !== undefined && revision <= previous) return false;
    if (effect && !(await effect().catch(() => false))) return false;
    const next = new Map(revisions);
    next.set(owner, revision);
    await AsyncStorage.setItem(unreadRevisionsKey, JSON.stringify(Object.fromEntries(next)));
    revisions.clear();
    for (const [key, value] of next) revisions.set(key, value);
    return true;
  });
  unreadRevisionMutationChain = task.catch(() => undefined);
  return task;
}

async function unreadRevisions(): Promise<Map<string, number>> {
  unreadRevisionsPromise ??= AsyncStorage.getItem(unreadRevisionsKey).then((encoded) => {
    if (!encoded) return new Map<string, number>();
    try {
      const parsed = recordValue(JSON.parse(encoded) as unknown);
      return new Map(
        Object.entries(parsed ?? {}).flatMap(([owner, value]) => {
          const revision = integerValue(value);
          return revision !== undefined && revision >= 0 ? [[owner, revision] as const] : [];
        }),
      );
    } catch {
      return new Map<string, number>();
    }
  });
  return unreadRevisionsPromise;
}

export function notificationRouteIdentities(route: NotificationRoute): string[] {
  const identities = [
    route.conversationKey,
    `${route.conversationType}:${route.conversationId}`,
    ...conversationNotificationRouteIdentities(readRoute(route)),
  ];
  if (route.conversationType === "script" && route.groupId !== undefined) {
    identities.push(`group:${route.groupId}`);
  }
  return identities.filter(
    (identity, index, values) =>
      Boolean(identity.split(":").slice(1).join(":")) && values.indexOf(identity) === index,
  );
}

function readRoute(route: NotificationRoute) {
  return {
    conversationType: route.conversationType,
    conversationId: route.conversationId,
    ...(route.senderId ? { senderId: route.senderId } : {}),
    ...(route.groupId !== undefined ? { groupId: route.groupId } : {}),
    ...(route.conversationType === "agent" ? { agentConversationId: route.conversationId } : {}),
    ...(route.scriptRoomId ? { scriptRoomId: route.scriptRoomId } : {}),
    ...(route.messageId !== undefined ? { messageId: route.messageId } : {}),
    ...(route.messageSequence !== undefined ? { messageSequence: route.messageSequence } : {}),
    ...(route.unreadCount !== undefined ? { unreadCount: route.unreadCount } : {}),
  };
}

function behavior(show: boolean, sound: boolean): PushPresentationPolicy {
  return {
    shouldShowBanner: show,
    shouldShowList: show,
    shouldPlaySound: sound,
    shouldSetBadge: false,
  };
}

/**
 * Preview is the deployment environment, not part of a sender or group name.
 * Keep the cleanup deliberately suffix-only so legitimate text such as
 * "Preview Club" or a message body containing "preview" remains untouched.
 */
export function notificationDisplayText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  const cleaned = normalized
    .replace(/(?:\s+|[-–—·|｜]\s*|\(\s*|（\s*|\[\s*|【\s*)preview\s*(?:\)|）|\]|】)?$/iu, "")
    .trim();
  return cleaned || normalized;
}

function validOpenTarget(value: unknown): value is PushOpenTarget {
  const record = recordValue(value);
  if (!record || typeof record.eventId !== "string") return false;
  if (record.kind === "moments") return true;
  return record.kind === "conversation" && recordValue(record.route) !== null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return recordValue(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(values: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(values[key]);
    if (value) return value;
  }
  return undefined;
}

function firstInteger(
  values: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = integerValue(values[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstBoolean(
  values: Record<string, unknown>,
  keys: readonly string[],
): boolean | undefined {
  for (const key of keys) {
    const value = booleanValue(values[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function integerValue(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) ? Math.trunc(number) : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return undefined;
  const token = value.trim().toLocaleLowerCase();
  if (["true", "1", "yes"].includes(token)) return true;
  if (["false", "0", "no"].includes(token)) return false;
  return undefined;
}

function normalizeNotificationConversationType(
  value: string | undefined,
): NotificationConversationType | undefined {
  const token = value?.trim().toLocaleLowerCase().replaceAll("-", "_");
  if (!token) return undefined;
  if (agentPushTypes.has(token) || ["ai", "assistant"].includes(token)) return "agent";
  if (scriptPushTypes.has(token) || ["roleplay", "script_room_chat"].includes(token)) {
    return "script";
  }
  if (groupPushTypes.has(token) || ["group_dm", "group_conversation"].includes(token)) {
    return "group";
  }
  if (directPushTypes.has(token) || ["direct", "private", "private_chat"].includes(token)) {
    return "dm";
  }
  return undefined;
}

function parseConversationKey(
  value: string | undefined,
): { type: NotificationConversationType; id: string } | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const type = normalizeNotificationConversationType(value.slice(0, separator));
  const id = value.slice(separator + 1).trim();
  return type && id ? { type, id } : null;
}

function firstDefinedString(values: readonly (string | undefined)[]): string | undefined {
  return values.find((value): value is string => Boolean(value?.trim()))?.trim();
}

function isMessagePushType(type: string): boolean {
  return (
    directPushTypes.has(type) ||
    groupPushTypes.has(type) ||
    agentPushTypes.has(type) ||
    scriptPushTypes.has(type)
  );
}

function coalesceForegroundPresentation(
  input: unknown,
  policy: PushPresentationPolicy,
  now = Date.now(),
): PushPresentationPolicy {
  if (!policy.shouldShowBanner) return policy;
  const payload = flattenNotificationPayload(input);
  const type = firstString(payload, ["push_type", "pushType", "event_type", "type"])
    ?.trim()
    .toLocaleLowerCase();
  if (
    type === "moments_update" ||
    (type && (callPushTypes.has(type) || securityPushTypes.has(type)))
  ) {
    return policy;
  }
  const route = parseNotificationRoute(payload);
  if (!route) return policy;
  if (
    (route.conversationType === "group" || route.conversationType === "script") &&
    (route.isDirectMention || route.isMentionAll)
  ) {
    return policy;
  }
  return shouldThrottleForegroundPresentation(route.conversationKey, now)
    ? behavior(false, false)
    : policy;
}

function shouldThrottleForegroundPresentation(conversationKey: string, now: number): boolean {
  const previous = lastForegroundPresentationByConversation.get(conversationKey);
  if (
    previous !== undefined &&
    now >= previous &&
    now - previous < foregroundPresentationWindowMilliseconds
  ) {
    return true;
  }
  lastForegroundPresentationByConversation.delete(conversationKey);
  lastForegroundPresentationByConversation.set(conversationKey, now);
  while (lastForegroundPresentationByConversation.size > 256) {
    lastForegroundPresentationByConversation.delete(
      lastForegroundPresentationByConversation.keys().next().value as string,
    );
  }
  return false;
}

function optionalString<Key extends string>(
  key: Key,
  value: string | undefined,
): { [P in Key]?: string } {
  return value === undefined ? {} : ({ [key]: value } as { [P in Key]?: string });
}

function optionalNumber<Key extends string>(
  key: Key,
  value: number | undefined,
): { [P in Key]?: number } {
  return value === undefined ? {} : ({ [key]: value } as { [P in Key]?: number });
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
