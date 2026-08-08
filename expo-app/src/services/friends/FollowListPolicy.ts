import { normalizeFollowUser } from "@/api/normalizers";
import type { FollowUser, FollowUsersPage } from "@/models";

export const followListPolicy = {
  pageSize: 30,
  recommendedLimit: 50,
  maximumCachedUsers: 500,
} as const;

/** Source geometry shared by all three FollowListViews.swift wrappers. */
export const followListMetrics = {
  navigationButton: 36,
  navigationSymbol: 17,
  contentHorizontalInset: 16,
  contentTopInset: 12,
  contentBottomInset: 28,
  rowGap: 10,
  rowMinimumHeight: 76,
  rowPadding: 14,
  rowRadius: 14,
  rowHorizontalGap: 12,
  identityGap: 12,
  avatarSize: 48,
  copyGap: 4,
  nameSize: 16,
  bioSize: 13,
  followButtonHeight: 32,
  followButtonHorizontalInset: 14,
  followButtonRadius: 16,
  followButtonTitleSize: 13,
  initialStateTopInset: 80,
  loadingMoreVerticalInset: 16,
  emptyGap: 12,
  emptyIconSize: 34,
  emptyTitleSize: 15,
} as const;

export function filterRecommendedFollowUsers(
  candidates: readonly FollowUser[],
  excludeUserId: string | undefined,
  currentUserId: string | undefined,
): FollowUser[] {
  const excluded = new Set(
    [excludeUserId?.trim(), currentUserId?.trim()].filter((value): value is string =>
      Boolean(value),
    ),
  );
  const seen = new Set<string>();
  return candidates.filter((user) => {
    const userId = user.user_id.trim();
    if (!userId || excluded.has(userId) || seen.has(userId)) return false;
    seen.add(userId);
    return true;
  });
}

export function decodeInitialRecommendedUsers(value: string | undefined): FollowUser[] {
  if (!value?.trim()) return [];
  try {
    const decoded: unknown = JSON.parse(value);
    if (!Array.isArray(decoded)) return [];
    return decoded.flatMap((candidate) => {
      try {
        const user = normalizeFollowUser(candidate);
        return user.user_id.trim() ? [user] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function mergeFollowPageUsers(
  current: readonly FollowUser[],
  incoming: readonly FollowUser[],
): FollowUser[] {
  const existingIds = new Set(current.map((user) => user.user_id));
  return [...current, ...incoming.filter((user) => !existingIds.has(user.user_id))];
}

export function nextFollowListPage(page: FollowUsersPage, currentPage: number): number | null {
  return page.has_more ? (page.next_page ?? currentPage + 1) : null;
}

export function acquireFollowListOperation(active: Set<string>, userId: string): boolean {
  if (active.has(userId)) return false;
  active.add(userId);
  return true;
}

export function releaseFollowListOperation(active: Set<string>, userId: string): void {
  active.delete(userId);
}

export function optimisticFollowUser(user: FollowUser): FollowUser {
  const followedByMe = !user.followed_by_me;
  return {
    ...user,
    followed_by_me: followedByMe,
    follower_count: Math.max(0, user.follower_count + (followedByMe ? 1 : -1)),
  };
}
