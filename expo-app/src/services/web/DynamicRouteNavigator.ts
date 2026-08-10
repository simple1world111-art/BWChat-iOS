import * as Linking from "expo-linking";
import { router, type Href } from "expo-router";

import { selectMainTab } from "@/services/main-tab/MainTabNavigation";
import type { MainTabID } from "@/services/main-tab/MainTabRegistry";
import type { DynamicRoute } from "@/services/remote-config/types";
import { policyAllowsURL, type WebViewPolicy } from "@/services/web/WebViewPolicy";

export type DynamicRouteOutcome =
  { handled: true } | { handled: false; title: string; message: string };

const nativeDestinations: Readonly<Record<string, Href>> = {
  messages: "/(tabs)/conversations",
  contacts: "/contacts",
  map: "/(tabs)/map",
  discover: "/(tabs)/discover",
  test: "/(tabs)/test" as Href,
  profile: "/(tabs)/profile",
  moments: "/moments",
  my_moments: { pathname: "/moments", params: { mode: "mine" } },
  groups: { pathname: "/group-list", params: { mode: "public" } },
  my_groups: { pathname: "/group-list", params: { mode: "mine" } },
  nearby: "/nearby",
  wallet: "/wallet",
  prop_bag: "/prop-bag" as Href,
  activity_center: "/activity-center" as Href,
  settings: "/settings",
  edit_profile: "/edit-profile",
  friend_requests: "/friend-requests",
  add_friend: "/add-friend",
  create_group: "/create-group",
  agent_create: "/agent-creator",
  agent_hub: "/agent-hub",
  games: "/game-center" as Href,
  game_center: "/game-center" as Href,
  short_drama: "/short-drama-series",
  my_short_dramas: "/short-drama-studio",
  script_center: "/script-center",
};

const rootTabs = new Set<MainTabID>(["messages", "map", "discover", "test", "profile"]);

export async function openDynamicRoute(
  route: DynamicRoute | undefined,
  policy: WebViewPolicy,
  fallbackTitle: string,
  comingSoonMessage: string,
  language: string,
  translate: (key: string) => string,
): Promise<DynamicRouteOutcome> {
  if (!route) return failure(fallbackTitle, comingSoonMessage);
  const type = normalizeToken(route.type ?? "coming_soon");
  const title =
    localizedDynamicText(route.titleI18n, language) ||
    translatedRouteKey(route.titleKey, translate) ||
    nonblank(route.title) ||
    fallbackTitle;
  const message =
    localizedDynamicText(route.messageI18n, language) ||
    translatedRouteKey(route.messageKey, translate) ||
    nonblank(route.message);
  if (type === "native") {
    const name = normalizeToken(route.name ?? "");
    const destination = nativeDestinations[name];
    if (!destination) return failure(title, message || comingSoonMessage);
    if (isMainTabID(name)) selectMainTab(name);
    else router.push(destination);
    return { handled: true };
  }

  if (["web", "h5", "url"].includes(type)) {
    const url = nonblank(route.url);
    if (!url || !policyAllowsURL(url, policy, { allowDevelopmentLocalhost: __DEV__ })) {
      return failure(
        title,
        message || translatedRouteKey("common.operationFailed", translate) || "操作失败",
      );
    }
    router.push({ pathname: "/in-app-web", params: { url, title } } as unknown as Href);
    return { handled: true };
  }

  if (type === "external") {
    const url = route.url;
    if (dynamicBool(route.params?.allow_external) !== true || !url) {
      return failure(title, message || comingSoonMessage);
    }
    // UIApplication.shared.open is fire-and-forget in DynamicRouteHandler and
    // the route is considered handled once its explicit allowlist bit passes.
    void Linking.openURL(url).catch(() => undefined);
    return { handled: true };
  }

  if (type === "screen") {
    const id = nonblank(route.screenId) || nonblank(route.name);
    if (!id) return failure(title, message || comingSoonMessage);
    router.push({ pathname: "/dynamic-screen/[id]", params: { id } } as unknown as Href);
    return { handled: true };
  }

  return failure(title, message || comingSoonMessage);
}

export function localizedDynamicText(
  values: Record<string, string> | undefined,
  language: string,
): string | undefined {
  if (!values) return undefined;
  const normalized = language.replaceAll("_", "-");
  const base = normalized.split("-")[0] ?? "";
  for (const key of [language, normalized, base, "en", "zh-Hans"]) {
    const value = values[key];
    if (value?.trim()) return value;
  }
  return undefined;
}

function failure(title: string, message: string): DynamicRouteOutcome {
  return { handled: false, title, message };
}

function normalizeToken(value: string): string {
  return value.trim().replaceAll("-", "_").toLocaleLowerCase();
}

function isMainTabID(value: string): value is MainTabID {
  return rootTabs.has(value as MainTabID);
}

function translatedRouteKey(
  key: string | undefined,
  translate: (key: string) => string,
): string | undefined {
  const normalized = nonblank(key);
  if (!normalized) return undefined;
  const translated = translate(normalized);
  return translated !== normalized ? translated : undefined;
}

function nonblank(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function dynamicBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return undefined;
}
