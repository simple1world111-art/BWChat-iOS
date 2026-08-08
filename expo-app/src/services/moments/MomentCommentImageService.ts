import * as ImageManipulator from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";

export async function prepareMomentCommentImage(
  asset: ImagePickerAsset,
): Promise<{ uri: string; filename: string }> {
  const prepared = await ImageManipulator.manipulateAsync(asset.uri, [], {
    compress: 0.7,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: prepared.uri, filename: "comment.jpg" };
}
