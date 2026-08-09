import type { VideoSource } from "expo-video";

import { authenticatedResourceRequest } from "@/api/client";
import { env } from "@/config/env";
import { readAccessToken } from "@/storage/tokenStorage";

export const videoRangeProbeHeader = "bytes=0-0";
export type VideoAuthorizationPolicy = "auto" | "required" | "none";

function isPublicVideoPlaybackPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/v1/public/") ||
    pathname.startsWith("/api/v1/moments/image/")
  );
}

export function videoPlaybackRequiresAuthorization(uri: string, apiBaseUrl: string): boolean {
  try {
    const source = new URL(uri);
    const api = new URL(apiBaseUrl);
    if (source.origin !== api.origin) return false;
    return !isPublicVideoPlaybackPath(source.pathname);
  } catch {
    return false;
  }
}

/**
 * Refreshes same-origin credentials with a one-byte Range request before the
 * native player starts its own metadata/scrubbing Range sequence. Public
 * images, public Moments media, cross-origin and local sources intentionally
 * receive no Authorization header. AVPlayer does not reliably preserve custom
 * headers across every Range request made for public Moments QuickTime files.
 */
export async function prepareVideoAuthorizationHeaders(
  uri: string,
  apiBaseUrl = env.apiBaseUrl,
  authorizationPolicy: VideoAuthorizationPolicy = "auto",
  signal?: AbortSignal,
): Promise<Record<string, string> | undefined> {
  if (
    authorizationPolicy === "none" ||
    (authorizationPolicy === "auto" && !videoPlaybackRequiresAuthorization(uri, apiBaseUrl))
  )
    return undefined;
  const response = await authenticatedResourceRequest(uri, {
    headers: { Range: videoRangeProbeHeader },
    timeoutMs: 30_000,
    transientRetries: false,
    ...(signal ? { signal } : {}),
  });
  await response.body?.cancel().catch(() => undefined);
  const token = await readAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export async function prepareVideoPlaybackSource(
  uri: string,
  apiBaseUrl = env.apiBaseUrl,
  signal?: AbortSignal,
): Promise<VideoSource> {
  const headers = await prepareVideoAuthorizationHeaders(uri, apiBaseUrl, "auto", signal);
  const isHls = uri.toLowerCase().includes(".m3u8");
  const usesStreamingCache = isRemoteVideoUri(uri) && !isHls;
  return {
    uri,
    ...(headers ? { headers } : {}),
    ...(usesStreamingCache ? { useCaching: true } : {}),
    ...(isHls ? { contentType: "hls" as const } : {}),
  };
}

function isRemoteVideoUri(uri: string): boolean {
  try {
    const protocol = new URL(uri).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
