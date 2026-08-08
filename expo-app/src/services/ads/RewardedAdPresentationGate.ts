let activeOwner: string | undefined;

export function rewardedAdPresentationInFlight(): boolean {
  return activeOwner !== undefined;
}

export function acquireRewardedAdPresentation(owner: string): boolean {
  if (!owner || activeOwner !== undefined) return false;
  activeOwner = owner;
  return true;
}

export function releaseRewardedAdPresentation(owner: string): void {
  if (activeOwner === owner) activeOwner = undefined;
}

export function resetRewardedAdPresentationGateForTests(): void {
  if (process.env.NODE_ENV === "test") activeOwner = undefined;
}
