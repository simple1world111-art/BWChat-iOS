import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

describe("react-native-webview game bridge native hardening", () => {
  it("persists the ExpoModulesJSI nested-framework signing workaround as a pnpm dependency patch", () => {
    const patch = fs.readFileSync(path.join(root, "patches/expo-modules-jsi@57.0.4.patch"), "utf8");
    const workspace = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).toContain("expo-modules-jsi@57.0.4: patches/expo-modules-jsi@57.0.4.patch");
    expect(patch).toContain("CODE_SIGNING_ALLOWED=NO");
    expect(patch).toContain("CODE_SIGNING_REQUIRED=NO");
  });

  it("persists the main-frame signal and motion denial as a pnpm dependency patch", () => {
    const patch = fs.readFileSync(
      path.join(root, "patches/react-native-webview@13.16.1.patch"),
      "utf8",
    );
    const workspace = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).toContain(
      "react-native-webview@13.16.1: patches/react-native-webview@13.16.1.patch",
    );
    expect(patch).toContain('@"isMainFrame": @(message.frameInfo.isMainFrame)');
    expect(patch).toContain(".isMainFrame = static_cast<bool>");
    expect(patch).toContain("requestDeviceOrientationAndMotionPermissionForOrigin");
    expect(patch).toContain("decisionHandler(WKPermissionDecisionDeny)");
  });

  it("coexists with the locked show-time rewarded SSV dependency patch", () => {
    const patch = fs.readFileSync(
      path.join(root, "patches/react-native-google-mobile-ads@16.3.4.patch"),
      "utf8",
    );
    const workspace = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
    const lockfile = fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
    expect(workspace).toContain(
      "react-native-google-mobile-ads@16.3.4: patches/react-native-google-mobile-ads@16.3.4.patch",
    );
    expect(workspace).toContain(
      "react-native-webview@13.16.1: patches/react-native-webview@13.16.1.patch",
    );
    expect(lockfile).toContain("react-native-google-mobile-ads@16.3.4:");
    expect(patch).toContain('showOptions[@"serverSideVerificationOptions"]');
    expect(patch).toContain("setServerSideVerificationOptions:options");
    expect(patch).toContain("serverSideVerificationOptions?: ServerSideVerificationOptions");
  });

  it("configures the JS WebView with persistent storage, denied media, no popups and frame-aware trust", () => {
    const source = fs.readFileSync(path.join(root, "src/app/in-app-web.tsx"), "utf8");
    expect(source).toContain('mediaCapturePermissionGrantType="deny"');
    expect(source).toContain("sharedCookiesEnabled");
    expect(source).toContain("cacheEnabled");
    expect(source).toContain("javaScriptCanOpenWindowsAutomatically={false}");
    expect(source).toContain("setSupportMultipleWindows={false}");
    expect(source).toContain("nativeEvent.isMainFrame === true");
    expect(source).toContain('install("bwchatGameBridge", "game")');
    expect(source).toContain('install("bwchat", "app")');
  });

  it("prewarms the dependency's shared WK process/data-store path before game launch", () => {
    const webViewPackageRoot = path.dirname(require.resolve("react-native-webview/package.json"));
    const nativeImplementation = fs.readFileSync(
      path.join(webViewPackageRoot, "apple/RNCWebViewImpl.m"),
      "utf8",
    );
    const prewarmer = fs.readFileSync(
      path.join(root, "src/components/games/GameWebViewPrewarmer.tsx"),
      "utf8",
    );
    const gameCenter = fs.readFileSync(path.join(root, "src/app/game-center.tsx"), "utf8");
    expect(prewarmer).toContain("RNCWKProcessPoolManager");
    expect(prewarmer).toContain("sharedCookiesEnabled");
    expect(prewarmer).toContain("cacheEnabled");
    expect(prewarmer).toContain("source={{ html: blankDocument }}");
    expect(gameCenter).toContain("<GameWebViewPrewarmer />");
    expect(nativeImplementation).toContain("[RNCWKProcessPoolManager sharedManager]");
    expect(nativeImplementation).toContain("[WKWebsiteDataStore defaultDataStore]");
  });
});
