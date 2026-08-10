import {
  CallNotificationBridge,
  decodeCallNotification,
} from "@/services/calls/CallNotificationBridge";

describe("call notification bridge", () => {
  it("replays a notification tap that arrives before the call UI subscribes", () => {
    const bridge = new CallNotificationBridge();
    const invitation = jest.fn(() => true);

    expect(bridge.publish(directPush()).kind).toBe("published");
    bridge.subscribe(invitation);

    expect(invitation).toHaveBeenCalledWith(
      expect.objectContaining({
        call_id: "call-1",
        caller_id: "caller-1",
        call_type: "video",
        room_name: "room-1",
      }),
    );
  });

  it("keeps the invitation pending until an authenticated consumer accepts it", () => {
    const bridge = new CallNotificationBridge();
    const unavailable = jest.fn(() => false);
    const authenticated = jest.fn(() => true);
    bridge.subscribe(unavailable);

    bridge.publish(directPush());
    bridge.subscribe(authenticated);

    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(authenticated).toHaveBeenCalledTimes(1);
  });

  it("normalizes nested camelCase direct and group notification payloads", () => {
    expect(
      decodeCallNotification({
        pushType: "call_invite",
        data: JSON.stringify({
          callId: "direct-call",
          callerId: "direct-caller",
          callerName: "Direct Caller",
          roomName: "direct-room",
          callType: "audio",
        }),
      }),
    ).toMatchObject({
      kind: "published",
      invitation: {
        call_id: "direct-call",
        caller_id: "direct-caller",
        caller_name: "Direct Caller",
        room_name: "direct-room",
        call_type: "voice",
      },
    });
    expect(
      decodeCallNotification({
        eventType: "group_call",
        payload: {
          callId: "group-call",
          groupId: "42",
          groupName: "Group 42",
          roomName: "group-room",
          mediaType: "video",
        },
      }),
    ).toMatchObject({
      kind: "published",
      invitation: {
        call_id: "group-call",
        group_id: 42,
        group_name: "Group 42",
        room_name: "group-room",
        call_type: "video",
      },
    });
  });

  it("reports the backend fields required to reconstruct an incoming call", () => {
    expect(decodeCallNotification({ push_type: "call", call_id: "call-1" })).toEqual({
      kind: "invalid",
      missingFields: ["room_name", "call_type", "caller_id"],
      pushType: "call",
    });
    expect(decodeCallNotification({ push_type: "group_call", call_id: "call-2" })).toEqual({
      kind: "invalid",
      missingFields: ["room_name", "call_type", "group_id", "group_name"],
      pushType: "group_call",
    });
  });
});

function directPush(): Record<string, unknown> {
  return {
    push_type: "call",
    call_id: "call-1",
    caller_id: "caller-1",
    caller_name: "Caller",
    room_name: "room-1",
    call_type: "video",
  };
}
