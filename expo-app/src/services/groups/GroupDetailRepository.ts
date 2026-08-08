import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  isRecord,
  normalizeGroupDetail,
  trimFoundationWhitespacesAndNewlines,
} from "@/api/normalizers";
import type {
  GroupAnnouncement,
  GroupCapabilities,
  GroupDetail,
  GroupMember,
  GroupNotificationSettings,
  GroupViewerSettings,
} from "@/models";
import { updateCachedGroupSummary } from "@/services/groups/GroupRepository";

const keyPrefix = "bwchat.group-detail.v1";
const profileCacheTtlMilliseconds = 10 * 60 * 1_000;
const repositoryGenerations = new Map<string, number>();
const writeChains = new Map<string, Promise<void>>();
type DetailListener = (detail: GroupDetail) => void;
interface ScopedDetailListener {
  ownerId: string;
  listener: DetailListener;
}
const detailListeners = new Set<ScopedDetailListener>();

export interface GroupDetailCacheSnapshot {
  detail: GroupDetail;
  savedAt: number;
  isFresh: boolean;
}

export async function loadCachedGroupDetail(
  ownerId: string,
  groupId: number,
): Promise<GroupDetail | null> {
  return (await loadCachedGroupDetailSnapshot(ownerId, groupId))?.detail ?? null;
}

export async function loadCachedGroupDetailSnapshot(
  ownerId: string,
  groupId: number,
): Promise<GroupDetailCacheSnapshot | null> {
  const owner = ownerKey(ownerId);
  if (!owner || !Number.isInteger(groupId) || groupId <= 0) return null;
  const encoded = await AsyncStorage.getItem(cacheKey(owner, groupId));
  if (!encoded) return null;
  try {
    const decoded: unknown = JSON.parse(encoded);
    const wrapped = isRecord(decoded) && isRecord(decoded.detail);
    const detail = normalizeGroupDetail(wrapped ? decoded.detail : decoded);
    if (detail.group_id <= 0) return null;
    const savedAt =
      wrapped && typeof decoded.saved_at === "number" && Number.isFinite(decoded.saved_at)
        ? decoded.saved_at
        : 0;
    return {
      detail,
      savedAt,
      isFresh: savedAt > 0 && Date.now() - savedAt < profileCacheTtlMilliseconds,
    };
  } catch {
    return null;
  }
}

export async function saveCachedGroupDetail(
  ownerId: string,
  detail: GroupDetail,
  expectedGeneration = groupDetailGeneration(ownerId, detail.group_id),
): Promise<GroupDetail> {
  const owner = ownerKey(ownerId);
  if (!owner || !Number.isInteger(detail.group_id) || detail.group_id <= 0) return detail;
  const key = cacheKey(owner, detail.group_id);
  let resolved = detail;
  await enqueueWrite(key, async () => {
    if (expectedGeneration !== groupDetailGeneration(owner, detail.group_id)) return;
    const current = await loadCachedGroupDetail(owner, detail.group_id);
    if (expectedGeneration !== groupDetailGeneration(owner, detail.group_id)) return;
    resolved = mergeGroupInfoRevisions(current, detail);
    await AsyncStorage.setItem(key, JSON.stringify({ saved_at: Date.now(), detail: resolved }));
    if (expectedGeneration !== groupDetailGeneration(owner, detail.group_id)) return;
    await updateCachedGroupSummary(owner, resolved);
    if (expectedGeneration !== groupDetailGeneration(owner, detail.group_id)) return;
    for (const subscription of [...detailListeners]) {
      if (subscription.ownerId === owner) subscription.listener(resolved);
    }
  });
  return resolved;
}

export function mergeGroupInfoRevisions(
  current: GroupDetail | null,
  incoming: GroupDetail,
): GroupDetail {
  if (!current || current.group_id !== incoming.group_id) return incoming;
  return {
    ...incoming,
    notification_settings:
      current.notification_settings.revision > incoming.notification_settings.revision
        ? current.notification_settings
        : incoming.notification_settings,
    viewer_settings:
      current.viewer_settings.revision > incoming.viewer_settings.revision
        ? current.viewer_settings
        : incoming.viewer_settings,
    ...(current.announcement &&
    incoming.announcement &&
    current.announcement.revision > incoming.announcement.revision
      ? { announcement: current.announcement }
      : {}),
  };
}

export async function applyGroupNotificationSettingsUpdate(
  ownerId: string,
  settings: GroupNotificationSettings,
): Promise<GroupDetail | null> {
  return applyGroupInfoUpdate(ownerId, settings.group_id, (current) =>
    current.notification_settings.revision > settings.revision
      ? current
      : { ...current, notification_settings: settings },
  );
}

export async function applyGroupViewerSettingsUpdate(
  ownerId: string,
  settings: GroupViewerSettings,
): Promise<GroupDetail | null> {
  return applyGroupInfoUpdate(ownerId, settings.group_id, (current) =>
    current.viewer_settings.revision > settings.revision
      ? current
      : { ...current, viewer_settings: settings },
  );
}

export async function applyGroupAnnouncementUpdate(
  ownerId: string,
  announcement: GroupAnnouncement,
): Promise<GroupDetail | null> {
  return applyGroupInfoUpdate(ownerId, announcement.group_id, (current) =>
    current.announcement && current.announcement.revision > announcement.revision
      ? current
      : { ...current, announcement },
  );
}

export async function removeCachedGroupDetail(ownerId: string, groupId: number): Promise<void> {
  const owner = ownerKey(ownerId);
  if (!owner || !Number.isInteger(groupId) || groupId <= 0) return;
  const key = cacheKey(owner, groupId);
  repositoryGenerations.set(key, groupDetailGeneration(owner, groupId) + 1);
  await enqueueWrite(key, () => AsyncStorage.removeItem(key));
}

export function subscribeGroupDetail(ownerId: string, listener: DetailListener): () => void {
  const owner = ownerKey(ownerId);
  if (!owner) return () => undefined;
  const subscription = { ownerId: owner, listener };
  detailListeners.add(subscription);
  return () => detailListeners.delete(subscription);
}

export function groupMemberDisplayName(member: GroupMember): string {
  return (
    trimFoundationWhitespacesAndNewlines(member.group_nickname ?? "") ||
    trimFoundationWhitespacesAndNewlines(member.nickname) ||
    member.user_id
  );
}

export function effectiveGroupCapabilities(
  detail: GroupDetail,
  currentUserId: string | undefined,
): GroupCapabilities {
  const current =
    detail.current_member ?? detail.members.find((member) => member.user_id === currentUserId);
  const role = trimFoundationWhitespacesAndNewlines(current?.role ?? "").toLowerCase();
  const isOwner = current?.user_id === detail.creator_id || role === "owner";
  const isManager = isOwner || role === "admin";
  return {
    can_manage_members: detail.capabilities.can_manage_members || isManager,
    can_edit_group: detail.capabilities.can_edit_group || isManager,
    can_edit_announcement: detail.capabilities.can_edit_announcement || isManager,
    can_create_invite: detail.capabilities.can_create_invite || detail.is_public || isManager,
    can_change_visibility: detail.capabilities.can_change_visibility || isOwner,
    can_dismiss_group: detail.capabilities.can_dismiss_group || isOwner,
  };
}

function cacheKey(ownerId: string, groupId: number): string {
  return `${keyPrefix}:${encodeURIComponent(ownerId)}:${groupId}`;
}

export function groupDetailGeneration(ownerId: string, groupId: number): number {
  const owner = ownerKey(ownerId);
  if (!owner || !Number.isInteger(groupId) || groupId <= 0) return 0;
  return repositoryGenerations.get(cacheKey(owner, groupId)) ?? 0;
}

async function applyGroupInfoUpdate(
  ownerId: string,
  groupId: number,
  update: (current: GroupDetail) => GroupDetail,
): Promise<GroupDetail | null> {
  const owner = ownerKey(ownerId);
  if (!owner || groupId <= 0) return null;
  const generation = groupDetailGeneration(owner, groupId);
  const current = await loadCachedGroupDetail(owner, groupId);
  if (!current) return null;
  return saveCachedGroupDetail(owner, update(current), generation);
}

function ownerKey(ownerId: string): string {
  return trimFoundationWhitespacesAndNewlines(ownerId);
}

async function enqueueWrite(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = writeChains.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  writeChains.set(key, current);
  try {
    await current;
  } finally {
    if (writeChains.get(key) === current) writeChains.delete(key);
  }
}
