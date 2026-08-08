import { isDisposedVideoPlayerError, runVideoPlayerCall } from "@/services/media/VideoPlayerGuard";

export interface ShortDramaVideoPlayerSnapshot {
  position: number;
  duration: number;
}

interface ShortDramaVideoPlayerSnapshotSource {
  currentTime: number;
  duration: number;
}

/**
 * Expo can release a VideoPlayer shared object before descendant React effect cleanups run.
 * Ignore only that native lifetime race; every other player/business exception remains visible.
 */
export function runShortDramaVideoPlayerCall<T>(operation: () => T, disposedFallback: T): T {
  return runVideoPlayerCall(operation, disposedFallback);
}

export function readShortDramaVideoPlayerSnapshot(
  player: ShortDramaVideoPlayerSnapshotSource,
  fallback: ShortDramaVideoPlayerSnapshot,
): ShortDramaVideoPlayerSnapshot {
  return {
    position: runShortDramaVideoPlayerCall(() => player.currentTime, fallback.position),
    duration: runShortDramaVideoPlayerCall(() => player.duration, fallback.duration),
  };
}

export function isDisposedShortDramaVideoPlayerError(error: unknown): boolean {
  return isDisposedVideoPlayerError(error);
}
