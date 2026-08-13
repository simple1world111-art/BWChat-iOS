import { resolveMediaUrl } from "@/utils/mediaUrl";

const protectedImagePrefix = "/api/v1/images/";
const publicImagePrefix = "/api/v1/public/images/";

export type ChatVideoPlaybackAttempt = {
  allowCache: boolean;
  candidateIndex: number;
  generation: number;
};

export function nextChatVideoPlaybackAttempt(
  current: ChatVideoPlaybackAttempt,
  sourceKind: "local" | "remote",
  resolvedCandidateIndex: number,
  candidateCount: number,
): ChatVideoPlaybackAttempt | null {
  if (sourceKind === "local") {
    return {
      allowCache: false,
      candidateIndex: Math.max(0, resolvedCandidateIndex),
      generation: current.generation + 1,
    };
  }
  const nextCandidateIndex = Math.max(0, resolvedCandidateIndex) + 1;
  if (nextCandidateIndex >= candidateCount) return null;
  return {
    allowCache: false,
    candidateIndex: nextCandidateIndex,
    generation: current.generation + 1,
  };
}

export function resolveChatVideoPlaybackCandidates(videoUrl: string, apiBaseUrl: string): string[] {
  const value = videoUrl.trim();
  if (!value) return [];
  if (value.startsWith("ph:")) return [value];

  let resolved: string | null;
  try {
    resolved = value.startsWith("/")
      ? new URL(value, new URL(apiBaseUrl).origin).toString()
      : resolveMediaUrl(value, apiBaseUrl);
  } catch {
    return [];
  }
  if (!resolved) return [];
  try {
    const parsed = new URL(resolved);
    if (!["http:", "https:", "file:", "content:", "ph:"].includes(parsed.protocol)) return [];

    const apiOrigin = new URL(apiBaseUrl).origin;
    if (parsed.origin !== apiOrigin) return [parsed.toString()];

    if (parsed.pathname.startsWith(protectedImagePrefix)) {
      const authenticated = parsed.toString();
      parsed.pathname = parsed.pathname.replace(protectedImagePrefix, publicImagePrefix);
      return [authenticated, parsed.toString()];
    }
    if (parsed.pathname.startsWith(publicImagePrefix)) {
      const publicUrl = parsed.toString();
      parsed.pathname = parsed.pathname.replace(publicImagePrefix, protectedImagePrefix);
      return [publicUrl, parsed.toString()];
    }
    return [parsed.toString()];
  } catch {
    // resolveMediaUrl already rejected malformed or unsupported remote URLs.
  }
  return [];
}

export function resolveChatVideoPlaybackUrl(videoUrl: string, apiBaseUrl: string): string | null {
  return resolveChatVideoPlaybackCandidates(videoUrl, apiBaseUrl)[0] ?? null;
}
