export interface ChatMediaUploadTask {
  start: () => Promise<void>;
  onError: (error: unknown) => void;
}

export const chatMediaUploadSchedulePolicy = Object.freeze({
  fallbackDelayMilliseconds: 100,
  optimisticRenderFrames: 2,
});

/**
 * Give React Native one complete frame to commit optimistic timeline rows before
 * durable staging, thumbnail generation, and uploads start competing for work.
 * Starting work in the first requestAnimationFrame callback can still block
 * that frame's native paint, because animation callbacks run before the frame
 * is presented. The second callback guarantees that the first frame was handed
 * back to the renderer.
 *
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

  const waitForFrame = (remaining: number) => {
    frame = requestAnimationFrame(() => {
      if (started) return;
      if (remaining <= 1) {
        start();
        return;
      }
      waitForFrame(remaining - 1);
    });
  };

  waitForFrame(chatMediaUploadSchedulePolicy.optimisticRenderFrames);
  fallback = setTimeout(start, chatMediaUploadSchedulePolicy.fallbackDelayMilliseconds);
}

/** Waits for the same optimistic-render boundary used by direct/group media outboxes. */
export function waitForChatOptimisticRender(): Promise<void> {
  return new Promise((resolve) => {
    startChatMediaUploadsAfterOptimisticRender([
      {
        start: async () => resolve(),
        onError: () => resolve(),
      },
    ]);
  });
}
