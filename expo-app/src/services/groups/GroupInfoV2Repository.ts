import { APIError, apiRequest } from "@/api/client";
import { createIdempotencyKey } from "@/api/bwchat";
import {
  flexBool,
  flexInt,
  flexString,
  isRecord,
  normalizeGroupAnnouncement as normalizeGroupAnnouncementWire,
  normalizeGroupMember,
  normalizeGroupNotificationSettings as normalizeGroupNotificationSettingsWire,
  normalizeGroupViewerSettings,
  trimFoundationWhitespacesAndNewlines,
} from "@/api/normalizers";
import type {
  GroupAnnouncement,
  GroupMember,
  GroupMemberUpdateEvent,
  GroupNotificationSettings,
  GroupViewerSettings,
} from "@/models";

export type { GroupAnnouncement, GroupNotificationSettings } from "@/models";

export const groupImportantMemberLimit = 4;

export interface GroupInvite {
  invite_id: string;
  group_id: number;
  invite_url: string;
  expires_at: string;
  created_at?: string | undefined;
  revoked_at?: string | undefined;
}

export interface GroupInvitePreview {
  token?: string | undefined;
  group_id: number;
  group_name: string;
  avatar_url: string;
  member_count: number;
  inviter_nickname?: string | undefined;
  expires_at: string;
  is_member: boolean;
  can_join: boolean;
}

export interface GroupInviteAcceptResult {
  group_id: number;
  already_member: boolean;
}

export interface GroupNotificationSettingsUpdate {
  muted?: boolean | undefined;
  notifyMentionsMe?: boolean | undefined;
  notifyMentionsAll?: boolean | undefined;
  importantMemberIds?: readonly string[] | undefined;
}

export function normalizeGroupNotificationSettings(
  value: unknown,
  fallbackGroupId = 0,
): GroupNotificationSettings {
  return normalizeGroupNotificationSettingsWire(value, fallbackGroupId);
}

export function normalizeGroupAnnouncement(value: unknown, fallbackGroupId = 0): GroupAnnouncement {
  return normalizeGroupAnnouncementWire(value, fallbackGroupId);
}

export function normalizeGroupMemberUpdateEvent(value: unknown): GroupMemberUpdateEvent {
  if (
    !isRecord(value) ||
    typeof value.group_id !== "number" ||
    !Number.isInteger(value.group_id) ||
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision)
  ) {
    throw new Error("群成员更新数据格式无效");
  }
  return {
    group_id: value.group_id,
    member: normalizeGroupMember(value.member),
    revision: value.revision,
  };
}

export function normalizeGroupInvite(value: unknown): GroupInvite {
  if (!isRecord(value)) throw new Error("群邀请数据格式无效");
  const createdAt = flexString(value.created_at);
  const revokedAt = flexString(value.revoked_at);
  return {
    invite_id: flexString(value.invite_id, value.id) ?? "",
    group_id: flexInt(value.group_id) ?? 0,
    invite_url: flexString(value.invite_url, value.url) ?? "",
    expires_at: flexString(value.expires_at) ?? "",
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(revokedAt !== undefined ? { revoked_at: revokedAt } : {}),
  };
}

export function normalizeGroupInvitePreview(value: unknown): GroupInvitePreview {
  if (!isRecord(value)) throw new Error("群邀请预览数据格式无效");
  const token = flexString(value.token);
  const inviterNickname = flexString(value.inviter_nickname);
  return {
    ...(token !== undefined ? { token } : {}),
    group_id: flexInt(value.group_id) ?? 0,
    group_name: flexString(value.group_name, value.name) ?? "",
    avatar_url: flexString(value.avatar_url) ?? "",
    member_count: flexInt(value.member_count) ?? 0,
    ...(inviterNickname !== undefined ? { inviter_nickname: inviterNickname } : {}),
    expires_at: flexString(value.expires_at) ?? "",
    is_member: flexBool(value.is_member) ?? false,
    can_join: flexBool(value.can_join) ?? false,
  };
}

export function normalizeGroupInviteAcceptResult(value: unknown): GroupInviteAcceptResult {
  if (
    !isRecord(value) ||
    typeof value.group_id !== "number" ||
    !Number.isInteger(value.group_id) ||
    typeof value.already_member !== "boolean"
  ) {
    throw new Error("群邀请加入结果格式无效");
  }
  return {
    group_id: value.group_id,
    already_member: value.already_member,
  };
}

export async function getGroupNotificationSettings(
  groupId: number,
): Promise<GroupNotificationSettings> {
  const value = await apiRequest<unknown>(`/groups/${groupId}/notification-settings`, {
    cache: "no-store",
    requiredData: true,
    requiredEnvelope: true,
  });
  return decodeNativeGroupInfo(value, (payload) =>
    normalizeGroupNotificationSettings(requireGroupInfoObject(payload), groupId),
  );
}

export async function updateGroupNotificationSettings(
  groupId: number,
  update: GroupNotificationSettingsUpdate,
): Promise<GroupNotificationSettings> {
  const body: Record<string, unknown> = {};
  if (update.muted !== undefined) body.muted = update.muted;
  if (update.notifyMentionsMe !== undefined) {
    body.notify_mentions_me = update.notifyMentionsMe;
  }
  if (update.notifyMentionsAll !== undefined) {
    body.notify_mentions_all = update.notifyMentionsAll;
  }
  if (update.importantMemberIds !== undefined) {
    body.important_member_ids = [...update.importantMemberIds];
  }
  if (Object.keys(body).length === 0) return getGroupNotificationSettings(groupId);

  const value = await apiRequest<unknown>(`/groups/${groupId}/notification-settings`, {
    method: "PATCH",
    body,
    requiredData: true,
    requiredEnvelope: true,
    transientRetries: false,
  });
  return decodeNativeGroupInfo(value, (payload) =>
    normalizeGroupNotificationSettings(requireGroupInfoObject(payload), groupId),
  );
}

export async function updateGroupViewerSettings(
  groupId: number,
  update: { remark?: string | undefined; showMemberNicknames?: boolean | undefined },
  fallback: () => Promise<GroupViewerSettings>,
): Promise<GroupViewerSettings> {
  const body: Record<string, unknown> = {};
  if (update.remark !== undefined) body.remark = update.remark;
  if (update.showMemberNicknames !== undefined) {
    body.show_member_nicknames = update.showMemberNicknames;
  }
  if (Object.keys(body).length === 0) return fallback();
  const value = await apiRequest<unknown>(`/groups/${groupId}/viewer-settings`, {
    method: "PATCH",
    body,
    requiredData: true,
    requiredEnvelope: true,
    transientRetries: false,
  });
  return decodeNativeGroupInfo(value, (payload) =>
    normalizeGroupViewerSettings(requireGroupInfoObject(payload), groupId),
  );
}

export async function updateMyGroupNickname(
  groupId: number,
  nickname: string,
): Promise<GroupMember> {
  const value = await apiRequest<unknown>(`/groups/${groupId}/members/me`, {
    method: "PATCH",
    body: { nickname },
    requiredData: true,
    requiredEnvelope: true,
    transientRetries: false,
  });
  return decodeNativeGroupInfo(value, normalizeGroupMember);
}

export async function updateGroupAnnouncement(
  groupId: number,
  title: string,
  content: string,
): Promise<GroupAnnouncement> {
  const value = await apiRequest<unknown>(`/groups/${groupId}/announcement`, {
    method: "PUT",
    body: { title, content },
    requiredData: true,
    requiredEnvelope: true,
    transientRetries: false,
  });
  return decodeNativeGroupInfo(value, (payload) => normalizeGroupAnnouncement(payload, groupId));
}

export async function createGroupInvite(groupId: number): Promise<GroupInvite> {
  const value = await apiRequest<unknown>(`/groups/${groupId}/invites`, {
    method: "POST",
    body: { expires_in_days: 7 },
    headers: { "Idempotency-Key": createIdempotencyKey() },
    requiredData: true,
    requiredEnvelope: true,
    transientRetries: false,
  });
  return decodeNativeGroupInfo(value, normalizeGroupInvite);
}

export async function revokeGroupInvite(groupId: number, inviteId: string): Promise<void> {
  await apiRequest<unknown>(`/groups/${groupId}/invites/${encodeURIComponent(inviteId)}`, {
    method: "DELETE",
    transientRetries: false,
  });
}

export async function getGroupInvitePreview(token: string): Promise<GroupInvitePreview> {
  const value = await apiRequest<unknown>(`/group-invites/${encodeURIComponent(token)}`, {
    cache: "no-store",
    requiredData: true,
    requiredEnvelope: true,
  });
  return decodeNativeGroupInfo(value, normalizeGroupInvitePreview);
}

export async function acceptGroupInvite(token: string): Promise<GroupInviteAcceptResult> {
  const value = await apiRequest<unknown>(`/group-invites/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    body: {},
    headers: { "Idempotency-Key": createIdempotencyKey() },
    requiredData: true,
    requiredEnvelope: true,
    transientRetries: false,
  });
  return decodeNativeGroupInfo(value, normalizeGroupInviteAcceptResult);
}

function decodeNativeGroupInfo<T>(payload: unknown, decode: (value: unknown) => T): T {
  try {
    return decode(payload);
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw new APIError("api.decodingError", 200, payload, "decoding_error");
  }
}

function requireGroupInfoObject(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) throw new Error("群资料响应格式无效");
  return payload;
}

export async function reportGroup(groupId: number, reason: string, detail?: string): Promise<void> {
  const hasDetail = detail !== undefined && trimFoundationWhitespacesAndNewlines(detail).length > 0;
  await apiRequest<unknown>(`/groups/${groupId}/reports`, {
    method: "POST",
    body: {
      reason,
      ...(hasDetail ? { detail } : {}),
    },
    headers: { "Idempotency-Key": createIdempotencyKey() },
    requiredEnvelope: true,
    transientRetries: false,
  });
}

export function shouldAlertGroupNotification(
  settings: GroupNotificationSettings,
  input: { senderId?: string | undefined; isDirectMention: boolean; isMentionAll: boolean },
): boolean {
  if (!settings.muted) return true;
  if (input.isDirectMention && settings.notify_mentions_me) return true;
  if (input.isMentionAll && settings.notify_mentions_all) return true;
  return input.senderId !== undefined && settings.important_member_ids.includes(input.senderId);
}
