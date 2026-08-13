import AsyncStorage from "@react-native-async-storage/async-storage";

import { getWalletBalance, getWalletTransactionPage } from "@/api/bwchat";
import {
  flexInt,
  isRecord,
  normalizeWalletBalanceSnapshot,
  normalizeWalletTransactionPage,
} from "@/api/normalizers";
import type { WalletBalanceSnapshot, WalletTransaction, WalletTransactionPage } from "@/models";
import { cacheGiftWalletBalance } from "@/services/messages/ChatGiftRepository";
import { walletMetrics } from "@/services/wallet/walletPolicy";

interface CachedEnvelope<T> {
  savedAt: number;
  value: T;
}

export interface WalletLoadResult<T> {
  value: T;
  source: "cache" | "stale-cache" | "remote";
  refreshError?: unknown;
}

export interface WalletRepositoryAccountGuard {
  operationKey: string;
  isCurrent(): boolean;
}

export class WalletRepositoryAccountChangedError extends Error {
  constructor() {
    super("Wallet repository account scope changed");
    this.name = "WalletRepositoryAccountChangedError";
  }
}

const balanceKeyPrefix = "bwchat.wallet.balance.v2";
const transactionsKeyPrefix = "bwchat.wallet.transactions.v2";
const inFlightLoads = new Map<string, Promise<unknown>>();

export async function loadWalletBalance(
  ownerId: string,
  forceRefresh = false,
  guard?: WalletRepositoryAccountGuard,
): Promise<WalletLoadResult<WalletBalanceSnapshot>> {
  const cached = await readEnvelope(balanceKey(ownerId), normalizeWalletBalanceSnapshot);
  assertCurrentAccount(guard);
  if (!forceRefresh && isFresh(cached, walletMetrics.balanceCacheTtlMs)) {
    return { value: cached.value, source: "cache" };
  }
  try {
    const value = await coalescedLoad(operationKey(balanceKey(ownerId), guard), getWalletBalance);
    assertCurrentAccount(guard);
    await persistBalance(ownerId, value).catch(() => undefined);
    return { value, source: "remote" };
  } catch (error) {
    if (error instanceof WalletRepositoryAccountChangedError) throw error;
    assertCurrentAccount(guard);
    if (isUsableStale(cached, walletMetrics.balanceCacheTtlMs)) {
      return { value: cached.value, source: "stale-cache", refreshError: error };
    }
    throw error;
  }
}

export async function refreshWalletBalance(
  ownerId: string,
  guard?: WalletRepositoryAccountGuard,
): Promise<WalletBalanceSnapshot> {
  return (await loadWalletBalance(ownerId, true, guard)).value;
}

export async function loadWalletTransactions(
  ownerId: string,
  forceRefresh = false,
  guard?: WalletRepositoryAccountGuard,
): Promise<WalletLoadResult<WalletTransactionPage>> {
  const cached = await readEnvelope(transactionsKey(ownerId), normalizeWalletTransactionPage);
  assertCurrentAccount(guard);
  if (!forceRefresh && isFresh(cached, walletMetrics.listCacheTtlMs)) {
    return { value: cached.value, source: "cache" };
  }
  if (!forceRefresh && isUsableStale(cached, walletMetrics.listCacheTtlMs)) {
    void refreshTransactionCache(ownerId, cached.value, guard);
    return { value: cached.value, source: "stale-cache" };
  }
  try {
    const remote = await coalescedLoad(operationKey(transactionsKey(ownerId), guard), () =>
      getWalletTransactionPage({ limit: walletMetrics.transactionPageSize }),
    );
    assertCurrentAccount(guard);
    const value = mergeWalletTransactionPages(remote, cached?.value);
    await writeEnvelope(transactionsKey(ownerId), value).catch(() => undefined);
    return { value, source: "remote" };
  } catch (error) {
    if (error instanceof WalletRepositoryAccountChangedError) throw error;
    assertCurrentAccount(guard);
    if (isUsableStale(cached, walletMetrics.listCacheTtlMs)) {
      return { value: cached.value, source: "stale-cache", refreshError: error };
    }
    throw error;
  }
}

export async function loadMoreWalletTransactions(
  ownerId: string,
  current: WalletTransactionPage,
  guard?: WalletRepositoryAccountGuard,
): Promise<WalletTransactionPage> {
  const cursor = current.next_cursor?.trim();
  if (!cursor) return current;
  assertCurrentAccount(guard);
  const remote = await coalescedLoad(
    operationKey(`${transactionsKey(ownerId)}:${cursor}`, guard),
    () =>
      getWalletTransactionPage({
        cursor,
        limit: walletMetrics.transactionPageSize,
      }),
  );
  assertCurrentAccount(guard);
  const nextCursor =
    remote.next_cursor?.trim() && remote.next_cursor !== cursor ? remote.next_cursor : undefined;
  const value: WalletTransactionPage = {
    transactions: deduplicateWalletTransactions([...current.transactions, ...remote.transactions]),
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
  };
  await writeEnvelope(transactionsKey(ownerId), value).catch(() => undefined);
  return value;
}

export async function readCachedWalletBalance(
  ownerId: string,
): Promise<WalletBalanceSnapshot | undefined> {
  return (await readEnvelope(balanceKey(ownerId), normalizeWalletBalanceSnapshot))?.value;
}

export async function readCachedWalletTransactions(
  ownerId: string,
): Promise<WalletTransactionPage | undefined> {
  return (await readEnvelope(transactionsKey(ownerId), normalizeWalletTransactionPage))?.value;
}

export async function persistBalance(
  ownerId: string,
  balance: WalletBalanceSnapshot,
): Promise<void> {
  await Promise.all([
    writeEnvelope(balanceKey(ownerId), balance),
    cacheGiftWalletBalance(ownerId, balance),
  ]);
}

export function mergeWalletTransactionPages(
  remote: WalletTransactionPage,
  cached?: WalletTransactionPage | undefined,
): WalletTransactionPage {
  const nextCursor = remote.next_cursor?.trim() ? remote.next_cursor : undefined;
  return {
    transactions: deduplicateWalletTransactions([
      ...remote.transactions,
      ...(cached?.transactions ?? []),
    ]),
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
  };
}

export function deduplicateWalletTransactions(
  transactions: readonly WalletTransaction[],
): WalletTransaction[] {
  const seen = new Set<string>();
  return transactions.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function balanceKey(ownerId: string): string {
  return `${balanceKeyPrefix}:${ownerId}`;
}

function transactionsKey(ownerId: string): string {
  return `${transactionsKeyPrefix}:${ownerId}`;
}

function isFresh<T>(
  envelope: CachedEnvelope<T> | undefined,
  ttlMs: number,
): envelope is CachedEnvelope<T> {
  return Boolean(envelope && Date.now() - envelope.savedAt < ttlMs);
}

function isUsableStale<T>(
  envelope: CachedEnvelope<T> | undefined,
  ttlMs: number,
): envelope is CachedEnvelope<T> {
  return Boolean(
    envelope && Date.now() - envelope.savedAt <= ttlMs + walletMetrics.staleRetentionMs,
  );
}

async function refreshTransactionCache(
  ownerId: string,
  cached: WalletTransactionPage,
  guard?: WalletRepositoryAccountGuard,
): Promise<void> {
  try {
    const remote = await coalescedLoad(operationKey(transactionsKey(ownerId), guard), () =>
      getWalletTransactionPage({ limit: walletMetrics.transactionPageSize }),
    );
    assertCurrentAccount(guard);
    await writeEnvelope(
      transactionsKey(ownerId),
      mergeWalletTransactionPages(remote, cached),
    ).catch(() => undefined);
  } catch {
    // Native stale-while-revalidate keeps the visible cached page and suppresses refresh errors.
  }
}

function operationKey(key: string, guard: WalletRepositoryAccountGuard | undefined): string {
  return `${key}\u0000${guard?.operationKey ?? "unscoped"}`;
}

async function coalescedLoad<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const existing = inFlightLoads.get(key);
  if (existing) return existing as Promise<T>;
  const task = operation().finally(() => {
    if (inFlightLoads.get(key) === task) inFlightLoads.delete(key);
  });
  inFlightLoads.set(key, task);
  return task;
}

function assertCurrentAccount(guard: WalletRepositoryAccountGuard | undefined): void {
  if (guard && !guard.isCurrent()) throw new WalletRepositoryAccountChangedError();
}

async function readEnvelope<T>(
  key: string,
  normalize: (value: unknown) => T,
): Promise<CachedEnvelope<T> | undefined> {
  try {
    const encoded = await AsyncStorage.getItem(key);
    if (!encoded) return undefined;
    const decoded: unknown = JSON.parse(encoded);
    if (!isRecord(decoded)) return undefined;
    const savedAt = flexInt(decoded.savedAt);
    if (savedAt === undefined || savedAt < 0) return undefined;
    return { savedAt, value: normalize(decoded.value) };
  } catch {
    return undefined;
  }
}

async function writeEnvelope<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
}

export function resetWalletRepositoryMemoryForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  inFlightLoads.clear();
}
