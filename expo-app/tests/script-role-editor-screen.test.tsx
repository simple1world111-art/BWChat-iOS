import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import type { ReactNode } from "react";

import { ScriptRoleEditorModal } from "@/app/script-editor";
import type { ScriptRoleDraft } from "@/services/scripts/scriptEditorPolicy";

const mockBack = jest.fn();
const mockPickRoleAvatar = jest.fn();
const mockRemoveCacheImage = jest.fn();

jest.mock("expo-router", () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
}));

jest.mock("expo-crypto", () => ({ randomUUID: () => "role-uuid" }));

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
  launchImageLibraryAsync: jest.fn(),
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
        onPress={() => onSelectionChange("male")}
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
    AuthenticatedImage: ({ uri }: { uri: string }) => (
      <MockView accessibilityLabel={`authenticated:${uri}`} />
    ),
  };
});

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    TopToast: ({ message }: { message: string | null }) => (
      <MockText accessibilityLabel="role-editor-toast">{message ?? ""}</MockText>
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
  invalidateScriptCatalog: jest.fn(),
  loadCachedScriptCategories: jest.fn(),
  saveCachedScriptCategories: jest.fn(),
}));

jest.mock("@/services/scripts/scriptEditorPolicy", () => {
  const actual = jest.requireActual("@/services/scripts/scriptEditorPolicy");
  return {
    ...actual,
    prepareScriptImage: jest.fn(),
    removeDisposableScriptImage: (uri: string) => {
      if (uri.startsWith("file:///cache/")) mockRemoveCacheImage(uri);
    },
  };
});

jest.mock("@/services/scripts/ScriptRoleMediaPicker", () => ({
  pickScriptRoleAvatar: (...args: unknown[]) => mockPickRoleAvatar(...args),
}));

const styles = {} as Parameters<typeof ScriptRoleEditorModal>[0]["styles"];
const text = (chinese: string, _english: string) => chinese;

describe("ScriptRoleEditorView runtime parity and lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPickRoleAvatar.mockReset();
    mockPickRoleAvatar.mockResolvedValue({ kind: "cancelled", access: "all" });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("edits all fields and hands the same stable client/server identity back to the parent", async () => {
    const onSave = jest.fn();
    const view = await renderRole(existingRole(), { onSave });

    expect(view.getByLabelText("角色名称").props.value).toBe("林夏");
    expect(view.getByLabelText("公开描述").props.value).toBe("工程师");
    expect(view.getByLabelText("AI 隐藏设定").props.value).toBe("害怕深海");
    expect(view.getByLabelText("authenticated:http://localhost:8000/api/v1/one.jpg")).toBeTruthy();

    await fireEvent.changeText(view.getByLabelText("角色名称"), "陆沉舟");
    await fireEvent.press(view.getByLabelText("picker-性别"));
    await fireEvent.changeText(view.getByLabelText("公开描述"), "领航员");
    await fireEvent.changeText(view.getByLabelText("AI 隐藏设定"), "隐藏身份");
    mockPickRoleAvatar.mockResolvedValueOnce({
      kind: "selected",
      access: "limited",
      uri: "file:///cache/new-avatar.jpg",
    });
    await fireEvent.press(view.getByLabelText("角色头像"));
    await waitFor(() => expect(view.getByLabelText("file:///cache/new-avatar.jpg")).toBeTruthy());
    await fireEvent.press(view.getByTestId("script-role-editor-save"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      id: "client-1",
      serverRoleId: "role-1",
      name: "陆沉舟",
      gender: "male",
      avatarUrl: "/one.jpg",
      avatarUri: "file:///cache/new-avatar.jpg",
      roleDescription: "领航员",
      hiddenSetting: "隐藏身份",
    });
    expect(mockRemoveCacheImage).not.toHaveBeenCalledWith("file:///cache/new-avatar.jpg");
  });

  it("exposes the role sheet, actions, avatar and live counters to accessibility", async () => {
    const view = await renderRole(existingRole());

    expect(view.getByText("编辑角色").props.accessibilityRole).toBe("header");
    expect(view.getByLabelText("取消").props).toMatchObject({
      accessibilityRole: "button",
      hitSlop: 10,
    });
    expect(view.getByLabelText("保存").props).toMatchObject({
      accessibilityRole: "button",
      hitSlop: 10,
    });
    expect(view.getByLabelText("角色头像").props).toMatchObject({
      accessibilityHint: "从相册选择角色头像",
      accessibilityRole: "button",
    });
    expect(view.getByLabelText("角色名称").props.accessibilityHint).toBe("2/8");
    expect(view.getByLabelText("公开描述").props.accessibilityHint).toBe("3/100");
    expect(view.getByLabelText("AI 隐藏设定").props.accessibilityHint).toBe("4/500");
  });

  it("keeps native validation order and only saves a locally complete new role", async () => {
    const onSave = jest.fn();
    const view = await renderRole(emptyRole(), { onSave });

    await fireEvent.press(view.getByTestId("script-role-editor-save"));
    expect(view.getByLabelText("role-editor-toast").props.children).toBe("请填写角色名称");
    await fireEvent.changeText(view.getByLabelText("角色名称"), "林夏");
    await fireEvent.press(view.getByTestId("script-role-editor-save"));
    expect(view.getByLabelText("role-editor-toast").props.children).toBe("请选择角色性别");
    await fireEvent.press(view.getByLabelText("picker-性别"));
    await fireEvent.press(view.getByTestId("script-role-editor-save"));
    expect(view.getByLabelText("role-editor-toast").props.children).toBe("请填写公开描述");
    await fireEvent.changeText(view.getByLabelText("公开描述"), "工程师");
    await fireEvent.press(view.getByTestId("script-role-editor-save"));
    expect(view.getByLabelText("role-editor-toast").props.children).toBe("请选择角色头像");

    mockPickRoleAvatar.mockResolvedValueOnce({
      kind: "selected",
      access: "none",
      uri: "file:///cache/new-role.jpg",
    });
    await fireEvent.press(view.getByLabelText("角色头像"));
    await fireEvent.press(view.getByTestId("script-role-editor-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "new-client-id",
        name: "林夏",
        gender: "male",
        avatarUri: "file:///cache/new-role.jpg",
        roleDescription: "工程师",
      }),
    );
  });

  it("silently preserves the old avatar for cancel, permission, malformed and preparation failures", async () => {
    mockPickRoleAvatar
      .mockResolvedValueOnce({ kind: "cancelled", access: "limited" })
      .mockResolvedValueOnce({ kind: "permission_denied", access: "none" })
      .mockResolvedValueOnce({ kind: "error", access: "all" });
    const onSave = jest.fn();
    const view = await renderRole(existingRole(), { onSave });

    for (let callCount = 1; callCount <= 3; callCount += 1) {
      await fireEvent.press(view.getByLabelText("角色头像"));
      await waitFor(() => expect(mockPickRoleAvatar).toHaveBeenCalledTimes(callCount));
      expect(view.getByLabelText("role-editor-toast").props.children).toBe("");
      expect(
        view.getByLabelText("authenticated:http://localhost:8000/api/v1/one.jpg"),
      ).toBeTruthy();
    }

    await fireEvent.press(view.getByTestId("script-role-editor-save"));
    expect(onSave).toHaveBeenCalledWith(existingRole());
  });

  it("single-flights avatar selection and cleans a selected result that arrives after cancel", async () => {
    const selection = deferred<{
      kind: "selected";
      access: "all";
      uri: string;
    }>();
    mockPickRoleAvatar.mockReturnValueOnce(selection.promise);
    const onSave = jest.fn();
    const view = await render(
      <RoleHarness key="owner-a:script-a" onSave={onSave} role={existingRole()} />,
    );

    await fireEvent.press(view.getByLabelText("角色头像"));
    await fireEvent.press(view.getByLabelText("角色头像"));
    expect(mockPickRoleAvatar).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByLabelText("取消"));
    expect(view.queryByText("编辑角色")).toBeNull();

    selection.resolve({
      kind: "selected",
      access: "all",
      uri: "file:///cache/late-after-cancel.jpg",
    });
    await waitFor(() =>
      expect(mockRemoveCacheImage).toHaveBeenCalledWith("file:///cache/late-after-cancel.jpg"),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("allows native-equivalent save during image preparation and rejects the late hand-off", async () => {
    const selection = deferred<{
      kind: "selected";
      access: "all";
      uri: string;
    }>();
    mockPickRoleAvatar.mockReturnValueOnce(selection.promise);
    const onSave = jest.fn();
    const view = await render(
      <RoleHarness key="owner-a:script-a:save" onSave={onSave} role={existingRole()} />,
    );

    await fireEvent.press(view.getByLabelText("角色头像"));
    expect(view.getByTestId("script-role-editor-save").props.disabled).toBeUndefined();
    expect(view.getByLabelText("角色头像").props.disabled).toBeUndefined();
    await fireEvent.press(view.getByTestId("script-role-editor-save"));
    expect(onSave).toHaveBeenCalledWith(existingRole());
    expect(view.queryByText("编辑角色")).toBeNull();

    selection.resolve({
      kind: "selected",
      access: "all",
      uri: "file:///cache/late-after-save.jpg",
    });
    await waitFor(() =>
      expect(mockRemoveCacheImage).toHaveBeenCalledWith("file:///cache/late-after-save.jpg"),
    );
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("isolates owner/script remounts and never removes the initial cache avatar on cancellation", async () => {
    const selection = deferred<{
      kind: "selected";
      access: "all";
      uri: string;
    }>();
    mockPickRoleAvatar.mockReturnValueOnce(selection.promise);
    const onSave = jest.fn();
    const initial = { ...existingRole(), avatarUri: "file:///cache/initial-avatar.jpg" };
    const view = await render(
      <RoleHarness key="owner-a:script-a" onSave={onSave} role={initial} />,
    );
    await fireEvent.press(view.getByLabelText("角色头像"));

    await view.rerender(
      <RoleHarness key="owner-b:script-b" onSave={onSave} role={existingRole()} />,
    );
    selection.resolve({
      kind: "selected",
      access: "all",
      uri: "file:///cache/owner-a-late.jpg",
    });
    await waitFor(() =>
      expect(mockRemoveCacheImage).toHaveBeenCalledWith("file:///cache/owner-a-late.jpg"),
    );
    expect(mockRemoveCacheImage).not.toHaveBeenCalledWith("file:///cache/initial-avatar.jpg");
    expect(onSave).not.toHaveBeenCalled();
  });
});

function RoleHarness({
  onSave,
  role,
}: {
  onSave(role: ScriptRoleDraft): void;
  role: ScriptRoleDraft;
}) {
  const [visible, setVisible] = useState(true);
  return visible ? (
    <ScriptRoleEditorModal
      onClose={() => setVisible(false)}
      onSave={(draft) => {
        onSave(draft);
        setVisible(false);
      }}
      role={role}
      scheme="light"
      selectedLanguage="system"
      styles={styles}
      text={text}
    />
  ) : null;
}

async function renderRole(
  role: ScriptRoleDraft,
  { onSave = jest.fn() }: { onSave?: (draft: ScriptRoleDraft) => void } = {},
) {
  return render(
    <ScriptRoleEditorModal
      onClose={jest.fn()}
      onSave={onSave}
      role={role}
      scheme="light"
      selectedLanguage="system"
      styles={styles}
      text={text}
    />,
  );
}

function existingRole(): ScriptRoleDraft {
  return {
    id: "client-1",
    serverRoleId: "role-1",
    name: "林夏",
    gender: "female",
    avatarUrl: "/one.jpg",
    roleDescription: "工程师",
    hiddenSetting: "害怕深海",
  };
}

function emptyRole(): ScriptRoleDraft {
  return {
    id: "new-client-id",
    name: "",
    gender: "unspecified",
    avatarUrl: "",
    roleDescription: "",
    hiddenSetting: "",
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
