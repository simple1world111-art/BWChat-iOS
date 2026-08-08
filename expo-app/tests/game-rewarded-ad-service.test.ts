import { AdEventType, RewardedAd, RewardedAdEventType } from "react-native-google-mobile-ads";

import { prepareRewardedAdSDK } from "@/services/ads/RewardedAdSDK";
import { resetRewardedAdPresentationGateForTests } from "@/services/ads/RewardedAdPresentationGate";
import { rewardedAdErrorCodes, type GameRewardedAdRequest } from "@/services/games/GameBridge";
import {
  prepareGameRewardedAds,
  presentGameRewardedAd,
  resetGameRewardedAdsForTests,
} from "@/services/games/GameRewardedAdService";

jest.mock("react-native-google-mobile-ads", () => ({
  AdEventType: { CLOSED: "closed", ERROR: "error" },
  RewardedAdEventType: { LOADED: "loaded", EARNED_REWARD: "earned" },
  RewardedAd: { createForAdRequest: jest.fn() },
}));
jest.mock("@/services/ads/RewardedAdSDK", () => ({ prepareRewardedAdSDK: jest.fn() }));

type Listener = (value?: never) => void;
type FakeAd = {
  listeners: Map<string, Listener>;
  addAdEventListener: jest.Mock<() => void, [string, Listener]>;
  load: jest.Mock<void, []>;
  removeAllListeners: jest.Mock<void, []>;
  show: jest.Mock<Promise<void>, [unknown?]>;
};

const createAd = jest.mocked(RewardedAd.createForAdRequest);
const prepareSDK = jest.mocked(prepareRewardedAdSDK);
const ads: FakeAd[] = [];

describe("game rewarded-ad SDK lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGameRewardedAdsForTests();
    resetRewardedAdPresentationGateForTests();
    ads.length = 0;
    prepareSDK.mockResolvedValue(true);
    createAd.mockImplementation(() => {
      const ad = fakeAd();
      ads.push(ad);
      return ad as unknown as ReturnType<typeof RewardedAd.createForAdRequest>;
    });
  });

  afterEach(() => {
    resetGameRewardedAdsForTests();
  });

  it("loads once, binds request-specific SSV only at show time, then completes after earned+dismissed", async () => {
    const pending = presentGameRewardedAd(request());
    await flushTasks();

    expect(createAd).toHaveBeenCalledWith(request().adUnitID);
    expect(currentAd().load).toHaveBeenCalledTimes(1);
    expect(currentAd().show).not.toHaveBeenCalled();
    emit(currentAd(), RewardedAdEventType.LOADED);
    await flushTasks();
    expect(currentAd().show).toHaveBeenCalledWith({
      serverSideVerificationOptions: {
        userId: request().ssvUserID,
        customData: request().ssvCustomData,
      },
    });
    const presented = currentAd();
    emit(presented, RewardedAdEventType.EARNED_REWARD);
    emit(presented, AdEventType.CLOSED);

    await expect(pending).resolves.toMatchObject({ status: "completed" });
    expect(presented.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(ads).toHaveLength(2);
    expect(currentAd().load).toHaveBeenCalledTimes(1);
  });

  it("single-flights preload and consumes the cached ad without loading again", async () => {
    const first = prepareGameRewardedAds([request().adUnitID, request().adUnitID]);
    const second = prepareGameRewardedAds([request().adUnitID]);
    await flushTasks();
    expect(ads).toHaveLength(1);
    emit(currentAd(), RewardedAdEventType.LOADED);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);

    const cached = currentAd();
    const pending = presentGameRewardedAd(request());
    await flushTasks();
    expect(ads).toHaveLength(1);
    expect(cached.show).toHaveBeenCalledTimes(1);
    emit(cached, AdEventType.CLOSED);
    await expect(pending).resolves.toMatchObject({ status: "dismissed" });
  });

  it("keeps an earned terminal result completed after a late presentation error", async () => {
    const pending = presentGameRewardedAd(request());
    await flushTasks();
    const presented = currentAd();
    emit(presented, RewardedAdEventType.LOADED);
    await flushTasks();
    emit(presented, RewardedAdEventType.EARNED_REWARD);
    emit(presented, AdEventType.ERROR, new Error("late") as never);
    await expect(pending).resolves.toMatchObject({ status: "completed" });
  });

  it("keeps an earned terminal result completed if show rejects after the earned callback", async () => {
    const pending = presentGameRewardedAd(request());
    await flushTasks();
    const loading = currentAd();
    loading.show.mockImplementationOnce(async () => {
      emit(loading, RewardedAdEventType.EARNED_REWARD);
      throw new Error("late show rejection");
    });
    emit(loading, RewardedAdEventType.LOADED);
    await expect(pending).resolves.toMatchObject({ status: "completed" });
  });

  it("maps no-fill to unavailable and rejects a concurrent game presentation", async () => {
    const first = presentGameRewardedAd(request());
    await flushTasks();
    await expect(
      presentGameRewardedAd(request("223e4567-e89b-42d3-a456-426614174000")),
    ).resolves.toMatchObject({
      status: "unavailable",
      error_code: rewardedAdErrorCodes.alreadyShowing,
    });
    emit(currentAd(), AdEventType.ERROR, {
      code: "googleMobileAds/error-code-no-fill",
      message: "No fill",
    } as never);
    await expect(first).resolves.toMatchObject({
      status: "unavailable",
      error_code: rewardedAdErrorCodes.noFill,
    });
  });

  it("uses the native 2.5-second load timeout and returns the stable load error", async () => {
    jest.useFakeTimers();
    try {
      const pending = presentGameRewardedAd(request());
      await flushTasks();
      await jest.advanceTimersByTimeAsync(2_500);
      await expect(pending).resolves.toMatchObject({
        status: "failed",
        error_code: rewardedAdErrorCodes.loadFailed,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("maps a missing iOS presenter to the native stable error code", async () => {
    const pending = presentGameRewardedAd(request());
    await flushTasks();
    const loading = currentAd();
    loading.show.mockRejectedValueOnce({ code: "nil-vc", message: "View Controller was nil" });
    emit(loading, RewardedAdEventType.LOADED);
    await expect(pending).resolves.toMatchObject({
      status: "unavailable",
      error_code: rewardedAdErrorCodes.presenterUnavailable,
    });
  });

  it("returns sdk-not-initialized without creating or loading an ad", async () => {
    prepareSDK.mockResolvedValue(false);
    await expect(presentGameRewardedAd(request())).resolves.toMatchObject({
      status: "unavailable",
      error_code: rewardedAdErrorCodes.sdkNotInitialized,
    });
    expect(createAd).not.toHaveBeenCalled();
  });
});

function fakeAd(): FakeAd {
  const listeners = new Map<string, Listener>();
  return {
    listeners,
    addAdEventListener: jest.fn((event, listener) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    }),
    load: jest.fn(),
    removeAllListeners: jest.fn(() => listeners.clear()),
    show: jest.fn(async () => undefined),
  };
}

function currentAd(): FakeAd {
  const ad = ads.at(-1);
  if (!ad) throw new Error("Expected a fake rewarded ad");
  return ad;
}

function emit(ad: FakeAd, event: string, value?: never): void {
  ad.listeners.get(event)?.(value);
}

function request(requestID = "123e4567-e89b-42d3-a456-426614174000"): GameRewardedAdRequest {
  return {
    type: "bwchat.game.show_rewarded_ad",
    version: 1,
    source: "just_clear",
    placement: "revive",
    requestID,
    sessionID: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    adUnitID: "ca-app-pub-1877504503518465/1011630693",
    ssvUserID: "owner-a",
    ssvCustomData: "signed-data",
  };
}

async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
