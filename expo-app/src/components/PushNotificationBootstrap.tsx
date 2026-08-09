import * as Notifications from "expo-notifications";
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/providers/AuthProvider";
import { useConversationUnread } from "@/services/conversations/ConversationUnreadStore";
import { captureException } from "@/services/monitoring/MonitoringService";
import { selectMainTabThenPush } from "@/services/main-tab/MainTabNavigation";
import { useMomentsUnread } from "@/services/moments/MomentsUnreadStore";
import {
  applyPushSideEffects,
  beginNativePushUploadSession,
  cacheNativePushToken,
  dismissCachedReadConversationNotifications,
  ensureNativePushTokenUploaded,
  markPushEventProcessed,
  pushOpenTarget,
  requestPushPermission,
  savePendingPushOpen,
  takePendingPushOpen,
  wasPushEventProcessed,
  type PushOpenTarget,
} from "@/services/push/PushService";

export function PushNotificationBootstrap() {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const conversationUnread = useConversationUnread(ownerId);
  const momentsUnread = useMomentsUnread(ownerId);

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

  const consumePending = useCallback(async () => {
    if (!user?.user_id) return;
    const target = await takePendingPushOpen();
    if (!target || (await wasPushEventProcessed(target.eventId))) return;
    navigatePushTarget(target);
    await markPushEventProcessed(target.eventId);
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
      void applyPushSideEffects(notification.request.content.data, user?.user_id).catch((error) =>
        captureException(error, { operation: "push_received" }),
      );
    });
    const open = async (response: Notifications.NotificationResponse) => {
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

function navigatePushTarget(target: PushOpenTarget): void {
  if (target.kind === "moments") {
    selectMainTabThenPush("discover", "/moments-notifications");
    return;
  }
  const { route } = target;
  if (route.conversationType === "group") {
    selectMainTabThenPush("messages", {
      pathname: "/group-chat/[id]",
      params: {
        id: route.conversationId,
        ...(route.groupName ? { name: route.groupName } : {}),
        ...(route.messageId !== undefined ? { messageId: String(route.messageId) } : {}),
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
    },
  });
}
