import { File, FileMode } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";

import { APIError, apiRequest } from "@/api/client";
import { isRecord } from "@/api/normalizers";
import { env } from "@/config/env";
import {
  adoptLocalImageFile,
  removeAdoptedImageCacheEntries,
  removeAuthenticatedImageCacheEntries,
} from "@/services/cache/ImageCacheService";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export type ChatBackgroundTargetType = "global" | "dm" | "group";

export interface ChatBackground {
  target_type: ChatBackgroundTargetType;
  target_id: string;
  image_url: string;
  updated_at?: string | undefined;
}

export interface ChatBackgroundUploadResult {
  background: ChatBackground | null;
  preparedUri: string;
}

export function backgroundKey(targetType: ChatBackgroundTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}

export function exactBackground(
  backgrounds: Record<string, ChatBackground>,
  targetType: ChatBackgroundTargetType,
  targetId: string,
): ChatBackground | null {
  return backgrounds[backgroundKey(targetType, targetId)] ?? null;
}

export function effectiveBackground(
  backgrounds: Record<string, ChatBackground>,
  targetType: ChatBackgroundTargetType,
  targetId: string,
): ChatBackground | null {
  return (
    exactBackground(backgrounds, targetType, targetId) ??
    (targetType === "global" ? null : exactBackground(backgrounds, "global", "global"))
  );
}

export async function getChatBackgrounds(): Promise<ChatBackground[]> {
  const value = await apiRequest<unknown>("/chat/backgrounds", {
    requiredData: true,
    requiredEnvelope: true,
  });
  if (!isRecord(value) || !Array.isArray(value.backgrounds)) throw decodingError(value);
  return normalizeBackgroundList(value.backgrounds);
}

export async function uploadChatBackground(
  targetType: ChatBackgroundTargetType,
  targetId: string,
  asset: ImagePickerAsset,
): Promise<ChatBackgroundUploadResult> {
  const prepared = await prepareBackgroundImage(asset);
  const form = new FormData();
  form.append("image", {
    uri: prepared.uri,
    name: `background_${Math.trunc(Date.now() / 1_000)}.jpg`,
    type: "image/jpeg",
  } as unknown as Blob);
  const value = await apiRequest<unknown>(
    `/chat/backgrounds/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`,
    {
      method: "POST",
      body: form,
      timeoutMs: 90_000,
      requiredEnvelope: true,
      transientRetries: false,
    },
  );
  if (value !== undefined && value !== null && !isRecord(value)) throw decodingError(value);
  const payload = isRecord(value) ? value : {};
  const direct = requireOptionalBackground(payload.background, value);
  if (
    payload.image_url !== undefined &&
    payload.image_url !== null &&
    typeof payload.image_url !== "string"
  ) {
    throw decodingError(value);
  }
  if (direct) {
    return { background: withLocalVersion(direct), preparedUri: prepared.uri };
  }
  if (typeof payload.image_url === "string") {
    return {
      background: {
        target_type: targetType,
        target_id: targetId,
        image_url: payload.image_url,
        updated_at: `local-${Math.trunc(Date.now() / 1_000)}`,
      },
      preparedUri: prepared.uri,
    };
  }
  return { background: null, preparedUri: prepared.uri };
}

export async function deleteChatBackground(
  targetType: ChatBackgroundTargetType,
  targetId: string,
): Promise<void> {
  await apiRequest<unknown>(
    `/chat/backgrounds/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`,
    { method: "DELETE", requiredEnvelope: true, transientRetries: false },
  );
}

export function normalizeBackgroundList(value: unknown): ChatBackground[] {
  if (!Array.isArray(value)) throw decodingError(value);
  return value.map((item) => requireNativeBackground(item, value));
}

export function backgroundImagePath(background: ChatBackground): string {
  const raw = background.image_url.trim();
  if (!raw || raw.startsWith("/") || /^https?:/i.test(raw)) return raw;
  return `/api/v1/${raw}`;
}

export function backgroundImageCacheKey(background: ChatBackground): string {
  const path = backgroundImagePath(background);
  const version = background.updated_at?.trim();
  if (!version) return path;
  return `${path}${path.includes("?") ? "&" : "?"}bg_updated_at=${encodeURIComponent(version)}`;
}

export function resolvedBackgroundImageUri(background: ChatBackground): string {
  return resolveMediaUrl(backgroundImagePath(background), env.apiBaseUrl) ?? "";
}

export async function cacheUploadedBackgroundImage(
  background: ChatBackground,
  sourceUri: string,
): Promise<void> {
  await adoptLocalImageFile(sourceUri, [backgroundImageCacheKey(background)]);
}

export async function removeCachedBackgroundImage(background: ChatBackground): Promise<void> {
  const cacheKey = backgroundImageCacheKey(background);
  await Promise.all([
    removeAdoptedImageCacheEntries([cacheKey]),
    removeAuthenticatedImageCacheEntries([cacheKey]),
  ]).catch(() => undefined);
  try {
    const { Image } = await import("expo-image");
    const cachePath = await Image.getCachePathAsync(cacheKey);
    if (!cachePath) return;
    const cached = new File(cachePath);
    if (cached.exists) cached.delete();
  } catch {
    // Native background-cache invalidation is best-effort, matching the Swift store.
  }
}

async function prepareBackgroundImage(
  asset: ImagePickerAsset,
): Promise<{ uri: string; size: number }> {
  const source = new File(asset.uri);
  const sourceSize = source.size ?? 0;
  const maxSide = Math.max(asset.width, asset.height);
  const isJpeg = isJpegFile(source);
  if (isJpeg && sourceSize > 0 && sourceSize <= 900_000 && maxSide <= 1_280) {
    return { uri: asset.uri, size: sourceSize };
  }

  let dimension = Math.min(Math.max(maxSide, 640), 1_280);
  let best: { uri: string; size: number } | null = null;
  for (;;) {
    for (const quality of [0.72, 0.65, 0.55, 0.45, 0.35]) {
      const actions =
        maxSide > dimension
          ? [
              {
                resize:
                  asset.width >= asset.height
                    ? { width: Math.trunc(dimension) }
                    : { height: Math.trunc(dimension) },
              },
            ]
          : [];
      const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: quality,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const size = new File(result.uri).size ?? Number.MAX_SAFE_INTEGER;
      best = !best || size < best.size ? { uri: result.uri, size } : best;
      if (size <= 900_000) return { uri: result.uri, size };
    }
    if (dimension <= 640) break;
    dimension = Math.max(640, dimension * 0.75);
  }
  if (best) return best;
  throw new Error("背景图片处理失败");
}

function isJpegFile(file: File): boolean {
  try {
    const handle = file.open(FileMode.ReadOnly);
    try {
      const header = handle.readBytes(3);
      return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    } finally {
      handle.close();
    }
  } catch {
    return false;
  }
}

function requireNativeBackground(value: unknown, payload: unknown): ChatBackground {
  if (!isRecord(value)) throw decodingError(payload);
  const targetType = value.target_type;
  if (
    (targetType !== "global" && targetType !== "dm" && targetType !== "group") ||
    typeof value.target_id !== "string" ||
    typeof value.image_url !== "string" ||
    (value.updated_at !== undefined &&
      value.updated_at !== null &&
      typeof value.updated_at !== "string")
  ) {
    throw decodingError(payload);
  }
  return {
    target_type: targetType,
    target_id: value.target_id,
    image_url: value.image_url,
    ...(typeof value.updated_at === "string" ? { updated_at: value.updated_at } : {}),
  };
}

function requireOptionalBackground(value: unknown, payload: unknown): ChatBackground | null {
  if (value === undefined || value === null) return null;
  return requireNativeBackground(value, payload);
}

function withLocalVersion(background: ChatBackground): ChatBackground {
  return background.updated_at
    ? background
    : { ...background, updated_at: `local-${Math.trunc(Date.now() / 1_000)}` };
}

function decodingError(payload: unknown): APIError {
  return new APIError("api.decodingError", 200, payload, "decoding_error");
}
