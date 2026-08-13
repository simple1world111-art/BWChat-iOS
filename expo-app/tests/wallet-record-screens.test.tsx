import { act, fireEvent, render, screen } from "@testing-library/react-native";

import WalletTransactionsScreen from "@/app/wallet-transactions";
import type { WalletTransaction } from "@/models";

const refreshTransactions = jest.fn(async () => undefined);
const mockWalletState: {
  transactions: WalletTransaction[];
  transactionNextCursor?: string;
  isLoadingTransactions: boolean;
  transactionError: string | null;
  refreshTransactions: typeof refreshTransactions;
  loadMoreTransactions: () => Promise<void>;
} = {
  transactions: [],
  isLoadingTransactions: false,
  transactionError: null,
  refreshTransactions,
  loadMoreTransactions: async () => undefined,
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
  useLocalization: () => ({
    t: (key: string, ...args: (string | number)[]) => [key, ...args].join("|"),
  }),
}));

jest.mock("@/providers/WalletProvider", () => ({
  useWallet: () => mockWalletState,
}));

jest.mock("@/components/wallet/WalletRecords", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    WalletEmptyState: ({ title }: { title: string }) => <Text>{title}</Text>,
    WalletTransactionRow: ({ transaction }: { transaction: { id: string } }) => (
      <Text testID={`transaction-${transaction.id}`}>{transaction.id}</Text>
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
    mockWalletState.transactionError = null;
  });

  it("switches between income and expense records through the actual tab press handler", async () => {
    await render(<WalletTransactionsScreen />);
    expect(screen.getByTestId("transaction-income")).toBeTruthy();
    expect(screen.queryByTestId("transaction-expense")).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId("wallet-record-tab-expense"));
    });
    expect(screen.queryByTestId("transaction-income")).toBeNull();
    expect(screen.getByTestId("transaction-expense")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId("wallet-record-tab-income"));
    });
    expect(screen.getByTestId("transaction-income")).toBeTruthy();
  });

  it("forces a transaction reload from the native pull-to-refresh control", async () => {
    const { root } = await render(<WalletTransactionsScreen />);
    const list = root!.queryAll((node) => node.props.refreshControl != null)[0]!;
    const refreshControl = list.props.refreshControl;

    await act(async () => {
      await refreshControl.props.onRefresh();
    });
    expect(refreshTransactions).toHaveBeenCalledWith(true);
  });
});
