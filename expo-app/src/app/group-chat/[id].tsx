import { LinearGradient } from "expo-linear-gradient";
import type { ImagePickerAsset } from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGroupMessages,
  getGroupMessageContext,
  getGroupDetail,
  recallGroupMessage,
  sendGroupGiftMessage,
  sendGroupStickerMessage,
  sendGroupTextMessage,
  sendGroupVoiceMessage,
} from "@/api/bwchat";
import { UserAvatarButton } from "@/components/Avatar";
import { TopToast } from "@/components/TopToast";
import { ChatBackgroundLayer } from "@/components/chat/ChatBackgroundLayer";
import { ChatMentionPicker } from "@/components/messages/ChatMentionPicker";
import { ImageGallery, type ImageGallerySelection } from "@/components/media/ImageGallery";
import { VideoPlayerOverlay } from "@/components/media/VideoPlayerOverlay";
import { ChatImageBubble } from "@/components/messages/ChatImageBubble";
import { ChatGiftBubble, ChatGiftPickerSheet } from "@/components/messages/ChatGiftViews";
import { ChatCallRecordBubble } from "@/components/messages/ChatCallRecordBubble";
import {
  ChatMessageDeliveryStatus,
  isPendingChatVoice,
} from "@/components/messages/ChatMessageDeliveryStatus";
import { ChatKeyboardAvoidingView } from "@/components/messages/ChatKeyboardAvoidingView";
import { ChatMoneyComposerModal } from "@/components/messages/ChatMoneyComposerViews";
import { ChatMoneyDetailModal } from "@/components/messages/ChatMoneyDetailViews";
import {
  ChatMoneyBubble,
  ChatMoneyPlusMenuGlyph,
  ChatMoneyReceiptTip,
} from "@/components/messages/ChatMoneyViews";
import { ChatMediaPickerPreview } from "@/components/messages/ChatMediaPickerPreview";
import {
  ChatSelectionIndicator,
  ChatSelectionToolbar,
  ForwardBundleMessageCard,
  ForwardFlowModal,
} from "@/components/messages/ChatForwardViews";
import { ChatStickerBubble } from "@/components/messages/ChatStickerBubble";
import {
  ChatComposerPanelHost,
  ChatComposerPanelToggleButton,
  ChatComposerSurfaceBackground,
} from "@/components/messages/ChatComposerSurface";
import { chatComposerInputHeight } from "@/components/messages/ChatComposerInputHeight";
import { ChatStickerPanel } from "@/components/messages/ChatStickerPanel";
import { ChatVideoBubble } from "@/components/messages/ChatVideoBubble";
import { ChatVoiceBubble } from "@/components/messages/ChatVoiceBubble";
import {
  ChatMessageActionOverlay,
  ChatMessageHighlightSurface,
  ChatMessageLongPressSurface,
  ChatQuotedMessageView,
  ChatRecalledMessageTip,
  ChatReplyPreviewBar,
  ChatTimelineLocatorButton,
  useChatMessageActivationGuard,
} from "@/components/messages/ChatReplyViews";
import {
  ChatVoiceComposer,
  VoiceRecordingOverlay,
  type ChatVoiceRecording,
  type VoiceRecordingVisualState,
} from "@/components/messages/ChatVoiceComposer";
import type {
  CallType,
  ChatMoneyActionResult,
  ChatMoneyKind,
  ChatMoneyPayload,
  ForwardMessageSource,
  ForwardMode,
  GroupDetail,
  GroupMember,
  GroupMessage,
} from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useCall } from "@/providers/CallProvider";
import { useChatAppearance } from "@/providers/ChatAppearanceProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { cacheUserInfoBatch, peekCachedUserInfo } from "@/services/cache/UserInfoCache";
import { markConversationRead } from "@/services/conversations/ConversationReadService";
import { publishGroupConversationPreviewUpdate } from "@/services/conversations/ConversationRepository";
import {
  groupDetailGeneration,
  loadCachedGroupDetail,
  removeCachedGroupDetail,
  saveCachedGroupDetail,
  subscribeGroupDetail,
} from "@/services/groups/GroupDetailRepository";
import { removeCachedGroup } from "@/services/groups/GroupRepository";
import {
  readChatDraftSnapshot,
  saveChatDraftSnapshot,
  type ChatDraftQuote,
  type ChatDraftSnapshot,
} from "@/services/messages/ChatDraftRepository";
import {
  filterLocallyHiddenChatMessages,
  hideChatMessagesLocally,
  readHiddenChatMessageIds,
} from "@/services/messages/ChatLocalDeleteRepository";
import {
  cancelChatImageUpload,
  enqueueGroupChatImage,
  groupOptimisticImageMessage,
  resumeChatImageUploads,
  retryChatImageUpload,
  subscribeChatImageOutbox,
} from "@/services/messages/ChatImageOutbox";
import {
  cancelChatVideoUpload,
  enqueueGroupChatVideo,
  groupOptimisticVideoMessage,
  resumeChatVideoUploads,
  retryChatVideoUpload,
  subscribeChatVideoOutbox,
} from "@/services/messages/ChatVideoOutbox";
import {
  groupChatHistoryPolicy,
  isGroupChatHistoryBackfilled,
  markGroupChatHistoryBackfilled,
  pruneGroupChatCachedMessagesThroughSequence,
  readGroupChatCachedPage,
  saveGroupChatMessages,
} from "@/services/messages/GroupChatHistoryRepository";
import {
  createGroupChatOutboxJob,
  groupChatOutboxFailure,
  groupOptimisticOutboxMessage,
  queuedGroupChatOutboxJob,
  readGroupChatOutboxJob,
  readGroupChatOutboxJobs,
  removeGroupChatOutboxJob,
  saveGroupChatOutboxJob,
  sendingGroupChatOutboxJob,
  type GroupChatOutboxJob,
} from "@/services/messages/GroupChatOutboxRepository";
import {
  filterClearedGroupMessages,
  readGroupHistoryClearWatermark,
  subscribeGroupHistoryClear,
} from "@/services/messages/GroupHistoryClearRepository";
import { subscribeGroupMessageLocation } from "@/services/messages/GroupMessageLocatorBus";
import { pickChatMedia } from "@/services/native/NativeCapabilities";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";
import { parseChatVoiceContent } from "@/services/messages/chatVoicePolicy";
import {
  completeGiftIdempotency,
  giftIdempotencyKey,
  parseGiftMessagePayload,
} from "@/services/messages/chatGiftPolicy";
import {
  encodeChatMoneyPayload,
  normalizeChatMoneyReceipt,
  parseChatMoneyPayload,
} from "@/services/messages/chatMoneyPolicy";
import { parseChatCallRecord } from "@/services/messages/chatCallRecordPolicy";
import {
  encodeChatStickerMessagePayload,
  chatComposerPlusItemWidth,
  insertChatComposerText,
  makeChatStickerMessagePayload,
  parseChatStickerMessagePayload,
  type ChatStickerItem,
  type ChatStickerPack,
  type ComposerTextSelection,
} from "@/services/messages/chatStickerPolicy";
import {
  actionsForChatMessage,
  chatRecallNotice,
  isRecalledChatMessage,
  replyPreviewFromMessage,
  resolveChatTimelineLocator,
  resolveGroupReply,
  type ChatMessageAnchor,
  type ChatMessageMenuAction,
} from "@/services/messages/chatReplyPolicy";
import {
  canForwardSelection,
  chatForwardMessagePreview,
  chatMessageReference,
  chatSelectionDescriptor,
  forwardSource,
  isSelectableChatMessage,
  parseForwardBundleMessage,
  toggleChatSelection,
  type ChatSelectionEntry,
} from "@/services/messages/chatForwardPolicy";
import {
  applyChatMentionEdit,
  deriveChatTextEdit,
  insertChatMentions,
  isStandaloneAtInsertion,
  mentionedUserIds,
  mentionsAll,
  normalizeMentionMembers,
  type ChatMentionSelection,
  type ChatMentionSpan,
  type ChatTextRange,
} from "@/services/messages/chatMentionPolicy";
import { saveImageToLibrary, saveVideoToLibrary } from "@/services/media/MediaLibrarySaver";
import { colors } from "@/theme";

interface TimelineRow {
  message: GroupMessage;
  showsTime: boolean;
}

interface GroupMenuTarget {
  message: GroupMessage;
  anchor: ChatMessageAnchor;
  actions: ChatMessageMenuAction[];
}

interface ForwardDraft {
  mode: ForwardMode;
  sources: ForwardMessageSource[];
  preview: string;
}

export default function GroupChatScreen() {
  const params = useLocalSearchParams<{
    id: string;
    name?: string;
    memberCount?: string;
    messageId?: string;
  }>();
  const groupId = Number(params.id);
  const initialMemberCount = Number(params.memberCount ?? "0");
  const navigation = useNavigation();
  const { user } = useAuth();
  const call = useCall();
  const { t } = useLocalization();
  const ownerId = user?.user_id ?? "";
  const sessionKey = groupChatSessionKey(ownerId, groupId);
  const appearance = useChatAppearance();
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [renderSessionKey, setRenderSessionKey] = useState(sessionKey);
  const [draft, setDraft] = useState("");
  const [composerMentions, setComposerMentions] = useState<ChatMentionSpan[]>([]);
  const [composerSelection, setComposerSelection] = useState<ChatTextRange>({
    location: 0,
    length: 0,
  });
  const [pendingMentionTriggerRange, setPendingMentionTriggerRange] =
    useState<ChatTextRange | null>(null);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [replyingTo, setReplyingTo] = useState<GroupMessage | null>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [menuTarget, setMenuTarget] = useState<GroupMenuTarget | null>(null);
  const [recalledEditableTexts, setRecalledEditableTexts] = useState<Record<number, string>>({});
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const [newMessagesBelowCount, setNewMessagesBelowCount] = useState(0);
  const [mentionLocatorMessageIds, setMentionLocatorMessageIds] = useState<number[]>([]);
  const [replyLocatorMessageIds, setReplyLocatorMessageIds] = useState<number[]>([]);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [isFocused, setFocused] = useState(false);
  const [isLoading, setLoading] = useState(true);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"stickers" | "plus" | null>(null);
  const [historyWatermark, setHistoryWatermark] = useState(-1);
  const [groupTitle, setGroupTitle] = useState(
    params.name?.trim() || `${t("group.name.title")} ${params.id}`,
  );
  const [memberCount, setMemberCount] = useState(
    Number.isFinite(initialMemberCount) ? initialMemberCount : 0,
  );
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [groupCreatorId, setGroupCreatorId] = useState("");
  const [imageSelection, setImageSelection] = useState<ImageGallerySelection | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [voiceRecordingState, setVoiceRecordingState] = useState<VoiceRecordingVisualState | null>(
    null,
  );
  const [showGiftSheet, setShowGiftSheet] = useState(false);
  const [moneyComposerKind, setMoneyComposerKind] = useState<ChatMoneyKind | null>(null);
  const [moneyDetail, setMoneyDetail] = useState<{
    payload: ChatMoneyPayload;
    isSender: boolean;
  } | null>(null);
  const [selectionEntries, setSelectionEntries] = useState<ChatSelectionEntry[] | null>(null);
  const [forwardDraft, setForwardDraft] = useState<ForwardDraft | null>(null);
  const [pendingMediaAssets, setPendingMediaAssets] = useState<ImagePickerAsset[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const messagesRef = useRef<GroupMessage[]>([]);
  const listRef = useRef<FlatList<TimelineRow>>(null);
  const hiddenMessageIdsRef = useRef<Set<number>>(new Set());
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const screenActiveRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const initialPushMessageHandledRef = useRef<string | null>(null);
  const memberRevisionRef = useRef(0);
  const activeSessionRef = useRef(sessionKey);
  const syncAttemptRef = useRef(0);
  const outboxTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const outboxInFlightRef = useRef(new Set<string>());
  const backfillInFlightRef = useRef(new Set<string>());
  const draftSnapshotsRef = useRef(new Map<string, ChatDraftSnapshot>());
  const groupFallbackTitleRef = useRef("");
  activeSessionRef.current = sessionKey;
  if (sessionKey && renderSessionKey === sessionKey) {
    draftSnapshotsRef.current.set(sessionKey, {
      text: draft,
      ...(composerMentions.length > 0 ? { mentions: composerMentions } : {}),
      ...(replyingTo ? { quote: groupDraftQuote(replyingTo, user?.user_id, t("common.me")) } : {}),
    });
  }

  const visibleMessages = useMemo(
    () => (renderSessionKey === sessionKey ? messages : []),
    [messages, renderSessionKey, sessionKey],
  );

  useLayoutEffect(() => {
    syncAttemptRef.current += 1;
    messagesRef.current = [];
    hiddenMessageIdsRef.current = new Set();
    hasMoreRef.current = false;
    loadingMoreRef.current = false;
    screenActiveRef.current = false;
    initialPushMessageHandledRef.current = null;
    memberRevisionRef.current = 0;
    // Route/account changes need one pre-paint reset; every async callback is
    // additionally fenced by `activeSessionRef` below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages([]);
    setRenderSessionKey(sessionKey);
    setDraft("");
    setComposerMentions([]);
    setComposerSelection({ location: 0, length: 0 });
    setPendingMentionTriggerRange(null);
    setShowMentionPicker(false);
    setReplyingTo(null);
    setMenuTarget(null);
    setRecalledEditableTexts({});
    setHighlightedMessageId(null);
    setNewMessagesBelowCount(0);
    setMentionLocatorMessageIds([]);
    setReplyLocatorMessageIds([]);
    setIsNearBottom(true);
    setFocused(false);
    setLoading(Boolean(sessionKey));
    setLoadingMore(false);
    setHasMore(false);
    setError(null);
    setPanel(null);
    setHistoryWatermark(-1);
    const fallbackTitle = `${t("group.name.title")} ${params.id}`;
    groupFallbackTitleRef.current = fallbackTitle;
    setGroupTitle(params.name?.trim() || fallbackTitle);
    setMemberCount(Number.isFinite(initialMemberCount) ? initialMemberCount : 0);
    setGroupMembers([]);
    setGroupCreatorId("");
    setImageSelection(null);
    setPreviewVideoUrl(null);
    setVoiceRecordingState(null);
    setShowGiftSheet(false);
    setMoneyComposerKind(null);
    setMoneyDetail(null);
    setSelectionEntries(null);
    setForwardDraft(null);
    setPendingMediaAssets([]);
    setToastMessage(null);
    // `t` is intentionally handled by the fallback-only effect below. A locale
    // change must not reset the active group's messages, draft or scroll state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMemberCount, params.id, params.name, sessionKey]);

  useEffect(() => {
    const previousFallback = groupFallbackTitleRef.current;
    const nextFallback = `${t("group.name.title")} ${params.id}`;
    groupFallbackTitleRef.current = nextFallback;
    if (params.name?.trim()) return;
    const frame = requestAnimationFrame(() => {
      setGroupTitle((current) => (current === previousFallback ? nextFallback : current));
    });
    return () => cancelAnimationFrame(frame);
  }, [params.id, params.name, t]);

  useEffect(() => {
    // A retry that belongs to group A may keep delivering to A's durable cache
    // while this route renders group B. Only a real unmount stops component-owned
    // timers; returning A→B→A must not silently pause an already scheduled job.
    activeSessionRef.current = sessionKey;
    const outboxTimers = outboxTimersRef.current;
    return () => {
      activeSessionRef.current = "";
      syncAttemptRef.current += 1;
      for (const timer of outboxTimers.values()) clearTimeout(timer);
      outboxTimers.clear();
    };
    // Session changes are handled by the pre-paint reset above. This effect is
    // deliberately mount-scoped so its cleanup represents a real unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerBackButtonDisplayMode: "minimal",
      headerShadowVisible: false,
      headerStyle: { backgroundColor: colors.background },
      title: selectionEntries
        ? t("selection.count", selectionEntries.length)
        : memberCount > 0
          ? `${groupTitle} (${memberCount})`
          : groupTitle,
      headerRight: selectionEntries
        ? () => null
        : () => (
            <Pressable
              accessibilityLabel={t("group.info.title")}
              hitSlop={10}
              onPress={() =>
                router.push({
                  pathname: "/group-detail",
                  params: { id: params.id },
                })
              }
            >
              <SymbolView name="ellipsis" size={16} weight="medium" tintColor={colors.accent} />
            </Pressable>
          ),
    });
  }, [groupTitle, memberCount, navigation, params.id, selectionEntries, t]);

  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        Keyboard.dismiss();
        if (selectionEntries === null) return;
        event.preventDefault();
        setSelectionEntries(null);
      }),
    [navigation, selectionEntries],
  );

  const load = useCallback(async () => {
    if (!ownerId || !sessionKey || !Number.isInteger(groupId) || groupId <= 0) return;
    const expectedSession = sessionKey;
    const syncAttempt = syncAttemptRef.current + 1;
    syncAttemptRef.current = syncAttempt;
    const isCurrent = () =>
      activeSessionRef.current === expectedSession && syncAttemptRef.current === syncAttempt;
    if (messagesRef.current.length === 0) setLoading(true);
    try {
      const [cached, initialWatermark, hiddenIds, pendingJobs, wasBackfilled] = await Promise.all([
        readGroupChatCachedPage(ownerId, groupId),
        readGroupHistoryClearWatermark(ownerId, groupId),
        readHiddenChatMessageIds(ownerId, "group", String(groupId)),
        readGroupChatOutboxJobs(ownerId, groupId),
        isGroupChatHistoryBackfilled(ownerId, groupId),
      ]);
      if (!isCurrent()) return;
      const latestWatermark = await readGroupHistoryClearWatermark(ownerId, groupId);
      if (!isCurrent()) return;
      const watermark = Math.max(initialWatermark, latestWatermark);
      setHistoryWatermark(watermark);
      hiddenMessageIdsRef.current = hiddenIds;
      const cachedVisible = filterLocallyHiddenChatMessages(
        filterClearedGroupMessages(cached.messages, watermark),
        hiddenIds,
      );
      const pending = pendingJobs.map(groupOptimisticOutboxMessage);
      const currentPending = messagesRef.current.filter(
        (message) => message.delivery_status === "sending" || message.delivery_status === "failed",
      );
      const initial = mergeMessages(currentPending, ...cachedVisible, ...pending);
      messagesRef.current = initial;
      setRenderSessionKey(expectedSession);
      setMessages(initial);
      hasMoreRef.current = cached.hasMore;
      setHasMore(cached.hasMore);
      setError(null);
      for (const job of pendingJobs) scheduleGroupOutboxJob(job, expectedSession);
      const cachedReadThrough = maximumServerMessageId(cachedVisible);
      if (cachedReadThrough !== undefined && screenActiveRef.current && isNearBottomRef.current)
        void markConversationRead(ownerId, "group", String(groupId), cachedReadThrough);

      const fetched: GroupMessage[] = [];
      const latestCachedId = maximumServerMessageId(cached.messages);
      if (latestCachedId !== undefined) {
        let afterId = latestCachedId;
        for (
          let pageIndex = 0;
          pageIndex < groupChatHistoryPolicy.maximumBackfillPages;
          pageIndex += 1
        ) {
          const newer = await getGroupMessages(groupId, {
            afterId,
            limit: groupChatHistoryPolicy.syncPageSize,
          });
          if (!isCurrent()) return;
          fetched.push(...newer.messages);
          const nextAfterId = maximumServerMessageId(newer.messages);
          if (!newer.hasMore || nextAfterId === undefined || nextAfterId <= afterId) break;
          afterId = nextAfterId;
        }
      }
      const recent = await getGroupMessages(groupId, {
        limit: groupChatHistoryPolicy.syncPageSize,
      });
      if (!isCurrent()) return;
      fetched.push(...recent.messages);
      await saveGroupChatMessages(ownerId, groupId, fetched);
      if (!isCurrent()) return;
      const serverVisible = filterLocallyHiddenChatMessages(
        filterClearedGroupMessages(fetched, watermark),
        hiddenIds,
      );
      const merged = mergeMessages(messagesRef.current, ...serverVisible);
      messagesRef.current = merged;
      setMessages(merged);
      const readThrough =
        maximumServerMessageId(serverVisible) ?? maximumServerMessageId(cachedVisible);
      if (readThrough !== undefined && screenActiveRef.current && isNearBottomRef.current)
        void markConversationRead(ownerId, "group", String(groupId), readThrough);

      if (!wasBackfilled) {
        hasMoreRef.current = false;
        setHasMore(false);
        void backfillGroupChatHistory(expectedSession);
      } else {
        const firstServerId = minimumServerMessageId(merged);
        const older =
          firstServerId === undefined
            ? null
            : await readGroupChatCachedPage(ownerId, groupId, {
                beforeId: firstServerId,
                limit: 1,
              });
        if (!isCurrent()) return;
        const nextHasMore = Boolean(older?.messages.length);
        hasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);
      }
    } catch (nextError) {
      if (isCurrent() && messagesRef.current.length === 0)
        setError(nextError instanceof Error ? nextError.message : t("messages.loadFailed"));
    } finally {
      if (isCurrent()) setLoading(false);
    }
    // The delivery/backfill functions are session-keyed and use this render
    // closure. Listing them would recreate `load` on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, ownerId, sessionKey, t]);

  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      chatRealtimeService.setActiveConversation("group", String(groupId));
      void load();
      return () => {
        Keyboard.dismiss();
        screenActiveRef.current = false;
        chatRealtimeService.setActiveConversation("group", null);
        const snapshot = draftSnapshotsRef.current.get(sessionKey);
        if (ownerId && groupId > 0 && snapshot)
          void saveChatDraftSnapshot(ownerId, String(groupId), snapshot, "group");
      };
    }, [groupId, load, ownerId, sessionKey]),
  );

  useEffect(() => {
    if (renderSessionKey === sessionKey) messagesRef.current = messages;
  }, [messages, renderSessionKey, sessionKey]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    if (!ownerId || groupId <= 0) return;
    const expectedSession = sessionKey;
    return chatRealtimeService.subscribe((event) => {
      if (activeSessionRef.current !== expectedSession) return;
      if (event.type === "group_message" && event.message.group_id === groupId) {
        const message = event.message;
        if (hiddenMessageIdsRef.current.has(message.id)) return;
        if (message.history_sequence !== undefined && message.history_sequence <= historyWatermark)
          return;
        const wasKnown = messagesRef.current.some(
          (candidate) =>
            candidate.id === message.id ||
            (Boolean(candidate.client_message_id) &&
              candidate.client_message_id === message.client_message_id),
        );
        setMessages((current) => {
          const merged = mergeMessages(current, message);
          messagesRef.current = merged;
          return merged;
        });
        if (message.id > 0)
          void saveGroupChatMessages(ownerId, groupId, [message]).then(() =>
            publishLatestCachedGroupConversationPreview(ownerId, groupId, t),
          );
        if (!wasKnown && screenActiveRef.current) {
          const isMine = message.sender_id === ownerId;
          if (isMine || isNearBottomRef.current) {
            requestAnimationFrame(() => {
              if (activeSessionRef.current === expectedSession)
                listRef.current?.scrollToOffset({ animated: true, offset: 0 });
            });
          } else {
            setNewMessagesBelowCount((count) => count + 1);
            if (message.mentions?.includes(ownerId) || message.mention_all) {
              setMentionLocatorMessageIds((current) =>
                current.includes(message.id) ? current : [...current, message.id],
              );
            }
            const replyId = message.reply_to_id ?? message.reply_to?.id;
            if (
              replyId !== undefined &&
              messagesRef.current.some(
                (candidate) => candidate.id === replyId && candidate.sender_id === ownerId,
              )
            ) {
              setReplyLocatorMessageIds((current) =>
                current.includes(message.id) ? current : [...current, message.id],
              );
            }
          }
        }
        if (message.sender_id !== ownerId && screenActiveRef.current && isNearBottomRef.current) {
          void markConversationRead(ownerId, "group", String(groupId), message.id);
        }
      } else if (event.type === "group_renamed" && event.group_id === groupId) {
        setGroupTitle(event.name);
      } else if (
        event.type === "group_member_updated" &&
        event.update.group_id === groupId &&
        event.update.revision >= memberRevisionRef.current
      ) {
        memberRevisionRef.current = event.update.revision;
        setGroupMembers((current) => {
          const index = current.findIndex(
            (member) => member.user_id === event.update.member.user_id,
          );
          const next =
            index >= 0
              ? current.map((member, memberIndex) =>
                  memberIndex === index ? event.update.member : member,
                )
              : [...current, event.update.member];
          setMemberCount((count) => Math.max(count, next.length));
          return next;
        });
      } else if (event.type === "group_removed" && event.group_id === groupId) {
        void removeCachedGroupDetail(ownerId, groupId);
        void removeCachedGroup(ownerId, groupId);
        router.dismissAll();
      } else if (event.type === "refresh_conversations" && screenActiveRef.current) {
        void load();
      }
    });
  }, [groupId, historyWatermark, load, ownerId, sessionKey, t]);

  useEffect(() => {
    let active = true;
    const ownerId = user?.user_id;
    if (!ownerId || groupId <= 0) return;
    const expectedSession = sessionKey;
    void readChatDraftSnapshot(ownerId, String(groupId), "group").then((saved) => {
      if (!active || activeSessionRef.current !== expectedSession) return;
      setDraft((current) => current || saved.text);
      setComposerMentions(saved.mentions ?? []);
      setComposerSelection({ location: saved.text.length, length: 0 });
      if (saved.quote)
        setReplyingTo((current) => current ?? groupMessageFromDraftQuote(saved.quote!, groupId));
    });
    return () => {
      active = false;
    };
  }, [groupId, sessionKey, user?.user_id]);

  useEffect(() => {
    const ownerId = user?.user_id;
    if (!ownerId || groupId <= 0) return;
    const timer = setTimeout(() => {
      void saveChatDraftSnapshot(
        ownerId,
        String(groupId),
        {
          text: draft,
          ...(composerMentions.length > 0 ? { mentions: composerMentions } : {}),
          ...(replyingTo
            ? { quote: groupDraftQuote(replyingTo, user?.user_id, t("common.me")) }
            : {}),
        },
        "group",
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [composerMentions, draft, groupId, replyingTo, t, user?.user_id]);

  const applyGroupDetail = useCallback(
    (detail: GroupDetail) => {
      if (activeSessionRef.current !== sessionKey || detail.group_id !== groupId) return;
      const displayName =
        detail.viewer_settings.remark.trim() || detail.display_name?.trim() || detail.name.trim();
      if (displayName) setGroupTitle(displayName);
      setMemberCount(detail.members.length);
      setGroupMembers(detail.members);
      setGroupCreatorId(detail.creator_id);
    },
    [groupId, sessionKey],
  );

  useEffect(() => {
    if (!ownerId || groupId <= 0) return;
    const expectedSession = sessionKey;
    return subscribeGroupDetail(ownerId, (detail) => {
      if (detail.group_id !== groupId || activeSessionRef.current !== expectedSession) return;
      void loadCachedGroupDetail(ownerId, groupId).then((accountDetail) => {
        if (activeSessionRef.current === expectedSession && accountDetail)
          applyGroupDetail(accountDetail);
      });
    });
  }, [applyGroupDetail, groupId, ownerId, sessionKey]);

  useEffect(() => {
    let active = true;
    if (!ownerId || groupId <= 0) return;
    const cacheGeneration = groupDetailGeneration(ownerId, groupId);
    void (async () => {
      const cached = await loadCachedGroupDetail(ownerId, groupId);
      if (active && activeSessionRef.current === sessionKey && cached) applyGroupDetail(cached);
      try {
        const detail = await getGroupDetail(groupId);
        if (!active || activeSessionRef.current !== sessionKey) return;
        const resolved = await saveCachedGroupDetail(ownerId, detail, cacheGeneration);
        if (
          active &&
          activeSessionRef.current === sessionKey &&
          cacheGeneration === groupDetailGeneration(ownerId, groupId)
        ) {
          applyGroupDetail(resolved);
        }
      } catch {
        // Message loading remains independent; cached/message-derived members still power @ mentions.
      }
    })();
    return () => {
      active = false;
    };
  }, [applyGroupDetail, groupId, ownerId, sessionKey]);

  useEffect(() => {
    const ownerId = user?.user_id;
    if (!ownerId || groupId <= 0) return;
    const expectedSession = sessionKey;
    return subscribeGroupHistoryClear((event) => {
      if (
        activeSessionRef.current !== expectedSession ||
        event.owner_id !== ownerId ||
        event.group_id !== groupId
      )
        return;
      syncAttemptRef.current += 1;
      setHistoryWatermark((current) => Math.max(current, event.cleared_before_sequence));
      setMessages((current) => {
        const filtered = filterClearedGroupMessages(current, event.cleared_before_sequence);
        messagesRef.current = filtered;
        void publishGroupConversationPreviewUpdate({
          owner_id: ownerId,
          group_id: groupId,
          ...groupConversationPreviewFields(filtered, ownerId, t),
        });
        return filtered;
      });
      void pruneGroupChatCachedMessagesThroughSequence(
        ownerId,
        groupId,
        event.cleared_before_sequence,
      );
      setReplyingTo(null);
      setSelectionEntries(null);
      setMenuTarget(null);
      setMentionLocatorMessageIds([]);
      setReplyLocatorMessageIds([]);
      hasMoreRef.current = false;
      setHasMore(false);
    });
  }, [groupId, sessionKey, t, user?.user_id]);

  useEffect(() => {
    const currentOwnerId = user?.user_id;
    if (!currentOwnerId) return;
    return subscribeChatImageOutbox((event) => {
      if (event.scope !== "group" || event.job.owner_id !== currentOwnerId) return;
      const eventGroupId = Number(event.job.target_id);
      if (!Number.isSafeInteger(eventGroupId) || eventGroupId <= 0) return;
      if (event.kind === "confirmed") {
        void saveGroupChatMessages(currentOwnerId, eventGroupId, [event.message]).then(() =>
          publishLatestCachedGroupConversationPreview(currentOwnerId, eventGroupId, t),
        );
      }
      if (activeSessionRef.current !== groupChatSessionKey(currentOwnerId, eventGroupId)) return;
      setMessages((current) => {
        const merged = mergeMessages(
          current,
          event.kind === "updated" ? groupOptimisticImageMessage(event.job) : event.message,
        );
        messagesRef.current = merged;
        return merged;
      });
    });
  }, [t, user?.user_id]);

  useEffect(() => {
    const currentOwnerId = user?.user_id;
    if (!currentOwnerId) return;
    return subscribeChatVideoOutbox((event) => {
      if (event.scope !== "group" || event.job.owner_id !== currentOwnerId) return;
      const eventGroupId = Number(event.job.target_id);
      if (!Number.isSafeInteger(eventGroupId) || eventGroupId <= 0) return;
      if (event.kind === "confirmed") {
        void saveGroupChatMessages(currentOwnerId, eventGroupId, [event.message]).then(() =>
          publishLatestCachedGroupConversationPreview(currentOwnerId, eventGroupId, t),
        );
      }
      if (activeSessionRef.current !== groupChatSessionKey(currentOwnerId, eventGroupId)) return;
      setMessages((current) => {
        const merged = mergeMessages(
          current,
          event.kind === "updated" ? groupOptimisticVideoMessage(event.job) : event.message,
        );
        messagesRef.current = merged;
        return merged;
      });
    });
  }, [t, user?.user_id]);

  useEffect(() => {
    const currentOwnerId = user?.user_id;
    if (!currentOwnerId || groupId <= 0) return;
    const targetId = String(groupId);
    void resumeChatImageUploads(currentOwnerId, "group", targetId);
    void resumeChatVideoUploads(currentOwnerId, "group", targetId);
  }, [groupId, user?.user_id]);

  useEffect(() => {
    const ownerId = user?.user_id;
    if (!ownerId || groupId <= 0) return;
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active")
        void saveChatDraftSnapshot(
          ownerId,
          String(groupId),
          {
            text: draft,
            ...(composerMentions.length > 0 ? { mentions: composerMentions } : {}),
            ...(replyingTo
              ? { quote: groupDraftQuote(replyingTo, user?.user_id, t("common.me")) }
              : {}),
          },
          "group",
        );
      if (state === "active" && previousState !== "active" && screenActiveRef.current) {
        void load();
        void resumeChatImageUploads(ownerId, "group", String(groupId));
        void resumeChatVideoUploads(ownerId, "group", String(groupId));
      }
      previousState = state;
    });
    return () => subscription.remove();
  }, [composerMentions, draft, groupId, load, replyingTo, t, user?.user_id]);

  useEffect(() => {
    if (call.session === null) return;
    Keyboard.dismiss();
    const frame = requestAnimationFrame(() => {
      setPanel(null);
      setFocused(false);
      setMenuTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [call.session]);

  useEffect(() => {
    if (selectionEntries === null) return;
    const available = new Set(
      visibleMessages.filter(isAvailableForGroupSelection).map((message) => message.id),
    );
    const next = selectionEntries.filter((entry) => available.has(entry.message_id));
    if (next.length === selectionEntries.length) return;
    const frame = requestAnimationFrame(() => {
      setSelectionEntries(next.length > 0 ? next : null);
      setToastMessage(t("selection.removedUnavailable"));
    });
    return () => cancelAnimationFrame(frame);
  }, [selectionEntries, t, visibleMessages]);

  const timeline = useMemo(() => makeTimeline(visibleMessages), [visibleMessages]);
  useEffect(() => {
    const authors = visibleMessages
      .filter((message) => message.sender_id.trim().length > 0)
      .map((message) => ({
        user_id: message.sender_id,
        nickname: message.sender_nickname || message.sender_id,
        avatar_url: message.sender_avatar || "",
      }));
    if (authors.length > 0) void cacheUserInfoBatch(authors);
  }, [visibleMessages]);
  const background = groupId > 0 ? appearance.effective("group", String(groupId)) : null;
  const giftRecipientSource = useMemo(
    () => ({ kind: "group" as const, groupId, groupName: groupTitle }),
    [groupId, groupTitle],
  );

  const mentionCandidates = useMemo(
    () =>
      normalizeMentionMembers(
        [
          ...groupMembers,
          ...visibleMessages.map((message): GroupMember => ({
            user_id: message.sender_id,
            nickname: message.sender_nickname || message.sender_id,
            avatar_url: message.sender_avatar,
            role: "member",
          })),
        ],
        ownerId,
      ),
    [groupMembers, ownerId, visibleMessages],
  );
  const allowsMentionAll = useMemo(() => {
    if (!ownerId) return false;
    if (groupCreatorId === ownerId) return true;
    const role = groupMembers
      .find((member) => member.user_id === ownerId)
      ?.role.trim()
      .toLocaleLowerCase();
    return role === "owner" || role === "admin";
  }, [groupCreatorId, groupMembers, ownerId]);

  function scheduleGroupOutboxJob(job: GroupChatOutboxJob, expectedSession: string): void {
    const existing = outboxTimersRef.current.get(job.id);
    if (existing) clearTimeout(existing);
    outboxTimersRef.current.delete(job.id);
    if (job.state === "failed") return;
    const scheduledAt = job.next_attempt_at ? Date.parse(job.next_attempt_at) : Date.now();
    const delay = Math.max(0, Number.isFinite(scheduledAt) ? scheduledAt - Date.now() : 0);
    const timer = setTimeout(() => {
      outboxTimersRef.current.delete(job.id);
      void deliverGroupOutboxJob(job, expectedSession);
    }, delay);
    outboxTimersRef.current.set(job.id, timer);
  }

  async function deliverGroupOutboxJob(
    input: GroupChatOutboxJob,
    expectedSession: string,
  ): Promise<void> {
    if (outboxInFlightRef.current.has(input.id)) return;
    outboxInFlightRef.current.add(input.id);
    const sendingJob = sendingGroupChatOutboxJob(input);
    try {
      await saveGroupChatOutboxJob(sendingJob);
      if (activeSessionRef.current === expectedSession) {
        setMessages((current) => {
          const merged = mergeMessages(current, groupOptimisticOutboxMessage(sendingJob));
          messagesRef.current = merged;
          return merged;
        });
      }
      const confirmed =
        sendingJob.msg_type === "text"
          ? await sendGroupTextMessage(sendingJob.group_id, sendingJob.content, {
              clientMessageId: sendingJob.id,
              mentions: sendingJob.mentions ?? [],
              mentionAll: sendingJob.mention_all,
              ...(sendingJob.reply_to_id !== undefined
                ? { replyToId: sendingJob.reply_to_id }
                : {}),
            })
          : await sendGroupStickerMessage(
              sendingJob.group_id,
              sendingJob.sticker_pack_id ?? "",
              sendingJob.sticker_id ?? "",
              {
                clientMessageId: sendingJob.id,
                ...(sendingJob.reply_to_id !== undefined
                  ? { replyToId: sendingJob.reply_to_id }
                  : {}),
              },
            );
      const normalized: GroupMessage = {
        ...confirmed,
        group_id: confirmed.group_id || sendingJob.group_id,
        sender_id: confirmed.sender_id || sendingJob.owner_id,
        sender_nickname: confirmed.sender_nickname || sendingJob.sender_nickname,
        sender_avatar: confirmed.sender_avatar || sendingJob.sender_avatar,
        msg_type: confirmed.msg_type || sendingJob.msg_type,
        content: confirmed.content.trim() ? confirmed.content : sendingJob.content,
        ...(confirmed.reply_to_id === undefined && sendingJob.reply_to_id !== undefined
          ? { reply_to_id: sendingJob.reply_to_id }
          : {}),
        ...(confirmed.reply_to === undefined && sendingJob.reply_to
          ? { reply_to: sendingJob.reply_to }
          : {}),
        ...(confirmed.mentions === undefined && sendingJob.mentions?.length
          ? { mentions: sendingJob.mentions }
          : {}),
        mention_all: confirmed.mention_all || sendingJob.mention_all,
        client_message_id: confirmed.client_message_id ?? sendingJob.id,
        delivery_status: "sent",
      };
      await Promise.all([
        removeGroupChatOutboxJob(sendingJob.owner_id, sendingJob.id),
        saveGroupChatMessages(sendingJob.owner_id, sendingJob.group_id, [normalized]),
      ]);
      await publishLatestCachedGroupConversationPreview(
        sendingJob.owner_id,
        sendingJob.group_id,
        t,
      );
      if (activeSessionRef.current === expectedSession) {
        setMessages((current) => {
          const merged = mergeMessages(current, normalized);
          messagesRef.current = merged;
          return merged;
        });
      }
    } catch (nextError) {
      const failed = groupChatOutboxFailure(sendingJob, nextError);
      await saveGroupChatOutboxJob(failed);
      if (activeSessionRef.current === expectedSession) {
        setMessages((current) => {
          const merged = mergeMessages(current, groupOptimisticOutboxMessage(failed));
          messagesRef.current = merged;
          return merged;
        });
        if (failed.state === "failed")
          Alert.alert(
            t("messages.sendFailed"),
            nextError instanceof Error ? nextError.message : t("common.operationFailed"),
          );
      }
      if (failed.state === "retry_waiting") scheduleGroupOutboxJob(failed, expectedSession);
    } finally {
      outboxInFlightRef.current.delete(input.id);
    }
  }

  async function backfillGroupChatHistory(expectedSession: string): Promise<void> {
    if (!ownerId || groupId <= 0) return;
    if (backfillInFlightRef.current.has(expectedSession)) return;
    backfillInFlightRef.current.add(expectedSession);
    try {
      const cached = await readGroupChatCachedPage(ownerId, groupId, {
        limit: groupChatHistoryPolicy.maximumCachedMessages,
      });
      let cursor = minimumServerMessageId(cached.messages);
      if (cursor === undefined) {
        await markGroupChatHistoryBackfilled(ownerId, groupId);
        return;
      }
      for (
        let pageIndex = 0;
        pageIndex < groupChatHistoryPolicy.maximumBackfillPages;
        pageIndex += 1
      ) {
        if (activeSessionRef.current !== expectedSession) return;
        try {
          const page = await getGroupMessages(groupId, {
            beforeId: cursor,
            limit: groupChatHistoryPolicy.syncPageSize,
          });
          if (page.messages.length === 0) {
            await markGroupChatHistoryBackfilled(ownerId, groupId);
            return;
          }
          await saveGroupChatMessages(ownerId, groupId, page.messages);
          if (activeSessionRef.current !== expectedSession) return;
          const nextCursor = minimumServerMessageId(page.messages);
          if (activeSessionRef.current === expectedSession) {
            hasMoreRef.current = true;
            setHasMore(true);
          }
          if (!page.hasMore || nextCursor === undefined || nextCursor >= cursor) {
            await markGroupChatHistoryBackfilled(ownerId, groupId);
            return;
          }
          cursor = nextCursor;
        } catch {
          if (activeSessionRef.current === expectedSession) {
            hasMoreRef.current = true;
            setHasMore(true);
          }
          return;
        }
      }
    } finally {
      backfillInFlightRef.current.delete(expectedSession);
    }
  }

  const editDraft = useCallback(
    (value: string) => {
      const edit = deriveChatTextEdit(draft, value);
      if (isStandaloneAtInsertion(draft, edit.range, edit.replacementText)) {
        setPendingMentionTriggerRange({ location: edit.range.location, length: 1 });
        setShowMentionPicker(true);
      }
      const result = applyChatMentionEdit(edit.range, edit.replacementText, {
        text: draft,
        mentions: composerMentions,
      });
      setDraft(result.document.text);
      setComposerMentions(result.document.mentions);
      setComposerSelection(result.selectedRange);
    },
    [composerMentions, draft],
  );

  const insertMentions = useCallback(
    (
      selections: ChatMentionSelection[],
      replacementRange: ChatTextRange | null = pendingMentionTriggerRange,
    ) => {
      if (selections.length === 0) return;
      const result = insertChatMentions(
        selections,
        replacementRange,
        { text: draft, mentions: composerMentions },
        composerSelection,
      );
      setDraft(result.document.text);
      setComposerMentions(result.document.mentions);
      setComposerSelection(result.selectedRange);
      setPendingMentionTriggerRange(null);
      setShowMentionPicker(false);
      setComposerFocusRequest((value) => value + 1);
    },
    [composerMentions, composerSelection, draft, pendingMentionTriggerRange],
  );

  const send = async (retry?: GroupMessage) => {
    const content = (retry?.content ?? draft).trim();
    if (!content || !user?.user_id || groupId <= 0) return;
    const expectedSession = sessionKey;
    const outgoingMentions = retry
      ? (retry.mentions ?? [])
      : mentionedUserIds({ text: draft, mentions: composerMentions });
    const outgoingMentionAll = retry
      ? retry.mention_all
      : mentionsAll({ text: draft, mentions: composerMentions });
    const replyTarget = retry ? null : replyingTo;
    const replyPreview =
      retry?.reply_to ?? (replyTarget ? replyPreviewFromMessage(replyTarget) : undefined);
    const replyToId = retry?.reply_to_id ?? replyPreview?.id;
    const clientId = retry?.client_message_id ?? makeClientMessageId();
    const jobInput = {
      id: clientId,
      owner_id: user.user_id,
      group_id: groupId,
      msg_type: "text" as const,
      content,
      ...(replyToId !== undefined ? { reply_to_id: replyToId } : {}),
      ...(replyPreview ? { reply_to: replyPreview } : {}),
      ...(outgoingMentions.length > 0 ? { mentions: outgoingMentions } : {}),
      mention_all: outgoingMentionAll,
      sender_nickname: user.nickname,
      sender_avatar: user.avatar_url,
      created_at: retry?.timestamp ?? new Date().toISOString(),
    };
    const optimistic = groupOptimisticOutboxMessage({
      ...jobInput,
      state: "queued",
      attempt_count: 0,
    });
    setMessages((current) => {
      const merged = mergeMessages(current, optimistic);
      messagesRef.current = merged;
      return merged;
    });
    if (!retry) {
      setDraft("");
      setComposerMentions([]);
      setComposerSelection({ location: 0, length: 0 });
      setPendingMentionTriggerRange(null);
      setReplyingTo(null);
    }
    try {
      const existing = retry ? await readGroupChatOutboxJob(user.user_id, clientId) : null;
      const job = existing
        ? queuedGroupChatOutboxJob(existing)
        : await createGroupChatOutboxJob(jobInput);
      if (existing) await saveGroupChatOutboxJob(job);
      scheduleGroupOutboxJob(job, expectedSession);
    } catch (nextError) {
      if (activeSessionRef.current !== expectedSession) return;
      setMessages((current) => {
        const next = current.map((item) =>
          item.client_message_id === clientId
            ? { ...item, delivery_status: "failed" as const }
            : item,
        );
        messagesRef.current = next;
        return next;
      });
      Alert.alert(
        t("messages.sendFailed"),
        nextError instanceof Error ? nextError.message : t("common.operationFailed"),
      );
    }
  };

  const sendVoice = async (recording: ChatVoiceRecording, retryMessage?: GroupMessage) => {
    if (!user?.user_id || groupId <= 0) return;
    const expectedSession = sessionKey;
    const sendingOwnerId = user.user_id;
    const sendingGroupId = groupId;
    const clientMessageId = retryMessage?.client_message_id ?? makeClientMessageId();
    const optimistic: GroupMessage = retryMessage
      ? { ...retryMessage, delivery_status: "sending" }
      : {
          id: -Date.now(),
          group_id: groupId,
          sender_id: user.user_id,
          msg_type: "voice",
          content: `${recording.uri}|${recording.duration}`,
          timestamp: new Date().toISOString(),
          sender_nickname: user.nickname,
          sender_avatar: user.avatar_url,
          mention_all: false,
          client_message_id: clientMessageId,
          version: 1,
          delivery_status: "sending",
        };
    setMessages((current) => {
      const merged = mergeMessages(current, optimistic);
      messagesRef.current = merged;
      return merged;
    });
    try {
      const received = await sendGroupVoiceMessage(sendingGroupId, recording);
      const normalized: GroupMessage = {
        ...received,
        group_id: received.group_id || sendingGroupId,
        sender_id: received.sender_id || sendingOwnerId,
        sender_nickname: received.sender_nickname || user.nickname,
        sender_avatar: received.sender_avatar || user.avatar_url,
        client_message_id: received.client_message_id ?? clientMessageId,
        delivery_status: "sent",
      };
      await saveGroupChatMessages(sendingOwnerId, sendingGroupId, [normalized]);
      await publishLatestCachedGroupConversationPreview(sendingOwnerId, sendingGroupId, t);
      if (activeSessionRef.current !== expectedSession) return;
      setMessages((current) => {
        const merged = mergeMessages(current, normalized);
        messagesRef.current = merged;
        return merged;
      });
    } catch (nextError) {
      if (activeSessionRef.current !== expectedSession) return;
      setMessages((current) => {
        const next = current.map((message) =>
          message.client_message_id === clientMessageId
            ? { ...message, delivery_status: "failed" as const }
            : message,
        );
        messagesRef.current = next;
        return next;
      });
      Alert.alert(
        t("messages.sendFailed"),
        nextError instanceof Error ? nextError.message : t("common.operationFailed"),
      );
    }
  };

  const sendSticker = async (pack: ChatStickerPack, sticker: ChatStickerItem) => {
    if (!user?.user_id || groupId <= 0) return;
    const expectedSession = sessionKey;
    const replyTarget = replyingTo;
    const replyToId = replyTarget?.id;
    const clientMessageId = makeClientMessageId();
    const content = encodeChatStickerMessagePayload(makeChatStickerMessagePayload(pack, sticker));
    const replyPreview = replyTarget ? replyPreviewFromMessage(replyTarget) : undefined;
    const jobInput = {
      id: clientMessageId,
      owner_id: user.user_id,
      group_id: groupId,
      msg_type: "sticker" as const,
      content,
      sticker_pack_id: pack.id,
      sticker_id: sticker.id,
      ...(replyToId !== undefined ? { reply_to_id: replyToId } : {}),
      ...(replyPreview ? { reply_to: replyPreview } : {}),
      mention_all: false,
      sender_nickname: user.nickname,
      sender_avatar: user.avatar_url,
      created_at: new Date().toISOString(),
    };
    setReplyingTo(null);
    setMessages((current) => {
      const merged = mergeMessages(
        current,
        groupOptimisticOutboxMessage({ ...jobInput, state: "queued", attempt_count: 0 }),
      );
      messagesRef.current = merged;
      return merged;
    });
    try {
      const job = await createGroupChatOutboxJob(jobInput);
      scheduleGroupOutboxJob(job, expectedSession);
    } catch (nextError) {
      if (activeSessionRef.current !== expectedSession) return;
      setMessages((current) => {
        const next = current.map((message) =>
          message.client_message_id === clientMessageId
            ? { ...message, delivery_status: "failed" as const }
            : message,
        );
        messagesRef.current = next;
        return next;
      });
      Alert.alert(
        t("messages.stickerSendFailed"),
        nextError instanceof Error ? nextError.message : t("common.operationFailed"),
      );
    }
  };

  const sendGift = async (giftId: string, recipientId: string) => {
    if (!user?.user_id || groupId <= 0) return;
    if (recipientId === user.user_id) throw new Error(t("gift.cannotSendToSelf"));
    const expectedSession = sessionKey;
    const sendingOwnerId = user.user_id;
    const sendingGroupId = groupId;
    const key = giftIdempotencyKey(recipientId, giftId);
    const received = await sendGroupGiftMessage(sendingGroupId, recipientId, giftId, key);
    completeGiftIdempotency(recipientId, giftId);
    const normalized: GroupMessage = {
      ...received,
      group_id: received.group_id || sendingGroupId,
      sender_id: received.sender_id || sendingOwnerId,
      sender_nickname: received.sender_nickname || user.nickname,
      sender_avatar: received.sender_avatar || user.avatar_url,
      msg_type: received.msg_type || "gift",
      delivery_status: "sent",
    };
    await saveGroupChatMessages(sendingOwnerId, sendingGroupId, [normalized]);
    await publishLatestCachedGroupConversationPreview(sendingOwnerId, sendingGroupId, t);
    if (activeSessionRef.current !== expectedSession) return;
    setMessages((current) => {
      const merged = mergeMessages(current, normalized);
      messagesRef.current = merged;
      return merged;
    });
  };

  const loadMore = useCallback(async (): Promise<GroupMessage[]> => {
    if (!ownerId || !hasMoreRef.current || loadingMoreRef.current || groupId <= 0) return [];
    const firstServerMessageId = minimumServerMessageId(messagesRef.current);
    if (firstServerMessageId === undefined) return [];
    const expectedSession = sessionKey;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      let cursor = firstServerMessageId;
      const collected: GroupMessage[] = [];
      let nextHasMore = true;
      const cached = await readGroupChatCachedPage(ownerId, groupId, {
        beforeId: cursor,
        limit: groupChatHistoryPolicy.visiblePageSize,
      });
      if (activeSessionRef.current !== expectedSession) return [];
      if (cached.messages.length > 0) {
        cursor = cached.messages[0]!.id;
        collected.push(
          ...filterLocallyHiddenChatMessages(
            filterClearedGroupMessages(cached.messages, historyWatermark),
            hiddenMessageIdsRef.current,
          ),
        );
        nextHasMore = cached.hasMore;
      }
      if (cached.messages.length === 0 || collected.length === 0) {
        for (
          let pageIndex = 0;
          pageIndex < groupChatHistoryPolicy.maximumBackfillPages;
          pageIndex += 1
        ) {
          const page = await getGroupMessages(groupId, {
            beforeId: cursor,
            limit: groupChatHistoryPolicy.syncPageSize,
          });
          if (activeSessionRef.current !== expectedSession) return [];
          await saveGroupChatMessages(ownerId, groupId, page.messages);
          const latestWatermark = await readGroupHistoryClearWatermark(ownerId, groupId);
          if (activeSessionRef.current !== expectedSession) return [];
          setHistoryWatermark((current) => Math.max(current, latestWatermark));
          const visible = filterLocallyHiddenChatMessages(
            filterClearedGroupMessages(page.messages, latestWatermark),
            hiddenMessageIdsRef.current,
          );
          collected.push(...visible);
          const nextCursor = minimumServerMessageId(page.messages);
          nextHasMore = page.hasMore;
          if (
            visible.length > 0 ||
            !page.hasMore ||
            nextCursor === undefined ||
            nextCursor >= cursor
          )
            break;
          cursor = nextCursor;
        }
      }
      if (activeSessionRef.current !== expectedSession) return [];
      const merged = mergeMessages(messagesRef.current, ...collected);
      messagesRef.current = merged;
      setMessages(merged);
      hasMoreRef.current = nextHasMore;
      setHasMore(nextHasMore);
      return collected;
    } catch (nextError) {
      if (activeSessionRef.current === expectedSession)
        Alert.alert(
          t("common.loadFailed"),
          nextError instanceof Error ? nextError.message : t("common.operationFailed"),
        );
      return [];
    } finally {
      if (activeSessionRef.current === expectedSession) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [groupId, historyWatermark, ownerId, sessionKey, t]);

  const loadMoreGalleryImages = useCallback(async () => {
    const existing = new Set(
      messagesRef.current.filter(isImageMessage).map((message) => message.content),
    );
    const older = await loadMore();
    return older
      .filter(isImageMessage)
      .map((message) => message.content)
      .filter((url) => !existing.has(url));
  }, [loadMore]);

  const retryMessage = (message: GroupMessage) => {
    const expectedSession = sessionKey;
    if (isImageMessage(message) && message.client_message_id) {
      const clientMessageId = message.client_message_id;
      setMessages((current) => {
        const next = current.map((item) =>
          item.client_message_id === clientMessageId
            ? { ...item, delivery_status: "sending" as const }
            : item,
        );
        messagesRef.current = next;
        return next;
      });
      if (user?.user_id) {
        void retryChatImageUpload(user.user_id, clientMessageId).then((didRetry) => {
          if (activeSessionRef.current !== expectedSession) return;
          if (!didRetry) {
            setMessages((current) => {
              const next = current.map((item) =>
                item.client_message_id === clientMessageId
                  ? { ...item, delivery_status: "failed" as const }
                  : item,
              );
              messagesRef.current = next;
              return next;
            });
            Alert.alert(t("common.operationFailed"), t("messages.sendFailed"));
          }
        });
      }
      return;
    }
    if (isVideoMessage(message) && message.client_message_id) {
      const clientMessageId = message.client_message_id;
      setMessages((current) => {
        const next = current.map((item) =>
          item.client_message_id === clientMessageId
            ? { ...item, delivery_status: "sending" as const }
            : item,
        );
        messagesRef.current = next;
        return next;
      });
      if (user?.user_id) {
        void retryChatVideoUpload(user.user_id, clientMessageId).then((didRetry) => {
          if (activeSessionRef.current !== expectedSession) return;
          if (!didRetry) {
            setMessages((current) => {
              const next = current.map((item) =>
                item.client_message_id === clientMessageId
                  ? { ...item, delivery_status: "failed" as const }
                  : item,
              );
              messagesRef.current = next;
              return next;
            });
            Alert.alert(t("common.operationFailed"), t("messages.sendFailed"));
          }
        });
      }
      return;
    }
    if (isVoiceMessage(message) && message.client_message_id) {
      const voice = parseChatVoiceContent(message.content);
      if (!/^(file|content):/u.test(voice.url) || voice.duration <= 0) {
        Alert.alert(t("common.operationFailed"), t("messages.sendFailed"));
        return;
      }
      void sendVoice(
        {
          uri: voice.url,
          duration: voice.duration,
          filename: `voice_${Math.floor(Date.now() / 1_000)}.m4a`,
        },
        message,
      );
      return;
    }
    if (message.client_message_id && user?.user_id) {
      void readGroupChatOutboxJob(user.user_id, message.client_message_id).then(async (stored) => {
        if (activeSessionRef.current !== expectedSession) return;
        if (stored) {
          const queued = queuedGroupChatOutboxJob(stored);
          await saveGroupChatOutboxJob(queued);
          if (activeSessionRef.current === expectedSession) {
            setMessages((current) => {
              const merged = mergeMessages(current, groupOptimisticOutboxMessage(queued));
              messagesRef.current = merged;
              return merged;
            });
          }
          scheduleGroupOutboxJob(queued, expectedSession);
          return;
        }
        if (message.msg_type.toLocaleLowerCase() === "sticker") {
          const payload = parseChatStickerMessagePayload(message.content);
          if (!payload) {
            Alert.alert(t("common.operationFailed"), t("messages.sendFailed"));
            return;
          }
          const created = await createGroupChatOutboxJob({
            id: message.client_message_id!,
            owner_id: user.user_id,
            group_id: groupId,
            msg_type: "sticker",
            content: message.content,
            sticker_pack_id: payload.packId,
            sticker_id: payload.stickerId,
            ...(message.reply_to_id !== undefined ? { reply_to_id: message.reply_to_id } : {}),
            ...(message.reply_to ? { reply_to: message.reply_to } : {}),
            mention_all: false,
            sender_nickname: message.sender_nickname,
            sender_avatar: message.sender_avatar,
            created_at: message.timestamp,
          });
          scheduleGroupOutboxJob(created, expectedSession);
          return;
        }
        void send(message);
      });
      return;
    }
    void send(message);
  };

  const revealMessage = useCallback(
    (messageId: number) => {
      const data = [...makeTimeline(messagesRef.current)].reverse();
      const index = data.findIndex((row) => row.message.id === messageId);
      if (index < 0) return false;
      const expectedSession = sessionKey;
      requestAnimationFrame(() => {
        if (activeSessionRef.current !== expectedSession) return;
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
        setHighlightedMessageId(messageId);
        setTimeout(() => {
          if (activeSessionRef.current === expectedSession)
            setHighlightedMessageId((current) => (current === messageId ? null : current));
        }, 2_000);
      });
      return true;
    },
    [sessionKey],
  );

  const scrollToMessage = useCallback(
    async (messageId: number) => {
      if (revealMessage(messageId) || groupId <= 0) return;
      const expectedSession = sessionKey;
      try {
        const fetched = await getGroupMessageContext(groupId, messageId);
        if (activeSessionRef.current !== expectedSession) return;
        await saveGroupChatMessages(ownerId, groupId, fetched);
        if (activeSessionRef.current !== expectedSession) return;
        const context = filterLocallyHiddenChatMessages(
          filterClearedGroupMessages(fetched, historyWatermark),
          hiddenMessageIdsRef.current,
        );
        const merged = mergeMessages(messagesRef.current, ...context);
        messagesRef.current = merged;
        setMessages(merged);
        setTimeout(() => revealMessage(messageId), 0);
      } catch (nextError) {
        if (activeSessionRef.current !== expectedSession) return;
        Alert.alert(
          t("messages.loadFailed"),
          nextError instanceof Error ? nextError.message : t("common.operationFailed"),
        );
      }
    },
    [groupId, historyWatermark, ownerId, revealMessage, sessionKey, t],
  );

  useEffect(() => {
    const target = Number(params.messageId);
    if (
      initialPushMessageHandledRef.current === params.messageId ||
      isLoading ||
      !Number.isInteger(target) ||
      target <= 0
    )
      return;
    initialPushMessageHandledRef.current = params.messageId ?? null;
    void scrollToMessage(target);
  }, [isLoading, params.messageId, scrollToMessage]);

  useEffect(
    () => subscribeGroupMessageLocation(groupId, (messageId) => void scrollToMessage(messageId)),
    [groupId, scrollToMessage],
  );

  const selectionEntryFor = useCallback(
    (message: GroupMessage): ChatSelectionEntry | null => {
      if (groupId <= 0 || !ownerId || !isAvailableForGroupSelection(message)) return null;
      return {
        reference: chatMessageReference(ownerId, "group", String(groupId), message.id),
        message_id: message.id,
        descriptor: chatSelectionDescriptor(message),
      };
    },
    [groupId, ownerId],
  );

  const toggleMessageSelection = useCallback(
    (message: GroupMessage) => {
      const entry = selectionEntryFor(message);
      if (!entry) return;
      if (selectionEntries === null) {
        Keyboard.dismiss();
        setPanel(null);
        setFocused(false);
        setMenuTarget(null);
        setSelectionEntries([entry]);
        return;
      }
      const result = toggleChatSelection(selectionEntries, entry);
      if (!result.accepted) setToastMessage(t("selection.maximum99"));
      setSelectionEntries(result.entries);
    },
    [selectionEntries, selectionEntryFor, t],
  );

  const beginSelectedForward = (mode: Exclude<ForwardMode, "single">) => {
    if (!selectionEntries || groupId <= 0) return;
    if (!canForwardSelection(selectionEntries, mode)) {
      setToastMessage(
        t(mode === "individual" ? "forward.unsupportedIndividual" : "forward.unsupportedMerged"),
      );
      return;
    }
    const messagesById = new Map(visibleMessages.map((message) => [message.id, message]));
    const selectedMessages = selectionEntries.flatMap((entry) => {
      const message = messagesById.get(entry.message_id);
      return message ? [message] : [];
    });
    if (selectedMessages.length !== selectionEntries.length) {
      setToastMessage(t("selection.removedUnavailable"));
      return;
    }
    setForwardDraft({
      mode,
      sources: selectedMessages.map((message) => forwardSource("group", String(groupId), message)),
      preview: t(
        mode === "merged" ? "forward.chatRecordCount" : "forward.messageCount",
        selectedMessages.length,
      ),
    });
  };

  const requestSelectionForward = () => {
    Alert.alert(t("forward.chooseMode"), undefined, [
      { text: t("forward.individual"), onPress: () => beginSelectedForward("individual") },
      { text: t("forward.merged"), onPress: () => beginSelectedForward("merged") },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const requestSelectionDelete = () => {
    if (!selectionEntries || groupId <= 0 || !ownerId) return;
    const expectedSession = sessionKey;
    Alert.alert(
      t("selection.delete.title"),
      t("selection.delete.message", selectionEntries.length),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            const selectedIds = selectionEntries.map((entry) => entry.message_id);
            hiddenMessageIdsRef.current = new Set([...hiddenMessageIdsRef.current, ...selectedIds]);
            void hideChatMessagesLocally(ownerId, "group", String(groupId), selectedIds).then(
              (hidden) => {
                if (activeSessionRef.current === expectedSession)
                  hiddenMessageIdsRef.current = hidden;
              },
            );
            const selected = new Set(selectedIds);
            setMessages((current) => {
              const next = current.filter((message) => !selected.has(message.id));
              messagesRef.current = next;
              void publishGroupConversationPreviewUpdate({
                owner_id: ownerId,
                group_id: groupId,
                ...groupConversationPreviewFields(next, ownerId, t),
              });
              return next;
            });
            setReplyingTo((current) => (current && selected.has(current.id) ? null : current));
            setSelectionEntries(null);
          },
        },
      ],
    );
  };

  const openMessageMenu = useCallback(
    (message: GroupMessage, anchor: ChatMessageAnchor) => {
      const actions: ChatMessageMenuAction[] =
        message.delivery_status === "failed"
          ? [
              ...(message.msg_type === "text" && message.content.trim() ? ["copy" as const] : []),
              "retry",
              "delete",
            ]
          : message.delivery_status === "sending" || message.id <= 0
            ? []
            : actionsForChatMessage(message, {
                viewerId: user?.user_id,
                isChatMoney: parseChatMoneyPayload(message.content) !== null,
                isChatMoneyReceipt: normalizeChatMoneyReceipt(message.content) !== null,
                isCallRecord: parseChatCallRecord(message.content) !== null,
                forwardingEnabled: true,
                localDeleteEnabled: true,
                multiselectEnabled: true,
                recallEnabled: message.id > 0,
              });
      if (actions.length > 0) setMenuTarget({ message, anchor, actions });
    },
    [user?.user_id],
  );

  async function handleMenuAction(action: ChatMessageMenuAction) {
    const target = menuTarget;
    setMenuTarget(null);
    if (!target || groupId <= 0 || !user?.user_id) return;
    const expectedSession = sessionKey;
    const message = target.message;
    switch (action) {
      case "copy":
        await Clipboard.setStringAsync(message.content);
        return;
      case "retry":
        retryMessage(message);
        return;
      case "quote":
        setReplyingTo(message);
        setComposerFocusRequest((value) => value + 1);
        return;
      case "recall": {
        const editableText =
          message.msg_type === "text" && message.content.trim() ? message.content : null;
        try {
          const recalled = await recallGroupMessage(groupId, message.id);
          await saveGroupChatMessages(user.user_id, groupId, [recalled]);
          if (activeSessionRef.current !== expectedSession) return;
          setMessages((current) => {
            const merged = mergeMessages(current, recalled);
            messagesRef.current = merged;
            void publishGroupConversationPreviewUpdate({
              owner_id: user.user_id,
              group_id: groupId,
              ...groupConversationPreviewFields(merged, user.user_id, t),
            });
            return merged;
          });
          if (editableText)
            setRecalledEditableTexts((current) => ({ ...current, [message.id]: editableText }));
          setReplyingTo((current) => (current?.id === message.id ? null : current));
        } catch (nextError) {
          if (activeSessionRef.current !== expectedSession) return;
          Alert.alert(
            t("chat.recall.failed"),
            nextError instanceof Error ? nextError.message : t("common.operationFailed"),
          );
        }
        return;
      }
      case "save": {
        const result =
          message.msg_type === "video"
            ? await saveVideoToLibrary(message.content)
            : await saveImageToLibrary(message.content);
        if (activeSessionRef.current !== expectedSession) return;
        if (result === "permissionDenied") {
          Alert.alert(
            t(
              message.msg_type === "video"
                ? "media.videoPermissionRequired"
                : "media.photoPermissionRequired",
            ),
          );
        } else if (result !== "saved") Alert.alert(t("media.saveFailed"));
        return;
      }
      case "delete":
        if (message.client_message_id && message.delivery_status === "failed") {
          if (isImageMessage(message)) {
            await cancelChatImageUpload(user.user_id, message.client_message_id);
          } else if (isVideoMessage(message)) {
            await cancelChatVideoUpload(user.user_id, message.client_message_id);
          } else {
            await removeGroupChatOutboxJob(user.user_id, message.client_message_id);
          }
          if (activeSessionRef.current !== expectedSession) return;
        }
        if (message.id > 0) {
          hiddenMessageIdsRef.current.add(message.id);
          const hidden = await hideChatMessagesLocally(user.user_id, "group", String(groupId), [
            message.id,
          ]);
          if (activeSessionRef.current !== expectedSession) return;
          hiddenMessageIdsRef.current = hidden;
        }
        setMessages((current) => {
          const next = current.filter((item) => identity(item) !== identity(message));
          messagesRef.current = next;
          void publishGroupConversationPreviewUpdate({
            owner_id: user.user_id,
            group_id: groupId,
            ...groupConversationPreviewFields(next, user.user_id, t),
          });
          return next;
        });
        setReplyingTo((current) => (current?.id === message.id ? null : current));
        return;
      case "forward":
        setForwardDraft({
          mode: "single",
          sources: [forwardSource("group", String(groupId), message)],
          preview: chatForwardMessagePreview(message, t),
        });
        return;
      case "multiSelect":
        toggleMessageSelection(message);
        return;
    }
  }

  const chooseMedia = async (confirmedAssets?: ImagePickerAsset[]) => {
    const expectedSession = sessionKey;
    try {
      const assets = confirmedAssets ?? (await pickChatMedia());
      if (activeSessionRef.current !== expectedSession) return;
      setPanel(null);
      const supportedAssets = assets.filter(
        (asset) => asset.type === "image" || asset.type === "video",
      );
      if (!confirmedAssets) {
        if (supportedAssets.length > 0) setPendingMediaAssets(supportedAssets);
        return;
      }
      const now = Date.now();
      const jobs = supportedAssets.map((asset, index) => ({
        asset,
        index,
        type: asset.type === "video" ? ("video" as const) : ("image" as const),
        clientMessageId: makeClientMessageId(),
        createdAt: new Date(now + index).toISOString(),
      }));
      if (user?.user_id && jobs.length > 0) {
        setMessages((current) => {
          const merged = mergeMessages(
            current,
            ...jobs.map((job) => ({
              id: -(now + job.index + 1),
              group_id: groupId,
              sender_id: user.user_id,
              msg_type: job.type,
              content: job.asset.uri,
              ...(job.type === "image" ? { thumbnail_url: job.asset.uri } : {}),
              timestamp: job.createdAt,
              sender_nickname: user.nickname,
              sender_avatar: user.avatar_url,
              mention_all: false,
              client_message_id: job.clientMessageId,
              version: 1,
              delivery_status: "sending" as const,
            })),
          );
          messagesRef.current = merged;
          return merged;
        });
        for (const job of jobs) {
          const operation =
            job.type === "image"
              ? enqueueGroupChatImage({
                  owner: user,
                  targetId: String(groupId),
                  clientMessageId: job.clientMessageId,
                  createdAt: job.createdAt,
                  asset: {
                    uri: job.asset.uri,
                    width: job.asset.width,
                    height: job.asset.height,
                    filename: job.asset.fileName ?? `image_${job.index}.jpg`,
                  },
                })
              : enqueueGroupChatVideo({
                  owner: user,
                  targetId: String(groupId),
                  clientMessageId: job.clientMessageId,
                  createdAt: job.createdAt,
                  asset: {
                    uri: job.asset.uri,
                    width: job.asset.width,
                    height: job.asset.height,
                    filename: job.asset.fileName ?? `video_${job.index}.mp4`,
                    ...(job.asset.mimeType ? { mime_type: job.asset.mimeType } : {}),
                  },
                });
          void operation.catch((nextError) => {
            if (activeSessionRef.current !== expectedSession) return;
            setMessages((current) => {
              const next = current.map((message) =>
                message.client_message_id === job.clientMessageId
                  ? { ...message, delivery_status: "failed" as const }
                  : message,
              );
              messagesRef.current = next;
              return next;
            });
            Alert.alert(
              t(job.type === "image" ? "messages.imageSendFailed" : "messages.videoSendFailed"),
              nextError instanceof Error ? nextError.message : t("common.operationFailed"),
            );
          });
        }
      }
    } catch (nextError) {
      if (activeSessionRef.current !== expectedSession) return;
      Alert.alert(
        t("common.operationFailed"),
        nextError instanceof Error ? nextError.message : t("common.operationFailed"),
      );
    }
  };

  const imageUrls = useMemo(
    () => visibleMessages.filter(isImageMessage).map((message) => message.content),
    [visibleMessages],
  );
  const timelineLocator = resolveChatTimelineLocator({
    isNearBottom,
    mentionMessageIds: mentionLocatorMessageIds,
    newMessagesBelowCount,
    replyMessageIds: replyLocatorMessageIds,
  });

  const activateTimelineLocator = () => {
    if (timelineLocator?.kind === "mention") {
      const target = mentionLocatorMessageIds[0];
      if (target === undefined) return;
      setMentionLocatorMessageIds((current) => current.slice(1));
      void scrollToMessage(target);
      return;
    }
    if (timelineLocator?.kind === "reply") {
      const target = replyLocatorMessageIds[0];
      if (target === undefined) return;
      setReplyLocatorMessageIds((current) => current.slice(1));
      void scrollToMessage(target);
      return;
    }
    setNewMessagesBelowCount(0);
    setMentionLocatorMessageIds([]);
    setReplyLocatorMessageIds([]);
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    listRef.current?.scrollToOffset({ animated: true, offset: 0 });
  };

  const applyChatMoneyResult = (result: ChatMoneyActionResult) => {
    const expectedSession = sessionKey;
    if (activeSessionRef.current !== expectedSession || !ownerId || groupId <= 0) return;
    setMessages((current) => {
      const updated = current.map((message) => {
        const payload = parseChatMoneyPayload(message.content);
        return payload?.asset_id === result.payload.asset_id
          ? {
              ...message,
              content: encodeChatMoneyPayload(result.payload),
              version: Math.max(message.version, result.payload.version),
            }
          : message;
      });
      const next = result.group_receipt_message
        ? mergeMessages(updated, result.group_receipt_message)
        : updated;
      messagesRef.current = next;
      void saveGroupChatMessages(
        ownerId,
        groupId,
        next.filter((message) => message.id > 0),
      ).then(() =>
        publishGroupConversationPreviewUpdate({
          owner_id: ownerId,
          group_id: groupId,
          ...groupConversationPreviewFields(next, ownerId, t),
        }),
      );
      return next;
    });
  };

  return (
    <ChatKeyboardAvoidingView style={styles.screen}>
      <View style={styles.timelineSurface}>
        <ChatBackgroundLayer background={background} style={styles.backgroundLayer} />
        {error && visibleMessages.length === 0 && !isLoading ? (
          <View style={styles.blockingState}>
            <Text style={styles.stateText}>{error}</Text>
            <Pressable onPress={() => void load()} style={styles.retryButton}>
              <Text style={styles.retryText}>{t("common.retry")}</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            contentContainerStyle={styles.list}
            data={[...timeline].reverse()}
            inverted
            keyExtractor={({ message }) => identity(message)}
            keyboardDismissMode="interactive"
            ListFooterComponent={
              isLoading || isLoadingMore ? (
                <Text style={styles.loadingText}>{t("common.loading")}</Text>
              ) : null
            }
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.2}
            onScrollBeginDrag={() => {
              Keyboard.dismiss();
              setFocused(false);
              setPanel(null);
              setMenuTarget(null);
            }}
            onScroll={({ nativeEvent }) => {
              const nextNearBottom = nativeEvent.contentOffset.y <= 24;
              if (nextNearBottom !== isNearBottomRef.current) {
                isNearBottomRef.current = nextNearBottom;
                setIsNearBottom(nextNearBottom);
                if (nextNearBottom) {
                  setNewMessagesBelowCount(0);
                  setMentionLocatorMessageIds([]);
                  setReplyLocatorMessageIds([]);
                  const throughMessageId = maximumServerMessageId(messagesRef.current);
                  if (ownerId && throughMessageId !== undefined)
                    void markConversationRead(ownerId, "group", String(groupId), throughMessageId);
                }
              }
            }}
            onScrollToIndexFailed={({ index }) => {
              const expectedSession = sessionKey;
              setTimeout(() => {
                if (activeSessionRef.current === expectedSession)
                  listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
              }, 80);
            }}
            onTouchStart={() => {
              Keyboard.dismiss();
              setFocused(false);
              setPanel(null);
              setMenuTarget(null);
            }}
            renderItem={({ item }) => {
              const entry = selectionEntryFor(item.message);
              const rowView = (
                <GroupMessageRow
                  highlighted={highlightedMessageId === item.message.id}
                  isMine={item.message.sender_id === user?.user_id}
                  myAvatar={user?.avatar_url}
                  myId={user?.user_id}
                  imageUrls={imageUrls}
                  loadMoreGalleryImages={loadMoreGalleryImages}
                  onImageOpen={setImageSelection}
                  onVideoOpen={setPreviewVideoUrl}
                  messages={visibleMessages}
                  onMenuRequested={openMessageMenu}
                  onQuoteTap={(messageId) => void scrollToMessage(messageId)}
                  recalledEditableText={recalledEditableTexts[item.message.id]}
                  onReedit={(text) => {
                    setDraft(text);
                    setComposerFocusRequest((value) => value + 1);
                  }}
                  row={item}
                  onRetry={retryMessage}
                  onChatMoneyTap={(payload) =>
                    setMoneyDetail({ payload, isSender: payload.sender_id === user?.user_id })
                  }
                  onForwardBundleTap={(bundleId) =>
                    router.push({ pathname: "/forward-bundle/[id]", params: { id: bundleId } })
                  }
                  onMentionSender={(message) =>
                    insertMentions(
                      [
                        {
                          kind: "direct",
                          user_id: message.sender_id,
                          nickname: message.sender_nickname || message.sender_id,
                        },
                      ],
                      null,
                    )
                  }
                />
              );
              if (selectionEntries === null) return rowView;
              const selected = entry
                ? selectionEntries.some(
                    (selectedEntry) => selectedEntry.reference === entry.reference,
                  )
                : false;
              return (
                <Pressable disabled={!entry} onPress={() => toggleMessageSelection(item.message)}>
                  <View style={styles.selectionRow}>
                    {entry ? <ChatSelectionIndicator selected={selected} /> : null}
                    <View pointerEvents="none" style={styles.selectionRowContent}>
                      {rowView}
                    </View>
                  </View>
                </Pressable>
              );
            }}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
          />
        )}
        {timelineLocator ? (
          <View pointerEvents="box-none" style={styles.timelineLocatorHost}>
            <ChatTimelineLocatorButton kind={timelineLocator} onPress={activateTimelineLocator} />
          </View>
        ) : null}
      </View>
      {selectionEntries !== null ? (
        <ChatSelectionToolbar
          count={selectionEntries.length}
          onDelete={requestSelectionDelete}
          onForward={requestSelectionForward}
          showsForward
        />
      ) : (
        <>
          {replyingTo ? (
            <ChatReplyPreviewBar
              onCancel={() => setReplyingTo(null)}
              value={{
                senderName:
                  replyingTo.sender_id === user?.user_id
                    ? t("common.me")
                    : replyingTo.sender_nickname,
                content: replyingTo.content,
                msgType: replyingTo.msg_type,
              }}
            />
          ) : null}
          <Composer
            draft={draft}
            focusRequest={composerFocusRequest}
            isFocused={isFocused}
            panel={panel}
            onChooseMedia={() => void chooseMedia()}
            onChooseGift={() => {
              setPanel(null);
              setShowGiftSheet(true);
            }}
            onChooseMoney={(kind) => {
              setPanel(null);
              setMoneyComposerKind(kind);
            }}
            onChooseCall={(callType) => {
              setPanel(null);
              void call.startGroupCall({ groupId, groupName: groupTitle }, callType);
            }}
            onDraftChange={editDraft}
            onFocusChange={setFocused}
            onPanelChange={setPanel}
            onSelectionChange={setComposerSelection}
            onSend={() => void send()}
            onSendSticker={(pack, sticker) => void sendSticker(pack, sticker)}
            onVoiceRecorded={sendVoice}
            onVoiceRecordingStateChange={setVoiceRecordingState}
            selection={composerSelection}
          />
        </>
      )}
      <ImageGallery onClose={() => setImageSelection(null)} selection={imageSelection} />
      <VideoPlayerOverlay onClose={() => setPreviewVideoUrl(null)} videoUrl={previewVideoUrl} />
      <VoiceRecordingOverlay state={voiceRecordingState} />
      {groupId > 0 && user?.user_id ? (
        <ChatGiftPickerSheet
          onClose={() => setShowGiftSheet(false)}
          onOpenWallet={() => router.push("/wallet")}
          onSend={(gift, recipient) => sendGift(gift.gift_id, recipient.id)}
          onSendFailure={(message) => Alert.alert(t("gift.sendFailed"), message)}
          ownerId={user.user_id}
          source={giftRecipientSource}
          visible={showGiftSheet}
        />
      ) : null}
      {groupId > 0 && user?.user_id && moneyComposerKind ? (
        <ChatMoneyComposerModal
          kind={moneyComposerKind}
          onClose={() => setMoneyComposerKind(null)}
          onCreated={(result) => {
            const created = result.group_message;
            if (!created) return;
            const normalized = { ...created, group_id: groupId };
            void saveGroupChatMessages(ownerId, groupId, [normalized]).then(() =>
              publishLatestCachedGroupConversationPreview(ownerId, groupId, t),
            );
            if (activeSessionRef.current !== sessionKey) return;
            setMessages((current) => {
              const merged = mergeMessages(current, normalized);
              messagesRef.current = merged;
              return merged;
            });
          }}
          onOpenWallet={() => {
            setMoneyComposerKind(null);
            router.push("/wallet");
          }}
          ownerId={user.user_id}
          source={giftRecipientSource}
          visible
        />
      ) : null}
      {user?.user_id ? (
        <ChatMoneyDetailModal
          initialPayload={moneyDetail?.payload ?? null}
          isSender={moneyDetail?.isSender ?? false}
          onClose={() => setMoneyDetail(null)}
          onOpenBillDetails={() => {
            setMoneyDetail(null);
            setTimeout(() => router.push("/wallet-transactions"), 200);
          }}
          onOpenWallet={() => {
            setMoneyDetail(null);
            setTimeout(() => router.push("/wallet"), 200);
          }}
          onResult={applyChatMoneyResult}
          ownerAvatar={user.avatar_url}
          ownerId={user.user_id}
          ownerName={user.nickname}
          visible={moneyDetail !== null}
        />
      ) : null}
      <ForwardFlowModal
        mode={forwardDraft?.mode ?? "single"}
        onClose={() => setForwardDraft(null)}
        onCompleted={() => {
          setSelectionEntries(null);
          setToastMessage(t("forward.sent"));
        }}
        preview={forwardDraft?.preview ?? ""}
        sources={forwardDraft?.sources ?? []}
        visible={forwardDraft !== null}
      />
      <ChatMediaPickerPreview
        items={pendingMediaAssets}
        onCancel={() => setPendingMediaAssets([])}
        onChange={setPendingMediaAssets}
        onSend={(items) => void chooseMedia(items)}
        visible={pendingMediaAssets.length > 0}
      />
      {showMentionPicker ? (
        <ChatMentionPicker
          allowsMentionAll={allowsMentionAll}
          groupId={groupId}
          initialMembers={mentionCandidates}
          onClose={() => {
            setShowMentionPicker(false);
            setPendingMentionTriggerRange(null);
          }}
          onSelect={(selections) => insertMentions(selections)}
        />
      ) : null}
      <ChatMessageActionOverlay
        actions={menuTarget?.actions ?? []}
        anchor={menuTarget?.anchor ?? null}
        onDismiss={() => setMenuTarget(null)}
        onSelect={(action) => void handleMenuAction(action)}
      />
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </ChatKeyboardAvoidingView>
  );
}

function GroupMessageRow({
  row,
  highlighted,
  isMine,
  myAvatar,
  myId,
  imageUrls,
  loadMoreGalleryImages,
  onImageOpen,
  onVideoOpen,
  messages,
  onMenuRequested,
  onQuoteTap,
  recalledEditableText,
  onReedit,
  onRetry,
  onChatMoneyTap,
  onForwardBundleTap,
  onMentionSender,
}: {
  row: TimelineRow;
  highlighted: boolean;
  isMine: boolean;
  myAvatar: string | undefined;
  myId: string | undefined;
  imageUrls: string[];
  loadMoreGalleryImages: () => Promise<string[]>;
  onImageOpen: (selection: ImageGallerySelection) => void;
  onVideoOpen: (url: string) => void;
  messages: GroupMessage[];
  onMenuRequested: (message: GroupMessage, anchor: ChatMessageAnchor) => void;
  onQuoteTap: (messageId: number) => void;
  recalledEditableText: string | undefined;
  onReedit: (text: string) => void;
  onRetry: (message: GroupMessage) => void;
  onChatMoneyTap: (payload: ChatMoneyPayload) => void;
  onForwardBundleTap: (bundleId: string) => void;
  onMentionSender: (message: GroupMessage) => void;
}) {
  const { t } = useLocalization();
  const message = row.message;
  if (isRecalledChatMessage(message)) {
    return (
      <View>
        {row.showsTime ? <TimeSeparator timestamp={message.timestamp} /> : null}
        <ChatRecalledMessageTip
          canReedit={isMine && recalledEditableText !== undefined}
          notice={chatRecallNotice(message.sender_id, myId, message.sender_nickname, t)}
          onReedit={() => recalledEditableText !== undefined && onReedit(recalledEditableText)}
        />
      </View>
    );
  }
  const moneyReceipt = normalizeChatMoneyReceipt(message.content);
  if (moneyReceipt) {
    return (
      <View>
        {row.showsTime ? <TimeSeparator timestamp={message.timestamp} /> : null}
        <ChatMoneyReceiptTip content={message.content} viewerId={myId} />
      </View>
    );
  }
  if (message.msg_type === "system") {
    return (
      <View>
        {row.showsTime ? <TimeSeparator timestamp={message.timestamp} /> : null}
        <View style={styles.systemRow}>
          <Text style={styles.systemText}>{message.content}</Text>
        </View>
      </View>
    );
  }
  const resolvedReply = resolveGroupReply(message, messages);
  const quotedSource = resolvedReply
    ? messages.find((item) => item.id === resolvedReply.id)
    : undefined;
  const cachedSender = peekCachedUserInfo(message.sender_id);
  const senderName = message.sender_nickname || cachedSender?.nickname || message.sender_id;
  const senderAvatar = message.sender_avatar || cachedSender?.avatar_url || "";
  return (
    <View>
      {row.showsTime ? <TimeSeparator timestamp={message.timestamp} /> : null}
      <ChatMessageHighlightSurface active={highlighted} style={styles.messageRow}>
        {isMine ? (
          <View style={styles.rowSpacer} />
        ) : (
          <UserAvatarButton
            accessibilityName={senderName}
            avatarUrl={senderAvatar}
            onLongPress={() => onMentionSender(message)}
            size={36}
            userId={message.sender_id}
          />
        )}
        <View style={[styles.messageColumn, isMine && styles.mineColumn]}>
          {!isMine ? (
            <Pressable onPress={() => onMentionSender(message)}>
              <Text style={styles.senderName}>{senderName}</Text>
            </Pressable>
          ) : null}
          {resolvedReply ? (
            <ChatQuotedMessageView
              isFromMe={isMine}
              onPress={() => onQuoteTap(resolvedReply.id)}
              value={{
                senderName:
                  resolvedReply.sender_id === myId
                    ? t("common.me")
                    : quotedSource?.sender_nickname ||
                      peekCachedUserInfo(resolvedReply.sender_id)?.nickname ||
                      resolvedReply.sender_id,
                content: resolvedReply.content,
                msgType: resolvedReply.msg_type,
              }}
            />
          ) : null}
          <View style={styles.messageContentRow}>
            <ChatMessageDeliveryStatus
              deliveryStatus={message.delivery_status}
              messageType={message.msg_type}
              onRetry={() => onRetry(message)}
            />
            <ChatMessageLongPressSurface
              disabled={parseChatCallRecord(message.content) !== null}
              onLongPress={(anchor) => onMenuRequested(message, anchor)}
            >
              <MessageContent
                imageUrls={imageUrls}
                isMine={isMine}
                loadMoreGalleryImages={loadMoreGalleryImages}
                message={message}
                myAvatar={myAvatar}
                myId={myId}
                onChatMoneyTap={onChatMoneyTap}
                onForwardBundleTap={onForwardBundleTap}
                onImageOpen={onImageOpen}
                onVideoOpen={onVideoOpen}
              />
            </ChatMessageLongPressSurface>
          </View>
        </View>
        {isMine ? (
          <UserAvatarButton
            accessibilityName={t("common.me")}
            avatarUrl={myAvatar}
            size={36}
            userId={myId ?? message.sender_id}
          />
        ) : (
          <View style={styles.rowSpacer} />
        )}
      </ChatMessageHighlightSurface>
    </View>
  );
}

function MessageContent({
  message,
  isMine,
  imageUrls,
  loadMoreGalleryImages,
  onImageOpen,
  onVideoOpen,
  onChatMoneyTap,
  onForwardBundleTap,
  myAvatar,
  myId,
}: {
  message: GroupMessage;
  isMine: boolean;
  imageUrls: string[];
  loadMoreGalleryImages: () => Promise<string[]>;
  onImageOpen: (selection: ImageGallerySelection) => void;
  onVideoOpen: (url: string) => void;
  onChatMoneyTap: (payload: ChatMoneyPayload) => void;
  onForwardBundleTap: (bundleId: string) => void;
  myAvatar?: string | undefined;
  myId?: string | undefined;
}) {
  const { t } = useLocalization();
  const canActivate = useChatMessageActivationGuard();
  const type = message.msg_type.toLocaleLowerCase();
  const forwardBundle = parseForwardBundleMessage(message.content, type);
  if (forwardBundle) {
    return (
      <ForwardBundleMessageCard
        isFromMe={isMine}
        onPress={() => {
          if (canActivate()) onForwardBundleTap(forwardBundle.bundle_id);
        }}
        payload={forwardBundle}
      />
    );
  }
  if (type === "image") {
    return (
      <ChatImageBubble
        imageUrls={imageUrls}
        index={Math.max(0, imageUrls.indexOf(message.content))}
        loadMoreOlder={loadMoreGalleryImages}
        messageId={identity(message)}
        onOpen={onImageOpen}
        thumbnailUrl={message.thumbnail_url}
        url={message.content}
      />
    );
  }
  if (type === "video") {
    return (
      <ChatVideoBubble
        onOpen={onVideoOpen}
        thumbnailUrl={message.thumbnail_url}
        url={message.content}
      />
    );
  }
  if (type === "voice") {
    return (
      <ChatVoiceBubble
        content={message.content}
        isFromMe={isMine}
        isPending={isMine && isPendingChatVoice(message.delivery_status)}
      />
    );
  }
  const moneyPayload =
    type === "red_packet" || type === "transfer" ? parseChatMoneyPayload(message.content) : null;
  if (moneyPayload) {
    return (
      <ChatMoneyBubble
        isFromMe={isMine}
        onPress={() => onChatMoneyTap(moneyPayload)}
        payload={moneyPayload}
        viewerId={myId}
      />
    );
  }
  if (type === "sticker") {
    return <ChatStickerBubble content={message.content} isFromMe={isMine} />;
  }
  const giftPayload = parseGiftMessagePayload(message.content);
  if (giftPayload) {
    return (
      <ChatGiftBubble
        isFromMe={isMine}
        payload={giftPayload}
        recipientAvatarFallback={giftPayload.recipient_id === myId ? myAvatar : undefined}
        recipientFallback={t("group.member")}
      />
    );
  }
  const callRecord = parseChatCallRecord(message.content);
  if (callRecord) {
    return <ChatCallRecordBubble isFromMe={isMine} record={callRecord} />;
  }
  const content =
    type === "text"
      ? message.content.replace(/[\r\n]+$/gu, "")
      : mediaPreview(type, message.content, t);
  if (isMine) {
    return (
      <LinearGradient
        colors={[colors.accent, colors.accentDark]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={[styles.bubble, styles.mineBubble]}
      >
        {type !== "text" ? <MediaSymbol type={type} mine /> : null}
        <Text style={styles.mineText}>{content}</Text>
      </LinearGradient>
    );
  }
  return (
    <View style={[styles.bubble, styles.otherBubble]}>
      {type !== "text" ? <MediaSymbol type={type} /> : null}
      <Text style={styles.otherText}>{content}</Text>
    </View>
  );
}

function MediaSymbol({ type, mine = false }: { type: string; mine?: boolean }) {
  const symbols: Record<string, SFSymbol> = {
    image: "photo",
    video: "video.fill",
    voice: "waveform",
    sticker: "face.smiling",
    gift: "gift.fill",
  };
  return (
    <SymbolView
      name={symbols[type] ?? "ellipsis.bubble"}
      size={20}
      tintColor={mine ? colors.white : colors.text}
    />
  );
}

function TimeSeparator({ timestamp }: { timestamp: string }) {
  const { t } = useLocalization();
  return (
    <View style={styles.timeRow}>
      <Text style={styles.timeText}>{formatSeparator(timestamp, t("time.yesterday"))}</Text>
    </View>
  );
}

function Composer({
  draft,
  focusRequest,
  isFocused,
  panel,
  onChooseMedia,
  onChooseGift,
  onChooseMoney,
  onChooseCall,
  onDraftChange,
  onFocusChange,
  onPanelChange,
  onSelectionChange,
  onSend,
  onSendSticker,
  onVoiceRecorded,
  onVoiceRecordingStateChange,
  selection,
}: {
  draft: string;
  focusRequest: number;
  isFocused: boolean;
  panel: "stickers" | "plus" | null;
  onChooseMedia: () => void;
  onChooseGift: () => void;
  onChooseMoney: (kind: ChatMoneyKind) => void;
  onChooseCall: (callType: CallType) => void;
  onDraftChange: (text: string) => void;
  onFocusChange: (focused: boolean) => void;
  onPanelChange: (panel: "stickers" | "plus" | null) => void;
  onSelectionChange: (selection: ChatTextRange) => void;
  onSend: () => void;
  onSendSticker: (pack: ChatStickerPack, sticker: ChatStickerItem) => void;
  onVoiceRecorded: (recording: ChatVoiceRecording) => void | Promise<void>;
  onVoiceRecordingStateChange: (state: VoiceRecordingVisualState | null) => void;
  selection: ChatTextRange;
}) {
  const { t } = useLocalization();
  const safeAreaInsets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const selectionRef = useRef<ComposerTextSelection>({ start: draft.length, end: draft.length });
  const composerDraftRef = useRef<string | null>(null);
  const initialInputHeight = chatComposerInputHeight(draft);
  useEffect(() => {
    if (composerDraftRef.current !== draft) {
      selectionRef.current = {
        start: selection.location,
        end: selection.location + selection.length,
      };
    }
    composerDraftRef.current = null;
  }, [draft, selection]);
  useEffect(() => {
    if (focusRequest <= 0) return;
    requestAnimationFrame(() => {
      setIsVoiceMode(false);
      inputRef.current?.focus();
    });
  }, [focusRequest]);
  const canSend = draft.trim().length > 0;
  const showsMic = !isVoiceMode && !isFocused && !panel && !draft;
  return (
    <View style={styles.composerSurface}>
      <ChatComposerSurfaceBackground showsStickerPanel={panel === "stickers"} />
      <View
        style={[
          styles.composerRow,
          { paddingBottom: isFocused || panel ? 5 : 12 + safeAreaInsets.bottom },
        ]}
      >
        {isVoiceMode ? (
          <ChatVoiceComposer
            onError={(message) => Alert.alert(t("messages.voiceSendFailed"), message)}
            onExitVoiceMode={() => {
              setIsVoiceMode(false);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            onRecorded={onVoiceRecorded}
            onRecordingStateChange={onVoiceRecordingStateChange}
          />
        ) : (
          <View style={styles.inputChrome}>
            {showsMic ? (
              <Pressable
                accessibilityLabel={t("chat.voiceInput")}
                onPress={() => {
                  onPanelChange(null);
                  onFocusChange(false);
                  setIsVoiceMode(true);
                }}
                style={styles.inlineMic}
              >
                <SymbolView name="mic.fill" size={20} weight="medium" tintColor={colors.accent} />
              </Pressable>
            ) : null}
            <TextInput
              ref={inputRef}
              maxLength={4_000}
              multiline
              onBlur={() => onFocusChange(false)}
              onChangeText={(value) => {
                composerDraftRef.current = value;
                onDraftChange(value);
              }}
              onFocus={() => {
                onPanelChange(null);
                onFocusChange(true);
              }}
              onSelectionChange={({ nativeEvent }) => {
                selectionRef.current = nativeEvent.selection;
                onSelectionChange({
                  location: nativeEvent.selection.start,
                  length: nativeEvent.selection.end - nativeEvent.selection.start,
                });
              }}
              onSubmitEditing={onSend}
              placeholder={t("chat.input.placeholder")}
              placeholderTextColor={colors.tertiaryText}
              returnKeyType="send"
              submitBehavior="submit"
              selection={{ start: selection.location, end: selection.location + selection.length }}
              style={[
                styles.composerInput,
                initialInputHeight !== undefined && { height: initialInputHeight },
                showsMic && styles.inputWithMic,
              ]}
              value={draft}
            />
          </View>
        )}
        {!isVoiceMode ? (
          <ChatComposerPanelToggleButton
            accessibilityLabel={t("chat.stickers")}
            activeSystemName="face.smiling.fill"
            inactiveSystemName="face.smiling"
            isActive={panel === "stickers"}
            onPress={() => {
              const next = panel === "stickers" ? null : "stickers";
              if (next) {
                inputRef.current?.blur();
                onFocusChange(false);
              }
              onPanelChange(next);
            }}
          />
        ) : null}
        {!isVoiceMode && canSend ? (
          <Pressable onPress={onSend} style={styles.iconButton}>
            <LinearGradient
              colors={[colors.accent, colors.accentDark]}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={styles.sendCircle}
            >
              <SymbolView name="arrow.up" size={15} weight="bold" tintColor={colors.white} />
            </LinearGradient>
          </Pressable>
        ) : !isVoiceMode ? (
          <ChatComposerPanelToggleButton
            accessibilityLabel={t("accessibility.moreActions")}
            activeSystemName="xmark.circle.fill"
            inactiveSystemName="plus.circle.fill"
            isActive={panel === "plus"}
            onPress={() => {
              const next = panel === "plus" ? null : "plus";
              if (next) {
                inputRef.current?.blur();
                onFocusChange(false);
              }
              onPanelChange(next);
            }}
          />
        ) : null}
      </View>
      <ChatComposerPanelHost
        panel={panel}
        plusItemCount={6}
        plusPanel={
          <PlusPanel
            onChooseCall={onChooseCall}
            onChooseGift={onChooseGift}
            onChooseMedia={onChooseMedia}
            onChooseMoney={onChooseMoney}
          />
        }
        stickerPanel={
          <ChatStickerPanel
            onInsertEmoji={(value) => {
              const inserted = insertChatComposerText(draft, selectionRef.current, value);
              selectionRef.current = inserted.selection;
              composerDraftRef.current = inserted.text;
              onDraftChange(inserted.text);
              onSelectionChange({
                location: inserted.selection.start,
                length: inserted.selection.end - inserted.selection.start,
              });
              requestAnimationFrame(() =>
                inputRef.current?.setNativeProps({ selection: inserted.selection }),
              );
            }}
            onSendSticker={onSendSticker}
          />
        }
      />
    </View>
  );
}

function PlusPanel({
  onChooseMedia,
  onChooseGift,
  onChooseMoney,
  onChooseCall,
}: {
  onChooseMedia: () => void;
  onChooseGift: () => void;
  onChooseMoney: (kind: ChatMoneyKind) => void;
  onChooseCall: (callType: CallType) => void;
}) {
  const { t } = useLocalization();
  const [panelWidth, setPanelWidth] = useState(0);
  const itemWidth = chatComposerPlusItemWidth(panelWidth);
  const items: {
    title: string;
    symbol?: SFSymbol;
    moneyKind?: ChatMoneyKind;
    action?: () => void;
  }[] = [
    { title: t("chat.album"), symbol: "photo", action: onChooseMedia },
    { title: t("gift.title"), symbol: "gift.fill", action: onChooseGift },
    {
      title: t("chatMoney.redPacket"),
      moneyKind: "red_packet",
      action: () => onChooseMoney("red_packet"),
    },
    {
      title: t("chatMoney.transfer"),
      moneyKind: "transfer",
      action: () => onChooseMoney("transfer"),
    },
    { title: t("call.voice"), symbol: "phone.fill", action: () => onChooseCall("voice") },
    { title: t("call.video"), symbol: "video.fill", action: () => onChooseCall("video") },
  ];
  return (
    <View
      onLayout={({ nativeEvent }) => setPanelWidth(nativeEvent.layout.width)}
      style={styles.plusPanel}
    >
      {items.map((item) => (
        <Pressable
          key={item.title}
          onPress={item.action}
          style={[styles.plusTile, { width: itemWidth }]}
        >
          <View style={styles.plusIcon}>
            {item.moneyKind ? (
              <ChatMoneyPlusMenuGlyph kind={item.moneyKind} />
            ) : (
              <SymbolView name={item.symbol!} size={22} tintColor={colors.text} />
            )}
          </View>
          <Text style={styles.plusTitle}>{item.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function makeTimeline(messages: GroupMessage[]): TimelineRow[] {
  const sorted = [...messages].sort(compareMessages);
  return sorted.map((message, index) => ({
    message,
    showsTime: shouldShowTime(message.timestamp, sorted[index - 1]?.timestamp),
  }));
}

function mergeMessages(current: GroupMessage[], ...incoming: GroupMessage[]): GroupMessage[] {
  const next = [...current];
  for (const message of incoming) {
    const matchingIndices = next.flatMap((candidate, index) =>
      identity(candidate) === identity(message) ||
      (candidate.id > 0 && message.id > 0 && candidate.id === message.id)
        ? [index]
        : [],
    );
    if (matchingIndices.length === 0) {
      next.push(message);
      continue;
    }
    const existing = matchingIndices
      .map((index) => next[index]!)
      .sort((left, right) => right.version - left.version)[0]!;
    const newest = message.version < existing.version ? existing : message;
    const stableClientMessageId =
      newest.client_message_id ??
      matchingIndices.map((index) => next[index]!.client_message_id).find(Boolean);
    const replacement = {
      ...newest,
      ...(stableClientMessageId ? { client_message_id: stableClientMessageId } : {}),
    };
    const keepIndex = matchingIndices[0]!;
    next[keepIndex] = replacement;
    for (const index of matchingIndices.slice(1).reverse()) next.splice(index, 1);
  }
  return next.sort(compareMessages);
}

function identity(message: GroupMessage): string {
  return message.client_message_id ? `client:${message.client_message_id}` : `server:${message.id}`;
}

function compareMessages(left: GroupMessage, right: GroupMessage): number {
  const difference = timestampValue(left.timestamp) - timestampValue(right.timestamp);
  return difference !== 0 ? difference : left.id - right.id;
}

function minimumServerMessageId(messages: readonly GroupMessage[]): number | undefined {
  const ids = messages.flatMap((message) => (message.id > 0 ? [message.id] : []));
  return ids.length > 0 ? Math.min(...ids) : undefined;
}

function maximumServerMessageId(messages: readonly GroupMessage[]): number | undefined {
  const ids = messages.flatMap((message) => (message.id > 0 ? [message.id] : []));
  return ids.length > 0 ? Math.max(...ids) : undefined;
}

function shouldShowTime(current: string, previous?: string): boolean {
  if (!previous) return true;
  const currentValue = timestampValue(current);
  const previousValue = timestampValue(previous);
  return Number.isFinite(currentValue) && Number.isFinite(previousValue)
    ? currentValue - previousValue >= 120_000
    : false;
}

function timestampValue(value: string): number {
  return Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

function groupChatSessionKey(ownerId: string, groupId: number): string {
  const owner = ownerId.trim();
  return owner && Number.isSafeInteger(groupId) && groupId > 0
    ? `${encodeURIComponent(owner)}:group:${groupId}`
    : "";
}

function formatSeparator(value: string, yesterdayLabel: string): string {
  const date = new Date(timestampValue(value));
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (date.toDateString() === today.toDateString()) return time;
  if (date.toDateString() === yesterday.toDateString()) return `${yesterdayLabel} ${time}`;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function makeClientMessageId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function mediaPreview(
  type: string,
  content: string,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  switch (type) {
    case "image":
      return t("message.image");
    case "video":
      return t("message.video");
    case "voice":
      return t("message.voice");
    case "gift":
      return t("message.giftWithName", "").trim();
    case "sticker":
      return t("message.sticker");
    default:
      return content;
  }
}

function isImageMessage(message: GroupMessage): boolean {
  return message.msg_type.toLocaleLowerCase() === "image" && message.content.trim().length > 0;
}

function isVideoMessage(message: GroupMessage): boolean {
  return message.msg_type.toLocaleLowerCase() === "video" && message.content.trim().length > 0;
}

function isVoiceMessage(message: GroupMessage): boolean {
  return message.msg_type.toLocaleLowerCase() === "voice" && message.content.trim().length > 0;
}

function isAvailableForGroupSelection(message: GroupMessage): boolean {
  return (
    parseChatCallRecord(message.content) === null &&
    isSelectableChatMessage(message, normalizeChatMoneyReceipt(message.content) !== null)
  );
}

function groupDraftQuote(
  message: GroupMessage,
  viewerId: string | undefined,
  selfName: string,
): ChatDraftQuote {
  const cached = peekCachedUserInfo(message.sender_id);
  return {
    message_id: message.id,
    sender_id: message.sender_id,
    sender_name:
      message.sender_id === viewerId
        ? selfName
        : message.sender_nickname || cached?.nickname || message.sender_id,
    msg_type: message.msg_type,
    content: message.content,
    timestamp: message.timestamp,
  };
}

function groupConversationPreviewFields(
  messages: readonly GroupMessage[],
  viewerId: string,
  t: (key: string, ...args: (string | number)[]) => string,
): { last_message?: string; last_message_time?: string; last_message_id?: number } {
  const latest = [...messages]
    .filter((message) => message.id > 0)
    .sort(compareMessages)
    .at(-1);
  if (!latest) return {};
  const type = latest.msg_type.toLocaleLowerCase();
  const lastMessage = isRecalledChatMessage(latest)
    ? chatRecallNotice(latest.sender_id, viewerId, latest.sender_nickname, t)
    : type === "image"
      ? t("message.image")
      : type === "video"
        ? t("message.video")
        : type === "voice"
          ? t("message.voice")
          : type === "sticker"
            ? t("message.sticker")
            : latest.content;
  return {
    last_message: lastMessage,
    last_message_time: latest.timestamp,
    last_message_id: latest.id,
  };
}

async function publishLatestCachedGroupConversationPreview(
  ownerId: string,
  groupId: number,
  t: (key: string, ...args: (string | number)[]) => string,
): Promise<void> {
  const cached = await readGroupChatCachedPage(ownerId, groupId);
  await publishGroupConversationPreviewUpdate({
    owner_id: ownerId,
    group_id: groupId,
    ...groupConversationPreviewFields(cached.messages, ownerId, t),
  });
}

function groupMessageFromDraftQuote(quote: ChatDraftQuote, groupId: number): GroupMessage {
  return {
    id: quote.message_id,
    group_id: groupId,
    sender_id: quote.sender_id,
    msg_type: quote.msg_type,
    content: quote.content,
    timestamp: quote.timestamp,
    sender_nickname: quote.sender_name,
    sender_avatar: "",
    mention_all: false,
    version: 1,
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  timelineSurface: { flex: 1 },
  backgroundLayer: { position: "absolute", inset: 0 },
  list: { paddingHorizontal: 12, paddingVertical: 8, rowGap: 4 },
  blockingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    rowGap: 14,
    padding: 24,
  },
  stateText: { color: colors.secondaryText, fontSize: 14, textAlign: "center" },
  retryButton: {
    minHeight: 36,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  retryText: { color: colors.white, fontSize: 14, fontWeight: "600" },
  loadingText: { padding: 16, color: colors.secondaryText, textAlign: "center" },
  selectionRow: { width: "100%", flexDirection: "row", alignItems: "center", columnGap: 4 },
  selectionRowContent: { flex: 1 },
  messageRow: {
    minWidth: "100%",
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 8,
  },
  timelineLocatorHost: { bottom: 14, position: "absolute", right: 12 },
  rowSpacer: { flex: 1, minWidth: 40 },
  messageColumn: { maxWidth: "72%", alignItems: "flex-start", rowGap: 3 },
  mineColumn: { alignItems: "flex-end" },
  messageContentRow: { alignItems: "center", columnGap: 6, flexDirection: "row" },
  senderName: { color: colors.secondaryText, fontSize: 12 },
  bubble: {
    maxWidth: "100%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
  },
  mineBubble: { borderBottomRightRadius: 0 },
  otherBubble: { borderBottomLeftRadius: 0, backgroundColor: colors.card },
  mineText: { color: colors.white, fontSize: 16, lineHeight: 21 },
  otherText: { color: colors.text, fontSize: 16, lineHeight: 21 },
  timeRow: { width: "100%", paddingVertical: 6, alignItems: "center" },
  timeText: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: "rgba(240,240,245,0.6)",
    color: colors.secondaryText,
    fontSize: 12,
  },
  systemRow: { width: "100%", paddingVertical: 4, alignItems: "center" },
  systemText: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    overflow: "hidden",
    borderRadius: 10,
    backgroundColor: "rgba(240,240,245,0.5)",
    color: colors.secondaryText,
    fontSize: 12,
  },
  composerSurface: { backgroundColor: "rgba(255,255,255,0.96)" },
  composerRow: {
    paddingHorizontal: 10,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
  },
  inputChrome: {
    flex: 1,
    minHeight: 54,
    maxHeight: 134,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.85)",
    backgroundColor: "rgba(255,255,255,0.92)",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    justifyContent: "center",
  },
  composerInput: {
    minHeight: 40,
    maxHeight: 120,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 16,
  },
  inputWithMic: { paddingLeft: 34 },
  inlineMic: {
    position: "absolute",
    left: 13,
    top: 7,
    zIndex: 2,
    width: 34,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButton: { width: 42, height: 54, alignItems: "center", justifyContent: "center" },
  sendCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  plusPanel: {
    paddingVertical: 16,
    columnGap: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 18,
  },
  plusTile: { height: 76, alignItems: "center", rowGap: 6 },
  plusIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5E5EA",
  },
  plusTitle: { color: colors.secondaryText, fontSize: 11 },
});
