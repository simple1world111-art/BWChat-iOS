import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { apiRequest } from "@/api/client";
import { captureException } from "@/services/monitoring/MonitoringService";
import { incrementMomentsUnread } from "@/services/moments/MomentsUnreadStore";
import {
  readCachedNativePushToken,
  writeCachedNativePushToken,
} from "@/services/push/PushTokenStore";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";

export { readCachedNativePushToken } from "@/services/push/PushTokenStore";

export type NotificationConversationType = "dm" | "group";

export interface NotificationRoute {
  eventId: string;
  conversationType: NotificationConversationType;
  conversationId: string;
  senderId?: string | undefined;
  groupId?: number | undefined;
  messageId?: number | undefined;
  conversationRevision?: number | undefined;
  unreadCount?: number | undefined;
  totalUnreadCount?: number | undefined;
  senderName?: string | undefined;
  senderAvatar?: string | undefined;
  groupName?: string | undefined;
  groupAvatar?: string | undefined;
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

const pendingOpenKey = "bwchat.push.pending-open.v1";
const processedEventIdsKey = "bwchat.push.processed-event-ids.v1";
const groupPushTypes = new Set([
  "group",
  "group_message",
  "new_group_message",
  "group_chat",
  "groupchat",
]);
const callPushTypes = new Set(["call", "call_invite", "group_call", "group_call_invite"]);
const uploadFlights = new Map<string, Promise<void>>();
const uploadedSessions = new Set<string>();
const uploadSessionGenerations = new Map<string, number>();
let initialized = false;
let processedEventIdsPromise: Promise<Set<string>> | null = null;

export function initializePushNotifications(): void {
  if (initialized) return;
  initialized = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) =>
      presentationPolicyForPush(notification.request.content.data, {
        isConversationActive: (type, id) => chatRealtimeService.isConversationActive(type, id),
      }),
    handleError: (_notificationId, error) =>
      captureException(error, { operation: "push_foreground_handler" }),
  });
  if (Platform.OS === "android") {
    void Notifications.setNotificationChannelAsync("default", {
      importance: Notifications.AndroidImportance.MAX,
      name: "消息",
      sound: "default",
    }).catch((error) => captureException(error, { operation: "push_android_channel" }));
  }
  void refreshNativePushToken().catch(() => undefined);
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
  const groupId = firstInteger(payload, ["group_id", "groupId"]);
  const rawType = firstString(payload, [
    "conversation_type",
    "conversationType",
    "push_type",
    "pushType",
    "type",
  ])?.toLocaleLowerCase();
  const conversationType: NotificationConversationType =
    groupId !== undefined || (rawType ? groupPushTypes.has(rawType) : false) ? "group" : "dm";
  const senderId = firstString(payload, ["sender_id", "senderId", "from_user_id", "user_id"]);
  const explicitConversationId = firstString(payload, ["conversation_id", "conversationId"]);
  const conversationId =
    conversationType === "group"
      ? (explicitConversationId ?? (groupId !== undefined ? String(groupId) : undefined))
      : (explicitConversationId ?? senderId);
  if (!conversationId) return null;
  const messageId = firstInteger(payload, ["message_id", "messageId", "msg_id", "id"]);
  const suppliedEventId = firstString(payload, ["event_id", "eventId"]);
  const sentAt = firstString(payload, ["sent_at", "timestamp", "last_message_time"]);
  const eventId =
    messageId !== undefined
      ? `${conversationType}:${conversationId}:message:${messageId}`
      : (suppliedEventId ?? [conversationType, conversationId, "", sentAt ?? ""].join(":"));
  const aps = recordValue(payload.aps);
  const totalUnreadCount =
    firstInteger(payload, ["total_unread_count", "totalUnreadCount", "badge"]) ??
    integerValue(aps?.badge);
  return {
    eventId,
    conversationType,
    conversationId,
    ...(senderId ? { senderId } : {}),
    ...(groupId !== undefined || conversationType === "group"
      ? { groupId: groupId ?? (Number(conversationId) || 0) }
      : {}),
    ...(messageId !== undefined ? { messageId } : {}),
    ...optionalNumber(
      "conversationRevision",
      firstInteger(payload, ["conversation_revision", "conversationRevision", "revision"]),
    ),
    ...optionalNumber(
      "unreadCount",
      firstInteger(payload, ["unread_count", "unreadCount", "unread"]),
    ),
    ...optionalNumber("totalUnreadCount", totalUnreadCount),
    ...optionalString(
      "senderName",
      firstString(payload, ["sender_name", "senderName", "sender_nickname", "nickname"]),
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
      firstString(payload, ["group_name", "groupName", "conversation_name"]),
    ),
    ...optionalString(
      "groupAvatar",
      firstString(payload, [
        "group_avatar_url",
        "group_avatar",
        "groupAvatarURL",
        "groupAvatarUrl",
        "groupAvatar",
      ]),
    ),
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
  context: { isConversationActive: (type: NotificationConversationType, id: string) => boolean },
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
  const route = parseNotificationRoute(payload);
  if (route?.notificationMode === "badge_only") return behavior(false, false);
  if (route && context.isConversationActive(route.conversationType, route.conversationId))
    return behavior(false, false);
  return behavior(true, true);
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
  if (type === "moments_update") {
    return {
      kind: "moments",
      eventId: firstString(payload, ["event_id", "eventId"]) ?? `moments:${fallbackEventId}`,
    };
  }
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

export async function applyPushSideEffects(input: unknown, ownerId = ""): Promise<void> {
  if (pushOpenTarget(input, "received")?.kind === "moments") {
    incrementMomentsUnread(ownerId);
  }
  const route = parseNotificationRoute(input);
  if (route?.totalUnreadCount !== undefined) {
    await Notifications.setBadgeCountAsync(Math.max(0, route.totalUnreadCount)).catch(() => false);
  }
  chatRealtimeService.requestConversationRefresh("push_notification");
}

/** Removes only delivered notifications covered by a successful chat read receipt. */
export async function dismissReadConversationNotifications(
  conversationType: NotificationConversationType,
  conversationId: string,
  throughMessageId: number,
): Promise<number> {
  const normalizedId = conversationId.trim();
  if (!normalizedId || !Number.isInteger(throughMessageId) || throughMessageId < 0) return 0;
  return dismissPresentedNotifications("chat_read_notification_cleanup", (notification) => {
    const route = parseNotificationRoute(notification.request.content.data);
    if (
      !route ||
      route.conversationType !== conversationType ||
      route.conversationId !== normalizedId
    ) {
      return false;
    }
    return route.messageId !== undefined && route.messageId <= throughMessageId;
  });
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
  await AsyncStorage.setItem(pendingOpenKey, JSON.stringify(target));
}

export async function takePendingPushOpen(): Promise<PushOpenTarget | null> {
  const encoded = await AsyncStorage.getItem(pendingOpenKey);
  if (!encoded) return null;
  await AsyncStorage.removeItem(pendingOpenKey);
  try {
    const parsed = JSON.parse(encoded) as unknown;
    return validOpenTarget(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
  uploadedSessions.clear();
  uploadFlights.clear();
  uploadSessionGenerations.clear();
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

function behavior(show: boolean, sound: boolean): PushPresentationPolicy {
  return {
    shouldShowBanner: show,
    shouldShowList: show,
    shouldPlaySound: sound,
    shouldSetBadge: false,
  };
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
