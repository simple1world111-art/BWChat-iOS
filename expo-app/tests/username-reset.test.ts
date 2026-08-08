import { updateUsername } from "@/api/bwchat";
import { APIError, apiRequest } from "@/api/client";
import {
  usernameCharacterCount,
  usernameResetError,
  usernameResetPolicy,
  usernameValidationMessage,
} from "@/services/profile/usernameResetPolicy";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, apiRequest: jest.fn() };
});

const request = jest.mocked(apiRequest);
const t = (key: string, ...args: (string | number)[]) =>
  args.length ? `${key}:${args.join("|")}` : key;

describe("native UsernameResetView policy and API", () => {
  beforeEach(() => request.mockReset());

  it("locks the original validation, layout and navigation-delay constants", () => {
    expect(usernameResetPolicy).toMatchObject({
      minimumCharacters: 3,
      maximumCharacters: 20,
      successNavigationDelayMilliseconds: 650,
      heroTopPadding: 84,
      contentBottomPadding: 110,
      horizontalPadding: 16,
      sectionSpacing: 26,
      heroIconSize: 62,
      heroSpacing: 20,
      heroCopySpacing: 14,
      heroTitleSize: 25,
      heroTitleMinimumScale: 0.68,
      heroDescriptionSize: 13,
      heroDescriptionLineHeight: 19,
      fieldSpacing: 12,
      fieldVerticalPadding: 7,
      fieldFontSize: 15,
      bottomHorizontalPadding: 46,
      bottomTopPadding: 12,
      bottomMinimumPadding: 24,
      submitMinimumHeight: 50,
      submitRadius: 8,
      submitFontSize: 17,
    });
  });

  it("matches Swift Character counting and all four validation branches", () => {
    expect(usernameCharacterCount("👨‍👩‍👧‍👦e\u0301")).toBe(2);
    expect(usernameValidationMessage(" \n ", "owner", t)).toBe("username.reset.empty");
    expect(usernameValidationMessage("ab", "owner", t)).toBe("username.reset.tooShort");
    expect(usernameValidationMessage("a".repeat(21), "owner", t)).toBe("username.reset.tooLong");
    expect(usernameValidationMessage(" owner ", "owner", t)).toBe("username.reset.same");
    expect(usernameValidationMessage(" next-owner ", "owner", t)).toBeNull();
  });

  it("uses the exact PUT wrapper contract and accepts native profile/user variants", async () => {
    request
      .mockResolvedValueOnce({ profile: userFixture({ username: "next" }) })
      .mockResolvedValueOnce({ user: userFixture({ username: "other" }) });

    await expect(updateUsername("next")).resolves.toMatchObject({ username: "next" });
    await expect(updateUsername("other")).resolves.toMatchObject({ username: "other" });
    expect(request).toHaveBeenNthCalledWith(1, "/profile/username", {
      method: "PUT",
      body: { username: "next" },
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("maps a missing native UsernameData payload to a decoding APIError", async () => {
    request.mockResolvedValueOnce({});
    await expect(updateUsername("next")).rejects.toMatchObject({
      name: "APIError",
      status: 200,
      code: "decoding_error",
      message: "api.decodingError",
    });
  });

  it("localizes symbolic codes from payloads, raw server messages and JSON messages", () => {
    expect(
      usernameResetError(new APIError("rejected", 409, { code: "INVALID_USERNAME" }), t, "en"),
    ).toBe("username.reset.invalid");
    expect(usernameResetError(new APIError("username_exists", 409), t, "en")).toBe(
      "username.reset.taken",
    );
    expect(
      usernameResetError(
        new APIError(JSON.stringify({ code: "username_change_cooldown", data: {} }), 409),
        t,
        "en",
      ),
    ).toBe("username.reset.cooldown");
    expect(
      usernameResetError(new APIError("rejected", 409, { message: " Server detail " }), t, "en"),
    ).toBe("Server detail");
  });
});

function userFixture(overrides: Record<string, unknown> = {}) {
  return {
    user_id: "me",
    username: "owner",
    nickname: "Owner",
    avatar_url: "/avatars/me.jpg",
    bio: "",
    gender: "",
    birthday: "",
    location: "",
    following_count: 0,
    follower_count: 0,
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
    ...overrides,
  };
}
