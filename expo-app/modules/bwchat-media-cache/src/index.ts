import { requireOptionalNativeModule } from "expo";

interface BWChatMediaCacheNativeModule {
  getCachedUriAsync(ownerId: string, mediaId: string): Promise<string | null>;
  startCacheAsync(
    ownerId: string,
    mediaId: string,
    remoteUrl: string,
    authorizationHeaders: Record<string, string> | null,
  ): Promise<boolean>;
  adoptLocalFileAsync(
    ownerId: string,
    mediaId: string,
    remoteUrl: string,
    sourceUri: string,
  ): Promise<string | null>;
  usageBytesAsync(ownerId: string): Promise<number>;
  clearAccountAsync(ownerId: string): Promise<void>;
  clearAllAsync(): Promise<void>;
}

const nativeModule = requireOptionalNativeModule<BWChatMediaCacheNativeModule>("BWChatMediaCache");

export function hasNativeMediaCache(): boolean {
  return nativeModule !== null;
}

export async function getNativeCachedMediaUri(
  ownerId: string,
  mediaId: string,
): Promise<string | null> {
  return nativeModule?.getCachedUriAsync(ownerId, mediaId) ?? null;
}

export async function startNativeMediaCache(options: {
  ownerId: string;
  mediaId: string;
  remoteUrl: string;
  authorizationHeaders?: Record<string, string> | undefined;
}): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.startCacheAsync(
    options.ownerId,
    options.mediaId,
    options.remoteUrl,
    options.authorizationHeaders ?? null,
  );
}

export async function adoptNativeLocalMediaFile(options: {
  ownerId: string;
  mediaId: string;
  remoteUrl: string;
  sourceUri: string;
}): Promise<string | null> {
  if (!nativeModule) return null;
  return nativeModule.adoptLocalFileAsync(
    options.ownerId,
    options.mediaId,
    options.remoteUrl,
    options.sourceUri,
  );
}

export async function nativeMediaCacheUsageBytes(ownerId: string): Promise<number> {
  return nativeModule?.usageBytesAsync(ownerId) ?? 0;
}

export async function clearNativeMediaCacheAccount(ownerId: string): Promise<void> {
  await nativeModule?.clearAccountAsync(ownerId);
}

export async function clearAllNativeMediaCache(): Promise<void> {
  await nativeModule?.clearAllAsync();
}
