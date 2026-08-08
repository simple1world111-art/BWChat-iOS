import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

import WalletTransactionsScreen from "@/app/wallet-transactions";
import WalletWithdrawalsScreen from "@/app/wallet-withdrawals";
import type { WalletTransaction, WalletWithdrawal } from "@/models";

const refreshTransactions = jest.fn(async () => undefined);
const refreshWithdrawals = jest.fn(async () => undefined);
const cancelWithdrawal = jest.fn(async () => undefined);
const mockWalletState: {
  transactions: WalletTransaction[];
  withdrawals: WalletWithdrawal[];
  transactionNextCursor?: string;
  isLoadingTransactions: boolean;
  isLoadingWithdrawals: boolean;
  isSubmittingWithdrawal: boolean;
  transactionError: string | null;
  withdrawalError: string | null;
  refreshTransactions: typeof refreshTransactions;
  refreshWithdrawals: typeof refreshWithdrawals;
  loadMoreTransactions: () => Promise<void>;
  cancelWithdrawal: typeof cancelWithdrawal;
} = {
  transactions: [],
  withdrawals: [],
  isLoadingTransactions: false,
  isLoadingWithdrawals: false,
  isSubmittingWithdrawal: false,
  transactionError: null,
  withdrawalError: null,
  refreshTransactions,
  refreshWithdrawals,
  loadMoreTransactions: async () => undefined,
  cancelWithdrawal,
};

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
  useFocusEffect: (callback: () => void) => callback(),
}));

jest.mock("expo-symbols", () => ({
  SymbolView: () => null,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, right: 0, bottom: 34, left: 0 }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string, ...args: (string | number)[]) => [key, ...args].join("|") }),
}));

jest.mock("@/providers/WalletProvider", () => ({
  useWallet: () => mockWalletState,
}));

jest.mock("@/components/wallet/WalletRecords", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    WalletEmptyState: ({ title }: { title: string }) => <Text>{title}</Text>,
    WalletTransactionRow: ({ transaction }: { transaction: { id: string } }) => (
      <Text testID={`transaction-${transaction.id}`}>{transaction.id}</Text>
    ),
    WalletWithdrawalRow: ({ onCancel, withdrawal }: { onCancel: () => void; withdrawal: { id: string } }) => (
      <Pressable onPress={onCancel} testID={`withdrawal-${withdrawal.id}`}><Text>{withdrawal.id}</Text></Pressable>
    ),
  };
});

describe("wallet record screen interactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWalletState.transactions = [
      { id: "income", type: "ios_iap", currency: "gold_coin", gold_coin_amount: 100 },
      { id: "expense", type: "gift_sent", currency: "gold_coin", gold_coin_amount: 20 },
    ];
    mockWalletState.withdrawals = [];
    mockWalletState.transactionError = null;
    mockWalletState.withdrawalError = null;
  });

  it("switches between income and expense records through the actual tab press handler", async () => {
    await render(<WalletTransactionsScreen />);
    expect(screen.getByTestId("transaction-income")).toBeTruthy();
    expect(screen.queryByTestId("transaction-expense")).toBeNull();

    await act(async () => { fireEvent.press(screen.getByTestId("wallet-record-tab-expense")); });
    expect(screen.queryByTestId("transaction-income")).toBeNull();
    expect(screen.getByTestId("transaction-expense")).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByTestId("wallet-record-tab-income")); });
    expect(screen.getByTestId("transaction-income")).toBeTruthy();
  });

  it("forwards the selected withdrawal id through the cancel control", async () => {
    mockWalletState.withdrawals = [
      { id: "wd-pending", currency: "gold_coin", gold_coin_amount: 100, status: "pending", can_cancel: true },
    ];
    await render(<WalletWithdrawalsScreen />);

    await act(async () => { fireEvent.press(screen.getByTestId("withdrawal-wd-pending")); });
    expect(cancelWithdrawal).toHaveBeenCalledWith("wd-pending");
  });

  it("shows the native notice alert when cancellation fails", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    cancelWithdrawal.mockRejectedValueOnce(new Error("network"));
    mockWalletState.withdrawals = [
      { id: "wd-pending", currency: "gold_coin", gold_coin_amount: 100, status: "pending", can_cancel: true },
    ];
    await render(<WalletWithdrawalsScreen />);

    await act(async () => { fireEvent.press(screen.getByTestId("withdrawal-wd-pending")); });
    await waitFor(() => expect(alert).toHaveBeenCalledWith(
      "common.notice",
      "wallet.withdrawal.cancel.failedWithError|network",
    ));
    alert.mockRestore();
  });

  it("forces a transaction reload from the native pull-to-refresh control", async () => {
    const { root } = await render(<WalletTransactionsScreen />);
    const list = root!.queryAll((node) => node.props.refreshControl != null)[0]!;
    const refreshControl = list.props.refreshControl;

    await act(async () => { await refreshControl.props.onRefresh(); });
    expect(refreshTransactions).toHaveBeenCalledWith(true);
  });

  it("forces a withdrawal reload from the native pull-to-refresh control", async () => {
    mockWalletState.withdrawals = [
      { id: "wd-pending", currency: "gold_coin", gold_coin_amount: 100, status: "pending", can_cancel: true },
    ];
    const { root } = await render(<WalletWithdrawalsScreen />);
    const list = root!.queryAll((node) => node.props.refreshControl != null)[0]!;
    const refreshControl = list.props.refreshControl;

    await act(async () => { await refreshControl.props.onRefresh(); });
    expect(refreshWithdrawals).toHaveBeenCalledWith(true);
  });
});
