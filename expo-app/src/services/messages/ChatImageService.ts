import { File } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";

export interface ChatImageSourceAsset {
  uri: string;
  width: number;
  height: number;
}

export interface PreparedChatImage {
  uri: string;
  thumbnail_uri: string;
  filename: string;
  thumbnail_filename: string;
}

export const chatImagePreparationPolicy = {
  originalMaxBytes: 2_000_000,
  thumbnailMaxBytes: 140_000,
  originalAttempts: [
  { dimension: 1200, quality: 0.7 },
  { dimension: 1200, quality: 0.65 },
  { dimension: 1200, quality: 0.55 },
  { dimension: 900, quality: 0.45 },
  { dimension: 675, quality: 0.35 },
  { dimension: 640, quality: 0.35 },
  ] as const,
  thumbnailAttempts: [
  { dimension: 360, quality: 0.58 },
  { dimension: 360, quality: 0.5 },
  { dimension: 360, quality: 0.4 },
  { dimension: 270, quality: 0.4 },
  ] as const,
};

export async function prepareChatImage(asset: ChatImageSourceAsset, index: number): Promise<PreparedChatImage> {
  const original = await boundedJpeg(
    asset.uri,
    asset.width,
    asset.height,
    chatImagePreparationPolicy.originalAttempts,
    chatImagePreparationPolicy.originalMaxBytes,
  );
  const thumbnail = await boundedJpeg(
    original.uri,
    original.width,
    original.height,
    chatImagePreparationPolicy.thumbnailAttempts,
    chatImagePreparationPolicy.thumbnailMaxBytes,
  );
  const base = `image_${createLocalId()}_${index}`;
  return {
    uri: original.uri,
    thumbnail_uri: thumbnail.uri,
    filename: `${base}.jpg`,
    thumbnail_filename: `${base}_thumb.jpg`,
  };
}

async function boundedJpeg(
  sourceUri: string,
  sourceWidth: number,
  sourceHeight: number,
  attempts: readonly { dimension: number; quality: number }[],
  maxBytes: number,
): Promise<{ uri: string; width: number; height: number }> {
  let best: { uri: string; width: number; height: number } | null = null;
  for (const attempt of attempts) {
    const longest = Math.max(sourceWidth, sourceHeight);
    const resize = longest > attempt.dimension
      ? sourceWidth >= sourceHeight
        ? [{ resize: { width: attempt.dimension } }]
        : [{ resize: { height: attempt.dimension } }]
      : [];
    const prepared = await ImageManipulator.manipulateAsync(sourceUri, resize, {
      compress: attempt.quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    best = prepared;
    if (new File(prepared.uri).size <= maxBytes) return prepared;
  }
  if (!best) throw new Error("图片处理失败");
  return best;
}

function createLocalId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 10)}`;
}
