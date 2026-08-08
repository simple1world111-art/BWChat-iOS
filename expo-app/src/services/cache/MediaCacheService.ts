import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import {
  adoptNativeLocalMediaFile,
  clearAllNativeMediaCache,
  clearNativeMediaCacheAccount,
  getNativeCachedMediaUri,
  hasNativeMediaCache,
  nativeMediaCacheUsageBytes,
  startNativeMediaCache,
} from "../../../modules/bwchat-media-cache/src";
import { prepareVideoAuthorizationHeaders } from "@/services/media/VideoPlaybackSource";
import type { VideoAuthorizationPolicy } from "@/services/media/VideoPlaybackSource";

export interface MediaCacheEntry {
  id: string;
  remote_url: string;
  relative_path: string;
  byte_count: number;
  created_at: number;
  last_accessed_at: number;
}

export const mediaCachePolicy = {
  scheduleDelayMilliseconds: 5_000,
  minimumFreeSpaceBytes: 2 * 1_024 * 1_024 * 1_024,
  staleAgeMilliseconds: 30 * 24 * 60 * 60 * 1_000,
  minimumBudgetBytes: 512 * 1_024 * 1_024,
  maximumBudgetBytes: 5 * 1_024 * 1_024 * 1_024,
  adaptiveBudgetFraction: 0.15,
};

const indexPrefix = "bwchat.media-cache.v1:";
const rootDirectory = new Directory(Paths.cache, "bwchat-media", "video");
const indexes = new Map<string, Map<string, MediaCacheEntry>>();
const loading = new Map<string, Promise<Map<string, MediaCacheEntry>>>();
const downloads = new Map<string, Promise<string | null>>();
const scheduled = new Map<string, ReturnType<typeof setTimeout>>();
const usageListeners = new Map<string, Set<(byteCount: number) => void>>();

export function mediaCacheIndexKey(ownerId: string): string {
  return `${indexPrefix}${encodeURIComponent(ownerId.trim())}`;
}

export function chatVideoMediaCacheId(remoteUrl: string): string {
  return `chat-video:${remoteUrl.trim()}`;
}

export function isHlsMediaUrl(remoteUrl: string): boolean {
  const normalized = remoteUrl.toLowerCase();
  return normalized.includes(".m3u8");
}

export async function mediaCacheUsageBytes(ownerId: string): Promise<number> {
  const owner = ownerId.trim();
  if (!owner) return 0;
  const nativeBytes = hasNativeMediaCache()
    ? await nativeMediaCacheUsageBytes(owner).catch(() => 0)
    : 0;
  const entries = await loadIndex(owner);
  const directory = await accountDirectory(owner, false);
  let changed = false;
  for (const entry of [...entries.values()]) {
    if (new File(directory, entry.relative_path).exists) continue;
    entries.delete(entry.id);
    changed = true;
  }
  if (changed) await persistIndex(owner, entries).catch(() => undefined);
  return nativeBytes + cachedByteCount(entries);
}

export function subscribeMediaCacheUsage(
  ownerId: string,
  listener: (byteCount: number) => void,
): () => void {
  const owner = ownerId.trim();
  if (!owner) return () => undefined;
  const listeners = usageListeners.get(owner) ?? new Set<(byteCount: number) => void>();
  listeners.add(listener);
  usageListeners.set(owner, listeners);
  return () => {
    const current = usageListeners.get(owner);
    current?.delete(listener);
    if (current?.size === 0) usageListeners.delete(owner);
  };
}

export function mediaCacheBudgetBytes(availableBytes: number, cachedBytes: number): number {
  const adaptive = Math.floor(
    Math.max(availableBytes + cachedBytes, 0) * mediaCachePolicy.adaptiveBudgetFraction,
  );
  return Math.min(
    mediaCachePolicy.maximumBudgetBytes,
    Math.max(mediaCachePolicy.minimumBudgetBytes, adaptive),
  );
}

export function mediaCachePruneIds(
  entries: readonly MediaCacheEntry[],
  availableBytes: number,
  now = Date.now(),
): string[] {
  const staleCutoff = now - mediaCachePolicy.staleAgeMilliseconds;
  const stale = entries.filter((entry) => entry.last_accessed_at < staleCutoff);
  const staleIds = new Set(stale.map((entry) => entry.id));
  let retainedBytes = entries.reduce(
    (total, entry) => total + (staleIds.has(entry.id) ? 0 : Math.max(0, entry.byte_count)),
    0,
  );
  const budget = mediaCacheBudgetBytes(availableBytes, retainedBytes);
  const removed = [...staleIds];
  for (const entry of entries
    .filter((candidate) => !staleIds.has(candidate.id))
    .sort((left, right) => left.last_accessed_at - right.last_accessed_at)) {
    if (retainedBytes <= budget) break;
    removed.push(entry.id);
    retainedBytes -= Math.max(0, entry.byte_count);
  }
  return removed;
}

export async function getCachedMediaUri(ownerId: string, mediaId: string): Promise<string | null> {
  const owner = ownerId.trim();
  const id = mediaId.trim();
  if (!owner || !id) return null;
  if (hasNativeMediaCache()) {
    const nativeUri = await getNativeCachedMediaUri(owner, id).catch(() => null);
    if (nativeUri) return nativeUri;
  }
  const entries = await loadIndex(owner);
  const entry = entries.get(id);
  if (!entry) return null;
  const directory = await accountDirectory(owner, false);
  const file = new File(directory, entry.relative_path);
  if (!file.exists) {
    entries.delete(id);
    await persistIndex(owner, entries);
    return null;
  }
  entry.last_accessed_at = Date.now();
  entries.set(id, entry);
  await persistIndex(owner, entries);
  return file.uri;
}

export function scheduleMediaCache(options: {
  ownerId: string;
  mediaId: string;
  remoteUrl: string;
  delayMilliseconds?: number;
  authorizationPolicy?: VideoAuthorizationPolicy;
}): () => void {
  const owner = options.ownerId.trim();
  const mediaId = options.mediaId.trim();
  const remoteUrl = options.remoteUrl.trim();
  if (
    !owner ||
    !mediaId ||
    !isDownloadableRemoteUrl(remoteUrl) ||
    (isHlsMediaUrl(remoteUrl) && !hasNativeMediaCache())
  ) {
    return () => undefined;
  }
  const key = flightKey(owner, mediaId);
  const previous = scheduled.get(key);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(
    () => {
      scheduled.delete(key);
      void startScheduledMediaCache({
        ownerId: owner,
        mediaId,
        remoteUrl,
        ...(options.authorizationPolicy
          ? { authorizationPolicy: options.authorizationPolicy }
          : {}),
      });
    },
    Math.max(options.delayMilliseconds ?? mediaCachePolicy.scheduleDelayMilliseconds, 0),
  );
  scheduled.set(key, timer);
  return () => cancelScheduledMediaCache(owner, mediaId);
}

export function cancelScheduledMediaCache(ownerId: string, mediaId: string): void {
  const key = flightKey(ownerId.trim(), mediaId.trim());
  const timer = scheduled.get(key);
  if (timer) clearTimeout(timer);
  scheduled.delete(key);
}

export async function cacheMediaFile(options: {
  ownerId: string;
  mediaId: string;
  remoteUrl: string;
  authorizationPolicy?: VideoAuthorizationPolicy;
}): Promise<string | null> {
  const owner = options.ownerId.trim();
  const mediaId = options.mediaId.trim();
  const remoteUrl = options.remoteUrl.trim();
  if (!owner || !mediaId || !isDownloadableRemoteUrl(remoteUrl) || isHlsMediaUrl(remoteUrl))
    return null;
  const existing = await getCachedMediaUri(owner, mediaId);
  if (existing) return existing;
  if (Paths.availableDiskSpace <= mediaCachePolicy.minimumFreeSpaceBytes) return null;
  const key = flightKey(owner, mediaId);
  const active = downloads.get(key);
  if (active) return active;
  const task = downloadMediaFile(owner, mediaId, remoteUrl, options.authorizationPolicy).finally(
    () => downloads.delete(key),
  );
  downloads.set(key, task);
  return task;
}

export async function adoptLocalMediaFile(options: {
  ownerId: string;
  mediaId: string;
  remoteUrl: string;
  sourceUri: string;
}): Promise<string | null> {
  const owner = options.ownerId.trim();
  const mediaId = options.mediaId.trim();
  const source = new File(options.sourceUri);
  if (!owner || !mediaId || !source.exists) return null;
  if (hasNativeMediaCache()) {
    const adopted = await adoptNativeLocalMediaFile({
      ownerId: owner,
      mediaId,
      remoteUrl: options.remoteUrl,
      sourceUri: options.sourceUri,
    }).catch(() => null);
    if (adopted) return adopted;
  }
  const directory = await accountDirectory(owner, true);
  const filename = `${await sha256(mediaId)}${safeExtension(options.sourceUri)}`;
  const destination = new File(directory, filename);
  if (destination.exists) destination.delete();
  try {
    await source.copy(destination);
    const now = Date.now();
    const entries = await loadIndex(owner);
    entries.set(mediaId, {
      id: mediaId,
      remote_url: options.remoteUrl,
      relative_path: filename,
      byte_count: destination.size ?? 0,
      created_at: now,
      last_accessed_at: now,
    });
    await pruneMediaCache(owner, entries, now);
    await persistIndex(owner, entries);
    return destination.uri;
  } catch {
    if (destination.exists) destination.delete();
    return null;
  }
}

export async function clearMediaCacheForAccount(ownerId: string): Promise<void> {
  const owner = ownerId.trim();
  if (!owner) return;
  if (hasNativeMediaCache()) {
    await clearNativeMediaCacheAccount(owner).catch(() => undefined);
  }
  for (const [key, timer] of scheduled) {
    if (!key.startsWith(`${owner}\u0000`)) continue;
    clearTimeout(timer);
    scheduled.delete(key);
  }
  const directory = await accountDirectory(owner, false);
  if (directory.exists) directory.delete();
  indexes.delete(owner);
  loading.delete(owner);
  emitUsage(owner, 0);
  await AsyncStorage.removeItem(mediaCacheIndexKey(owner));
}

export async function clearAllMediaCache(): Promise<void> {
  const owners = new Set([...indexes.keys(), ...usageListeners.keys()]);
  if (hasNativeMediaCache()) {
    await clearAllNativeMediaCache().catch(() => undefined);
  }
  for (const timer of scheduled.values()) clearTimeout(timer);
  scheduled.clear();
  if (rootDirectory.exists) rootDirectory.delete();
  indexes.clear();
  loading.clear();
  for (const owner of owners) emitUsage(owner, 0);
  const keys = await AsyncStorage.getAllKeys();
  const indexKeys = keys.filter((key) => key.startsWith(indexPrefix));
  if (indexKeys.length > 0) await AsyncStorage.multiRemove(indexKeys);
}

async function startScheduledMediaCache(options: {
  ownerId: string;
  mediaId: string;
  remoteUrl: string;
  authorizationPolicy?: VideoAuthorizationPolicy;
}): Promise<void> {
  if (await getCachedMediaUri(options.ownerId, options.mediaId)) return;
  if (!hasNativeMediaCache()) {
    await cacheMediaFile(options);
    return;
  }
  try {
    const headers = await authorizationHeaders(
      options.remoteUrl,
      options.authorizationPolicy ?? "auto",
    );
    await startNativeMediaCache({
      ownerId: options.ownerId,
      mediaId: options.mediaId,
      remoteUrl: options.remoteUrl,
      ...(headers ? { authorizationHeaders: headers } : {}),
    });
  } catch {
    // Cache warm-up is best effort and must never affect active playback.
  }
}

async function downloadMediaFile(
  owner: string,
  mediaId: string,
  remoteUrl: string,
  authorizationPolicy: VideoAuthorizationPolicy = "auto",
): Promise<string | null> {
  const directory = await accountDirectory(owner, true);
  const filename = `${await sha256(mediaId)}${safeExtension(remoteUrl)}`;
  const destination = new File(directory, filename);
  const partial = new File(directory, `${filename}.partial`);
  if (partial.exists) partial.delete();
  try {
    const headers = await authorizationHeaders(remoteUrl, authorizationPolicy);
    const downloaded = await File.downloadFileAsync(remoteUrl, partial, {
      ...(headers ? { headers } : {}),
      idempotent: true,
    });
    if (destination.exists) destination.delete();
    await downloaded.move(destination);
    const now = Date.now();
    const entries = await loadIndex(owner);
    entries.set(mediaId, {
      id: mediaId,
      remote_url: remoteUrl,
      relative_path: filename,
      byte_count: destination.size ?? 0,
      created_at: now,
      last_accessed_at: now,
    });
    await pruneMediaCache(owner, entries, now);
    await persistIndex(owner, entries);
    return destination.uri;
  } catch {
    if (partial.exists) partial.delete();
    return null;
  }
}

async function loadIndex(owner: string): Promise<Map<string, MediaCacheEntry>> {
  const current = indexes.get(owner);
  if (current) return current;
  const pending = loading.get(owner);
  if (pending) return pending;
  const task = (async () => {
    let entries = new Map<string, MediaCacheEntry>();
    try {
      const raw = await AsyncStorage.getItem(mediaCacheIndexKey(owner));
      const decoded: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(decoded)) {
        entries = new Map(
          decoded
            .map(normalizeEntry)
            .filter((entry): entry is MediaCacheEntry => entry !== undefined)
            .map((entry) => [entry.id, entry]),
        );
      }
    } catch {
      entries = new Map();
    }
    indexes.set(owner, entries);
    loading.delete(owner);
    return entries;
  })();
  loading.set(owner, task);
  return task;
}

async function persistIndex(owner: string, entries: Map<string, MediaCacheEntry>): Promise<void> {
  emitUsage(owner, cachedByteCount(entries));
  await AsyncStorage.setItem(mediaCacheIndexKey(owner), JSON.stringify([...entries.values()]));
}

function cachedByteCount(entries: Map<string, MediaCacheEntry>): number {
  return [...entries.values()].reduce((total, entry) => total + Math.max(0, entry.byte_count), 0);
}

function emitUsage(owner: string, byteCount: number): void {
  for (const listener of usageListeners.get(owner) ?? []) listener(byteCount);
}

async function pruneMediaCache(
  owner: string,
  entries: Map<string, MediaCacheEntry>,
  now: number,
): Promise<void> {
  const directory = await accountDirectory(owner, false);
  for (const entry of [...entries.values()]) {
    if (!new File(directory, entry.relative_path).exists) entries.delete(entry.id);
  }
  for (const id of mediaCachePruneIds([...entries.values()], Paths.availableDiskSpace, now)) {
    const entry = entries.get(id);
    if (!entry) continue;
    const file = new File(directory, entry.relative_path);
    if (file.exists) file.delete();
    entries.delete(id);
  }
}

async function accountDirectory(owner: string, create: boolean): Promise<Directory> {
  const directory = new Directory(rootDirectory, await sha256(`account:${owner}`));
  if (create && !directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function normalizeEntry(value: unknown): MediaCacheEntry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<MediaCacheEntry>;
  if (typeof item.id !== "string" || !item.id.trim() || typeof item.relative_path !== "string")
    return undefined;
  return {
    id: item.id,
    remote_url: typeof item.remote_url === "string" ? item.remote_url : "",
    relative_path: item.relative_path,
    byte_count: finiteNumber(item.byte_count),
    created_at: finiteNumber(item.created_at),
    last_accessed_at: finiteNumber(item.last_accessed_at),
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeExtension(uri: string): string {
  try {
    const pathname = new URL(uri).pathname;
    const match = pathname.match(/\.([a-z0-9]{1,8})$/i);
    return match ? `.${match[1]!.toLowerCase()}` : ".mp4";
  } catch {
    const match = uri.match(/\.([a-z0-9]{1,8})(?:\?.*)?$/i);
    return match ? `.${match[1]!.toLowerCase()}` : ".mp4";
  }
}

function isDownloadableRemoteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function authorizationHeaders(
  remoteUrl: string,
  authorizationPolicy: VideoAuthorizationPolicy,
): Promise<Record<string, string> | undefined> {
  return prepareVideoAuthorizationHeaders(remoteUrl, undefined, authorizationPolicy);
}

function flightKey(owner: string, mediaId: string): string {
  return `${owner}\u0000${mediaId}`;
}

function sha256(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}
