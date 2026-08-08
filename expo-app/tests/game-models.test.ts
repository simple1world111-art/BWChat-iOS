import {
  normalizeGameCatalogItem,
  normalizeGameCatalogPage,
  normalizeGameRoundStart,
  normalizeGameSession,
  validateGameLobbySession,
  validateGameRoundStart,
} from "@/services/games/GameModels";

const wallet = {
  currency: "gold_coin",
  gold_coin_balance: 90,
  activity_cat_food_balance: 10,
  spendable_balance: 100,
  recharge_gold_coin_balance: 80,
  gift_income_gold_coin_balance: 10,
  withdraw_frozen_gold_coin_balance: 0,
  withdrawable_gold_coin_balance: 10,
  chat_money_frozen_gold_coin_balance: 0,
};

describe("game response models", () => {
  it("preserves server order, keeps the first duplicate and accepts the legacy price field", () => {
    const page = normalizeGameCatalogPage({
      items: [
        { id: "b", name: "B", poster_url: "https://id7.com/b.png", order: 90, entry_price_cat_coins: "8" },
        { id: "a", name: "A", poster_url: "https://id7.com/a.png", order: 10 },
        { id: "b", name: "changed", poster_url: "https://id7.com/c.png", order: 1 },
      ],
      next_cursor: "next-1",
    });
    expect(page.items.map((item) => item.id)).toEqual(["b", "a"]);
    expect(page.items[0]).toMatchObject({ name: "B", entryPriceGoldCoins: 8, sortOrder: 90 });
    expect(page.nextCursor).toBe("next-1");
  });

  it("requires the same catalog fields as the Codable native model", () => {
    expect(() => normalizeGameCatalogItem({ id: "a", name: "A", order: 1 })).toThrow("游戏海报");
    expect(() => normalizeGameCatalogItem({ id: "a", name: "A", poster_url: "x" })).toThrow("排序");
    expect(() => normalizeGameCatalogItem({ id: "a", name: "A", poster_url: "x", order: 1, entry_price_gold_coins: -1 })).toThrow();
  });

  it("accepts only payment-free positive-price lobby sessions", () => {
    const valid = normalizeGameSession({
      session_id: "session-123456789",
      launch_url: "https://id7.com/api/v1/game-assets/a/index.html",
      expires_at: "2026-08-08T00:00:00Z",
      entry_price_gold_coins: 5,
    });
    expect(() => validateGameLobbySession(valid)).not.toThrow();
    expect(() => validateGameLobbySession({ ...valid, paymentMethod: "gold_coins" })).toThrow("PAYMENT_WAS_APPLIED");
    expect(() => validateGameLobbySession({ ...valid, entryPriceGoldCoins: 0 })).toThrow("INVALID_ENTRY_PRICE");
  });

  it("validates a server-authoritative gold-coin round and consistent spendable balance", () => {
    const round = normalizeGameRoundStart({
      round_id: "round-1",
      round_token: "token-1",
      expires_at: "2026-08-08T00:00:00Z",
      payment_method: "gold_coins",
      entry_price_gold_coins: 5,
      wallet_balance: wallet,
    });
    expect(() => validateGameRoundStart(round)).not.toThrow();
    expect(() => validateGameRoundStart({ ...round, paymentMethod: "cat_food" })).toThrow("PAYMENT_METHOD_MISMATCH");
    expect(() => validateGameRoundStart({
      ...round,
      walletBalance: { ...round.walletBalance, spendable_balance: 99 },
    })).toThrow("INVALID_GRANT");
    expect(() => validateGameRoundStart({
      ...round,
      consumedProp: { definition_id: "ticket", remaining_quantity: 1 },
    })).toThrow("INVALID_CONSUMPTION");
  });
});
