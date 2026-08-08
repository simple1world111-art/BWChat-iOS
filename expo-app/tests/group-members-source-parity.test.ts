import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const copiedNativeRoot = resolve(root, "..");
const originalNativeRoot = resolve(root, "../..", "BWChat-iOS");

describe("GroupMembers native source topology", () => {
  it("locks every copied Swift source used by the member-list contract", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/GroupDetailView.swift":
        "3a4a012ba50f60e099e1f3c36d98f9950104dfb8c3fdb954e08f0fd0ef38dfb4",
      "BWChat/Models/Group.swift":
        "9cc71d2d874002629302dd14f06183bd80cb396f7bfcdd3fbf5838b549bee792",
      "BWChat/Services/APIService.swift":
        "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274",
      "BWChat/Services/CacheRepository.swift":
        "530f9734eeb9fdc8aeafc3e5430d5eae876754462372bb3c05c9b830526f0b66",
      "BWChat/Components/AvatarView.swift":
        "a3c6f6de8c1ffc38cc07dfd0d9495a60830e18cf69864392f7cf7529f46bff92",
      "BWChat/Utils/Constants.swift":
        "efb8861fbf1461deb01d917c44433516aa2ec7373c11b3dc90e1fede170b16cd",
      "BWChat/zh-Hans.lproj/Localizable.strings":
        "a9a6ce25dd4d5ef898a27a3c7d03619dbb6e64cb83d753ffa5a52a3c78558931",
      "BWChat/en.lproj/Localizable.strings":
        "62c800c570e79cfce00e7d0b9f76c83ce0737831ca08646448e486f54c5c9c0d",
    };
    for (const [relativePath, expectedHash] of Object.entries(hashes)) {
      const copied = resolve(copiedNativeRoot, relativePath);
      expect(sha256(copied)).toBe(expectedHash);
      const original = resolve(originalNativeRoot, relativePath);
      if (existsSync(original)) expect(sha256(original)).toBe(expectedHash);
    }
  });

  it("restores the parent snapshot without an initial or focus GET", () => {
    const page = source("src/app/group-members.tsx");
    expect(page).toContain("loadCachedGroupDetail(ownerId, groupId)");
    expect(page).not.toContain("useFocusEffect");
    expect(page).not.toContain("searchVisible");
    expect(page).toContain("TextInput");
    expect(page).not.toContain("Stack.SearchBar");
  });

  it("keeps search collapsed by default and reveals the native stacked search on pull", () => {
    const native = nativeSource("BWChat/Views/GroupDetailView.swift");
    const page = source("src/app/group-members.tsx");
    expect(native).toContain('.searchable(text: $query, prompt: L10n.tr("group.members.search"))');
    expect(native).not.toMatch(/\.searchable\([^\n]*placement:/u);
    expect(native).toContain(".listStyle(.plain)");
    expect(page).toContain('testID="group-members-search"');
    expect(page).toContain("styles.searchDock");
    expect(page).toContain('contentInsetAdjustmentBehavior="automatic"');
    expect(page).toContain("isNativeSearchPresented");
    expect(page).toContain("nativeSearchTouchStartYRef.current");
    expect(page).toContain("onTouchStart");
    expect(page).toContain("onTouchEnd");
    expect(page).toContain("onTouchCancel");
    expect(page).toContain("event.nativeEvent.pageY - startY >= 32");
    expect(page).toContain("alwaysBounceVertical");
    expect(page).toContain("setNativeSearchPresented(false)");
    expect(page).not.toMatch(/initialScrollIndex|contentOffset=|scrollToIndex|scrollToOffset/u);
    expect(page).toContain("TextInput");
    expect(page).not.toContain("Stack.SearchBar");
  });

  it("keeps capabilities fixed to the initial snapshot and the native role semantics", () => {
    const page = source("src/app/group-members.tsx");
    expect(page).toContain("setCapabilities(effectiveGroupCapabilities(cached, user?.user_id))");
    expect(page).not.toMatch(/setCapabilities\([^)]*fetched/u);
    expect(source("src/services/groups/GroupMembersPolicy.ts")).toContain(
      'member.role.toLocaleLowerCase() === "member"',
    );
    expect(source("src/services/groups/GroupMembersPolicy.ts")).not.toContain("member.role.trim()");
  });

  it("preserves native row, typography, role badge and symbol geometry", () => {
    const native = nativeSource("BWChat/Views/GroupDetailView.swift");
    const page = source("src/app/group-members.tsx");
    for (const contract of [
      "HStack(spacing: 12)",
      "size: 44",
      "VStack(alignment: .leading, spacing: 2)",
      "HStack(spacing: 6)",
      ".font(.body)",
      ".lineLimit(1)",
      ".font(.caption)",
      ".font(.caption2.weight(.semibold))",
      ".padding(.horizontal, 6)",
      ".padding(.vertical, 2)",
      "cornerRadius: 4",
      'Image(systemName: "minus.circle")',
      'Image(systemName: "person.badge.plus")',
    ]) {
      expect(native).toContain(contract);
    }
    expect(page).toContain("size={44}");
    expect(page).toContain("columnGap: 12");
    expect(page).toContain("rowGap: 2");
    expect(page).toContain("columnGap: 6");
    expect(page).toContain("fontSize: 17");
    expect(page).toContain("fontSize: 12");
    expect(page).toContain("fontSize: 11");
    expect(page).toContain('fontWeight: "600"');
    expect(page).toContain("paddingHorizontal: 6");
    expect(page).toContain("paddingVertical: 2");
    expect(page).toContain("borderRadius: 4");
    expect(page).toContain('<SymbolView name="minus.circle" size={17}');
    expect(page).toContain('<SymbolView name="person.badge.plus" size={17}');
    expect(page).toContain("<Text style={styles.originalName}>{item.nickname}</Text>");
  });

  it("matches native add and remove refresh cardinality", () => {
    const page = source("src/app/group-members.tsx");
    expect(page).toContain("subscribeGroupMembersAdded");
    expect(page).toContain("const reloadMembersAfterAdd");
    expect(page).toContain("void refreshParentSnapshot()");
    expect(page).not.toContain("await saveCachedGroupDetail(ownerId, next)");
    expect(source("src/app/add-group-members.tsx")).toContain(
      'if (params.source === "group-members") notifyGroupMembersAdded(groupId)',
    );
  });

  it("requires the native response envelopes and has no member pagination", () => {
    const api = source("src/api/bwchat.ts");
    expect(api).toMatch(
      /getGroupDetail[\s\S]*?requiredData: true,[\s\S]*?requiredEnvelope: true,/u,
    );
    expect(api).toMatch(
      /removeGroupMember[\s\S]*?body: \{ user_id: userId \},[\s\S]*?requiredEnvelope: true,/u,
    );
    const page = source("src/app/group-members.tsx");
    expect(page).not.toMatch(/cursor|hasMore|has_more|next_page|onEndReached/u);
  });

  it("uses a transparent nonblocking processing spinner", () => {
    const page = source("src/app/group-members.tsx");
    expect(page).toContain('<View pointerEvents="none" style={styles.overlay}>');
    expect(page).not.toContain('backgroundColor: "rgba(0,0,0,0.08)"');
  });

  it("guards every late UI mutation and disposes its mounted lifecycle", () => {
    const page = source("src/app/group-members.tsx");
    expect(page).toContain("mountedRef.current = false");
    expect(page).toContain("scopeRef.current = scopeKey");
    expect(page).toContain("isCurrentScope(operationScope)");
    expect(page).toContain("operationScopeRef.current === operationScope");
    expect(page).toContain("loadedScope === scopeKey ? members : []");
    expect(page).toContain("isLoading || loadedScope !== scopeKey");
    expect(page).toContain("beginGroupMembersOperation(processingRef)");
    expect(page).toContain("finishGroupMembersOperation(processingRef)");
    expect(page).toContain("executeGroupMemberRemoval(groupId, member.user_id");
    expect(page).toContain("const cacheGeneration = groupDetailGeneration(ownerId, groupId)");
    expect(page).toContain("cacheGeneration !== groupDetailGeneration(ownerId, groupId)");
    expect(page).toContain("saveCachedGroupDetail(ownerId, fetched, cacheGeneration)");
  });

  it("uses no member-list bitmap asset and contains no removed airplane feature", () => {
    const page = source("src/app/group-members.tsx");
    expect(page).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
    expect(page).not.toMatch(/airplane|飞机/iu);
  });
});

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function nativeSource(path: string): string {
  return readFileSync(resolve(copiedNativeRoot, path), "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
