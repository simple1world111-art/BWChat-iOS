import { act, render } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { createRef, forwardRef, useImperativeHandle } from "react";
import { AppState, Text } from "react-native";

import * as api from "@/api/bwchat";
import { useAuth } from "@/providers/AuthProvider";
import { CallProvider, useCall } from "@/providers/CallProvider";
import { publishCallSettlementRefresh } from "@/services/calls/CallSettlementRefreshService";
import { getLiveCallState } from "@/services/live/LiveLobbyRepository";
import { captureException } from "@/services/monitoring/MonitoringService";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";
import { refreshWalletBalance } from "@/services/wallet/WalletRepository";

jest.mock("@/api/bwchat", () => ({
  startDirectCall: jest.fn(),
  startGroupCall: jest.fn(),
  joinCall: jest.fn(),
  leaveGroupCall: jest.fn(),
  endCall: jest.fn(),
  rejectCall: jest.fn(),
  markCallBusy: jest.fn(),
}));
jest.mock("@/providers/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    t: (key: string, ...args: unknown[]) => `${key}${args.length ? `:${args.join("|")}` : ""}`,
  }),
}));
jest.mock("@/components/calls/CallOverlay", () => ({ CallOverlay: () => null }));
jest.mock("@/components/TopToast", () => ({ TopToast: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("expo-audio", () => ({ requestRecordingPermissionsAsync: jest.fn() }));
jest.mock("expo-camera", () => ({
  Camera: { requestCameraPermissionsAsync: jest.fn() },
}));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn() }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Warning: "warning" },
  ImpactFeedbackStyle: { Light: "light" },
}));
jest.mock("expo-notifications", () => ({
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}));
jest.mock("@/services/calls/CallSounds", () => ({
  playCallRingPulseAsync: jest.fn(async () => true),
}));
jest.mock("@/services/monitoring/MonitoringService", () => ({ captureException: jest.fn() }));
jest.mock("@/services/realtime/ChatRealtimeService", () => ({
  chatRealtimeService: {
    subscribe: jest.fn(() => jest.fn()),
    subscribeStatus: jest.fn((listener: (status: string) => void) => {
      listener("disconnected");
      return jest.fn();
    }),
    send: jest.fn(),
  },
}));
jest.mock("@/services/calls/CallSettlementRefreshService", () => ({
  publishCallSettlementRefresh: jest.fn(),
}));
jest.mock("@/services/wallet/WalletRepository", () => ({ refreshWalletBalance: jest.fn() }));
jest.mock("@/services/live/LiveLobbyRepository", () => ({ getLiveCallState: jest.fn() }));

const recordingPermission = jest.requireMock("expo-audio")
  .requestRecordingPermissionsAsync as jest.Mock;
const cameraPermission = jest.requireMock("expo-camera").Camera
  .requestCameraPermissionsAsync as jest.Mock;
const randomUUID = jest.requireMock("expo-crypto").randomUUID as jest.Mock;
const mockedUseAuth = jest.mocked(useAuth);
const startGroupCall = jest.mocked(api.startGroupCall);
const startDirectCall = jest.mocked(api.startDirectCall);
const joinCall = jest.mocked(api.joinCall);
const leaveGroupCall = jest.mocked(api.leaveGroupCall);
const endCall = jest.mocked(api.endCall);
const rejectCall = jest.mocked(api.rejectCall);
const markCallBusy = jest.mocked(api.markCallBusy);
const reportError = jest.mocked(captureException);
const getLiveState = jest.mocked(getLiveCallState);
const refreshWallet = jest.mocked(refreshWalletBalance);
const publishSettlement = jest.mocked(publishCallSettlementRefresh);
const actions = createRef<ReturnType<typeof useCall>>();
let ownerId: string | null;

const Harness = forwardRef<ReturnType<typeof useCall>>(function Harness(_props, ref) {
  const call = useCall();
  useImperativeHandle(ref, () => call, [call]);
  return <Text>{call.session ? `${call.session.group_id}:${call.session.state}` : "none"}</Text>;
});

describe("group CallProvider lifecycle parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ownerId = "owner-a";
    mockedUseAuth.mockImplementation(
      () => ({ user: ownerId ? { user_id: ownerId } : null }) as ReturnType<typeof useAuth>,
    );
    recordingPermission.mockResolvedValue({ granted: true });
    cameraPermission.mockResolvedValue({ granted: true });
    randomUUID.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
    leaveGroupCall.mockResolvedValue(undefined);
    endCall.mockResolvedValue(undefined);
    rejectCall.mockResolvedValue(undefined);
    markCallBusy.mockResolvedValue(undefined);
    getLiveState.mockReset();
    refreshWallet.mockReset().mockResolvedValue({
      currency: "gold_coin",
      gold_coin_balance: 0,
      activity_cat_food_balance: 0,
      spendable_balance: 0,
      recharge_gold_coin_balance: 0,
      gift_income_gold_coin_balance: 0,
      withdraw_frozen_gold_coin_balance: 0,
      withdrawable_gold_coin_balance: 0,
      chat_money_frozen_gold_coin_balance: 0,
    });
    publishSettlement.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("starts a group call only after permissions and keeps live role/billing fields isolated", async () => {
    startGroupCall.mockResolvedValue(credentials());
    await render(tree());

    await act(async () => {
      await actions.current?.startGroupCall({ groupId: 7, groupName: "Friends" }, "video");
    });

    expect(recordingPermission).toHaveBeenCalledTimes(1);
    expect(cameraPermission).toHaveBeenCalledTimes(1);
    expect(startGroupCall).toHaveBeenCalledWith(7, "video");
    expect(actions.current?.session).toMatchObject({
      id: "session-1",
      group_id: 7,
      group_name: "Friends",
      is_outgoing: true,
      state: "connecting",
      call_id: "call-7",
      room_name: "room-7",
      livekit_url: "wss://live.example.test/room",
    });
    expect(actions.current?.session).not.toHaveProperty("is_live_pair");
    expect(actions.current?.session).not.toHaveProperty("live_role_setting");
    expect(actions.current?.session).not.toHaveProperty("live_billing_policy");
  });

  it("aborts an outgoing group video call before the API when camera permission is denied", async () => {
    cameraPermission.mockResolvedValue({ granted: false });
    await render(tree());

    await act(async () => {
      await actions.current?.startGroupCall({ groupId: 70, groupName: "Denied" }, "video");
    });

    expect(recordingPermission).toHaveBeenCalledTimes(1);
    expect(cameraPermission).toHaveBeenCalledTimes(1);
    expect(startGroupCall).not.toHaveBeenCalled();
    expect(leaveGroupCall).not.toHaveBeenCalled();
    expect(actions.current?.session).toBeNull();
  });

  it("starts group duration only after the LiveKit room reports connected", async () => {
    startGroupCall.mockResolvedValue(credentials({ call_id: "duration-call" }));
    await render(tree());
    await act(async () => {
      await actions.current?.startGroupCall({ groupId: 71, groupName: "Duration" }, "voice");
    });
    expect(actions.current?.session).toMatchObject({ state: "connecting" });
    expect(actions.current?.session).not.toHaveProperty("connected_at");

    await act(async () => actions.current?.markMediaConnected(0, false));
    expect(actions.current?.session).toMatchObject({ state: "connected" });
    expect(actions.current?.session?.connected_at).toEqual(expect.any(Number));
  });

  it("joins an existing native group room through the shared join endpoint", async () => {
    joinCall.mockResolvedValue(credentials({ call_id: "joined-call" }));
    await render(tree());

    await act(async () => {
      await actions.current?.joinGroupCall(
        { groupId: 8, groupName: "Team", roomName: "existing-room" },
        "voice",
      );
    });

    expect(cameraPermission).not.toHaveBeenCalled();
    expect(joinCall).toHaveBeenCalledWith("existing-room");
    expect(actions.current?.session).toMatchObject({
      group_id: 8,
      group_name: "Team",
      is_outgoing: false,
      state: "connecting",
      call_id: "joined-call",
    });
  });

  it("does not invent a group leave when start fails before native room identity exists", async () => {
    const originalError = new Error("start failed");
    startGroupCall.mockRejectedValue(originalError);
    await render(tree());

    await act(async () => {
      await actions.current?.startGroupCall({ groupId: 9, groupName: "Errors" }, "voice");
      await flushTasks();
    });

    expect(leaveGroupCall).not.toHaveBeenCalled();
    expect(actions.current?.session).toBeNull();
    expect(reportError).toHaveBeenCalledWith(originalError, { operation: "group_call_start" });
  });

  it("treats an error-free server room close as a normal leave without a connection error", async () => {
    startGroupCall.mockResolvedValue(credentials({ call_id: "server-closed" }));
    await render(tree());
    await act(async () => {
      await actions.current?.startGroupCall({ groupId: 74, groupName: "Server Close" }, "voice");
      actions.current?.failMedia();
      await flushTasks();
    });

    expect(actions.current?.session).toBeNull();
    expect(leaveGroupCall).toHaveBeenCalledTimes(1);
    expect(leaveGroupCall).toHaveBeenCalledWith(74, {
      callId: "server-closed",
      roomName: "room-7",
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("ends an old-owner call locally and ignores its late response after A to B switching", async () => {
    const response = deferred<ReturnType<typeof credentials>>();
    startGroupCall.mockReturnValue(response.promise);
    const view = await render(tree());
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = actions.current?.startGroupCall({ groupId: 10, groupName: "Scoped" }, "voice");
      await flushTasks();
    });
    expect(actions.current?.session?.group_id).toBe(10);

    ownerId = "owner-b";
    await view.rerender(tree());
    expect(actions.current?.session).toBeNull();

    await act(async () => {
      response.resolve(credentials());
      await pending;
    });
    expect(actions.current?.session).toBeNull();
    expect(leaveGroupCall).not.toHaveBeenCalled();
  });

  it("keeps a new A room isolated from an old response across A to B to A switching", async () => {
    const oldResponse = deferred<ReturnType<typeof credentials>>();
    startGroupCall
      .mockReturnValueOnce(oldResponse.promise)
      .mockResolvedValueOnce(credentials({ call_id: "new-a-call", room_name: "new-a-room" }));
    const view = await render(tree());
    let oldPending: Promise<void> | undefined;
    await act(async () => {
      oldPending = actions.current?.startGroupCall({ groupId: 75, groupName: "Old A" }, "voice");
      await flushTasks();
    });

    ownerId = "owner-b";
    await view.rerender(tree());
    ownerId = "owner-a";
    await view.rerender(tree());
    await act(async () => {
      await actions.current?.startGroupCall({ groupId: 76, groupName: "New A" }, "video");
    });
    expect(actions.current?.session).toMatchObject({
      group_id: 76,
      call_id: "new-a-call",
      room_name: "new-a-room",
    });

    await act(async () => {
      oldResponse.resolve(credentials({ call_id: "old-a-call", room_name: "old-a-room" }));
      await oldPending;
    });
    expect(actions.current?.session).toMatchObject({
      group_id: 76,
      call_id: "new-a-call",
      room_name: "new-a-room",
    });
    expect(leaveGroupCall).not.toHaveBeenCalled();
  });

  it("tears down an established group room locally without using the next account token", async () => {
    startGroupCall.mockResolvedValue(credentials({ call_id: "owner-a-call" }));
    const view = await render(tree());
    await act(async () => {
      await actions.current?.startGroupCall({ groupId: 72, groupName: "Owner A" }, "voice");
    });
    expect(actions.current?.session?.group_id).toBe(72);

    ownerId = "owner-b";
    await view.rerender(tree());

    expect(actions.current?.session).toBeNull();
    expect(leaveGroupCall).not.toHaveBeenCalled();
  });

  it("sends call and room identity exactly once when the current owner hangs up", async () => {
    startGroupCall.mockResolvedValue(credentials());
    await render(tree());
    await act(async () => {
      await actions.current?.startGroupCall({ groupId: 11, groupName: "Hangup" }, "voice");
    });

    await act(async () => {
      actions.current?.minimizeCall();
    });
    expect(actions.current?.isMinimized).toBe(true);
    await act(async () => {
      actions.current?.restoreCall();
    });
    expect(actions.current?.isMinimized).toBe(false);

    await act(async () => {
      actions.current?.endCall();
    });
    expect(leaveGroupCall).toHaveBeenCalledTimes(1);
    expect(leaveGroupCall).toHaveBeenCalledWith(11, {
      callId: "call-7",
      roomName: "room-7",
    });
    expect(actions.current?.session).toBeNull();
  });

  it("claims an incoming group invite synchronously so a double answer joins only once", async () => {
    joinCall.mockResolvedValue(credentials({ call_id: "incoming-call" }));
    await render(tree());
    await sendGroupSignal("group_call_invite", {
      call_id: "incoming-call",
      group_id: 12,
      group_name: "Incoming",
      room_name: "incoming-room",
      call_type: "video",
      caller_id: "caller",
    });
    expect(actions.current?.session).toMatchObject({
      group_id: 12,
      state: "incoming",
      is_outgoing: false,
    });

    await act(async () => {
      await Promise.all([actions.current?.acceptCall(), actions.current?.acceptCall()]);
    });

    expect(joinCall).toHaveBeenCalledTimes(1);
    expect(joinCall).toHaveBeenCalledWith("incoming-room");
    expect(actions.current?.session).toMatchObject({
      call_id: "incoming-call",
      state: "connecting",
    });
  });

  it("normalizes native nested notification containers with top-level precedence", async () => {
    await render(tree());
    const listener = jest
      .mocked(Notifications.addNotificationReceivedListener)
      .mock.calls.at(-1)?.[0];
    if (!listener) throw new Error("CallProvider notification listener was not installed");

    await act(async () => {
      listener({
        request: {
          content: {
            data: {
              push_type: "group_call",
              group_id: 31,
              notification_data: JSON.stringify({
                group_id: 99,
                group_name: "Nested Group",
                room_name: "nested-room",
                call_type: "voice",
                call_id: "nested-call",
              }),
            },
          },
        },
      } as never);
    });

    expect(actions.current?.session).toMatchObject({
      group_id: 31,
      group_name: "Nested Group",
      room_name: "nested-room",
      call_type: "voice",
      call_id: "nested-call",
      state: "incoming",
    });
  });

  it("accepts the native group-id-zero and empty room/name invite shape", async () => {
    joinCall.mockResolvedValue(credentials({ call_id: "zero-call" }));
    await render(tree());
    await sendGroupSignal("group_call_invite", {
      group_id: 0,
      group_name: "",
      room_name: "",
      call_type: "voice",
    });
    expect(actions.current?.session).toMatchObject({
      group_id: 0,
      group_name: "",
      room_name: "",
      state: "incoming",
    });

    await act(async () => {
      await actions.current?.acceptCall();
    });

    expect(joinCall).toHaveBeenCalledWith("");
    expect(actions.current?.session).toMatchObject({ group_id: 0, call_id: "zero-call" });
  });

  it("does not invent direct-call busy signaling for a competing group invite", async () => {
    startDirectCall.mockResolvedValue(credentials({ call_id: "active-direct" }));
    await render(tree());
    await act(async () => {
      await actions.current?.startDirectCall({ userId: "friend", nickname: "Friend" }, "voice");
    });

    await sendGroupSignal("group_call_invite", {
      call_id: "competing-group",
      group_id: 73,
      group_name: "Competing",
      room_name: "competing-room",
      call_type: "voice",
      caller_id: "group-caller",
    });

    expect(actions.current?.session).toMatchObject({ call_id: "active-direct" });
    expect(chatRealtimeService.send).not.toHaveBeenCalledWith("call_busy", expect.anything());
    expect(markCallBusy).not.toHaveBeenCalled();
  });

  it("closes only the matching group-ended identity and ignores stale room events", async () => {
    await render(tree());
    await sendGroupSignal("group_call_invite", {
      call_id: "current-call",
      group_id: 13,
      group_name: "Identity",
      room_name: "current-room",
      call_type: "voice",
    });

    await sendGroupSignal("group_call_ended", {
      call_id: "stale-call",
      group_id: 13,
      room_name: "stale-room",
    });
    expect(actions.current?.session?.group_id).toBe(13);

    await sendGroupSignal("group_call_ended", {
      call_id: "current-call",
      group_id: 13,
      room_name: "different-room",
    });
    expect(actions.current?.session).toBeNull();
    await sendGroupSignal("group_call_ended", {
      call_id: "current-call",
      group_id: 13,
      room_name: "current-room",
    });
    expect(leaveGroupCall).not.toHaveBeenCalled();
  });

  it("deduplicates the same group invite and silently ignores a competing group room", async () => {
    await render(tree());
    await sendGroupSignal("group_call_invite", {
      call_id: "group-current",
      group_id: 77,
      group_name: "Current Group",
      room_name: "group-current-room",
      call_type: "voice",
    });
    const sessionId = actions.current?.session?.id;

    await sendGroupSignal("group_call_invite", {
      call_id: "group-current",
      group_id: 77,
      group_name: "Current Group",
      room_name: "group-current-room",
      call_type: "voice",
    });
    await sendGroupSignal("group_call_invite", {
      call_id: "group-competing",
      group_id: 78,
      group_name: "Competing Group",
      room_name: "group-competing-room",
      call_type: "video",
    });

    expect(actions.current?.session?.id).toBe(sessionId);
    expect(actions.current?.session).toMatchObject({ group_id: 77, call_id: "group-current" });
    expect(chatRealtimeService.send).not.toHaveBeenCalledWith("call_busy", expect.anything());
    expect(markCallBusy).not.toHaveBeenCalled();
  });

  it("ends a permission-denied incoming group invite locally without inventing a leave", async () => {
    recordingPermission.mockResolvedValue({ granted: false });
    await render(tree());
    await sendGroupSignal("group_call_invite", {
      call_id: "denied-call",
      group_id: 14,
      group_name: "Denied",
      room_name: "denied-room",
      call_type: "voice",
    });

    await act(async () => {
      await actions.current?.acceptCall();
    });

    expect(joinCall).not.toHaveBeenCalled();
    expect(leaveGroupCall).not.toHaveBeenCalled();
    expect(actions.current?.session).toBeNull();
  });

  it("starts a normal friend call with the native outgoing and credential state", async () => {
    startDirectCall.mockResolvedValue(credentials({ call_id: "friend-call" }));
    await render(tree());

    await act(async () => {
      await actions.current?.startDirectCall(
        { userId: "friend-1", nickname: "Alice", avatarUrl: "/alice.jpg" },
        "video",
      );
    });

    expect(startDirectCall).toHaveBeenCalledWith("friend-1", "video");
    expect(actions.current?.session).toMatchObject({
      call_id: "friend-call",
      remote_user_id: "friend-1",
      remote_nickname: "Alice",
      remote_avatar_url: "/alice.jpg",
      is_outgoing: true,
      state: "outgoing",
    });
    expect(actions.current?.session).not.toHaveProperty("is_live_pair");
  });

  it("requests microphone then camera and aborts outgoing video when camera access is denied", async () => {
    cameraPermission.mockResolvedValue({ granted: false });
    await render(tree());

    await act(async () => {
      await actions.current?.startDirectCall(
        { userId: "friend-denied", nickname: "Denied" },
        "video",
      );
    });

    expect(recordingPermission).toHaveBeenCalledTimes(1);
    expect(cameraPermission).toHaveBeenCalledTimes(1);
    expect(recordingPermission.mock.invocationCallOrder[0]).toBeLessThan(
      cameraPermission.mock.invocationCallOrder[0]!,
    );
    expect(startDirectCall).not.toHaveBeenCalled();
    expect(actions.current?.session).toBeNull();
  });

  it("rejects a permission-denied incoming friend call over native signaling without joining", async () => {
    recordingPermission.mockResolvedValue({ granted: false });
    await render(tree());
    await sendDirectSignal("call_invite", {
      call_id: "denied-direct",
      caller_id: "friend-denied",
      caller_name: "Denied",
      room_name: "denied-room",
      call_type: "video",
    });

    await act(async () => {
      await actions.current?.acceptCall();
    });

    expect(chatRealtimeService.send).toHaveBeenCalledWith("call_reject", {
      target_id: "friend-denied",
      call_id: "denied-direct",
      room_name: "denied-room",
      reason: "permission_denied",
    });
    expect(cameraPermission).not.toHaveBeenCalled();
    expect(joinCall).not.toHaveBeenCalled();
    expect(rejectCall).not.toHaveBeenCalled();
    expect(actions.current?.session).toBeNull();
  });

  it("uses the exact 45-second unanswered timeout with websocket and HTTP end fallbacks", async () => {
    jest.useFakeTimers();
    startDirectCall.mockResolvedValue(credentials({ call_id: "timeout-call" }));
    await render(tree());
    await act(async () => {
      await actions.current?.startDirectCall({ userId: "friend-2", nickname: "Bob" }, "voice");
    });

    await act(async () => {
      jest.advanceTimersByTime(44_999);
    });
    expect(actions.current?.session).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    expect(chatRealtimeService.send).toHaveBeenCalledWith("call_end", {
      target_id: "friend-2",
      call_id: "timeout-call",
      room_name: "room-7",
    });
    expect(endCall).toHaveBeenCalledWith("timeout-call");
    expect(actions.current?.session).toBeNull();
  });

  it("deduplicates the same invite and replies busy to a different direct call", async () => {
    await render(tree());
    await sendDirectSignal("call_invite", {
      call_id: "current-direct",
      caller_id: "friend-3",
      caller_name: "Carol",
      room_name: "current-room",
      call_type: "voice",
    });
    const sessionId = actions.current?.session?.id;
    await sendDirectSignal("call_offer", {
      call_id: "current-direct",
      caller_id: "friend-3",
      caller_name: "Carol",
      room_name: "current-room",
      call_type: "audio",
    });
    expect(actions.current?.session?.id).toBe(sessionId);
    expect(markCallBusy).not.toHaveBeenCalled();

    await sendDirectSignal("call_invite", {
      call_id: "busy-direct",
      caller_id: "friend-4",
      caller_name: "Dave",
      room_name: "busy-room",
      call_type: "video",
    });
    expect(chatRealtimeService.send).toHaveBeenCalledWith("call_busy", {
      target_id: "friend-4",
      call_id: "busy-direct",
      room_name: "busy-room",
    });
    expect(markCallBusy).toHaveBeenCalledWith("busy-direct");
    expect(actions.current?.session?.id).toBe(sessionId);
  });

  it("rejects a friend invite with both native signaling fallbacks", async () => {
    await render(tree());
    await sendDirectSignal("call_invite", {
      call_id: "reject-direct",
      caller_id: "friend-5",
      caller_name: "Eve",
      room_name: "reject-room",
      call_type: "voice",
    });

    await act(async () => actions.current?.rejectCall());
    expect(chatRealtimeService.send).toHaveBeenCalledWith("call_reject", {
      target_id: "friend-5",
      call_id: "reject-direct",
      room_name: "reject-room",
      reason: "declined",
    });
    expect(rejectCall).toHaveBeenCalledWith("reject-direct");
    expect(actions.current?.session).toBeNull();
  });

  it("best-effort ends an identified direct room when joining or media fails", async () => {
    const originalError = new Error("join failed");
    const fallbackError = new Error("end failed");
    joinCall.mockRejectedValue(originalError);
    endCall.mockRejectedValue(fallbackError);
    await render(tree());
    await sendDirectSignal("call_invite", {
      call_id: "failed-direct",
      caller_id: "friend-6",
      caller_name: "Frank",
      room_name: "failed-room",
      call_type: "voice",
    });

    await act(async () => {
      await actions.current?.acceptCall();
    });

    expect(chatRealtimeService.send).toHaveBeenCalledWith("call_end", {
      target_id: "friend-6",
      call_id: "failed-direct",
      room_name: "failed-room",
    });
    expect(endCall).toHaveBeenCalledWith("failed-direct");
    expect(reportError).toHaveBeenCalledWith(originalError, { operation: "call_join" });
    await flushTasks();
    expect(reportError).toHaveBeenCalledWith(fallbackError, {
      operation: "call_join_call_end",
    });
    expect(actions.current?.session).toBeNull();
  });

  it("does not let a late direct-start callback end or populate the next account", async () => {
    const response = deferred<ReturnType<typeof credentials>>();
    startDirectCall.mockReturnValue(response.promise);
    const view = await render(tree());
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = actions.current?.startDirectCall(
        { userId: "friend-7", nickname: "Grace" },
        "voice",
      );
      await flushTasks();
    });
    ownerId = "owner-b";
    await view.rerender(tree());

    await act(async () => {
      response.resolve(credentials({ call_id: "old-owner-call" }));
      await pending;
    });
    expect(actions.current?.session).toBeNull();
    expect(endCall).not.toHaveBeenCalled();
    expect(chatRealtimeService.send).not.toHaveBeenCalledWith("call_end", expect.anything());
  });

  it("does not let a late accepted-call join response populate a switched account", async () => {
    const response = deferred<ReturnType<typeof credentials>>();
    joinCall.mockReturnValue(response.promise);
    const view = await render(tree());
    await sendDirectSignal("call_invite", {
      call_id: "old-incoming",
      caller_id: "friend-old",
      caller_name: "Old Friend",
      room_name: "old-room",
      call_type: "voice",
    });
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = actions.current?.acceptCall();
      await flushTasks();
    });

    ownerId = "owner-b";
    await view.rerender(tree());
    await act(async () => {
      response.resolve(credentials({ call_id: "old-incoming" }));
      await pending;
    });

    expect(actions.current?.session).toBeNull();
    expect(endCall).not.toHaveBeenCalled();
    expect(publishSettlement).not.toHaveBeenCalled();
  });

  it("persists the swapped primary video through minimize/restore and resets it on teardown", async () => {
    startDirectCall.mockResolvedValue(credentials({ call_id: "swap-call" }));
    await render(tree());
    await act(async () => {
      await actions.current?.startDirectCall({ userId: "friend-8", nickname: "Heidi" }, "video");
      actions.current?.setRemotePrimary(false);
      actions.current?.minimizeCall();
    });
    expect(actions.current?.isRemotePrimary).toBe(false);
    expect(actions.current?.isMinimized).toBe(true);

    await act(async () => actions.current?.restoreCall());
    expect(actions.current?.isRemotePrimary).toBe(false);
    await act(async () => actions.current?.endCall());
    expect(actions.current?.isRemotePrimary).toBe(true);
  });

  it("reconciles a live remote end with authoritative insufficient billing before graceful teardown", async () => {
    jest.useFakeTimers();
    getLiveState.mockResolvedValue(
      liveState({
        endReason: "billing_insufficient",
        terminationGraceMilliseconds: 2_600,
        finalBilling: {
          chargedActivityCatFood: 20,
          chargedGoldCoins: 80,
          totalCharged: 100,
          goldCoinBalanceAfter: 10,
          activityCatFoodBalanceAfter: 0,
          spendableBalanceAfter: 10,
          billingStatus: "billing_insufficient",
        },
      }),
    );
    await render(tree());
    await connectLiveCall();
    const liveSessionId = actions.current?.session?.id;

    await sendCallSignal("call_end", { call_id: "live-call", room_name: "live-room" });
    await act(flushTasks);

    expect(getLiveState).toHaveBeenCalledWith("live-call");
    expect(actions.current?.session).toMatchObject({
      live_ending_message: "金币余额不足，本次视频即将结束",
      confirmed_live_activity_cat_food_charge: 20,
      confirmed_live_gold_coin_charge: 80,
      confirmed_live_total_charge: 100,
    });
    expect(endCall).not.toHaveBeenCalled();

    refreshWallet.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(2_600);
      await flushTasks();
    });
    expect(actions.current?.session).toBeNull();
    expect(refreshWallet).toHaveBeenCalledTimes(1);
    expect(refreshWallet).toHaveBeenCalledWith("owner-a");
    expect(publishSettlement).toHaveBeenCalledTimes(1);
    expect(publishSettlement).toHaveBeenCalledWith("owner-a", liveSessionId);
  });

  it("waits the native 800ms reconciliation window for a generic live remote end", async () => {
    jest.useFakeTimers();
    getLiveState.mockResolvedValue(liveState());
    await render(tree());
    await connectLiveCall();

    await sendCallSignal("call_end", { call_id: "live-call" });
    await act(flushTasks);
    await act(async () => jest.advanceTimersByTime(799));
    expect(actions.current?.session).not.toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1);
      await flushTasks();
    });
    expect(actions.current?.session).toBeNull();
    expect(endCall).not.toHaveBeenCalled();
    expect(chatRealtimeService.send).not.toHaveBeenCalledWith("call_end", expect.anything());
    expect(publishSettlement).toHaveBeenCalledTimes(1);
  });

  it("coalesces repeated live media failures and publishes final settlement once", async () => {
    jest.useFakeTimers();
    const failure = new Error("media disconnected");
    getLiveState.mockResolvedValue(liveState());
    await render(tree());
    await connectLiveCall();

    await act(async () => {
      actions.current?.failMedia(failure);
      actions.current?.failMedia(new Error("duplicate"));
      await flushTasks();
    });
    expect(getLiveState).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(800);
      await flushTasks();
    });
    expect(endCall).toHaveBeenCalledTimes(1);
    expect(endCall).toHaveBeenCalledWith("live-call");
    expect(reportError).toHaveBeenCalledWith(failure, {
      operation: "live_call_media_connection",
    });
    expect(publishSettlement).toHaveBeenCalledTimes(1);
    expect(refreshWallet).toHaveBeenCalledTimes(1);
  });

  it("keeps final prop settlement publication independent from a wallet refresh failure", async () => {
    refreshWallet.mockRejectedValue(new Error("wallet unavailable"));
    await render(tree());
    await connectLiveCall();

    await act(async () => {
      actions.current?.endCall();
      await flushTasks();
    });

    expect(actions.current?.session).toBeNull();
    expect(refreshWallet).toHaveBeenCalledWith("owner-a");
    expect(publishSettlement).toHaveBeenCalledTimes(1);
  });

  it("applies valid payer billing and experience updates but rejects inconsistent totals", async () => {
    await render(tree());
    await connectLiveCall();

    await sendLiveSignal("one_to_one_live.billing_updated", {
      call_id: "live-call",
      charged_activity_cat_food: 25,
      charged_gold_coins: 75,
      total_charged: 100,
      gold_coin_balance_after: 400,
      activity_cat_food_balance_after: 50,
      spendable_balance_after: 450,
      live_experience: {
        definition_id: "live_experience_card_10m",
        duration_seconds: 600,
        status: "active",
        remaining_seconds: 500,
      },
    });

    expect(actions.current?.session).toMatchObject({
      confirmed_live_activity_cat_food_charge: 25,
      confirmed_live_gold_coin_charge: 75,
      confirmed_live_total_charge: 100,
      live_experience: {
        definitionId: "live_experience_card_10m",
        durationSeconds: 600,
        status: "active",
      },
    });
    expect(refreshWallet).toHaveBeenCalledWith("owner-a");

    await sendLiveSignal("one_to_one_live.billing_updated", {
      call_id: "live-call",
      charged_activity_cat_food: 50,
      charged_gold_coins: 50,
      total_charged: 101,
    });
    expect(actions.current?.session?.confirmed_live_total_charge).toBe(100);
  });

  it("keeps host earnings distinct from payer charges", async () => {
    await render(tree());
    await act(async () => {
      await actions.current?.connectAcceptedLiveCall(
        { userId: "viewer", nickname: "Viewer" },
        credentials({ call_id: "host-live", room_name: "host-room" }),
        "voice",
        false,
      );
    });

    await sendLiveSignal("one_to_one_live.billing_updated", {
      call_id: "host-live",
      earned_gold_coins: 88,
      total_charged: 100,
      charged_activity_cat_food: 0,
      charged_gold_coins: 100,
    });

    expect(actions.current?.session).toMatchObject({
      confirmed_live_earning_gold_coins: 88,
    });
    expect(actions.current?.session).not.toHaveProperty("confirmed_live_total_charge");
    expect(refreshWallet).not.toHaveBeenCalled();
  });

  it("drops a late live reconciliation after A to B account switching", async () => {
    jest.useFakeTimers();
    const response = deferred<ReturnType<typeof liveState>>();
    getLiveState.mockReturnValue(response.promise);
    const view = await render(tree());
    await connectLiveCall();
    await sendCallSignal("call_end", { call_id: "live-call" });

    ownerId = "owner-b";
    await view.rerender(tree());
    expect(actions.current?.session).toBeNull();

    await act(async () => {
      response.resolve(liveState({ endReason: "billing_insufficient" }));
      await response.promise;
      await flushTasks();
    });
    await act(async () => {
      jest.advanceTimersByTime(800);
      await flushTasks();
    });
    expect(endCall).not.toHaveBeenCalled();
    expect(publishSettlement).not.toHaveBeenCalled();
    expect(refreshWallet).not.toHaveBeenCalled();
  });

  it("refreshes authoritative live state after websocket reconnection", async () => {
    getLiveState.mockResolvedValue(liveState({ endReason: "billing_insufficient" }));
    await render(tree());
    await connectLiveCall();

    const subscribeStatus = jest.mocked(chatRealtimeService.subscribeStatus);
    const statusListener = subscribeStatus.mock.calls.at(-1)?.[0];
    if (!statusListener) throw new Error("CallProvider status listener was not installed");
    await act(async () => {
      statusListener("connected");
      await flushTasks();
    });

    expect(getLiveState).toHaveBeenCalledWith("live-call");
    expect(actions.current?.session?.live_ending_message).toBe("金币余额不足，本次视频即将结束");
  });

  it("refreshes live state when the app returns to the foreground", async () => {
    const listeners: ((state: string) => void)[] = [];
    const appStateSpy = jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_, listener) => {
        listeners.push(listener as (state: string) => void);
        return { remove: jest.fn() };
      });
    getLiveState.mockResolvedValue(liveState({ endReason: "billing_insufficient" }));
    await render(tree());
    await connectLiveCall();

    await act(async () => {
      listeners.at(-1)?.("background");
      listeners.at(-1)?.("active");
      await flushTasks();
    });

    expect(getLiveState).toHaveBeenCalledWith("live-call");
    expect(actions.current?.session?.live_ending_message).toBe("金币余额不足，本次视频即将结束");
    appStateSpy.mockRestore();
  });
});

function tree(): React.JSX.Element {
  return (
    <CallProvider>
      <Harness ref={actions} />
    </CallProvider>
  );
}

function credentials(overrides: Record<string, unknown> = {}) {
  return {
    call_id: "call-7",
    room_name: "room-7",
    token: "token-7",
    livekit_url: "https://live.example.test/room",
    call_type: "video" as const,
    ...overrides,
  };
}

async function connectLiveCall(): Promise<void> {
  await act(async () => {
    await actions.current?.connectAcceptedLiveCall(
      { userId: "live-friend", nickname: "Live Friend" },
      credentials({ call_id: "live-call", room_name: "live-room" }),
      "video",
      true,
    );
  });
}

function liveState(overrides: Record<string, unknown> = {}) {
  return {
    callId: "live-call",
    callType: "video" as const,
    status: "active",
    phase: "accepted" as const,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function sendGroupSignal(
  signalType: "group_call_invite" | "group_call_ended",
  data: Record<string, unknown>,
): Promise<void> {
  const subscribe = jest.mocked(chatRealtimeService.subscribe);
  const listener = subscribe.mock.calls.at(-1)?.[0];
  if (!listener) throw new Error("CallProvider realtime listener was not installed");
  await act(async () => {
    listener({ type: "call_signal", signal_type: signalType, data });
  });
}

async function sendDirectSignal(
  signalType: "call_invite" | "call_offer",
  data: Record<string, unknown>,
): Promise<void> {
  const subscribe = jest.mocked(chatRealtimeService.subscribe);
  const listener = subscribe.mock.calls.at(-1)?.[0];
  if (!listener) throw new Error("CallProvider realtime listener was not installed");
  await act(async () => {
    listener({ type: "call_signal", signal_type: signalType, data });
  });
}

async function sendCallSignal(signalType: string, data: Record<string, unknown>): Promise<void> {
  const subscribe = jest.mocked(chatRealtimeService.subscribe);
  const listener = subscribe.mock.calls.at(-1)?.[0];
  if (!listener) throw new Error("CallProvider realtime listener was not installed");
  await act(async () => {
    listener({ type: "call_signal", signal_type: signalType, data });
  });
}

async function sendLiveSignal(signalType: string, data: Record<string, unknown>): Promise<void> {
  const subscribe = jest.mocked(chatRealtimeService.subscribe);
  const listener = subscribe.mock.calls.at(-1)?.[0];
  if (!listener) throw new Error("CallProvider realtime listener was not installed");
  await act(async () => {
    listener({ type: "live_signal", signal_type: signalType, data });
  });
}
