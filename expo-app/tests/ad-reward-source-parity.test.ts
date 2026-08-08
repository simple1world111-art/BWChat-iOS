import fs from "node:fs";
import path from "node:path";

const expoRoot = process.cwd();
const nativeRoot = path.resolve(expoRoot, "..");

describe("AdRewardService source parity", () => {
  it("keeps the account-owned iOS wallet ad unit, daily limit and Shanghai day", () => {
    const swift = native("BWChat/Services/AdRewardService.swift");
    const policy = expo("src/services/wallet/walletPolicy.ts");
    expect(swift).toContain(
      'productionRewardedAdUnitID = "ca-app-pub-1877504503518465/1011630693"',
    );
    expect(policy).toContain(
      'iosProductionRewardedAdUnitId = "ca-app-pub-1877504503518465/1011630693"',
    );
    expect(swift).toContain("dailyRewardedAdLimit = 10");
    expect(policy).toContain("dailyAdLimit: 10");
    expect(swift).toContain('TimeZone(identifier: "Asia/Shanghai")');
    expect(policy).toContain('timeZone: "Asia/Shanghai"');
  });

  it("preserves UMP consent before SDK initialization with retryable single flight", () => {
    const swift = native("BWChat/Services/AdRewardService.swift");
    const sdk = expo("src/services/ads/RewardedAdSDK.ts");
    expect(swift).toContain("ConsentForm.loadAndPresentIfRequired");
    expect(swift).toContain("MobileAds.shared.start()");
    expect(sdk).toContain("AdsConsent.gatherConsent()");
    expect(sdk).toContain("mobileAds().initialize()");
    expect(sdk).toContain("preparation = undefined");
  });

  it("preloads first, then creates the server session and binds owner/custom SSV at show time", () => {
    const swift = native("BWChat/Services/AdRewardService.swift");
    const walletView = native("BWChat/Views/WalletView.swift");
    const api = expo("src/api/bwchat.ts");
    const hook = expo("src/services/wallet/useWalletRewardAd.ts");
    const client = expo("src/services/wallet/WalletRewardedAdClient.ts");
    expect(walletView).toContain("await adRewardService.load()");
    expect(swift).toContain("prepareServerVerification(for: ad");
    expect(api).toContain('apiRequest<unknown>("/wallet/ad-rewards/status", {');
    expect(api).toContain('apiRequest<unknown>("/wallet/ad-rewards/sessions", {');
    expect(api).toContain('reward_item: "gold_coin"');
    expect(hook).toContain("prepareWalletRewardedAd");
    expect(hook).toContain("takeWalletRewardedAd");
    expect(hook).toContain("retainWalletRewardedAd");
    expect(hook).toContain("userId: ownerId");
    expect(hook).toContain("customData: session.ssv_custom_data");
    expect(client).toContain("RewardedAd.createForAdRequest(adUnitId)");
    expect(client).toContain("RewardedAdEventType.EARNED_REWARD");
    expect(client).toContain(".show({");
    expect(client).toContain("serverSideVerificationOptions: verification");
  });

  it("keeps pending credit until authoritative counter decrease or session expiry", () => {
    const swift = native("BWChat/Services/AdRewardService.swift");
    const policy = expo("src/services/wallet/walletPolicy.ts");
    const hook = expo("src/services/wallet/useWalletRewardAd.ts");
    expect(swift).toContain("serverRemainingCount < remainingCountBeforeReward");
    expect(policy).toContain("serverRemainingCount < pending.remainingBefore");
    expect(hook).toContain("adCreditPollAttempts");
    expect(hook).toContain("setAwaitingServerCredit(true)");
    expect(hook).toContain("setBusinessDayResetAt(nextShanghaiMidnight(Date.now() + 1_000))");
  });

  it("shares one process-wide presentation gate with game rewarded ads", () => {
    const swift = native("BWChat/Services/AdRewardService.swift");
    const wallet = expo("src/services/wallet/useWalletRewardAd.ts");
    const game = expo("src/services/games/GameRewardedAdService.ts");
    expect(swift).toContain("RewardedAdPresentationGate.shared.acquire");
    expect(wallet).toContain("acquireRewardedAdPresentation");
    expect(game).toContain("acquireRewardedAdPresentation");
    expect(game).toContain("2_500");
  });
});

function native(file: string): string {
  return fs.readFileSync(path.join(nativeRoot, file), "utf8");
}

function expo(file: string): string {
  return fs.readFileSync(path.join(expoRoot, file), "utf8");
}
