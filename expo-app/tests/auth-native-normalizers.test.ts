import {
  normalizeAuthSession,
  normalizeToken,
  normalizeVerifyData,
  trimFoundationWhitespacesAndNewlines,
} from "@/api/normalizers";
import type { CatalogLanguage } from "@/localization/catalogs";
import { localizedString } from "@/providers/LocalizationProvider";

let mockActiveLanguage: CatalogLanguage = "en";

jest.mock("@/providers/LocalizationProvider", () => {
  const actual = jest.requireActual("@/providers/LocalizationProvider");
  return { ...actual, getActiveLanguageCode: () => mockActiveLanguage };
});

describe("Swift-exact authentication response normalizers", () => {
  it("uses Foundation whitespace/newline code points for token and Bearer normalization", () => {
    const foundationOnly = "\u0085\u200B";
    expect(trimFoundationWhitespacesAndNewlines(`${foundationOnly}value${foundationOnly}`)).toBe(
      "value",
    );
    expect(normalizeToken(`${foundationOnly}BeArEr access-token${foundationOnly}`)).toBe(
      "access-token",
    );
    expect(normalizeToken(foundationOnly)).toBeNull();

    const byteOrderMark = "\uFEFF";
    expect(trimFoundationWhitespacesAndNewlines(`${byteOrderMark}value${byteOrderMark}`)).toBe(
      `${byteOrderMark}value${byteOrderMark}`,
    );
    expect(normalizeToken(`${byteOrderMark}Bearer access${byteOrderMark}`)).toBe(
      `${byteOrderMark}Bearer access${byteOrderMark}`,
    );
  });

  it("preserves raw snake-case User strings and Swift flexible scalar semantics", () => {
    const session = normalizeAuthSession({
      token: "access",
      refresh_token: "refresh",
      user: {
        user_id: " owner ",
        userID: "camel-must-not-win",
        username: "  ",
        nickname: " Nick ",
        avatar_url: 7,
        avatarURL: "camel-avatar",
        following_count: " \u00851,234.9\u200B ",
        follower_count: 2.9,
        posts_count: "3e1",
        moments_count: "invalid",
        followed_by_me: "YES",
        follows_me: " yes ",
        is_friend: 1,
      },
    });

    expect(session.user).toEqual({
      user_id: " owner ",
      username: "  ",
      nickname: " Nick ",
      avatar_url: "7",
      bio: "",
      gender: "",
      birthday: "",
      location: "",
      following_count: 1234,
      follower_count: 2,
      posts_count: 30,
      followed_by_me: true,
      follows_me: false,
      is_friend: true,
    });
  });

  it("ignores camel-only User aliases instead of widening the native CodingKeys", () => {
    const verified = normalizeVerifyData({
      user: {
        userID: "camel-id",
        avatarURL: "camel-avatar",
        followingCount: 9,
        followedByMe: true,
      },
    });
    expect(verified.user).toMatchObject({
      user_id: "",
      avatar_url: "",
      following_count: 0,
      followed_by_me: false,
    });
  });

  it("rejects every non-string value in Swift's strict optional User fields", () => {
    for (const field of ["bio", "gender", "birthday", "location"] as const) {
      expect(() =>
        normalizeAuthSession({
          token: "access",
          refresh_token: "refresh",
          user: { user_id: "owner", [field]: 7 },
        }),
      ).toThrow(`用户字段 ${field} 类型无效`);
    }
  });

  it("uses the active catalog for a missing nickname in all ten languages", () => {
    const languages: CatalogLanguage[] = [
      "en",
      "ja",
      "ko",
      "es",
      "fr",
      "de",
      "pt-BR",
      "ru",
      "zh-Hans",
      "zh-Hant",
    ];
    for (const language of languages) {
      mockActiveLanguage = language;
      const session = normalizeAuthSession({
        token: "access",
        refresh_token: "refresh",
        user: { user_id: "owner" },
      });
      expect(session.user.nickname).toBe(localizedString(language, "profile.defaultUser"));
    }
  });
});
