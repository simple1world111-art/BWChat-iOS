import { createScript, updateScript, uploadScriptAsset } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import type { InteractiveScript } from "@/models";
import { scriptText } from "@/services/scripts/scriptCenterPolicy";
import {
  emptyScriptDraft,
  emptyScriptRoleDraft,
  isDisposableScriptImageUri,
  limitScriptCharacters,
  scriptCharacterCount,
  scriptDraftFromScript,
  scriptDraftRequestBody,
  scriptDraftValidationMessages,
  scriptEditorMetrics,
  scriptRoleValidationMessage,
} from "@/services/scripts/scriptEditorPolicy";
import { pickScriptRoleAvatar, scriptPhotoAccess } from "@/services/scripts/ScriptRoleMediaPicker";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);

describe("native ScriptEditorView and ScriptRoleEditorView contracts", () => {
  beforeEach(() => request.mockReset());

  it("keeps source form, cover, input, role and toast geometry", () => {
    expect(scriptEditorMetrics).toMatchObject({
      formSectionGap: 22,
      formHorizontalInset: 16,
      sectionHeaderInset: 16,
      sectionHeaderSize: 14,
      coverHeight: 180,
      emptyCoverMinimumHeight: 150,
      coverRadius: 14,
      synopsisMinimumHeight: 130,
      worldSettingMinimumHeight: 120,
      roleAvatarSize: 42,
      roleEditorAvatarSize: 92,
      roleEditorAvatarStroke: 2,
      roleDescriptionMinimumHeight: 110,
      roleHiddenMinimumHeight: 110,
      editorToastMilliseconds: 3_500,
      roleToastMilliseconds: 3_000,
    });
  });

  it("keeps every source character, role and upload limit", () => {
    expect(scriptEditorMetrics).toMatchObject({
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
    });
  });

  it("counts and truncates Swift-style grapheme characters", () => {
    const value = "A👨‍👩‍👧‍👦e\u0301中";
    expect(scriptCharacterCount(value)).toBe(4);
    expect(limitScriptCharacters(value, 3)).toBe("A👨‍👩‍👧‍👦e\u0301");
  });

  it("uses the same ScriptText branch for system and all ten selectable languages", () => {
    for (const language of ["system", "zh-Hans", "zh-Hant"]) {
      expect(scriptText(language, "中文", "English")).toBe("中文");
    }
    for (const language of ["en", "ja", "ko", "es", "fr", "de", "pt-BR", "ru"]) {
      expect(scriptText(language, "中文", "English")).toBe("English");
    }
  });

  it("matches private and public validation ordering", () => {
    const role = emptyScriptRoleDraft("client-1");
    const privateDraft = { ...emptyScriptDraft(), roles: [role] };
    expect(scriptDraftValidationMessages(privateDraft)).toEqual(["请选择每个角色的性别"]);
    expect(scriptDraftValidationMessages({ ...privateDraft, visibility: "public" })).toEqual([
      "请选择每个角色的性别",
      "标题至少需要 5 个字符",
      "剧情简介至少需要 20 个字符",
      "请选择封面",
      "请选择至少一个分类",
      "至少需要两个角色",
      "请补全所有角色的名称和公开描述",
      "请为所有角色选择头像",
    ]);
  });

  it("requires complete unique public roles using case and diacritic folding", () => {
    const base = {
      ...emptyScriptDraft(),
      title: "完整的剧本",
      synopsis: "这是一个长度已经满足公开要求的完整剧情简介。",
      coverUrl: "/cover.jpg",
      categoryIds: ["2"],
      visibility: "public" as const,
    };
    const first = {
      ...emptyScriptRoleDraft("one"),
      name: "ÉVA",
      gender: "female",
      avatarUrl: "/one.jpg",
      roleDescription: "角色一",
    };
    const second = {
      ...emptyScriptRoleDraft("two"),
      name: "eva",
      gender: "male",
      avatarUrl: "/two.jpg",
      roleDescription: "角色二",
    };
    expect(scriptDraftValidationMessages({ ...base, roles: [first, second] })).toEqual([
      "角色名称不能重复",
    ]);
    expect(scriptRoleValidationMessage(emptyScriptRoleDraft("new"), true)).toBe("请填写角色名称");
    expect(scriptRoleValidationMessage({ ...first, avatarUrl: "" }, false)).toBe(
      "Choose a character avatar",
    );
  });

  it("matches Foundation whitespace-and-newline validation and role payload trimming", () => {
    const foundationOnly = "\u0085";
    const complete = {
      ...emptyScriptRoleDraft("one"),
      name: "林夏",
      gender: "female",
      avatarUrl: "/one.jpg",
      roleDescription: "工程师",
    };
    expect(scriptRoleValidationMessage({ ...complete, name: foundationOnly }, true)).toBe(
      "请填写角色名称",
    );
    expect(
      scriptRoleValidationMessage({ ...complete, roleDescription: foundationOnly }, true),
    ).toBe("请填写公开描述");
    expect(scriptRoleValidationMessage({ ...complete, avatarUrl: foundationOnly }, true)).toBe(
      "请选择角色头像",
    );

    expect(
      scriptDraftRequestBody({
        ...emptyScriptDraft(),
        title: `${foundationOnly}标题${foundationOnly}`,
        synopsis: `${foundationOnly}简介${foundationOnly}`,
        worldSetting: `${foundationOnly}世界${foundationOnly}`,
        roles: [
          {
            ...complete,
            name: `${foundationOnly}林夏${foundationOnly}`,
            roleDescription: `${foundationOnly}工程师${foundationOnly}`,
            hiddenSetting: `${foundationOnly}秘密${foundationOnly}`,
          },
        ],
      }),
    ).toMatchObject({
      title: "标题",
      synopsis: "简介",
      world_setting: "世界",
      roles: [
        expect.objectContaining({
          name: "林夏",
          description: "工程师",
          hidden_setting: "秘密",
        }),
      ],
    });
  });

  it("round-trips the original draft and serializes numeric category and role IDs", () => {
    const script = makeScript();
    const draft = scriptDraftFromScript(script);
    expect(draft.roles[0]).toMatchObject({
      id: "client-one",
      serverRoleId: "role-one",
      roleDescription: "工程师",
      hiddenSetting: "害怕深海",
    });
    expect(scriptDraftRequestBody({ ...draft, categoryIds: ["12", "story", "2"] })).toEqual({
      title: "失落星港",
      synopsis: "两名船员抵达失联多年的星港。",
      cover_url: "/cover.jpg",
      category_ids: [12, 2, "story"],
      visibility: "public",
      world_setting: "秘密世界",
      roles: [
        {
          client_role_id: "client-one",
          role_id: "role-one",
          name: "林夏",
          gender: "female",
          avatar_url: "/one.jpg",
          description: "工程师",
          hidden_setting: "害怕深海",
        },
      ],
    });
  });

  it("uses exact create and update routes with unchanged JSON bodies", async () => {
    request
      .mockResolvedValueOnce({ script: makeScript() })
      .mockResolvedValueOnce({ script: makeScript() });
    const body = { title: "失落星港", visibility: "private" };
    await createScript(body);
    await updateScript("script/one", body);
    expect(request.mock.calls).toEqual([
      ["/scripts", { method: "POST", requiredData: true, requiredEnvelope: true, body }],
      [
        "/scripts/script%2Fone",
        { method: "PATCH", requiredData: true, requiredEnvelope: true, body },
      ],
    ]);
  });

  it("uploads the exact business/file multipart body with the native 90-second timeout", async () => {
    request.mockResolvedValueOnce({
      asset_url: "/assets/cover.jpg",
      mime_type: "image/jpeg",
      size: 42,
    });
    const append = jest.spyOn(FormData.prototype, "append");
    await expect(
      uploadScriptAsset("script_cover", "file:///cover.jpg", "script-cover-id.jpg"),
    ).resolves.toEqual({ url: "/assets/cover.jpg", mime_type: "image/jpeg", size: 42 });
    expect(request).toHaveBeenCalledTimes(1);
    const [path, options] = request.mock.calls[0] ?? [];
    expect(path).toBe("/scripts/assets");
    expect(options).toMatchObject({
      method: "POST",
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 90_000,
    });
    expect(options?.body).toBeInstanceOf(FormData);
    expect(append.mock.calls).toEqual([
      ["business", "script_cover"],
      [
        "file",
        {
          uri: "file:///cover.jpg",
          name: "script-cover-id.jpg",
          type: "image/jpeg",
        },
      ],
    ]);
    append.mockRestore();
  });

  it("keeps PhotosPicker usable for limited/denied library scope and classifies cancel", async () => {
    const prepare = jest.fn(async () => "file:///cache/prepared.jpg");
    const launchPicker = jest.fn(async () => ({
      canceled: false,
      assets: [{ uri: "file:///picker/photo.heic", width: 3024, height: 4032 }],
    }));
    await expect(
      pickScriptRoleAvatar({
        inspectAccess: async () => ({ granted: false, accessPrivileges: "none" }),
        launchPicker,
        prepare,
      }),
    ).resolves.toEqual({
      kind: "selected",
      access: "none",
      uri: "file:///cache/prepared.jpg",
    });
    expect(launchPicker).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith({
      uri: "file:///picker/photo.heic",
      width: 3024,
      height: 4032,
    });

    await expect(
      pickScriptRoleAvatar({
        inspectAccess: async () => ({ granted: true, accessPrivileges: "limited" }),
        launchPicker: async () => ({ canceled: true, assets: null }),
        prepare,
      }),
    ).resolves.toEqual({ kind: "cancelled", access: "limited" });
  });

  it("classifies permission, malformed-selection and preparation errors without throwing", async () => {
    await expect(
      pickScriptRoleAvatar({
        inspectAccess: async () => {
          throw new Error("permission inspection unavailable");
        },
        launchPicker: async () => {
          throw Object.assign(new Error("Missing camera or camera roll permission"), {
            code: "ERR_MISSING_PERMISSION",
          });
        },
        prepare: async () => "unused",
      }),
    ).resolves.toEqual({ kind: "permission_denied", access: "unknown" });

    await expect(
      pickScriptRoleAvatar({
        inspectAccess: async () => ({ granted: true }),
        launchPicker: async () => ({
          canceled: false,
          assets: [{ uri: "file:///broken.heic", width: 0, height: 0 }],
        }),
        prepare: async () => "unused",
      }),
    ).resolves.toEqual({ kind: "error", access: "all" });

    await expect(
      pickScriptRoleAvatar({
        inspectAccess: async () => ({ status: "granted", accessPrivileges: "all" }),
        launchPicker: async () => ({
          canceled: false,
          assets: [{ uri: "file:///large.heic", width: 8064, height: 6048 }],
        }),
        prepare: async () => {
          throw new Error("decode failed");
        },
      }),
    ).resolves.toEqual({ kind: "error", access: "all" });
  });

  it("normalizes access and only allows cache-owned media cleanup", () => {
    expect(scriptPhotoAccess({ accessPrivileges: "all" })).toBe("all");
    expect(scriptPhotoAccess({ accessPrivileges: "limited" })).toBe("limited");
    expect(scriptPhotoAccess({ granted: false })).toBe("none");
    expect(scriptPhotoAccess(null)).toBe("unknown");
    expect(
      isDisposableScriptImageUri("file:///app/cache/ImagePicker/photo.jpg", "file:///app/cache/"),
    ).toBe(true);
    expect(
      isDisposableScriptImageUri("file:///app/Documents/important.jpg", "file:///app/cache/"),
    ).toBe(false);
  });
});

function makeScript(): InteractiveScript {
  return {
    script_id: "script-one",
    title: "失落星港",
    synopsis: "两名船员抵达失联多年的星港。",
    cover_url: "/cover.jpg",
    category_ids: ["2"],
    visibility: "public",
    status: "ready",
    creator: { user_id: "owner", nickname: "作者", avatar_url: "" },
    roles: [
      {
        role_id: "role-one",
        client_role_id: "client-one",
        name: "林夏",
        gender: "female",
        avatar_url: "/one.jpg",
        description: "工程师",
        hidden_setting: "害怕深海",
        sort_order: 0,
      },
    ],
    world_setting: "秘密世界",
    is_admin_hidden: false,
  };
}
