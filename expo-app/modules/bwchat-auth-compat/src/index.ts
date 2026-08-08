import { requireOptionalNativeModule } from "expo";

interface BWChatAuthCompatNativeModule {
  readCachedUserJSONAsync(): Promise<string | null>;
  readLastActiveAccountIdAsync(): Promise<string | null>;
  clearCachedUserAsync(): Promise<void>;
  readLanguageSelection(): string | null;
  writeLanguageSelection(language: string): void;
  formatFileByteCount(byteCount: number): string;
}

const nativeModule = requireOptionalNativeModule<BWChatAuthCompatNativeModule>("BWChatAuthCompat");

export async function readLegacyCachedUserJSON(): Promise<string | null> {
  return nativeModule?.readCachedUserJSONAsync ? nativeModule.readCachedUserJSONAsync() : null;
}

export async function readLegacyLastActiveAccountId(): Promise<string | null> {
  return nativeModule?.readLastActiveAccountIdAsync
    ? nativeModule.readLastActiveAccountIdAsync()
    : null;
}

export async function clearLegacyCachedUser(): Promise<void> {
  await nativeModule?.clearCachedUserAsync?.();
}

export function readNativeLanguageSelection(): string | null {
  try {
    return nativeModule?.readLanguageSelection?.() ?? null;
  } catch {
    return null;
  }
}

export function writeNativeLanguageSelection(language: string): boolean {
  if (!nativeModule?.writeLanguageSelection) return false;
  try {
    nativeModule.writeLanguageSelection(language);
    return true;
  } catch {
    return false;
  }
}

export function formatNativeFileByteCount(byteCount: number): string | null {
  if (!nativeModule?.formatFileByteCount) return null;
  try {
    return nativeModule.formatFileByteCount(Math.max(0, Math.trunc(byteCount)));
  } catch {
    return null;
  }
}
