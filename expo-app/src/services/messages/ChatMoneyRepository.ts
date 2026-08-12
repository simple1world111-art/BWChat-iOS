import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  acceptTransfer,
  claimRedPacket,
  createRedPacketMessage,
  createTransferMessage,
  getChatMoneyConfiguration,
  getChatMoneyDetail,
  returnTransfer,
} from "@/api/bwchat";
import type {
  ChatMoneyActionResult,
  ChatMoneyConfiguration,
  ChatMoneyCreationResult,
  ChatMoneyDetail,
  ChatMoneyRecipient,
  ChatMoneyRedPacketMode,
  ChatMoneyScope,
  ChatMoneyStatus,
} from "@/models";
import { cacheGiftWalletBalance } from "@/services/messages/ChatGiftRepository";
import {
  mergeChatMoneyDetail,
  unavailableChatMoneyConfiguration,
} from "@/services/messages/chatMoneyPolicy";

interface ViewerClaimReceipt {
  user_id: string;
  nickname: string;
  avatar_url?: string | undefined;
  amount: number;
  claimed_at: string;
}

interface TransferActionReceipt {
  status: "accepted" | "returned";
  completed_at: string;
}

const configurationCache = new Map<string, ChatMoneyConfiguration>();
const detailCache = new Map<string, ChatMoneyDetail>();
const detailRequests = new Map<string, Promise<ChatMoneyDetail>>();
const configurationCachePrefix = "bwchat.chat-money.config.v1:";
const detailCachePrefix = "bwchat.chat-money.detail.v1:";
let activeOperation: { ownerId: string; assetId: string } | null = null;

interface StoredChatMoneyValue<T> {
  value: T;
  savedAt: number;
}

export function resetChatMoneyMemoryForAccount(ownerId: string): void {
  const owner = ownerId.trim();
  if (!owner) return;
  configurationCache.delete(owner);
  const detailPrefix = `${owner}|`;
  for (const key of detailCache.keys()) {
    if (key.startsWith(detailPrefix)) detailCache.delete(key);
  }
  for (const key of detailRequests.keys()) {
    if (key.startsWith(detailPrefix)) detailRequests.delete(key);
  }
  if (activeOperation?.ownerId === owner) activeOperation = null;
}

export async function loadChatMoneyConfiguration(ownerId: string): Promise<ChatMoneyConfiguration> {
  const owner = ownerId.trim();
  const persisted = await readStoredConfiguration(owner);
  if (persisted) configurationCache.set(owner, persisted);
  try {
    const configuration = await getChatMoneyConfiguration();
    configurationCache.set(owner, configuration);
    await writeStoredValue(configurationStorageKey(owner), configuration);
    return configuration;
  } catch {
    const fallback = configurationCache.get(owner) ?? unavailableChatMoneyConfiguration;
    configurationCache.set(owner, fallback);
    return fallback;
  }
}

export function cachedChatMoneyConfiguration(ownerId: string): ChatMoneyConfiguration {
  return configurationCache.get(ownerId.trim()) ?? unavailableChatMoneyConfiguration;
}

export async function createChatMoneyRedPacket(input: {
  ownerId: string;
  clientMessageId: string;
  scope: ChatMoneyScope;
  mode: ChatMoneyRedPacketMode;
  totalAmount: number;
  packetCount: number;
  greeting: string;
  receiverId?: string | undefined;
  groupId?: number | undefined;
  recipient?: ChatMoneyRecipient | undefined;
  amountPerPacket?: number | undefined;
}): Promise<ChatMoneyCreationResult> {
  ensureEligible(input.ownerId, "red_packet");
  return performMutation(input.ownerId, input.clientMessageId, async () => {
    const result = await createRedPacketMessage({
      clientMessageId: input.clientMessageId,
      scope: input.scope,
      mode: input.mode,
      totalAmount: input.totalAmount,
      packetCount: input.packetCount,
      greeting: input.greeting,
      ...(input.receiverId ? { receiverId: input.receiverId } : {}),
      ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
      ...(input.recipient
        ? {
            recipientId: input.recipient.id,
            recipientName: input.recipient.name,
          }
        : {}),
      ...(input.amountPerPacket !== undefined ? { amountPerPacket: input.amountPerPacket } : {}),
    });
    await applyWallet(input.ownerId, result.wallet_balance);
    return result;
  });
}

export async function createChatMoneyTransfer(input: {
  ownerId: string;
  clientMessageId: string;
  scope: ChatMoneyScope;
  recipient: ChatMoneyRecipient;
  amount: number;
  note: string;
  receiverId?: string | undefined;
  groupId?: number | undefined;
}): Promise<ChatMoneyCreationResult> {
  ensureEligible(input.ownerId, "transfer");
  return performMutation(input.ownerId, input.clientMessageId, async () => {
    const result = await createTransferMessage({
      clientMessageId: input.clientMessageId,
      scope: input.scope,
      recipientId: input.recipient.id,
      recipientName: input.recipient.name,
      amount: input.amount,
      note: input.note,
      ...(input.receiverId ? { receiverId: input.receiverId } : {}),
      ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
    });
    await applyWallet(input.ownerId, result.wallet_balance);
    return result;
  });
}

export async function loadChatMoneyDetail(input: {
  ownerId: string;
  assetId: string;
  force?: boolean | undefined;
}): Promise<ChatMoneyDetail> {
  const key = detailKey(input.ownerId, input.assetId);
  if (!input.force && detailCache.has(key)) return detailCache.get(key)!;
  const persisted = await readStoredDetail(input.ownerId, input.assetId);
  if (persisted) detailCache.set(key, persisted);
  if (!input.force && persisted) return persisted;

  const existingRequest = detailRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    try {
      const server = await getChatMoneyDetail(input.assetId);
      const normalized = await normalizeForLocalReceipts(input.ownerId, server);
      const merged = mergeChatMoneyDetail(detailCache.get(key), normalized);
      detailCache.set(key, merged);
      await writeStoredValue(detailStorageKey(input.ownerId, input.assetId), merged);
      return merged;
    } catch (error) {
      if (persisted) return persisted;
      throw error;
    }
  })();
  detailRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (detailRequests.get(key) === request) detailRequests.delete(key);
  }
}

export function cachedChatMoneyDetail(ownerId: string, assetId: string): ChatMoneyDetail | null {
  return detailCache.get(detailKey(ownerId, assetId)) ?? null;
}

export async function claimChatMoneyRedPacket(input: {
  ownerId: string;
  ownerName: string;
  ownerAvatar?: string | undefined;
  assetId: string;
}): Promise<ChatMoneyActionResult> {
  if (await hasViewerClaimedChatMoney(input.ownerId, input.assetId)) {
    throw new Error("red_packet_already_claimed");
  }
  return performMutation(input.ownerId, input.assetId, async () => {
    const result = await claimRedPacket(input.assetId);
    await recordViewerClaim(input, result.detail);
    const normalized = await normalizeForLocalReceipts(input.ownerId, result.detail);
    const detail = cacheDetail(input.ownerId, normalized);
    await writeStoredValue(detailStorageKey(input.ownerId, detail.asset_id), detail);
    await applyWallet(input.ownerId, result.wallet_balance);
    return { ...result, detail };
  });
}

export async function acceptChatMoneyTransfer(input: {
  ownerId: string;
  assetId: string;
}): Promise<ChatMoneyActionResult> {
  return finalizeTransfer(input, "accepted", acceptTransfer);
}

export async function returnChatMoneyTransfer(input: {
  ownerId: string;
  assetId: string;
}): Promise<ChatMoneyActionResult> {
  return finalizeTransfer(input, "returned", returnTransfer);
}

export async function hasViewerClaimedChatMoney(
  ownerId: string,
  assetId: string,
): Promise<boolean> {
  return (await claimedAssetIds(ownerId)).includes(assetId);
}

export async function hasFinalizedChatMoneyTransfer(
  ownerId: string,
  assetId: string,
): Promise<boolean> {
  const receipts = await transferReceipts(ownerId);
  return receipts[assetId] !== undefined;
}

async function finalizeTransfer(
  input: { ownerId: string; assetId: string },
  status: "accepted" | "returned",
  operation: (assetId: string) => Promise<ChatMoneyActionResult>,
): Promise<ChatMoneyActionResult> {
  if (await hasFinalizedChatMoneyTransfer(input.ownerId, input.assetId)) {
    throw new Error("transfer_already_finalized");
  }
  return performMutation(input.ownerId, input.assetId, async () => {
    const result = await operation(input.assetId);
    const receipts = await transferReceipts(input.ownerId);
    const completedAt = new Date().toISOString();
    receipts[input.assetId] = { status, completed_at: completedAt };
    await AsyncStorage.setItem(transferReceiptKey(input.ownerId), JSON.stringify(receipts));
    const detail = cacheDetail(input.ownerId, {
      ...result.detail,
      status,
      can_accept: false,
      can_return: false,
      finalized_at: result.detail.finalized_at ?? completedAt,
    });
    await writeStoredValue(detailStorageKey(input.ownerId, detail.asset_id), detail);
    await applyWallet(input.ownerId, result.wallet_balance);
    return { ...result, detail };
  });
}

async function normalizeForLocalReceipts(
  ownerId: string,
  detail: ChatMoneyDetail,
): Promise<ChatMoneyDetail> {
  let normalized = detail;
  if (detail.kind === "red_packet" && (await hasViewerClaimedChatMoney(ownerId, detail.asset_id))) {
    const receipts = await viewerClaimReceipts(ownerId);
    const receipt = receipts[detail.asset_id];
    const hasClaim = receipt && !detail.claims.some((claim) => claim.user_id === receipt.user_id);
    const status: ChatMoneyStatus =
      detail.scope === "dm" ||
      detail.packet_count === 1 ||
      (detail.claimed_count !== undefined && detail.claimed_count === detail.packet_count)
        ? "completed"
        : detail.status === "pending"
          ? "partial"
          : detail.status;
    normalized = {
      ...detail,
      status,
      can_claim: false,
      ...(receipt ? { viewer_claim_amount: detail.viewer_claim_amount ?? receipt.amount } : {}),
      claims: hasClaim ? [...detail.claims, { ...receipt, is_luckiest: false }] : detail.claims,
    };
  }
  if (detail.kind === "transfer") {
    const receipt = (await transferReceipts(ownerId))[detail.asset_id];
    if (receipt) {
      normalized = {
        ...normalized,
        status: receipt.status,
        can_accept: false,
        can_return: false,
        finalized_at: normalized.finalized_at ?? receipt.completed_at,
      };
    }
  }
  if (["completed", "accepted", "returned", "expired_refunded"].includes(normalized.status)) {
    normalized = { ...normalized, can_claim: false, can_accept: false, can_return: false };
  }
  return normalized;
}

async function recordViewerClaim(
  input: { ownerId: string; ownerName: string; ownerAvatar?: string | undefined; assetId: string },
  detail: ChatMoneyDetail,
): Promise<void> {
  const ids = await claimedAssetIds(input.ownerId);
  if (!ids.includes(input.assetId)) ids.push(input.assetId);
  await AsyncStorage.setItem(claimedAssetKey(input.ownerId), JSON.stringify(ids));
  const server = detail.claims.find((claim) => claim.user_id === input.ownerId);
  const amount = detail.viewer_claim_amount ?? server?.amount;
  if (amount === undefined) return;
  const receipts = await viewerClaimReceipts(input.ownerId);
  receipts[input.assetId] = {
    user_id: input.ownerId,
    nickname: input.ownerName || server?.nickname || input.ownerId,
    ...(input.ownerAvatar || server?.avatar_url
      ? { avatar_url: input.ownerAvatar || server?.avatar_url }
      : {}),
    amount,
    claimed_at: server?.claimed_at || new Date().toISOString(),
  };
  await AsyncStorage.setItem(viewerClaimMetadataKey(input.ownerId), JSON.stringify(receipts));
}

function ensureEligible(ownerId: string, kind: "red_packet" | "transfer"): void {
  const configuration = cachedChatMoneyConfiguration(ownerId);
  if (kind === "red_packet" ? !configuration.red_packet_enabled : !configuration.transfer_enabled) {
    throw new Error("chat_money_disabled");
  }
  if (!configuration.eligibility.eligible) {
    throw new Error(configuration.eligibility.message || "chat_money_not_eligible");
  }
}

async function performMutation<T>(
  ownerId: string,
  assetId: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (activeOperation !== null) throw new Error("operation_in_progress");
  const current = { ownerId: ownerId.trim(), assetId };
  activeOperation = current;
  try {
    return await operation();
  } finally {
    if (activeOperation === current) activeOperation = null;
  }
}

function cacheDetail(ownerId: string, detail: ChatMoneyDetail): ChatMoneyDetail {
  const key = detailKey(ownerId, detail.asset_id);
  const merged = mergeChatMoneyDetail(detailCache.get(key), detail);
  detailCache.set(key, merged);
  return merged;
}

async function applyWallet(
  ownerId: string,
  balance: ChatMoneyCreationResult["wallet_balance"],
): Promise<void> {
  if (balance) await cacheGiftWalletBalance(ownerId, balance);
}

async function claimedAssetIds(ownerId: string): Promise<string[]> {
  const encoded = await AsyncStorage.getItem(claimedAssetKey(ownerId));
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(encoded) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

async function viewerClaimReceipts(ownerId: string): Promise<Record<string, ViewerClaimReceipt>> {
  return readRecord<ViewerClaimReceipt>(viewerClaimMetadataKey(ownerId));
}

async function transferReceipts(ownerId: string): Promise<Record<string, TransferActionReceipt>> {
  return readRecord<TransferActionReceipt>(transferReceiptKey(ownerId));
}

async function readRecord<T>(key: string): Promise<Record<string, T>> {
  const encoded = await AsyncStorage.getItem(key);
  if (!encoded) return {};
  try {
    const value = JSON.parse(encoded) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, T>)
      : {};
  } catch {
    return {};
  }
}

function detailKey(ownerId: string, assetId: string): string {
  return `${ownerId.trim()}|${assetId.trim()}`;
}

async function readStoredConfiguration(ownerId: string): Promise<ChatMoneyConfiguration | null> {
  const value = await readStoredValue<ChatMoneyConfiguration>(configurationStorageKey(ownerId));
  return value &&
    typeof value.red_packet_enabled === "boolean" &&
    typeof value.transfer_enabled === "boolean" &&
    value.eligibility
    ? value
    : null;
}

async function readStoredDetail(ownerId: string, assetId: string): Promise<ChatMoneyDetail | null> {
  const value = await readStoredValue<ChatMoneyDetail>(detailStorageKey(ownerId, assetId));
  return value &&
    value.asset_id === assetId.trim() &&
    (value.kind === "red_packet" || value.kind === "transfer")
    ? value
    : null;
}

async function readStoredValue<T>(key: string): Promise<T | null> {
  if (!key) return null;
  try {
    const encoded = await AsyncStorage.getItem(key);
    if (!encoded) return null;
    const decoded = JSON.parse(encoded) as Partial<StoredChatMoneyValue<T>>;
    return typeof decoded.savedAt === "number" && decoded.value ? decoded.value : null;
  } catch {
    return null;
  }
}

async function writeStoredValue<T>(key: string, value: T): Promise<void> {
  if (!key) return;
  await AsyncStorage.setItem(key, JSON.stringify({ value, savedAt: Date.now() }));
}

function configurationStorageKey(ownerId: string): string {
  const owner = ownerId.trim();
  return owner ? `${configurationCachePrefix}account:${encodeURIComponent(owner)}` : "";
}

function detailStorageKey(ownerId: string, assetId: string): string {
  const owner = ownerId.trim();
  const asset = assetId.trim();
  return owner && asset
    ? `${detailCachePrefix}account:${encodeURIComponent(owner)}:asset:${encodeURIComponent(asset)}`
    : "";
}

function claimedAssetKey(ownerId: string): string {
  return `bbchat.chat-money.claimed-assets.${ownerId}`;
}

function viewerClaimMetadataKey(ownerId: string): string {
  return `${claimedAssetKey(ownerId)}.metadata`;
}

function transferReceiptKey(ownerId: string): string {
  return `bbchat.chat-money.transfer-actions.${ownerId}`;
}
