import { APIError } from "@/api/client";
import {
  addGroupMembersErrorMessage,
  isValidAddGroupMembersRoute,
} from "@/services/groups/AddGroupMembersPolicy";

const t = (key: string) => `translated:${key}`;

describe("native add-group-members policy", () => {
  it("uses the native localized API error categories", () => {
    expect(addGroupMembersErrorMessage(new APIError("offline", 0), t)).toBe(
      "translated:api.networkUnavailable",
    );
    expect(addGroupMembersErrorMessage(new APIError("timeout", 408), t)).toBe(
      "translated:api.networkUnavailable",
    );
    expect(
      addGroupMembersErrorMessage(
        new APIError("api.decodingError", 200, undefined, "decoding_error"),
        t,
      ),
    ).toBe("translated:api.decodingError");
    expect(addGroupMembersErrorMessage(new APIError("gateway", 503), t)).toBe(
      "translated:api.serverUnavailable",
    );
    expect(addGroupMembersErrorMessage(new APIError("expired", 401), t)).toBe(
      "translated:api.unauthorized",
    );
    expect(addGroupMembersErrorMessage(new APIError("成员数量已达上限", 409), t)).toBe(
      "成员数量已达上限",
    );
  });

  it("uses the fixed native add failure for non-API errors", () => {
    expect(addGroupMembersErrorMessage(new Error("implementation detail"), t)).toBe(
      "translated:group.addMembers.failed",
    );
    expect(addGroupMembersErrorMessage(new APIError("", 400), t)).toBe(
      "translated:group.addMembers.failed",
    );
  });

  it("accepts only a signed-in owner and positive integral group id", () => {
    expect(isValidAddGroupMembersRoute(21, "owner-a")).toBe(true);
    expect(isValidAddGroupMembersRoute(0, "owner-a")).toBe(false);
    expect(isValidAddGroupMembersRoute(1.5, "owner-a")).toBe(false);
    expect(isValidAddGroupMembersRoute(21, " ")).toBe(false);
  });
});
