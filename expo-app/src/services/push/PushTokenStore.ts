import AsyncStorage from "@react-native-async-storage/async-storage";

const nativeTokenKey = "bwchat.push.native-token.v1";

export async function readCachedNativePushToken(): Promise<string | null> {
  const value = (await AsyncStorage.getItem(nativeTokenKey))?.trim();
  return value || null;
}

export async function writeCachedNativePushToken(token: string): Promise<string | null> {
  const value = token.trim();
  if (!value) return null;
  await AsyncStorage.setItem(nativeTokenKey, value);
  return value;
}
