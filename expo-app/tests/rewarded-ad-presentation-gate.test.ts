import {
  acquireRewardedAdPresentation,
  releaseRewardedAdPresentation,
  resetRewardedAdPresentationGateForTests,
  rewardedAdPresentationInFlight,
} from "@/services/ads/RewardedAdPresentationGate";

describe("process-wide rewarded ad presentation gate", () => {
  beforeEach(() => resetRewardedAdPresentationGateForTests());

  it("allows one owner and rejects every concurrent owner", () => {
    expect(acquireRewardedAdPresentation("wallet:user-1")).toBe(true);
    expect(rewardedAdPresentationInFlight()).toBe(true);
    expect(acquireRewardedAdPresentation("game:request-1")).toBe(false);
  });

  it("only releases for the owner that acquired the gate", () => {
    expect(acquireRewardedAdPresentation("game:request-1")).toBe(true);
    releaseRewardedAdPresentation("wallet:user-1");
    expect(rewardedAdPresentationInFlight()).toBe(true);
    releaseRewardedAdPresentation("game:request-1");
    expect(rewardedAdPresentationInFlight()).toBe(false);
  });
});
