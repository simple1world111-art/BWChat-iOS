import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");

describe("MainTab source and contract parity", () => {
  it("locks the audited native tab, dynamic-route and group-avatar implementations", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/MainTabView.swift":
        "911941d7d47304f854e4ced436bf1056ebc1fe2fabf46db8e0cf7fe4f6a33fb9",
      "BWChat/Utils/UIKitNav.swift":
        "54d1f479588bae9bd382f014a79c6c959df1aead402b8863e390fd854b527b5f",
      "BWChat/Components/AvatarView.swift":
        "a3c6f6de8c1ffc38cc07dfd0d9495a60830e18cf69864392f7cf7529f46bff92",
      "BWChat/Services/DynamicRouteHandler.swift":
        "fba6f7c42e069901cd310940dad900f7c48a24b92b94fe6083efb7fa2abe24b2",
      "BWChat/Models/DynamicConfigModels.swift":
        "8a09512ab3e119ac63499fae8aafd0f69c6d1dbc6489d97979bc7c29e3726803",
    };

    for (const [relativePath, expected] of Object.entries(hashes)) {
      expect(createHash("sha256").update(sourceNative(relativePath)).digest("hex")).toBe(expected);
    }
  });

  it("preserves effective-tab ordering, required roots, localized labels, badges and reselect behavior", () => {
    const nativeModel = sourceNative("BWChat/Models/DynamicConfigModels.swift");
    const nativeTabs = sourceNative("BWChat/Utils/UIKitNav.swift");
    const config = sourceExpo("src/services/remote-config/RemoteConfigService.ts");
    const layout = sourceExpo("src/app/(tabs)/_layout.tsx");
    const registry = sourceExpo("src/services/main-tab/MainTabRegistry.ts");
    const unread = sourceExpo("src/services/conversations/ConversationUnreadStore.ts");

    for (const contract of [
      'let hiddenTabIDs: Set<String> = ["contacts"]',
      "isSupportedByCurrentBuild",
      "DynamicTabDescriptor.requiredCoreTabs",
      "remote.sorted(by: DynamicTabDescriptor.sort)",
    ]) {
      expect(nativeModel).toContain(contract);
    }
    expect(config).toContain('const hidden = new Set(["contacts", "test"])');
    expect(config).toContain("tab.minBuild");
    expect(config).toContain('["messages", "discover", "profile"]');
    expect(config).toContain("return merged.sort(compareTabs)");
    const didSelect = nativeTabs.slice(
      nativeTabs.indexOf("func tabBarController(\n            _ tabBarController"),
      nativeTabs.indexOf("func repairRootTabBarIfNeeded"),
    );
    expect(didSelect).not.toContain("popToRootViewController");
    expect(layout).toContain("disablePopToTop");
    expect(layout).toContain("disableScrollToTop");
    expect(layout).toContain("key={signature}");
    expect(layout).toContain("mainTabSignature(tabs, activeLanguage, t)");
    expect(layout).toContain("mainTabDescriptorTitle(");
    expect(registry).toContain("localizedMainTabText(descriptor.titleI18n, language)");
    expect(registry).toContain("dynamicMainTabSlotCount = 20");
    expect(layout).toContain("conversationUnreadBadgeText(messagesUnread)");
    expect(layout).toContain("momentsUnreadBadgeText(momentsUnread)");
    expect(unread).toContain('return normalized > 99 ? "99+"');
  });

  it("uses account-scoped native-equivalent caches and force-refresh semantics for Contacts", () => {
    const native = sourceNative("BWChat/Views/MainTabView.swift");
    const nativeRoutes = sourceNative("BWChat/Services/DynamicRouteHandler.swift");
    const page = sourceExpo("src/app/(tabs)/contacts.tsx");
    const pushed = sourceExpo("src/app/contacts.tsx");

    expect(nativeRoutes).toContain("ContactsTabView(isRootTab: false)");
    expect(native).toContain("appConfig.load(force: true)");
    expect(native).toContain("viewModel.loadFriends(forceRefresh: true)");
    expect(native).toContain("viewModel.loadFriendRequests(forceRefresh: true)");
    expect(native).toContain("groupsViewModel.loadGroups(forceRefresh: true)");
    expect(page).toContain("loadFriendsWithNativeCache(ownerId, getFriendList, { forceRefresh })");
    expect(page).toContain(
      "loadFriendRequestsWithNativeCache(ownerId, getFriendRequests, { forceRefresh })",
    );
    expect(page).toContain("loadGroupsWithNativeCache(ownerId, getGroups, { forceRefresh })");
    expect(page).toContain("refreshConfig(forceRefresh ? { ignoreETag: true } : undefined)");
    expect(page).toContain("activeOwnerRef.current === ownerId");
    expect(page).toContain("openDynamicRoute(");
    expect(page).toContain("isRootTab");
    expect(pushed).toContain("<ContactsContent isRootTab={false} />");
  });

  it("preserves group-list detail, collage, preference, preview and live-unread semantics", () => {
    const native = sourceNative("BWChat/Views/MainTabView.swift");
    const nativeAvatar = sourceNative("BWChat/Components/AvatarView.swift");
    const page = sourceExpo("src/app/group-list.tsx");
    const avatar = sourceExpo("src/components/GroupMemberAvatar.tsx");
    const unread = sourceExpo("src/services/conversations/ConversationUnreadStore.ts");

    expect(native).toContain("GroupMemberAvatarView(groupID: group.groupID, size: 48)");
    expect(native).toContain("conversationUnreadCount(");
    expect(native).toContain("groupInfoPreferencesStore.displayName(");
    expect(nativeAvatar).toContain("Array(members.prefix(9).map(\\.avatarURL))");
    expect(nativeAvatar).toContain("case 2...4:");
    expect(nativeAvatar).toContain("return 2");
    expect(nativeAvatar).toContain("return 3");
    expect(page).toContain("loadGroupsWithNativeCache(ownerId, getGroups, { forceRefresh })");
    expect(page).toContain("useConversationUnreadCount(ownerId, `group:${group.group_id}`)");
    expect(page).toContain(
      'trimFoundationWhitespacesAndNewlines(detail?.viewer_settings.remark ?? "") || group.name',
    );
    expect(page).toContain("detail?.notification_settings.muted || group.is_muted");
    expect(page).toContain("conversationContentPreviewText(");
    expect(page).toContain("conversationSenderPrefixText(");
    expect(page).toContain("headerShadowVisible: false");
    expect(page).toContain('headerBackButtonDisplayMode: "minimal"');
    expect(page).toContain("headerStyle: { backgroundColor: colors.background }");
    expect(page).toContain("screen: { flex: 1, backgroundColor: colors.background }");
    expect(avatar).toContain("loadCachedGroupDetailSnapshot(ownerId, groupId)");
    expect(avatar).toContain("peekCachedGroupDetail(ownerId, groupId)");
    expect(avatar).toContain("getGroupDetail(groupId)");
    expect(avatar).toContain("saveCachedGroupDetail(ownerId, detail, cacheGeneration)");
    expect(avatar).toContain(".slice(0, 9)");
    expect(avatar).toContain("displayed.length <= 4 ? 2 : 3");
    expect(unread).toContain("conversationCountsByOwner");
  });

  it("keeps the exact backend routes and strict response envelopes used by this feature", () => {
    const api = sourceExpo("src/api/bwchat.ts");
    const remoteConfig = sourceExpo("src/services/remote-config/RemoteConfigService.ts");
    const dynamicScreens = sourceExpo("src/services/dynamic-screen/DynamicScreenRepository.ts");

    for (const route of ['"/friends/list"', '"/friends/requests"', '"/groups/list"']) {
      expect(api).toContain(route);
    }
    expect(api).toContain("`/groups/${groupId}`");
    expect(api).toContain("requiredData: true");
    expect(api).toContain("requiredEnvelope: true");
    expect(remoteConfig).toContain("fetch(env.remoteConfigUrl");
    expect(remoteConfig).toContain('headers.set("If-None-Match", etag)');
    expect(remoteConfig).toContain("invalidateSessionOnUnauthorized: false");
    expect(dynamicScreens).toContain(
      '`${env.apiBaseUrl.replace(/\\/$/u, "")}/app/screens/${encodeURIComponent(screenId)}`',
    );
  });

  it("pushes hidden Contacts and Nearby routes while switching only true root tabs", () => {
    const native = sourceNative("BWChat/Services/DynamicRouteHandler.swift");
    const expo = sourceExpo("src/services/web/DynamicRouteNavigator.ts");
    expect(native).toContain('case "contacts":');
    expect(native).toContain("navigator.push(ContactsTabView(isRootTab: false))");
    expect(native).toContain('case "nearby":');
    expect(native).toContain("navigator.push(MapDatingView())");
    expect(expo).toContain('contacts: "/contacts"');
    expect(expo).toContain('nearby: "/nearby"');
    expect(expo).toContain(
      'const rootTabs = new Set<MainTabID>(["messages", "map", "discover", "profile"])',
    );
  });
});

function sourceExpo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function sourceNative(relativePath: string): string {
  return readFileSync(resolve(nativeRoot, relativePath), "utf8");
}
