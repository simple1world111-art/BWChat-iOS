import * as Clipboard from "expo-clipboard";
import { Linking } from "react-native";

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

export async function openSupportEmail(email: string): Promise<boolean> {
  try {
    await Linking.openURL(`mailto:${encodeURIComponent(email)}`);
    return true;
  } catch {
    return false;
  }
}

export async function copySupportEmail(email: string): Promise<void> {
  await Clipboard.setStringAsync(email);
}
