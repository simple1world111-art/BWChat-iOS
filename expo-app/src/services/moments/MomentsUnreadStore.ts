import { useEffect, useSyncExternalStore } from "react";

type Listener = () => void;

export interface MomentsUnreadInfoSnapshot {
  unreadCount: number;
  hasNewMoments: boolean;
}

export interface MomentsUnreadRefreshToken {
  ownerId: string;
  revision: number;
}

const listeners = new Set<Listener>();
let activeOwnerId = "";
let unreadCount = 0;
let hasNewMoments = false;
let revision = 0;

export function activateMomentsUnreadOwner(ownerId: string): void {
  const owner = ownerId.trim();
  if (activeOwnerId === owner) return;
  activeOwnerId = owner;
  unreadCount = 0;
  hasNewMoments = false;
  revision += 1;
  notify();
}

export function captureMomentsUnreadRefresh(ownerId: string): MomentsUnreadRefreshToken {
  return { ownerId: ownerId.trim(), revision };
}

export function publishMomentsUnread(
  ownerId: string,
  count: number,
  token?: MomentsUnreadRefreshToken,
): number {
  const owner = ownerId.trim();
  if (!owner || owner !== activeOwnerId) return 0;
  if (!mayPublish(owner, token)) return unreadCount;
  const next = normalizeCount(count);
  if (unreadCount === next) return next;
  unreadCount = next;
  revision += 1;
  notify();
  return next;
}

export function publishMomentsUnreadInfo(
  ownerId: string,
  info: { unread_count: number; has_new_moments: boolean },
  token?: MomentsUnreadRefreshToken,
): MomentsUnreadInfoSnapshot {
  const owner = ownerId.trim();
  if (!owner || owner !== activeOwnerId || !mayPublish(owner, token)) {
    return momentsUnreadInfoSnapshot(owner);
  }
  const nextUnread = normalizeCount(info.unread_count);
  const nextHasNew = info.has_new_moments === true;
  if (unreadCount === nextUnread && hasNewMoments === nextHasNew) {
    return { unreadCount, hasNewMoments };
  }
  unreadCount = nextUnread;
  hasNewMoments = nextHasNew;
  revision += 1;
  notify();
  return { unreadCount, hasNewMoments };
}

export function incrementMomentsUnread(ownerId: string): number {
  const owner = ownerId.trim();
  if (!owner || owner !== activeOwnerId) return 0;
  unreadCount += 1;
  revision += 1;
  notify();
  return unreadCount;
}

export function clearMomentsUnread(ownerId: string): void {
  const owner = ownerId.trim();
  if (!owner || owner !== activeOwnerId) return;
  const changed = unreadCount !== 0;
  unreadCount = 0;
  revision += 1;
  if (changed) notify();
}

export function clearMomentsNew(ownerId: string): void {
  const owner = ownerId.trim();
  if (!owner || owner !== activeOwnerId) return;
  const changed = hasNewMoments;
  hasNewMoments = false;
  revision += 1;
  if (changed) notify();
}

export function consumeMomentsNew(ownerId: string): boolean {
  const hadNewMoments = momentsHasNewSnapshot(ownerId);
  clearMomentsNew(ownerId);
  return hadNewMoments;
}

export function momentsUnreadSnapshot(ownerId: string): number {
  const owner = ownerId.trim();
  return owner && owner === activeOwnerId ? unreadCount : 0;
}

export function momentsHasNewSnapshot(ownerId: string): boolean {
  const owner = ownerId.trim();
  return Boolean(owner && owner === activeOwnerId && hasNewMoments);
}

export function momentsUnreadInfoSnapshot(ownerId: string): MomentsUnreadInfoSnapshot {
  return {
    unreadCount: momentsUnreadSnapshot(ownerId),
    hasNewMoments: momentsHasNewSnapshot(ownerId),
  };
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

export function useMomentsHasNew(ownerId: string): boolean {
  const owner = ownerId.trim();
  useEffect(() => activateMomentsUnreadOwner(owner), [owner]);
  return useSyncExternalStore(
    subscribeMomentsUnread,
    () => momentsHasNewSnapshot(owner),
    () => false,
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
  hasNewMoments = false;
  revision = 0;
  listeners.clear();
}

function mayPublish(ownerId: string, token?: MomentsUnreadRefreshToken): boolean {
  return !token || (token.ownerId === ownerId && token.revision === revision);
}

function normalizeCount(count: number): number {
  return Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
}

function notify(): void {
  for (const listener of listeners) listener();
}
