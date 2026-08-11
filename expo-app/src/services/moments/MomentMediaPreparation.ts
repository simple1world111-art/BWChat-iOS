import { Directory, File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type * as ImagePicker from "expo-image-picker";
import { createVideoPlayer, type VideoPlayer } from "expo-video";

import { createIdempotencyKey } from "@/api/bwchat";
import type { MomentUploadAsset } from "@/models";
import { momentDraftDirectory } from "@/services/moments/MomentOutboxStore";

export { momentDraftDirectory, removeMomentDraft } from "@/services/moments/MomentOutboxStore";

export interface PreparedMomentMedia extends MomentUploadAsset {
  id: string;
  preview_uri: string;
}

export const momentMediaPreparationPolicy = {
  maximumImageCount: 9,
  maximumVideoCount: 1,
  uploadMaximumDimension: 1_200,
  uploadJPEGQuality: 0.7,
  // A soft network optimization target; never a publish limit.
  uploadTargetBytes: 2_000_000,
  imagePreviewMaximumDimension: 360,
  videoPreviewMaximumDimension: 320,
  previewJPEGQuality: 0.82,
  videoReadyTimeoutMilliseconds: 30_000,
} as const;

export async function prepareMomentImage(
  ownerId: string,
  draftId: string,
  asset: ImagePicker.ImagePickerAsset,
  offset: number,
): Promise<PreparedMomentMedia> {
  const directory = momentDraftDirectory(ownerId, draftId);
  ensureDirectory(directory);
  const filename = `moment_image_${Math.floor(Date.now() / 1_000)}_${offset}.jpg`;
  const upload = await prepareImageUpload(asset);
  const durableUpload = new File(directory, filename);
  try {
    await copyReplacing(upload.uri, durableUpload);
  } finally {
    if (upload.disposable) removeTemporaryFile(upload.uri);
  }

  let previewUri = durableUpload.uri;
  try {
    const preview = await renderJPEG(
      durableUpload.uri,
      asset.width,
      asset.height,
      momentMediaPreparationPolicy.imagePreviewMaximumDimension,
      momentMediaPreparationPolicy.previewJPEGQuality,
      true,
    );
    const durablePreview = new File(directory, `preview_${offset}.jpg`);
    try {
      await copyReplacing(preview.uri, durablePreview);
      previewUri = durablePreview.uri;
    } finally {
      if (preview.disposable) removeTemporaryFile(preview.uri);
    }
  } catch {
    // Native keeps the selected upload when only its durable preview fails.
  }
  return {
    id: createIdempotencyKey(),
    kind: "image",
    uri: durableUpload.uri,
    preview_uri: previewUri,
    filename,
    mime_type: "image/jpeg",
  };
}

export async function prepareMomentVideo(
  ownerId: string,
  draftId: string,
  asset: ImagePicker.ImagePickerAsset,
): Promise<PreparedMomentMedia> {
  const directory = momentDraftDirectory(ownerId, draftId);
  ensureDirectory(directory);
  const filename = momentVideoFilename(asset.fileName ?? asset.uri);
  const durableVideo = new File(directory, filename);
  await copyReplacing(asset.uri, durableVideo);
  let previewUri = durableVideo.uri;
  try {
    const generatedPreview = await createVideoPreview(durableVideo.uri);
    const durablePreview = new File(directory, "preview_video.jpg");
    try {
      await copyReplacing(generatedPreview, durablePreview);
      previewUri = durablePreview.uri;
    } finally {
      removeTemporaryFile(generatedPreview);
    }
  } catch {
    // Native accepts a video even when AVAsset cannot produce a first frame.
  }
  return {
    id: createIdempotencyKey(),
    kind: "video",
    uri: durableVideo.uri,
    preview_uri: previewUri,
    filename,
    mime_type: momentVideoMimeType(filename),
  };
}

export function momentVideoFilename(original: string | null | undefined): string {
  const withoutQuery = (original ?? "").split(/[?#]/u, 1)[0] ?? "";
  const basename = withoutQuery.split(/[\\/]/u).at(-1) ?? "";
  const dot = basename.lastIndexOf(".");
  const extension =
    dot > 0 && dot < basename.length - 1 ? basename.slice(dot + 1).toLowerCase() : "mp4";
  return `moment_video_${Math.floor(Date.now() / 1_000)}_0.${safeExtension(extension)}`;
}

export function momentVideoMimeType(filename: string): string {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (extension === "mov") return "video/quicktime";
  if (extension === "m4v") return "video/x-m4v";
  return "video/mp4";
}

export function shouldPrepareImage(asset: {
  fileSize?: number | null | undefined;
  width: number;
  height: number;
  mimeType?: string | null | undefined;
}): boolean {
  return (
    asset.width <= 0 ||
    asset.height <= 0 ||
    (asset.fileSize ?? Number.POSITIVE_INFINITY) > momentMediaPreparationPolicy.uploadTargetBytes ||
    Math.max(asset.width, asset.height) > momentMediaPreparationPolicy.uploadMaximumDimension ||
    asset.mimeType?.toLowerCase() !== "image/jpeg"
  );
}

async function renderJPEG(
  uri: string,
  width: number,
  height: number,
  maximumDimension: number,
  quality: number,
  forceRender: boolean,
): Promise<PreparedImageFile> {
  const hasKnownDimensions = width > 0 && height > 0;
  if (!forceRender && hasKnownDimensions && Math.max(width, height) <= maximumDimension) {
    return { uri, disposable: false };
  }
  const context = ImageManipulator.manipulate(uri);
  try {
    if (hasKnownDimensions && Math.max(width, height) > maximumDimension) {
      if (width >= height) context.resize({ width: maximumDimension });
      else context.resize({ height: maximumDimension });
    }
    const rendered = await context.renderAsync();
    try {
      const saved = await rendered.saveAsync({ compress: quality, format: SaveFormat.JPEG });
      if (!hasKnownDimensions && Math.max(rendered.width, rendered.height) > maximumDimension) {
        try {
          return await renderJPEG(
            saved.uri,
            rendered.width,
            rendered.height,
            maximumDimension,
            quality,
            true,
          );
        } finally {
          removeTemporaryFile(saved.uri);
        }
      }
      return { uri: saved.uri, disposable: true };
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
}

interface PreparedImageFile {
  uri: string;
  disposable: boolean;
}

async function prepareImageUpload(asset: ImagePicker.ImagePickerAsset): Promise<PreparedImageFile> {
  if (!shouldPrepareImage(asset)) return { uri: asset.uri, disposable: false };
  const qualities = [momentMediaPreparationPolicy.uploadJPEGQuality, 0.65, 0.55, 0.45, 0.35];
  let maximumDimension: number = momentMediaPreparationPolicy.uploadMaximumDimension;
  const minimumDimension = 360;
  let best: PreparedImageFile | undefined;
  try {
    while (true) {
      for (const quality of qualities) {
        const candidate = await renderJPEG(
          asset.uri,
          asset.width,
          asset.height,
          maximumDimension,
          quality,
          true,
        );
        if (best?.disposable && best.uri !== candidate.uri) removeTemporaryFile(best.uri);
        best = candidate;
        if (
          (new File(candidate.uri).size ?? Number.MAX_SAFE_INTEGER) <=
          momentMediaPreparationPolicy.uploadTargetBytes
        ) {
          return candidate;
        }
      }
      if (maximumDimension <= minimumDimension) break;
      maximumDimension = Math.max(minimumDimension, maximumDimension * 0.75);
    }
    // Preserve publishability for arbitrary source sizes. The best derivative
    // is uploaded even when high-detail content stays above the soft target.
    if (best) return best;
    throw new Error("图片处理失败");
  } catch (error) {
    if (best?.disposable) removeTemporaryFile(best.uri);
    throw error;
  }
}

async function createVideoPreview(videoUri: string): Promise<string> {
  const player = createVideoPlayer({ uri: videoUri });
  try {
    await waitForVideoReady(player, momentMediaPreparationPolicy.videoReadyTimeoutMilliseconds);
    const thumbnails = await player.generateThumbnailsAsync(0, {
      maxWidth: momentMediaPreparationPolicy.videoPreviewMaximumDimension,
      maxHeight: momentMediaPreparationPolicy.videoPreviewMaximumDimension,
    });
    const thumbnail = thumbnails[0];
    if (!thumbnail) throw new Error("无法生成视频封面");
    try {
      const context = ImageManipulator.manipulate(thumbnail);
      try {
        const rendered = await context.renderAsync();
        try {
          return (
            await rendered.saveAsync({
              compress: momentMediaPreparationPolicy.previewJPEGQuality,
              format: SaveFormat.JPEG,
            })
          ).uri;
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

function ensureDirectory(directory: Directory): void {
  directory.create({ intermediates: true, idempotent: true });
}

async function copyReplacing(sourceUri: string, destination: File): Promise<void> {
  if (sourceUri === destination.uri) return;
  await new File(sourceUri).copy(destination, { overwrite: true });
}

function removeTemporaryFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // ImageManipulator/video thumbnail outputs are cache files; cleanup is
    // best-effort and never touches the durable document outbox copy.
  }
}

function safeExtension(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "mp4";
}
