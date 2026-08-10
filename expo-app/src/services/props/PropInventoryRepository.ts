import AsyncStorage from "@react-native-async-storage/async-storage";

import { apiRequest } from "@/api/client";
import { normalizePropBagPage, type PropBagPage } from "@/services/props/PropInventoryModels";

export const propInventoryCachePolicy = {
  ttlMilliseconds: 60_000,
  staleRetentionMilliseconds: 365 * 24 * 60 * 60 * 1_000,
} as const;

interface StoredPropBagPage {
  page: PropBagPage;
  savedAt: number;
}

const cachePrefix = "bwchat.prop-bag.v1:";

export async function getPropBag(ownerId = "", forceRefresh = false): Promise<PropBagPage> {
  const owner = ownerId.trim();
  const cached = owner ? await readCachedPropBag(owner) : null;
  if (
    cached &&
    !forceRefresh &&
    Date.now() - cached.savedAt < propInventoryCachePolicy.ttlMilliseconds
  ) {
    return cached.page;
  }
  try {
    const page = normalizePropBagPage(
      await apiRequest<unknown>("/me/prop-bag", { cache: "no-store" }),
    );
    if (owner) await saveCachedPropBag(owner, page).catch(() => undefined);
    return page;
  } catch (error) {
    if (
      cached &&
      Date.now() - cached.savedAt <=
        propInventoryCachePolicy.ttlMilliseconds +
          propInventoryCachePolicy.staleRetentionMilliseconds
    ) {
      return cached.page;
    }
    throw error;
  }
}

export async function readCachedPropBag(ownerId: string): Promise<StoredPropBagPage | null> {
  const key = propBagCacheKey(ownerId);
  if (!key) return null;
  try {
    const encoded = await AsyncStorage.getItem(key);
    if (!encoded) return null;
    const decoded = JSON.parse(encoded) as Partial<StoredPropBagPage>;
    if (typeof decoded.savedAt !== "number" || !decoded.page) return null;
    return { page: normalizePropBagPage(decoded.page), savedAt: decoded.savedAt };
  } catch {
    return null;
  }
}

export async function saveCachedPropBag(
  ownerId: string,
  page: PropBagPage,
  savedAt = Date.now(),
): Promise<void> {
  const key = propBagCacheKey(ownerId);
  if (!key) return;
  await AsyncStorage.setItem(key, JSON.stringify({ page, savedAt } satisfies StoredPropBagPage));
}

export function propBagCacheKey(ownerId: string): string {
  const owner = ownerId.trim();
  return owner ? `${cachePrefix}account:${encodeURIComponent(owner)}` : "";
}
