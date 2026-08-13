import { act, render } from "@testing-library/react-native";
import { AppState, type AppStateStatus, Text } from "react-native";

import { useAuth } from "@/providers/AuthProvider";
import { RealtimeProvider } from "@/providers/RealtimeProvider";
import { catchUpConversationState } from "@/services/conversations/ChatSyncCatchUp";
import { conversationSyncCoordinator } from "@/services/conversations/ConversationSyncCoordinator";
import { publishConversationCatalogRefresh } from "@/services/conversations/ConversationRepository";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";

jest.mock("@/providers/AuthProvider", () => ({ useAuth: jest.fn() }));

jest.mock("expo-network", () => ({
  getNetworkStateAsync: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  }),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock("@/services/conversations/ConversationSyncCoordinator", () => ({
  conversationSyncCoordinator: {
    request: jest.fn().mockResolvedValue(undefined),
    setApplicationActive: jest.fn(),
    setNetworkAvailable: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
    start: jest.fn(),
    stop: jest.fn(),
  },
}));

jest.mock("@/services/conversations/ChatSyncCatchUp", () => ({
  catchUpConversationState: jest.fn().mockResolvedValue({
    mode: "delta",
    cursor: 11,
    page_count: 1,
    event_count: 1,
    full_sync_required: false,
  }),
}));

jest.mock("@/services/conversations/ConversationRepository", () => ({
  publishConversationCatalogRefresh: jest.fn(),
}));

jest.mock("@/services/realtime/ChatRealtimeService", () => ({
  chatRealtimeService: {
    acknowledgeCatchUp: jest.fn().mockResolvedValue(undefined),
    reconnectNow: jest.fn(),
    setNetworkAvailable: jest.fn(),
    setApplicationActive: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
    subscribeStatus: jest.fn((listener: (status: string) => void) => {
      listener("disconnected");
      return jest.fn();
    }),
  },
}));

const mockedUseAuth = jest.mocked(useAuth);
const startRealtime = jest.mocked(chatRealtimeService.start);
const stopRealtime = jest.mocked(chatRealtimeService.stop);
const reconnectRealtime = jest.mocked(chatRealtimeService.reconnectNow);
const setRealtimeApplicationActive = jest.mocked(chatRealtimeService.setApplicationActive);
const subscribeConversationSync = jest.mocked(conversationSyncCoordinator.subscribe);
const catchUpConversations = jest.mocked(catchUpConversationState);
const publishCatalogRefresh = jest.mocked(publishConversationCatalogRefresh);

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
    expect(setRealtimeApplicationActive).toHaveBeenLastCalledWith(false);
    expect(reconnectRealtime).not.toHaveBeenCalled();

    await sendAppState("active");
    expect(setRealtimeApplicationActive).toHaveBeenLastCalledWith(true);
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

  it("owns one account snapshot catch-up for each coordinator flight", async () => {
    currentUserId = "authenticated-user";
    const view = await renderProvider();
    const listener = subscribeConversationSync.mock.calls[0]?.[1];
    expect(listener).toBeDefined();

    await act(async () => {
      await listener?.({
        owner_id: "authenticated-user",
        reasons: ["direct_message_hint", "push_notification"],
        full: false,
        targets: [
          {
            conversation_type: "dm",
            conversation_id: "friend-a",
            message_id: 8,
            message_version: 3,
          },
        ],
        requested_at: 1,
      });
    });

    expect(catchUpConversations).toHaveBeenCalledTimes(1);
    expect(catchUpConversations).toHaveBeenCalledWith(
      "authenticated-user",
      expect.any(AbortSignal),
    );

    await view.unmount();
  });

  it("does not feed delta-delivered hints back into a second coordinator flight", async () => {
    currentUserId = "authenticated-user";
    const view = await renderProvider();
    const eventListener = jest.mocked(chatRealtimeService.subscribe).mock.calls[0]?.[0];

    await act(async () => {
      eventListener?.({
        type: "direct_message_hint",
        sender_id: "friend-a",
        receiver_id: "authenticated-user",
        message_id: 8,
        delivery_source: "catch_up",
      });
    });

    expect(conversationSyncCoordinator.request).not.toHaveBeenCalledWith(
      "authenticated-user",
      "direct_message_hint",
      expect.anything(),
    );
    await view.unmount();
  });

  it("refreshes catalogs only for a full trigger and forces a snapshot for a missing row", async () => {
    currentUserId = "authenticated-user";
    const view = await renderProvider();
    const listener = subscribeConversationSync.mock.calls[0]?.[1];

    await act(async () => {
      await listener?.({
        owner_id: "authenticated-user",
        reasons: ["app_foreground"],
        full: true,
        targets: [],
        requested_at: 1,
      });
      await listener?.({
        owner_id: "authenticated-user",
        reasons: ["realtime_missing_conversation"],
        full: false,
        targets: [{ conversation_type: "dm", conversation_id: "friend-a", message_id: 9 }],
        requested_at: 2,
      });
    });

    expect(publishCatalogRefresh).toHaveBeenCalledTimes(1);
    expect(catchUpConversations).toHaveBeenLastCalledWith(
      "authenticated-user",
      expect.any(AbortSignal),
      { forceAuthoritativeSnapshot: true },
    );
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
