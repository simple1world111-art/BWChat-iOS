export const discoverRefreshDelayMs = 280;
export const discoverConfigMinimumRefreshIntervalMs = 5 * 60 * 1_000;

export function shouldFetchDiscoverConfig(input: {
  force: boolean;
  nowMs: number;
  lastAttemptMs: number;
}): boolean {
  return input.force || input.nowMs - input.lastAttemptMs >= discoverConfigMinimumRefreshIntervalMs;
}

export function discoverRefreshMayCommit(input: {
  generation: number;
  currentGeneration: number;
  targetOwnerId: string;
  activeOwnerId: string;
  focused: boolean;
}): boolean {
  return (
    input.focused &&
    input.generation === input.currentGeneration &&
    input.targetOwnerId === input.activeOwnerId
  );
}
