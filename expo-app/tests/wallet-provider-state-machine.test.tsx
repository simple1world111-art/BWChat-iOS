import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

import type { User, WalletBalanceSnapshot } from "@/models";
import { useWallet, WalletProvider } from "@/providers/WalletProvider";
import { loadWalletBalance, readCachedWalletBalance } from "@/services/wallet/WalletRepository";

let mockAuthUser: User | null = { user_id: "owner-a" } as User;

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockAuthUser }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    t: (key: string, ...args: (string | number)[]) =>
      args.length > 0 ? `${key}:${args.join(",")}` : key,
  }),
}));

jest.mock("@/providers/RemoteConfigProvider", () => ({
  useRemoteConfig: () => ({ config: { wallet: undefined } }),
}));

jest.mock("@/services/visualAcceptance", () => ({
  walletVisualAcceptanceBalance: null,
  walletVisualAcceptanceEnabled: false,
  walletVisualAcceptanceTransactions: [],
  walletVisualAcceptanceVariant: undefined,
}));

jest.mock("@/services/wallet/WalletRepository", () => ({
  loadMoreWalletTransactions: jest.fn(),
  loadWalletBalance: jest.fn(),
  loadWalletTransactions: jest.fn(),
  persistBalance: jest.fn().mockResolvedValue(undefined),
  readCachedWalletBalance: jest.fn(),
  readCachedWalletTransactions: jest.fn().mockResolvedValue(undefined),
  WalletRepositoryAccountChangedError: class WalletRepositoryAccountChangedError extends Error {},
}));

const mockLoadBalance = jest.mocked(loadWalletBalance);
const mockReadBalance = jest.mocked(readCachedWalletBalance);
let currentWallet: ReturnType<typeof useWallet> | undefined;

describe("wallet provider account and mutation state machine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { user_id: "owner-a" } as User;
    currentWallet = undefined;
    mockReadBalance.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("restores raw account snapshots and remounts empty for the next account", async () => {
    mockReadBalance.mockImplementation(async (ownerId) =>
      ownerId === "owner-a" ? balance(120) : undefined,
    );
    const view = await render(
      <WalletProvider>
        <WalletProbe />
      </WalletProvider>,
    );
    await waitFor(() => expect(view.getByText("balance:120")).toBeTruthy());

    mockAuthUser = { user_id: "owner-b" } as User;
    await act(async () => {
      await view.rerender(
        <WalletProvider>
          <WalletProbe />
        </WalletProvider>,
      );
    });
    expect(view.getByText("balance:none")).toBeTruthy();
    expect(mockReadBalance).toHaveBeenCalledWith("owner-a");
    expect(mockReadBalance).toHaveBeenCalledWith("owner-b");
  });

  it("ignores a completed balance load after the account scope is replaced", async () => {
    const response = deferred<WalletBalanceSnapshot>();
    mockLoadBalance.mockReturnValue(
      response.promise.then((value) => ({ value, source: "remote" as const })),
    );
    const view = await render(
      <WalletProvider>
        <WalletProbe />
      </WalletProvider>,
    );
    await act(async () => {
      void currentWallet?.refreshBalance(true);
      await Promise.resolve();
    });

    mockAuthUser = { user_id: "owner-b" } as User;
    await act(async () => {
      await view.rerender(
        <WalletProvider>
          <WalletProbe />
        </WalletProvider>,
      );
      response.resolve(balance(999));
      await Promise.resolve();
    });
    expect(view.getByText("balance:none")).toBeTruthy();
  });
});

function WalletProbe() {
  const wallet = useWallet();
  useEffect(() => {
    currentWallet = wallet;
  }, [wallet]);
  return (
    <>
      <Text>{`balance:${wallet.balance?.spendable_balance ?? "none"}`}</Text>
      <Text>{`balance-error:${wallet.balanceError ?? "none"}`}</Text>
    </>
  );
}

function balance(spendable: number): WalletBalanceSnapshot {
  return {
    currency: "gold_coin",
    gold_coin_balance: spendable,
    activity_cat_food_balance: 0,
    spendable_balance: spendable,
    chat_money_frozen_gold_coin_balance: 0,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}
