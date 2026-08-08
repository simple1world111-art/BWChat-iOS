import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

import type { User, WalletBalanceSnapshot } from "@/models";
import { useWallet, WalletProvider } from "@/providers/WalletProvider";
import {
  loadWalletBalance,
  loadWalletWithdrawalList,
  readCachedWalletBalance,
  submitWalletWithdrawal,
} from "@/services/wallet/WalletRepository";

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
  walletVisualAcceptanceWithdrawals: [],
}));

jest.mock("@/services/wallet/WalletRepository", () => ({
  cancelWalletWithdrawal: jest.fn(),
  loadMoreWalletTransactions: jest.fn(),
  loadWalletBalance: jest.fn(),
  loadWalletTransactions: jest.fn(),
  loadWalletWithdrawalList: jest.fn(),
  persistBalance: jest.fn().mockResolvedValue(undefined),
  readCachedWalletBalance: jest.fn(),
  readCachedWalletTransactions: jest.fn().mockResolvedValue(undefined),
  readCachedWalletWithdrawals: jest.fn().mockResolvedValue(undefined),
  submitWalletWithdrawal: jest.fn(),
  WalletRepositoryAccountChangedError: class WalletRepositoryAccountChangedError extends Error {},
}));

const mockLoadBalance = jest.mocked(loadWalletBalance);
const mockLoadWithdrawals = jest.mocked(loadWalletWithdrawalList);
const mockReadBalance = jest.mocked(readCachedWalletBalance);
const mockSubmitWithdrawal = jest.mocked(submitWalletWithdrawal);
let currentWallet: ReturnType<typeof useWallet> | undefined;

describe("wallet provider account and mutation state machine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { user_id: "owner-a" } as User;
    currentWallet = undefined;
    mockReadBalance.mockResolvedValue(undefined);
    mockSubmitWithdrawal.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("restores raw account snapshots and remounts empty for the next account", async () => {
    mockReadBalance.mockImplementation(async (ownerId) =>
      ownerId === "owner-a" ? balance(120, 100) : undefined,
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

  it("enforces the native defensive withdrawal validation before POST", async () => {
    await render(
      <WalletProvider>
        <WalletProbe />
      </WalletProvider>,
    );
    await act(async () => currentWallet?.applyBalance(balance(120, 100)));

    await expect(
      currentWallet?.requestWithdrawal({
        goldCoinAmount: 101,
        usdtAmount: "0.50",
        network: "TRC20",
        walletAddress: "T12345678901",
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "insufficient_withdrawable_gold_coin_balance",
    });
    await expect(
      currentWallet?.requestWithdrawal({
        goldCoinAmount: 100,
        usdtAmount: "0.50",
        network: "TRC20",
        walletAddress: "short",
      }),
    ).rejects.toMatchObject({ status: 400, code: "payout_account_required" });
    expect(mockSubmitWithdrawal).not.toHaveBeenCalled();
  });

  it("does not downgrade a successful withdrawal when post-submit refreshes fail", async () => {
    const view = await render(
      <WalletProvider>
        <WalletProbe />
      </WalletProvider>,
    );
    await act(async () => currentWallet?.applyBalance(balance(120, 100)));
    mockLoadBalance.mockRejectedValue(new Error("balance offline"));
    mockLoadWithdrawals.mockRejectedValue(new Error("history offline"));

    await act(async () => {
      await expect(
        currentWallet?.requestWithdrawal({
          goldCoinAmount: 100,
          usdtAmount: "0.50",
          network: "TRC20",
          walletAddress: "T12345678901",
        }),
      ).resolves.toBeUndefined();
    });

    expect(mockSubmitWithdrawal).toHaveBeenCalledWith(
      "owner-a",
      {
        goldCoinAmount: 100,
        usdtAmount: "0.50",
        network: "TRC20",
        walletAddress: "T12345678901",
      },
      expect.objectContaining({ operationKey: expect.stringMatching(/^owner-a:/u) }),
    );
    expect(
      view.getByText("balance-error:wallet.balance.loadFailedWithError:balance offline"),
    ).toBeTruthy();
    expect(
      view.getByText("withdrawal-error:wallet.withdrawals.loadFailedWithError:history offline"),
    ).toBeTruthy();
    expect(currentWallet?.isSubmittingWithdrawal).toBe(false);
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
      response.resolve(balance(999, 100));
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
      <Text>{`withdrawal-error:${wallet.withdrawalError ?? "none"}`}</Text>
    </>
  );
}

function balance(spendable: number, withdrawable: number): WalletBalanceSnapshot {
  return {
    currency: "gold_coin",
    gold_coin_balance: spendable,
    activity_cat_food_balance: 0,
    spendable_balance: spendable,
    recharge_gold_coin_balance: spendable - withdrawable,
    gift_income_gold_coin_balance: withdrawable,
    withdraw_frozen_gold_coin_balance: 0,
    withdrawable_gold_coin_balance: withdrawable,
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
