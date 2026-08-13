import AsyncStorage from "@react-native-async-storage/async-storage";
import { waitFor } from "@testing-library/react-native";

import { getWalletBalance, getWalletTransactionPage } from "@/api/bwchat";
import type { WalletBalanceSnapshot, WalletTransaction, WalletTransactionPage } from "@/models";
import {
  loadMoreWalletTransactions,
  loadWalletBalance,
  loadWalletTransactions,
  readCachedWalletBalance,
  readCachedWalletTransactions,
  resetWalletRepositoryMemoryForTests,
  WalletRepositoryAccountChangedError,
} from "@/services/wallet/WalletRepository";
import { walletMetrics } from "@/services/wallet/walletPolicy";

jest.mock("@/api/bwchat", () => ({
  getWalletBalance: jest.fn(),
  getWalletTransactionPage: jest.fn(),
}));

jest.mock("@/services/messages/ChatGiftRepository", () => ({
  cacheGiftWalletBalance: jest.fn().mockResolvedValue(undefined),
}));

const fetchBalance = jest.mocked(getWalletBalance);
const fetchTransactions = jest.mocked(getWalletTransactionPage);
const now = Date.parse("2026-08-08T12:00:00.000Z");

describe("native wallet cache and pagination state machine", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetWalletRepositoryMemoryForTests();
    await AsyncStorage.clear();
    jest.spyOn(Date, "now").mockReturnValue(now);
  });

  afterEach(() => jest.restoreAllMocks());

  it("uses strict freshness and inclusive thirty-day stale retention", async () => {
    await saveEnvelope("bwchat.wallet.balance.v2:fresh", balance(10), now - 29_999);
    expect(await loadWalletBalance("fresh")).toMatchObject({ source: "cache", value: balance(10) });
    expect(fetchBalance).not.toHaveBeenCalled();

    const networkError = new Error("offline");
    fetchBalance.mockRejectedValue(networkError);
    await saveEnvelope("bwchat.wallet.balance.v2:boundary", balance(20), now - 30_000);
    expect(await loadWalletBalance("boundary")).toMatchObject({
      source: "stale-cache",
      value: balance(20),
      refreshError: networkError,
    });

    await saveEnvelope(
      "bwchat.wallet.balance.v2:last-retained",
      balance(30),
      now - walletMetrics.balanceCacheTtlMs - walletMetrics.staleRetentionMs,
    );
    await expect(loadWalletBalance("last-retained")).resolves.toMatchObject({
      source: "stale-cache",
      value: balance(30),
    });

    await saveEnvelope(
      "bwchat.wallet.balance.v2:expired",
      balance(40),
      now - walletMetrics.balanceCacheTtlMs - walletMetrics.staleRetentionMs - 1,
    );
    await expect(loadWalletBalance("expired")).rejects.toBe(networkError);
    expect(await readCachedWalletBalance("expired")).toEqual(balance(40));
  });

  it("returns a stale transaction page immediately and refreshes its cache in the background", async () => {
    const cached = page([transaction("cached"), transaction("shared")], "cursor-old");
    await saveEnvelope(
      "bwchat.wallet.transactions.v2:owner",
      cached,
      now - walletMetrics.listCacheTtlMs,
    );
    const remote = deferred<WalletTransactionPage>();
    fetchTransactions.mockReturnValue(remote.promise);

    await expect(loadWalletTransactions("owner")).resolves.toEqual({
      source: "stale-cache",
      value: cached,
    });
    expect(fetchTransactions).toHaveBeenCalledWith({ limit: 50 });

    remote.resolve(page([transaction("remote"), transaction("shared")], "cursor-new"));
    await waitFor(async () => {
      await expect(readCachedWalletTransactions("owner")).resolves.toEqual(
        page([transaction("remote"), transaction("shared"), transaction("cached")], "cursor-new"),
      );
    });
  });

  it("coalesces same-account loads and treats persistence as best effort", async () => {
    const response = deferred<WalletBalanceSnapshot>();
    fetchBalance.mockReturnValue(response.promise);
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));

    const first = loadWalletBalance("owner");
    const second = loadWalletBalance("owner");
    response.resolve(balance(55));

    await expect(Promise.all([first, second])).resolves.toEqual([
      { source: "remote", value: balance(55) },
      { source: "remote", value: balance(55) },
    ]);
    expect(fetchBalance).toHaveBeenCalledTimes(1);
  });

  it("rejects a response after account scope changes and does not seed the old cache", async () => {
    const response = deferred<WalletBalanceSnapshot>();
    fetchBalance.mockReturnValue(response.promise);
    let current = true;
    const load = loadWalletBalance("owner-a", false, {
      operationKey: "owner-a:1",
      isCurrent: () => current,
    });
    current = false;
    response.resolve(balance(80));

    await expect(load).rejects.toBeInstanceOf(WalletRepositoryAccountChangedError);
    expect(await readCachedWalletBalance("owner-a")).toBeUndefined();
  });

  it("appends first-wins transaction rows and terminates a repeated cursor", async () => {
    fetchTransactions.mockResolvedValue(
      page([transaction("shared"), transaction("remote")], "cursor-one"),
    );
    const current = page([transaction("local"), transaction("shared")], "cursor-one");
    await expect(loadMoreWalletTransactions("owner", current)).resolves.toEqual({
      transactions: [transaction("local"), transaction("shared"), transaction("remote")],
    });
    expect(fetchTransactions).toHaveBeenCalledWith({ cursor: "cursor-one", limit: 50 });
  });
});

async function saveEnvelope(key: string, value: unknown, savedAt: number): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify({ savedAt, value }));
}

function balance(value: number): WalletBalanceSnapshot {
  return {
    currency: "gold_coin",
    gold_coin_balance: value,
    activity_cat_food_balance: 0,
    spendable_balance: value,
    chat_money_frozen_gold_coin_balance: 0,
  };
}

function transaction(id: string): WalletTransaction {
  return {
    id,
    type: "ios_iap",
    currency: "gold_coin",
    gold_coin_amount: 100,
  };
}

function page(transactions: WalletTransaction[], nextCursor?: string): WalletTransactionPage {
  return {
    transactions,
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}
