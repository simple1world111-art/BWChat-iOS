type GroupMembersAddedListener = (groupId: number) => void;

const addedListeners = new Set<GroupMembersAddedListener>();

export function notifyGroupMembersAdded(groupId: number): void {
  if (!Number.isInteger(groupId) || groupId <= 0) return;
  for (const listener of [...addedListeners]) listener(groupId);
}

export function subscribeGroupMembersAdded(listener: GroupMembersAddedListener): () => void {
  addedListeners.add(listener);
  return () => addedListeners.delete(listener);
}
