import { APIError } from "@/api/client";
import { correlateLiveCallEvent, liveCallErrorMessage } from "@/services/live/LiveCallPolicy";

const outgoing = {
  isOutgoing: true,
  callId: "call-1",
  slotId: "slot-1",
  peerUserId: "host-1",
};
const t = (key: string) => `localized:${key}`;

describe("live call native event and business policies", () => {
  it("requires call, slot and host correlation and ignores agent match events", () => {
    expect(
      correlateLiveCallEvent({ call_id: "call-1", slot_id: "slot-1", host_id: "host-1" }, outgoing),
    ).toEqual({ kind: "handle", callId: "call-1" });
    expect(correlateLiveCallEvent({ call_id: "call-1", slot_id: "other" }, outgoing)).toEqual({
      kind: "ignore",
    });
    expect(correlateLiveCallEvent({ call_id: "call-1", host_user_id: "other" }, outgoing)).toEqual({
      kind: "ignore",
    });
    expect(
      correlateLiveCallEvent({ call_id: "call-1", match_id: "agent-match" }, outgoing),
    ).toEqual({ kind: "ignore" });
  });

  it("defers a valid early event until the invite response supplies its call id", () => {
    expect(
      correlateLiveCallEvent(
        { call_id: "early-call", slot_id: "slot-1", host_id: "host-1" },
        { ...outgoing, callId: undefined },
      ),
    ).toEqual({ kind: "defer", callId: "early-call" });
  });

  it("maps every native live business code and preserves explicit server messages", () => {
    expect(
      liveCallErrorMessage(
        new APIError("generic", 400, { code: "LIVE_SELF_CALL_FORBIDDEN" }),
        t,
        "fallback",
      ),
    ).toBe("这是你的直播，其他用户可以从这里与你连线");
    expect(
      liveCallErrorMessage(
        new APIError("generic", 400, { code: "LIVE_CALL_TYPE_NOT_ALLOWED" }),
        t,
        "fallback",
      ),
    ).toBe("该主播未开放这种连线方式");
    expect(
      liveCallErrorMessage(
        new APIError("generic", 400, {
          code: "LIVE_HOST_CANNOT_CALL_OTHER_HOST",
          message: "服务端提示",
        }),
        t,
        "fallback",
      ),
    ).toBe("服务端提示");
    expect(
      liveCallErrorMessage(new APIError("generic", 400, { code: "PROP_EXPIRED" }), t, "fallback"),
    ).toBe("localized:live.experience.error.unavailable");
    expect(
      liveCallErrorMessage(
        new APIError("generic", 400, { code: "LIVE_EXPERIENCE_CARD_BUSY" }),
        t,
        "fallback",
      ),
    ).toBe("localized:live.experience.error.busy");
    expect(
      liveCallErrorMessage(
        new APIError("generic", 400, {
          data: { error_code: "LIVE_EXPERIENCE_CARD_MISMATCH" },
        }),
        t,
        "fallback",
      ),
    ).toBe("localized:live.experience.error.mismatch");
  });
});
