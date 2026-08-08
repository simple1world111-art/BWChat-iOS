import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import type { ReactNode } from "react";

import ActivityCatFoodScreen from "@/app/activity-cat-food";
import PropBagScreen from "@/app/prop-bag";
import type { WalletBalanceSnapshot } from "@/models";

const mockRouterPush = jest.mocked(router.push);
const mockLoadInventory = jest.fn(async () => undefined);
const mockRefreshBalance = jest.fn(async () => undefined);
const mockRefreshActivityTransactions = jest.fn(async () => undefined);

const mockInventoryState = {
  items: [{
    inventoryId: "image-card",
    definitionId: "media_unlock_card_image",
    type: "media_unlock_card",
    name: "Test Card",
    description: "Unlock one image",
    quantity: 2,
    isEquipped: false,
    availableActions: ["consume_for_media_unlock"],
    metadata: { mediaType: "image" },
  }],
  summary: { totalQuantity: 2, equippedCount: 0, expiringCount: 0 },
  isLoading: false,
  errorMessage: undefined as string | undefined,
  availableLiveExperienceCards: [],
  quantity: () => 0,
  load: mockLoadInventory,
  applyLiveExperienceReservation: jest.fn(),
};

const mockWalletState = {
  balance: {
    currency: "gold_coin" as const,
    gold_coin_balance: 20,
    activity_cat_food_balance: 8,
    spendable_balance: 28,
    recharge_gold_coin_balance: 20,
    gift_income_gold_coin_balance: 0,
    withdraw_frozen_gold_coin_balance: 0,
    withdrawable_gold_coin_balance: 0,
    chat_money_frozen_gold_coin_balance: 0,
  } as WalletBalanceSnapshot | null,
  transactions: [],
  withdrawals: [],
  activityCatFoodTransactions: [{
    id: "check-in",
    delta: 3,
    balance_after: 8,
    source: "daily_check_in_reward",
    created_at: "2026-08-07T00:00:00Z",
  }],
  activityCatFoodNextCursor: "next" as string | undefined,
  isActivityCatFoodEnabled: true,
  activityCatFoodDisabledByServer: false,
  isLoadingBalance: false,
  isLoadingTransactions: false,
  isLoadingWithdrawals: false,
  isSubmittingWithdrawal: false,
  isLoadingActivityCatFoodTransactions: false,
  balanceError: null as string | null,
  transactionError: null,
  withdrawalError: null,
  activityCatFoodTransactionError: null as string | null,
  refreshBalance: mockRefreshBalance,
  refreshTransactions: jest.fn(async () => undefined),
  loadMoreTransactions: jest.fn(async () => undefined),
  refreshActivityCatFoodTransactions: mockRefreshActivityTransactions,
  refreshWithdrawals: jest.fn(async () => undefined),
  requestWithdrawal: jest.fn(async () => undefined),
  cancelWithdrawal: jest.fn(async () => undefined),
  applyBalance: jest.fn(async () => undefined),
};

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("expo-image", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Image: (props: Record<string, unknown>) => <MockView {...props} /> };
});

jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { LinearGradient: ({ children, ...props }: { children: ReactNode }) => <MockView {...props}>{children}</MockView> };
});

jest.mock("@/components/AuthenticatedImage", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { AuthenticatedImage: (props: Record<string, unknown>) => <MockView {...props} /> };
});

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    t: (key: string, ...args: (string | number)[]) => [key, ...args].join("|"),
  }),
}));

jest.mock("@/providers/PropInventoryProvider", () => ({
  usePropInventory: () => mockInventoryState,
}));

jest.mock("@/providers/WalletProvider", () => ({
  useWallet: () => mockWalletState,
}));

describe("prop-bag screen interactions", () => {
  const walletBalance: WalletBalanceSnapshot = {
    currency: "gold_coin",
    gold_coin_balance: 20,
    activity_cat_food_balance: 8,
    spendable_balance: 28,
    recharge_gold_coin_balance: 20,
    gift_income_gold_coin_balance: 0,
    withdraw_frozen_gold_coin_balance: 0,
    withdrawable_gold_coin_balance: 0,
    chat_money_frozen_gold_coin_balance: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockInventoryState.items = [{
      inventoryId: "image-card",
      definitionId: "media_unlock_card_image",
      type: "media_unlock_card",
      name: "Test Card",
      description: "Unlock one image",
      quantity: 2,
      isEquipped: false,
      availableActions: ["consume_for_media_unlock"],
      metadata: { mediaType: "image" },
    }];
    mockInventoryState.isLoading = false;
    mockInventoryState.errorMessage = undefined;
    mockWalletState.balance = walletBalance;
    mockWalletState.balanceError = null;
    mockWalletState.isActivityCatFoodEnabled = true;
    mockWalletState.activityCatFoodTransactions = [{
      id: "check-in",
      delta: 3,
      balance_after: 8,
      source: "daily_check_in_reward",
      created_at: "2026-08-07T00:00:00Z",
    }];
    mockWalletState.activityCatFoodNextCursor = "next";
    mockWalletState.activityCatFoodTransactionError = null;
  });

  it("loads inventory and balance, exposes the usage rule, and routes the enabled cat-food card", async () => {
    await render(<PropBagScreen />);
    expect(mockLoadInventory).toHaveBeenCalledWith();
    expect(mockRefreshBalance).toHaveBeenCalledWith();

    expect(screen.getByLabelText("Test Card, ×2").props.accessibilityHint).toBe("Unlock one image");

    await fireEvent.press(screen.getByLabelText("activityCatFood.title, ×8"));
    expect(mockRouterPush).toHaveBeenCalledWith("/activity-cat-food");
  });

  it("opens the native usage rule and refreshes both data sources with force enabled", async () => {
    await render(<PropBagScreen />);
    await fireEvent.press(screen.getByLabelText("Test Card, ×2"));
    expect(screen.getByText("Unlock one image")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("common.close"));
    expect(screen.queryByText("Unlock one image")).toBeNull();

    mockLoadInventory.mockClear();
    mockRefreshBalance.mockClear();
    const scrolling = screen.getByTestId("prop-bag-scroll");
    await act(async () => {
      await scrolling.props.refreshControl.props.onRefresh();
    });
    expect(mockLoadInventory).toHaveBeenCalledWith(true);
    expect(mockRefreshBalance).toHaveBeenCalledWith(true);
  });

  it("retries a missing balance instead of opening details and disables a read-only cat-food card", async () => {
    mockWalletState.balance = null;
    mockWalletState.balanceError = "balance failed";
    const retry = await render(<PropBagScreen />);
    await fireEvent.press(screen.getByLabelText("activityCatFood.title, ×…"));
    expect(mockRefreshBalance).toHaveBeenCalledWith(true);
    expect(mockRouterPush).not.toHaveBeenCalled();
    await retry.unmount();

    mockWalletState.balance = walletBalance;
    mockWalletState.isActivityCatFoodEnabled = false;
    await render(<PropBagScreen />);
    const readOnly = screen.getByLabelText("activityCatFood.title, ×8");
    expect(readOnly.props.accessibilityState).toEqual({ disabled: true });
    await fireEvent.press(readOnly);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("keeps loading, error retry, and empty inventory branches distinct", async () => {
    mockWalletState.balance = null;
    mockWalletState.isActivityCatFoodEnabled = false;
    mockInventoryState.items = [];
    mockInventoryState.errorMessage = "prop failed";
    const error = await render(<PropBagScreen />);
    expect(screen.getByText("prop failed")).toBeTruthy();
    await fireEvent.press(screen.getByText("common.retry"));
    expect(mockLoadInventory).toHaveBeenCalledWith(true);
    await error.unmount();

    mockInventoryState.errorMessage = undefined;
    await render(<PropBagScreen />);
    expect(screen.getByText("propBag.empty.title")).toBeTruthy();
    expect(screen.getByText("propBag.empty.message")).toBeTruthy();
  });

  it("renders localized activity rows and requests the next page near the bottom", async () => {
    await render(<ActivityCatFoodScreen />);
    expect(mockRefreshBalance).toHaveBeenCalledWith();
    expect(mockRefreshActivityTransactions).toHaveBeenCalledWith(true);
    expect(screen.getByText("activityCenter.checkIn.title")).toBeTruthy();
    expect(screen.getByText("activityCatFood.transaction.grant")).toBeTruthy();
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByLabelText(
      "activityCenter.checkIn.title, +3, activityCatFood.balanceAfter|8",
    ).props.accessible).toBe(true);

    mockRefreshActivityTransactions.mockClear();
    const scrolling = screen.getByTestId("activity-cat-food-scroll");
    await act(async () => {
      scrolling.props.onLayout({ nativeEvent: { layout: { height: 700 } } });
      scrolling.props.onContentSizeChange(390, 500);
    });
    expect(mockRefreshActivityTransactions).toHaveBeenCalledWith(false);

    mockRefreshActivityTransactions.mockClear();
    await act(async () => {
      scrolling.props.onScroll({
        nativeEvent: {
          contentOffset: { y: 900 },
          contentSize: { height: 1_500 },
          layoutMeasurement: { height: 500 },
        },
      });
    });
    expect(mockRefreshActivityTransactions).toHaveBeenCalledWith(false);

    mockRefreshBalance.mockClear();
    mockRefreshActivityTransactions.mockClear();
    await act(async () => {
      await scrolling.props.refreshControl.props.onRefresh();
    });
    expect(mockRefreshBalance).toHaveBeenCalledWith(true);
    expect(mockRefreshActivityTransactions).toHaveBeenCalledWith(true);
  });

  it("does not request another cat-food page without a server cursor", async () => {
    mockWalletState.activityCatFoodNextCursor = undefined;
    await render(<ActivityCatFoodScreen />);
    mockRefreshActivityTransactions.mockClear();
    const scrolling = screen.getByTestId("activity-cat-food-scroll");
    await act(async () => {
      scrolling.props.onScroll({
        nativeEvent: {
          contentOffset: { y: 900 },
          contentSize: { height: 1_500 },
          layoutMeasurement: { height: 500 },
        },
      });
    });
    expect(mockRefreshActivityTransactions).not.toHaveBeenCalled();
  });

  it("loads restored cat-food details when remote config becomes enabled after mount", async () => {
    mockWalletState.isActivityCatFoodEnabled = false;
    const view = await render(<ActivityCatFoodScreen />);
    expect(mockRefreshBalance).toHaveBeenCalledTimes(1);
    expect(mockRefreshActivityTransactions).not.toHaveBeenCalled();

    mockWalletState.isActivityCatFoodEnabled = true;
    await view.rerender(<ActivityCatFoodScreen />);
    expect(mockRefreshBalance).toHaveBeenCalledTimes(1);
    expect(mockRefreshActivityTransactions).toHaveBeenCalledTimes(1);
    expect(mockRefreshActivityTransactions).toHaveBeenCalledWith(true);
  });

  it("keeps the native empty and error branches actionable", async () => {
    mockWalletState.activityCatFoodTransactions = [];
    mockWalletState.activityCatFoodNextCursor = undefined;
    const empty = await render(<ActivityCatFoodScreen />);
    expect(screen.getByText("activityCatFood.transactions.empty")).toBeTruthy();
    await empty.unmount();

    mockWalletState.activityCatFoodTransactionError = "network failed";
    await render(<ActivityCatFoodScreen />);
    expect(screen.getByText("network failed")).toBeTruthy();
    await fireEvent.press(screen.getByText("common.retry"));
    expect(mockRefreshActivityTransactions).toHaveBeenCalledWith(true);
  });
});
