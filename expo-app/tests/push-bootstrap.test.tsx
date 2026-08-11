import { act, render, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { AppState, type AppStateStatus } from "react-native";

import { PushNotificationBootstrap } from "@/components/PushNotificationBootstrap";
import type { Conversation } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { publishCallNotification } from "@/services/calls/CallNotificationBridge";
import {
  publishConversationUnread,
  resetConversationUnreadStoreForTests,
} from "@/services/conversations/ConversationUnreadStore";
import {
  activateMomentsUnreadOwner,
  publishMomentsUnread,
  resetMomentsUnreadStoreForTests,
} from "@/services/moments/MomentsUnreadStore";
import {
  applyPushSideEffects,
  acknowledgePendingPushOpen,
  beginNativePushUploadSession,
  cacheNativePushToken,
  claimPendingPushOpen,
  dismissCachedReadConversationNotifications,
  ensureNativePushTokenUploaded,
  markPushEventProcessed,
  pushOpenTarget,
  releasePendingPushOpen,
  requestPushPermission,
  savePendingPushOpen,
  setActivePushOwnerId,
  wasPushEventProcessed,
  type PushOpenTarget,
} from "@/services/push/PushService";

jest.mock("@/providers/AuthProvider", () => ({ useAuth: jest.fn() }));

jest.mock("expo-router", () => ({
  router: { dismissAll: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

jest.mock("expo-notifications", () => ({
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  addPushTokenListener: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
  setBadgeCountAsync: jest.fn(),
}));

jest.mock("@/services/monitoring/MonitoringService", () => ({ captureException: jest.fn() }));

jest.mock("@/services/calls/CallNotificationBridge", () => ({
  publishCallNotification: jest.fn(),
}));

jest.mock("@/services/push/PushService", () => ({
  applyPushSideEffects: jest.fn(),
  acknowledgePendingPushOpen: jest.fn(),
  beginNativePushUploadSession: jest.fn(),
  cacheNativePushToken: jest.fn(),
  claimPendingPushOpen: jest.fn(),
  dismissCachedReadConversationNotifications: jest.fn(),
  ensureNativePushTokenUploaded: jest.fn(),
  markPushEventProcessed: jest.fn(),
  pushOpenTarget: jest.fn(),
  releasePendingPushOpen: jest.fn(),
  requestPushPermission: jest.fn(),
  savePendingPushOpen: jest.fn(),
  setActivePushOwnerId: jest.fn(),
  wasPushEventProcessed: jest.fn(),
}));

const mockedUseAuth = jest.mocked(useAuth);
const publishCall = jest.mocked(publishCallNotification);
const requestPermission = jest.mocked(requestPushPermission);
const beginUploadSession = jest.mocked(beginNativePushUploadSession);
const uploadToken = jest.mocked(ensureNativePushTokenUploaded);
const cacheToken = jest.mocked(cacheNativePushToken);
const dismissCachedRead = jest.mocked(dismissCachedReadConversationNotifications);
const applySideEffects = jest.mocked(applyPushSideEffects);
const parseOpenTarget = jest.mocked(pushOpenTarget);
const saveOpenTarget = jest.mocked(savePendingPushOpen);
const claimOpenTarget = jest.mocked(claimPendingPushOpen);
const acknowledgeOpenTarget = jest.mocked(acknowledgePendingPushOpen);
const releaseOpenTarget = jest.mocked(releasePendingPushOpen);
const setPushOwner = jest.mocked(setActivePushOwnerId);
const wasProcessed = jest.mocked(wasPushEventProcessed);
const markProcessed = jest.mocked(markPushEventProcessed);
const pushRoute = jest.mocked(router.push);
const replaceRoute = jest.mocked(router.replace);

describe("authenticated push bootstrap", () => {
  let currentUserId: string | null;
  let appStateListener: ((state: AppStateStatus) => void) | null;
  let tokenListener: ((token: Notifications.DevicePushToken) => void) | null;
  let receivedListener: ((notification: Notifications.Notification) => void) | null;
  let responseListener: ((response: Notifications.NotificationResponse) => void) | null;
  let removeAppState: jest.Mock;
  let removeToken: jest.Mock;
  let removeReceived: jest.Mock;
  let removeResponse: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetConversationUnreadStoreForTests();
    resetMomentsUnreadStoreForTests();
    currentUserId = null;
    appStateListener = null;
    tokenListener = null;
    receivedListener = null;
    responseListener = null;
    removeAppState = jest.fn();
    removeToken = jest.fn();
    removeReceived = jest.fn();
    removeResponse = jest.fn();
    mockedUseAuth.mockImplementation(
      () =>
        ({
          user: currentUserId ? { user_id: currentUserId } : null,
        }) as ReturnType<typeof useAuth>,
    );
    requestPermission.mockResolvedValue(true);
    beginUploadSession.mockReturnValue(1);
    uploadToken.mockResolvedValue();
    cacheToken.mockResolvedValue("cached-token");
    dismissCachedRead.mockResolvedValue(0);
    applySideEffects.mockResolvedValue();
    publishCall.mockReturnValue({ kind: "not_call" });
    claimOpenTarget.mockResolvedValue(null);
    acknowledgeOpenTarget.mockResolvedValue();
    wasProcessed.mockResolvedValue(false);
    markProcessed.mockResolvedValue();
    saveOpenTarget.mockResolvedValue();
    jest.mocked(Notifications.setBadgeCountAsync).mockResolvedValue(true);
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(null);
    jest.mocked(Notifications.addPushTokenListener).mockImplementation((listener) => {
      tokenListener = listener;
      return { remove: removeToken };
    });
    jest.mocked(Notifications.addNotificationReceivedListener).mockImplementation((listener) => {
      receivedListener = listener;
      return { remove: removeReceived };
    });
    jest
      .mocked(Notifications.addNotificationResponseReceivedListener)
      .mockImplementation((listener) => {
        responseListener = listener;
        return { remove: removeResponse };
      });
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
      appStateListener = listener;
      return { remove: removeAppState };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("defers permission and token registration until authentication", async () => {
    const view = await render(<PushNotificationBootstrap />);

    expect(requestPermission).not.toHaveBeenCalled();
    expect(uploadToken).not.toHaveBeenCalled();
    expect(Notifications.addPushTokenListener).not.toHaveBeenCalled();
    expect(Notifications.addNotificationReceivedListener).toHaveBeenCalledTimes(1);
    expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);

    currentUserId = "owner";
    await view.rerender(<PushNotificationBootstrap />);
    await waitFor(() => expect(uploadToken).toHaveBeenCalledWith("owner", expect.any(Object)));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(Notifications.addPushTokenListener).toHaveBeenCalledTimes(1);

    await view.unmount();
    expect(removeToken).toHaveBeenCalledTimes(1);
    expect(removeAppState).toHaveBeenCalledTimes(1);
    expect(removeReceived).toHaveBeenCalledTimes(2);
    expect(removeResponse).toHaveBeenCalledTimes(2);
  });

  it("refreshes a rotated token, retries on foreground, and aborts the old account session", async () => {
    currentUserId = "first-owner";
    const view = await render(<PushNotificationBootstrap />);
    await waitFor(() =>
      expect(uploadToken).toHaveBeenCalledWith("first-owner", expect.any(Object)),
    );
    const firstSignal = uploadToken.mock.calls[0]?.[1]?.signal;

    await act(async () => {
      tokenListener?.({ type: "ios", data: "rotated-token" });
      await Promise.resolve();
    });
    expect(cacheToken).toHaveBeenCalledWith({ type: "ios", data: "rotated-token" });
    await waitFor(() =>
      expect(uploadToken).toHaveBeenCalledWith(
        "first-owner",
        expect.objectContaining({ token: "cached-token" }),
      ),
    );

    await act(async () => {
      appStateListener?.("active");
    });
    expect(uploadToken).toHaveBeenCalledWith("first-owner", expect.any(Object));

    currentUserId = "second-owner";
    await view.rerender(<PushNotificationBootstrap />);
    expect(firstSignal?.aborted).toBe(true);
    expect(removeToken).toHaveBeenCalledTimes(1);
    expect(removeAppState).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(uploadToken).toHaveBeenCalledWith("second-owner", expect.any(Object)),
    );

    await view.unmount();
  });

  it("starts a new push upload session after logout and same-account login", async () => {
    beginUploadSession.mockReturnValueOnce(4).mockReturnValueOnce(5);
    currentUserId = "same-owner";
    const view = await render(<PushNotificationBootstrap />);
    await waitFor(() =>
      expect(uploadToken).toHaveBeenCalledWith(
        "same-owner",
        expect.objectContaining({ sessionGeneration: 4 }),
      ),
    );

    currentUserId = null;
    await view.rerender(<PushNotificationBootstrap />);
    currentUserId = "same-owner";
    await view.rerender(<PushNotificationBootstrap />);
    await waitFor(() =>
      expect(uploadToken).toHaveBeenCalledWith(
        "same-owner",
        expect.objectContaining({ sessionGeneration: 5 }),
      ),
    );
    expect(beginUploadSession).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  it("applies foreground side effects and consumes an authenticated notification open once", async () => {
    const target: PushOpenTarget = {
      kind: "conversation",
      eventId: "dm:friend:message:7",
      route: {
        eventId: "dm:friend:message:7",
        conversationType: "dm",
        conversationId: "friend",
        messageId: 7,
        senderName: "Friend",
        isDirectMention: false,
        isMentionAll: false,
      },
    };
    currentUserId = "owner";
    claimOpenTarget
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(target)
      .mockResolvedValue(null);
    parseOpenTarget.mockReturnValue(target);
    const view = await render(<PushNotificationBootstrap />);

    await act(async () => {
      receivedListener?.(notification({ sender_id: "friend", message_id: 7 }));
      await Promise.resolve();
    });
    expect(applySideEffects).toHaveBeenCalledWith({ sender_id: "friend", message_id: 7 }, "owner");

    await act(async () => {
      responseListener?.(response(notification({ sender_id: "friend", message_id: 7 })));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(saveOpenTarget).toHaveBeenCalledWith(target);
    await waitFor(() =>
      expect(pushRoute).toHaveBeenCalledWith({
        pathname: "/chat/[id]",
        params: { id: "friend", name: "Friend", messageId: "7", latestMessageId: "7" },
      }),
    );
    expect(replaceRoute).toHaveBeenCalledWith("/(tabs)/conversations");
    expect(markProcessed).toHaveBeenCalledWith(target.eventId);
    expect(acknowledgeOpenTarget).toHaveBeenCalledWith(target.eventId);
    expect(releaseOpenTarget).not.toHaveBeenCalled();
    expect(setPushOwner).toHaveBeenCalledWith("owner");

    await view.unmount();
  });

  it("hands a tapped call notification to the replayable call bridge instead of chat routing", async () => {
    currentUserId = "owner";
    publishCall.mockReturnValue({
      kind: "published",
      invitation: {
        call_id: "call-1",
        caller_id: "caller-1",
        caller_name: "Caller",
        caller_avatar: "",
        call_type: "video",
        room_name: "room-1",
      },
    });
    const view = await render(<PushNotificationBootstrap />);

    await act(async () => {
      responseListener?.(response(notification({ push_type: "call", call_id: "call-1" })));
      await Promise.resolve();
    });

    expect(publishCall).toHaveBeenCalledWith({ push_type: "call", call_id: "call-1" });
    expect(parseOpenTarget).not.toHaveBeenCalled();
    expect(saveOpenTarget).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("keeps the application icon badge equal to chat plus moments unread and clears on logout", async () => {
    currentUserId = "owner";
    publishConversationUnread("owner", [conversation({ unread_count: 4 })]);
    activateMomentsUnreadOwner("owner");
    publishMomentsUnread("owner", 3);

    const view = await render(<PushNotificationBootstrap />);
    await waitFor(() => expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(7));

    await act(async () => {
      publishConversationUnread("owner", [conversation({ unread_count: 1 })]);
    });
    await waitFor(() => expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(4));

    currentUserId = null;
    await view.rerender(<PushNotificationBootstrap />);
    await waitFor(() => expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(0));

    await view.unmount();
  });
});

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    type: "dm",
    id: "friend",
    name: "Friend",
    avatar_url: "",
    unread_count: 0,
    is_muted: false,
    ...overrides,
  };
}

function notification(data: Record<string, unknown>): Notifications.Notification {
  return {
    date: 0,
    request: {
      identifier: "notification-id",
      content: { data },
    },
  } as Notifications.Notification;
}

function response(value: Notifications.Notification): Notifications.NotificationResponse {
  return { notification: value } as Notifications.NotificationResponse;
}
