import { File, Paths } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type { InteractiveScript, ScriptRole, ScriptVisibility } from "@/models";

export interface ScriptRoleDraft {
  id: string;
  serverRoleId?: string | undefined;
  name: string;
  gender: string;
  avatarUrl: string;
  avatarUri?: string | undefined;
  roleDescription: string;
  hiddenSetting: string;
}

export interface ScriptDraft {
  title: string;
  synopsis: string;
  coverUrl: string;
  coverUri?: string | undefined;
  categoryIds: string[];
  visibility: ScriptVisibility;
  worldSetting: string;
  roles: ScriptRoleDraft[];
}

export type ScriptAssetBusiness = "script_cover" | "script_role_avatar";

export const scriptEditorMetrics = {
  formSectionGap: 22,
  formHorizontalInset: 16,
  formTopInset: 16,
  formBottomInset: 40,
  sectionHeaderInset: 16,
  sectionHeaderSize: 14,
  sectionHeaderCardGap: 7,
  sectionRadius: 10,
  rowHorizontalInset: 16,
  rowVerticalInset: 11,
  visibilityCopyGap: 3,
  visibilityDetailSize: 12,
  textStackGap: 6,
  counterSize: 11,
  coverHeight: 180,
  emptyCoverMinimumHeight: 150,
  coverRadius: 14,
  coverPlaceholderGap: 9,
  coverSymbolSize: 30,
  coverLabelSize: 14,
  synopsisMinimumHeight: 130,
  worldSettingMinimumHeight: 120,
  roleRowGap: 12,
  roleAvatarSize: 42,
  roleCopyGap: 3,
  roleNameSize: 15,
  roleDescriptionSize: 12,
  roleEditorAvatarSize: 92,
  roleEditorAvatarStroke: 2,
  roleEditorSymbolSize: 24,
  roleDescriptionMinimumHeight: 110,
  roleHiddenMinimumHeight: 110,
  titleMaximumCharacters: 15,
  synopsisMaximumCharacters: 500,
  worldSettingMaximumCharacters: 500,
  maximumRoles: 12,
  roleNameMaximumCharacters: 8,
  roleDescriptionMaximumCharacters: 100,
  roleHiddenMaximumCharacters: 500,
  coverMaximumDimension: 1_600,
  coverInitialQuality: 0.82,
  coverMaximumBytes: 1_500_000,
  roleMaximumDimension: 800,
  roleInitialQuality: 0.8,
  roleMaximumBytes: 700_000,
  uploadTimeoutMilliseconds: 90_000,
  editorToastMilliseconds: 3_500,
  roleToastMilliseconds: 3_000,
} as const;

export function emptyScriptDraft(): ScriptDraft {
  return {
    title: "",
    synopsis: "",
    coverUrl: "",
    categoryIds: [],
    visibility: "private",
    worldSetting: "",
    roles: [],
  };
}

export function scriptDraftFromScript(script: InteractiveScript): ScriptDraft {
  return {
    title: script.title,
    synopsis: script.synopsis,
    coverUrl: script.cover_url,
    categoryIds: [...script.category_ids],
    visibility: script.visibility,
    worldSetting: script.world_setting ?? "",
    roles: script.roles.map(scriptRoleDraftFromRole),
  };
}

export function scriptRoleDraftFromRole(role: ScriptRole): ScriptRoleDraft {
  return {
    id: role.client_role_id ?? role.role_id,
    ...(role.role_id ? { serverRoleId: role.role_id } : {}),
    name: role.name,
    gender: role.gender,
    avatarUrl: role.avatar_url,
    roleDescription: role.description,
    hiddenSetting: role.hidden_setting ?? "",
  };
}

export function emptyScriptRoleDraft(id: string): ScriptRoleDraft {
  return {
    id,
    name: "",
    gender: "unspecified",
    avatarUrl: "",
    roleDescription: "",
    hiddenSetting: "",
  };
}

export function scriptDraftRequestBody(draft: ScriptDraft): Record<string, unknown> {
  return {
    title: trimFoundationWhitespacesAndNewlines(draft.title),
    synopsis: trimFoundationWhitespacesAndNewlines(draft.synopsis),
    cover_url: draft.coverUrl,
    category_ids: [...draft.categoryIds].sort().map(numericCategoryId),
    visibility: draft.visibility,
    world_setting: trimFoundationWhitespacesAndNewlines(draft.worldSetting),
    roles: draft.roles.map(scriptRoleDraftRequestBody),
  };
}

export function scriptRoleDraftRequestBody(role: ScriptRoleDraft): Record<string, unknown> {
  return {
    client_role_id: role.id,
    name: trimFoundationWhitespacesAndNewlines(role.name),
    gender: role.gender,
    avatar_url: role.avatarUrl,
    description: trimFoundationWhitespacesAndNewlines(role.roleDescription),
    hidden_setting: trimFoundationWhitespacesAndNewlines(role.hiddenSetting),
    ...(role.serverRoleId ? { role_id: role.serverRoleId } : {}),
  };
}

export function scriptDraftValidationMessages(
  draft: ScriptDraft,
  requiresComplete = draft.visibility === "public",
): string[] {
  const messages: string[] = [];
  const title = trimFoundationWhitespacesAndNewlines(draft.title);
  const synopsis = trimFoundationWhitespacesAndNewlines(draft.synopsis);
  const worldSetting = trimFoundationWhitespacesAndNewlines(draft.worldSetting);

  if (scriptCharacterCount(title) > scriptEditorMetrics.titleMaximumCharacters) {
    messages.push("标题最多 15 个字符");
  }
  if (scriptCharacterCount(synopsis) > scriptEditorMetrics.synopsisMaximumCharacters) {
    messages.push("剧情简介最多 500 个字符");
  }
  if (scriptCharacterCount(worldSetting) > scriptEditorMetrics.worldSettingMaximumCharacters) {
    messages.push("世界隐藏设定最多 500 个字符");
  }
  if (draft.roles.length > scriptEditorMetrics.maximumRoles) messages.push("角色最多 12 个");
  if (draft.roles.some((role) => !["female", "male"].includes(role.gender))) {
    messages.push("请选择每个角色的性别");
  }
  if (
    draft.roles.some(
      (role) =>
        scriptCharacterCount(trimFoundationWhitespacesAndNewlines(role.name)) >
        scriptEditorMetrics.roleNameMaximumCharacters,
    )
  ) {
    messages.push("角色名称最多 8 个字符");
  }
  if (
    draft.roles.some(
      (role) =>
        scriptCharacterCount(trimFoundationWhitespacesAndNewlines(role.roleDescription)) >
        scriptEditorMetrics.roleDescriptionMaximumCharacters,
    )
  ) {
    messages.push("角色公开描述最多 100 个字符");
  }
  if (
    draft.roles.some(
      (role) =>
        scriptCharacterCount(trimFoundationWhitespacesAndNewlines(role.hiddenSetting)) >
        scriptEditorMetrics.roleHiddenMaximumCharacters,
    )
  ) {
    messages.push("角色隐藏设定最多 500 个字符");
  }

  if (requiresComplete) {
    if (scriptCharacterCount(title) < 5) messages.push("标题至少需要 5 个字符");
    if (scriptCharacterCount(synopsis) < 20) messages.push("剧情简介至少需要 20 个字符");
    if (!draft.coverUrl && !draft.coverUri) messages.push("请选择封面");
    if (draft.categoryIds.length === 0) messages.push("请选择至少一个分类");
    if (draft.roles.length < 2) messages.push("至少需要两个角色");
    if (
      draft.roles.some(
        (role) =>
          !trimFoundationWhitespacesAndNewlines(role.name) ||
          !trimFoundationWhitespacesAndNewlines(role.roleDescription),
      )
    ) {
      messages.push("请补全所有角色的名称和公开描述");
    }
    if (
      draft.roles.some(
        (role) => !trimFoundationWhitespacesAndNewlines(role.avatarUrl) && !role.avatarUri,
      )
    ) {
      messages.push("请为所有角色选择头像");
    }
    const names = draft.roles
      .map((role) => foldedRoleName(trimFoundationWhitespacesAndNewlines(role.name)))
      .filter(Boolean);
    if (new Set(names).size !== names.length) messages.push("角色名称不能重复");
  }
  return messages;
}

export function scriptRoleValidationMessage(role: ScriptRoleDraft, chinese = true): string | null {
  const value = (zh: string, en: string) => (chinese ? zh : en);
  const name = trimFoundationWhitespacesAndNewlines(role.name);
  const description = trimFoundationWhitespacesAndNewlines(role.roleDescription);
  const avatarUrl = trimFoundationWhitespacesAndNewlines(role.avatarUrl);
  if (!name) return value("请填写角色名称", "Enter a character name");
  if (scriptCharacterCount(name) > scriptEditorMetrics.roleNameMaximumCharacters) {
    return value("角色名称最多 8 个字符", "Character names can contain up to 8 characters");
  }
  if (!["female", "male"].includes(role.gender)) {
    return value("请选择角色性别", "Select the character's gender");
  }
  if (!description) return value("请填写公开描述", "Enter a public description");
  if (scriptCharacterCount(description) > scriptEditorMetrics.roleDescriptionMaximumCharacters) {
    return value("公开描述最多 100 个字符", "Public descriptions can contain up to 100 characters");
  }
  if (!avatarUrl && !role.avatarUri) {
    return value("请选择角色头像", "Choose a character avatar");
  }
  return null;
}

export function limitScriptCharacters(value: string, maximum: number): string {
  return scriptCharacters(value).slice(0, Math.max(0, maximum)).join("");
}

export function scriptCharacterCount(value: string): number {
  return scriptCharacters(value).length;
}

export async function prepareScriptImage(
  uri: string,
  width: number,
  height: number,
  business: ScriptAssetBusiness,
): Promise<string> {
  const isCover = business === "script_cover";
  const maximumDimension = isCover
    ? scriptEditorMetrics.coverMaximumDimension
    : scriptEditorMetrics.roleMaximumDimension;
  const maximumBytes = isCover
    ? scriptEditorMetrics.coverMaximumBytes
    : scriptEditorMetrics.roleMaximumBytes;
  const initialQuality = isCover
    ? scriptEditorMetrics.coverInitialQuality
    : scriptEditorMetrics.roleInitialQuality;
  const minimumDimension = Math.min(maximumDimension, 640);
  const qualities = [...new Set([initialQuality, 0.65, 0.55, 0.45, 0.35])];
  const source = new File(uri);
  if (
    Math.max(width, height) <= maximumDimension &&
    (source.size ?? Number.MAX_SAFE_INTEGER) <= maximumBytes &&
    (await isJpegFile(source))
  ) {
    return uri;
  }
  let dimension: number = maximumDimension;
  let bestUri: string | null = null;

  try {
    while (true) {
      const actions =
        Math.max(width, height) > dimension
          ? [{ resize: width >= height ? { width: dimension } : { height: dimension } }]
          : [];
      for (const quality of qualities) {
        const prepared = await ImageManipulator.manipulateAsync(uri, actions, {
          compress: quality,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        if (bestUri && bestUri !== prepared.uri && bestUri !== uri) {
          removeDisposableScriptImage(bestUri);
        }
        bestUri = prepared.uri;
        if ((new File(prepared.uri).size ?? Number.MAX_SAFE_INTEGER) <= maximumBytes) {
          return prepared.uri;
        }
      }
      if (dimension <= minimumDimension) break;
      dimension = Math.max(minimumDimension, dimension * 0.75);
    }
  } catch (error) {
    if (bestUri && bestUri !== uri) removeDisposableScriptImage(bestUri);
    throw error;
  }
  if (!bestUri) throw new Error("图片处理失败");
  return bestUri;
}

export function isDisposableScriptImageUri(
  uri: string,
  cacheDirectoryUri = Paths.cache.uri,
): boolean {
  const normalizedUri = uri.trim();
  const normalizedCache = cacheDirectoryUri.trim().replace(/\/+$/u, "");
  return Boolean(
    normalizedUri && normalizedCache && normalizedUri.startsWith(`${normalizedCache}/`),
  );
}

export function removeDisposableScriptImage(uri: string | undefined): void {
  if (!uri || !isDisposableScriptImageUri(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup must never turn a successful selection or save into a product error.
  }
}

function numericCategoryId(value: string): string | number {
  if (!/^[+-]?\d+$/u.test(value)) return value;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : value;
}

function foldedRoleName(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

async function isJpegFile(file: File): Promise<boolean> {
  try {
    const bytes = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  } catch {
    return false;
  }
}

function scriptCharacters(value: string): string[] {
  type Segment = { segment: string };
  type Segmenter = { segment(input: string): Iterable<Segment> };
  type SegmenterConstructor = new (
    locales?: string | string[],
    options?: { granularity: "grapheme" },
  ) => Segmenter;
  const Constructor = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  if (Constructor) {
    return Array.from(
      new Constructor(undefined, { granularity: "grapheme" }).segment(value),
      (item) => item.segment,
    );
  }
  return Array.from(value);
}
