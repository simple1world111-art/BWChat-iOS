import AsyncStorage from "@react-native-async-storage/async-storage";

import { apiRequest, APIError } from "@/api/client";
import {
  appendRecommendedPage,
  createGameLobbySession,
  GameRepositoryAccountChangedError,
  gameCenterErrorKey,
  loadPlayedGames,
  loadRecommendedGames,
  readCachedGamePage,
  readGamePlayedRevision,
  recordPlayedGame,
  resetGameRepositoryMemoryForTests,
  startGameRound,
} from "@/services/games/GameRepository";
import { gameCenterCachePolicy } from "@/services/games/GameCenterPolicy";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, apiRequest: jest.fn() };
});

const request = jest.mocked(apiRequest);
const wallet = {
  currency: "gold_coin",
  gold_coin_balance: 90,
  activity_cat_food_balance: 10,
  spendable_balance: 100,
  chat_money_frozen_gold_coin_balance: 0,
};
const game = { id: "g/1", name: "Game", poster_url: "https://id7.com/g.png", order: 10 };

describe("GameRepository", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    request.mockReset();
    resetGameRepositoryMemoryForTests();
    await AsyncStorage.clear();
  });

  it("requests the exact recommended/played list routes and keeps fresh account caches", async () => {
    request
      .mockResolvedValueOnce({ items: [game], next_cursor: "cursor/2" })
      .mockResolvedValueOnce({ items: [game] });
    const recommended = await loadRecommendedGames("owner");
    const played = await loadPlayedGames("owner");
    expect(recommended.page.nextCursor).toBe("cursor/2");
    expect(played.page.items).toHaveLength(1);
    expect(request).toHaveBeenNthCalledWith(1, "/games/recommended?limit=50", {
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/games/played?limit=50", {
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
    });

    request.mockClear();
    await expect(loadRecommendedGames("owner")).resolves.toMatchObject({ source: "cache" });
    expect(request).not.toHaveBeenCalled();
  });

  it("never serves one account's game cache to another account", async () => {
    request
      .mockResolvedValueOnce({
        items: [{ ...game, id: "owner-a-game", name: "Owner A" }],
      })
      .mockResolvedValueOnce({
        items: [{ ...game, id: "owner-b-game", name: "Owner B" }],
      });

    await expect(loadRecommendedGames("owner-a")).resolves.toMatchObject({
      page: { items: [{ id: "owner-a-game" }] },
      source: "remote",
    });
    await expect(loadRecommendedGames("owner-b")).resolves.toMatchObject({
      page: { items: [{ id: "owner-b-game" }] },
      source: "remote",
    });
    request.mockClear();
    await expect(loadRecommendedGames("owner-a")).resolves.toMatchObject({
      page: { items: [{ id: "owner-a-game" }] },
      source: "cache",
    });
    await expect(loadRecommendedGames("owner-b")).resolves.toMatchObject({
      page: { items: [{ id: "owner-b-game" }] },
      source: "cache",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("encodes cursors and merges the next recommended page with first-item deduplication", async () => {
    request.mockResolvedValueOnce({
      items: [
        { id: "g/1", name: "changed", poster_url: "https://id7.com/changed.png", order: 1 },
        { id: "g2", name: "Game 2", poster_url: "https://id7.com/g2.png", order: 20 },
      ],
      next_cursor: "cursor-3",
    });
    const page = await appendRecommendedPage(
      "owner",
      {
        items: [{ id: "g/1", name: "Game", posterURL: "https://id7.com/g.png", sortOrder: 10 }],
        nextCursor: "cursor/2",
      },
      "cursor/2",
    );
    expect(request).toHaveBeenCalledWith("/games/recommended?limit=50&cursor=cursor%2F2", {
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
    });
    expect(page.items.map((item) => item.name)).toEqual(["Game", "Game 2"]);
    expect(page.nextCursor).toBe("cursor-3");
  });

  it("creates a payment-free lobby with the exact body and idempotency header", async () => {
    request.mockResolvedValueOnce({
      session_id: "server-session-123456789",
      launch_url: "https://id7.com/api/v1/game-assets/g/index.html",
      expires_at: "2026-08-08T00:00:00Z",
      entry_price_gold_coins: 5,
    });
    await expect(createGameLobbySession("g/1", "lobby-key")).resolves.toMatchObject({
      sessionID: "server-session-123456789",
      entryPriceGoldCoins: 5,
    });
    expect(request).toHaveBeenCalledWith("/games/g%2F1/sessions", {
      method: "POST",
      headers: { "Idempotency-Key": "lobby-key" },
      body: { purpose: "lobby" },
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
      transientRetries: false,
    });
  });

  it("starts one gold-coin round with the bridge UUID as its idempotency key", async () => {
    request.mockResolvedValueOnce({
      round_id: "round-1",
      round_token: "token-1",
      expires_at: "2026-08-08T00:00:00Z",
      payment_method: "gold_coins",
      entry_price_gold_coins: 5,
      wallet_balance: wallet,
    });
    await expect(startGameRound("g/1", "session/a", "round-key")).resolves.toMatchObject({
      roundID: "round-1",
      paymentMethod: "gold_coins",
    });
    expect(request).toHaveBeenCalledWith("/games/g%2F1/sessions/session%2Fa/rounds", {
      method: "POST",
      headers: { "Idempotency-Key": "round-key" },
      body: { payment_method: "gold_coins" },
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
      transientRetries: false,
    });
  });

  it("records a successful round locally at the front and refresh can replace it from server", async () => {
    await recordPlayedGame("owner", {
      id: "g1",
      name: "Game",
      posterURL: "https://id7.com/g.png",
      sortOrder: 10,
    });
    const cached = await loadPlayedGames("owner");
    expect(cached.page.items[0]).toMatchObject({ id: "g1", lastPlayedAt: expect.any(String) });
    request.mockResolvedValueOnce({ items: [] });
    const refreshed = await loadPlayedGames("owner", true);
    expect(refreshed.page.items).toEqual([]);
  });

  it("matches native profile-cache freshness and inclusive 90-day retention boundaries", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    request.mockResolvedValueOnce({ items: [game] });
    await loadRecommendedGames("boundary-owner");

    request.mockResolvedValueOnce({ items: [{ ...game, id: "fresh-boundary" }] });
    jest.spyOn(Date, "now").mockReturnValue(1_000_000 + gameCenterCachePolicy.ttlMilliseconds);
    await expect(loadRecommendedGames("boundary-owner")).resolves.toMatchObject({
      source: "remote",
      page: { items: [{ id: "fresh-boundary" }] },
    });

    request.mockRejectedValueOnce(new Error("offline"));
    jest
      .spyOn(Date, "now")
      .mockReturnValue(
        1_000_000 +
          gameCenterCachePolicy.ttlMilliseconds +
          gameCenterCachePolicy.ttlMilliseconds +
          gameCenterCachePolicy.staleRetentionMilliseconds,
      );
    await expect(loadRecommendedGames("boundary-owner", true)).resolves.toMatchObject({
      source: "stale-cache",
      page: { items: [{ id: "fresh-boundary" }] },
      refreshError: expect.any(Error),
    });

    request.mockRejectedValueOnce(new Error("offline"));
    jest
      .spyOn(Date, "now")
      .mockReturnValue(
        1_000_000 +
          gameCenterCachePolicy.ttlMilliseconds +
          gameCenterCachePolicy.ttlMilliseconds +
          gameCenterCachePolicy.staleRetentionMilliseconds +
          1,
      );
    await expect(loadRecommendedGames("boundary-owner", true)).rejects.toThrow("offline");
    await expect(readCachedGamePage("boundary-owner", "recommended")).resolves.toMatchObject({
      items: [{ id: "fresh-boundary" }],
    });
  });

  it("coalesces same-account first-page refreshes and keeps remote success on cache-write failure", async () => {
    const pending = deferred<unknown>();
    request.mockReturnValueOnce(pending.promise);
    const first = loadRecommendedGames("coalesced-owner", true);
    const second = loadRecommendedGames("coalesced-owner", true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(request).toHaveBeenCalledTimes(1);
    pending.resolve({ items: [game] });
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { source: "remote", page: { items: [{ id: "g/1" }] } },
      { source: "remote", page: { items: [{ id: "g/1" }] } },
    ]);

    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));
    request.mockResolvedValueOnce({ items: [{ ...game, id: "remote-survives" }] });
    await expect(loadPlayedGames("disk-owner", true)).resolves.toMatchObject({
      source: "remote",
      page: { items: [{ id: "remote-survives" }] },
    });
  });

  it("does not persist a late page after its account-generation guard changes", async () => {
    const pending = deferred<unknown>();
    let current = true;
    request.mockReturnValueOnce(pending.promise);
    const load = loadRecommendedGames("old-owner", true, {
      operationKey: "generation-1",
      isCurrent: () => current,
    });
    await Promise.resolve();
    current = false;
    pending.resolve({ items: [game] });

    await expect(load).rejects.toBeInstanceOf(GameRepositoryAccountChangedError);
    await expect(readCachedGamePage("old-owner", "recommended")).resolves.toBeUndefined();
  });

  it("marks a successful round for return refresh even when local played persistence fails", async () => {
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));
    await expect(
      recordPlayedGame("played-owner", {
        id: "g1",
        name: "Game",
        posterURL: "https://id7.com/g.png",
        sortOrder: 1,
      }),
    ).resolves.toBeUndefined();
    expect(readGamePlayedRevision("played-owner")).toBe(1);
    expect(readGamePlayedRevision("another-owner")).toBe(0);
  });

  it("maps native game session failures to localized keys", () => {
    expect(gameCenterErrorKey(new APIError("bad", 400, { code: "INSUFFICIENT_GOLD_COINS" }))).toBe(
      "gameRound.error.insufficientCoins",
    );
    expect(gameCenterErrorKey(new APIError("bad", 409, { code: "idempotency_conflict" }))).toBe(
      "gameRound.error.requestConflict",
    );
    expect(
      gameCenterErrorKey(new APIError("bad", 429, { code: "game_session_rate_limited" })),
    ).toBe("gameRound.error.rateLimited");
    expect(gameCenterErrorKey(new APIError("bad", 404, { code: "game_unavailable" }))).toBe(
      "gameRound.error.gameUnavailable",
    );
  });
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
