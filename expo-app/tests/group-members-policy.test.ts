import { APIError } from "@/api/client";
import type { GroupCapabilities, GroupMember } from "@/models";
import {
  beginGroupMembersOperation,
  canRemoveGroupMember,
  filterGroupMembers,
  finishGroupMembersOperation,
  groupMembersErrorMessage,
  isValidGroupMembersRoute,
} from "@/services/groups/GroupMembersPolicy";

const t = (key: string) => key;
const manager: GroupCapabilities = {
  can_manage_members: true,
  can_edit_group: true,
  can_edit_announcement: true,
  can_create_invite: true,
  can_change_visibility: false,
  can_dismiss_group: false,
};
const member = (
  userId: string,
  nickname: string,
  role = "member",
  groupNickname?: string,
): GroupMember => ({
  user_id: userId,
  nickname,
  avatar_url: "",
  role,
  ...(groupNickname === undefined ? {} : { group_nickname: groupNickname }),
});

describe("native group-members policy", () => {
  it("filters the three native local fields after trimming the query", () => {
    const members = [
      member("alice-id", "Alice", "member", "小艾"),
      member("bob-id", "Bobby"),
      member("charlie-id", "Charlie"),
    ];
    expect(filterGroupMembers(members, "  小艾  ")).toEqual([members[0]]);
    expect(filterGroupMembers(members, "BOBB")).toEqual([members[1]]);
    expect(filterGroupMembers(members, "CHARLIE-ID")).toEqual([members[2]]);
    expect(filterGroupMembers(members, "  ")).toEqual(members);
  });

  it("uses the native exact untrimmed role gate", () => {
    expect(canRemoveGroupMember(manager, member("other", "Other", "MEMBER"), "self")).toBe(true);
    expect(canRemoveGroupMember(manager, member("other", "Other", " member "), "self")).toBe(
      false,
    );
    expect(canRemoveGroupMember(manager, member("self", "Self"), "self")).toBe(false);
    expect(canRemoveGroupMember({ ...manager, can_manage_members: false }, member("other", "Other"), "self")).toBe(false);
  });

  it("matches native APIError localization and keeps unknown failures fixed", () => {
    expect(groupMembersErrorMessage(new APIError("offline", 0), t)).toBe(
      "api.networkUnavailable",
    );
    expect(groupMembersErrorMessage(new APIError("timeout", 408), t)).toBe(
      "api.networkUnavailable",
    );
    expect(groupMembersErrorMessage(new APIError("gateway", 503), t)).toBe(
      "api.serverUnavailable",
    );
    expect(groupMembersErrorMessage(new APIError("expired", 401), t)).toBe("api.unauthorized");
    expect(
      groupMembersErrorMessage(
        new APIError("api.decodingError", 200, undefined, "decoding_error"),
        t,
      ),
    ).toBe("api.decodingError");
    expect(groupMembersErrorMessage(new APIError("不能移除群主", 409), t)).toBe("不能移除群主");
    expect(groupMembersErrorMessage(new APIError("", 409), t)).toBe("");
    expect(groupMembersErrorMessage(new Error("implementation detail"), t)).toBe(
      "group.removeFailed",
    );
  });

  it("rejects invalid or accountless routes", () => {
    expect(isValidGroupMembersRoute(21, "owner-a")).toBe(true);
    expect(isValidGroupMembersRoute(0, "owner-a")).toBe(false);
    expect(isValidGroupMembersRoute(1.5, "owner-a")).toBe(false);
    expect(isValidGroupMembersRoute(21, " ")).toBe(false);
  });

  it("locks rapid duplicate operations until the active request finishes", () => {
    const lock = { current: false };
    expect(beginGroupMembersOperation(lock)).toBe(true);
    expect(beginGroupMembersOperation(lock)).toBe(false);
    finishGroupMembersOperation(lock);
    expect(beginGroupMembersOperation(lock)).toBe(true);
  });
});
