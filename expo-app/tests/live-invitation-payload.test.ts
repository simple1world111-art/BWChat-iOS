import { normalizeLiveInvitationPayload } from "@/services/live/LiveInvitationPayload";

describe("live invitation payload compatibility", () => {
  it("flattens JSON-string invitation/caller/call payloads into native canonical fields", () => {
    expect(normalizeLiveInvitationPayload({
      invitation: JSON.stringify({ slotId: "slot-1", call: "unused" }),
      call: JSON.stringify({ id: "call-1", callType: "audio", billingPolicy: { unit_seconds: 60 }, liveExperience: { definition_id: "live_experience_card_10m" } }),
      caller: JSON.stringify({ userId: "u-1", nickname: "Alice", avatar: "/a.jpg", role_setting: "Detective" }),
    })).toMatchObject({
      call_id: "call-1",
      caller_id: "u-1",
      slot_id: "slot-1",
      caller_username: "Alice",
      caller_avatar_url: "/a.jpg",
      character_setting: "Detective",
      call_type: "audio",
      billing_policy: { unit_seconds: 60 },
      live_experience: { definition_id: "live_experience_card_10m" },
    });
  });

  it("keeps explicit root values ahead of nested compatibility aliases", () => {
    expect(normalizeLiveInvitationPayload({
      call_id: "root-call",
      caller_id: "root-user",
      data: { call_id: "nested-call", caller_id: "nested-user" },
    })).toMatchObject({ call_id: "root-call", caller_id: "root-user" });
  });
});
