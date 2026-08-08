import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  normalizeScriptCategories,
  normalizeScriptPage,
  trimFoundationWhitespacesAndNewlines,
} from "@/api/normalizers";
import type { InteractiveScript, ScriptCategory, ScriptPage, ScriptScope } from "@/models";
import { scriptCenterMetrics } from "@/services/scripts/scriptCenterPolicy";

interface StoredValue<T> {
  value: T;
  updatedAt: number;
  expiresAt: number;
}

export interface CachedScriptCatalogValue<T> extends StoredValue<T> {
  isStale: boolean;
}

type ScriptLibraryChange = InteractiveScript | string | undefined;
const listenersByOwner = new Map<string, Set<(change: ScriptLibraryChange) => void>>();
const generationsByOwner = new Map<string, number>();
const storageTailsByOwner = new Map<string, Promise<void>>();

export async function loadCachedScriptCategories(
  ownerId: string,
  now = Date.now(),
): Promise<CachedScriptCatalogValue<ScriptCategory[]> | null> {
  return loadStored(categoriesKey(ownerId), ownerId, now, normalizeScriptCategories);
}

export async function saveCachedScriptCategories(
  ownerId: string,
  categories: readonly ScriptCategory[],
  now = Date.now(),
  expectedGeneration = scriptCatalogGeneration(ownerId),
): Promise<void> {
  await saveStored(
    categoriesKey(ownerId),
    ownerId,
    [...categories],
    scriptCenterMetrics.categoryTtlMilliseconds,
    now,
    expectedGeneration,
  );
}

export async function loadCachedScriptPage(
  ownerId: string,
  scope: ScriptScope,
  categoryId?: string,
  now = Date.now(),
): Promise<CachedScriptCatalogValue<ScriptPage> | null> {
  return loadStored(pageKey(ownerId, scope, categoryId), ownerId, now, normalizeScriptPage);
}

export async function saveCachedScriptPage(
  ownerId: string,
  scope: ScriptScope,
  categoryId: string | undefined,
  page: ScriptPage,
  now = Date.now(),
  expectedGeneration = scriptCatalogGeneration(ownerId),
): Promise<void> {
  await saveStored(
    pageKey(ownerId, scope, categoryId),
    ownerId,
    page,
    scriptCenterMetrics.pageTtlMilliseconds,
    now,
    expectedGeneration,
  );
}

export async function invalidateScriptCatalog(
  ownerId: string,
  change?: InteractiveScript | string,
): Promise<void> {
  const owner = ownerKey(ownerId);
  if (!owner) return;
  advanceScriptCatalogGeneration(owner);
  const prefix = pagePrefix(owner);
  try {
    await enqueueStorage(owner, async () => {
      const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
      if (keys.length > 0) await AsyncStorage.multiRemove(keys);
    });
  } catch {
    // Server save is authoritative. Cache cleanup is best effort, while the
    // library-change event below must still reach visible native-equivalent consumers.
  }
  for (const listener of listenersByOwner.get(owner) ?? []) listener(change);
}

export function scriptCatalogGeneration(ownerId: string): number {
  const owner = ownerKey(ownerId);
  return owner ? (generationsByOwner.get(owner) ?? 0) : 0;
}

export function subscribeScriptLibraryChanges(
  ownerId: string,
  listener: (change: ScriptLibraryChange) => void,
): () => void {
  const owner = ownerKey(ownerId);
  if (!owner) return () => undefined;
  const listeners = listenersByOwner.get(owner) ?? new Set<(change: ScriptLibraryChange) => void>();
  listeners.add(listener);
  listenersByOwner.set(owner, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByOwner.delete(owner);
  };
}

export function scriptCategoriesCacheKey(ownerId: string): string {
  return categoriesKey(ownerId);
}

export function scriptPageCacheKey(
  ownerId: string,
  scope: ScriptScope,
  categoryId?: string,
): string {
  return pageKey(ownerId, scope, categoryId);
}

async function loadStored<T>(
  key: string,
  ownerId: string,
  now: number,
  normalize: (value: unknown) => T,
): Promise<CachedScriptCatalogValue<T> | null> {
  if (!key) return null;
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredValue<unknown>;
    if (
      !Number.isFinite(stored.updatedAt) ||
      !Number.isFinite(stored.expiresAt) ||
      stored.value === undefined
    ) {
      await removeStoredIfUnchanged(key, ownerId, raw);
      return null;
    }
    if (now - stored.expiresAt > scriptCenterMetrics.staleRetentionMilliseconds) {
      await removeStoredIfUnchanged(key, ownerId, raw);
      return null;
    }
    return {
      value: normalize(stored.value),
      updatedAt: stored.updatedAt,
      expiresAt: stored.expiresAt,
      isStale: now >= stored.expiresAt,
    };
  } catch {
    await removeStoredIfUnchanged(key, ownerId, raw);
    return null;
  }
}

async function saveStored<T>(
  key: string,
  ownerId: string,
  value: T,
  ttl: number,
  now: number,
  expectedGeneration: number,
): Promise<void> {
  const owner = ownerKey(ownerId);
  if (!key || !owner) return;
  await enqueueStorage(owner, async () => {
    if (scriptCatalogGeneration(owner) !== expectedGeneration) return;
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ value, updatedAt: now, expiresAt: now + ttl }),
    );
  });
}

async function removeStoredIfUnchanged(key: string, ownerId: string, raw: string): Promise<void> {
  const owner = ownerKey(ownerId);
  if (!owner) return;
  await enqueueStorage(owner, async () => {
    if ((await AsyncStorage.getItem(key)) === raw) await AsyncStorage.removeItem(key);
  });
}

function advanceScriptCatalogGeneration(ownerId: string): number {
  const next = scriptCatalogGeneration(ownerId) + 1;
  generationsByOwner.set(ownerKey(ownerId), next);
  return next;
}

async function enqueueStorage(ownerId: string, operation: () => Promise<void>): Promise<void> {
  const owner = ownerKey(ownerId);
  if (!owner) return;
  const previous = storageTailsByOwner.get(owner) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  storageTailsByOwner.set(owner, current);
  try {
    await current;
  } finally {
    if (storageTailsByOwner.get(owner) === current) storageTailsByOwner.delete(owner);
  }
}

function accountPrefix(ownerId: string): string {
  const normalized = ownerKey(ownerId);
  return normalized ? `bwchat.script-catalog-v1:account:${encodeURIComponent(normalized)}:` : "";
}

function ownerKey(ownerId: string): string {
  return trimFoundationWhitespacesAndNewlines(ownerId);
}

function pagePrefix(ownerId: string): string {
  const prefix = accountPrefix(ownerId);
  return prefix ? `${prefix}scripts:list-v3:` : "";
}

function categoriesKey(ownerId: string): string {
  const prefix = accountPrefix(ownerId);
  return prefix ? `${prefix}scripts:categories` : "";
}

function pageKey(ownerId: string, scope: ScriptScope, categoryId?: string): string {
  const prefix = accountPrefix(ownerId);
  const categoryKey =
    categoryId !== undefined && trimFoundationWhitespacesAndNewlines(categoryId).length > 0
      ? categoryId
      : "all";
  return prefix ? `${prefix}scripts:list-v3:${scope}:${encodeURIComponent(categoryKey)}` : "";
}
