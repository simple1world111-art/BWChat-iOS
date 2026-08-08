import AsyncStorage from "@react-native-async-storage/async-storage";

import { getGiftCatalog, getWalletBalance } from "@/api/bwchat";
import { normalizeWalletBalanceSnapshot } from "@/api/normalizers";
import type { GiftCatalogItem, WalletBalanceSnapshot } from "@/models";
import {
  effectiveGiftCatalog,
  fixedGiftCatalog,
  normalizeGiftCatalog,
} from "@/services/messages/chatGiftPolicy";

const catalogKeyPrefix = "bwchat.gift.catalog.v1";
const balanceKeyPrefix = "bwchat.wallet.balance.v1";

export interface GiftCatalogLoadResult {
  gifts: GiftCatalogItem[];
  usedFallback: boolean;
}

export async function loadGiftCatalog(ownerId: string): Promise<GiftCatalogLoadResult> {
  const cached = await readCachedGiftCatalog(ownerId);
  try {
    const remote = await getGiftCatalog();
    const gifts = effectiveGiftCatalog(remote);
    await AsyncStorage.setItem(catalogKey(ownerId), JSON.stringify(gifts));
    return { gifts, usedFallback: remote.length === 0 };
  } catch {
    if (cached.length > 0) return { gifts: cached, usedFallback: false };
    return { gifts: [...fixedGiftCatalog], usedFallback: true };
  }
}

export async function readCachedGiftCatalog(ownerId: string): Promise<GiftCatalogItem[]> {
  const encoded = await AsyncStorage.getItem(catalogKey(ownerId));
  if (!encoded) return [];
  try {
    return normalizeGiftCatalog(JSON.parse(encoded) as unknown);
  } catch {
    return [];
  }
}

export async function refreshGiftWalletBalance(ownerId: string): Promise<WalletBalanceSnapshot> {
  try {
    const balance = await getWalletBalance();
    await cacheGiftWalletBalance(ownerId, balance);
    return balance;
  } catch (error) {
    const cached = await readCachedGiftWalletBalance(ownerId);
    if (cached) return cached;
    throw error;
  }
}

export async function cacheGiftWalletBalance(
  ownerId: string,
  balance: WalletBalanceSnapshot,
): Promise<void> {
  await AsyncStorage.setItem(balanceKey(ownerId), JSON.stringify(balance));
}

export async function readCachedGiftWalletBalance(
  ownerId: string,
): Promise<WalletBalanceSnapshot | null> {
  const encoded = await AsyncStorage.getItem(balanceKey(ownerId));
  if (!encoded) return null;
  try {
    return normalizeWalletBalanceSnapshot(JSON.parse(encoded) as unknown);
  } catch {
    return null;
  }
}

function catalogKey(ownerId: string): string {
  return `${catalogKeyPrefix}:${encodeURIComponent(ownerId)}`;
}

function balanceKey(ownerId: string): string {
  return `${balanceKeyPrefix}:${encodeURIComponent(ownerId)}`;
}
