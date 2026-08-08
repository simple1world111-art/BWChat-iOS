import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { LiveCallProvider, useLiveCall } from "@/providers/LiveCallProvider";
import type { LiveLobbyParticipant } from "@/services/live/LiveLobbyModels";

let mockOwnerId = "owner-a";
let mockRealtimeListener: ((event: Record<string, unknown>) => void) | undefined;
let mockUuid = 0;
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
const mockConnect = jest.fn();
const mockApplyReservation = jest.fn();
const mockLoadInventory = jest.fn();
const mockRefreshWallet = jest.fn();
const mockRequestLiveCall = jest.fn();
const mockAcceptLiveCall = jest.fn();
const mockJoinAcceptedLiveCall = jest.fn();
const mockGetLiveCallState = jest.fn();
const mockRejectLiveCall = jest.fn();
const mockCancelLiveCall = jest.fn();

jest.mock("expo-blur", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { BlurView: (props: object) => <MockView {...props} /> };
});

jest.mock("expo-crypto", () => ({ randomUUID: () => `live-key-${++mockUuid}` }));

jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    dismissAll: () => mockDismissAll(),
  },
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@/components/Avatar", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Avatar: (props: object) => <MockView {...props} /> };
});

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { TopToast: ({ message }: { message: string }) => <MockText>{message}</MockText> };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockOwnerId ? { user_id: mockOwnerId } : null }),
}));

jest.mock("@/providers/CallProvider", () => ({
  useCall: () => ({ session: null, connectAcceptedLiveCall: mockConnect }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

jest.mock("@/providers/PropInventoryProvider", () => ({
  usePropInventory: () => ({
    applyLiveExperienceReservation: mockApplyReservation,
    load: mockLoadInventory,
  }),
}));

jest.mock("@/services/live/LiveLobbyRepository", () => ({
  acceptLiveCall: (...args: unknown[]) => mockAcceptLiveCall(...args),
  cancelLiveCall: (...args: unknown[]) => mockCancelLiveCall(...args),
  getLiveCallState: (...args: unknown[]) => mockGetLiveCallState(...args),
  joinAcceptedLiveCall: (...args: unknown[]) => mockJoinAcceptedLiveCall(...args),
  rejectLiveCall: (...args: unknown[]) => mockRejectLiveCall(...args),
  requestLiveCall: (...args: unknown[]) => mockRequestLiveCall(...args),
}));

jest.mock("@/services/realtime/ChatRealtimeService", () => ({
  chatRealtimeService: {
    subscribe: (listener: (event: Record<string, unknown>) => void) => {
      mockRealtimeListener = listener;
      return () => {
        if (mockRealtimeListener === listener) mockRealtimeListener = undefined;
      };
    },
  },
}));

jest.mock("@/services/wallet/WalletRepository", () => ({
  refreshWalletBalance: (...args: unknown[]) => mockRefreshWallet(...args),
}));

describe("LiveCallProvider native invitation lifecycle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockOwnerId = "owner-a";
    mockRealtimeListener = undefined;
    mockUuid = 0;
    mockConnect.mockResolvedValue(true);
    mockLoadInventory.mockResolvedValue(undefined);
    mockRefreshWallet.mockResolvedValue({ spendable_balance: 1_000 });
    mockRequestLiveCall.mockResolvedValue(invitation("call-1"));
    mockAcceptLiveCall.mockResolvedValue(joinCredentials());
    mockJoinAcceptedLiveCall.mockResolvedValue(joinCredentials());
    mockGetLiveCallState.mockResolvedValue({
      ...invitation("call-1"),
      status: "pending",
      phase: "pending",
    });
    mockRejectLiveCall.mockResolvedValue(undefined);
    mockCancelLiveCall.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("single-flights same-frame balance requests and restores the native insufficient copy", async () => {
    const balance = deferred<{ spendable_balance: number }>();
    mockRefreshWallet.mockReturnValueOnce(balance.promise);
    await renderProvider();

    await fireEvent.press(screen.getByLabelText("request-balance"));
    await fireEvent.press(screen.getByLabelText("request-balance"));
    expect(mockRefreshWallet).toHaveBeenCalledTimes(1);
    expect(mockRequestLiveCall).not.toHaveBeenCalled();

    await act(async () => {
      balance.resolve({ spendable_balance: 99 });
      await balance.promise;
    });

    await waitFor(() =>
      expect(screen.getByTestId("live-error").props.children).toBe("猫粮不足，暂时无法视频连线"),
    );
    expect(mockRequestLiveCall).not.toHaveBeenCalled();
  });

  it("reconciles an accepted event that arrives before the invite response and preserves card context", async () => {
    const response = deferred<ReturnType<typeof invitation>>();
    mockRequestLiveCall.mockReturnValueOnce(response.promise);
    await renderProvider();

    await fireEvent.press(screen.getByLabelText("request-card"));
    await waitFor(() => expect(mockRequestLiveCall).toHaveBeenCalledTimes(1));
    await emit("one_to_one_live.call_accepted", {
      call_id: "call-early",
      slot_id: "slot-1",
      host_id: "host-1",
    });

    await act(async () => {
      response.resolve(invitation("call-early"));
      await response.promise;
      await Promise.resolve();
    });
    expect(mockJoinAcceptedLiveCall).toHaveBeenCalledWith("call-early");
    expect(mockGetLiveCallState).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(120);
      await Promise.resolve();
    });
    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "host-1",
        roleSetting: "侦探",
        liveExperience: expect.objectContaining({
          definitionId: "live_experience_card_5m",
          durationSeconds: 300,
          status: "reserved",
        }),
      }),
      joinCredentials(),
      "video",
      true,
    );
  });

  it("lets an early terminal event win over an early accepted event and refreshes card inventory", async () => {
    const response = deferred<ReturnType<typeof invitation>>();
    mockRequestLiveCall.mockReturnValueOnce(response.promise);
    await renderProvider();

    await fireEvent.press(screen.getByLabelText("request-card"));
    await waitFor(() => expect(mockRequestLiveCall).toHaveBeenCalledTimes(1));
    await emit("one_to_one_live.call_accepted", {
      call_id: "call-terminal",
      slot_id: "slot-1",
      host_id: "host-1",
    });
    await emit("one_to_one_live.call_rejected", {
      call_id: "call-terminal",
      slot_id: "slot-1",
      host_id: "host-1",
    });

    await act(async () => {
      response.resolve(invitation("call-terminal"));
      await response.promise;
      await Promise.resolve();
    });

    expect(mockJoinAcceptedLiveCall).not.toHaveBeenCalled();
    expect(mockGetLiveCallState).not.toHaveBeenCalled();
    expect(mockLoadInventory).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("has-invitation").props.children).toBe("false");
  });

  it("starts call-state reconciliation immediately and never overlaps a slow lookup", async () => {
    const firstState = deferred<Record<string, unknown>>();
    mockGetLiveCallState.mockReturnValueOnce(firstState.promise).mockResolvedValueOnce({
      ...invitation("call-state"),
      status: "accepted",
      phase: "accepted",
    });
    mockRequestLiveCall.mockResolvedValueOnce(invitation("call-state"));
    await renderProvider();

    await fireEvent.press(screen.getByLabelText("request-card"));
    await waitFor(() => expect(mockGetLiveCallState).toHaveBeenCalledTimes(1));
    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(mockGetLiveCallState).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstState.resolve({
        ...invitation("call-state"),
        status: "pending",
        phase: "pending",
      });
      await firstState.promise;
      await Promise.resolve();
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    await waitFor(() => expect(mockGetLiveCallState).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockJoinAcceptedLiveCall).toHaveBeenCalledWith("call-state"));
  });

  it("hides and invalidates an old account request before its response can navigate or cancel as the new account", async () => {
    const response = deferred<ReturnType<typeof invitation>>();
    mockRequestLiveCall.mockReturnValueOnce(response.promise);
    const view = await renderProvider();
    await fireEvent.press(screen.getByLabelText("request-card"));
    await waitFor(() => expect(mockRequestLiveCall).toHaveBeenCalledTimes(1));

    mockOwnerId = "owner-b";
    await act(async () => {
      view.rerender(
        <LiveCallProvider>
          <Probe />
        </LiveCallProvider>,
      );
      await Promise.resolve();
    });
    expect(screen.getByTestId("has-invitation").props.children).toBe("false");

    await act(async () => {
      response.resolve(invitation("call-old-owner"));
      await response.promise;
      await Promise.resolve();
      jest.advanceTimersByTime(120);
    });
    expect(mockCancelLiveCall).not.toHaveBeenCalled();
    expect(mockJoinAcceptedLiveCall).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

function Probe() {
  const live = useLiveCall();
  return (
    <>
      <Text testID="has-invitation">{String(live.hasInvitation)}</Text>
      <Text testID="live-error">{live.errorMessage ?? ""}</Text>
      <Pressable
        accessibilityLabel="request-balance"
        onPress={() => {
          void live.requestCall(requestInput({ type: "spendable_balance" }));
        }}
      />
      <Pressable
        accessibilityLabel="request-card"
        onPress={() => {
          void live.requestCall(
            requestInput({ type: "prop_card", definitionId: "live_experience_card_5m" }),
          );
        }}
      />
    </>
  );
}

async function renderProvider() {
  return render(
    <LiveCallProvider>
      <Probe />
    </LiveCallProvider>,
  );
}

function requestInput(
  paymentMethod: { type: "spendable_balance" } | { type: "prop_card"; definitionId: string },
) {
  return {
    participant: participant(),
    callType: "video" as const,
    billingPolicy: {
      currency: "spendable_balance",
      freeSeconds: 10,
      unitSeconds: 60,
      amountPerUnit: 100,
      minimumStartingBalance: 100,
      rounding: "started_unit",
    },
    isCurrentUserLive: false,
    paymentMethod,
  };
}

function participant(): LiveLobbyParticipant {
  return {
    id: "slot-1",
    userId: "host-1",
    displayName: "主播",
    avatarUrl: "/avatar.jpg",
    roleSetting: "侦探",
    allowedCallTypes: ["video"],
    gender: "female",
    availability: "available",
    hasChatted: false,
    paletteIndex: 1,
    isCurrentUser: false,
  };
}

function invitation(callId: string) {
  return { callId, callType: "video" as const };
}

function joinCredentials() {
  return {
    call_id: "call-1",
    room_name: "room-1",
    token: "live-token",
    livekit_url: "wss://live.example.test",
    call_type: "video" as const,
  };
}

async function emit(signalType: string, data: Record<string, unknown>): Promise<void> {
  await act(async () => {
    mockRealtimeListener?.({ type: "live_signal", signal_type: signalType, data });
  });
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
