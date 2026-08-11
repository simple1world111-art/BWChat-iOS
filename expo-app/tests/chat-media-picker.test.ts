import * as ImagePicker from "expo-image-picker";

import { pickChatMedia } from "@/services/native/NativeCapabilities";

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Current: "current" },
  VideoExportPreset: { Passthrough: 0 },
}));

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));

describe("chat media picker", () => {
  beforeEach(() => {
    jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockReset();
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockReset();
  });

  it("returns current asset representations without foreground image or video transcoding", async () => {
    jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValueOnce({
      granted: true,
    } as Awaited<ReturnType<typeof ImagePicker.requestMediaLibraryPermissionsAsync>>);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          assetId: "photo-1",
          type: "image",
          uri: "file:///picker/photo.heic",
          width: 1200,
          height: 800,
        },
      ],
    });

    await expect(pickChatMedia()).resolves.toEqual([
      expect.objectContaining({ assetId: "photo-1", uri: "file:///picker/photo.heic" }),
    ]);
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        quality: 1,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
        videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
      }),
    );
  });
});
