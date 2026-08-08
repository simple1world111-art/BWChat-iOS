import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeMomentsNotifications } from "@/api/normalizers";
import type { MomentsNotification } from "@/models";

const cachePrefix = "bwchat.moments-notifications.v1";

export async function readCachedMomentsNotifications(
  ownerId: string,
): Promise<MomentsNotification[] | null> {
  const encoded = await AsyncStorage.getItem(cacheKey(ownerId));
  if (!encoded) return null;
  try {
    const decoded: unknown = JSON.parse(encoded);
    return normalizeMomentsNotifications(decoded);
  } catch {
    return null;
  }
}

export async function saveCachedMomentsNotifications(
  ownerId: string,
  notifications: MomentsNotification[],
): Promise<void> {
  await AsyncStorage.setItem(
    cacheKey(ownerId),
    JSON.stringify({ notifications: notifications.slice(0, 500) }),
  );
}

function cacheKey(ownerId: string): string {
  return `${cachePrefix}:${encodeURIComponent(ownerId)}`;
}
