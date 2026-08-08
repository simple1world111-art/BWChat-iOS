import mobileAds, { AdsConsent } from "react-native-google-mobile-ads";

import {
  prepareRewardedAdSDK,
  resetRewardedAdSDKForTests,
} from "@/services/ads/RewardedAdSDK";

jest.mock("react-native-google-mobile-ads", () => ({
  __esModule: true,
  AdsConsent: { gatherConsent: jest.fn() },
  default: jest.fn(),
}));

const mockGatherConsent = jest.mocked(AdsConsent.gatherConsent);
const mockMobileAds = jest.mocked(mobileAds);
const mockInitialize = jest.fn();

describe("rewarded ad consent and SDK preparation", () => {
  beforeEach(() => {
    resetRewardedAdSDKForTests();
    jest.clearAllMocks();
    mockMobileAds.mockReturnValue({ initialize: mockInitialize } as unknown as ReturnType<typeof mobileAds>);
    mockGatherConsent.mockResolvedValue(consent(true));
    mockInitialize.mockResolvedValue([]);
  });

  it("uses one preparation flight and permanently reuses a successful initialization", async () => {
    expect(await Promise.all([
      prepareRewardedAdSDK(),
      prepareRewardedAdSDK(),
      prepareRewardedAdSDK(),
    ])).toEqual([true, true, true]);
    expect(mockGatherConsent).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(await prepareRewardedAdSDK()).toBe(true);
    expect(mockGatherConsent).toHaveBeenCalledTimes(1);
  });

  it("does not poison future attempts when consent is temporarily unavailable", async () => {
    mockGatherConsent
      .mockResolvedValueOnce(consent(false))
      .mockResolvedValueOnce(consent(true));
    expect(await prepareRewardedAdSDK()).toBe(false);
    expect(await prepareRewardedAdSDK()).toBe(true);
    expect(mockGatherConsent).toHaveBeenCalledTimes(2);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it("allows retry after consent or SDK exceptions", async () => {
    mockGatherConsent.mockRejectedValueOnce(new Error("offline"));
    expect(await prepareRewardedAdSDK()).toBe(false);
    expect(await prepareRewardedAdSDK()).toBe(true);
    expect(mockGatherConsent).toHaveBeenCalledTimes(2);
  });
});

function consent(canRequestAds: boolean): Awaited<ReturnType<typeof AdsConsent.gatherConsent>> {
  return { canRequestAds } as unknown as Awaited<ReturnType<typeof AdsConsent.gatherConsent>>;
}
