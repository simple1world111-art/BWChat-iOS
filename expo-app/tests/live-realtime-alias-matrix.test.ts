import { parseChatRealtimeEnvelope } from "@/services/realtime/ChatRealtimeService";

const canonicalLiveSignals = [
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
] as const;

describe("one-to-one live WebSocket alias matrix", () => {
  it.each(canonicalLiveSignals)("routes %s through the isolated live channel", (type) => {
    const data = { call_id: "call-1", slot_id: "slot-1" };
    expect(parseChatRealtimeEnvelope({ type, data })).toEqual([{
      type: "live_signal",
      signal_type: type,
      data,
    }]);
  });

  it("routes only legacy live call_invite payloads away from ordinary friend calls", () => {
    expect(parseChatRealtimeEnvelope({
      type: "call_invite",
      data: { call_id: "live-1", slot_id: "slot-1" },
    })[0]).toMatchObject({ type: "live_signal", signal_type: "call_invite" });
    expect(parseChatRealtimeEnvelope({
      type: "call_invite",
      data: { call_id: "friend-1", caller_id: "user-1", room_name: "room-1" },
    })[0]).toMatchObject({ type: "call_signal", signal_type: "call_invite" });
  });
});
