import { act, cleanup, renderHook, waitFor } from "@testing-library/react-native";
import type { Purchase, PurchaseIOS } from "expo-iap";

import { confirmWalletIapPurchase } from "@/api/bwchat";
import { APIError } from "@/api/client";
import { useWalletPurchases } from "@/services/wallet/useWalletPurchases";
import { fallbackGoldCoinProducts } from "@/services/wallet/walletPolicy";

const mockFinishTransaction = jest.fn();
const mockFetchProducts = jest.fn();
const mockGetAvailablePurchases = jest.fn();
const mockIsTransactionVerifiedIOS = jest.fn();
const mockRequestPurchase = jest.fn();
let mockIapOptions: {
  onPurchaseSuccess(purchase: Purchase): void;
  onPurchaseError(error: { code: string; message: string }): void;
} | null = null;

jest.mock("expo-iap", () => ({
  ErrorCode: {
    UserCancelled: "user-cancelled",
    Pending: "pending",
    DeferredPayment: "deferred",
  },
  finishTransaction: (...args: unknown[]) => mockFinishTransaction(...args),
  isTransactionVerifiedIOS: (...args: unknown[]) => mockIsTransactionVerifiedIOS(...args),
  useIAP: (options: typeof mockIapOptions) => {
    mockIapOptions = options;
    return {
      connected: true,
      products: [{ id: "com.bwchat.app.catfood.100", displayPrice: "$0.99" }],
      availablePurchases: [],
      getAvailablePurchases: mockGetAvailablePurchases,
      fetchProducts: mockFetchProducts,
      requestPurchase: mockRequestPurchase,
    };
  },
}));

jest.mock("expo-application", () => ({ applicationId: "com.bwchat.app" }));

jest.mock("@/api/bwchat", () => ({ confirmWalletIapPurchase: jest.fn() }));

const mockApplyBalance = jest.fn();
const mockRefreshBalance = jest.fn();
const mockRefreshTransactions = jest.fn();

jest.mock("@/providers/WalletProvider", () => ({
  useWallet: () => ({
    applyBalance: mockApplyBalance,
    refreshBalance: mockRefreshBalance,
    refreshTransactions: mockRefreshTransactions,
  }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    t: (key: string, ...args: (string | number)[]) =>
      args.length > 0 ? `${key}:${args.join(",")}` : key,
  }),
}));

jest.mock("@/services/visualAcceptance", () => ({ walletVisualAcceptanceEnabled: false }));

const confirmPurchase = jest.mocked(confirmWalletIapPurchase);
const product = fallbackGoldCoinProducts[0]!;

describe("native StoreKit wallet delivery state machine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIapOptions = null;
    mockFinishTransaction.mockResolvedValue(undefined);
    mockFetchProducts.mockResolvedValue(undefined);
    mockGetAvailablePurchases.mockResolvedValue(undefined);
    mockIsTransactionVerifiedIOS.mockResolvedValue(true);
    mockRequestPurchase.mockResolvedValue(undefined);
    mockApplyBalance.mockResolvedValue(undefined);
    mockRefreshBalance.mockResolvedValue(undefined);
    mockRefreshTransactions.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("refreshes balance but leaves the transaction unfinished when current delivery is deferred", async () => {
    confirmPurchase.mockRejectedValue(new APIError("offline", 503));
    const hook = await renderHook(() => useWalletPurchases(fallbackGoldCoinProducts));
    await act(async () => hook.result.current.purchase(product));
    await emitPurchase(purchase());

    await waitFor(() => expect(hook.result.current.isPurchasing).toBe(false));
    expect(mockRefreshBalance).toHaveBeenCalledWith(true);
    expect(mockRefreshTransactions).not.toHaveBeenCalled();
    expect(mockFinishTransaction).not.toHaveBeenCalled();
    expect(hook.result.current).toMatchObject({
      notice: "wallet.purchase.deliveryPending",
      noticePresentation: "alert",
    });
  });

  it("silently defers a restored unfinished transaction without current-purchase UI", async () => {
    confirmPurchase.mockRejectedValue(new APIError("offline", 503));
    const hook = await renderHook(() => useWalletPurchases(fallbackGoldCoinProducts));
    await emitPurchase(purchase());

    await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(1));
    expect(mockRefreshBalance).not.toHaveBeenCalled();
    expect(mockFinishTransaction).not.toHaveBeenCalled();
    expect(hook.result.current.notice).toBeNull();
    expect(hook.result.current.isPurchasing).toBe(false);
  });

  it("refreshes, finishes and reports an already-confirmed current purchase", async () => {
    confirmPurchase.mockRejectedValue(new APIError("already confirmed", 409));
    const hook = await renderHook(() => useWalletPurchases(fallbackGoldCoinProducts));
    await act(async () => hook.result.current.purchase(product));
    await emitPurchase(purchase());

    await waitFor(() => expect(mockFinishTransaction).toHaveBeenCalledTimes(1));
    expect(mockRefreshBalance).toHaveBeenCalledWith(true);
    expect(mockRefreshTransactions).toHaveBeenCalledWith(true);
    expect(hook.result.current).toMatchObject({
      notice: "wallet.purchase.alreadyHandled",
      noticePresentation: "center",
    });
  });

  it("delivers and finishes restored transactions without showing a foreground toast", async () => {
    confirmPurchase.mockResolvedValue({
      gold_coin_amount: 100,
      balance: walletBalance(200),
    });
    const hook = await renderHook(() => useWalletPurchases(fallbackGoldCoinProducts));
    await emitPurchase(purchase());

    await waitFor(() => expect(mockFinishTransaction).toHaveBeenCalledTimes(1));
    expect(mockApplyBalance).toHaveBeenCalledWith(walletBalance(200));
    expect(mockRefreshTransactions).toHaveBeenCalledWith(true);
    expect(hook.result.current.notice).toBeNull();
  });

  it("does not send unverified current purchases to the confirmation endpoint", async () => {
    const hook = await renderHook(() => useWalletPurchases(fallbackGoldCoinProducts));
    await act(async () => hook.result.current.purchase(product));
    await emitPurchase(purchase({ purchaseToken: "" }));

    await waitFor(() => expect(hook.result.current.isPurchasing).toBe(false));
    expect(confirmPurchase).not.toHaveBeenCalled();
    expect(mockFinishTransaction).not.toHaveBeenCalled();
    expect(hook.result.current).toMatchObject({
      notice: "wallet.purchase.verificationFailed",
      noticePresentation: "alert",
    });
  });

  it("does not send or consume a StoreKit transaction that fails local verification", async () => {
    mockIsTransactionVerifiedIOS.mockResolvedValue(false);
    const hook = await renderHook(() => useWalletPurchases(fallbackGoldCoinProducts));
    await act(async () => hook.result.current.purchase(product));
    await emitPurchase(purchase());

    await waitFor(() => expect(hook.result.current.isPurchasing).toBe(false));
    expect(mockIsTransactionVerifiedIOS).toHaveBeenCalledWith(product.productId);
    expect(confirmPurchase).not.toHaveBeenCalled();
    expect(mockFinishTransaction).not.toHaveBeenCalled();
    expect(hook.result.current).toMatchObject({
      notice: "wallet.purchase.verificationFailed",
      noticePresentation: "alert",
    });
  });
});

function purchase(overrides: Partial<PurchaseIOS> = {}): PurchaseIOS {
  return {
    id: "transaction-1",
    productId: product.productId,
    transactionId: "transaction-1",
    transactionDate: Date.parse("2026-08-08T12:00:00.000Z"),
    purchaseToken: "signed-jws",
    originalTransactionIdentifierIOS: "original-1",
    appBundleIdIOS: "com.bwchat.app",
    ...overrides,
  } as PurchaseIOS;
}

function walletBalance(value: number) {
  return {
    currency: "gold_coin" as const,
    gold_coin_balance: value,
    activity_cat_food_balance: 0,
    spendable_balance: value,
    chat_money_frozen_gold_coin_balance: 0,
  };
}

async function emitPurchase(value: Purchase): Promise<void> {
  await act(async () => {
    mockIapOptions?.onPurchaseSuccess(value);
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  });
}
