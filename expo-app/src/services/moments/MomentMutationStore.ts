import type { Moment } from "@/models";

export type MomentMutation =
  | { kind: "upsert"; moment: Moment }
  | { kind: "created"; moment: Moment }
  | { kind: "delete"; momentId: number };

type Listener = (mutation: MomentMutation) => void;

const listenersByOwner = new Map<string, Set<Listener>>();

export function publishMomentMutation(ownerId: string, mutation: MomentMutation): void {
  const owner = ownerId.trim();
  if (!owner) return;
  for (const listener of listenersByOwner.get(owner) ?? []) listener(mutation);
}

export function subscribeMomentMutation(ownerId: string, listener: Listener): () => void {
  const owner = ownerId.trim();
  if (!owner) return () => undefined;
  const listeners = listenersByOwner.get(owner) ?? new Set<Listener>();
  listeners.add(listener);
  listenersByOwner.set(owner, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByOwner.delete(owner);
  };
}
