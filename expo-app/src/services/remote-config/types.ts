export type FeatureKey =
  | "aiImageEnabled"
  | "aiVideoEnabled"
  | "paymentEnabled"
  | "maintenanceMode"
  | "momentsEnabled"
  | "mapEnabled"
  | "gamesEnabled"
  | "shortDramaEnabled"
  | "voiceVideoCallEnabled";

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rolloutPercentage?: number | undefined;
  salt?: string | undefined;
  minAppVersion?: string | undefined;
  maxAppVersion?: string | undefined;
  minBuild?: number | undefined;
  maxBuild?: number | undefined;
}

export interface DynamicRoute {
  type?: string | undefined;
  name?: string | undefined;
  url?: string | undefined;
  screenId?: string | undefined;
  titleKey?: string | undefined;
  title?: string | undefined;
  titleI18n?: Record<string, string> | undefined;
  messageKey?: string | undefined;
  message?: string | undefined;
  messageI18n?: Record<string, string> | undefined;
  params?: Record<string, unknown> | undefined;
}

export interface DynamicTabDescriptor {
  id: string;
  type?: string | undefined;
  titleKey?: string | undefined;
  title?: string | undefined;
  titleI18n?: Record<string, string> | undefined;
  systemImage?: string | undefined;
  selectedSystemImage?: string | undefined;
  order?: number | undefined;
  enabled?: boolean | undefined;
  route?: DynamicRoute | undefined;
  badgeKey?: string | undefined;
  minAppVersion?: string | undefined;
  minBuild?: number | undefined;
}

export interface DynamicSectionItem {
  id: string;
  type?: string | undefined;
  titleKey?: string | undefined;
  title?: string | undefined;
  titleI18n?: Record<string, string> | undefined;
  subtitleKey?: string | undefined;
  subtitle?: string | undefined;
  subtitleI18n?: Record<string, string> | undefined;
  systemImage?: string | undefined;
  remoteIconKey?: string | undefined;
  colors?: string[] | undefined;
  badgeKey?: string | undefined;
  badgeCount?: number | undefined;
  dotKey?: string | undefined;
  showsDot?: boolean | undefined;
  enabled?: boolean | undefined;
  order?: number | undefined;
  minAppVersion?: string | undefined;
  minBuild?: number | undefined;
  route?: DynamicRoute | undefined;
}

export interface DynamicSection {
  id: string;
  titleKey?: string | undefined;
  title?: string | undefined;
  titleI18n?: Record<string, string> | undefined;
  enabled?: boolean | undefined;
  order?: number | undefined;
  items: DynamicSectionItem[];
}

export interface AppKillSwitch {
  enabled: boolean;
  message?: string | Record<string, string> | undefined;
}

export interface AccountRemoteConfig {
  supportEmail?: string | undefined;
  privacyScreenId: string;
  dataPrivacyScreenId: string;
  accountDeletionUrl: string;
}

export interface RemoteConfig {
  schemaVersion: number;
  configVersion: string;
  generatedAt?: string | undefined;
  minSupportedAppVersion?: string | undefined;
  minSupportedBuild?: number | undefined;
  refreshIntervalSeconds: number;
  killSwitch?: AppKillSwitch | undefined;
  featureFlags: FeatureFlag[];
  tabs: DynamicTabDescriptor[];
  profileSections: DynamicSection[];
  contactModules: DynamicSection[];
  discover?: unknown;
  theme?: unknown;
  webViewPolicy: import("@/services/web/WebViewPolicy").WebViewPolicy;
  assetManifest?: unknown;
  stickerPacks?: unknown[] | undefined;
  wallet?: unknown;
  account?: AccountRemoteConfig | undefined;
  reviewMode?: unknown;
  screens?: import("@/services/dynamic-screen/DynamicScreenModels").DynamicScreen[] | undefined;

  // Compatibility projection used by migrated screens while their individual
  // native feature-flag keys are being ported.
  features: Record<FeatureKey, boolean>;
  update?:
    | {
        forceUpdate: boolean;
        message?: string | undefined;
        storeUrl?: string | undefined;
      }
    | undefined;
}

export type RemoteConfigSource = "bundled" | "cache" | "remote";
