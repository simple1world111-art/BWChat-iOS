import type { FriendRequest } from "@/models";

export const friendRequestsMetrics = {
  backButtonSize: 36,
  backSymbolSize: 17,
  emptyGap: 14,
  emptyIconSize: 40,
  emptyTextSize: 15,
  rowHorizontalInset: 16,
  rowVerticalInset: 10,
  rowGap: 12,
  rowSpacerMinWidth: 4,
  rowResolvedHeight: 64,
  avatarSize: 44,
  copyGap: 3,
  nameSize: 16,
  subtitleSize: 13,
  actionsGap: 8,
  actionSize: 38,
  actionRadius: 19,
  actionSymbolSize: 14,
  dividerLeadingInset: 72,
  toastMilliseconds: 2_000,
} as const;

export function acquireFriendRequestOperation(active: Set<number>, requestId: number): boolean {
  if (active.has(requestId)) return false;
  active.add(requestId);
  return true;
}

export function releaseFriendRequestOperation(active: Set<number>, requestId: number): void {
  active.delete(requestId);
}

export function withoutFriendRequest(
  requests: readonly FriendRequest[],
  requestId: number,
): FriendRequest[] {
  return requests.filter((request) => request.request_id !== requestId);
}

export function withoutResolvedFriendRequests(
  requests: readonly FriendRequest[],
  resolvedRequestIds: ReadonlySet<number>,
): FriendRequest[] {
  if (resolvedRequestIds.size === 0) return [...requests];
  return requests.filter((request) => !resolvedRequestIds.has(request.request_id));
}
