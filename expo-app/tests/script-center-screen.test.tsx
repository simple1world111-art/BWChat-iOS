import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { getScriptCategories, getScripts } from "@/api/bwchat";
import ScriptCenterScreen from "@/app/script-center";
import type { InteractiveScript, ScriptPage, User } from "@/models";
import {
  clearPendingScriptForNavigation,
  pendingScriptForNavigation,
} from "@/services/scripts/ScriptNavigationStore";

let mockUser: User | null = { user_id: "owner-a" } as User;
const mockPush = jest.fn();
const mockLoadCategories = jest.fn();
const mockLoadPage = jest.fn();
const mockSaveCategories = jest.fn();
const mockSavePage = jest.fn();

jest.mock("expo-router", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
    Stack: {
      Screen: ({
        options,
      }: {
        options?: { headerTitle?: () => ReactNode; headerRight?: () => ReactNode };
      }) => (
        <>
          {options?.headerTitle?.()}
          {options?.headerRight?.()}
        </>
      ),
    },
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(callback, [callback]);
    },
  };
});

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

jest.mock("@/api/bwchat", () => ({
  getScriptCategories: jest.fn(),
  getScripts: jest.fn(),
}));

jest.mock("@/components/AuthenticatedImage", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    AuthenticatedImage: () => <MockView accessibilityLabel="authenticated-script-image" />,
  };
});

jest.mock("@/components/SystemSegmentedTabs", () => {
  const {
    Pressable: MockPressable,
    Text: MockText,
    View: MockView,
  } = jest.requireActual("react-native");
  return {
    SystemSegmentedTabs: ({
      items,
      onSelectionChange,
      selection,
    }: {
      items: { title: string; value: "public" | "mine" }[];
      onSelectionChange(value: "public" | "mine"): void;
      selection: "public" | "mine";
    }) => (
      <MockView>
        {items.map((item) => (
          <MockPressable
            accessibilityLabel={`script-center-tab-${item.value}`}
            accessibilityState={{ selected: selection === item.value }}
            key={item.value}
            onPress={() => onSelectionChange(item.value)}
          >
            <MockText>{item.title}</MockText>
          </MockPressable>
        ))}
      </MockView>
    ),
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    selectedLanguage: "system",
    t: (key: string) => (key === "common.back" ? "返回" : key),
  }),
}));

jest.mock("@/services/scripts/ScriptCatalogRepository", () => ({
  loadCachedScriptCategories: (...args: unknown[]) => mockLoadCategories(...args),
  loadCachedScriptPage: (...args: unknown[]) => mockLoadPage(...args),
  saveCachedScriptCategories: (...args: unknown[]) => mockSaveCategories(...args),
  saveCachedScriptPage: (...args: unknown[]) => mockSavePage(...args),
  scriptCatalogGeneration: jest.fn(() => 0),
  subscribeScriptLibraryChanges: jest.fn(() => () => undefined),
}));

const mockGetCategories = jest.mocked(getScriptCategories);
const mockGetScripts = jest.mocked(getScripts);

describe("Script Center screen interactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { user_id: "owner-a" } as User;
    mockLoadCategories.mockResolvedValue(null);
    mockLoadPage.mockResolvedValue(null);
    mockSaveCategories.mockResolvedValue(undefined);
    mockSavePage.mockResolvedValue(undefined);
    mockGetCategories.mockResolvedValue([
      { id: "mystery", name: "悬疑", icon_url: "", sort_order: 1 },
    ]);
    mockGetScripts.mockResolvedValue(page([script("public-one", "公开一号")]));
  });

  afterEach(() => {
    cleanup();
    clearPendingScriptForNavigation("public-one", "owner-a");
    clearPendingScriptForNavigation("mine-one", "owner-a");
  });

  it("switches public/mine/category with exact queries and opens create/detail routes", async () => {
    mockGetScripts
      .mockResolvedValueOnce(page([script("public-one", "公开一号")]))
      .mockResolvedValueOnce(page([script("mine-one", "我的一号", "private")]))
      .mockResolvedValueOnce(page([script("mine-filtered", "悬疑私稿", "private")]));
    const view = await render(<ScriptCenterScreen />);

    await waitFor(() => expect(view.getByText("公开一号")).toBeTruthy());
    await fireEvent.press(view.getByLabelText("创建剧本"));
    expect(mockPush).toHaveBeenCalledWith("/script-editor");

    await fireEvent.press(view.getByText("公开一号"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/script-detail",
      params: { scriptId: "public-one" },
    });
    expect(pendingScriptForNavigation("public-one", "owner-a")?.title).toBe("公开一号");

    await fireEvent.press(view.getByLabelText("script-center-tab-mine"));
    await waitFor(() => expect(view.getByText("我的一号")).toBeTruthy());
    await fireEvent.press(view.getByText("悬疑"));
    await waitFor(() => expect(view.getByText("悬疑私稿")).toBeTruthy());

    expect(mockGetScripts.mock.calls).toEqual([
      ["public", { limit: 20 }],
      ["mine", { limit: 20 }],
      ["mine", { categoryId: "mystery", limit: 20 }],
    ]);
  });

  it("shows the native error state and retries categories plus the selected page", async () => {
    mockGetScripts
      .mockRejectedValueOnce(new Error("网络离线"))
      .mockResolvedValueOnce(page([script("recovered", "恢复成功")]));
    const view = await render(<ScriptCenterScreen />);

    await waitFor(() => expect(view.getByText("无法加载公开剧本")).toBeTruthy());
    expect(view.getByText("网络离线")).toBeTruthy();
    expect(view.getByTestId("script-center-list").props.refreshControl).toBeUndefined();
    await fireEvent.press(view.getByText("重试"));

    await waitFor(() => expect(view.getByText("恢复成功")).toBeTruthy());
    expect(mockGetCategories).toHaveBeenCalledTimes(2);
    expect(mockGetScripts).toHaveBeenCalledTimes(2);
  });

  it("invalidates the public request synchronously when Mine is selected", async () => {
    const publicPage = deferred<ScriptPage>();
    mockGetScripts
      .mockReturnValueOnce(publicPage.promise)
      .mockResolvedValueOnce(page([script("mine-current", "Mine 当前", "private")]));
    const view = await render(<ScriptCenterScreen />);
    await waitFor(() => expect(mockGetScripts).toHaveBeenCalledTimes(1));

    await fireEvent.press(view.getByLabelText("script-center-tab-mine"));
    expect(view.queryByText("Public 迟到")).toBeNull();
    expect(mockGetScripts).toHaveBeenCalledTimes(1);

    await act(async () => {
      publicPage.resolve(page([script("public-late", "Public 迟到")]));
      await publicPage.promise;
    });
    await waitFor(() => expect(view.getByText("Mine 当前")).toBeTruthy());
    expect(view.queryByText("Public 迟到")).toBeNull();
    expect(view.getByText("Mine 当前")).toBeTruthy();
  });

  it("clears old-scope cards immediately and exposes native button semantics", async () => {
    const minePage = deferred<ScriptPage>();
    mockGetScripts
      .mockResolvedValueOnce(page([script("public-one", "公开一号")]))
      .mockReturnValueOnce(minePage.promise);
    const view = await render(<ScriptCenterScreen />);
    await waitFor(() => expect(view.getByText("公开一号")).toBeTruthy());

    expect(view.getByLabelText("创建剧本").props.accessibilityRole).toBe("button");
    expect(view.getByLabelText("全部").props).toMatchObject({
      accessibilityRole: "button",
      accessibilityState: { selected: true },
    });
    expect(view.getByLabelText(/公开一号/u).props.accessibilityRole).toBe("button");

    await fireEvent.press(view.getByLabelText("script-center-tab-mine"));
    expect(view.queryByText("公开一号")).toBeNull();
    expect(view.getByTestId("script-center-list").props.refreshControl).toBeUndefined();

    await act(async () => {
      minePage.resolve(page([script("mine-one", "我的一号", "private")]));
      await minePage.promise;
    });
    await waitFor(() => expect(view.getByText("我的一号")).toBeTruthy());
  });

  it("shows the refresh control only for an explicit pull refresh", async () => {
    const refreshed = deferred<ScriptPage>();
    const view = await render(<ScriptCenterScreen />);
    await waitFor(() => expect(view.getByText("公开一号")).toBeTruthy());
    mockGetScripts.mockReturnValueOnce(refreshed.promise);

    const refreshControl = view.getByTestId("script-center-list").props.refreshControl;
    expect(refreshControl.props.refreshing).toBe(false);
    await act(async () => {
      refreshControl.props.onRefresh();
      await Promise.resolve();
    });
    expect(view.getByTestId("script-center-list").props.refreshControl.props.refreshing).toBe(true);

    await act(async () => {
      refreshed.resolve(page([script("refreshed", "刷新完成")]));
      await refreshed.promise;
    });
    await waitFor(() => expect(view.getByText("刷新完成")).toBeTruthy());
    expect(view.getByTestId("script-center-list").props.refreshControl.props.refreshing).toBe(
      false,
    );
  });

  it("keeps retained cache quiet when its automatic refresh fails", async () => {
    mockLoadPage.mockResolvedValue({
      value: page([script("cached", "缓存剧本")]),
      updatedAt: 1,
      expiresAt: 2,
      isStale: true,
    });
    mockGetScripts.mockRejectedValue(new Error("后台刷新失败"));
    const view = await render(<ScriptCenterScreen />);

    await waitFor(() => expect(view.getByText("缓存剧本")).toBeTruthy());
    expect(view.queryByText("后台刷新失败")).toBeNull();
    expect(view.queryByText("无法加载公开剧本")).toBeNull();
    expect(view.getByTestId("script-center-list").props.refreshControl.props.refreshing).toBe(
      false,
    );
  });

  it("falls back a removed category to All without issuing a duplicate page request", async () => {
    mockGetScripts
      .mockResolvedValueOnce(page([script("public-one", "公开一号")]))
      .mockResolvedValueOnce(page([script("filtered", "悬疑剧本")]))
      .mockResolvedValueOnce(page([script("all-again", "全部剧本")]))
      .mockResolvedValueOnce(page([script("duplicate", "不应重复")]))
      .mockResolvedValueOnce(page([script("duplicate", "不应重复")]))
      .mockResolvedValueOnce(page([script("duplicate", "不应重复")]));
    const view = await render(<ScriptCenterScreen />);
    await waitFor(() => expect(view.getByText("公开一号")).toBeTruthy());
    await fireEvent.press(view.getByText("悬疑"));
    await waitFor(() => expect(view.getByText("悬疑剧本")).toBeTruthy());

    mockGetCategories.mockResolvedValueOnce([]);
    await act(async () => {
      view.getByTestId("script-center-list").props.refreshControl.props.onRefresh();
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("全部剧本")).toBeTruthy());
    await act(async () => Promise.resolve());

    expect(mockGetScripts).toHaveBeenCalledTimes(3);
    expect(view.getByLabelText("全部").props.accessibilityState).toEqual({ selected: true });
    expect(view.queryByText("不应重复")).toBeNull();
  });
});

function script(
  id: string,
  title: string,
  visibility: InteractiveScript["visibility"] = "public",
): InteractiveScript {
  return {
    script_id: id,
    title,
    synopsis: "剧情简介",
    cover_url: "",
    category_ids: [],
    visibility,
    status: "ready",
    creator: { user_id: "creator", nickname: "作者", avatar_url: "" },
    roles: [],
    is_admin_hidden: false,
  };
}

function page(scripts: InteractiveScript[], hasMore = false, cursor?: string): ScriptPage {
  return {
    scripts,
    has_more: hasMore,
    ...(cursor ? { next_cursor: cursor } : {}),
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
