import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const originalRoot = "/Users/wegpt.com/Desktop/BWChat-Expo-HotUpdate/BWChat";
const copiedRoot = resolve(root, "../BWChat");

describe("CreateGroup native source topology", () => {
  it("locks byte-identical original and desktop-copy fact sources", () => {
    const facts: Readonly<Record<string, string>> = {
      "Views/CreateGroupView.swift":
        "d60a51247b16dc11e9a7780a0990fe32f5ec8e64d2e725f6446355a4b833ae37",
      "ViewModels/GroupsViewModel.swift":
        "71ea14e94edcfce52fce29d1db500b2678541663c568d74d6f5eb922c23512a0",
      "Services/APIService.swift":
        "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
      "Services/CacheRepository.swift":
        "570ed9486b10b8b55ddd6136c04c11a1390a287a14563492c640a6a2f144e117",
      "Models/Follow.swift": "77d332a2b061e50f01ed036a2538e064f743c63745528d879793ae226db43dba",
    };
    for (const [file, expectedHash] of Object.entries(facts)) {
      expect(hash(readFileSync(resolve(originalRoot, file)))).toBe(expectedHash);
      expect(hash(readFileSync(resolve(copiedRoot, file)))).toBe(expectedHash);
    }
  });

  it("loads both sources initially and refreshes them in native sequence", () => {
    const page = source("src/app/create-group.tsx");
    expect(page).toContain('const mutual = useMemberSource("mutual"');
    expect(page).toContain('const followers = useMemberSource("followers"');
    expect(page).toMatch(/await mutual\.refresh\(\);\s*await followers\.refresh\(\);/u);
    expect(page).toContain('if (source === "followers" || eligible.length > 0) break');
  });

  it("preserves selection across sources and uses the exact native create gate", () => {
    const page = source("src/app/create-group.tsx");
    expect(page).toContain("const trimmedName = groupName.trim()");
    expect(page).toContain("trimmedName.length > 0 && selectedMemberIds.size > 0");
    expect(page).toContain("selectedMemberIds={selectedMemberIds}");
    expect(page).toContain("memberIds: [...selectedMemberIds]");
  });

  it("guards pending work from account changes, unmount and duplicate dismissal", () => {
    const page = source("src/app/create-group.tsx");
    expect(page).toContain("generationRef.current !== generation");
    expect(page).toContain("submissionRef.current");
    expect(page).toContain("dismissedRef.current");
    expect(page).toContain("displayedOwnerRef.current !== ownerId");
    expect(page).toContain("ownerGenerationRef.current === generation");
    expect(page).toContain("setSelectedMemberIds(new Set())");
    expect(page).toContain("if (mountedRef.current && isCurrentOwner) setCreating(false)");
  });

  it("uses native list caching after create and exact API envelopes", () => {
    const coordinator = source("src/services/groups/CreateGroupCoordinator.ts");
    expect(coordinator).toContain("await createGroup(input.name, input.memberIds, input.isPublic)");
    expect(coordinator).toContain("await loadGroupsWithNativeCache(ownerId, getGroups)");
    expect(coordinator).toContain("input.isOwnerCurrent && !input.isOwnerCurrent()");
    const api = source("src/api/bwchat.ts");
    expect(api).toMatch(/getGroups[\s\S]*?requiredData: true,[\s\S]*?requiredEnvelope: true,/u);
    expect(api).toContain('throw new Error("群列表响应格式无效")');
    expect(api).toMatch(/createGroup[\s\S]*?requiredEnvelope: true,/u);
    expect(api).toMatch(
      /getFollowUsersPage[\s\S]*?requiredData: true,[\s\S]*?requiredEnvelope: true,/u,
    );
    expect(api).toContain("await cacheUserInfoBatch(page.users).catch(() => undefined)");
    const repository = source("src/services/groups/GroupRepository.ts");
    expect(repository).toContain(
      "saveCachedGroupsAt(normalizedOwnerId, fetched, now).catch(() => undefined)",
    );
    expect(repository).toMatch(/now - snapshot\.savedAt < groupListCachePolicy\.ttlMilliseconds/u);
  });

  it("routes public, mine and quick-create entry points to real pages", () => {
    const routes = source("src/services/web/DynamicRouteNavigator.ts");
    expect(routes).toContain('groups: { pathname: "/group-list", params: { mode: "public" } }');
    expect(routes).toContain('my_groups: { pathname: "/group-list", params: { mode: "mine" } }');
    expect(routes).toContain('create_group: "/create-group"');
    expect(source("src/app/(tabs)/contacts.tsx")).toContain("openDynamicRoute(");
    expect(source("src/app/(tabs)/conversations.tsx")).toContain('router.push("/create-group")');
    expect(source("src/app/group-list.tsx")).toContain('pathname: "/create-group"');
    expect(source("src/app/group-list.tsx")).toContain(
      'isPublic: mode === "public" ? "true" : "false"',
    );
    expect(source("src/app/_layout.tsx")).toMatch(
      /name="create-group"[\s\S]*?presentation: "modal"/u,
    );
  });

  it("locks the native CreateGroup visual and asset matrix in source", () => {
    const page = source("src/app/create-group.tsx");
    for (const rule of [
      "nameFieldGroup: { rowGap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }",
      'sectionLabel: { color: colors.secondaryText, fontSize: 13, fontWeight: "500" }',
      "minHeight: 44,",
      "paddingHorizontal: 16,",
      "paddingVertical: 12,",
      "borderRadius: 12,",
      "minHeight: 55,",
      "columnGap: 12,",
      "width: 42,",
      "height: 42,",
      "borderRadius: 21,",
      'followersTitle: { color: colors.text, fontSize: 16, fontWeight: "600" }',
      "height: 26,",
      "paddingTop: 14,",
      "paddingBottom: 6,",
      "width: 24,",
      "height: 24,",
      "borderWidth: 2,",
      "marginLeft: 76,",
      "paddingVertical: 42,",
      'selectedHeaderCount: { color: colors.accent, fontSize: 14, fontWeight: "600" }',
      "createSpinner: { transform: [{ scale: 0.8 }] }",
      'publicIcon: { width: 24, alignItems: "center" }',
    ]) {
      expect(page).toContain(rule);
    }
    expect(page).toMatch(/<SymbolView\s+name="person\.2\.fill"[\s\S]*?size=\{17\}[\s\S]*?\/>/u);
    expect(page).toContain("<Avatar name={member.nickname} size={42} uri={member.avatar_url} />");
    expect(page).toContain('accessibilityRole="button"');
    expect(page).toContain("accessibilityState={{ busy: isCreating");
    expect(page).toContain('accessibilityLabel={t("group.create.name")}');
    expect(page).toContain('useColorScheme() === "dark" ? "#000000" : colors.card');
    expect(page).toContain("emptyTop={36}");
    expect(page).not.toMatch(/require\([^)]*assets/iu);

    const simplifiedChinese = JSON.parse(
      source("src/localization/generated/zh-Hans.json"),
    ) as Record<string, string>;
    const english = JSON.parse(source("src/localization/generated/en.json")) as Record<
      string,
      string
    >;
    expect(simplifiedChinese).toMatchObject({
      "group.create.title": "创建群聊",
      "group.create.name": "群聊名称",
      "group.create.name.placeholder": "输入群聊名称",
      "group.create.noMutualFollows": "暂无相互关注的用户",
      "group.selectMembers.count": "选择成员 (%d)",
      "group.selectedMembers.count": "已选 %d",
      "group.isPublic": "是否公开",
      "follow.followers": "粉丝",
      "follow.followers.empty": "暂无粉丝",
      "follow.relationship.mutual": "互相关注",
    });
    expect(english).toMatchObject({
      "group.create.title": "Create Group",
      "group.create.name": "Group Name",
      "group.create.name.placeholder": "Enter group name",
      "group.create.noMutualFollows": "No mutual follows yet",
      "group.selectMembers.count": "Select Members (%d)",
      "group.selectedMembers.count": "%d selected",
      "group.isPublic": "Public",
      "follow.followers": "Followers",
      "follow.followers.empty": "No followers yet",
      "follow.relationship.mutual": "Mutual follow",
    });
  });

  it("keeps every rendered key byte-for-byte aligned with all ten native locales", () => {
    const keys = [
      "group.create.title",
      "group.create.name",
      "group.create.name.placeholder",
      "group.create.noMutualFollows",
      "group.selectMembers.count",
      "group.selectedMembers.count",
      "group.isPublic",
      "follow.followers",
      "follow.followers.empty",
      "follow.relationship.mutual",
      "common.cancel",
      "common.create",
      "common.back",
    ];
    for (const locale of [
      "de",
      "en",
      "es",
      "fr",
      "ja",
      "ko",
      "pt-BR",
      "ru",
      "zh-Hans",
      "zh-Hant",
    ]) {
      const expo = JSON.parse(source(`src/localization/generated/${locale}.json`)) as Record<
        string,
        string
      >;
      const native = nativeStrings(locale);
      for (const key of keys) expect(expo[key]).toBe(native[key]);
    }
  });
});

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function nativeStrings(locale: string): Record<string, string> {
  const contents = readFileSync(
    resolve(root, `../BWChat/${locale}.lproj/Localizable.strings`),
    "utf8",
  );
  const result: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*("(?:\\.|[^"\\])*")\s*=\s*("(?:\\.|[^"\\])*")\s*;/u);
    if (!match) continue;
    result[JSON.parse(match[1]!)] = JSON.parse(match[2]!);
  }
  return result;
}

function hash(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}
