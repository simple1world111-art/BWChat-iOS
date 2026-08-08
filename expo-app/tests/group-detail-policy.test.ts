import { APIError } from "@/api/client";
import { groupDetailErrorMessage } from "@/services/groups/GroupDetailPolicy";

const t = (key: string) => `translated:${key}`;
const fallback = "translated:common.operationFailed";

describe("native group-detail error policy", () => {
  it("maps native decoding, network, server and session failures through localization", () => {
    expect(groupDetailErrorMessage(new APIError("offline", 0), t, fallback)).toBe(
      "translated:api.networkUnavailable",
    );
    expect(
      groupDetailErrorMessage(
        new APIError("api.decodingError", 200, undefined, "decoding_error"),
        t,
        fallback,
      ),
    ).toBe("translated:api.decodingError");
    expect(groupDetailErrorMessage(new APIError("gateway", 503), t, fallback)).toBe(
      "translated:api.serverUnavailable",
    );
    expect(groupDetailErrorMessage(new APIError("expired", 401), t, fallback)).toBe(
      "translated:api.unauthorized",
    );
  });

  it("retains backend API messages but never exposes plain implementation errors", () => {
    expect(groupDetailErrorMessage(new APIError("成员数量已达上限", 409), t, fallback)).toBe(
      "成员数量已达上限",
    );
    expect(groupDetailErrorMessage(new Error("群公告数据格式无效"), t, fallback)).toBe(fallback);
    expect(groupDetailErrorMessage(new APIError("", 400), t, fallback)).toBe(fallback);
  });
});
