import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  shanghaiBusinessDay,
  type WalletPendingRewardCredit,
  walletMetrics,
} from "@/services/wallet/walletPolicy";

const pendingPrefix = "bbchat.adReward.pendingCredit";
const counterPrefix = "bbchat.adReward.daily";

export async function readPendingWalletAdReward(ownerId: string): Promise<WalletPendingRewardCredit | undefined> {
  try {
    const raw = await AsyncStorage.getItem(`${pendingPrefix}.${ownerId}`);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<WalletPendingRewardCredit>;
    return value.userId === ownerId
      && typeof value.remainingBefore === "number"
      && typeof value.businessDayResetAt === "number"
      && typeof value.sessionExpiresAt === "number"
      ? value as WalletPendingRewardCredit
      : undefined;
  } catch {
    return undefined;
  }
}

export async function savePendingWalletAdReward(value: WalletPendingRewardCredit): Promise<void> {
  await AsyncStorage.setItem(`${pendingPrefix}.${value.userId}`, JSON.stringify(value));
}

export async function removePendingWalletAdReward(ownerId: string): Promise<void> {
  await AsyncStorage.removeItem(`${pendingPrefix}.${ownerId}`);
}

export async function localWalletAdRemaining(ownerId: string, now = Date.now()): Promise<number> {
  const day = shanghaiBusinessDay(now);
  const key = `${counterPrefix}.${ownerId}`;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      await AsyncStorage.setItem(key, JSON.stringify({ day, watched: 0 }));
      return walletMetrics.dailyAdLimit;
    }
    const value = JSON.parse(raw) as { day?: unknown; watched?: unknown };
    if (value.day !== day || typeof value.watched !== "number") {
      await AsyncStorage.setItem(key, JSON.stringify({ day, watched: 0 }));
      return walletMetrics.dailyAdLimit;
    }
    return walletMetrics.dailyAdLimit - Math.min(
      Math.max(Math.trunc(value.watched), 0),
      walletMetrics.dailyAdLimit,
    );
  } catch {
    return walletMetrics.dailyAdLimit;
  }
}

export async function recordLocalWalletAdReward(ownerId: string, now = Date.now()): Promise<void> {
  const remaining = await localWalletAdRemaining(ownerId, now);
  const watched = walletMetrics.dailyAdLimit - remaining + 1;
  await AsyncStorage.setItem(
    `${counterPrefix}.${ownerId}`,
    JSON.stringify({
      day: shanghaiBusinessDay(now),
      watched: Math.min(watched, walletMetrics.dailyAdLimit),
    }),
  );
}
