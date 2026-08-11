import { galleryOwnerCacheKey } from "@/components/media/imageGalleryMath";
import { env } from "@/config/env";
import type { GroupMessage, Message } from "@/models";
import {
  getAdoptedImageUri,
  getAuthenticatedImageUri,
  peekAdoptedImageUri,
  peekAuthenticatedImageUri,
  prefetchImage,
} from "@/services/cache/ImageCacheService";
import { chatImagePresentationUrlFor } from "@/services/media/ChatImageSourcePolicy";
import { resolveMediaUrl } from "@/utils/mediaUrl";

type ChatImageMessage = Pick<
  Message | GroupMessage,
  "id" | "msg_type" | "content" | "thumbnail_url"
>;

export const chatMediaPreviewPreloadPolicy = Object.freeze({
  retryDelaysMilliseconds: [0, 300, 700, 1_500, 3_000] as const,
});

const preloadFlights = new Map<string, Promise<boolean>>();

export async function preloadChatImagePreview(
  ownerId: string,
  message: ChatImageMessage,
  options: { retry?: boolean } = {},
): Promise<boolean> {
  if (message.msg_type.trim().toLocaleLowerCase() !== "image") return true;
  const presentationUrl = chatImagePresentationUrlFor(message);
  const resolvedUrl = resolveMediaUrl(presentationUrl, env.apiBaseUrl);
  if (!resolvedUrl) return false;
  if (/^(?:file|content|data|blob):/iu.test(resolvedUrl)) return true;
  const owner = ownerId.trim();
  if (!owner) return false;
  const cacheKey = galleryOwnerCacheKey(owner, resolvedUrl);
  const flightKey = `${owner}\u0000${resolvedUrl}`;
  const existing = preloadFlights.get(flightKey);
  if (existing) return existing;
  const delays =
    options.retry === false ? [0] : chatMediaPreviewPreloadPolicy.retryDelaysMilliseconds;
  let task: Promise<boolean>;
  task = (async () => {
    for (const delay of delays) {
      if (delay > 0) await waitFor(delay);
      if (peekAdoptedImageUri(cacheKey) || peekAuthenticatedImageUri(cacheKey)) return true;
      if (await getAdoptedImageUri(cacheKey)) return true;
      if (isSameServer(resolvedUrl, env.apiBaseUrl)) {
        if (await getAuthenticatedImageUri(resolvedUrl, cacheKey)) return true;
      } else if (await prefetchImage(resolvedUrl).catch(() => false)) {
        return true;
      }
    }
    return false;
  })().finally(() => {
    if (preloadFlights.get(flightKey) === task) preloadFlights.delete(flightKey);
  });
  preloadFlights.set(flightKey, task);
  return task;
}

export async function preloadPreferredChatImagePreview(
  ownerId: string,
  messages: readonly ChatImageMessage[],
  preferredMessageIds: readonly number[] = [],
): Promise<boolean> {
  const preferred = preferredMessageIds.flatMap((messageId) => {
    const message = messages.find((candidate) => candidate.id === messageId);
    return message ? [message] : [];
  })[0];
  if (preferredMessageIds.length > 0 && !preferred) return true;
  const target =
    preferred ??
    [...messages].filter((message) => message.id > 0).sort((left, right) => right.id - left.id)[0];
  return target ? preloadChatImagePreview(ownerId, target) : true;
}

export function resetChatMediaPreviewPreloaderForTests(): void {
  preloadFlights.clear();
}

function isSameServer(uri: string, apiBaseUrl: string): boolean {
  try {
    return new URL(uri).origin === new URL(apiBaseUrl).origin;
  } catch {
    return false;
  }
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
