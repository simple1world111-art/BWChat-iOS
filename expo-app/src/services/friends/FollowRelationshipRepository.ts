import { apiRequest } from "@/api/client";
import { normalizeFollowRelationship } from "@/api/normalizers";
import type { FollowRelationship } from "@/models";
import { publishFollowRelationship } from "@/services/friends/FollowRelationshipStore";

export async function getFollowRelationship(
  ownerId: string,
  userId: string,
): Promise<FollowRelationship> {
  const relationship = {
    ...normalizeFollowRelationship(
      await apiRequest<unknown>(`/follows/${encodeURIComponent(userId)}/relationship`, {
        requiredEnvelope: true,
      }),
      userId,
      false,
    ),
    user_id: userId,
  };
  publishFollowRelationship({ relationship }, ownerId);
  return relationship;
}
