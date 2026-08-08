import type { FollowRelationship, SearchUser } from "@/models";

export const addFriendPolicy = {
  searchDebounceMilliseconds: 400,
  messageNavigationDelayMilliseconds: 250,
} as const;

export function normalizedAddFriendQuery(value: string): string {
  return value.trim();
}

export function shouldFollowSearchUser(user: SearchUser): boolean {
  return !user.followed_by_me && !user.follow_requested;
}

export function acquireAddFriendOperation(activeUserIds: Set<string>, userId: string): boolean {
  if (activeUserIds.has(userId)) return false;
  activeUserIds.add(userId);
  return true;
}

export function releaseAddFriendOperation(activeUserIds: Set<string>, userId: string): void {
  activeUserIds.delete(userId);
}

export function optimisticSearchUserFollow(user: SearchUser): SearchUser {
  return {
    ...user,
    followed_by_me: shouldFollowSearchUser(user),
    follow_requested: false,
  };
}

export function applyRelationshipToSearchUsers(
  users: readonly SearchUser[],
  relationship: FollowRelationship,
): SearchUser[] {
  return users.map((user) =>
    user.user_id === relationship.user_id
      ? {
          ...user,
          followed_by_me: relationship.followed_by_me,
          follow_requested: relationship.follow_requested ?? false,
        }
      : user,
  );
}
