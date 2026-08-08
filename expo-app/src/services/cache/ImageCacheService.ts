import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import { authenticatedResourceRequest } from "@/api/client";
import { env } from "@/config/env";
import { resolveMediaUrl } from "@/utils/mediaUrl";

const adoptedIndexKey = "bwchat.image-cache-adopted.v1";
const adoptedDirectory = new Directory(Paths.cache, "bwchat-images", "adopted");
const authenticatedDirectory = new Directory(Paths.cache, "bwchat-images", "authenticated");
let adoptedImages = new Map<string, string>();
let adoptedHydrated = false;
let adoptedHydration: Promise<void> | undefined;
let authenticatedImageUris = new Map<string, string>();
const authenticatedImageLoads = new Map<string, Promise<string | undefined>>();
let authenticatedCacheGeneration = 0;
const authenticatedIdentityGenerations = new Map<string, number>();

export const imageCachePolicy = {
  cachePolicy: "memory-disk" as const,
  nativeThumbnailMaximumPixels: 720,
  nativeOriginalMaximumPixels: 2_048,
  nativeMemoryObjectLimit: 200,
  nativeDecodedMemoryLimitBytes: 80 * 1_024 * 1_024,
  authenticatedDiskCache: true,
};

export async function prefetchImage(
  uri: string,
  headers?: Record<string, string>,
): Promise<boolean> {
  const normalized = uri.trim();
  if (!normalized) return false;
  const { Image } = await import("expo-image");
  return Image.prefetch(normalized, {
    cachePolicy: imageCachePolicy.cachePolicy,
    ...(headers ? { headers } : {}),
  });
}

export function peekAdoptedImageUri(cacheKey: string): string | undefined {
  const filename = adoptedImages.get(cacheKey.trim());
  if (!filename) return undefined;
  const file = new File(adoptedDirectory, filename);
  return file.exists ? file.uri : undefined;
}

export async function getAdoptedImageUri(cacheKey: string): Promise<string | undefined> {
  await hydrateAdoptedImages();
  const normalized = cacheKey.trim();
  const filename = adoptedImages.get(normalized);
  if (!filename) return undefined;
  const file = new File(adoptedDirectory, filename);
  if (file.exists) return file.uri;
  adoptedImages.delete(normalized);
  await persistAdoptedImages();
  return undefined;
}

export function peekAuthenticatedImageUri(cacheKey: string): string | undefined {
  const normalized = normalizedRemoteImageUrl(cacheKey);
  if (!normalized) return undefined;
  const localUri = authenticatedImageUris.get(normalized);
  if (!localUri) return undefined;
  const file = new File(localUri);
  if (file.exists) return file.uri;
  authenticatedImageUris.delete(normalized);
  return undefined;
}

/**
 * Resolves a same-server image to an explicitly persisted local file. The
 * transport refreshes an expired access token once and concurrent callers for
 * the same URL share one download, matching native ImageCacheManager behavior.
 */
export async function getAuthenticatedImageUri(
  resourceUri: string,
  cacheKey = resourceUri,
): Promise<string | undefined> {
  const remoteUrl = normalizedRemoteImageUrl(resourceUri);
  const normalized = normalizedRemoteImageUrl(cacheKey);
  if (!remoteUrl || !normalized || !isSameServer(remoteUrl, env.apiBaseUrl)) return undefined;

  const memoryHit = peekAuthenticatedImageUri(normalized);
  if (memoryHit) return memoryHit;

  const filename = `${await sha256(normalized)}${safeExtension(normalized)}`;
  const destination = new File(authenticatedDirectory, filename);
  if (destination.exists) {
    authenticatedImageUris.set(normalized, destination.uri);
    return destination.uri;
  }

  const active = authenticatedImageLoads.get(normalized);
  if (active) return active;
  const generation = authenticatedCacheGeneration;
  const identityGeneration = authenticatedIdentityGenerations.get(normalized) ?? 0;
  const task = downloadAuthenticatedImage(
    remoteUrl,
    normalized,
    filename,
    generation,
    identityGeneration,
  );
  authenticatedImageLoads.set(normalized, task);
  try {
    return await task;
  } finally {
    if (authenticatedImageLoads.get(normalized) === task) {
      authenticatedImageLoads.delete(normalized);
    }
  }
}

export async function removeAuthenticatedImageCacheEntries(
  cacheKeys: readonly string[],
): Promise<void> {
  const uniqueKeys = [
    ...new Set(
      cacheKeys
        .map((key) => normalizedRemoteImageUrl(key))
        .filter((key): key is string => Boolean(key)),
    ),
  ];
  for (const cacheKey of uniqueKeys) {
    authenticatedIdentityGenerations.set(
      cacheKey,
      (authenticatedIdentityGenerations.get(cacheKey) ?? 0) + 1,
    );
    authenticatedImageUris.delete(cacheKey);
    const filename = `${await sha256(cacheKey)}${safeExtension(cacheKey)}`;
    const file = new File(authenticatedDirectory, filename);
    if (file.exists) file.delete();
  }
}

export async function adoptLocalImageFile(
  sourceUri: string,
  cacheKeys: readonly string[],
): Promise<void> {
  const source = new File(sourceUri);
  if (!source.exists) return;
  await hydrateAdoptedImages();
  if (!adoptedDirectory.exists) adoptedDirectory.create({ intermediates: true, idempotent: true });
  const uniqueKeys = [...new Set(cacheKeys.map((key) => key.trim()).filter(Boolean))];
  const extension = safeExtension(sourceUri);
  for (const cacheKey of uniqueKeys) {
    const filename = `${await sha256(cacheKey)}${extension}`;
    const destination = new File(adoptedDirectory, filename);
    if (destination.exists) destination.delete();
    await source.copy(destination);
    adoptedImages.set(cacheKey, filename);
  }
  if (uniqueKeys.length > 0) await persistAdoptedImages();
}

export async function removeAdoptedImageCacheEntries(cacheKeys: readonly string[]): Promise<void> {
  await hydrateAdoptedImages();
  const uniqueKeys = [...new Set(cacheKeys.map((key) => key.trim()).filter(Boolean))];
  let changed = false;
  for (const cacheKey of uniqueKeys) {
    const filename = adoptedImages.get(cacheKey);
    if (!filename) continue;
    adoptedImages.delete(cacheKey);
    const file = new File(adoptedDirectory, filename);
    if (file.exists) file.delete();
    changed = true;
  }
  if (changed) await persistAdoptedImages();
}

export async function clearImageCache(): Promise<void> {
  const { Image } = await import("expo-image");
  authenticatedCacheGeneration += 1;
  if (adoptedDirectory.exists) adoptedDirectory.delete();
  if (authenticatedDirectory.exists) authenticatedDirectory.delete();
  adoptedImages.clear();
  authenticatedImageUris.clear();
  authenticatedIdentityGenerations.clear();
  adoptedHydrated = true;
  adoptedHydration = undefined;
  await Promise.all([
    Image.clearMemoryCache(),
    Image.clearDiskCache(),
    AsyncStorage.removeItem(adoptedIndexKey),
  ]);
}

export function resetAdoptedImageCacheForTests(): void {
  adoptedImages = new Map();
  adoptedHydrated = false;
  adoptedHydration = undefined;
  authenticatedCacheGeneration += 1;
  authenticatedImageUris = new Map();
  authenticatedImageLoads.clear();
  authenticatedIdentityGenerations.clear();
}

async function downloadAuthenticatedImage(
  remoteUrl: string,
  cacheIdentity: string,
  filename: string,
  generation: number,
  identityGeneration: number,
): Promise<string | undefined> {
  let partial: File | undefined;
  try {
    const response = await authenticatedResourceRequest(remoteUrl);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.byteLength === 0 ||
      !isAuthenticatedGenerationCurrent(cacheIdentity, generation, identityGeneration)
    )
      return undefined;
    if (!authenticatedDirectory.exists) {
      authenticatedDirectory.create({ intermediates: true, idempotent: true });
    }
    const destination = new File(authenticatedDirectory, filename);
    if (destination.exists) {
      authenticatedImageUris.set(cacheIdentity, destination.uri);
      return destination.uri;
    }
    partial = new File(authenticatedDirectory, `${filename}.partial`);
    if (partial.exists) partial.delete();
    partial.write(bytes);
    if (!isAuthenticatedGenerationCurrent(cacheIdentity, generation, identityGeneration)) {
      if (partial.exists) partial.delete();
      return undefined;
    }
    await partial.move(destination);
    if (!isAuthenticatedGenerationCurrent(cacheIdentity, generation, identityGeneration)) {
      if (destination.exists) destination.delete();
      return undefined;
    }
    authenticatedImageUris.set(cacheIdentity, destination.uri);
    return destination.uri;
  } catch {
    if (partial?.exists) partial.delete();
    return undefined;
  }
}

function isAuthenticatedGenerationCurrent(
  cacheIdentity: string,
  generation: number,
  identityGeneration: number,
): boolean {
  return (
    generation === authenticatedCacheGeneration &&
    identityGeneration === (authenticatedIdentityGenerations.get(cacheIdentity) ?? 0)
  );
}

async function hydrateAdoptedImages(): Promise<void> {
  if (adoptedHydrated) return;
  adoptedHydration ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(adoptedIndexKey);
      const decoded: unknown = raw ? JSON.parse(raw) : {};
      adoptedImages = new Map(
        decoded && typeof decoded === "object" && !Array.isArray(decoded)
          ? Object.entries(decoded).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            )
          : [],
      );
    } catch {
      adoptedImages = new Map();
    } finally {
      adoptedHydrated = true;
    }
  })();
  await adoptedHydration;
}

function persistAdoptedImages(): Promise<void> {
  return AsyncStorage.setItem(adoptedIndexKey, JSON.stringify(Object.fromEntries(adoptedImages)));
}

function safeExtension(uri: string): string {
  const pathname = (() => {
    try {
      return new URL(uri).pathname;
    } catch {
      return uri;
    }
  })();
  const match = pathname.match(/\.([a-z0-9]{1,8})$/i);
  return match ? `.${match[1]!.toLowerCase()}` : ".img";
}

function normalizedRemoteImageUrl(cacheKey: string): string | undefined {
  const normalized = cacheKey.trim();
  if (!normalized) return undefined;
  const resolved = resolveMediaUrl(normalized, env.apiBaseUrl);
  if (!resolved || /^(?:file|content|data|blob):/iu.test(resolved)) return undefined;
  return resolved;
}

function isSameServer(uri: string, apiBaseUrl: string): boolean {
  try {
    return new URL(uri).origin === new URL(apiBaseUrl).origin;
  } catch {
    return false;
  }
}

function sha256(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}
