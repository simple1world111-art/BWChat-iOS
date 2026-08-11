import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";

export async function pickChatMedia(): Promise<ImagePicker.ImagePickerAsset[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("需要相册权限才能选择图片或视频");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    orderedSelection: true,
    selectionLimit: 9,
    // Avoid foreground transcoding in the picker. The durable chat outbox
    // prepares images and thumbnails after the local bubble is already shown.
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    quality: 1,
  });
  return result.canceled ? [] : result.assets;
}

export async function getCurrentLocation(): Promise<Location.LocationObject> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error("需要定位权限才能使用地图功能");
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
}

export async function requestPushPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}
