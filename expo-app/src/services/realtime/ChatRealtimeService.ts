import type {
  ConversationPreference,
  ConversationReadReceipt,
  GroupAnnouncement,
  GroupHistoryClearReceipt,
  GroupMemberUpdateEvent,
  GroupMessage,
  GroupNotificationSettings,
  GroupViewerSettings,
  Message,
  ScriptTurnState,
} from "@/models";
import {
  flexInt,
  flexString,
  isRecord,
  normalizeConversationPreference,
  normalizeConversationReadReceipt,
  normalizeGroupHistoryClearReceipt,
  normalizeGroupMessage,
  normalizeGroupViewerSettings,
  normalizeMessage,
  normalizeScriptTurnState,
} from "@/api/normalizers";
import { verifySession } from "@/api/bwchat";
import { env } from "@/config/env";
import { applyConversationReadReceipt } from "@/services/conversations/ConversationRepository";
import { recordConversationNotificationRead } from "@/services/conversations/ConversationNotificationReadState";
import { applyGroupHistoryClear } from "@/services/messages/GroupHistoryClearRepository";
import {
  applyGroupAnnouncementUpdate,
  applyGroupNotificationSettingsUpdate,
  applyGroupViewerSettingsUpdate,
} from "@/services/groups/GroupDetailRepository";
import {
  normalizeGroupAnnouncement,
  normalizeGroupMemberUpdateEvent,
  normalizeGroupNotificationSettings,
} from "@/services/groups/GroupInfoV2Repository";
import { saveDirectChatMessages } from "@/services/messages/DirectChatHistoryRepository";
import { saveGroupChatMessages } from "@/services/messages/GroupChatHistoryRepository";
import { readAccessToken } from "@/storage/tokenStorage";

export type ChatRealtimeEvent =
  | { type: "direct_message"; message: Message }
  | { type: "direct_message_hint"; sender_id: string; receiver_id: string; message_id: number }
  | { type: "group_message"; message: GroupMessage }
  | { type: "group_message_hint"; group_id: number; message_id: number }
  | { type: "conversation_read"; receipt: ConversationReadReceipt }
  | { type: "group_history_cleared"; receipt: GroupHistoryClearReceipt }
  | { type: "conversation_preference"; preference: ConversationPreference }
  | { type: "group_notification_settings_updated"; settings: GroupNotificationSettings }
  | { type: "group_viewer_settings_updated"; settings: GroupViewerSettings }
  | { type: "group_announcement_updated"; announcement: GroupAnnouncement }
  | { type: "group_member_updated"; update: GroupMemberUpdateEvent }
  | { type: "group_removed"; group_id: number }
  | { type: "group_renamed"; group_id: number; name: string }
  | { type: "refresh_conversations"; reason: string }
  | { type: "script_turn_state"; state: ScriptTurnState }
  | { type: "call_signal"; signal_type: string; data: Record<string, unknown> }
  | { type: "live_signal"; signal_type: string; data: Record<string, unknown> };

export type ChatRealtimeStatus = "disconnected" | "connecting" | "connected";

type EventListener = (event: ChatRealtimeEvent) => void;
type StatusListener = (status: ChatRealtimeStatus) => void;

const callSignalTypes = new Set([
  "call_invite",
  "call_offer",
  "call_answer",
  "ice_candidate",
  "call_end",
  "call_reject",
  "call_busy",
  "group_call_invite",
  "group_call_ended",
]);

const liveSignalTypes = new Set([
  "one_to_one_live.call_invite",
  "one_to_one_live.call.invite",
  "one_to_one_live_call_invite",
  "live_call_invite",
  "one_to_one_live.call_accepted",
  "one_to_one_live.call_rejected",
  "one_to_one_live.call_cancelled",
  "one_to_one_live.call_expired",
  "one_to_one_live.match_exhausted",
  "one_to_one_live.match_cancelled",
  "one_to_one_live.billing_updated",
  "one_to_one_live.earning_updated",
  "one_to_one_live.experience_reserved",
  "one_to_one_live.experience_started",
  "one_to_one_live.experience_consumed",
  "one_to_one_live.experience_released",
  "one_to_one_live.experience_completed",
  "one_to_one_live.overage_started",
  "one_to_one_live.billing_insufficient",
  "one_to_one_live.slot.created",
  "one_to_one_live.slot.updated",
  "one_to_one_live.slot.ended",
]);

export function makeChatWebSocketURL(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.searchParams.delete("token");
  url.searchParams.append("token", token.trim());
  return url.toString();
}

export function chatRealtimeReconnectDelay(attempt: number): number {
  return Math.min(2 ** Math.max(0, Math.floor(attempt)), 30) * 1_000;
}

export function parseChatRealtimeEnvelope(value: unknown): ChatRealtimeEvent[] {
  const envelope = parseEnvelope(value);
  if (!envelope) return [];
  const rawType = flexString(envelope.type);
  if (!rawType) return [];
  const type = normalizeEventType(rawType);
  const payload = isRecord(envelope.data) ? envelope.data : envelope;
  try {
    switch (type) {
      case "new_message":
      case "message_updated":
        return [{ type: "direct_message", message: normalizeMessage(messagePayload(payload)) }];
      case "new_group_message":
      case "group_message_updated":
        return [{ type: "group_message", message: normalizeGroupMessage(messagePayload(payload)) }];
      case "conversation_read_state": {
        const receipt = normalizeConversationReadReceipt(payload);
        return receipt.conversation_id ? [{ type: "conversation_read", receipt }] : [];
      }
      case "group_history_cleared": {
        const groupId = flexInt(payload.group_id, payload.groupId, payload.groupID) ?? 0;
        return groupId > 0
          ? [
              {
                type: "group_history_cleared",
                receipt: normalizeGroupHistoryClearReceipt(payload, groupId),
              },
            ]
          : [];
      }
      case "conversation_preferences_updated":
        return [
          { type: "conversation_preference", preference: normalizeConversationPreference(payload) },
        ];
      case "group_notification_settings_updated": {
        const settings = normalizeGroupNotificationSettings(payload);
        return settings.group_id > 0
          ? [{ type: "group_notification_settings_updated", settings }]
          : [];
      }
      case "group_viewer_settings_updated": {
        const settings = normalizeGroupViewerSettings(payload);
        return settings.group_id > 0 ? [{ type: "group_viewer_settings_updated", settings }] : [];
      }
      case "group_announcement_updated": {
        const announcement = normalizeGroupAnnouncement(payload);
        return announcement.group_id > 0
          ? [{ type: "group_announcement_updated", announcement }]
          : [];
      }
      case "group_member_updated":
      case "group_member_profile_updated": {
        const update = normalizeGroupMemberUpdateEvent(payload);
        return update.group_id > 0 && update.member.user_id
          ? [{ type: "group_member_updated", update }]
          : [];
      }
      case "group_removed": {
        const groupId = flexInt(payload.group_id, payload.groupId, payload.groupID) ?? 0;
        return groupId > 0 ? [{ type: "group_removed", group_id: groupId }] : [];
      }
      case "group_renamed": {
        const groupId = flexInt(payload.group_id, payload.groupID) ?? 0;
        const name = flexString(payload.name);
        return groupId > 0 && name ? [{ type: "group_renamed", group_id: groupId, name }] : [];
      }
      case "chat_money_updated":
        return chatMoneyMessageEvents(payload);
      case "contact_update": {
        const events: ChatRealtimeEvent[] = [{ type: "refresh_conversations", reason: type }];
        const senderId =
          flexString(
            payload.sender_id,
            payload.senderId,
            payload.from_user_id,
            payload.fromUserId,
          ) ?? "";
        const receiverId =
          flexString(
            payload.receiver_id,
            payload.receiverId,
            payload.recipient_id,
            payload.recipientId,
            payload.to_user_id,
            payload.toUserId,
          ) ?? "";
        const messageId =
          flexInt(
            payload.message_id,
            payload.messageId,
            payload.last_message_id,
            payload.lastMessageId,
            payload.lastMessageID,
          ) ?? 0;
        if (senderId && receiverId && messageId > 0) {
          events.push({
            type: "direct_message_hint",
            sender_id: senderId,
            receiver_id: receiverId,
            message_id: messageId,
          });
        }
        return events;
      }
      case "script_turn_state": {
        if (envelope.type !== "script_turn_state") return [];
        if (!isRecord(envelope.data)) return [];
        const state = normalizeScriptTurnState(envelope.data);
        return state.room_id ? [{ type: "script_turn_state", state }] : [];
      }
      case "group_contact_update": {
        const events: ChatRealtimeEvent[] = [{ type: "refresh_conversations", reason: type }];
        const groupId = flexInt(payload.group_id, payload.groupId, payload.groupID) ?? 0;
        const messageId =
          flexInt(
            payload.message_id,
            payload.messageId,
            payload.last_message_id,
            payload.lastMessageId,
            payload.lastMessageID,
          ) ?? 0;
        if (groupId > 0 && messageId > 0) {
          events.push({ type: "group_message_hint", group_id: groupId, message_id: messageId });
        }
        return events;
      }
      case "group_created":
      case "friend_request":
      case "friend_accepted":
      case "chat_reset":
        return [{ type: "refresh_conversations", reason: type }];
      case "ping":
      case "pong":
        return [];
      default:
        if (liveSignalTypes.has(type) || (type === "call_invite" && isLegacyLiveInvite(payload))) {
          return [{ type: "live_signal", signal_type: type, data: payload }];
        }
        return callSignalTypes.has(type)
          ? [{ type: "call_signal", signal_type: type, data: payload }]
          : [];
    }
  } catch {
    return [];
  }
}

class ChatRealtimeService {
  private socket: WebSocket | null = null;
  private ownerId: string | null = null;
  private manuallyStopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private refreshAttempted = false;
  private status: ChatRealtimeStatus = "disconnected";
  private activeDirectId: string | null = null;
  private activeGroupId: number | null = null;
  private incomingEventDispatch: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();

  start(ownerId: string): void {
    const normalized = ownerId.trim();
    if (!normalized) return;
    if (this.ownerId === normalized && (this.socket || this.reconnectTimer)) return;
    this.teardownSocket();
    this.ownerId = normalized;
    this.manuallyStopped = false;
    this.reconnectAttempt = 0;
    this.refreshAttempted = false;
    void this.connect();
  }

  stop(): void {
    this.manuallyStopped = true;
    this.ownerId = null;
    this.teardownSocket(1000, "logout");
    this.setStatus("disconnected");
  }

  reconnectNow(): void {
    if (this.manuallyStopped || !this.ownerId) return;
    this.reconnectAttempt = 0;
    this.teardownSocket(1001, "foreground");
    void this.connect();
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  setActiveConversation(type: "dm" | "group", id: string | null): void {
    if (type === "dm") this.activeDirectId = id?.trim() || null;
    else this.activeGroupId = id ? Number(id) || null : null;
  }

  isConversationActive(type: "dm" | "group", id: string): boolean {
    return type === "dm" ? this.activeDirectId === id : this.activeGroupId === Number(id);
  }

  requestConversationRefresh(reason: string): void {
    const normalized = reason.trim() || "external";
    for (const listener of this.listeners)
      listener({ type: "refresh_conversations", reason: normalized });
  }

  publishLocalGroupMessage(ownerId: string, message: GroupMessage): boolean {
    const owner = ownerId.trim();
    if (
      !owner ||
      owner !== this.ownerId ||
      !Number.isInteger(message.id) ||
      message.id <= 0 ||
      !Number.isInteger(message.group_id) ||
      message.group_id <= 0
    ) {
      return false;
    }
    const event: ChatRealtimeEvent = { type: "group_message", message };
    for (const listener of this.listeners) listener(event);
    return true;
  }

  send(type: string, data: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type, data }));
    return true;
  }

  private async connect(): Promise<void> {
    if (this.manuallyStopped || !this.ownerId || this.socket) return;
    const token = await readAccessToken();
    if (!token || this.manuallyStopped || !this.ownerId) return;
    this.setStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(makeChatWebSocketURL(env.webSocketUrl, token));
    } catch (error) {
      reportRealtimeError(error, "websocket_construct");
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      this.startHeartbeat();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || !this.ownerId) return;
      const ownerId = this.ownerId;
      this.lastMessageAt = Date.now();
      this.reconnectAttempt = 0;
      this.refreshAttempted = false;
      this.setStatus("connected");
      this.enqueueIncomingEvents(socket, ownerId, parseChatRealtimeEnvelope(event.data));
    };
    socket.onerror = () => {
      // The close callback owns reconnect scheduling on React Native.
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.teardownSocket();
      this.setStatus("disconnected");
      if (this.manuallyStopped) return;
      const tokenFailure =
        event.code === 4001 || event.reason.toLocaleLowerCase().includes("token");
      if (tokenFailure && !this.refreshAttempted) {
        this.refreshAttempted = true;
        void this.refreshTokenThenReconnect();
      } else {
        this.scheduleReconnect();
      }
    };
  }

  private async refreshTokenThenReconnect(): Promise<void> {
    try {
      await verifySession();
      if (this.manuallyStopped) return;
      this.reconnectAttempt = 0;
      await this.connect();
    } catch (error) {
      reportRealtimeError(error, "websocket_refresh");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.manuallyStopped || !this.ownerId || this.reconnectTimer) return;
    const delay = chatRealtimeReconnectDelay(this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopTimers();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN)
        this.socket.send(JSON.stringify({ type: "ping" }));
    }, 15_000);
    this.healthTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt <= 45_000) return;
      this.reconnectNow();
    }, 45_000);
  }

  private async applySideEffects(ownerId: string, event: ChatRealtimeEvent): Promise<void> {
    if (event.type === "direct_message" || event.type === "group_message") {
      await persistChatRealtimeMessage(ownerId, event);
    } else if (event.type === "conversation_read") {
      recordConversationNotificationRead(
        ownerId,
        event.receipt.conversation_type,
        event.receipt.conversation_id,
        event.receipt.read_through_message_id,
      );
      await applyConversationReadReceipt(ownerId, event.receipt);
    } else if (event.type === "group_history_cleared") {
      await applyGroupHistoryClear(ownerId, event.receipt);
    } else if (event.type === "group_notification_settings_updated") {
      await applyGroupNotificationSettingsUpdate(ownerId, event.settings);
    } else if (event.type === "group_viewer_settings_updated") {
      await applyGroupViewerSettingsUpdate(ownerId, event.settings);
    } else if (event.type === "group_announcement_updated") {
      await applyGroupAnnouncementUpdate(ownerId, event.announcement);
    }
  }

  private enqueueIncomingEvents(
    socket: WebSocket,
    ownerId: string,
    events: readonly ChatRealtimeEvent[],
  ): void {
    if (events.length === 0) return;
    this.incomingEventDispatch = this.incomingEventDispatch
      .catch(() => undefined)
      .then(async () => {
        for (const event of events) {
          if (this.socket !== socket || this.ownerId !== ownerId) return;
          try {
            // Keep the list preview and the timeline on one ordered source of
            // truth: a user can only tap a newly broadcast preview after its
            // corresponding message is durable in the account-scoped cache.
            await this.applySideEffects(ownerId, event);
          } catch (error) {
            reportRealtimeError(error, "realtime_event_side_effect");
          }
          if (this.socket !== socket || this.ownerId !== ownerId) return;
          for (const listener of this.listeners) listener(event);
        }
      });
  }

  private teardownSocket(code?: number, reason?: string): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopTimers();
    const socket = this.socket;
    this.socket = null;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      socket.onclose = null;
      socket.close(code, reason);
    }
  }

  private stopTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.heartbeatTimer = null;
    this.healthTimer = null;
  }

  private setStatus(status: ChatRealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

export const chatRealtimeService = new ChatRealtimeService();

export function directMessageContactId(ownerId: string, message: Message): string | null {
  const owner = ownerId.trim();
  if (!owner) return null;
  if (message.sender_id === owner) return message.receiver_id.trim() || null;
  if (message.receiver_id === owner) return message.sender_id.trim() || null;
  return null;
}

export async function persistChatRealtimeMessage(
  ownerId: string,
  event: Extract<ChatRealtimeEvent, { type: "direct_message" | "group_message" }>,
): Promise<void> {
  const owner = ownerId.trim();
  if (!owner || event.message.id <= 0) return;
  if (event.type === "direct_message") {
    const contactId = directMessageContactId(owner, event.message);
    if (contactId) await saveDirectChatMessages(owner, contactId, [event.message]);
    return;
  }
  await saveGroupChatMessages(owner, event.message.group_id, [event.message]);
}

function parseEnvelope(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function messagePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return isRecord(payload.message) ? payload.message : payload;
}

function normalizeEventType(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll("-", "_");
}

function isLegacyLiveInvite(payload: Record<string, unknown>): boolean {
  const candidates = [payload];
  for (const key of ["data", "payload", "invitation", "call"]) {
    if (isRecord(payload[key])) candidates.push(payload[key]);
  }
  return candidates.some((candidate) => {
    if (flexString(candidate.slot_id, candidate.live_slot_id, candidate.slotId)) return true;
    const source = normalizeEventType(
      flexString(
        candidate.invitation_source,
        candidate.source,
        candidate.call_source,
        candidate.scene,
      ) ?? "",
    );
    return ["one_to_one_live", "live_lobby", "agent_match", "live"].includes(source);
  });
}

function chatMoneyMessageEvents(payload: Record<string, unknown>): ChatRealtimeEvent[] {
  const events: ChatRealtimeEvent[] = [];
  for (const key of ["message", "receipt_message", "receiptMessage"] as const) {
    if (!isRecord(payload[key])) continue;
    events.push({ type: "direct_message", message: normalizeMessage(payload[key]) });
  }
  for (const key of [
    "group_message",
    "groupMessage",
    "receipt_group_message",
    "receiptGroupMessage",
  ] as const) {
    if (!isRecord(payload[key])) continue;
    events.push({ type: "group_message", message: normalizeGroupMessage(payload[key]) });
  }
  return events;
}

function reportRealtimeError(error: unknown, operation: string): void {
  void import("@/services/monitoring/MonitoringService")
    .then(({ captureException }) => captureException(error, { operation }))
    .catch(() => undefined);
}
