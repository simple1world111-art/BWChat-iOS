import { readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..");

describe("Android EAS build compatibility", () => {
  test("keeps local Expo module native folders in the EAS archive", () => {
    const easIgnore = readFileSync(path.join(projectRoot, ".easignore"), "utf8");

    expect(easIgnore).toMatch(/^\/ios\/$/m);
    expect(easIgnore).toMatch(/^\/android\/$/m);
    expect(easIgnore).not.toMatch(/^ios\/$/m);
    expect(easIgnore).not.toMatch(/^android\/$/m);
  });

  test("pins the compatible bridge and Android Mobile Ads SDK pair", () => {
    const packageJsonPath = require.resolve("react-native-google-mobile-ads/package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      version: string;
      sdkVersions: { android: { googleMobileAds: string } };
    };

    expect(packageJson).toMatchObject({
      version: "16.3.4",
      sdkVersions: { android: { googleMobileAds: "25.0.0" } },
    });
  });
});
