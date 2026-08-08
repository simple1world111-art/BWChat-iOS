import { createGroup, getGroups } from "@/api/bwchat";
import { loadGroupsWithNativeCache } from "@/services/groups/GroupRepository";

export type CreateGroupInput = {
  name: string;
  memberIds: readonly string[];
  isPublic: boolean;
  ownerId: string;
  isOwnerCurrent?: (() => boolean) | undefined;
};

export async function createGroupWithNativeRefresh(input: CreateGroupInput): Promise<boolean> {
  const ownerId = input.ownerId.trim();
  if (!ownerId) return false;
  try {
    await createGroup(input.name, input.memberIds, input.isPublic);
  } catch {
    return false;
  }
  if (input.isOwnerCurrent && !input.isOwnerCurrent()) return true;
  try {
    await loadGroupsWithNativeCache(ownerId, getGroups);
  } catch {
    // Native GroupsViewModel treats a successful create as success even if list reload fails.
  }
  return true;
}
