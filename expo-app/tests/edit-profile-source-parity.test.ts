import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const copiedNativeRoot = resolve(expoRoot, "..");
const originalNativeRoot = resolve(expoRoot, "..");

describe("EditProfile source parity", () => {
  it("locks every copied native source used by the screen", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/EditProfileView.swift":
        "856443769ff46ceb040c0304970ec864bd7dd82edb74a7d899c46a0921e8658e",
      "BWChat/ViewModels/ProfileViewModel.swift":
        "126f560668b09acdb4f53132cf9ac32e777f404df3f18d19e8864df85be2bf06",
      "BWChat/Services/APIService.swift":
        "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
      "BWChat/Models/User.swift":
        "20ea81372c06150c5a7e348432c91f2f00c5879eb1fadf073436a3ab415f2e5d",
      "BWChat/Managers/AuthManager.swift":
        "be19db71600446ecbdf7d41fcf1c83df153228520b5436619ae4229ffda6882f",
      "BWChat/Managers/ImageCacheManager.swift":
        "b1ceea7c302eb044c00ec11ff58f3d58099058ac4b08f6a14db0976bfd52118a",
      "BWChat/Components/AvatarView.swift":
        "a3c6f6de8c1ffc38cc07dfd0d9495a60830e18cf69864392f7cf7529f46bff92",
      "BWChat/Utils/Constants.swift":
        "efb8861fbf1461deb01d917c44433516aa2ec7373c11b3dc90e1fede170b16cd",
      "BWChat/Utils/Extensions.swift":
        "e625dab1ea95cbd63d74c1e8bf33d4bf3f4a85adbd2001c1b0ca27a99bcc5ce5",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      const copied = resolve(copiedNativeRoot, relativePath);
      expect(sha256(copied)).toBe(expected);
      const original = resolve(originalNativeRoot, relativePath);
      if (existsSync(original)) expect(sha256(original)).toBe(expected);
    }
  });

  it("keeps every edit-profile localization key in both native language catalogs", () => {
    for (const nativeRoot of [copiedNativeRoot, originalNativeRoot]) {
      if (!existsSync(nativeRoot)) continue;
      const simplifiedChinese = readFileSync(
        resolve(nativeRoot, "BWChat/zh-Hans.lproj/Localizable.strings"),
        "utf8",
      );
      const english = readFileSync(
        resolve(nativeRoot, "BWChat/en.lproj/Localizable.strings"),
        "utf8",
      );
      for (const key of [
        "profile.edit.title",
        "profile.avatar.change",
        "profile.nickname",
        "profile.nickname.placeholder",
        "profile.bio",
        "profile.bio.placeholder",
        "profile.gender",
        "profile.gender.male",
        "profile.gender.female",
        "profile.gender.other",
        "profile.unset",
        "profile.birthday",
        "profile.birthday.select",
        "profile.birthday.clear",
        "profile.location",
        "profile.location.placeholder",
      ]) {
        expect(simplifiedChinese).toContain(`"${key}" =`);
        expect(english).toContain(`"${key}" =`);
      }
    }
  });

  it("keeps the original geometry, typography and animation constants", () => {
    const screen = expo("src/app/edit-profile.tsx");
    const policy = expo("src/services/profile/editProfilePolicy.ts");
    for (const contract of [
      "avatarSize: 88",
      "avatarShadowRadius: 6",
      "avatarShadowY: 3",
      "cameraBadgeSize: 28",
      "cameraSymbolSize: 12",
      "avatarTopPadding: 20",
      "avatarLabelSpacing: 12",
      "sectionSpacing: 24",
      "formRadius: 14",
      "rowHorizontalPadding: 16",
      "rowVerticalPadding: 18",
      "rowTitleWidth: 96",
      "rowTitleMinimumScale: 0.78",
      "bioCharacterLimit: 150",
      "toastDurationMs: 2_500",
      "toastAnimationMs: 350",
      "birthdayOpenAnimationMs: 250",
      "birthdayCloseAnimationMs: 200",
    ]) {
      expect(policy).toContain(contract);
    }
    expect(screen).toContain("paddingBottom: 30");
    expect(screen).toContain('fontSize: 16, fontWeight: "600"');
    expect(screen).toContain("fontSize: 13");
    expect(screen).toContain('backgroundColor: "rgba(0,0,0,0.75)"');
    expect(screen).toContain("right: 2");
    expect(screen).toContain("bottom: 2");
    expect(screen).toContain("columnGap: 8");
    expect(screen).not.toContain("topAligned");
  });

  it("keeps strict backend contracts and native cache invalidation", () => {
    const api = expo("src/api/bwchat.ts");
    const screen = expo("src/app/edit-profile.tsx");
    expect(api).toContain('apiRequest<unknown>("/profile/me", {');
    expect(api).toContain('method: "PUT"');
    expect(api).toContain('apiRequest<unknown>("/profile/avatar", {');
    expect(api).toContain("requiredData: true");
    expect(api).toContain("requiredEnvelope: true");
    expect(api).toContain("timeoutMs: profileAvatarUploadPolicy.timeoutMilliseconds");
    expect(api).toContain("name: profileAvatarUploadPolicy.filename");
    expect(api).toContain("type: profileAvatarUploadPolicy.mimeType");
    expect(screen).toContain("await uploadAvatar(result.assets[0].uri)");
    expect(screen).toContain("updated = await getProfile()");
    expect(screen).toContain("await clearImageCache()");
    expect(screen).toContain("await updateUser(updated)");
    expect(screen).toContain("profileUsersEqual(profile, updated)");
    expect(screen).toContain("if (operationActiveRef.current) setSaving(false)");
    expect(screen).toContain("await clearImageCache().catch(() => undefined)");
    expect(screen).not.toContain("editable={!isSaving}");
    expect(profileFunction(api, "getProfile", "updateProfile")).not.toContain("cacheUser(");
    expect(profileFunction(api, "updateProfile", "uploadAvatar")).not.toContain("cacheUser(");
    expect(api).toContain("return normalizeNativeUser(value.profile)");
    const normalizers = expo("src/api/normalizers.ts");
    expect(normalizers).toContain("export function normalizeNativeUser(value: unknown): User");
    expect(normalizers).toContain('nativeOptionalString(value, "bio")');
    expect(normalizers).toContain("nativeFlexString(value.user_id)");
  });

  it("keeps app-locale native controls, VoiceOver labels and exact user-media behavior", () => {
    const screen = expo("src/app/edit-profile.tsx");
    expect(screen).toContain('environment("locale", activeLanguage)');
    expect(screen).toContain('accessibilityLabel={t("profile.nickname")}');
    expect(screen).toContain('accessibilityLabel={t("profile.bio")}');
    expect(screen).toContain('swiftUIAccessibilityLabel(t("profile.gender"))');
    expect(screen).toContain('accessibilityLabel={t("profile.birthday")}');
    expect(screen).toContain('accessibilityLabel={t("profile.location")}');
    expect(screen).toContain('mediaTypes: ["images"]');
    expect(screen).toContain("UIImagePickerPreferredAssetRepresentationMode.Current");
    expect(screen).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
    expect(screen).not.toMatch(/airplane|飞机/iu);
  });
});

function expo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function profileFunction(source: string, start: string, end: string): string {
  return source.slice(
    source.indexOf(`export async function ${start}`),
    source.indexOf(`export async function ${end}`),
  );
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
