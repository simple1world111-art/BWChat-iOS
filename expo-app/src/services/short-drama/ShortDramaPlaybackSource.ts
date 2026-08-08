import type { VideoSource } from "expo-video";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type { ShortDramaVideo } from "@/models";
import { getCachedMediaUri, isHlsMediaUrl } from "@/services/cache/MediaCacheService";
import { prepareVideoAuthorizationHeaders } from "@/services/media/VideoPlaybackSource";
import {
  shortDramaStreamingUrl,
  shouldAuthorizeShortDramaMedia,
} from "@/services/short-drama/shortDramaFeedPolicy";

export type ShortDramaMediaCandidateLabel = "primary" | "mp4_url" | "play_url" | "hls_url";

export interface ShortDramaMediaCandidate {
  label: ShortDramaMediaCandidateLabel;
  url: string;
}

export function shortDramaMediaCacheId(videoId: string): string {
  return `short-drama:${videoId}`;
}

/** Mirrors ShortDramaFeedViewModel.mediaCandidates(for:) including its order and URL de-duplication. */
export function shortDramaMediaCandidates(
  video: ShortDramaVideo,
  apiBaseUrl: string,
): ShortDramaMediaCandidate[] {
  const rawCandidates: readonly [ShortDramaMediaCandidateLabel, string | undefined][] = [
    ["primary", shortDramaStreamingUrl(video)],
    ["mp4_url", video.mp4_url],
    ["play_url", video.play_url],
    ["hls_url", video.hls_url],
  ];
  const seen = new Set<string>();
  const candidates: ShortDramaMediaCandidate[] = [];
  for (const [label, rawValue] of rawCandidates) {
    const url = resolveShortDramaMediaUrl(rawValue, apiBaseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    candidates.push({ label, url });
  }
  return candidates;
}

export function resolveShortDramaMediaUrl(
  rawValue: string | null | undefined,
  apiBaseUrl: string,
): string | null {
  const value = trimFoundationWhitespacesAndNewlines(rawValue ?? "");
  if (!value) return null;
  try {
    const absolute = new URL(value);
    if (absolute.protocol === "http:" || absolute.protocol === "https:") {
      return absolute.toString();
    }
  } catch {
    // Continue with the same server-relative rules as the native view model.
  }

  const normalizedBase = apiBaseUrl.replace(/\/$/u, "");
  try {
    if (value.startsWith("/api/v1/")) {
      const api = new URL(normalizedBase);
      return new URL(value, api.origin).toString();
    }
    return new URL(
      value.startsWith("/") ? `${normalizedBase}${value}` : `${normalizedBase}/${value}`,
    ).toString();
  } catch {
    return null;
  }
}

export async function prepareShortDramaPlaybackSource(options: {
  apiBaseUrl: string;
  candidate: ShortDramaMediaCandidate;
  ownerId: string;
  videoId: string;
  useLocalPrimary: boolean;
}): Promise<VideoSource> {
  const cachedUri = options.useLocalPrimary
    ? await getCachedMediaUri(options.ownerId, shortDramaMediaCacheId(options.videoId))
    : null;
  const uri = cachedUri ?? options.candidate.url;
  const isProtected =
    !cachedUri && shouldAuthorizeShortDramaMedia(options.candidate.url, options.apiBaseUrl);
  const headers = cachedUri
    ? undefined
    : await prepareVideoAuthorizationHeaders(
        options.candidate.url,
        options.apiBaseUrl,
        isProtected ? "required" : "none",
      );
  return {
    uri,
    useCaching: true,
    ...(headers ? { headers } : {}),
    ...(isHlsMediaUrl(uri) ? { contentType: "hls" as const } : {}),
  };
}

export function shouldLoopShortDramaPlayback(options: {
  currentTime: number;
  duration: number;
  isActive: boolean;
  isManuallyPaused: boolean;
  isPlaying: boolean;
  requireNearEnd: boolean;
}): boolean {
  if (!options.isActive || options.isManuallyPaused) return false;
  if (!options.requireNearEnd) return true;
  return (
    options.isPlaying &&
    Number.isFinite(options.duration) &&
    options.duration > 0.5 &&
    Number.isFinite(options.currentTime) &&
    options.currentTime >= Math.max(0, options.duration - 0.25)
  );
}
