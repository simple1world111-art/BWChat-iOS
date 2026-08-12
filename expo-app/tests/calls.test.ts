import {
  endCall,
  getGroupCallStatus,
  joinCall,
  leaveGroupCall,
  markCallBusy,
  reportCallQuality,
  rejectCall,
  startDirectCall,
  startGroupCall,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  normalizeCallConnectionCredentials,
  normalizeCallType,
  normalizeGroupCallStatus,
} from "@/api/normalizers";
import type { CallSession } from "@/models";
import {
  callSignalMatchesSession,
  callSignalPayload,
  formatCallDuration,
  groupVideoCellSize,
  groupCallEndSignalMatchesSession,
  isDuplicateCallInvite,
  normalizeLiveKitServerURL,
  parseIncomingCallSignal,
  shouldMarkCallConnected,
} from "@/services/calls/callPolicy";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
const request = jest.mocked(apiRequest);

describe("native friend and group call contracts", () => {
  beforeEach(() => request.mockReset());

  it("keeps two-column group video cells at a stable explicit 3:4 size", () => {
    expect(groupVideoCellSize(430)).toEqual({ width: 209, height: 279 });
    expect(groupVideoCellSize(0)).toEqual({ width: 0, height: 0 });
    expect(groupVideoCellSize(Number.NaN)).toEqual({ width: 0, height: 0 });
  });

  it("normalizes voice/audio/video types and all LiveKit response aliases", () => {
    expect(normalizeCallType("AUDIO")).toBe("voice");
    expect(normalizeCallType("video")).toBe("video");
    expect(normalizeCallType("screen")).toBeUndefined();
    expect(
      normalizeCallConnectionCredentials({
        callID: 9,
        room: " room-1 ",
        livekitToken: " token ",
        serverUrl: "https://live.example.test",
        media_type: "audio",
        participantCount: -2,
      }),
    ).toEqual({
      call_id: "9",
      room_name: "room-1",
      token: "token",
      livekit_url: "https://live.example.test",
      call_type: "voice",
      participant_count: 0,
    });
    expect(normalizeCallConnectionCredentials({ room_name: "r", token: "t" }).livekit_url).toBe(
      "wss://id7.com/livekit",
    );
    expect(() => normalizeCallConnectionCredentials({ room_name: "r" })).toThrow("缺少房间或令牌");
  });

  it("uses exact native direct start/join/end/reject/busy routes and bodies", async () => {
    request
      .mockResolvedValueOnce(credentials())
      .mockResolvedValueOnce(credentials())
      .mockResolvedValue(undefined);
    await startDirectCall("friend-1", "video");
    await joinCall("room-1");
    await endCall("call-1");
    await rejectCall("call-1");
    await markCallBusy("call-1");
    expect(request).toHaveBeenNthCalledWith(1, "/call/start", {
      method: "POST",
      body: { target_id: "friend-1", call_type: "video" },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/call/join", {
      method: "POST",
      body: { room_name: "room-1" },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(3, "/call/call-1/end", {
      method: "POST",
      body: {},
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(4, "/call/call-1/reject", {
      method: "POST",
      body: {},
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(5, "/call/call-1/busy", {
      method: "POST",
      body: {},
      requiredEnvelope: true,
      transientRetries: false,
    });
  });

  it("decodes the shared join response with the exact native schema", async () => {
    request.mockResolvedValueOnce({
      call_id: " call ",
      room_name: " room ",
      token: " token ",
      livekit_url: "\u0085",
      server_url: " wss://live.example.test/room ",
      call_type: "voice",
      billing_policy: {
        currency: " ",
        free_seconds: "-2",
        unit_seconds: 0,
        amount_per_unit: "250",
        minimum_starting_balance: 0,
        rounding: " ",
      },
      live_experience: {
        prop_definition_id: "live_experience_card_10m",
        status: " ACTIVE ",
        remaining_seconds: "45",
        host_earning_enabled: "yes",
        reserved_prop: {
          inventory_id: "inventory-1",
          definition_id: "live_experience_card_10m",
          remaining_quantity: 2,
        },
        server_time: "inner-time",
      },
      server_time: 123,
    });

    await expect(joinCall(" room ")).resolves.toMatchObject({
      call_id: " call ",
      room_name: " room ",
      token: " token ",
      livekit_url: " wss://live.example.test/room ",
      call_type: "voice",
      billing_policy: {
        currency: "spendable_balance",
        freeSeconds: 0,
        unitSeconds: 60,
        amountPerUnit: 250,
        minimumStartingBalance: 250,
        rounding: "started_unit",
      },
      live_experience: {
        definitionId: "live_experience_card_10m",
        durationSeconds: 600,
        status: "active",
        remainingSeconds: 45,
        hostEarningEnabled: true,
        reservedProp: {
          inventory_id: "inventory-1",
          definition_id: "live_experience_card_10m",
          remaining_quantity: 2,
        },
        serverTime: "123",
      },
    });
    expect(request).toHaveBeenCalledWith("/call/join", {
      method: "POST",
      body: { room_name: " room " },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
  });

  it("rejects join aliases and malformed optional native fields", async () => {
    request
      .mockResolvedValueOnce({ roomName: "room", token: "token" })
      .mockResolvedValueOnce({ room_name: "room", token: "token", call_type: "audio" })
      .mockResolvedValueOnce({
        room_name: "room",
        token: "token",
        live_experience: {
          definition_id: "live_experience_card_5m",
          reserved_prop: { definition_id: "live_experience_card_5m", remaining_quantity: "1" },
        },
      });

    await expect(joinCall("room")).rejects.toThrow("通话加入响应格式无效");
    await expect(joinCall("room")).rejects.toThrow("通话加入响应格式无效");
    await expect(joinCall("room")).rejects.toThrow("通话加入响应格式无效");
  });

  it("preserves native short-circuit decoding for fallback join fields", async () => {
    request.mockResolvedValueOnce({
      room_name: "room",
      token: "token",
      livekit_url: "wss://live.example.test/room",
      server_url: 42,
      live_experience: { definition_id: "live_experience_card_5m" },
      experience: "ignored malformed fallback",
    });

    await expect(joinCall("room")).resolves.toMatchObject({
      room_name: "room",
      token: "token",
      livekit_url: "wss://live.example.test/room",
      live_experience: { definitionId: "live_experience_card_5m", durationSeconds: 300 },
    });
  });

  it("uploads the exact privacy-preserving video quality report contract", async () => {
    request.mockResolvedValue(undefined);
    await reportCallQuality("call/a", {
      appBuild: "42",
      sampleCount: 3,
      outbound: {
        width: 1280,
        height: 720,
        fps: 29.97,
        bitrateBps: 900_000,
        packetsLost: 2,
        nackCount: 3,
        pliCount: 4,
        firCount: 5,
        rttMs: 81.5,
        fractionLost: 0.02,
        qualityLimitationReason: "bandwidth",
      },
      inbound: {
        framesDropped: 6,
        freezeCount: 1,
      },
      iceTransport: "turn_tls",
      relay: true,
    });
    expect(request).toHaveBeenCalledWith("/call/call%2Fa/quality-report", {
      method: "POST",
      body: {
        app_build: "42",
        sample_count: 3,
        outbound: {
          width: 1280,
          height: 720,
          fps: 29.97,
          bitrate_bps: 900_000,
          packets_lost: 2,
          nack: 3,
          pli: 4,
          fir: 5,
          rtt_ms: 81.5,
          fraction_lost: 0.02,
          quality_limitation_reason: "bandwidth",
        },
        inbound: { frames_dropped: 6, freeze_count: 1 },
        ice_transport: "turn_tls",
        relay: true,
      },
    });
  });

  it("uses exact group start/leave/status routes and omits absent leave identities", async () => {
    request
      .mockResolvedValueOnce(
        credentials({
          call_id: " call ",
          room_name: " room ",
          token: " token ",
          livekit_url: "  ",
          server_url: " https://server.example.test/livekit ",
          call_type: "future-media",
          participant_count: -3,
        }),
      )
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        active: true,
        call_id: "c",
        room_name: "r",
        call_type: "voice",
        participant_count: 3,
      });
    await expect(startGroupCall(7, "voice")).resolves.toEqual({
      call_id: " call ",
      room_name: " room ",
      token: " token ",
      livekit_url: " https://server.example.test/livekit ",
      call_type: "future-media",
      participant_count: -3,
    });
    await leaveGroupCall(7, { callId: " c ", roomName: " room " });
    await leaveGroupCall(7);
    expect(await getGroupCallStatus(7)).toEqual({
      active: true,
      call_id: "c",
      room_name: "r",
      call_type: "voice",
      participant_count: 3,
    });
    expect(request).toHaveBeenNthCalledWith(1, "/call/group/7/start", {
      method: "POST",
      body: { call_type: "voice" },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/call/group/7/leave", {
      method: "POST",
      body: { call_id: " c ", room_name: " room " },
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(3, "/call/group/7/leave", {
      method: "POST",
      body: {},
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(4, "/call/group/7/status", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("rejects group start/status payloads that the native Decodable contracts reject", async () => {
    request.mockResolvedValueOnce({ room_name: "room", token: "token" });
    await expect(startGroupCall(7, "voice")).rejects.toThrow("群通话连接响应格式无效");

    request.mockResolvedValueOnce({ active: "true" });
    await expect(getGroupCallStatus(7)).rejects.toThrow("群通话状态响应格式无效");
  });

  it("sends only normalized selected group invitees when starting a call", async () => {
    request.mockResolvedValueOnce(
      credentials({
        room_name: "room-selected",
        call_type: "video",
      }),
    );

    await startGroupCall(7, "video", [" member-b ", "", "member-a", "member-b"]);

    expect(request).toHaveBeenCalledWith("/call/group/7/start", {
      method: "POST",
      body: {
        call_type: "video",
        invitee_user_ids: ["member-b", "member-a"],
      },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
  });

  it("preserves native group-start URL fallback short-circuit decoding", async () => {
    request.mockResolvedValueOnce({
      room_name: "room",
      token: "token",
      livekit_url: "wss://live.example.test/room",
      server_url: 42,
      call_type: "voice",
    });

    await expect(startGroupCall(7, "voice")).resolves.toMatchObject({
      room_name: "room",
      token: "token",
      livekit_url: "wss://live.example.test/room",
      call_type: "voice",
    });
  });

  it("preserves native empty required strings and uses the exact LiveKit fallback", async () => {
    request.mockResolvedValueOnce({
      call_id: "",
      room_name: "",
      token: "",
      livekit_url: "\u0085",
      server_url: "\n",
      call_type: "",
      participant_count: 0,
    });
    await expect(startGroupCall(0, "video")).resolves.toEqual({
      call_id: "",
      room_name: "",
      token: "",
      livekit_url: "wss://id7.com/livekit",
      call_type: "",
      participant_count: 0,
    });
  });

  it("omits only native-empty leave identities and preserves whitespace-only values", async () => {
    request.mockResolvedValue(undefined);
    await leaveGroupCall(0, { callId: "", roomName: "" });
    await leaveGroupCall(0, { callId: " \n", roomName: "\u0085" });
    expect(request).toHaveBeenNthCalledWith(1, "/call/group/0/leave", {
      method: "POST",
      body: {},
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/call/group/0/leave", {
      method: "POST",
      body: { call_id: " \n", room_name: "\u0085" },
      requiredEnvelope: true,
      transientRetries: false,
    });
  });

  it("normalizes HTTP/HTTPS/relative LiveKit servers and rejects other schemes", () => {
    expect(normalizeLiveKitServerURL("https://live.example.test/livekit", "http://api.test")).toBe(
      "wss://live.example.test/livekit",
    );
    expect(normalizeLiveKitServerURL("http://52.193.78.191/livekit", "http://api.test")).toBe(
      "ws://52.193.78.191/livekit",
    );
    expect(normalizeLiveKitServerURL("/livekit", "https://api.example.test/api")).toBe(
      "wss://api.example.test/livekit",
    );
    expect(
      normalizeLiveKitServerURL("\u0085https://live.example.test/livekit\u0085", "http://api.test"),
    ).toBe("wss://live.example.test/livekit");
    expect(() =>
      normalizeLiveKitServerURL("ftp://example.test/livekit", "http://api.test"),
    ).toThrow("通话服务器地址无效");
  });

  it("parses all native incoming aliases for direct and group calls", () => {
    expect(
      parseIncomingCallSignal("call_offer", {
        call_id: "c1",
        room: "room-1",
        media_type: "audio",
        from_user_id: "u1",
        caller_nickname: "Alice",
        avatar: "/a.jpg",
      }),
    ).toEqual({
      call_id: "c1",
      room_name: "room-1",
      call_type: "voice",
      caller_id: "u1",
      caller_name: "Alice",
      caller_avatar: "/a.jpg",
    });
    expect(
      parseIncomingCallSignal("group_call_invite", {
        group_id: "7",
        name: "Friends",
        room_name: "group-room",
        call_type: "video",
        user_id: "u2",
      }),
    ).toMatchObject({ group_id: 7, group_name: "Friends", caller_id: "u2", call_type: "video" });
    expect(
      parseIncomingCallSignal("group_call_invite", {
        group_id: 0,
        group_name: "",
        room_name: "",
        call_type: "AUDIO",
        caller_id: 9,
      }),
    ).toEqual({
      room_name: "",
      call_type: "voice",
      caller_id: "9",
      caller_name: "",
      caller_avatar: "",
      group_id: 0,
      group_name: "",
    });
    expect(
      parseIncomingCallSignal("group_call_invite", {
        group_id: "0.0",
        group_name: "Friends",
        room_name: "room",
        call_type: "video",
      }),
    ).toBeNull();
    expect(
      parseIncomingCallSignal("group_call_invite", {
        group_id: 7,
        group_name: "Friends",
        room_name: "room",
        call_type: " video ",
      }),
    ).toBeNull();
    expect(parseIncomingCallSignal("call_offer", { caller_id: "u1" })).toBeNull();
  });

  it("matches stable call identity, detects duplicates, and builds exact signaling fields", () => {
    const current = session();
    expect(callSignalMatchesSession(current, { call_id: "c1", room_name: "room-1" })).toBe(true);
    expect(callSignalMatchesSession(current, { call_id: "different", room_name: "room-1" })).toBe(
      false,
    );
    expect(
      isDuplicateCallInvite(current, {
        call_id: "c1",
        room_name: "room-1",
        call_type: "voice",
        caller_id: "u1",
        caller_name: "Alice",
        caller_avatar: "",
      }),
    ).toBe(true);
    expect(callSignalPayload(current, "declined")).toEqual({
      target_id: "u1",
      call_id: "c1",
      room_name: "room-1",
      reason: "declined",
    });
  });

  it("matches native group end identity precedence and identity-less compatibility", () => {
    const current = session({ group_id: 0, call_id: " current ", room_name: " room " });
    expect(groupCallEndSignalMatchesSession(current, { group_id: "0" })).toBe(true);
    expect(
      groupCallEndSignalMatchesSession(current, {
        group_id: 0,
        call_id: "current",
        room_name: "different-room",
      }),
    ).toBe(true);
    expect(
      groupCallEndSignalMatchesSession(current, {
        group_id: 0,
        call_id: "stale",
        room_name: "room",
      }),
    ).toBe(false);
    expect(groupCallEndSignalMatchesSession(current, { group_id: null })).toBe(false);
  });

  it("preserves native connected transition and duration rules", () => {
    expect(shouldMarkCallConnected(session(), 1, false)).toBe(false);
    expect(shouldMarkCallConnected(session(), 1, true)).toBe(true);
    expect(
      shouldMarkCallConnected({ ...session(), is_outgoing: false, state: "connecting" }, 0, false),
    ).toBe(true);
    expect(
      shouldMarkCallConnected({ ...session(), group_id: 7, state: "connecting" }, 0, false),
    ).toBe(true);
    expect(shouldMarkCallConnected({ ...session(), state: "connected" }, 1, true)).toBe(false);
    expect(formatCallDuration(0)).toBe("00:00");
    expect(formatCallDuration(125.9)).toBe("02:05");
  });

  it("preserves the exact native inactive group status values", () => {
    expect(normalizeGroupCallStatus({ active: false, participant_count: -1 })).toEqual({
      active: false,
      participant_count: -1,
    });
    expect(
      normalizeGroupCallStatus({ active: true, call_id: " ", room_name: "", call_type: "other" }),
    ).toEqual({ active: true, call_id: " ", room_name: "", call_type: "other" });
  });
});

function credentials(overrides: Record<string, unknown> = {}) {
  return {
    call_id: "call-1",
    room_name: "room-1",
    token: "token-1",
    livekit_url: "https://live.example.test",
    call_type: "video",
    ...overrides,
  };
}

function session(overrides: Partial<CallSession> = {}): CallSession {
  return {
    id: "local-1",
    remote_user_id: "u1",
    remote_nickname: "Alice",
    remote_avatar_url: "",
    call_type: "voice",
    is_outgoing: true,
    state: "outgoing",
    started_at: 1,
    call_id: "c1",
    room_name: "room-1",
    ...overrides,
  };
}
