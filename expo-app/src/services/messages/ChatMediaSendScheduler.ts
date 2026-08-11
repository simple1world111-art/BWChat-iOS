export interface ChatMediaUploadTask {
  start: () => Promise<void>;
  onError: (error: unknown) => void;
}

export const chatMediaUploadSchedulePolicy = Object.freeze({
  fallbackDelayMilliseconds: 100,
});

/**
 * Give React Native one frame to commit optimistic timeline rows before
 * durable staging, thumbnail generation, and uploads start competing for work.
 * The timeout covers runtimes that briefly stop producing animation frames
 * while the system picker dismissal is settling.
 */
export function startChatMediaUploadsAfterOptimisticRender(
  tasks: readonly ChatMediaUploadTask[],
): void {
  if (tasks.length === 0) return;
  const pending = [...tasks];
  let started = false;
  let frame: number | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;

  const start = () => {
    if (started) return;
    started = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (fallback !== undefined) clearTimeout(fallback);
    for (const task of pending) {
      void Promise.resolve().then(task.start).catch(task.onError);
    }
  };

  frame = requestAnimationFrame(start);
  fallback = setTimeout(start, chatMediaUploadSchedulePolicy.fallbackDelayMilliseconds);
}
