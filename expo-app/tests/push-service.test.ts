import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

import { apiRequest } from "@/api/client";
import { recordConversationNotificationRead } from "@/services/conversations/ConversationNotificationReadState";
import { reconcileConversationSnapshot } from "@/services/conversations/ConversationRepository";
import { conversationSyncCoordinator } from "@/services/conversations/ConversationSyncCoordinator";
import {
  activateMomentsUnreadOwner,
  momentsUnreadSnapshot,
  resetMomentsUnreadStoreForTests,
} from "@/services/moments/MomentsUnreadStore";
import {
  applyPushSideEffects,
  acknowledgePendingPushOpen,
  beginNativePushUploadSession,
  claimPendingPushOpen,
  dismissCachedReadConversationNotifications,
  dismissActiveConversationNotifications,
  dismissReadConversationNotifications,
  dismissReadMomentsNotifications,
  ensureNativePushTokenUploaded,
  flattenNotificationPayload,
  initializePushNotifications,
  markPushEventProcessed,
  notificationDisplayText,
  parseNotificationRoute,
  presentationPolicyForPush,
  pushOpenTarget,
  releasePendingPushOpen,
  requestPushPermission,
  resetPushServiceForTests,
  savePendingPushOpen,
  setActivePushOwnerId,
  shouldAlertForGroupSettings,
  takePendingPushOpen,
  wasPushEventProcessed,
  type NotificationConversationType,
} from "@/services/push/PushService";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
jest.mock("@/services/monitoring/MonitoringService", () => ({ captureException: jest.fn() }));
jest.mock("@/services/conversations/ConversationSyncCoordinator", () => ({
  conversationSyncCoordinator: { request: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("@/services/realtime/ChatRealtimeService", () => ({
  chatRealtimeService: {
    hasActiveConversation: jest.fn(() => false),
    isConversationActive: jest.fn(() => false),
    requestConversationRefresh: jest.fn(),
  },
}));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { LOW: 2, HIGH: 4, MAX: 5 },
  IosAlertStyle: { ALERT: 2, NONE: 0 },
  IosAllowsPreviews: { ALWAYS: 1 },
  IosAuthorizationStatus: { AUTHORIZED: 2, NOT_DETERMINED: 0 },
  PermissionStatus: { GRANTED: "granted", UNDETERMINED: "undetermined" },
  dismissNotificationAsync: jest.fn(async () => undefined),
  getDevicePushTokenAsync: jest.fn(),
  getPresentedNotificationsAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setBadgeCountAsync: jest.fn(async () => true),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
}));

const request = jest.mocked(apiRequest);
const getToken = jest.mocked(Notifications.getDevicePushTokenAsync);
const getPermissions = jest.mocked(Notifications.getPermissionsAsync);
const getPresented = jest.mocked(Notifications.getPresentedNotificationsAsync);
const requestPermissions = jest.mocked(Notifications.requestPermissionsAsync);
const dismissNotification = jest.mocked(Notifications.dismissNotificationAsync);

describe("native push service", () => {
  beforeEach(async () => {
    resetPushServiceForTests();
    resetMomentsUnreadStoreForTests();
    jest.clearAllMocks();
    await AsyncStorage.clear();
    getToken.mockResolvedValue({ type: "ios", data: "apns-token" });
    getPermissions.mockResolvedValue(permission(false));
    getPresented.mockResolvedValue([]);
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

  it("removes only a trailing Preview environment label from notification display names", () => {
    expect(notificationDisplayText("BBchat Preview")).toBe("BBchat");
    expect(notificationDisplayText("Study — Preview")).toBe("Study");
    expect(notificationDisplayText("Oscar（Preview）")).toBe("Oscar");
    expect(notificationDisplayText("Preview Club")).toBe("Preview Club");
    expect(notificationDisplayText("Preview")).toBe("Preview");
    expect(
      parseNotificationRoute({
        sender_id: "u1",
        sender_nickname: "Oscar [Preview]",
        group_id: 12,
        group_name: "BBchat Preview",
      }),
    ).toMatchObject({ senderName: "Oscar", groupName: "BBchat" });
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
    const routeWithUnrelatedId = parseNotificationRoute({ sender_id: "u1", id: 999 });
    expect(routeWithUnrelatedId).toMatchObject({ conversationId: "u1" });
    expect(routeWithUnrelatedId).not.toHaveProperty("messageId");
    expect(
      parseNotificationRoute({ fromUserId: "friend", chatId: "thread-1", msgId: "12" }),
    ).toMatchObject({ conversationId: "thread-1", senderId: "friend", messageId: 12 });
  });

  it("normalizes v2 canonical identities for all four conversation surfaces", () => {
    expect(
      parseNotificationRoute({
        surface_type: "dm",
        surface_id: "friend",
        conversation_key: "dm:friend",
        message_id: "101",
        message_version: "3",
      }),
    ).toMatchObject({
      conversationType: "dm",
      conversationId: "friend",
      conversationKey: "dm:friend",
      messageVersion: 3,
    });
    expect(
      parseNotificationRoute({
        surface_type: "group",
        conversation_key: "group:42",
        group_id: 42,
        version: 99,
        conversation_unread: 3,
      }),
    ).toEqual(
      expect.not.objectContaining({
        messageVersion: expect.anything(),
      }),
    );
    expect(
      parseNotificationRoute({
        surface_type: "group",
        conversation_key: "group:42",
        group_id: 42,
        version: 99,
        conversation_unread: 3,
      }),
    ).toMatchObject({
      conversationType: "group",
      conversationId: "42",
      conversationKey: "group:42",
      groupId: 42,
      unreadCount: 3,
    });
    expect(
      parseNotificationRoute({
        surface_type: "agent",
        surface_id: "agent-conversation-1",
        agent_id: "agent-1",
        message_id: "message-uuid",
      }),
    ).toMatchObject({
      conversationType: "agent",
      conversationId: "agent-conversation-1",
      conversationKey: "agent:agent-conversation-1",
      agentId: "agent-1",
      messageKey: "message-uuid",
    });
    expect(
      parseNotificationRoute({
        surface_type: "script_room",
        conversation_key: "script:room-1",
        group_id: 9,
        script_id: "script-1",
      }),
    ).toMatchObject({
      conversationType: "script",
      conversationId: "room-1",
      conversationKey: "script:room-1",
      scriptRoomId: "room-1",
      scriptId: "script-1",
      groupId: 9,
    });
  });

  it("matches native foreground sound/banner suppression rules", () => {
    const active = {
      isConversationActive: (type: NotificationConversationType, id: string) =>
        type === "dm" && id === "u1",
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
    expect(
      presentationPolicyForPush(
        { conversation_id: "server-thread-1", sender_id: "u1", message_id: 8 },
        active,
      ),
    ).toEqual(policy(false, false));
    expect(presentationPolicyForPush({ push_type: "new_message", message_id: 9 }, active)).toEqual(
      policy(true, true),
    );
  });

  it("suppresses active agent/script surfaces and coalesces ordinary foreground banners for 1.5 seconds", () => {
    const inactive = {
      isConversationActive: () => false,
      now: () => 10_000,
    };
    expect(
      presentationPolicyForPush(
        { surface_type: "agent", surface_id: "agent-chat-1", message_id: "m1" },
        {
          isConversationActive: (type, id) => type === "agent" && id === "agent-chat-1",
          now: () => 10_000,
        },
      ),
    ).toEqual(policy(false, false));
    expect(
      presentationPolicyForPush(
        { surface_type: "script_room", surface_id: "room-1", message_id: 1 },
        {
          isConversationActive: (type, id) => type === "script" && id === "room-1",
          now: () => 10_000,
        },
      ),
    ).toEqual(policy(false, false));

    expect(
      presentationPolicyForPush(
        { surface_type: "agent", surface_id: "other-agent", message_id: "m1" },
        inactive,
      ),
    ).toEqual(policy(true, true));
    expect(
      presentationPolicyForPush(
        { surface_type: "agent", surface_id: "other-agent", message_id: "m2" },
        { ...inactive, now: () => 11_499 },
      ),
    ).toEqual(policy(false, false));
    expect(
      presentationPolicyForPush(
        { surface_type: "agent", surface_id: "other-agent", message_id: "m3" },
        { ...inactive, now: () => 11_500 },
      ),
    ).toEqual(policy(true, true));
    expect(
      presentationPolicyForPush(
        {
          surface_type: "group",
          surface_id: "7",
          message_id: 1,
          is_direct_mention: true,
        },
        inactive,
      ),
    ).toEqual(policy(true, true));
    expect(presentationPolicyForPush({ push_type: "security_alert" }, inactive)).toEqual(
      policy(true, true),
    );
  });

  it("builds conversation/moments open targets and leaves calls to CallProvider", () => {
    expect(pushOpenTarget({ push_type: "call", caller_id: "u1" }, "n1")).toBeNull();
    expect(
      pushOpenTarget({ push_type: "security_alert", sender_id: "u1" }, "security-1"),
    ).toBeNull();
    expect(pushOpenTarget({ push_type: "moments_update", event_id: "moment-1" }, "n2")).toEqual({
      kind: "moments",
      eventId: "moment-1",
    });
    expect(pushOpenTarget({ group_id: 7, message_id: 9 }, "n3")).toMatchObject({
      kind: "conversation",
      eventId: "group:7:message:9",
      route: { conversationType: "group", conversationId: "7", messageId: 9 },
    });
    expect(
      pushOpenTarget({ push_type: "friend_request", sender_id: "u1", message_id: 10 }, "n4"),
    ).toBeNull();
  });

  it("honors cached muted-group mention and important-member exceptions", () => {
    const settings = {
      group_id: 7,
      muted: true,
      notify_mentions_me: true,
      notify_mentions_all: false,
      important_member_ids: ["vip"],
      revision: 1,
    };
    expect(
      shouldAlertForGroupSettings(settings, {
        senderId: "ordinary",
        isDirectMention: false,
        isMentionAll: false,
      }),
    ).toBe(false);
    expect(
      shouldAlertForGroupSettings(settings, {
        senderId: "ordinary",
        isDirectMention: true,
        isMentionAll: false,
      }),
    ).toBe(true);
    expect(
      shouldAlertForGroupSettings(settings, {
        senderId: "vip",
        isDirectMention: false,
        isMentionAll: false,
      }),
    ).toBe(true);
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

  it("registers one foreground handler, applies a revisioned badge and triggers reconciliation", async () => {
    initializePushNotifications();
    initializePushNotifications();
    expect(Notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    await applyPushSideEffects(
      {
        sender_id: "u1",
        event_id: "event-1",
        total_unread_count: 8,
        unread_revision: 1,
      },
      "owner",
    );
    expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(8);
    expect(conversationSyncCoordinator.request).toHaveBeenCalledWith(
      "owner",
      "push_notification",
      expect.objectContaining({ conversation_type: "dm", conversation_id: "u1" }),
    );
  });

  it("deduplicates receive side effects and rejects stale or unversioned badge totals", async () => {
    await expect(
      applyPushSideEffects(
        {
          surface_type: "dm",
          surface_id: "u1",
          event_id: "event-1",
          message_id: 1,
          total_unread: 8,
          unread_revision: 10,
        },
        "owner",
      ),
    ).resolves.toBe(true);
    await expect(
      applyPushSideEffects(
        {
          surface_type: "dm",
          surface_id: "u1",
          event_id: "event-1",
          message_id: 1,
          total_unread: 8,
          unread_revision: 10,
        },
        "owner",
      ),
    ).resolves.toBe(false);
    await applyPushSideEffects(
      {
        surface_type: "dm",
        surface_id: "u1",
        event_id: "event-stale",
        total_unread: 99,
        unread_revision: 9,
      },
      "owner",
    );
    await applyPushSideEffects(
      { sender_id: "u1", event_id: "event-legacy", total_unread_count: 100 },
      "owner",
    );
    await applyPushSideEffects(
      {
        surface_type: "dm",
        surface_id: "u1",
        event_id: "event-new",
        total_unread: 7,
        unread_revision: 11,
      },
      "owner",
    );

    expect(Notifications.setBadgeCountAsync).toHaveBeenCalledTimes(2);
    expect(Notifications.setBadgeCountAsync).toHaveBeenNthCalledWith(1, 8);
    expect(Notifications.setBadgeCountAsync).toHaveBeenNthCalledWith(2, 7);
    expect(conversationSyncCoordinator.request).toHaveBeenCalledTimes(4);
  });

  it("retries the same unread revision when setting the absolute badge fails", async () => {
    const setBadge = jest.mocked(Notifications.setBadgeCountAsync);
    setBadge.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await applyPushSideEffects(
      {
        surface_type: "dm",
        surface_id: "u1",
        event_id: "badge-failed",
        message_id: 1,
        total_unread: 5,
        unread_revision: 30,
      },
      "owner",
    );
    await applyPushSideEffects(
      {
        surface_type: "dm",
        surface_id: "u1",
        event_id: "badge-retry",
        message_id: 1,
        total_unread: 5,
        unread_revision: 30,
      },
      "owner",
    );

    expect(setBadge).toHaveBeenCalledTimes(2);
    expect(setBadge).toHaveBeenNthCalledWith(1, 5);
    expect(setBadge).toHaveBeenNthCalledWith(2, 5);
  });

  it("advances unread revision even when the delivered message was already read", async () => {
    recordConversationNotificationRead("owner", "dm", "u1", 42);
    await applyPushSideEffects(
      {
        sender_id: "u1",
        event_id: "read-event",
        message_id: 42,
        total_unread: 0,
        unread_revision: 20,
      },
      "owner",
    );
    await applyPushSideEffects(
      {
        sender_id: "u1",
        event_id: "stale-event",
        message_id: 43,
        total_unread: 99,
        unread_revision: 19,
      },
      "owner",
    );

    expect(Notifications.setBadgeCountAsync).not.toHaveBeenCalled();
  });

  it("suppresses a delayed foreground push after its message was already read locally", async () => {
    recordConversationNotificationRead("owner", "dm", "u1", 42);
    setActivePushOwnerId("owner");
    initializePushNotifications();
    const handler = jest.mocked(Notifications.setNotificationHandler).mock.calls[0]?.[0];
    const behavior = await handler?.handleNotification(
      presented("late", {
        conversation_id: "server-thread-1",
        sender_id: "u1",
        message_id: 42,
        total_unread_count: 8,
      }),
    );

    expect(behavior).toEqual(policy(false, false));
    await applyPushSideEffects(
      {
        conversation_id: "server-thread-1",
        sender_id: "u1",
        message_id: 42,
        total_unread_count: 8,
      },
      "owner",
    );
    expect(Notifications.setBadgeCountAsync).not.toHaveBeenCalled();
    expect(conversationSyncCoordinator.request).toHaveBeenCalledWith(
      "owner",
      "push_notification",
      expect.objectContaining({ conversation_type: "dm", conversation_id: "server-thread-1" }),
    );
  });

  it("increments the active account moments tab badge for a foreground moments push", async () => {
    activateMomentsUnreadOwner("owner");
    await applyPushSideEffects({ push_type: "moments_update", event_id: "moment-1" }, "owner");
    expect(momentsUnreadSnapshot("owner")).toBe(1);
    await applyPushSideEffects({ push_type: "moments_update", event_id: "late" }, "old-owner");
    expect(momentsUnreadSnapshot("owner")).toBe(1);
  });

  it("dismisses only delivered chat notifications covered by the read watermark", async () => {
    getPresented.mockResolvedValue([
      presented("dm-40", { sender_id: "u1", message_id: 40 }),
      presented("dm-42", { sender_id: "u1", message_id: 42 }),
      presented("dm-43", { sender_id: "u1", message_id: 43 }),
      presented("other-dm", { sender_id: "u2", message_id: 4 }),
      presented("group", { group_id: 1, message_id: 1 }),
      presented("legacy-without-message-id", { sender_id: "u1" }),
    ]);

    await expect(dismissReadConversationNotifications("dm", "u1", 42)).resolves.toBe(2);
    expect(dismissNotification).toHaveBeenCalledTimes(2);
    expect(dismissNotification).toHaveBeenNthCalledWith(1, "dm-40");
    expect(dismissNotification).toHaveBeenNthCalledWith(2, "dm-42");
  });

  it("dismisses every delivered notification when its conversation gains focus", async () => {
    getPresented.mockResolvedValue([
      presented("dm-40", { conversation_id: "thread", sender_id: "u1", message_id: 40 }),
      presented("dm-legacy", { sender_id: "u1" }),
      presented("other-dm", { sender_id: "u2", message_id: 4 }),
      presented("group", { group_id: 1, message_id: 1 }),
    ]);

    await expect(dismissActiveConversationNotifications("dm", "u1")).resolves.toBe(2);
    expect(dismissNotification).toHaveBeenCalledWith("dm-40");
    expect(dismissNotification).toHaveBeenCalledWith("dm-legacy");
    expect(dismissNotification).not.toHaveBeenCalledWith("other-dm");
  });

  it("dismisses agent and script notifications by canonical surface and group alias", async () => {
    getPresented.mockResolvedValue([
      presented("agent", {
        surface_type: "agent",
        conversation_key: "agent:agent-chat-1",
        message_id: "uuid",
      }),
      presented("script", {
        surface_type: "script_room",
        conversation_key: "script:room-1",
        group_id: 9,
        message_sequence: 12,
      }),
      presented("other", {
        surface_type: "agent",
        conversation_key: "agent:agent-chat-2",
      }),
    ]);

    await expect(dismissActiveConversationNotifications("agent", "agent-chat-1")).resolves.toBe(1);
    await expect(dismissReadConversationNotifications("script", "room-1", 12)).resolves.toBe(1);
    await expect(dismissActiveConversationNotifications("group", "9")).resolves.toBe(1);
  });

  it("dismisses delivered Moments notifications without touching chat or call pushes", async () => {
    getPresented.mockResolvedValue([
      presented("moment-1", { push_type: "moments_update", event_id: "m1" }),
      presented("moment-2", { event_type: "moments_update", event_id: "m2" }),
      presented("chat", { sender_id: "u1", message_id: 1 }),
      presented("call", { push_type: "call", caller_id: "u1" }),
    ]);

    await expect(dismissReadMomentsNotifications()).resolves.toBe(2);
    expect(dismissNotification).toHaveBeenCalledTimes(2);
    expect(dismissNotification).toHaveBeenCalledWith("moment-1");
    expect(dismissNotification).toHaveBeenCalledWith("moment-2");
  });

  it("cleans notifications already covered by cached zero-unread conversations on startup", async () => {
    await reconcileConversationSnapshot("owner", {
      conversations: [
        conversation({ id: "u1", last_message_id: 42, unread_count: 0 }),
        conversation({ id: "u2", last_message_id: 7, unread_count: 1 }),
        conversation({
          type: "group",
          id: "group-9",
          group_id: 9,
          read_through_message_id: 12,
          unread_count: 0,
        }),
      ],
      revision: 1,
      snapshot_complete: true,
    });
    getPresented.mockResolvedValue([
      presented("read-dm", { sender_id: "u1", message_id: 42 }),
      presented("newer-dm", { sender_id: "u1", message_id: 43 }),
      presented("unread-dm", { sender_id: "u2", message_id: 7 }),
      presented("read-group", { group_id: 9, message_id: 12 }),
    ]);

    await expect(dismissCachedReadConversationNotifications("owner")).resolves.toBe(2);
    expect(dismissNotification).toHaveBeenCalledTimes(2);
    expect(dismissNotification).toHaveBeenCalledWith("read-dm");
    expect(dismissNotification).toHaveBeenCalledWith("read-group");
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

  it("queues multiple opens and removes them only after acknowledgement", async () => {
    const first = pushOpenTarget({ sender_id: "u1", message_id: 3 }, "n1")!;
    const second = pushOpenTarget({ group_id: 7, message_id: 4 }, "n2")!;
    await savePendingPushOpen(first);
    await savePendingPushOpen(second);

    expect(await claimPendingPushOpen()).toEqual(first);
    expect(await claimPendingPushOpen()).toEqual(second);
    releasePendingPushOpen(first.eventId);
    expect(await claimPendingPushOpen()).toEqual(first);
    await acknowledgePendingPushOpen(first.eventId);
    await acknowledgePendingPushOpen(second.eventId);
    expect(await claimPendingPushOpen()).toBeNull();
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

function presented(identifier: string, data: Record<string, unknown>): Notifications.Notification {
  return {
    date: Date.now(),
    request: { identifier, content: { data } },
  } as Notifications.Notification;
}

function conversation(overrides: Partial<import("@/models").Conversation> = {}) {
  return {
    type: "dm",
    id: "u1",
    name: "Alice",
    avatar_url: "",
    unread_count: 0,
    is_muted: false,
    ...overrides,
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
