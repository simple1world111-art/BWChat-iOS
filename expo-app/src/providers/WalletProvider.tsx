import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  ActivityCatFoodTransaction,
  ActivityCatFoodTransactionPage,
  WalletBalanceSnapshot,
  WalletTransaction,
  WalletTransactionPage,
} from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import {
  appendActivityCatFoodTransactionPage,
  isActivityCatFoodConfigured,
  isActivityCatFoodDisabledError,
  loadActivityCatFoodTransactionPage,
} from "@/services/wallet/ActivityCatFoodRepository";
import {
  loadMoreWalletTransactions,
  loadWalletBalance,
  loadWalletTransactions,
  persistBalance,
  readCachedWalletBalance,
  readCachedWalletTransactions,
  WalletRepositoryAccountChangedError,
  type WalletRepositoryAccountGuard,
} from "@/services/wallet/WalletRepository";
import {
  walletVisualAcceptanceBalance,
  walletVisualAcceptanceEnabled,
  walletVisualAcceptanceTransactions,
  walletVisualAcceptanceVariant,
} from "@/services/visualAcceptance";

interface WalletContextValue {
  balance: WalletBalanceSnapshot | null;
  transactions: WalletTransaction[];
  transactionNextCursor?: string | undefined;
  activityCatFoodTransactions: ActivityCatFoodTransaction[];
  activityCatFoodNextCursor?: string | undefined;
  isActivityCatFoodEnabled: boolean;
  activityCatFoodDisabledByServer: boolean;
  isLoadingBalance: boolean;
  isLoadingTransactions: boolean;
  isLoadingActivityCatFoodTransactions: boolean;
  balanceError: string | null;
  transactionError: string | null;
  activityCatFoodTransactionError: string | null;
  refreshBalance(force?: boolean): Promise<void>;
  refreshTransactions(force?: boolean): Promise<void>;
  loadMoreTransactions(): Promise<void>;
  refreshActivityCatFoodTransactions(reset?: boolean): Promise<void>;
  applyBalance(balance: WalletBalanceSnapshot): Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);
let walletScopeGeneration = 0;

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  return (
    <WalletScope key={ownerId} ownerId={ownerId}>
      {children}
    </WalletScope>
  );
}

function WalletScope({ children, ownerId }: { children: React.ReactNode; ownerId: string }) {
  const { t } = useLocalization();
  const { config } = useRemoteConfig();
  const [repositoryScope] = useState(() => ({
    active: true,
    operationKey: `${ownerId}:${++walletScopeGeneration}`,
  }));
  const repositoryGuard = useMemo<WalletRepositoryAccountGuard>(
    () => ({
      operationKey: repositoryScope.operationKey,
      isCurrent: () => repositoryScope.active,
    }),
    [repositoryScope],
  );
  const isActivityCatFoodConfiguredByRemote = isActivityCatFoodConfigured(config.wallet);
  const [balance, setBalance] = useState<WalletBalanceSnapshot | null>(() =>
    walletVisualAcceptanceEnabled ? walletVisualAcceptanceBalance : null,
  );
  const [transactionPage, setTransactionPage] = useState<WalletTransactionPage>(() => ({
    transactions:
      walletVisualAcceptanceVariant === "wallet-transactions-rows" ||
      walletVisualAcceptanceVariant === "wallet-transactions-expense-rows"
        ? [...walletVisualAcceptanceTransactions]
        : [],
  }));
  const [activityCatFoodPage, setActivityCatFoodPage] = useState<ActivityCatFoodTransactionPage>({
    items: [],
  });
  const [activityCatFoodDisabledByServer, setActivityCatFoodDisabledByServer] = useState(false);
  const [isLoadingBalance, setLoadingBalance] = useState(false);
  const [isLoadingTransactions, setLoadingTransactions] = useState(
    walletVisualAcceptanceVariant === "wallet-transactions-loading",
  );
  const [isLoadingActivityCatFoodTransactions, setLoadingActivityCatFoodTransactions] =
    useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [transactionError, setTransactionError] = useState<string | null>(() =>
    walletVisualAcceptanceVariant === "wallet-transactions-error"
      ? t("wallet.transactions.loadFailedWithError", "验收错误")
      : null,
  );
  const [activityCatFoodTransactionError, setActivityCatFoodTransactionError] = useState<
    string | null
  >(null);
  const requestedCursors = useRef(new Set<string>());
  const loadingBalanceRef = useRef(false);
  const loadingTransactionsRef = useRef(false);
  const loadingActivityCatFoodTransactionsRef = useRef(false);
  const balanceEpochRef = useRef(0);
  const transactionEpochRef = useRef(0);
  const isActivityCatFoodEnabled =
    isActivityCatFoodConfiguredByRemote && !activityCatFoodDisabledByServer;

  useEffect(
    () => () => {
      repositoryScope.active = false;
    },
    [repositoryScope],
  );

  useEffect(() => {
    if (walletVisualAcceptanceEnabled || !ownerId) return;
    const balanceEpoch = balanceEpochRef.current;
    const transactionEpoch = transactionEpochRef.current;
    void Promise.all([
      readCachedWalletBalance(ownerId),
      readCachedWalletTransactions(ownerId),
    ]).then(([cachedBalance, cachedTransactions]) => {
      if (!repositoryGuard.isCurrent()) return;
      if (cachedBalance && balanceEpochRef.current === balanceEpoch) setBalance(cachedBalance);
      if (cachedTransactions && transactionEpochRef.current === transactionEpoch) {
        setTransactionPage(cachedTransactions);
      }
    });
  }, [ownerId, repositoryGuard]);

  const refreshBalance = useCallback(
    async (force = false) => {
      if (walletVisualAcceptanceEnabled) return;
      if (!ownerId || loadingBalanceRef.current) return;
      loadingBalanceRef.current = true;
      balanceEpochRef.current += 1;
      setLoadingBalance(true);
      setBalanceError(null);
      try {
        const result = await loadWalletBalance(ownerId, force, repositoryGuard);
        if (!repositoryGuard.isCurrent()) return;
        setBalance(result.value);
        if (isActivityCatFoodDisabledError(result.refreshError)) {
          setActivityCatFoodDisabledByServer(true);
          setActivityCatFoodPage({ items: [] });
        } else if (result.source === "remote" && isActivityCatFoodConfiguredByRemote) {
          setActivityCatFoodDisabledByServer(false);
        }
      } catch (error) {
        if (error instanceof WalletRepositoryAccountChangedError) return;
        if (isActivityCatFoodDisabledError(error)) {
          setActivityCatFoodDisabledByServer(true);
          setActivityCatFoodPage({ items: [] });
        }
        setBalanceError(t("wallet.balance.loadFailedWithError", errorMessage(error)));
      } finally {
        loadingBalanceRef.current = false;
        if (repositoryGuard.isCurrent()) setLoadingBalance(false);
      }
    },
    [isActivityCatFoodConfiguredByRemote, ownerId, repositoryGuard, t],
  );

  const refreshTransactions = useCallback(
    async (force = false) => {
      if (walletVisualAcceptanceEnabled) return;
      if (!ownerId || loadingTransactionsRef.current) return;
      loadingTransactionsRef.current = true;
      transactionEpochRef.current += 1;
      setLoadingTransactions(true);
      setTransactionError(null);
      try {
        const result = await loadWalletTransactions(ownerId, force, repositoryGuard);
        if (!repositoryGuard.isCurrent()) return;
        requestedCursors.current.clear();
        setTransactionPage(result.value);
      } catch (error) {
        if (error instanceof WalletRepositoryAccountChangedError) return;
        setTransactionError(t("wallet.transactions.loadFailedWithError", errorMessage(error)));
      } finally {
        loadingTransactionsRef.current = false;
        if (repositoryGuard.isCurrent()) setLoadingTransactions(false);
      }
    },
    [ownerId, repositoryGuard, t],
  );

  const loadMoreTransactions = useCallback(async () => {
    if (walletVisualAcceptanceEnabled) return;
    const cursor = transactionPage.next_cursor?.trim();
    if (
      !ownerId ||
      !cursor ||
      loadingTransactionsRef.current ||
      requestedCursors.current.has(cursor)
    )
      return;
    requestedCursors.current.add(cursor);
    loadingTransactionsRef.current = true;
    transactionEpochRef.current += 1;
    setLoadingTransactions(true);
    setTransactionError(null);
    try {
      const value = await loadMoreWalletTransactions(ownerId, transactionPage, repositoryGuard);
      if (!repositoryGuard.isCurrent()) return;
      const nextCursor = value.next_cursor?.trim();
      setTransactionPage(
        nextCursor && requestedCursors.current.has(nextCursor)
          ? { ...value, next_cursor: undefined }
          : value,
      );
    } catch (error) {
      if (error instanceof WalletRepositoryAccountChangedError) return;
      requestedCursors.current.delete(cursor);
      setTransactionError(t("wallet.transactions.loadFailedWithError", errorMessage(error)));
    } finally {
      loadingTransactionsRef.current = false;
      if (repositoryGuard.isCurrent()) setLoadingTransactions(false);
    }
  }, [ownerId, repositoryGuard, t, transactionPage]);

  const refreshActivityCatFoodTransactions = useCallback(
    async (reset = true) => {
      if (
        !ownerId ||
        !isActivityCatFoodEnabled ||
        loadingActivityCatFoodTransactionsRef.current ||
        (!reset && !activityCatFoodPage.next_cursor)
      )
        return;
      loadingActivityCatFoodTransactionsRef.current = true;
      setLoadingActivityCatFoodTransactions(true);
      if (reset) setActivityCatFoodTransactionError(null);
      try {
        const page = await loadActivityCatFoodTransactionPage(
          reset ? undefined : activityCatFoodPage.next_cursor,
        );
        if (!repositoryGuard.isCurrent()) return;
        setActivityCatFoodPage((current) =>
          reset ? page : appendActivityCatFoodTransactionPage(current, page),
        );
        setActivityCatFoodTransactionError(null);
      } catch (error) {
        if (!repositoryGuard.isCurrent()) return;
        if (isActivityCatFoodDisabledError(error)) {
          setActivityCatFoodDisabledByServer(true);
          setActivityCatFoodPage({ items: [] });
          setActivityCatFoodTransactionError(null);
        } else {
          setActivityCatFoodTransactionError(errorMessage(error));
        }
      } finally {
        loadingActivityCatFoodTransactionsRef.current = false;
        if (repositoryGuard.isCurrent()) setLoadingActivityCatFoodTransactions(false);
      }
    },
    [activityCatFoodPage.next_cursor, isActivityCatFoodEnabled, ownerId, repositoryGuard],
  );

  const applyBalance = useCallback(
    async (nextBalance: WalletBalanceSnapshot) => {
      if (walletVisualAcceptanceEnabled) {
        setBalance(nextBalance);
        return;
      }
      if (!ownerId || !repositoryGuard.isCurrent()) return;
      balanceEpochRef.current += 1;
      setBalance(nextBalance);
      await persistBalance(ownerId, nextBalance).catch(() => undefined);
    },
    [ownerId, repositoryGuard],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      balance,
      transactions: transactionPage.transactions,
      ...(transactionPage.next_cursor
        ? { transactionNextCursor: transactionPage.next_cursor }
        : {}),
      activityCatFoodTransactions: activityCatFoodPage.items,
      ...(activityCatFoodPage.next_cursor
        ? { activityCatFoodNextCursor: activityCatFoodPage.next_cursor }
        : {}),
      isActivityCatFoodEnabled,
      activityCatFoodDisabledByServer,
      isLoadingBalance,
      isLoadingTransactions,
      isLoadingActivityCatFoodTransactions,
      balanceError,
      transactionError,
      activityCatFoodTransactionError,
      refreshBalance,
      refreshTransactions,
      loadMoreTransactions,
      refreshActivityCatFoodTransactions,
      applyBalance,
    }),
    [
      activityCatFoodDisabledByServer,
      activityCatFoodPage,
      activityCatFoodTransactionError,
      applyBalance,
      balance,
      balanceError,
      isLoadingBalance,
      isLoadingTransactions,
      isLoadingActivityCatFoodTransactions,
      isActivityCatFoodEnabled,
      loadMoreTransactions,
      refreshBalance,
      refreshActivityCatFoodTransactions,
      refreshTransactions,
      transactionError,
      transactionPage,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}
