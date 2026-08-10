import AsyncStorage from "@react-native-async-storage/async-storage";
import fs from "node:fs";
import path from "node:path";

import {
  clearAllMediaCache,
  clearMediaCacheForAccount,
  mediaCacheUsageBytes,
} from "@/services/cache/MediaCacheService";
import {
  clearAllAccountData,
  clearCurrentAccountData,
  clearVideoCache,
  formatVideoCacheSize,
  formattedVideoCacheSize,
  isAccountCacheKey,
} from "@/services/cache/AppCacheService";
import { resetAgentConversationMemoryForAccount } from "@/services/agents/AgentConversationResolver";
import { clearImageCache } from "@/services/cache/ImageCacheService";
import { clearUserInfoCache } from "@/services/cache/UserInfoCache";
import { resetConversationReadSubmissionForAccount } from "@/services/conversations/ConversationReadService";
import {
  resetFriendRepositoryMemoryForAccount,
  waitForAllFriendRepositoryPersistence,
  waitForFriendRepositoryPersistenceForAccount,
} from "@/services/friends/FriendRepository";
import { resetFollowListRepositoryMemoryForAccount } from "@/services/friends/FollowListRepository";
import { resetGroupRepositoryForAccount } from "@/services/groups/GroupRepository";
import { resetChatMoneyMemoryForAccount } from "@/services/messages/ChatMoneyRepository";
import { resetShortDramaFeedRepositoryMemoryForAccount } from "@/services/short-drama/ShortDramaFeedRepository";
import { resetShortDramaHistoryRepositoryMemoryForAccount } from "@/services/short-drama/ShortDramaHistoryRepository";
import { resetShortDramaSeriesRepositoryMemoryForAccount } from "@/services/short-drama/ShortDramaSeriesRepository";
import { formatNativeFileByteCount } from "../modules/bwchat-auth-compat/src";

jest.mock("expo-file-system", () => ({
  Directory: class MockDirectory {
    exists = false;
    delete = jest.fn();
  },
  Paths: { cache: "/cache", document: "/document" },
}));

jest.mock("@/services/cache/MediaCacheService", () => ({
  clearAllMediaCache: jest.fn(),
  clearMediaCacheForAccount: jest.fn(),
  mediaCacheUsageBytes: jest.fn(),
  subscribeMediaCacheUsage: jest.fn(() => () => undefined),
}));

jest.mock("@/services/cache/ImageCacheService", () => ({ clearImageCache: jest.fn() }));
jest.mock("@/services/cache/UserInfoCache", () => ({ clearUserInfoCache: jest.fn() }));
jest.mock("@/services/agents/AgentConversationResolver", () => ({
  resetAgentConversationMemoryForAccount: jest.fn(),
}));
jest.mock("@/services/conversations/ConversationReadService", () => ({
  resetConversationReadSubmissionForAccount: jest.fn(),
}));
jest.mock("@/services/friends/FriendRepository", () => ({
  resetFriendRepositoryMemoryForAccount: jest.fn(),
  waitForAllFriendRepositoryPersistence: jest.fn(),
  waitForFriendRepositoryPersistenceForAccount: jest.fn(),
}));
jest.mock("@/services/friends/FollowListRepository", () => ({
  resetFollowListRepositoryMemoryForAccount: jest.fn(),
}));
jest.mock("@/services/groups/GroupRepository", () => ({
  resetGroupRepositoryForAccount: jest.fn(),
}));
jest.mock("@/services/messages/ChatMoneyRepository", () => ({
  resetChatMoneyMemoryForAccount: jest.fn(),
}));
jest.mock("@/services/short-drama/ShortDramaFeedRepository", () => ({
  resetShortDramaFeedRepositoryMemoryForAccount: jest.fn(),
}));
jest.mock("@/services/short-drama/ShortDramaHistoryRepository", () => ({
  resetShortDramaHistoryRepositoryMemoryForAccount: jest.fn(),
}));
jest.mock("@/services/short-drama/ShortDramaSeriesRepository", () => ({
  resetShortDramaSeriesRepositoryMemoryForAccount: jest.fn(),
}));
jest.mock("../modules/bwchat-auth-compat/src", () => ({
  formatNativeFileByteCount: jest.fn(),
}));

const clearAccountMedia = jest.mocked(clearMediaCacheForAccount);
const clearEveryMedia = jest.mocked(clearAllMediaCache);
const getMediaUsage = jest.mocked(mediaCacheUsageBytes);
const nativeFormat = jest.mocked(formatNativeFileByteCount);

describe("native ProfileSettings cache controls", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    clearAccountMedia.mockResolvedValue();
    clearEveryMedia.mockResolvedValue();
    jest.mocked(clearImageCache).mockResolvedValue();
    jest.mocked(clearUserInfoCache).mockResolvedValue();
    jest.mocked(resetGroupRepositoryForAccount).mockResolvedValue();
    jest.mocked(waitForAllFriendRepositoryPersistence).mockResolvedValue();
    jest.mocked(waitForFriendRepositoryPersistenceForAccount).mockResolvedValue();
    nativeFormat.mockReturnValue(null);
  });

  it("recognizes every account-scoped key family without matching another account", () => {
    const owner = "user/1";
    const scoped = [
      "bbchat.activity-center.snapshot.user%2F1",
      "bbchat.activity-center.idempotency.user%2F1.check-in",
      "bbchat.adReward.daily.user/1",
      "bbchat.app.dynamicScreen.v1.user.user/1.home",
      "bbchat.chat-money.claimed-assets.user/1.metadata",
      "bwchat.agent-catalog-v1:account:user/1:overview",
      "bwchat.agent-messages-v1:account:user%2F1:conversation:c1",
      "bwchat.chat-hidden-messages.v1:user%2F1:dm:peer",
      "bwchat.discover-refresh.v1:user%2F1",
      "bwchat.friend-requests-metadata.v1:user%2F1",
      "bwchat.games.recommended.v1:user%2F1",
      "bwchat.gift.catalog.v1:user%2F1",
      "bwchat.profile-agents.v1:user%2F1:target",
      "bwchat.remote-config.v2:user.user/1:zh-Hans",
      "bwchat.short-drama-feed-v1:account:user%2F1:recommended",
      "bwchat.wallet.balance.v2:user/1",
    ];
    for (const key of scoped) expect(isAccountCacheKey(key, owner)).toBe(true);
    expect(isAccountCacheKey("bwchat.wallet.balance.v2:other", owner)).toBe(false);
    expect(isAccountCacheKey("bwchat.update-state.v1", owner)).toBe(false);
    expect(isAccountCacheKey("bwchat.auth.access-token.v1", owner)).toBe(false);
  });

  it("clears only the current account's storage and media cache", async () => {
    const owner = "user/1";
    const ownKeys = [
      "bwchat.wallet.balance.v2:user/1",
      "bwchat.agent-messages-v1:account:user%2F1:conversation:c1",
      "bwchat.profile-agents.v1:user%2F1:target",
      "bwchat.short-drama-feed-v1:account:user%2F1:recommended",
      "bbchat.activity-center.snapshot.user%2F1",
    ];
    const retained = [
      "bwchat.wallet.balance.v2:other",
      "bwchat.auth.access-token.v1",
      "bwchat.update-state.v1",
    ];
    await Promise.all([...ownKeys, ...retained].map((key) => AsyncStorage.setItem(key, "value")));
    const remove = jest.spyOn(AsyncStorage, "multiRemove");

    await clearCurrentAccountData(owner);

    expect(remove).toHaveBeenCalledWith(ownKeys);
    expect(clearAccountMedia).toHaveBeenCalledWith(owner);
    expect(resetAgentConversationMemoryForAccount).toHaveBeenCalledWith(owner);
    expect(resetConversationReadSubmissionForAccount).toHaveBeenCalledWith(owner);
    expect(resetFriendRepositoryMemoryForAccount).toHaveBeenCalledWith(owner);
    expect(waitForFriendRepositoryPersistenceForAccount).toHaveBeenCalledWith(owner);
    expect(
      jest.mocked(waitForFriendRepositoryPersistenceForAccount).mock.invocationCallOrder[0],
    ).toBeLessThan(remove.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
    expect(resetFollowListRepositoryMemoryForAccount).toHaveBeenCalledWith(owner);
    expect(resetGroupRepositoryForAccount).toHaveBeenCalledWith(owner);
    expect(resetChatMoneyMemoryForAccount).toHaveBeenCalledWith(owner);
    expect(resetShortDramaFeedRepositoryMemoryForAccount).toHaveBeenCalledWith(owner);
    expect(resetShortDramaHistoryRepositoryMemoryForAccount).toHaveBeenCalledWith(owner);
    expect(resetShortDramaSeriesRepositoryMemoryForAccount).toHaveBeenCalledWith(owner);
    for (const key of retained) await expect(AsyncStorage.getItem(key)).resolves.toBe("value");
  });

  it("keeps the video-cache action account-scoped and all-data action global", async () => {
    await clearVideoCache("owner");
    expect(clearAccountMedia).toHaveBeenCalledWith("owner");
    expect(clearEveryMedia).not.toHaveBeenCalled();

    await clearAllAccountData("owner");
    expect(waitForAllFriendRepositoryPersistence).toHaveBeenCalledTimes(1);
    expect(clearEveryMedia).toHaveBeenCalledTimes(1);
    expect(clearImageCache).toHaveBeenCalledTimes(1);
    expect(clearUserInfoCache).toHaveBeenCalledTimes(1);
    expect(resetAgentConversationMemoryForAccount).toHaveBeenCalledWith("owner");
    expect(resetShortDramaFeedRepositoryMemoryForAccount).toHaveBeenCalledWith("owner");
    expect(resetShortDramaHistoryRepositoryMemoryForAccount).toHaveBeenCalledWith("owner");
    expect(resetShortDramaSeriesRepositoryMemoryForAccount).toHaveBeenCalledWith("owner");
  });

  it("uses native ByteCountFormatter when available and a decimal file-style fallback", async () => {
    nativeFormat.mockReturnValueOnce("1.5 MB");
    expect(formatVideoCacheSize(1_500_000)).toBe("1.5 MB");
    expect(formatVideoCacheSize(0)).toBe("Zero KB");
    expect(formatVideoCacheSize(500)).toBe("500 bytes");
    expect(formatVideoCacheSize(1_500)).toBe("2 KB");
    expect(formatVideoCacheSize(1_500_000)).toBe("1.5 MB");

    getMediaUsage.mockResolvedValueOnce(12_500_000);
    await expect(formattedVideoCacheSize("owner")).resolves.toBe("12.5 MB");
    expect(getMediaUsage).toHaveBeenCalledWith("owner");
  });

  it("keeps the iOS bridge on the original UserDefaults key and ByteCountFormatter", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "modules/bwchat-auth-compat/ios/BWChatAuthCompatModule.swift"),
      "utf8",
    );
    expect(source).toContain('selectedLanguageKey = "app.language.selection"');
    expect(source).toContain('Function("readLanguageSelection")');
    expect(source).toContain('Function("writeLanguageSelection")');
    expect(source).toContain("ByteCountFormatter.string(fromByteCount:");
    expect(source).toContain("countStyle: .file");
  });
});
