import { act, render, waitFor } from "@testing-library/react-native";

import { AudioSession, LiveKitRoom } from "@livekit/react-native";

import { CallOverlay } from "@/components/calls/CallOverlay";
import type { CallSession } from "@/models";
import { useCall } from "@/providers/CallProvider";

jest.mock("@/providers/CallProvider", () => ({ useCall: jest.fn() }));
jest.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
jest.mock("expo-symbols", () => ({ SymbolView: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("@/components/Avatar", () => ({ Avatar: () => null }));
jest.mock("@livekit/react-native", () => ({
  AndroidAudioTypePresets: { communication: "communication" },
  AudioSession: {
    configureAudio: jest.fn(async () => undefined),
    startAudioSession: jest.fn(async () => undefined),
    stopAudioSession: jest.fn(async () => undefined),
    getAudioOutputs: jest.fn(async () => []),
    selectAudioOutput: jest.fn(async () => undefined),
  },
  isTrackReference: jest.fn(() => false),
  LiveKitRoom: jest.fn(() => null),
  VideoTrack: () => null,
  useConnectionState: jest.fn(),
  useLocalParticipant: jest.fn(),
  useRemoteParticipants: jest.fn(),
  useSpeakingParticipants: jest.fn(),
  useTracks: jest.fn(),
}));

const mockedUseCall = jest.mocked(useCall);
const mockedLiveKitRoom = jest.mocked(LiveKitRoom);

describe("GroupCall LiveKit media host", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(AudioSession.configureAudio).mockResolvedValue(undefined);
    jest.mocked(AudioSession.startAudioSession).mockResolvedValue(undefined);
  });

  it("keeps an interactive call surface visible while LiveKit creates its room context", async () => {
    mockedUseCall.mockReturnValue(callValue({}));

    const view = await render(<CallOverlay />);
    await waitFor(() => expect(mockedLiveKitRoom).toHaveBeenCalled());

    expect(view.getByLabelText("call.end")).toBeTruthy();
    view.unmount();
  });

  it("shows payer and host billing as separate asset rows without a total", async () => {
    mockedUseCall.mockReturnValue({
      ...callValue({}),
      session: liveSession({
        is_outgoing: true,
        confirmed_live_activity_cat_food_charge: 58,
        confirmed_live_gold_coin_charge: 42,
        confirmed_live_total_charge: 100,
      }),
    });
    const payer = await render(<CallOverlay />);
    expect(payer.getByText("live.billing.chargedActivityCatFood")).toBeTruthy();
    expect(payer.getByText("live.billing.chargedGoldCoins")).toBeTruthy();
    expect(payer.queryByText("live.billing.totalCharged")).toBeNull();
    await act(async () => payer.unmount());

    mockedUseCall.mockReturnValue({
      ...callValue({}),
      session: liveSession({
        is_outgoing: false,
        confirmed_live_earning_activity_cat_food: 58,
        confirmed_live_earning_gold_coins: 42,
      }),
    });
    const host = await render(<CallOverlay />);
    expect(host.getByText("live.billing.earnedActivityCatFood")).toBeTruthy();
    expect(host.getByText("live.billing.earnedGoldCoins")).toBeTruthy();
    await act(async () => host.unmount());
  });

  it("keeps the room alive for device failures and synchronizes media controls", async () => {
    const failMedia = jest.fn();
    const setMuted = jest.fn();
    const setCameraEnabled = jest.fn();
    const showError = jest.fn();
    mockedUseCall.mockReturnValue(callValue({ failMedia, setMuted, setCameraEnabled, showError }));

    const view = await render(<CallOverlay />);
    await waitFor(() => expect(mockedLiveKitRoom).toHaveBeenCalled());
    const props = mockedLiveKitRoom.mock.calls.at(-1)?.[0] as
      | {
          onDisconnected?: () => void;
          onError?: (error: Error) => void;
          onMediaDeviceFailure?: (
            failure: string,
            kind?: "audioinput" | "audiooutput" | "videoinput",
          ) => void;
        }
      | undefined;
    if (!props) throw new Error("LiveKitRoom was not rendered");

    props.onMediaDeviceFailure?.("DeviceInUse", "audioinput");
    expect(setMuted).toHaveBeenCalledWith(true);
    expect(showError).toHaveBeenCalledWith("call.error.microphoneUnavailable");
    expect(failMedia).not.toHaveBeenCalled();

    props.onMediaDeviceFailure?.("DeviceInUse", "videoinput");
    expect(setCameraEnabled).toHaveBeenCalledWith(false);
    expect(showError).toHaveBeenCalledWith("call.error.cameraUnavailable");
    expect(failMedia).not.toHaveBeenCalled();

    const mediaError = new Error("camera busy");
    mediaError.name = "TrackStartError";
    props.onError?.(mediaError);
    expect(failMedia).not.toHaveBeenCalled();

    props.onDisconnected?.();
    expect(failMedia).toHaveBeenCalledTimes(1);
    expect(failMedia).toHaveBeenCalledWith();
    view.unmount();
  });

  it("passes a native-decodable empty token into LiveKit so connection failure can close the call", async () => {
    mockedUseCall.mockReturnValue({
      ...callValue({}),
      session: { ...groupSession(), token: "" },
    });

    const view = await render(<CallOverlay />);
    await waitFor(() => expect(mockedLiveKitRoom).toHaveBeenCalled());
    expect(mockedLiveKitRoom.mock.calls.at(-1)?.[0]).toMatchObject({ token: "" });
    view.unmount();
  });
});

function callValue(overrides: Partial<ReturnType<typeof useCall>>): ReturnType<typeof useCall> {
  return {
    session: groupSession(),
    isMinimized: false,
    isMuted: false,
    isSpeakerOn: true,
    isCameraEnabled: true,
    isFrontCamera: true,
    isRemotePrimary: true,
    startDirectCall: jest.fn(async () => undefined),
    startGroupCall: jest.fn(async () => undefined),
    joinGroupCall: jest.fn(async () => undefined),
    connectAcceptedLiveCall: jest.fn(async () => false),
    acceptCall: jest.fn(async () => undefined),
    rejectCall: jest.fn(),
    endCall: jest.fn(),
    minimizeCall: jest.fn(),
    restoreCall: jest.fn(),
    setMuted: jest.fn(),
    setSpeakerOn: jest.fn(),
    setCameraEnabled: jest.fn(),
    setFrontCamera: jest.fn(),
    setRemotePrimary: jest.fn(),
    showError: jest.fn(),
    markMediaConnected: jest.fn(),
    failMedia: jest.fn(),
    ...overrides,
  };
}

function groupSession(): CallSession {
  return {
    id: "group-session",
    remote_user_id: "",
    remote_nickname: "Friends",
    remote_avatar_url: "",
    call_type: "video",
    is_outgoing: true,
    state: "connected",
    started_at: Date.now(),
    connected_at: Date.now(),
    call_id: "group-call",
    room_name: "group-room",
    token: "group-token",
    livekit_url: "wss://live.example.test",
    group_id: 7,
    group_name: "Friends",
  };
}

function liveSession(overrides: Partial<CallSession>): CallSession {
  return {
    id: "live-session",
    remote_user_id: "remote-user",
    remote_nickname: "Remote",
    remote_avatar_url: "/remote.jpg",
    call_type: "voice",
    is_outgoing: true,
    state: "connected",
    started_at: Date.now(),
    connected_at: Date.now() - 65_000,
    call_id: "live-call",
    is_live_pair: true,
    live_billing_policy: {
      currency: "spendable_balance",
      freeSeconds: 0,
      unitSeconds: 60,
      amountPerUnit: 100,
      minimumStartingBalance: 100,
      rounding: "started_unit",
    },
    ...overrides,
  };
}
