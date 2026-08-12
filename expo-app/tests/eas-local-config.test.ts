import type { ConfigContext, ExpoConfig } from "expo/config";

import createAppConfig from "../app.config";
import easConfig from "../eas.json";

const projectId = "f623eda4-1a5f-4227-9890-1a2eb5a6df2c";
const environmentKeys = [
  "APP_ENV",
  "BWCHAT_EXPECTED_APP_ENV",
  "EAS_BUILD",
  "EAS_PROJECT_ID",
  "EXPO_OWNER",
  "EXPO_PUBLIC_API_BASE_URL",
  "EXPO_PUBLIC_WEB_BASE_URL",
  "EXPO_PUBLIC_WEBSOCKET_URL",
  "EXPO_PUBLIC_REMOTE_CONFIG_URL",
  "EXPO_PUBLIC_SENTRY_DSN",
  "EXPO_PUBLIC_IOS_ADMOB_APP_ID",
  "EXPO_PUBLIC_ANDROID_ADMOB_APP_ID",
] as const;

const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
);

describe("local Expo/EAS configuration", () => {
  beforeEach(() => {
    for (const key of environmentKeys) delete process.env[key];
  });

  afterAll(() => {
    for (const key of environmentKeys) {
      const value = originalEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("binds the real EAS project without manual environment exports", () => {
    const config = resolveConfig();

    expect(config.owner).toBe("wegpt");
    expect(config.slug).toBe("bbchat");
    expect(config.runtimeVersion).toEqual({ policy: "fingerprint" });
    expect(config.ios?.runtimeVersion).toEqual({ policy: "appVersion" });
    expect(config.ios?.icon).toBe("./assets/images/bwchat/icon-ios-full-bleed.png");
    expect(config.updates).toMatchObject({
      enabled: true,
      checkAutomatically: "NEVER",
      fallbackToCacheTimeout: 0,
      url: `https://u.expo.dev/${projectId}`,
    });
    expect(config.extra).toMatchObject({
      environment: "development",
      eas: { projectId },
    });
  });

  test("uses explicit production overrides and keeps Sentry optional", () => {
    Object.assign(process.env, releaseEnvironment("production"));
    const config = resolveConfig();

    expect(config.name).toBe("BBchat");
    expect(config.owner).toBe("override-owner");
    expect(config.updates?.url).toBe("https://u.expo.dev/123e4567-e89b-42d3-a456-426614174000");
    expect(config.extra).toMatchObject({
      environment: "production",
      apiBaseUrl: "https://production-api.example.invalid/v1",
      webBaseUrl: "https://production-web.example.invalid",
      webSocketUrl: "wss://production-web.example.invalid/ws",
      remoteConfigUrl: "https://production-api.example.invalid/v1/app/config",
    });
    expect(config.extra).not.toHaveProperty("sentryDsn");
    expect(config.ios?.entitlements?.["aps-environment"]).toBe("production");
  });

  test("fails closed when a packaged environment is incomplete or mismatched", () => {
    process.env.APP_ENV = "preview";
    expect(() => resolveConfig()).toThrow(/EXPO_PUBLIC_API_BASE_URL is required/);

    Object.assign(process.env, releaseEnvironment("preview"));
    process.env.BWCHAT_EXPECTED_APP_ENV = "production";
    expect(() => resolveConfig()).toThrow(/APP_ENV must match BWCHAT_EXPECTED_APP_ENV/);
  });

  test("rejects an invalid project override", () => {
    process.env.EAS_PROJECT_ID = "not-a-project-id";
    expect(() => resolveConfig()).toThrow(/EAS_PROJECT_ID must be a UUID/);
  });

  test("locks all Build and Submit profiles", () => {
    expect(easConfig.cli).toMatchObject({ appVersionSource: "remote", requireCommit: true });
    expect(easConfig.build.development).toMatchObject({
      developmentClient: true,
      distribution: "internal",
      channel: "development",
      environment: "development",
    });
    expect(easConfig.build.preview).toMatchObject({
      distribution: "internal",
      channel: "preview",
      environment: "preview",
    });
    expect(easConfig.build["preview-simulator"]).toEqual({
      extends: "preview",
      ios: { simulator: true },
    });
    expect(easConfig.build.production).toMatchObject({
      distribution: "store",
      channel: "production",
      environment: "production",
      autoIncrement: true,
    });
    expect(easConfig.submit.production).toEqual({ ios: {}, android: {} });
  });
});

function resolveConfig(): ExpoConfig {
  return createAppConfig({ config: {} as ExpoConfig } as ConfigContext);
}

function releaseEnvironment(environment: "preview" | "production") {
  return {
    APP_ENV: environment,
    EAS_PROJECT_ID: "123e4567-e89b-42d3-a456-426614174000",
    EXPO_OWNER: "override-owner",
    EXPO_PUBLIC_API_BASE_URL: `https://${environment}-api.example.invalid/v1`,
    EXPO_PUBLIC_WEB_BASE_URL: `https://${environment}-web.example.invalid`,
    EXPO_PUBLIC_WEBSOCKET_URL: `wss://${environment}-web.example.invalid/ws`,
    EXPO_PUBLIC_REMOTE_CONFIG_URL: `https://${environment}-api.example.invalid/v1/app/config`,
    EXPO_PUBLIC_IOS_ADMOB_APP_ID: "ca-app-pub-0000000000000000~0000000000",
    EXPO_PUBLIC_ANDROID_ADMOB_APP_ID: "ca-app-pub-0000000000000000~0000000001",
  };
}
