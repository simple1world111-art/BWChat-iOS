import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { createVideoPlayer, type VideoPlayer } from "expo-video";

import {
  chatVideoMimeType,
  chatVideoPreparationPolicy,
  chatVideoThumbnailFilename,
} from "@/services/messages/chatVideoPolicy";

export interface ChatVideoSourceAsset {
  uri: string;
  width: number;
  height: number;
  filename: string;
  mimeType?: string | undefined;
}

export interface PreparedChatVideo {
  uri: string;
  thumbnail_uri: string;
  filename: string;
  thumbnail_filename: string;
  mime_type: string;
  width: number;
  height: number;
}

export async function prepareChatVideo(asset: ChatVideoSourceAsset): Promise<PreparedChatVideo> {
  const player = createVideoPlayer({ uri: asset.uri });
  player.bufferOptions = {
    preferredForwardBufferDuration: 2,
    waitsToMinimizeStalling: true,
  };
  try {
    await waitForVideoReady(player, chatVideoPreparationPolicy.readyTimeoutMilliseconds);
    const thumbnails = await player.generateThumbnailsAsync(0, {
      maxWidth: chatVideoPreparationPolicy.thumbnailMaximumSize,
      maxHeight: chatVideoPreparationPolicy.thumbnailMaximumSize,
    });
    const thumbnail = thumbnails[0];
    if (!thumbnail) throw new Error("无法生成视频缩略图");
    const context = ImageManipulator.manipulate(thumbnail);
    try {
      const rendered = await context.renderAsync();
      try {
        const saved = await rendered.saveAsync({
          compress: chatVideoPreparationPolicy.thumbnailQuality,
          format: SaveFormat.JPEG,
        });
        return {
          uri: asset.uri,
          thumbnail_uri: saved.uri,
          filename: asset.filename,
          thumbnail_filename: chatVideoThumbnailFilename(asset.filename),
          mime_type: chatVideoMimeType(asset.filename, asset.mimeType),
          width: thumbnail.width > 0 ? thumbnail.width : asset.width,
          height: thumbnail.height > 0 ? thumbnail.height : asset.height,
        };
      } finally {
        rendered.release();
      }
    } finally {
      context.release();
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
