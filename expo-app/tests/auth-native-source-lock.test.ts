import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const nativeRoot = path.resolve(root, "../BWChat");

const nativeSourceHashes = {
  "Views/LoginView.swift": "3b43f2fad8563d300d803e97751c49ef4f3082b034826040c33b01dd5a26432c",
  "Views/RegisterView.swift": "1f029efa48ff49f0cbb1fa7bf06dea8ee131dbaa5f6cd40d35f1600c5bf10516",
  "ViewModels/AuthViewModel.swift":
    "996514298b74b8bcae9f6d28589d91c008d3ba3aef74586da8bb6d23254dc0ec",
  "Managers/AuthManager.swift": "be19db71600446ecbdf7d41fcf1c83df153228520b5436619ae4229ffda6882f",
  "Services/APIService.swift": "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
  "Services/PushService.swift": "e84e820a5ec176a9ab1b4f08601037bd50d1a7a78ea37b3d5bfbfa6437b9d161",
  "Utils/KeychainHelper.swift": "c1923e178b262805cf7cdda2f440b85aa1bb2d3415f700944f1d026e1825de26",
  "Models/User.swift": "20ea81372c06150c5a7e348432c91f2f00c5879eb1fadf073436a3ab415f2e5d",
  "Services/LoginLocationRecorder.swift":
    "cb9e9514affcf9a1ecca83e4696c8e5c216ae8976316d4e5cf56f3c9bec61bad",
} as const;

const authAssetHashes = {
  auth_cat_idle: "ab1fd0a2b523955670a5cb3a7006ca99e28d7d586e58654352e1290baaa907a1",
  auth_cat_peek: "405ade92bf14db61c2f0bfb3cb9ab8847330e7f6a5572b1ec3fc653d28eadcfb",
  auth_cat_cover: "b3fc0816a1ed3b6bb7ad1a4ba35ddccc81706c7b7d59e4534b4f9f89863f9c94",
} as const;

describe("Login/Register original-source evidence lock", () => {
  it("pins every native source used by the authentication audit", () => {
    for (const [relativePath, expected] of Object.entries(nativeSourceHashes)) {
      expect(sha256(path.join(nativeRoot, relativePath))).toBe(expected);
    }
  });

  it("keeps all three authentication cat images byte-identical to Assets.xcassets", () => {
    for (const [assetName, expected] of Object.entries(authAssetHashes)) {
      const relativePath = `Assets.xcassets/${assetName}.imageset/${assetName}.png`;
      const copied = path.join(root, "assets/native-original", relativePath);
      expect(sha256(path.join(nativeRoot, relativePath))).toBe(expected);
      expect(sha256(copied)).toBe(expected);
    }
  });

  it("statically bundles the original images used by every cat mood", () => {
    const assetMap = readFileSync(path.join(root, "src/assets/nativeAssets.ts"), "utf8");
    const authChrome = readFileSync(path.join(root, "src/components/auth/AuthChrome.tsx"), "utf8");
    for (const key of ["authCatIdle", "authCatPeek", "authCatCover"] as const) {
      expect(assetMap).toContain(`${key}: require(`);
      expect(authChrome).toContain(`source: nativeAssets.${key}`);
    }
  });
});

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
