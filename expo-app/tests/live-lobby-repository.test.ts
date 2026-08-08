import { apiRequest } from "@/api/client";
import {
  acceptLiveCall,
  cancelAgentLiveMatch,
  cancelLiveCall,
  createLiveSlot,
  deleteLiveSlot,
  getCurrentLiveSlot,
  getLiveCallState,
  getLiveLobbySlots,
  heartbeatLiveSlot,
  joinAcceptedLiveCall,
  rejectLiveCall,
  requestLiveCall,
  startAgentLiveMatch,
  uploadLiveAvatar,
} from "@/services/live/LiveLobbyRepository";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
const request = jest.mocked(apiRequest);

describe("one-to-one live lobby repository", () => {
  beforeEach(() => request.mockReset());

  it("uses exact native slot list/current/create/delete/heartbeat routes and identities", async () => {
    request
      .mockResolvedValueOnce({ items: [], supported_call_types: ["video"] })
      .mockResolvedValueOnce({ slot: null })
      .mockResolvedValueOnce({ slot: wireSlot() })
      .mockResolvedValue(undefined);
    await getLiveLobbySlots("chatted", "cursor/a");
    await getCurrentLiveSlot();
    await createLiveSlot({
      characterSetting: " Role ",
      liveAvatarAssetId: "asset-1",
      allowedCallTypes: ["video", "voice"],
      idempotencyKey: "create-key",
    });
    await deleteLiveSlot("slot/a", "delete-key");
    await heartbeatLiveSlot("slot/a");
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/one-to-one-live/slots?filter=chatted&limit=30&cursor=cursor%2Fa",
      {
        headers: { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" },
        requiredData: true,
        requiredEnvelope: true,
        timeoutMs: 15_000,
      },
    );
    expect(request).toHaveBeenNthCalledWith(2, "/one-to-one-live/slots/me/current", {
      cache: "no-store",
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(3, "/one-to-one-live/slots", {
      method: "POST",
      headers: { "Idempotency-Key": "create-key" },
      body: {
        character_setting: " Role ",
        allowed_call_types: ["voice", "video"],
        idempotency_key: "create-key",
        live_avatar_asset_id: "asset-1",
      },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(4, "/one-to-one-live/slots/slot%2Fa", {
      method: "DELETE",
      headers: { "Idempotency-Key": "delete-key" },
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(5, "/one-to-one-live/slots/slot%2Fa/heartbeat", {
      method: "POST",
      body: {},
      requiredEnvelope: true,
    });
  });

  it("uses exact invitation lifecycle routes, payment fields, and idempotency header", async () => {
    request
      .mockResolvedValueOnce({ call_id: "call-1", call_type: "audio" })
      .mockResolvedValueOnce(joinWire())
      .mockResolvedValueOnce(joinWire())
      .mockResolvedValueOnce({ call_id: "call-1", status: "accepted", call_type: "video" })
      .mockResolvedValue(undefined);
    expect(
      await requestLiveCall({
        slotId: "slot/a",
        callType: "voice",
        idempotencyKey: "invite-key",
        paymentMethod: { type: "prop_card", definitionId: "live_10m" },
      }),
    ).toMatchObject({ callId: "call-1", callType: "voice" });
    await expect(acceptLiveCall("call/1")).resolves.toMatchObject({
      billing_policy: { freeSeconds: 12 },
      live_experience: { definitionId: "live_experience_card_5m", durationSeconds: 300 },
    });
    await joinAcceptedLiveCall("call/1");
    await getLiveCallState("call/1");
    await rejectLiveCall("call/1", "busy");
    await cancelLiveCall("call/1");
    expect(request).toHaveBeenNthCalledWith(1, "/one-to-one-live/slots/slot%2Fa/invite", {
      method: "POST",
      headers: { "Idempotency-Key": "invite-key" },
      body: { call_type: "voice", payment_method: "prop_card", prop_definition_id: "live_10m" },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/one-to-one-live/calls/call%2F1/accept", {
      method: "POST",
      body: {},
      requiredData: true,
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(3, "/one-to-one-live/calls/call%2F1/join", {
      method: "POST",
      body: {},
      requiredData: true,
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(4, "/one-to-one-live/calls/call%2F1", {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(5, "/one-to-one-live/calls/call%2F1/reject", {
      method: "POST",
      body: { reason: "busy" },
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(6, "/one-to-one-live/calls/call%2F1/cancel", {
      method: "POST",
      body: {},
      requiredEnvelope: true,
    });
  });

  it("uploads the exact JPEG multipart field with stable identity and no mutation retry", async () => {
    request.mockResolvedValue({
      data: { asset_id: "asset-1", live_avatar_url: "/live/avatar.jpg" },
    });
    const append = jest.spyOn(FormData.prototype, "append");

    await expect(
      uploadLiveAvatar("file:///prepared-live-avatar.jpg", "upload-key"),
    ).resolves.toEqual({ assetId: "asset-1", liveAvatarUrl: "/live/avatar.jpg" });

    expect(append).toHaveBeenCalledWith("file", {
      uri: "file:///prepared-live-avatar.jpg",
      name: "live-avatar.jpg",
      type: "image/jpeg",
    });
    const [path, options] = request.mock.calls[0] ?? [];
    expect(path).toBe("/one-to-one-live/assets/avatar");
    expect(options).toMatchObject({
      method: "POST",
      headers: { "Idempotency-Key": "upload-key" },
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 90_000,
      transientRetries: false,
    });
    expect(options?.body).toBeInstanceOf(FormData);
    append.mockRestore();
  });

  it("rejects incomplete avatar upload responses", async () => {
    request.mockResolvedValue({ asset_id: "asset-only" });
    await expect(uploadLiveAvatar("file:///avatar.jpg", "upload-key")).rejects.toThrow(
      "Live avatar upload response is invalid",
    );
  });

  it("uses exact agent match start/cancel contracts and validates the server identity", async () => {
    request
      .mockResolvedValueOnce({ match_id: "match-1", created_at: "2026-08-08T00:00:00Z" })
      .mockResolvedValueOnce(undefined);

    await expect(
      startAgentLiveMatch({
        roleSetting: " Detective ",
        sourceAgentId: "agent/a",
        clientMatchId: "match-1",
      }),
    ).resolves.toEqual({ matchId: "match-1", createdAt: "2026-08-08T00:00:00Z" });
    await cancelAgentLiveMatch("match/a");

    expect(request.mock.calls).toEqual([
      [
        "/one-to-one-live/matches",
        {
          method: "POST",
          body: {
            role_setting: " Detective ",
            source_agent_id: "agent/a",
            client_match_id: "match-1",
          },
          requiredData: true,
        },
      ],
      ["/one-to-one-live/matches/match%2Fa/cancel", { method: "POST", body: {} }],
    ]);

    request.mockReset().mockResolvedValue({ created_at: "2026-08-08T00:00:00Z" });
    await expect(
      startAgentLiveMatch({
        roleSetting: "Role",
        sourceAgentId: "agent",
        clientMatchId: "match-2",
      }),
    ).rejects.toThrow("Agent live match response is invalid");
  });
});

function wireSlot() {
  return {
    id: "slot-1",
    status: "waiting",
    character_setting: "Role",
    user: { user_id: "u1", nickname: "A" },
  };
}
function joinWire() {
  return {
    call_id: "call-1",
    room_name: "room",
    token: "token",
    livekit_url: "wss://live.test",
    call_type: "video",
    billing_policy: { free_seconds: 12, unit_seconds: 60, amount_per_unit: 100 },
    live_experience: { definition_id: "live_experience_card_5m", status: "active" },
  };
}
