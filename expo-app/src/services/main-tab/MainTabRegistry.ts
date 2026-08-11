import type { DynamicTabDescriptor } from "@/services/remote-config/types";
import { normalizedTabName } from "@/services/remote-config/RemoteConfigService";
import { policyAllowsURL, type WebViewPolicy } from "@/services/web/WebViewPolicy";

export const dynamicMainTabSlotCount = 20;

export type MainTabID = "messages" | "map" | "discover" | "profile";

let activeRouteNameByTabID: Partial<Record<MainTabID, string>> = {
  messages: "conversations",
  map: "map",
  discover: "discover",
  profile: "profile",
};

const staticRouteByNativeName: Readonly<Record<string, string>> = {
  messages: "conversations",
  map: "map",
  nearby: "map",
  discover: "discover",
  profile: "profile",
};

export interface MainTabEntry {
  descriptor: DynamicTabDescriptor;
  routeName: string;
  slotIndex?: number | undefined;
}

export type DynamicMainTabRootResolution =
  | {
      kind: "native";
      name: "messages" | "map" | "nearby" | "discover" | "profile";
    }
  | { kind: "screen"; screenId: string }
  | { kind: "web"; url: string }
  | { kind: "placeholder" };

export function resolveMainTabEntries(
  descriptors: readonly DynamicTabDescriptor[],
): MainTabEntry[] {
  const usedStaticRoutes = new Set<string>();
  let nextSlotIndex = 0;
  const entries: MainTabEntry[] = [];

  for (const descriptor of descriptors) {
    const staticRoute = staticRouteByNativeName[normalizedTabName(descriptor)];
    if (staticRoute && !usedStaticRoutes.has(staticRoute)) {
      usedStaticRoutes.add(staticRoute);
      entries.push({ descriptor, routeName: staticRoute });
      continue;
    }
    if (nextSlotIndex >= dynamicMainTabSlotCount) continue;
    const slotIndex = nextSlotIndex++;
    entries.push({
      descriptor,
      routeName: dynamicMainTabSlotRouteName(slotIndex),
      slotIndex,
    });
  }
  return entries;
}

export function dynamicMainTabSlotRouteName(slotIndex: number): string {
  return `dynamic-tab-${String(slotIndex).padStart(2, "0")}`;
}

export function mainTabDescriptorTitle(
  descriptor: DynamicTabDescriptor,
  fallback: string,
  language: string,
  translate: (key: string) => string,
): string {
  const localized = localizedMainTabText(descriptor.titleI18n, language);
  const titleKey = descriptor.titleKey?.trim();
  const translated = titleKey ? translate(titleKey) : "";
  return (
    localized ||
    (titleKey && translated !== titleKey ? translated : "") ||
    descriptor.title?.trim() ||
    descriptor.id.trim() ||
    fallback
  );
}

export function publishActiveMainTabEntries(entries: readonly MainTabEntry[]): void {
  const next: Partial<Record<MainTabID, string>> = {};
  for (const entry of entries) {
    const id = normalizeToken(entry.descriptor.id);
    if (isMainTabID(id)) next[id] = entry.routeName;
  }
  activeRouteNameByTabID = next;
}

export function activeMainTabRouteName(tabID: MainTabID): string | undefined {
  return activeRouteNameByTabID[tabID];
}

export function resetActiveMainTabEntriesForTests(): void {
  activeRouteNameByTabID = {
    messages: "conversations",
    map: "map",
    discover: "discover",
    profile: "profile",
  };
}

export function mainTabSignature(
  entries: readonly MainTabEntry[],
  language: string,
  translate: (key: string) => string,
): string {
  return entries
    .map(({ descriptor }) =>
      [
        descriptor.id,
        mainTabDescriptorTitle(descriptor, descriptor.id, language, translate),
        descriptor.systemImage ?? "",
        descriptor.selectedSystemImage ?? "",
        descriptor.route ? normalizeToken(descriptor.route.type ?? "coming_soon") : "",
        descriptor.route?.name ?? "",
        descriptor.route?.url ?? "",
        descriptor.route?.screenId ?? "",
      ].join(":"),
    )
    .join("|");
}

export function resolveDynamicMainTabRoot(
  descriptor: DynamicTabDescriptor,
  webViewPolicy: WebViewPolicy,
): DynamicMainTabRootResolution {
  const nativeName = normalizedTabName(descriptor);
  if (["messages", "map", "nearby", "discover", "profile"].includes(nativeName)) {
    return {
      kind: "native",
      name: nativeName as Extract<DynamicMainTabRootResolution, { kind: "native" }>["name"],
    };
  }

  const route = descriptor.route;
  const type = normalizeToken(
    route ? (route.type ?? "coming_soon") : (descriptor.type ?? "native"),
  );
  if (type === "screen") {
    return {
      kind: "screen",
      screenId: route?.screenId?.trim() || route?.name?.trim() || descriptor.id,
    };
  }
  if (["web", "h5", "url"].includes(type)) {
    const url = route?.url?.trim() ?? "";
    if (url && policyAllowsURL(url, webViewPolicy)) return { kind: "web", url };
  }
  return { kind: "placeholder" };
}

function normalizeToken(value: string): string {
  return value.trim().replaceAll("-", "_").toLocaleLowerCase();
}

function isMainTabID(value: string): value is MainTabID {
  return ["messages", "map", "discover", "profile"].includes(value);
}

function localizedMainTabText(
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
