import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, Paths } from "expo-file-system";

import { resetAgentConversationMemoryForAccount } from "@/services/agents/AgentConversationResolver";
import { clearImageCache } from "@/services/cache/ImageCacheService";
import {
  clearAllMediaCache,
  clearMediaCacheForAccount,
  mediaCacheUsageBytes,
  subscribeMediaCacheUsage,
} from "@/services/cache/MediaCacheService";
import { clearUserInfoCache } from "@/services/cache/UserInfoCache";
import { resetConversationReadSubmissionForAccount } from "@/services/conversations/ConversationReadService";
import { resetConversationRepositoryMemoryForAccount } from "@/services/conversations/ConversationRepository";
import {
  resetFriendRepositoryMemoryForAccount,
  waitForAllFriendRepositoryPersistence,
  waitForFriendRepositoryPersistenceForAccount,
} from "@/services/friends/FriendRepository";
import { resetFollowListRepositoryMemoryForAccount } from "@/services/friends/FollowListRepository";
import { resetGroupRepositoryForAccount } from "@/services/groups/GroupRepository";
import {
  resetAllGroupDetailRepositoryMemory,
  resetGroupDetailRepositoryMemoryForAccount,
} from "@/services/groups/GroupDetailRepository";
import { resetChatMoneyMemoryForAccount } from "@/services/messages/ChatMoneyRepository";
import {
  clearNavigationSnapshots,
  clearNavigationSnapshotsForOwner,
  waitForNavigationSnapshotPersistence,
} from "@/services/navigation/NavigationSnapshotCache";
import { resetShortDramaFeedRepositoryMemoryForAccount } from "@/services/short-drama/ShortDramaFeedRepository";
import { resetShortDramaHistoryRepositoryMemoryForAccount } from "@/services/short-drama/ShortDramaHistoryRepository";
import { resetShortDramaSeriesRepositoryMemoryForAccount } from "@/services/short-drama/ShortDramaSeriesRepository";
import { formatNativeFileByteCount } from "../../../modules/bwchat-auth-compat/src";

const accountCachePrefixes = [
  "bbchat.activity-center.idempotency.",
  "bbchat.activity-center.snapshot.",
  "bbchat.adReward.daily.",
  "bbchat.adReward.pendingCredit.",
  "bbchat.app.dynamicScreen.etag.v1.",
  "bbchat.app.dynamicScreen.v1.",
  "bbchat.chat-money.claimed-assets.",
  "bbchat.chat-money.transfer-actions.",
  "bwchat.chat-money.config.v1:",
  "bwchat.chat-money.detail.v1:",
  "bwchat.agent-catalog-v1:",
  "bwchat.agent-messages-v1:",
  "bwchat.chat-draft.v1:",
  "bwchat.chat-hidden-messages.v1:",
  "bwchat.chat-image-outbox.v1:",
  "bwchat.chat-video-outbox.v1:",
  "bwchat.chat-backgrounds.v1:",
  "bwchat.conversations.hidden.v1:",
  "bwchat.conversations.initiated-dms.v1:",
  "bwchat.conversations.live-pairs.v1:",
  "bwchat.conversations.pinned.v1:",
  "bwchat.conversations.snapshot-metadata.v1:",
  "bwchat.conversations.snapshot.v1:",
  "bwchat.direct-history-clear.v1:",
  "bwchat.direct-message-backfilled.v1:",
  "bwchat.direct-message-history.v1:",
  "bwchat.direct-message-outbox.v1:",
  "bwchat.discover-refresh.v1:",
  "bwchat.friend-requests.v1:",
  "bwchat.friend-requests-metadata.v1:",
  "bwchat.friends.v1:",
  "bwchat.friends-metadata.v1:",
  "bwchat.follow-list.v1:",
  "bwchat.games.played.v1:",
  "bwchat.games.recommended.v1:",
  "bwchat.gift.catalog.v1:",
  "bwchat.groups.v1:",
  "bwchat.group-detail.v1:",
  "bwchat.group-history-clear.v1:",
  "bwchat.group-message-backfilled.v1:",
  "bwchat.group-message-history.v1:",
  "bwchat.group-message-outbox.v1:",
  "bwchat.group-pinned.v1:",
  "bwchat.moment-detail.v1:",
  "bwchat.moments-feed.v1:",
  "bwchat.moments-notifications.v1:",
  "bwchat.moment-outbox.v1:",
  "bwchat.media-cache.v1:",
  "bwchat.profile-moments.v1:",
  "bwchat.profile-agents.v1:",
  "bwchat.profile-short-dramas.v1:",
  "bwchat.prop-bag.v1:",
  "bwchat.public-profile.v1:",
  "bwchat.remote-config.v2:user.",
  "bwchat.script-room-messages-v1:",
  "bwchat.script-room-v1:",
  "bwchat.script-catalog-v1:",
  "bwchat.short-drama-comments-v1:",
  "bwchat.short-drama-feed-v1:",
  "bwchat.short-drama-history-v1:",
  "bwchat.short-drama-outbox.v1:",
  "bwchat.short-drama-series-v1:",
  "bwchat.wallet.balance.v1:",
  "bwchat.wallet.balance.v2:",
  "bwchat.wallet.transactions.v2:",
  ["bwchat.wallet.", "withdrawals.v1:"].join(""),
  ["bwchat.wallet.", "usdt.payout.v1:"].join(""),
] as const;

export async function formattedVideoCacheSize(ownerId: string): Promise<string> {
  return formatVideoCacheSize(await mediaCacheUsageBytes(ownerId));
}

export function formatVideoCacheSize(byteCount: number): string {
  return formatNativeFileByteCount(byteCount) ?? fallbackFileByteCount(byteCount);
}

export function subscribeVideoCacheSize(
  ownerId: string,
  listener: (formattedSize: string) => void,
): () => void {
  return subscribeMediaCacheUsage(ownerId, (byteCount) =>
    listener(formatVideoCacheSize(byteCount)),
  );
}

export async function clearVideoCache(ownerId: string): Promise<void> {
  await clearMediaCacheForAccount(ownerId);
}

export async function clearCurrentAccountData(ownerId: string): Promise<void> {
  const owner = ownerId.trim();
  const encodedOwner = encodeURIComponent(owner);
  if (!encodedOwner) return;
  resetAccountMemory(owner);
  await waitForNavigationSnapshotPersistence().catch(() => undefined);
  await waitForFriendRepositoryPersistenceForAccount(owner).catch(() => undefined);
  await removeAccountStorageKeys(owner).catch(() => undefined);
  await resetGroupRepositoryForAccount(owner).catch(() => undefined);
  await clearMediaCacheForAccount(owner).catch(() => undefined);
  for (const kind of ["moments", "chat-images", "chat-videos", "short-drama"] as const) {
    deleteDirectoryIfExists(new Directory(Paths.document, "bwchat-outbox", kind, encodedOwner));
  }
}

export async function clearAllAccountData(currentOwnerId?: string): Promise<void> {
  const currentOwner = currentOwnerId?.trim();
  if (currentOwner) {
    resetAccountMemory(currentOwner);
    await resetGroupRepositoryForAccount(currentOwner).catch(() => undefined);
  }
  resetAllGroupDetailRepositoryMemory();
  clearNavigationSnapshots();
  await waitForNavigationSnapshotPersistence().catch(() => undefined);
  await waitForAllFriendRepositoryPersistence().catch(() => undefined);
  await removeAllAccountStorageKeys().catch(() => undefined);
  const outbox = new Directory(Paths.document, "bwchat-outbox");
  deleteDirectoryIfExists(outbox);
  await Promise.allSettled([clearAllMediaCache(), clearImageCache(), clearUserInfoCache()]);
}

function resetAccountMemory(ownerId: string): void {
  clearNavigationSnapshotsForOwner(ownerId);
  resetAgentConversationMemoryForAccount(ownerId);
  resetConversationRepositoryMemoryForAccount(ownerId);
  resetConversationReadSubmissionForAccount(ownerId);
  resetFriendRepositoryMemoryForAccount(ownerId);
  resetFollowListRepositoryMemoryForAccount(ownerId);
  resetGroupDetailRepositoryMemoryForAccount(ownerId);
  resetChatMoneyMemoryForAccount(ownerId);
  resetShortDramaFeedRepositoryMemoryForAccount(ownerId);
  resetShortDramaHistoryRepositoryMemoryForAccount(ownerId);
  resetShortDramaSeriesRepositoryMemoryForAccount(ownerId);
}

export function isAccountCacheKey(key: string, ownerId: string): boolean {
  const prefix = accountCachePrefixes.find((candidate) => key.startsWith(candidate));
  const owner = ownerId.trim();
  if (!prefix || !owner) return false;
  const tail = key.slice(prefix.length);
  return [owner, encodeURIComponent(owner)].some(
    (candidate) =>
      tail === candidate ||
      tail.startsWith(`${candidate}:`) ||
      tail.startsWith(`${candidate}.`) ||
      tail === `account:${candidate}` ||
      tail.startsWith(`account:${candidate}:`) ||
      tail === `user.${candidate}` ||
      tail.startsWith(`user.${candidate}:`) ||
      tail.startsWith(`user.${candidate}.`) ||
      tail === `.${candidate}` ||
      tail.startsWith(`.${candidate}.`),
  );
}

async function removeAccountStorageKeys(ownerId: string): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const scoped = keys.filter((key) => isAccountCacheKey(key, ownerId));
  if (scoped.length > 0) await AsyncStorage.multiRemove(scoped);
}

async function removeAllAccountStorageKeys(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const businessKeys = keys.filter((key) =>
    accountCachePrefixes.some((prefix) => key.startsWith(prefix)),
  );
  if (businessKeys.length > 0) await AsyncStorage.multiRemove(businessKeys);
}

function deleteDirectoryIfExists(directory: Directory): void {
  try {
    if (directory.exists) directory.delete();
  } catch {
    // Native cache clearing is best-effort and does not surface a settings error.
  }
}

function fallbackFileByteCount(byteCount: number): string {
  const bytes = Math.max(0, Math.trunc(byteCount));
  if (bytes === 0) return "Zero KB";
  if (bytes < 1_000) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  if (bytes < 1_000_000_000) return `${roundedUnit(bytes / 1_000_000)} MB`;
  return `${roundedUnit(bytes / 1_000_000_000)} GB`;
}

function roundedUnit(value: number): string {
  return String(Number(value.toPrecision(3)));
}
