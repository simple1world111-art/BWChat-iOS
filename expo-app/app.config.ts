import type { ConfigContext, ExpoConfig } from "expo/config";

type AppEnvironment = "development" | "preview" | "production";

const defaultEasProjectId = "f623eda4-1a5f-4227-9890-1a2eb5a6df2c";
const defaultExpoOwner = "wegpt";
const developmentApiBaseUrl = "https://id7.com/api/v1";
const developmentWebBaseUrl = "https://id7.com";
const developmentIosAdMobAppId = "ca-app-pub-1877504503518465~7347579927";
const developmentAndroidAdMobAppId = "ca-app-pub-3940256099942544~3347511713";
const defaultIosAssociatedDomains = ["applinks:id7.com"];

function resolveEnvironment(): AppEnvironment {
  const explicitValue = process.env.APP_ENV;
  const value = explicitValue ?? "development";
  if (value === "development" || value === "preview" || value === "production") {
    const expected = process.env.BWCHAT_EXPECTED_APP_ENV;
    if (explicitValue && expected && expected !== value) {
      throw new Error(`APP_ENV must match BWCHAT_EXPECTED_APP_ENV=${expected}; received: ${value}`);
    }
    return value;
  }
  throw new Error(`APP_ENV must be development, preview, or production; received: ${value}`);
}

function requireForPackagedApp(
  name: string,
  value: string | undefined,
  environment: AppEnvironment,
  developmentFallback?: string,
): string {
  const normalized = value?.trim();
  if (normalized) return normalized;
  if (environment !== "development" || process.env.EAS_BUILD === "true") {
    throw new Error(`${name} is required for ${environment} builds and updates`);
  }
  if (developmentFallback) return developmentFallback;
  throw new Error(`${name} is required`);
}

function validateUrl(name: string, value: string): string {
  try {
    const url = new URL(value);
    if (!url.protocol || !url.hostname) throw new Error("missing URL protocol or host");
    return value;
  } catch {
    throw new Error(`${name} must be an absolute URL; received: ${value}`);
  }
}

function requireSecureTransport(
  name: string,
  value: string,
  secureProtocol: "https:" | "wss:",
): void {
  const protocol = new URL(value).protocol.toLowerCase();
  if (protocol !== secureProtocol) {
    throw new Error(`${name} must use ${secureProtocol.slice(0, -1)}`);
  }
}

function optionalUrlList(name: string, rawValue: string | undefined): string[] {
  return (rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) => validateUrl(`${name}[${index}]`, value));
}

function associatedDomains(rawValue: string | undefined): string[] {
  const values = (rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const domains = values.length > 0 ? values : defaultIosAssociatedDomains;
  for (const domain of domains) {
    if (!/^applinks:[a-z0-9.-]+$/iu.test(domain)) {
      throw new Error(`IOS_ASSOCIATED_DOMAINS contains an invalid applinks entry: ${domain}`);
    }
  }
  return [...new Set(domains.map((domain) => domain.toLowerCase()))];
}

function validateProjectId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error(`EAS_PROJECT_ID must be a UUID; received: ${value}`);
  }
  return value;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = resolveEnvironment();
  const projectId = validateProjectId(process.env.EAS_PROJECT_ID?.trim() || defaultEasProjectId);
  const owner = process.env.EXPO_OWNER?.trim() || defaultExpoOwner;
  const apiBaseUrl = validateUrl(
    "EXPO_PUBLIC_API_BASE_URL",
    requireForPackagedApp(
      "EXPO_PUBLIC_API_BASE_URL",
      process.env.EXPO_PUBLIC_API_BASE_URL,
      environment,
      developmentApiBaseUrl,
    ),
  );
  const webBaseUrl = validateUrl(
    "EXPO_PUBLIC_WEB_BASE_URL",
    requireForPackagedApp(
      "EXPO_PUBLIC_WEB_BASE_URL",
      process.env.EXPO_PUBLIC_WEB_BASE_URL,
      environment,
      developmentWebBaseUrl,
    ),
  );
  const webSocketUrl = validateUrl(
    "EXPO_PUBLIC_WEBSOCKET_URL",
    requireForPackagedApp(
      "EXPO_PUBLIC_WEBSOCKET_URL",
      process.env.EXPO_PUBLIC_WEBSOCKET_URL,
      environment,
      `${webBaseUrl.replace(/^http/iu, "ws").replace(/\/$/u, "")}/ws`,
    ),
  );
  const remoteConfigUrl = validateUrl(
    "EXPO_PUBLIC_REMOTE_CONFIG_URL",
    requireForPackagedApp(
      "EXPO_PUBLIC_REMOTE_CONFIG_URL",
      process.env.EXPO_PUBLIC_REMOTE_CONFIG_URL,
      environment,
      `${apiBaseUrl.replace(/\/$/u, "")}/app/config`,
    ),
  );
  const notificationAssetBaseUrls = optionalUrlList(
    "EXPO_PUBLIC_NOTIFICATION_ASSET_BASE_URLS",
    process.env.EXPO_PUBLIC_NOTIFICATION_ASSET_BASE_URLS,
  );
  const iosAssociatedDomains = associatedDomains(process.env.IOS_ASSOCIATED_DOMAINS);
  requireSecureTransport("EXPO_PUBLIC_API_BASE_URL", apiBaseUrl, "https:");
  requireSecureTransport("EXPO_PUBLIC_WEB_BASE_URL", webBaseUrl, "https:");
  requireSecureTransport("EXPO_PUBLIC_WEBSOCKET_URL", webSocketUrl, "wss:");
  requireSecureTransport("EXPO_PUBLIC_REMOTE_CONFIG_URL", remoteConfigUrl, "https:");
  for (const [index, url] of notificationAssetBaseUrls.entries()) {
    requireSecureTransport(`EXPO_PUBLIC_NOTIFICATION_ASSET_BASE_URLS[${index}]`, url, "https:");
  }
  const rawSentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  const sentryDsn = rawSentryDsn ? validateUrl("EXPO_PUBLIC_SENTRY_DSN", rawSentryDsn) : undefined;
  const iosAdMobAppId = requireForPackagedApp(
    "EXPO_PUBLIC_IOS_ADMOB_APP_ID",
    process.env.EXPO_PUBLIC_IOS_ADMOB_APP_ID,
    environment,
    developmentIosAdMobAppId,
  );
  const androidAdMobAppId = requireForPackagedApp(
    "EXPO_PUBLIC_ANDROID_ADMOB_APP_ID",
    process.env.EXPO_PUBLIC_ANDROID_ADMOB_APP_ID,
    environment,
    developmentAndroidAdMobAppId,
  );

  return {
    ...config,
    name: "BBchat",
    slug: "bbchat",
    owner,
    scheme: "bwchat",
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    icon: "./assets/images/bwchat/icon.png",
    runtimeVersion: { policy: "fingerprint" },
    updates: {
      enabled: true,
      checkAutomatically: "NEVER",
      fallbackToCacheTimeout: 0,
      url: `https://u.expo.dev/${projectId}`,
    },
    ios: {
      appleTeamId: "A5U93R249R",
      bundleIdentifier: "com.bwchat.app",
      buildNumber: "8",
      associatedDomains: iosAssociatedDomains,
      runtimeVersion: { policy: "appVersion" },
      bitcode: false,
      supportsTablet: false,
      icon: "./assets/images/bwchat/icon-ios-full-bleed.png",
      entitlements: {
        "aps-environment": environment === "production" ? "production" : "development",
        "com.apple.developer.usernotifications.communication": true,
      },
      infoPlist: {
        CFBundleAllowMixedLocalizations: true,
        CFBundleLocalizations: [
          "zh-Hans",
          "zh-Hant",
          "en",
          "ja",
          "ko",
          "es",
          "fr",
          "de",
          "pt-BR",
          "ru",
        ],
        ITSAppUsesNonExemptEncryption: false,
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: false,
          // Expo Dev Client can still discover local Metro services without
          // weakening arbitrary Internet transport.
          NSAllowsLocalNetworking: environment === "development",
        },
        // Apple requires every donated communication intent to be declared by
        // the parent app. Preserve Expo Router's activity alongside messaging.
        NSUserActivityTypes: [
          "INSendMessageIntent",
          "$(PRODUCT_BUNDLE_IDENTIFIER).expo.index_route",
        ],
        NSCameraUsageDescription: "BBchat 需要使用摄像头拍摄内容及进行视频通话。",
        NSContactsUsageDescription:
          "BBchat 只读取联系人电话号码并在本机规范化、加盐哈希，用于发现已注册好友。",
        NSLocationWhenInUseUsageDescription: "BBchat 会在打开地图时使用位置，以展示附近的人。",
        NSMicrophoneUsageDescription: "BBchat 需要使用麦克风发送语音及进行通话。",
        NSPhotoLibraryAddUsageDescription: "BBchat 需要保存图片和视频到相册。",
        NSPhotoLibraryUsageDescription: "BBchat 需要选择图片和视频用于聊天及动态。",
        UIBackgroundModes: ["remote-notification", "audio"],
      },
    },
    android: {
      package: "com.bwchat.app",
      versionCode: 8,
      adaptiveIcon: {
        foregroundImage: "./assets/images/bwchat/icon.png",
        backgroundColor: "#FFFFFF",
      },
      permissions: [
        "CAMERA",
        "RECORD_AUDIO",
        "READ_CONTACTS",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "POST_NOTIFICATIONS",
        "ACCESS_NETWORK_STATE",
        "INTERNET",
        "MODIFY_AUDIO_SETTINGS",
        "SYSTEM_ALERT_WINDOW",
        "WAKE_LOCK",
        "BLUETOOTH",
      ],
    },
    web: { output: "static", favicon: "./assets/images/bwchat/icon.png" },
    plugins: [
      "expo-router",
      "./plugins/with-disabled-dev-loading-view",
      "expo-asset",
      "expo-localization",
      [
        "expo-build-properties",
        {
          ios: { deploymentTarget: "16.4" },
          android: { usesCleartextTraffic: true },
        },
      ],
      "expo-secure-store",
      "expo-notifications",
      [
        "./plugins/with-notification-service",
        {
          apiBaseUrl,
          assetBaseUrls: [apiBaseUrl, webBaseUrl, ...notificationAssetBaseUrls],
          appleTeamId: "A5U93R249R",
          buildNumber: process.env.EAS_BUILD_IOS_BUILD_NUMBER?.trim() || "8",
          bundleIdentifier: "com.bwchat.app.BWChatNotificationServiceExtension",
          deploymentTarget: "16.4",
          version: "1.0.0",
        },
      ],
      ["expo-image-picker", { photosPermission: "允许 BBchat 选择要发送的照片和视频。" }],
      [
        "expo-media-library",
        {
          photosPermission: "允许 BBchat 访问相册。",
          savePhotosPermission: "允许 BBchat 保存图片和视频到相册。",
          granularPermissions: ["photo"],
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission: "允许 BBchat 使用摄像头。",
          microphonePermission: "允许 BBchat 使用麦克风。",
          recordAudioAndroid: true,
        },
      ],
      ["expo-contacts", { contactsPermission: "允许 BBchat 查找已注册的联系人。" }],
      ["expo-location", { locationWhenInUsePermission: "允许 BBchat 在地图中使用你的位置。" }],
      "expo-sharing",
      "expo-local-authentication",
      "expo-audio",
      ["expo-video", { supportsBackgroundPlayback: true }],
      "expo-sqlite",
      "expo-background-task",
      "expo-iap",
      [
        "react-native-google-mobile-ads",
        {
          androidAppId: androidAdMobAppId,
          iosAppId: iosAdMobAppId,
          delayAppMeasurementInit: true,
        },
      ],
      [
        "@livekit/react-native-expo-plugin",
        {
          android: { audioType: "communication" },
          ios: { enableMultitaskingCameraAccess: false },
        },
      ],
      "@sentry/react-native/expo",
      // Expo config-mod callbacks are stacked, so register this fallback first;
      // its Android dangerous mod then runs after expo-splash-screen cleanup.
      "./plugins/with-transparent-android-splash-drawable",
      [
        "expo-splash-screen",
        {
          backgroundColor: "#FFFFFF",
        },
      ],
    ],
    experiments: { typedRoutes: true, reactCompiler: true },
    extra: {
      environment,
      apiBaseUrl,
      webBaseUrl,
      webSocketUrl,
      remoteConfigUrl,
      ...(sentryDsn ? { sentryDsn } : {}),
      eas: {
        projectId,
        build: {
          experimental: {
            ios: {
              appExtensions: [
                {
                  targetName: "BWChatNotificationService",
                  bundleIdentifier: "com.bwchat.app.BWChatNotificationServiceExtension",
                },
              ],
            },
          },
        },
      },
    },
  };
};
