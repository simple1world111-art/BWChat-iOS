import type { FollowRelationship, FollowUser, PublicProfile, SearchUser } from "@/models";
import { mutateCachedFollowList } from "@/services/friends/FollowListRepository";
import {
  readCachedPublicProfile,
  saveCachedPublicProfile,
} from "@/services/profile/PublicProfileRepository";
import { applyRelationshipToPublicProfile } from "@/services/profile/PublicProfileRelationship";

export interface FollowRelationshipEvent {
  relationship: FollowRelationship;
  user?: FollowUser | undefined;
  ownerId?: string | undefined;
}

type Listener = (event: FollowRelationshipEvent) => void;
const listenersByOwner = new Map<string, Set<Listener>>();

export function publishFollowRelationship(event: FollowRelationshipEvent, ownerId: string): void {
  const normalizedOwnerId = ownerId.trim();
  if (!normalizedOwnerId) return;
  const scopedEvent = { ...event, ownerId: normalizedOwnerId };
  for (const listener of [...(listenersByOwner.get(normalizedOwnerId) ?? [])]) {
    listener(scopedEvent);
  }
  void applyFollowRelationshipToCaches(normalizedOwnerId, scopedEvent).catch(() => undefined);
}

export function subscribeFollowRelationship(ownerId: string, listener: Listener): () => void {
  const normalizedOwnerId = ownerId.trim();
  if (!normalizedOwnerId) return () => undefined;
  const listeners = listenersByOwner.get(normalizedOwnerId) ?? new Set<Listener>();
  listeners.add(listener);
  listenersByOwner.set(normalizedOwnerId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByOwner.delete(normalizedOwnerId);
  };
}

export function followUserFromSearch(user: SearchUser): FollowUser {
  return {
    user_id: user.user_id,
    username: "",
    nickname: user.nickname,
    avatar_url: user.avatar_url,
    bio: "",
    following_count: 0,
    follower_count: 0,
    followed_by_me: user.followed_by_me,
    follows_me: false,
    is_friend: false,
  };
}

export function applyRelationshipToFollowUser(
  user: FollowUser,
  relationship: FollowRelationship,
): FollowUser {
  if (user.user_id !== relationship.user_id) return user;
  return {
    ...user,
    followed_by_me: relationship.followed_by_me,
    follows_me: relationship.follows_me,
    is_friend: relationship.is_friend,
    ...(relationship.following_count !== undefined
      ? { following_count: relationship.following_count }
      : {}),
    ...(relationship.follower_count !== undefined
      ? { follower_count: relationship.follower_count }
      : {}),
  };
}

export function reconcileFollowListRelationship(
  users: FollowUser[],
  event: FollowRelationshipEvent,
  context: {
    kind: "following" | "followers" | "recommended";
    ownerId: string;
    subjectId: string;
  },
): FollowUser[] {
  const { relationship } = event;
  const index = users.findIndex((user) => user.user_id === relationship.user_id);
  const isMyFollowing = context.kind === "following" && context.subjectId === context.ownerId;
  if (isMyFollowing && !relationship.followed_by_me) {
    return index < 0 ? users : users.filter((_, itemIndex) => itemIndex !== index);
  }
  if (isMyFollowing && relationship.followed_by_me && index < 0 && event.user) {
    return [applyRelationshipToFollowUser(event.user, relationship), ...users];
  }
  if (index < 0) return users;
  return users.map((user, itemIndex) =>
    itemIndex === index ? applyRelationshipToFollowUser(user, relationship) : user,
  );
}

export async function applyFollowRelationshipToCaches(
  ownerId: string,
  event: FollowRelationshipEvent,
): Promise<void> {
  const normalizedOwnerId = ownerId.trim();
  if (!normalizedOwnerId) return;
  const cachedProfile = await readCachedPublicProfile(
    normalizedOwnerId,
    event.relationship.user_id,
  );
  const profileUser = cachedProfile
    ? await updateCachedProfile(normalizedOwnerId, cachedProfile, event.relationship)
    : undefined;
  const suppliedUser = profileUser ?? event.user;

  await Promise.all([
    mutateCachedFollowList(normalizedOwnerId, normalizedOwnerId, "followers", (page) =>
      updateExistingCachedRow(page, event.relationship),
    ),
    mutateCachedFollowList(normalizedOwnerId, normalizedOwnerId, "following", (page) => {
      const index = page.users.findIndex((user) => user.user_id === event.relationship.user_id);
      if (!event.relationship.followed_by_me) {
        if (index < 0) return null;
        return {
          ...page,
          users: page.users.filter((_, itemIndex) => itemIndex !== index),
        };
      }
      if (index >= 0) return updateExistingCachedRow(page, event.relationship);
      if (!suppliedUser) return "invalidate";
      return {
        ...page,
        users: [applyRelationshipToCachedUser(suppliedUser, event.relationship), ...page.users],
      };
    }),
  ]);
}

function updateExistingCachedRow(
  page: { users: FollowUser[]; has_more: boolean; next_page?: number | undefined },
  relationship: FollowRelationship,
) {
  const index = page.users.findIndex((user) => user.user_id === relationship.user_id);
  if (index < 0) return null;
  return {
    ...page,
    users: page.users.map((user, itemIndex) =>
      itemIndex === index ? applyRelationshipToCachedUser(user, relationship) : user,
    ),
  };
}

function applyRelationshipToCachedUser(
  user: FollowUser,
  relationship: FollowRelationship,
): FollowUser {
  const wasFollowedByMe = user.followed_by_me;
  const updated = applyRelationshipToFollowUser(user, relationship);
  if (
    relationship.follower_count === undefined &&
    wasFollowedByMe !== relationship.followed_by_me
  ) {
    return {
      ...updated,
      follower_count: Math.max(0, user.follower_count + (relationship.followed_by_me ? 1 : -1)),
    };
  }
  return updated;
}

async function updateCachedProfile(
  ownerId: string,
  profile: PublicProfile,
  relationship: FollowRelationship,
): Promise<FollowUser> {
  const wasFollowedByMe = profile.followed_by_me;
  let next = applyRelationshipToPublicProfile(profile, relationship);
  if (
    relationship.follower_count === undefined &&
    wasFollowedByMe !== relationship.followed_by_me
  ) {
    next = {
      ...next,
      follower_count: Math.max(0, profile.follower_count + (relationship.followed_by_me ? 1 : -1)),
    };
  }
  await saveCachedPublicProfile(ownerId, next);
  return publicProfileFollowUser(next);
}

function publicProfileFollowUser(profile: PublicProfile): FollowUser {
  return {
    user_id: profile.user_id,
    username: profile.username,
    nickname: profile.nickname,
    avatar_url: profile.avatar_url,
    bio: profile.bio,
    following_count: profile.following_count,
    follower_count: profile.follower_count,
    followed_by_me: profile.followed_by_me,
    follows_me: profile.follows_me,
    is_friend: profile.is_friend,
  };
}
