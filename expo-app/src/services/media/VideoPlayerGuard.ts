interface VideoPlaybackController {
  pause(): void;
  play(): void;
}

const disposedSharedObjectMessage =
  "Unable to find the native shared object associated with given JavaScript object";

/**
 * Expo may release a VideoPlayer shared object before descendant React effects
 * finish cleaning up. Ignore only that native lifetime race; every other
 * player or business exception must remain visible.
 */
export function runVideoPlayerCall<T>(operation: () => T, disposedFallback: T): T {
  try {
    return operation();
  } catch (error) {
    if (isDisposedVideoPlayerError(error)) return disposedFallback;
    throw error;
  }
}

export function playVideoPlayer(player: VideoPlaybackController): void {
  runVideoPlayerCall(() => player.play(), undefined);
}

export function pauseVideoPlayer(player: VideoPlaybackController): void {
  runVideoPlayerCall(() => player.pause(), undefined);
}

export function isDisposedVideoPlayerError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return message.includes(disposedSharedObjectMessage);
}
