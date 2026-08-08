import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Contact, FriendInfo, PublicProfile, SearchUser, User } from "@/models";

const storageKey = "bwchat.user-info-cache.v1";

export interface CachedUserInfo {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url: string;
  updated_at: string;
}

type UserInfoSource = Pick<CachedUserInfo, "user_id" | "nickname" | "avatar_url"> &
  Partial<Pick<CachedUserInfo, "username">>;

let users = new Map<string, CachedUserInfo>();
let hydrated = false;
let hydration: Promise<void> | undefined;
let writeQueue = Promise.resolve();

export async function hydrateUserInfoCache(): Promise<void> {
  if (hydrated) return;
  hydration ??= loadFromStorage();
  await hydration;
}

export async function getCachedUserInfo(userId: string): Promise<CachedUserInfo | undefined> {
  await hydrateUserInfoCache();
  return users.get(userId.trim());
}

export function peekCachedUserInfo(userId: string): CachedUserInfo | undefined {
  return users.get(userId.trim());
}

export async function cacheUserInfo(source: UserInfoSource): Promise<void> {
  await cacheUserInfoBatch([source]);
}

export async function cacheUserInfoBatch(sources: readonly UserInfoSource[]): Promise<void> {
  await hydrateUserInfoCache();
  const updatedAt = new Date().toISOString();
  let changed = false;
  for (const source of sources) {
    const userId = source.user_id.trim();
    if (!userId) continue;
    const previous = users.get(userId);
    users.set(userId, {
      user_id: userId,
      username: source.username?.trim() || previous?.username || "",
      nickname: source.nickname.trim(),
      avatar_url: source.avatar_url.trim(),
      updated_at: updatedAt,
    });
    changed = true;
  }
  if (changed) await persist();
}

export async function cacheUser(user: User): Promise<void> {
  await cacheUserInfo(user);
}

export async function cacheFriendList(friends: readonly FriendInfo[]): Promise<void> {
  await cacheUserInfoBatch(friends);
}

export async function cacheContactList(contacts: readonly Contact[]): Promise<void> {
  await cacheUserInfoBatch(contacts);
}

export async function cacheSearchUsers(usersToCache: readonly SearchUser[]): Promise<void> {
  await cacheUserInfoBatch(usersToCache);
}

export async function cachePublicProfile(profile: PublicProfile): Promise<void> {
  await cacheUserInfo(profile);
}

export async function cachedNickname(userId: string): Promise<string> {
  return (await getCachedUserInfo(userId))?.nickname || userId;
}

export async function cachedAvatarUrl(userId: string): Promise<string> {
  return (await getCachedUserInfo(userId))?.avatar_url || "";
}

export async function clearUserInfoCache(): Promise<void> {
  users.clear();
  hydrated = true;
  hydration = undefined;
  writeQueue = writeQueue.then(() => AsyncStorage.removeItem(storageKey));
  await writeQueue;
}

export function resetUserInfoCacheForTests(): void {
  users = new Map();
  hydrated = false;
  hydration = undefined;
  writeQueue = Promise.resolve();
}

async function loadFromStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    const decoded: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(decoded)) {
      const restored = new Map<string, CachedUserInfo>();
      for (const candidate of decoded) {
        const normalized = normalizeCachedUser(candidate);
        if (normalized) restored.set(normalized.user_id, normalized);
      }
      users = restored;
    }
  } catch {
    users = new Map();
  } finally {
    hydrated = true;
  }
}

function normalizeCachedUser(value: unknown): CachedUserInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<Record<keyof CachedUserInfo, unknown>>;
  const userId = typeof candidate.user_id === "string" ? candidate.user_id.trim() : "";
  if (!userId) return undefined;
  return {
    user_id: userId,
    username: typeof candidate.username === "string" ? candidate.username : "",
    nickname: typeof candidate.nickname === "string" ? candidate.nickname : "",
    avatar_url: typeof candidate.avatar_url === "string" ? candidate.avatar_url : "",
    updated_at: typeof candidate.updated_at === "string" ? candidate.updated_at : "",
  };
}

async function persist(): Promise<void> {
  const snapshot = JSON.stringify([...users.values()]);
  writeQueue = writeQueue.then(() => AsyncStorage.setItem(storageKey, snapshot));
  await writeQueue;
}
