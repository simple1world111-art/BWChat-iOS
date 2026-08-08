import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

import { apiRequest } from "@/api/client";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";
import {
  activateMomentsUnreadOwner,
  momentsUnreadSnapshot,
  resetMomentsUnreadStoreForTests,
} from "@/services/moments/MomentsUnreadStore";
import {
  applyPushSideEffects,
  beginNativePushUploadSession,
  ensureNativePushTokenUploaded,
  flattenNotificationPayload,
  initializePushNotifications,
  markPushEventProcessed,
  parseNotificationRoute,
  presentationPolicyForPush,
  pushOpenTarget,
  requestPushPermission,
  resetPushServiceForTests,
  savePendingPushOpen,
  takePendingPushOpen,
  wasPushEventProcessed,
} from "@/services/push/PushService";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
jest.mock("@/services/monitoring/MonitoringService", () => ({ captureException: jest.fn() }));
jest.mock("@/services/realtime/ChatRealtimeService", () => ({
  chatRealtimeService: {
    isConversationActive: jest.fn(() => false),
    requestConversationRefresh: jest.fn(),
  },
}));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { MAX: 5 },
  IosAlertStyle: { ALERT: 2, NONE: 0 },
  IosAllowsPreviews: { ALWAYS: 1 },
  IosAuthorizationStatus: { AUTHORIZED: 2, NOT_DETERMINED: 0 },
  PermissionStatus: { GRANTED: "granted", UNDETERMINED: "undetermined" },
  getDevicePushTokenAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setBadgeCountAsync: jest.fn(async () => true),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
}));

const request = jest.mocked(apiRequest);
const getToken = jest.mocked(Notifications.getDevicePushTokenAsync);
const getPermissions = jest.mocked(Notifications.getPermissionsAsync);
const requestPermissions = jest.mocked(Notifications.requestPermissionsAsync);

describe("native push service", () => {
  beforeEach(async () => {
    resetPushServiceForTests();
    resetMomentsUnreadStoreForTests();
    jest.clearAllMocks();
    await AsyncStorage.clear();
    getToken.mockResolvedValue({ type: "ios", data: "apns-token" });
    getPermissions.mockResolvedValue(permission(false));
    requestPermissions.mockResolvedValue(permission(true));
    request.mockResolvedValue({});
  });

  it("flattens dictionary or JSON payload containers without overriding top-level values", () => {
    expect(
      flattenNotificationPayload({
        sender_id: "top",
        group_name: null,
        data: JSON.stringify({ sender_id: "nested", message_id: 7 }),
        payload: { group_id: 9, group_name: "nested group" },
      }),
    ).toMatchObject({ sender_id: "top", message_id: 7, group_id: 9, group_name: null });
  });

  it("normalizes group aliases, flags, badge and canonical message identity", () => {
    expect(
      parseNotificationRoute({
        notification_data: JSON.stringify({
          pushType: "new_group_message",
          conversationId: "12",
          senderId: "u2",
          messageId: "44",
          conversationRevision: "8",
          isDirectMention: "yes",
          mention_all: 1,
          notificationMode: "BADGE_ONLY",
          groupName: "Study",
          aps: { badge: 6 },
        }),
      }),
    ).toEqual(
      expect.objectContaining({
        eventId: "group:12:message:44",
        conversationType: "group",
        conversationId: "12",
        groupId: 12,
        senderId: "u2",
        messageId: 44,
        conversationRevision: 8,
        totalUnreadCount: 6,
        groupName: "Study",
        isDirectMention: true,
        isMentionAll: true,
        notificationMode: "badge_only",
      }),
    );
  });

  it("uses sender as direct conversation fallback and rejects payloads without a target", () => {
    expect(
      parseNotificationRoute({ sender_id: 123, msg_id: 5, timestamp: "2026-08-07T00:00:00Z" }),
    ).toMatchObject({
      conversationType: "dm",
      conversationId: "123",
      eventId: "dm:123:message:5",
    });
    expect(parseNotificationRoute({ push_type: "new_message" })).toBeNull();
  });

  it("matches native foreground sound/banner suppression rules", () => {
    const active = {
      isConversationActive: (type: "dm" | "group", id: string) => type === "dm" && id === "u1",
    };
    expect(presentationPolicyForPush({ push_type: "call_invite" }, active)).toEqual(
      policy(false, true),
    );
    expect(presentationPolicyForPush({ push_type: "moments_update" }, active)).toEqual(
      policy(true, true),
    );
    expect(presentationPolicyForPush({ sender_id: "u1" }, active)).toEqual(policy(false, false));
    expect(
      presentationPolicyForPush({ sender_id: "u2", notification_mode: "badge_only" }, active),
    ).toEqual(policy(false, false));
    expect(presentationPolicyForPush({ sender_id: "u2" }, active)).toEqual(policy(true, true));
  });

  it("builds conversation/moments open targets and leaves calls to CallProvider", () => {
    expect(pushOpenTarget({ push_type: "call", caller_id: "u1" }, "n1")).toBeNull();
    expect(pushOpenTarget({ push_type: "moments_update", event_id: "moment-1" }, "n2")).toEqual({
      kind: "moments",
      eventId: "moment-1",
    });
    expect(pushOpenTarget({ group_id: 7, message_id: 9 }, "n3")).toMatchObject({
      kind: "conversation",
      eventId: "group:7:message:9",
      route: { conversationType: "group", conversationId: "7", messageId: 9 },
    });
  });

  it("requests alert/badge/sound permission and uploads one native token per account session", async () => {
    expect(await requestPushPermission()).toBe(true);
    expect(requestPermissions).toHaveBeenCalledWith({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    await Promise.all([
      ensureNativePushTokenUploaded("owner"),
      ensureNativePushTokenUploaded("owner"),
    ]);
    await ensureNativePushTokenUploaded("owner");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/push/device-token", {
      method: "POST",
      body: { device_token: "apns-token" },
      requiredEnvelope: true,
    });
    expect(await AsyncStorage.getItem("bwchat.push.native-token.v1")).toBe("apns-token");
  });

  it("uploads again when the same owner begins a later authenticated session", async () => {
    const firstGeneration = beginNativePushUploadSession("owner");
    await ensureNativePushTokenUploaded("owner", { sessionGeneration: firstGeneration });
    await ensureNativePushTokenUploaded("owner", { sessionGeneration: firstGeneration });
    const secondGeneration = beginNativePushUploadSession("owner");
    await ensureNativePushTokenUploaded("owner", { sessionGeneration: secondGeneration });

    expect(secondGeneration).toBe(firstGeneration + 1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(2, "/push/device-token", {
      method: "POST",
      body: { device_token: "apns-token" },
      requiredEnvelope: true,
    });
  });

  it("registers one foreground handler, applies badge and triggers conversation reconciliation", async () => {
    initializePushNotifications();
    initializePushNotifications();
    expect(Notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    await applyPushSideEffects({ sender_id: "u1", total_unread_count: 8 });
    expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(8);
    expect(chatRealtimeService.requestConversationRefresh).toHaveBeenCalledWith(
      "push_notification",
    );
  });

  it("increments the active account moments tab badge for a foreground moments push", async () => {
    activateMomentsUnreadOwner("owner");
    await applyPushSideEffects({ push_type: "moments_update", event_id: "moment-1" }, "owner");
    expect(momentsUnreadSnapshot("owner")).toBe(1);
    await applyPushSideEffects({ push_type: "moments_update", event_id: "late" }, "old-owner");
    expect(momentsUnreadSnapshot("owner")).toBe(1);
  });

  it("persists cold-open targets and caps processed delivery identity", async () => {
    const target = pushOpenTarget({ sender_id: "u1", message_id: 3 }, "n1");
    expect(target).not.toBeNull();
    await savePendingPushOpen(target!);
    expect(await takePendingPushOpen()).toEqual(target);
    expect(await takePendingPushOpen()).toBeNull();
    await markPushEventProcessed("event-1");
    expect(await wasPushEventProcessed("event-1")).toBe(true);
    expect(await wasPushEventProcessed("event-2")).toBe(false);
  });
});

function policy(show: boolean, sound: boolean) {
  return {
    shouldShowBanner: show,
    shouldShowList: show,
    shouldPlaySound: sound,
    shouldSetBadge: false,
  };
}

function permission(granted: boolean): Notifications.NotificationPermissionsStatus {
  return {
    canAskAgain: !granted,
    expires: "never",
    granted,
    ios: {
      alertStyle: granted ? Notifications.IosAlertStyle.ALERT : Notifications.IosAlertStyle.NONE,
      allowsAlert: granted,
      allowsAnnouncements: false,
      allowsBadge: granted,
      allowsCriticalAlerts: false,
      allowsDisplayInCarPlay: false,
      allowsDisplayOnLockScreen: granted,
      allowsDisplayInNotificationCenter: granted,
      allowsPreviews: Notifications.IosAllowsPreviews.ALWAYS,
      allowsSound: granted,
      providesAppNotificationSettings: false,
      status: granted
        ? Notifications.IosAuthorizationStatus.AUTHORIZED
        : Notifications.IosAuthorizationStatus.NOT_DETERMINED,
    },
    status: granted
      ? Notifications.PermissionStatus.GRANTED
      : Notifications.PermissionStatus.UNDETERMINED,
  };
}
