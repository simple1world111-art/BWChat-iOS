import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type { CallSession, CallType } from "@/models";

export const CALL_CONNECTION_TIMEOUT_MS = 20_000;
export const DIRECT_REMOTE_DEPARTURE_GRACE_MS = 20_000;
export const GROUP_REMOTE_DEPARTURE_GRACE_MS = 3_000;
export const LIVE_TERMINATION_RECONCILIATION_MS = 800;

export interface IncomingCallSignal {
  call_id?: string | undefined;
  room_name: string;
  call_type: CallType;
  caller_id: string;
  caller_name: string;
  caller_avatar: string;
  group_id?: number | undefined;
  group_name?: string | undefined;
}

export function normalizeLiveKitServerURL(serverUrl: string, apiBaseUrl: string): string {
  const trimmed = trimFoundationWhitespacesAndNewlines(serverUrl);
  if (!trimmed) throw new Error("通话服务器地址无效");
  const resolved = trimmed.startsWith("/")
    ? new URL(trimmed, trailingSlash(apiBaseUrl))
    : new URL(trimmed);
  if (resolved.protocol === "https:") resolved.protocol = "wss:";
  else if (resolved.protocol === "http:") resolved.protocol = "ws:";
  else if (resolved.protocol !== "wss:" && resolved.protocol !== "ws:") {
    throw new Error("通话服务器地址无效");
  }
  if (!resolved.hostname) throw new Error("通话服务器地址无效");
  return resolved.toString();
}

export function parseIncomingCallSignal(
  signalType: string,
  data: Record<string, unknown>,
): IncomingCallSignal | null {
  const group = signalType === "group_call_invite";
  if (signalType !== "call_invite" && signalType !== "call_offer" && !group) return null;
  if (group) return parseIncomingGroupCallSignal(data);
  const roomName = firstString(data, ["room_name", "room"]);
  const callType = callTypeValue(data.call_type ?? data.media_type ?? data.type);
  if (!roomName || !callType) return null;
  const callId = firstString(data, ["call_id"]);
  const callerId = firstString(data, ["caller_id", "from_user_id", "user_id"]) ?? "";
  if (!callerId) return null;
  return {
    ...(callId ? { call_id: callId } : {}),
    room_name: roomName,
    call_type: callType,
    caller_id: callerId,
    caller_name: firstString(data, ["caller_name", "caller_nickname", "nickname"]) ?? callerId,
    caller_avatar: firstString(data, ["caller_avatar", "avatar_url", "avatar"]) ?? "",
  };
}

/** Matches the native group lifecycle gate, including `group_id == 0`. */
export function groupCallEndSignalMatchesSession(
  session: CallSession,
  data: Record<string, unknown>,
): boolean {
  const groupId = nativeGroupIntValue(data.group_id);
  if (groupId === undefined || session.group_id !== groupId) return false;
  const incoming = groupSignalIdentity(data);
  const current = callSessionIdentity(session);
  return !hasComparableSignalKey(current, incoming) || signalIdentitiesMatch(current, incoming);
}

export function hasCallSignalIdentity(
  session: Pick<CallSession, "call_id" | "room_name">,
): boolean {
  const identity = callSessionIdentity(session);
  return identity.callId !== undefined || identity.roomName !== undefined;
}

export function callSignalMatchesSession(
  session: CallSession,
  data: Record<string, unknown>,
): boolean {
  const callId = firstString(data, ["call_id"]);
  const roomName = firstString(data, ["room_name", "room"]);
  const hasComparableKey = Boolean((callId && session.call_id) || (roomName && session.room_name));
  if (callId && session.call_id && callId !== session.call_id) return false;
  if (roomName && session.room_name && roomName !== session.room_name) return false;
  if (hasComparableKey) return true;
  const sender = firstString(data, ["caller_id", "from_user_id", "user_id", "target_id"]);
  return !sender || !session.remote_user_id || sender === session.remote_user_id;
}

export function isDuplicateCallInvite(session: CallSession, incoming: IncomingCallSignal): boolean {
  if ((session.group_id ?? null) !== (incoming.group_id ?? null)) return false;
  if (session.group_id !== undefined) {
    return signalIdentitiesMatch(
      callSessionIdentity(session),
      groupSignalIdentity(incoming as unknown as Record<string, unknown>),
    );
  }
  if (session.remote_user_id !== incoming.caller_id) return false;
  return callSignalMatchesSession(session, incoming as unknown as Record<string, unknown>);
}

export function callSignalPayload(
  session: Pick<CallSession, "remote_user_id" | "call_id" | "room_name">,
  reason?: string,
): Record<string, unknown> {
  return {
    target_id: session.remote_user_id,
    ...(session.call_id?.trim() ? { call_id: session.call_id.trim() } : {}),
    ...(session.room_name?.trim() ? { room_name: session.room_name.trim() } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function shouldMarkCallConnected(
  session: Pick<CallSession, "is_outgoing" | "group_id" | "state">,
  remoteParticipantCount: number,
  hasRemoteAudio: boolean,
): boolean {
  if (session.state === "connected" || session.state === "ended") return false;
  if (session.group_id !== undefined || !session.is_outgoing) return true;
  return remoteParticipantCount > 0 && hasRemoteAudio;
}

export function shouldScheduleCallAutoExit(
  isGroupCall: boolean,
  hasObservedRemoteParticipant: boolean,
  remoteParticipantCount: number,
): boolean {
  if (remoteParticipantCount !== 0) return false;
  return !isGroupCall || hasObservedRemoteParticipant;
}

export function formatCallDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function callTypeValue(value: unknown): CallType | null {
  const normalized = stringValue(value)?.toLocaleLowerCase();
  if (normalized === "voice" || normalized === "audio") return "voice";
  return normalized === "video" ? "video" : null;
}

function parseIncomingGroupCallSignal(data: Record<string, unknown>): IncomingCallSignal | null {
  const groupId = nativeGroupIntValue(data.group_id);
  const groupName = nativeGroupFirstString(data, ["group_name", "name"]);
  const roomName = nativeGroupFirstString(data, ["room_name", "room"]);
  const callType = nativeGroupCallType(data.call_type ?? data.type);
  if (groupId === undefined || groupName === undefined || roomName === undefined || !callType) {
    return null;
  }
  const callId = normalizeSignalIdentityValue(nativeGroupFirstString(data, ["call_id"]));
  const callerId = nativeGroupFirstString(data, ["caller_id", "from_user_id", "user_id"]) ?? "";
  return {
    ...(callId !== undefined ? { call_id: callId } : {}),
    room_name: roomName,
    call_type: callType,
    caller_id: callerId,
    caller_name: groupName,
    caller_avatar: "",
    group_id: groupId,
    group_name: groupName,
  };
}

function nativeGroupCallType(value: unknown): CallType | null {
  const normalized = nativeGroupStringValue(value)?.toLowerCase();
  if (normalized === "voice" || normalized === "audio") return "voice";
  return normalized === "video" ? "video" : null;
}

function nativeGroupFirstString(
  data: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = nativeGroupStringValue(data[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function nativeGroupStringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return undefined;
}

function nativeGroupIntValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string" || !/^[+-]?\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

interface SignalIdentity {
  callId?: string | undefined;
  roomName?: string | undefined;
}

function callSessionIdentity(session: Pick<CallSession, "call_id" | "room_name">): SignalIdentity {
  return {
    callId: normalizeSignalIdentityValue(session.call_id),
    roomName: normalizeSignalIdentityValue(session.room_name),
  };
}

function groupSignalIdentity(data: Record<string, unknown>): SignalIdentity {
  return {
    callId: normalizeSignalIdentityValue(nativeGroupFirstString(data, ["call_id"])),
    roomName: normalizeSignalIdentityValue(nativeGroupFirstString(data, ["room_name", "room"])),
  };
}

function normalizeSignalIdentityValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = trimFoundationWhitespacesAndNewlines(value);
  return normalized.length > 0 ? normalized : undefined;
}

function hasComparableSignalKey(left: SignalIdentity, right: SignalIdentity): boolean {
  return Boolean((left.callId && right.callId) || (left.roomName && right.roomName));
}

function signalIdentitiesMatch(left: SignalIdentity, right: SignalIdentity): boolean {
  if (left.callId !== undefined && right.callId !== undefined) return left.callId === right.callId;
  if (left.roomName !== undefined && right.roomName !== undefined) {
    return left.roomName === right.roomName;
  }
  return false;
}

function firstString(data: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(data[key]);
    if (value) return value;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function trailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
