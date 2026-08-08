import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");

describe("ScriptCenterView source parity", () => {
  it("locks every copied native source used by center, API, model, cache and images", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/ScriptCenterView.swift":
        "e8095af14ad25b459f6b2628c728b827f2665939af3c92bc699df13f0d83eda2",
      "BWChat/ViewModels/InteractiveScriptViewModels.swift":
        "53618004998796bffb0afa3d32e47eeb881bb837e1b9032bf9cdbff7a86cf1c9",
      "BWChat/Models/InteractiveScript.swift":
        "f272d793b0e060fdea99be654e0961abcb22a867264447bf9461dfa6d27ae8ed",
      "BWChat/Services/APIService.swift":
        "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274",
      "BWChat/Services/CacheRepository.swift":
        "530f9734eeb9fdc8aeafc3e5430d5eae876754462372bb3c05c9b830526f0b66",
      "BWChat/Managers/ImageCacheManager.swift":
        "b1ceea7c302eb044c00ec11ff58f3d58099058ac4b08f6a14db0976bfd52118a",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      expect(createHash("sha256").update(native(relativePath)).digest("hex")).toBe(expected);
    }
  });

  it("preserves segmented tabs, category strip, grid, cards and empty geometry", () => {
    const original = native("BWChat/Views/ScriptCenterView.swift");
    const page = expo("src/app/script-center.tsx");
    const policy = expo("src/services/scripts/scriptCenterPolicy.ts");
    for (const contract of [
      ".frame(width: 196)",
      ".frame(width: 34, height: 34)",
      "HStack(spacing: 8)",
      ".padding(.horizontal, 16)",
      ".padding(.top, 10)",
      ".padding(.bottom, 12)",
      "GridItem(.flexible(), spacing: 12)",
      "ForEach(0..<6",
      "VStack(alignment: .leading, spacing: 9)",
      ".aspectRatio(0.82",
      ".frame(width: 22, height: 22)",
      ".padding(10)",
      "cornerRadius: 15",
      ".font(.system(size: 36",
    ]) {
      expect(original).toContain(contract);
    }
    expect(page).toContain('accessibilityIdentifier="script.center.top.tabs"');
    expect(page).toContain("numColumns={scriptCenterMetrics.gridColumns}");
    expect(page).toContain('testID="script-center-list"');
    expect(page).toContain('headerBackButtonDisplayMode: "minimal"');
    expect(page).toContain('gridRow: { alignItems: "center"');
    expect(page).toContain("<ScriptCover key={script.cover_url}");
    expect(page).toContain("scriptCoverAspectRatio(event.source.width, event.source.height)");
    expect(page).toContain("{...(onLoad ? { onLoad } : {})}");
    expect(page).toContain("lineHeight: 16");
    expect(policy).toContain("segmentedWidth: 196");
    expect(policy).toContain("gridColumns: 2");
    expect(policy).toContain("skeletonCount: 6");
    expect(policy).toContain("coverAspectRatio: 0.82");
  });

  it("locks native cache TTL, selection, pagination and owner authority", () => {
    const originalViewModel = native("BWChat/ViewModels/InteractiveScriptViewModels.swift");
    const originalCache = native("BWChat/Services/CacheRepository.swift");
    const page = expo("src/app/script-center.tsx");
    const repository = expo("src/services/scripts/ScriptCatalogRepository.ts");
    expect(originalCache).toContain(
      "static let catalog = CachePolicy(ttl: 60 * 60, staleRetention: 90 * 24 * 60 * 60)",
    );
    expect(originalCache).toContain(
      "static let scriptCatalog = CachePolicy(ttl: 5 * 60, staleRetention: 90 * 24 * 60 * 60)",
    );
    expect(originalViewModel).toContain("scripts.suffix(4).contains");
    expect(originalViewModel).toContain("scripts.append(contentsOf:");
    expect(originalViewModel).toContain("scheduleLoadForCurrentSelection()");
    expect(page).toContain('key={ownerId || "anonymous"}');
    expect(page).toContain("paginationInFlightRef.current");
    expect(page).toContain("generation !== paginationGenerationRef.current");
    expect(page).toContain("sameSelection(selectionRef.current");
    expect(repository).toContain("listenersByOwner");
    expect(repository).toContain("listenersByOwner.get(owner)");
    expect(repository).toContain("scriptCatalogGeneration(ownerId)");
    expect(repository).toContain("removeStoredIfUnchanged");
  });

  it("locks native backend routes, envelope gates and room idempotency", () => {
    const original = native("BWChat/Services/APIService.swift");
    const api = expo("src/api/bwchat.ts");
    for (const contract of [
      'path: "/scripts/categories"',
      'path: "/scripts"',
      'name: "scope"',
      'name: "limit"',
      'name: "category_id"',
      'name: "cursor"',
      'request.httpMethod = "DELETE"',
      'forHTTPHeaderField: "Idempotency-Key"',
      '["player_role_id": playerRoleID]',
    ]) {
      expect(original).toContain(contract);
    }
    expect(api).toContain('apiRequest<unknown>("/scripts/categories", {');
    expect(api).toContain("requiredData: true");
    expect(api).toContain("requiredEnvelope: true");
    expect(api).toContain('headers: { "Idempotency-Key": idempotencyKey }');
    expect(api).toContain("body: { player_role_id: playerRoleId }");
  });

  it("keeps create/detail/room navigation and account-scoped hand-offs", () => {
    const center = expo("src/app/script-center.tsx");
    const detail = expo("src/app/script-detail.tsx");
    const navigation = expo("src/services/scripts/ScriptNavigationStore.ts");
    expect(center).toContain('router.push("/script-editor")');
    expect(center).toContain('pathname: "/script-detail"');
    expect(center).toContain("rememberScriptForNavigation(item, ownerId)");
    expect(detail).toContain("createScriptRoom(scriptId, roleId, randomUUID().toUpperCase())");
    expect(detail).toContain('pathname: "/script-room-chat"');
    expect(navigation).toContain("pendingScript.ownerId !== owner");
    expect(navigation).toContain("pendingScript = null");
    expect(navigation).toContain("trimFoundationWhitespacesAndNewlines(ownerId)");
  });

  it("locks immediate selection clearing, manual refresh chrome and VoiceOver semantics", () => {
    const page = expo("src/app/script-center.tsx");
    expect(page).toContain("scriptsRef.current = []");
    expect(page).toContain("selectionLoadInFlightRef.current");
    expect(page).toContain("queuedSelectionLoadRef.current = run");
    expect(page).toContain("refreshing={isManualRefreshing}");
    expect(page).toContain('headerBackTitle: t("common.back")');
    expect(page).toContain('headerBackButtonDisplayMode: "minimal"');
    expect(page).toContain('colorScheme="light"');
    expect(page).toContain('accessibilityRole="button"');
    expect(page).toContain("accessibilityState={{ selected }}");
    expect(page).toContain("scriptCardAccessibilityLabel(item, selectedLanguage)");
  });

  it("locks raw Foundation query values and native Script decoder strictness", () => {
    const api = expo("src/api/bwchat.ts");
    const normalizers = expo("src/api/normalizers.ts");
    expect(api).toContain("trimFoundationWhitespacesAndNewlines(options.categoryId)");
    expect(api).toContain('query.set("category_id", options.categoryId)');
    expect(api).toContain('query.set("cursor", options.cursor)');
    expect(api).toContain("!isRecord(value.script)");
    expect(normalizers).toContain("function scriptString(...values: unknown[])");
    expect(normalizers).toContain("function scriptStringArray(value: unknown)");
    expect(normalizers).toContain("scriptIsBlank(scriptId)");
    expect(normalizers).toContain("decodeScriptRoles(value.roles)");
    expect(normalizers).toContain('Object.hasOwn(value, "scripts")');
  });

  it("copies no invented bitmap because the native page uses symbols and remote media", () => {
    const original = native("BWChat/Views/ScriptCenterView.swift");
    const page = expo("src/app/script-center.tsx");
    expect(original).not.toMatch(/Image\("/u);
    expect(original).not.toContain("UIImage(named:");
    expect(original).toContain("Image(systemName:");
    expect(original).toContain("Image(uiImage: image)");
    expect(page).toContain("AuthenticatedImage");
    expect(page).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
  });
});

function expo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function native(relativePath: string): string {
  return readFileSync(resolve(nativeRoot, relativePath), "utf8");
}
