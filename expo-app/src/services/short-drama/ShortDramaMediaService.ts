import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as ImageManipulatorModule from "expo-image-manipulator";
import {
  ImageManipulator as ImageManipulatorContext,
  SaveFormat,
} from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";
import { createVideoPlayer, type VideoPlayer } from "expo-video";

import {
  shortDramaEditorMetrics,
  shortDramaVideoMimeType,
} from "@/services/short-drama/shortDramaEditorPolicy";

export interface PreparedShortDramaEpisodeAsset {
  id: string;
  selection_index: number;
  local_video_uri: string;
  local_video_filename: string;
  local_video_mime_type: string;
  preview_uri: string;
}

export async function stageShortDramaCover(
  ownerId: string,
  draftId: string,
  asset: ImagePickerAsset,
): Promise<string> {
  const preparedUri = await prepareShortDramaCoverImage(asset);
  const filename = shortDramaCoverFilename();
  const destination = new File(shortDramaDraftDirectory(ownerId, draftId), filename);
  await new File(preparedUri).copy(destination, { overwrite: true });
  return destination.uri;
}

export async function prepareShortDramaEpisodeAsset(
  ownerId: string,
  draftId: string,
  asset: ImagePickerAsset,
  selectionIndex: number,
): Promise<PreparedShortDramaEpisodeAsset> {
  const extension = fileExtension(asset.fileName) || fileExtension(asset.uri) || "mp4";
  const videoFilename = `episode-${selectionIndex}-${randomUUID()}.${extension}`;
  const video = new File(shortDramaDraftDirectory(ownerId, draftId), videoFilename);
  await new File(asset.uri).copy(video, { overwrite: true });
  try {
    const previewUri = await createShortDramaPreview(video.uri, ownerId, draftId, selectionIndex);
    return {
      id: randomUUID(),
      selection_index: selectionIndex,
      local_video_uri: video.uri,
      local_video_filename: videoFilename,
      local_video_mime_type: shortDramaVideoMimeType(videoFilename, asset.mimeType),
      preview_uri: previewUri,
    };
  } catch (error) {
    if (video.exists) video.delete();
    throw error;
  }
}

export function shortDramaCoverFilename(now = Date.now()): string {
  return `short_drama_cover_${Math.floor(now / 1_000)}.jpg`;
}

export function shortDramaEpisodeCoverFilename(id = randomUUID()): string {
  return `short_drama_episode_cover_${id}.jpg`;
}

export function shortDramaEpisodeVideoFilename(uri: string, id = randomUUID()): string {
  return `short_drama_episode_${id}.${fileExtension(uri) || "mp4"}`;
}

export function shortDramaDraftDirectory(ownerId: string, draftId: string): Directory {
  const directory = new Directory(
    Paths.document,
    "bwchat-outbox",
    "short-drama",
    encodeURIComponent(ownerId || "anonymous"),
    draftId,
  );
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export function removeShortDramaLocalFile(uri: string | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Draft cleanup is best effort, matching the native editor.
  }
}

async function prepareShortDramaCoverImage(asset: ImagePickerAsset): Promise<string> {
  const source = new File(asset.uri);
  if (
    Math.max(asset.width, asset.height) <= shortDramaEditorMetrics.coverMaximumDimension
    && (source.size ?? Number.MAX_SAFE_INTEGER) <= shortDramaEditorMetrics.coverMaximumBytes
    && await isJpegFile(source)
  ) {
    return asset.uri;
  }
  const minimumDimension = Math.min(shortDramaEditorMetrics.coverMaximumDimension, 640);
  const qualities = [...new Set([
    shortDramaEditorMetrics.coverInitialQuality,
    0.65,
    0.55,
    0.45,
    0.35,
  ])];
  let dimension: number = shortDramaEditorMetrics.coverMaximumDimension;
  let bestUri: string | null = null;
  while (true) {
    const actions = Math.max(asset.width, asset.height) > dimension
      ? [{ resize: asset.width >= asset.height ? { width: dimension } : { height: dimension } }]
      : [];
    for (const quality of qualities) {
      const prepared = await ImageManipulatorModule.manipulateAsync(asset.uri, actions, {
        compress: quality,
        format: SaveFormat.JPEG,
      });
      bestUri = prepared.uri;
      if ((new File(prepared.uri).size ?? Number.MAX_SAFE_INTEGER)
        <= shortDramaEditorMetrics.coverMaximumBytes) {
        return prepared.uri;
      }
    }
    if (dimension <= minimumDimension) break;
    dimension = Math.max(minimumDimension, dimension * 0.75);
  }
  if (!bestUri) throw new Error("图片处理失败");
  return bestUri;
}

async function createShortDramaPreview(
  videoUri: string,
  ownerId: string,
  draftId: string,
  selectionIndex: number,
): Promise<string> {
  const player = createVideoPlayer({ uri: videoUri });
  try {
    await waitForVideoReady(player, 30_000);
    const thumbnails = await player.generateThumbnailsAsync(0, {
      maxWidth: shortDramaEditorMetrics.previewMaximumDimension,
      maxHeight: shortDramaEditorMetrics.previewMaximumDimension,
    });
    const thumbnail = thumbnails[0];
    if (!thumbnail) throw new Error("无法生成视频封面");
    try {
      const context = ImageManipulatorContext.manipulate(thumbnail);
      try {
        const rendered = await context.renderAsync();
        try {
          const prepared = await rendered.saveAsync({
            compress: shortDramaEditorMetrics.previewQuality,
            format: SaveFormat.JPEG,
          });
          const filename = `episode-cover-${selectionIndex}-${randomUUID()}.jpg`;
          const destination = new File(shortDramaDraftDirectory(ownerId, draftId), filename);
          await new File(prepared.uri).copy(destination, { overwrite: true });
          return destination.uri;
        } finally {
          rendered.release();
        }
      } finally {
        context.release();
      }
    } finally {
      thumbnail.release();
    }
  } finally {
    player.release();
  }
}

async function waitForVideoReady(player: VideoPlayer, timeoutMilliseconds: number): Promise<void> {
  if (player.status === "readyToPlay") return;
  if (player.status === "error") throw new Error("视频加载失败");
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      subscription.remove();
      reject(new Error("视频加载超时"));
    }, timeoutMilliseconds);
    const subscription = player.addListener("statusChange", ({ status, error }) => {
      if (status !== "readyToPlay" && status !== "error") return;
      clearTimeout(timeout);
      subscription.remove();
      if (status === "readyToPlay") resolve();
      else reject(new Error(error?.message || "视频加载失败"));
    });
  });
}

async function isJpegFile(file: File): Promise<boolean> {
  try {
    const bytes = await file.bytes();
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  } catch {
    return false;
  }
}

function fileExtension(value: string | null | undefined): string {
  const path = value?.split(/[?#]/u)[0] ?? "";
  const extension = path.split(".").at(-1)?.toLocaleLowerCase() ?? "";
  return /^[a-z0-9]{1,8}$/u.test(extension) ? extension : "";
}
