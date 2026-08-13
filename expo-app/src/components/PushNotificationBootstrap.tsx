import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/providers/AuthProvider";
import { publishCallNotification } from "@/services/calls/CallNotificationBridge";
import { useConversationUnread } from "@/services/conversations/ConversationUnreadStore";
import { conversationSyncCoordinator } from "@/services/conversations/ConversationSyncCoordinator";
import { captureException } from "@/services/monitoring/MonitoringService";
import { selectMainTabThenPush } from "@/services/main-tab/MainTabNavigation";
import { useMomentsUnread } from "@/services/moments/MomentsUnreadStore";
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

export function PushNotificationBootstrap() {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const conversationUnread = useConversationUnread(ownerId);
  const momentsUnread = useMomentsUnread(ownerId);
  const pendingConsumerRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    setActivePushOwnerId(ownerId);
    return () => setActivePushOwnerId("");
  }, [ownerId]);

  useEffect(() => {
    void Notifications.setBadgeCountAsync(ownerId ? conversationUnread + momentsUnread : 0).catch(
      (error) => captureException(error, { operation: "application_badge_sync" }),
    );
  }, [conversationUnread, momentsUnread, ownerId]);

  useEffect(() => {
    if (!ownerId) return;
    void dismissCachedReadConversationNotifications(ownerId).catch((error) =>
      captureException(error, { operation: "cached_read_notification_bootstrap" }),
    );
  }, [ownerId]);

  const consumePending = useCallback((): Promise<void> => {
    if (!user?.user_id) return Promise.resolve();
    if (pendingConsumerRef.current) return pendingConsumerRef.current;
    const task = (async () => {
      for (let index = 0; index < 16; index += 1) {
        const target = await claimPendingPushOpen();
        if (!target) return;
        try {
          if (!(await wasPushEventProcessed(target.eventId))) {
            if (target.kind === "conversation") {
              await conversationSyncCoordinator.request(user.user_id, "push_open", {
                conversation_type: target.route.conversationType,
                conversation_id: target.route.conversationId,
                message_id: target.route.messageSequence ?? target.route.messageId,
                message_version: target.route.messageVersion,
              });
            }
            navigatePushTarget(target);
            await markPushEventProcessed(target.eventId);
          }
          await acknowledgePendingPushOpen(target.eventId);
        } catch (error) {
          releasePendingPushOpen(target.eventId);
          throw error;
        }
      }
    })().finally(() => {
      if (pendingConsumerRef.current === task) pendingConsumerRef.current = null;
    });
    pendingConsumerRef.current = task;
    return task;
  }, [user?.user_id]);

  useEffect(() => {
    if (!user?.user_id) return;
    const controller = new AbortController();
    const sessionGeneration = beginNativePushUploadSession(user.user_id);
    void requestPushPermission().catch((error) =>
      captureException(error, { operation: "push_permission" }),
    );
    void ensureNativePushTokenUploaded(user.user_id, {
      signal: controller.signal,
      sessionGeneration,
    }).catch((error) => captureException(error, { operation: "push_token_upload" }));
    void consumePending().catch((error) =>
      captureException(error, { operation: "push_pending_route" }),
    );
    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      void cacheNativePushToken(token)
        .then((value) =>
          ensureNativePushTokenUploaded(user.user_id, {
            signal: controller.signal,
            token: value,
            sessionGeneration,
          }),
        )
        .catch((error) => captureException(error, { operation: "push_token_refresh" }));
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void ensureNativePushTokenUploaded(user.user_id, {
          signal: controller.signal,
          sessionGeneration,
        }).catch((error) => captureException(error, { operation: "push_token_foreground" }));
      }
    });
    return () => {
      controller.abort();
      tokenSubscription.remove();
      appStateSubscription.remove();
    };
  }, [consumePending, user?.user_id]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((notification) => {
      handleCallNotification(notification.request.content.data);
      void applyPushSideEffects(notification.request.content.data, user?.user_id).catch((error) =>
        captureException(error, { operation: "push_received" }),
      );
    });
    const open = async (response: Notifications.NotificationResponse) => {
      if (handleCallNotification(response.notification.request.content.data)) return;
      const target = pushOpenTarget(
        response.notification.request.content.data,
        response.notification.request.identifier,
      );
      if (!target) return;
      await savePendingPushOpen(target);
      if (user?.user_id) await consumePending();
    };
    const responded = Notifications.addNotificationResponseReceivedListener((response) => {
      void open(response).catch((error) => captureException(error, { operation: "push_response" }));
    });
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) return open(response);
      })
      .catch((error) => captureException(error, { operation: "push_cold_response" }));
    return () => {
      received.remove();
      responded.remove();
    };
  }, [consumePending, user?.user_id]);

  return null;
}

function handleCallNotification(data: unknown): boolean {
  const result = publishCallNotification(data);
  if (result.kind === "not_call") return false;
  if (result.kind === "invalid") {
    captureException(new Error("Incoming call notification payload is incomplete"), {
      operation: "call_push_decode",
      missing_fields: result.missingFields.join(","),
      push_type: result.pushType,
    });
  }
  return true;
}

function navigatePushTarget(target: PushOpenTarget): void {
  if (target.kind === "moments") {
    selectMainTabThenPush("discover", "/moments-notifications");
    return;
  }
  const { route } = target;
  if (route.conversationType === "agent") {
    selectMainTabThenPush("messages", {
      pathname: "/agent-chat",
      params: {
        conversationId: route.conversationId,
        ...(route.agentId ? { agentId: route.agentId } : {}),
        ...(route.conversationName || route.senderName
          ? { name: route.conversationName ?? route.senderName }
          : {}),
        ...(route.agentAvatarAssetId ? { avatarId: route.agentAvatarAssetId } : {}),
      },
    });
    return;
  }
  if (route.conversationType === "script") {
    selectMainTabThenPush("messages", {
      pathname: "/script-room-chat",
      params: { roomId: route.scriptRoomId ?? route.conversationId },
    });
    return;
  }
  if (route.conversationType === "group") {
    selectMainTabThenPush("messages", {
      pathname: "/group-chat/[id]",
      params: {
        id: route.conversationId,
        ...(route.groupName || route.conversationName
          ? { name: route.groupName ?? route.conversationName }
          : {}),
        ...(route.messageId !== undefined ? { messageId: String(route.messageId) } : {}),
        ...(route.messageId !== undefined ? { latestMessageId: String(route.messageId) } : {}),
      },
    });
    return;
  }
  selectMainTabThenPush("messages", {
    pathname: "/chat/[id]",
    params: {
      id: route.conversationId,
      ...(route.senderName ? { name: route.senderName } : {}),
      ...(route.senderAvatar ? { avatar: route.senderAvatar } : {}),
      ...(route.messageId !== undefined ? { messageId: String(route.messageId) } : {}),
      ...(route.messageId !== undefined ? { latestMessageId: String(route.messageId) } : {}),
    },
  });
}
