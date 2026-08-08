import { APIError } from "@/api/client";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";

type Translator = (key: string, ...args: (string | number)[]) => string;

export function addGroupMembersErrorMessage(error: unknown, t: Translator): string {
  if (!(error instanceof APIError)) return t("group.addMembers.failed");
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
  const message = error.message.trim();
  if (message.startsWith("api.")) return t(message);
  return message || t("group.addMembers.failed");
}

export function isValidAddGroupMembersRoute(groupId: number, ownerId: string): boolean {
  return (
    trimFoundationWhitespacesAndNewlines(ownerId).length > 0 &&
    Number.isInteger(groupId) &&
    groupId > 0
  );
}
