import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { useEffect } from "react";

import { useAuth } from "@/providers/AuthProvider";
import { resumeMomentUploads } from "@/services/moments/MomentUploadQueue";
import { readCachedUser } from "@/storage/authStorage";

export const momentUploadBackgroundTaskName = "bwchat-moment-upload-recovery-v1";

if (!TaskManager.isTaskDefined(momentUploadBackgroundTaskName)) {
  TaskManager.defineTask(momentUploadBackgroundTaskName, async () => {
    try {
      const user = await readCachedUser();
      if (user?.user_id) {
        await resumeMomentUploads(user.user_id, { awaitCompletion: true });
      }
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export function MomentUploadBootstrap() {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";

  useEffect(() => {
    void ensureMomentUploadBackgroundTask().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (ownerId) void resumeMomentUploads(ownerId);
  }, [ownerId]);

  return null;
}

export async function ensureMomentUploadBackgroundTask(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(momentUploadBackgroundTaskName)) return;
  await BackgroundTask.registerTaskAsync(momentUploadBackgroundTaskName, {
    minimumInterval: 15,
  });
}
