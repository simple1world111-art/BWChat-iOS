type Listener = (messageId: number) => void;

const pending = new Map<number, number>();
const listeners = new Map<number, Set<Listener>>();

export function requestGroupMessageLocation(groupId: number, messageId: number): void {
  if (!validId(groupId) || !validId(messageId)) return;
  const current = listeners.get(groupId);
  if (!current || current.size === 0) {
    pending.set(groupId, messageId);
    return;
  }
  pending.delete(groupId);
  for (const listener of current) listener(messageId);
}

export function subscribeGroupMessageLocation(groupId: number, listener: Listener): () => void {
  if (!validId(groupId)) return () => undefined;
  const current = listeners.get(groupId) ?? new Set<Listener>();
  current.add(listener);
  listeners.set(groupId, current);
  const requested = pending.get(groupId);
  if (requested !== undefined) {
    pending.delete(groupId);
    queueMicrotask(() => {
      if (listeners.get(groupId)?.has(listener)) listener(requested);
    });
  }
  return () => {
    const groupListeners = listeners.get(groupId);
    groupListeners?.delete(listener);
    if (groupListeners?.size === 0) listeners.delete(groupId);
  };
}

export function clearGroupMessageLocationRequestsForTests(): void {
  pending.clear();
  listeners.clear();
}

function validId(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
