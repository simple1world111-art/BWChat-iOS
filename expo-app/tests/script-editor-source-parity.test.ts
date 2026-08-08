import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");
const originalNativeRoot = resolve(expoRoot, "../../BWChat-iOS");

describe("ScriptEditorView complete source parity", () => {
  it("locks every copied native source used by editor, role, persistence, upload and cache", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/ScriptEditorView.swift":
        "67adef4264527ccebefe5b2952905146141fff919f6882879460f7b85464c1cd",
      "BWChat/Views/ScriptRoleEditorView.swift":
        "9b6cc508cd4f33a7c73b098051f948dd8eac3f1cfd21ada5f2082f47b803e5d3",
      "BWChat/Views/ScriptCenterView.swift":
        "e8095af14ad25b459f6b2628c728b827f2665939af3c92bc699df13f0d83eda2",
      "BWChat/Views/ScriptDetailView.swift":
        "e42405b7b7f1117039e839bbf64fa42c3f30f0632179443bf5b8bdaf6267da4d",
      "BWChat/ViewModels/InteractiveScriptViewModels.swift":
        "53618004998796bffb0afa3d32e47eeb881bb837e1b9032bf9cdbff7a86cf1c9",
      "BWChat/Models/InteractiveScript.swift":
        "f272d793b0e060fdea99be654e0961abcb22a867264447bf9461dfa6d27ae8ed",
      "BWChat/Services/APIService.swift":
        "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274",
      "BWChat/Services/CacheRepository.swift":
        "530f9734eeb9fdc8aeafc3e5430d5eae876754462372bb3c05c9b830526f0b66",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      const copied = sourceNative(relativePath);
      expect(copied).toBe(sourceOriginalNative(relativePath));
      expect(createHash("sha256").update(copied).digest("hex")).toBe(expected);
    }
  });

  it("preserves create/edit modes, the exact grouped section order and native navigation behavior", () => {
    const native = sourceNative("BWChat/Views/ScriptEditorView.swift");
    const expo = sourceExpo("src/app/script-editor.tsx");
    expect(native).toContain("init(script: InteractiveScript?)");
    expect(native).toContain(
      "visibilitySection\n            coverSection\n            titleSection",
    );
    expect(native).toContain(
      "synopsisSection\n            categorySection\n            worldSection\n            rolesSection",
    );
    expect(native).toContain('ScriptText.value("编辑剧本", "Edit Script")');
    expect(native).toContain('ScriptText.value("创建剧本", "Create Script")');
    expect(native).toContain("navigator.pop()");
    expect(expo).toContain("sourceScript || scriptId");
    expect(expo).toContain("router.back()");
    expect(expo).toContain('testID="script-editor-save"');
  });

  it("preserves both native entry points and the Expo route registration", () => {
    const nativeCenter = sourceNative("BWChat/Views/ScriptCenterView.swift");
    const nativeDetail = sourceNative("BWChat/Views/ScriptDetailView.swift");
    const expoCenter = sourceExpo("src/app/script-center.tsx");
    const expoDetail = sourceExpo("src/app/script-detail.tsx");
    const layout = sourceExpo("src/app/_layout.tsx");
    expect(nativeCenter).toContain("navigator.push(ScriptEditorView(script: nil))");
    expect(nativeDetail).toContain("navigator.push(ScriptEditorView(script: script))");
    expect(expoCenter).toContain('router.push("/script-editor")');
    expect(expoDetail).toContain('pathname: "/script-editor"');
    expect(expoDetail).toContain("params: { scriptId }");
    expect(layout).toContain('name="script-editor"');
  });

  it("keeps every native editor-facing bilingual pair", () => {
    const native = sourceNative("BWChat/Views/ScriptEditorView.swift");
    const expo = sourceExpo("src/app/script-editor.tsx");
    for (const [chinese, english] of [
      ["编辑剧本", "Edit Script"],
      ["创建剧本", "Create Script"],
      ["保存", "Save"],
      ["公开剧本", "Public script"],
      ["完整后公开会立即展示", "Complete scripts appear immediately"],
      ["发布设置", "Publishing"],
      ["剧本封面", "Script Cover"],
      ["请输入剧本标题", "Enter script title"],
      ["剧本标题", "Script Title"],
      ["公开剧本需要填写 5～15 个字符。", "Public scripts require 5–15 characters."],
      ["剧情简介", "Synopsis"],
      ["公开剧本需要填写 20～500 个字符。", "Public scripts require 20–500 characters."],
      ["选择剧本封面", "Choose cover"],
      ["剧本分类", "Script Categories"],
      ["公开剧本至少选择一个分类。", "Public scripts require at least one category."],
      ["世界隐藏设定", "Hidden World Setting"],
      [
        "不会展示在公开详情，仅用于服务端生成剧情。",
        "Not shown publicly; used only for server-side generation.",
      ],
      ["未命名角色", "Unnamed character"],
      ["点击补充角色资料", "Tap to add details"],
      ["最多添加 12 个角色", "You can add up to 12 characters"],
      ["添加角色", "Add Character"],
      [
        "公开或开局至少需要两个完整角色。",
        "Publishing or starting requires at least two complete characters.",
      ],
    ] as const) {
      expectBilingualCall(native, "ScriptText.value", chinese, english);
      expectBilingualCall(expo, "text", chinese, english);
    }
    expect(native).toContain('"角色列表（\\(viewModel.draft.roles.count)/12）"');
    expect(native).toContain('"Characters (\\(viewModel.draft.roles.count)/12)"');
    expect(expo).toContain("`角色列表（${draft.roles.length}/12）`");
    expect(expo).toContain("`Characters (${draft.roles.length}/12)`");
  });

  it("keeps all fields, enums, limits, geometry, role order and stable role hand-off", () => {
    const nativeView = sourceNative("BWChat/Views/ScriptEditorView.swift");
    const nativeModel = sourceNative("BWChat/Models/InteractiveScript.swift");
    const policy = sourceExpo("src/services/scripts/scriptEditorPolicy.ts");
    const expo = sourceExpo("src/app/script-editor.tsx");
    for (const contract of [
      "viewModel.draft.visibility",
      "viewModel.draft.title",
      "viewModel.draft.synopsis",
      "viewModel.draft.categoryIDs",
      "viewModel.draft.worldSetting",
      "viewModel.draft.roles",
      "String($0.prefix(15))",
      ".frame(minHeight: 130)",
      "String($0.prefix(500))",
      ".frame(minHeight: 120)",
      ".frame(height: 180)",
      "minHeight: 150",
      "cornerRadius: 14",
      ".frame(width: 42, height: 42)",
      "viewModel.draft.roles.count < 12",
    ]) {
      expect(nativeView).toContain(contract);
    }
    expect(nativeModel).toContain('gender = role?.gender ?? "unspecified"');
    expect(nativeModel).toContain("roles.map(\\.requestBody)");
    expect(policy).toContain('type ScriptAssetBusiness = "script_cover" | "script_role_avatar"');
    expect(policy).toContain("roles: draft.roles.map(scriptRoleDraftRequestBody)");
    expect(expo).toContain("current.roles.findIndex((item) => item.id === role.id)");
    expect(expo).toContain("roles: current.roles.filter((item) => item.id !== role.id)");
  });

  it("keeps draft/public validation ordering and exact request-body field names", () => {
    const native = sourceNative("BWChat/Models/InteractiveScript.swift");
    const policy = sourceExpo("src/services/scripts/scriptEditorPolicy.ts");
    for (const message of [
      "标题最多 15 个字符",
      "剧情简介最多 500 个字符",
      "世界隐藏设定最多 500 个字符",
      "角色最多 12 个",
      "请选择每个角色的性别",
      "角色名称最多 8 个字符",
      "角色公开描述最多 100 个字符",
      "角色隐藏设定最多 500 个字符",
      "标题至少需要 5 个字符",
      "剧情简介至少需要 20 个字符",
      "请选择封面",
      "请选择至少一个分类",
      "至少需要两个角色",
      "请补全所有角色的名称和公开描述",
      "请为所有角色选择头像",
      "角色名称不能重复",
    ]) {
      expect(native).toContain(message);
      expect(policy).toContain(message);
    }
    for (const field of [
      "title",
      "synopsis",
      "cover_url",
      "category_ids",
      "visibility",
      "world_setting",
      "roles",
      "client_role_id",
      "role_id",
      "name",
      "gender",
      "avatar_url",
      "description",
      "hidden_setting",
    ]) {
      expect(native).toContain(`"${field}"`);
      expect(policy).toContain(field);
    }
    expect(native).toContain("categoryIDs.sorted().map");
    expect(policy).toContain("[...draft.categoryIds].sort().map(numericCategoryId)");
  });

  it("preserves cover preprocessing, sequential asset uploads, partial recovery and final POST/PATCH", () => {
    const nativeView = sourceNative("BWChat/Views/ScriptEditorView.swift");
    const nativeViewModel = editorViewModelSource();
    const nativeApi = scriptApiSource();
    const expo = sourceExpo("src/app/script-editor.tsx");
    expect(nativeView).toContain("item.loadTransferable(type: Data.self)");
    expect(nativeView).toContain("maxDimension: 1600");
    expect(nativeView).toContain("quality: 0.82");
    expect(nativeView).toContain("maxBytes: 1_500_000");
    expect(nativeView).toContain("let data = try? await item.loadTransferable");
    expect(nativeViewModel).toContain("if let coverData = draft.coverData");
    expect(nativeViewModel).toContain("for index in draft.roles.indices");
    expect(nativeViewModel).toContain("draft.coverData = nil");
    expect(nativeViewModel).toContain("draft.roles[index].avatarData = nil");
    expect(nativeViewModel).toContain("updateScript(");
    expect(nativeViewModel).toContain("createScript(body: draft.requestBody)");
    expect(nativeApi).toContain('baseURL + "/scripts/assets"');
    expect(nativeApi).toContain('name=\\"business\\"');
    expect(nativeApi).toContain('name=\\"file\\"');
    expect(nativeApi).toContain("request.timeoutInterval = 90");
    expect(expo.indexOf('uploadScriptAsset(\n            "script_cover"')).toBeLessThan(
      expo.indexOf('uploadScriptAsset(\n            "script_role_avatar"'),
    );
    expect(expo).toContain("preparedDraft = { ...preparedDraft, coverUrl: asset.url");
    expect(expo).toContain("roles[index] = { ...role, avatarUrl: asset.url");
    expect(expo).not.toContain("Unable to read selected image");
  });

  it("uses the original account cache/write-back and adds only identity/lifecycle safety", () => {
    const nativeViewModel = editorViewModelSource();
    const expo = sourceExpo("src/app/script-editor.tsx");
    expect(nativeViewModel).toContain("ScriptCacheKeys.categories()");
    expect(nativeViewModel).toContain("AppCacheRepository.shared.loadValue");
    expect(nativeViewModel).toContain(
      "NotificationCenter.default.post(name: .scriptLibraryDidChange",
    );
    expect(expo).toContain("loadCachedScriptCategories(ownerId)");
    expect(expo).toContain("saveCachedScriptCategories(ownerId, remote)");
    expect(expo).toContain("invalidateScriptCatalog(expectedOwnerId, saved)");
    expect(expo).toContain("pendingScriptForNavigation(scriptId, ownerId)");
    expect(expo).toContain("script.creator.user_id !== ownerId");
    expect(expo).toContain("scriptId && !sourceScript");
    expect(expo).toContain("saveGenerationRef.current");
    expect(expo).toContain("uploadingMediaRef.current");
    expect(expo).toContain("cleanupLostScriptDraftMedia");
    expect(expo).toContain("if (active && !cached) setErrorMessage(readableError(error))");
    expect(expo).toContain("saveCachedScriptCategories(ownerId, remote).catch");
  });

  it("does not invent editor delete, publish, idempotency or bitmap-asset capabilities", () => {
    const nativeView = sourceNative("BWChat/Views/ScriptEditorView.swift");
    const nativeViewModel = editorViewModelSource();
    const expo = sourceExpo("src/app/script-editor.tsx");
    expect(nativeView).not.toContain("deleteScript");
    expect(nativeViewModel).not.toContain("deleteScript");
    expect(nativeViewModel).not.toContain("idempotency");
    expect(expo).not.toContain("deleteScript");
    expect(expo).not.toContain("publishScript");
    expect(expo).not.toContain("Idempotency-Key");
    expect(expo).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
  });
});

function editorViewModelSource(): string {
  const source = sourceNative("BWChat/ViewModels/InteractiveScriptViewModels.swift");
  return source.slice(
    source.indexOf("final class ScriptEditorViewModel"),
    source.indexOf("final class ScriptRoomViewModel"),
  );
}

function scriptApiSource(): string {
  const source = sourceNative("BWChat/Services/APIService.swift");
  return source.slice(
    source.indexOf("func getScript(scriptID:"),
    source.indexOf("func createScriptRoom("),
  );
}

function sourceExpo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function sourceNative(relativePath: string): string {
  return readFileSync(resolve(nativeRoot, relativePath), "utf8");
}

function sourceOriginalNative(relativePath: string): string {
  return readFileSync(resolve(originalNativeRoot, relativePath), "utf8");
}

function expectBilingualCall(
  source: string,
  callee: string,
  chinese: string,
  english: string,
): void {
  const pattern = new RegExp(
    `${escapeRegularExpression(callee)}\\(\\s*"${escapeRegularExpression(chinese)}"\\s*,\\s*"${escapeRegularExpression(english)}"\\s*,?\\s*\\)`,
    "u",
  );
  expect(source).toMatch(pattern);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
