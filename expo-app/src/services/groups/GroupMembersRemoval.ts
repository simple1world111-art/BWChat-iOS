import { removeGroupMember } from "@/api/bwchat";

type GroupMemberRemovalCallbacks = {
  onRemoved: () => void;
  onChanged: () => void;
  onError: (error: unknown) => void;
};

export async function executeGroupMemberRemoval(
  groupId: number,
  userId: string,
  callbacks: GroupMemberRemovalCallbacks,
): Promise<void> {
  try {
    await removeGroupMember(groupId, userId);
    callbacks.onRemoved();
    callbacks.onChanged();
  } catch (error) {
    callbacks.onError(error);
  }
}
