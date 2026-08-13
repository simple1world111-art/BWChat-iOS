import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");
const originalNativeRoot = resolve(expoRoot, "..");

describe("FollowList source parity", () => {
  it("locks the native view, view-model, model, API and cache sources", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/FollowListViews.swift":
        "36233ddaaa55ffa3b81e31e8a198d357a47ba0dfbbadd79565acd92415f2ed9e",
      "BWChat/ViewModels/FollowListViewModel.swift":
        "22902877d5c508b20ceb4bd86ea19824e4d996d46c64be2ce2391dadc8c5b67d",
      "BWChat/Models/Follow.swift":
        "77d332a2b061e50f01ed036a2538e064f743c63745528d879793ae226db43dba",
      "BWChat/Services/APIService.swift":
        "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
      "BWChat/Services/CacheRepository.swift":
        "570ed9486b10b8b55ddd6136c04c11a1390a287a14563492c640a6a2f144e117",
      "BWChat/Utils/Extensions.swift":
        "e625dab1ea95cbd63d74c1e8bf33d4bf3f4a85adbd2001c1b0ca27a99bcc5ce5",
      "BWChat/Components/AvatarView.swift":
        "a3c6f6de8c1ffc38cc07dfd0d9495a60830e18cf69864392f7cf7529f46bff92",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      const copied = sourceNative(relativePath);
      const original = sourceOriginalNative(relativePath);
      expect(copied).toBe(original);
      expect(createHash("sha256").update(copied).digest("hex")).toBe(expected);
    }
  });

  it("keeps all three wrappers, navigation, initial recommendations and lifecycle", () => {
    const native = sourceNative("BWChat/Views/FollowListViews.swift");
    const nativeProfile = sourceNative("BWChat/Views/UserProfileView.swift");
    const expo = sourceExpo("src/app/follow-list.tsx");
    const expoProfile = sourceExpo("src/app/user-profile.tsx");
    for (const contract of [
      "struct FollowingListView",
      "struct FollowersListView",
      "struct RecommendedUsersListView",
      "initialUsers: [FollowUser] = []",
      ".hidesTabBarOnPush()",
      ".withUIKitBackButton()",
      ".refreshable",
      "navigator.push(UserProfileView(userID: user.userID))",
    ]) {
      expect(native).toContain(contract);
    }
    expect(nativeProfile).toContain("initialUsers: viewModel.suggestedUsers");
    expect(expo).toContain('params.kind === "followers" || params.kind === "recommended"');
    expect(expo).toContain("decodeInitialRecommendedUsers(params.initialUsers)");
    expect(expo).toContain('router.push({ pathname: "/user-profile"');
    expect(expoProfile).toContain("initialUsers: JSON.stringify(suggestions)");
    expect(expoProfile).toContain("excludeUserId={profile.user_id}");
  });

  it("matches cache, pagination, filtering and relationship membership contracts", () => {
    const nativeViewModel = sourceNative("BWChat/ViewModels/FollowListViewModel.swift");
    const nativeView = sourceNative("BWChat/Views/FollowListViews.swift");
    const repository = sourceExpo("src/services/friends/FollowListRepository.ts");
    const policy = sourceExpo("src/services/friends/FollowListPolicy.ts");
    const store = sourceExpo("src/services/friends/FollowRelationshipStore.ts");
    expect(nativeViewModel).toContain("policy: .profile");
    expect(nativeViewModel).toContain("Array(users.prefix(500))");
    expect(nativeViewModel).toContain("result.nextPage ?? page + 1");
    expect(nativeViewModel).toContain("users.insert(user, at: 0)");
    expect(nativeView).toContain("!excludedIDs.contains($0.userID)");
    expect(repository).toContain("ttlMilliseconds: 10 * 60 * 1_000");
    expect(repository).toContain("staleRetentionMilliseconds: 90 * 24 * 60 * 60 * 1_000");
    expect(repository).toContain("inFlightLoads");
    expect(repository).toContain("resetFollowListRepositoryMemoryForAccount");
    expect(repository).toContain("repositoryGenerations");
    expect(repository).toContain("FollowListRepositoryResetError");
    expect(repository).toContain("page.users.slice(0, 500)");
    expect(repository).toContain("return decodeSnapshot(await AsyncStorage.getItem");
    expect(repository).toContain("} catch {");
    expect(repository).toContain("now <= decoded.expires_at");
    expect(policy).toContain("existingIds");
    expect(policy).toContain("page.next_page ?? currentPage + 1");
    expect(store).toContain('"following"');
    expect(store).toContain('return "invalidate"');
    expect(store).toContain("applyFollowRelationshipToCaches");
    expect(store).toContain("listenersByOwner");
    expect(store).toContain("listenersByOwner.get(normalizedOwnerId)");
    expect(store).toContain("if (!normalizedOwnerId) return");
  });

  it("preserves exact routes, query order, envelope rules and target normalization", () => {
    const native = sourceNative("BWChat/Services/APIService.swift");
    const expo = sourceExpo("src/api/bwchat.ts");
    const relationshipRepository = sourceExpo(
      "src/services/friends/FollowRelationshipRepository.ts",
    );
    for (const route of [
      'path: "/users/recommended"',
      'path: "/follows/following"',
      'path: "/follows/followers"',
      'path: "/follows/\\(Self.pathComponent(userID))"',
    ]) {
      expect(native).toContain(route);
    }
    expect(expo).toContain(
      "new URLSearchParams({\n    page: String(options.page ?? 1),\n    limit: String(options.limit ?? 30),",
    );
    expect(expo).toContain('query.set("user_id", options.userId.trim())');
    expect(expo).toContain("requiredData: true");
    expect(expo).toContain("requiredEnvelope: true");
    expect(expo.match(/user_id: userId/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(relationshipRepository).toContain("requiredEnvelope: true");
    expect(relationshipRepository).toContain("user_id: userId");
  });

  it("keeps the complete geometry and confirms there are no page bitmap assets", () => {
    const native = sourceNative("BWChat/Views/FollowListViews.swift");
    const expo = sourceExpo("src/app/follow-list.tsx");
    const policy = sourceExpo("src/services/friends/FollowListPolicy.ts");
    for (const contract of [
      "LazyVStack(spacing: 10)",
      ".padding(.horizontal, 16)",
      ".padding(.top, 12)",
      ".padding(.bottom, 28)",
      "HStack(spacing: 12)",
      "size: 48",
      "VStack(alignment: .leading, spacing: 4)",
      ".font(.system(size: 16, weight: .semibold))",
      ".font(.system(size: 13))",
      ".padding(14)",
      ".cornerRadius(14)",
      ".frame(height: 32)",
      ".padding(.horizontal, 14)",
      ".padding(.top, 80)",
    ]) {
      expect(native).toContain(contract);
    }
    for (const contract of [
      "contentHorizontalInset: 16",
      "contentTopInset: 12",
      "contentBottomInset: 28",
      "rowGap: 10",
      "rowMinimumHeight: 76",
      "rowPadding: 14",
      "rowRadius: 14",
      "rowHorizontalGap: 12",
      "identityGap: 12",
      "avatarSize: 48",
      "copyGap: 4",
      "nameSize: 16",
      "bioSize: 13",
      "followButtonHeight: 32",
      "followButtonHorizontalInset: 14",
      "followButtonRadius: 16",
      "followButtonTitleSize: 13",
      "initialStateTopInset: 80",
      "emptyIconSize: 34",
      "emptyTitleSize: 15",
    ]) {
      expect(policy).toContain(contract);
    }
    expect(expo).toContain("followListMetrics.avatarSize");
    expect(expo).toContain("followListMetrics.contentHorizontalInset");
    expect(expo).toContain("followListMetrics.emptyIconSize");
    expect(expo).toContain('headerBackButtonDisplayMode: "minimal"');
    expect(expo).toContain("headerShadowVisible: false");
    expect(expo).toContain('headerTitleAlign: "center"');
    expect(expo).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
    expect(expo).toContain("const theme = palette(useColorScheme())");
    expect(expo).toContain("backgroundColor: theme.background");
    expect(expo).toContain("backgroundColor: theme.card");
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
