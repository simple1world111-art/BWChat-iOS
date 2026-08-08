import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { APIError } from "@/api/client";
import type {
  ActivityCatFoodTransaction,
  ActivityCatFoodTransactionPage,
  WalletBalanceSnapshot,
  WalletTransaction,
  WalletTransactionPage,
  WalletWithdrawal,
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
  cancelWalletWithdrawal,
  loadMoreWalletTransactions,
  loadWalletBalance,
  loadWalletTransactions,
  loadWalletWithdrawalList,
  persistBalance,
  readCachedWalletBalance,
  readCachedWalletTransactions,
  readCachedWalletWithdrawals,
  submitWalletWithdrawal,
  WalletRepositoryAccountChangedError,
  type WalletRepositoryAccountGuard,
} from "@/services/wallet/WalletRepository";
import {
  isValidUsdtIncrement,
  isWalletPayoutAccountConfigured,
  maximumUsdtAmount,
  requiredGoldCoins,
  resolveWalletRuntimeConfig,
  withdrawalPolicyFor,
} from "@/services/wallet/walletPolicy";
import {
  walletVisualAcceptanceBalance,
  walletVisualAcceptanceEnabled,
  walletVisualAcceptanceTransactions,
  walletVisualAcceptanceVariant,
  walletVisualAcceptanceWithdrawals,
} from "@/services/visualAcceptance";

interface WalletContextValue {
  balance: WalletBalanceSnapshot | null;
  transactions: WalletTransaction[];
  transactionNextCursor?: string | undefined;
  withdrawals: WalletWithdrawal[];
  activityCatFoodTransactions: ActivityCatFoodTransaction[];
  activityCatFoodNextCursor?: string | undefined;
  isActivityCatFoodEnabled: boolean;
  activityCatFoodDisabledByServer: boolean;
  isLoadingBalance: boolean;
  isLoadingTransactions: boolean;
  isLoadingWithdrawals: boolean;
  isSubmittingWithdrawal: boolean;
  isLoadingActivityCatFoodTransactions: boolean;
  balanceError: string | null;
  transactionError: string | null;
  withdrawalError: string | null;
  activityCatFoodTransactionError: string | null;
  refreshBalance(force?: boolean): Promise<void>;
  refreshTransactions(force?: boolean): Promise<void>;
  loadMoreTransactions(): Promise<void>;
  refreshActivityCatFoodTransactions(reset?: boolean): Promise<void>;
  refreshWithdrawals(force?: boolean): Promise<void>;
  requestWithdrawal(input: {
    goldCoinAmount: number;
    usdtAmount: string;
    network: string;
    walletAddress: string;
  }): Promise<void>;
  cancelWithdrawal(withdrawalId: string): Promise<void>;
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
  const runtime = useMemo(() => resolveWalletRuntimeConfig(config.wallet), [config.wallet]);
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
  const [withdrawals, setWithdrawals] = useState<WalletWithdrawal[]>(() =>
    walletVisualAcceptanceVariant === "wallet-withdrawals-rows"
      ? [...walletVisualAcceptanceWithdrawals]
      : [],
  );
  const [activityCatFoodPage, setActivityCatFoodPage] = useState<ActivityCatFoodTransactionPage>({
    items: [],
  });
  const [activityCatFoodDisabledByServer, setActivityCatFoodDisabledByServer] = useState(false);
  const [isLoadingBalance, setLoadingBalance] = useState(false);
  const [isLoadingTransactions, setLoadingTransactions] = useState(
    walletVisualAcceptanceVariant === "wallet-transactions-loading",
  );
  const [isLoadingWithdrawals, setLoadingWithdrawals] = useState(
    walletVisualAcceptanceVariant === "wallet-withdrawals-loading",
  );
  const [isSubmittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const [isLoadingActivityCatFoodTransactions, setLoadingActivityCatFoodTransactions] =
    useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [transactionError, setTransactionError] = useState<string | null>(() =>
    walletVisualAcceptanceVariant === "wallet-transactions-error"
      ? t("wallet.transactions.loadFailedWithError", "验收错误")
      : null,
  );
  const [withdrawalError, setWithdrawalError] = useState<string | null>(() =>
    walletVisualAcceptanceVariant === "wallet-withdrawals-error"
      ? t("wallet.withdrawals.loadFailedWithError", "验收错误")
      : null,
  );
  const [activityCatFoodTransactionError, setActivityCatFoodTransactionError] = useState<
    string | null
  >(null);
  const requestedCursors = useRef(new Set<string>());
  const loadingBalanceRef = useRef(false);
  const loadingTransactionsRef = useRef(false);
  const loadingWithdrawalsRef = useRef(false);
  const submittingWithdrawalRef = useRef(false);
  const loadingActivityCatFoodTransactionsRef = useRef(false);
  const balanceEpochRef = useRef(0);
  const transactionEpochRef = useRef(0);
  const withdrawalEpochRef = useRef(0);
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
    const withdrawalEpoch = withdrawalEpochRef.current;
    void Promise.all([
      readCachedWalletBalance(ownerId),
      readCachedWalletTransactions(ownerId),
      readCachedWalletWithdrawals(ownerId),
    ]).then(([cachedBalance, cachedTransactions, cachedWithdrawals]) => {
      if (!repositoryGuard.isCurrent()) return;
      if (cachedBalance && balanceEpochRef.current === balanceEpoch) setBalance(cachedBalance);
      if (cachedTransactions && transactionEpochRef.current === transactionEpoch) {
        setTransactionPage(cachedTransactions);
      }
      if (cachedWithdrawals && withdrawalEpochRef.current === withdrawalEpoch) {
        setWithdrawals(cachedWithdrawals);
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

  const refreshWithdrawals = useCallback(
    async (force = false) => {
      if (walletVisualAcceptanceEnabled) return;
      if (!ownerId || loadingWithdrawalsRef.current) return;
      loadingWithdrawalsRef.current = true;
      withdrawalEpochRef.current += 1;
      setLoadingWithdrawals(true);
      setWithdrawalError(null);
      try {
        const result = await loadWalletWithdrawalList(ownerId, force, repositoryGuard);
        if (!repositoryGuard.isCurrent()) return;
        setWithdrawals(result.value);
      } catch (error) {
        if (error instanceof WalletRepositoryAccountChangedError) return;
        setWithdrawalError(
          isMissingWithdrawalEndpoint(error)
            ? t("wallet.withdrawal.serviceUnavailable")
            : t("wallet.withdrawals.loadFailedWithError", errorMessage(error)),
        );
      } finally {
        loadingWithdrawalsRef.current = false;
        if (repositoryGuard.isCurrent()) setLoadingWithdrawals(false);
      }
    },
    [ownerId, repositoryGuard, t],
  );

  const requestWithdrawal = useCallback(
    async (input: {
      goldCoinAmount: number;
      usdtAmount: string;
      network: string;
      walletAddress: string;
    }) => {
      if (walletVisualAcceptanceEnabled) return;
      if (!ownerId || submittingWithdrawalRef.current) return;
      validateWithdrawalInput(input, balance, runtime, t);
      submittingWithdrawalRef.current = true;
      setSubmittingWithdrawal(true);
      setWithdrawalError(null);
      try {
        await submitWalletWithdrawal(ownerId, input, repositoryGuard);
        if (!repositoryGuard.isCurrent()) return;
        await Promise.all([refreshBalance(), refreshWithdrawals()]);
      } finally {
        submittingWithdrawalRef.current = false;
        if (repositoryGuard.isCurrent()) setSubmittingWithdrawal(false);
      }
    },
    [balance, ownerId, refreshBalance, refreshWithdrawals, repositoryGuard, runtime, t],
  );

  const cancelWithdrawal = useCallback(
    async (withdrawalId: string) => {
      if (walletVisualAcceptanceEnabled) return;
      if (!ownerId || submittingWithdrawalRef.current) return;
      submittingWithdrawalRef.current = true;
      setSubmittingWithdrawal(true);
      setWithdrawalError(null);
      try {
        await cancelWalletWithdrawal(ownerId, withdrawalId, repositoryGuard);
        if (!repositoryGuard.isCurrent()) return;
        await Promise.all([refreshBalance(), refreshWithdrawals()]);
      } finally {
        submittingWithdrawalRef.current = false;
        if (repositoryGuard.isCurrent()) setSubmittingWithdrawal(false);
      }
    },
    [ownerId, refreshBalance, refreshWithdrawals, repositoryGuard],
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
      withdrawals,
      activityCatFoodTransactions: activityCatFoodPage.items,
      ...(activityCatFoodPage.next_cursor
        ? { activityCatFoodNextCursor: activityCatFoodPage.next_cursor }
        : {}),
      isActivityCatFoodEnabled,
      activityCatFoodDisabledByServer,
      isLoadingBalance,
      isLoadingTransactions,
      isLoadingWithdrawals,
      isSubmittingWithdrawal,
      isLoadingActivityCatFoodTransactions,
      balanceError,
      transactionError,
      withdrawalError,
      activityCatFoodTransactionError,
      refreshBalance,
      refreshTransactions,
      loadMoreTransactions,
      refreshActivityCatFoodTransactions,
      refreshWithdrawals,
      requestWithdrawal,
      cancelWithdrawal,
      applyBalance,
    }),
    [
      activityCatFoodDisabledByServer,
      activityCatFoodPage,
      activityCatFoodTransactionError,
      applyBalance,
      balance,
      balanceError,
      cancelWithdrawal,
      isLoadingBalance,
      isLoadingTransactions,
      isLoadingWithdrawals,
      isLoadingActivityCatFoodTransactions,
      isActivityCatFoodEnabled,
      isSubmittingWithdrawal,
      loadMoreTransactions,
      refreshBalance,
      refreshActivityCatFoodTransactions,
      refreshTransactions,
      refreshWithdrawals,
      requestWithdrawal,
      transactionError,
      transactionPage,
      withdrawalError,
      withdrawals,
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

function isMissingWithdrawalEndpoint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

function validateWithdrawalInput(
  input: {
    goldCoinAmount: number;
    usdtAmount: string;
    network: string;
    walletAddress: string;
  },
  balance: WalletBalanceSnapshot | null,
  runtime: ReturnType<typeof resolveWalletRuntimeConfig>,
  t: (key: string, ...args: (string | number)[]) => string,
): void {
  const withdrawableGoldCoins = Math.max(balance?.withdrawable_gold_coin_balance ?? 0, 0);
  if (!Number.isInteger(input.goldCoinAmount) || input.goldCoinAmount <= 0) {
    throw walletValidationError(t("wallet.withdrawal.amount.invalid"), "invalid_withdrawal_amount");
  }
  if (input.goldCoinAmount > withdrawableGoldCoins) {
    throw walletValidationError(
      t("wallet.withdrawal.amount.insufficientGoldCoins"),
      "insufficient_withdrawable_gold_coin_balance",
    );
  }

  const policy = withdrawalPolicyFor(runtime, input.network);
  const requestedUsdt = Number(input.usdtAmount);
  if (
    !Number.isFinite(requestedUsdt) ||
    requestedUsdt + 0.000_000_1 < policy.minimumUsdt ||
    !isValidUsdtIncrement(policy, requestedUsdt) ||
    requestedUsdt > maximumUsdtAmount(policy, withdrawableGoldCoins) + 0.000_000_1 ||
    input.goldCoinAmount !== requiredGoldCoins(policy, requestedUsdt)
  ) {
    throw walletValidationError(t("wallet.withdrawal.amount.invalid"), "invalid_withdrawal_amount");
  }
  if (!isWalletPayoutAccountConfigured(input.network, input.walletAddress)) {
    throw walletValidationError(t("wallet.withdrawal.usdt.required"), "payout_account_required");
  }
}

function walletValidationError(message: string, code: string): APIError {
  return new APIError(message, 400, { code }, code);
}
