import { randomUUID } from "expo-crypto";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  clearDirectMessageHistory,
  clearGroupMessageHistory,
  createAgentConversation,
  getAgentConversations,
  getConversationSyncSnapshot,
  getFriendList,
  getInstalledAgents,
  getScriptRoom,
  hideConversation,
  updateConversationPreference,
} from "@/api/bwchat";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { Avatar } from "@/components/Avatar";
import { GroupMemberAvatar } from "@/components/GroupMemberAvatar";
import { RootTabTitle } from "@/components/RootTabTitle";
import { TopToast } from "@/components/TopToast";
import { env } from "@/config/env";
import type { Conversation } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useCall } from "@/providers/CallProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { loadCachedAgentCatalog, saveAgentCatalog } from "@/services/agents/AgentCatalogRepository";
import {
  applyAgentRealtimeMessage,
  applyConversationLocalState,
  applyServerPinnedRows,
  conversationListIdentity,
  conversationListTime,
  conversationPreferenceTarget,
  conversationPreviewText,
  conversationEventSender,
  conversationSenderPrefix,
  consumeConversationRealtimeUnreadEvent,
  isAgentConversation,
  isScriptRoomConversation,
  mergeAgentConversationRows,
  preservingIncompleteConversationRows,
  reconcileLatestConversationPreviews,
  reconcileRetainedDirectConversationRows,
  resolvedGroupId,
  shouldApplyRealtimeConversationPreview,
  shouldResolveScriptRoomAvatar,
  visibleChatConversations,
} from "@/services/conversations/ConversationListPolicy";
import { ConversationAccountScope } from "@/services/conversations/ConversationAccountScope";
import { conversationSyncCoordinator } from "@/services/conversations/ConversationSyncCoordinator";
import {
  markConversationRead,
  resetConversationReadSubmissionForAccount,
} from "@/services/conversations/ConversationReadService";
import {
  applyDirectConversationCandidate,
  applyConversationReadReceiptToItems,
  applyDirectConversationPreviewUpdate,
  applyGroupConversationPreviewUpdate,
  clearDirectConversationPreview,
  hideCachedConversation,
  loadCachedConversationSnapshot,
  loadConversationInitiatedDmIds,
  loadConversationListLocalState,
  loadConversationLivePairIds,
  loadConversationSnapshotWithNativeCache,
  resetConversationRepositoryMemoryForAccount,
  saveCachedConversationItemsProjection,
  saveConversationHiddenSnapshots,
  saveConversationInitiatedDmIds,
  saveConversationLivePairIds,
  saveConversationPinnedKeys,
  subscribeConversationCatalogRefreshes,
  subscribeConversationReadReceipts,
  subscribeConversationSnapshotUpdates,
  subscribeDirectConversationCandidates,
  subscribeDirectConversationPreviewUpdates,
  subscribeGroupConversationPreviewUpdates,
  unhideCachedConversation,
} from "@/services/conversations/ConversationRepository";
import { publishConversationUnread } from "@/services/conversations/ConversationUnreadStore";
import {
  loadCachedFriends,
  loadFriendsWithNativeCache,
  resetFriendRepositoryMemoryForAccount,
} from "@/services/friends/FriendRepository";
import {
  applyDirectHistoryClear,
  subscribeDirectHistoryClear,
} from "@/services/messages/DirectHistoryClearRepository";
import {
  applyGroupHistoryClear,
  subscribeGroupHistoryClear,
} from "@/services/messages/GroupHistoryClearRepository";
import { readChatDraft } from "@/services/messages/ChatDraftRepository";
import { chatMoneyMessagePreview } from "@/services/messages/chatMoneyPolicy";
import { giftMessagePreview } from "@/services/messages/chatGiftPolicy";
import { chatRecallNotice } from "@/services/messages/chatReplyPolicy";
import {
  localizedChatStickerText,
  parseChatStickerMessagePayload,
} from "@/services/messages/chatStickerPolicy";
import { featureFlagEnabled } from "@/services/remote-config/RemoteConfigService";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";
import { rememberScriptRoomConversation } from "@/services/scripts/ScriptRoomNavigationStore";
import {
  loadCachedScriptRoom,
  saveCachedScriptRoom,
} from "@/services/scripts/ScriptRoomRepository";
import { palette } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

const ROOT_HORIZONTAL_INSET = 16;
const CONVERSATION_CARD_HEIGHT = 72;
const ROOT_TAB_BOTTOM_CLEARANCE = 160;
const SWIPE_ACTION_WIDTH = 144;

type Translate = (key: string, ...args: (string | number)[]) => string;
type ConversationTheme = ReturnType<typeof palette>;
type ConversationLoadMode = "initial" | "manual" | "projection" | "dependencies";

export default function ConversationsScreen() {
  const insets = useSafeAreaInsets();
  const { styles, theme } = useConversationTheme();
  const { user } = useAuth();
  const { session: activeCall } = useCall();
  const { activeLanguage, t } = useLocalization();
  const { config } = useRemoteConfig();
  const ownerId = user?.user_id ?? "";
  const [stateOwnerId, setStateOwnerId] = useState(ownerId);
  const [items, setItemsState] = useState<Conversation[]>([]);
  const itemsRef = useRef<Conversation[]>([]);
  const [pinnedKeys, setPinnedKeysState] = useState<Set<string>>(new Set());
  const pinnedKeysRef = useRef(new Set<string>());
  const [hiddenSnapshots, setHiddenSnapshotsState] = useState<Record<string, string>>({});
  const hiddenSnapshotsRef = useRef<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshControlRevision, setRefreshControlRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [isSearchFocused, setSearchFocused] = useState(false);
  const [isActionMenuVisible, setActionMenuVisible] = useState(false);
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());
  const openingAgentKeys = useRef(new Set<string>());
  const loadGeneration = useRef(0);
  const activeOwner = useRef(ownerId);
  const accountScopeRef = useRef(new ConversationAccountScope(ownerId));
  const locallyInitiatedDmIds = useRef(new Set<string>());
  const livePairDmIds = useRef(new Set<string>());
  const openSwipeKey = useRef<string | null>(null);
  const swipeClosers = useRef(new Map<string, () => void>());

  const setItems = useCallback(
    (next: Conversation[] | ((current: Conversation[]) => Conversation[])) => {
      setItemsState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        itemsRef.current = resolved;
        return resolved;
      });
    },
    [],
  );

  const setPinnedKeys = useCallback((next: Set<string>) => {
    pinnedKeysRef.current = next;
    setPinnedKeysState(next);
  }, []);

  const setHiddenSnapshots = useCallback((next: Record<string, string>) => {
    hiddenSnapshotsRef.current = next;
    setHiddenSnapshotsState(next);
  }, []);

  useLayoutEffect(() => {
    const previousOwner = activeOwner.current;
    if (previousOwner && previousOwner !== ownerId) {
      resetConversationRepositoryMemoryForAccount(previousOwner);
      resetFriendRepositoryMemoryForAccount(previousOwner);
      resetConversationReadSubmissionForAccount(previousOwner);
    }
    activeOwner.current = ownerId;
    accountScopeRef.current.updateOwner(ownerId);
    const ticket = accountScopeRef.current.capture();
    loadGeneration.current += 1;
    itemsRef.current = [];
    pinnedKeysRef.current = new Set();
    hiddenSnapshotsRef.current = {};
    locallyInitiatedDmIds.current.clear();
    livePairDmIds.current.clear();
    openingAgentKeys.current.clear();
    closeOpenSwipe(openSwipeKey, swipeClosers);
    queueMicrotask(() => {
      if (!accountScopeRef.current.isCurrent(ticket)) return;
      setStateOwnerId(ownerId);
      setItemsState([]);
      setPinnedKeysState(new Set());
      setHiddenSnapshotsState({});
      setDrafts({});
      setError(null);
      setToastMessage(null);
      setSearchText("");
      setSearchFocused(false);
      setActionMenuVisible(false);
      setDeletingKeys(new Set());
      setIsLoading(Boolean(ownerId));
      setIsRefreshing(false);
    });
  }, [ownerId]);

  const refreshDrafts = useCallback(
    async (rows: readonly Conversation[]) => {
      if (!ownerId) return;
      const ticket = accountScopeRef.current.capture();
      if (ticket.ownerId !== ownerId) return;
      const entries = await Promise.all(
        rows.flatMap((conversation) => {
          if (isAgentConversation(conversation) || isScriptRoomConversation(conversation))
            return [];
          const groupId = resolvedGroupId(conversation);
          const type = groupId ? "group" : "dm";
          const id = groupId ? String(groupId) : conversation.id;
          return [
            readChatDraft(ownerId, id, type).then(
              (draft) => [conversationListIdentity(conversation), draft] as const,
            ),
          ];
        }),
      );
      if (accountScopeRef.current.isCurrent(ticket)) setDrafts(Object.fromEntries(entries));
    },
    [ownerId],
  );

  const load = useCallback(
    async (mode: ConversationLoadMode = "initial") => {
      if (!ownerId) return;
      const forceRefresh = mode === "manual";
      const forceDependencyRefresh = forceRefresh || mode === "dependencies";
      const showRefreshIndicator = mode === "manual";
      const generation = ++loadGeneration.current;
      if (showRefreshIndicator) setIsRefreshing(true);
      else if (mode === "initial") setIsLoading(true);
      try {
        const [
          cachedSnapshot,
          localState,
          cachedFriends,
          cachedCatalog,
          storedLivePairIds,
          storedInitiatedDmIds,
        ] = await Promise.all([
          loadCachedConversationSnapshot(ownerId),
          loadConversationListLocalState(ownerId),
          loadCachedFriends(ownerId),
          loadCachedAgentCatalog(ownerId),
          loadConversationLivePairIds(ownerId),
          loadConversationInitiatedDmIds(ownerId),
        ]);
        if (generation !== loadGeneration.current || activeOwner.current !== ownerId) return;
        livePairDmIds.current = storedLivePairIds;
        locallyInitiatedDmIds.current = new Set([
          ...locallyInitiatedDmIds.current,
          ...storedLivePairIds,
          ...storedInitiatedDmIds,
        ]);
        setPinnedKeys(localState.pinnedKeys);
        setHiddenSnapshots(localState.hiddenSnapshots);
        if (!forceRefresh && cachedSnapshot) {
          const provisionalChat = reconcileLatestConversationPreviews(
            visibleChatConversations(
              cachedSnapshot.conversations.filter((row) => !isAgentConversation(row)),
              cachedFriends,
              ownerId,
              locallyInitiatedDmIds.current,
            ),
            itemsRef.current,
          );
          const provisional = mergeAgentConversationRows(
            provisionalChat,
            cachedSnapshot.conversations,
            cachedCatalog?.value.conversations,
            cachedCatalog?.value.installedAgents,
            t,
          );
          setItems(provisional);
          void refreshDrafts(provisional);
          setIsLoading(false);
        }
        if (mode === "projection") {
          setError(null);
          return;
        }

        const [snapshotResult, friendsResult, agentConversationsResult, installedAgentsResult] =
          await Promise.allSettled([
            loadConversationSnapshotWithNativeCache(ownerId, getConversationSyncSnapshot, {
              forceRefresh,
            }),
            loadFriendsWithNativeCache(ownerId, getFriendList, {
              forceRefresh: forceDependencyRefresh,
            }),
            getAgentConversations(),
            getInstalledAgents(),
          ]);
        if (generation !== loadGeneration.current || activeOwner.current !== ownerId) return;
        if (snapshotResult.status === "rejected") throw snapshotResult.reason;

        const snapshot = snapshotResult.value;
        const friends = friendsResult.status === "fulfilled" ? friendsResult.value : cachedFriends;
        const currentChatRows = itemsRef.current.filter((row) => !isAgentConversation(row));
        const incomingChatRows = visibleChatConversations(
          snapshot.conversations.filter((row) => !isAgentConversation(row)),
          friends,
          ownerId,
          locallyInitiatedDmIds.current,
        );
        const chatRows = reconcileLatestConversationPreviews(
          reconcileRetainedDirectConversationRows(
            preservingIncompleteConversationRows(
              incomingChatRows,
              currentChatRows,
              snapshot.snapshot_complete,
            ),
            currentChatRows,
            locallyInitiatedDmIds.current,
          ),
          currentChatRows,
        );
        const nextPinned = applyServerPinnedRows(pinnedKeysRef.current, snapshot.conversations);
        setPinnedKeys(nextPinned);
        await saveConversationPinnedKeys(ownerId, nextPinned).catch(() => undefined);

        const agentConversations =
          agentConversationsResult.status === "fulfilled"
            ? agentConversationsResult.value
            : undefined;
        const installedAgents =
          installedAgentsResult.status === "fulfilled" ? installedAgentsResult.value : undefined;
        let merged = mergeAgentConversationRows(
          chatRows,
          itemsRef.current,
          agentConversations,
          installedAgents,
          t,
        );
        merged = await resolvingScriptRoomAvatars(ownerId, merged);
        if (generation !== loadGeneration.current || activeOwner.current !== ownerId) return;

        const applied = applyConversationLocalState(
          merged,
          {
            pinnedKeys: nextPinned,
            hiddenSnapshots: hiddenSnapshotsRef.current,
          },
          ownerId,
        );
        if (!sameStringRecord(applied.hiddenSnapshots, hiddenSnapshotsRef.current)) {
          setHiddenSnapshots(applied.hiddenSnapshots);
          await saveConversationHiddenSnapshots(ownerId, applied.hiddenSnapshots).catch(
            () => undefined,
          );
        }
        setItems(merged);
        await saveCachedConversationItemsProjection(ownerId, merged).catch(() => undefined);
        await refreshDrafts(merged);

        if (
          agentConversationsResult.status === "fulfilled" ||
          installedAgentsResult.status === "fulfilled"
        ) {
          const cachedValue = cachedCatalog?.value;
          await saveAgentCatalog(ownerId, {
            installedAgents: installedAgents ?? cachedValue?.installedAgents ?? [],
            conversations: agentConversations ?? cachedValue?.conversations ?? [],
            joinedScriptRooms: merged.filter(isScriptRoomConversation),
            ...(cachedValue?.runtimeConfig ? { runtimeConfig: cachedValue.runtimeConfig } : {}),
            ...(cachedValue?.spendableBalance !== undefined
              ? { spendableBalance: cachedValue.spendableBalance }
              : {}),
          }).catch(() => undefined);
        }
        setError(null);
      } catch (nextError) {
        if (generation !== loadGeneration.current || activeOwner.current !== ownerId) return;
        const message = readableError(nextError, t("messages.loadFailed"));
        if (itemsRef.current.length === 0) setError(message);
        else setToastMessage(message);
      } finally {
        if (generation === loadGeneration.current && activeOwner.current === ownerId) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [ownerId, refreshDrafts, setHiddenSnapshots, setItems, setPinnedKeys, t],
  );

  useFocusEffect(
    useCallback(() => {
      Keyboard.dismiss();
      const resetRefreshFrame = requestAnimationFrame(() => {
        setIsRefreshing(false);
        setRefreshControlRevision((current) => current + 1);
      });
      void load(itemsRef.current.length > 0 ? "projection" : "initial");
      void refreshDrafts(itemsRef.current);
      return () => {
        cancelAnimationFrame(resetRefreshFrame);
        closeOpenSwipe(openSwipeKey, swipeClosers);
      };
    }, [load, refreshDrafts]),
  );

  useEffect(() => {
    if (!ownerId || !activeCall?.is_live_pair || !activeCall.remote_user_id.trim()) return;
    const ticket = accountScopeRef.current.capture();
    if (ticket.ownerId !== ownerId || !accountScopeRef.current.isCurrent(ticket)) return;
    const peerId = activeCall.remote_user_id.trim();
    locallyInitiatedDmIds.current.add(peerId);
    livePairDmIds.current.add(peerId);
    void saveConversationLivePairIds(ownerId, livePairDmIds.current);
    void saveConversationInitiatedDmIds(ownerId, locallyInitiatedDmIds.current);
    setItems((current) => {
      if (!accountScopeRef.current.isCurrent(ticket)) return current;
      const index = current.findIndex((row) => conversationListIdentity(row) === `dm:${peerId}`);
      const name = activeCall.remote_nickname.trim() || peerId;
      const avatarUrl = activeCall.remote_avatar_url.trim();
      const next = [...current];
      if (index >= 0) {
        const existing = next[index];
        if (!existing) return current;
        next[index] = {
          ...existing,
          name: activeCall.remote_nickname.trim() || existing.name,
          avatar_url: avatarUrl || existing.avatar_url,
          conversation_kind: existing.conversation_kind ?? "live_call",
        };
      } else {
        next.push({
          type: "dm",
          id: peerId,
          name,
          avatar_url: avatarUrl,
          unread_count: 0,
          conversation_kind: "live_call",
          is_muted: false,
        });
      }
      void saveCachedConversationItemsProjection(ownerId, next);
      return next;
    });
  }, [activeCall, ownerId, setItems]);

  useEffect(() => {
    if (!ownerId) return;
    const ticket = accountScopeRef.current.capture();
    return subscribeDirectHistoryClear((event) => {
      if (event.owner_id !== ownerId || !accountScopeRef.current.isCurrent(ticket)) return;
      setItems((current) => clearDirectConversationPreview(current, event.conversation_id));
    });
  }, [ownerId, setItems]);

  useEffect(() => {
    if (!ownerId) return;
    const ticket = accountScopeRef.current.capture();
    return subscribeGroupHistoryClear((event) => {
      if (event.owner_id !== ownerId || !accountScopeRef.current.isCurrent(ticket)) return;
      setItems((current) =>
        current.map((conversation) =>
          resolvedGroupId(conversation) === event.group_id
            ? withoutConversationPreview(conversation)
            : conversation,
        ),
      );
    });
  }, [ownerId, setItems]);

  useEffect(() => {
    if (!ownerId) return;
    const ticket = accountScopeRef.current.capture();
    return subscribeDirectConversationCandidates(ownerId, (candidate) => {
      if (!accountScopeRef.current.isCurrent(ticket)) return;
      locallyInitiatedDmIds.current.add(candidate.contact_id);
      const identity = `dm:${candidate.contact_id}`;
      if (hiddenSnapshotsRef.current[identity] !== undefined) {
        const nextHidden = { ...hiddenSnapshotsRef.current };
        delete nextHidden[identity];
        setHiddenSnapshots(nextHidden);
      }
      setItems((current) => applyDirectConversationCandidate(current, candidate));
    });
  }, [ownerId, setHiddenSnapshots, setItems]);

  useEffect(() => {
    if (!ownerId) return;
    const ticket = accountScopeRef.current.capture();
    return subscribeDirectConversationPreviewUpdates(ownerId, (update) => {
      if (!accountScopeRef.current.isCurrent(ticket)) return;
      setItems((current) => applyDirectConversationPreviewUpdate(current, update));
    });
  }, [ownerId, setItems]);

  useEffect(() => {
    if (!ownerId) return;
    const ticket = accountScopeRef.current.capture();
    return subscribeGroupConversationPreviewUpdates(ownerId, (update) => {
      if (!accountScopeRef.current.isCurrent(ticket)) return;
      setItems((current) => applyGroupConversationPreviewUpdate(current, update));
    });
  }, [ownerId, setItems]);

  useEffect(() => {
    if (!ownerId) return;
    const ticket = accountScopeRef.current.capture();
    return subscribeConversationReadReceipts(ownerId, (receipt) => {
      if (!accountScopeRef.current.isCurrent(ticket)) return;
      setItems((current) => applyConversationReadReceiptToItems(current, receipt));
    });
  }, [ownerId, setItems]);

  useEffect(() => {
    if (!ownerId) return;
    return subscribeConversationSnapshotUpdates(ownerId, () => load("projection"));
  }, [load, ownerId]);

  useEffect(() => {
    if (!ownerId) return;
    return subscribeConversationCatalogRefreshes(ownerId, () => load("dependencies"));
  }, [load, ownerId]);

  useEffect(() => {
    if (!ownerId) return;
    return chatRealtimeService.subscribe((event) => {
      const eventTicket = accountScopeRef.current.capture();
      if (eventTicket.ownerId !== ownerId) return;
      if (event.type === "refresh_conversations") {
        // RealtimeProvider funnels refresh, foreground, network and push triggers through the
        // account-scoped single-flight coordinator above.
        return;
      }
      if (event.type === "conversation_preference") {
        if (!accountScopeRef.current.isCurrent(eventTicket)) return;
        const identity = `${event.preference.conversation_type === "group" ? "group" : "dm"}:${event.preference.target_id}`;
        const next = new Set(pinnedKeysRef.current);
        if (event.preference.is_pinned) next.add(identity);
        else next.delete(identity);
        setPinnedKeys(next);
        void saveConversationPinnedKeys(ownerId, next);
        return;
      }
      if (event.type === "direct_message" && event.message.sender_id === ownerId) {
        locallyInitiatedDmIds.current.add(event.message.receiver_id);
        void saveConversationInitiatedDmIds(ownerId, locallyInitiatedDmIds.current);
      }
      setItems((current) => {
        if (!accountScopeRef.current.isCurrent(eventTicket)) return current;
        let found = false;
        const next = current.flatMap((conversation) => {
          if (event.type === "agent_message") {
            if (
              conversationListIdentity(conversation) !==
              `agent:${event.message.conversation_id.trim()}`
            ) {
              return [conversation];
            }
            found = true;
            const senderType = event.message.sender.type
              .trim()
              .toLocaleLowerCase()
              .replaceAll("-", "_");
            const senderId = event.message.sender.id.trim();
            const outgoingUserMessage =
              senderType === "user" && (!senderId || senderId === ownerId);
            const incrementUnread = consumeConversationRealtimeUnreadEvent({
              ownerId,
              conversation,
              messageId: event.message.id || event.message.sequence_no,
              incoming: !outgoingUserMessage,
              isActive: chatRealtimeService.isConversationActive(
                "agent",
                event.message.conversation_id,
              ),
              isUpdate: event.is_update === true,
              alreadyProjected:
                event.message.sequence_no > 0 &&
                event.message.sequence_no === conversation.last_message_id,
            });
            const updated = applyAgentRealtimeMessage(
              conversation,
              event.message,
              incrementUnread,
              t,
              event.is_update === true,
            );
            if (updated === conversation) return [conversation];
            unhideConversation(ownerId, conversation, setHiddenSnapshots, () =>
              accountScopeRef.current.isCurrent(eventTicket),
            );
            return [updated];
          }
          if (event.type === "direct_message") {
            const contactId =
              event.message.sender_id === ownerId
                ? event.message.receiver_id
                : event.message.sender_id;
            if (conversationListIdentity(conversation) !== `dm:${contactId}`) return [conversation];
            found = true;
            const incoming = event.message.sender_id !== ownerId;
            const incrementUnread = consumeConversationRealtimeUnreadEvent({
              ownerId,
              conversation,
              messageId: event.message.id,
              incoming,
              isActive: chatRealtimeService.isConversationActive("dm", contactId),
              isUpdate: event.is_update === true,
              alreadyProjected: event.message.id === conversation.last_message_id,
            });
            if (
              !shouldApplyRealtimeConversationPreview(
                conversation,
                event.message.timestamp,
                event.message.id,
                event.is_update === true,
                event.message.version,
                event.message.id,
              )
            ) {
              return incrementUnread
                ? [{ ...conversation, unread_count: conversation.unread_count + 1 }]
                : [conversation];
            }
            unhideConversation(ownerId, conversation, setHiddenSnapshots, () =>
              accountScopeRef.current.isCurrent(eventTicket),
            );
            return [
              {
                ...conversation,
                last_message: realtimeMessagePreview(
                  event.message.msg_type,
                  event.message.content,
                  t,
                  {
                    activeLanguage,
                    senderId: event.message.sender_id,
                    senderName: incoming ? conversation.name : undefined,
                    viewerId: ownerId,
                  },
                ),
                last_message_time: event.message.timestamp,
                last_message_id: event.message.id,
                last_message_version: event.message.version,
                last_message_sequence: event.message.id,
                unread_count: incrementUnread
                  ? conversation.unread_count + 1
                  : conversation.unread_count,
              },
            ];
          }
          if (event.type === "group_message") {
            const groupId = resolvedGroupId(conversation);
            if (groupId !== event.message.group_id) return [conversation];
            found = true;
            const incoming = event.message.sender_id !== ownerId;
            const incrementUnread = consumeConversationRealtimeUnreadEvent({
              ownerId,
              conversation,
              messageId: event.message.id,
              incoming,
              isActive: chatRealtimeService.isConversationActive(
                "group",
                String(event.message.group_id),
              ),
              isUpdate: event.is_update === true,
              alreadyProjected: event.message.id === conversation.last_message_id,
            });
            if (
              !shouldApplyRealtimeConversationPreview(
                conversation,
                event.message.timestamp,
                event.message.id,
                event.is_update === true,
                event.message.version,
                event.message.history_sequence ?? event.message.id,
              )
            ) {
              return incrementUnread
                ? [{ ...conversation, unread_count: conversation.unread_count + 1 }]
                : [conversation];
            }
            unhideConversation(ownerId, conversation, setHiddenSnapshots, () =>
              accountScopeRef.current.isCurrent(eventTicket),
            );
            return [
              {
                ...conversation,
                last_message: realtimeMessagePreview(
                  event.message.msg_type,
                  event.message.content,
                  t,
                  {
                    activeLanguage,
                    senderId: event.message.sender_id,
                    senderName: event.message.sender_nickname,
                    viewerId: ownerId,
                  },
                ),
                last_message_time: event.message.timestamp,
                last_message_id: event.message.id,
                last_message_version: event.message.version,
                last_message_sequence: event.message.history_sequence ?? event.message.id,
                last_message_sender_id: event.message.sender_id,
                subtitle: conversationEventSender(
                  event.message.msg_type,
                  event.message.content,
                  event.message.sender_id,
                  event.message.sender_nickname,
                  ownerId,
                  t,
                ),
                unread_count: incrementUnread
                  ? conversation.unread_count + 1
                  : conversation.unread_count,
              },
            ];
          }
          if (event.type === "group_message_hint") {
            const groupId = resolvedGroupId(conversation);
            if (groupId !== event.group_id) return [conversation];
            found = true;
            if ((conversation.last_message_id ?? 0) >= event.message_id) return [conversation];
            return [{ ...conversation, last_message_id: event.message_id }];
          }
          if (event.type === "group_renamed" && resolvedGroupId(conversation) === event.group_id) {
            found = true;
            return [{ ...conversation, name: event.name }];
          }
          if (event.type === "group_removed" && resolvedGroupId(conversation) === event.group_id) {
            found = true;
            return [];
          }
          if (
            event.type === "group_notification_settings_updated" &&
            resolvedGroupId(conversation) === event.settings.group_id
          ) {
            found = true;
            return [{ ...conversation, is_muted: event.settings.muted }];
          }
          return [conversation];
        });
        if (!found && ["direct_message", "group_message", "agent_message"].includes(event.type)) {
          queueMicrotask(() => {
            if (event.type === "direct_message") {
              const contactId =
                event.message.sender_id === ownerId
                  ? event.message.receiver_id
                  : event.message.sender_id;
              void conversationSyncCoordinator.request(ownerId, "realtime_missing_conversation", {
                conversation_type: "dm",
                conversation_id: contactId,
                message_id: event.message.id,
                message_version: event.message.version,
              });
            } else if (event.type === "group_message") {
              void conversationSyncCoordinator.request(ownerId, "realtime_missing_conversation", {
                conversation_type: "group",
                conversation_id: String(event.message.group_id),
                message_id: event.message.history_sequence ?? event.message.id,
                message_version: event.message.version,
              });
            } else if (event.type === "agent_message") {
              void conversationSyncCoordinator.request(ownerId, "realtime_missing_conversation", {
                conversation_type: "agent",
                conversation_id: event.message.conversation_id,
                message_id: event.message.sequence_no,
              });
            }
          });
          return current;
        }
        if (accountScopeRef.current.isCurrent(eventTicket)) {
          void saveCachedConversationItemsProjection(ownerId, next);
        }
        return next;
      });
    });
  }, [activeLanguage, ownerId, setHiddenSnapshots, setItems, setPinnedKeys, t]);

  const ownerStateIsCurrent = stateOwnerId === ownerId;
  const localProjection = useMemo(
    () =>
      applyConversationLocalState(
        ownerStateIsCurrent ? items : [],
        {
          pinnedKeys: ownerStateIsCurrent ? pinnedKeys : new Set(),
          hiddenSnapshots: ownerStateIsCurrent ? hiddenSnapshots : {},
        },
        ownerId,
      ).conversations,
    [hiddenSnapshots, items, ownerId, ownerStateIsCurrent, pinnedKeys],
  );
  const query = ownerStateIsCurrent ? searchText.trim().toLocaleLowerCase() : "";
  const visibleItems = useMemo(
    () =>
      query.length === 0
        ? localProjection
        : localProjection.filter((item) =>
            [
              item.name,
              item.subtitle,
              conversationPreviewText(item, {
                activeLanguage,
                viewerId: ownerId,
                translate: t,
              }),
            ].some((value) => value?.toLocaleLowerCase().includes(query)),
          ),
    [activeLanguage, localProjection, ownerId, query, t],
  );

  useEffect(() => {
    if (ownerStateIsCurrent && ownerId) publishConversationUnread(ownerId, localProjection);
  }, [localProjection, ownerId, ownerStateIsCurrent]);

  const preferencesEnabled = featureFlagEnabled(
    config,
    "conversation_preferences_v1",
    ownerId,
    false,
  );

  const togglePinned = useCallback(
    async (conversation: Conversation) => {
      const ticket = accountScopeRef.current.capture();
      if (ticket.ownerId !== ownerId || !accountScopeRef.current.isCurrent(ticket)) return;
      const identity = conversationListIdentity(conversation);
      const previous = new Set(pinnedKeysRef.current);
      const next = new Set(previous);
      const shouldPin = !next.has(identity);
      if (shouldPin) next.add(identity);
      else next.delete(identity);
      setPinnedKeys(next);
      await saveConversationPinnedKeys(ownerId, next).catch(() => undefined);
      const target = conversationPreferenceTarget(conversation);
      if (!preferencesEnabled || (target.type !== "dm" && target.type !== "group")) return;
      if (!accountScopeRef.current.isCurrent(ticket)) return;
      try {
        await updateConversationPreference(target.type, target.targetId, shouldPin);
      } catch (nextError) {
        await saveConversationPinnedKeys(ownerId, previous).catch(() => undefined);
        if (accountScopeRef.current.isCurrent(ticket)) {
          setPinnedKeys(previous);
          setToastMessage(readableError(nextError, t("common.operationFailed")));
        }
      }
    },
    [ownerId, preferencesEnabled, setPinnedKeys, t],
  );

  const deleteConversation = useCallback(
    async (conversation: Conversation) => {
      const ticket = accountScopeRef.current.capture();
      if (ticket.ownerId !== ownerId || !accountScopeRef.current.isCurrent(ticket)) return;
      const identity = conversationListIdentity(conversation);
      if (deletingKeys.has(identity)) return;
      setDeletingKeys((current) => new Set(current).add(identity));
      try {
        const target = conversationPreferenceTarget(conversation);
        if (target.type === "dm") {
          const receipt = await clearDirectMessageHistory(target.targetId);
          await applyDirectHistoryClear(ownerId, receipt);
        } else if (target.type === "group") {
          const groupId = Number(target.targetId);
          if (!Number.isInteger(groupId) || groupId <= 0) {
            throw new Error(t("common.operationFailed"));
          }
          const receipt = await clearGroupMessageHistory(groupId);
          await applyGroupHistoryClear(ownerId, receipt);
        }
        if (!accountScopeRef.current.isCurrent(ticket)) return;
        if (preferencesEnabled && (target.type === "dm" || target.type === "group")) {
          await hideConversation(target.type, target.targetId).catch(() => undefined);
        }
        if (!accountScopeRef.current.isCurrent(ticket)) return;
        const nextHidden = await hideCachedConversation(ownerId, conversation);
        if (!accountScopeRef.current.isCurrent(ticket)) return;
        setHiddenSnapshots(nextHidden);
        const nextPinned = new Set(pinnedKeysRef.current);
        nextPinned.delete(identity);
        setPinnedKeys(nextPinned);
        setItems((current) =>
          current.filter((candidate) => conversationListIdentity(candidate) !== identity),
        );
      } catch (nextError) {
        if (accountScopeRef.current.isCurrent(ticket)) {
          setToastMessage(readableError(nextError, t("common.operationFailed")));
        }
      } finally {
        if (accountScopeRef.current.isCurrent(ticket)) {
          setDeletingKeys((current) => {
            const next = new Set(current);
            next.delete(identity);
            return next;
          });
        }
      }
    },
    [deletingKeys, ownerId, preferencesEnabled, setHiddenSnapshots, setItems, setPinnedKeys, t],
  );

  const confirmDelete = useCallback(
    (conversation: Conversation) => {
      const target = conversationPreferenceTarget(conversation);
      Alert.alert(
        t("messages.deleteConversation.confirmTitle"),
        target.type === "dm" || target.type === "group"
          ? t("messages.deleteConversation.historyMessage")
          : t("messages.deleteConversation.listOnlyMessage"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("common.delete"),
            style: "destructive",
            onPress: () => void deleteConversation(conversation),
          },
        ],
      );
    },
    [deleteConversation, t],
  );

  const openConversation = useCallback(
    async (conversation: Conversation) => {
      const ticket = accountScopeRef.current.capture();
      if (ticket.ownerId !== ownerId || !accountScopeRef.current.isCurrent(ticket)) return;
      closeOpenSwipe(openSwipeKey, swipeClosers);
      Keyboard.dismiss();
      const identity = conversationListIdentity(conversation);
      if (isAgentConversation(conversation)) {
        if (openingAgentKeys.current.has(identity)) return;
        openingAgentKeys.current.add(identity);
        try {
          let conversationId =
            conversation.agent_conversation_id?.trim() ||
            (conversation.conversation_kind?.trim().toLocaleLowerCase().replaceAll("-", "_") ===
            "agent_conversation"
              ? conversation.id.trim()
              : "");
          if (!conversationId) {
            const agentId = conversation.agent_id?.trim();
            if (!agentId) throw new Error(t("common.operationFailed"));
            const created = await createAgentConversation(
              agentId,
              conversation.agent_greeting_id ?? "default",
              randomUUID(),
            );
            conversationId = created.id;
          }
          if (!accountScopeRef.current.isCurrent(ticket)) return;
          router.push({
            pathname: "/agent-chat",
            params: {
              conversationId,
              agentId: conversation.agent_id ?? "",
              name: conversation.name,
              avatarId: conversation.agent_avatar_asset_id ?? "",
            },
          });
        } catch (nextError) {
          if (accountScopeRef.current.isCurrent(ticket)) {
            Alert.alert(t("common.operationFailed"), readableError(nextError, t("common.retry")));
          }
        } finally {
          if (accountScopeRef.current.isCurrent(ticket)) openingAgentKeys.current.delete(identity);
        }
        return;
      }
      const groupId = resolvedGroupId(conversation);
      if (!accountScopeRef.current.isCurrent(ticket)) return;
      if (conversation.unread_count > 0) {
        setItems((current) =>
          current.map((candidate) =>
            conversationListIdentity(candidate) === identity
              ? { ...candidate, unread_count: 0 }
              : candidate,
          ),
        );
        void markConversationRead(
          ownerId,
          groupId ? "group" : "dm",
          groupId ? String(groupId) : conversation.id,
          conversation.last_message_id,
        );
      }
      if (isScriptRoomConversation(conversation) && conversation.script_room_id) {
        rememberScriptRoomConversation(conversation, ownerId);
        router.push({
          pathname: "/script-room-chat",
          params: { roomId: conversation.script_room_id },
        });
      } else if (groupId) {
        router.push({
          pathname: "/group-chat/[id]",
          params: {
            id: String(groupId),
            name: conversation.name,
            avatar: conversation.avatar_url,
            memberCount: String(conversation.member_count ?? 0),
            ...(conversation.last_message_id !== undefined
              ? { latestMessageId: String(conversation.last_message_id) }
              : {}),
          },
        });
      } else {
        router.push({
          pathname: "/chat/[id]",
          params: {
            id: conversation.id,
            name: conversation.name,
            avatar: conversation.avatar_url,
            ...(conversation.last_message_id !== undefined
              ? { latestMessageId: String(conversation.last_message_id) }
              : {}),
          },
        });
      }
    },
    [ownerId, setItems, t],
  );

  const header = (
    <View style={{ paddingTop: insets.top }}>
      <View style={styles.header}>
        <RootTabTitle localizedKey="tab.messages" style={styles.rootTitle} />
        <Pressable
          accessibilityLabel={t("messages.moreActions")}
          accessibilityRole="button"
          hitSlop={2}
          onPress={() => {
            closeOpenSwipe(openSwipeKey, swipeClosers);
            Keyboard.dismiss();
            setActionMenuVisible(true);
          }}
          style={({ pressed }) => [styles.actionButtonHitArea, pressed && styles.pressed]}
        >
          <View style={styles.actionButton}>
            <SymbolView name="plus" size={20} weight="bold" tintColor={theme.text} />
          </View>
        </Pressable>
      </View>

      <Pressable
        style={styles.searchBox}
        onPress={() => closeOpenSwipe(openSwipeKey, swipeClosers)}
      >
        <SymbolView
          name="magnifyingglass"
          size={15}
          weight="semibold"
          tintColor={theme.tertiaryText}
        />
        <TextInput
          accessibilityLabel={t("messages.search.placeholder")}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(value) => {
            setSearchText(value);
            closeOpenSwipe(openSwipeKey, swipeClosers);
          }}
          onBlur={() => setSearchFocused(false)}
          onFocus={() => setSearchFocused(true)}
          onSubmitEditing={Keyboard.dismiss}
          placeholder={t("messages.search.placeholder")}
          placeholderTextColor={theme.tertiaryText}
          returnKeyType="search"
          style={styles.searchInput}
          value={searchText}
        />
        {searchText ? (
          <Pressable
            accessibilityLabel={t("common.cancel")}
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => setSearchText("")}
            style={styles.searchClear}
          >
            <SymbolView
              name="xmark.circle.fill"
              size={15}
              weight="semibold"
              tintColor={theme.tertiaryText}
            />
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={visibleItems}
        keyExtractor={conversationListIdentity}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={
          <ConversationEmptyState
            error={error}
            isLoading={isLoading}
            isSearching={query.length > 0}
            retry={() => void load("manual")}
            t={t}
          />
        }
        ListFooterComponent={<View style={styles.bottomClearance} />}
        refreshControl={
          <RefreshControl
            key={`conversation-refresh-${refreshControlRevision}`}
            refreshing={isRefreshing}
            onRefresh={() => {
              closeOpenSwipe(openSwipeKey, swipeClosers);
              void load("manual");
            }}
            tintColor={theme.accent}
            progressViewOffset={insets.top + 86}
          />
        }
        renderItem={({ item, index }) => {
          const identity = conversationListIdentity(item);
          return (
            <SwipeableConversationRow
              conversation={item}
              draft={drafts[identity]}
              isDeleting={deletingKeys.has(identity)}
              isPinned={pinnedKeys.has(identity)}
              onDelete={() => confirmDelete(item)}
              onOpen={(close) => {
                if (openSwipeKey.current && openSwipeKey.current !== identity) {
                  swipeClosers.current.get(openSwipeKey.current)?.();
                }
                openSwipeKey.current = identity;
                swipeClosers.current.set(identity, close);
              }}
              onPress={() => {
                if (openSwipeKey.current) {
                  closeOpenSwipe(openSwipeKey, swipeClosers);
                  return;
                }
                if (isSearchFocused) {
                  Keyboard.dismiss();
                  setSearchFocused(false);
                  return;
                }
                void openConversation(item);
              }}
              onRegister={(close) => {
                if (close) swipeClosers.current.set(identity, close);
                else swipeClosers.current.delete(identity);
              }}
              onTogglePin={() => void togglePinned(item)}
              showsDivider={index !== visibleItems.length - 1}
              t={t}
            />
          );
        }}
        showsVerticalScrollIndicator={false}
      />
      <MessageActionsModal
        visible={isActionMenuVisible}
        top={insets.top + 44}
        onClose={() => setActionMenuVisible(false)}
        t={t}
      />
      <TopToast
        message={toastMessage}
        onDismiss={() => setToastMessage(null)}
        topInset={insets.top}
      />
    </View>
  );
}

function ConversationEmptyState({
  error,
  isLoading,
  isSearching,
  retry,
  t,
}: {
  error: string | null;
  isLoading: boolean;
  isSearching: boolean;
  retry: () => void;
  t: Translate;
}) {
  const { styles, theme } = useConversationTheme();
  if (isLoading) return <View style={styles.emptyFill} />;
  if (isSearching) {
    return (
      <View style={styles.searchEmpty}>
        <SymbolView
          name="magnifyingglass"
          size={28}
          weight="semibold"
          tintColor={theme.tertiaryText}
        />
        <Text style={styles.searchEmptyText}>{t("messages.search.empty")}</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.emptyState}>
        <SymbolView name="wifi.slash" size={34} weight="semibold" tintColor={theme.warning} />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={retry} style={styles.retryButton}>
          <Text style={styles.retryText}>{t("common.retry")}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconCircle}>
        <SymbolView
          name="bubble.left.and.bubble.right"
          size={32}
          tintColor="rgba(102,126,234,0.5)"
        />
      </View>
      <Text style={styles.emptyTitle}>{t("messages.empty.title")}</Text>
      <Text style={styles.emptySubtitle}>{t("messages.empty.subtitle")}</Text>
    </View>
  );
}

function SwipeableConversationRow({
  conversation,
  draft,
  isDeleting,
  isPinned,
  onDelete,
  onOpen,
  onPress,
  onRegister,
  onTogglePin,
  showsDivider,
  t,
}: {
  conversation: Conversation;
  draft: string | undefined;
  isDeleting: boolean;
  isPinned: boolean;
  onDelete: () => void;
  onOpen: (close: () => void) => void;
  onPress: () => void;
  onRegister: (close: (() => void) | null) => void;
  onTogglePin: () => void;
  showsDivider: boolean;
  t: Translate;
}) {
  const { styles } = useConversationTheme();
  const swipeRef = useRef<SwipeableMethods | null>(null);
  const close = useCallback(() => swipeRef.current?.close(), []);
  useEffect(() => {
    onRegister(close);
    return () => onRegister(null);
  }, [close, onRegister]);
  return (
    <ReanimatedSwipeable
      childrenContainerStyle={styles.swipeForeground}
      friction={1}
      onSwipeableOpen={() => onOpen(close)}
      overshootRight={false}
      ref={swipeRef}
      renderRightActions={() => (
        <ConversationSwipeActions
          close={close}
          isDeleting={isDeleting}
          isPinned={isPinned}
          onDelete={onDelete}
          onTogglePin={onTogglePin}
          t={t}
        />
      )}
      rightThreshold={SWIPE_ACTION_WIDTH * 0.46}
    >
      <ConversationRow
        conversation={conversation}
        draft={draft}
        isPinned={isPinned}
        onPress={onPress}
        showsDivider={showsDivider}
        t={t}
      />
    </ReanimatedSwipeable>
  );
}

function ConversationSwipeActions({
  close,
  isDeleting,
  isPinned,
  onDelete,
  onTogglePin,
  t,
}: {
  close: () => void;
  isDeleting: boolean;
  isPinned: boolean;
  onDelete: () => void;
  onTogglePin: () => void;
  t: Translate;
}) {
  const { styles } = useConversationTheme();
  return (
    <View style={styles.swipeActions}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          close();
          setTimeout(onTogglePin, 160);
        }}
        style={[styles.swipeAction, styles.pinAction]}
      >
        <SymbolView
          name={isPinned ? "pin.slash" : "pin.fill"}
          size={16}
          weight="semibold"
          tintColor="#FFFFFF"
        />
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          numberOfLines={1}
          style={styles.swipeActionText}
        >
          {isPinned ? t("messages.unpin") : t("messages.pin")}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={isDeleting}
        onPress={onDelete}
        style={[styles.swipeAction, styles.deleteAction]}
      >
        {isDeleting ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <SymbolView name="trash" size={16} weight="semibold" tintColor="#FFFFFF" />
        )}
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          numberOfLines={1}
          style={styles.swipeActionText}
        >
          {t("common.delete")}
        </Text>
      </Pressable>
    </View>
  );
}

function ConversationRow({
  conversation,
  draft,
  isPinned,
  onPress,
  showsDivider,
  t,
}: {
  conversation: Conversation;
  draft: string | undefined;
  isPinned: boolean;
  onPress: () => void;
  showsDivider: boolean;
  t: Translate;
}) {
  const { styles, theme } = useConversationTheme();
  const { user } = useAuth();
  const { activeLanguage } = useLocalization();
  const unreadCount = Math.max(0, conversation.unread_count ?? 0);
  const sender = conversationSenderPrefix(conversation, t, user?.user_id);
  const preview =
    conversationPreviewText(conversation, {
      activeLanguage,
      viewerId: user?.user_id,
      translate: t,
    }) ?? "";
  const groupId = resolvedGroupId(conversation);
  return (
    <Pressable
      accessibilityLabel={conversation.name}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.rowOuter, pressed && styles.pressed]}
      testID={`conversation.${conversationListIdentity(conversation)}`}
    >
      <View style={styles.rowCard}>
        <ConversationAvatar conversation={conversation} />
        <View style={styles.rowBody}>
          <View style={styles.nameLine}>
            <Text style={styles.rowName} numberOfLines={1}>
              {conversation.name}
            </Text>
            {isScriptRoomConversation(conversation) ? <KindBadge text={t("script.label")} /> : null}
            {isAgentConversation(conversation) ? (
              <KindBadge text={t("contacts.aiCompanions")} />
            ) : null}
            {isPinned ? (
              <SymbolView name="pin.fill" size={10} weight="semibold" tintColor="#F0A020" />
            ) : null}
            {groupId && conversation.member_count !== undefined ? (
              <Text style={styles.memberCount}>({conversation.member_count})</Text>
            ) : null}
            {groupId && conversation.is_muted ? (
              <SymbolView
                accessibilityLabel={t("group.notifications.mute")}
                name="bell.slash.fill"
                size={11}
                weight="medium"
                tintColor={theme.tertiaryText}
              />
            ) : null}
          </View>
          {draft ? (
            <Text style={styles.rowPreview} numberOfLines={1}>
              <Text style={styles.draftPrefix}>{t("draft.prefix")} </Text>
              {draft}
            </Text>
          ) : preview ? (
            <Text style={styles.rowPreview} numberOfLines={1}>
              {sender ? `${sender}: ` : ""}
              {preview}
            </Text>
          ) : (
            <Text style={styles.rowPlaceholder} numberOfLines={1}>
              {groupId ? t("conversation.startGroup") : t("conversation.startChat")}
            </Text>
          )}
        </View>
        <View style={styles.rowTrailing}>
          <Text style={styles.rowTime}>
            {conversationListTime(conversation.last_message_time, new Date(), t("time.yesterday"))}
          </Text>
          {unreadCount > 0 ? (
            <View style={[styles.unreadBadge, conversation.is_muted && styles.mutedBadge]}>
              <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
            </View>
          ) : null}
        </View>
        {showsDivider ? <View pointerEvents="none" style={styles.rowDivider} /> : null}
      </View>
    </Pressable>
  );
}

function ConversationAvatar({ conversation }: { conversation: Conversation }) {
  if (isAgentConversation(conversation))
    return <AgentAvatar assetId={conversation.agent_avatar_asset_id} />;
  if (isScriptRoomConversation(conversation)) return <ScriptAvatar uri={conversation.avatar_url} />;
  const groupId = resolvedGroupId(conversation);
  if (groupId) return <GroupMemberAvatar groupId={groupId} size={50} />;
  return <Avatar uri={conversation.avatar_url} name={conversation.name} size={50} />;
}

function AgentAvatar({ assetId }: { assetId: string | undefined }) {
  const { styles, theme } = useConversationTheme();
  const uri = assetId
    ? resolveMediaUrl(`/agent-assets/${encodeURIComponent(assetId)}`, env.apiBaseUrl)
    : null;
  const fallback = (
    <LinearGradient colors={[theme.accent, theme.accentDark]} style={styles.agentAvatar}>
      <SymbolView name="sparkles" size={17} weight="semibold" tintColor="#FFFFFF" />
    </LinearGradient>
  );
  return uri ? (
    <AuthenticatedImage
      accessible={false}
      contentFit="cover"
      errorFallback={fallback}
      fallback={fallback}
      style={styles.agentAvatar}
      uri={uri}
    />
  ) : (
    fallback
  );
}

function ScriptAvatar({ uri }: { uri: string }) {
  const { styles, theme } = useConversationTheme();
  const resolved = uri ? resolveMediaUrl(uri, env.apiBaseUrl) : null;
  const fallback = (
    <View style={styles.scriptAvatarFallback}>
      <SymbolView name="book.closed.fill" size={22} weight="semibold" tintColor={theme.accent} />
    </View>
  );
  return resolved ? (
    <AuthenticatedImage
      accessible={false}
      contentFit="cover"
      errorFallback={fallback}
      fallback={fallback}
      style={styles.scriptAvatar}
      uri={resolved}
    />
  ) : (
    fallback
  );
}

function KindBadge({ text }: { text: string }) {
  const { styles } = useConversationTheme();
  return <Text style={styles.kindBadge}>{text}</Text>;
}

function MessageActionsModal({
  visible,
  top,
  onClose,
  t,
}: {
  visible: boolean;
  top: number;
  onClose: () => void;
  t: Translate;
}) {
  const { styles } = useConversationTheme();
  const perform = (action: "group" | "friend" | "agent") => {
    onClose();
    requestAnimationFrame(() => {
      if (action === "friend") router.push("/add-friend");
      else if (action === "group") router.push("/create-group");
      else router.push("/agent-creator");
    });
  };
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalScrim}>
        <View style={[styles.actionMenu, { top }]}>
          <ActionMenuRow
            title={t("messages.startGroup")}
            symbol="bubble.left.and.bubble.right"
            onPress={() => perform("group")}
          />
          <ActionMenuRow
            title={t("messages.addFriend")}
            symbol="person.badge.plus"
            onPress={() => perform("friend")}
          />
          <ActionMenuRow
            title={t("messages.createBot")}
            symbol="person.crop.circle.badge.plus"
            onPress={() => perform("agent")}
            last
          />
        </View>
      </Pressable>
    </Modal>
  );
}

function ActionMenuRow({
  title,
  symbol,
  onPress,
  last = false,
}: {
  title: string;
  symbol: SFSymbol;
  onPress: () => void;
  last?: boolean;
}) {
  const { styles, theme } = useConversationTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        !last && styles.menuDivider,
        pressed && styles.menuPressed,
      ]}
    >
      <SymbolView
        name={symbol}
        size={17}
        weight="regular"
        tintColor={theme.text}
        style={styles.menuSymbol}
      />
      <Text style={styles.menuTitle}>{title}</Text>
    </Pressable>
  );
}

async function resolvingScriptRoomAvatars(
  ownerId: string,
  rows: readonly Conversation[],
): Promise<Conversation[]> {
  return Promise.all(
    rows.map(async (conversation) => {
      const roomId = conversation.script_room_id?.trim();
      if (!shouldResolveScriptRoomAvatar(conversation) || !roomId) {
        return conversation;
      }
      const cached = await loadCachedScriptRoom(ownerId, roomId);
      if (cached?.value.script_snapshot.cover_url) {
        return { ...conversation, avatar_url: cached.value.script_snapshot.cover_url };
      }
      try {
        const room = await getScriptRoom(roomId);
        await saveCachedScriptRoom(ownerId, room).catch(() => undefined);
        return room.script_snapshot.cover_url
          ? { ...conversation, avatar_url: room.script_snapshot.cover_url }
          : conversation;
      } catch {
        return conversation;
      }
    }),
  );
}

function unhideConversation(
  ownerId: string,
  conversation: Conversation,
  setHiddenSnapshots: (value: Record<string, string>) => void,
  isCurrent: () => boolean,
): void {
  void unhideCachedConversation(ownerId, conversation).then((next) => {
    if (isCurrent()) setHiddenSnapshots(next);
  });
}

function closeOpenSwipe(
  openKey: React.MutableRefObject<string | null>,
  closers: React.MutableRefObject<Map<string, () => void>>,
): void {
  if (openKey.current) closers.current.get(openKey.current)?.();
  openKey.current = null;
}

function withoutConversationPreview(conversation: Conversation): Conversation {
  const next = { ...conversation, unread_count: 0 };
  delete next.last_message;
  delete next.last_message_time;
  return next;
}

function realtimeMessagePreview(
  messageType: string,
  content: string,
  t: Translate,
  context: {
    activeLanguage: string;
    senderId: string;
    senderName?: string | undefined;
    viewerId: string;
  },
): string {
  const normalizedType = messageType.trim().toLocaleLowerCase().replaceAll("-", "_");
  if (["recall", "recalled", "withdrawn", "revoked", "message_recalled"].includes(normalizedType)) {
    return chatRecallNotice(context.senderId, context.viewerId, context.senderName, t);
  }
  switch (normalizedType) {
    case "image":
      return t("message.image");
    case "video":
      return t("message.video");
    case "voice":
      return t("message.voice");
    case "sticker": {
      const sticker = parseChatStickerMessagePayload(content);
      const name = localizedChatStickerText(sticker?.name, context.activeLanguage)?.trim();
      return name ? `[${name}]` : t("message.sticker");
    }
    case "gift":
      return giftMessagePreview(content, t);
    default:
      return chatMoneyMessagePreview(normalizedType, content, context.viewerId, t);
  }
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function sameStringRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

function useConversationTheme(): {
  theme: ConversationTheme;
  styles: ReturnType<typeof createStyles>;
} {
  const theme = palette(useColorScheme());
  return { theme, styles: useMemo(() => createStyles(theme), [theme]) };
}

function createStyles(theme: ConversationTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    header: {
      minHeight: 44,
      marginHorizontal: ROOT_HORIZONTAL_INSET,
      marginBottom: 8,
      flexDirection: "row",
      alignItems: "center",
      columnGap: 12,
    },
    rootTitle: { flex: 1 },
    actionButtonHitArea: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    actionButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.separator,
      shadowColor: "#000000",
      shadowOpacity: 0.08,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 2 },
    },
    pressed: { opacity: 0.68 },
    searchBox: {
      minHeight: 42,
      marginHorizontal: ROOT_HORIZONTAL_INSET,
      marginBottom: 10,
      paddingHorizontal: 13,
      borderRadius: 12,
      backgroundColor: theme.card,
      flexDirection: "row",
      alignItems: "center",
      columnGap: 9,
    },
    searchInput: { flex: 1, minHeight: 42, paddingVertical: 0, color: theme.text, fontSize: 15 },
    searchClear: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
    emptyFill: { minHeight: 360 },
    emptyState: { minHeight: 420, alignItems: "center", justifyContent: "center", rowGap: 16 },
    emptyIconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
    },
    emptyTitle: { color: theme.text, fontSize: 17, fontWeight: "600" },
    emptySubtitle: { color: theme.secondaryText, fontSize: 14 },
    errorText: {
      maxWidth: 310,
      paddingHorizontal: 28,
      color: theme.secondaryText,
      fontSize: 14,
      textAlign: "center",
    },
    retryButton: {
      minHeight: 34,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accent,
    },
    retryText: { color: theme.white, fontSize: 14, fontWeight: "600" },
    searchEmpty: { paddingTop: 28, paddingVertical: 20, alignItems: "center", rowGap: 10 },
    searchEmptyText: { color: theme.secondaryText, fontSize: 14, fontWeight: "500" },
    rowOuter: { marginHorizontal: ROOT_HORIZONTAL_INSET, backgroundColor: theme.background },
    rowCard: {
      minHeight: CONVERSATION_CARD_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      backgroundColor: theme.background,
    },
    rowBody: { flex: 1, minHeight: 50, marginLeft: 12, justifyContent: "center", rowGap: 4 },
    rowDivider: {
      position: "absolute",
      right: 0,
      bottom: 0,
      left: 62,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.separator,
    },
    nameLine: { minHeight: 20, flexDirection: "row", alignItems: "center", columnGap: 4 },
    rowName: { flexShrink: 1, color: theme.text, fontSize: 16, fontWeight: "600" },
    memberCount: { color: theme.tertiaryText, fontSize: 13 },
    kindBadge: {
      color: theme.accent,
      fontSize: 10,
      fontWeight: "600",
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      backgroundColor: theme.accentSoft,
    },
    rowPreview: { color: theme.secondaryText, fontSize: 14 },
    rowPlaceholder: { color: theme.tertiaryText, fontSize: 14 },
    draftPrefix: { color: theme.danger },
    rowTrailing: {
      minWidth: 48,
      minHeight: 50,
      marginLeft: 4,
      alignItems: "flex-end",
      justifyContent: "center",
      rowGap: 6,
    },
    rowTime: { color: theme.tertiaryText, fontSize: 12 },
    unreadBadge: {
      minWidth: 20,
      minHeight: 20,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.danger,
    },
    mutedBadge: { backgroundColor: "#B2B2B2" },
    unreadBadgeText: { color: theme.white, fontSize: 11, fontWeight: "700" },
    swipeForeground: { backgroundColor: theme.background },
    swipeActions: {
      width: SWIPE_ACTION_WIDTH,
      height: CONVERSATION_CARD_HEIGHT,
      flexDirection: "row",
      marginRight: ROOT_HORIZONTAL_INSET,
    },
    swipeAction: {
      width: SWIPE_ACTION_WIDTH / 2,
      height: CONVERSATION_CARD_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
      rowGap: 3,
    },
    pinAction: { backgroundColor: "#F0A020" },
    deleteAction: { backgroundColor: "#E5484D" },
    swipeActionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
    agentAvatar: {
      width: 50,
      height: 50,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    scriptAvatar: { width: 50, height: 50, borderRadius: 10 },
    scriptAvatarFallback: {
      width: 50,
      height: 50,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
    },
    bottomClearance: { height: ROOT_TAB_BOTTOM_CLEARANCE },
    modalScrim: { flex: 1 },
    actionMenu: {
      position: "absolute",
      right: 14,
      width: 210,
      paddingVertical: 4,
      overflow: "hidden",
      borderRadius: 14,
      backgroundColor: theme.card,
      shadowColor: "#000000",
      shadowOpacity: 0.16,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    menuRow: {
      minHeight: 44,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      columnGap: 13,
    },
    menuDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.separator,
    },
    menuPressed: { backgroundColor: "rgba(118,118,128,0.12)" },
    menuSymbol: { width: 22 },
    menuTitle: { color: theme.text, fontSize: 16 },
  });
}
