import type {
  ActivityCatFoodTransaction,
  ActivityCatFoodTransactionPage,
  AuthSession,
  AgentActor,
  AgentCapabilities,
  AgentConversation,
  AgentDefinition,
  AgentGreeting,
  AgentMessage,
  AgentMediaUnlock,
  AgentMessagePage,
  AgentMessagePart,
  AgentPartMetadata,
  AgentProfile,
  AgentRuntimeConfig,
  AgentSummary,
  AgentSummaryPage,
  AgentTurn,
  AgentTurnAccepted,
  AgentTurnResult,
  ChatGroup,
  CallConnectionCredentials,
  CallType,
  Contact,
  Conversation,
  ConversationPreference,
  ConversationReadReceipt,
  ConversationSyncSnapshot,
  DirectHistoryClearReceipt,
  FollowRelationship,
  FollowUser,
  FollowUsersPage,
  FriendInfo,
  FriendRequest,
  GroupCapabilities,
  GroupAnnouncement,
  GroupCallStatus,
  GroupDetail,
  GroupHistoryClearReceipt,
  GroupMember,
  GroupNotificationSettings,
  GroupMessage,
  GroupMessageScriptContext,
  GroupMessageSearchPage,
  GroupMessageSearchResult,
  GroupReplyPreview,
  GroupViewerSettings,
  Message,
  Moment,
  MomentAuthor,
  MomentComment,
  MomentFeedPage,
  MomentMedia,
  MomentsNotification,
  MomentsUnreadInfo,
  MomentUnlockResult,
  MixedAssetCharge,
  ProfileHighlight,
  PublicProfile,
  ReplyPreview,
  SearchUser,
  InteractiveScript,
  ScriptCategory,
  ScriptCreator,
  ScriptPage,
  ScriptRole,
  ScriptRoleAssignment,
  ScriptRoom,
  ScriptRoomSnapshot,
  ScriptTurnResponse,
  ScriptTurnState,
  ShortDramaCreator,
  ShortDramaComment,
  ShortDramaCommentsPage,
  ShortDramaEpisodeUploadResult,
  ShortDramaFeedPage,
  ShortDramaInteractionResult,
  ShortDramaPublishStatus,
  ShortDramaSeries,
  ShortDramaSeriesPage,
  ShortDramaUnlockResult,
  ShortDramaVideo,
  User,
  VerifyData,
  WalletAdRewardSession,
  WalletAdRewardStatus,
  WalletBalanceSnapshot,
  WalletIapConfirmation,
  WalletTransaction,
  WalletTransactionPage,
  WalletWithdrawal,
} from "@/models";
import { getActiveLanguageCode, localizedString } from "@/providers/LocalizationProvider";
import { parseGiftMessagePayload } from "@/services/messages/chatGiftPolicy";

type UnknownRecord = Record<string, unknown>;

const foundationWhitespaces =
  /^[\u0009\u0020\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]+|[\u0009\u0020\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]+$/gu;
const foundationWhitespacesAndNewlines =
  /^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000]+$/gu;

/** Matches Foundation `trimmingCharacters(in: .whitespacesAndNewlines)`. */
export function trimFoundationWhitespacesAndNewlines(value: string): string {
  return value.replace(foundationWhitespacesAndNewlines, "");
}

/** Matches Foundation `trimmingCharacters(in: .whitespaces)`. */
export function trimFoundationWhitespaces(value: string): string {
  return value.replace(foundationWhitespaces, "");
}

function createLocalIdentifier(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

function createUppercaseUUID(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function flexString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export function flexInt(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
  }
  return undefined;
}

export function flexDouble(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function nonnegativeInt(...values: unknown[]): number {
  const decoded = flexInt(...values) ?? 0;
  if (decoded < 0) throw new Error("数值不能为负数");
  return decoded;
}

function requiredNonnegativeInt(...values: unknown[]): number {
  const decoded = flexInt(...values);
  if (decoded === undefined) throw new Error("钱包余额缺少必需字段");
  if (decoded < 0) throw new Error("数值不能为负数");
  return decoded;
}

export function flexBool(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLocaleLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off"].includes(normalized)) return false;
    }
  }
  return undefined;
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find(Array.isArray) ?? [];
}

function firstRecord(...values: unknown[]): UnknownRecord | undefined {
  return values.find(isRecord) as UnknownRecord | undefined;
}

const walletLegacyGoldCoinCurrencies = new Set(["gold_coin", "cat_coin", "cat_coins", "cat_food"]);
const walletProductAmounts: Readonly<Record<string, number>> = {
  "com.bwchat.app.catfood.100": 100,
  "com.bwchat.app.catfood.800": 800,
  "com.bwchat.app.catfood.1800": 1_800,
  "com.bwchat.app.catfood.3000": 3_000,
  "com.bwchat.app.catfood.9800": 9_800,
  "com.bwchat.app.catfood.19800": 19_800,
};
const walletGiftPricesById: Readonly<Record<string, number>> = {
  fish_10: 10,
  wand_20: 20,
  yarn_50: 50,
  can_100: 100,
  tree_200: 200,
  bell_500: 500,
};
const walletGiftPricesByName: Readonly<Record<string, number>> = {
  "Dried Fish": 10,
  "Teaser Wand": 20,
  "Yarn Ball": 50,
  "Cat Can": 100,
  "Cat Tree": 200,
  "Golden Bell": 500,
};

function normalizeWalletToken(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll("-", "_");
}

function inferWalletTransactionAmount(
  type: string,
  productId: string | undefined,
  giftId: string | undefined,
  giftName: string | undefined,
): number | undefined {
  const normalizedType = normalizeWalletToken(type);
  if (normalizedType === "ios_iap" && productId) return walletProductAmounts[productId];
  const giftPrice =
    (giftId ? walletGiftPricesById[giftId] : undefined) ??
    (giftName ? walletGiftPricesByName[giftName] : undefined);
  if (giftPrice === undefined) return undefined;
  return normalizedType === "gift_received" ? Math.floor(giftPrice * 0.8) : giftPrice;
}

export function normalizeCallType(...values: unknown[]): CallType | undefined {
  const value = flexString(...values)?.toLocaleLowerCase();
  if (value === "voice" || value === "audio") return "voice";
  return value === "video" ? "video" : undefined;
}

export function normalizeCallConnectionCredentials(
  value: unknown,
  fallbackLiveKitUrl = "http://52.193.78.191/livekit",
): CallConnectionCredentials {
  if (!isRecord(value)) throw new Error("通话连接响应格式无效");
  const roomName = flexString(value.room_name, value.roomName, value.room);
  const token = flexString(value.token, value.livekit_token, value.livekitToken);
  if (!roomName || !token) throw new Error("通话连接响应缺少房间或令牌");
  const callId = flexString(value.call_id, value.callID);
  const callType = normalizeCallType(value.call_type, value.callType, value.media_type);
  const participantCount = flexInt(value.participant_count, value.participantCount);
  return {
    ...(callId ? { call_id: callId } : {}),
    room_name: roomName,
    token,
    livekit_url:
      flexString(value.livekit_url, value.livekitUrl, value.server_url, value.serverUrl) ??
      fallbackLiveKitUrl,
    ...(callType ? { call_type: callType } : {}),
    ...(participantCount !== undefined ? { participant_count: Math.max(participantCount, 0) } : {}),
  };
}

export function normalizeGroupCallStatus(value: unknown): GroupCallStatus {
  if (!isRecord(value) || typeof value.active !== "boolean") {
    throw new Error("群通话状态响应格式无效");
  }
  for (const key of ["call_id", "room_name", "call_type"] as const) {
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== "string") {
      throw new Error("群通话状态响应格式无效");
    }
  }
  if (
    value.participant_count !== undefined &&
    value.participant_count !== null &&
    (typeof value.participant_count !== "number" || !Number.isInteger(value.participant_count))
  ) {
    throw new Error("群通话状态响应格式无效");
  }
  return {
    active: value.active,
    ...(typeof value.call_id === "string" ? { call_id: value.call_id } : {}),
    ...(typeof value.room_name === "string" ? { room_name: value.room_name } : {}),
    ...(typeof value.call_type === "string" ? { call_type: value.call_type } : {}),
    ...(typeof value.participant_count === "number"
      ? { participant_count: value.participant_count }
      : {}),
  };
}

export function normalizeUser(value: unknown): User {
  if (!isRecord(value)) throw new Error("用户数据格式无效");
  return {
    user_id: flexString(value.user_id, value.userID, value.id) ?? "",
    username: flexString(value.username) ?? "",
    nickname: flexString(value.nickname) ?? "用户",
    avatar_url: flexString(value.avatar_url, value.avatarURL, value.avatar) ?? "",
    bio: flexString(value.bio) ?? "",
    gender: flexString(value.gender) ?? "",
    birthday: flexString(value.birthday) ?? "",
    location: flexString(value.location) ?? "",
    following_count: flexInt(value.following_count, value.followingCount) ?? 0,
    follower_count: flexInt(value.follower_count, value.followerCount) ?? 0,
    ...(flexInt(value.posts_count, value.postsCount) !== undefined
      ? { posts_count: flexInt(value.posts_count, value.postsCount) }
      : {}),
    ...(flexInt(value.moments_count, value.momentsCount) !== undefined
      ? { moments_count: flexInt(value.moments_count, value.momentsCount) }
      : {}),
    followed_by_me: flexBool(value.followed_by_me, value.followedByMe) ?? false,
    follows_me: flexBool(value.follows_me, value.followsMe) ?? false,
    is_friend: flexBool(value.is_friend, value.isFriend) ?? false,
  };
}

export function normalizeAuthSession(value: unknown): AuthSession {
  if (!isRecord(value)) throw new Error("登录响应格式无效");
  if (typeof value.token !== "string" || typeof value.refresh_token !== "string") {
    throw new Error("登录响应缺少令牌");
  }
  const token = normalizeToken(value.token);
  const refreshToken = normalizeToken(value.refresh_token);
  if (!token || !refreshToken) throw new Error("登录响应缺少令牌");
  return { token, refresh_token: refreshToken, user: normalizeNativeUser(value.user) };
}

export function normalizeVerifyData(value: unknown): VerifyData {
  if (!isRecord(value)) throw new Error("会话验证响应格式无效");
  return { user: normalizeNativeUser(value.user) };
}

export function normalizeToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = trimFoundationWhitespacesAndNewlines(value);
  const withoutScheme = trimmed.toLowerCase().startsWith("bearer ")
    ? trimFoundationWhitespacesAndNewlines(trimmed.slice(7))
    : trimmed;
  return withoutScheme.length > 0 ? withoutScheme : null;
}

export function normalizeNativeUser(value: unknown): User {
  if (!isRecord(value)) throw new Error("用户数据格式无效");
  return {
    user_id: nativeFlexString(value.user_id) ?? "",
    username: nativeFlexString(value.username) ?? "",
    nickname:
      nativeFlexString(value.nickname) ??
      localizedString(getActiveLanguageCode(), "profile.defaultUser"),
    avatar_url: nativeFlexString(value.avatar_url) ?? "",
    bio: nativeOptionalString(value, "bio"),
    gender: nativeOptionalString(value, "gender"),
    birthday: nativeOptionalString(value, "birthday"),
    location: nativeOptionalString(value, "location"),
    following_count: nativeFlexInt(value.following_count) ?? 0,
    follower_count: nativeFlexInt(value.follower_count) ?? 0,
    ...(nativeFlexInt(value.posts_count) !== undefined
      ? { posts_count: nativeFlexInt(value.posts_count) }
      : {}),
    ...(nativeFlexInt(value.moments_count) !== undefined
      ? { moments_count: nativeFlexInt(value.moments_count) }
      : {}),
    followed_by_me: nativeFlexBool(value.followed_by_me) ?? false,
    follows_me: nativeFlexBool(value.follows_me) ?? false,
    is_friend: nativeFlexBool(value.is_friend) ?? false,
  };
}

function nativeFlexString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return String(value);
}

function nativeFlexInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return undefined;
  const normalized = trimFoundationWhitespacesAndNewlines(value).replaceAll(",", "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function nativeFlexBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isInteger(value)) return value !== 0;
  if (typeof value !== "string") return undefined;
  switch (value.toLowerCase()) {
    case "true":
    case "1":
    case "yes":
      return true;
    case "false":
    case "0":
    case "no":
      return false;
    default:
      return undefined;
  }
}

function nativeOptionalString(value: UnknownRecord, key: string): string {
  const candidate = value[key];
  if (candidate === undefined || candidate === null) return "";
  if (typeof candidate === "string") return candidate;
  throw new Error(`用户字段 ${key} 类型无效`);
}

export function normalizeContact(value: unknown): Contact {
  if (!isRecord(value)) throw new Error("联系人数据格式无效");
  return {
    user_id: flexString(value.user_id, value.userID, value.id) ?? "",
    nickname: flexString(value.nickname, value.name) ?? "用户",
    avatar_url: flexString(value.avatar_url, value.avatarURL, value.avatar) ?? "",
    ...(flexString(value.last_message, value.lastMessage) !== undefined
      ? { last_message: flexString(value.last_message, value.lastMessage) }
      : {}),
    ...(flexString(value.last_message_time, value.lastMessageTime) !== undefined
      ? { last_message_time: flexString(value.last_message_time, value.lastMessageTime) }
      : {}),
    unread_count: flexInt(value.unread_count, value.unread, value.unreadCount) ?? 0,
  };
}

export function normalizeFriendInfo(value: unknown): FriendInfo {
  if (!isRecord(value)) throw new Error("好友数据格式无效");
  return {
    user_id: flexString(value.user_id, value.userID, value.id) ?? "",
    nickname: flexString(value.nickname, value.name) ?? "BBchat 用户",
    avatar_url: flexString(value.avatar_url, value.avatarURL, value.avatar) ?? "",
    added_at: flexString(value.added_at, value.addedAt) ?? "",
  };
}

export function normalizeRequiredFriendInfo(value: unknown): FriendInfo {
  if (
    !isRecord(value) ||
    typeof value.user_id !== "string" ||
    typeof value.nickname !== "string" ||
    typeof value.avatar_url !== "string" ||
    typeof value.added_at !== "string"
  ) {
    throw new Error("好友数据格式无效");
  }
  return {
    user_id: value.user_id,
    nickname: value.nickname,
    avatar_url: value.avatar_url,
    added_at: value.added_at,
  };
}

export function normalizeFriendRequest(value: unknown): FriendRequest {
  if (!isRecord(value)) throw new Error("好友请求数据格式无效");
  return {
    request_id: flexInt(value.request_id, value.requestID, value.id) ?? 0,
    user_id: flexString(value.user_id, value.userID) ?? "",
    nickname: flexString(value.nickname, value.name) ?? "BBchat 用户",
    avatar_url: flexString(value.avatar_url, value.avatarURL, value.avatar) ?? "",
    created_at: flexString(value.created_at, value.createdAt) ?? "",
  };
}

export function normalizeRequiredFriendRequest(value: unknown): FriendRequest {
  if (
    !isRecord(value) ||
    typeof value.request_id !== "number" ||
    !Number.isInteger(value.request_id) ||
    typeof value.user_id !== "string" ||
    typeof value.nickname !== "string" ||
    typeof value.avatar_url !== "string" ||
    typeof value.created_at !== "string"
  ) {
    throw new Error("好友请求数据格式无效");
  }
  return {
    request_id: value.request_id,
    user_id: value.user_id,
    nickname: value.nickname,
    avatar_url: value.avatar_url,
    created_at: value.created_at,
  };
}

export function normalizeSearchUser(value: unknown): SearchUser {
  if (!isRecord(value)) throw new Error("用户搜索结果格式无效");
  const user = isRecord(value.user) ? value.user : value;
  return {
    user_id:
      flexString(user.user_id, user.userID, user.id, user.user_uuid, user.uuid, user.uid) ?? "",
    nickname: flexString(user.nickname, user.name) ?? "BBchat 用户",
    avatar_url: flexString(user.avatar_url, user.avatarURL, user.avatar) ?? "",
    relation: flexString(value.relation, user.relation) ?? "none",
    followed_by_me:
      flexBool(value.followed_by_me, value.followedByMe, user.followed_by_me, user.followedByMe) ??
      false,
    follow_requested:
      flexBool(
        value.follow_requested,
        value.followRequested,
        value.request_pending,
        value.requestPending,
        user.follow_requested,
        user.followRequested,
        user.request_pending,
        user.requestPending,
      ) ?? false,
  };
}

export function normalizeFollowRelationship(
  value: unknown,
  fallbackUserId: string,
  fallbackFollowedByMe: boolean,
): FollowRelationship {
  if (!isRecord(value)) {
    return {
      user_id: fallbackUserId,
      followed_by_me: fallbackFollowedByMe,
      follows_me: false,
      is_friend: false,
    };
  }
  const nested = value.relationship ?? value.relation;
  if (isRecord(nested)) {
    return normalizeFollowRelationship(nested, fallbackUserId, fallbackFollowedByMe);
  }
  return {
    user_id: flexString(value.user_id, value.userID, value.id) ?? fallbackUserId,
    followed_by_me: flexBool(value.followed_by_me, value.followedByMe) ?? fallbackFollowedByMe,
    follows_me: flexBool(value.follows_me, value.followsMe) ?? false,
    is_friend: flexBool(value.is_friend, value.isFriend) ?? false,
    ...(flexBool(
      value.follow_requested,
      value.followRequested,
      value.request_pending,
      value.requestPending,
    ) !== undefined
      ? {
          follow_requested: flexBool(
            value.follow_requested,
            value.followRequested,
            value.request_pending,
            value.requestPending,
          ),
        }
      : {}),
    ...(flexInt(value.following_count, value.followingCount) !== undefined
      ? { following_count: flexInt(value.following_count, value.followingCount) }
      : {}),
    ...(flexInt(value.follower_count, value.followerCount) !== undefined
      ? { follower_count: flexInt(value.follower_count, value.followerCount) }
      : {}),
  };
}

export function normalizeFollowUser(value: unknown): FollowUser {
  if (!isRecord(value)) throw new Error("关注用户数据格式无效");
  if (isRecord(value.profile)) return normalizeFollowUser(value.profile);
  if (isRecord(value.user)) return normalizeFollowUser(value.user);
  return {
    user_id: flexString(value.user_id, value.userID, value.id) ?? "",
    username: flexString(value.username) ?? "",
    nickname:
      flexString(value.nickname, value.name) ??
      localizedString(getActiveLanguageCode(), "profile.defaultUser"),
    avatar_url: flexString(value.avatar_url, value.avatarURL, value.avatar) ?? "",
    bio: flexString(value.bio) ?? "",
    following_count: flexInt(value.following_count, value.followingCount) ?? 0,
    follower_count: flexInt(value.follower_count, value.followerCount) ?? 0,
    followed_by_me: flexBool(value.followed_by_me, value.followedByMe) ?? false,
    follows_me: flexBool(value.follows_me, value.followsMe) ?? false,
    is_friend: flexBool(value.is_friend, value.isFriend) ?? false,
  };
}

export function normalizeFollowUsersPage(value: unknown): FollowUsersPage {
  if (Array.isArray(value)) {
    return {
      users: normalizeFollowUserArray(value),
      has_more: false,
    };
  }
  if (!isRecord(value)) throw new Error("关注用户列表格式无效");
  const candidates = [value.users, value.following, value.followers, value.items, value.list];
  let users: FollowUser[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    try {
      users = normalizeFollowUserArray(candidate);
      break;
    } catch {
      // Swift tries the next keyed list alias when one complete array fails to decode.
    }
  }
  const page = flexInt(value.page);
  const nextPage = flexInt(value.next_page, value.nextPage);
  const total = flexInt(value.total);
  const explicitHasMore = flexBool(value.has_more, value.hasMore);
  const hasMore =
    explicitHasMore ??
    (nextPage !== undefined ? true : total !== undefined ? users.length < total : false);
  return {
    users,
    has_more: hasMore,
    ...(nextPage !== undefined
      ? { next_page: nextPage }
      : hasMore && page !== undefined
        ? { next_page: page + 1 }
        : {}),
  };
}

function normalizeFollowUserArray(value: readonly unknown[]): FollowUser[] {
  return value.map(normalizeFollowUser).filter((user) => user.user_id.length > 0);
}

export function normalizeProfileHighlight(value: unknown): ProfileHighlight {
  if (!isRecord(value)) throw new Error("精选动态数据格式无效");
  const title = flexString(value.title, value.name) ?? "";
  return {
    id: flexString(value.id, value.highlight_id, title) ?? "",
    title,
    cover_url: flexString(value.cover_url, value.coverURL) ?? "",
    ...(flexInt(value.item_count, value.itemCount) !== undefined
      ? { item_count: flexInt(value.item_count, value.itemCount) }
      : {}),
  };
}

function normalizePublicProfileArray<T>(value: unknown, normalize: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) return [];
  try {
    return value.map(normalize);
  } catch {
    return [];
  }
}

export function normalizePublicProfile(value: unknown): PublicProfile {
  if (!isRecord(value)) throw new Error("公开资料数据格式无效");
  if (isRecord(value.profile)) {
    try {
      return normalizePublicProfile(value.profile);
    } catch {
      // The native decoder continues with `user`, then the top-level payload.
    }
  }
  if (isRecord(value.user)) {
    try {
      return normalizePublicProfile(value.user);
    } catch {
      // The native decoder treats a malformed nested user as a recoverable wrapper mismatch.
    }
  }
  const rawMutualFollowers = value.mutual_followers ?? value.mutualFollowers;
  const mutualFollowers = normalizePublicProfileArray(
    rawMutualFollowers,
    normalizeFollowUser,
  ).filter((user) => user.user_id.length > 0);
  const highlights = normalizePublicProfileArray(value.highlights, normalizeProfileHighlight);
  return {
    user_id: flexString(value.user_id, value.userID, value.id) ?? "",
    username: flexString(value.username) ?? "",
    nickname:
      flexString(value.nickname, value.name) ??
      localizedString(getActiveLanguageCode(), "profile.defaultUser"),
    avatar_url: flexString(value.avatar_url, value.avatarURL, value.avatar) ?? "",
    bio: flexString(value.bio) ?? "",
    gender: flexString(value.gender) ?? "",
    birthday: flexString(value.birthday) ?? "",
    location: flexString(value.location) ?? "",
    following_count: flexInt(value.following_count, value.followingCount) ?? 0,
    follower_count: flexInt(value.follower_count, value.followerCount) ?? 0,
    followed_by_me: flexBool(value.followed_by_me, value.followedByMe) ?? false,
    follows_me: flexBool(value.follows_me, value.followsMe) ?? false,
    is_friend: flexBool(value.is_friend, value.isFriend) ?? false,
    follow_requested:
      flexBool(
        value.follow_requested,
        value.followRequested,
        value.request_pending,
        value.requestPending,
      ) ?? false,
    ...(flexInt(value.posts_count, value.postsCount) !== undefined
      ? { posts_count: flexInt(value.posts_count, value.postsCount) }
      : {}),
    ...(flexInt(value.moments_count, value.momentsCount) !== undefined
      ? { moments_count: flexInt(value.moments_count, value.momentsCount) }
      : {}),
    ...optionalPublicProfileString("website_url", value.website_url, value.websiteURL),
    ...optionalPublicProfileString(
      "contact_email",
      value.contact_email,
      value.contactEmail,
      value.business_email,
      value.businessEmail,
    ),
    ...optionalPublicProfileString("contact_url", value.contact_url, value.contactURL),
    is_verified: flexBool(value.is_verified, value.isVerified) ?? false,
    category: flexString(value.category) ?? "",
    pronouns: flexString(value.pronouns) ?? "",
    is_private: flexBool(value.is_private, value.isPrivate) ?? false,
    can_view_moments: flexBool(value.can_view_moments, value.canViewMoments) ?? true,
    can_message: flexBool(value.can_message, value.canMessage) ?? true,
    ...(flexInt(value.mutual_followers_count, value.mutualFollowersCount) !== undefined
      ? {
          mutual_followers_count: flexInt(value.mutual_followers_count, value.mutualFollowersCount),
        }
      : {}),
    mutual_followers: mutualFollowers,
    highlights,
    ...optionalPublicProfileString(
      "account_created_at",
      value.account_created_at,
      value.accountCreatedAt,
    ),
  };
}

export function normalizeMomentAuthor(value: unknown): MomentAuthor {
  if (!isRecord(value)) throw new Error("朋友圈作者数据格式无效");
  return {
    user_id: flexString(value.user_id, value.userID, value.id) ?? "",
    nickname: flexString(value.nickname, value.name) ?? "用户",
    avatar_url: flexString(value.avatar_url, value.avatarURL, value.avatar) ?? "",
  };
}

export function normalizeMomentComment(value: unknown): MomentComment {
  if (!isRecord(value)) throw new Error("朋友圈评论数据格式无效");
  const reply = isRecord(value.reply_to ?? value.replyTo)
    ? normalizeMomentAuthor(value.reply_to ?? value.replyTo)
    : undefined;
  const createdAt = flexString(value.created_at, value.createdAt);
  const imageUrl = flexString(value.image_url, value.imageURL);
  return {
    id: flexInt(value.id, value.comment_id, value.commentID) ?? 0,
    content: flexString(value.content, value.text) ?? "",
    user_id: flexString(value.user_id, value.userID) ?? "",
    nickname: flexString(value.nickname, value.name) ?? "用户",
    avatar_url: flexString(value.avatar_url, value.avatarURL, value.avatar) ?? "",
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(reply ? { reply_to: reply } : {}),
    ...(imageUrl !== undefined ? { image_url: imageUrl } : {}),
  };
}

export function normalizeMomentMedia(value: unknown, fallbackId = "media"): MomentMedia {
  if (!isRecord(value)) throw new Error("朋友圈媒体数据格式无效");
  const url = flexString(value.url, value.media_url, value.mediaURL) ?? "";
  const thumbnail = flexString(value.thumbnail_url, value.thumbnailURL);
  const lockedPreview = flexString(value.locked_preview_url, value.lockedPreviewURL);
  const rawType = flexString(value.type, value.media_type, value.mediaType)?.toLocaleLowerCase();
  return {
    id:
      flexString(value.id, value.media_id, value.mediaID) ??
      (url || lockedPreview || thumbnail || fallbackId),
    type: rawType === "video" ? "video" : "image",
    url,
    ...(thumbnail !== undefined ? { thumbnail_url: thumbnail } : {}),
    ...(lockedPreview !== undefined ? { locked_preview_url: lockedPreview } : {}),
    is_locked: flexBool(value.is_locked, value.isLocked) ?? false,
  };
}

export function normalizeMoment(value: unknown): Moment {
  if (!isRecord(value) || !isRecord(value.author)) {
    throw new Error("朋友圈动态数据格式无效");
  }
  const rawImages = Array.isArray(value.images) ? value.images : [];
  const images = rawImages.flatMap((item) => {
    const url = flexString(item);
    return url === undefined ? [] : [url];
  });
  const rawMedia = Array.isArray(value.media) ? value.media : [];
  const media =
    rawMedia.length > 0
      ? rawMedia.map((item, index) => normalizeMomentMedia(item, `media-${index}`))
      : images.map((url, index) =>
          normalizeMomentMedia({ id: `image-${index}-${url}`, type: "image", url }),
        );
  const resolvedImages =
    images.length > 0
      ? images
      : media.filter((item) => item.type === "image" && item.url).map((item) => item.url);
  const decodedPrice = flexInt(value.unlock_price_gold_coins, value.unlockPriceGoldCoins);
  const unlockPrice = decodedPrice !== undefined && decodedPrice > 0 ? decodedPrice : undefined;
  const decodedUnlocked = flexBool(value.is_unlocked, value.isUnlocked);
  const location = flexString(value.location_name, value.locationName);
  const clientRequestId = flexString(value.client_request_id, value.clientRequestId);
  return {
    id: flexInt(value.id, value.moment_id, value.momentID) ?? 0,
    author: normalizeMomentAuthor(value.author),
    content: flexString(value.content, value.text) ?? "",
    images: resolvedImages,
    media,
    ...(unlockPrice !== undefined ? { unlock_price_gold_coins: unlockPrice } : {}),
    is_unlocked:
      decodedUnlocked ??
      (unlockPrice === undefined ? !media.some((item) => item.is_locked) : false),
    ...(location !== undefined ? { location_name: location } : {}),
    created_at: flexString(value.created_at, value.createdAt) ?? "",
    likes: Array.isArray(value.likes)
      ? value.likes.map(normalizeMomentAuthor).filter((author) => author.user_id.length > 0)
      : [],
    comments: Array.isArray(value.comments)
      ? value.comments.map(normalizeMomentComment).filter((comment) => comment.id > 0)
      : [],
    liked_by_me: flexBool(value.liked_by_me, value.likedByMe) ?? false,
    ...(clientRequestId !== undefined ? { client_request_id: clientRequestId } : {}),
  };
}

export function normalizeMomentFeedPage(value: unknown): MomentFeedPage {
  if (!isRecord(value) || !Array.isArray(value.moments)) {
    throw new Error("朋友圈列表响应格式无效");
  }
  const snapshotComplete = flexBool(
    value.snapshot_complete,
    value.snapshotComplete,
    value.is_complete,
    value.isComplete,
  );
  return {
    moments: value.moments.map(normalizeMoment).filter((moment) => moment.id > 0),
    has_more: flexBool(value.has_more, value.hasMore) ?? false,
    ...(snapshotComplete !== undefined ? { snapshot_complete: snapshotComplete } : {}),
  };
}

export function normalizeMomentsUnreadInfo(value: unknown): MomentsUnreadInfo {
  if (!isRecord(value)) throw new Error("朋友圈未读信息格式无效");
  return {
    unread_count: Math.max(0, flexInt(value.unread_count, value.unreadCount) ?? 0),
    has_new_moments: flexBool(value.has_new_moments, value.hasNewMoments) ?? false,
  };
}

export function normalizeMomentsNotification(value: unknown): MomentsNotification {
  if (!isRecord(value) || !isRecord(value.user)) {
    throw new Error("朋友圈通知数据格式无效");
  }
  const rawImages = Array.isArray(value.moment_images)
    ? value.moment_images
    : Array.isArray(value.momentImages)
      ? value.momentImages
      : undefined;
  const images = rawImages
    ?.map((item) => flexString(item))
    .filter((item): item is string => item !== undefined);
  const content = flexString(value.content);
  const momentContent = flexString(value.moment_content, value.momentContent);
  return {
    type: flexString(value.type) ?? "",
    id: flexString(value.id, value.notification_id, value.notificationID) ?? "",
    moment_id: flexInt(value.moment_id, value.momentID) ?? 0,
    user_id: flexString(value.user_id, value.userID) ?? "",
    ...(content !== undefined ? { content } : {}),
    ...(momentContent !== undefined ? { moment_content: momentContent } : {}),
    ...(images !== undefined ? { moment_images: images } : {}),
    created_at: flexString(value.created_at, value.createdAt) ?? "",
    user: normalizeMomentAuthor(value.user),
  };
}

export function normalizeMomentsNotifications(value: unknown): MomentsNotification[] {
  if (!isRecord(value) || !Array.isArray(value.notifications)) {
    throw new Error("朋友圈通知列表格式无效");
  }
  return value.notifications
    .map(normalizeMomentsNotification)
    .filter((item) => item.id.length > 0 && item.moment_id > 0);
}

export function normalizeWalletBalanceSnapshot(value: unknown): WalletBalanceSnapshot {
  if (!isRecord(value)) throw new Error("钱包余额响应格式无效");
  const currency = normalizeWalletToken(flexString(value.currency) ?? "");
  if (currency !== "gold_coin") throw new Error("钱包余额币种必须是 gold_coin");
  return {
    currency,
    gold_coin_balance: requiredNonnegativeInt(value.gold_coin_balance, value.goldCoinBalance),
    activity_cat_food_balance: requiredNonnegativeInt(
      value.activity_cat_food_balance,
      value.activityCatFoodBalance,
    ),
    spendable_balance: requiredNonnegativeInt(value.spendable_balance, value.spendableBalance),
    recharge_gold_coin_balance: requiredNonnegativeInt(
      value.recharge_gold_coin_balance,
      value.rechargeGoldCoinBalance,
    ),
    gift_income_gold_coin_balance: requiredNonnegativeInt(
      value.gift_income_gold_coin_balance,
      value.giftIncomeGoldCoinBalance,
    ),
    withdraw_frozen_gold_coin_balance: requiredNonnegativeInt(
      value.withdraw_frozen_gold_coin_balance,
      value.withdrawFrozenGoldCoinBalance,
    ),
    withdrawable_gold_coin_balance: requiredNonnegativeInt(
      value.withdrawable_gold_coin_balance,
      value.withdrawableGoldCoinBalance,
    ),
    chat_money_frozen_gold_coin_balance: requiredNonnegativeInt(
      value.chat_money_frozen_gold_coin_balance,
      value.chatMoneyFrozenGoldCoinBalance,
    ),
  };
}

export function normalizeWalletTransaction(value: unknown): WalletTransaction {
  if (!isRecord(value)) throw new Error("钱包交易数据格式无效");
  const rawCurrency = flexString(value.currency, value.receiver_currency);
  if (
    rawCurrency !== undefined &&
    !walletLegacyGoldCoinCurrencies.has(normalizeWalletToken(rawCurrency))
  ) {
    throw new Error("钱包交易币种必须是 gold_coin");
  }
  const type = flexString(value.type) ?? "";
  const giftId = flexString(value.gift_id, value.giftId);
  const giftName = flexString(value.gift_name, value.giftName);
  const productId = flexString(value.product_id, value.productId, value.iap_product_id, value.sku);
  const decodedAmount = flexInt(
    value.gold_coin_amount,
    value.goldCoinAmount,
    value.gold_coin_delta,
    value.amount,
    value.delta,
    value.total_amount,
    value.cat_coin_amount,
    value.cat_coin,
    value.cat_coins,
    value.cat_food_amount,
    value.cat_food,
    value.coin_amount,
    value.coins,
  );
  const inferredAmount = inferWalletTransactionAmount(type, productId, giftId, giftName);
  const amount =
    decodedAmount !== undefined && decodedAmount !== 0 ? decodedAmount : inferredAmount;
  return {
    id: flexString(value.id, value.transaction_id) ?? createLocalIdentifier("wallet-transaction"),
    type,
    currency: "gold_coin",
    ...(amount !== undefined ? { gold_coin_amount: amount } : {}),
    ...(flexInt(value.gold_coin_balance_after, value.balance_after) !== undefined
      ? { gold_coin_balance_after: flexInt(value.gold_coin_balance_after, value.balance_after) }
      : {}),
    ...(flexString(value.title) ? { title: flexString(value.title) } : {}),
    ...(flexString(value.note, value.description)
      ? { note: flexString(value.note, value.description) }
      : {}),
    ...(giftId ? { gift_id: giftId } : {}),
    ...(giftName ? { gift_name: giftName } : {}),
    ...(productId ? { product_id: productId } : {}),
    ...(flexString(value.created_at, value.createdAt, value.timestamp)
      ? { created_at: flexString(value.created_at, value.createdAt, value.timestamp) }
      : {}),
  };
}

export function normalizeWalletTransactionPage(value: unknown): WalletTransactionPage {
  const source = Array.isArray(value)
    ? value
    : isRecord(value)
      ? firstArray(value.transactions, value.items, value.records, value.list, value.rows)
      : [];
  const transactions = source.flatMap((item) => {
    try {
      return [normalizeWalletTransaction(item)];
    } catch {
      return [];
    }
  });
  const nextCursor = isRecord(value) ? flexString(value.next_cursor, value.nextCursor) : undefined;
  return {
    transactions,
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
  };
}

export function normalizeActivityCatFoodTransaction(value: unknown): ActivityCatFoodTransaction {
  if (!isRecord(value)) throw new Error("猫粮流水数据格式无效");
  const source = flexString(value.source);
  const title = flexString(value.title);
  const createdAt = flexString(value.created_at, value.createdAt);
  return {
    id:
      flexString(value.id, value.transaction_id, value.transactionId) ??
      createLocalIdentifier("activity-cat-food-transaction"),
    delta: flexInt(value.delta) ?? 0,
    balance_after: flexInt(value.balance_after, value.balanceAfter) ?? 0,
    ...(source ? { source } : {}),
    ...(title ? { title } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}

export function normalizeActivityCatFoodTransactionPage(
  value: unknown,
): ActivityCatFoodTransactionPage {
  const source = isRecord(value) && isRecord(value.data) ? value.data : value;
  const rows = Array.isArray(source)
    ? source
    : isRecord(source)
      ? firstArray(source.items, source.transactions)
      : [];
  const items = rows.flatMap((item) => {
    try {
      return [normalizeActivityCatFoodTransaction(item)];
    } catch {
      return [];
    }
  });
  const nextCursor = isRecord(source)
    ? flexString(source.next_cursor, source.nextCursor)
    : undefined;
  return {
    items,
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
  };
}

export function normalizeWalletWithdrawal(value: unknown): WalletWithdrawal {
  if (!isRecord(value)) throw new Error("提现数据格式无效");
  if (flexString(value.currency) !== "gold_coin") throw new Error("提现币种必须是 gold_coin");
  const payoutUsd = flexDouble(value.payout_usd, value.payoutUSD);
  const payoutCents = flexInt(value.payout_cents, value.payoutCents);
  const canCancel = flexBool(value.can_cancel, value.canCancel);
  const optional = (key: keyof WalletWithdrawal, ...candidates: unknown[]) => {
    const decoded = flexString(...candidates);
    return decoded === undefined ? {} : { [key]: decoded };
  };
  return {
    id:
      flexString(value.id, value.withdrawal_id, value.withdrawalId) ??
      createLocalIdentifier("wallet-withdrawal"),
    currency: "gold_coin",
    gold_coin_amount: flexInt(value.gold_coin_amount, value.goldCoinAmount) ?? 0,
    ...(payoutUsd !== undefined ? { payout_usd: payoutUsd } : {}),
    ...(payoutCents !== undefined ? { payout_cents: payoutCents } : {}),
    ...optional("provider", value.provider),
    ...optional("payout_method", value.payout_method, value.payoutMethod),
    ...optional("payout_account", value.payout_account, value.payoutAccount),
    ...optional("network", value.network, value.chain),
    ...optional(
      "wallet_address",
      value.wallet_address,
      value.walletAddress,
      value.usdt_address,
      value.usdtAddress,
    ),
    status: flexString(value.status) ?? "pending",
    ...(canCancel !== undefined ? { can_cancel: canCancel } : {}),
    ...optional("note", value.note, value.remark, value.reason),
    ...optional("created_at", value.created_at, value.createdAt),
    ...optional("updated_at", value.updated_at, value.updatedAt),
  };
}

export function normalizeWalletWithdrawals(value: unknown): WalletWithdrawal[] {
  const source = Array.isArray(value)
    ? value
    : isRecord(value)
      ? firstArray(value.withdrawals, value.items, value.records, value.list, value.rows)
      : [];
  return source.flatMap((item) => {
    try {
      return [normalizeWalletWithdrawal(item)];
    } catch {
      return [];
    }
  });
}

export function normalizeWalletAdRewardStatus(value: unknown): WalletAdRewardStatus {
  if (!isRecord(value)) throw new Error("广告奖励状态格式无效");
  const dailyLimit = nonnegativeInt(value.daily_limit, value.dailyLimit);
  return {
    enabled: flexBool(value.enabled) ?? false,
    daily_limit: dailyLimit,
    watched_count: Math.min(nonnegativeInt(value.watched_count, value.watchedCount), dailyLimit),
    remaining_count: Math.min(
      nonnegativeInt(value.remaining_count, value.remainingCount),
      dailyLimit,
    ),
    next_reset_at: flexString(value.next_reset_at, value.nextResetAt) ?? "",
  };
}

export function normalizeWalletAdRewardSession(value: unknown): WalletAdRewardSession {
  if (!isRecord(value)) throw new Error("广告奖励会话格式无效");
  const sessionId = flexString(value.session_id, value.sessionId);
  const customData = flexString(value.ssv_custom_data, value.ssvCustomData);
  if (!sessionId || !customData) throw new Error("广告奖励会话缺少 SSV 数据");
  const expiresAt = flexString(value.expires_at, value.expiresAt);
  return {
    session_id: sessionId,
    ssv_custom_data: customData,
    remaining_count: nonnegativeInt(value.remaining_count, value.remainingCount),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    next_reset_at: flexString(value.next_reset_at, value.nextResetAt) ?? "",
  };
}

export function normalizeWalletIapConfirmation(value: unknown): WalletIapConfirmation {
  if (!isRecord(value)) throw new Error("内购确认响应格式无效");
  const balanceValue = firstRecord(
    value.balance,
    value.balance_data,
    value.balanceData,
    value.wallet,
    value.wallet_balance,
    value.walletBalance,
  );
  const transactionValue = firstRecord(
    value.transaction,
    value.wallet_transaction,
    value.walletTransaction,
  );
  const amount = flexInt(value.gold_coin_amount, value.goldCoinAmount, value.amount);
  return {
    ...(balanceValue ? { balance: normalizeWalletBalanceSnapshot(balanceValue) } : {}),
    ...(amount !== undefined ? { gold_coin_amount: amount } : {}),
    ...(transactionValue ? { transaction: normalizeWalletTransaction(transactionValue) } : {}),
  };
}

export function normalizeMixedAssetCharge(value: unknown): MixedAssetCharge {
  if (!isRecord(value)) throw new Error("混合资产扣款响应格式无效");
  const chargedActivityCatFood = nonnegativeInt(
    value.charged_activity_cat_food,
    value.chargedActivityCatFood,
  );
  const chargedGoldCoins = nonnegativeInt(value.charged_gold_coins, value.chargedGoldCoins);
  const totalCharged = nonnegativeInt(value.total_charged, value.totalCharged);
  if (totalCharged !== chargedActivityCatFood + chargedGoldCoins) {
    throw new Error("混合资产扣款总额不一致");
  }
  return {
    charged_activity_cat_food: chargedActivityCatFood,
    charged_gold_coins: chargedGoldCoins,
    total_charged: totalCharged,
    wallet_balance: normalizeWalletBalanceSnapshot(value.wallet_balance ?? value.walletBalance),
  };
}

export function normalizeMomentUnlockResult(value: unknown): MomentUnlockResult {
  if (!isRecord(value)) throw new Error("朋友圈解锁响应格式无效");
  if (isRecord(value.author)) {
    return { moment: normalizeMoment(value), already_unlocked: false };
  }
  const moment = isRecord(value.moment) ? normalizeMoment(value.moment) : undefined;
  const hasCharge = [
    value.charged_activity_cat_food,
    value.chargedActivityCatFood,
    value.charged_gold_coins,
    value.chargedGoldCoins,
    value.total_charged,
    value.totalCharged,
    value.wallet_balance,
    value.walletBalance,
  ].some((candidate) => candidate !== undefined);
  const charge = hasCharge ? normalizeMixedAssetCharge(value) : undefined;
  const rawProp = value.consumed_prop ?? value.consumedProp;
  const inventoryId = isRecord(rawProp)
    ? flexString(rawProp.inventory_id, rawProp.inventoryID)
    : undefined;
  const consumedProp = isRecord(rawProp)
    ? {
        ...(inventoryId !== undefined ? { inventory_id: inventoryId } : {}),
        definition_id: flexString(rawProp.definition_id, rawProp.definitionID) ?? "",
        remaining_quantity: nonnegativeInt(rawProp.remaining_quantity, rawProp.remainingQuantity),
      }
    : undefined;
  return {
    ...(moment ? { moment } : {}),
    ...(charge ? { charge } : {}),
    ...(consumedProp ? { consumed_prop: consumedProp } : {}),
    already_unlocked: flexBool(value.already_unlocked, value.alreadyUnlocked) ?? false,
  };
}

export function normalizeAgentMediaUnlock(value: unknown): AgentMediaUnlock {
  if (!isRecord(value)) throw new Error("智能体媒体解锁响应格式无效");
  const hasCharge = [
    value.charged_activity_cat_food,
    value.chargedActivityCatFood,
    value.charged_gold_coins,
    value.chargedGoldCoins,
    value.total_charged,
    value.totalCharged,
    value.wallet_balance,
    value.walletBalance,
  ].some((candidate) => candidate !== undefined);
  const rawProp = value.consumed_prop ?? value.consumedProp;
  const definitionId = isRecord(rawProp)
    ? flexString(rawProp.definition_id, rawProp.definitionID)
    : undefined;
  const remainingQuantity = isRecord(rawProp)
    ? flexInt(rawProp.remaining_quantity, rawProp.remainingQuantity)
    : undefined;
  const inventoryId = isRecord(rawProp)
    ? flexString(rawProp.inventory_id, rawProp.inventoryID)
    : undefined;
  const consumedProp =
    definitionId && remainingQuantity !== undefined && remainingQuantity >= 0
      ? {
          ...(inventoryId ? { inventory_id: inventoryId } : {}),
          definition_id: definitionId,
          remaining_quantity: remainingQuantity,
        }
      : undefined;
  return {
    ...(hasCharge ? { charge: normalizeMixedAssetCharge(value) } : {}),
    already_unlocked: flexBool(value.already_unlocked, value.alreadyUnlocked) ?? false,
    content_url: flexString(value.content_url, value.contentURL) ?? "",
    download_url: flexString(value.download_url, value.downloadURL) ?? "",
    ...(consumedProp ? { consumed_prop: consumedProp } : {}),
  };
}

export function normalizeAgentProfile(value: unknown): AgentProfile {
  if (!isRecord(value)) throw new Error("智能体资料数据格式无效");
  const tagline = flexString(value.tagline);
  const description = flexString(value.description);
  const language = flexString(value.language);
  const avatarAssetId = flexString(value.avatar_asset_id, value.avatarAssetID);
  const tags = lossyStringArray(value.tags);
  return {
    name: flexString(value.name) ?? "",
    ...(tagline !== undefined ? { tagline } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(avatarAssetId !== undefined ? { avatar_asset_id: avatarAssetId } : {}),
  };
}

export function normalizeAgentGreeting(value: unknown): AgentGreeting {
  if (typeof value === "string") return { id: "default", text: value };
  if (!isRecord(value)) throw new Error("智能体开场白数据格式无效");
  return {
    id: flexString(value.id, value.greeting_id, value.greetingID) ?? "default",
    text: flexString(value.text, value.message, value.content) ?? "",
  };
}

export function normalizeAgentSummary(value: unknown): AgentSummary {
  if (!isRecord(value)) throw new Error("智能体数据格式无效");
  const nested = value.agent ?? value.draft ?? value.item ?? value.summary ?? value.data;
  const outerId = flexString(value.id, value.agent_id, value.agentID);
  if (isRecord(nested)) {
    const flattened: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (
        key === "agent" ||
        key === "draft" ||
        key === "item" ||
        key === "summary" ||
        key === "data"
      ) {
        continue;
      }
      flattened[key] = entry;
    }
    Object.assign(flattened, nested);
    if (!flexString(nested.id, nested.agent_id, nested.agentID) && outerId) {
      flattened.id = outerId;
    }
    return normalizeAgentSummary(flattened);
  }
  const id = outerId;
  if (!id) throw new Error("智能体响应缺少 id/agent_id");
  const profile = isRecord(value.profile) ? normalizeAgentProfile(value.profile) : undefined;
  const capabilities = isRecord(value.capabilities)
    ? normalizeAgentCapabilities(value.capabilities)
    : undefined;
  const greetings = Array.isArray(value.greetings)
    ? value.greetings.map(normalizeAgentGreeting)
    : undefined;
  const visibility = flexString(value.visibility);
  const status = flexString(value.status);
  const versionNumber = flexInt(value.version_number, value.versionNumber);
  const revision = flexInt(value.revision);
  const isOwner = flexBool(value.is_owner, value.isOwner);
  const avatarAssetId = flexString(value.avatar_asset_id, value.avatarAssetID);
  const primaryReferenceAssetId = flexString(
    value.primary_reference_asset_id,
    value.primaryReferenceAssetID,
  );
  const definition = isRecord(value.definition)
    ? normalizeAgentDefinition(value.definition)
    : undefined;
  return {
    id,
    ...(visibility !== undefined ? { visibility } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(versionNumber !== undefined ? { version_number: versionNumber } : {}),
    ...(revision !== undefined ? { revision } : {}),
    ...(isOwner !== undefined ? { is_owner: isOwner } : {}),
    ...(profile ? { profile } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(greetings ? { greetings } : {}),
    ...(avatarAssetId !== undefined ? { avatar_asset_id: avatarAssetId } : {}),
    ...(primaryReferenceAssetId !== undefined
      ? { primary_reference_asset_id: primaryReferenceAssetId }
      : {}),
    ...(definition ? { definition } : {}),
  };
}

export function normalizeAgentDefinition(value: unknown): AgentDefinition {
  if (!isRecord(value)) return {};
  const tone = isRecord(value.tone) ? value.tone : undefined;
  const relationship = isRecord(value.relationship) ? value.relationship : undefined;
  const intimacy = isRecord(value.intimacy) ? value.intimacy : undefined;
  const identity = flexString(value.identity);
  const personality = lossyStringArray(value.personality);
  const greetings = Array.isArray(value.greetings)
    ? value.greetings.map(normalizeAgentGreeting)
    : undefined;
  const capabilities = isRecord(value.capabilities)
    ? normalizeAgentCapabilities(value.capabilities)
    : undefined;
  return {
    ...(identity !== undefined ? { identity } : {}),
    ...(personality !== undefined ? { personality } : {}),
    ...(tone
      ? {
          tone: {
            ...optionalStringValue("style", tone.style),
            ...optionalStringValue("reply_length", tone.reply_length, tone.replyLength),
          },
        }
      : {}),
    ...(relationship
      ? {
          relationship: {
            ...optionalStringValue("type", relationship.type),
            ...optionalStringValue(
              "address_style",
              relationship.address_style,
              relationship.addressStyle,
            ),
          },
        }
      : {}),
    ...(intimacy
      ? {
          intimacy: {
            ...(flexBool(intimacy.adult_enabled, intimacy.adultEnabled) !== undefined
              ? { adult_enabled: flexBool(intimacy.adult_enabled, intimacy.adultEnabled) }
              : {}),
            ...optionalStringValue("style", intimacy.style),
            ...optionalStringValue("initiative", intimacy.initiative),
          },
        }
      : {}),
    ...(greetings ? { greetings } : {}),
    ...(capabilities ? { capabilities } : {}),
  };
}

function optionalStringValue<Key extends string>(
  key: Key,
  ...values: unknown[]
): Partial<Record<Key, string>> {
  const value = flexString(...values);
  return value === undefined ? {} : ({ [key]: value } as Record<Key, string>);
}

export function normalizeAgentRuntimeConfig(value: unknown): AgentRuntimeConfig {
  if (!isRecord(value)) throw new Error("智能体运行配置格式无效");
  if (!isRecord(value.features) || !isRecord(value.vision)) {
    throw new Error("智能体运行配置缺少 features/vision");
  }
  const features = value.features;
  const vision = value.vision;
  const agentsEnabled = flexBool(features.agents_enabled, features.agentsEnabled);
  const imageInputEnabled = flexBool(features.image_input_enabled, features.imageInputEnabled);
  const paidImagesEnabled = flexBool(features.paid_images_enabled, features.paidImagesEnabled);
  const paidVideosEnabled = flexBool(features.paid_videos_enabled, features.paidVideosEnabled);
  if (
    agentsEnabled === undefined ||
    imageInputEnabled === undefined ||
    paidImagesEnabled === undefined ||
    paidVideosEnabled === undefined
  ) {
    throw new Error("智能体运行配置缺少必需功能开关");
  }
  const paidMedia = isRecord(value.paid_media ?? value.paidMedia)
    ? ((value.paid_media ?? value.paidMedia) as UnknownRecord)
    : {};
  const image = isRecord(paidMedia.image) ? paidMedia.image : {};
  const imagePricePoints = flexInt(image.price_points, image.pricePoints);
  return {
    agents_enabled: agentsEnabled,
    image_input_enabled: imageInputEnabled,
    paid_images_enabled: paidImagesEnabled,
    paid_videos_enabled: paidVideosEnabled,
    vision: {
      max_images_per_turn: Math.max(
        1,
        flexInt(vision.max_images_per_turn, vision.maxImagesPerTurn) ?? 1,
      ),
    },
    ...(imagePricePoints !== undefined ? { image_price_points: imagePricePoints } : {}),
  };
}

export function normalizeAgentSummaryPage(value: unknown): AgentSummaryPage {
  if (Array.isArray(value)) {
    return { agents: value.map(normalizeAgentSummary), has_more: false };
  }
  if (!isRecord(value)) throw new Error("智能体列表响应格式无效");
  const raw = [value.agents, value.items, value.bots].find(Array.isArray) ?? [];
  const nextCursor = flexString(value.next_cursor, value.nextCursor);
  return {
    agents: raw.map(normalizeAgentSummary),
    has_more: flexBool(value.has_more, value.hasMore) ?? nextCursor !== undefined,
    ...(nextCursor !== undefined ? { next_cursor: nextCursor } : {}),
  };
}

export function normalizeAgentCapabilities(value: unknown): AgentCapabilities {
  const record = isRecord(value) ? value : {};
  const stickers = flexBool(record.stickers);
  const platformRewards = flexBool(record.platform_rewards, record.platformRewards);
  const proactiveMessages = flexBool(record.proactive_messages, record.proactiveMessages);
  return {
    paid_images: flexBool(record.paid_images, record.paidImages) ?? false,
    paid_videos: flexBool(record.paid_videos, record.paidVideos) ?? false,
    ...(stickers !== undefined ? { stickers } : {}),
    ...(platformRewards !== undefined ? { platform_rewards: platformRewards } : {}),
    ...(proactiveMessages !== undefined ? { proactive_messages: proactiveMessages } : {}),
  };
}

export function normalizeAgentActor(value: unknown): AgentActor {
  const record = isRecord(value) ? value : {};
  return {
    type: flexString(record.type) ?? "",
    id: flexString(record.id, record.actor_id, record.actorID) ?? "",
  };
}

export function normalizeAgentPartMetadata(value: unknown): AgentPartMetadata {
  const record = isRecord(value) ? value : {};
  return {
    ...optionalAgentMetadataString("media_type", record.media_type, record.mediaType),
    ...optionalAgentMetadataString(
      "generation_status",
      record.generation_status,
      record.generationStatus,
    ),
    ...(flexInt(record.price_points, record.pricePoints) !== undefined
      ? { price_points: flexInt(record.price_points, record.pricePoints) }
      : {}),
    ...optionalAgentMetadataString("access", record.access),
    ...optionalAgentMetadataString("preview_url", record.preview_url, record.previewURL),
    ...optionalAgentMetadataString("content_url", record.content_url, record.contentURL),
    ...optionalAgentMetadataString("download_url", record.download_url, record.downloadURL),
    ...(flexInt(record.width) !== undefined ? { width: flexInt(record.width) } : {}),
    ...(flexInt(record.height) !== undefined ? { height: flexInt(record.height) } : {}),
    ...optionalAgentMetadataString("error_code", record.error_code, record.errorCode),
  };
}

export function normalizeAgentMessagePart(value: unknown): AgentMessagePart {
  if (!isRecord(value)) throw new Error("智能体消息片段格式无效");
  const assetId = flexString(value.asset_id, value.assetID);
  const referenceId = flexString(value.reference_id, value.referenceID);
  return {
    id: flexString(value.id, value.part_id, value.partID) ?? "",
    ordinal: flexInt(value.ordinal) ?? 0,
    type: flexString(value.type) ?? "text",
    text: flexString(value.text) ?? "",
    ...(assetId !== undefined ? { asset_id: assetId } : {}),
    ...(referenceId !== undefined ? { reference_id: referenceId } : {}),
    metadata: normalizeAgentPartMetadata(value.metadata),
  };
}

export function normalizeAgentMessage(value: unknown): AgentMessage {
  if (!isRecord(value)) throw new Error("智能体消息格式无效");
  const turnId = flexString(value.turn_id, value.turnID);
  const replyToId = flexString(value.reply_to_id, value.replyToID);
  const clientMessageId = flexString(value.client_message_id, value.clientMessageID);
  return {
    id: flexString(value.id, value.message_id, value.messageID) ?? "",
    conversation_id: flexString(value.conversation_id, value.conversationID) ?? "",
    sequence_no: flexInt(value.sequence_no, value.sequenceNo) ?? 0,
    sender: normalizeAgentActor(value.sender),
    ...(turnId !== undefined ? { turn_id: turnId } : {}),
    source: flexString(value.source) ?? "",
    status: flexString(value.status) ?? "",
    ...(replyToId !== undefined ? { reply_to_id: replyToId } : {}),
    ...(clientMessageId !== undefined ? { client_message_id: clientMessageId } : {}),
    created_at: flexString(value.created_at, value.createdAt) ?? "",
    updated_at: flexString(value.updated_at, value.updatedAt) ?? "",
    parts: Array.isArray(value.parts)
      ? value.parts
          .map(normalizeAgentMessagePart)
          .sort((left, right) => left.ordinal - right.ordinal)
      : [],
  };
}

export function normalizeAgentConversation(value: unknown): AgentConversation {
  if (!isRecord(value)) throw new Error("智能体会话格式无效");
  const nested = value.conversation ?? value.item ?? value.data;
  if (isRecord(nested)) return normalizeAgentConversation(nested);
  const profile = isRecord(value.agent_profile ?? value.agentProfile)
    ? normalizeAgentProfile(value.agent_profile ?? value.agentProfile)
    : normalizeAgentProfile({ name: flexString(value.title) ?? "智能体" });
  const latest = isRecord(value.latest_message ?? value.latestMessage)
    ? normalizeAgentMessage(value.latest_message ?? value.latestMessage)
    : undefined;
  return {
    id: flexString(value.id, value.conversation_id, value.conversationID) ?? "",
    title: flexString(value.title) ?? profile.name,
    status: flexString(value.status) ?? "active",
    agent_id: flexString(value.agent_id, value.agentID) ?? "",
    agent_version_id: flexString(value.agent_version_id, value.agentVersionID) ?? "",
    agent_profile: profile,
    agent_capabilities: normalizeAgentCapabilities(
      value.agent_capabilities ?? value.agentCapabilities,
    ),
    ...(latest ? { latest_message: latest } : {}),
    created_at: flexString(value.created_at, value.createdAt) ?? "",
    updated_at: flexString(value.updated_at, value.updatedAt) ?? "",
  };
}

export function normalizeAgentMessagePage(value: unknown): AgentMessagePage {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    throw new Error("智能体消息列表响应格式无效");
  }
  return {
    messages: value.messages
      .map(normalizeAgentMessage)
      .filter((message) => message.id.length > 0)
      .sort(
        (left, right) => left.sequence_no - right.sequence_no || left.id.localeCompare(right.id),
      ),
    has_more: flexBool(value.has_more, value.hasMore) ?? false,
  };
}

export function normalizeAgentTurn(value: unknown): AgentTurn {
  if (!isRecord(value)) throw new Error("智能体回合格式无效");
  const responseMessageId = flexString(value.response_message_id, value.responseMessageID);
  const completedAt = flexString(value.completed_at, value.completedAt);
  return {
    id: flexString(value.id, value.turn_id, value.turnID) ?? "",
    conversation_id: flexString(value.conversation_id, value.conversationID) ?? "",
    trigger_message_id: flexString(value.trigger_message_id, value.triggerMessageID) ?? "",
    ...(responseMessageId !== undefined ? { response_message_id: responseMessageId } : {}),
    status: flexString(value.status) ?? "",
    interaction_mode: flexString(value.interaction_mode, value.interactionMode) ?? "",
    chat_model: flexString(value.chat_model, value.chatModel) ?? "",
    vision_model: flexString(value.vision_model, value.visionModel) ?? "",
    error_code: flexString(value.error_code, value.errorCode) ?? "",
    error_detail: flexString(value.error_detail, value.errorDetail) ?? "",
    created_at: flexString(value.created_at, value.createdAt) ?? "",
    updated_at: flexString(value.updated_at, value.updatedAt) ?? "",
    ...(completedAt !== undefined ? { completed_at: completedAt } : {}),
  };
}

export function normalizeAgentTurnAccepted(value: unknown): AgentTurnAccepted {
  if (!isRecord(value)) throw new Error("智能体回合创建响应格式无效");
  return {
    turn: normalizeAgentTurn(value.turn),
    message: normalizeAgentMessage(value.message),
    events_url: flexString(value.events_url, value.eventsURL) ?? "",
  };
}

export function normalizeAgentTurnResult(value: unknown): AgentTurnResult {
  if (!isRecord(value)) throw new Error("智能体回合响应格式无效");
  const response = isRecord(value.response_message ?? value.responseMessage)
    ? normalizeAgentMessage(value.response_message ?? value.responseMessage)
    : undefined;
  return {
    turn: normalizeAgentTurn(value.turn),
    ...(response ? { response_message: response } : {}),
  };
}

function shortDramaFlexString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function shortDramaFlexInt(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value !== "string") continue;
    const normalized = trimFoundationWhitespacesAndNewlines(value).replaceAll(",", "");
    if (!normalized) continue;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return undefined;
}

function shortDramaFlexDouble(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (
      typeof value === "string" &&
      value.length > 0 &&
      value === trimFoundationWhitespacesAndNewlines(value)
    ) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function shortDramaFlexBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isInteger(value)) return value !== 0;
  if (typeof value !== "string") return undefined;
  switch (value.toLowerCase()) {
    case "true":
    case "1":
    case "yes":
      return true;
    case "false":
    case "0":
    case "no":
      return false;
    default:
      return undefined;
  }
}

function shortDramaIsBlank(value: string): boolean {
  return trimFoundationWhitespacesAndNewlines(value).length === 0;
}

function shortDramaStatusIfDecodable(value: unknown): ShortDramaPublishStatus | undefined {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value))
    ? normalizeShortDramaStatus(value)
    : undefined;
}

function decodeShortDramaVideos(...values: unknown[]): ShortDramaVideo[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    try {
      return value.map(normalizeShortDramaVideo);
    } catch {
      continue;
    }
  }
  return [];
}

function decodeShortDramaSeriesArray(...values: unknown[]): ShortDramaSeries[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    try {
      return value.map(normalizeShortDramaSeries);
    } catch {
      continue;
    }
  }
  return [];
}

function decodeShortDramaComments(...values: unknown[]): ShortDramaComment[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    try {
      return value.map(normalizeShortDramaComment);
    } catch {
      continue;
    }
  }
  return [];
}

export function normalizeShortDramaCreator(value: unknown): ShortDramaCreator {
  if (!isRecord(value)) throw new Error("短剧作者数据格式无效");
  const nested = firstRecord(value.creator, value.author, value.user);
  if (nested) return normalizeShortDramaCreator(nested);
  return {
    user_id: shortDramaFlexString(value.user_id) ?? "",
    username: shortDramaFlexString(value.username) ?? "",
    nickname:
      shortDramaFlexString(value.nickname) ??
      localizedString(getActiveLanguageCode(), "profile.defaultUser"),
    avatar_url: shortDramaFlexString(value.avatar_url) ?? "",
    followed_by_me: shortDramaFlexBool(value.followed_by_me) ?? false,
    follows_me: shortDramaFlexBool(value.follows_me) ?? false,
    is_friend: shortDramaFlexBool(value.is_friend) ?? false,
  };
}

export function normalizeShortDramaStatus(value: unknown): ShortDramaPublishStatus {
  if (typeof value === "number" && Number.isInteger(value)) {
    return (
      (["draft", "processing", "reviewing", "published", "rejected", "failed"][value] as
        ShortDramaPublishStatus | undefined) ?? "unknown"
    );
  }
  const normalized =
    typeof value === "string"
      ? trimFoundationWhitespacesAndNewlines(value).toLowerCase()
      : undefined;
  if (!normalized) return "unknown";
  if (["draft", "草稿"].includes(normalized)) return "draft";
  if (
    [
      "processing",
      "transcoding",
      "encoding",
      "queued",
      "uploading",
      "pending_transcode",
      "处理中",
      "处理",
      "转码中",
      "上传中",
    ].includes(normalized)
  )
    return "processing";
  if (
    [
      "reviewing",
      "review",
      "pending",
      "audit",
      "auditing",
      "pending_review",
      "under_review",
      "in_review",
      "审核中",
      "待审核",
    ].includes(normalized)
  )
    return "reviewing";
  if (
    [
      "published",
      "online",
      "approved",
      "ready",
      "complete",
      "completed",
      "success",
      "succeeded",
      "active",
      "available",
      "released",
      "public",
      "已发布",
      "发布成功",
      "已上线",
      "通过",
      "审核通过",
      "已完成",
    ].includes(normalized)
  )
    return "published";
  if (
    [
      "rejected",
      "reject",
      "blocked",
      "disabled",
      "content_rejected",
      "review_rejected",
      "moderation_rejected",
      "已拒绝",
      "拒绝",
      "审核拒绝",
      "审核不通过",
      "未通过",
      "内容违规",
      "违规",
    ].includes(normalized)
  )
    return "rejected";
  if (
    [
      "failed",
      "failure",
      "error",
      "processing_failed",
      "process_failed",
      "transcode_failed",
      "transcoding_failed",
      "encoding_failed",
      "upload_failed",
      "media_failed",
      "处理失败",
      "转码失败",
      "上传失败",
      "失败",
    ].includes(normalized)
  )
    return "failed";
  return "unknown";
}

export function normalizeShortDramaVideo(value: unknown): ShortDramaVideo {
  if (!isRecord(value)) throw new Error("短剧分集数据格式无效");
  const creatorValue = firstRecord(value.creator, value.author, value.user);
  const creator = creatorValue
    ? normalizeShortDramaCreator(creatorValue)
    : normalizeShortDramaCreator({});
  const playUrl =
    shortDramaFlexString(value.play_url, value.hls_url, value.mp4_url, value.video_url) ?? "";
  const publishStatus =
    shortDramaStatusIfDecodable(value.publish_status) ?? shortDramaStatusIfDecodable(value.status);
  const decodedPrice = shortDramaFlexInt(value.unlock_price_gold_coins, value.unlockPriceGoldCoins);
  const price =
    decodedPrice !== undefined && decodedPrice > 0 ? Math.min(decodedPrice, 100) : undefined;
  const episodeNumber = shortDramaFlexInt(value.episode_number, value.episode_no, value.episode);
  const duration = shortDramaFlexDouble(value.duration_seconds, value.duration);
  const statusMessage = shortDramaFlexString(
    value.status_message,
    value.failure_reason,
    value.review_reason,
    value.rejection_reason,
    value.reject_reason,
    value.reason,
    value.message,
  );
  const hls = shortDramaFlexString(value.hls_url);
  const mp4 = shortDramaFlexString(value.mp4_url, value.video_url);
  return {
    id: shortDramaFlexString(value.id, value.video_id) ?? createUppercaseUUID(),
    drama_id: shortDramaFlexString(value.drama_id, value.series_id) ?? "",
    creator,
    drama_title:
      shortDramaFlexString(value.drama_title, value.series_title, value.show_title) ?? "",
    title: shortDramaFlexString(value.title, value.name) ?? "",
    intro: shortDramaFlexString(value.intro, value.description, value.summary) ?? "",
    ...(episodeNumber !== undefined ? { episode_number: episodeNumber } : {}),
    cover_url: shortDramaFlexString(value.cover_url, value.thumbnail_url, value.poster_url) ?? "",
    play_url: playUrl,
    ...(hls !== undefined ? { hls_url: hls } : {}),
    ...(mp4 !== undefined ? { mp4_url: mp4 } : {}),
    ...(duration !== undefined ? { duration_seconds: duration } : {}),
    playback_position_seconds:
      shortDramaFlexDouble(value.playback_position_seconds, value.progress_seconds) ?? 0,
    like_count: shortDramaFlexInt(value.like_count, value.likes_count) ?? 0,
    comment_count: shortDramaFlexInt(value.comment_count, value.comments_count) ?? 0,
    liked_by_me: shortDramaFlexBool(value.liked_by_me) ?? false,
    ...(publishStatus !== undefined ? { publish_status: publishStatus } : {}),
    ...(statusMessage !== undefined ? { status_message: statusMessage } : {}),
    ...(price !== undefined ? { unlock_price_gold_coins: price } : {}),
    is_unlocked:
      shortDramaFlexBool(value.is_unlocked) ?? shortDramaFlexBool(value.isUnlocked) ?? false,
    is_owned_by_current_user:
      shortDramaFlexBool(value.is_owned_by_current_user) ??
      shortDramaFlexBool(value.isOwnedByCurrentUser) ??
      false,
  };
}

export function normalizeShortDramaSeries(value: unknown): ShortDramaSeries {
  if (!isRecord(value)) throw new Error("短剧系列数据格式无效");
  const episodes = decodeShortDramaVideos(value.episodes, value.videos, value.items);
  const seriesId =
    shortDramaFlexString(value.series_id, value.drama_id, value.id) ?? createUppercaseUUID();
  const title =
    shortDramaFlexString(value.title, value.name) ??
    localizedString(getActiveLanguageCode(), "shortDrama.series.untitled");
  const intro = shortDramaFlexString(value.intro, value.description, value.summary) ?? "";
  const coverUrl =
    shortDramaFlexString(value.cover_url, value.poster_url, value.thumbnail_url) ?? "";
  const rawCreator = firstRecord(value.creator, value.author, value.user);
  const creator = rawCreator
    ? normalizeShortDramaCreator(rawCreator)
    : (episodes[0]?.creator ?? normalizeShortDramaCreator({}));
  const resolvedEpisodes = episodes.map((episode) => ({
    ...episode,
    drama_id: shortDramaIsBlank(episode.drama_id) ? seriesId : episode.drama_id,
    drama_title: shortDramaIsBlank(episode.drama_title) ? title : episode.drama_title,
    intro: shortDramaIsBlank(episode.intro) ? intro : episode.intro,
    cover_url: shortDramaIsBlank(episode.cover_url) ? coverUrl : episode.cover_url,
    creator: fillShortDramaCreator(episode.creator, creator),
  }));
  const statusMessage = shortDramaFlexString(
    value.status_message,
    value.failure_reason,
    value.review_reason,
    value.rejection_reason,
    value.reject_reason,
    value.reason,
    value.message,
  );
  const resumeEpisodeId = shortDramaFlexString(value.resume_episode_id, value.resumeEpisodeID);
  const lastWatchedAt = shortDramaFlexString(value.last_watched_at, value.lastWatchedAt);
  const status =
    shortDramaStatusIfDecodable(value.status) ??
    shortDramaStatusIfDecodable(value.publish_status) ??
    "draft";
  return {
    series_id: seriesId,
    title,
    intro,
    cover_url: coverUrl,
    episode_count:
      shortDramaFlexInt(value.episode_count, value.episodes_count) ?? resolvedEpisodes.length,
    status,
    ...(statusMessage !== undefined ? { status_message: statusMessage } : {}),
    updated_at: shortDramaFlexString(value.updated_at, value.created_at) ?? "",
    episodes: resolvedEpisodes,
    creator,
    ...(resumeEpisodeId !== undefined ? { resume_episode_id: resumeEpisodeId } : {}),
    resume_position_seconds:
      shortDramaFlexDouble(value.resume_position_seconds, value.resumePositionSeconds) ?? 0,
    ...(lastWatchedAt !== undefined ? { last_watched_at: lastWatchedAt } : {}),
  };
}

export function normalizeShortDramaSeriesPage(value: unknown): ShortDramaSeriesPage {
  if (Array.isArray(value)) {
    return { series: value.map(normalizeShortDramaSeries), has_more: false };
  }
  if (!isRecord(value)) throw new Error("短剧系列列表响应格式无效");
  const raw = decodeShortDramaSeriesArray(value.series, value.items, value.list);
  const nextCursor = shortDramaFlexString(value.next_cursor, value.cursor);
  return {
    series: raw,
    has_more:
      shortDramaFlexBool(value.has_more) ??
      (nextCursor !== undefined && trimFoundationWhitespacesAndNewlines(nextCursor).length > 0),
    ...(nextCursor !== undefined ? { next_cursor: nextCursor } : {}),
  };
}

export function normalizeShortDramaFeedPage(value: unknown): ShortDramaFeedPage {
  if (Array.isArray(value)) {
    return { videos: value.map(normalizeShortDramaVideo), has_more: false };
  }
  if (!isRecord(value)) throw new Error("短剧信息流响应格式无效");
  const raw = decodeShortDramaVideos(value.videos, value.items, value.list, value.feed);
  const nextCursor = shortDramaFlexString(value.next_cursor, value.cursor);
  return {
    videos: raw,
    has_more:
      shortDramaFlexBool(value.has_more) ??
      (nextCursor !== undefined && trimFoundationWhitespacesAndNewlines(nextCursor).length > 0),
    ...(nextCursor !== undefined ? { next_cursor: nextCursor } : {}),
  };
}

export function normalizeShortDramaUnlockResult(value: unknown): ShortDramaUnlockResult {
  if (!isRecord(value)) throw new Error("短剧解锁响应格式无效");
  const rawVideo = isRecord(value.video)
    ? value.video
    : isRecord(value.episode)
      ? value.episode
      : undefined;
  const video = rawVideo ? normalizeShortDramaVideo(rawVideo) : undefined;
  const hasCharge = [
    value.charged_activity_cat_food,
    value.charged_gold_coins,
    value.total_charged,
    value.wallet_balance,
  ].some((candidate) => candidate !== undefined);
  const charge = hasCharge
    ? normalizeShortDramaMixedAssetCharge({
        charged_activity_cat_food: value.charged_activity_cat_food,
        charged_gold_coins: value.charged_gold_coins,
        total_charged: value.total_charged,
        wallet_balance: value.wallet_balance,
      })
    : undefined;
  return {
    ...(video ? { video } : {}),
    ...(charge ? { charge } : {}),
  };
}

export function normalizeShortDramaEpisodeUploadResult(
  value: unknown,
): ShortDramaEpisodeUploadResult {
  if (!isRecord(value)) throw new Error("短剧分集上传响应格式无效");
  const rawVideo = value.video ?? value.episode ?? value.item;
  const directVideo = isRecord(rawVideo)
    ? rawVideo
    : value.video_id !== undefined || value.videoID !== undefined || value.id !== undefined
      ? value
      : undefined;
  const video = directVideo ? normalizeShortDramaVideo(directVideo) : undefined;
  const rawStatus =
    value.status ?? value.publish_status ?? value.publishStatus ?? video?.publish_status;
  const statusMessage = flexString(
    value.status_message,
    value.statusMessage,
    value.failure_reason,
    value.review_reason,
    value.rejection_reason,
    value.reject_reason,
    value.reason,
    value.message,
    video?.status_message,
  );
  return {
    ...(video ? { video } : {}),
    ...(rawStatus !== undefined ? { status: normalizeShortDramaStatus(rawStatus) } : {}),
    ...(statusMessage !== undefined ? { status_message: statusMessage } : {}),
  };
}

export function normalizeShortDramaComment(value: unknown): ShortDramaComment {
  if (!isRecord(value)) throw new Error("短剧评论数据格式无效");
  return {
    id: shortDramaFlexString(value.id, value.comment_id) ?? createUppercaseUUID(),
    video_id: shortDramaFlexString(value.video_id) ?? "",
    user_id: shortDramaFlexString(value.user_id) ?? "",
    nickname:
      shortDramaFlexString(value.nickname) ??
      localizedString(getActiveLanguageCode(), "profile.defaultUser"),
    avatar_url: shortDramaFlexString(value.avatar_url) ?? "",
    content: shortDramaFlexString(value.content, value.text) ?? "",
    created_at: shortDramaFlexString(value.created_at) ?? "",
  };
}

export function normalizeShortDramaCommentsPage(value: unknown): ShortDramaCommentsPage {
  if (Array.isArray(value)) {
    return { comments: value.map(normalizeShortDramaComment), has_more: false };
  }
  if (!isRecord(value)) throw new Error("短剧评论列表响应格式无效");
  const comments = decodeShortDramaComments(value.comments, value.items, value.list);
  const cursor = shortDramaFlexString(value.next_cursor, value.cursor);
  return {
    comments,
    has_more:
      shortDramaFlexBool(value.has_more) ??
      (cursor !== undefined && trimFoundationWhitespacesAndNewlines(cursor).length > 0),
    ...(cursor !== undefined ? { next_cursor: cursor } : {}),
  };
}

export function normalizeShortDramaInteractionResult(value: unknown): ShortDramaInteractionResult {
  if (value === null || value === undefined) return {};
  if (!isRecord(value)) throw new Error("短剧互动响应格式无效");
  const liked = flexBool(value.liked);
  const count = flexInt(value.like_count);
  return {
    ...(liked !== undefined ? { liked } : {}),
    ...(count !== undefined ? { like_count: count } : {}),
  };
}

function normalizeShortDramaMixedAssetCharge(value: Record<string, unknown>): MixedAssetCharge {
  const chargedActivityCatFood = requiredShortDramaChargeInt(value.charged_activity_cat_food);
  const chargedGoldCoins = requiredShortDramaChargeInt(value.charged_gold_coins);
  const totalCharged = requiredShortDramaChargeInt(value.total_charged);
  if (totalCharged !== chargedActivityCatFood + chargedGoldCoins) {
    throw new Error("混合资产扣款总额不一致");
  }
  return {
    charged_activity_cat_food: chargedActivityCatFood,
    charged_gold_coins: chargedGoldCoins,
    total_charged: totalCharged,
    wallet_balance: normalizeWalletBalanceSnapshot(value.wallet_balance),
  };
}

function requiredShortDramaChargeInt(value: unknown): number {
  const decoded = shortDramaFlexInt(value);
  if (decoded === undefined) throw new Error("钱包余额缺少必需字段");
  if (decoded < 0) throw new Error("数值不能为负数");
  return decoded;
}

export function normalizeChatGroup(value: unknown): ChatGroup {
  if (!isRecord(value)) throw new Error("群组数据格式无效");
  const lastMessage = flexContent(value.last_message, value.lastMessage);
  return {
    group_id: flexInt(value.group_id, value.groupID, value.id) ?? 0,
    name: flexString(value.name) ?? "",
    avatar_url: flexString(value.avatar_url, value.avatarURL, value.avatar) ?? "",
    creator_id: flexString(value.creator_id, value.creatorID) ?? "",
    member_count: flexInt(value.member_count, value.memberCount) ?? 0,
    ...(lastMessage !== undefined ? { last_message: lastMessage } : {}),
    ...(flexString(value.last_message_time, value.lastMessageTime) !== undefined
      ? { last_message_time: flexString(value.last_message_time, value.lastMessageTime) }
      : {}),
    ...(flexString(value.last_message_sender, value.lastMessageSender) !== undefined
      ? { last_message_sender: flexString(value.last_message_sender, value.lastMessageSender) }
      : {}),
    unread_count: flexInt(value.unread_count, value.unread, value.unreadCount) ?? 0,
    is_public: flexBool(value.is_public, value.isPublic) ?? false,
    is_muted: flexBool(value.is_muted, value.isMuted) ?? false,
  };
}

export function normalizeGroupMember(value: unknown): GroupMember {
  if (!isRecord(value)) throw new Error("群成员数据格式无效");
  const userId = groupFlexString(value.user_id) ?? "";
  const groupNickname = groupFlexString(value.group_nickname, value.groupNickname);
  return {
    user_id: userId,
    nickname: groupFlexString(value.nickname) ?? userId,
    avatar_url: groupFlexString(value.avatar_url) ?? "",
    role: groupFlexString(value.role) ?? "member",
    ...(groupNickname !== undefined ? { group_nickname: groupNickname } : {}),
  };
}

export function normalizeGroupDetail(value: unknown): GroupDetail {
  if (!isRecord(value)) throw new Error("群信息数据格式无效");
  if (typeof value.group_id !== "number" || !Number.isInteger(value.group_id)) {
    throw new Error("群信息缺少 group_id");
  }
  if (typeof value.name !== "string") throw new Error("群信息缺少 name");
  if (typeof value.avatar_url !== "string") throw new Error("群信息缺少 avatar_url");
  if (typeof value.creator_id !== "string") throw new Error("群信息缺少 creator_id");
  if (!Array.isArray(value.members)) throw new Error("群信息缺少 members");
  const groupId = value.group_id;
  const members = value.members.map(normalizeGroupMember);
  const currentMember = tryNormalizeGroupMember(value.current_member ?? value.currentMember);
  const isPublic = groupFlexBool(value.is_public, value.isPublic) ?? false;
  const announcementValue = value.announcement;
  const serverCapabilities =
    strictGroupCapabilities(value.permissions) ?? strictGroupCapabilities(value.capabilities);
  return {
    group_id: groupId,
    name: value.name,
    avatar_url: value.avatar_url,
    creator_id: value.creator_id,
    members,
    is_public: isPublic,
    notification_settings: normalizeGroupNotificationSettings(
      value.notification_settings ?? value.notificationSettings,
      groupId,
    ),
    viewer_settings: normalizeGroupViewerSettings(
      value.viewer_settings ?? value.viewerSettings,
      groupId,
    ),
    ...(tryNormalizeGroupAnnouncement(announcementValue, groupId) ?? {}),
    ...(currentMember ? { current_member: currentMember } : {}),
    capabilities:
      serverCapabilities ?? fallbackGroupCapabilities(value.creator_id, currentMember, isPublic),
    ...(groupFlexString(value.display_name, value.displayName) !== undefined
      ? { display_name: groupFlexString(value.display_name, value.displayName) }
      : {}),
  };
}

export function normalizeGroupNotificationSettings(
  value: unknown,
  fallbackGroupId = 0,
): GroupNotificationSettings {
  const record = isRecord(value) ? value : {};
  const rawMemberIds = record.important_member_ids ?? record.importantMemberIDs;
  const decodedMemberIds = groupFlexStringArray(rawMemberIds) ?? [];
  const importantMemberIds: string[] = [];
  const seen = new Set<string>();
  for (const candidate of decodedMemberIds) {
    const userId = trimFoundationWhitespacesAndNewlines(candidate);
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    importantMemberIds.push(userId);
    if (importantMemberIds.length === 4) break;
  }
  const updatedAt = groupFlexString(record.updated_at, record.updatedAt);
  return {
    group_id: groupFlexInt(record.group_id, record.groupID) ?? fallbackGroupId,
    muted: groupFlexBool(record.muted, record.is_muted, record.isMuted) ?? false,
    notify_mentions_me: groupFlexBool(record.notify_mentions_me, record.notifyMentionsMe) ?? true,
    notify_mentions_all:
      groupFlexBool(record.notify_mentions_all, record.notifyMentionsAll) ?? true,
    important_member_ids: importantMemberIds,
    revision: Math.max(0, groupFlexInt(record.revision) ?? 0),
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
  };
}

export function normalizeGroupAnnouncement(value: unknown, fallbackGroupId = 0): GroupAnnouncement {
  if (!isRecord(value)) throw new Error("群公告数据格式无效");
  const updatedById = groupFlexString(value.updated_by_id);
  const updatedByNickname = groupFlexString(value.updated_by_nickname);
  const updatedAt = groupFlexString(value.updated_at);
  return {
    announcement_id: groupFlexString(value.announcement_id, value.id) ?? "",
    group_id: groupFlexInt(value.group_id) ?? fallbackGroupId,
    title: groupFlexString(value.title) ?? "",
    content: groupFlexString(value.content) ?? "",
    ...(updatedById !== undefined ? { updated_by_id: updatedById } : {}),
    ...(updatedByNickname !== undefined ? { updated_by_nickname: updatedByNickname } : {}),
    revision: groupFlexInt(value.revision) ?? 0,
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
  };
}

export function normalizeGroupCapabilities(value: unknown): GroupCapabilities {
  const record = isRecord(value) ? value : {};
  return {
    can_manage_members: flexBool(record.can_manage_members, record.canManageMembers) ?? false,
    can_edit_group: flexBool(record.can_edit_group, record.canEditGroup) ?? false,
    can_edit_announcement:
      flexBool(record.can_edit_announcement, record.canEditAnnouncement) ?? false,
    can_create_invite: flexBool(record.can_create_invite, record.canCreateInvite) ?? false,
    can_change_visibility:
      flexBool(record.can_change_visibility, record.canChangeVisibility) ?? false,
    can_dismiss_group: flexBool(record.can_dismiss_group, record.canDismissGroup) ?? false,
  };
}

export function normalizeGroupViewerSettings(
  value: unknown,
  fallbackGroupId = 0,
): GroupViewerSettings {
  const record = isRecord(value) ? value : {};
  const clearedBeforeSequence = groupFlexInt(
    record.cleared_before_sequence,
    record.clearedBeforeSequence,
  );
  const updatedAt = groupFlexString(record.updated_at, record.updatedAt);
  return {
    group_id: groupFlexInt(record.group_id, record.groupID) ?? fallbackGroupId,
    remark: groupFlexString(record.remark, record.group_remark) ?? "",
    show_member_nicknames:
      groupFlexBool(record.show_member_nicknames, record.showMemberNicknames) ?? true,
    ...(clearedBeforeSequence !== undefined
      ? { cleared_before_sequence: clearedBeforeSequence }
      : {}),
    revision: Math.max(0, groupFlexInt(record.revision) ?? 0),
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
  };
}

function tryNormalizeGroupMember(value: unknown): GroupMember | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return normalizeGroupMember(value);
  } catch {
    return undefined;
  }
}

function tryNormalizeGroupAnnouncement(
  value: unknown,
  fallbackGroupId: number,
): { announcement: GroupAnnouncement } | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return { announcement: normalizeGroupAnnouncement(value, fallbackGroupId) };
  } catch {
    return undefined;
  }
}

function strictGroupCapabilities(value: unknown): GroupCapabilities | undefined {
  if (!isRecord(value)) return undefined;
  const keys = [
    "can_manage_members",
    "can_edit_group",
    "can_edit_announcement",
    "can_create_invite",
    "can_change_visibility",
    "can_dismiss_group",
  ] as const;
  if (!keys.every((key) => typeof value[key] === "boolean")) return undefined;
  return {
    can_manage_members: value.can_manage_members as boolean,
    can_edit_group: value.can_edit_group as boolean,
    can_edit_announcement: value.can_edit_announcement as boolean,
    can_create_invite: value.can_create_invite as boolean,
    can_change_visibility: value.can_change_visibility as boolean,
    can_dismiss_group: value.can_dismiss_group as boolean,
  };
}

function fallbackGroupCapabilities(
  creatorId: string,
  currentMember: GroupMember | undefined,
  isPublic: boolean,
): GroupCapabilities {
  const role = trimFoundationWhitespacesAndNewlines(currentMember?.role ?? "").toLowerCase();
  const isOwner = currentMember?.user_id === creatorId || role === "owner";
  const isManager = isOwner || role === "admin";
  return {
    can_manage_members: isManager,
    can_edit_group: isManager,
    can_edit_announcement: isManager,
    can_create_invite: isPublic || isManager,
    can_change_visibility: isOwner,
    can_dismiss_group: isOwner,
  };
}

function groupFlexString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function groupFlexInt(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value !== "string") continue;
    const normalized = trimFoundationWhitespacesAndNewlines(value).replaceAll(",", "");
    if (!normalized) continue;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return undefined;
}

function groupFlexBool(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isInteger(value)) return value !== 0;
    if (typeof value !== "string") continue;
    switch (value.toLowerCase()) {
      case "true":
      case "1":
      case "yes":
        return true;
      case "false":
      case "0":
      case "no":
        return false;
    }
  }
  return undefined;
}

function groupFlexStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[];
  }
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "number" && Number.isInteger(item))
  ) {
    return (value as number[]).map(String);
  }
  if (typeof value !== "string") return undefined;
  if (!trimFoundationWhitespacesAndNewlines(value)) return [];
  try {
    const decoded: unknown = JSON.parse(value);
    if (Array.isArray(decoded) && decoded.every((item) => typeof item === "string")) {
      return decoded;
    }
  } catch {
    // The Swift decoder falls through to comma-separated values.
  }
  return value.split(",").map(trimFoundationWhitespacesAndNewlines).filter(Boolean);
}

function groupFlexContent(...values: unknown[]): string | undefined {
  for (const value of values) {
    const direct = groupFlexString(value);
    if (direct !== undefined) return direct;
    if (isRecord(value) || Array.isArray(value)) {
      try {
        return JSON.stringify(value);
      } catch {
        // Match the native decoder's nil fallback for non-serializable content.
      }
    }
  }
  return undefined;
}

export function normalizeGroupHistoryClearReceipt(
  value: unknown,
  fallbackGroupId: number,
): GroupHistoryClearReceipt {
  if (!isRecord(value)) throw new Error("群聊清空回执格式无效");
  return {
    group_id: flexInt(value.group_id) ?? fallbackGroupId,
    cleared_before_sequence: flexInt(value.cleared_before_sequence) ?? 0,
    ...(flexString(value.cleared_at) !== undefined
      ? { cleared_at: flexString(value.cleared_at) }
      : {}),
    revision: flexInt(value.revision) ?? 0,
  };
}

export function normalizeConversationPreference(value: unknown): ConversationPreference {
  if (!isRecord(value)) throw new Error("会话偏好响应格式无效");
  return {
    conversation_type:
      flexString(value.conversation_type, value.conversationType, value.type) ?? "",
    target_id: flexString(value.target_id, value.targetID, value.id) ?? "",
    is_pinned: flexBool(value.is_pinned, value.isPinned) ?? false,
    is_hidden: flexBool(value.is_hidden, value.isHidden) ?? false,
    revision: flexInt(value.revision) ?? 0,
    ...(flexString(value.updated_at, value.updatedAt) !== undefined
      ? { updated_at: flexString(value.updated_at, value.updatedAt) }
      : {}),
  };
}

export function normalizeGroupMessage(value: unknown): GroupMessage {
  if (!isRecord(value)) throw new Error("群消息数据格式无效");
  const content = groupFlexContent(value.content, value.payload, value.gift) ?? "";
  const rawType =
    groupFlexString(value.msg_type, value.msgType, value.message_type, value.type) ??
    (parseGiftMessagePayload(content) ? "gift" : "text");
  const recalledAt = groupFlexString(value.recalled_at, value.recalledAt);
  const status = groupFlexString(value.status)?.toLocaleLowerCase().replaceAll("-", "_");
  const normalizedType = rawType.toLocaleLowerCase().replaceAll("-", "_");
  const recallValues = ["recall", "recalled", "withdrawn", "revoked", "message_recalled"];
  const msgType =
    groupFlexBool(value.is_recalled, value.isRecalled) === true ||
    recalledAt !== undefined ||
    recallValues.includes(normalizedType) ||
    (status !== undefined && recallValues.includes(status))
      ? "recalled"
      : rawType;
  const senderId =
    groupFlexString(
      value.sender_id,
      value.senderId,
      value.from_user_id,
      value.fromUserId,
      value.user_id,
    ) ?? "";
  const reply =
    normalizeGroupReplyPreview(value.reply_to) ?? normalizeGroupReplyPreview(value.replyTo);
  const mentions = groupFlexStringArray(value.mentions);
  const scriptContext =
    normalizeGroupMessageScriptContext(value.script_context) ??
    normalizeGroupMessageScriptContext(value.scriptContext);
  return {
    id: groupFlexInt(value.id, value.message_id, value.messageId, value.msg_id, value.msgId) ?? 0,
    group_id: groupFlexInt(value.group_id, value.groupId) ?? 0,
    sender_id: senderId,
    msg_type: msgType,
    content,
    timestamp:
      groupFlexString(value.timestamp, value.created_at, value.createdAt, value.time) ??
      new Date().toISOString(),
    sender_nickname:
      groupFlexString(value.sender_nickname, value.senderNickname, value.nickname) ?? senderId,
    sender_avatar: groupFlexString(value.sender_avatar, value.senderAvatar, value.avatar_url) ?? "",
    ...(groupFlexInt(value.reply_to_id, value.replyToId) !== undefined
      ? { reply_to_id: groupFlexInt(value.reply_to_id, value.replyToId) }
      : {}),
    ...(reply ? { reply_to: reply } : {}),
    ...(mentions ? { mentions } : {}),
    mention_all: groupFlexBool(value.mention_all, value.mentionAll) ?? false,
    ...optionalNativeGroupMessageString(
      "client_message_id",
      value.client_message_id,
      value.clientMessageId,
      value.client_id,
      value.clientId,
    ),
    ...(scriptContext ? { script_context: scriptContext } : {}),
    ...(groupFlexInt(value.history_sequence, value.historySequence) !== undefined
      ? { history_sequence: groupFlexInt(value.history_sequence, value.historySequence) }
      : {}),
    version: groupFlexInt(value.version) ?? 1,
    ...optionalNativeGroupMessageString("updated_at", value.updated_at),
    ...optionalNativeGroupThumbnail(
      value.thumbnail_url,
      value.thumbnailURL,
      value.preview_url,
      value.previewURL,
    ),
  };
}

export function normalizeGroupMessageScriptContext(
  value: unknown,
): GroupMessageScriptContext | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.room_id !== "string" ||
    typeof value.role_id !== "string" ||
    (value.actor_type !== "user" && value.actor_type !== "ai") ||
    typeof value.turn_id !== "string"
  ) {
    return undefined;
  }
  return {
    room_id: value.room_id,
    role_id: value.role_id,
    actor_type: value.actor_type,
    turn_id: value.turn_id,
  };
}

export function normalizeScriptRole(value: unknown): ScriptRole {
  if (!isRecord(value)) throw new Error("剧本角色数据格式无效");
  const clientRoleId = scriptString(value.client_role_id);
  const hiddenSetting = scriptString(value.hidden_setting);
  return {
    role_id: scriptString(value.role_id, value.id) ?? "",
    ...(clientRoleId !== undefined ? { client_role_id: clientRoleId } : {}),
    name: scriptString(value.name) ?? "",
    gender: scriptString(value.gender) ?? "unspecified",
    avatar_url: scriptString(value.avatar_url, value.avatar) ?? "",
    description: scriptString(value.description, value.public_description) ?? "",
    ...(hiddenSetting !== undefined ? { hidden_setting: hiddenSetting } : {}),
    sort_order: scriptInt(value.sort_order, value.order) ?? 0,
  };
}

export function normalizeScriptCategory(value: unknown): ScriptCategory {
  if (!isRecord(value)) throw new Error("剧本分类数据格式无效");
  const id = scriptString(value.id, value.category_id) ?? "";
  const iconUrl = scriptString(value.icon_url);
  return {
    id,
    name: scriptString(value.name, value.title) ?? id,
    ...(iconUrl !== undefined ? { icon_url: iconUrl } : {}),
    sort_order: scriptInt(value.sort_order, value.order) ?? 0,
  };
}

export function normalizeScriptCreator(value: unknown): ScriptCreator {
  if (!isRecord(value)) return { user_id: "", nickname: "", avatar_url: "" };
  return {
    user_id: scriptString(value.user_id, value.id) ?? "",
    nickname: scriptString(value.nickname, value.name) ?? "",
    avatar_url: scriptString(value.avatar_url, value.avatar) ?? "",
  };
}

export function normalizeInteractiveScript(value: unknown): InteractiveScript {
  if (!isRecord(value)) throw new Error("互动剧本数据格式无效");
  const scriptId = scriptString(value.script_id, value.id);
  const title = scriptString(value.title);
  if (scriptId === undefined || scriptIsBlank(scriptId)) throw new Error("互动剧本缺少 script_id");
  if (title === undefined || scriptIsBlank(title)) throw new Error("互动剧本缺少 title");
  const singleCategoryId = scriptString(value.category_id);
  const categoryIds =
    scriptStringArray(value.category_ids) ??
    (singleCategoryId !== undefined ? [singleCategoryId] : []);
  const worldSetting = scriptString(value.world_setting);
  const hiddenReason = scriptString(value.hidden_reason);
  const createdAt = scriptString(value.created_at);
  const updatedAt = scriptString(value.updated_at);
  const roles = decodeScriptRoles(value.roles) ?? decodeScriptRoles(value.characters) ?? [];
  const creatorSource = isRecord(value.creator)
    ? value.creator
    : isRecord(value.author)
      ? value.author
      : undefined;
  return {
    script_id: scriptId,
    title,
    synopsis: scriptString(value.synopsis, value.intro) ?? "",
    cover_url: scriptString(value.cover_url, value.cover) ?? "",
    category_ids: categoryIds,
    visibility: normalizedScriptVisibility(value.visibility),
    status: normalizedScriptStatus(value.status),
    creator: normalizeScriptCreator(creatorSource),
    roles,
    ...(worldSetting !== undefined ? { world_setting: worldSetting } : {}),
    is_admin_hidden: scriptBool(value.is_admin_hidden) ?? false,
    ...(hiddenReason !== undefined ? { hidden_reason: hiddenReason } : {}),
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
  };
}

export function normalizeScriptCategories(value: unknown): ScriptCategory[] {
  const direct = decodeScriptCategories(value);
  if (direct) return sortScriptCategories(direct);
  if (!isRecord(value)) throw new Error("剧本分类响应格式无效");
  const decoded =
    decodeScriptCategories(value.categories) ??
    decodeScriptCategories(value.items) ??
    decodeScriptCategories(value.list) ??
    [];
  return sortScriptCategories(decoded);
}

export function normalizeScriptPage(value: unknown): ScriptPage {
  if (Array.isArray(value)) {
    return { scripts: value.map(normalizeInteractiveScript), has_more: false };
  }
  if (!isRecord(value)) throw new Error("剧本列表响应格式无效");
  const source = Object.hasOwn(value, "scripts")
    ? value.scripts
    : Object.hasOwn(value, "items")
      ? value.items
      : Object.hasOwn(value, "list")
        ? value.list
        : undefined;
  if (!Array.isArray(source)) throw new Error("剧本列表响应缺少 scripts");
  const cursor = scriptString(value.next_cursor, value.cursor);
  return {
    scripts: source.map(normalizeInteractiveScript),
    has_more: scriptBool(value.has_more) ?? false,
    ...(cursor !== undefined ? { next_cursor: cursor } : {}),
  };
}

function scriptString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  }
  return undefined;
}

function scriptInt(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (typeof value !== "string" || !/^[+-]?\d+$/u.test(value)) continue;
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function scriptBool(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    const integer = scriptInt(value);
    if (integer !== undefined) return integer !== 0;
    if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
  }
  return undefined;
}

function scriptStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.every((item) => typeof item === "string")) return value as string[];
  if (value.every((item) => typeof item === "number" && Number.isSafeInteger(item))) {
    return value.map(String);
  }
  return undefined;
}

function scriptIsBlank(value: string): boolean {
  return trimFoundationWhitespacesAndNewlines(value).length === 0;
}

function decodeScriptRoles(value: unknown): ScriptRole[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    return value.map(normalizeScriptRole);
  } catch {
    return undefined;
  }
}

function decodeScriptCategories(value: unknown): ScriptCategory[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    return value.map(normalizeScriptCategory);
  } catch {
    return undefined;
  }
}

function sortScriptCategories(categories: ScriptCategory[]): ScriptCategory[] {
  return categories.sort((left, right) => {
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export function normalizeScriptRoleAssignment(value: unknown): ScriptRoleAssignment {
  if (!isRecord(value)) throw new Error("剧本角色分配数据格式无效");
  const userId = scriptString(value.user_id);
  return {
    role_id: scriptString(value.role_id) ?? "",
    actor_type: exactScriptActorType(value.actor_type),
    ...(userId !== undefined ? { user_id: userId } : {}),
  };
}

export function normalizeScriptRoomSnapshot(value: unknown): ScriptRoomSnapshot {
  if (!isRecord(value)) throw new Error("剧本房间快照格式无效");
  const roles = decodeScriptRoles(value.roles) ?? decodeScriptRoles(value.characters) ?? [];
  return {
    title: scriptString(value.title) ?? "",
    synopsis: scriptString(value.synopsis, value.intro) ?? "",
    cover_url: scriptString(value.cover_url, value.cover) ?? "",
    roles,
  };
}

export function normalizeScriptRoom(value: unknown): ScriptRoom {
  if (!isRecord(value)) throw new Error("剧本房间数据格式无效");
  const snapshot = Object.hasOwn(value, "script_snapshot") ? value.script_snapshot : value.snapshot;
  return {
    room_id: scriptString(value.room_id, value.id) ?? "",
    script_id: scriptString(value.script_id) ?? "",
    group_id: scriptInt(value.group_id) ?? 0,
    status: exactScriptRoomStatus(value.status),
    player_role_id: scriptString(value.player_role_id) ?? "",
    assignments: decodeScriptRoleAssignments(value.assignments) ?? [],
    script_snapshot: normalizeScriptRoomSnapshot(snapshot),
  };
}

/** Mirrors Swift's `ScriptRoomEnvelope`: prefer a valid non-empty direct room, then `.room`. */
export function normalizeScriptRoomEnvelope(value: unknown): ScriptRoom {
  if (!isRecord(value)) throw new Error("剧本房间响应格式无效");
  try {
    const direct = normalizeScriptRoom(value);
    if (direct.room_id.length > 0) return direct;
  } catch {
    // The native decoder retries the required nested `room` member.
  }
  if (!isRecord(value.room)) throw new Error("剧本房间响应缺少 room");
  return normalizeScriptRoom(value.room);
}

export function normalizeScriptTurnResponse(value: unknown): ScriptTurnResponse {
  if (!isRecord(value)) throw new Error("剧本回合响应格式无效");
  const userMessage = isRecord(value.user_message)
    ? normalizeGroupMessage(value.user_message)
    : undefined;
  const aiMessage = isRecord(value.ai_message)
    ? normalizeGroupMessage(value.ai_message)
    : undefined;
  return {
    turn_id: scriptString(value.turn_id) ?? "",
    status: exactScriptTurnStatus(value.status, "queued"),
    ...(userMessage ? { user_message: userMessage } : {}),
    ...(aiMessage ? { ai_message: aiMessage } : {}),
  };
}

export function normalizeScriptTurnState(value: unknown): ScriptTurnState {
  if (!isRecord(value)) throw new Error("剧本回合状态格式无效");
  const errorCode = scriptString(value.error_code);
  const message = scriptString(value.message);
  return {
    room_id: scriptString(value.room_id) ?? "",
    turn_id: scriptString(value.turn_id) ?? "",
    status: exactScriptTurnStatus(value.status, "failed"),
    ...(errorCode !== undefined ? { error_code: errorCode } : {}),
    ...(message !== undefined ? { message } : {}),
  };
}

function decodeScriptRoleAssignments(value: unknown): ScriptRoleAssignment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    return value.map(normalizeScriptRoleAssignment);
  } catch {
    return undefined;
  }
}

function exactScriptActorType(value: unknown): "user" | "ai" {
  return value === "user" ? "user" : "ai";
}

function normalizedScriptVisibility(...values: unknown[]): "private" | "public" {
  return scriptString(...values) === "public" ? "public" : "private";
}

function normalizedScriptStatus(...values: unknown[]): "draft" | "ready" | "archived" {
  const value = scriptString(...values);
  return value === "ready" || value === "archived" ? value : "draft";
}

function exactScriptRoomStatus(value: unknown): "active" | "ended" {
  return value === "ended" ? "ended" : "active";
}

function exactScriptTurnStatus(
  value: unknown,
  fallback: "queued" | "failed",
): "queued" | "generating" | "completed" | "failed" {
  return value === "queued" || value === "generating" || value === "completed" || value === "failed"
    ? value
    : fallback;
}

export function normalizeGroupMessagesPage(value: unknown): {
  messages: GroupMessage[];
  hasMore: boolean;
} {
  if (!isRecord(value)) throw new Error("群消息列表响应格式无效");
  const messages = Array.isArray(value.messages) ? value.messages.map(normalizeGroupMessage) : [];
  return {
    messages: messages.sort(compareGroupMessages),
    hasMore: flexBool(value.has_more, value.hasMore) ?? false,
  };
}

export function normalizeGroupMessageSearchResult(value: unknown): GroupMessageSearchResult {
  if (!isRecord(value)) throw new Error("群消息搜索结果格式无效");
  const message = normalizeGroupMessage(value.message ?? value);
  const rawLocator = isRecord(value.locator) ? value.locator : {};
  const messageId = flexInt(rawLocator.message_id, rawLocator.messageId) ?? message.id;
  const historySequence =
    flexInt(rawLocator.history_sequence, rawLocator.historySequence) ?? message.history_sequence;
  const highlightedText = flexString(value.highlighted_text, value.highlightedText);
  return {
    message,
    locator: {
      message_id: messageId,
      ...(historySequence !== undefined ? { history_sequence: historySequence } : {}),
    },
    ...(highlightedText !== undefined ? { highlighted_text: highlightedText } : {}),
  };
}

export function normalizeGroupMessageSearchPage(value: unknown): GroupMessageSearchPage {
  if (!isRecord(value)) throw new Error("群消息搜索响应格式无效");
  const source = Array.isArray(value.results)
    ? value.results
    : Array.isArray(value.messages)
      ? value.messages
      : [];
  const results = source
    .map((item) => normalizeGroupMessageSearchResult(item))
    .filter((item) => item.locator.message_id !== 0);
  const nextCursor = flexString(value.next_cursor, value.nextCursor);
  return {
    results,
    ...(nextCursor !== undefined ? { next_cursor: nextCursor } : {}),
    has_more: flexBool(value.has_more, value.hasMore) ?? nextCursor !== undefined,
  };
}

export function normalizeConversation(value: unknown): Conversation {
  if (!isRecord(value)) throw new Error("会话数据格式无效");
  const groupId = flexInt(value.group_id, value.groupId, value.groupID);
  const id = flexString(value.id, value.conversation_id, value.conversationId, groupId) ?? "";
  const rawType = flexString(value.type);
  const type = normalizeConversationType(rawType, groupId, id);
  const lastMessage = flexContent(value.last_message, value.lastMessage);
  return {
    type,
    id,
    name: flexString(value.name, value.title) ?? id,
    avatar_url: flexString(value.avatar_url, value.avatarURL, value.avatar) ?? "",
    ...(lastMessage !== undefined ? { last_message: lastMessage } : {}),
    ...(flexString(value.last_message_time, value.lastMessageTime) !== undefined
      ? { last_message_time: flexString(value.last_message_time, value.lastMessageTime) }
      : {}),
    unread_count: flexInt(value.unread_count, value.unread, value.unreadCount) ?? 0,
    ...(flexString(value.subtitle) !== undefined ? { subtitle: flexString(value.subtitle) } : {}),
    ...(groupId !== undefined ? { group_id: groupId } : {}),
    ...(flexInt(value.member_count, value.memberCount) !== undefined
      ? { member_count: flexInt(value.member_count, value.memberCount) }
      : {}),
    ...optionalString(value, "conversation_kind", "conversationKind"),
    ...optionalString(value, "script_room_id", "scriptRoomID"),
    ...optionalString(value, "script_id", "scriptID"),
    ...optionalString(value, "agent_conversation_id", "agentConversationID"),
    ...optionalString(value, "agent_id", "agentID"),
    ...optionalString(value, "agent_avatar_asset_id", "agentAvatarAssetID"),
    ...optionalString(value, "agent_greeting_id", "agentGreetingID"),
    ...(flexInt(value.last_message_id, value.lastMessageId, value.lastMessageID) !== undefined
      ? {
          last_message_id: flexInt(value.last_message_id, value.lastMessageId, value.lastMessageID),
        }
      : {}),
    ...(flexInt(
      value.read_through_message_id,
      value.readThroughMessageId,
      value.readThroughMessageID,
    ) !== undefined
      ? {
          read_through_message_id: flexInt(
            value.read_through_message_id,
            value.readThroughMessageId,
            value.readThroughMessageID,
          ),
        }
      : {}),
    ...(flexInt(value.revision) !== undefined ? { revision: flexInt(value.revision) } : {}),
    is_muted: flexBool(value.is_muted, value.isMuted) ?? false,
    ...(flexBool(value.is_pinned, value.isPinned) !== undefined
      ? { is_pinned: flexBool(value.is_pinned, value.isPinned) }
      : {}),
  };
}

export function normalizeConversationSnapshot(value: unknown): ConversationSyncSnapshot {
  if (!isRecord(value)) throw new Error("会话快照格式无效");
  const conversations = Array.isArray(value.conversations)
    ? value.conversations.map(normalizeConversation).filter((item) => item.id.length > 0)
    : [];
  return {
    conversations,
    ...(flexInt(value.revision) !== undefined ? { revision: flexInt(value.revision) } : {}),
    ...(flexString(value.server_time, value.serverTime) !== undefined
      ? { server_time: flexString(value.server_time, value.serverTime) }
      : {}),
    ...(flexInt(value.total_unread_count, value.totalUnreadCount) !== undefined
      ? { total_unread_count: flexInt(value.total_unread_count, value.totalUnreadCount) }
      : {}),
    ...(flexBool(value.snapshot_complete, value.is_complete) !== undefined
      ? { snapshot_complete: flexBool(value.snapshot_complete, value.is_complete) }
      : {}),
  };
}

export function normalizeConversationReadReceipt(value: unknown): ConversationReadReceipt {
  if (!isRecord(value)) throw new Error("会话已读回执格式无效");
  return {
    conversation_type: flexString(value.conversation_type, value.conversationType) ?? "",
    conversation_id:
      flexString(value.conversation_id, value.conversationId, value.conversationID) ?? "",
    read_through_message_id:
      flexInt(
        value.read_through_message_id,
        value.readThroughMessageId,
        value.readThroughMessageID,
      ) ?? 0,
    unread_count: Math.max(0, flexInt(value.unread_count, value.unreadCount) ?? 0),
    ...(flexInt(value.total_unread_count, value.totalUnreadCount) !== undefined
      ? {
          total_unread_count: Math.max(
            0,
            flexInt(value.total_unread_count, value.totalUnreadCount)!,
          ),
        }
      : {}),
    ...(flexInt(value.revision) !== undefined ? { revision: flexInt(value.revision) } : {}),
    ...(flexString(value.server_time, value.serverTime) !== undefined
      ? { server_time: flexString(value.server_time, value.serverTime) }
      : {}),
  };
}

export function normalizeMessage(value: unknown): Message {
  if (!isRecord(value)) throw new Error("消息数据格式无效");
  const content = flexContent(value.content, value.payload, value.gift) ?? "";
  const rawType =
    flexString(value.msg_type, value.msgType, value.message_type, value.type) ?? "text";
  const recalledAt = flexString(value.recalled_at, value.recalledAt);
  const status = flexString(value.status)?.toLocaleLowerCase().replaceAll("-", "_");
  const normalizedType = rawType.toLocaleLowerCase().replaceAll("-", "_");
  const recallValues = ["recall", "recalled", "withdrawn", "revoked", "message_recalled"];
  const msgType =
    flexBool(value.is_recalled, value.isRecalled) === true ||
    recalledAt !== undefined ||
    recallValues.includes(normalizedType) ||
    (status !== undefined && recallValues.includes(status))
      ? "recalled"
      : rawType;
  const reply = normalizeReplyPreview(value.reply_to ?? value.replyTo);
  return {
    id: flexInt(value.id, value.message_id, value.messageId) ?? 0,
    sender_id:
      flexString(
        value.sender_id,
        value.senderId,
        value.from_user_id,
        value.fromUserId,
        value.user_id,
      ) ?? "",
    receiver_id:
      flexString(
        value.receiver_id,
        value.receiverId,
        value.recipient_id,
        value.recipientId,
        value.to_user_id,
        value.toUserId,
      ) ?? "",
    msg_type: msgType,
    content,
    timestamp:
      flexString(value.timestamp, value.created_at, value.createdAt, value.time) ??
      new Date().toISOString(),
    ...(flexInt(value.reply_to_id, value.replyToId) !== undefined
      ? { reply_to_id: flexInt(value.reply_to_id, value.replyToId) }
      : {}),
    ...(reply ? { reply_to: reply } : {}),
    ...optionalMessageString(
      "client_message_id",
      value.client_message_id,
      value.clientMessageId,
      value.client_id,
    ),
    version: flexInt(value.version) ?? 1,
    ...optionalMessageString("updated_at", value.updated_at),
    ...optionalMessageString(
      "thumbnail_url",
      value.thumbnail_url,
      value.thumbnailURL,
      value.preview_url,
      value.previewURL,
    ),
  };
}

export function normalizeMessagesPage(value: unknown): { messages: Message[]; hasMore: boolean } {
  if (!isRecord(value)) throw new Error("消息列表响应格式无效");
  const messages = Array.isArray(value.messages)
    ? value.messages.map(normalizeMessage).filter((message) => message.id !== 0)
    : [];
  return {
    messages: messages.sort(compareMessages),
    hasMore: flexBool(value.has_more, value.hasMore) ?? false,
  };
}

export function normalizeDirectHistoryClearReceipt(
  value: unknown,
  fallbackConversationId = "",
): DirectHistoryClearReceipt {
  if (!isRecord(value)) throw new Error("清空聊天记录响应格式无效");
  return {
    conversation_id:
      flexString(value.conversation_id, value.conversationID, value.contact_id, value.contactID) ??
      fallbackConversationId,
    cleared_before_message_id:
      flexInt(
        value.cleared_before_message_id,
        value.clearedBeforeMessageID,
        value.cleared_before_id,
        value.clearedBeforeID,
      ) ?? 0,
    ...(flexString(value.cleared_at, value.clearedAt) !== undefined
      ? { cleared_at: flexString(value.cleared_at, value.clearedAt) }
      : {}),
    revision: flexInt(value.revision) ?? 0,
  };
}

function flexContent(...values: unknown[]): string | undefined {
  for (const value of values) {
    const direct = flexString(value);
    if (direct !== undefined) return direct;
    if (isRecord(value)) {
      const nested = flexString(value.text, value.content, value.preview);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function normalizeConversationType(
  rawType: string | undefined,
  groupId: number | undefined,
  id: string,
): string {
  const normalized = rawType?.toLocaleLowerCase().replaceAll("-", "_");
  if (
    ["group", "group_chat", "groupchat"].includes(normalized ?? "") ||
    groupId !== undefined ||
    id.startsWith("group:")
  ) {
    return "group";
  }
  if (["agent", "agent_conversation", "agent_profile"].includes(normalized ?? "")) return "agent";
  return "dm";
}

function optionalString(
  record: UnknownRecord,
  snakeKey: string,
  camelKey: string,
): Record<string, string> {
  const value = flexString(record[snakeKey], record[camelKey]);
  return value === undefined ? {} : { [snakeKey]: value };
}

function normalizeReplyPreview(value: unknown): ReplyPreview | undefined {
  if (!isRecord(value)) return undefined;
  const id = flexInt(value.id, value.message_id);
  if (id === undefined) return undefined;
  return {
    id,
    sender_id: flexString(value.sender_id, value.senderId) ?? "",
    msg_type: flexString(value.msg_type, value.msgType, value.message_type, value.type) ?? "text",
    content: flexContent(value.content, value.payload) ?? "",
  };
}

function normalizeGroupReplyPreview(value: unknown): GroupReplyPreview | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "number" ||
    !Number.isSafeInteger(value.id) ||
    typeof value.sender_id !== "string" ||
    typeof value.msg_type !== "string" ||
    typeof value.content !== "string"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    sender_id: value.sender_id,
    msg_type: value.msg_type,
    content: value.content,
  };
}

function optionalMessageString(
  key: "client_message_id" | "updated_at" | "thumbnail_url",
  ...values: unknown[]
): Partial<Message> {
  const value = flexString(...values);
  return value === undefined ? {} : { [key]: value };
}

function optionalNativeGroupMessageString(
  key: "client_message_id" | "updated_at" | "thumbnail_url",
  ...values: unknown[]
): Partial<GroupMessage> {
  const value = groupFlexString(...values);
  return value === undefined ? {} : { [key]: value };
}

function optionalNativeGroupThumbnail(...values: unknown[]): Partial<GroupMessage> {
  const value = groupFlexString(...values);
  if (value === undefined) return {};
  const trimmed = trimFoundationWhitespacesAndNewlines(value);
  return trimmed ? { thumbnail_url: trimmed } : {};
}

function optionalPublicProfileString(
  key: "website_url" | "contact_email" | "contact_url" | "account_created_at",
  ...values: unknown[]
): Partial<PublicProfile> {
  const value = flexString(...values);
  return value === undefined ? {} : { [key]: value };
}

function optionalAgentMetadataString(
  key:
    | "media_type"
    | "generation_status"
    | "access"
    | "preview_url"
    | "content_url"
    | "download_url"
    | "error_code",
  ...values: unknown[]
): Partial<AgentPartMetadata> {
  const value = flexString(...values);
  return value === undefined ? {} : { [key]: value };
}

function lossyStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const normalized = flexString(item);
      return normalized === undefined ? [] : [normalized];
    });
  }
  const encoded = flexString(value);
  if (encoded === undefined) return undefined;
  return encoded
    .split(/[,，]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fillShortDramaCreator(
  creator: ShortDramaCreator,
  fallback: ShortDramaCreator,
): ShortDramaCreator {
  const resolvedUserId = shortDramaIsBlank(creator.user_id) ? fallback.user_id : creator.user_id;
  const identitiesMatch = resolvedUserId === fallback.user_id;
  const defaultNickname = localizedString(getActiveLanguageCode(), "profile.defaultUser");
  return {
    user_id: resolvedUserId,
    username:
      shortDramaIsBlank(creator.username) && identitiesMatch ? fallback.username : creator.username,
    nickname:
      (shortDramaIsBlank(creator.nickname) || creator.nickname === defaultNickname) &&
      identitiesMatch
        ? fallback.nickname
        : creator.nickname,
    avatar_url:
      shortDramaIsBlank(creator.avatar_url) && identitiesMatch
        ? fallback.avatar_url
        : creator.avatar_url,
    followed_by_me: creator.followed_by_me || (identitiesMatch ? fallback.followed_by_me : false),
    follows_me: creator.follows_me || (identitiesMatch ? fallback.follows_me : false),
    is_friend: creator.is_friend || (identitiesMatch ? fallback.is_friend : false),
  };
}

function compareMessages(left: Message, right: Message): number {
  const leftDate = Date.parse(normalizeBackendTimestamp(left.timestamp));
  const rightDate = Date.parse(normalizeBackendTimestamp(right.timestamp));
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) {
    return leftDate - rightDate;
  }
  return left.id - right.id;
}

function compareGroupMessages(left: GroupMessage, right: GroupMessage): number {
  const leftDate = Date.parse(normalizeBackendTimestamp(left.timestamp));
  const rightDate = Date.parse(normalizeBackendTimestamp(right.timestamp));
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) {
    return leftDate - rightDate;
  }
  return left.id - right.id;
}

function normalizeBackendTimestamp(value: string): string {
  return value.includes("T") ? value : value.replace(" ", "T") + "Z";
}
