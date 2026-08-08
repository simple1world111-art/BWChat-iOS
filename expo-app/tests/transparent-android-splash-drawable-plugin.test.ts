import type { ConfigContext, ExpoConfig } from "expo/config";

import createAppConfig from "../app.config";

// The config plugin is intentionally CommonJS because Expo loads it directly from app.config.ts.
/* eslint-disable @typescript-eslint/no-require-imports */
const {
  transparentSplashDrawableXml,
} = require("../plugins/with-transparent-android-splash-drawable");
/* eslint-enable @typescript-eslint/no-require-imports */

describe("transparent Android native splash drawable", () => {
  test("keeps Expo's generated splash resource valid without adding a visible logo", () => {
    expect(transparentSplashDrawableXml).toContain(
      '<shape xmlns:android="http://schemas.android.com/apk/res/android"',
    );
    expect(transparentSplashDrawableXml).toContain(
      '<solid android:color="@android:color/transparent" />',
    );
    expect(transparentSplashDrawableXml).not.toMatch(/bitmap|src=/u);
  });

  test("is registered before expo-splash-screen so its stacked mod runs after cleanup", () => {
    const config = createAppConfig({ config: {} as ExpoConfig } as ConfigContext);
    const plugins = config.plugins ?? [];
    const splashIndex = plugins.findIndex(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
    );
    const fallbackIndex = plugins.indexOf("./plugins/with-transparent-android-splash-drawable");

    expect(splashIndex).toBeGreaterThanOrEqual(0);
    expect(fallbackIndex).toBeLessThan(splashIndex);
  });
});
