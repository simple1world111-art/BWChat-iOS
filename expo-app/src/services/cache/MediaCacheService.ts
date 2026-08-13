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
  maximumSingleFileBytes: 512 * 1_024 * 1_024,
  staleAgeMilliseconds: 30 * 24 * 60 * 60 * 1_000,
  minimumBudgetBytes: 512 * 1_024 * 1_024,
  maximumBudgetBytes: 5 * 1_024 * 1_024 * 1_024,
  adaptiveBudgetFraction: 0.15,
};

const indexPrefix = "bwchat.media-cache.v1:";
const rootDirectory = new Directory(Paths.cache, "bwchat-media", "video");
const indexes = new Map<string, Map<string, MediaCacheEntry>>();
const loading = new Map<string, Promise<Map<string, MediaCacheEntry>>>();
type ActiveMediaDownload = {
  controller: AbortController;
  promise: Promise<string | null>;
  waiters: Set<symbol>;
};
type MediaCacheGeneration = { global: number; owner: number };
const downloads = new Map<string, ActiveMediaDownload>();
const scheduled = new Map<string, ReturnType<typeof setTimeout>>();
const usageListeners = new Map<string, Set<(byteCount: number) => void>>();
const ownerGenerations = new Map<string, number>();
let globalGeneration = 0;

export function mediaCacheIndexKey(ownerId: string): string {
  return `${indexPrefix}${encodeURIComponent(ownerId.trim())}`;
}

export function chatVideoMediaCacheId(remoteUrl: string): string {
  // v4 also bypasses the short-lived v3 native warm-up path. Older native
  // modules could persist an HTTP error body after the JS Range probe passed.
  return `chat-video:v4:${remoteUrl.trim()}`;
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

export function mediaCacheDownloadByteLimit(availableBytes: number): number {
  if (!Number.isFinite(availableBytes)) return 0;
  return Math.max(
    0,
    Math.min(
      mediaCachePolicy.maximumSingleFileBytes,
      Math.floor(availableBytes) - mediaCachePolicy.minimumFreeSpaceBytes,
    ),
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
    if (nativeUri) {
      if (nativeUri.toLowerCase().includes(".movpkg")) return nativeUri;
      const nativeFile = new File(nativeUri);
      if (mediaCacheFileLooksPlayable(nativeFile, nativeUri)) return nativeUri;
    }
  }
  const entries = await loadIndex(owner);
  const entry = entries.get(id);
  if (!entry) return null;
  const directory = await accountDirectory(owner, false);
  const file = new File(directory, entry.relative_path);
  if (!file.exists || !mediaCacheFileLooksPlayable(file, entry.remote_url)) {
    if (file.exists) file.delete();
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
  signal?: AbortSignal;
}): Promise<string | null> {
  const owner = options.ownerId.trim();
  const mediaId = options.mediaId.trim();
  const remoteUrl = options.remoteUrl.trim();
  if (!owner || !mediaId || !isDownloadableRemoteUrl(remoteUrl) || isHlsMediaUrl(remoteUrl))
    return null;
  const generation = currentMediaCacheGeneration(owner);
  const existing = await getCachedMediaUri(owner, mediaId);
  if (!mediaCacheGenerationIsCurrent(owner, generation)) return null;
  if (existing) return existing;
  if (options.signal?.aborted) return null;
  const byteLimit = mediaCacheDownloadByteLimit(Paths.availableDiskSpace);
  if (byteLimit < 12) return null;
  const key = flightKey(owner, mediaId);
  const active = downloads.get(key);
  if (active) return waitForMediaDownload(active, options.signal);

  const controller = new AbortController();
  const promise = downloadMediaFile(
    owner,
    mediaId,
    remoteUrl,
    options.authorizationPolicy,
    controller,
    byteLimit,
    generation,
  ).finally(() => {
    downloads.delete(key);
  });
  const download = { controller, promise, waiters: new Set<symbol>() };
  downloads.set(key, download);
  return waitForMediaDownload(download, options.signal);
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
  const generation = currentMediaCacheGeneration(owner);
  if (hasNativeMediaCache()) {
    const adopted = await adoptNativeLocalMediaFile({
      ownerId: owner,
      mediaId,
      remoteUrl: options.remoteUrl,
      sourceUri: options.sourceUri,
    }).catch(() => null);
    if (adopted && mediaCacheGenerationIsCurrent(owner, generation)) return adopted;
    if (!mediaCacheGenerationIsCurrent(owner, generation)) return null;
  }
  const directory = await accountDirectory(owner, true);
  if (!mediaCacheGenerationIsCurrent(owner, generation)) return null;
  const filename = `${await sha256(mediaId)}${safeExtension(options.sourceUri)}`;
  if (!mediaCacheGenerationIsCurrent(owner, generation)) return null;
  const destination = new File(directory, filename);
  if (destination.exists) destination.delete();
  try {
    await source.copy(destination);
    if (
      !mediaCacheGenerationIsCurrent(owner, generation) ||
      !mediaCacheFileLooksPlayable(destination, options.sourceUri)
    ) {
      throw new Error("Local media file failed container validation");
    }
    const now = Date.now();
    const entries = await loadIndex(owner);
    if (!mediaCacheGenerationIsCurrent(owner, generation)) {
      if (destination.exists) destination.delete();
      return null;
    }
    entries.set(mediaId, {
      id: mediaId,
      remote_url: options.remoteUrl,
      relative_path: filename,
      byte_count: destination.size ?? 0,
      created_at: now,
      last_accessed_at: now,
    });
    await pruneMediaCache(owner, entries, now);
    if (!mediaCacheGenerationIsCurrent(owner, generation)) {
      entries.delete(mediaId);
      if (destination.exists) destination.delete();
      return null;
    }
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
  ownerGenerations.set(owner, (ownerGenerations.get(owner) ?? 0) + 1);
  if (hasNativeMediaCache()) {
    await clearNativeMediaCacheAccount(owner).catch(() => undefined);
  }
  for (const [key, timer] of scheduled) {
    if (!key.startsWith(`${owner}\u0000`)) continue;
    clearTimeout(timer);
    scheduled.delete(key);
  }
  const activeDownloads = [...downloads.entries()].filter(([key]) =>
    key.startsWith(`${owner}\u0000`),
  );
  activeDownloads.forEach(([, download]) => download.controller.abort("account-cache-cleared"));
  await Promise.allSettled(activeDownloads.map(([, download]) => download.promise));
  const directory = await accountDirectory(owner, false);
  if (directory.exists) directory.delete();
  indexes.delete(owner);
  loading.delete(owner);
  emitUsage(owner, 0);
  await AsyncStorage.removeItem(mediaCacheIndexKey(owner));
}

export async function clearAllMediaCache(): Promise<void> {
  globalGeneration += 1;
  const owners = new Set([...indexes.keys(), ...usageListeners.keys()]);
  if (hasNativeMediaCache()) {
    await clearAllNativeMediaCache().catch(() => undefined);
  }
  for (const timer of scheduled.values()) clearTimeout(timer);
  scheduled.clear();
  const activeDownloads = [...downloads.values()];
  activeDownloads.forEach((download) => download.controller.abort("all-media-cache-cleared"));
  await Promise.allSettled(activeDownloads.map((download) => download.promise));
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
  controller?: AbortController,
  byteLimit = 0,
  generation?: MediaCacheGeneration,
): Promise<string | null> {
  const signal = controller?.signal;
  if (!generation || !mediaCacheGenerationIsCurrent(owner, generation)) return null;
  const directory = await accountDirectory(owner, true);
  const filename = `${await sha256(mediaId)}${safeExtension(remoteUrl)}`;
  if (!mediaCacheGenerationIsCurrent(owner, generation)) return null;
  const destination = new File(directory, filename);
  const partial = new File(directory, `${filename}.partial`);
  if (partial.exists) partial.delete();
  try {
    if (signal?.aborted) return null;
    const headers = await authorizationHeaders(remoteUrl, authorizationPolicy, signal);
    if (signal?.aborted || !mediaCacheGenerationIsCurrent(owner, generation)) return null;
    const downloaded = await File.downloadFileAsync(remoteUrl, partial, {
      ...(headers ? { headers } : {}),
      idempotent: true,
      ...(signal ? { signal } : {}),
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (
          bytesWritten > byteLimit ||
          totalBytes > byteLimit ||
          Paths.availableDiskSpace <= mediaCachePolicy.minimumFreeSpaceBytes
        ) {
          controller?.abort("media-download-exceeds-cache-size-limit");
        }
      },
    });
    if (
      !mediaCacheGenerationIsCurrent(owner, generation) ||
      downloaded.size <= 0 ||
      downloaded.size > byteLimit ||
      !mediaCacheFileLooksPlayable(downloaded, remoteUrl)
    ) {
      throw new Error("Downloaded media failed container validation");
    }
    if (destination.exists) destination.delete();
    await downloaded.move(destination);
    if (!mediaCacheGenerationIsCurrent(owner, generation)) {
      if (destination.exists) destination.delete();
      return null;
    }
    const now = Date.now();
    const entries = await loadIndex(owner);
    if (!mediaCacheGenerationIsCurrent(owner, generation)) {
      if (destination.exists) destination.delete();
      return null;
    }
    entries.set(mediaId, {
      id: mediaId,
      remote_url: remoteUrl,
      relative_path: filename,
      byte_count: destination.size ?? 0,
      created_at: now,
      last_accessed_at: now,
    });
    await pruneMediaCache(owner, entries, now);
    if (!mediaCacheGenerationIsCurrent(owner, generation)) {
      entries.delete(mediaId);
      if (destination.exists) destination.delete();
      return null;
    }
    await persistIndex(owner, entries);
    return destination.uri;
  } catch {
    if (partial.exists) partial.delete();
    return null;
  }
}

function currentMediaCacheGeneration(owner: string): MediaCacheGeneration {
  return { global: globalGeneration, owner: ownerGenerations.get(owner) ?? 0 };
}

function mediaCacheGenerationIsCurrent(owner: string, generation: MediaCacheGeneration): boolean {
  return (
    generation.global === globalGeneration &&
    generation.owner === (ownerGenerations.get(owner) ?? 0)
  );
}

async function waitForMediaDownload(
  download: ActiveMediaDownload,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) return null;
  const waiter = Symbol("media-download-waiter");
  download.waiters.add(waiter);
  return new Promise((resolve) => {
    const finish = (value: string | null) => {
      signal?.removeEventListener("abort", abort);
      download.waiters.delete(waiter);
      resolve(value);
    };
    const abort = () => {
      finish(null);
      if (download.waiters.size === 0) download.controller.abort(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    void download.promise.then(finish, () => finish(null));
  });
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
  return explicitExtension(uri) ?? ".mp4";
}

function explicitExtension(uri: string): string | null {
  try {
    const pathname = new URL(uri).pathname;
    const match = pathname.match(/\.([a-z0-9]{1,8})$/i);
    return match ? `.${match[1]!.toLowerCase()}` : null;
  } catch {
    const match = uri.match(/\.([a-z0-9]{1,8})(?:\?.*)?$/i);
    return match ? `.${match[1]!.toLowerCase()}` : null;
  }
}

export function mediaFileHeaderLooksPlayable(
  remoteUrl: string,
  header: Uint8Array,
  byteCount: number,
): boolean {
  if (!Number.isFinite(byteCount) || byteCount < 12 || header.length < 4) return false;
  if (looksLikeTextErrorBody(header)) return false;

  const isIsoBaseMedia = containsBytes(header, [0x66, 0x74, 0x79, 0x70], 4, 32);
  const isEbml = startsWithBytes(header, [0x1a, 0x45, 0xdf, 0xa3]);
  const isAvi =
    startsWithBytes(header, [0x52, 0x49, 0x46, 0x46]) &&
    containsBytes(header, [0x41, 0x56, 0x49, 0x20], 8, 12);
  const isFlv = startsWithBytes(header, [0x46, 0x4c, 0x56]);
  const isOgg = startsWithBytes(header, [0x4f, 0x67, 0x67, 0x53]);
  const isMpeg = startsWithBytes(header, [0x00, 0x00, 0x01]);
  const isTransportStream = byteCount >= 188 && header[0] === 0x47;
  const hasKnownVideoContainer =
    isIsoBaseMedia || isEbml || isAvi || isFlv || isOgg || isMpeg || isTransportStream;

  switch (explicitExtension(remoteUrl)) {
    case ".mp4":
    case ".m4v":
    case ".mov":
    case ".3gp":
    case ".3g2":
      return isIsoBaseMedia;
    case ".webm":
    case ".mkv":
      return isEbml;
    case ".avi":
      return isAvi;
    case ".flv":
      return isFlv;
    case ".ogv":
    case ".ogg":
      return isOgg;
    case ".mpg":
    case ".mpeg":
      return isMpeg;
    case ".ts":
      return isTransportStream;
    default:
      return hasKnownVideoContainer || !looksLikeMostlyText(header);
  }
}

function mediaCacheFileLooksPlayable(file: File, remoteUrl: string): boolean {
  if (!file.exists || file.size < 12) return false;
  let handle: ReturnType<File["open"]> | null = null;
  try {
    handle = file.open();
    return mediaFileHeaderLooksPlayable(remoteUrl, handle.readBytes(64), file.size);
  } catch {
    return false;
  } finally {
    handle?.close();
  }
}

function startsWithBytes(value: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((byte, index) => value[index] === byte);
}

function containsBytes(
  value: Uint8Array,
  expected: readonly number[],
  start: number,
  end: number,
): boolean {
  const lastStart = Math.min(value.length - expected.length, end - expected.length);
  for (let offset = Math.max(start, 0); offset <= lastStart; offset += 1) {
    if (expected.every((byte, index) => value[offset + index] === byte)) return true;
  }
  return false;
}

function looksLikeTextErrorBody(header: Uint8Array): boolean {
  const significant = [...header].find((byte) => ![0x09, 0x0a, 0x0d, 0x20].includes(byte));
  if (significant === undefined) return true;
  return significant === 0x3c || significant === 0x7b || significant === 0x5b;
}

function looksLikeMostlyText(header: Uint8Array): boolean {
  if (header.length === 0) return true;
  const printable = [...header].filter(
    (byte) => byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e),
  ).length;
  return printable / header.length > 0.9;
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
  signal?: AbortSignal,
): Promise<Record<string, string> | undefined> {
  return prepareVideoAuthorizationHeaders(remoteUrl, undefined, authorizationPolicy, signal);
}

function flightKey(owner: string, mediaId: string): string {
  return `${owner}\u0000${mediaId}`;
}

function sha256(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}
