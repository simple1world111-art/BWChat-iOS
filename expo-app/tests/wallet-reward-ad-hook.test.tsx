import { act, renderHook, waitFor } from "@testing-library/react-native";

import { createWalletAdRewardSession, getWalletAdRewardStatus } from "@/api/bwchat";
import { APIError } from "@/api/client";
import { useAuth } from "@/providers/AuthProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { useWallet } from "@/providers/WalletProvider";
import {
  acquireRewardedAdPresentation,
  releaseRewardedAdPresentation,
  rewardedAdPresentationInFlight,
} from "@/services/ads/RewardedAdPresentationGate";
import { prepareRewardedAdSDK } from "@/services/ads/RewardedAdSDK";
import {
  readPendingWalletAdReward,
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
import { useWalletRewardAd } from "@/services/wallet/useWalletRewardAd";

jest.mock("@/api/bwchat", () => ({
  createWalletAdRewardSession: jest.fn(),
  getWalletAdRewardStatus: jest.fn(),
}));
jest.mock("@/providers/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("@/providers/RemoteConfigProvider", () => ({ useRemoteConfig: jest.fn() }));
jest.mock("@/providers/WalletProvider", () => ({ useWallet: jest.fn() }));
jest.mock("@/config/env", () => ({ env: { environment: "development" } }));
jest.mock("@/services/remote-config/RemoteConfigService", () => ({
  featureFlagEnabled: jest.fn(() => true),
}));
jest.mock("@/services/visualAcceptance", () => ({
  walletVisualAcceptanceEnabled: false,
}));
jest.mock("@/services/ads/RewardedAdPresentationGate", () => ({
  acquireRewardedAdPresentation: jest.fn(() => true),
  releaseRewardedAdPresentation: jest.fn(),
  rewardedAdPresentationInFlight: jest.fn(() => false),
}));
jest.mock("@/services/ads/RewardedAdSDK", () => ({ prepareRewardedAdSDK: jest.fn() }));
jest.mock("@/services/wallet/WalletAdRewardStore", () => ({
  localWalletAdRemaining: jest.fn(async () => 10),
  readPendingWalletAdReward: jest.fn(),
  recordLocalWalletAdReward: jest.fn(),
  removePendingWalletAdReward: jest.fn(),
  savePendingWalletAdReward: jest.fn(),
}));
jest.mock("@/services/wallet/WalletRewardedAdClient", () => ({
  discardWalletRewardedAd: jest.fn(),
  prepareWalletRewardedAd: jest.fn(),
  presentWalletRewardedAd: jest.fn(),
  retainWalletRewardedAd: jest.fn(),
  takeWalletRewardedAd: jest.fn(),
}));

const owner = { user_id: "owner-a" };
const ad = { opaque: "loaded-ad" };
const status = {
  enabled: true,
  daily_limit: 10,
  watched_count: 2,
  remaining_count: 8,
  next_reset_at: "2026-08-09T16:00:00Z",
};
const session = {
  session_id: "session-a",
  ssv_custom_data: "signed-session-a",
  remaining_count: 8,
  expires_at: "2026-08-08T12:30:00Z",
  next_reset_at: "2026-08-09T16:00:00Z",
};

describe("useWalletRewardAd native lifecycle orchestration", () => {
  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.mocked(useAuth).mockReturnValue({ user: owner } as ReturnType<typeof useAuth>);
    jest.mocked(useRemoteConfig).mockReturnValue({
      config: { wallet: {} },
    } as ReturnType<typeof useRemoteConfig>);
    jest.mocked(useWallet).mockReturnValue({
      refreshBalance: jest.fn(async () => undefined),
      refreshTransactions: jest.fn(async () => undefined),
    } as unknown as ReturnType<typeof useWallet>);
    jest.mocked(getWalletAdRewardStatus).mockResolvedValue(status);
    jest.mocked(createWalletAdRewardSession).mockResolvedValue(session);
    jest.mocked(prepareRewardedAdSDK).mockResolvedValue(true);
    jest.mocked(readPendingWalletAdReward).mockResolvedValue(undefined);
    jest.mocked(removePendingWalletAdReward).mockResolvedValue();
    jest.mocked(savePendingWalletAdReward).mockResolvedValue();
    jest.mocked(prepareWalletRewardedAd).mockResolvedValue(true);
    jest.mocked(takeWalletRewardedAd).mockResolvedValue(ad as never);
    jest.mocked(presentWalletRewardedAd).mockResolvedValue(false);
    jest.mocked(acquireRewardedAdPresentation).mockReturnValue(true);
    jest.mocked(rewardedAdPresentationInFlight).mockReturnValue(false);
  });

  afterEach(() => jest.useRealTimers());

  it("preloads after authoritative status, then creates the session before show-time SSV", async () => {
    const { result } = await renderHook(() => useWalletRewardAd());
    await act(async () => jest.advanceTimersByTimeAsync(0));
    await waitFor(() => expect(prepareWalletRewardedAd).toHaveBeenCalledTimes(1));
    expect(getWalletAdRewardStatus).toHaveBeenCalledTimes(1);

    let outcome: Awaited<ReturnType<typeof result.current.present>> | undefined;
    await act(async () => {
      outcome = await result.current.present();
    });

    expect(outcome).toBe("closed");
    expect(takeWalletRewardedAd).toHaveBeenCalledWith(
      "ca-app-pub-1877504503518465/1011630693",
      "owner-a",
    );
    expect(createWalletAdRewardSession).toHaveBeenCalledWith({
      adUnitId: "ca-app-pub-1877504503518465/1011630693",
      platform: "ios",
    });
    expect(presentWalletRewardedAd).toHaveBeenCalledWith(ad, {
      userId: "owner-a",
      customData: "signed-session-a",
    });
    expect(jest.mocked(takeWalletRewardedAd).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(createWalletAdRewardSession).mock.invocationCallOrder[0]!,
    );
    expect(jest.mocked(createWalletAdRewardSession).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(presentWalletRewardedAd).mock.invocationCallOrder[0]!,
    );
    expect(releaseRewardedAdPresentation).toHaveBeenCalledTimes(1);
  });

  it("retains the preloaded ad when session creation has a retryable server failure", async () => {
    jest.mocked(createWalletAdRewardSession).mockRejectedValueOnce(new APIError("server", 503));
    const { result } = await renderHook(() => useWalletRewardAd());
    await act(async () => jest.advanceTimersByTimeAsync(0));
    await waitFor(() => expect(result.current.isBusy).toBe(false));

    await act(async () => {
      await expect(result.current.present()).resolves.toBe("failed");
    });

    expect(retainWalletRewardedAd).toHaveBeenCalledWith(
      ad,
      "ca-app-pub-1877504503518465/1011630693",
      "owner-a",
    );
    expect(presentWalletRewardedAd).not.toHaveBeenCalled();
  });

  it("does not retain the ad after 403 and disables further presentation", async () => {
    jest.mocked(createWalletAdRewardSession).mockRejectedValueOnce(new APIError("disabled", 403));
    const { result } = await renderHook(() => useWalletRewardAd());
    await act(async () => jest.advanceTimersByTimeAsync(0));
    await waitFor(() => expect(result.current.isBusy).toBe(false));

    await act(async () => {
      await expect(result.current.present()).resolves.toBe("failed");
    });

    expect(retainWalletRewardedAd).not.toHaveBeenCalled();
    expect(result.current.isAvailable).toBe(false);
  });

  it("invalidates the cached ad whenever the account owner changes or unmounts", async () => {
    const { rerender, unmount } = await renderHook(
      ({ userId }: { userId: string }) => {
        jest.mocked(useAuth).mockReturnValue({
          user: userId ? { user_id: userId } : null,
        } as ReturnType<typeof useAuth>);
        return useWalletRewardAd();
      },
      { initialProps: { userId: "owner-a" } },
    );
    await act(async () => jest.advanceTimersByTimeAsync(0));
    await waitFor(() => expect(prepareWalletRewardedAd).toHaveBeenCalled());
    expect(discardWalletRewardedAd).toHaveBeenCalledTimes(1);

    await rerender({ userId: "owner-b" });
    await act(async () => jest.advanceTimersByTimeAsync(0));
    await waitFor(() => expect(discardWalletRewardedAd).toHaveBeenCalledTimes(2));
    await unmount();
    expect(discardWalletRewardedAd).toHaveBeenCalledTimes(3);
  });
});
