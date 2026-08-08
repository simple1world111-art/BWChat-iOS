import { AdEventType, RewardedAd, RewardedAdEventType } from "react-native-google-mobile-ads";

import {
  prepareWalletRewardedAd,
  presentWalletRewardedAd,
  resetWalletRewardedAdClientForTests,
  retainWalletRewardedAd,
  takeWalletRewardedAd,
} from "@/services/wallet/WalletRewardedAdClient";

jest.mock("react-native-google-mobile-ads", () => ({
  AdEventType: { CLOSED: "closed", ERROR: "error" },
  RewardedAdEventType: { LOADED: "loaded", EARNED_REWARD: "earned" },
  RewardedAd: { createForAdRequest: jest.fn() },
}));

type Listener = (value?: unknown) => void;
type FakeAd = {
  listeners: Map<string, Listener>;
  addAdEventListener: jest.Mock<() => void, [string, Listener]>;
  load: jest.Mock<void, []>;
  removeAllListeners: jest.Mock<void, []>;
  show: jest.Mock<Promise<void>, [unknown?]>;
};

const createAd = jest.mocked(RewardedAd.createForAdRequest);
const ads: FakeAd[] = [];

describe("wallet rewarded-ad preload and SSV lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetWalletRewardedAdClientForTests();
    ads.length = 0;
    createAd.mockImplementation(() => {
      const ad = fakeAd();
      ads.push(ad);
      return ad as unknown as ReturnType<typeof RewardedAd.createForAdRequest>;
    });
  });

  afterEach(() => resetWalletRewardedAdClientForTests());

  it("single-flights preload without SSV and consumes the same loaded ad", async () => {
    const first = prepareWalletRewardedAd("unit-a", "owner-a");
    const second = prepareWalletRewardedAd("unit-a", "owner-a");
    expect(ads).toHaveLength(1);
    expect(currentAd().load).toHaveBeenCalledTimes(1);
    expect(createAd).toHaveBeenCalledWith("unit-a");

    emit(currentAd(), RewardedAdEventType.LOADED);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    await expect(prepareWalletRewardedAd("unit-a", "owner-a")).resolves.toBe(true);
    expect(ads).toHaveLength(1);
    await expect(takeWalletRewardedAd("unit-a", "owner-a")).resolves.toBe(ads[0]);
  });

  it("binds the server session SSV only at show time and resolves after earned plus closed", async () => {
    const preparing = prepareWalletRewardedAd("unit-a", "owner-a");
    emit(currentAd(), RewardedAdEventType.LOADED);
    await expect(preparing).resolves.toBe(true);
    const ad = await takeWalletRewardedAd("unit-a", "owner-a");
    expect(ad).toBeDefined();

    const pending = presentWalletRewardedAd(ad!, {
      userId: "owner-a",
      customData: "signed-session",
    });
    expect(currentAd().show).toHaveBeenCalledWith({
      serverSideVerificationOptions: {
        userId: "owner-a",
        customData: "signed-session",
      },
    });
    emit(currentAd(), RewardedAdEventType.EARNED_REWARD);
    emit(currentAd(), AdEventType.CLOSED);
    await expect(pending).resolves.toBe(true);
  });

  it("retains an unshown ad after a retryable session failure", async () => {
    const preparing = prepareWalletRewardedAd("unit-a", "owner-a");
    emit(currentAd(), RewardedAdEventType.LOADED);
    await preparing;
    const ad = await takeWalletRewardedAd("unit-a", "owner-a");
    expect(ad).toBeDefined();

    retainWalletRewardedAd(ad!, "unit-a", "owner-a");
    await expect(takeWalletRewardedAd("unit-a", "owner-a")).resolves.toBe(ad);
    expect(ads).toHaveLength(1);
  });

  it("invalidates the old account cache before loading for a new owner", async () => {
    const first = prepareWalletRewardedAd("unit-a", "owner-a");
    emit(currentAd(), RewardedAdEventType.LOADED);
    await first;

    const second = prepareWalletRewardedAd("unit-a", "owner-b");
    expect(ads).toHaveLength(2);
    emit(currentAd(), RewardedAdEventType.LOADED);
    await expect(second).resolves.toBe(true);
    await expect(prepareWalletRewardedAd("unit-a", "owner-b")).resolves.toBe(true);
    await expect(takeWalletRewardedAd("unit-a", "owner-b")).resolves.toBe(ads[1]);
    expect(ads).toHaveLength(2);
  });

  it("clears a failed load so a later preload can retry with a fresh ad", async () => {
    const failed = prepareWalletRewardedAd("unit-a", "owner-a");
    emit(currentAd(), AdEventType.ERROR, new Error("no fill"));
    await expect(failed).resolves.toBe(false);

    const retry = prepareWalletRewardedAd("unit-a", "owner-a");
    expect(ads).toHaveLength(2);
    emit(currentAd(), RewardedAdEventType.LOADED);
    await expect(retry).resolves.toBe(true);
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

function emit(ad: FakeAd, event: string, value?: unknown): void {
  ad.listeners.get(event)?.(value);
}
