import { getProfile, updateProfile, uploadAvatar } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  birthdayForProfileSave,
  canSaveProfileNickname,
  defaultProfileBirthdayDate,
  displayProfileBirthday,
  editProfilePolicy,
  formatProfileBirthday,
  limitProfileBio,
  makeProfileEditValues,
  normalizeProfileBirthday,
  parseProfileBirthday,
  profileAvatarUploadPolicy,
  profileBioLength,
  profileUsersEqual,
  profileUpdateBody,
} from "@/services/profile/editProfilePolicy";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);

describe("native EditProfileView contracts", () => {
  beforeEach(() => request.mockReset());

  it("keeps the source geometry, limit, animation and toast constants", () => {
    expect(editProfilePolicy).toMatchObject({
      avatarSize: 88,
      avatarShadowRadius: 6,
      avatarShadowY: 3,
      cameraBadgeSize: 28,
      cameraSymbolSize: 12,
      avatarTopPadding: 20,
      avatarLabelSpacing: 12,
      sectionSpacing: 24,
      formHorizontalPadding: 16,
      formVerticalPadding: 4,
      formRadius: 14,
      rowHorizontalPadding: 16,
      rowVerticalPadding: 18,
      rowTitleWidth: 96,
      rowTitleMinimumScale: 0.78,
      bioCharacterLimit: 150,
      birthdayOpenAnimationMs: 250,
      birthdayCloseAnimationMs: 200,
      toastDurationMs: 2_500,
      toastAnimationMs: 350,
      toastBottomPadding: 30,
    });
  });

  it("counts and truncates Swift-style extended grapheme clusters", () => {
    expect(profileBioLength("👨‍👩‍👧‍👦e\u0301")).toBe(2);
    const value = `${"a".repeat(149)}👨‍👩‍👧‍👦tail`;
    expect(profileBioLength(limitProfileBio(value))).toBe(150);
    expect(limitProfileBio(value)).toBe(`${"a".repeat(149)}👨‍👩‍👧‍👦`);
  });

  it("uses the native birthday normalization and default minus-18-years rule", () => {
    const now = new Date(2026, 7, 7, 9, 30);
    expect(formatProfileBirthday(defaultProfileBirthdayDate(now))).toBe("2008-08-07");
    expect(formatProfileBirthday(parseProfileBirthday(" 2001-02-03 ")!)).toBe("2001-02-03");
    expect(normalizeProfileBirthday("2001-02-03T09:00:00Z")).toBe("2001-02-03");
    expect(normalizeProfileBirthday("legacy-value")).toBe("legacy-value");
    expect(parseProfileBirthday("2025-02-29")).toBeNull();
    expect(birthdayForProfileSave("bad-date", new Date(2000, 4, 6, 12))).toBe("2000-05-06");
    expect(birthdayForProfileSave("  \n", new Date(2000, 4, 6, 12))).toBe("");
    expect(formatProfileBirthday(defaultProfileBirthdayDate(new Date(2024, 1, 29, 9, 30)))).toBe(
      "2006-02-28",
    );
    expect(normalizeProfileBirthday("\u00852001-02-03\u200B")).toBe("2001-02-03");
    expect(normalizeProfileBirthday("\uFEFF2001-02-03\uFEFF")).toBe("\uFEFF2001-02-03\uFEFF");
  });

  it("preserves raw field values while limiting bio and normalizing the save birthday", () => {
    expect(canSaveProfileNickname(" \t ")).toBe(false);
    expect(canSaveProfileNickname("\u0085")).toBe(true);
    expect(canSaveProfileNickname("\n")).toBe(true);
    expect(canSaveProfileNickname(" 昵称 ")).toBe(true);
    const values = makeProfileEditValues({
      nickname: " 昵称 ",
      bio: "b".repeat(170),
      gender: "unknown",
      birthday: "2001-02-03T00:00:00Z",
      location: " 东京 ",
    });
    expect(values).toEqual({
      nickname: " 昵称 ",
      bio: "b".repeat(150),
      gender: "unknown",
      birthday: "2001-02-03",
      location: " 东京 ",
    });
    expect(profileUpdateBody(values, new Date(1999, 0, 2, 12))).toEqual(values);
  });

  it("matches Swift User Equatable before replacing unsaved avatar-edit fields", () => {
    const current = userFixture({ posts_count: 3, moments_count: 4 });
    expect(profileUsersEqual(current, { ...current })).toBe(true);
    expect(profileUsersEqual(current, { ...current, avatar_url: "/avatars/new.jpg" })).toBe(false);
    expect(profileUsersEqual(null, current)).toBe(false);
  });

  it("shows unset only for an empty birthday and preserves invalid legacy text", () => {
    expect(displayProfileBirthday("", "en", "Unset")).toBe("Unset");
    expect(displayProfileBirthday("legacy-value", "en", "Unset")).toBe("legacy-value");
    expect(displayProfileBirthday("   ", "en", "Unset")).toBe("   ");
    expect(displayProfileBirthday("2001-02-03", "en", "Unset")).not.toBe("Unset");
  });

  it("uses the exact PUT profile route and complete five-field body", async () => {
    request.mockResolvedValueOnce({ profile: userFixture({ nickname: "New" }) });
    const updated = await updateProfile({
      nickname: "New",
      bio: "Bio",
      gender: "female",
      birthday: "2001-02-03",
      location: "Tokyo",
    });
    expect(updated.nickname).toBe("New");
    expect(request).toHaveBeenCalledWith("/profile/me", {
      method: "PUT",
      requiredData: true,
      requiredEnvelope: true,
      body: {
        nickname: "New",
        bio: "Bio",
        gender: "female",
        birthday: "2001-02-03",
        location: "Tokyo",
      },
    });
  });

  it("requires the native success envelope and profile data for GET", async () => {
    request.mockResolvedValueOnce({ profile: userFixture() });
    await expect(getProfile()).resolves.toMatchObject({ user_id: "me", nickname: "Owner" });
    expect(request).toHaveBeenCalledWith("/profile/me", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("rejects non-native profile aliases instead of accepting user or bare data", async () => {
    request.mockResolvedValueOnce({ user: userFixture() });
    await expect(getProfile()).rejects.toThrow("个人资料响应格式无效");

    request.mockResolvedValueOnce(userFixture());
    await expect(
      updateProfile({ nickname: "N", bio: "", gender: "", birthday: "", location: "" }),
    ).rejects.toThrow("个人资料响应格式无效");
  });

  it("uses Swift User coding keys and strict optional-string decoding", async () => {
    request.mockResolvedValueOnce({
      profile: {
        userID: "camel-id",
        avatarURL: "/camel-avatar.jpg",
        followingCount: 9,
        followerCount: 8,
        nickname: 7,
        avatar_url: 11,
        following_count: "1,234.9",
        followed_by_me: "YES",
      },
    });
    await expect(getProfile()).resolves.toMatchObject({
      user_id: "",
      nickname: "7",
      avatar_url: "11",
      following_count: 1_234,
      follower_count: 0,
      followed_by_me: true,
    });

    request.mockResolvedValueOnce({ profile: userFixture({ bio: 3 }) });
    await expect(getProfile()).rejects.toThrow("个人资料响应格式无效");
  });

  it("uploads avatar as the original image/avatar.jpg JPEG multipart with 90s timeout", async () => {
    request.mockResolvedValueOnce({ avatar_url: "/avatars/new.jpg" });
    await expect(uploadAvatar("file:///picked.heic")).resolves.toBe("/avatars/new.jpg");
    expect(request).toHaveBeenCalledWith("/profile/avatar", {
      method: "POST",
      body: expect.any(FormData),
      timeoutMs: 90_000,
      requiredData: true,
      requiredEnvelope: true,
    });
    const form = request.mock.calls[0]?.[1]?.body as FormData;
    expect(form.has("image")).toBe(true);
    expect(profileAvatarUploadPolicy).toEqual({
      fieldName: "image",
      filename: "avatar.jpg",
      mimeType: "image/jpeg",
      timeoutMilliseconds: 90_000,
    });
  });

  it("requires avatar_url while preserving its exact string value", async () => {
    request.mockResolvedValueOnce({ avatar_url: " /avatars/new.jpg " });
    await expect(uploadAvatar("file:///picked.heic")).resolves.toBe(" /avatars/new.jpg ");

    request.mockResolvedValueOnce({ avatarUrl: "/avatars/camel.jpg" });
    await expect(uploadAvatar("file:///picked.heic")).rejects.toThrow("头像上传响应格式无效");
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
