import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");

describe("ScriptDetailView source parity", () => {
  it("locks the copied native detail fact sources without modifying the original project", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/ScriptDetailView.swift":
        "e42405b7b7f1117039e839bbf64fa42c3f30f0632179443bf5b8bdaf6267da4d",
      "BWChat/ViewModels/InteractiveScriptViewModels.swift":
        "53618004998796bffb0afa3d32e47eeb881bb837e1b9032bf9cdbff7a86cf1c9",
      "BWChat/Models/InteractiveScript.swift":
        "f272d793b0e060fdea99be654e0961abcb22a867264447bf9461dfa6d27ae8ed",
      "BWChat/Services/APIService.swift":
        "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
      "BWChat/Services/CacheRepository.swift":
        "570ed9486b10b8b55ddd6136c04c11a1390a287a14563492c640a6a2f144e117",
      "BWChat/Managers/ImageCacheManager.swift":
        "b1ceea7c302eb044c00ec11ff58f3d58099058ac4b08f6a14db0976bfd52118a",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      expect(createHash("sha256").update(native(relativePath)).digest("hex")).toBe(expected);
    }
  });

  it("locks cover, summary, role, owner action, start bar and both sheet geometry", () => {
    const original = native("BWChat/Views/ScriptDetailView.swift");
    const page = expo("src/app/script-detail.tsx");
    const policy = expo("src/services/scripts/scriptDetailPolicy.ts");
    for (const contract of [
      "VStack(alignment: .leading, spacing: 18)",
      ".padding(.horizontal, 16)",
      ".padding(.bottom, 110)",
      ".aspectRatio(1.55",
      "cornerRadius: 18",
      ".font(.system(size: 25, weight: .bold))",
      "VStack(alignment: .leading, spacing: 10)",
      ".font(.system(size: 11, weight: .semibold))",
      ".frame(width: 48, height: 48)",
      "Divider().padding(.leading, 46)",
      ".padding(.vertical, 13)",
      "cornerRadius: 13",
      ".frame(width: 92, height: 92)",
      "VStack(spacing: 10)",
      ".padding(12)",
      "cornerRadius: 14",
      ".font(.system(size: 22))",
    ]) {
      expect(original).toContain(contract);
    }
    expect(page).toContain('headerBackButtonDisplayMode: "minimal"');
    expect(page).toContain("headerShadowVisible: false");
    expect(page).toContain("scriptDetailCoverAspectRatio(");
    expect(page).toContain("event.source.width");
    expect(page).toContain("event.source.height");
    expect(page).toContain("styles.cover, { aspectRatio }");
    expect(page).toContain("size={92}");
    expect(page).toContain("size={48}");
    expect(policy).toContain("coverAspectRatio: 1.55");
    expect(policy).toContain("return width / height");
    expect(page).toContain("paddingBottom: scriptDetailMetrics.contentBottomInset");
    expect(policy).toContain("roomNavigationDelayMilliseconds: 250");
    expect(policy).toContain("toastMilliseconds: 3_000");
  });

  it("locks native permission gates, metadata ordering and complete action semantics", () => {
    const original = native("BWChat/Views/ScriptDetailView.swift");
    const viewModel = native("BWChat/ViewModels/InteractiveScriptViewModels.swift");
    const page = expo("src/app/script-detail.tsx");
    const policy = expo("src/services/scripts/scriptDetailPolicy.ts");
    expect(original).toContain("if isOwner(script) { ownerActions(script) }");
    expect(original).toContain(
      "script.status != .ready || script.isAdminHidden || script.roles.count < 2 || viewModel.isWorking",
    );
    expect(original).toContain('ScriptText.value("后台隐藏", "Admin hidden")');
    expect(original).toContain(
      'ScriptText.value("已有房间不会被删除。", "Existing rooms will remain available.")',
    );
    expect(viewModel).toContain(
      "guard let script, script.visibility != visibility, !isWorking else { return }",
    );
    expect(viewModel).toContain("guard !isWorking else { return nil }");
    expect(viewModel).toContain("guard !isWorking else { return false }");
    expect(policy).toContain('script.status === "ready"');
    expect(policy).toContain("script.roles.length >= 2");
    expect(page).toContain("workingRef.current");
    expect(page).toContain("if (!activeRef.current || workingRef.current) return null");
    expect(page).toContain("creatingRef.current");
    expect(page).toContain("if (!selectedRoleId || creatingRef.current) return");
  });

  it("locks load/action generations, account remount, cache handoff and delayed navigation cleanup", () => {
    const page = expo("src/app/script-detail.tsx");
    for (const contract of [
      "key={`${encodeURIComponent(ownerId)}:${encodeURIComponent(scriptId)}`}",
      "loadGenerationRef.current !== generation",
      "actionGenerationRef.current === generation",
      "navigationGenerationRef.current !== navigationGeneration",
      "if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current)",
      "saveCachedScriptRoom(ownerId, result.room)",
      "invalidateAgentCatalog(ownerId)",
      "clearPendingScriptForNavigation(scriptId, ownerId)",
      'pathname: "/script-room-chat"',
    ]) {
      expect(page).toContain(contract);
    }
  });

  it("locks exact detail/mutation/room backend contracts and wrapper authority", () => {
    const original = native("BWChat/Services/APIService.swift");
    const api = expo("src/api/bwchat.ts");
    const client = expo("src/api/client.ts");
    for (const contract of [
      'path: "/scripts/\\(Self.pathComponent(scriptID))"',
      'request.httpMethod = "DELETE"',
      'request.httpMethod = "POST"',
      'request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")',
      '["player_role_id": playerRoleID]',
      "return try response.requiredData()",
    ]) {
      expect(original).toContain(contract);
    }
    expect(api).toContain("apiRequest<unknown>(`/scripts/${encodeURIComponent(scriptId)}`");
    expect(api).toContain('method: "PATCH"');
    expect(api).toContain('method: "DELETE"');
    expect(api).toContain('headers: { "Idempotency-Key": idempotencyKey }');
    expect(api).toContain("body: { player_role_id: playerRoleId }");
    expect(api).toContain("requiredData: true");
    expect(api).toContain("requiredEnvelope: true");
    expect(client).toContain('headers.set("Authorization", `Bearer ${token}`)');
    expect(client).toContain('new Headers(options.headers).has("Idempotency-Key")');
  });

  it("does not invent lookup, invitation, sharing or bundled bitmap behavior absent from native", () => {
    const original = native("BWChat/Views/ScriptDetailView.swift");
    const viewModel = native("BWChat/ViewModels/InteractiveScriptViewModels.swift").slice(
      native("BWChat/ViewModels/InteractiveScriptViewModels.swift").indexOf(
        "final class ScriptDetailViewModel",
      ),
      native("BWChat/ViewModels/InteractiveScriptViewModels.swift").indexOf(
        "struct ScriptEditorValidationError",
      ),
    );
    const page = expo("src/app/script-detail.tsx");
    for (const absent of [
      "invite",
      "邀请码",
      "分享",
      "ShareLink",
      "UIActivityViewController",
      "existingRoom",
      "findRoom",
    ] as const) {
      expect(original.toLocaleLowerCase()).not.toContain(absent.toLocaleLowerCase());
      expect(viewModel.toLocaleLowerCase()).not.toContain(absent.toLocaleLowerCase());
      expect(page.toLocaleLowerCase()).not.toContain(absent.toLocaleLowerCase());
    }
    expect(original).not.toMatch(/Image\("/u);
    expect(page).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
    expect(original).toContain("ScriptRemoteImage");
    expect(page).toContain("AuthenticatedImage");
  });
});

function expo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function native(relativePath: string): string {
  return readFileSync(resolve(nativeRoot, relativePath), "utf8");
}
