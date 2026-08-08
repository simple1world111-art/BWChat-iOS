import { useEffect, useSyncExternalStore } from "react";

type Listener = () => void;

const listeners = new Set<Listener>();
let activeOwnerId = "";
let unreadCount = 0;

export function activateMomentsUnreadOwner(ownerId: string): void {
  const owner = ownerId.trim();
  if (activeOwnerId === owner) return;
  activeOwnerId = owner;
  unreadCount = 0;
  notify();
}

export function publishMomentsUnread(ownerId: string, count: number): number {
  const owner = ownerId.trim();
  if (!owner || owner !== activeOwnerId) return 0;
  const next = normalizeCount(count);
  if (unreadCount === next) return next;
  unreadCount = next;
  notify();
  return next;
}

export function incrementMomentsUnread(ownerId: string): number {
  const owner = ownerId.trim();
  if (!owner || owner !== activeOwnerId) return 0;
  unreadCount += 1;
  notify();
  return unreadCount;
}

export function clearMomentsUnread(ownerId: string): void {
  publishMomentsUnread(ownerId, 0);
}

export function momentsUnreadSnapshot(ownerId: string): number {
  const owner = ownerId.trim();
  return owner && owner === activeOwnerId ? unreadCount : 0;
}

export function subscribeMomentsUnread(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMomentsUnread(ownerId: string): number {
  const owner = ownerId.trim();
  useEffect(() => activateMomentsUnreadOwner(owner), [owner]);
  return useSyncExternalStore(
    subscribeMomentsUnread,
    () => momentsUnreadSnapshot(owner),
    () => 0,
  );
}

export function momentsUnreadBadgeText(count: number): string | null {
  const normalized = normalizeCount(count);
  if (normalized === 0) return null;
  return normalized > 99 ? "99+" : String(normalized);
}

export function resetMomentsUnreadStoreForTests(): void {
  activeOwnerId = "";
  unreadCount = 0;
  listeners.clear();
}

function normalizeCount(count: number): number {
  return Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
}

function notify(): void {
  for (const listener of listeners) listener();
}
