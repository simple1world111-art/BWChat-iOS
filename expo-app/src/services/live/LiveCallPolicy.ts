import { APIError } from "@/api/client";
import { flexString, isRecord } from "@/api/normalizers";

export type LiveCallEventCorrelation =
  { kind: "ignore" } | { kind: "defer"; callId: string } | { kind: "handle"; callId: string };

export function correlateLiveCallEvent(
  data: Record<string, unknown>,
  invitation: {
    isOutgoing: boolean;
    callId?: string | undefined;
    slotId: string;
    peerUserId: string;
  },
): LiveCallEventCorrelation {
  if (!invitation.isOutgoing || field(data, "match_id")) return { kind: "ignore" };
  const eventCallId = field(data, "call_id", "callId");
  if (!eventCallId) return { kind: "ignore" };

  const eventSlotId = field(data, "slot_id", "live_slot_id", "slotId");
  if (eventSlotId && invitation.slotId && eventSlotId !== invitation.slotId) {
    return { kind: "ignore" };
  }
  const eventPeerId = field(data, "host_id", "host_user_id");
  if (eventPeerId && invitation.peerUserId && eventPeerId !== invitation.peerUserId) {
    return { kind: "ignore" };
  }

  const invitationCallId = invitation.callId?.trim();
  if (!invitationCallId) return { kind: "defer", callId: eventCallId };
  return invitationCallId === eventCallId
    ? { kind: "handle", callId: eventCallId }
    : { kind: "ignore" };
}

export function liveCallErrorMessage(
  error: unknown,
  translate: (key: string, ...args: (string | number)[]) => string,
  fallback: string,
): string {
  const code = liveCallBusinessCode(error)?.toUpperCase();
  const serverMessage = liveCallServerMessage(error);
  switch (code) {
    case "LIVE_HOST_CANNOT_CALL_OTHER_HOST":
      return serverMessage || "正在直播，无法与其他在直播的人视频";
    case "LIVE_SELF_CALL_FORBIDDEN":
      return "这是你的直播，其他用户可以从这里与你连线";
    case "LIVE_CALL_TYPE_NOT_ALLOWED":
      return serverMessage || "该主播未开放这种连线方式";
    case "PROP_NOT_OWNED":
    case "PROP_EXPIRED":
    case "PROP_NOT_CONSUMABLE":
      return translate("live.experience.error.unavailable");
    case "PROP_ALREADY_RESERVED":
    case "LIVE_EXPERIENCE_CARD_BUSY":
      return translate("live.experience.error.busy");
    case "LIVE_EXPERIENCE_CARD_MISMATCH":
      return translate("live.experience.error.mismatch");
    default:
      return (
        serverMessage ||
        (error instanceof Error && error.message.trim() ? error.message.trim() : fallback)
      );
  }
}

function liveCallBusinessCode(error: unknown): string | undefined {
  if (!(error instanceof APIError)) return undefined;
  const payload = isRecord(error.payload) ? error.payload : {};
  const nestedError = isRecord(payload.error) ? payload.error : {};
  const nestedData = isRecord(payload.data) ? payload.data : {};
  const detail = isRecord(payload.detail) ? payload.detail : {};
  return flexString(
    error.code,
    payload.code,
    nestedError.code,
    nestedData.error_code,
    nestedData.code,
    detail.code,
  )?.trim();
}

function liveCallServerMessage(error: unknown): string | undefined {
  if (!(error instanceof APIError)) return undefined;
  const payload = isRecord(error.payload) ? error.payload : {};
  const nestedError = isRecord(payload.error) ? payload.error : {};
  const detail = isRecord(payload.detail) ? payload.detail : {};
  return flexString(payload.message, nestedError.message, detail.message)?.trim();
}

function field(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) {
      return String(value).trim();
    }
  }
  return undefined;
}
