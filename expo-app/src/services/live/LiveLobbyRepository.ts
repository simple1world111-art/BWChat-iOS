import { apiRequest } from "@/api/client";
import type { CallConnectionCredentials, CallType } from "@/models";
import {
  normalizeAgentLiveMatchResponse,
  normalizeCallJoin,
  normalizeCurrentLiveSlot,
  normalizeLiveCallInvitation,
  normalizeLiveCallState,
  normalizeLiveSlot,
  normalizeLiveSlotPage,
  type AgentLiveMatchResponse,
  type LiveCallInvitationResponse,
  type OneToOneLiveCallState,
  type OneToOneLiveSlot,
  type OneToOneLiveSlotPage,
} from "@/services/live/LiveLobbyModels";

export async function getLiveLobbySlots(
  filter: "recommended" | "chatted",
  cursor?: string,
): Promise<OneToOneLiveSlotPage> {
  const query = new URLSearchParams({ filter, limit: "30" });
  if (cursor?.trim()) query.set("cursor", cursor.trim());
  return normalizeLiveSlotPage(
    await apiRequest<unknown>(`/one-to-one-live/slots?${query}`, {
      headers: { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" },
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 15_000,
    }),
  );
}

export async function getCurrentLiveSlot(): Promise<OneToOneLiveSlot | null> {
  return normalizeCurrentLiveSlot(
    await apiRequest<unknown>("/one-to-one-live/slots/me/current", {
      cache: "no-store",
      requiredEnvelope: true,
    }),
  );
}

export async function uploadLiveAvatar(
  uri: string,
  idempotencyKey: string,
): Promise<{ assetId: string; liveAvatarUrl: string }> {
  const form = new FormData();
  form.append("file", { uri, name: "live-avatar.jpg", type: "image/jpeg" } as unknown as Blob);
  const source = unwrap(
    await apiRequest<unknown>("/one-to-one-live/assets/avatar", {
      method: "POST",
      body: form,
      headers: { "Idempotency-Key": idempotencyKey },
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 90_000,
      transientRetries: false,
    }),
  );
  const assetId = stringValue(source.asset_id, source.assetId);
  const liveAvatarUrl = stringValue(source.live_avatar_url, source.liveAvatarUrl);
  if (!assetId || !liveAvatarUrl) throw new Error("Live avatar upload response is invalid");
  return { assetId, liveAvatarUrl };
}

export async function createLiveSlot(input: {
  characterSetting: string;
  liveAvatarAssetId?: string | undefined;
  allowedCallTypes: CallType[];
  idempotencyKey: string;
}): Promise<OneToOneLiveSlot> {
  const value = await apiRequest<unknown>("/one-to-one-live/slots", {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: {
      character_setting: input.characterSetting,
      allowed_call_types: (["voice", "video"] as CallType[]).filter((type) =>
        input.allowedCallTypes.includes(type),
      ),
      idempotency_key: input.idempotencyKey,
      ...(input.liveAvatarAssetId ? { live_avatar_asset_id: input.liveAvatarAssetId } : {}),
    },
    requiredData: true,
    requiredEnvelope: true,
    transientRetries: false,
  });
  const source = unwrap(value);
  const slot = normalizeLiveSlot(source.slot ?? source.item ?? source.live_slot ?? source);
  if (!slot?.id || !slot.user.userId) throw new Error("Live slot creation response is invalid");
  return slot;
}

export async function deleteLiveSlot(slotId: string, idempotencyKey: string): Promise<void> {
  await apiRequest<unknown>(`/one-to-one-live/slots/${encodeURIComponent(slotId)}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": idempotencyKey },
    requiredEnvelope: true,
    transientRetries: false,
  });
}

export async function heartbeatLiveSlot(slotId: string): Promise<void> {
  await apiRequest<unknown>(`/one-to-one-live/slots/${encodeURIComponent(slotId)}/heartbeat`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
  });
}

export async function requestLiveCall(input: {
  slotId: string;
  callType: CallType;
  idempotencyKey: string;
  paymentMethod?:
    { type: "spendable_balance" } | { type: "prop_card"; definitionId: string } | undefined;
}): Promise<LiveCallInvitationResponse> {
  return normalizeLiveCallInvitation(
    await apiRequest<unknown>(`/one-to-one-live/slots/${encodeURIComponent(input.slotId)}/invite`, {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: {
        call_type: input.callType,
        ...(input.paymentMethod?.type === "prop_card"
          ? { payment_method: "prop_card", prop_definition_id: input.paymentMethod.definitionId }
          : {}),
      },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    }),
  );
}

export async function acceptLiveCall(callId: string): Promise<CallConnectionCredentials> {
  return normalizeCallJoin(
    await apiRequest<unknown>(`/one-to-one-live/calls/${encodeURIComponent(callId)}/accept`, {
      method: "POST",
      body: {},
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}
export async function joinAcceptedLiveCall(callId: string): Promise<CallConnectionCredentials> {
  return normalizeCallJoin(
    await apiRequest<unknown>(`/one-to-one-live/calls/${encodeURIComponent(callId)}/join`, {
      method: "POST",
      body: {},
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}
export async function getLiveCallState(callId: string): Promise<OneToOneLiveCallState> {
  return normalizeLiveCallState(
    await apiRequest<unknown>(`/one-to-one-live/calls/${encodeURIComponent(callId)}`, {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}
export async function rejectLiveCall(callId: string, reason: string): Promise<void> {
  await apiRequest<unknown>(`/one-to-one-live/calls/${encodeURIComponent(callId)}/reject`, {
    method: "POST",
    body: { reason },
    requiredEnvelope: true,
  });
}
export async function cancelLiveCall(callId: string): Promise<void> {
  await apiRequest<unknown>(`/one-to-one-live/calls/${encodeURIComponent(callId)}/cancel`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
  });
}

export async function startAgentLiveMatch(input: {
  roleSetting: string;
  sourceAgentId: string;
  clientMatchId: string;
}): Promise<AgentLiveMatchResponse> {
  return normalizeAgentLiveMatchResponse(
    await apiRequest<unknown>("/one-to-one-live/matches", {
      method: "POST",
      body: {
        role_setting: input.roleSetting,
        source_agent_id: input.sourceAgentId,
        client_match_id: input.clientMatchId,
      },
      requiredData: true,
    }),
  );
}

export async function cancelAgentLiveMatch(matchId: string): Promise<void> {
  await apiRequest<unknown>(`/one-to-one-live/matches/${encodeURIComponent(matchId)}/cancel`, {
    method: "POST",
    body: {},
  });
}

function unwrap(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Live response is invalid");
  const source = value as Record<string, unknown>;
  return typeof source.data === "object" && source.data !== null && !Array.isArray(source.data)
    ? unwrap(source.data)
    : source;
}
function stringValue(...values: unknown[]): string | undefined {
  for (const value of values)
    if ((typeof value === "string" || typeof value === "number") && String(value).trim())
      return String(value).trim();
  return undefined;
}
