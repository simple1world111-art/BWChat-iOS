import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Platform } from "react-native";
import { z } from "zod";

import { refreshAccessToken } from "@/api/client";
import { isRecord } from "@/api/normalizers";
import { env } from "@/config/env";
import {
  defaultFeatures,
  defaultContactModules,
  defaultProfileSections,
  defaultRemoteConfig,
  defaultTabs,
} from "@/services/remote-config/defaultConfig";
import type {
  DynamicRoute,
  DynamicSection,
  DynamicSectionItem,
  DynamicTabDescriptor,
  FeatureFlag,
  FeatureKey,
  RemoteConfig,
} from "@/services/remote-config/types";
import { readAccessToken } from "@/storage/tokenStorage";
import { getActiveLanguageCode } from "@/providers/LocalizationProvider";
import { normalizeWebViewPolicy } from "@/services/web/WebViewPolicy";
import { parseDynamicScreenWire } from "@/services/dynamic-screen/DynamicScreenModels";

const cachePrefix = "bwchat.remote-config.v2";
const supportedSchemaVersion = 1;
const fetchInFlightByScope = new Map<string, Promise<RemoteConfigFetchResult>>();
const dynamicScreenIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,159}$/u);

const featureFlagSchema = z.object({
  key: z.string().min(1).max(160),
  enabled: z.boolean(),
  rolloutPercentage: z.number().min(0).max(100).optional(),
  salt: z.string().max(300).optional(),
  minAppVersion: z.string().max(80).optional(),
  maxAppVersion: z.string().max(80).optional(),
  minBuild: z.number().int().nonnegative().optional(),
  maxBuild: z.number().int().nonnegative().optional(),
});

const routeSchema: z.ZodType<DynamicRoute> = z.object({
  type: z.string().max(80).optional(),
  name: z.string().max(160).optional(),
  url: z.string().max(2_000).optional(),
  screenId: z.string().max(160).optional(),
  titleKey: z.string().max(160).optional(),
  title: z.string().max(300).optional(),
  titleI18n: z.record(z.string(), z.string().max(300)).optional(),
  messageKey: z.string().max(160).optional(),
  message: z.string().max(1_000).optional(),
  messageI18n: z.record(z.string(), z.string().max(1_000)).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const tabSchema: z.ZodType<DynamicTabDescriptor> = z.object({
  id: z.string().min(1).max(160),
  type: z.string().max(80).optional(),
  titleKey: z.string().max(160).optional(),
  title: z.string().max(300).optional(),
  titleI18n: z.record(z.string(), z.string().max(300)).optional(),
  systemImage: z.string().max(160).optional(),
  selectedSystemImage: z.string().max(160).optional(),
  order: z.number().int().optional(),
  enabled: z.boolean().optional(),
  route: routeSchema.optional(),
  badgeKey: z.string().max(160).optional(),
  minAppVersion: z.string().max(80).optional(),
  minBuild: z.number().int().nonnegative().optional(),
});

const sectionItemSchema: z.ZodType<DynamicSectionItem> = z.object({
  id: z.string().min(1).max(160),
  type: z.string().max(80).optional(),
  titleKey: z.string().max(160).optional(),
  title: z.string().max(300).optional(),
  titleI18n: z.record(z.string(), z.string().max(300)).optional(),
  subtitleKey: z.string().max(160).optional(),
  subtitle: z.string().max(500).optional(),
  subtitleI18n: z.record(z.string(), z.string().max(500)).optional(),
  systemImage: z.string().max(160).optional(),
  remoteIconKey: z.string().max(160).optional(),
  colors: z.array(z.string().max(20)).max(8).optional(),
  badgeKey: z.string().max(160).optional(),
  badgeCount: z.number().int().optional(),
  dotKey: z.string().max(160).optional(),
  showsDot: z.boolean().optional(),
  enabled: z.boolean().optional(),
  order: z.number().int().optional(),
  minAppVersion: z.string().max(80).optional(),
  minBuild: z.number().int().nonnegative().optional(),
  route: routeSchema.optional(),
});

const sectionSchema: z.ZodType<DynamicSection> = z.object({
  id: z.string().min(1).max(160),
  titleKey: z.string().max(160).optional(),
  title: z.string().max(300).optional(),
  titleI18n: z.record(z.string(), z.string().max(300)).optional(),
  enabled: z.boolean().optional(),
  order: z.number().int().optional(),
  items: z.array(sectionItemSchema).max(100),
});

const normalizedConfigSchema = z.object({
  schemaVersion: z.number().int().min(1).max(supportedSchemaVersion),
  configVersion: z.string().min(1).max(200),
  generatedAt: z.string().max(100).optional(),
  minSupportedAppVersion: z.string().max(80).optional(),
  minSupportedBuild: z.number().int().positive().optional(),
  refreshIntervalSeconds: z.number().int().min(60).max(86_400),
  killSwitch: z
    .object({
      enabled: z.boolean(),
      message: z
        .union([z.string().max(1_000), z.record(z.string(), z.string().max(1_000))])
        .optional(),
    })
    .optional(),
  featureFlags: z.array(featureFlagSchema).max(1_000),
  tabs: z.array(tabSchema).max(20),
  profileSections: z.array(z.unknown()),
  contactModules: z.array(z.unknown()),
  discover: z.unknown().optional(),
  theme: z.unknown().optional(),
  webViewPolicy: z.custom<RemoteConfig["webViewPolicy"]>(),
  assetManifest: z.unknown().optional(),
  stickerPacks: z.array(z.unknown()).optional(),
  wallet: z.unknown().optional(),
  account: z
    .object({
      supportEmail: z.string().email().max(254).optional(),
      privacyScreenId: dynamicScreenIdSchema,
      dataPrivacyScreenId: dynamicScreenIdSchema,
      accountDeletionUrl: z.string().url().max(2_000),
    })
    .optional(),
  reviewMode: z.unknown().optional(),
  screens: z.array(z.unknown()).optional(),
  features: z.record(z.string(), z.boolean()),
  update: z
    .object({
      forceUpdate: z.boolean(),
      message: z.string().max(500).optional(),
      storeUrl: z.string().url().optional(),
    })
    .optional(),
});

export interface RemoteConfigFetchResult {
  config: RemoteConfig;
  source: "cache" | "remote";
}

export function parseRemoteConfig(value: unknown): RemoteConfig {
  const raw = unwrapData(value);
  if (!isRecord(raw)) throw new Error("远程配置格式无效");
  const featureFlags = normalizeFeatureFlags(raw.feature_flags ?? raw.featureFlags);
  const legacyFeatures = isRecord(raw.features) ? raw.features : {};
  const normalized = {
    schemaVersion: numberValue(raw.schema_version, raw.schemaVersion) ?? 1,
    configVersion: stringValue(raw.config_version, raw.configVersion) ?? "remote",
    ...optional("generatedAt", stringValue(raw.generated_at, raw.generatedAt)),
    ...optional(
      "minSupportedAppVersion",
      stringValue(raw.min_supported_app_version, raw.minSupportedAppVersion),
    ),
    ...optional(
      "minSupportedBuild",
      numberValue(raw.min_supported_build, raw.minSupportedBuild, raw.minimumBuildNumber),
    ),
    refreshIntervalSeconds: Math.max(
      60,
      numberValue(raw.refresh_interval_seconds, raw.refreshIntervalSeconds) ?? 300,
    ),
    ...optional("killSwitch", normalizeKillSwitch(raw.kill_switch ?? raw.killSwitch)),
    featureFlags,
    tabs: normalizeTabs(raw.tabs),
    profileSections: normalizeSections(raw.profile_sections ?? raw.profileSections),
    contactModules: normalizeSections(
      raw.contact_modules ?? raw.contactModules,
      defaultContactModules,
    ),
    ...optional("discover", raw.discover),
    ...optional("theme", raw.theme),
    webViewPolicy: normalizeWebViewPolicy(raw.web_view_policy ?? raw.webViewPolicy),
    ...optional("assetManifest", raw.asset_manifest ?? raw.assetManifest),
    ...optional("stickerPacks", arrayValueOptional(raw.sticker_packs, raw.stickerPacks)),
    ...optional("wallet", raw.wallet),
    ...optional("account", normalizeAccountConfig(raw.account)),
    ...optional("reviewMode", raw.review_mode ?? raw.reviewMode),
    ...optional("screens", normalizeDynamicScreens(raw.screens)),
    features: projectFeatures(featureFlags, legacyFeatures),
    ...optional("update", normalizeUpdate(raw.update)),
  };
  return normalizedConfigSchema.parse(normalized) as RemoteConfig;
}

function normalizeAccountConfig(value: unknown): RemoteConfig["account"] {
  if (!isRecord(value)) return undefined;
  const supportEmail = stringValue(value.support_email);
  const privacyScreenId = stringValue(value.privacy_screen_id) ?? "privacy_policy";
  const dataPrivacyScreenId = stringValue(value.data_privacy_screen_id) ?? "data_privacy";
  const accountDeletionUrl =
    stringValue(value.account_deletion_url) ?? "https://id7.com/account-deletion";
  return {
    ...(supportEmail ? { supportEmail } : {}),
    privacyScreenId,
    dataPrivacyScreenId,
    accountDeletionUrl,
  };
}

function normalizeDynamicScreens(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const screens = [];
  for (const item of value) {
    const screen = parseDynamicScreenWire(item);
    if (!screen) return undefined;
    screens.push(screen);
  }
  return screens;
}

export async function readCachedRemoteConfig(ownerId?: string): Promise<RemoteConfig | null> {
  const raw = await AsyncStorage.getItem(configKey(ownerId));
  if (!raw) return null;
  try {
    return parseRemoteConfig(JSON.parse(raw) as unknown);
  } catch {
    await clearRemoteConfigCache(ownerId);
    return null;
  }
}

export function fetchRemoteConfig(
  ownerId?: string,
  timeoutMs = 8_000,
  options: { ignoreETag?: boolean } = {},
): Promise<RemoteConfigFetchResult> {
  const scope = ownerId?.trim() ? `user.${ownerId.trim()}` : "guest";
  const active = fetchInFlightByScope.get(scope);
  if (active) return active;
  const task = performRemoteConfigFetch(ownerId, timeoutMs, options).finally(() => {
    if (fetchInFlightByScope.get(scope) === task) fetchInFlightByScope.delete(scope);
  });
  fetchInFlightByScope.set(scope, task);
  return task;
}

async function performRemoteConfigFetch(
  ownerId: string | undefined,
  timeoutMs: number,
  options: { ignoreETag?: boolean },
): Promise<RemoteConfigFetchResult> {
  const [token, etag] = await Promise.all([
    readAccessToken(),
    AsyncStorage.getItem(etagKey(ownerId)),
  ]);
  return requestRemoteConfig(ownerId, timeoutMs, options, token, etag, Boolean(token));
}

async function requestRemoteConfig(
  ownerId: string | undefined,
  timeoutMs: number,
  options: { ignoreETag?: boolean },
  token: string | null,
  etag: string | null,
  canRefresh: boolean,
): Promise<RemoteConfigFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers({
      Accept: "application/json",
      "Accept-Language": resolvedLocale(),
      "X-App-Version": Application.nativeApplicationVersion ?? "1.0.0",
      "X-App-Build": Application.nativeBuildVersion ?? "0",
      "X-Platform": Platform.OS === "ios" ? "iOS" : Platform.OS,
      "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (etag && !options.ignoreETag) headers.set("If-None-Match", etag);

    const response = await fetch(env.remoteConfigUrl, { headers, signal: controller.signal });
    if (response.status === 401 && token && canRefresh) {
      const refreshedToken = await refreshAccessToken({
        invalidateSessionOnUnauthorized: false,
      });
      return requestRemoteConfig(ownerId, timeoutMs, options, refreshedToken, etag, false);
    }
    if (response.status === 304) {
      const cached = await readCachedRemoteConfig(ownerId);
      if (!cached) throw new Error("服务端返回 304，但本地配置缓存不存在");
      await AsyncStorage.setItem(lastFetchKey(ownerId), String(Date.now()));
      return { config: cached, source: "cache" };
    }
    if (!response.ok) throw new Error(`远程配置请求失败（${response.status}）`);
    const config = parseRemoteConfig((await response.json()) as unknown);
    await Promise.all([
      AsyncStorage.setItem(configKey(ownerId), JSON.stringify(config)),
      AsyncStorage.setItem(lastFetchKey(ownerId), String(Date.now())),
      response.headers.get("ETag")
        ? AsyncStorage.setItem(etagKey(ownerId), response.headers.get("ETag") as string)
        : AsyncStorage.removeItem(etagKey(ownerId)),
    ]);
    return { config, source: "remote" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function shouldRefreshRemoteConfig(
  ownerId: string | undefined,
  intervalSeconds: number,
): Promise<boolean> {
  const value = Number(await AsyncStorage.getItem(lastFetchKey(ownerId)));
  return !Number.isFinite(value) || Date.now() - value >= Math.max(intervalSeconds, 60) * 1_000;
}

export async function clearRemoteConfigCache(ownerId?: string): Promise<void> {
  await AsyncStorage.multiRemove([configKey(ownerId), etagKey(ownerId), lastFetchKey(ownerId)]);
}

export function featureFlagEnabled(
  config: RemoteConfig,
  key: string,
  subjectId: string,
  defaultValue = false,
): boolean {
  const flag = config.featureFlags.find((item) => normalizeToken(item.key) === normalizeToken(key));
  if (!flag) return defaultValue;
  const build = Number(Application.nativeBuildVersion ?? "0");
  if (!flag.enabled) return false;
  if (flag.minBuild !== undefined && build > 0 && build < flag.minBuild) return false;
  if (flag.maxBuild !== undefined && build > flag.maxBuild) return false;
  const rollout = Math.max(0, Math.min(flag.rolloutPercentage ?? 100, 100));
  if (rollout <= 0) return false;
  if (rollout >= 100) return true;
  return stableBucket(`${flag.key}|${flag.salt ?? ""}|${subjectId}`) < rollout;
}

/**
 * Whether the installed native shell is too old for the currently effective
 * server configuration.  This deliberately considers only native-version
 * gates: an OTA can update JavaScript, but it cannot add a required native
 * capability to an already installed binary.
 */
export function requiresStoreUpdate(
  config: Pick<RemoteConfig, "minSupportedAppVersion" | "minSupportedBuild" | "update">,
  installedBuild = Number(Application.nativeBuildVersion ?? "0"),
  installedVersion = Application.nativeApplicationVersion,
): boolean {
  if (config.update?.forceUpdate) return true;
  if (
    config.minSupportedBuild !== undefined &&
    Number.isFinite(installedBuild) &&
    installedBuild > 0 &&
    installedBuild < config.minSupportedBuild
  ) {
    return true;
  }
  return (
    Boolean(config.minSupportedAppVersion) &&
    Boolean(installedVersion) &&
    compareAppVersions(installedVersion as string, config.minSupportedAppVersion as string) < 0
  );
}

function compareAppVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function versionParts(value: string): number[] {
  return value
    .trim()
    .split(/[.+-]/)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
}

export function effectiveTabs(config: RemoteConfig): DynamicTabDescriptor[] {
  const build = Number(Application.nativeBuildVersion ?? "0");
  // Contacts is intentionally a pushed screen. Test was a temporary Preview
  // surface and must stay removed even if an older server config still sends
  // either its descriptor id or native route name.
  const hidden = new Set(["contacts", "test"]);
  const remote = config.tabs.filter((tab) => {
    const name = normalizedTabName(tab);
    return (
      tab.enabled !== false &&
      (tab.minBuild === undefined || build <= 0 || build >= tab.minBuild) &&
      !hidden.has(normalizeToken(tab.id)) &&
      !hidden.has(name)
    );
  });
  const candidates = remote.length > 0 ? remote : defaultTabs;
  const merged: DynamicTabDescriptor[] = [];
  const seen = new Set<string>();
  for (const tab of [...candidates].sort(compareTabs)) {
    const id = normalizeToken(tab.id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(tab);
  }
  for (const core of defaultTabs.filter((tab) =>
    ["messages", "discover", "profile"].includes(tab.id),
  )) {
    const id = normalizeToken(core.id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(core);
  }
  return merged.sort(compareTabs);
}

export function normalizedTabName(tab: DynamicTabDescriptor): string {
  const routeName = normalizeToken(tab.route?.name ?? "");
  return routeName || normalizeToken(tab.id);
}

export function effectiveProfileItems(config: RemoteConfig): DynamicSectionItem[] {
  const build = Number(Application.nativeBuildVersion ?? "0");
  const source =
    config.profileSections.length > 0 ? config.profileSections : defaultProfileSections;
  const items = source
    .filter((section) => section.enabled !== false)
    .sort(compareOrdered)
    .flatMap((section) =>
      section.items.filter((item) => item.enabled !== false).sort(compareOrdered),
    )
    .filter((item) => item.minBuild === undefined || build <= 0 || build >= item.minBuild);
  return items.length > 0 ? items : defaultProfileSections.flatMap((section) => section.items);
}

export function effectiveContactItems(config: RemoteConfig): DynamicSectionItem[] {
  const build = Number(Application.nativeBuildVersion ?? "0");
  const source = config.contactModules.length > 0 ? config.contactModules : defaultContactModules;
  const items = source
    .filter((section) => section.enabled !== false)
    .sort(compareOrdered)
    .flatMap((section) =>
      section.items.filter((item) => item.enabled !== false).sort(compareOrdered),
    )
    .filter((item) => item.minBuild === undefined || build <= 0 || build >= item.minBuild)
    .filter((item) => !["agent_hub", "ai_companions"].includes(normalizeToken(item.id)));
  return items.length > 0 ? items : defaultContactModules.flatMap((section) => section.items);
}

export { defaultRemoteConfig };

function normalizeFeatureFlags(value: unknown): FeatureFlag[] {
  if (Array.isArray(value)) return value.flatMap(normalizeFeatureFlag);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (typeof item === "boolean") return [{ key, enabled: item }];
    return normalizeFeatureFlag(
      isRecord(item) ? { ...item, key: stringValue(item.key) ?? key } : item,
    );
  });
}

function normalizeFeatureFlag(value: unknown): FeatureFlag[] {
  if (!isRecord(value)) return [];
  const key = stringValue(value.key);
  if (!key) return [];
  return [
    featureFlagSchema.parse({
      key,
      enabled: boolValue(value.enabled) ?? false,
      ...optional(
        "rolloutPercentage",
        numberValue(value.rollout_percentage, value.rolloutPercentage),
      ),
      ...optional("salt", stringValue(value.salt)),
      ...optional("minAppVersion", stringValue(value.min_app_version, value.minAppVersion)),
      ...optional("maxAppVersion", stringValue(value.max_app_version, value.maxAppVersion)),
      ...optional("minBuild", numberValue(value.min_build, value.minBuild)),
      ...optional("maxBuild", numberValue(value.max_build, value.maxBuild)),
    }),
  ];
}

function normalizeTabs(value: unknown): DynamicTabDescriptor[] {
  if (!Array.isArray(value)) return defaultTabs;
  const tabs = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.id);
    if (!id) return [];
    const route = normalizeDynamicRoute(item.route);
    return [
      tabSchema.parse({
        id,
        ...optional("type", stringValue(item.type)),
        ...optional("titleKey", stringValue(item.title_key, item.titleKey)),
        ...optional("title", stringValue(item.title)),
        ...optional("titleI18n", stringMap(item.title_i18n ?? item.titleI18n)),
        ...optional("systemImage", stringValue(item.system_image, item.systemImage)),
        ...optional(
          "selectedSystemImage",
          stringValue(item.selected_system_image, item.selectedSystemImage),
        ),
        ...optional("order", numberValue(item.order)),
        ...optional("enabled", boolValue(item.enabled)),
        ...optional("route", route),
        ...optional("badgeKey", stringValue(item.badge_key, item.badgeKey)),
        ...optional("minAppVersion", stringValue(item.min_app_version, item.minAppVersion)),
        ...optional("minBuild", numberValue(item.min_build, item.minBuild)),
      }),
    ];
  });
  return tabs.length > 0 ? tabs : defaultTabs;
}

function normalizeSections(
  value: unknown,
  fallback: DynamicSection[] = defaultProfileSections,
): DynamicSection[] {
  if (!Array.isArray(value)) return fallback;
  const sections = value.flatMap((rawSection) => {
    if (!isRecord(rawSection)) return [];
    const id = stringValue(rawSection.id);
    if (!id) return [];
    const rawItems = Array.isArray(rawSection.items) ? rawSection.items : [];
    const items = rawItems.flatMap((rawItem) => normalizeSectionItem(rawItem));
    return [
      sectionSchema.parse({
        id,
        ...optional("titleKey", stringValue(rawSection.title_key, rawSection.titleKey)),
        ...optional("title", stringValue(rawSection.title)),
        ...optional("titleI18n", stringMap(rawSection.title_i18n ?? rawSection.titleI18n)),
        ...optional("enabled", boolValue(rawSection.enabled)),
        ...optional("order", numberValue(rawSection.order)),
        items,
      }),
    ];
  });
  return sections.length > 0 ? sections : fallback;
}

function normalizeSectionItem(value: unknown): DynamicSectionItem[] {
  if (!isRecord(value)) return [];
  const id = stringValue(value.id);
  if (!id) return [];
  return [
    sectionItemSchema.parse({
      id,
      ...optional("type", stringValue(value.type)),
      ...optional("titleKey", stringValue(value.title_key, value.titleKey)),
      ...optional("title", stringValue(value.title)),
      ...optional("titleI18n", stringMap(value.title_i18n ?? value.titleI18n)),
      ...optional("subtitleKey", stringValue(value.subtitle_key, value.subtitleKey)),
      ...optional("subtitle", stringValue(value.subtitle)),
      ...optional("subtitleI18n", stringMap(value.subtitle_i18n ?? value.subtitleI18n)),
      ...optional("systemImage", stringValue(value.system_image, value.systemImage)),
      ...optional("remoteIconKey", stringValue(value.remote_icon_key, value.remoteIconKey)),
      ...optional("colors", colorArray(value.colors)),
      ...optional("badgeKey", stringValue(value.badge_key, value.badgeKey)),
      ...optional("badgeCount", numberValue(value.badge_count, value.badgeCount)),
      ...optional("dotKey", stringValue(value.dot_key, value.dotKey)),
      ...optional("showsDot", boolValue(value.shows_dot, value.showsDot)),
      ...optional("enabled", boolValue(value.enabled)),
      ...optional("order", numberValue(value.order)),
      ...optional("minAppVersion", stringValue(value.min_app_version, value.minAppVersion)),
      ...optional("minBuild", numberValue(value.min_build, value.minBuild)),
      ...optional("route", normalizeDynamicRoute(value.route)),
    }),
  ];
}

export function normalizeDynamicRoute(value: unknown): DynamicRoute | undefined {
  if (!isRecord(value)) return undefined;
  return routeSchema.parse({
    ...optional("type", stringValue(value.type)),
    ...optional("name", stringValue(value.name)),
    ...optional("url", stringValue(value.url)),
    ...optional("screenId", stringValue(value.screen_id, value.screenId)),
    ...optional("titleKey", stringValue(value.title_key, value.titleKey)),
    ...optional("title", stringValue(value.title)),
    ...optional("titleI18n", stringMap(value.title_i18n ?? value.titleI18n)),
    ...optional("messageKey", stringValue(value.message_key, value.messageKey)),
    ...optional("message", stringValue(value.message)),
    ...optional("messageI18n", stringMap(value.message_i18n ?? value.messageI18n)),
    ...optional("params", isRecord(value.params) ? value.params : undefined),
  });
}

function projectFeatures(
  flags: FeatureFlag[],
  legacy: Record<string, unknown>,
): RemoteConfig["features"] {
  const aliases: Record<FeatureKey, string[]> = {
    aiImageEnabled: ["aiImageEnabled", "ai_image_enabled"],
    aiVideoEnabled: ["aiVideoEnabled", "ai_video_enabled"],
    paymentEnabled: ["paymentEnabled", "payment_enabled"],
    maintenanceMode: ["maintenanceMode", "maintenance_mode"],
    momentsEnabled: ["momentsEnabled", "moments_enabled"],
    mapEnabled: ["mapEnabled", "map_enabled"],
    gamesEnabled: ["gamesEnabled", "games_enabled"],
    shortDramaEnabled: ["shortDramaEnabled", "short_drama_enabled"],
    voiceVideoCallEnabled: ["voiceVideoCallEnabled", "voice_video_call_enabled"],
  };
  return Object.fromEntries(
    (Object.keys(defaultFeatures) as FeatureKey[]).map((key) => {
      const alias = aliases[key].find((candidate) => legacy[candidate] !== undefined);
      const flag = flags.find((item) =>
        aliases[key].some((candidate) => normalizeToken(candidate) === normalizeToken(item.key)),
      );
      return [
        key,
        alias
          ? (boolValue(legacy[alias]) ?? defaultFeatures[key])
          : (flag?.enabled ?? defaultFeatures[key]),
      ];
    }),
  ) as RemoteConfig["features"];
}

function normalizeKillSwitch(value: unknown): RemoteConfig["killSwitch"] {
  if (!isRecord(value)) return undefined;
  const message = stringValue(value.message) ?? stringMap(value.message);
  return { enabled: boolValue(value.enabled) ?? false, ...optional("message", message) };
}

function normalizeUpdate(value: unknown): RemoteConfig["update"] {
  if (!isRecord(value)) return undefined;
  return {
    forceUpdate: boolValue(value.forceUpdate, value.force_update) ?? false,
    ...optional("message", stringValue(value.message)),
    ...optional("storeUrl", stringValue(value.storeUrl, value.store_url)),
  };
}

function unwrapData(value: unknown): unknown {
  return isRecord(value) && "data" in value ? value.data : value;
}

function optional(key: string, value: unknown): Record<string, unknown> {
  return value === undefined || value === null ? {} : { [key]: value };
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return undefined;
}

function boolValue(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true") return true;
    if (value === 0 || value === "0" || value === "false") return false;
  }
  return undefined;
}

function arrayValueOptional(...values: unknown[]): unknown[] | undefined {
  return values.find(Array.isArray) as unknown[] | undefined;
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const result = Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return Object.keys(result).length > 0 ? result : undefined;
}

function colorArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const colors = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return colors.length > 0 ? colors : undefined;
}

function normalizeToken(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function resolvedLocale(): string {
  return getActiveLanguageCode();
}

function cacheScope(ownerId?: string): string {
  return ownerId?.trim() ? `user.${ownerId.trim()}` : "guest";
}

function configKey(ownerId?: string): string {
  return `${cachePrefix}:${cacheScope(ownerId)}:config`;
}

function etagKey(ownerId?: string): string {
  return `${cachePrefix}:${cacheScope(ownerId)}:etag`;
}

function lastFetchKey(ownerId?: string): string {
  return `${cachePrefix}:${cacheScope(ownerId)}:last-fetch`;
}

function stableBucket(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 100;
}

function compareTabs(left: DynamicTabDescriptor, right: DynamicTabDescriptor): number {
  const order = (left.order ?? 0) - (right.order ?? 0);
  return order !== 0 ? order : left.id.localeCompare(right.id);
}

function compareOrdered(
  left: { id: string; order?: number | undefined },
  right: { id: string; order?: number | undefined },
): number {
  const order = (left.order ?? 0) - (right.order ?? 0);
  return order !== 0 ? order : left.id.localeCompare(right.id);
}
