import { APIError } from "@/api/client";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type { GroupCapabilities, GroupMember } from "@/models";

import { groupMemberDisplayName } from "@/services/groups/GroupDetailRepository";

type Translator = (key: string, ...args: (string | number)[]) => string;
type OperationLock = { current: boolean };

export function filterGroupMembers(members: readonly GroupMember[], query: string): GroupMember[] {
  const value = trimFoundationWhitespacesAndNewlines(query);
  if (!value) return [...members];
  const normalized = value.toLocaleLowerCase();
  return members.filter((member) =>
    [groupMemberDisplayName(member), member.nickname, member.user_id].some((candidate) =>
      candidate.toLocaleLowerCase().includes(normalized),
    ),
  );
}

export function canRemoveGroupMember(
  capabilities: GroupCapabilities | null,
  member: GroupMember,
  currentUserId: string | undefined,
): boolean {
  return (
    capabilities?.can_manage_members === true &&
    member.user_id !== currentUserId &&
    member.role.toLocaleLowerCase() === "member"
  );
}

export function groupMembersErrorMessage(error: unknown, t: Translator): string {
  if (!(error instanceof APIError)) return t("group.removeFailed");
  const numericCode = Number(error.code);
  if (error.code === "decoding_error" || error.message === "api.decodingError") {
    return t("api.decodingError");
  }
  if (error.status === 0 || (error.status === 408 && error.payload === undefined)) {
    return t("api.networkUnavailable");
  }
  if (error.status >= 500 || (Number.isFinite(numericCode) && numericCode >= 500)) {
    return t("api.serverUnavailable");
  }
  if (error.status === 401) return t("api.unauthorized");
  if (error.message.startsWith("api.")) return t(error.message);
  return error.message;
}

export function isValidGroupMembersRoute(groupId: number, ownerId: string): boolean {
  return (
    trimFoundationWhitespacesAndNewlines(ownerId).length > 0 &&
    Number.isInteger(groupId) &&
    groupId > 0
  );
}

export function beginGroupMembersOperation(lock: OperationLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function finishGroupMembersOperation(lock: OperationLock): void {
  lock.current = false;
}
