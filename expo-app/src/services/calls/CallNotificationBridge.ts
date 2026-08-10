import { parseIncomingCallSignal, type IncomingCallSignal } from "@/services/calls/callPolicy";
import { flattenNotificationPayload } from "@/services/push/PushService";

type CallNotificationListener = (invitation: IncomingCallSignal) => boolean;

export type CallNotificationPublishResult =
  | { kind: "not_call" }
  | { kind: "invalid"; missingFields: string[]; pushType: string }
  | { kind: "published"; invitation: IncomingCallSignal };

const directCallPushTypes = new Set(["call", "call_invite"]);
const groupCallPushTypes = new Set(["group_call", "group_call_invite"]);

/**
 * Replays a notification invitation when the call provider mounts after the
 * notification response. This closes the cold-launch gap between Expo's
 * one-shot response callback and the authenticated call UI.
 */
export class CallNotificationBridge {
  private listeners = new Set<CallNotificationListener>();
  private pending: IncomingCallSignal | null = null;

  publish(input: unknown): CallNotificationPublishResult {
    const decoded = decodeCallNotification(input);
    if (decoded.kind !== "published") return decoded;
    this.pending = decoded.invitation;
    this.drain();
    return decoded;
  }

  subscribe(listener: CallNotificationListener): () => void {
    this.listeners.add(listener);
    this.drain(listener);
    return () => this.listeners.delete(listener);
  }

  private drain(only?: CallNotificationListener): void {
    const invitation = this.pending;
    if (!invitation) return;
    const candidates = only ? [only] : [...this.listeners];
    for (const listener of candidates) {
      if (!listener(invitation)) continue;
      if (this.pending === invitation) this.pending = null;
      return;
    }
  }
}

const callNotificationBridge = new CallNotificationBridge();

export function publishCallNotification(input: unknown): CallNotificationPublishResult {
  return callNotificationBridge.publish(input);
}

export function subscribeCallNotifications(listener: CallNotificationListener): () => void {
  return callNotificationBridge.subscribe(listener);
}

export function decodeCallNotification(input: unknown): CallNotificationPublishResult {
  const data = flattenNotificationPayload(input);
  const pushType = firstString(data, [
    "push_type",
    "pushType",
    "event_type",
    "eventType",
    "type",
  ])?.toLocaleLowerCase();
  if (!pushType) return { kind: "not_call" };
  const signalType = directCallPushTypes.has(pushType)
    ? "call_invite"
    : groupCallPushTypes.has(pushType)
      ? "group_call_invite"
      : null;
  if (!signalType) return { kind: "not_call" };

  const invitation = parseIncomingCallSignal(signalType, data);
  if (invitation) return { kind: "published", invitation };
  return {
    kind: "invalid",
    missingFields: missingCallNotificationFields(signalType, data),
    pushType,
  };
}

function missingCallNotificationFields(
  signalType: "call_invite" | "group_call_invite",
  data: Record<string, unknown>,
): string[] {
  const missing: string[] = [];
  if (!firstString(data, ["room_name", "roomName", "room"])) missing.push("room_name");
  if (!firstString(data, ["call_type", "callType", "media_type", "mediaType"])) {
    missing.push("call_type");
  }
  if (signalType === "group_call_invite") {
    if (firstInteger(data, ["group_id", "groupId"]) === undefined) missing.push("group_id");
    if (!firstString(data, ["group_name", "groupName", "name"])) missing.push("group_name");
  } else if (
    !firstString(data, [
      "caller_id",
      "callerId",
      "from_user_id",
      "fromUserId",
      "user_id",
      "userId",
      "sender_id",
      "senderId",
    ])
  ) {
    missing.push("caller_id");
  }
  return missing;
}

function firstString(data: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstInteger(data: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = data[key];
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^[+-]?\d+$/u.test(value)
          ? Number(value)
          : Number.NaN;
    if (Number.isSafeInteger(number)) return number;
  }
  return undefined;
}
