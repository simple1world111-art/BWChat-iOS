import { act, render } from "@testing-library/react-native";
import { AppState, type AppStateStatus, Text } from "react-native";

import { useAuth } from "@/providers/AuthProvider";
import { RealtimeProvider } from "@/providers/RealtimeProvider";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";

jest.mock("@/providers/AuthProvider", () => ({ useAuth: jest.fn() }));

jest.mock("@/services/realtime/ChatRealtimeService", () => ({
  chatRealtimeService: {
    reconnectNow: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  },
}));

const mockedUseAuth = jest.mocked(useAuth);
const startRealtime = jest.mocked(chatRealtimeService.start);
const stopRealtime = jest.mocked(chatRealtimeService.stop);
const reconnectRealtime = jest.mocked(chatRealtimeService.reconnectNow);

describe("authenticated realtime bootstrap", () => {
  let currentUserId: string | null;
  let appStateListener: ((state: AppStateStatus) => void) | null;
  let removeAppStateListener: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    currentUserId = null;
    appStateListener = null;
    removeAppStateListener = jest.fn();
    mockedUseAuth.mockImplementation(
      () =>
        ({
          user: currentUserId ? { user_id: currentUserId } : null,
        }) as ReturnType<typeof useAuth>,
    );
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
      appStateListener = listener;
      return { remove: removeAppStateListener };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts for the signed-in user and reconnects only when the app becomes active", async () => {
    currentUserId = "authenticated-user";
    const view = await renderProvider();

    expect(startRealtime).toHaveBeenCalledWith("authenticated-user");
    expect(stopRealtime).not.toHaveBeenCalled();

    await sendAppState("background");
    expect(reconnectRealtime).not.toHaveBeenCalled();

    await sendAppState("active");
    expect(reconnectRealtime).toHaveBeenCalledTimes(1);

    await view.unmount();
    expect(stopRealtime).toHaveBeenCalledTimes(1);
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  });

  it("stops while signed out and does not reconnect on foreground", async () => {
    const view = await renderProvider();

    expect(startRealtime).not.toHaveBeenCalled();
    expect(stopRealtime).toHaveBeenCalledTimes(1);
    await sendAppState("active");
    expect(reconnectRealtime).not.toHaveBeenCalled();

    await view.unmount();
    expect(stopRealtime).toHaveBeenCalledTimes(2);
  });

  it("cleans up the old session before switching the realtime owner", async () => {
    currentUserId = "first-user";
    const view = await renderProvider();
    expect(startRealtime).toHaveBeenLastCalledWith("first-user");

    currentUserId = "second-user";
    await view.rerender(providerTree());

    expect(stopRealtime).toHaveBeenCalledTimes(1);
    expect(startRealtime).toHaveBeenLastCalledWith("second-user");
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);

    await sendAppState("active");
    expect(reconnectRealtime).toHaveBeenCalledTimes(1);

    await view.unmount();
  });

  async function sendAppState(state: AppStateStatus): Promise<void> {
    await act(async () => {
      appStateListener?.(state);
    });
  }
});

async function renderProvider() {
  return render(providerTree());
}

function providerTree(): React.JSX.Element {
  return (
    <RealtimeProvider>
      <Text>child</Text>
    </RealtimeProvider>
  );
}
