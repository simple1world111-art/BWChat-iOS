import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { getScriptCategories, getScripts } from "@/api/bwchat";
import ScriptCenterScreen from "@/app/script-center";
import type { InteractiveScript, ScriptPage, User } from "@/models";

let mockUser: User | null = { user_id: "owner-a" } as User;
const mockLoadCategories = jest.fn();
const mockLoadPage = jest.fn();
const mockSaveCategories = jest.fn();
const mockSavePage = jest.fn();

jest.mock("expo-router", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");
  return {
    router: { push: jest.fn() },
    Stack: { Screen: () => null },
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
  return { AuthenticatedImage: () => <MockView /> };
});

jest.mock("@/components/SystemSegmentedTabs", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { SystemSegmentedTabs: () => <MockView /> };
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

describe("Script Center lifecycle isolation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { user_id: "owner-a" } as User;
    mockLoadCategories.mockResolvedValue(null);
    mockLoadPage.mockResolvedValue(null);
    mockSaveCategories.mockResolvedValue(undefined);
    mockSavePage.mockResolvedValue(undefined);
    mockGetCategories.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it("ignores an old owner's late categories after the owner-keyed screen unmounts", async () => {
    const oldCategories =
      deferred<{ id: string; name: string; icon_url: string; sort_order: number }[]>();
    mockGetCategories
      .mockReturnValueOnce(oldCategories.promise)
      .mockResolvedValueOnce([{ id: "b", name: "B 分类", icon_url: "", sort_order: 1 }]);
    mockGetScripts.mockResolvedValueOnce(page([script("b-one", "B 剧本")]));
    const view = await render(<ScriptCenterScreen />);
    await waitFor(() => expect(mockGetCategories).toHaveBeenCalledTimes(1));

    mockUser = { user_id: "owner-b" } as User;
    await act(async () => {
      view.rerender(<ScriptCenterScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("B 剧本")).toBeTruthy());

    await act(async () => {
      oldCategories.resolve([{ id: "a", name: "A 迟到分类", icon_url: "", sort_order: 1 }]);
      await oldCategories.promise;
    });
    expect(view.queryByText("A 迟到分类")).toBeNull();
    expect(view.getByText("B 分类")).toBeTruthy();
    expect(mockGetScripts).toHaveBeenCalledTimes(1);
  });

  it("does not revive the first A page after an A to B to A sequence", async () => {
    const firstA = deferred<ScriptPage>();
    mockGetScripts
      .mockReturnValueOnce(firstA.promise)
      .mockResolvedValueOnce(page([script("b", "B 当前")]))
      .mockResolvedValueOnce(page([script("a-new", "A 新页面")]));
    const view = await render(<ScriptCenterScreen />);
    await waitFor(() => expect(mockGetScripts).toHaveBeenCalledTimes(1));

    mockUser = { user_id: "owner-b" } as User;
    await act(async () => {
      view.rerender(<ScriptCenterScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("B 当前")).toBeTruthy());

    mockUser = { user_id: "owner-a" } as User;
    await act(async () => {
      view.rerender(<ScriptCenterScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("A 新页面")).toBeTruthy());

    await act(async () => {
      firstA.resolve(page([script("a-old", "A 旧迟到页面")]));
      await firstA.promise;
    });
    expect(view.queryByText("A 旧迟到页面")).toBeNull();
    expect(view.getByText("A 新页面")).toBeTruthy();
  });

  it("locks duplicate pagination and ignores its late completion after an owner change", async () => {
    const oldMore = deferred<ScriptPage>();
    mockGetScripts
      .mockResolvedValueOnce(page([script("a-first", "A 首屏")], true, "cursor-a"))
      .mockReturnValueOnce(oldMore.promise)
      .mockResolvedValueOnce(page([script("b-first", "B 首屏")]));
    const view = await render(<ScriptCenterScreen />);
    await waitFor(() => expect(view.getByText("A 首屏")).toBeTruthy());

    const list = view.getByTestId("script-center-list");
    await act(async () => {
      list.props.onEndReached();
      list.props.onEndReached();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockGetScripts).toHaveBeenCalledTimes(2));
    expect(mockGetScripts).toHaveBeenLastCalledWith("public", {
      cursor: "cursor-a",
      limit: 20,
    });

    mockUser = { user_id: "owner-b" } as User;
    await act(async () => {
      view.rerender(<ScriptCenterScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("B 首屏")).toBeTruthy());

    await act(async () => {
      oldMore.resolve(page([script("a-more", "A 迟到分页")]));
      await oldMore.promise;
    });
    expect(view.queryByText("A 迟到分页")).toBeNull();
    expect(view.getByText("B 首屏")).toBeTruthy();
    expect(mockGetScripts).toHaveBeenCalledTimes(3);
  });
});

function script(id: string, title: string): InteractiveScript {
  return {
    script_id: id,
    title,
    synopsis: "剧情简介",
    cover_url: "",
    category_ids: [],
    visibility: "public",
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
