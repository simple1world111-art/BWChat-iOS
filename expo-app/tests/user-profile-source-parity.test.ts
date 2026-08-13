import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");
const originalNativeRoot = resolve(expoRoot, "..");

describe("UserProfile source parity", () => {
  it("locks the complete native view, view-model, model, API and cache facts", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/UserProfileView.swift":
        "cc8e3484dcfa2a15522d558c4f25f49239dfea9c359190d867e725b468f1dcd6",
      "BWChat/ViewModels/UserProfileViewModel.swift":
        "aeb828dce040da39306674320cafa1ba827b2b5b9b2c8325170e93f672716a91",
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
      "BWChat/Components/ToastView.swift":
        "4b80ea63213df06915e12e03865d832b2526d105b3d16ea1495443f4211a9d36",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      const copiedSource = sourceNative(relativePath);
      expect(createHash("sha256").update(copiedSource).digest("hex")).toBe(expected);
      expect(sourceOriginalNative(relativePath)).toBe(copiedSource);
    }
  });

  it("preserves initial concurrency, lazy tabs, refresh, account scope and relationship behavior", () => {
    const nativeView = sourceNative("BWChat/Views/UserProfileView.swift");
    const nativeModel = sourceNative("BWChat/ViewModels/UserProfileViewModel.swift");
    const expo = sourceExpo("src/app/user-profile.tsx");
    const content = sourceExpo("src/components/profile/PublicProfileContent.tsx");
    const policy = sourceExpo("src/services/profile/UserProfilePolicy.ts");
    for (const contract of [
      "async let profileTask: () = viewModel.loadProfile()",
      "async let momentsTask: () = viewModel.loadInitialMoments()",
      "async let suggestionsTask: () = viewModel.loadSuggestedUsers()",
      ".task(id: selectedTab)",
      "viewModel.loadProfile(forceRefresh: true)",
      "await loadSelectedTab()",
    ]) {
      expect(nativeView).toContain(contract);
    }
    for (const contract of [
      "momentsPageSize = 24",
      "agentsPageSize = 20",
      "shortDramasPageSize = 12",
      "updatingSuggestedUserIDs: Set<String>",
      "openingAgentIDs: Set<String>",
      "followUser(userID: userID)",
    ]) {
      expect(nativeModel).toContain(contract);
    }
    expect(expo).toContain("Promise.allSettled");
    expect(expo).toContain("key={userProfileIdentity(ownerId, targetId)}");
    expect(expo).toContain("const [requestScope] = useState");
    expect(expo).not.toContain("requestScopeRef.current");
    expect(expo).toContain("followUser(targetId)");
    expect(expo).toContain("subscribeFollowRelationship(ownerId");
    expect(expo).toContain("}, ownerId)");
    expect(expo).toContain("contentRef.current?.refresh()");
    expect(content).toContain('if (tab === "agents" && !agentsLoadedRef.current)');
    expect(content).toContain("openingAgentIdsRef.current.has(agent.id)");
    expect(policy).toContain("generation");
    expect(policy).toContain("ticket.key === this.key");
  });

  it("preserves cache TTLs, retention, account/target keys, caps and first-wins merges", () => {
    const nativeCache = sourceNative("BWChat/Services/CacheRepository.swift");
    const nativeModel = sourceNative("BWChat/ViewModels/UserProfileViewModel.swift");
    const profileRepository = sourceExpo("src/services/profile/PublicProfileRepository.ts");
    const contentRepository = sourceExpo("src/services/profile/PublicProfileContentRepository.ts");
    expect(nativeCache).toContain(
      "static let profile = CachePolicy(ttl: 10 * 60, staleRetention: 90 * 24 * 60 * 60)",
    );
    expect(nativeCache).toContain(
      "static let feed = CachePolicy(ttl: 2 * 60, staleRetention: 30 * 24 * 60 * 60)",
    );
    expect(nativeCache).toContain(
      "static let mediaFeed = CachePolicy(ttl: 5 * 60, staleRetention: 30 * 24 * 60 * 60)",
    );
    expect(nativeModel).toContain('namespace: "profiles"');
    expect(nativeModel).toContain("namespace: MomentCacheNamespace.userFeed");
    expect(nativeModel).toContain('namespace: "user-short-dramas"');
    expect(nativeModel).toContain("Array(moments.prefix(200))");
    expect(profileRepository).toContain("ttlMilliseconds: 10 * 60 * 1_000");
    expect(profileRepository).toContain("staleRetentionMilliseconds: 90 * 24 * 60 * 60 * 1_000");
    expect(profileRepository).toContain("cacheUserId = profile.user_id");
    expect(contentRepository).toContain("ttlMilliseconds: 2 * 60 * 1_000");
    expect(contentRepository).toContain("ttlMilliseconds: 5 * 60 * 1_000");
    expect(
      contentRepository.match(/staleRetentionMilliseconds: 30 \* 24 \* 60 \* 60 \* 1_000/gu),
    ).toHaveLength(3);
    expect(contentRepository).toContain("page.moments.slice(0, 200)");
    expect(contentRepository).toContain("page.agents.slice(0, 200)");
    expect(contentRepository).toContain("page.series.slice(0, 200)");
    expect(contentRepository).toContain("if (seen.has(item.id)) return false");
    expect(contentRepository).toContain("if (seen.has(item.series_id)) return false");
  });

  it("keeps all tab panes mounted and prewarms persistent profile content after navigation", () => {
    const profile = sourceExpo("src/app/user-profile.tsx");
    const content = sourceExpo("src/components/profile/PublicProfileContent.tsx");
    expect(content).toContain("InteractionManager.runAfterInteractions");
    expect(content).toContain("readCachedProfileAgentsSnapshot(ownerId, targetId)");
    expect(content).toContain("saveCachedProfileAgents(ownerId, targetId");
    expect(profile).toContain("readNavigationSnapshot<UserProfileNavigationSnapshot>");
    expect(profile).toContain("writeNavigationSnapshot<UserProfileNavigationSnapshot>");
    expect(content).toContain("readNavigationSnapshot<PublicProfileContentNavigationSnapshot>");
    expect(content).toContain("writeNavigationSnapshot<PublicProfileContentNavigationSnapshot>");
    expect(profile).toContain("routeProfilePreview(");
    expect(profile).not.toContain("<ActivityIndicator");
    expect(content).toContain("return <View style={styles.contentLoading} />");
    expect(content).toContain(
      'paneHost: { position: "relative", width: "100%", overflow: "hidden" }',
    );
    expect(content).toContain("tabPane: {");
    expect(content).toContain("style={[styles.paneHost, { height: presentedPaneHeight }]}");
    expect(content).not.toContain('display: "none"');
    expect(content).toContain("const MomentList = memo");
    expect(content).toContain("const MomentListItem = memo");
    expect(content).toContain("const AgentList = memo");
    expect(content).toContain("const ShortDramaList = memo");
    expect(profile).toContain("const ProfileHeader = memo");
    expect(profile).toContain("const Suggestions = memo");
    expect(content).not.toContain("if (!isVisible) return null");
    expect(content).toContain("presentedTabRef.current === tab");
    expect(content).toContain("InteractionManager.runAfterInteractions");
    expect(content).toContain("inactivePersistentTab: { opacity: 1");
  });

  it("preserves exact public-profile, follow, recommendation and content API routes", () => {
    const native = sourceNative("BWChat/Services/APIService.swift");
    const expo = sourceExpo("src/api/bwchat.ts");
    for (const contract of [
      'path: "/profile/public/\\(Self.pathComponent(userID))"',
      'path: "/follows/\\(Self.pathComponent(userID))"',
      'path: "/users/recommended"',
      'var path = "/moments/user/\\(Self.pathComponent(userID))?limit=\\(limit)"',
      'path: "/agents/public"',
      'path: "/short-drama/series"',
    ]) {
      expect(native).toContain(contract);
    }
    for (const contract of [
      "`/profile/public/${encodeURIComponent(userId)}`",
      "`/follows/${encodeShortDramaPathComponent(userId)}`",
      "new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 50)) })",
      "`/moments/user/${encodeURIComponent(userId)}?${query.toString()}`",
      'query.set("owner_user_id", ownerUserId.trim())',
      "creator_user_id: creatorUserId",
    ]) {
      expect(expo).toContain(contract);
    }
  });

  it("keeps profile geometry, navigation, states, authenticated remote assets and no flight feature", () => {
    const native = sourceNative("BWChat/Views/UserProfileView.swift");
    const expo = sourceExpo("src/app/user-profile.tsx");
    const content = sourceExpo("src/components/profile/PublicProfileContent.tsx");
    const policy = sourceExpo("src/services/profile/UserProfilePolicy.ts");
    for (const contract of [
      "HStack(spacing: 2)",
      ".minimumScaleFactor(0.82)",
      ".frame(maxWidth: 180, alignment: .leading)",
      "size: 72",
      "cornerRadius: 16",
      ".frame(height: 36)",
      "RoundedRectangle(cornerRadius: 8",
      ".padding(.top, 54)",
      ".padding(.top, 96)",
      "initialEpisodeID: episodeID ?? series.resumeEpisodeID",
      "profile.directConversationUserID",
    ]) {
      expect(native).toContain(contract);
    }
    for (const contract of [
      "minimumFontScale={userProfileMetrics.header.nameMinimumScale}",
      "cornerRadius={userProfileMetrics.header.avatarRadius}",
      "styles.avatarBorder",
      "headerShadowVisible: false",
      "backgroundColor: colors.card",
      "setScrollViewportHeight(nativeEvent.layout.height)",
      "scrollViewportHeight > 0 ? { minHeight: scrollViewportHeight }",
      "styles.tabsDivider",
      "series.resume_episode_id",
      "profile.user_id.trim()",
    ]) {
      expect(expo).toContain(contract);
    }
    for (const contract of [
      "gap: 2",
      "titleMinimumScale: 0.82",
      "avatar: 72",
      "avatarRadius: 16",
      "height: 36",
      "radius: 8",
      "contentTopInset: 54",
      "missingTopInset: 96",
      "loadingHeight: 120",
      "rowHeight: 44",
      "labelHeight: 43",
      "underlineHeight: 1",
    ]) {
      expect(policy).toContain(contract);
    }
    expect(expo).not.toContain("useWindowDimensions");
    expect(expo).toContain("<AuthenticatedImage");
    expect(content).toContain("<AuthenticatedImage");
    expect(expo).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
    expect(`${expo}\n${content}`).not.toMatch(/飞机|airplane|\bflight\b|\bplane\b/iu);
  });

  it("keeps the simplified back control and recommendation cards free of account IDs and dismiss buttons", () => {
    const expo = sourceExpo("src/app/user-profile.tsx");
    expect(expo).not.toContain("styles.navigationName");
    expect(expo).not.toContain("style={styles.suggestionId}");
    expect(expo).not.toContain("styles.dismissSuggestion");
    expect(expo).not.toContain('name="xmark"');
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
