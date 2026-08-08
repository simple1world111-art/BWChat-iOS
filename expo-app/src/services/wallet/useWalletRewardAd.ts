import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Platform } from "react-native";

import { createWalletAdRewardSession, getWalletAdRewardStatus } from "@/api/bwchat";
import { APIError } from "@/api/client";
import {
  acquireRewardedAdPresentation,
  releaseRewardedAdPresentation,
  rewardedAdPresentationInFlight,
} from "@/services/ads/RewardedAdPresentationGate";
import { prepareRewardedAdSDK } from "@/services/ads/RewardedAdSDK";
import type { WalletAdRewardStatus } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { useWallet } from "@/providers/WalletProvider";
import { env } from "@/config/env";
import { featureFlagEnabled } from "@/services/remote-config/RemoteConfigService";
import {
  nextShanghaiMidnight,
  pendingRewardResolution,
  resolveWalletRuntimeConfig,
  type WalletPendingRewardCredit,
  walletMetrics,
  walletRewardedAdUnitId,
} from "@/services/wallet/walletPolicy";
import { walletVisualAcceptanceEnabled } from "@/services/visualAcceptance";
import {
  localWalletAdRemaining,
  readPendingWalletAdReward,
  recordLocalWalletAdReward,
  removePendingWalletAdReward,
  savePendingWalletAdReward,
} from "@/services/wallet/WalletAdRewardStore";
import {
  discardWalletRewardedAd,
  prepareWalletRewardedAd,
  presentWalletRewardedAd,
  retainWalletRewardedAd,
  takeWalletRewardedAd,
} from "@/services/wallet/WalletRewardedAdClient";

export interface WalletRewardAdController {
  isConfigured: boolean;
  isAvailable: boolean;
  isBusy: boolean;
  isAwaitingServerCredit: boolean;
  remainingCount: number;
  error: string | null;
  sync(): Promise<void>;
  present(): Promise<"earned" | "closed" | "failed" | "unavailable">;
  clearError(): void;
}

export function useWalletRewardAd(): WalletRewardAdController {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const { config } = useRemoteConfig();
  const { refreshBalance, refreshTransactions } = useWallet();
  const runtime = useMemo(() => resolveWalletRuntimeConfig(config.wallet), [config.wallet]);
  const isDevelopment = env.environment === "development";
  const isConfigured =
    walletVisualAcceptanceEnabled ||
    isDevelopment ||
    (runtime.adRewardEnabled &&
      runtime.adRewardsGoldCoins &&
      featureFlagEnabled(config, "wallet_ad_reward_delivery", ownerId, false));
  const [serverEnabled, setServerEnabled] = useState(
    walletVisualAcceptanceEnabled || isDevelopment,
  );
  const [remainingCount, setRemainingCount] = useState<number>(
    walletVisualAcceptanceEnabled ? 0 : walletMetrics.dailyAdLimit,
  );
  const [businessDayResetAt, setBusinessDayResetAt] = useState(nextShanghaiMidnight);
  const [syncedOwnerId, setSyncedOwnerId] = useState(walletVisualAcceptanceEnabled ? ownerId : "");
  const [isSyncing, setSyncing] = useState(false);
  const [isAdPreparing, setAdPreparing] = useState(false);
  const [isPresenting, setPresenting] = useState(false);
  const [isAwaitingServerCredit, setAwaitingServerCredit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasSynced =
    walletVisualAcceptanceEnabled || (Boolean(ownerId) && syncedOwnerId === ownerId);
  const isBusy = isSyncing || isAdPreparing || isPresenting;

  const applyStatus = useCallback(
    async (status: WalletAdRewardStatus, pending?: WalletPendingRewardCredit | undefined) => {
      setServerEnabled(status.enabled);
      setRemainingCount(
        Math.min(Math.max(status.remaining_count, 0), Math.max(status.daily_limit, 0)),
      );
      setBusinessDayResetAt(parseDate(status.next_reset_at) ?? nextShanghaiMidnight());
      if (!pending) return;
      const resolution = pendingRewardResolution(
        pending,
        ownerId,
        status.remaining_count,
        Date.now(),
      );
      if (resolution === "pending") {
        setAwaitingServerCredit(true);
        return;
      }
      await removePendingWalletAdReward(ownerId);
      setAwaitingServerCredit(false);
      if (resolution === "confirmed") {
        await recordLocalWalletAdReward(ownerId);
        await Promise.all([refreshBalance(true), refreshTransactions(true)]);
      }
    },
    [ownerId, refreshBalance, refreshTransactions],
  );

  const sync = useCallback(async () => {
    if (walletVisualAcceptanceEnabled) return;
    if (!ownerId) return;
    setSyncing(true);
    const pending = await readPendingWalletAdReward(ownerId);
    setAwaitingServerCredit(Boolean(pending));
    try {
      const status = await getWalletAdRewardStatus();
      await applyStatus(status, pending);
      setError(null);
    } catch (nextError) {
      setRemainingCount(await localWalletAdRemaining(ownerId));
      setError(errorMessage(nextError));
      if (
        pending &&
        pendingRewardResolution(pending, ownerId, undefined, Date.now()) === "expired"
      ) {
        await removePendingWalletAdReward(ownerId);
        setAwaitingServerCredit(false);
      }
    } finally {
      setSyncing(false);
      setSyncedOwnerId(ownerId);
    }
  }, [applyStatus, ownerId]);

  useEffect(() => {
    discardWalletRewardedAd();
  }, [ownerId]);

  useEffect(
    () => () => {
      discardWalletRewardedAd();
    },
    [],
  );

  useEffect(() => {
    const task = setTimeout(() => {
      void sync();
    }, 0);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    return () => {
      clearTimeout(task);
      subscription.remove();
    };
  }, [sync]);

  useEffect(() => {
    const milliseconds = Math.min(
      Math.max(businessDayResetAt - Date.now() + 100, 1_000),
      2_147_483_647,
    );
    const timer = setTimeout(() => {
      setBusinessDayResetAt(nextShanghaiMidnight(Date.now() + 1_000));
      void sync();
    }, milliseconds);
    return () => clearTimeout(timer);
  }, [businessDayResetAt, sync]);

  const prepareAd = useCallback(
    async (force = false): Promise<boolean> => {
      if (
        walletVisualAcceptanceEnabled ||
        !hasSynced ||
        !ownerId ||
        !isConfigured ||
        !serverEnabled ||
        remainingCount <= 0 ||
        isAwaitingServerCredit
      ) {
        return false;
      }
      setAdPreparing(true);
      try {
        if (!(await prepareRewardedAdSDK())) return false;
        const platform = Platform.OS === "android" ? "android" : "ios";
        const adUnitId = walletRewardedAdUnitId(runtime, platform, isDevelopment);
        const prepared = await prepareWalletRewardedAd(adUnitId, ownerId, force);
        if (!prepared) setError("ad-load-failed");
        return prepared;
      } finally {
        setAdPreparing(false);
      }
    },
    [
      hasSynced,
      isAwaitingServerCredit,
      isConfigured,
      isDevelopment,
      ownerId,
      remainingCount,
      runtime,
      serverEnabled,
    ],
  );

  useEffect(() => {
    const task = setTimeout(() => {
      void prepareAd();
    }, 0);
    return () => clearTimeout(task);
  }, [prepareAd]);

  const reconcilePending = useCallback(
    async (pending: WalletPendingRewardCredit) => {
      for (let attempt = 0; attempt < walletMetrics.adCreditPollAttempts; attempt += 1) {
        if (attempt > 0) await delay(walletMetrics.adCreditPollIntervalMs);
        const status = await getWalletAdRewardStatus().catch(() => undefined);
        if (!status) continue;
        await applyStatus(status, pending);
        if (
          pendingRewardResolution(pending, ownerId, status.remaining_count, Date.now()) !==
          "pending"
        )
          break;
      }
      await Promise.all([refreshBalance(true), refreshTransactions(true)]);
    },
    [applyStatus, ownerId, refreshBalance, refreshTransactions],
  );

  const present = useCallback(async (): Promise<"earned" | "closed" | "failed" | "unavailable"> => {
    if (walletVisualAcceptanceEnabled) return "closed";
    if (
      !ownerId ||
      !isConfigured ||
      !serverEnabled ||
      remainingCount <= 0 ||
      isBusy ||
      rewardedAdPresentationInFlight()
    ) {
      return "unavailable";
    }
    const existingPending = await readPendingWalletAdReward(ownerId);
    if (existingPending) {
      setAwaitingServerCredit(true);
      return "unavailable";
    }
    const presentationOwner = `wallet:${ownerId}:${Date.now()}`;
    if (!acquireRewardedAdPresentation(presentationOwner)) return "unavailable";
    setPresenting(true);
    setError(null);
    try {
      if (!(await prepareRewardedAdSDK())) throw new Error("Advertising consent is required.");
      const platform = Platform.OS === "android" ? "android" : "ios";
      const adUnitId = walletRewardedAdUnitId(runtime, platform, isDevelopment);
      const ad = await takeWalletRewardedAd(adUnitId, ownerId);
      if (!ad) throw new Error("ad-load-failed");
      let session: Awaited<ReturnType<typeof createWalletAdRewardSession>>;
      try {
        session = await createWalletAdRewardSession({ adUnitId, platform });
      } catch (sessionError) {
        if (!(sessionError instanceof APIError) || ![403, 429].includes(sessionError.status)) {
          retainWalletRewardedAd(ad, adUnitId, ownerId);
        }
        throw sessionError;
      }
      setBusinessDayResetAt(parseDate(session.next_reset_at) ?? nextShanghaiMidnight());
      if (session.remaining_count <= 0) {
        setRemainingCount(0);
        throw new Error("daily-limit");
      }
      setRemainingCount(session.remaining_count);
      const earned = await presentWalletRewardedAd(ad, {
        userId: ownerId,
        customData: session.ssv_custom_data,
      });
      if (!earned) {
        void prepareWalletRewardedAd(adUnitId, ownerId, true);
        return "closed";
      }
      const pending: WalletPendingRewardCredit = {
        userId: ownerId,
        remainingBefore: Math.max(session.remaining_count, 0),
        businessDayResetAt: parseDate(session.next_reset_at) ?? nextShanghaiMidnight(),
        sessionExpiresAt:
          parseDate(session.expires_at) ?? Date.now() + walletMetrics.adPendingFallbackTtlMs,
      };
      await savePendingWalletAdReward(pending);
      setAwaitingServerCredit(true);
      void reconcilePending(pending);
      return "earned";
    } catch (nextError) {
      if (nextError instanceof APIError && nextError.status === 429) setRemainingCount(0);
      if (nextError instanceof APIError && nextError.status === 403) setServerEnabled(false);
      setError(errorMessage(nextError));
      return "failed";
    } finally {
      setPresenting(false);
      releaseRewardedAdPresentation(presentationOwner);
    }
  }, [
    isBusy,
    isConfigured,
    isDevelopment,
    ownerId,
    remainingCount,
    reconcilePending,
    runtime,
    serverEnabled,
  ]);

  return {
    isConfigured,
    isAvailable: isConfigured && serverEnabled,
    isBusy,
    isAwaitingServerCredit,
    remainingCount: walletVisualAcceptanceEnabled ? 0 : remainingCount,
    error: walletVisualAcceptanceEnabled ? null : error,
    sync,
    present,
    clearError: () => setError(null),
  };
}

function parseDate(value?: string | undefined): number | undefined {
  if (!value) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(value: unknown): string {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "object" && value !== null && "message" in value)
    return String(value.message);
  return "rewarded-ad-failed";
}
