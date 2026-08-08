import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const originalRoot = "/Users/wegpt.com/Desktop/BWChat-iOS/BWChat";
const copiedRoot = "/Users/wegpt.com/Desktop/BWChat-Expo-HotUpdate/BWChat";
const expoRoot = resolve(__dirname, "..");

describe("InAppWebView source/API parity", () => {
  it("pins every read-only Swift fact source used by the page against the desktop copy", () => {
    const sources: Readonly<Record<string, string>> = {
      "Views/Web/InAppWebView.swift":
        "7e96133cb669fc96569ee87d014155accceb56af8a23ad56cdafcefa7446192d",
      "Models/DynamicConfigModels.swift":
        "8a09512ab3e119ac63499fae8aafd0f69c6d1dbc6489d97979bc7c29e3726803",
      "Services/DynamicRouteHandler.swift":
        "fba6f7c42e069901cd310940dad900f7c48a24b92b94fe6083efb7fa2abe24b2",
      "Views/GameCenterView.swift":
        "a8e6eab3e5551521b73c0d5e975b72eeec5ca3a74fb115dbd58d2ff8c2de2f4c",
      "Services/APIService.swift":
        "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274",
      "Services/AdRewardService.swift":
        "da581ee90e805c67db0d0fdc9bffe1aace67a34daacaa13bad42ad37ab2abe90",
      "Services/WalletStore.swift":
        "cbc20644b9619fd707cf3372265af42e13528f5dcc2d3924455351af66b3cbe6",
    };
    for (const [file, expected] of Object.entries(sources)) {
      const original = readFileSync(resolve(originalRoot, file));
      const copied = readFileSync(resolve(copiedRoot, file));
      expect(copied).toEqual(original);
      expect(hash(original)).toBe(expected);
    }
  });

  it("keeps the native allowlist and deliberately headerless persistent document load", () => {
    const screen = expo("src/app/in-app-web.tsx");
    const policy = expo("src/services/web/WebViewPolicy.ts");
    expect(policy).toContain('allowedDomains: ["id7.com", "playdot.games"]');
    expect(policy).toContain("hostMatchesDomain");
    expect(policy).toContain("allowDevelopmentLocalhost");
    expect(policy).toContain("gameLaunchPolicy");
    expect(screen).toContain("policyAllowsURL(initialURL, policy");
    expect(screen).toContain("allowsInitialGameURL(initialURL, policy)");
    // Swift uses URLRequest(url:) with the default persistent website store:
    // no app Bearer or Accept-Language header is injected into H5 navigation.
    expect(screen).toContain("source={{ uri: initialURL }}");
    expect(screen).toContain("sharedCookiesEnabled");
    expect(screen).toContain("thirdPartyCookiesEnabled");
    expect(screen).toContain("cacheEnabled");
    expect(screen).toContain("domStorageEnabled");
    expect(screen).not.toContain("Authorization");
    expect(screen).not.toContain("Accept-Language");
    expect(screen).not.toContain("headers:");
  });

  it("keeps native navigation, external, media and lifecycle behavior without inventing downloads", () => {
    const screen = expo("src/app/in-app-web.tsx");
    const policy = expo("src/services/web/WebViewPolicy.ts");
    expect(policy).toContain('["tel", "mailto", "sms", "facetime", "itms-apps", "itms-services"]');
    expect(policy).toContain('hostMatchesDomain(host, "apps.apple.com")');
    expect(policy).toContain('hostMatchesDomain(host, "itunes.apple.com")');
    expect(screen).toContain("shouldOpenURLExternally(nextURL)");
    expect(screen).toContain("void Linking.openURL(nextURL).catch(() => undefined)");
    expect(screen).toContain("gameNavigationResolution(nextURL, initialURL)");
    expect(screen).toContain('mediaCapturePermissionGrantType="deny"');
    expect(screen).toContain("javaScriptCanOpenWindowsAutomatically={false}");
    expect(screen).toContain("setSupportMultipleWindows={false}");
    expect(screen).toContain("onOpenWindow={() => undefined}");
    expect(screen).toContain(
      "shouldShowBlockingNavigationError(hasFinishedInitialDocumentRef.current)",
    );
    expect(screen).toContain("onLoadStart");
    expect(screen).toContain("onLoad={() =>");
    expect(screen).not.toContain("onFileDownload");
  });

  it("routes only bridge-owned game mutations through their exact API contract", () => {
    const screen = expo("src/app/in-app-web.tsx");
    const repository = expo("src/services/games/GameRepository.ts");
    expect(screen).toContain("policy.allowedBridgeMethods.includes(method as never)");
    expect(screen).toContain("decodeAppBridgeRoute");
    expect(screen).toContain("nativeEvent.isMainFrame === true");
    expect(screen).toContain("allowsGameBridgeMessage");
    expect(screen).toContain("roundLedgerRef.current.begin(address)");
    expect(screen).toContain("await wallet.applyBalance(round.walletBalance)");
    expect(screen).toContain("presentGameRewardedAd(action.request)");
    expect(screen).not.toContain("apiRequest");
    expect(repository).toContain(
      "`/games/${encodeURIComponent(gameID)}/sessions/${encodeURIComponent(sessionID)}/rounds`",
    );
    expect(repository).toContain('headers: { "Idempotency-Key": idempotencyKey }');
    expect(repository).toContain('body: { payment_method: "gold_coins" }');
    expect(repository).toContain("requiredData: true");
    expect(repository).toContain("requiredEnvelope: true");
    expect(repository).toContain("requiredSuccessCode: true");
    expect(repository).toContain("transientRetries: false");
  });
});

function expo(path: string): string {
  return readFileSync(resolve(expoRoot, path), "utf8");
}

function hash(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}
