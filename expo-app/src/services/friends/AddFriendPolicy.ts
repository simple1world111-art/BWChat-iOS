import type { FollowRelationship, FollowUser, SearchUser } from "@/models";

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

export function reconcileSearchUsersWithKnownFollowing(
  users: readonly SearchUser[],
  knownUsers: readonly Pick<FollowUser, "user_id" | "followed_by_me">[],
): SearchUser[] {
  const followedUserIds = new Set(
    knownUsers.filter((user) => user.followed_by_me).map((user) => user.user_id),
  );
  return users.map((user) =>
    !user.followed_by_me && followedUserIds.has(user.user_id)
      ? { ...user, followed_by_me: true, follow_requested: false }
      : user,
  );
}

export function mergeSearchUsersWithKnownFollowing(
  users: readonly SearchUser[],
  knownUsers: readonly FollowUser[],
  query: string,
): SearchUser[] {
  const reconciled = reconcileSearchUsersWithKnownFollowing(users, knownUsers);
  const seenUserIds = new Set(reconciled.map((user) => user.user_id));
  const normalizedQuery = normalizedAddFriendQuery(query).toLocaleLowerCase();
  if (!normalizedQuery) return reconciled;

  const merged = [...reconciled];
  for (const user of knownUsers) {
    if (!user.followed_by_me || seenUserIds.has(user.user_id)) continue;
    if (
      ![user.user_id, user.username, user.nickname].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      )
    ) {
      continue;
    }
    seenUserIds.add(user.user_id);
    merged.push({
      user_id: user.user_id,
      nickname: user.nickname,
      avatar_url: user.avatar_url,
      relation: user.is_friend ? "friend" : "none",
      followed_by_me: true,
      follow_requested: false,
    });
  }
  return merged;
}
