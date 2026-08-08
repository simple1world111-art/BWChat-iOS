import * as Application from "expo-application";
import {
  ErrorCode,
  finishTransaction,
  isTransactionVerifiedIOS,
  type Product,
  type Purchase,
  type PurchaseIOS,
  useIAP,
} from "expo-iap";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import { confirmWalletIapPurchase } from "@/api/bwchat";
import { APIError } from "@/api/client";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useWallet } from "@/providers/WalletProvider";
import type { GoldCoinProductConfig } from "@/services/wallet/walletPolicy";
import { walletVisualAcceptanceEnabled } from "@/services/visualAcceptance";

export interface WalletPurchaseController {
  connected: boolean;
  productsById: ReadonlyMap<string, Product>;
  isLoadingProducts: boolean;
  isPurchasing: boolean;
  productError: string | null;
  notice: string | null;
  noticePresentation: "alert" | "center" | "top" | null;
  clearNotice(): void;
  displayPrice(product: GoldCoinProductConfig): string;
  isAvailable(product: GoldCoinProductConfig): boolean;
  loadProducts(force?: boolean): Promise<void>;
  purchase(product: GoldCoinProductConfig): Promise<void>;
}

export function useWalletPurchases(
  configuredProducts: readonly GoldCoinProductConfig[],
): WalletPurchaseController {
  const { t } = useLocalization();
  const { applyBalance, refreshBalance, refreshTransactions } = useWallet();
  const [isLoadingProducts, setLoadingProducts] = useState(false);
  const [isPurchasing, setPurchasing] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticePresentation, setNoticePresentation] = useState<"alert" | "center" | "top" | null>(
    null,
  );
  const inFlightTransactions = useRef(new Set<string>());
  const expectedCoins = useRef(
    new Map(configuredProducts.map((item) => [item.productId, item.coins])),
  );
  const expectedProduct = useRef<string | null>(null);

  useEffect(() => {
    expectedCoins.current = new Map(configuredProducts.map((item) => [item.productId, item.coins]));
  }, [configuredProducts]);

  const deliver = useCallback(
    async (purchase: Purchase) => {
      const transactionId = purchase.transactionId?.trim() || purchase.id.trim();
      if (!transactionId || inFlightTransactions.current.has(transactionId)) return;
      const presentsOutcome = expectedProduct.current === purchase.productId;
      inFlightTransactions.current.add(transactionId);
      if (presentsOutcome) setPurchasing(true);
      try {
        if (Platform.OS !== "ios") {
          throw new WalletPurchaseVerificationError(t("wallet.purchase.verificationFailed"));
        }
        const iosPurchase = purchase as PurchaseIOS;
        const signedPayload = purchase.purchaseToken?.trim();
        if (!signedPayload)
          throw new WalletPurchaseVerificationError(t("wallet.purchase.verificationFailed"));
        // Match StoreKit's `checkVerified` gate in WalletStore: a transaction
        // must pass device-side StoreKit 2 verification before its signed JWS is
        // sent to the wallet-credit endpoint or marked as consumable.
        if (!(await isTransactionVerifiedIOS(purchase.productId))) {
          throw new WalletPurchaseVerificationError(t("wallet.purchase.verificationFailed"));
        }
        const confirmation = await confirmWalletIapPurchase({
          productId: purchase.productId,
          transactionId,
          originalTransactionId:
            iosPurchase.originalTransactionIdentifierIOS?.trim() || transactionId,
          signedPayload,
          purchaseDate: new Date(purchase.transactionDate).toISOString(),
          bundleId:
            iosPurchase.appBundleIdIOS?.trim() || Application.applicationId || "com.bwchat.app",
          ...(iosPurchase.appAccountToken?.trim()
            ? { appAccountToken: iosPurchase.appAccountToken.trim() }
            : {}),
        });
        if (confirmation.balance) await applyBalance(confirmation.balance);
        else await refreshBalance(true);
        await refreshTransactions(true);
        await finishTransaction({ purchase, isConsumable: true });
        const coins =
          confirmation.gold_coin_amount ?? expectedCoins.current.get(purchase.productId) ?? 0;
        if (presentsOutcome) {
          setNoticePresentation("center");
          setNotice(
            coins > 0 ? t("wallet.purchase.success", coins) : t("wallet.purchase.alreadyHandled"),
          );
        }
      } catch (error) {
        if (error instanceof WalletPurchaseVerificationError) {
          if (presentsOutcome) {
            setNoticePresentation("alert");
            setNotice(error.message);
          }
        } else if (isAlreadyConfirmed(error)) {
          await Promise.all([refreshBalance(true), refreshTransactions(true)]);
          await finishTransaction({ purchase, isConsumable: true });
          if (presentsOutcome) {
            setNoticePresentation("center");
            setNotice(t("wallet.purchase.alreadyHandled"));
          }
        } else if (presentsOutcome) {
          await refreshBalance(true);
          setNoticePresentation("alert");
          setNotice(t("wallet.purchase.deliveryPending"));
        }
      } finally {
        if (presentsOutcome) expectedProduct.current = null;
        inFlightTransactions.current.delete(transactionId);
        if (presentsOutcome) setPurchasing(false);
      }
    },
    [applyBalance, refreshBalance, refreshTransactions, t],
  );

  const {
    connected,
    products,
    availablePurchases,
    getAvailablePurchases,
    fetchProducts,
    requestPurchase,
  } = useIAP({
    onPurchaseSuccess: (purchase) => {
      void deliver(purchase);
    },
    onPurchaseError: (error) => {
      expectedProduct.current = null;
      setPurchasing(false);
      if (error.code === ErrorCode.UserCancelled) {
        setNoticePresentation("top");
        setNotice(t("wallet.purchase.cancelled"));
      } else if (error.code === ErrorCode.Pending || error.code === ErrorCode.DeferredPayment) {
        setNoticePresentation("alert");
        setNotice(t("wallet.purchase.pending"));
      } else {
        setNoticePresentation("alert");
        setNotice(t("wallet.purchase.failedWithError", error.message));
      }
    },
    onError: (error) => setProductError(t("wallet.products.loadFailedWithError", error.message)),
    purchaseUpdatedListenerOptions: { dedupeTransactionIOS: false },
  });

  useEffect(() => {
    if (walletVisualAcceptanceEnabled || !connected || Platform.OS !== "ios") return;
    void getAvailablePurchases({ onlyIncludeActiveItemsIOS: false });
  }, [connected, getAvailablePurchases]);

  useEffect(() => {
    const tasks = availablePurchases.map((purchase) =>
      setTimeout(() => {
        void deliver(purchase);
      }, 0),
    );
    return () => tasks.forEach(clearTimeout);
  }, [availablePurchases, deliver]);

  const productIdsKey = configuredProducts.map((item) => item.productId).join("|");
  const loadProducts = useCallback(
    async (_force = false) => {
      if (walletVisualAcceptanceEnabled) return;
      const productIds = productIdsKey ? productIdsKey.split("|") : [];
      if (!connected || productIds.length === 0 || Platform.OS !== "ios") return;
      setLoadingProducts(true);
      setProductError(null);
      try {
        await fetchProducts({ skus: productIds, type: "in-app" });
      } catch (error) {
        setProductError(t("wallet.products.loadFailedWithError", message(error)));
      } finally {
        setLoadingProducts(false);
      }
    },
    [connected, fetchProducts, productIdsKey, t],
  );

  useEffect(() => {
    const task = setTimeout(() => {
      void loadProducts();
    }, 0);
    return () => clearTimeout(task);
  }, [loadProducts]);

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const purchase = useCallback(
    async (product: GoldCoinProductConfig) => {
      if (walletVisualAcceptanceEnabled) return;
      if (isPurchasing || expectedProduct.current) {
        setNoticePresentation("alert");
        setNotice(t("wallet.purchase.inProgress"));
        return;
      }
      if (Platform.OS !== "ios" || !productsById.has(product.productId)) {
        setNoticePresentation("alert");
        setNotice(productError ?? t("wallet.product.configMissing"));
        return;
      }
      expectedProduct.current = product.productId;
      setPurchasing(true);
      setNotice(null);
      setNoticePresentation(null);
      try {
        await requestPurchase({
          request: { apple: { sku: product.productId } },
          type: "in-app",
        });
      } catch (error) {
        expectedProduct.current = null;
        setPurchasing(false);
        setNoticePresentation("alert");
        setNotice(t("wallet.purchase.failedWithError", message(error)));
      }
    },
    [isPurchasing, productError, productsById, requestPurchase, t],
  );

  const clearNotice = useCallback(() => {
    setNotice(null);
    setNoticePresentation(null);
  }, []);

  return {
    connected: walletVisualAcceptanceEnabled || connected,
    productsById,
    isLoadingProducts: walletVisualAcceptanceEnabled ? false : isLoadingProducts,
    isPurchasing,
    productError: walletVisualAcceptanceEnabled ? null : productError,
    notice,
    noticePresentation,
    clearNotice,
    displayPrice: (product) =>
      cleanPrice(
        walletVisualAcceptanceEnabled
          ? product.fallbackPriceUsd
          : (productsById.get(product.productId)?.displayPrice ?? product.fallbackPriceUsd),
      ),
    isAvailable: (product) =>
      walletVisualAcceptanceEnabled ||
      (Platform.OS === "ios" && productsById.has(product.productId)),
    loadProducts,
    purchase,
  };
}

class WalletPurchaseVerificationError extends Error {}

function cleanPrice(value: string): string {
  return value.replaceAll("US$", "$").replaceAll("US $", "$").replaceAll("US\u00a0$", "$").trim();
}

function isAlreadyConfirmed(error: unknown): boolean {
  return (
    error instanceof APIError &&
    (error.status === 409 || error.message.toLocaleLowerCase().includes("already"))
  );
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Unknown error";
}
