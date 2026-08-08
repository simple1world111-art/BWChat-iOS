import type { FollowRelationship, PublicProfile } from "@/models";

export function optimisticPublicProfileFollow(profile: PublicProfile): {
  profile: PublicProfile;
  shouldSendFollow: boolean;
} {
  const shouldSendFollow = !profile.followed_by_me && !profile.follow_requested;
  if (shouldSendFollow && profile.is_private) {
    return {
      profile: { ...profile, followed_by_me: false, follow_requested: true },
      shouldSendFollow,
    };
  }
  if (shouldSendFollow) {
    return {
      profile: {
        ...profile,
        followed_by_me: true,
        follow_requested: false,
        follower_count: profile.follower_count + 1,
      },
      shouldSendFollow,
    };
  }
  return {
    profile: {
      ...profile,
      followed_by_me: false,
      follow_requested: false,
      follower_count: Math.max(0, profile.follower_count - (profile.followed_by_me ? 1 : 0)),
    },
    shouldSendFollow,
  };
}

export function applyRelationshipToPublicProfile(
  profile: PublicProfile,
  relationship: FollowRelationship,
): PublicProfile {
  if (profile.user_id !== relationship.user_id) return profile;
  return reconcilePublicProfileRelationship(profile, relationship);
}

/**
 * Applies a relationship already scoped by the caller's route/user guard.
 * Native UserProfileViewModel does not compare the returned profile's
 * canonical ID a second time after a direct route-target mutation.
 */
export function reconcilePublicProfileRelationship(
  profile: PublicProfile,
  relationship: FollowRelationship,
): PublicProfile {
  return {
    ...profile,
    followed_by_me: relationship.followed_by_me,
    follows_me: relationship.follows_me,
    is_friend: relationship.is_friend,
    follow_requested:
      relationship.follow_requested ??
      (relationship.followed_by_me ? false : profile.follow_requested),
    ...(relationship.following_count !== undefined
      ? { following_count: relationship.following_count }
      : {}),
    ...(relationship.follower_count !== undefined
      ? { follower_count: relationship.follower_count }
      : {}),
  };
}
