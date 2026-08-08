import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");
const originalNativeRoot = resolve(expoRoot, "../../BWChat-iOS");

describe("ScriptRoleEditorView source parity", () => {
  it("locks every copied native source used by role editing and persistence", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/ScriptRoleEditorView.swift":
        "9b6cc508cd4f33a7c73b098051f948dd8eac3f1cfd21ada5f2082f47b803e5d3",
      "BWChat/Views/ScriptEditorView.swift":
        "67adef4264527ccebefe5b2952905146141fff919f6882879460f7b85464c1cd",
      "BWChat/Views/ScriptCenterView.swift":
        "e8095af14ad25b459f6b2628c728b827f2665939af3c92bc699df13f0d83eda2",
      "BWChat/Models/InteractiveScript.swift":
        "f272d793b0e060fdea99be654e0961abcb22a867264447bf9461dfa6d27ae8ed",
      "BWChat/ViewModels/InteractiveScriptViewModels.swift":
        "53618004998796bffb0afa3d32e47eeb881bb837e1b9032bf9cdbff7a86cf1c9",
      "BWChat/Services/APIService.swift":
        "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      const copied = sourceNative(relativePath);
      expect(copied).toBe(sourceOriginalNative(relativePath));
      expect(createHash("sha256").update(copied).digest("hex")).toBe(expected);
    }
  });

  it("keeps every visible and validation bilingual pair plus the native locale branch", () => {
    const nativeRole = sourceNative("BWChat/Views/ScriptRoleEditorView.swift");
    const nativeText = sourceNative("BWChat/Views/ScriptCenterView.swift");
    const expo = sourceExpo("src/app/script-editor.tsx");
    const policy = sourceExpo("src/services/scripts/scriptEditorPolicy.ts");
    const centerPolicy = sourceExpo("src/services/scripts/scriptCenterPolicy.ts");
    const roleModal = expo.slice(
      expo.indexOf("export function ScriptRoleEditorModal"),
      expo.indexOf("function cloneDraft"),
    );
    const visiblePairs = [
      ["头像", "Avatar"],
      ["公开资料", "Public Profile"],
      ["角色名称", "Character name"],
      ["性别", "Gender"],
      ["请选择", "Select"],
      ["公开描述", "Public description"],
      ["AI 隐藏设定", "Hidden AI Setting"],
      [
        "仅你和服务端生成过程可读取，不会展示给其他用户。",
        "Only you and server-side generation can read this.",
      ],
      ["编辑角色", "Edit Character"],
      ["取消", "Cancel"],
      ["保存", "Save"],
    ] as const;
    for (const [chinese, english] of visiblePairs) {
      expectBilingualCall(nativeRole, "ScriptText.value", chinese, english);
      expectBilingualCall(roleModal, "text", chinese, english);
    }
    for (const [chinese, english] of [
      ["男", "Male"],
      ["女", "Female"],
    ] as const) {
      expectBilingualCall(nativeText, "self.value", chinese, english);
      expectBilingualCall(roleModal, "text", chinese, english);
    }
    for (const [chinese, english] of [
      ["请填写角色名称", "Enter a character name"],
      ["角色名称最多 8 个字符", "Character names can contain up to 8 characters"],
      ["请选择角色性别", "Select the character's gender"],
      ["请填写公开描述", "Enter a public description"],
      ["公开描述最多 100 个字符", "Public descriptions can contain up to 100 characters"],
      ["请选择角色头像", "Choose a character avatar"],
    ] as const) {
      expectBilingualCall(nativeRole, "ScriptText.value", chinese, english);
      expectBilingualCall(policy, "value", chinese, english);
    }
    expect(nativeText).toContain("case .simplifiedChinese, .traditionalChinese, .system:");
    expect(centerPolicy).toContain(
      'selectedLanguage === "system" || selectedLanguage.startsWith("zh")',
    );
  });

  it("preserves the real editor entry, large page sheet and grouped form structure", () => {
    const nativeParent = sourceNative("BWChat/Views/ScriptEditorView.swift");
    const nativeRole = sourceNative("BWChat/Views/ScriptRoleEditorView.swift");
    const expo = sourceExpo("src/app/script-editor.tsx");
    expect(nativeParent).toContain(".sheet(item: $editingRole)");
    expect(nativeParent).toContain("ScriptRoleEditorView(role: role, onSave: upsertRole)");
    expect(nativeParent).toContain(".presentationDetents([.large])");
    expect(nativeRole).toContain("NavigationStack");
    expect(nativeRole).toContain("Form {");
    expect(expo).toContain('presentationStyle="pageSheet"');
    expect(expo).toContain("allowSwipeDismissal");
    expect(expo).toContain("<ScriptRoleEditorModal");
    expect(expo).toContain("<FormSection secondaryHeader");
  });

  it("keeps avatar, input, counter, picker and toast geometry and limits", () => {
    const native = sourceNative("BWChat/Views/ScriptRoleEditorView.swift");
    const policy = sourceExpo("src/services/scripts/scriptEditorPolicy.ts");
    const expo = sourceExpo("src/app/script-editor.tsx");
    for (const contract of [
      ".frame(width: 92, height: 92)",
      "lineWidth: 2",
      "String($0.prefix(8))",
      ".frame(minHeight: 110)",
      "String($0.prefix(100))",
      "String($0.prefix(500))",
      "duration: 3",
    ]) {
      expect(native).toContain(contract);
    }
    for (const contract of [
      "roleEditorAvatarSize: 92",
      "roleEditorAvatarStroke: 2",
      "roleNameMaximumCharacters: 8",
      "roleDescriptionMaximumCharacters: 100",
      "roleHiddenMaximumCharacters: 500",
      "roleDescriptionMinimumHeight: 110",
      "roleHiddenMinimumHeight: 110",
      "roleToastMilliseconds: 3_000",
    ]) {
      expect(policy).toContain(contract);
    }
    expect(expo).toContain('pickerStyle("menu")');
    expect(expo).toContain('tag("unspecified")');
    expect(expo).toContain('tag("female")');
    expect(expo).toContain('tag("male")');
  });

  it("matches PhotosPicker semantics, HEIC/EXIF conversion and bounded 700KB preparation", () => {
    const native = sourceNative("BWChat/Views/ScriptRoleEditorView.swift");
    const nativeApi = sourceNative("BWChat/Services/APIService.swift");
    const policy = sourceExpo("src/services/scripts/scriptEditorPolicy.ts");
    const picker = sourceExpo("src/services/scripts/ScriptRoleMediaPicker.ts");
    const expo = sourceExpo("src/app/script-editor.tsx");
    const roleModal = expo.slice(
      expo.indexOf("export function ScriptRoleEditorModal"),
      expo.indexOf("function cloneDraft"),
    );
    expect(native).toContain("PhotosPicker(selection: $photoItem, matching: .images)");
    expect(native).toContain("item.loadTransferable(type: Data.self)");
    expect(native).toContain("let data = try? await item.loadTransferable");
    expect(native).toContain("maxDimension: 800");
    expect(native).toContain("quality: 0.8");
    expect(native).toContain("maxBytes: 700_000");
    expect(nativeApi).toContain("CGImageSourceCreateWithData");
    expect(policy).toContain("roleMaximumDimension: 800");
    expect(policy).toContain("roleInitialQuality: 0.8");
    expect(policy).toContain("roleMaximumBytes: 700_000");
    expect(policy).toContain("[initialQuality, 0.65, 0.55, 0.45, 0.35]");
    expect(policy).toContain("file.slice(0, 3).arrayBuffer()");
    expect(expo).toContain("UIImagePickerPreferredAssetRepresentationMode.Automatic");
    expect(picker).toContain("Permission inspection is therefore diagnostic only");
    expect(picker).toContain('kind: "cancelled"');
    expect(picker).toContain('kind: "permission_denied"');
    expect(roleModal).toContain('if (outcome.kind === "selected")');
    expect(roleModal).not.toContain("无法访问相册，请在系统设置中允许选择照片");
    expect(roleModal).not.toContain("Unable to read selected image");
    expect(roleModal).not.toContain("roleAvatarLoading");
    expect(roleModal).not.toContain("const [isPicking, setPicking]");
  });

  it("preserves validation, role payload, strict envelopes and cache writeback", () => {
    const nativeRole = sourceNative("BWChat/Views/ScriptRoleEditorView.swift");
    const nativeModel = sourceNative("BWChat/Models/InteractiveScript.swift");
    const nativeViewModel = sourceNative("BWChat/ViewModels/InteractiveScriptViewModels.swift");
    const nativeApi = sourceNative("BWChat/Services/APIService.swift");
    const policy = sourceExpo("src/services/scripts/scriptEditorPolicy.ts");
    const api = sourceExpo("src/api/bwchat.ts");
    const editor = sourceExpo("src/app/script-editor.tsx");
    for (const contract of [
      "请填写角色名称",
      "请选择角色性别",
      "请填写公开描述",
      "请选择角色头像",
    ]) {
      expect(nativeRole).toContain(contract);
      expect(policy).toContain(contract);
    }
    for (const field of [
      '"client_role_id"',
      '"name"',
      '"gender"',
      '"avatar_url"',
      '"description"',
      '"hidden_setting"',
      '"role_id"',
    ]) {
      expect(nativeModel).toContain(field);
      expect(policy).toContain(field.replaceAll('"', ""));
    }
    expect(nativeViewModel).toContain(
      "NotificationCenter.default.post(name: .scriptLibraryDidChange",
    );
    expect(nativeModel).toContain("name.trimmingCharacters(in: .whitespacesAndNewlines)");
    expect(nativeModel).toContain(
      "roleDescription.trimmingCharacters(in: .whitespacesAndNewlines)",
    );
    expect(policy).toContain("trimFoundationWhitespacesAndNewlines(role.name)");
    expect(editor).toContain("trimFoundationWhitespacesAndNewlines(role.name)");
    expect(editor).toContain("trimFoundationWhitespacesAndNewlines(role.roleDescription)");
    expect(nativeApi).toContain('baseURL + "/scripts/assets"');
    expect(api).toContain('apiRequest<unknown>("/scripts/assets", {');
    expect(api).toContain("requiredEnvelope: true");
    expect(api).toContain("requiredData: true");
    expect(editor).toContain("invalidateScriptCatalog(expectedOwnerId, saved)");
  });

  it("guards duplicate/late/account-switched work, cleans only cache media and exposes VoiceOver", () => {
    const editor = sourceExpo("src/app/script-editor.tsx");
    const policy = sourceExpo("src/services/scripts/scriptEditorPolicy.ts");
    for (const contract of [
      "pickingRef.current",
      "pickerGenerationRef.current",
      "savingRef.current",
      "saveGenerationRef.current",
      "expectedOwnerId === ownerIdRef.current",
      "transferredRef.current",
      "removeDisposableScriptImage",
      "accessibilityViewIsModal",
      'accessibilityRole="header"',
      'accessibilityRole="button"',
    ]) {
      expect(editor).toContain(contract);
    }
    expect(policy).toContain("normalizedUri.startsWith(`${normalizedCache}/`)");
    expect(editor).toContain('scheme === "dark" ? "#1C1C1E" : theme.background');
  });

  it("does not invent bitmap assets for a page that only shows dynamic role avatars and symbols", () => {
    const native = sourceNative("BWChat/Views/ScriptRoleEditorView.swift");
    const expo = sourceExpo("src/app/script-editor.tsx");
    expect(native).toContain('Image(systemName: "camera.fill")');
    expect(expo).toContain('name={size > 50 ? "camera.fill" : "person.fill"}');
    expect(expo).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
  });

  it("keeps the role sheet as a local hand-off without invented API, delete or idempotency actions", () => {
    const native = sourceNative("BWChat/Views/ScriptRoleEditorView.swift");
    const expo = sourceExpo("src/app/script-editor.tsx");
    const roleModal = expo.slice(
      expo.indexOf("export function ScriptRoleEditorModal"),
      expo.indexOf("function cloneDraft"),
    );
    expect(native).toContain("let onSave: (ScriptRoleDraft) -> Void");
    expect(native).not.toContain("APIService.shared");
    expect(native).not.toContain("deleteScript");
    expect(roleModal).toContain("onSave(draft)");
    expect(roleModal).not.toContain("uploadScriptAsset");
    expect(roleModal).not.toContain("createScript");
    expect(roleModal).not.toContain("updateScript");
    expect(roleModal).not.toContain("deleteScript");
    expect(roleModal).not.toContain("Idempotency-Key");
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
