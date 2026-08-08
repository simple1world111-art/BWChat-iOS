import { act, cleanup, render } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

import type { User, WalletBalanceSnapshot } from "@/models";
import { useWallet, WalletProvider } from "@/providers/WalletProvider";
import { persistBalance } from "@/services/wallet/WalletRepository";

let mockAuthUser: User | null = { user_id: "owner-a" } as User;

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockAuthUser }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
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

jest.mock("@/services/wallet/WalletRepository", () => {
  const actual = jest.requireActual("@/services/wallet/WalletRepository");
  return { ...actual, persistBalance: jest.fn() };
});

const mockPersistBalance = jest.mocked(persistBalance);
let currentWallet: ReturnType<typeof useWallet> | undefined;

describe("server-authoritative game round wallet consumption", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { user_id: "owner-a" } as User;
    currentWallet = undefined;
    mockPersistBalance.mockResolvedValue();
  });

  afterEach(() => cleanup());

  it("installs the server balance before best-effort persistence and does not downgrade success", async () => {
    const next = balance(75);
    mockPersistBalance.mockRejectedValueOnce(new Error("disk full"));
    const view = await render(
      <WalletProvider>
        <WalletProbe />
      </WalletProvider>,
    );

    await act(async () => {
      await expect(currentWallet?.applyBalance(next)).resolves.toBeUndefined();
    });
    expect(view.getByText("75")).toBeTruthy();
    expect(mockPersistBalance).toHaveBeenCalledWith("owner-a", next);
  });

  it("keeps an applied balance scoped to the account that received it", async () => {
    const view = await render(
      <WalletProvider>
        <WalletProbe />
      </WalletProvider>,
    );
    await act(async () => {
      await currentWallet?.applyBalance(balance(60));
    });
    expect(view.getByText("60")).toBeTruthy();

    mockAuthUser = { user_id: "owner-b" } as User;
    await act(async () => {
      await view.rerender(
        <WalletProvider>
          <WalletProbe />
        </WalletProvider>,
      );
    });
    expect(view.getByText("none")).toBeTruthy();
    expect(mockPersistBalance).toHaveBeenCalledTimes(1);
    expect(mockPersistBalance).toHaveBeenCalledWith("owner-a", expect.any(Object));
  });
});

function WalletProbe() {
  const wallet = useWallet();
  useEffect(() => {
    currentWallet = wallet;
  }, [wallet]);
  return <Text>{wallet.balance?.spendable_balance ?? "none"}</Text>;
}

function balance(spendable: number): WalletBalanceSnapshot {
  return {
    currency: "gold_coin",
    gold_coin_balance: spendable - 5,
    activity_cat_food_balance: 5,
    spendable_balance: spendable,
    recharge_gold_coin_balance: spendable - 10,
    gift_income_gold_coin_balance: 5,
    withdraw_frozen_gold_coin_balance: 0,
    withdrawable_gold_coin_balance: 5,
    chat_money_frozen_gold_coin_balance: 0,
  };
}
