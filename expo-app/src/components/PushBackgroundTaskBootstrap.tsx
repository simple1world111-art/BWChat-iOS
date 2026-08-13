import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { useEffect } from "react";

import { getConversationSyncSnapshot } from "@/api/bwchat";
import { reconcileConversationSnapshot } from "@/services/conversations/ConversationRepository";
import { captureException } from "@/services/monitoring/MonitoringService";
import { applyPushSideEffects } from "@/services/push/PushService";
import { readCachedUser } from "@/storage/authStorage";

export const pushBackgroundTaskName = "bwchat-push-reconciliation-v1";

if (!TaskManager.isTaskDefined(pushBackgroundTaskName)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    pushBackgroundTaskName,
    async ({ data, error }) => {
      if (error) return Notifications.BackgroundNotificationTaskResult.Failed;
      try {
        const user = await readCachedUser();
        const ownerId = user?.user_id ?? "";
        const payload = backgroundNotificationData(data);
        const applied = await applyPushSideEffects(payload, ownerId);
        if (ownerId && applied) {
          const snapshot = await getConversationSyncSnapshot();
          await reconcileConversationSnapshot(ownerId, snapshot);
        }
        return Notifications.BackgroundNotificationTaskResult.NewData;
      } catch (nextError) {
        captureException(nextError, { operation: "push_background_reconciliation" });
        return Notifications.BackgroundNotificationTaskResult.Failed;
      }
    },
  );
}

export function PushBackgroundTaskBootstrap() {
  useEffect(() => {
    void ensurePushBackgroundTask().catch((error) =>
      captureException(error, { operation: "push_background_registration" }),
    );
  }, []);
  return null;
}

export async function ensurePushBackgroundTask(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(pushBackgroundTaskName)) return;
  await Notifications.registerTaskAsync(pushBackgroundTaskName);
}

function backgroundNotificationData(data: Notifications.NotificationTaskPayload): unknown {
  if ("actionIdentifier" in data) return data.notification.request.content.data;
  if (data.data.dataString) {
    try {
      return JSON.parse(data.data.dataString) as unknown;
    } catch {
      return data.data;
    }
  }
  return { ...data.data, ...(data.aps ? { aps: data.aps } : {}) };
}
