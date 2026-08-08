import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeMoment } from "@/api/normalizers";
import type { Moment } from "@/models";

const cachePrefix = "bwchat.moment-detail.v1";

export async function readCachedMomentDetail(
  ownerId: string,
  momentId: number,
): Promise<Moment | null> {
  const encoded = await AsyncStorage.getItem(cacheKey(ownerId, momentId));
  if (!encoded) return null;
  try {
    const decoded: unknown = JSON.parse(encoded);
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("moment" in decoded)
    ) {
      return null;
    }
    return normalizeMoment(decoded.moment);
  } catch {
    return null;
  }
}

export async function saveCachedMomentDetail(
  ownerId: string,
  moment: Moment,
): Promise<void> {
  await AsyncStorage.setItem(
    cacheKey(ownerId, moment.id),
    JSON.stringify({ moment, cached_at: new Date().toISOString() }),
  );
}

export async function removeCachedMomentDetail(
  ownerId: string,
  momentId: number,
): Promise<void> {
  await AsyncStorage.removeItem(cacheKey(ownerId, momentId));
}

function cacheKey(ownerId: string, momentId: number): string {
  return `${cachePrefix}:${encodeURIComponent(ownerId)}:${momentId}`;
}
