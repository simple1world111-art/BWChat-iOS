import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { Linking } from "react-native";

const lastKnownGoodSupportEmailKey = "bwchat.support-email.last-known-good.v1";

let inMemoryLastKnownGoodSupportEmail: string | undefined;

export function normalizedSupportEmail(value: string | undefined): string | undefined {
  const email = value?.trim();
  if (
    !email ||
    email.length > 254 ||
    !/^[A-Z0-9.!#$%&'*+/=_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/iu.test(
      email,
    )
  ) {
    return undefined;
  }
  return email;
}

export function supportMailtoURL(value: string | undefined): string | undefined {
  const email = normalizedSupportEmail(value);
  return email ? `mailto:${encodeURIComponent(email)}` : undefined;
}

export async function readLastKnownGoodSupportEmail(): Promise<string | undefined> {
  if (inMemoryLastKnownGoodSupportEmail) return inMemoryLastKnownGoodSupportEmail;
  try {
    const stored = normalizedSupportEmail(
      (await AsyncStorage.getItem(lastKnownGoodSupportEmailKey)) ?? undefined,
    );
    if (stored) inMemoryLastKnownGoodSupportEmail = stored;
    return stored;
  } catch {
    return undefined;
  }
}

export async function persistLastKnownGoodSupportEmail(
  value: string | undefined,
): Promise<string | undefined> {
  const email = normalizedSupportEmail(value);
  if (!email) return undefined;
  inMemoryLastKnownGoodSupportEmail = email;
  try {
    await AsyncStorage.setItem(lastKnownGoodSupportEmailKey, email);
  } catch {
    // The in-memory value remains usable for this process. A storage failure
    // must never replace a valid server value with the unconfigured state.
  }
  return email;
}

export function resetSupportEmailMemoryForTests(): void {
  if (process.env.NODE_ENV === "test") inMemoryLastKnownGoodSupportEmail = undefined;
}

export async function openSupportEmail(email: string): Promise<boolean> {
  const url = supportMailtoURL(email);
  if (!url) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export async function copySupportEmail(email: string): Promise<void> {
  await Clipboard.setStringAsync(email);
}
