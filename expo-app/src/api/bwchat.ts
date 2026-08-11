import { APIError, apiRequest } from "@/api/client";
import { readRefreshToken } from "@/storage/tokenStorage";
import { File } from "expo-file-system";
import {
  isRecord,
  normalizeActivityCatFoodTransactionPage,
  normalizeAgentSummaryPage,
  normalizeAgentRuntimeConfig,
  normalizeAgentConversation,
  normalizeAgentMediaUnlock,
  normalizeAgentMessagePage,
  normalizeAgentSummary,
  normalizeAgentTurnAccepted,
  normalizeAgentTurnResult,
  normalizeChatGroup,
  normalizeCallConnectionCredentials,
  normalizeAuthSession,
  normalizeContact,
  normalizeConversationSnapshot,
  normalizeConversationPreference,
  normalizeConversationReadReceipt,
  normalizeDirectHistoryClearReceipt,
  normalizeFollowRelationship,
  normalizeFollowUsersPage,
  normalizeRequiredFriendInfo,
  normalizeRequiredFriendRequest,
  normalizeGroupMessage,
  normalizeGroupCallStatus,
  normalizeGroupMessageSearchPage,
  normalizeGroupMessagesPage,
  normalizeGroupDetail,
  normalizeGroupHistoryClearReceipt,
  normalizeMessage,
  normalizeMessagesPage,
  normalizeMoment,
  normalizeMomentComment,
  normalizeMomentFeedPage,
  normalizeMomentsNotifications,
  normalizeMomentsUnreadInfo,
  normalizeMomentUnlockResult,
  normalizePublicProfile,
  normalizeSearchUser,
  normalizeConversation,
  normalizeInteractiveScript,
  normalizeScriptCategories,
  normalizeScriptPage,
  normalizeScriptRoom,
  normalizeScriptRoomEnvelope,
  normalizeScriptTurnResponse,
  normalizeShortDramaComment,
  normalizeShortDramaCommentsPage,
  normalizeShortDramaEpisodeUploadResult,
  normalizeShortDramaFeedPage,
  normalizeShortDramaInteractionResult,
  normalizeShortDramaSeries,
  normalizeShortDramaSeriesPage,
  normalizeShortDramaUnlockResult,
  normalizeShortDramaVideo,
  normalizeNativeUser,
  normalizeUser,
  normalizeVerifyData,
  normalizeWalletAdRewardSession,
  normalizeWalletAdRewardStatus,
  normalizeWalletBalanceSnapshot,
  normalizeWalletIapConfirmation,
  normalizeWalletTransactionPage,
  normalizeWalletWithdrawal,
  normalizeWalletWithdrawals,
  trimFoundationWhitespacesAndNewlines,
} from "@/api/normalizers";
import type {
  ActivityCatFoodTransactionPage,
  AuthSession,
  AgentSummaryPage,
  AgentRuntimeConfig,
  AgentReferenceUpload,
  AgentConversation,
  AgentMessagePage,
  AgentMediaUnlock,
  AgentSummary,
  AgentTurnAccepted,
  AgentTurnResult,
  AgentVersion,
  ChatGroup,
  CallConnectionCredentials,
  CallQualityReport,
  CallQualityStreamReport,
  CallType,
  LiveBillingPolicy,
  LiveExperienceSnapshot,
  PropConsumptionResult,
  ChatMoneyActionResult,
  ChatMoneyConfiguration,
  ChatMoneyCreationResult,
  ChatMoneyDetail,
  ChatMoneyPayload,
  ChatMoneyRedPacketMode,
  ChatMoneyScope,
  Contact,
  Conversation,
  ConversationSyncSnapshot,
  ConversationPreference,
  ConversationReadReceipt,
  DirectHistoryClearReceipt,
  FollowRelationship,
  FollowUsersPage,
  FriendInfo,
  FriendRequest,
  ForwardBundle,
  ForwardCreatedMessage,
  ForwardOperationResult,
  ForwardRequest,
  GiftCatalogItem,
  GiftMessagePayload,
  GroupMessage,
  GroupCallStartCredentials,
  GroupCallStatus,
  GroupMessageSearchPage,
  GroupDetail,
  GroupHistoryClearReceipt,
  GroupMember,
  Message,
  Moment,
  MomentComment,
  MomentFeedPage,
  MomentsNotification,
  MomentsUnreadInfo,
  MomentUploadAsset,
  MomentUnlockResult,
  PublicProfile,
  SearchUser,
  ScriptCategory,
  InteractiveScript,
  ScriptPage,
  ScriptScope,
  ScriptRoom,
  ScriptRoomCreationData,
  ScriptTurnResponse,
  ShortDramaComment,
  ShortDramaCommentsPage,
  ShortDramaEpisodeUploadResult,
  ShortDramaFeedPage,
  ShortDramaInteractionResult,
  ShortDramaSeries,
  ShortDramaSeriesFilter,
  ShortDramaSeriesPage,
  ShortDramaUnlockResult,
  ShortDramaVideo,
  User,
  VerifyData,
  WalletAdRewardSession,
  WalletAdRewardStatus,
  WalletBalanceSnapshot,
  WalletIapConfirmation,
  WalletTransactionPage,
  WalletWithdrawal,
} from "@/models";
import { formatChatVoiceUploadDuration } from "@/services/messages/chatVoicePolicy";
import {
  encodeGiftMessagePayload,
  fixedGiftCatalog,
  makeGiftMessagePayload,
  normalizeGiftCatalog,
  parseGiftMessagePayload,
} from "@/services/messages/chatGiftPolicy";
import {
  normalizeChatMoneyConfiguration,
  normalizeChatMoneyDetail,
  normalizeChatMoneyPayload,
  parseChatMoneyPayload,
} from "@/services/messages/chatMoneyPolicy";
import { profileAvatarUploadPolicy } from "@/services/profile/editProfilePolicy";
import { readCachedNativePushToken } from "@/services/push/PushTokenStore";
import {
  cacheContactList,
  cacheFriendList,
  cachePublicProfile,
  cacheSearchUsers,
  cacheUserInfoBatch,
} from "@/services/cache/UserInfoCache";

export async function login(username: string, password: string): Promise<AuthSession> {
  const deviceToken = await readCachedNativePushToken().catch(() => null);
  return normalizeNativeAuthSession(
    await apiRequest<unknown>("/auth/login", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: { username, password, ...(deviceToken ? { device_token: deviceToken } : {}) },
    }),
  );
}

export async function register(
  username: string,
  password: string,
  nickname: string,
): Promise<AuthSession> {
  const deviceToken = await readCachedNativePushToken().catch(() => null);
  return normalizeNativeAuthSession(
    await apiRequest<unknown>("/auth/register", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: {
        username,
        password,
        ...(nickname.length > 0 ? { nickname } : {}),
        ...(deviceToken ? { device_token: deviceToken } : {}),
      },
    }),
  );
}

export async function verifySession(): Promise<VerifyData> {
  try {
    return normalizeVerifyData(
      await apiRequest<unknown>("/auth/verify", {
        requiredData: true,
        requiredEnvelope: true,
      }),
    );
  } catch (error) {
    throw normalizedAuthError(error);
  }
}

export async function refreshSession(): Promise<AuthSession> {
  const refreshToken = await readRefreshToken();
  if (!refreshToken) throw new APIError("登录状态已失效", 401);
  return normalizeNativeAuthSession(
    await apiRequest<unknown>("/auth/refresh", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: { refresh_token: refreshToken },
    }),
  );
}

export async function logout(): Promise<void> {
  await apiRequest<unknown>("/auth/logout", {
    method: "POST",
    body: {},
    requiredEnvelope: true,
  });
}

function normalizeNativeAuthSession(value: unknown): AuthSession {
  try {
    return normalizeAuthSession(value);
  } catch (error) {
    throw normalizedAuthError(error);
  }
}

function normalizedAuthError(error: unknown): unknown {
  return error instanceof APIError
    ? error
    : new APIError("api.decodingError", 200, undefined, "decoding_error");
}

export async function getConversationSyncSnapshot(): Promise<ConversationSyncSnapshot> {
  return normalizeConversationSnapshot(
    await apiRequest<unknown>("/chat/conversations", {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
    }),
  );
}

export async function getConversations(): Promise<Conversation[]> {
  return (await getConversationSyncSnapshot()).conversations;
}

export async function getContacts(): Promise<Contact[]> {
  const value = await apiRequest<unknown>("/chat/contacts");
  const contacts = isRecord(value) && Array.isArray(value.contacts) ? value.contacts : [];
  const normalized = contacts.map(normalizeContact).filter((contact) => contact.user_id.length > 0);
  await cacheContactList(normalized);
  return normalized;
}

export async function searchUsers(keyword: string): Promise<SearchUser[]> {
  const query = new URLSearchParams({ keyword });
  const value = await apiRequest<unknown>(`/friends/search?${query.toString()}`, {
    requiredData: true,
    requiredEnvelope: true,
  });
  if (!isRecord(value) || !Array.isArray(value.users)) {
    throw new Error("用户搜索响应格式无效");
  }
  const users = value.users;
  const normalized = users.map(normalizeSearchUser).filter((user) => user.user_id.length > 0);
  await cacheSearchUsers(normalized).catch(() => undefined);
  return normalized;
}

export async function getFriendList(): Promise<FriendInfo[]> {
  const value = await apiRequest<unknown>("/friends/list", {
    requiredData: true,
    requiredEnvelope: true,
  });
  if (!isRecord(value) || !Array.isArray(value.friends)) {
    throw nativeDecodingError(value);
  }
  let normalized: FriendInfo[];
  try {
    normalized = value.friends.map(normalizeRequiredFriendInfo);
  } catch {
    throw nativeDecodingError(value);
  }
  // Native UserCacheManager persistence is best-effort and never changes API success into failure.
  await cacheFriendList(normalized).catch(() => undefined);
  return normalized;
}

export async function getFriendRequests(): Promise<FriendRequest[]> {
  const value = await apiRequest<unknown>("/friends/requests", {
    requiredData: true,
    requiredEnvelope: true,
  });
  if (!isRecord(value) || !Array.isArray(value.requests)) {
    throw new Error("好友请求响应格式无效");
  }
  return value.requests.map(normalizeRequiredFriendRequest);
}

export async function getGroups(): Promise<ChatGroup[]> {
  const value = await apiRequest<unknown>("/groups/list", {
    requiredData: true,
    requiredEnvelope: true,
  });
  if (!isRecord(value) || !Array.isArray(value.groups)) {
    throw new Error("群列表响应格式无效");
  }
  return value.groups.map(normalizeChatGroup).filter((group) => group.group_id > 0);
}

export async function createGroup(
  name: string,
  memberIds: readonly string[],
  isPublic = false,
): Promise<void> {
  await apiRequest<unknown>("/groups/create", {
    method: "POST",
    body: { name, member_ids: [...memberIds], is_public: isPublic },
    requiredEnvelope: true,
    requiredSuccessCode: true,
  });
}

export async function getGroupDetail(groupId: number): Promise<GroupDetail> {
  return normalizeNativeGroupDetail(
    await apiRequest<unknown>(`/groups/${groupId}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function renameGroup(groupId: number, name: string): Promise<void> {
  await apiRequest<unknown>(`/groups/${groupId}/rename`, {
    method: "POST",
    body: { name },
    requiredEnvelope: true,
  });
}

export async function updateGroupVisibility(groupId: number, isPublic: boolean): Promise<void> {
  await apiRequest<unknown>(`/groups/${groupId}/visibility`, {
    method: "POST",
    body: { is_public: isPublic },
    requiredEnvelope: true,
  });
}

export async function leaveGroup(groupId: number): Promise<void> {
  await apiRequest<unknown>(`/groups/${groupId}/leave`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
  });
}

export async function dismissGroup(groupId: number): Promise<void> {
  await apiRequest<unknown>(`/groups/${groupId}/dismiss`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
  });
}

export async function startDirectCall(
  targetId: string,
  callType: CallType,
): Promise<CallConnectionCredentials> {
  return normalizeCallConnectionCredentials(
    await apiRequest<unknown>("/call/start", {
      method: "POST",
      body: { target_id: targetId, call_type: callType },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    }),
  );
}

export async function joinCall(roomName: string): Promise<CallConnectionCredentials> {
  return normalizeNativeCallJoinResponse(
    requireNativeCallJoinResponse(
      await apiRequest<unknown>("/call/join", {
        method: "POST",
        body: { room_name: roomName },
        requiredData: true,
        requiredEnvelope: true,
        transientRetries: false,
      }),
    ),
  );
}

function requireNativeCallJoinResponse(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value.room_name !== "string" || typeof value.token !== "string") {
    throw new Error("通话加入响应格式无效");
  }
  requireOptionalString(value, "call_id", "通话加入响应格式无效");
  requireOptionalString(value, "livekit_url", "通话加入响应格式无效");
  if (
    typeof value.livekit_url !== "string" ||
    trimFoundationWhitespacesAndNewlines(value.livekit_url).length === 0
  ) {
    requireOptionalString(value, "server_url", "通话加入响应格式无效");
  }
  if (
    value.call_type !== undefined &&
    value.call_type !== null &&
    value.call_type !== "voice" &&
    value.call_type !== "video"
  ) {
    throw new Error("通话加入响应格式无效");
  }
  if (
    value.billing_policy !== undefined &&
    value.billing_policy !== null &&
    !isRecord(value.billing_policy)
  ) {
    throw new Error("通话加入响应格式无效");
  }
  if (
    value.live_experience !== undefined &&
    value.live_experience !== null &&
    !isRecord(value.live_experience)
  ) {
    throw new Error("通话加入响应格式无效");
  }
  if (
    (value.live_experience === undefined || value.live_experience === null) &&
    value.experience !== undefined &&
    value.experience !== null &&
    !isRecord(value.experience)
  ) {
    throw new Error("通话加入响应格式无效");
  }
  return value;
}

function normalizeNativeCallJoinResponse(
  value: Record<string, unknown>,
): CallConnectionCredentials {
  const livekitUrl =
    typeof value.livekit_url === "string" &&
    trimFoundationWhitespacesAndNewlines(value.livekit_url).length > 0
      ? value.livekit_url
      : typeof value.server_url === "string" &&
          trimFoundationWhitespacesAndNewlines(value.server_url).length > 0
        ? value.server_url
        : "http://52.193.78.191/livekit";
  const billingPolicy = isRecord(value.billing_policy)
    ? normalizeNativeLiveBillingPolicy(value.billing_policy)
    : undefined;
  const experienceSource = isRecord(value.live_experience)
    ? value.live_experience
    : isRecord(value.experience)
      ? value.experience
      : undefined;
  const liveExperience = experienceSource
    ? normalizeNativeLiveExperienceSnapshot(experienceSource, flexNativeString(value.server_time))
    : undefined;
  return {
    ...(typeof value.call_id === "string" ? { call_id: value.call_id } : {}),
    room_name: value.room_name as string,
    token: value.token as string,
    livekit_url: livekitUrl,
    ...(value.call_type === "voice" || value.call_type === "video"
      ? { call_type: value.call_type }
      : {}),
    ...(billingPolicy ? { billing_policy: billingPolicy } : {}),
    ...(liveExperience ? { live_experience: liveExperience } : {}),
  };
}

function normalizeNativeLiveBillingPolicy(value: Record<string, unknown>): LiveBillingPolicy {
  const decodedCurrency = flexNativeString(value.currency) ?? "spendable_balance";
  const decodedRounding = flexNativeString(value.rounding) ?? "started_unit";
  const freeSeconds = flexNativeInt(value.free_seconds) ?? 10;
  const unitSeconds = flexNativeInt(value.unit_seconds) ?? 60;
  const amountPerUnit = flexNativeInt(value.amount_per_unit) ?? 100;
  const minimumStartingBalance = flexNativeInt(value.minimum_starting_balance) ?? 100;
  const normalizedCurrency = trimFoundationWhitespacesAndNewlines(decodedCurrency);
  const normalizedRounding = trimFoundationWhitespacesAndNewlines(decodedRounding);
  const normalizedAmount = amountPerUnit > 0 ? amountPerUnit : 100;
  return {
    currency: normalizedCurrency.length > 0 ? normalizedCurrency : "spendable_balance",
    freeSeconds: Math.max(freeSeconds, 0),
    unitSeconds: unitSeconds > 0 ? unitSeconds : 60,
    amountPerUnit: normalizedAmount,
    minimumStartingBalance: minimumStartingBalance > 0 ? minimumStartingBalance : normalizedAmount,
    rounding: normalizedRounding.length > 0 ? normalizedRounding : "started_unit",
  };
}

function normalizeNativeLiveExperienceSnapshot(
  value: Record<string, unknown>,
  outerServerTime: string | undefined,
): LiveExperienceSnapshot {
  const definitionId =
    flexNativeString(value.definition_id) ?? flexNativeString(value.prop_definition_id) ?? "";
  const durationSeconds =
    flexNativeInt(value.duration_seconds) ?? nativeLiveExperienceDuration(definitionId) ?? 0;
  const rawStatus =
    typeof value.status === "string"
      ? trimFoundationWhitespacesAndNewlines(value.status).toLocaleLowerCase().replaceAll("-", "_")
      : "";
  const status: LiveExperienceSnapshot["status"] = [
    "reserved",
    "active",
    "consumed",
    "released",
    "completed",
  ].includes(rawStatus)
    ? (rawStatus as LiveExperienceSnapshot["status"])
    : "unknown";
  const startedAt = flexNativeString(value.started_at) ?? flexNativeString(value.connected_at);
  const endsAt = flexNativeString(value.ends_at) ?? flexNativeString(value.experience_ends_at);
  const remainingSeconds = flexNativeInt(value.remaining_seconds);
  const autoContinuePaymentMethod = flexNativeString(value.auto_continue_payment_method);
  const reservedProp = decodeNativePropConsumption(value.reserved_prop);
  const consumedProp = decodeNativePropConsumption(value.consumed_prop);
  const innerServerTime = flexNativeString(value.server_time);
  return {
    definitionId,
    durationSeconds: Math.max(durationSeconds, 0),
    status,
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(endsAt !== undefined ? { endsAt } : {}),
    ...(remainingSeconds !== undefined ? { remainingSeconds: Math.max(remainingSeconds, 0) } : {}),
    ...(autoContinuePaymentMethod !== undefined ? { autoContinuePaymentMethod } : {}),
    hostEarningEnabled: flexNativeBool(value.host_earning_enabled) ?? false,
    ...(reservedProp ? { reservedProp } : {}),
    ...(consumedProp ? { consumedProp } : {}),
    ...((outerServerTime ?? innerServerTime) !== undefined
      ? { serverTime: outerServerTime ?? innerServerTime }
      : {}),
    receivedAt: Date.now(),
  };
}

function decodeNativePropConsumption(value: unknown): PropConsumptionResult | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    !isRecord(value) ||
    typeof value.definition_id !== "string" ||
    typeof value.remaining_quantity !== "number" ||
    !Number.isInteger(value.remaining_quantity) ||
    (value.inventory_id !== undefined &&
      value.inventory_id !== null &&
      typeof value.inventory_id !== "string")
  ) {
    throw new Error("通话加入响应格式无效");
  }
  return {
    ...(typeof value.inventory_id === "string" ? { inventory_id: value.inventory_id } : {}),
    definition_id: value.definition_id,
    remaining_quantity: value.remaining_quantity,
  };
}

function flexNativeString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function flexNativeInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return undefined;
  const normalized = trimFoundationWhitespacesAndNewlines(value).replaceAll(",", "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function flexNativeBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isInteger(value)) return value !== 0;
  if (typeof value !== "string") return undefined;
  switch (value.toLocaleLowerCase()) {
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

function nativeLiveExperienceDuration(definitionId: string): number | undefined {
  if (definitionId === "live_experience_card_5m") return 300;
  if (definitionId === "live_experience_card_10m") return 600;
  if (definitionId === "live_experience_card_15m") return 900;
  return undefined;
}

export async function endCall(callId: string): Promise<void> {
  await apiRequest<unknown>(`/call/${encodeURIComponent(callId)}/end`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
    transientRetries: false,
  });
}

export async function rejectCall(callId: string): Promise<void> {
  await apiRequest<unknown>(`/call/${encodeURIComponent(callId)}/reject`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
    transientRetries: false,
  });
}

export async function markCallBusy(callId: string): Promise<void> {
  await apiRequest<unknown>(`/call/${encodeURIComponent(callId)}/busy`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
    transientRetries: false,
  });
}

export async function startGroupCall(
  groupId: number,
  callType: CallType,
  inviteeUserIds: readonly string[] = [],
): Promise<GroupCallStartCredentials> {
  const normalizedInviteeUserIds = [
    ...new Set(inviteeUserIds.map((userId) => userId.trim()).filter(Boolean)),
  ];
  return normalizeNativeGroupCallStartResponse(
    requireNativeGroupCallStartResponse(
      await apiRequest<unknown>(`/call/group/${groupId}/start`, {
        method: "POST",
        body: {
          call_type: callType,
          ...(normalizedInviteeUserIds.length > 0
            ? { invitee_user_ids: normalizedInviteeUserIds }
            : {}),
        },
        requiredData: true,
        requiredEnvelope: true,
        transientRetries: false,
      }),
    ),
  );
}

export async function leaveGroupCall(
  groupId: number,
  options: { callId?: string; roomName?: string } = {},
): Promise<void> {
  await apiRequest<unknown>(`/call/group/${groupId}/leave`, {
    method: "POST",
    body: {
      ...(options.callId !== undefined && options.callId.length > 0
        ? { call_id: options.callId }
        : {}),
      ...(options.roomName !== undefined && options.roomName.length > 0
        ? { room_name: options.roomName }
        : {}),
    },
    requiredEnvelope: true,
    transientRetries: false,
  });
}

export async function getGroupCallStatus(groupId: number): Promise<GroupCallStatus> {
  return normalizeGroupCallStatus(
    requireNativeGroupCallStatusResponse(
      await apiRequest<unknown>(`/call/group/${groupId}/status`, {
        requiredData: true,
        requiredEnvelope: true,
      }),
    ),
  );
}

function requireNativeGroupCallStartResponse(value: unknown): Record<string, unknown> {
  if (
    !isRecord(value) ||
    typeof value.room_name !== "string" ||
    typeof value.token !== "string" ||
    typeof value.call_type !== "string"
  ) {
    throw new Error("群通话连接响应格式无效");
  }
  requireOptionalString(value, "call_id", "群通话连接响应格式无效");
  requireOptionalString(value, "livekit_url", "群通话连接响应格式无效");
  if (
    typeof value.livekit_url !== "string" ||
    trimFoundationWhitespacesAndNewlines(value.livekit_url).length === 0
  ) {
    requireOptionalString(value, "server_url", "群通话连接响应格式无效");
  }
  if (
    value.participant_count !== undefined &&
    value.participant_count !== null &&
    (!Number.isInteger(value.participant_count) || typeof value.participant_count !== "number")
  ) {
    throw new Error("群通话连接响应格式无效");
  }
  return value;
}

function normalizeNativeGroupCallStartResponse(
  value: Record<string, unknown>,
): GroupCallStartCredentials {
  const livekitUrl =
    typeof value.livekit_url === "string" &&
    trimFoundationWhitespacesAndNewlines(value.livekit_url).length > 0
      ? value.livekit_url
      : typeof value.server_url === "string" &&
          trimFoundationWhitespacesAndNewlines(value.server_url).length > 0
        ? value.server_url
        : "http://52.193.78.191/livekit";
  return {
    ...(typeof value.call_id === "string" ? { call_id: value.call_id } : {}),
    room_name: value.room_name as string,
    token: value.token as string,
    livekit_url: livekitUrl,
    call_type: value.call_type as string,
    ...(typeof value.participant_count === "number"
      ? { participant_count: value.participant_count }
      : {}),
  };
}

function requireNativeGroupCallStatusResponse(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value.active !== "boolean") {
    throw new Error("群通话状态响应格式无效");
  }
  requireOptionalString(value, "call_id", "群通话状态响应格式无效");
  requireOptionalString(value, "room_name", "群通话状态响应格式无效");
  requireOptionalString(value, "call_type", "群通话状态响应格式无效");
  if (
    value.participant_count !== undefined &&
    value.participant_count !== null &&
    (!Number.isInteger(value.participant_count) || typeof value.participant_count !== "number")
  ) {
    throw new Error("群通话状态响应格式无效");
  }
  return value;
}

function requireOptionalString(value: Record<string, unknown>, key: string, message: string): void {
  if (value[key] !== undefined && value[key] !== null && typeof value[key] !== "string") {
    throw new Error(message);
  }
}

export async function removeGroupMember(groupId: number, userId: string): Promise<void> {
  await apiRequest<unknown>(`/groups/${groupId}/members/remove`, {
    method: "POST",
    body: { user_id: userId },
    requiredEnvelope: true,
  });
}

export async function addGroupMembers(
  groupId: number,
  memberIds: readonly string[],
): Promise<void> {
  await apiRequest<unknown>(`/groups/${groupId}/members/add`, {
    method: "POST",
    body: { user_ids: [...memberIds] },
    requiredEnvelope: true,
  });
}

function normalizeNativeGroupDetail(value: unknown): GroupDetail {
  if (
    !isRecord(value) ||
    typeof value.group_id !== "number" ||
    !Number.isSafeInteger(value.group_id) ||
    typeof value.name !== "string" ||
    typeof value.avatar_url !== "string" ||
    typeof value.creator_id !== "string" ||
    !Array.isArray(value.members)
  ) {
    throw nativeDecodingError(value);
  }
  try {
    const normalized = normalizeGroupDetail(value);
    return {
      ...normalized,
      group_id: value.group_id,
      name: value.name,
      avatar_url: value.avatar_url,
      creator_id: value.creator_id,
      members: value.members.map(normalizeNativeGroupMember),
    };
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw nativeDecodingError(value);
  }
}

function normalizeNativeGroupMember(value: unknown): GroupMember {
  if (!isRecord(value)) throw nativeDecodingError(value);
  const userId = nativeFlexibleString(value.user_id) ?? "";
  const groupNickname =
    nativeFlexibleString(value.group_nickname) ?? nativeFlexibleString(value.groupNickname);
  return {
    user_id: userId,
    nickname: nativeFlexibleString(value.nickname) ?? userId,
    avatar_url: nativeFlexibleString(value.avatar_url) ?? "",
    role: nativeFlexibleString(value.role) ?? "member",
    ...(groupNickname === undefined ? {} : { group_nickname: groupNickname }),
  };
}

function nativeFlexibleString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function nativeDecodingError(payload: unknown): APIError {
  return new APIError("api.decodingError", 200, payload, "decoding_error");
}

function decodeNativeResponse<T>(payload: unknown, decode: (value: unknown) => T): T {
  try {
    return decode(payload);
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw nativeDecodingError(payload);
  }
}

function normalizeNativeConversationPreference(value: unknown): ConversationPreference {
  if (!isRecord(value)) throw new Error("会话偏好响应格式无效");
  const updatedAt = nativeFlexibleString(value.updated_at);
  return {
    conversation_type: nativeFlexibleString(value.conversation_type) ?? "",
    target_id: nativeFlexibleString(value.target_id) ?? "",
    is_pinned: nativeFlexibleBool(value.is_pinned) ?? false,
    is_hidden: nativeFlexibleBool(value.is_hidden) ?? false,
    revision: nativeFlexibleInt(value.revision) ?? 0,
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
  };
}

function nativeFlexibleBool(value: unknown): boolean | undefined {
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

function nativeFlexibleInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return undefined;
  const normalized = trimFoundationWhitespacesAndNewlines(value).replaceAll(",", "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

export async function clearGroupMessageHistory(groupId: number): Promise<GroupHistoryClearReceipt> {
  const value = await apiRequest<unknown>(`/groups/${groupId}/messages/history`, {
    method: "DELETE",
    headers: { "Idempotency-Key": createIdempotencyKey() },
    requiredData: true,
    requiredEnvelope: true,
  });
  return decodeNativeResponse(value, (payload) =>
    normalizeGroupHistoryClearReceipt(payload, groupId),
  );
}

export async function updateConversationPreference(
  conversationType: string,
  targetId: string,
  isPinned: boolean,
): Promise<ConversationPreference> {
  const type = encodeURIComponent(conversationType);
  const target = encodeURIComponent(targetId);
  const value = await apiRequest<unknown>(`/chat/conversations/${type}/${target}/preferences`, {
    method: "PUT",
    body: { is_pinned: isPinned, is_hidden: false },
    requiredData: true,
    requiredEnvelope: true,
  });
  return decodeNativeResponse(value, normalizeNativeConversationPreference);
}

export async function hideConversation(
  conversationType: string,
  targetId: string,
): Promise<ConversationPreference> {
  const type = encodeURIComponent(conversationType);
  const target = encodeURIComponent(targetId);
  return normalizeConversationPreference(
    await apiRequest<unknown>(`/chat/conversations/${type}/${target}/preferences`, {
      method: "PUT",
      body: { is_pinned: false, is_hidden: true },
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function getFollowing(
  options: { userId?: string; page?: number; limit?: number } = {},
): Promise<FollowUsersPage> {
  return getFollowUsersPage("/follows/following", options);
}

export async function getFollowers(
  options: { userId?: string; page?: number; limit?: number } = {},
): Promise<FollowUsersPage> {
  return getFollowUsersPage("/follows/followers", options);
}

export async function getRecommendedUsers(
  limit = 18,
  excludeUserId?: string,
): Promise<FollowUsersPage["users"]> {
  const query = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 50)) });
  if (excludeUserId?.trim()) query.set("exclude_user_id", excludeUserId.trim());
  const users = normalizeFollowUsersPage(
    await apiRequest<unknown>(`/users/recommended?${query.toString()}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  ).users;
  await cacheUserInfoBatch(users);
  return users;
}

export async function getGroupMessages(
  groupId: number,
  options: { beforeId?: number; afterId?: number; limit?: number } = {},
): Promise<{ messages: GroupMessage[]; hasMore: boolean }> {
  const query = new URLSearchParams();
  if (options.beforeId !== undefined) query.set("before_id", String(options.beforeId));
  if (options.afterId !== undefined) query.set("after_id", String(options.afterId));
  query.set("limit", String(options.limit ?? 30));
  const value = await apiRequest<unknown>(`/groups/${groupId}/messages?${query.toString()}`, {
    requiredData: true,
    requiredEnvelope: true,
  });
  if (!isRecord(value) || !Array.isArray(value.messages) || typeof value.has_more !== "boolean") {
    throw new Error("群消息列表响应格式无效");
  }
  const page = normalizeGroupMessagesPage(value);
  return { messages: page.messages, hasMore: value.has_more };
}

export async function getScriptRoom(roomId: string): Promise<ScriptRoom> {
  return normalizeScriptRoomEnvelope(
    await apiRequest<unknown>(`/script-rooms/${encodeURIComponent(roomId)}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function getScriptCategories(): Promise<ScriptCategory[]> {
  return normalizeScriptCategories(
    await apiRequest<unknown>("/scripts/categories", {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function getScript(scriptId: string): Promise<InteractiveScript> {
  const value = await apiRequest<unknown>(`/scripts/${encodeURIComponent(scriptId)}`, {
    requiredData: true,
    requiredEnvelope: true,
  });
  if (!isRecord(value) || !isRecord(value.script)) throw new Error("互动剧本响应缺少 script");
  return normalizeInteractiveScript(value.script);
}

export async function createScript(body: Record<string, unknown>): Promise<InteractiveScript> {
  const value = await apiRequest<unknown>("/scripts", {
    method: "POST",
    requiredData: true,
    requiredEnvelope: true,
    body,
  });
  if (!isRecord(value) || !isRecord(value.script)) throw new Error("互动剧本响应缺少 script");
  return normalizeInteractiveScript(value.script);
}

export async function updateScript(
  scriptId: string,
  body: Record<string, unknown>,
): Promise<InteractiveScript> {
  const value = await apiRequest<unknown>(`/scripts/${encodeURIComponent(scriptId)}`, {
    method: "PATCH",
    requiredData: true,
    requiredEnvelope: true,
    body,
  });
  if (!isRecord(value) || !isRecord(value.script)) throw new Error("互动剧本响应缺少 script");
  return normalizeInteractiveScript(value.script);
}

export async function deleteScript(scriptId: string): Promise<void> {
  await apiRequest<unknown>(`/scripts/${encodeURIComponent(scriptId)}`, {
    method: "DELETE",
    requiredEnvelope: true,
  });
}

export async function uploadScriptAsset(
  business: "script_cover" | "script_role_avatar",
  uri: string,
  filename: string,
): Promise<{ url: string; mime_type?: string | undefined; size?: number | undefined }> {
  const form = new FormData();
  form.append("business", business);
  form.append("file", {
    uri,
    name: filename,
    type: "image/jpeg",
  } as unknown as Blob);
  const value = await apiRequest<unknown>("/scripts/assets", {
    method: "POST",
    body: form,
    requiredData: true,
    requiredEnvelope: true,
    timeoutMs: 90_000,
  });
  const asset = isRecord(value) && isRecord(value.asset) ? value.asset : value;
  if (!isRecord(asset)) throw new Error("剧本资源响应格式无效");
  const rawUrl = asset.url ?? asset.asset_url ?? asset.assetURL;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("剧本资源响应缺少 URL");
  }
  const rawMime = asset.mime_type ?? asset.mimeType;
  const rawSize = Number(asset.size);
  return {
    url: rawUrl,
    ...(typeof rawMime === "string" && rawMime ? { mime_type: rawMime } : {}),
    ...(Number.isSafeInteger(rawSize) ? { size: rawSize } : {}),
  };
}

export async function createScriptRoom(
  scriptId: string,
  playerRoleId: string,
  idempotencyKey: string,
): Promise<ScriptRoomCreationData> {
  const value = await apiRequest<unknown>(`/scripts/${encodeURIComponent(scriptId)}/rooms`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: { player_role_id: playerRoleId },
    requiredData: true,
    requiredEnvelope: true,
  });
  if (!isRecord(value)) throw new Error("创建剧本房间响应格式无效");
  if (!isRecord(value.room)) throw new Error("创建剧本房间响应缺少 room");
  const conversation = isRecord(value.conversation)
    ? normalizeConversation(value.conversation)
    : undefined;
  return {
    room: normalizeScriptRoom(value.room),
    ...(conversation ? { conversation } : {}),
  };
}

export async function getScripts(
  scope: ScriptScope,
  options: { categoryId?: string; cursor?: string; limit?: number } = {},
): Promise<ScriptPage> {
  const query = new URLSearchParams({
    scope,
    limit: String(Math.min(Math.max(options.limit ?? 20, 1), 50)),
  });
  if (
    options.categoryId !== undefined &&
    trimFoundationWhitespacesAndNewlines(options.categoryId).length > 0
  ) {
    query.set("category_id", options.categoryId);
  }
  if (
    options.cursor !== undefined &&
    trimFoundationWhitespacesAndNewlines(options.cursor).length > 0
  ) {
    query.set("cursor", options.cursor);
  }
  return normalizeScriptPage(
    await apiRequest<unknown>(`/scripts?${query.toString()}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function submitScriptTurn(
  roomId: string,
  content: string,
  clientMessageId: string,
): Promise<ScriptTurnResponse> {
  return normalizeScriptTurnResponse(
    await apiRequest<unknown>(`/script-rooms/${encodeURIComponent(roomId)}/turns`, {
      method: "POST",
      body: { content, client_message_id: clientMessageId },
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function retryScriptTurn(roomId: string, turnId: string): Promise<ScriptTurnResponse> {
  return normalizeScriptTurnResponse(
    await apiRequest<unknown>(
      `/script-rooms/${encodeURIComponent(roomId)}/turns/${encodeURIComponent(turnId)}/retry`,
      {
        method: "POST",
        body: {},
        requiredData: true,
        requiredEnvelope: true,
      },
    ),
  );
}

export async function endScriptRoom(roomId: string): Promise<void> {
  await apiRequest<unknown>(`/script-rooms/${encodeURIComponent(roomId)}/end`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
  });
}

export async function markDirectMessagesRead(
  contactId: string,
  options: { throughMessageId?: number; idempotencyKey?: string } = {},
): Promise<ConversationReadReceipt | null> {
  const idempotencyKey = options.idempotencyKey ?? createIdempotencyKey();
  const value = await apiRequest<unknown>(`/chat/messages/${encodeURIComponent(contactId)}/read`, {
    method: "POST",
    requiredEnvelope: true,
    body: {
      idempotency_key: idempotencyKey,
      ...(options.throughMessageId !== undefined
        ? { through_message_id: options.throughMessageId }
        : {}),
    },
  });
  return value === null || value === undefined ? null : normalizeConversationReadReceipt(value);
}

export async function markGroupMessagesRead(
  groupId: number,
  options: { throughMessageId?: number; idempotencyKey?: string } = {},
): Promise<ConversationReadReceipt | null> {
  const idempotencyKey = options.idempotencyKey ?? createIdempotencyKey();
  const value = await apiRequest<unknown>(`/groups/${groupId}/messages/read`, {
    method: "POST",
    requiredEnvelope: true,
    body: {
      idempotency_key: idempotencyKey,
      ...(options.throughMessageId !== undefined
        ? { through_message_id: options.throughMessageId }
        : {}),
    },
  });
  return value === null || value === undefined ? null : normalizeConversationReadReceipt(value);
}

export async function getGroupMessageContext(
  groupId: number,
  messageId: number,
  options: { before?: number; after?: number } = {},
): Promise<GroupMessage[]> {
  const query = new URLSearchParams({
    before: String(options.before ?? 20),
    after: String(options.after ?? 20),
  });
  const value = await apiRequest<unknown>(
    `/groups/${groupId}/messages/${messageId}/context?${query.toString()}`,
    { requiredData: true, requiredEnvelope: true },
  );
  return normalizeGroupMessagesPage(value).messages;
}

export async function searchGroupMessages(
  groupId: number,
  options: {
    query: string;
    senderId?: string;
    messageType?: string;
    from?: Date;
    to?: Date;
    cursor?: string;
    limit?: number;
  },
): Promise<GroupMessageSearchPage> {
  const query = new URLSearchParams();
  query.set("q", options.query);
  query.set("limit", String(Math.min(Math.max(options.limit ?? 30, 1), 100)));
  if (
    options.senderId !== undefined &&
    trimFoundationWhitespacesAndNewlines(options.senderId).length > 0
  ) {
    query.set("sender_id", options.senderId);
  }
  if (
    options.messageType !== undefined &&
    trimFoundationWhitespacesAndNewlines(options.messageType).length > 0
  ) {
    query.set("message_type", options.messageType);
  }
  if (options.from) query.set("from", options.from.toISOString());
  if (options.to) query.set("to", options.to.toISOString());
  if (
    options.cursor !== undefined &&
    trimFoundationWhitespacesAndNewlines(options.cursor).length > 0
  ) {
    query.set("cursor", options.cursor);
  }
  const value = await apiRequest<unknown>(
    `/groups/${groupId}/messages/search?${query.toString()}`,
    {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
    },
  );
  return decodeNativeResponse(value, normalizeGroupMessageSearchPage);
}

export async function recallGroupMessage(
  groupId: number,
  messageId: number,
): Promise<GroupMessage> {
  return normalizeGroupMessage(
    await apiRequest<unknown>(`/groups/${groupId}/messages/${messageId}/recall`, {
      method: "POST",
      body: {},
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function sendGroupTextMessage(
  groupId: number,
  content: string,
  options: {
    replyToId?: number;
    mentions?: string[];
    mentionAll?: boolean;
    clientMessageId?: string;
  } = {},
): Promise<GroupMessage> {
  const value = await apiRequest<unknown>(`/groups/${groupId}/messages/text`, {
    method: "POST",
    body: {
      content,
      ...(options.replyToId !== undefined ? { reply_to_id: options.replyToId } : {}),
      ...(options.mentions && options.mentions.length > 0 ? { mentions: options.mentions } : {}),
      ...(options.mentionAll ? { mention_all: true } : {}),
      ...(options.clientMessageId ? { client_message_id: options.clientMessageId } : {}),
    },
    requiredData: true,
    requiredEnvelope: true,
  });
  return normalizeGroupMessage(value);
}

export async function sendGroupStickerMessage(
  groupId: number,
  packId: string,
  stickerId: string,
  options: { replyToId?: number; clientMessageId?: string } = {},
): Promise<GroupMessage> {
  const value = await apiRequest<unknown>(`/groups/${groupId}/messages/sticker`, {
    method: "POST",
    body: {
      pack_id: packId,
      sticker_id: stickerId,
      ...(options.replyToId !== undefined ? { reply_to_id: options.replyToId } : {}),
      ...(options.clientMessageId ? { client_message_id: options.clientMessageId } : {}),
    },
    requiredData: true,
    requiredEnvelope: true,
  });
  return normalizeGroupMessage(value);
}

export async function sendGroupGiftMessage(
  groupId: number,
  recipientId: string,
  giftId: string,
  idempotencyKey: string,
): Promise<GroupMessage> {
  const value = await apiRequest<unknown>(`/groups/${groupId}/messages/gift`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: {
      recipient_id: recipientId,
      receiver_id: recipientId,
      gift_id: giftId,
      idempotency_key: idempotencyKey,
    },
    requiredData: true,
    requiredEnvelope: true,
  });
  return normalizedGroupGiftResponse(value, groupId, recipientId, giftId);
}

export async function acceptFriendRequest(requestId: number): Promise<void> {
  await apiRequest<unknown>(`/friends/requests/${requestId}/accept`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
  });
}

export async function rejectFriendRequest(requestId: number): Promise<void> {
  await apiRequest<unknown>(`/friends/requests/${requestId}/reject`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
  });
}

export async function followUser(userId: string): Promise<FollowRelationship> {
  const value = await apiRequest<unknown>(`/follows/${encodeShortDramaPathComponent(userId)}`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
  });
  return { ...normalizeFollowRelationship(value, userId, true), user_id: userId };
}

export async function unfollowUser(userId: string): Promise<FollowRelationship> {
  const value = await apiRequest<unknown>(`/follows/${encodeShortDramaPathComponent(userId)}`, {
    method: "DELETE",
    requiredEnvelope: true,
  });
  return { ...normalizeFollowRelationship(value, userId, false), user_id: userId };
}

export async function getMessages(
  contactId: string,
  options: { beforeId?: number; afterId?: number; limit?: number } = {},
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const query = new URLSearchParams();
  if (options.beforeId !== undefined) query.set("before_id", String(options.beforeId));
  if (options.afterId !== undefined) query.set("after_id", String(options.afterId));
  query.set("limit", String(options.limit ?? 30));
  const value = await apiRequest<unknown>(
    `/chat/messages/${encodeURIComponent(contactId)}?${query.toString()}`,
    { requiredData: true, requiredEnvelope: true },
  );
  return normalizeMessagesPage(value);
}

export async function getMessageContext(
  contactId: string,
  messageId: number,
  options: { before?: number; after?: number } = {},
): Promise<Message[]> {
  const query = new URLSearchParams({
    before: String(options.before ?? 20),
    after: String(options.after ?? 20),
  });
  const value = await apiRequest<unknown>(
    `/chat/messages/${encodeURIComponent(contactId)}/${messageId}/context?${query.toString()}`,
    { requiredData: true, requiredEnvelope: true },
  );
  return normalizeMessagesPage(value).messages;
}

export async function recallDirectMessage(contactId: string, messageId: number): Promise<Message> {
  return normalizeMessage(
    await apiRequest<unknown>(
      `/chat/messages/${encodeURIComponent(contactId)}/${messageId}/recall`,
      { method: "POST", body: {}, requiredData: true, requiredEnvelope: true },
    ),
  );
}

export async function sendTextMessage(
  contactId: string,
  content: string,
  options: { replyToId?: number; clientMessageId?: string } = {},
): Promise<Message> {
  const value = await apiRequest<unknown>("/chat/messages/text", {
    method: "POST",
    requiredData: true,
    requiredEnvelope: true,
    body: {
      receiver_id: contactId,
      content,
      ...(options.replyToId !== undefined ? { reply_to_id: options.replyToId } : {}),
      ...(options.clientMessageId ? { client_message_id: options.clientMessageId } : {}),
    },
  });
  return normalizeMessage(value);
}

export async function sendDirectStickerMessage(
  contactId: string,
  packId: string,
  stickerId: string,
  options: { replyToId?: number; clientMessageId?: string } = {},
): Promise<Message> {
  const value = await apiRequest<unknown>("/chat/messages/sticker", {
    method: "POST",
    requiredData: true,
    requiredEnvelope: true,
    body: {
      receiver_id: contactId,
      pack_id: packId,
      sticker_id: stickerId,
      ...(options.replyToId !== undefined ? { reply_to_id: options.replyToId } : {}),
      ...(options.clientMessageId ? { client_message_id: options.clientMessageId } : {}),
    },
  });
  return normalizeMessage(value);
}

export async function sendDirectGiftMessage(
  contactId: string,
  giftId: string,
  idempotencyKey: string,
): Promise<Message> {
  const value = await apiRequest<unknown>("/chat/messages/gift", {
    method: "POST",
    requiredData: true,
    requiredEnvelope: true,
    headers: { "Idempotency-Key": idempotencyKey },
    body: {
      receiver_id: contactId,
      recipient_id: contactId,
      gift_id: giftId,
      idempotency_key: idempotencyKey,
    },
  });
  return normalizedDirectGiftResponse(value, contactId, giftId);
}

export async function forwardMessages(request: ForwardRequest): Promise<ForwardOperationResult> {
  const value = await apiRequest<unknown>("/chat/forwards", {
    method: "POST",
    headers: { "Idempotency-Key": request.client_operation_id },
    body: {
      client_operation_id: request.client_operation_id,
      mode: request.mode,
      sources: request.sources,
      targets: request.targets,
    },
  });
  const record = isRecord(value) ? value : {};
  const operationId = String(
    record.client_operation_id ?? record.clientOperationId ?? request.client_operation_id,
  );
  const createdValue = record.created_messages ?? record.createdMessages;
  const created = Array.isArray(createdValue)
    ? createdValue.flatMap((item: unknown): ForwardCreatedMessage[] => {
        if (!isRecord(item)) return [];
        const conversationType = String(item.conversation_type ?? item.conversationType ?? "");
        const conversationId = String(item.conversation_id ?? item.conversationId ?? "");
        const messageId = Number(item.message_id ?? item.messageId ?? 0);
        if (
          (conversationType !== "dm" && conversationType !== "group") ||
          !conversationId ||
          !Number.isSafeInteger(messageId) ||
          messageId <= 0
        )
          return [];
        return [
          {
            conversation_type: conversationType,
            conversation_id: conversationId,
            message_id: messageId,
          },
        ];
      })
    : [];
  const bundleIdValue = record.bundle_id ?? record.bundleId;
  return {
    client_operation_id: operationId,
    ...(typeof bundleIdValue === "string" && bundleIdValue ? { bundle_id: bundleIdValue } : {}),
    created_messages: created,
  };
}

export async function getForwardBundle(bundleId: string): Promise<ForwardBundle> {
  const value = await apiRequest<unknown>(`/chat/forward-bundles/${encodeURIComponent(bundleId)}`);
  if (!isRecord(value)) throw new Error("合并转发详情响应格式无效");
  const id = String(value.bundle_id ?? value.bundleId ?? "");
  const title = String(value.title ?? "");
  const createdAt = String(value.created_at ?? value.createdAt ?? "");
  const items = Array.isArray(value.items)
    ? value.items
        .flatMap((item) => {
          if (!isRecord(item)) return [];
          const ordinal = Number(item.ordinal);
          if (!Number.isSafeInteger(ordinal)) return [];
          const asset = item.asset_id ?? item.assetId;
          return [
            {
              ordinal,
              sender_name: String(item.sender_name ?? item.senderName ?? ""),
              sent_at: String(item.sent_at ?? item.sentAt ?? ""),
              message_type: String(item.message_type ?? item.messageType ?? "text"),
              summary: String(item.summary ?? ""),
              ...(typeof asset === "string" && asset ? { asset_id: asset } : {}),
            },
          ];
        })
        .sort((left, right) => left.ordinal - right.ordinal)
    : [];
  if (!id || !title) throw new Error("合并转发详情响应格式无效");
  return { bundle_id: id, title, created_at: createdAt, items };
}

export async function sendDirectImageMessage(
  contactId: string,
  image: { uri: string; filename: string; thumbnailUri: string; thumbnailFilename: string },
  clientMessageId: string,
): Promise<Message> {
  const form = new FormData();
  form.append("receiver_id", contactId);
  form.append("client_message_id", clientMessageId);
  appendChatImageFiles(form, image);
  const message = normalizeMessage(
    await apiRequest<unknown>("/chat/messages/image", {
      method: "POST",
      headers: { "Idempotency-Key": clientMessageId },
      body: form,
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 180_000,
    }),
  );
  return requireConfirmedChatImage(message, "direct");
}

export async function sendGroupImageMessage(
  groupId: number,
  image: { uri: string; filename: string; thumbnailUri: string; thumbnailFilename: string },
  clientMessageId: string,
): Promise<GroupMessage> {
  const form = new FormData();
  form.append("client_message_id", clientMessageId);
  appendChatImageFiles(form, image);
  const message = normalizeGroupMessage(
    await apiRequest<unknown>(`/groups/${groupId}/messages/image`, {
      method: "POST",
      headers: { "Idempotency-Key": clientMessageId },
      body: form,
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 180_000,
    }),
  );
  return requireConfirmedChatImage(message, "group");
}

export async function sendDirectVideoMessage(
  contactId: string,
  video: {
    uri: string;
    filename: string;
    mimeType: string;
    thumbnailUri: string;
    thumbnailFilename: string;
  },
  clientMessageId: string,
): Promise<Message> {
  const form = new FormData();
  form.append("receiver_id", contactId);
  form.append("client_message_id", clientMessageId);
  appendChatVideoFiles(form, video);
  const message = normalizeMessage(
    await apiRequest<unknown>("/chat/messages/video", {
      method: "POST",
      headers: { "Idempotency-Key": clientMessageId },
      body: form,
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 600_000,
    }),
  );
  return requireConfirmedChatMedia(message, "direct", "video");
}

export async function sendGroupVideoMessage(
  groupId: number,
  video: {
    uri: string;
    filename: string;
    mimeType: string;
    thumbnailUri: string;
    thumbnailFilename: string;
  },
  clientMessageId: string,
): Promise<GroupMessage> {
  const form = new FormData();
  form.append("client_message_id", clientMessageId);
  appendChatVideoFiles(form, video);
  const message = normalizeGroupMessage(
    await apiRequest<unknown>(`/groups/${groupId}/messages/video`, {
      method: "POST",
      headers: { "Idempotency-Key": clientMessageId },
      body: form,
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 600_000,
    }),
  );
  return requireConfirmedChatMedia(message, "group", "video");
}

export async function sendDirectVoiceMessage(
  contactId: string,
  voice: { uri: string; filename: string; duration: number },
): Promise<Message> {
  const form = new FormData();
  form.append("receiver_id", contactId);
  appendChatVoiceFile(form, voice);
  return normalizeMessage(
    await apiRequest<unknown>("/chat/messages/voice", {
      method: "POST",
      body: form,
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
    }),
  );
}

export async function sendGroupVoiceMessage(
  groupId: number,
  voice: { uri: string; filename: string; duration: number },
): Promise<GroupMessage> {
  const form = new FormData();
  appendChatVoiceFile(form, voice);
  return normalizeGroupMessage(
    await apiRequest<unknown>(`/groups/${groupId}/messages/voice`, {
      method: "POST",
      body: form,
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
    }),
  );
}

function appendChatImageFiles(
  form: FormData,
  image: { uri: string; filename: string; thumbnailUri: string; thumbnailFilename: string },
) {
  appendExpoFilePart(form, "image", image.uri, image.filename, "image/jpeg");
  appendExpoFilePart(form, "thumbnail", image.thumbnailUri, image.thumbnailFilename, "image/jpeg");
}

function appendExpoFilePart(
  form: FormData,
  field: string,
  uri: string,
  filename: string,
  mimeType: string,
): void {
  const file = new File(uri);
  // React Native 0.86 no longer accepts the legacy `{ uri, name, type }`
  // pseudo-Blob. Expo File implements the native byte-backed Blob contract.
  form.append(field, {
    name: filename,
    type: mimeType,
    bytes: () => file.bytes(),
  } as unknown as Blob);
}

function requireConfirmedChatImage<T extends Message | GroupMessage>(
  message: T,
  scope: "direct" | "group",
): T {
  return requireConfirmedChatMedia(message, scope, "image");
}

function requireConfirmedChatMedia<T extends Message | GroupMessage>(
  message: T,
  scope: "direct" | "group",
  expectedType: "image" | "video",
): T {
  if (
    message.id <= 0 ||
    message.msg_type.trim().toLocaleLowerCase() !== expectedType ||
    !message.content.trim()
  ) {
    throw new APIError(
      scope === "group" ? "群媒体消息未被服务端确认" : "媒体消息未被服务端确认",
      502,
      message,
      "unconfirmed_media_message",
    );
  }
  return message;
}

function appendChatVideoFiles(
  form: FormData,
  video: {
    uri: string;
    filename: string;
    mimeType: string;
    thumbnailUri: string;
    thumbnailFilename: string;
  },
) {
  form.append("video", {
    uri: video.uri,
    name: video.filename,
    type: video.mimeType,
  } as unknown as Blob);
  form.append("thumbnail", {
    uri: video.thumbnailUri,
    name: video.thumbnailFilename,
    type: "image/jpeg",
  } as unknown as Blob);
}

function appendChatVoiceFile(
  form: FormData,
  voice: { uri: string; filename: string; duration: number },
) {
  form.append("duration", formatChatVoiceUploadDuration(voice.duration));
  form.append("voice", {
    uri: voice.uri,
    name: voice.filename,
    type: "audio/m4a",
  } as unknown as Blob);
}

export async function clearDirectMessageHistory(
  contactId: string,
): Promise<DirectHistoryClearReceipt> {
  const value = await apiRequest<unknown>(
    `/chat/messages/${encodeURIComponent(contactId)}/history`,
    {
      method: "DELETE",
      headers: { "Idempotency-Key": createIdempotencyKey() },
      requiredData: true,
      requiredEnvelope: true,
    },
  );
  return normalizeDirectHistoryClearReceipt(value, contactId);
}

export async function getProfile(): Promise<User> {
  const value = await apiRequest<unknown>("/profile/me", {
    requiredData: true,
    requiredEnvelope: true,
  });
  if (!isRecord(value) || !isRecord(value.profile)) throw new Error("个人资料响应格式无效");
  try {
    return normalizeNativeUser(value.profile);
  } catch {
    throw new Error("个人资料响应格式无效");
  }
}

export async function updateProfile(input: {
  nickname: string;
  bio: string;
  gender: string;
  birthday: string;
  location: string;
}): Promise<User> {
  const value = await apiRequest<unknown>("/profile/me", {
    method: "PUT",
    requiredData: true,
    requiredEnvelope: true,
    body: {
      nickname: input.nickname,
      bio: input.bio,
      gender: input.gender,
      birthday: input.birthday,
      location: input.location,
    },
  });
  if (!isRecord(value) || !isRecord(value.profile)) throw new Error("个人资料响应格式无效");
  try {
    return normalizeNativeUser(value.profile);
  } catch {
    throw new Error("个人资料响应格式无效");
  }
}

export async function uploadAvatar(uri: string): Promise<string> {
  const form = new FormData();
  form.append(profileAvatarUploadPolicy.fieldName, {
    uri,
    name: profileAvatarUploadPolicy.filename,
    type: profileAvatarUploadPolicy.mimeType,
  } as unknown as Blob);
  const value = await apiRequest<unknown>("/profile/avatar", {
    method: "POST",
    body: form,
    timeoutMs: profileAvatarUploadPolicy.timeoutMilliseconds,
    requiredData: true,
    requiredEnvelope: true,
  });
  if (!isRecord(value) || typeof value.avatar_url !== "string") {
    throw new Error("头像上传响应格式无效");
  }
  return value.avatar_url;
}

export async function getPublicProfile(userId: string): Promise<PublicProfile> {
  const profile = normalizePublicProfile(
    await apiRequest<unknown>(`/profile/public/${encodeURIComponent(userId)}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
  await cachePublicProfile(profile);
  return profile;
}

export async function getUserMoments(
  userId: string,
  options: { limit?: number; beforeId?: number } = {},
): Promise<MomentFeedPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 24) });
  if (options.beforeId !== undefined) query.set("before_id", String(options.beforeId));
  return normalizeMomentFeedPage(
    await apiRequest<unknown>(`/moments/user/${encodeURIComponent(userId)}?${query.toString()}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function getMomentsWorld(
  options: { limit?: number; beforeId?: number } = {},
): Promise<MomentFeedPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 20) });
  if (options.beforeId !== undefined) query.set("before_id", String(options.beforeId));
  return normalizeMomentFeedPage(await apiRequest<unknown>(`/moments/world?${query.toString()}`));
}

export async function getMomentsFollowing(
  options: { limit?: number; beforeId?: number } = {},
): Promise<MomentFeedPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 20) });
  if (options.beforeId !== undefined) query.set("before_id", String(options.beforeId));
  return normalizeMomentFeedPage(await apiRequest<unknown>(`/moments/feed?${query.toString()}`));
}

export async function createMoment(
  content: string,
  media: MomentUploadAsset[],
  options: {
    unlockPriceGoldCoins?: number | undefined;
    clientRequestId?: string | undefined;
  } = {},
): Promise<Moment> {
  validateMomentUploadAssets(media);
  const form = new FormData();
  form.append("content", content);
  if (options.clientRequestId?.trim()) {
    form.append("client_request_id", options.clientRequestId.trim());
  }
  if ((options.unlockPriceGoldCoins ?? 0) > 0) {
    form.append("unlock_price_gold_coins", String(options.unlockPriceGoldCoins));
  }
  for (const asset of media) {
    form.append("media", {
      uri: asset.uri,
      name: asset.filename,
      type: asset.mime_type,
    } as unknown as Blob);
  }
  return normalizeMoment(
    await apiRequest<unknown>("/moments/create", {
      method: "POST",
      body: form,
      timeoutMs: media.some((item) => item.kind === "video") ? 600_000 : 180_000,
    }),
  );
}

export async function deleteMoment(momentId: number): Promise<void> {
  await apiRequest<unknown>(`/moments/${momentId}`, { method: "DELETE" });
}

export async function getMomentsUnreadInfo(): Promise<MomentsUnreadInfo> {
  return normalizeMomentsUnreadInfo(
    await apiRequest<unknown>("/moments/notifications/unread", {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function getMomentsNotifications(limit = 50): Promise<MomentsNotification[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  return normalizeMomentsNotifications(
    await apiRequest<unknown>(`/moments/notifications/list?${query.toString()}`),
  );
}

export async function markMomentsNotificationsRead(): Promise<void> {
  await apiRequest<unknown>("/moments/notifications/read", {
    method: "POST",
    body: {},
  });
}

export async function markMomentsFeedViewed(): Promise<void> {
  await apiRequest<unknown>("/moments/feed/viewed", {
    method: "POST",
    body: {},
  });
}

export async function toggleMomentLike(momentId: number): Promise<boolean> {
  const value = await apiRequest<unknown>(`/moments/${momentId}/like`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
  });
  return isRecord(value) ? Boolean(value.liked) : false;
}

export function validateMomentUploadAssets(media: MomentUploadAsset[]): void {
  const imageCount = media.filter((item) => item.kind === "image").length;
  const videoCount = media.filter((item) => item.kind === "video").length;
  if (imageCount > 0 && videoCount > 0) {
    throw new Error("一条动态不能同时包含图片和视频");
  }
  if (imageCount > 9) throw new Error("最多只能选择 9 张图片");
  if (videoCount > 1) throw new Error("一次只能选择 1 个视频");
}

export async function getMomentDetail(momentId: number): Promise<Moment> {
  return normalizeMoment(await apiRequest<unknown>(`/moments/detail/${momentId}`));
}

export async function addMomentComment(
  momentId: number,
  content: string,
  options: {
    replyToUserId?: string | undefined;
    image?: { uri: string; filename?: string | undefined } | undefined;
  } = {},
): Promise<MomentComment> {
  const form = new FormData();
  form.append("content", content);
  if (options.replyToUserId?.trim()) {
    form.append("reply_to_user_id", options.replyToUserId.trim());
  }
  if (options.image) {
    form.append("image", {
      uri: options.image.uri,
      name: options.image.filename || "comment.jpg",
      type: "image/jpeg",
    } as unknown as Blob);
  }
  return normalizeMomentComment(
    await apiRequest<unknown>(`/moments/${momentId}/comment`, {
      method: "POST",
      body: form,
      timeoutMs: 90_000,
    }),
  );
}

export async function unlockMoment(
  momentId: number,
  mediaType: "image" | "video",
  idempotencyKey = createIdempotencyKey(),
): Promise<MomentUnlockResult> {
  return normalizeMomentUnlockResult(
    await apiRequest<unknown>(`/moments/${momentId}/unlock`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: {
        payment_method: "auto",
        prop_definition_id:
          mediaType === "video" ? "media_unlock_card_video" : "media_unlock_card_image",
      },
      requiredData: true,
      transientRetries: false,
    }),
  );
}

export async function getPublicAgentsPage(
  ownerUserId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<AgentSummaryPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 20) });
  if (ownerUserId.trim()) query.set("owner_user_id", ownerUserId.trim());
  if (options.cursor?.trim()) query.set("cursor", options.cursor.trim());
  return normalizeAgentSummaryPage(
    await apiRequest<unknown>(`/agents/public?${query.toString()}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function getAgentRuntimeConfig(): Promise<AgentRuntimeConfig> {
  return normalizeAgentRuntimeConfig(
    await apiRequest<unknown>("/agents/runtime-config", {
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
    }),
  );
}

export async function getAgent(agentId: string): Promise<AgentSummary> {
  return normalizeRequiredAgentSummary(
    await apiRequest<unknown>(`/agents/${encodeURIComponent(agentId)}`, {
      requiredData: true,
      requiredSuccessCode: true,
      timeoutMs: 60_000,
    }),
    agentId,
  );
}

export async function uploadAgentReference(
  uri: string,
  idempotencyKey: string,
): Promise<AgentReferenceUpload> {
  const form = new FormData();
  const image = new File(uri);
  form.append("image", {
    name: "agent-reference.jpg",
    type: "image/jpeg",
    bytes: () => image.bytes(),
  } as unknown as Blob);
  const value = await apiRequest<unknown>("/agent-assets/reference-images", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: form,
    timeoutMs: 90_000,
    requiredData: true,
    requiredEnvelope: true,
    transientRetries: false,
  });
  if (!isRecord(value)) throw new Error("智能体参考图响应格式无效");
  const primary = value.primary_reference_asset_id ?? value.primaryReferenceAssetID;
  const avatar = value.avatar_asset_id ?? value.avatarAssetID;
  if (
    (typeof primary !== "string" && typeof primary !== "number") ||
    (typeof avatar !== "string" && typeof avatar !== "number")
  ) {
    throw new Error("智能体参考图响应缺少资源 ID");
  }
  return {
    primary_reference_asset_id: String(primary),
    avatar_asset_id: String(avatar),
  };
}

export async function uploadAgentChatImage(
  uri: string,
  idempotencyKey: string,
  filename = "agent-chat.jpg",
): Promise<string> {
  const form = new FormData();
  // Expo 57's fetch implementation serializes multipart files through `bytes()`.
  // React Native's legacy `{ uri, name, type }` part is rejected before the
  // request reaches the API with `Unsupported FormDataPart implementation`.
  const image = new File(uri);
  form.append("image", {
    name: filename,
    type: "image/jpeg",
    bytes: () => image.bytes(),
  } as unknown as Blob);
  const value = await apiRequest<unknown>("/agent-assets/images", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: form,
    timeoutMs: 90_000,
  });
  if (!isRecord(value)) throw new Error("智能体聊天图片响应格式无效");
  const assetId = value.asset_id ?? value.assetID;
  if (typeof assetId !== "string" && typeof assetId !== "number") {
    throw new Error("智能体聊天图片响应缺少资源 ID");
  }
  return String(assetId);
}

export async function createAgent(
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<AgentSummary> {
  return normalizeRequiredAgentSummary(
    await apiRequest<unknown>("/agents", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: payload,
      timeoutMs: 30_000,
      requiredData: true,
      transientRetries: false,
    }),
  );
}

export async function updateAgentDraft(
  agentId: string,
  expectedRevision: number,
  patch: Record<string, unknown>,
): Promise<AgentSummary> {
  return normalizeRequiredAgentSummary(
    await apiRequest<unknown>(`/agents/${encodeURIComponent(agentId)}/draft`, {
      method: "PATCH",
      body: { expected_revision: expectedRevision, patch },
      timeoutMs: 30_000,
      requiredData: true,
    }),
  );
}

export async function publishAgent(agentId: string, idempotencyKey: string): Promise<AgentVersion> {
  const value = await apiRequest<unknown>(`/agents/${encodeURIComponent(agentId)}/publish`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: {},
    timeoutMs: 30_000,
    requiredData: true,
    requiredEnvelope: true,
    transientRetries: false,
  });
  if (!isRecord(value)) {
    throw new APIError("api.decodingError", 200, value, "decoding_error");
  }
  const id = value.id;
  const agent = value.agent_id ?? value.agentID;
  const version = value.version_number ?? value.versionNumber;
  const status = value.status;
  return {
    ...(typeof id === "string" || typeof id === "number" ? { id: String(id) } : {}),
    ...(typeof agent === "string" || typeof agent === "number" ? { agent_id: String(agent) } : {}),
    ...(typeof version === "number" && Number.isFinite(version)
      ? { version_number: Math.trunc(version) }
      : typeof version === "string" && Number.isFinite(Number(version))
        ? { version_number: Math.trunc(Number(version)) }
        : {}),
    ...(typeof status === "string" ? { status } : {}),
  };
}

export async function getInstalledAgents(): Promise<AgentSummary[]> {
  return normalizeAgentSummaryPage(
    await apiRequest<unknown>("/agents/installed", {
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
    }),
  ).agents;
}

export async function installAgent(agentId: string): Promise<AgentSummary> {
  return normalizeRequiredAgentSummary(
    await apiRequest<unknown>(`/agents/${encodeURIComponent(agentId)}/install`, {
      method: "POST",
      body: {},
      requiredData: true,
      timeoutMs: 60_000,
    }),
  );
}

export async function uninstallAgent(agentId: string): Promise<void> {
  await apiRequest<unknown>(`/agents/${encodeURIComponent(agentId)}/install`, {
    method: "DELETE",
    requiredEnvelope: true,
    timeoutMs: 60_000,
  });
}

export async function getAgentConversations(): Promise<AgentConversation[]> {
  const value = await apiRequest<unknown>("/agent-conversations", {
    requiredData: true,
    requiredEnvelope: true,
    timeoutMs: 60_000,
  });
  if (Array.isArray(value)) return value.map(normalizeAgentConversation);
  if (!isRecord(value)) throw new Error("智能体会话列表响应格式无效");
  const raw = [value.conversations, value.items].find(Array.isArray) ?? [];
  return raw.map(normalizeAgentConversation).filter((conversation) => conversation.id.length > 0);
}

export async function createAgentConversation(
  agentId: string,
  greetingId = "default",
  idempotencyKey = createIdempotencyKey(),
): Promise<AgentConversation> {
  return normalizeRequiredAgentConversation(
    await apiRequest<unknown>("/agent-conversations", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: { agent_id: agentId, greeting_id: greetingId },
      requiredData: true,
      timeoutMs: 15_000,
      transientRetries: false,
    }),
  );
}

function normalizeRequiredAgentSummary(value: unknown, requestedAgentId?: string): AgentSummary {
  try {
    return normalizeAgentSummary(value);
  } catch (initialError) {
    const recovered = agentSummaryPayloadWithRequestedId(value, requestedAgentId);
    if (recovered !== value) {
      try {
        return normalizeAgentSummary(recovered);
      } catch (recoveryError) {
        throwAgentEnvelopeError(value, recoveryError);
      }
    }
    throwAgentEnvelopeError(value, initialError);
  }
}

function agentSummaryPayloadWithRequestedId(
  value: unknown,
  requestedAgentId: string | undefined,
): unknown {
  const fallbackId = requestedAgentId?.trim();
  if (!fallbackId || !isRecord(value)) return value;
  for (const key of ["agent", "draft", "item", "summary", "data"] as const) {
    const nested = value[key];
    if (!isRecord(nested)) continue;
    const recovered = agentSummaryPayloadWithRequestedId(nested, fallbackId);
    return recovered === nested ? value : { ...value, [key]: recovered };
  }
  if (agentSummaryResponseId(value) || !isAgentSummaryDetail(value)) return value;
  return { ...value, id: fallbackId };
}

function agentSummaryResponseId(value: Record<string, unknown>): string | null {
  for (const key of ["id", "agent_id", "agentID"] as const) {
    const candidate = value[key];
    if (typeof candidate !== "string" && typeof candidate !== "number") continue;
    const normalized = String(candidate).trim();
    if (normalized) return normalized;
  }
  return null;
}

function isAgentSummaryDetail(value: Record<string, unknown>): boolean {
  return (
    isRecord(value.profile) ||
    isRecord(value.definition) ||
    isRecord(value.capabilities) ||
    Array.isArray(value.greetings) ||
    typeof value.revision === "number" ||
    typeof value.revision === "string" ||
    "avatar_asset_id" in value ||
    "primary_reference_asset_id" in value
  );
}

function normalizeRequiredAgentConversation(value: unknown): AgentConversation {
  try {
    return normalizeAgentConversation(value);
  } catch (error) {
    throwAgentEnvelopeError(value, error);
  }
}

function throwAgentEnvelopeError(value: unknown, fallback: unknown): never {
  if (isRecord(value)) {
    const rawCode = value.code;
    const code = typeof rawCode === "string" || typeof rawCode === "number" ? rawCode : undefined;
    if (code !== undefined || "message" in value) {
      const message = typeof value.message === "string" ? value.message.trim() : "";
      throw new APIError(message || "api.invalidResponse", 200, value, code);
    }
  }
  throw fallback;
}

export async function getAgentMessages(
  conversationId: string,
  options: { beforeSequence?: number; limit?: number } = {},
): Promise<AgentMessagePage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 30) });
  if (options.beforeSequence !== undefined) {
    query.set("before_sequence", String(options.beforeSequence));
  }
  return normalizeAgentMessagePage(
    await apiRequest<unknown>(
      `/agent-conversations/${encodeURIComponent(conversationId)}/messages?${query.toString()}`,
    ),
  );
}

export type AgentTurnInputPart =
  { type: "text"; text: string } | { type: "input_image"; asset_id: string };

export async function createAgentTurn(
  conversationId: string,
  parts: readonly AgentTurnInputPart[],
  options: {
    clientMessageId?: string;
    replyToId?: string | undefined;
    idempotencyKey?: string;
  } = {},
): Promise<AgentTurnAccepted> {
  return normalizeAgentTurnAccepted(
    await apiRequest<unknown>(`/agent-conversations/${encodeURIComponent(conversationId)}/turns`, {
      method: "POST",
      headers: { "Idempotency-Key": options.idempotencyKey ?? createIdempotencyKey() },
      timeoutMs: 30_000,
      body: {
        client_message_id: options.clientMessageId ?? createIdempotencyKey(),
        parts: [...parts],
        ...(options.replyToId?.trim() ? { reply_to_id: options.replyToId.trim() } : {}),
      },
    }),
  );
}

export async function createAgentTextTurn(
  conversationId: string,
  text: string,
  clientMessageId = createIdempotencyKey(),
): Promise<AgentTurnAccepted> {
  return createAgentTurn(conversationId, [{ type: "text", text }], { clientMessageId });
}

export async function getAgentTurn(turnId: string): Promise<AgentTurnResult> {
  return normalizeAgentTurnResult(
    await apiRequest<unknown>(`/agent-turns/${encodeURIComponent(turnId)}`),
  );
}

export type AgentMediaUnlockPaymentMethod =
  | { type: "automatic"; mediaType: "image" | "video" }
  | { type: "spendable_balance" }
  | { type: "prop_card"; mediaType: "image" | "video" };

export async function unlockAgentMedia(
  mediaId: string,
  paymentMethod: AgentMediaUnlockPaymentMethod,
  idempotencyKey: string,
): Promise<AgentMediaUnlock> {
  const propDefinitionId =
    paymentMethod.type === "spendable_balance"
      ? undefined
      : `media_unlock_card_${paymentMethod.mediaType}`;
  return normalizeAgentMediaUnlock(
    await apiRequest<unknown>(`/agent-media/${encodeURIComponent(mediaId)}/unlock`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body:
        paymentMethod.type === "spendable_balance"
          ? {}
          : {
              payment_method: paymentMethod.type === "automatic" ? "auto" : "prop_card",
              prop_definition_id: propDefinitionId,
            },
      requiredData: true,
      transientRetries: false,
    }),
  );
}

export async function getUserShortDramaSeries(
  creatorUserId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<ShortDramaSeriesPage> {
  const query = new URLSearchParams({
    creator_user_id: creatorUserId,
    limit: String(options.limit ?? 12),
  });
  if (
    options.cursor !== undefined &&
    trimFoundationWhitespacesAndNewlines(options.cursor).length > 0
  ) {
    query.set("cursor", options.cursor);
  }
  return normalizeShortDramaSeriesPage(
    await apiRequest<unknown>(`/short-drama/series?${query.toString()}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function getMyShortDramaSeries(
  options: { cursor?: string | undefined; limit?: number | undefined } = {},
): Promise<ShortDramaSeriesPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 20) });
  if (
    options.cursor !== undefined &&
    trimFoundationWhitespacesAndNewlines(options.cursor).length > 0
  ) {
    query.set("cursor", options.cursor);
  }
  return normalizeShortDramaSeriesPage(
    await apiRequest<unknown>(`/short-drama/mine?${query.toString()}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function getShortDramaSeriesFeed(
  filter: ShortDramaSeriesFilter,
  options: { cursor?: string | undefined; limit?: number | undefined } = {},
): Promise<ShortDramaSeriesPage> {
  let query = `tab=${encodeShortDramaQueryValue(filter)}&limit=${encodeShortDramaQueryValue(
    String(options.limit ?? 12),
  )}`;
  if (
    options.cursor !== undefined &&
    trimFoundationWhitespacesAndNewlines(options.cursor).length > 0
  ) {
    query += `&cursor=${encodeShortDramaQueryValue(options.cursor)}`;
  }
  return normalizeShortDramaSeriesPage(
    await apiRequest<unknown>(`/short-drama/series?${query}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function getShortDramaFeed(
  options: { cursor?: string | undefined; limit?: number | undefined } = {},
): Promise<ShortDramaFeedPage> {
  let query = `limit=${encodeShortDramaQueryValue(String(options.limit ?? 12))}`;
  if (
    options.cursor !== undefined &&
    trimFoundationWhitespacesAndNewlines(options.cursor).length > 0
  ) {
    query += `&cursor=${encodeShortDramaQueryValue(options.cursor)}`;
  }
  return normalizeShortDramaFeedPage(
    await apiRequest<unknown>(`/short-drama/feed?${query}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function setShortDramaLiked(
  videoId: string,
  liked: boolean,
): Promise<ShortDramaInteractionResult> {
  const path = `/short-drama/videos/${encodeShortDramaPathComponent(videoId)}/like`;
  const value = await apiRequest<unknown>(
    path,
    liked
      ? { method: "POST", body: {}, requiredEnvelope: true }
      : { method: "DELETE", requiredEnvelope: true },
  );
  const normalized = normalizeShortDramaInteractionResult(value);
  return Object.keys(normalized).length > 0 ? normalized : { liked };
}

export async function getShortDramaComments(
  videoId: string,
  options: { cursor?: string | undefined; limit?: number | undefined } = {},
): Promise<ShortDramaCommentsPage> {
  let query = `limit=${encodeShortDramaQueryValue(String(options.limit ?? 30))}`;
  if (
    options.cursor !== undefined &&
    trimFoundationWhitespacesAndNewlines(options.cursor).length > 0
  ) {
    query += `&cursor=${encodeShortDramaQueryValue(options.cursor)}`;
  }
  return normalizeShortDramaCommentsPage(
    await apiRequest<unknown>(
      `/short-drama/videos/${encodeShortDramaPathComponent(videoId)}/comments?${query}`,
      { requiredData: true, requiredEnvelope: true },
    ),
  );
}

export async function sendShortDramaComment(
  videoId: string,
  content: string,
): Promise<ShortDramaComment> {
  return normalizeShortDramaComment(
    await apiRequest<unknown>(
      `/short-drama/videos/${encodeShortDramaPathComponent(videoId)}/comments`,
      {
        method: "POST",
        body: { content },
        requiredData: true,
        requiredEnvelope: true,
      },
    ),
  );
}

function encodeShortDramaPathComponent(value: string): string {
  return restoreNativeURLCharacters(encodeURIComponent(value), /%(24|26|2B|2C|3A|3B|3D|40)/gu);
}

function encodeShortDramaQueryValue(value: string): string {
  return restoreNativeURLCharacters(encodeURIComponent(value), /%(24|2B|2C|2F|3A|3B|3F|40)/gu);
}

function restoreNativeURLCharacters(value: string, pattern: RegExp): string {
  return value.replace(pattern, (escape) => decodeURIComponent(escape));
}

export async function getShortDramaSeriesDetail(seriesId: string): Promise<ShortDramaSeries> {
  return normalizeShortDramaSeries(
    await apiRequest<unknown>(`/short-drama/series/${encodeShortDramaPathComponent(seriesId)}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function createShortDramaSeries(input: {
  title: string;
  intro: string;
  coverUri: string;
  coverFilename: string;
}): Promise<ShortDramaSeries> {
  const form = new FormData();
  form.append("title", input.title);
  form.append("intro", input.intro);
  appendShortDramaFile(form, "cover", input.coverUri, input.coverFilename, "image/jpeg");
  return normalizeShortDramaSeries(
    await apiRequest<unknown>("/short-drama/series", {
      method: "POST",
      body: form,
      timeoutMs: 180_000,
    }),
  );
}

export async function updateShortDramaSeries(
  seriesId: string,
  input: {
    title: string;
    intro: string;
    coverUri?: string | undefined;
    coverFilename?: string | undefined;
  },
): Promise<ShortDramaSeries> {
  const form = new FormData();
  form.append("title", input.title);
  form.append("intro", input.intro);
  if (input.coverUri && input.coverFilename) {
    appendShortDramaFile(form, "cover", input.coverUri, input.coverFilename, "image/jpeg");
  }
  return normalizeShortDramaSeries(
    await apiRequest<unknown>(`/short-drama/series/${encodeURIComponent(seriesId)}`, {
      method: "PATCH",
      body: form,
      timeoutMs: 180_000,
    }),
  );
}

export async function uploadShortDramaEpisode(input: {
  seriesId: string;
  clientSeriesId: string;
  clientEpisodeId: string;
  title: string;
  intro: string;
  episodeNumber: number;
  unlockPriceGoldCoins: number;
  videoUri: string;
  videoFilename: string;
  videoMimeType: string;
  coverUri: string;
  coverFilename: string;
}): Promise<ShortDramaEpisodeUploadResult> {
  const form = new FormData();
  form.append("title", input.title);
  form.append("intro", input.intro);
  form.append("episode_number", String(input.episodeNumber));
  form.append("client_episode_id", input.clientEpisodeId);
  form.append("client_series_id", input.clientSeriesId);
  form.append(
    "unlock_price_gold_coins",
    String(Math.min(Math.max(Math.trunc(input.unlockPriceGoldCoins), 0), 100)),
  );
  appendShortDramaFile(form, "video", input.videoUri, input.videoFilename, input.videoMimeType);
  appendShortDramaFile(form, "cover", input.coverUri, input.coverFilename, "image/jpeg");
  return normalizeShortDramaEpisodeUploadResult(
    await apiRequest<unknown>(
      `/short-drama/series/${encodeURIComponent(input.seriesId)}/episodes`,
      { method: "POST", body: form, timeoutMs: 600_000 },
    ),
  );
}

export async function updateShortDramaEpisode(
  videoId: string,
  input: {
    title: string;
    intro: string;
    episodeNumber: number;
    unlockPriceGoldCoins: number;
  },
): Promise<ShortDramaVideo> {
  return normalizeShortDramaVideo(
    await apiRequest<unknown>(`/short-drama/videos/${encodeURIComponent(videoId)}`, {
      method: "PATCH",
      body: {
        title: input.title,
        intro: input.intro,
        episode_number: input.episodeNumber,
        unlock_price_gold_coins: Math.min(Math.max(Math.trunc(input.unlockPriceGoldCoins), 0), 100),
      },
    }),
  );
}

export async function deleteShortDramaEpisode(videoId: string): Promise<void> {
  await apiRequest<unknown>(`/short-drama/videos/${encodeURIComponent(videoId)}`, {
    method: "DELETE",
  });
}

export async function submitShortDramaSeries(
  seriesId: string,
  clientRequestId: string,
): Promise<ShortDramaSeries> {
  return normalizeShortDramaSeries(
    await apiRequest<unknown>(`/short-drama/series/${encodeURIComponent(seriesId)}/submit`, {
      method: "POST",
      body: { client_request_id: clientRequestId },
    }),
  );
}

function appendShortDramaFile(
  form: FormData,
  field: "cover" | "video",
  uri: string,
  filename: string,
  type: string,
): void {
  form.append(field, { uri, name: filename, type } as unknown as Blob);
}

export async function reportShortDramaProgress(
  videoId: string,
  positionSeconds: number,
  durationSeconds?: number | undefined,
  signal?: AbortSignal | undefined,
): Promise<void> {
  await apiRequest<unknown>(
    `/short-drama/videos/${encodeShortDramaPathComponent(videoId)}/progress`,
    {
      method: "POST",
      requiredEnvelope: true,
      timeoutMs: 4_000,
      ...(signal ? { signal } : {}),
      body: {
        position_seconds: Math.max(0, Number.isFinite(positionSeconds) ? positionSeconds : 0),
        ...(durationSeconds !== undefined && Number.isFinite(durationSeconds) && durationSeconds > 0
          ? { duration_seconds: durationSeconds }
          : {}),
      },
    },
  );
}

export async function unlockShortDramaEpisode(
  videoId: string,
  idempotencyKey: string,
): Promise<ShortDramaUnlockResult> {
  return normalizeShortDramaUnlockResult(
    await apiRequest<unknown>(
      `/short-drama/videos/${encodeShortDramaPathComponent(videoId)}/unlock`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: { idempotency_key: idempotencyKey },
        requiredData: true,
        requiredEnvelope: true,
      },
    ),
  );
}

export async function getWalletGoldCoinBalance(): Promise<number> {
  return (await getWalletBalance()).gold_coin_balance;
}

export async function reportCallQuality(callId: string, report: CallQualityReport): Promise<void> {
  await apiRequest<unknown>(`/call/${encodeURIComponent(callId)}/quality-report`, {
    method: "POST",
    body: callQualityReportBody(report),
  });
}

function callQualityReportBody(report: CallQualityReport): Record<string, unknown> {
  return {
    app_build: report.appBuild,
    sample_count: report.sampleCount,
    ...(report.outbound ? { outbound: callQualityStreamBody(report.outbound) } : {}),
    ...(report.inbound ? { inbound: callQualityStreamBody(report.inbound) } : {}),
    ...(report.iceTransport ? { ice_transport: report.iceTransport } : {}),
    ...(report.relay !== undefined ? { relay: report.relay } : {}),
  };
}

function callQualityStreamBody(stream: CallQualityStreamReport): Record<string, unknown> {
  return {
    ...(stream.width !== undefined ? { width: stream.width } : {}),
    ...(stream.height !== undefined ? { height: stream.height } : {}),
    ...(stream.fps !== undefined ? { fps: stream.fps } : {}),
    ...(stream.bitrateBps !== undefined ? { bitrate_bps: stream.bitrateBps } : {}),
    ...(stream.packetsLost !== undefined ? { packets_lost: stream.packetsLost } : {}),
    ...(stream.nackCount !== undefined ? { nack: stream.nackCount } : {}),
    ...(stream.pliCount !== undefined ? { pli: stream.pliCount } : {}),
    ...(stream.firCount !== undefined ? { fir: stream.firCount } : {}),
    ...(stream.framesDropped !== undefined ? { frames_dropped: stream.framesDropped } : {}),
    ...(stream.freezeCount !== undefined ? { freeze_count: stream.freezeCount } : {}),
    ...(stream.rttMs !== undefined ? { rtt_ms: stream.rttMs } : {}),
    ...(stream.fractionLost !== undefined ? { fraction_lost: stream.fractionLost } : {}),
    ...(stream.qualityLimitationReason
      ? { quality_limitation_reason: stream.qualityLimitationReason }
      : {}),
  };
}

export async function getWalletBalance(): Promise<WalletBalanceSnapshot> {
  return normalizeWalletBalanceSnapshot(
    await apiRequest<unknown>("/wallet/balance", {
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
    }),
  );
}

export async function getWalletTransactionPage(
  options: {
    cursor?: string | undefined;
    limit?: number | undefined;
  } = {},
): Promise<WalletTransactionPage> {
  const query = new URLSearchParams({
    limit: String(Math.min(Math.max(options.limit ?? 50, 1), 100)),
  });
  if (options.cursor?.trim()) query.set("cursor", options.cursor.trim());
  return normalizeWalletTransactionPage(
    await apiRequest<unknown>(`/wallet/transactions?${query.toString()}`, {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function getActivityCatFoodTransactionPage(
  options: {
    cursor?: string | undefined;
    limit?: number | undefined;
  } = {},
): Promise<ActivityCatFoodTransactionPage> {
  const query = new URLSearchParams({
    limit: String(Math.min(Math.max(options.limit ?? 20, 1), 50)),
  });
  if (options.cursor?.trim()) query.set("cursor", options.cursor.trim());
  return normalizeActivityCatFoodTransactionPage(
    await apiRequest<unknown>(`/wallet/activity-cat-food/transactions?${query.toString()}`, {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function getWalletWithdrawals(): Promise<WalletWithdrawal[]> {
  return normalizeWalletWithdrawals(
    await apiRequest<unknown>("/wallet/withdrawals", {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function createWalletWithdrawal(input: {
  goldCoinAmount: number;
  usdtAmount: string;
  network: string;
  walletAddress: string;
}): Promise<WalletWithdrawal | undefined> {
  const value = await apiRequest<unknown>("/wallet/withdrawals", {
    method: "POST",
    requiredEnvelope: true,
    body: {
      gold_coin_amount: input.goldCoinAmount,
      usdt_amount: input.usdtAmount,
      payout_method: "usdt",
      payout_account: `${input.network}:${input.walletAddress}`,
      network: input.network,
      wallet_address: input.walletAddress,
    },
  });
  if (!isRecord(value)) return undefined;
  const withdrawal = value.withdrawal ?? value.item ?? value.record ?? value.data ?? value;
  return isRecord(withdrawal) ? normalizeWalletWithdrawal(withdrawal) : undefined;
}

export async function cancelWalletWithdrawal(id: string): Promise<WalletWithdrawal | undefined> {
  const value = await apiRequest<unknown>(`/wallet/withdrawals/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: {},
    requiredEnvelope: true,
  });
  if (!isRecord(value)) return undefined;
  const withdrawal = value.withdrawal ?? value.item ?? value.record ?? value.data ?? value;
  return isRecord(withdrawal) ? normalizeWalletWithdrawal(withdrawal) : undefined;
}

export async function getWalletAdRewardStatus(): Promise<WalletAdRewardStatus> {
  return normalizeWalletAdRewardStatus(
    await apiRequest<unknown>("/wallet/ad-rewards/status", {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
}

export async function createWalletAdRewardSession(input: {
  adUnitId: string;
  platform: "ios" | "android";
}): Promise<WalletAdRewardSession> {
  return normalizeWalletAdRewardSession(
    await apiRequest<unknown>("/wallet/ad-rewards/sessions", {
      method: "POST",
      requiredData: true,
      requiredEnvelope: true,
      body: {
        platform: input.platform,
        ad_unit_id: input.adUnitId,
        reward_item: "gold_coin",
      },
    }),
  );
}

export async function confirmWalletIapPurchase(input: {
  productId: string;
  transactionId: string;
  originalTransactionId: string;
  signedPayload: string;
  purchaseDate: string;
  bundleId: string;
  appAccountToken?: string | undefined;
}): Promise<WalletIapConfirmation> {
  return normalizeWalletIapConfirmation(
    await apiRequest<unknown>("/wallet/ios-iap/confirm", {
      method: "POST",
      requiredData: true,
      requiredEnvelope: true,
      body: {
        platform: "ios",
        product_id: input.productId,
        transaction_id: input.transactionId,
        original_transaction_id: input.originalTransactionId,
        signed_payload: input.signedPayload,
        signed_transaction_info: input.signedPayload,
        purchase_date: input.purchaseDate,
        bundle_id: input.bundleId,
        ...(input.appAccountToken ? { app_account_token: input.appAccountToken } : {}),
      },
    }),
  );
}

export async function getGiftCatalog(): Promise<GiftCatalogItem[]> {
  const value = await apiRequest<unknown>("/wallet/gifts/catalog");
  return normalizeGiftCatalog(value);
}

export async function getChatMoneyConfiguration(): Promise<ChatMoneyConfiguration> {
  const configuration = normalizeChatMoneyConfiguration(
    await apiRequest<unknown>("/wallet/chat-money/config"),
  );
  if (!configuration) throw new Error("红包与转账配置响应格式无效");
  return configuration;
}

export async function createRedPacketMessage(request: {
  clientMessageId: string;
  scope: ChatMoneyScope;
  mode: ChatMoneyRedPacketMode;
  totalAmount: number;
  packetCount: number;
  greeting: string;
  receiverId?: string | undefined;
  groupId?: number | undefined;
  recipientId?: string | undefined;
  recipientName?: string | undefined;
  amountPerPacket?: number | undefined;
}): Promise<ChatMoneyCreationResult> {
  const value = await apiRequest<unknown>("/wallet/red-packets", {
    method: "POST",
    body: {
      client_message_id: request.clientMessageId,
      scope: request.scope,
      mode: request.mode,
      total_amount: request.totalAmount,
      packet_count: request.packetCount,
      greeting: request.greeting,
      ...(request.receiverId ? { receiver_id: request.receiverId } : {}),
      ...(request.groupId !== undefined ? { group_id: request.groupId } : {}),
      ...(request.recipientId ? { recipient_id: request.recipientId } : {}),
      ...(request.recipientName ? { recipient_name: request.recipientName } : {}),
      ...(request.amountPerPacket !== undefined
        ? { amount_per_packet: request.amountPerPacket }
        : {}),
    },
  });
  return normalizeChatMoneyCreationResult(value, request.scope);
}

export async function createTransferMessage(request: {
  clientMessageId: string;
  scope: ChatMoneyScope;
  recipientId: string;
  amount: number;
  note: string;
  receiverId?: string | undefined;
  groupId?: number | undefined;
  recipientName?: string | undefined;
}): Promise<ChatMoneyCreationResult> {
  const value = await apiRequest<unknown>("/wallet/transfers", {
    method: "POST",
    body: {
      client_message_id: request.clientMessageId,
      scope: request.scope,
      recipient_id: request.recipientId,
      amount: request.amount,
      note: request.note,
      ...(request.receiverId ? { receiver_id: request.receiverId } : {}),
      ...(request.groupId !== undefined ? { group_id: request.groupId } : {}),
      ...(request.recipientName ? { recipient_name: request.recipientName } : {}),
    },
  });
  return normalizeChatMoneyCreationResult(value, request.scope);
}

export async function getChatMoneyDetail(assetId: string): Promise<ChatMoneyDetail> {
  const detail = normalizeChatMoneyDetail(
    await apiRequest<unknown>(`/wallet/chat-money/${encodeURIComponent(assetId)}`),
  );
  if (!detail) throw new Error("红包或转账详情响应格式无效");
  return detail;
}

export async function claimRedPacket(assetId: string): Promise<ChatMoneyActionResult> {
  const value = await apiRequest<unknown>(
    `/wallet/red-packets/${encodeURIComponent(assetId)}/claim`,
    {
      method: "POST",
      body: {},
    },
  );
  return normalizeChatMoneyActionResult(value);
}

export async function acceptTransfer(assetId: string): Promise<ChatMoneyActionResult> {
  const value = await apiRequest<unknown>(
    `/wallet/transfers/${encodeURIComponent(assetId)}/accept`,
    {
      method: "POST",
      body: {},
    },
  );
  return normalizeChatMoneyActionResult(value);
}

export async function returnTransfer(assetId: string): Promise<ChatMoneyActionResult> {
  const value = await apiRequest<unknown>(
    `/wallet/transfers/${encodeURIComponent(assetId)}/return`,
    {
      method: "POST",
      body: {},
    },
  );
  return normalizeChatMoneyActionResult(value);
}

export async function updateUsername(username: string): Promise<User> {
  const value = await apiRequest<unknown>("/profile/username", {
    method: "PUT",
    body: { username },
    requiredData: true,
    requiredEnvelope: true,
  });
  if (!isRecord(value)) {
    throw new APIError("api.decodingError", 200, value, "decoding_error");
  }
  try {
    return normalizeUser(value.profile ?? value.user);
  } catch {
    throw new APIError("api.decodingError", 200, value, "decoding_error");
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiRequest<unknown>("/auth/change-password", {
    method: "POST",
    body: { old_password: currentPassword, new_password: newPassword },
    requiredEnvelope: true,
  });
}

export function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().toUpperCase();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    .replace(/[xy]/g, (token) => {
      const random = Math.floor(Math.random() * 16);
      return (token === "x" ? random : (random & 0x3) | 0x8).toString(16);
    })
    .toUpperCase();
}

function normalizedDirectGiftResponse(
  value: unknown,
  recipientId: string,
  giftId: string,
): Message {
  const record = isRecord(value) ? value : {};
  const messageValue =
    firstUsableGiftMessage(record, [
      "message",
      "msg",
      "chat_message",
      "chatMessage",
      "data",
      "item",
    ]) ?? (isUsableGiftMessageValue(record) ? record : null);
  const message = messageValue ? normalizeMessage(messageValue) : null;
  const content = normalizedGiftContent(record, message?.content, recipientId, giftId);
  return {
    id: message?.id || fallbackMessageId(),
    sender_id: message?.sender_id ?? "",
    receiver_id: message?.receiver_id || recipientId,
    msg_type: parseGiftMessagePayload(content) ? "gift" : message?.msg_type || "gift",
    content,
    timestamp: message?.timestamp || new Date().toISOString(),
    ...(message?.reply_to_id !== undefined ? { reply_to_id: message.reply_to_id } : {}),
    ...(message?.reply_to ? { reply_to: message.reply_to } : {}),
    ...(message?.client_message_id ? { client_message_id: message.client_message_id } : {}),
    version: message?.version ?? 1,
    ...(message?.updated_at ? { updated_at: message.updated_at } : {}),
  };
}

function normalizeChatMoneyCreationResult(
  value: unknown,
  scope: ChatMoneyScope,
): ChatMoneyCreationResult {
  const record = findChatMoneyResponseRecord(value);
  const directSource = firstObject(record, ["message", "direct_message", "directMessage"]);
  const groupSource = firstObject(record, ["group_message", "groupMessage"]);
  const directMessage = directSource ? normalizeMessage(directSource) : undefined;
  const groupMessage = groupSource ? normalizeGroupMessage(groupSource) : undefined;
  if (scope === "dm" && !directMessage) throw new Error("红包或转账创建响应缺少私聊消息");
  if (scope === "group" && !groupMessage) throw new Error("红包或转账创建响应缺少群聊消息");
  const payload = firstChatMoneyPayload(record, directMessage?.content, groupMessage?.content);
  if (!payload) throw new Error("红包或转账创建响应缺少资产数据");
  const wallet = firstObject(record, ["wallet_balance", "walletBalance", "balance"]);
  return {
    ...(scope === "dm" && directMessage ? { direct_message: directMessage } : {}),
    ...(scope === "group" && groupMessage ? { group_message: groupMessage } : {}),
    payload,
    ...(wallet ? { wallet_balance: normalizeWalletBalanceSnapshot(wallet) } : {}),
  };
}

function normalizeChatMoneyActionResult(value: unknown): ChatMoneyActionResult {
  const record = findChatMoneyResponseRecord(value);
  const detail = normalizeChatMoneyDetail(record);
  const payload = firstChatMoneyPayload(record);
  if (!detail || !payload) throw new Error("红包或转账操作响应格式无效");
  const directReceipt = firstObject(record, ["receipt_message", "receiptMessage", "message"]);
  const groupReceipt = firstObject(record, [
    "receipt_group_message",
    "receiptGroupMessage",
    "group_message",
    "groupMessage",
  ]);
  const wallet = firstObject(record, ["wallet_balance", "walletBalance", "balance"]);
  return {
    detail,
    payload,
    ...(wallet ? { wallet_balance: normalizeWalletBalanceSnapshot(wallet) } : {}),
    ...(directReceipt ? { direct_receipt_message: normalizeMessage(directReceipt) } : {}),
    ...(groupReceipt ? { group_receipt_message: normalizeGroupMessage(groupReceipt) } : {}),
  };
}

function findChatMoneyResponseRecord(value: unknown): Record<string, unknown> {
  let current = isRecord(value) ? value : {};
  for (let depth = 0; depth < 4; depth += 1) {
    const hasKnownField = [
      "asset",
      "payload",
      "detail",
      "message",
      "group_message",
      "wallet_balance",
    ].some((key) => key in current);
    if (hasKnownField) return current;
    const nested = firstObject(current, ["data", "result", "chat_money", "chatMoney"]);
    if (!nested) break;
    current = nested;
  }
  return current;
}

function firstChatMoneyPayload(
  record: Record<string, unknown>,
  ...contents: (string | undefined)[]
): ChatMoneyPayload | null {
  for (const candidate of [
    record.asset,
    record.payload,
    record.chat_money,
    record.chatMoney,
    record.detail,
  ]) {
    const payload = normalizeChatMoneyPayload(candidate);
    if (payload) return payload;
  }
  for (const content of contents) {
    if (!content) continue;
    const payload = parseChatMoneyPayload(content);
    if (payload) return payload;
  }
  return normalizeChatMoneyPayload(record);
}

function firstObject(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    if (isRecord(record[key])) return record[key];
  }
  return null;
}

function normalizedGroupGiftResponse(
  value: unknown,
  groupId: number,
  recipientId: string,
  giftId: string,
): GroupMessage {
  const record = isRecord(value) ? value : {};
  const messageValue =
    firstUsableGiftMessage(record, [
      "message",
      "msg",
      "group_message",
      "groupMessage",
      "chat_message",
      "chatMessage",
      "data",
      "item",
    ]) ?? (isUsableGiftMessageValue(record) ? record : null);
  const message = messageValue ? normalizeGroupMessage(messageValue) : null;
  const content = normalizedGiftContent(record, message?.content, recipientId, giftId);
  const senderId = message?.sender_id ?? "";
  return {
    id: message?.id || fallbackMessageId(),
    group_id: message?.group_id || groupId,
    sender_id: senderId,
    msg_type: parseGiftMessagePayload(content) ? "gift" : message?.msg_type || "gift",
    content,
    timestamp: message?.timestamp || new Date().toISOString(),
    sender_nickname: message?.sender_nickname || senderId,
    sender_avatar: message?.sender_avatar || "",
    ...(message?.reply_to_id !== undefined ? { reply_to_id: message.reply_to_id } : {}),
    ...(message?.reply_to ? { reply_to: message.reply_to } : {}),
    ...(message?.mentions ? { mentions: message.mentions } : {}),
    mention_all: message?.mention_all ?? false,
    ...(message?.client_message_id ? { client_message_id: message.client_message_id } : {}),
    ...(message?.history_sequence !== undefined
      ? { history_sequence: message.history_sequence }
      : {}),
    version: message?.version ?? 1,
    ...(message?.updated_at ? { updated_at: message.updated_at } : {}),
  };
}

function firstUsableGiftMessage(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const candidate = record[key];
    if (isUsableGiftMessageValue(candidate)) return candidate;
  }
  return null;
}

function isUsableGiftMessageValue(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const id = Number(value.id ?? value.message_id ?? value.messageId ?? 0);
  const type = String(value.msg_type ?? value.msgType ?? value.type ?? "").toLocaleLowerCase();
  const content = flexibleGiftContent(value.content ?? value.payload ?? value.gift);
  return (
    (Number.isFinite(id) && id !== 0) ||
    type === "gift" ||
    (content ? parseGiftMessagePayload(content) !== null : false)
  );
}

function normalizedGiftContent(
  response: Record<string, unknown>,
  messageContent: string | undefined,
  recipientId: string,
  giftId: string,
): string {
  for (const candidate of [
    response.gift,
    response.payload,
    response.content,
    response.data,
    response.item,
    messageContent,
  ]) {
    const content = flexibleGiftContent(candidate);
    if (content && parseGiftMessagePayload(content)) return content;
  }
  const gift = fixedGiftCatalog.find((item) => item.gift_id === giftId) ?? {
    gift_id: giftId,
    name: "礼物",
    price: 0,
    asset_key: "gift_fish",
    receiver_currency: "gold_coin" as const,
  };
  const payload: GiftMessagePayload = makeGiftMessagePayload(gift, {
    id: recipientId,
    name: "",
    avatar_url: "",
  });
  delete payload.recipient_name;
  return encodeGiftMessagePayload(payload);
}

function flexibleGiftContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function fallbackMessageId(): number {
  return Date.now() + Math.floor(Math.random() * 1_000);
}

async function getFollowUsersPage(
  path: "/follows/following" | "/follows/followers",
  options: { userId?: string; page?: number; limit?: number },
): Promise<FollowUsersPage> {
  const query = new URLSearchParams({
    page: String(options.page ?? 1),
    limit: String(options.limit ?? 30),
  });
  if (options.userId?.trim()) query.set("user_id", options.userId.trim());
  const page = normalizeFollowUsersPage(
    await apiRequest<unknown>(`${path}?${query.toString()}`, {
      requiredData: true,
      requiredEnvelope: true,
    }),
  );
  await cacheUserInfoBatch(page.users).catch(() => undefined);
  return page;
}
