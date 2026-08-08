import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";

import { apiRequest } from "@/api/client";
import { readAccessToken } from "@/storage/tokenStorage";
import {
  effectiveDiscoverSections,
  parseDiscoverConfig,
  type DiscoverConfigData,
  type DiscoverSection,
} from "@/services/discover/DiscoverConfig";

const cacheKey = "bbchat.discover.remoteConfig.v1";

export async function readCachedDiscoverConfig(): Promise<DiscoverConfigData | null> {
  const raw = await AsyncStorage.getItem(cacheKey);
  if (!raw) return null;
  try {
    return parseDiscoverConfig(JSON.parse(raw) as unknown);
  } catch {
    await AsyncStorage.removeItem(cacheKey);
    return null;
  }
}

export async function fetchDiscoverSections(): Promise<DiscoverSection[]> {
  const hasToken = Boolean(await readAccessToken());
  const payload = await apiRequest<unknown>("/app/discover-config", {
    auth: hasToken,
    refreshAuth: hasToken,
    invalidateSessionOnUnauthorized: hasToken,
    cache: "no-store",
    headers: {
      "X-App-Version": Application.nativeApplicationVersion ?? "1.0.0",
      "X-App-Build": Application.nativeBuildVersion ?? "0",
    },
    timeoutMs: 8_000,
  });
  const config = parseDiscoverConfig(payload);
  const sections = effectiveDiscoverSections(config);
  if (sections.length > 0) await AsyncStorage.setItem(cacheKey, JSON.stringify(config));
  return sections;
}
