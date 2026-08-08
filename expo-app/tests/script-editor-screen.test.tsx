import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import {
  createScript,
  getScript,
  getScriptCategories,
  updateScript,
  uploadScriptAsset,
} from "@/api/bwchat";
import { ScriptEditorOwnerScreen } from "@/app/script-editor";
import type { InteractiveScript } from "@/models";
import {
  clearPendingScriptForNavigation,
  rememberScriptForNavigation,
} from "@/services/scripts/ScriptNavigationStore";

const mockBack = jest.fn();
const mockInvalidateScriptCatalog = jest.fn();
const mockLoadCachedCategories = jest.fn();
const mockSaveCachedCategories = jest.fn();
const mockPrepareImage = jest.fn();
const mockRemoveCacheImage = jest.fn();
const mockPickRoleAvatar = jest.fn();
const mockLaunchImageLibrary = jest.fn();
let mockUuidCounter = 0;

jest.mock("expo-router", () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  Stack: {
    Screen: ({
      options,
    }: {
      options: {
        headerLeft?: (() => ReactNode) | undefined;
        headerRight?: (() => ReactNode) | undefined;
      };
    }) => {
      const { View: MockView } = jest.requireActual("react-native");
      return (
        <MockView>
          {options.headerLeft?.()}
          {options.headerRight?.()}
        </MockView>
      );
    },
  },
  useLocalSearchParams: () => ({}),
}));

jest.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++mockUuidCounter}` }));

jest.mock("expo-image", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Image: ({ source }: { source: string }) => <MockView accessibilityLabel={source} /> };
});

jest.mock("expo-image-picker", () => ({
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: "automatic" },
  getMediaLibraryPermissionsAsync: jest.fn(async () => ({
    accessPrivileges: "all",
    granted: true,
  })),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibrary(...args),
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@expo/ui/swift-ui", () => {
  const {
    Pressable: MockPressable,
    Text: MockText,
    View: MockView,
  } = jest.requireActual("react-native");
  return {
    Host: ({ children }: { children: ReactNode }) => <MockView>{children}</MockView>,
    Picker: ({
      children,
      label,
      onSelectionChange,
    }: {
      children: ReactNode;
      label: string;
      onSelectionChange(value: string): void;
    }) => (
      <MockPressable
        accessibilityLabel={`picker-${label}`}
        onPress={() => onSelectionChange("female")}
      >
        <MockText>{label}</MockText>
        {children}
      </MockPressable>
    ),
    Text: ({ children }: { children: ReactNode }) => <MockText>{children}</MockText>,
  };
});

jest.mock("@expo/ui/swift-ui/modifiers", () => ({
  pickerStyle: (value: string) => value,
  tag: (value: string) => value,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

jest.mock("@/api/bwchat", () => ({
  createScript: jest.fn(),
  getScript: jest.fn(),
  getScriptCategories: jest.fn(),
  updateScript: jest.fn(),
  uploadScriptAsset: jest.fn(),
}));

jest.mock("@/components/AuthenticatedImage", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    AuthenticatedImage: ({ uri }: { uri: string }) => <MockView accessibilityLabel={uri} />,
  };
});

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    TopToast: ({ message }: { message: string | null }) => (
      <MockText accessibilityLabel="editor-toast">{message ?? ""}</MockText>
    ),
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { user_id: "owner-a" } }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ selectedLanguage: "system" }),
}));

jest.mock("@/services/scripts/ScriptCatalogRepository", () => ({
  invalidateScriptCatalog: (...args: unknown[]) => mockInvalidateScriptCatalog(...args),
  loadCachedScriptCategories: (...args: unknown[]) => mockLoadCachedCategories(...args),
  saveCachedScriptCategories: (...args: unknown[]) => mockSaveCachedCategories(...args),
}));

jest.mock("@/services/scripts/scriptEditorPolicy", () => {
  const actual = jest.requireActual("@/services/scripts/scriptEditorPolicy");
  return {
    ...actual,
    prepareScriptImage: (...args: unknown[]) => mockPrepareImage(...args),
    removeDisposableScriptImage: (uri: string) => {
      if (uri.startsWith("file:///cache/")) mockRemoveCacheImage(uri);
    },
  };
});

jest.mock("@/services/scripts/ScriptRoleMediaPicker", () => ({
  pickScriptRoleAvatar: (...args: unknown[]) => mockPickRoleAvatar(...args),
}));

const mockCreateScript = jest.mocked(createScript);
const mockGetScript = jest.mocked(getScript);
const mockGetCategories = jest.mocked(getScriptCategories);
const mockUpdateScript = jest.mocked(updateScript);
const mockUploadAsset = jest.mocked(uploadScriptAsset);

describe("Script Editor screen parity, identity and transaction lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUuidCounter = 0;
    mockLoadCachedCategories.mockResolvedValue(null);
    mockSaveCachedCategories.mockResolvedValue(undefined);
    mockInvalidateScriptCatalog.mockResolvedValue(undefined);
    mockGetCategories.mockResolvedValue([
      { id: "12", name: "科幻", sort_order: 0 },
      { id: "2", name: "悬疑", sort_order: 1 },
    ]);
    mockGetScript.mockResolvedValue(script());
    mockCreateScript.mockResolvedValue(script("已创建"));
    mockUpdateScript.mockResolvedValue(script("已保存"));
    mockPickRoleAvatar.mockResolvedValue({
      kind: "selected",
      access: "all",
      uri: "file:///cache/role-a.jpg",
    });
    mockLaunchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///photos/cover.heic", width: 3024, height: 4032 }],
    });
    mockPrepareImage.mockImplementation(
      async (_uri: string, _width: number, _height: number, business: string) =>
        business === "script_cover" ? "file:///cache/cover-a.jpg" : "file:///cache/role-a.jpg",
    );
  });

  afterEach(async () => {
    await cleanup();
    for (const owner of ["owner-a", "owner-b", "intruder"]) {
      clearPendingScriptForNavigation("script-1", owner);
    }
  });

  it("hydrates edit mode, preserves every field and single-flights the exact PATCH write-back", async () => {
    const update = deferred<InteractiveScript>();
    mockUpdateScript.mockReturnValueOnce(update.promise);
    const view = await render(
      <ScriptEditorOwnerScreen key="owner-a:script-1" ownerId="owner-a" scriptId="script-1" />,
    );

    await waitFor(() => expect(view.getByLabelText("剧本标题").props.value).toBe("失落的星港"));
    expect(view.getByLabelText("剧情简介").props.value).toBe(
      "两名船员抵达失联多年的星港，并开始寻找隐藏在深处的真相。",
    );
    expect(view.getByLabelText("世界隐藏设定").props.value).toBe("秘密世界");
    expect(view.getByText("林夏")).toBeTruthy();
    expect(view.getByText("陆沉舟")).toBeTruthy();
    await waitFor(() =>
      expect(view.getByTestId("script-editor-save").props.disabled).toBeUndefined(),
    );

    await fireEvent.changeText(view.getByLabelText("剧本标题"), "更新后的星港");
    await fireEvent.press(view.getByTestId("script-editor-save"));
    await fireEvent.press(view.getByTestId("script-editor-save"));
    expect(mockUpdateScript).toHaveBeenCalledTimes(1);
    expect(mockCreateScript).not.toHaveBeenCalled();
    expect(mockUploadAsset).not.toHaveBeenCalled();
    expect(mockUpdateScript).toHaveBeenCalledWith("script-1", {
      title: "更新后的星港",
      synopsis: "两名船员抵达失联多年的星港，并开始寻找隐藏在深处的真相。",
      cover_url: "/cover.jpg",
      category_ids: ["science_fiction"],
      visibility: "public",
      world_setting: "秘密世界",
      roles: [
        {
          client_role_id: "client-1",
          role_id: "role-1",
          name: "林夏",
          gender: "female",
          avatar_url: "/one.jpg",
          description: "工程师",
          hidden_setting: "害怕深海",
        },
        {
          client_role_id: "client-2",
          role_id: "role-2",
          name: "陆沉舟",
          gender: "male",
          avatar_url: "/two.jpg",
          description: "领航员",
          hidden_setting: "",
        },
      ],
    });

    await act(async () => {
      update.resolve(script("更新后的星港"));
      await update.promise;
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockInvalidateScriptCatalog).toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({ title: "更新后的星港" }),
    );
  });

  it("uses Foundation whitespace semantics for parent role summaries", async () => {
    const source = script();
    mockGetScript.mockResolvedValueOnce({
      ...source,
      roles: [
        {
          ...source.roles[0]!,
          name: "\u0085",
          description: "\u0085",
        },
      ],
    });
    const view = await render(
      <ScriptEditorOwnerScreen
        key="owner-a:script-1:foundation-whitespace"
        ownerId="owner-a"
        scriptId="script-1"
      />,
    );

    await waitFor(() => expect(view.getByText("未命名角色")).toBeTruthy());
    expect(view.getByText("点击补充角色资料")).toBeTruthy();
  });

  it("matches native category fallback and treats cache persistence as best effort", async () => {
    mockLoadCachedCategories.mockResolvedValueOnce({
      value: [{ id: "cached", name: "缓存分类", sort_order: 0 }],
      updatedAt: 0,
      expiresAt: 0,
      isStale: true,
    });
    mockGetCategories.mockRejectedValueOnce(new Error("分类刷新失败"));
    const fallback = await render(
      <ScriptEditorOwnerScreen key="owner-a:stale-categories" ownerId="owner-a" scriptId="" />,
    );

    await waitFor(() => expect(fallback.getByLabelText("缓存分类")).toBeTruthy());
    expect(fallback.getByLabelText("editor-toast").props.children).toBe("");
    await fallback.unmount();

    mockGetCategories.mockResolvedValueOnce([{ id: "remote", name: "远端分类", sort_order: 0 }]);
    mockSaveCachedCategories.mockRejectedValueOnce(new Error("缓存写入失败"));
    const remote = await render(
      <ScriptEditorOwnerScreen key="owner-a:cache-write" ownerId="owner-a" scriptId="" />,
    );

    await waitFor(() => expect(remote.getByLabelText("远端分类")).toBeTruthy());
    expect(remote.getByLabelText("editor-toast").props.children).toBe("");
  });

  it("uses a fresh category cache and recovers from cache-read failure through the API", async () => {
    mockLoadCachedCategories.mockResolvedValueOnce({
      value: [{ id: "fresh", name: "新鲜缓存", sort_order: 0 }],
      updatedAt: 1,
      expiresAt: 2,
      isStale: false,
    });
    const fresh = await render(
      <ScriptEditorOwnerScreen key="owner-a:fresh-categories" ownerId="owner-a" scriptId="" />,
    );

    await waitFor(() => expect(fresh.getByLabelText("新鲜缓存")).toBeTruthy());
    expect(mockGetCategories).not.toHaveBeenCalled();
    await fresh.unmount();

    mockLoadCachedCategories.mockRejectedValueOnce(new Error("缓存读取失败"));
    mockGetCategories.mockResolvedValueOnce([{ id: "recovered", name: "接口分类", sort_order: 0 }]);
    const recovered = await render(
      <ScriptEditorOwnerScreen key="owner-a:cache-read" ownerId="owner-a" scriptId="" />,
    );

    await waitFor(() => expect(recovered.getByLabelText("接口分类")).toBeTruthy());
    expect(recovered.getByLabelText("editor-toast").props.children).toBe("");
  });

  it("silently preserves the existing cover when PhotosPicker loading fails", async () => {
    rememberScriptForNavigation(script(), "owner-a");
    mockPrepareImage.mockRejectedValueOnce(new Error("decode failed"));
    const view = await render(
      <ScriptEditorOwnerScreen key="owner-a:cover-failure" ownerId="owner-a" scriptId="script-1" />,
    );

    await fireEvent.press(view.getByTestId("script-editor-cover"));
    await waitFor(() => expect(mockPrepareImage).toHaveBeenCalledTimes(1));
    expect(view.getByLabelText("editor-toast").props.children).toBe("");
    expect(view.getByLabelText("http://localhost:8000/api/v1/cover.jpg")).toBeTruthy();
  });

  it("blocks blank PATCH after GET failure or owner mismatch and only saves after a successful retry", async () => {
    mockGetScript.mockReset();
    mockGetScript.mockRejectedValueOnce(new Error("网络失败")).mockResolvedValueOnce(script());
    const view = await render(
      <ScriptEditorOwnerScreen key="owner-a:script-1" ownerId="owner-a" scriptId="script-1" />,
    );

    await waitFor(() => expect(view.getByText("无法加载剧本")).toBeTruthy());
    expect(view.getAllByText("网络失败").length).toBeGreaterThan(0);
    await fireEvent.press(view.getByTestId("script-editor-save"));
    expect(mockUpdateScript).not.toHaveBeenCalled();
    expect(mockUploadAsset).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText("重试"));
    await waitFor(() => expect(view.getByLabelText("剧本标题").props.value).toBe("失落的星港"));
    await waitFor(() =>
      expect(view.getByTestId("script-editor-save").props.disabled).toBeUndefined(),
    );
    await fireEvent.press(view.getByTestId("script-editor-save"));
    await waitFor(() => expect(mockUpdateScript).toHaveBeenCalledTimes(1));

    await cleanup();
    mockGetScript.mockResolvedValueOnce(script("别人的剧本", "intruder"));
    const mismatch = await render(
      <ScriptEditorOwnerScreen
        key="owner-a:script-1:mismatch"
        ownerId="owner-a"
        scriptId="script-1"
      />,
    );
    await waitFor(() =>
      expect(mismatch.getAllByText("你只能编辑自己的剧本").length).toBeGreaterThan(0),
    );
    await fireEvent.press(mismatch.getByTestId("script-editor-save"));
    expect(mockUpdateScript).toHaveBeenCalledTimes(1);
    expect(mockCreateScript).not.toHaveBeenCalled();
  });

  it("isolates A to B to A edit hydration and ignores every unmounted late response", async () => {
    const firstA = deferred<InteractiveScript>();
    const loadB = deferred<InteractiveScript>();
    const secondA = deferred<InteractiveScript>();
    mockGetScript.mockReset();
    mockGetScript
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(loadB.promise)
      .mockReturnValueOnce(secondA.promise);
    const view = await render(
      <ScriptEditorOwnerScreen key="owner-a:first" ownerId="owner-a" scriptId="script-1" />,
    );
    await waitFor(() => expect(mockGetScript).toHaveBeenCalledTimes(1));

    await view.rerender(
      <ScriptEditorOwnerScreen key="owner-b" ownerId="owner-b" scriptId="script-1" />,
    );
    await waitFor(() => expect(mockGetScript).toHaveBeenCalledTimes(2));
    await act(async () => {
      loadB.resolve(script("B 当前", "owner-b"));
      await loadB.promise;
    });
    await act(async () => {
      firstA.resolve(script("A 迟到"));
      await firstA.promise;
    });
    expect(view.getByLabelText("剧本标题").props.value).toBe("B 当前");

    await view.rerender(
      <ScriptEditorOwnerScreen key="owner-a:again" ownerId="owner-a" scriptId="script-1" />,
    );
    await waitFor(() => expect(mockGetScript).toHaveBeenCalledTimes(3));
    await act(async () => {
      secondA.resolve(script("A 返回"));
      await secondA.promise;
    });
    expect(view.getByLabelText("剧本标题").props.value).toBe("A 返回");
  });

  it("uploads cover then roles in source order, commits partial progress and retries without reuploading", async () => {
    const coverUpload = deferred<{ url: string; mime_type: string; size: number }>();
    mockUploadAsset
      .mockReturnValueOnce(coverUpload.promise)
      .mockRejectedValueOnce(new Error("角色上传失败"))
      .mockResolvedValueOnce({ url: "/role-a-uploaded.jpg", mime_type: "image/jpeg", size: 20 });

    const view = await render(
      <ScriptEditorOwnerScreen key="owner-a:create" ownerId="owner-a" scriptId="" />,
    );
    await waitFor(() => expect(view.getByLabelText("科幻")).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText("剧本标题"), "草稿标题");
    await fireEvent.changeText(view.getByLabelText("剧情简介"), "草稿简介");
    await fireEvent.changeText(view.getByLabelText("世界隐藏设定"), "隐藏世界");
    await fireEvent.press(view.getByLabelText("科幻"));
    await fireEvent.press(view.getByTestId("script-editor-cover"));
    await waitFor(() => expect(mockPrepareImage).toHaveBeenCalledTimes(1));

    await fireEvent.press(view.getByLabelText("添加角色"));
    await fireEvent.changeText(view.getByLabelText("角色名称"), "林夏");
    await fireEvent.press(view.getByLabelText("picker-性别"));
    await fireEvent.changeText(view.getByLabelText("公开描述"), "工程师");
    await fireEvent.changeText(view.getByLabelText("AI 隐藏设定"), "害怕深海");
    await fireEvent.press(view.getByLabelText("角色头像"));
    await waitFor(() => expect(mockPickRoleAvatar).toHaveBeenCalledTimes(1));
    await fireEvent.press(view.getByTestId("script-role-editor-save"));

    await fireEvent.press(view.getByTestId("script-editor-save"));
    await fireEvent.press(view.getByTestId("script-editor-save"));
    expect(mockUploadAsset).toHaveBeenCalledTimes(1);
    expect(mockUploadAsset).toHaveBeenNthCalledWith(
      1,
      "script_cover",
      "file:///cache/cover-a.jpg",
      "script-cover-uuid-2.jpg",
    );
    expect(mockCreateScript).not.toHaveBeenCalled();

    await act(async () => {
      coverUpload.resolve({ url: "/cover-uploaded.jpg", mime_type: "image/jpeg", size: 10 });
      await coverUpload.promise;
    });
    await waitFor(() => expect(mockUploadAsset).toHaveBeenCalledTimes(2));
    expect(mockUploadAsset).toHaveBeenNthCalledWith(
      2,
      "script_role_avatar",
      "file:///cache/role-a.jpg",
      "script-role-uuid-3.jpg",
    );
    await waitFor(() =>
      expect(view.getByLabelText("editor-toast").props.children).toBe("角色上传失败"),
    );
    expect(mockCreateScript).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId("script-editor-save"));
    await waitFor(() => expect(mockUploadAsset).toHaveBeenCalledTimes(3));
    expect(mockUploadAsset).toHaveBeenNthCalledWith(
      3,
      "script_role_avatar",
      "file:///cache/role-a.jpg",
      "script-role-uuid-4.jpg",
    );
    await waitFor(() => expect(mockCreateScript).toHaveBeenCalledTimes(1));
    expect(mockCreateScript).toHaveBeenCalledWith({
      title: "草稿标题",
      synopsis: "草稿简介",
      cover_url: "/cover-uploaded.jpg",
      category_ids: [12],
      visibility: "private",
      world_setting: "隐藏世界",
      roles: [
        {
          client_role_id: "uuid-1",
          name: "林夏",
          gender: "female",
          avatar_url: "/role-a-uploaded.jpg",
          description: "工程师",
          hidden_setting: "害怕深海",
        },
      ],
    });
    expect(mockInvalidateScriptCatalog).toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({ title: "已创建" }),
    );
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("cleans replaced/deleted cache media by stable role id but preserves non-cache originals", async () => {
    mockPrepareImage
      .mockResolvedValueOnce("file:///cache/cover-a.jpg")
      .mockResolvedValueOnce("file:///cache/cover-b.jpg")
      .mockResolvedValueOnce("file:///photos/original.heic");
    mockPickRoleAvatar
      .mockResolvedValueOnce({ kind: "selected", access: "all", uri: "file:///cache/role-a.jpg" })
      .mockResolvedValueOnce({ kind: "selected", access: "all", uri: "file:///cache/role-b.jpg" });
    const view = await render(
      <ScriptEditorOwnerScreen key="owner-a:cleanup" ownerId="owner-a" scriptId="" />,
    );

    await fireEvent.press(view.getByTestId("script-editor-cover"));
    await fireEvent.press(view.getByTestId("script-editor-cover"));
    await waitFor(() =>
      expect(mockRemoveCacheImage).toHaveBeenCalledWith("file:///cache/cover-a.jpg"),
    );
    await fireEvent.press(view.getByTestId("script-editor-cover"));
    expect(mockRemoveCacheImage).toHaveBeenCalledWith("file:///cache/cover-b.jpg");

    await fireEvent.press(view.getByLabelText("添加角色"));
    await fireEvent.changeText(view.getByLabelText("角色名称"), "林夏");
    await fireEvent.press(view.getByLabelText("picker-性别"));
    await fireEvent.changeText(view.getByLabelText("公开描述"), "工程师");
    await fireEvent.press(view.getByLabelText("角色头像"));
    await fireEvent.press(view.getByTestId("script-role-editor-save"));
    await fireEvent.press(view.getByLabelText("编辑角色"));
    await fireEvent.press(view.getByLabelText("角色头像"));
    await fireEvent.press(view.getByTestId("script-role-editor-save"));
    expect(mockRemoveCacheImage).toHaveBeenCalledWith("file:///cache/role-a.jpg");

    await fireEvent.press(view.getByLabelText("删除角色"));
    expect(mockRemoveCacheImage).toHaveBeenCalledWith("file:///cache/role-b.jpg");
    await view.unmount();
    expect(mockRemoveCacheImage).not.toHaveBeenCalledWith("file:///photos/original.heic");
  });

  it("protects an uploading cache URI until completion and suppresses every late write-back", async () => {
    const upload = deferred<{ url: string; mime_type: string; size: number }>();
    mockUploadAsset.mockReturnValueOnce(upload.promise);
    const view = await render(
      <ScriptEditorOwnerScreen key="owner-a:late-upload" ownerId="owner-a" scriptId="" />,
    );
    await fireEvent.press(view.getByTestId("script-editor-cover"));
    await waitFor(() => expect(mockPrepareImage).toHaveBeenCalledTimes(1));
    await fireEvent.press(view.getByTestId("script-editor-save"));
    await waitFor(() => expect(mockUploadAsset).toHaveBeenCalledTimes(1));

    await view.unmount();
    expect(mockRemoveCacheImage).not.toHaveBeenCalledWith("file:///cache/cover-a.jpg");
    await act(async () => {
      upload.resolve({ url: "/late-cover.jpg", mime_type: "image/jpeg", size: 10 });
      await upload.promise;
    });
    expect(mockRemoveCacheImage).toHaveBeenCalledTimes(1);
    expect(mockRemoveCacheImage).toHaveBeenCalledWith("file:///cache/cover-a.jpg");
    expect(mockCreateScript).not.toHaveBeenCalled();
    expect(mockInvalidateScriptCatalog).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("accepts only the owner-scoped navigation hand-off", async () => {
    rememberScriptForNavigation(script(), "owner-a");
    const owner = await render(
      <ScriptEditorOwnerScreen key="owner-a:pending" ownerId="owner-a" scriptId="script-1" />,
    );
    expect(owner.getByLabelText("剧本标题").props.value).toBe("失落的星港");
    expect(mockGetScript).not.toHaveBeenCalled();
    await owner.unmount();

    rememberScriptForNavigation(script(), "owner-a");
    const intruderLoad = deferred<InteractiveScript>();
    mockGetScript.mockReturnValueOnce(intruderLoad.promise);
    const intruder = await render(
      <ScriptEditorOwnerScreen key="owner-b:pending" ownerId="owner-b" scriptId="script-1" />,
    );
    await waitFor(() => expect(mockGetScript).toHaveBeenCalledTimes(1));
    expect(intruder.queryByDisplayValue("失落的星港")).toBeNull();
    await intruder.unmount();
  });
});

function script(title = "失落的星港", ownerId = "owner-a"): InteractiveScript {
  return {
    script_id: "script-1",
    title,
    synopsis: "两名船员抵达失联多年的星港，并开始寻找隐藏在深处的真相。",
    cover_url: "/cover.jpg",
    category_ids: ["science_fiction"],
    visibility: "public",
    status: "ready",
    creator: { user_id: ownerId, nickname: "作者甲", avatar_url: "" },
    roles: [
      {
        role_id: "role-1",
        client_role_id: "client-1",
        name: "林夏",
        gender: "female",
        avatar_url: "/one.jpg",
        description: "工程师",
        hidden_setting: "害怕深海",
        sort_order: 0,
      },
      {
        role_id: "role-2",
        client_role_id: "client-2",
        name: "陆沉舟",
        gender: "male",
        avatar_url: "/two.jpg",
        description: "领航员",
        sort_order: 1,
      },
    ],
    world_setting: "秘密世界",
    is_admin_hidden: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}
