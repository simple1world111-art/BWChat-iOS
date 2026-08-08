import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { Asset, getPermissionsAsync, requestPermissionsAsync } from "expo-media-library";

import { env } from "@/config/env";
import { resolveMediaUrl } from "@/utils/mediaUrl";
import { downloadAuthenticatedMediaToFile } from "@/services/media/AuthenticatedMediaLoader";
import {
  saveImageWithDependencies,
  type SaveImageResult,
} from "@/services/media/MediaLibrarySaveCoordinator";

export type { SaveImageResult } from "@/services/media/MediaLibrarySaveCoordinator";
export type SaveVideoResult = "saved" | "permissionDenied" | "downloadFailed" | "saveFailed";

export async function saveImageToLibrary(mediaPath: string): Promise<SaveImageResult> {
  const resolved = resolveMediaUrl(mediaPath, env.apiBaseUrl) ?? mediaPath;
  return saveImageWithDependencies(resolved, {
    getAddPermission: async () => (await getPermissionsAsync(true, ["photo"])).granted,
    requestAddPermission: async () => (await requestPermissionsAsync(true, ["photo"])).granted,
    download: async (url) => {
      const extension = imageExtension(resolved);
      let temporaryFile = new File(
        Paths.cache,
        `bwchat-save-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`,
      );
      temporaryFile = await downloadAuthenticatedMediaToFile(url, temporaryFile);
      return {
        uri: temporaryFile.uri,
        cleanup: () => {
          if (temporaryFile.exists) temporaryFile.delete();
        },
      };
    },
    validateImage: async (localUri) => {
      await Image.loadAsync(localUri);
    },
    createAsset: async (localUri) => {
      await Asset.create(localUri);
    },
  });
}

export async function saveVideoToLibrary(mediaPath: string): Promise<SaveVideoResult> {
  const resolved = resolveMediaUrl(mediaPath, env.apiBaseUrl) ?? mediaPath;
  try {
    const granted =
      (await getPermissionsAsync(true, ["video"])).granted ||
      (await requestPermissionsAsync(true, ["video"])).granted;
    if (!granted) return "permissionDenied";
  } catch {
    return "saveFailed";
  }

  let temporaryFile: File | null = null;
  let localUri = resolved;
  try {
    if (!resolved.startsWith("file://") && !resolved.startsWith("content://")) {
      const destination = new File(
        Paths.cache,
        `bwchat-save-${Date.now()}-${Math.random().toString(16).slice(2)}.${videoExtension(resolved)}`,
      );
      temporaryFile = await downloadAuthenticatedMediaToFile(resolved, destination);
      localUri = temporaryFile.uri;
    }
  } catch {
    if (temporaryFile?.exists) temporaryFile.delete();
    return "downloadFailed";
  }

  try {
    await Asset.create(localUri);
    return "saved";
  } catch {
    return "saveFailed";
  } finally {
    if (temporaryFile?.exists) temporaryFile.delete();
  }
}

function imageExtension(uri: string): string {
  const pathname = (() => {
    try {
      return new URL(uri).pathname;
    } catch {
      return uri;
    }
  })();
  const extension = /\.([a-zA-Z0-9]{2,5})$/.exec(pathname)?.[1]?.toLowerCase();
  return extension && ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"].includes(extension)
    ? extension
    : "jpg";
}

function videoExtension(uri: string): string {
  const pathname = (() => {
    try {
      return new URL(uri).pathname;
    } catch {
      return uri;
    }
  })();
  const extension = /\.([a-zA-Z0-9]{2,5})$/.exec(pathname)?.[1]?.toLowerCase();
  return extension && ["mp4", "mov", "m4v", "webm"].includes(extension) ? extension : "mp4";
}
