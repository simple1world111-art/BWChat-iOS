import AsyncStorage from "@react-native-async-storage/async-storage";

import type { GroupMessage, ScriptRoom } from "@/models";
import { mergeCachedScriptMessages, scriptRoomMetrics } from "@/services/scripts/scriptRoomPolicy";

interface StoredRoom {
  room: ScriptRoom;
  updatedAt: number;
}

const messageWrites = new Map<string, Promise<GroupMessage[]>>();

export interface CachedScriptRoom {
  value: ScriptRoom;
  updatedAt: number;
  isStale: boolean;
}

export async function loadCachedScriptRoom(
  ownerId: string,
  roomId: string,
  now = Date.now(),
): Promise<CachedScriptRoom | null> {
  if (!ownerId.trim() || roomId.length === 0) return null;
  const raw = await AsyncStorage.getItem(roomKey(ownerId, roomId));
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredRoom;
    const age = now - stored.updatedAt;
    if (
      !stored.room?.room_id ||
      !Number.isFinite(stored.updatedAt) ||
      age < 0 ||
      age > scriptRoomMetrics.roomTtlMilliseconds + scriptRoomMetrics.roomStaleRetentionMilliseconds
    ) {
      await AsyncStorage.removeItem(roomKey(ownerId, roomId));
      return null;
    }
    return {
      value: stored.room,
      updatedAt: stored.updatedAt,
      isStale: age >= scriptRoomMetrics.roomTtlMilliseconds,
    };
  } catch {
    await AsyncStorage.removeItem(roomKey(ownerId, roomId));
    return null;
  }
}

export async function saveCachedScriptRoom(
  ownerId: string,
  room: ScriptRoom,
  now = Date.now(),
): Promise<void> {
  if (!ownerId.trim() || room.room_id.length === 0) return;
  await AsyncStorage.setItem(
    roomKey(ownerId, room.room_id),
    JSON.stringify({ room, updatedAt: now }),
  );
}

export async function loadCachedScriptMessages(
  ownerId: string,
  groupId: number,
): Promise<GroupMessage[]> {
  if (!ownerId.trim() || !Number.isSafeInteger(groupId)) return [];
  const raw = await AsyncStorage.getItem(messageKey(ownerId, groupId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? mergeCachedScriptMessages([], parsed as GroupMessage[], groupId)
      : [];
  } catch {
    await AsyncStorage.removeItem(messageKey(ownerId, groupId));
    return [];
  }
}

export async function saveCachedScriptMessages(
  ownerId: string,
  groupId: number,
  current: readonly GroupMessage[],
  incoming: readonly GroupMessage[] = [],
): Promise<GroupMessage[]> {
  if (!ownerId.trim() || !Number.isSafeInteger(groupId)) return [];
  const key = messageKey(ownerId, groupId);
  const previous = messageWrites.get(key) ?? Promise.resolve([] as GroupMessage[]);
  const operation = previous
    .catch(() => [])
    .then(async (persisted) => {
      const merged = mergeCachedScriptMessages(persisted, [...current, ...incoming], groupId);
      await AsyncStorage.setItem(key, JSON.stringify(merged));
      return merged;
    });
  messageWrites.set(key, operation);
  try {
    return await operation;
  } finally {
    if (messageWrites.get(key) === operation) messageWrites.delete(key);
  }
}

export function scriptRoomCacheKey(ownerId: string, roomId: string): string {
  return roomKey(ownerId, roomId);
}

function roomKey(ownerId: string, roomId: string): string {
  return `bwchat.script-room-v1:account:${encodeURIComponent(ownerId)}:room:${encodeURIComponent(roomId)}`;
}

function messageKey(ownerId: string, groupId: number): string {
  return `bwchat.script-room-messages-v1:account:${encodeURIComponent(ownerId)}:group:${groupId}`;
}
