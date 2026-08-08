import type { FollowUser, FollowUsersPage } from "@/models";

export type GroupMemberSourceKind = "mutual" | "followers";

export function eligibleGroupMembers(
  source: GroupMemberSourceKind,
  currentUserId: string | undefined,
  users: readonly FollowUser[],
): FollowUser[] {
  return users.filter(
    (member) =>
      member.user_id !== currentUserId &&
      (source === "followers" || (member.followed_by_me && member.follows_me)),
  );
}

export function mergeUniqueGroupMembers(
  current: readonly FollowUser[],
  incoming: readonly FollowUser[],
): FollowUser[] {
  const known = new Set(current.map((member) => member.user_id));
  return [...current, ...incoming.filter((member) => !known.has(member.user_id))];
}

export function nextFollowPage(result: FollowUsersPage, currentPage: number): number | null {
  if (!result.has_more) return null;
  const candidate = result.next_page ?? currentPage + 1;
  return candidate > currentPage ? candidate : currentPage + 1;
}
