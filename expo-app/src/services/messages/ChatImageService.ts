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
  // These byte counts are optimization targets, never selection/upload limits.
  originalTargetBytes: 2_000_000,
  thumbnailTargetBytes: 140_000,
  originalAttempts: [
    { dimension: 1200, quality: 0.7 },
    { dimension: 1200, quality: 0.65 },
    { dimension: 1200, quality: 0.55 },
    { dimension: 900, quality: 0.45 },
    { dimension: 675, quality: 0.35 },
    { dimension: 640, quality: 0.35 },
    { dimension: 480, quality: 0.3 },
    { dimension: 360, quality: 0.3 },
  ] as const,
  thumbnailAttempts: [
    { dimension: 360, quality: 0.58 },
    { dimension: 360, quality: 0.5 },
    { dimension: 360, quality: 0.4 },
    { dimension: 270, quality: 0.4 },
    { dimension: 200, quality: 0.3 },
  ] as const,
};

export async function prepareChatImage(
  asset: ChatImageSourceAsset,
  index: number,
): Promise<PreparedChatImage> {
  const original = await boundedJpeg(
    asset.uri,
    asset.width,
    asset.height,
    chatImagePreparationPolicy.originalAttempts,
    chatImagePreparationPolicy.originalTargetBytes,
  );
  const thumbnail = await boundedJpeg(
    original.uri,
    original.width,
    original.height,
    chatImagePreparationPolicy.thumbnailAttempts,
    chatImagePreparationPolicy.thumbnailTargetBytes,
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
  targetBytes: number,
): Promise<{ uri: string; width: number; height: number }> {
  let best: { uri: string; width: number; height: number } | null = null;
  let resolvedWidth = sourceWidth;
  let resolvedHeight = sourceHeight;
  for (const attempt of attempts) {
    const longest = Math.max(resolvedWidth, resolvedHeight);
    const resize =
      longest > attempt.dimension
        ? resolvedWidth >= resolvedHeight
          ? [{ resize: { width: attempt.dimension } }]
          : [{ resize: { height: attempt.dimension } }]
        : [];
    const prepared = await ImageManipulator.manipulateAsync(sourceUri, resize, {
      compress: attempt.quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    best = prepared;
    // Some cloud-backed picker assets report 0x0 until their first decode.
    // Use the decoded dimensions for subsequent bounded attempts.
    if (resolvedWidth <= 0 || resolvedHeight <= 0) {
      resolvedWidth = prepared.width;
      resolvedHeight = prepared.height;
    }
    const size = new File(prepared.uri).size;
    if (size !== null && size <= targetBytes) return prepared;
  }
  if (!best) throw new Error("图片处理失败");
  // Large/high-detail images are still sent when the optimization target
  // cannot be reached. Source size never blocks the user from sending.
  return best;
}

function createLocalId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 10)}`;
}
