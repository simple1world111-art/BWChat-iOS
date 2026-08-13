import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");
const originalNativeRoot = resolve(expoRoot, "..");

const locales = ["de", "en", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-Hans", "zh-Hant"] as const;

const pageLocalizationKeys = [
  "contacts.friendRequests",
  "friendRequests.empty",
  "friendRequests.row.subtitle",
  "friends.added",
  "common.operationFailed",
  "common.back",
  "common.cancel",
  "common.confirm",
] as const;

describe("FriendRequestsView source parity", () => {
  it("locks every copied native fact source and keeps the original project byte-identical", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/FriendRequestsView.swift":
        "cb5ed2ed010715659aaa550760635ec8d9de4330c53a9dea0a46f0ea30d3bc41",
      "BWChat/ViewModels/FriendsViewModel.swift":
        "b7e9121299a6b952fcaf02435fc8cf6f27cde68b51665699cb06beb7adf590db",
      "BWChat/Models/FriendRequest.swift":
        "a939226f62f2ec3979ffd899c4820bc6ef2f69dc781050edecb60b64ec579046",
      "BWChat/Services/APIService.swift":
        "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
      "BWChat/Services/CacheRepository.swift":
        "570ed9486b10b8b55ddd6136c04c11a1390a287a14563492c640a6a2f144e117",
      "BWChat/Utils/LocalCache.swift":
        "8ea5e1b869f10b9f70055130758762fb2abdabcb6e6ae4ff2d4e5810133d9ddb",
      "BWChat/Components/AvatarView.swift":
        "a3c6f6de8c1ffc38cc07dfd0d9495a60830e18cf69864392f7cf7529f46bff92",
      "BWChat/Components/ToastView.swift":
        "4b80ea63213df06915e12e03865d832b2526d105b3d16ea1495443f4211a9d36",
      "BWChat/Utils/Extensions.swift":
        "e625dab1ea95cbd63d74c1e8bf33d4bf3f4a85adbd2001c1b0ca27a99bcc5ce5",
      "BWChat/Utils/Constants.swift":
        "efb8861fbf1461deb01d917c44433516aa2ec7373c11b3dc90e1fede170b16cd",
    };
    for (const [relativePath, expectedHash] of Object.entries(hashes)) {
      const copied = sourceNative(relativePath);
      expect(copied).toBe(sourceOriginalNative(relativePath));
      expect(createHash("sha256").update(copied).digest("hex")).toBe(expectedHash);
    }
  });

  it("locks the native view lifecycle, navigation, and visible message wiring", () => {
    const native = sourceNative("BWChat/Views/FriendRequestsView.swift");
    expect(native).toContain("@StateObject private var viewModel = FriendsViewModel()");
    expect(native).toContain('L10n.tr("contacts.friendRequests")');
    expect(native).toContain(".hidesTabBarOnPush()");
    expect(native).toContain(".withUIKitBackButton()");
    expect(native).toContain("await viewModel.loadFriendRequests()");
    expect(native).toContain(".toast(message: $viewModel.successMessage)");
    expect(native).not.toContain(".toast(message: $viewModel.errorMessage)");
  });

  it("keeps the complete row and empty-state geometry without page bitmap assets", () => {
    const native = sourceNative("BWChat/Views/FriendRequestsView.swift");
    const nativeColors = sourceNative("BWChat/Utils/Constants.swift");
    const expo = sourceExpo("src/app/friend-requests.tsx");
    for (const contract of [
      "VStack(spacing: 14)",
      ".font(.system(size: 40))",
      ".font(.system(size: 15))",
      "HStack(spacing: 12)",
      "size: 44",
      "VStack(alignment: .leading, spacing: 3)",
      "HStack(spacing: 8)",
      ".frame(width: 38, height: 38)",
      ".padding(.horizontal, 16)",
      ".padding(.vertical, 10)",
      "Divider().padding(.leading, 72)",
    ]) {
      expect(native).toContain(contract);
    }
    for (const contract of [
      "friendRequestsMetrics.backButtonSize",
      "friendRequestsMetrics.backSymbolSize",
      "friendRequestsMetrics.emptyGap",
      "friendRequestsMetrics.emptyIconSize",
      "friendRequestsMetrics.emptyTextSize",
      "friendRequestsMetrics.rowGap",
      "friendRequestsMetrics.rowSpacerMinWidth",
      "friendRequestsMetrics.avatarSize",
      "friendRequestsMetrics.copyGap",
      "friendRequestsMetrics.actionsGap",
      "friendRequestsMetrics.actionSize",
      "friendRequestsMetrics.rowHorizontalInset",
      "friendRequestsMetrics.rowVerticalInset",
      "friendRequestsMetrics.dividerLeadingInset",
    ]) {
      expect(expo).toContain(contract);
    }
    expect(expo).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
    expect(nativeColors).toContain(
      "static let secondaryBackground = Color(.secondarySystemBackground)",
    );
    for (const hex of ["1A1A2E", "9E9EB8", "C4C4D4", "F0F0F5", "667EEA", "764BA2"]) {
      expect(nativeColors).toContain(`Color(hex: "${hex}")`);
    }
    expect(expo).toContain('PlatformColor("secondarySystemBackgroundColor")');
    expect(expo).toContain("backgroundColor: secondarySystemBackground");
    expect(expo).toContain("backgroundColor: colors.separator");
    expect(expo).toContain("tintColor={colors.tertiaryText}");
    expect(expo).toContain("color: colors.secondaryText");
    expect(expo).not.toContain("palette(useColorScheme())");
    expect(expo).toContain("headerBackVisible: false");
    expect(expo).toContain("headerShadowVisible: false");
    expect(expo).toContain("headerStyle: { backgroundColor: secondarySystemBackground }");
  });

  it("matches the shared avatar, UIKit back button and top-toast visual facts", () => {
    const nativeAvatar = sourceNative("BWChat/Components/AvatarView.swift");
    const nativeToast = sourceNative("BWChat/Components/ToastView.swift");
    const nativeNavigation = sourceNative("BWChat/Utils/Extensions.swift");
    const expoAvatar = sourceExpo("src/components/Avatar.tsx");
    const expoToast = sourceExpo("src/components/TopToast.tsx");
    const page = sourceExpo("src/app/friend-requests.tsx");
    for (const contract of [
      ".scaledToFill()",
      "cornerRadius: size * 0.22",
      'Image(systemName: "person.fill")',
      ".white.opacity(0.8)",
      ".font(.system(size: size * 0.38, weight: .medium))",
    ]) {
      expect(nativeAvatar).toContain(contract);
    }
    for (const contract of [
      'contentFit="cover"',
      "size * 0.22",
      'name="person.fill"',
      'tintColor="rgba(255,255,255,0.8)"',
      "size={size * 0.38}",
      'weight="medium"',
    ]) {
      expect(expoAvatar).toContain(contract);
    }
    expect(nativeNavigation).toContain('Image(systemName: "chevron.left")');
    expect(nativeNavigation).toContain(".font(.system(size: 17, weight: .semibold))");
    expect(nativeNavigation).toContain(".frame(width: 36, height: 36)");
    expect(page).toContain('name="chevron.left"');
    expect(page).toContain("size={friendRequestsMetrics.backSymbolSize}");
    expect(page).toContain("width: friendRequestsMetrics.backButtonSize");
    expect(page).toContain('weight="semibold"');
    expect(page).toContain('accessibilityLabel={t("common.back")}');
    expect(page).toContain("onPress={() => router.back()}");
    for (const contract of [
      ".padding(.horizontal, 20)",
      ".padding(.vertical, 10)",
      ".background(Color.black.opacity(0.75))",
      ".cornerRadius(20)",
      ".padding(.top, 8)",
      "duration: TimeInterval = 2.0",
    ]) {
      expect(nativeToast).toContain(contract);
    }
    for (const contract of [
      "paddingHorizontal: 20",
      "paddingVertical: 10",
      'backgroundColor: "rgba(0,0,0,0.75)"',
      "borderRadius: 20",
      "{ top: topInset + 8",
      "duration = 2_000",
    ]) {
      expect(expoToast).toContain(contract);
    }
    expect(page).toContain("duration={friendRequestsMetrics.toastMilliseconds}");
  });

  it("keeps all page and accessibility strings byte-for-byte aligned in ten languages", () => {
    for (const locale of locales) {
      const nativeCatalog = sourceNative(`BWChat/${locale}.lproj/Localizable.strings`);
      const expoCatalog = JSON.parse(
        sourceExpo(`src/localization/generated/${locale}.json`),
      ) as Record<string, string>;
      for (const key of pageLocalizationKeys) {
        expect(expoCatalog[key]).toBe(nativeLocalizedValue(nativeCatalog, key));
      }
    }
  });

  it("matches native request caching while hardening concurrency and late responses", () => {
    const nativeModel = sourceNative("BWChat/ViewModels/FriendsViewModel.swift");
    const repository = sourceExpo("src/services/friends/FriendRepository.ts");
    const screen = sourceExpo("src/app/friend-requests.tsx");
    expect(nativeModel).toContain('CacheKey.current(namespace: "friends", key: "requests")');
    expect(nativeModel).toContain("policy: .list");
    expect(nativeModel).toContain("forceRefresh: forceRefresh");
    expect(repository).toContain("ttlMilliseconds: 2 * 60 * 1_000");
    expect(repository).toContain("staleRetentionMilliseconds: 30 * 24 * 60 * 60 * 1_000");
    expect(repository).toContain("friendRequestLoads");
    expect(repository).toContain("markFriendRequestResolved");
    expect(screen).toContain("focusGenerationRef");
    expect(screen).toContain("resolvedRequestIdsRef");
    expect(screen).toContain("acquireFriendRequestOperation(operationSet, request.request_id)");
    expect(screen).not.toContain("isLoading");
  });

  it("preserves exact authenticated API routes, bodies, and envelope requirements", () => {
    const nativeApi = sourceNative("BWChat/Services/APIService.swift");
    const expoApi = sourceExpo("src/api/bwchat.ts");
    const client = sourceExpo("src/api/client.ts");
    expect(nativeApi).toContain('get(path: "/friends/requests")');
    expect(nativeApi).toContain("getFriendList() async throws -> [FriendInfo]");
    expect(nativeApi).toContain('get(path: "/friends/list")');
    expect(nativeApi).toContain('path: "/friends/requests/\\(requestID)/accept"');
    expect(nativeApi).toContain('path: "/friends/requests/\\(requestID)/reject"');
    expect(expoApi).toContain('apiRequest<unknown>("/friends/requests", {');
    expect(expoApi).toContain('apiRequest<unknown>("/friends/list", {');
    expect(expoApi).toContain("value.friends.map(normalizeRequiredFriendInfo)");
    expect(expoApi).toContain("`/friends/requests/${requestId}/accept`");
    expect(expoApi).toContain("`/friends/requests/${requestId}/reject`");
    expect(expoApi.match(/requiredEnvelope: true/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(expoApi).toContain("requiredData: true");
    expect(client).toContain('headers.set("Authorization", `Bearer ${token}`)');
    expect(client).toContain('headers.set("Accept-Language", getActiveLanguageCode())');
    expect(client).toContain("const transientDelays = [350, 900] as const");
  });

  it("does not invent profile/chat navigation or follow-relationship broadcasting", () => {
    const screen = sourceExpo("src/app/friend-requests.tsx");
    expect(screen).not.toContain("router.push");
    expect(screen).not.toContain("user-profile");
    expect(screen).not.toContain("publishFollowRelationship");
    expect(screen.match(/accessibilityRole="button"/gu)).toHaveLength(3);
    expect(screen).toContain("accessibilityState={{");
  });
});

function sourceExpo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function sourceNative(relativePath: string): string {
  return readFileSync(resolve(nativeRoot, relativePath), "utf8");
}

function sourceOriginalNative(relativePath: string): string {
  return readFileSync(resolve(originalNativeRoot, relativePath), "utf8");
}

function nativeLocalizedValue(catalog: string, key: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^"${escapedKey}"\\s*=\\s*"((?:\\\\.|[^"\\\\])*)";`, "mu").exec(catalog);
  if (!match?.[1]) throw new Error(`Missing native localization key: ${key}`);
  return JSON.parse(`"${match[1]}"`) as string;
}
