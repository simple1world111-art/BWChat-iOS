import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import GameCenterScreen from "@/app/game-center";
import type { User } from "@/models";
import {
  appendRecommendedPage,
  createGameLobbySession,
  loadPlayedGames,
  loadRecommendedGames,
  readCachedGamePage,
} from "@/services/games/GameRepository";
import type { GameCatalogItem, GameCatalogPage } from "@/services/games/GameModels";

let mockAuthUser: User | null = { user_id: "owner-a" } as User;
let mockFocusCallback: (() => void | (() => void)) | undefined;
let mockPlayedRevision = 0;

jest.mock("expo-router", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");
  return {
    router: { push: jest.fn() },
    Stack: {
      Screen: ({ options }: { options: { headerTitle?: () => React.ReactNode } }) =>
        options.headerTitle?.() ?? null,
    },
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocusCallback = callback;
      ReactModule.useEffect(callback, [callback]);
    },
  };
});

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@/components/games/GamePoster", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { GamePoster: ({ url }: { url: string }) => <MockText>{`poster:${url}`}</MockText> };
});

jest.mock("@/components/games/GameWebViewPrewarmer", () => ({
  GameWebViewPrewarmer: () => null,
}));

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
    }: {
      items: { value: string; title: string }[];
      onSelectionChange(value: string): void;
    }) => (
      <MockView>
        {items.map((item) => (
          <MockPressable key={item.value} onPress={() => onSelectionChange(item.value)}>
            <MockText>{item.title}</MockText>
          </MockPressable>
        ))}
      </MockView>
    ),
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockAuthUser }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

jest.mock("@/providers/RemoteConfigProvider", () => ({
  useRemoteConfig: () => ({
    config: {
      wallet: undefined,
      webViewPolicy: {
        allowedDomains: ["id7.com"],
        blockedDomains: [],
        allowedBridgeMethods: ["close", "openRoute", "getAppInfo", "setNavigationTitle"],
        externalDomainsOpenInSafari: true,
        requireHTTPS: true,
      },
    },
  }),
}));

jest.mock("@/services/games/GameRepository", () => ({
  appendRecommendedPage: jest.fn(),
  createGameLobbySession: jest.fn(),
  gameCenterErrorKey: jest.fn(() => "gameCenter.sessionFailed"),
  loadPlayedGames: jest.fn(),
  loadRecommendedGames: jest.fn(),
  readCachedGamePage: jest.fn(),
  readGamePlayedRevision: jest.fn(() => mockPlayedRevision),
}));

jest.mock("@/services/games/GameRewardedAdService", () => ({
  gameRewardedAdUnitAllowlist: jest.fn(() => []),
  prepareGameRewardedAds: jest.fn(async () => true),
}));

jest.mock("@/api/bwchat", () => ({ createIdempotencyKey: jest.fn(() => "lobby-key") }));

const mockAppendRecommended = jest.mocked(appendRecommendedPage);
const mockCreateLobby = jest.mocked(createGameLobbySession);
const mockLoadPlayed = jest.mocked(loadPlayedGames);
const mockLoadRecommended = jest.mocked(loadRecommendedGames);
const mockReadCached = jest.mocked(readCachedGamePage);

const recommendedGame = game("recommended", "Recommended");
const playedGame = game("played", "Played");

describe("GameCenter screen state machine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { user_id: "owner-a" } as User;
    mockFocusCallback = undefined;
    mockPlayedRevision = 0;
    mockReadCached.mockResolvedValue(undefined);
    mockLoadRecommended.mockResolvedValue(remotePage([recommendedGame]));
    mockLoadPlayed.mockResolvedValue(remotePage([playedGame]));
    mockAppendRecommended.mockResolvedValue({ items: [recommendedGame] });
    mockCreateLobby.mockResolvedValue({
      sessionID: "session-123456789",
      launchURL: "https://id7.com/api/v1/game-assets/recommended/index.html",
      expiresAt: "2026-08-08T00:00:00Z",
      entryPriceGoldCoins: 5,
    });
  });

  afterEach(() => cleanup());

  it("loads both native tabs together and switches without a second played request", async () => {
    const view = await render(<GameCenterScreen />);
    await waitFor(() => expect(view.getByText("Recommended")).toBeTruthy());
    expect(mockLoadRecommended).toHaveBeenCalledWith(
      "owner-a",
      false,
      expect.objectContaining({ operationKey: "0", isCurrent: expect.any(Function) }),
    );
    expect(mockLoadPlayed).toHaveBeenCalledWith(
      "owner-a",
      false,
      expect.objectContaining({ operationKey: "0", isCurrent: expect.any(Function) }),
    );

    await fireEvent.press(view.getByText("gameCenter.tab.played"));
    expect(view.getByText("Played")).toBeTruthy();
    expect(mockLoadPlayed).toHaveBeenCalledTimes(1);
  });

  it("seeds an arbitrarily old native-style snapshot before a failed refresh", async () => {
    const pending = deferred<ReturnType<typeof remotePage>>();
    const cached = game("cached", "Cached");
    mockReadCached.mockImplementation(async (_ownerId, kind) =>
      kind === "recommended" ? { items: [cached] } : undefined,
    );
    mockLoadRecommended.mockReturnValueOnce(pending.promise);
    const view = await render(<GameCenterScreen />);

    await waitFor(() => expect(view.getByText("Cached")).toBeTruthy());
    await act(async () => {
      pending.reject(new Error("offline"));
      await pending.promise.catch(() => undefined);
    });
    expect(view.getByText("Cached")).toBeTruthy();
    expect(view.queryByText("gameCenter.loadFailed")).toBeNull();
  });

  it("refreshes played only after a successful-round revision is observed on return", async () => {
    const view = await render(<GameCenterScreen />);
    await waitFor(() => expect(view.getByText("Recommended")).toBeTruthy());
    mockLoadPlayed.mockClear();

    await invokeFocus();
    expect(mockLoadPlayed).not.toHaveBeenCalled();

    mockPlayedRevision = 1;
    await invokeFocus();
    await waitFor(() =>
      expect(mockLoadPlayed).toHaveBeenCalledWith("owner-a", true, expect.anything()),
    );
  });

  it("does not treat a valid lobby launch by itself as a played-game completion", async () => {
    const view = await render(<GameCenterScreen />);
    await waitFor(() => expect(view.getByText("Recommended")).toBeTruthy());
    mockLoadPlayed.mockClear();

    await fireEvent.press(view.getByText("Recommended"));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/in-app-web",
        params: expect.objectContaining({
          gameID: "recommended",
          ownerID: "owner-a",
          sessionID: "session-123456789",
          restrictToInitialOrigin: "true",
        }),
      }),
    );
    await invokeFocus();
    expect(mockLoadPlayed).not.toHaveBeenCalled();
  });

  it("shares the launch and pagination locks across overlapping presses/events", async () => {
    const lobby = deferred<Awaited<ReturnType<typeof createGameLobbySession>>>();
    const next = deferred<GameCatalogPage>();
    const pageItems = [
      recommendedGame,
      game("recommended-2", "Recommended 2"),
      game("recommended-3", "Recommended 3"),
      game("recommended-4", "Recommended 4"),
      game("recommended-5", "Recommended 5"),
      game("recommended-6", "Recommended 6"),
    ];
    mockLoadRecommended.mockResolvedValueOnce(remotePage(pageItems, "cursor-2"));
    mockCreateLobby.mockReturnValueOnce(lobby.promise);
    mockAppendRecommended.mockReturnValueOnce(next.promise);
    const view = await render(<GameCenterScreen />);
    await waitFor(() => expect(view.getByText("Recommended")).toBeTruthy());

    await fireEvent.press(view.getByText("Recommended"));
    await fireEvent.press(view.getByText("Recommended"));
    expect(mockCreateLobby).toHaveBeenCalledTimes(1);

    await fireCatalogScroll(view.getByTestId("game-center-list"), 0);
    expect(mockAppendRecommended).not.toHaveBeenCalled();
    await fireCatalogScroll(view.getByTestId("game-center-list"), 500);
    await fireCatalogScroll(view.getByTestId("game-center-list"), 500);
    expect(mockAppendRecommended).toHaveBeenCalledTimes(1);

    await act(async () => {
      lobby.resolve({
        sessionID: "session-123456789",
        launchURL: "https://id7.com/api/v1/game-assets/recommended/index.html",
        expiresAt: "2026-08-08T00:00:00Z",
        entryPriceGoldCoins: 5,
      });
      next.resolve({ items: [recommendedGame, game("next", "Next")] });
      await Promise.all([lobby.promise, next.promise]);
    });
    await waitFor(() => expect(view.getByText("Next")).toBeTruthy());
  });
});

async function invokeFocus(): Promise<void> {
  await act(async () => {
    mockFocusCallback?.();
    await Promise.resolve();
  });
}

async function fireCatalogScroll(
  list: Awaited<ReturnType<typeof render>>["container"],
  offsetY: number,
): Promise<void> {
  await fireEvent.scroll(list, {
    nativeEvent: {
      contentOffset: { x: 0, y: offsetY },
      contentSize: { height: 1_000, width: 390 },
      layoutMeasurement: { height: 300, width: 390 },
    },
  });
}

function remotePage(items: GameCatalogItem[], nextCursor?: string) {
  return {
    page: { items, ...(nextCursor ? { nextCursor } : {}) },
    source: "remote" as const,
  };
}

function game(id: string, name: string): GameCatalogItem {
  return {
    id,
    name,
    posterURL: `https://id7.com/api/v1/game-assets/${id}/poster.png`,
    summary: `${name} summary`,
    gameType: "casual",
    entryPriceGoldCoins: 5,
    sortOrder: 1,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
