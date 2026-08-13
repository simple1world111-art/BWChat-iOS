import type {
  ConversationPreference,
  ConversationReadReceipt,
  AgentMessage,
  GroupAnnouncement,
  GroupHistoryClearReceipt,
  GroupMemberUpdateEvent,
  GroupMessage,
  GroupNotificationSettings,
  GroupViewerSettings,
  Message,
  ScriptTurnState,
} from "@/models";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  flexInt,
  flexString,
  isRecord,
  normalizeConversationPreference,
  normalizeConversationReadReceipt,
  normalizeAgentMessage,
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

export type ChatRealtimeEvent = (
  | { type: "direct_message"; message: Message; is_update?: boolean | undefined }
  | {
      type: "direct_message_hint";
      sender_id: string;
      receiver_id: string;
      message_id: number;
      message_version?: number | undefined;
    }
  | { type: "group_message"; message: GroupMessage; is_update?: boolean | undefined }
  | {
      type: "group_message_hint";
      group_id: number;
      message_id: number;
      message_version?: number | undefined;
    }
  | { type: "agent_message"; message: AgentMessage; is_update?: boolean | undefined }
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
  | { type: "live_signal"; signal_type: string; data: Record<string, unknown> }
) & { delivery_source?: "catch_up" | undefined };

export type ChatRealtimeStatus = "disconnected" | "connecting" | "connected";
export type ChatConversationSurface = "dm" | "group" | "agent" | "script";

export interface ChatConversationAlias {
  type: ChatConversationSurface;
  id: string;
}

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

export function makeChatWebSocketURL(
  baseUrl: string,
  token: string,
  afterEventSequence?: number,
): string {
  const url = new URL(baseUrl);
  url.searchParams.delete("token");
  url.searchParams.delete("after_event_seq");
  url.searchParams.append("token", token.trim());
  if (
    afterEventSequence !== undefined &&
    Number.isSafeInteger(afterEventSequence) &&
    afterEventSequence > 0
  ) {
    url.searchParams.append("after_event_seq", String(afterEventSequence));
  }
  return url.toString();
}

export function chatRealtimeReconnectDelay(attempt: number): number {
  return Math.min(2 ** Math.max(0, Math.floor(attempt)), 30) * 1_000;
}

export function jitteredChatRealtimeReconnectDelay(attempt: number, random = Math.random): number {
  const base = chatRealtimeReconnectDelay(attempt);
  return Math.round(base * Math.min(1, Math.max(0, random())));
}

export interface ChatRealtimeEnvelopeMetadata {
  event_id?: string | undefined;
  event_sequence?: number | undefined;
  server_time?: string | undefined;
}

export interface ChatRealtimeCatchUpEvent extends ChatRealtimeEnvelopeMetadata {
  event_sequence: number;
  type: string;
  data: unknown;
}

export function nextPersistedRealtimeEventSequence(
  previous: number,
  incoming: number | undefined,
  options: { hasGap: boolean; persistenceSucceeded: boolean },
): number {
  if (
    incoming === undefined ||
    incoming <= previous ||
    options.hasGap ||
    !options.persistenceSucceeded
  ) {
    return previous;
  }
  return incoming;
}

export function parseChatRealtimeEnvelopeMetadata(value: unknown): ChatRealtimeEnvelopeMetadata {
  const envelope = parseEnvelope(value);
  if (!envelope) return {};
  const payload = isRecord(envelope.data) ? envelope.data : envelope;
  const eventId = flexString(
    envelope.event_id,
    envelope.eventId,
    payload.event_id,
    payload.eventId,
  );
  const eventSequence = flexInt(
    envelope.event_seq,
    envelope.event_sequence,
    envelope.eventSequence,
    payload.event_seq,
    payload.event_sequence,
    payload.eventSequence,
  );
  const serverTime = flexString(
    envelope.server_time,
    envelope.serverTime,
    payload.server_time,
    payload.serverTime,
  );
  return {
    ...(eventId ? { event_id: eventId } : {}),
    ...(eventSequence !== undefined && eventSequence > 0 ? { event_sequence: eventSequence } : {}),
    ...(serverTime ? { server_time: serverTime } : {}),
  };
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
        return [{ type: "direct_message", message: normalizeMessage(messagePayload(payload)) }];
      case "message_updated":
        return [
          {
            type: "direct_message",
            message: normalizeMessage(messagePayload(payload)),
            is_update: true,
          },
        ];
      case "new_group_message":
        return [{ type: "group_message", message: normalizeGroupMessage(messagePayload(payload)) }];
      case "group_message_updated":
        return [
          {
            type: "group_message",
            message: normalizeGroupMessage(messagePayload(payload)),
            is_update: true,
          },
        ];
      case "agent_message":
      case "new_agent_message": {
        const message = normalizeAgentMessage(agentMessagePayload(payload));
        return message.id && message.conversation_id ? [{ type: "agent_message", message }] : [];
      }
      case "agent_message_updated": {
        const message = normalizeAgentMessage(agentMessagePayload(payload));
        return message.id && message.conversation_id
          ? [{ type: "agent_message", message, is_update: true }]
          : [];
      }
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
        const messageVersion = flexInt(
          payload.message_version,
          payload.messageVersion,
          payload.version,
        );
        if (senderId && receiverId && messageId > 0) {
          return [
            {
              type: "direct_message_hint",
              sender_id: senderId,
              receiver_id: receiverId,
              message_id: messageId,
              ...(messageVersion !== undefined ? { message_version: messageVersion } : {}),
            },
          ];
        }
        return [{ type: "refresh_conversations", reason: type }];
      }
      case "script_turn_state": {
        if (envelope.type !== "script_turn_state") return [];
        if (!isRecord(envelope.data)) return [];
        const state = normalizeScriptTurnState(envelope.data);
        return state.room_id ? [{ type: "script_turn_state", state }] : [];
      }
      case "group_contact_update": {
        const groupId = flexInt(payload.group_id, payload.groupId, payload.groupID) ?? 0;
        const messageId =
          flexInt(
            payload.message_id,
            payload.messageId,
            payload.last_message_id,
            payload.lastMessageId,
            payload.lastMessageID,
          ) ?? 0;
        const messageVersion = flexInt(
          payload.message_version,
          payload.messageVersion,
          payload.version,
        );
        if (groupId > 0 && messageId > 0) {
          return [
            {
              type: "group_message_hint",
              group_id: groupId,
              message_id: messageId,
              ...(messageVersion !== undefined ? { message_version: messageVersion } : {}),
            },
          ];
        }
        return [{ type: "refresh_conversations", reason: type }];
      }
      case "group_created":
      case "friend_request":
      case "friend_accepted":
      case "chat_reset":
        return [{ type: "refresh_conversations", reason: type }];
      case "resync_required":
      case "sync_required":
      case "replay_unavailable":
        return [{ type: "refresh_conversations", reason: "realtime_resync_required" }];
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
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMessageAt = 0;
  private refreshAttempted = false;
  private status: ChatRealtimeStatus = "disconnected";
  private activeConversation: {
    lease: number;
    canonical: string;
    identities: Set<string>;
  } | null = null;
  private applicationActive = true;
  private networkAvailable = true;
  private activeConversationLease = 0;
  private incomingEventDispatch: Promise<void> = Promise.resolve();
  private realtimePersistenceDispatch: Promise<void> = Promise.resolve();
  private readonly ingestedMessageVersions = new Map<string, number>();
  private readonly observedEventSequences = new Map<string, number>();
  private readonly persistenceFailureSequences = new Map<string, number>();
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
    this.ingestedMessageVersions.clear();
    this.observedEventSequences.clear();
    this.persistenceFailureSequences.clear();
    void this.connect();
  }

  stop(): void {
    this.manuallyStopped = true;
    this.ownerId = null;
    this.activeConversationLease += 1;
    this.activeConversation = null;
    this.applicationActive = true;
    this.ingestedMessageVersions.clear();
    this.observedEventSequences.clear();
    this.persistenceFailureSequences.clear();
    this.teardownSocket(1000, "logout");
    this.setStatus("disconnected");
  }

  reconnectNow(): void {
    if (this.manuallyStopped || !this.ownerId) return;
    if (this.socket?.readyState === WebSocket.OPEN && Date.now() - this.lastMessageAt <= 45_000) {
      return;
    }
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

  setActiveConversation(type: ChatConversationSurface, id: string | null): void {
    const identity = id ? activeConversationIdentity(type, id) : null;
    if (!identity) {
      if (
        this.activeConversation &&
        [...this.activeConversation.identities].some((candidate) =>
          candidate.startsWith(`${type}:`),
        )
      ) {
        this.activeConversationLease += 1;
        this.activeConversation = null;
      }
      return;
    }
    const lease = ++this.activeConversationLease;
    this.activeConversation = { lease, canonical: identity, identities: new Set([identity]) };
  }

  activateConversation(
    type: ChatConversationSurface,
    id: string,
    aliases: readonly ChatConversationAlias[] = [],
  ): () => void {
    const canonical = activeConversationIdentity(type, id);
    if (!canonical) {
      return () => undefined;
    }
    const lease = ++this.activeConversationLease;
    const identities = new Set<string>([canonical]);
    for (const alias of aliases) {
      const identity = activeConversationIdentity(alias.type, alias.id);
      if (identity) identities.add(identity);
    }
    this.activeConversation = { lease, canonical, identities };
    return () => {
      if (lease !== this.activeConversation?.lease) return;
      this.activeConversationLease += 1;
      this.activeConversation = null;
    };
  }

  addActiveConversationAlias(
    type: ChatConversationSurface,
    id: string,
    aliasType: ChatConversationSurface,
    aliasId: string,
  ): () => void {
    const canonical = activeConversationIdentity(type, id);
    const alias = activeConversationIdentity(aliasType, aliasId);
    const active = this.activeConversation;
    if (!canonical || !alias || !active || active.canonical !== canonical) {
      return () => undefined;
    }
    const lease = active.lease;
    active.identities.add(alias);
    return () => {
      const current = this.activeConversation;
      if (!current || current.lease !== lease || current.canonical !== canonical) return;
      if (alias !== canonical) current.identities.delete(alias);
    };
  }

  hasActiveConversation(): boolean {
    return this.applicationActive && this.activeConversation !== null;
  }

  isConversationActive(type: ChatConversationSurface, id: string): boolean {
    const identity = activeConversationIdentity(type, id);
    return Boolean(
      this.applicationActive && identity && this.activeConversation?.identities.has(identity),
    );
  }

  setApplicationActive(active: boolean): void {
    this.applicationActive = active;
  }

  setNetworkAvailable(available: boolean): void {
    if (this.networkAvailable === available) return;
    this.networkAvailable = available;
    if (!available) {
      this.teardownSocket(1001, "network_offline");
      this.setStatus("disconnected");
      return;
    }
    if (!this.manuallyStopped && this.ownerId) {
      this.reconnectAttempt = 0;
      void this.connect();
    }
  }

  requestConversationRefresh(reason: string): void {
    const normalized = reason.trim() || "external";
    for (const listener of this.listeners)
      listener({ type: "refresh_conversations", reason: normalized });
  }

  async acknowledgeCatchUp(ownerId: string, eventSequence: number): Promise<void> {
    const owner = ownerId.trim();
    if (
      !owner ||
      owner !== this.ownerId ||
      !Number.isSafeInteger(eventSequence) ||
      eventSequence <= 0
    ) {
      return;
    }
    await this.realtimePersistenceDispatch.catch(() => undefined);
    await saveRealtimeEventSequence(owner, eventSequence);
    this.observedEventSequences.set(
      owner,
      Math.max(this.observedEventSequences.get(owner) ?? 0, eventSequence),
    );
    const blockedSequence = this.persistenceFailureSequences.get(owner);
    if (blockedSequence !== undefined && blockedSequence <= eventSequence) {
      this.persistenceFailureSequences.delete(owner);
    }
  }

  persistedEventSequence(ownerId: string): Promise<number> {
    return readRealtimeEventSequence(ownerId.trim());
  }

  /**
   * Applies one ordered `/chat/sync` page through the same parser, UI listeners,
   * version gate and serialized persistence lane as WebSocket events. The page
   * cursor is committed only after every accepted side effect is durable.
   */
  ingestCatchUpPage(
    ownerId: string,
    envelopes: readonly ChatRealtimeCatchUpEvent[],
  ): Promise<number> {
    const owner = ownerId.trim();
    const operation = this.incomingEventDispatch
      .catch(() => undefined)
      .then(async () => {
        if (!owner || owner !== this.ownerId) throw new Error("realtime_owner_changed");
        // A WebSocket event may already be visible while its disk write is queued.
        // Flush that lane before validating the delta start cursor.
        await this.realtimePersistenceDispatch.catch(() => undefined);
        const durableSequence = await readRealtimeEventSequence(owner);
        const pending = envelopes.filter((event) => event.event_sequence > durableSequence);
        if (pending.length === 0) return durableSequence;

        let expectedSequence = durableSequence + 1;
        const acceptedEvents: ChatRealtimeEvent[] = [];
        for (const envelope of pending) {
          if (
            !Number.isSafeInteger(envelope.event_sequence) ||
            envelope.event_sequence !== expectedSequence
          ) {
            throw new Error("chat_sync_sequence_gap");
          }
          const parsed = parseChatRealtimeEnvelope(envelope);
          if (parsed.length === 0) throw new Error("chat_sync_event_unsupported");
          for (const event of parsed) {
            if (!this.shouldIngestEvent(owner, event)) continue;
            const deliveredEvent: ChatRealtimeEvent = { ...event, delivery_source: "catch_up" };
            acceptedEvents.push(deliveredEvent);
            for (const listener of this.listeners) listener(deliveredEvent);
          }
          expectedSequence += 1;
        }

        const firstSequence = pending[0]!.event_sequence;
        const lastSequence = pending.at(-1)!.event_sequence;
        const persisted = await this.enqueueAcceptedEventPersistence({
          ownerId: owner,
          acceptedEvents,
          previousSequence: durableSequence,
          firstSequence,
          eventSequence: lastSequence,
          hasGap: false,
          requireCursorAdvance: true,
        });
        if (!persisted) throw new Error("chat_sync_persistence_failed");
        return lastSequence;
      });
    this.incomingEventDispatch = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
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
    if (this.manuallyStopped || !this.ownerId || this.socket || !this.networkAvailable) return;
    const expectedOwnerId = this.ownerId;
    const token = await readAccessToken();
    const afterEventSequence = await readRealtimeEventSequence(expectedOwnerId);
    if (
      !token ||
      this.manuallyStopped ||
      this.ownerId !== expectedOwnerId ||
      !this.networkAvailable
    ) {
      return;
    }
    this.setStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        makeChatWebSocketURL(env.webSocketUrl, token, afterEventSequence || undefined),
      );
    } catch (error) {
      reportRealtimeError(error, "websocket_construct");
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.connectionTimer = setTimeout(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.CONNECTING) return;
      this.teardownSocket(1001, "connect_timeout");
      this.setStatus("disconnected");
      this.scheduleReconnect();
    }, 10_000);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      if (this.connectionTimer) clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
      this.lastMessageAt = Date.now();
      this.reconnectAttempt = 0;
      this.refreshAttempted = false;
      this.setStatus("connected");
      this.startHeartbeat();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || !this.ownerId) return;
      const ownerId = this.ownerId;
      this.lastMessageAt = Date.now();
      this.enqueueIncomingEvents(
        socket,
        ownerId,
        parseChatRealtimeEnvelope(event.data),
        parseChatRealtimeEnvelopeMetadata(event.data),
      );
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
    if (this.manuallyStopped || !this.ownerId || !this.networkAvailable || this.reconnectTimer) {
      return;
    }
    const delay = jitteredChatRealtimeReconnectDelay(this.reconnectAttempt++);
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
    metadata: ChatRealtimeEnvelopeMetadata = {},
  ): void {
    if (events.length === 0 && metadata.event_sequence === undefined) return;
    this.incomingEventDispatch = this.incomingEventDispatch
      .catch(() => undefined)
      .then(async () => {
        const eventSequence = metadata.event_sequence;
        const previousSequence = await readRealtimeEventSequence(ownerId);
        if (eventSequence !== undefined && eventSequence <= previousSequence) return;
        const observedSequence = this.observedEventSequences.get(ownerId) ?? previousSequence;
        if (eventSequence !== undefined && eventSequence <= observedSequence) return;
        const hasGap =
          eventSequence !== undefined &&
          observedSequence > 0 &&
          eventSequence > observedSequence + 1;
        if (hasGap) {
          for (const listener of this.listeners) {
            listener({ type: "refresh_conversations", reason: "realtime_sequence_gap" });
          }
        } else if (eventSequence !== undefined) {
          this.observedEventSequences.set(ownerId, eventSequence);
        }
        const acceptedEvents: ChatRealtimeEvent[] = [];
        for (const event of events) {
          if (this.socket !== socket || this.ownerId !== ownerId) return;
          if (!this.shouldIngestEvent(ownerId, event)) continue;
          acceptedEvents.push(event);
          for (const listener of this.listeners) listener(event);
        }
        // UI observes the canonical, version-gated ingest immediately. Disk writes remain ordered
        // on their own lane, so slow AsyncStorage cannot stall later WebSocket events.
        void this.enqueueAcceptedEventPersistence({
          ownerId,
          acceptedEvents,
          previousSequence,
          ...(eventSequence !== undefined ? { firstSequence: eventSequence, eventSequence } : {}),
          hasGap,
          requireCursorAdvance: false,
        });
      });
  }

  private enqueueAcceptedEventPersistence(input: {
    ownerId: string;
    acceptedEvents: readonly ChatRealtimeEvent[];
    previousSequence: number;
    firstSequence?: number | undefined;
    eventSequence?: number | undefined;
    hasGap: boolean;
    requireCursorAdvance: boolean;
  }): Promise<boolean> {
    const operation = this.realtimePersistenceDispatch
      .catch(() => undefined)
      .then(async () => {
        let persistenceSucceeded = false;
        try {
          for (const event of input.acceptedEvents) {
            await this.applySideEffects(input.ownerId, event);
          }
          persistenceSucceeded = true;
        } catch (error) {
          reportRealtimeError(error, "realtime_event_side_effect");
          if (input.eventSequence !== undefined) {
            this.recordPersistenceFailure(input.ownerId, input.eventSequence);
          }
          this.rollbackMessageIngestGates(input.ownerId, input.acceptedEvents);
          this.observedEventSequences.set(input.ownerId, input.previousSequence);
          this.publishPersistenceFailure(input.ownerId);
        }

        const durableSequence = await readRealtimeEventSequence(input.ownerId);
        let blockedSequence = this.persistenceFailureSequences.get(input.ownerId);
        if (
          persistenceSucceeded &&
          blockedSequence !== undefined &&
          input.firstSequence !== undefined &&
          input.eventSequence !== undefined &&
          blockedSequence >= input.firstSequence &&
          blockedSequence <= input.eventSequence
        ) {
          this.persistenceFailureSequences.delete(input.ownerId);
          blockedSequence = undefined;
        }
        const remainsBlocked =
          blockedSequence !== undefined &&
          input.eventSequence !== undefined &&
          blockedSequence < input.eventSequence;
        const durableGap =
          input.firstSequence !== undefined &&
          durableSequence > 0 &&
          input.firstSequence > durableSequence + 1;
        const nextSequence = nextPersistedRealtimeEventSequence(
          durableSequence,
          input.eventSequence,
          {
            hasGap: input.hasGap || durableGap || remainsBlocked,
            persistenceSucceeded,
          },
        );
        if (nextSequence > durableSequence) {
          try {
            await saveRealtimeEventSequence(input.ownerId, nextSequence);
            this.observedEventSequences.set(
              input.ownerId,
              Math.max(this.observedEventSequences.get(input.ownerId) ?? 0, nextSequence),
            );
          } catch (error) {
            reportRealtimeError(error, "realtime_cursor_persist");
            this.recordPersistenceFailure(input.ownerId, nextSequence);
            this.rollbackMessageIngestGates(input.ownerId, input.acceptedEvents);
            this.observedEventSequences.set(input.ownerId, input.previousSequence);
            this.publishPersistenceFailure(input.ownerId);
            return false;
          }
        }
        if (!persistenceSucceeded) return false;
        return !input.requireCursorAdvance || input.eventSequence === undefined
          ? true
          : Math.max(durableSequence, nextSequence) >= input.eventSequence;
      });
    this.realtimePersistenceDispatch = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private publishPersistenceFailure(ownerId: string): void {
    if (this.ownerId !== ownerId) return;
    for (const listener of this.listeners) {
      listener({ type: "refresh_conversations", reason: "realtime_persistence_failed" });
    }
  }

  private shouldIngestEvent(ownerId: string, event: ChatRealtimeEvent): boolean {
    const gate = realtimeMessageIngestGate(ownerId, event);
    if (!gate) return true;
    const previousVersion = this.ingestedMessageVersions.get(gate.key);
    if (previousVersion !== undefined && gate.version <= previousVersion) return false;
    this.ingestedMessageVersions.set(gate.key, gate.version);
    if (this.ingestedMessageVersions.size > 4_096) {
      const oldestKey = this.ingestedMessageVersions.keys().next().value;
      if (oldestKey !== undefined) this.ingestedMessageVersions.delete(oldestKey);
    }
    return true;
  }

  private rollbackMessageIngestGates(ownerId: string, events: readonly ChatRealtimeEvent[]): void {
    for (const event of events) {
      const gate = realtimeMessageIngestGate(ownerId, event);
      if (!gate || this.ingestedMessageVersions.get(gate.key) !== gate.version) continue;
      this.ingestedMessageVersions.delete(gate.key);
    }
  }

  private recordPersistenceFailure(ownerId: string, eventSequence: number): void {
    const previous = this.persistenceFailureSequences.get(ownerId);
    this.persistenceFailureSequences.set(
      ownerId,
      previous === undefined ? eventSequence : Math.min(previous, eventSequence),
    );
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
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.heartbeatTimer = null;
    this.healthTimer = null;
    this.connectionTimer = null;
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

function realtimeMessageIngestGate(
  ownerId: string,
  event: ChatRealtimeEvent,
): { key: string; version: number } | null {
  if (event.type !== "direct_message" && event.type !== "group_message") return null;
  return {
    key:
      event.type === "direct_message"
        ? `dm:${directMessageContactId(ownerId, event.message) ?? "unknown"}:${event.message.id}`
        : `group:${event.message.group_id}:${event.message.id}`,
    version: Math.max(0, event.message.version),
  };
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

const realtimeEventSequenceKeyPrefix = "bwchat.realtime.event-sequence.v1";
const realtimeEventSequences = new Map<string, number>();
const realtimeEventSequenceLoads = new Map<string, Promise<number>>();

async function readRealtimeEventSequence(ownerId: string): Promise<number> {
  const cached = realtimeEventSequences.get(ownerId);
  if (cached !== undefined) return cached;
  const existing = realtimeEventSequenceLoads.get(ownerId);
  if (existing) return existing;
  const load = AsyncStorage.getItem(realtimeEventSequenceKey(ownerId))
    .then((encoded) => {
      const value = Number(encoded);
      const sequence = Number.isSafeInteger(value) && value > 0 ? value : 0;
      realtimeEventSequences.set(ownerId, sequence);
      return sequence;
    })
    .catch(() => 0)
    .finally(() => realtimeEventSequenceLoads.delete(ownerId));
  realtimeEventSequenceLoads.set(ownerId, load);
  return load;
}

async function saveRealtimeEventSequence(ownerId: string, eventSequence: number): Promise<void> {
  const previous = await readRealtimeEventSequence(ownerId);
  if (!Number.isSafeInteger(eventSequence) || eventSequence <= previous) return;
  await AsyncStorage.setItem(realtimeEventSequenceKey(ownerId), String(eventSequence));
  realtimeEventSequences.set(ownerId, eventSequence);
}

function realtimeEventSequenceKey(ownerId: string): string {
  return `${realtimeEventSequenceKeyPrefix}:${encodeURIComponent(ownerId)}`;
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

function agentMessagePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return isRecord(payload.message) ? { ...payload, ...payload.message } : payload;
}

function normalizeEventType(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll("-", "_");
}

function activeConversationIdentity(type: ChatConversationSurface, id: string): string | null {
  const target = id.trim();
  if (!target) return null;
  if (type === "group") {
    const groupId = Number(target);
    return Number.isInteger(groupId) && groupId > 0 ? `group:${groupId}` : null;
  }
  return `${type}:${target}`;
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
