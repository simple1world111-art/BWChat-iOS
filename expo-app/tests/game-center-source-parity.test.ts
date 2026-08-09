import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const nativeRoot = resolve(root, "..");
const originalNativeRoot = resolve(root, "../../BWChat-iOS");
const screen = readFileSync(resolve(root, "src/app/game-center.tsx"), "utf8");
const web = readFileSync(resolve(root, "src/app/in-app-web.tsx"), "utf8");
const walletProvider = readFileSync(resolve(root, "src/providers/WalletProvider.tsx"), "utf8");
const repository = readFileSync(resolve(root, "src/services/games/GameRepository.ts"), "utf8");
const policy = readFileSync(resolve(root, "src/services/games/GameCenterPolicy.ts"), "utf8");
const rewarded = readFileSync(resolve(root, "src/services/games/GameRewardedAdService.ts"), "utf8");
const poster = readFileSync(resolve(root, "src/components/games/GamePoster.tsx"), "utf8");
const appConfig = readFileSync(resolve(root, "app.config.ts"), "utf8");
const packageManifest = readFileSync(resolve(root, "package.json"), "utf8");

describe("GameCenterView source parity", () => {
  it("locks every native game, cache, ad, WebView, remote-config and wallet fact source", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/GameCenterView.swift":
        "a8e6eab3e5551521b73c0d5e975b72eeec5ca3a74fb115dbd58d2ff8c2de2f4c",
      "BWChat/Models/GameCenter.swift":
        "9fd28a012fd4f64d543353aac519dde9170ca4f7328408c39187237cf1bc4bc9",
      "BWChat/Services/APIService.swift":
        "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274",
      "BWChat/Services/CacheRepository.swift":
        "530f9734eeb9fdc8aeafc3e5430d5eae876754462372bb3c05c9b830526f0b66",
      "BWChat/Services/AdRewardService.swift":
        "da581ee90e805c67db0d0fdc9bffe1aace67a34daacaa13bad42ad37ab2abe90",
      "BWChat/Views/Web/InAppWebView.swift":
        "7e96133cb669fc96569ee87d014155accceb56af8a23ad56cdafcefa7446192d",
      "BWChat/Services/AppRemoteConfigStore.swift":
        "6bcf0f8367120bd0fddeb6b27ca1b768fb3d92bb0182c4cdda5d04cdbe3ce85f",
      "BWChat/Services/WalletStore.swift":
        "cbc20644b9619fd707cf3372265af42e13528f5dcc2d3924455351af66b3cbe6",
      "BWChat/BWChatApp.swift": "45f12ddeed0504b5f71550681d2c9b0916804f3e812d56ba57705c5b735c26ad",
      "BWChat/Info.plist": "ea56af87091d8ccf46777a768163814301e7a3486ed7fc0dc5397ae0919c63e3",
      "BWChat/Utils/Extensions.swift":
        "e625dab1ea95cbd63d74c1e8bf33d4bf3f4a85adbd2001c1b0ca27a99bcc5ce5",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      const copied = nativeSource(nativeRoot, relativePath);
      expect(copied).toBe(nativeSource(originalNativeRoot, relativePath));
      expect(createHash("sha256").update(copied).digest("hex")).toBe(expected);
    }
  });

  it("keeps the native recommended/played topology, paging threshold, return refresh and card geometry", () => {
    expect(screen).toContain('type GameCenterTab = "recommended" | "played"');
    expect(screen).toContain("Promise.all([loadRecommended(), loadPlayed()])");
    expect(screen).toContain("onScroll={onCatalogScroll}");
    expect(screen).toContain("gameCenterPolicy.paginationTriggerRemainingItems");
    expect(screen).toContain("centerContent={false}");
    expect(screen).toContain("RefreshControl");
    expect(screen).toContain('justifyContent: "flex-start"');
    expect(screen).toContain("listViewportHeight > 0 && { minHeight: listViewportHeight }");
    expect(screen).toContain('position: "absolute"');
    expect(screen).not.toContain("onEndReachedThreshold");
    expect(screen).toContain("playedRevisionRef.current !== readGamePlayedRevision(ownerId)");
    expect(screen).toContain("void loadPlayed(true)");
    expect(screen).not.toContain("launchedGameRef");
    expect(policy).toContain("paginationTriggerRemainingItems: 4");
    expect(policy).toContain("cardMinimumHeight: 88");
    expect(policy).toContain("posterSize: 50");
    expect(policy).toContain("posterPlaceholderIconSize: 19");
    expect(policy).toContain("cardRadius: 14");
    expect(policy).toContain("nameSize: 17");
  });

  it("keeps list, lobby and paid-round endpoints and ledgers separate", () => {
    expect(repository).toContain('body: { purpose: "lobby" }');
    expect(repository).toContain('body: { payment_method: "gold_coins" }');
    expect(repository).toContain('headers: { "Idempotency-Key": idempotencyKey }');
    expect(repository.match(/transientRetries: false/g)).toHaveLength(2);
    expect(repository.match(/requiredData: true/g)).toHaveLength(3);
    expect(repository.match(/requiredEnvelope: true/g)).toHaveLength(3);
    expect(repository.match(/requiredSuccessCode: true/g)).toHaveLength(3);
    expect(web).toContain("roundRequestAddress(request)");
    expect(web).toContain("roundLedgerRef.current.begin(address)");
    expect(web).toContain("paymentBlockedSessionID === gameSessionID");
    expect(web).toContain("isRoundResumeTokenFailure(error)");
    expect(web).toContain("await wallet.applyBalance(round.walletBalance)");
    expect(web).toContain("if (ownerId && game) await recordPlayedGame(ownerId, game)");
    expect(walletProvider.indexOf("setBalance(nextBalance)")).toBeLessThan(
      walletProvider.indexOf("await persistBalance(ownerId, nextBalance).catch"),
    );
  });

  it("invalidates late list, paging, launch and round completions across account switches", () => {
    expect(screen).toContain("new GameAccountScope(ownerId)");
    expect(screen).toContain('key={ownerId || "signed-out"}');
    expect(screen).toContain('accountScopeRef.current.updateOwner("")');
    expect(screen).toContain("accountScopeRef.current.isCurrent(ticket)");
    expect(screen).toContain("ownerID: ticket.ownerId");
    expect(screen).toContain("repositoryGuard(accountScopeRef.current, ticket)");
    expect(repository).toContain("assertCurrentAccount(guard)");
    expect(repository).toContain("inFlightFirstPages");
    expect(web).toContain("gameContextMatchesOwner");
    expect(web).toContain("accountScopeRef.current.isCurrent(operationOwnerTicket)");
    expect(web).toContain("operationOwnerTicket.ownerId !== gameOwnerID");
  });

  it("matches native raw seeding, profile-cache lifetime, inclusive retention and best-effort writes", () => {
    expect(screen).toContain('readCachedGamePage(ownerId, "recommended")');
    expect(screen).toContain('readCachedGamePage(ownerId, "played")');
    expect(policy).toContain("ttlMilliseconds: 10 * 60 * 1_000");
    expect(policy).toContain("staleRetentionMilliseconds: 90 * 24 * 60 * 60 * 1_000");
    expect(repository).toContain(
      "Date.now() - cached.savedAt < gameCenterCachePolicy.ttlMilliseconds",
    );
    expect(repository).toContain("gameCenterCachePolicy.staleRetentionMilliseconds");
    expect(repository).toContain(".catch(() => undefined)");
    expect(repository).toContain("playedRevisions.set");
  });

  it("retains origin allowlisting, identity binding, persistent H5 storage and return navigation controls", () => {
    expect(web).toContain("request.source !== gameID");
    expect(web).toContain("request.sessionID !== gameSessionID");
    expect(web).toContain("nativeEvent.isMainFrame === true");
    expect(web).toContain("allowsGameBridgeMessage");
    expect(web).toContain("gameRewardedAdUnitAllowlist(config.wallet, __DEV__)");
    expect(web).toContain("sharedCookiesEnabled");
    expect(web).toContain("cacheEnabled");
    expect(web).toContain("incognito={false}");
    expect(web).toContain("allowsBackForwardNavigationGestures={!restrictToInitialOrigin}");
  });

  it("locks every visible native geometry constant and the minimal transparent navigation chrome", () => {
    const native = nativeSource(nativeRoot, "BWChat/Views/GameCenterView.swift");
    for (const contract of [
      ".padding(.vertical, 18)",
      "LazyVStack(spacing: 12)",
      ".padding(.horizontal, 16)",
      ".frame(width: 196)",
      ".frame(width: 50, height: 50)",
      "cornerRadius: 11",
      ".font(.system(size: 17, weight: .semibold))",
      ".font(.system(size: 14, weight: .regular))",
      ".padding(12)",
      "minHeight: 88",
      "cornerRadius: 14",
      "minHeight: 320",
      ".font(.system(size: 38, weight: .semibold))",
    ]) {
      expect(native).toContain(contract);
    }
    expect(screen).toContain('headerBackButtonDisplayMode: "minimal"');
    expect(screen).toContain('headerStyle: { backgroundColor: "transparent" }');
    expect(screen).toContain("gameCenterMetrics.contentHorizontalInset");
    expect(screen).toContain("gameCenterMetrics.messageIconSize");
    expect(screen).toContain('contentInsetAdjustmentBehavior="never"');
    expect(screen).toContain("data.length === 0 ? (");
    expect(screen).toContain('testID="game-center-empty-scroll"');
    expect(screen).toContain("key={`content:${selectedTab}`}");
    expect(screen).toContain("data.map((game) => (");
    expect(screen).toContain("style={styles.listContainer}");
  });

  it("covers AdMob consent/load/show/earned/SSV/no-fill and the process-wide presentation gate", () => {
    expect(rewarded).toContain("serverSideVerificationOptions");
    expect(rewarded).toContain("RewardedAdEventType.LOADED");
    expect(rewarded).toContain("RewardedAdEventType.EARNED_REWARD");
    expect(rewarded).toContain("AdEventType.CLOSED");
    expect(rewarded).toContain("AdEventType.ERROR");
    expect(rewarded).toContain("rewardedAdErrorCodes.noFill");
    expect(rewarded).toContain("acquireRewardedAdPresentation");
    expect(rewarded).toContain("gameAdMaximumAgeMilliseconds = 50 * 60 * 1_000");
    expect(rewarded).toContain("ensureGameRewardedAdIsCached");
    expect(rewarded).toContain("serverSideVerificationOptions");
    expect(appConfig).toContain('"react-native-google-mobile-ads"');
    expect(appConfig).toContain("iosAppId: iosAdMobAppId");
    expect(packageManifest).toContain('"react-native-google-mobile-ads"');
  });

  it("uses authenticated remote SVG/poster data with the original byte and path safety boundary", () => {
    expect(poster).toContain("const maximumSVGByteCount = 5 * 1_024 * 1_024");
    expect(poster).toContain("Authorization: `Bearer ${token}`");
    expect(poster).toContain("allowsInitialGameURL(response.url, policy)");
    expect(poster).toContain('<SvgXml height="100%" preserveAspectRatio="xMidYMid slice"');
    expect(screen).toContain("gameDisplayIconURL(game)");
  });
});

function nativeSource(sourceRoot: string, relativePath: string): string {
  return readFileSync(resolve(sourceRoot, relativePath), "utf8");
}
