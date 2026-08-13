import type { VideoSourceObject } from "expo-video";

import { authenticatedResourceRequest } from "@/api/client";
import { env } from "@/config/env";
import { readAccessToken } from "@/storage/tokenStorage";

export const videoRangeProbeHeader = "bytes=0-0";
export type VideoAuthorizationPolicy = "auto" | "required" | "none";
export type PreparedVideoPlayback = {
  source: VideoSourceObject;
  uri: string;
};

function isPublicVideoPlaybackPath(pathname: string): boolean {
  return pathname.startsWith("/api/v1/public/");
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

function videoPlaybackIsSameOrigin(uri: string, apiBaseUrl: string): boolean {
  try {
    return new URL(uri).origin === new URL(apiBaseUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Refreshes same-origin protected credentials with a one-byte Range request.
 * Callers may also ask to probe unprotected remote media; that validation is
 * always performed without exposing the account token.
 */
export async function prepareVideoAuthorizationHeaders(
  uri: string,
  apiBaseUrl = env.apiBaseUrl,
  authorizationPolicy: VideoAuthorizationPolicy = "auto",
  signal?: AbortSignal,
  probeUnprotectedRemote = false,
): Promise<Record<string, string> | undefined> {
  if (!isRemoteVideoUri(uri)) return undefined;
  const requiresAuthorization =
    authorizationPolicy === "required"
      ? videoPlaybackIsSameOrigin(uri, apiBaseUrl)
      : authorizationPolicy === "auto" && videoPlaybackRequiresAuthorization(uri, apiBaseUrl);
  if (!requiresAuthorization && !probeUnprotectedRemote) return undefined;
  const response = await authenticatedResourceRequest(uri, {
    auth: requiresAuthorization,
    headers: { Range: videoRangeProbeHeader },
    timeoutMs: 30_000,
    transientRetries: false,
    ...(signal ? { signal } : {}),
  });
  try {
    validateVideoProbeResponse(response);
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }
  if (!requiresAuthorization) return undefined;
  const token = await readAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export async function prepareVideoPlaybackSource(
  uri: string,
  apiBaseUrl = env.apiBaseUrl,
  signal?: AbortSignal,
): Promise<VideoSourceObject> {
  const headers = await prepareVideoAuthorizationHeaders(uri, apiBaseUrl, "auto", signal, true);
  const isHls = uri.toLowerCase().includes(".m3u8");
  return {
    uri,
    ...(headers ? { headers } : {}),
    ...(isHls ? { contentType: "hls" as const } : {}),
  };
}

export async function prepareFirstPlayableVideoSource(
  candidates: readonly string[],
  apiBaseUrl = env.apiBaseUrl,
  signal?: AbortSignal,
): Promise<PreparedVideoPlayback> {
  let lastError: unknown;
  for (const uri of [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))]) {
    if (signal?.aborted) throw abortError();
    try {
      return {
        source: await prepareVideoPlaybackSource(uri, apiBaseUrl, signal),
        uri,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error("没有可用的视频地址");
}

function isRemoteVideoUri(uri: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(uri).protocol);
  } catch {
    return false;
  }
}

function validateVideoProbeResponse(response: Response): void {
  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`视频探测返回异常状态 ${response.status}`);
  }
  const contentType = response.headers?.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (
    !contentType ||
    (!contentType.startsWith("video/") &&
      ![
        "application/mp4",
        "application/x-mp4",
        "application/octet-stream",
        "binary/octet-stream",
        "application/vnd.apple.mpegurl",
        "application/x-mpegurl",
      ].includes(contentType))
  ) {
    throw new Error(`视频探测返回非媒体内容 ${contentType || "missing"}`);
  }

  const contentLength = numericHeader(response, "content-length");
  if (response.status === 200) {
    if (contentLength === 0) throw new Error("视频探测返回空响应");
    return;
  }

  const contentRange = response.headers?.get("content-range")?.trim();
  const match = contentRange?.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/iu);
  if (!match) throw new Error("视频探测缺少有效 Content-Range");
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === "*" ? null : Number(match[3]);
  if (start !== 0 || end !== 0 || (total !== null && total <= end)) {
    throw new Error(`视频探测返回异常 Content-Range ${contentRange}`);
  }
  if (contentLength !== null && contentLength !== 1) {
    throw new Error(`视频探测返回异常 Content-Length ${contentLength}`);
  }
}

function numericHeader(response: Response, name: string): number | null {
  const raw = response.headers?.get(name)?.trim();
  if (!raw || !/^\d+$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function abortError(): Error {
  const error = new Error("视频加载已取消");
  error.name = "AbortError";
  return error;
}
