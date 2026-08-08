import { AdEventType, RewardedAd, RewardedAdEventType } from "react-native-google-mobile-ads";

import {
  acquireRewardedAdPresentation,
  releaseRewardedAdPresentation,
} from "@/services/ads/RewardedAdPresentationGate";
import { prepareRewardedAdSDK } from "@/services/ads/RewardedAdSDK";
import {
  rewardedAdErrorCodes,
  type GameRewardedAdRequest,
  type GameRewardedAdResult,
} from "@/services/games/GameBridge";
import { resolveWalletRuntimeConfig } from "@/services/wallet/walletPolicy";

const productionGameAdUnitID = "ca-app-pub-1877504503518465/1011630693";
const iosTestGameAdUnitID = "ca-app-pub-3940256099942544/1712485313";
const gameAdLoadTimeoutMilliseconds = 2_500;
const gameAdMaximumAgeMilliseconds = 50 * 60 * 1_000;

type GameRewardedAd = ReturnType<typeof RewardedAd.createForAdRequest>;
type CachedGameRewardedAd = { ad: GameRewardedAd; loadedAt: number };
type GameRewardedAdLoad = {
  promise: Promise<CachedGameRewardedAd | undefined>;
  cancel(): void;
};

let activeRequestID: string | undefined;
const cachedAds = new Map<string, CachedGameRewardedAd>();
const loadingAds = new Map<string, GameRewardedAdLoad>();
const loadErrors = new Map<string, unknown>();

export async function prepareGameRewardedAds(adUnitIDs: readonly string[] = []): Promise<boolean> {
  if (!(await prepareRewardedAdSDK())) return false;
  for (const adUnitID of new Set(adUnitIDs.filter((value) => Boolean(value.trim())))) {
    await ensureGameRewardedAdIsCached(adUnitID);
  }
  return true;
}

export function gameRewardedAdUnitAllowlist(
  walletConfig: unknown,
  isDevelopment: boolean,
): string[] {
  const configured = resolveWalletRuntimeConfig(walletConfig).iosAdUnitIds;
  if (configured.length > 0) return [...new Set(configured)];
  return isDevelopment ? [iosTestGameAdUnitID, productionGameAdUnitID] : [productionGameAdUnitID];
}

export async function presentGameRewardedAd(
  request: GameRewardedAdRequest,
): Promise<GameRewardedAdResult> {
  const presentationOwner = `game:${request.requestID}`;
  if (activeRequestID || !acquireRewardedAdPresentation(presentationOwner)) {
    return result(request, "unavailable", rewardedAdErrorCodes.alreadyShowing);
  }
  activeRequestID = request.requestID;
  try {
    if (!(await prepareGameRewardedAds())) {
      return result(request, "unavailable", rewardedAdErrorCodes.sdkNotInitialized);
    }
    const cached = await ensureGameRewardedAdIsCached(request.adUnitID);
    if (!cached) return loadFailureResult(request, loadErrors.get(request.adUnitID));
    cachedAds.delete(request.adUnitID);
    return await presentCachedAd(cached.ad, request);
  } finally {
    if (activeRequestID === request.requestID) activeRequestID = undefined;
    releaseRewardedAdPresentation(presentationOwner);
  }
}

function presentCachedAd(
  ad: GameRewardedAd,
  request: GameRewardedAdRequest,
): Promise<GameRewardedAdResult> {
  return new Promise((resolve) => {
    let earned = false;
    let shown = false;
    let settled = false;
    const cleanups: (() => void)[] = [];

    const finish = (value: GameRewardedAdResult) => {
      if (settled) return;
      settled = true;
      for (const cleanup of cleanups) cleanup();
      ad.removeAllListeners();
      resolve(value);
      void ensureGameRewardedAdIsCached(request.adUnitID);
    };

    cleanups.push(
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      }),
    );
    cleanups.push(
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        finish(result(request, earned ? "completed" : "dismissed"));
      }),
    );
    cleanups.push(
      ad.addAdEventListener(AdEventType.ERROR, (error) => {
        if (earned) {
          finish(result(request, "completed"));
          return;
        }
        finish(
          shown
            ? result(request, "failed", rewardedAdErrorCodes.presentFailed)
            : loadFailureResult(request, error),
        );
      }),
    );

    shown = true;
    void ad
      .show({
        serverSideVerificationOptions: {
          userId: request.ssvUserID,
          customData: request.ssvCustomData,
        },
      })
      .catch((error: unknown) => {
        finish(
          earned
            ? result(request, "completed")
            : presenterUnavailable(error)
              ? result(request, "unavailable", rewardedAdErrorCodes.presenterUnavailable)
              : result(request, "failed", rewardedAdErrorCodes.presentFailed),
        );
      });
  });
}

function ensureGameRewardedAdIsCached(adUnitID: string): Promise<CachedGameRewardedAd | undefined> {
  const cached = cachedAds.get(adUnitID);
  if (cached && Date.now() - cached.loadedAt < gameAdMaximumAgeMilliseconds) {
    return Promise.resolve(cached);
  }
  if (cached) {
    cached.ad.removeAllListeners();
    cachedAds.delete(adUnitID);
  }
  const active = loadingAds.get(adUnitID);
  if (active) return active.promise;
  const operation = loadGameRewardedAd(adUnitID);
  loadingAds.set(adUnitID, operation);
  void operation.promise.finally(() => {
    if (loadingAds.get(adUnitID) === operation) loadingAds.delete(adUnitID);
  });
  return operation.promise;
}

function loadGameRewardedAd(adUnitID: string): GameRewardedAdLoad {
  let cancel: () => void = () => undefined;
  const promise = new Promise<CachedGameRewardedAd | undefined>((resolve) => {
    const ad = RewardedAd.createForAdRequest(adUnitID);
    let settled = false;
    const cleanups: (() => void)[] = [];
    const finish = (value: CachedGameRewardedAd | undefined, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      for (const cleanup of cleanups) cleanup();
      if (value) {
        cachedAds.set(adUnitID, value);
        loadErrors.delete(adUnitID);
      } else {
        ad.removeAllListeners();
        loadErrors.set(adUnitID, error);
      }
      resolve(value);
    };
    const timeout = setTimeout(
      () => finish(undefined, new Error("game_rewarded_ad_load_timeout")),
      gameAdLoadTimeoutMilliseconds,
    );
    cancel = () => finish(undefined, new Error("game_rewarded_ad_load_cancelled"));
    cleanups.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        finish({ ad, loadedAt: Date.now() });
      }),
    );
    cleanups.push(ad.addAdEventListener(AdEventType.ERROR, (error) => finish(undefined, error)));
    ad.load();
  });
  return { promise, cancel: () => cancel() };
}

function loadFailureResult(request: GameRewardedAdRequest, error: unknown): GameRewardedAdResult {
  return noFillError(error)
    ? result(request, "unavailable", rewardedAdErrorCodes.noFill)
    : result(request, "failed", rewardedAdErrorCodes.loadFailed);
}

function noFillError(error: unknown): boolean {
  const code = errorValue(error, "code");
  const message = error instanceof Error ? error.message : errorValue(error, "message");
  const normalized = `${code} ${message}`.toLowerCase();
  return normalized.includes("no-fill") || code.endsWith("/no-fill");
}

function presenterUnavailable(error: unknown): boolean {
  const normalized = `${errorValue(error, "code")} ${
    error instanceof Error ? error.message : errorValue(error, "message")
  }`.toLowerCase();
  return (
    normalized.includes("nil-vc") ||
    normalized.includes("presenter") ||
    normalized.includes("view controller was nil")
  );
}

function errorValue(error: unknown, key: "code" | "message"): string {
  return typeof error === "object" && error !== null && key in error
    ? String((error as Record<string, unknown>)[key] ?? "")
    : "";
}

export function resetGameRewardedAdsForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  for (const cached of cachedAds.values()) cached.ad.removeAllListeners();
  for (const loading of loadingAds.values()) loading.cancel();
  cachedAds.clear();
  loadingAds.clear();
  loadErrors.clear();
  activeRequestID = undefined;
}

function result(
  request: GameRewardedAdRequest,
  status: GameRewardedAdResult["status"],
  errorCode?: string,
): GameRewardedAdResult {
  return {
    request_id: request.requestID,
    session_id: request.sessionID,
    status,
    ...(errorCode ? { error_code: errorCode } : {}),
  };
}
