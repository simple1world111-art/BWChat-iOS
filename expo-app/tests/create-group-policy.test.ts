import { APIError } from "@/api/client";
import { createGroupErrorMessage } from "@/services/groups/CreateGroupPolicy";

const t = (key: string) => `translated:${key}`;

describe("CreateGroup failure policy", () => {
  it("localizes transport, authentication, server and decoding failures", () => {
    expect(createGroupErrorMessage(new APIError("offline", 0), t)).toBe(
      "translated:api.networkUnavailable",
    );
    expect(createGroupErrorMessage(new APIError("timeout", 408), t)).toBe(
      "translated:api.networkUnavailable",
    );
    expect(createGroupErrorMessage(new APIError("expired", 401), t)).toBe(
      "translated:api.unauthorized",
    );
    expect(createGroupErrorMessage(new APIError("gateway", 503), t)).toBe(
      "translated:api.serverUnavailable",
    );
    expect(
      createGroupErrorMessage(
        new APIError("api.decodingError", 200, undefined, "decoding_error"),
        t,
      ),
    ).toBe("translated:api.decodingError");
  });

  it("surfaces stable backend member-eligibility and nested validation messages", () => {
    expect(
      createGroupErrorMessage(
        new APIError(
          "部分成员已不在你的粉丝列表中",
          422,
          { code: "GROUP_MEMBER_NOT_ELIGIBLE" },
          "GROUP_MEMBER_NOT_ELIGIBLE",
        ),
        t,
      ),
    ).toBe("部分成员已不在你的粉丝列表中");
    expect(
      createGroupErrorMessage(
        new APIError("请求失败（422）", 422, { detail: { message: "群名过长" } }),
        t,
      ),
    ).toBe("群名过长");
  });

  it("does not expose arbitrary non-API implementation details", () => {
    expect(createGroupErrorMessage(new Error("internal detail"), t)).toBe(
      "translated:group.createFailed",
    );
    expect(createGroupErrorMessage(new APIError("", 400), t)).toBe("translated:group.createFailed");
  });
});
