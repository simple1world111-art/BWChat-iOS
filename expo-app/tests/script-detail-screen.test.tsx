import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Alert, StyleSheet } from "react-native";

import { createScriptRoom, deleteScript, getScript, updateScript } from "@/api/bwchat";
import { ScriptDetailOwnerScreen } from "@/app/script-detail";
import type { InteractiveScript, ScriptRoomCreationData } from "@/models";
import {
  clearPendingScriptForNavigation,
  rememberScriptForNavigation,
} from "@/services/scripts/ScriptNavigationStore";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockInvalidateAgentCatalog = jest.fn();
const mockInvalidateScriptCatalog = jest.fn();
const mockSaveCachedScriptRoom = jest.fn();
const mockLibrarySubscribers = new Map<
  string,
  (change: InteractiveScript | string | undefined) => void
>();

jest.mock("expo-router", () => ({
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    push: (...args: unknown[]) => mockPush(...args),
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ scriptId: "script-1" }),
}));

jest.mock("expo-crypto", () => ({ randomUUID: () => "room-idempotency-1" }));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children: ReactNode }) => {
    const { View: MockView } = jest.requireActual("react-native");
    return <MockView>{children}</MockView>;
  },
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

jest.mock("@/api/bwchat", () => ({
  createScriptRoom: jest.fn(),
  deleteScript: jest.fn(),
  getScript: jest.fn(),
  updateScript: jest.fn(),
}));

jest.mock("@/components/AuthenticatedImage", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    AuthenticatedImage: ({
      onLoad,
    }: {
      onLoad?: ((event: { source: { width: number; height: number } }) => void) | undefined;
    }) => <MockView accessibilityLabel="script-detail-image" {...(onLoad ? { onLoad } : {})} />,
  };
});

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { TopToast: ({ message }: { message: string | null }) => <MockText>{message}</MockText> };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { user_id: "owner-a" } }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ selectedLanguage: "system" }),
}));

jest.mock("@/services/agents/AgentCatalogRepository", () => ({
  invalidateAgentCatalog: (...args: unknown[]) => mockInvalidateAgentCatalog(...args),
}));

jest.mock("@/services/scripts/ScriptCatalogRepository", () => ({
  invalidateScriptCatalog: (...args: unknown[]) => mockInvalidateScriptCatalog(...args),
  subscribeScriptLibraryChanges: (
    ownerId: string,
    listener: (change: InteractiveScript | string | undefined) => void,
  ) => {
    mockLibrarySubscribers.set(ownerId, listener);
    return () => mockLibrarySubscribers.delete(ownerId);
  },
}));

jest.mock("@/services/scripts/ScriptRoomRepository", () => ({
  saveCachedScriptRoom: (...args: unknown[]) => mockSaveCachedScriptRoom(...args),
}));

const mockCreateRoom = jest.mocked(createScriptRoom);
const mockDeleteScript = jest.mocked(deleteScript);
const mockGetScript = jest.mocked(getScript);
const mockUpdateScript = jest.mocked(updateScript);

describe("Script Detail screen parity and lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLibrarySubscribers.clear();
    mockInvalidateAgentCatalog.mockResolvedValue(undefined);
    mockInvalidateScriptCatalog.mockResolvedValue(undefined);
    mockSaveCachedScriptRoom.mockResolvedValue(undefined);
    mockGetScript.mockResolvedValue(script());
    mockUpdateScript.mockResolvedValue({ ...script(), visibility: "private" });
    mockDeleteScript.mockResolvedValue(undefined);
    mockCreateRoom.mockResolvedValue(roomResult());
  });

  afterEach(async () => {
    await cleanup();
    jest.useRealTimers();
    for (const owner of ["owner-a", "owner-b"]) {
      clearPendingScriptForNavigation("script-1", owner);
    }
  });

  it("renders native metadata, roles, owner controls, detail sheet and edit hand-off", async () => {
    rememberScriptForNavigation(script(), "owner-a");
    const view = await render(
      <ScriptDetailOwnerScreen key="owner-a:script-1" ownerId="owner-a" scriptId="script-1" />,
    );

    expect(view.getByText("失落星港")).toBeTruthy();
    expect(view.getByText("作者甲")).toBeTruthy();
    expect(view.getByText("可开局")).toBeTruthy();
    expect(view.getByText("公开")).toBeTruthy();
    expect(view.getByText("两名船员抵达失联多年的星港。")).toBeTruthy();
    expect(view.getByText("林夏")).toBeTruthy();
    expect(view.getByText("陆沉舟")).toBeTruthy();
    expect(view.getByText("编辑剧本")).toBeTruthy();
    expect(view.getByText("设为私人")).toBeTruthy();
    expect(view.getByText("删除剧本")).toBeTruthy();

    await fireEvent.press(view.getByLabelText("script-detail-role-role-1"));
    expect(view.getByText("角色详情")).toBeTruthy();
    expect(view.getAllByText("工程师")).toHaveLength(2);
    await fireEvent.press(view.getByText("完成"));

    await fireEvent.press(view.getByText("编辑剧本"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/script-editor",
      params: { scriptId: "script-1" },
    });
  });

  it("reflows the cover to the loaded poster's intrinsic dimensions", async () => {
    rememberScriptForNavigation(script(), "owner-a");
    const view = await render(
      <ScriptDetailOwnerScreen key="owner-a:script-1" ownerId="owner-a" scriptId="script-1" />,
    );
    const cover = view.getByLabelText("script-detail-cover");
    expect(StyleSheet.flatten(cover.props.style).aspectRatio).toBe(1.55);

    const coverImage = view.getAllByLabelText("script-detail-image")[0];
    expect(coverImage).toBeDefined();
    if (!coverImage) throw new Error("Expected the script cover image");
    await fireEvent(coverImage, "load", {
      source: { width: 1_024, height: 1_536 },
    });

    await waitFor(() =>
      expect(StyleSheet.flatten(cover.props.style).aspectRatio).toBeCloseTo(2 / 3),
    );
  });

  it("synchronously single-flights visibility and delete owner actions", async () => {
    rememberScriptForNavigation(script(), "owner-a");
    const visibility = deferred<InteractiveScript>();
    mockUpdateScript.mockReturnValueOnce(visibility.promise);
    const view = await render(
      <ScriptDetailOwnerScreen key="owner-a:script-1" ownerId="owner-a" scriptId="script-1" />,
    );

    await fireEvent.press(view.getByText("设为私人"));
    await fireEvent.press(view.getByText("设为私人"));
    expect(mockUpdateScript).toHaveBeenCalledTimes(1);
    expect(mockUpdateScript).toHaveBeenCalledWith("script-1", { visibility: "private" });

    await act(async () => {
      visibility.resolve({ ...script(), visibility: "private" });
      await visibility.promise;
    });
    await waitFor(() => expect(view.getByText("立即公开")).toBeTruthy());
    expect(mockInvalidateScriptCatalog).toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({ script_id: "script-1", visibility: "private" }),
    );

    const deletion = deferred<void>();
    mockDeleteScript.mockReturnValueOnce(deletion.promise);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await fireEvent.press(view.getByText("删除剧本"));
    const destructive = alert.mock.calls[0]?.[2]?.find((action) => action.style === "destructive");
    await act(async () => {
      destructive?.onPress?.();
      destructive?.onPress?.();
    });
    expect(mockDeleteScript).toHaveBeenCalledTimes(1);

    await act(async () => {
      deletion.resolve();
      await deletion.promise;
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockInvalidateScriptCatalog).toHaveBeenLastCalledWith("owner-a", "script-1");
    alert.mockRestore();
  });

  it("single-flights role creation, keeps the idempotency key, caches by owner and cancels late navigation", async () => {
    jest.useFakeTimers();
    rememberScriptForNavigation(script(), "owner-a");
    const creation = deferred<ScriptRoomCreationData>();
    mockCreateRoom.mockReturnValueOnce(creation.promise);
    const view = await render(
      <ScriptDetailOwnerScreen key="owner-a:script-1" ownerId="owner-a" scriptId="script-1" />,
    );

    await fireEvent.press(view.getByLabelText("script-detail-start"));
    await fireEvent.press(view.getByLabelText("script-role-selection-role-1"));
    await fireEvent.press(view.getByLabelText("script-role-selection-start"));
    await fireEvent.press(view.getByLabelText("script-role-selection-start"));
    expect(mockCreateRoom).toHaveBeenCalledTimes(1);
    expect(mockCreateRoom).toHaveBeenCalledWith("script-1", "role-1", "ROOM-IDEMPOTENCY-1");

    await act(async () => {
      creation.resolve(roomResult());
      await creation.promise;
    });
    expect(mockSaveCachedScriptRoom).toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({ room_id: "room-1" }),
    );
    expect(mockInvalidateAgentCatalog).toHaveBeenCalledWith("owner-a");

    await view.unmount();
    await act(async () => jest.advanceTimersByTime(250));
    expect(mockPush).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/script-room-chat" }),
    );
  });

  it("lets forced refresh supersede the old load and ignores the late response", async () => {
    const oldLoad = deferred<InteractiveScript>();
    const freshLoad = deferred<InteractiveScript>();
    mockGetScript.mockReset();
    mockGetScript.mockReturnValueOnce(oldLoad.promise).mockReturnValueOnce(freshLoad.promise);
    const view = await render(
      <ScriptDetailOwnerScreen key="owner-a:script-1" ownerId="owner-a" scriptId="script-1" />,
    );
    await waitFor(() => expect(mockGetScript).toHaveBeenCalledTimes(1));

    await act(async () => mockLibrarySubscribers.get("owner-a")?.(script("刷新事件")));
    expect(mockGetScript).toHaveBeenCalledTimes(2);
    await act(async () => {
      freshLoad.resolve(script("新详情"));
      await freshLoad.promise;
    });
    expect(view.getByText("新详情")).toBeTruthy();

    await act(async () => {
      oldLoad.resolve(script("迟到旧详情"));
      await oldLoad.promise;
    });
    expect(view.queryByText("迟到旧详情")).toBeNull();
    expect(view.getByText("新详情")).toBeTruthy();
  });

  it("isolates A to B to A loads and every unmounted action write-back", async () => {
    const firstA = deferred<InteractiveScript>();
    const loadB = deferred<InteractiveScript>();
    const secondA = deferred<InteractiveScript>();
    mockGetScript.mockReset();
    mockGetScript
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(loadB.promise)
      .mockReturnValueOnce(secondA.promise);
    const view = await render(
      <ScriptDetailOwnerScreen key="owner-a:script-1" ownerId="owner-a" scriptId="script-1" />,
    );
    await waitFor(() => expect(mockGetScript).toHaveBeenCalledTimes(1));
    await view.rerender(
      <ScriptDetailOwnerScreen key="owner-b:script-1" ownerId="owner-b" scriptId="script-1" />,
    );
    await waitFor(() => expect(mockGetScript).toHaveBeenCalledTimes(2));
    await act(async () => {
      loadB.resolve(script("B 当前"));
      await loadB.promise;
    });
    await act(async () => {
      firstA.resolve(script("A 迟到"));
      await firstA.promise;
    });
    expect(view.getByText("B 当前")).toBeTruthy();
    expect(view.queryByText("A 迟到")).toBeNull();

    await view.rerender(
      <ScriptDetailOwnerScreen
        key="owner-a:script-1:again"
        ownerId="owner-a"
        scriptId="script-1"
      />,
    );
    await waitFor(() => expect(mockGetScript).toHaveBeenCalledTimes(3));
    await act(async () => {
      secondA.resolve(script("A 返回"));
      await secondA.promise;
    });
    expect(view.getByText("A 返回")).toBeTruthy();

    rememberScriptForNavigation(script(), "owner-a");
    const lateUpdate = deferred<InteractiveScript>();
    mockUpdateScript.mockReturnValueOnce(lateUpdate.promise);
    await view.rerender(
      <ScriptDetailOwnerScreen
        key="owner-a:script-1:action"
        ownerId="owner-a"
        scriptId="script-1"
      />,
    );
    await fireEvent.press(view.getByText("设为私人"));
    await view.unmount();
    await act(async () => {
      lateUpdate.resolve({ ...script(), visibility: "private" });
      await lateUpdate.promise;
    });
    expect(mockInvalidateScriptCatalog).not.toHaveBeenCalled();
  });

  it("does not cache or navigate when room creation resolves after unmount", async () => {
    rememberScriptForNavigation(script(), "owner-a");
    const creation = deferred<ScriptRoomCreationData>();
    mockCreateRoom.mockReturnValueOnce(creation.promise);
    const view = await render(
      <ScriptDetailOwnerScreen key="owner-a:script-1" ownerId="owner-a" scriptId="script-1" />,
    );
    await fireEvent.press(view.getByLabelText("script-detail-start"));
    await fireEvent.press(view.getByLabelText("script-role-selection-role-1"));
    await fireEvent.press(view.getByLabelText("script-role-selection-start"));
    await view.unmount();

    await act(async () => {
      creation.resolve(roomResult());
      await creation.promise;
    });
    expect(mockSaveCachedScriptRoom).not.toHaveBeenCalled();
    expect(mockInvalidateAgentCatalog).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/script-room-chat" }),
    );
  });

  it("does not invalidate or pop when deletion resolves after unmount", async () => {
    rememberScriptForNavigation(script(), "owner-a");
    const deletion = deferred<void>();
    mockDeleteScript.mockReturnValueOnce(deletion.promise);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const view = await render(
      <ScriptDetailOwnerScreen key="owner-a:script-1" ownerId="owner-a" scriptId="script-1" />,
    );
    await fireEvent.press(view.getByText("删除剧本"));
    await act(async () => {
      alert.mock.calls[0]?.[2]?.find((action) => action.style === "destructive")?.onPress?.();
    });
    expect(mockDeleteScript).toHaveBeenCalledTimes(1);
    await view.unmount();

    await act(async () => {
      deletion.resolve();
      await deletion.promise;
    });
    expect(mockInvalidateScriptCatalog).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});

function script(title = "失落星港"): InteractiveScript {
  return {
    script_id: "script-1",
    title,
    synopsis: "两名船员抵达失联多年的星港。",
    cover_url: "/cover.jpg",
    category_ids: ["science_fiction"],
    visibility: "public",
    status: "ready",
    creator: { user_id: "owner-a", nickname: "作者甲", avatar_url: "" },
    roles: [
      {
        role_id: "role-1",
        name: "林夏",
        gender: "female",
        avatar_url: "/one.jpg",
        description: "工程师",
        sort_order: 0,
      },
      {
        role_id: "role-2",
        name: "陆沉舟",
        gender: "male",
        avatar_url: "/two.jpg",
        description: "领航员",
        sort_order: 1,
      },
    ],
    is_admin_hidden: false,
  };
}

function roomResult(): ScriptRoomCreationData {
  return {
    room: {
      room_id: "room-1",
      script_id: "script-1",
      group_id: 42,
      status: "active",
      player_role_id: "role-1",
      assignments: [],
      script_snapshot: {
        title: "失落星港",
        synopsis: "",
        cover_url: "",
        roles: script().roles,
      },
    },
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
