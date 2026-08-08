import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeUser } from "@/api/normalizers";
import type { User } from "@/models";
import {
  clearLegacyCachedUser,
  readLegacyCachedUserJSON,
  readLegacyLastActiveAccountId,
} from "../../modules/bwchat-auth-compat/src";

const currentUserKey = "bwchat.auth.current-user.v1";

export async function readCachedUser(): Promise<User | null> {
  const encoded = await safeCurrentUserStorage("auth-user-read", () =>
    AsyncStorage.getItem(currentUserKey),
  );
  const current = decodeUser(encoded);
  if (current) return current;

  const legacy = decodeUser(await readLegacyCachedUserJSON());
  if (legacy) return migrateLegacyUser(legacy);

  const lastActiveAccountId = (await readLegacyLastActiveAccountId())?.trim();
  if (!lastActiveAccountId) return null;
  return migrateLegacyUser(
    normalizeUser({
      user_id: lastActiveAccountId,
      nickname: lastActiveAccountId,
    }),
  );
}

export async function saveCachedUser(user: User): Promise<void> {
  await safeCurrentUserStorage("auth-user-save", () =>
    AsyncStorage.setItem(currentUserKey, JSON.stringify(user)),
  );
  await clearLegacyCachedUser().catch(() => undefined);
}

export async function clearCachedUser(): Promise<void> {
  await safeCurrentUserStorage("auth-user-delete", () => AsyncStorage.removeItem(currentUserKey));
  await clearLegacyCachedUser().catch(() => undefined);
}

function decodeUser(encoded: string | null): User | null {
  if (!encoded) return null;
  try {
    const user = normalizeUser(JSON.parse(encoded) as unknown);
    return user.user_id.trim() ? user : null;
  } catch {
    return null;
  }
}

async function migrateLegacyUser(user: User): Promise<User> {
  await safeCurrentUserStorage("auth-user-migrate", () =>
    AsyncStorage.setItem(currentUserKey, JSON.stringify(user)),
  );
  await clearLegacyCachedUser().catch(() => undefined);
  return user;
}

async function safeCurrentUserStorage<T>(
  operation: string,
  action: () => Promise<T>,
): Promise<T | null> {
  try {
    return await action();
  } catch (error) {
    reportAuthStorageFailure(operation, error);
    return null;
  }
}

function reportAuthStorageFailure(operation: string, error: unknown): void {
  if (process.env.NODE_ENV === "test") return;
  const errorType = error instanceof Error ? error.name : "unknown";
  // User JSON and native identity data must never be included in diagnostics.
  console.warn(`[AuthIdentity] ${operation} failed type=${errorType}`);
}
