import * as SecureStore from "expo-secure-store";

import { normalizeToken } from "@/api/normalizers";

const nativeAccessTokenKey = "jwt_token";
const nativeRefreshTokenKey = "jwt_refresh_token";
const legacyExpoAccessTokenKey = "bwchat.auth.access-token.v1";
const legacyExpoRefreshTokenKey = "bwchat.auth.refresh-token.v1";
const nativeKeychainOptions: SecureStore.SecureStoreOptions = {
  keychainService: "com.bwchat.app",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
let inMemoryAccessToken: string | null = null;
let inMemoryRefreshToken: string | null = null;

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
}

export async function readAccessToken(): Promise<string | null> {
  if (inMemoryAccessToken) return inMemoryAccessToken;
  inMemoryAccessToken = await readAndMigrateToken(nativeAccessTokenKey, legacyExpoAccessTokenKey);
  return inMemoryAccessToken;
}

export async function readRefreshToken(): Promise<string | null> {
  if (inMemoryRefreshToken) return inMemoryRefreshToken;
  inMemoryRefreshToken = await readAndMigrateToken(
    nativeRefreshTokenKey,
    legacyExpoRefreshTokenKey,
  );
  return inMemoryRefreshToken;
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  const accessToken = normalizeToken(tokens.accessToken);
  const refreshToken = normalizeToken(tokens.refreshToken);
  if (!accessToken) throw new Error("访问令牌不能为空");
  // AuthManager keeps the active tokens in memory even if a Keychain write
  // fails. Protected requests must remain usable for the current session.
  inMemoryAccessToken = accessToken;
  inMemoryRefreshToken = refreshToken;
  await safeSecureStoreWrite("access-token-save", () =>
    SecureStore.setItemAsync(nativeAccessTokenKey, accessToken, nativeKeychainOptions),
  );
  if (refreshToken) {
    await safeSecureStoreWrite("refresh-token-save", () =>
      SecureStore.setItemAsync(nativeRefreshTokenKey, refreshToken, nativeKeychainOptions),
    );
  } else {
    await safeSecureStoreWrite("refresh-token-delete", () =>
      SecureStore.deleteItemAsync(nativeRefreshTokenKey, nativeKeychainOptions),
    );
  }
  await Promise.all([
    safeSecureStoreWrite("legacy-access-token-delete", () =>
      SecureStore.deleteItemAsync(legacyExpoAccessTokenKey),
    ),
    safeSecureStoreWrite("legacy-refresh-token-delete", () =>
      SecureStore.deleteItemAsync(legacyExpoRefreshTokenKey),
    ),
  ]);
}

export async function clearTokens(): Promise<void> {
  inMemoryAccessToken = null;
  inMemoryRefreshToken = null;
  await Promise.all([
    safeSecureStoreWrite("access-token-delete", () =>
      SecureStore.deleteItemAsync(nativeAccessTokenKey, nativeKeychainOptions),
    ),
    safeSecureStoreWrite("refresh-token-delete", () =>
      SecureStore.deleteItemAsync(nativeRefreshTokenKey, nativeKeychainOptions),
    ),
    safeSecureStoreWrite("legacy-access-token-delete", () =>
      SecureStore.deleteItemAsync(legacyExpoAccessTokenKey),
    ),
    safeSecureStoreWrite("legacy-refresh-token-delete", () =>
      SecureStore.deleteItemAsync(legacyExpoRefreshTokenKey),
    ),
  ]);
}

async function readAndMigrateToken(nativeKey: string, legacyExpoKey: string): Promise<string | null> {
  const nativeValue = normalizeToken(
    await safeSecureStoreRead("native-token-read", () =>
      SecureStore.getItemAsync(nativeKey, nativeKeychainOptions),
    ),
  );
  if (nativeValue) return nativeValue;
  const legacyValue = normalizeToken(
    await safeSecureStoreRead("legacy-token-read", () => SecureStore.getItemAsync(legacyExpoKey)),
  );
  if (!legacyValue) return null;
  await safeSecureStoreWrite("legacy-token-migrate", () =>
    SecureStore.setItemAsync(nativeKey, legacyValue, nativeKeychainOptions),
  );
  await safeSecureStoreWrite("legacy-token-delete", () =>
    SecureStore.deleteItemAsync(legacyExpoKey),
  );
  return legacyValue;
}

async function safeSecureStoreRead(
  operation: string,
  read: () => Promise<string | null>,
): Promise<string | null> {
  try {
    return await read();
  } catch (error) {
    reportTokenStorageFailure(operation, error);
    return null;
  }
}

async function safeSecureStoreWrite(operation: string, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    reportTokenStorageFailure(operation, error);
  }
}

function reportTokenStorageFailure(operation: string, error: unknown): void {
  if (process.env.NODE_ENV === "test") return;
  const errorType = error instanceof Error ? error.name : "unknown";
  // Never include the token value or the platform error message here.
  console.warn(`[AuthToken] ${operation} failed type=${errorType}`);
}

export function resetTokenStorageForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  inMemoryAccessToken = null;
  inMemoryRefreshToken = null;
}
