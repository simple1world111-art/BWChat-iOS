import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

import DynamicScreenPage from "@/app/dynamic-screen/[id]";
import type { DynamicScreen } from "@/services/dynamic-screen/DynamicScreenModels";

const mockSetOptions = jest.fn();
const mockEmbeddedDynamicScreen = jest.fn<DynamicScreen | null, [string, unknown]>();
const mockReadCachedDynamicScreen = jest.fn();
const mockFetchDynamicScreen = jest.fn();
const mockPersistDynamicScreen = jest.fn<Promise<void>, unknown[]>();
const mockPersistDynamicScreenETag = jest.fn<Promise<void>, unknown[]>();
const mockOpenDynamicRoute = jest.fn();
const mockTranslate = (key: string) => key;
let mockOwnerId = "owner-a";
let mockScreenId = "screen";

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const MockPressable = actual.Pressable;
  const MockRefreshControl = ({
    accessibilityLabel,
    onRefresh,
    refreshing,
  }: {
    accessibilityLabel?: string;
    onRefresh: () => void;
    refreshing: boolean;
  }) => (
    <MockPressable
      accessibilityLabel={accessibilityLabel ?? "dynamic-screen-refresh-control"}
      accessibilityState={{ busy: refreshing }}
      onPress={onRefresh}
    />
  );
  return new Proxy(actual, {
    get(target, property, receiver) {
      return property === "RefreshControl"
        ? MockRefreshControl
        : Reflect.get(target, property, receiver);
    },
  });
});

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: mockScreenId }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@/components/dynamic-screen/DynamicComponentRenderer", () => ({
  DynamicComponentRenderer: ({
    component,
    onRoute,
  }: {
    component: { action?: unknown; id: string; props: { text?: unknown } };
    onRoute: (route: unknown) => void;
  }) => {
    const { Pressable: MockPressable, Text: MockText } = jest.requireActual("react-native");
    return (
      <MockPressable
        accessibilityLabel={`component:${component.id}`}
        onPress={() => onRoute(component.action)}
      >
        <MockText>{String(component.props.text ?? component.id)}</MockText>
      </MockPressable>
    );
  },
}));

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockOwnerId ? { user_id: mockOwnerId } : null }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    activeLanguage: "en",
    t: mockTranslate,
  }),
}));

jest.mock("@/providers/RemoteConfigProvider", () => ({
  useRemoteConfig: () => ({ config: { screens: [], webViewPolicy: {} } }),
}));

jest.mock("@/services/dynamic-screen/DynamicScreenRepository", () => ({
  embeddedDynamicScreen: (...args: [string, unknown]) => mockEmbeddedDynamicScreen(...args),
  fetchDynamicScreen: (...args: unknown[]) => mockFetchDynamicScreen(...args),
  persistDynamicScreen: (...args: unknown[]) => mockPersistDynamicScreen(...args),
  persistDynamicScreenETag: (...args: unknown[]) => mockPersistDynamicScreenETag(...args),
  readCachedDynamicScreen: (...args: unknown[]) => mockReadCachedDynamicScreen(...args),
}));

jest.mock("@/services/web/DynamicRouteNavigator", () => ({
  openDynamicRoute: (...args: unknown[]) => mockOpenDynamicRoute(...args),
}));

describe("DynamicScreen page lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOwnerId = "owner-a";
    mockScreenId = "screen";
    mockEmbeddedDynamicScreen.mockReturnValue(null);
    mockReadCachedDynamicScreen.mockResolvedValue({ screen: null, etag: null });
    mockFetchDynamicScreen.mockResolvedValue({ screen: null, etag: null, notModified: true });
    mockPersistDynamicScreen.mockResolvedValue();
    mockPersistDynamicScreenETag.mockResolvedValue();
    mockOpenDynamicRoute.mockResolvedValue({ handled: true });
  });

  it("ignores the old account's late response and never persists it into the new identity", async () => {
    const oldRequest = deferred<{ screen: DynamicScreen; etag: string; notModified: false }>();
    mockFetchDynamicScreen.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce({
      screen: screen("new", "New account"),
      etag: '"new"',
      notModified: false,
    });
    const view = await render(<DynamicScreenPage />);
    await waitFor(() => expect(mockFetchDynamicScreen).toHaveBeenCalledTimes(1));

    mockOwnerId = "owner-b";
    await view.rerender(<DynamicScreenPage />);
    await waitFor(() => expect(view.getByText("New account")).toBeTruthy());

    await act(async () => {
      oldRequest.resolve({
        screen: screen("old", "Old account"),
        etag: '"old"',
        notModified: false,
      });
      await oldRequest.promise;
    });
    expect(view.queryByText("Old account")).toBeNull();
    expect(mockPersistDynamicScreen).not.toHaveBeenCalledWith(
      "owner-a",
      "screen",
      expect.objectContaining({ screenId: "old" }),
      '"old"',
    );
  });

  it("treats even normalized-equivalent raw screen IDs as separate request identities", async () => {
    mockScreenId = "daily-rewards";
    const oldRequest = deferred<{ screen: DynamicScreen; etag: string; notModified: false }>();
    mockFetchDynamicScreen.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce({
      screen: screen("new", "Underscore route"),
      etag: '"new"',
      notModified: false,
    });
    const view = await render(<DynamicScreenPage />);
    await waitFor(() => expect(mockFetchDynamicScreen).toHaveBeenCalledWith("daily-rewards", null));

    mockScreenId = "daily_rewards";
    await view.rerender(<DynamicScreenPage />);
    await waitFor(() => expect(view.getByText("Underscore route")).toBeTruthy());

    await act(async () => {
      oldRequest.resolve({
        screen: screen("old", "Hyphen route"),
        etag: '"old"',
        notModified: false,
      });
      await oldRequest.promise;
    });
    expect(view.queryByText("Hyphen route")).toBeNull();
    expect(mockFetchDynamicScreen).toHaveBeenCalledWith("daily_rewards", null);
  });

  it("coalesces pull-to-refresh with the in-flight initial load", async () => {
    const request = deferred<{ screen: DynamicScreen; etag: null; notModified: false }>();
    mockEmbeddedDynamicScreen.mockReturnValue(screen("embedded", "Embedded"));
    mockFetchDynamicScreen.mockReturnValue(request.promise);
    const view = await render(<DynamicScreenPage />);
    await waitFor(() => expect(mockFetchDynamicScreen).toHaveBeenCalledTimes(1));

    const refreshControl = view.getByLabelText("dynamic-screen-refresh-control");
    await act(async () => fireEvent.press(refreshControl));
    expect(mockFetchDynamicScreen).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.resolve({ screen: screen("remote", "Remote"), etag: null, notModified: false });
      await request.promise;
    });
    await waitFor(() => expect(view.getByText("Remote")).toBeTruthy());
  });

  it("does not overwrite the cached ETag when a 304 omits its replacement header", async () => {
    mockEmbeddedDynamicScreen.mockReturnValue(screen("embedded", "Embedded"));
    mockReadCachedDynamicScreen.mockResolvedValue({
      screen: null,
      etag: '"cached"',
    });
    mockFetchDynamicScreen.mockResolvedValue({ screen: null, etag: null, notModified: true });
    await render(<DynamicScreenPage />);

    await waitFor(() => expect(mockFetchDynamicScreen).toHaveBeenCalledWith("screen", '"cached"'));
    expect(mockPersistDynamicScreenETag).not.toHaveBeenCalled();
  });

  it("keeps the cached remote legal document when its bundled fallback receives 304", async () => {
    mockEmbeddedDynamicScreen.mockReturnValue(screen("screen", "Bundled fallback"));
    mockReadCachedDynamicScreen.mockResolvedValue({
      screen: screen("screen", "Cached legal document"),
      etag: '"legal-v4"',
    });
    mockFetchDynamicScreen.mockResolvedValue({ screen: null, etag: null, notModified: true });

    const view = await render(<DynamicScreenPage />);

    await waitFor(() => expect(view.getByText("Cached legal document")).toBeTruthy());
    expect(view.queryByText("Bundled fallback")).toBeNull();
    expect(mockFetchDynamicScreen).toHaveBeenCalledWith("screen", '"legal-v4"');
  });

  it("keeps the bundled legal document when cache and server contain placeholders", async () => {
    mockScreenId = "privacy_policy";
    mockEmbeddedDynamicScreen.mockReturnValue(screen("privacy_policy", "Bundled complete policy"));
    mockReadCachedDynamicScreen.mockResolvedValue({
      screen: screen("privacy_policy", "Cached placeholder"),
      etag: '"placeholder-v1"',
    });
    mockFetchDynamicScreen.mockResolvedValue({
      screen: screen("privacy_policy", "Remote placeholder"),
      etag: '"placeholder-v1"',
      notModified: false,
    });

    const view = await render(<DynamicScreenPage />);

    await waitFor(() => expect(mockFetchDynamicScreen).toHaveBeenCalledTimes(1));
    expect(view.getByText("Bundled complete policy")).toBeTruthy();
    expect(view.queryByText("Cached placeholder")).toBeNull();
    expect(view.queryByText("Remote placeholder")).toBeNull();
    expect(mockPersistDynamicScreen).not.toHaveBeenCalled();
  });

  it("suppresses a late route alert after unmount", async () => {
    const outcome = deferred<{ handled: false; title: string; message: string }>();
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    mockEmbeddedDynamicScreen.mockReturnValue(screen("embedded", "Tap", { type: "coming_soon" }));
    mockOpenDynamicRoute.mockReturnValue(outcome.promise);
    const view = await render(<DynamicScreenPage />);
    await waitFor(() => expect(view.getByText("Tap")).toBeTruthy());

    await act(async () => fireEvent.press(view.getByLabelText("component:embedded-component")));
    await view.unmount();
    await act(async () => {
      outcome.resolve({ handled: false, title: "Late", message: "Late message" });
      await outcome.promise;
    });
    expect(alert).not.toHaveBeenCalled();
  });
});

function screen(id: string, copy: string, action?: { type: string }): DynamicScreen {
  return {
    screenId: id,
    components: [
      {
        id: `${id}-component`,
        type: "text",
        props: { text: copy },
        ...(action ? { action } : {}),
      },
    ],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
