import { AdEventType, RewardedAd, RewardedAdEventType } from "react-native-google-mobile-ads";

type WalletRewardedAd = ReturnType<typeof RewardedAd.createForAdRequest>;

type CachedAd = {
  ad: WalletRewardedAd;
  key: string;
  loadedAt: number;
};

type LoadingAd = {
  generation: number;
  key: string;
  promise: Promise<boolean>;
};

const adFreshnessMilliseconds = 50 * 60 * 1_000;
const adLoadTimeoutMilliseconds = 15_000;

let cache: CachedAd | undefined;
let loading: LoadingAd | undefined;
let generation = 0;

export async function prepareWalletRewardedAd(
  adUnitId: string,
  ownerId: string,
  force = false,
): Promise<boolean> {
  const key = cacheKey(adUnitId, ownerId);
  if (!force && cache?.key === key && Date.now() - cache.loadedAt < adFreshnessMilliseconds) {
    return true;
  }
  if (loading?.key === key) return loading.promise;

  generation += 1;
  const operationGeneration = generation;
  cache = undefined;
  const operation: LoadingAd = {
    generation: operationGeneration,
    key,
    promise: loadRewardedAd(adUnitId).then((ad) => {
      if (generation !== operationGeneration) return false;
      if (ad) cache = { ad, key, loadedAt: Date.now() };
      return Boolean(ad);
    }),
  };
  loading = operation;
  void operation.promise.finally(() => {
    if (loading === operation) loading = undefined;
  });
  return operation.promise;
}

export async function takeWalletRewardedAd(
  adUnitId: string,
  ownerId: string,
): Promise<WalletRewardedAd | undefined> {
  const key = cacheKey(adUnitId, ownerId);
  if (!(await prepareWalletRewardedAd(adUnitId, ownerId))) return undefined;
  if (cache?.key !== key) return undefined;
  const ad = cache.ad;
  cache = undefined;
  return ad;
}

export function retainWalletRewardedAd(
  ad: WalletRewardedAd,
  adUnitId: string,
  ownerId: string,
): void {
  generation += 1;
  cache = { ad, key: cacheKey(adUnitId, ownerId), loadedAt: Date.now() };
}

export function discardWalletRewardedAd(): void {
  generation += 1;
  cache = undefined;
  loading = undefined;
}

export function presentWalletRewardedAd(
  ad: WalletRewardedAd,
  verification: { userId: string; customData: string },
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let earned = false;
    let settled = false;
    const cleanups: (() => void)[] = [];
    const finish = (value?: boolean, failure?: Error) => {
      if (settled) return;
      settled = true;
      for (const cleanup of cleanups) cleanup();
      ad.removeAllListeners();
      if (failure && !earned) reject(failure);
      else resolve(earned || Boolean(value));
    };
    cleanups.push(
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      }),
    );
    cleanups.push(ad.addAdEventListener(AdEventType.CLOSED, () => finish(earned)));
    cleanups.push(
      ad.addAdEventListener(AdEventType.ERROR, (failure) => finish(undefined, asError(failure))),
    );
    void ad
      .show({
        serverSideVerificationOptions: verification,
      })
      .catch((failure: unknown) => finish(undefined, asError(failure)));
  });
}

export function resetWalletRewardedAdClientForTests(): void {
  discardWalletRewardedAd();
}

function loadRewardedAd(adUnitId: string): Promise<WalletRewardedAd | undefined> {
  return new Promise((resolve) => {
    const ad = RewardedAd.createForAdRequest(adUnitId);
    let settled = false;
    const cleanups: (() => void)[] = [];
    const timeout = setTimeout(() => finish(undefined), adLoadTimeoutMilliseconds);
    const finish = (value?: WalletRewardedAd) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      for (const cleanup of cleanups) cleanup();
      ad.removeAllListeners();
      resolve(value);
    };
    cleanups.push(ad.addAdEventListener(RewardedAdEventType.LOADED, () => finish(ad)));
    cleanups.push(ad.addAdEventListener(AdEventType.ERROR, () => finish(undefined)));
    ad.load();
  });
}

function cacheKey(adUnitId: string, ownerId: string): string {
  return `${ownerId}\u0000${adUnitId}`;
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "object" && value !== null && "message" in value) {
    return new Error(String(value.message));
  }
  return new Error("rewarded-ad-failed");
}
