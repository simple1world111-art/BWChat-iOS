import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
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
  getMessages,
  getMessageContext,
  recallDirectMessage,
  sendDirectGiftMessage,
  sendDirectStickerMessage,
  sendDirectVoiceMessage,
  sendTextMessage,
} from "@/api/bwchat";
import { UserAvatarButton } from "@/components/Avatar";
import { TopToast } from "@/components/TopToast";
import { ChatBackgroundLayer } from "@/components/chat/ChatBackgroundLayer";
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
import {
  ChatMoneyComposerModal,
  type ChatMoneyOptimisticCreation,
} from "@/components/messages/ChatMoneyComposerViews";
import { ChatMoneyDetailModal } from "@/components/messages/ChatMoneyDetailViews";
import {
  ChatMoneyBubble,
  ChatMoneyReceiptTip,
  ChatMoneyPlusMenuGlyph,
} from "@/components/messages/ChatMoneyViews";
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
  GiftCatalogItem,
  GiftRecipient,
  Message,
} from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useCall } from "@/providers/CallProvider";
import { useChatAppearance } from "@/providers/ChatAppearanceProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { markConversationRead } from "@/services/conversations/ConversationReadService";
import { publishDirectConversationPreviewUpdate } from "@/services/conversations/ConversationRepository";
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
  directOptimisticImageMessage,
  enqueueDirectChatImage,
  resumeChatImageUploads,
  retryChatImageUpload,
  subscribeChatImageOutbox,
} from "@/services/messages/ChatImageOutbox";
import {
  cancelChatVideoUpload,
  directOptimisticVideoMessage,
  enqueueDirectChatVideo,
  resumeChatVideoUploads,
  retryChatVideoUpload,
  subscribeChatVideoOutbox,
} from "@/services/messages/ChatVideoOutbox";
import {
  directChatHistoryPolicy,
  isDirectChatHistoryBackfilled,
  markDirectChatHistoryBackfilled,
  pruneDirectChatCachedMessagesThrough,
  readDirectChatCachedPage,
  saveDirectChatMessages,
} from "@/services/messages/DirectChatHistoryRepository";
import {
  createDirectChatOutboxJob,
  directChatOutboxFailure,
  directOptimisticOutboxMessage,
  queuedDirectChatOutboxJob,
  readDirectChatOutboxJob,
  readDirectChatOutboxJobs,
  removeDirectChatOutboxJob,
  saveDirectChatOutboxJob,
  sendingDirectChatOutboxJob,
  type DirectChatOutboxJob,
} from "@/services/messages/DirectChatOutboxRepository";
import {
  filterClearedDirectMessages,
  readDirectHistoryClearWatermark,
  subscribeDirectHistoryClear,
} from "@/services/messages/DirectHistoryClearRepository";
import { pickChatMedia } from "@/services/native/NativeCapabilities";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";
import { parseChatVoiceContent } from "@/services/messages/chatVoicePolicy";
import {
  completeGiftIdempotency,
  encodeGiftMessagePayload,
  giftIdempotencyKey,
  makeGiftMessagePayload,
  parseGiftMessagePayload,
  withGiftMessageRecipient,
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
  resolveDirectReply,
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
import { saveImageToLibrary, saveVideoToLibrary } from "@/services/media/MediaLibrarySaver";
import { colors } from "@/theme";

interface TimelineRow {
  message: Message;
  showsTime: boolean;
}

interface DirectMenuTarget {
  message: Message;
  anchor: ChatMessageAnchor;
  actions: ChatMessageMenuAction[];
}

interface ForwardDraft {
  mode: ForwardMode;
  sources: ForwardMessageSource[];
  preview: string;
}

export default function ChatScreen() {
  const { id, name, avatar, messageId } = useLocalSearchParams<{
    id: string;
    name?: string;
    avatar?: string;
    messageId?: string;
  }>();
  const navigation = useNavigation();
  const { user } = useAuth();
  const call = useCall();
  const ownerId = user?.user_id ?? "";
  const sessionKey = directChatSessionKey(ownerId, id);
  const { t } = useLocalization();
  const appearance = useChatAppearance();
  const [messages, setMessages] = useState<Message[]>([]);
  const [renderSessionKey, setRenderSessionKey] = useState(sessionKey);
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [menuTarget, setMenuTarget] = useState<DirectMenuTarget | null>(null);
  const [recalledEditableTexts, setRecalledEditableTexts] = useState<Record<number, string>>({});
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const [newMessagesBelowCount, setNewMessagesBelowCount] = useState(0);
  const [replyLocatorMessageIds, setReplyLocatorMessageIds] = useState<number[]>([]);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [isInputFocused, setInputFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [clearThroughMessageId, setClearThroughMessageId] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<"stickers" | "plus" | null>(null);
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
    senderName?: string | undefined;
    senderAvatar?: string | undefined;
  } | null>(null);
  const [selectionEntries, setSelectionEntries] = useState<ChatSelectionEntry[] | null>(null);
  const [forwardDraft, setForwardDraft] = useState<ForwardDraft | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const listRef = useRef<FlatList<TimelineRow>>(null);
  const hiddenMessageIdsRef = useRef<Set<number>>(new Set());
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const screenActiveRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const initialPushMessageHandledRef = useRef<string | null>(null);
  const activeSessionRef = useRef(sessionKey);
  const syncAttemptRef = useRef(0);
  const outboxTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const outboxInFlightRef = useRef(new Set<string>());
  const draftSnapshotsRef = useRef(new Map<string, ChatDraftSnapshot>());
  activeSessionRef.current = sessionKey;
  if (sessionKey) {
    draftSnapshotsRef.current.set(sessionKey, {
      text: draft,
      ...(replyingTo
        ? { quote: directDraftQuote(replyingTo, user?.user_id, name, t("common.me")) }
        : {}),
    });
  }

  const visibleMessages = useMemo(
    () => (renderSessionKey === sessionKey ? messages : []),
    [messages, renderSessionKey, sessionKey],
  );

  useLayoutEffect(() => {
    syncAttemptRef.current += 1;
    for (const timer of outboxTimersRef.current.values()) clearTimeout(timer);
    outboxTimersRef.current.clear();
    messagesRef.current = [];
    hiddenMessageIdsRef.current = new Set();
    hasMoreRef.current = false;
    loadingMoreRef.current = false;
    initialPushMessageHandledRef.current = null;
    // Route identity changes require one atomic pre-paint reset; async callbacks
    // are additionally fenced by `activeSessionRef` below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages([]);
    setRenderSessionKey(sessionKey);
    setDraft("");
    setReplyingTo(null);
    setMenuTarget(null);
    setRecalledEditableTexts({});
    setHighlightedMessageId(null);
    setNewMessagesBelowCount(0);
    setReplyLocatorMessageIds([]);
    setIsNearBottom(true);
    setIsLoading(Boolean(sessionKey));
    setIsLoadingMore(false);
    setHasMore(false);
    setClearThroughMessageId(-1);
    setError(null);
    setActivePanel(null);
    setImageSelection(null);
    setPreviewVideoUrl(null);
    setVoiceRecordingState(null);
    setShowGiftSheet(false);
    setMoneyComposerKind(null);
    setMoneyDetail(null);
    setSelectionEntries(null);
    setForwardDraft(null);
  }, [sessionKey]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: selectionEntries ? t("selection.count", selectionEntries.length) : (name ?? id),
      headerBackButtonDisplayMode: "minimal",
      headerShadowVisible: false,
      headerStyle: { backgroundColor: colors.background },
      headerRight: selectionEntries
        ? () => null
        : () => (
            <Pressable
              accessibilityLabel={t("chat.info")}
              hitSlop={10}
              onPress={() =>
                router.push({
                  pathname: "/direct-chat-settings",
                  params: { id, name: name ?? "", avatar: avatar ?? "" },
                })
              }
            >
              <SymbolView name="ellipsis" size={16} weight="medium" tintColor={colors.accent} />
            </Pressable>
          ),
    });
  }, [avatar, id, name, navigation, selectionEntries, t]);

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

  // The sibling delivery/backfill functions are session-keyed and belong to
  // this render closure; listing them would recreate `load` on every render.
  const load = useCallback(async () => {
    if (!id || !ownerId || !sessionKey) return;
    const expectedSession = sessionKey;
    const syncAttempt = syncAttemptRef.current + 1;
    syncAttemptRef.current = syncAttempt;
    const isCurrent = () =>
      activeSessionRef.current === expectedSession && syncAttemptRef.current === syncAttempt;
    if (messagesRef.current.length === 0) setIsLoading(true);

    try {
      const [cached, initialWatermark, hiddenIds, pendingJobs, wasBackfilled] = await Promise.all([
        readDirectChatCachedPage(ownerId, id),
        readDirectHistoryClearWatermark(ownerId, id),
        readHiddenChatMessageIds(ownerId, "dm", id),
        readDirectChatOutboxJobs(ownerId, id),
        isDirectChatHistoryBackfilled(ownerId, id),
      ]);
      if (!isCurrent()) return;
      const latestWatermark = await readDirectHistoryClearWatermark(ownerId, id);
      if (!isCurrent()) return;
      const watermark = Math.max(initialWatermark, latestWatermark);
      hiddenMessageIdsRef.current = hiddenIds;
      const cachedVisible = filterLocallyHiddenChatMessages(
        filterClearedDirectMessages(cached.messages, watermark),
        hiddenIds,
      );
      const pending = pendingJobs.map(directOptimisticOutboxMessage);
      const currentPending = messagesRef.current.filter(
        (message) => message.delivery_status === "sending" || message.delivery_status === "failed",
      );
      const initial = mergeMessages(currentPending, ...cachedVisible, ...pending);
      messagesRef.current = initial;
      setRenderSessionKey(expectedSession);
      setMessages(initial);
      setClearThroughMessageId(watermark);
      hasMoreRef.current = cached.hasMore;
      setHasMore(cached.hasMore);
      setError(null);
      for (const job of pendingJobs) scheduleDirectOutboxJob(job, expectedSession);
      const cachedReadThrough = cachedVisible.at(-1)?.id;
      if (cachedReadThrough !== undefined)
        void markConversationRead(ownerId, "dm", id, cachedReadThrough);

      const fetched: Message[] = [];
      const latestCachedId = cached.messages.at(-1)?.id;
      if (latestCachedId !== undefined) {
        let afterId = latestCachedId;
        for (
          let pageIndex = 0;
          pageIndex < directChatHistoryPolicy.maximumBackfillPages;
          pageIndex += 1
        ) {
          const newer = await getMessages(id, {
            afterId,
            limit: directChatHistoryPolicy.syncPageSize,
          });
          if (!isCurrent()) return;
          fetched.push(...newer.messages);
          const nextAfterId = newer.messages.at(-1)?.id;
          if (!newer.hasMore || nextAfterId === undefined || nextAfterId <= afterId) break;
          afterId = nextAfterId;
        }
      }
      const recent = await getMessages(id, { limit: directChatHistoryPolicy.syncPageSize });
      if (!isCurrent()) return;
      fetched.push(...recent.messages);
      await saveDirectChatMessages(ownerId, id, fetched);
      if (!isCurrent()) return;
      const serverVisible = filterLocallyHiddenChatMessages(
        filterClearedDirectMessages(fetched, watermark),
        hiddenIds,
      );
      const merged = mergeMessages(messagesRef.current, ...serverVisible);
      messagesRef.current = merged;
      setMessages(merged);
      const readThrough = serverVisible.at(-1)?.id ?? cachedVisible.at(-1)?.id;
      if (readThrough !== undefined) void markConversationRead(ownerId, "dm", id, readThrough);

      if (!wasBackfilled) {
        hasMoreRef.current = false;
        setHasMore(false);
        void backfillDirectChatHistory(expectedSession);
      } else {
        const firstServerId = merged.find((message) => message.id > 0)?.id;
        const older =
          firstServerId === undefined
            ? null
            : await readDirectChatCachedPage(ownerId, id, { beforeId: firstServerId, limit: 1 });
        if (!isCurrent()) return;
        const nextHasMore = Boolean(older?.messages.length);
        hasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);
      }
    } catch (nextError) {
      if (isCurrent() && messagesRef.current.length === 0)
        setError(nextError instanceof Error ? nextError.message : t("messages.loadFailed"));
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ownerId, sessionKey, t]);

  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      chatRealtimeService.setActiveConversation("dm", id);
      void load();
      return () => {
        Keyboard.dismiss();
        screenActiveRef.current = false;
        chatRealtimeService.setActiveConversation("dm", null);
        const snapshot = draftSnapshotsRef.current.get(sessionKey);
        if (ownerId && id && snapshot) void saveChatDraftSnapshot(ownerId, id, snapshot);
      };
    }, [id, load, ownerId, sessionKey]),
  );

  useEffect(() => {
    if (renderSessionKey === sessionKey) messagesRef.current = messages;
  }, [messages, renderSessionKey, sessionKey]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    if (!ownerId || !id) return;
    const expectedSession = sessionKey;
    return chatRealtimeService.subscribe((event) => {
      if (activeSessionRef.current !== expectedSession) return;
      if (event.type === "direct_message") {
        const message = event.message;
        const relevant =
          (message.sender_id === id && message.receiver_id === ownerId) ||
          (message.sender_id === ownerId && message.receiver_id === id);
        if (!relevant || hiddenMessageIdsRef.current.has(message.id)) return;
        if (message.id > 0 && message.id <= clearThroughMessageId) return;
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
        if (message.id > 0) void saveDirectChatMessages(ownerId, id, [message]);
        if (!wasKnown && screenActiveRef.current) {
          const isMine = message.sender_id === ownerId;
          if (isMine || isNearBottomRef.current) {
            requestAnimationFrame(() =>
              listRef.current?.scrollToOffset({ animated: true, offset: 0 }),
            );
          } else {
            setNewMessagesBelowCount((count) => count + 1);
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
        if (message.sender_id !== ownerId && screenActiveRef.current) {
          void markConversationRead(ownerId, "dm", id, message.id);
        }
      } else if (event.type === "refresh_conversations" && screenActiveRef.current) {
        void load();
      }
    });
  }, [clearThroughMessageId, id, load, ownerId, sessionKey]);

  useEffect(() => {
    let active = true;
    const ownerId = user?.user_id;
    if (!ownerId || !id) return;
    const expectedSession = sessionKey;
    void readChatDraftSnapshot(ownerId, id).then((saved) => {
      if (!active || activeSessionRef.current !== expectedSession) return;
      setDraft((current) => current || saved.text);
      if (saved.quote) {
        setReplyingTo((current) => current ?? messageFromDraftQuote(saved.quote!, id));
      }
    });
    return () => {
      active = false;
    };
  }, [id, sessionKey, user?.user_id]);

  useEffect(() => {
    const ownerId = user?.user_id;
    if (!ownerId || !id) return;
    const snapshot = {
      text: draft,
      ...(replyingTo
        ? { quote: directDraftQuote(replyingTo, user?.user_id, name, t("common.me")) }
        : {}),
    };
    const timer = setTimeout(() => {
      void saveChatDraftSnapshot(ownerId, id, snapshot);
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, id, name, replyingTo, t, user?.user_id]);

  useEffect(() => {
    const ownerId = user?.user_id;
    if (!ownerId || !id) return;
    return subscribeDirectHistoryClear((event) => {
      if (event.owner_id !== ownerId || event.conversation_id !== id) return;
      setClearThroughMessageId((current) => Math.max(current, event.cleared_before_message_id));
      setMessages((current) => {
        const filtered = filterClearedDirectMessages(current, event.cleared_before_message_id);
        messagesRef.current = filtered;
        return filtered;
      });
      void pruneDirectChatCachedMessagesThrough(ownerId, id, event.cleared_before_message_id);
      setReplyingTo(null);
      setSelectionEntries(null);
      setMenuTarget(null);
      setHasMore(false);
      hasMoreRef.current = false;
    });
  }, [id, user?.user_id]);

  useEffect(() => {
    const ownerId = user?.user_id;
    if (!ownerId || !id) return;
    const expectedSession = sessionKey;
    const unsubscribe = subscribeChatImageOutbox((event) => {
      if (activeSessionRef.current !== expectedSession) return;
      if (event.scope !== "direct" || event.job.owner_id !== ownerId || event.job.target_id !== id)
        return;
      if (event.kind === "confirmed") void saveDirectChatMessages(ownerId, id, [event.message]);
      setMessages((current) => {
        const merged = mergeMessages(
          current,
          event.kind === "updated" ? directOptimisticImageMessage(event.job) : event.message,
        );
        messagesRef.current = merged;
        return merged;
      });
    });
    void resumeChatImageUploads(ownerId, "direct", id);
    return unsubscribe;
  }, [id, sessionKey, user?.user_id]);

  useEffect(() => {
    const ownerId = user?.user_id;
    if (!ownerId || !id) return;
    const expectedSession = sessionKey;
    const unsubscribe = subscribeChatVideoOutbox((event) => {
      if (activeSessionRef.current !== expectedSession) return;
      if (event.scope !== "direct" || event.job.owner_id !== ownerId || event.job.target_id !== id)
        return;
      if (event.kind === "confirmed") void saveDirectChatMessages(ownerId, id, [event.message]);
      setMessages((current) => {
        const merged = mergeMessages(
          current,
          event.kind === "updated" ? directOptimisticVideoMessage(event.job) : event.message,
        );
        messagesRef.current = merged;
        return merged;
      });
    });
    void resumeChatVideoUploads(ownerId, "direct", id);
    return unsubscribe;
  }, [id, sessionKey, user?.user_id]);

  useEffect(() => {
    const ownerId = user?.user_id;
    if (!ownerId || !id) return;
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active")
        void saveChatDraftSnapshot(ownerId, id, {
          text: draft,
          ...(replyingTo
            ? { quote: directDraftQuote(replyingTo, user?.user_id, name, t("common.me")) }
            : {}),
        });
      if (state === "active" && previousState !== "active" && screenActiveRef.current) {
        void load();
        void resumeChatImageUploads(ownerId, "direct", id);
        void resumeChatVideoUploads(ownerId, "direct", id);
      }
      previousState = state;
    });
    return () => subscription.remove();
  }, [draft, id, load, name, replyingTo, t, user?.user_id]);

  useEffect(() => {
    if (call.session === null) return;
    Keyboard.dismiss();
    const frame = requestAnimationFrame(() => {
      setActivePanel(null);
      setInputFocused(false);
      setMenuTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [call.session]);

  useEffect(() => {
    if (selectionEntries === null) return;
    const available = new Set(visibleMessages.map((message) => message.id));
    const next = selectionEntries.filter((entry) => available.has(entry.message_id));
    if (next.length === selectionEntries.length) return;
    const frame = requestAnimationFrame(() => {
      setSelectionEntries(next.length > 0 ? next : null);
      setToastMessage(t("selection.removedUnavailable"));
    });
    return () => cancelAnimationFrame(frame);
  }, [selectionEntries, t, visibleMessages]);

  const timeline = useMemo(() => makeTimeline(visibleMessages), [visibleMessages]);
  const chatBackground = id ? appearance.effective("dm", id) : null;
  const giftRecipientSource = useMemo(
    () =>
      id
        ? {
            kind: "fixed" as const,
            recipient: { id, name: name ?? id, avatar_url: avatar ?? "" },
          }
        : null,
    [avatar, id, name],
  );

  function scheduleDirectOutboxJob(job: DirectChatOutboxJob, expectedSession: string): void {
    const existing = outboxTimersRef.current.get(job.id);
    if (existing) clearTimeout(existing);
    outboxTimersRef.current.delete(job.id);
    if (job.state === "failed") return;
    const scheduledAt = job.next_attempt_at ? Date.parse(job.next_attempt_at) : Date.now();
    const delay = Math.max(0, Number.isFinite(scheduledAt) ? scheduledAt - Date.now() : 0);
    const timer = setTimeout(() => {
      outboxTimersRef.current.delete(job.id);
      void deliverDirectOutboxJob(job, expectedSession);
    }, delay);
    outboxTimersRef.current.set(job.id, timer);
  }

  async function deliverDirectOutboxJob(
    input: DirectChatOutboxJob,
    expectedSession: string,
  ): Promise<void> {
    if (outboxInFlightRef.current.has(input.id)) return;
    outboxInFlightRef.current.add(input.id);
    const sendingJob = sendingDirectChatOutboxJob(input);
    try {
      await saveDirectChatOutboxJob(sendingJob);
      if (activeSessionRef.current === expectedSession) {
        setMessages((current) => {
          const merged = mergeMessages(current, directOptimisticOutboxMessage(sendingJob));
          messagesRef.current = merged;
          return merged;
        });
      }
      const confirmed =
        sendingJob.msg_type === "text"
          ? await sendTextMessage(sendingJob.target_id, sendingJob.content, {
              clientMessageId: sendingJob.id,
              ...(sendingJob.reply_to_id !== undefined
                ? { replyToId: sendingJob.reply_to_id }
                : {}),
            })
          : await sendDirectStickerMessage(
              sendingJob.target_id,
              sendingJob.sticker_pack_id ?? "",
              sendingJob.sticker_id ?? "",
              {
                clientMessageId: sendingJob.id,
                ...(sendingJob.reply_to_id !== undefined
                  ? { replyToId: sendingJob.reply_to_id }
                  : {}),
              },
            );
      const normalized: Message = {
        ...confirmed,
        msg_type: confirmed.msg_type || sendingJob.msg_type,
        content: confirmed.content.trim() ? confirmed.content : sendingJob.content,
        sender_id: confirmed.sender_id || sendingJob.owner_id,
        receiver_id: confirmed.receiver_id || sendingJob.target_id,
        ...(confirmed.reply_to_id === undefined && sendingJob.reply_to_id !== undefined
          ? { reply_to_id: sendingJob.reply_to_id }
          : {}),
        ...(confirmed.reply_to === undefined && sendingJob.reply_to
          ? { reply_to: sendingJob.reply_to }
          : {}),
        client_message_id: confirmed.client_message_id ?? sendingJob.id,
        delivery_status: "sent",
      };
      await Promise.all([
        removeDirectChatOutboxJob(sendingJob.owner_id, sendingJob.id),
        saveDirectChatMessages(sendingJob.owner_id, sendingJob.target_id, [normalized]),
      ]);
      if (activeSessionRef.current === expectedSession) {
        setMessages((current) => {
          const merged = mergeMessages(current, normalized);
          messagesRef.current = merged;
          return merged;
        });
      }
    } catch (nextError) {
      const failed = directChatOutboxFailure(sendingJob, nextError);
      await saveDirectChatOutboxJob(failed);
      if (activeSessionRef.current === expectedSession) {
        setMessages((current) => {
          const merged = mergeMessages(current, directOptimisticOutboxMessage(failed));
          messagesRef.current = merged;
          return merged;
        });
        if (failed.state === "failed")
          Alert.alert(
            t("messages.sendFailed"),
            nextError instanceof Error ? nextError.message : t("common.operationFailed"),
          );
      }
      if (failed.state === "retry_waiting") scheduleDirectOutboxJob(failed, expectedSession);
    } finally {
      outboxInFlightRef.current.delete(input.id);
    }
  }

  async function backfillDirectChatHistory(expectedSession: string): Promise<void> {
    if (!id || !ownerId) return;
    const cached = await readDirectChatCachedPage(ownerId, id, {
      limit: directChatHistoryPolicy.maximumCachedMessages,
    });
    let cursor = cached.messages[0]?.id;
    if (cursor === undefined) return;
    for (
      let pageIndex = 0;
      pageIndex < directChatHistoryPolicy.maximumBackfillPages;
      pageIndex += 1
    ) {
      try {
        const page = await getMessages(id, {
          beforeId: cursor,
          limit: directChatHistoryPolicy.syncPageSize,
        });
        if (page.messages.length === 0) {
          await markDirectChatHistoryBackfilled(ownerId, id);
          return;
        }
        await saveDirectChatMessages(ownerId, id, page.messages);
        const nextCursor = page.messages[0]?.id;
        if (activeSessionRef.current === expectedSession) {
          hasMoreRef.current = true;
          setHasMore(true);
        }
        if (!page.hasMore || nextCursor === undefined || nextCursor >= cursor) {
          await markDirectChatHistoryBackfilled(ownerId, id);
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
  }

  const send = async (retryMessage?: Message) => {
    const content = (retryMessage?.content ?? draft).trim();
    if (!content || !id || !user?.user_id) return;
    const replyTarget = retryMessage ? null : replyingTo;
    const replyPreview =
      retryMessage?.reply_to ?? (replyTarget ? replyPreviewFromMessage(replyTarget) : undefined);
    const replyToId = retryMessage?.reply_to_id ?? replyPreview?.id;
    const clientMessageId = retryMessage?.client_message_id ?? makeClientMessageId();
    const jobInput = {
      id: clientMessageId,
      owner_id: user.user_id,
      target_id: id,
      msg_type: "text" as const,
      content,
      ...(replyToId !== undefined ? { reply_to_id: replyToId } : {}),
      ...(replyPreview ? { reply_to: replyPreview } : {}),
      created_at: retryMessage?.timestamp ?? new Date().toISOString(),
    };
    const optimistic = directOptimisticOutboxMessage({
      ...jobInput,
      state: "queued",
      attempt_count: 0,
    });
    setMessages((current) => {
      const merged = mergeMessages(current, optimistic);
      messagesRef.current = merged;
      return merged;
    });
    if (!retryMessage) {
      setDraft("");
      setReplyingTo(null);
    }
    try {
      const job = await createDirectChatOutboxJob(jobInput);
      scheduleDirectOutboxJob(job, sessionKey);
    } catch (nextError) {
      setMessages((current) =>
        current.map((item) =>
          item.client_message_id === clientMessageId
            ? { ...item, delivery_status: "failed" }
            : item,
        ),
      );
      Alert.alert(
        t("messages.sendFailed"),
        nextError instanceof Error ? nextError.message : t("common.operationFailed"),
      );
    }
  };

  const sendVoice = async (recording: ChatVoiceRecording, retryMessage?: Message) => {
    if (!id || !user?.user_id) return;
    const expectedSession = sessionKey;
    const sendingOwnerId = user.user_id;
    const sendingTargetId = id;
    const clientMessageId = retryMessage?.client_message_id ?? makeClientMessageId();
    const optimistic: Message = retryMessage
      ? { ...retryMessage, delivery_status: "sending" }
      : {
          id: -Date.now(),
          sender_id: user.user_id,
          receiver_id: id,
          msg_type: "voice",
          content: `${recording.uri}|${recording.duration}`,
          timestamp: new Date().toISOString(),
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
      const confirmed = await sendDirectVoiceMessage(sendingTargetId, recording);
      const normalized: Message = {
        ...confirmed,
        client_message_id: confirmed.client_message_id ?? clientMessageId,
        delivery_status: "sent",
      };
      await saveDirectChatMessages(sendingOwnerId, sendingTargetId, [normalized]);
      if (activeSessionRef.current !== expectedSession) return;
      setMessages((current) => {
        const merged = mergeMessages(current, normalized);
        messagesRef.current = merged;
        return merged;
      });
    } catch (nextError) {
      if (activeSessionRef.current !== expectedSession) return;
      setMessages((current) =>
        current.map((message) =>
          message.client_message_id === clientMessageId
            ? { ...message, delivery_status: "failed" }
            : message,
        ),
      );
      Alert.alert(
        t("messages.sendFailed"),
        nextError instanceof Error ? nextError.message : t("common.operationFailed"),
      );
    }
  };

  const sendSticker = async (pack: ChatStickerPack, sticker: ChatStickerItem) => {
    if (!id || !user?.user_id) return;
    const replyTarget = replyingTo;
    const replyToId = replyTarget?.id;
    const clientMessageId = makeClientMessageId();
    const content = encodeChatStickerMessagePayload(makeChatStickerMessagePayload(pack, sticker));
    const replyPreview = replyTarget ? replyPreviewFromMessage(replyTarget) : undefined;
    const jobInput = {
      id: clientMessageId,
      owner_id: user.user_id,
      target_id: id,
      msg_type: "sticker" as const,
      content,
      sticker_pack_id: pack.id,
      sticker_id: sticker.id,
      ...(replyToId !== undefined ? { reply_to_id: replyToId } : {}),
      ...(replyPreview ? { reply_to: replyPreview } : {}),
      created_at: new Date().toISOString(),
    };
    setReplyingTo(null);
    setMessages((current) => {
      const merged = mergeMessages(
        current,
        directOptimisticOutboxMessage({ ...jobInput, state: "queued", attempt_count: 0 }),
      );
      messagesRef.current = merged;
      return merged;
    });
    try {
      const job = await createDirectChatOutboxJob(jobInput);
      scheduleDirectOutboxJob(job, sessionKey);
    } catch (nextError) {
      setMessages((current) =>
        current.map((message) =>
          message.client_message_id === clientMessageId
            ? { ...message, delivery_status: "failed" }
            : message,
        ),
      );
      Alert.alert(
        t("messages.stickerSendFailed"),
        nextError instanceof Error ? nextError.message : t("common.operationFailed"),
      );
    }
  };

  const sendGift = async (gift: GiftCatalogItem, recipient: GiftRecipient) => {
    if (!id || !user?.user_id) return;
    if (id === user.user_id) throw new Error(t("gift.cannotSendToSelf"));
    const expectedSession = sessionKey;
    const sendingOwnerId = user.user_id;
    const sendingTargetId = id;
    const key = giftIdempotencyKey(id, gift.gift_id);
    const confirmed = await sendDirectGiftMessage(sendingTargetId, gift.gift_id, key);
    completeGiftIdempotency(sendingTargetId, gift.gift_id);
    const giftPayload = withGiftMessageRecipient(
      parseGiftMessagePayload(confirmed.content) ??
        makeGiftMessagePayload(gift, recipient, { id: sendingOwnerId, name: user.nickname }),
      recipient,
    );
    const normalized: Message = {
      ...confirmed,
      content: encodeGiftMessagePayload(giftPayload),
      sender_id: confirmed.sender_id || sendingOwnerId,
      receiver_id: confirmed.receiver_id || sendingTargetId,
      msg_type: confirmed.msg_type || "gift",
      delivery_status: "sent",
    };
    await saveDirectChatMessages(sendingOwnerId, sendingTargetId, [normalized]);
    if (activeSessionRef.current !== expectedSession) return;
    setMessages((current) => {
      const merged = mergeMessages(current, normalized);
      messagesRef.current = merged;
      return merged;
    });
  };

  const applyChatMoneyResult = (result: ChatMoneyActionResult) => {
    const expectedSession = sessionKey;
    if (activeSessionRef.current !== expectedSession || !ownerId || !id) return;
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
      const next = result.direct_receipt_message
        ? mergeMessages(updated, result.direct_receipt_message)
        : updated;
      messagesRef.current = next;
      void saveDirectChatMessages(
        ownerId,
        id,
        next.filter((message) => message.id > 0),
      );
      return next;
    });
  };

  const loadMore = useCallback(async (): Promise<Message[]> => {
    if (!id || !hasMoreRef.current || loadingMoreRef.current) return [];
    const firstServerMessage = messagesRef.current.find((message) => message.id > 0);
    if (!firstServerMessage) return [];
    const expectedSession = sessionKey;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      let cursor = firstServerMessage.id;
      const collected: Message[] = [];
      let nextHasMore = true;
      const cached = await readDirectChatCachedPage(ownerId, id, {
        beforeId: cursor,
        limit: directChatHistoryPolicy.visiblePageSize,
      });
      if (activeSessionRef.current !== expectedSession) return [];
      if (cached.messages.length > 0) {
        cursor = cached.messages[0]!.id;
        collected.push(
          ...filterLocallyHiddenChatMessages(
            filterClearedDirectMessages(cached.messages, clearThroughMessageId),
            hiddenMessageIdsRef.current,
          ),
        );
        nextHasMore = cached.hasMore;
      }
      if (cached.messages.length === 0 || collected.length === 0) {
        for (
          let pageIndex = 0;
          pageIndex < directChatHistoryPolicy.maximumBackfillPages;
          pageIndex += 1
        ) {
          const page = await getMessages(id, {
            beforeId: cursor,
            limit: directChatHistoryPolicy.syncPageSize,
          });
          if (activeSessionRef.current !== expectedSession) return [];
          await saveDirectChatMessages(ownerId, id, page.messages);
          const visible = filterLocallyHiddenChatMessages(
            filterClearedDirectMessages(page.messages, clearThroughMessageId),
            hiddenMessageIdsRef.current,
          );
          collected.push(...visible);
          const nextCursor = page.messages[0]?.id;
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
        setIsLoadingMore(false);
      }
    }
  }, [clearThroughMessageId, id, ownerId, sessionKey, t]);

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

  const revealMessage = useCallback((messageId: number) => {
    const data = [...makeTimeline(messagesRef.current)].reverse();
    const index = data.findIndex((row) => row.message.id === messageId);
    if (index < 0) return false;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      setHighlightedMessageId(messageId);
      setTimeout(
        () => setHighlightedMessageId((current) => (current === messageId ? null : current)),
        2_000,
      );
    });
    return true;
  }, []);

  const scrollToMessage = useCallback(
    async (messageId: number) => {
      if (revealMessage(messageId) || !id) return;
      const expectedSession = sessionKey;
      try {
        const fetched = await getMessageContext(id, messageId);
        if (activeSessionRef.current !== expectedSession) return;
        await saveDirectChatMessages(ownerId, id, fetched);
        if (activeSessionRef.current !== expectedSession) return;
        const context = filterLocallyHiddenChatMessages(
          filterClearedDirectMessages(fetched, clearThroughMessageId),
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
    [clearThroughMessageId, id, ownerId, revealMessage, sessionKey, t],
  );

  useEffect(() => {
    const target = Number(messageId);
    if (
      initialPushMessageHandledRef.current === messageId ||
      isLoading ||
      !Number.isInteger(target) ||
      target <= 0
    )
      return;
    initialPushMessageHandledRef.current = messageId ?? null;
    void scrollToMessage(target);
  }, [isLoading, messageId, scrollToMessage]);

  const selectionEntryFor = useCallback(
    (message: Message): ChatSelectionEntry | null => {
      if (
        !id ||
        !user?.user_id ||
        parseChatCallRecord(message.content) !== null ||
        !isSelectableChatMessage(message, normalizeChatMoneyReceipt(message.content) !== null)
      )
        return null;
      return {
        reference: chatMessageReference(user.user_id, "dm", id, message.id),
        message_id: message.id,
        descriptor: chatSelectionDescriptor(message),
      };
    },
    [id, user],
  );

  const toggleMessageSelection = useCallback(
    (message: Message) => {
      const entry = selectionEntryFor(message);
      if (!entry) return;
      if (selectionEntries === null) {
        Keyboard.dismiss();
        setActivePanel(null);
        setInputFocused(false);
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
    if (!selectionEntries || !id) return;
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
      sources: selectedMessages.map((message) => forwardSource("dm", id, message)),
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
    if (!selectionEntries || !id || !user?.user_id) return;
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
            void hideChatMessagesLocally(user.user_id, "dm", id, selectedIds).then((hidden) => {
              hiddenMessageIdsRef.current = hidden;
            });
            const selected = new Set(selectedIds);
            const filtered = messagesRef.current.filter((message) => !selected.has(message.id));
            messagesRef.current = filtered;
            setMessages(filtered);
            void publishLocalDirectConversationPreview(filtered);
            setReplyingTo((current) => (current && selected.has(current.id) ? null : current));
            setSelectionEntries(null);
          },
        },
      ],
    );
  };

  const openMessageMenu = useCallback(
    (message: Message, anchor: ChatMessageAnchor) => {
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
    if (!target || !id || !user?.user_id) return;
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
        const expectedSession = sessionKey;
        try {
          const recalled = await recallDirectMessage(id, message.id);
          await saveDirectChatMessages(user.user_id, id, [recalled]);
          if (activeSessionRef.current !== expectedSession) return;
          setMessages((current) => {
            const merged = mergeMessages(current, recalled);
            messagesRef.current = merged;
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
        if (message.id > 0) {
          const hidden = await hideChatMessagesLocally(user.user_id, "dm", id, [message.id]);
          hiddenMessageIdsRef.current = hidden;
        } else if (message.client_message_id) {
          const timer = outboxTimersRef.current.get(message.client_message_id);
          if (timer) clearTimeout(timer);
          outboxTimersRef.current.delete(message.client_message_id);
          if (isImageMessage(message))
            await cancelChatImageUpload(user.user_id, message.client_message_id);
          else if (isVideoMessage(message))
            await cancelChatVideoUpload(user.user_id, message.client_message_id);
          else await removeDirectChatOutboxJob(user.user_id, message.client_message_id);
        }
        const filtered = messagesRef.current.filter(
          (item) => timelineIdentity(item) !== timelineIdentity(message),
        );
        messagesRef.current = filtered;
        setMessages(filtered);
        void publishLocalDirectConversationPreview(filtered);
        setReplyingTo((current) => (current?.id === message.id ? null : current));
        return;
      case "forward":
        setForwardDraft({
          mode: "single",
          sources: [forwardSource("dm", id, message)],
          preview: chatForwardMessagePreview(message, t),
        });
        return;
      case "multiSelect":
        toggleMessageSelection(message);
        return;
    }
  }

  async function publishLocalDirectConversationPreview(
    currentMessages: readonly Message[],
  ): Promise<void> {
    if (!ownerId || !id) return;
    const latest = [...currentMessages]
      .filter((message) => message.id > 0)
      .sort(compareMessages)
      .at(-1);
    await publishDirectConversationPreviewUpdate({
      owner_id: ownerId,
      contact_id: id,
      ...(latest
        ? {
            last_message: directLocalPreviewText(latest, ownerId, name, t),
            last_message_time: latest.timestamp,
            last_message_id: latest.id,
          }
        : {}),
    });
  }

  const retryMessage = (message: Message) => {
    if (isImageMessage(message) && message.client_message_id) {
      const clientMessageId = message.client_message_id;
      setMessages((current) =>
        current.map((item) =>
          item.client_message_id === clientMessageId
            ? { ...item, delivery_status: "sending" }
            : item,
        ),
      );
      if (user?.user_id) {
        void retryChatImageUpload(user.user_id, clientMessageId).then((didRetry) => {
          if (!didRetry) Alert.alert(t("common.operationFailed"), t("messages.sendFailed"));
        });
      }
      return;
    }
    if (isVideoMessage(message) && message.client_message_id) {
      const clientMessageId = message.client_message_id;
      setMessages((current) =>
        current.map((item) =>
          item.client_message_id === clientMessageId
            ? { ...item, delivery_status: "sending" }
            : item,
        ),
      );
      if (user?.user_id) {
        void retryChatVideoUpload(user.user_id, clientMessageId).then((didRetry) => {
          if (!didRetry) Alert.alert(t("common.operationFailed"), t("messages.sendFailed"));
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
      const expectedSession = sessionKey;
      void readDirectChatOutboxJob(user.user_id, message.client_message_id).then(async (stored) => {
        if (stored) {
          const queued = queuedDirectChatOutboxJob(stored);
          await saveDirectChatOutboxJob(queued);
          if (activeSessionRef.current === expectedSession) {
            setMessages((current) => {
              const merged = mergeMessages(current, directOptimisticOutboxMessage(queued));
              messagesRef.current = merged;
              return merged;
            });
          }
          scheduleDirectOutboxJob(queued, expectedSession);
          return;
        }
        if (message.msg_type.toLocaleLowerCase() === "sticker") {
          const payload = parseChatStickerMessagePayload(message.content);
          if (!payload) {
            Alert.alert(t("common.operationFailed"), t("messages.sendFailed"));
            return;
          }
          const created = await createDirectChatOutboxJob({
            id: message.client_message_id!,
            owner_id: user.user_id,
            target_id: id,
            msg_type: "sticker",
            content: message.content,
            sticker_pack_id: payload.packId,
            sticker_id: payload.stickerId,
            ...(message.reply_to_id !== undefined ? { reply_to_id: message.reply_to_id } : {}),
            ...(message.reply_to ? { reply_to: message.reply_to } : {}),
            created_at: message.timestamp,
          });
          scheduleDirectOutboxJob(created, expectedSession);
          return;
        }
        void send(message);
      });
      return;
    }
    void send(message);
  };

  const chooseMedia = async () => {
    const expectedSession = sessionKey;
    try {
      const assets = await pickChatMedia();
      if (activeSessionRef.current !== expectedSession) return;
      setActivePanel(null);
      const supportedAssets = assets.filter(
        (asset) => asset.type === "image" || asset.type === "video",
      );
      const now = Date.now();
      const jobs = supportedAssets.map((asset, index) => ({
        asset,
        index,
        type: asset.type === "video" ? ("video" as const) : ("image" as const),
        clientMessageId: makeClientMessageId(),
        createdAt: new Date(now + index).toISOString(),
      }));
      if (user?.user_id && id && jobs.length > 0) {
        setMessages((current) =>
          mergeMessages(
            current,
            ...jobs.map((job) => ({
              id: -(now + job.index + 1),
              sender_id: user.user_id,
              receiver_id: id,
              msg_type: job.type,
              content: job.asset.uri,
              ...(job.type === "image" ? { thumbnail_url: job.asset.uri } : {}),
              timestamp: job.createdAt,
              client_message_id: job.clientMessageId,
              version: 1,
              delivery_status: "sending" as const,
            })),
          ),
        );
        for (const job of jobs) {
          const operation =
            job.type === "image"
              ? enqueueDirectChatImage({
                  owner: user,
                  targetId: id,
                  clientMessageId: job.clientMessageId,
                  createdAt: job.createdAt,
                  asset: {
                    uri: job.asset.uri,
                    width: job.asset.width,
                    height: job.asset.height,
                    filename: job.asset.fileName ?? `image_${job.index}.jpg`,
                  },
                })
              : enqueueDirectChatVideo({
                  owner: user,
                  targetId: id,
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
            setMessages((current) =>
              current.map((message) =>
                message.client_message_id === job.clientMessageId
                  ? { ...message, delivery_status: "failed" }
                  : message,
              ),
            );
            Alert.alert(
              t("messages.sendFailed"),
              nextError instanceof Error ? nextError.message : t("common.operationFailed"),
            );
          });
        }
      }
    } catch (nextError) {
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
    newMessagesBelowCount,
    replyMessageIds: replyLocatorMessageIds,
  });

  const activateTimelineLocator = () => {
    if (timelineLocator?.kind === "reply") {
      const target = replyLocatorMessageIds[0];
      if (target === undefined) return;
      setReplyLocatorMessageIds((current) => current.slice(1));
      void scrollToMessage(target);
      return;
    }
    setNewMessagesBelowCount(0);
    setReplyLocatorMessageIds([]);
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    listRef.current?.scrollToOffset({ animated: true, offset: 0 });
  };

  return (
    <View style={styles.screen}>
      <ChatBackgroundLayer background={chatBackground} style={styles.backgroundLayer} />
      <ChatKeyboardAvoidingView style={styles.chatContent}>
        <View style={styles.timelineSurface}>
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
              ItemSeparatorComponent={() => <View style={styles.messageSeparator} />}
              keyExtractor={({ message }) => timelineIdentity(message)}
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
                setInputFocused(false);
                setActivePanel(null);
                setMenuTarget(null);
              }}
              onTouchStart={() => {
                Keyboard.dismiss();
                setInputFocused(false);
                setActivePanel(null);
              }}
              onScroll={({ nativeEvent }) => {
                const nextNearBottom = nativeEvent.contentOffset.y <= 24;
                if (nextNearBottom !== isNearBottomRef.current) {
                  isNearBottomRef.current = nextNearBottom;
                  setIsNearBottom(nextNearBottom);
                  if (nextNearBottom) {
                    setNewMessagesBelowCount(0);
                    setReplyLocatorMessageIds([]);
                  }
                }
              }}
              onScrollToIndexFailed={({ index }) => {
                setTimeout(
                  () =>
                    listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 }),
                  80,
                );
              }}
              renderItem={({ item }) => {
                const entry = selectionEntryFor(item.message);
                const rowView = (
                  <MessageTimelineRow
                    highlighted={highlightedMessageId === item.message.id}
                    row={item}
                    isMine={item.message.sender_id === user?.user_id}
                    myAvatar={user?.avatar_url}
                    myId={user?.user_id}
                    imageUrls={imageUrls}
                    loadMoreGalleryImages={loadMoreGalleryImages}
                    onImageOpen={setImageSelection}
                    onVideoOpen={setPreviewVideoUrl}
                    peerAvatar={avatar}
                    peerId={id}
                    peerName={name}
                    messages={visibleMessages}
                    onMenuRequested={openMessageMenu}
                    onQuoteTap={(messageId) => void scrollToMessage(messageId)}
                    recalledEditableText={recalledEditableTexts[item.message.id]}
                    onReedit={(text) => {
                      setDraft(text);
                      setComposerFocusRequest((value) => value + 1);
                    }}
                    onRetry={retryMessage}
                    onChatMoneyTap={(payload) => {
                      const isSender = payload.sender_id === user?.user_id;
                      setMoneyDetail({
                        payload,
                        isSender,
                        senderName: isSender ? user?.nickname : name,
                        senderAvatar: isSender ? user?.avatar_url : avatar,
                      });
                    }}
                    onForwardBundleTap={(bundleId) =>
                      router.push({ pathname: "/forward-bundle/[id]", params: { id: bundleId } })
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
                      : (name ?? replyingTo.sender_id),
                  content: replyingTo.content,
                  msgType: replyingTo.msg_type,
                }}
              />
            ) : null}
            <Composer
              activePanel={activePanel}
              draft={draft}
              focusRequest={composerFocusRequest}
              isInputFocused={isInputFocused}
              isSelfChat={Boolean(user?.user_id && id === user.user_id)}
              onChooseMedia={() => void chooseMedia()}
              onChooseGift={() => {
                setActivePanel(null);
                setShowGiftSheet(true);
              }}
              onChooseMoney={(kind) => {
                setActivePanel(null);
                setMoneyComposerKind(kind);
              }}
              onChooseCall={(callType) => {
                setActivePanel(null);
                void call.startDirectCall(
                  { userId: id, nickname: name ?? id, avatarUrl: avatar },
                  callType,
                );
              }}
              onDraftChange={setDraft}
              onFocusChange={setInputFocused}
              onPanelChange={setActivePanel}
              onSend={() => void send()}
              onSendSticker={(pack, sticker) => void sendSticker(pack, sticker)}
              onVoiceRecorded={(recording) => sendVoice(recording)}
              onVoiceRecordingStateChange={setVoiceRecordingState}
            />
          </>
        )}
        <ImageGallery onClose={() => setImageSelection(null)} selection={imageSelection} />
        <VideoPlayerOverlay onClose={() => setPreviewVideoUrl(null)} videoUrl={previewVideoUrl} />
        <VoiceRecordingOverlay state={voiceRecordingState} />
        {giftRecipientSource && user?.user_id ? (
          <ChatGiftPickerSheet
            onClose={() => setShowGiftSheet(false)}
            onOpenWallet={() => router.push("/wallet")}
            onSend={sendGift}
            onSendFailure={(message) => Alert.alert(t("gift.sendFailed"), message)}
            ownerId={user.user_id}
            source={giftRecipientSource}
            visible={showGiftSheet}
          />
        ) : null}
        {user?.user_id && moneyComposerKind ? (
          <ChatMoneyComposerModal
            kind={moneyComposerKind}
            onClose={() => setMoneyComposerKind(null)}
            onCreateFailed={(clientMessageId, message) => {
              if (activeSessionRef.current !== sessionKey) return;
              setMessages((current) => {
                const next = current.filter((item) => item.client_message_id !== clientMessageId);
                messagesRef.current = next;
                return next;
              });
              Alert.alert(t("messages.sendFailed"), message);
            }}
            onCreated={(result, clientMessageId) => {
              if (activeSessionRef.current !== sessionKey || !result.direct_message) return;
              const created: Message = {
                ...result.direct_message,
                client_message_id: result.direct_message.client_message_id ?? clientMessageId,
                delivery_status: "sent",
              };
              void saveDirectChatMessages(ownerId, id, [created]);
              setMessages((current) => {
                const merged = mergeMessages(current, created);
                messagesRef.current = merged;
                return merged;
              });
            }}
            onOptimisticCreated={(creation: ChatMoneyOptimisticCreation) => {
              if (activeSessionRef.current !== sessionKey) return;
              const optimistic: Message = {
                id: -Date.now(),
                sender_id: ownerId,
                receiver_id: id,
                msg_type: creation.payload.kind,
                content: encodeChatMoneyPayload(creation.payload),
                timestamp: creation.createdAt,
                client_message_id: creation.clientMessageId,
                version: 1,
                delivery_status: "sending",
              };
              setMessages((current) => {
                const merged = mergeMessages(current, optimistic);
                messagesRef.current = merged;
                return merged;
              });
            }}
            onOpenWallet={() => {
              setMoneyComposerKind(null);
              router.push("/wallet");
            }}
            ownerId={user.user_id}
            source={giftRecipientSource!}
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
            initialSenderAvatar={moneyDetail?.senderAvatar}
            initialSenderName={moneyDetail?.senderName}
            visible={moneyDetail !== null}
          />
        ) : null}
        <ForwardFlowModal
          mode={forwardDraft?.mode ?? "single"}
          onClose={() => setForwardDraft(null)}
          onCompleted={() => {
            if (activeSessionRef.current !== sessionKey) return;
            setSelectionEntries(null);
            setToastMessage(t("forward.sent"));
          }}
          preview={forwardDraft?.preview ?? ""}
          sources={forwardDraft?.sources ?? []}
          visible={forwardDraft !== null}
        />
        <ChatMessageActionOverlay
          actions={menuTarget?.actions ?? []}
          anchor={menuTarget?.anchor ?? null}
          onDismiss={() => setMenuTarget(null)}
          onSelect={(action) => void handleMenuAction(action)}
        />
        <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      </ChatKeyboardAvoidingView>
    </View>
  );
}

function MessageTimelineRow({
  row,
  highlighted,
  isMine,
  myAvatar,
  myId,
  imageUrls,
  loadMoreGalleryImages,
  onImageOpen,
  onVideoOpen,
  peerAvatar,
  peerId,
  peerName,
  messages,
  onMenuRequested,
  onQuoteTap,
  recalledEditableText,
  onReedit,
  onRetry,
  onChatMoneyTap,
  onForwardBundleTap,
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
  peerAvatar: string | undefined;
  peerId: string;
  peerName: string | undefined;
  messages: Message[];
  onMenuRequested: (message: Message, anchor: ChatMessageAnchor) => void;
  onQuoteTap: (messageId: number) => void;
  recalledEditableText: string | undefined;
  onReedit: (text: string) => void;
  onRetry: (message: Message) => void;
  onChatMoneyTap: (payload: ChatMoneyPayload) => void;
  onForwardBundleTap: (bundleId: string) => void;
}) {
  const { t } = useLocalization();
  const { message } = row;
  if (isRecalledChatMessage(message)) {
    return (
      <View>
        {row.showsTime ? <TimeSeparator timestamp={message.timestamp} /> : null}
        <ChatRecalledMessageTip
          canReedit={isMine && recalledEditableText !== undefined}
          notice={chatRecallNotice(message.sender_id, myId, peerName, t)}
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
  const resolvedReply = resolveDirectReply(message, messages);
  return (
    <View>
      {row.showsTime ? <TimeSeparator timestamp={message.timestamp} /> : null}
      <ChatMessageHighlightSurface active={highlighted} style={styles.messageRow}>
        {isMine ? (
          <View style={styles.rowSpacer} />
        ) : (
          <UserAvatarButton
            accessibilityName={peerName || peerId}
            avatarUrl={peerAvatar}
            size={36}
            userId={peerId}
          />
        )}
        <View style={[styles.messageColumn, isMine && styles.mineColumn]}>
          {resolvedReply ? (
            <ChatQuotedMessageView
              isFromMe={isMine}
              onPress={() => onQuoteTap(resolvedReply.id)}
              value={{
                senderName:
                  resolvedReply.sender_id === myId
                    ? t("common.me")
                    : (peerName ?? resolvedReply.sender_id),
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
                peerAvatar={peerAvatar}
                peerId={message.receiver_id}
                peerName={peerName}
              />
            </ChatMessageLongPressSurface>
          </View>
        </View>
        {isMine ? (
          <UserAvatarButton
            accessibilityName={t("common.me")}
            avatarUrl={myAvatar}
            size={36}
            userId={myId ?? ""}
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
  peerAvatar,
  peerId,
  peerName,
}: {
  message: Message;
  isMine: boolean;
  imageUrls: string[];
  loadMoreGalleryImages: () => Promise<string[]>;
  onImageOpen: (selection: ImageGallerySelection) => void;
  onVideoOpen: (url: string) => void;
  onChatMoneyTap: (payload: ChatMoneyPayload) => void;
  onForwardBundleTap: (bundleId: string) => void;
  myAvatar?: string | undefined;
  myId?: string | undefined;
  peerAvatar?: string | undefined;
  peerId?: string | undefined;
  peerName?: string | undefined;
}) {
  const { t } = useLocalization();
  const canActivate = useChatMessageActivationGuard();
  const normalizedType = message.msg_type.toLocaleLowerCase();
  const forwardBundle = parseForwardBundleMessage(message.content, normalizedType);
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
  if (normalizedType === "image") {
    return (
      <ChatImageBubble
        imageUrls={imageUrls}
        index={Math.max(0, imageUrls.indexOf(message.content))}
        loadMoreOlder={loadMoreGalleryImages}
        messageId={timelineIdentity(message)}
        onOpen={onImageOpen}
        thumbnailUrl={message.thumbnail_url}
        url={message.content}
      />
    );
  }
  if (normalizedType === "video") {
    return (
      <ChatVideoBubble
        onOpen={onVideoOpen}
        thumbnailUrl={message.thumbnail_url}
        url={message.content}
      />
    );
  }
  if (normalizedType === "voice") {
    return (
      <ChatVoiceBubble
        content={message.content}
        isFromMe={isMine}
        isPending={isMine && isPendingChatVoice(message.delivery_status)}
      />
    );
  }
  const moneyPayload =
    normalizedType === "red_packet" || normalizedType === "transfer"
      ? parseChatMoneyPayload(message.content)
      : null;
  if (moneyPayload) {
    return (
      <ChatMoneyBubble
        isFromMe={isMine}
        onPress={() => {
          if (message.delivery_status !== "sending") onChatMoneyTap(moneyPayload);
        }}
        payload={moneyPayload}
        viewerId={myId}
      />
    );
  }
  if (normalizedType === "sticker") {
    return <ChatStickerBubble content={message.content} isFromMe={isMine} />;
  }
  const giftPayload = parseGiftMessagePayload(message.content);
  if (giftPayload) {
    return (
      <ChatGiftBubble
        isFromMe={isMine}
        payload={giftPayload}
        recipientAvatarFallback={isMine ? peerAvatar : myAvatar}
        recipientFallback={isMine ? peerName : t("common.me")}
        recipientIdFallback={isMine ? peerId : myId}
      />
    );
  }
  const callRecord = parseChatCallRecord(message.content);
  if (callRecord) {
    return <ChatCallRecordBubble isFromMe={isMine} record={callRecord} />;
  }
  if (normalizedType !== "text") {
    const symbols: Record<string, SFSymbol> = {
      image: "photo",
      video: "video.fill",
      voice: "waveform",
      sticker: "face.smiling",
      gift: "gift.fill",
    };
    return (
      <View style={[styles.bubble, isMine ? styles.mineBubble : styles.otherBubble]}>
        <SymbolView
          name={symbols[normalizedType] ?? "ellipsis.bubble"}
          size={20}
          tintColor={isMine ? "#FFFFFF" : colors.text}
        />
        <Text style={isMine ? styles.mineText : styles.otherText} numberOfLines={2}>
          {mediaPreview(normalizedType, message.content, t)}
        </Text>
      </View>
    );
  }
  const content = message.content.replace(/[\r\n]+$/gu, "");
  if (isMine) {
    return (
      <LinearGradient
        colors={[colors.accent, "#764BA2"]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={[styles.bubble, styles.mineBubble]}
      >
        <Text style={styles.mineText}>{content}</Text>
      </LinearGradient>
    );
  }
  return (
    <View style={[styles.bubble, styles.otherBubble]}>
      <Text style={styles.otherText}>{content}</Text>
    </View>
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
  activePanel,
  draft,
  focusRequest,
  isInputFocused,
  isSelfChat,
  onChooseMedia,
  onChooseGift,
  onChooseMoney,
  onChooseCall,
  onDraftChange,
  onFocusChange,
  onPanelChange,
  onSend,
  onSendSticker,
  onVoiceRecorded,
  onVoiceRecordingStateChange,
}: {
  activePanel: "stickers" | "plus" | null;
  draft: string;
  focusRequest: number;
  isInputFocused: boolean;
  isSelfChat: boolean;
  onChooseMedia: () => void;
  onChooseGift: () => void;
  onChooseMoney: (kind: ChatMoneyKind) => void;
  onChooseCall: (callType: CallType) => void;
  onDraftChange: (value: string) => void;
  onFocusChange: (value: boolean) => void;
  onPanelChange: (panel: "stickers" | "plus" | null) => void;
  onSend: () => void;
  onSendSticker: (pack: ChatStickerPack, sticker: ChatStickerItem) => void;
  onVoiceRecorded: (recording: ChatVoiceRecording) => void | Promise<void>;
  onVoiceRecordingStateChange: (state: VoiceRecordingVisualState | null) => void;
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
      selectionRef.current = { start: draft.length, end: draft.length };
    }
    composerDraftRef.current = null;
  }, [draft]);
  useEffect(() => {
    if (focusRequest <= 0) return;
    requestAnimationFrame(() => {
      setIsVoiceMode(false);
      inputRef.current?.focus();
    });
  }, [focusRequest]);
  const canSend = draft.trim().length > 0;
  const showMicrophone = !isVoiceMode && !isInputFocused && !activePanel && draft.length === 0;
  return (
    <View style={styles.composerSurface}>
      <ChatComposerSurfaceBackground showsStickerPanel={activePanel === "stickers"} />
      <View
        style={[
          styles.composerRow,
          { paddingBottom: isInputFocused || activePanel ? 5 : 12 + safeAreaInsets.bottom },
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
            {showMicrophone ? (
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
              }}
              onSubmitEditing={onSend}
              placeholder={t("chat.input.placeholder")}
              placeholderTextColor={colors.tertiaryText}
              returnKeyType="send"
              submitBehavior="submit"
              style={[
                styles.composerInput,
                initialInputHeight !== undefined && { height: initialInputHeight },
                showMicrophone && styles.inputWithMic,
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
            isActive={activePanel === "stickers"}
            onPress={() => {
              const next = activePanel === "stickers" ? null : "stickers";
              if (next) {
                inputRef.current?.blur();
                onFocusChange(false);
              }
              onPanelChange(next);
            }}
          />
        ) : null}

        {!isVoiceMode && canSend ? (
          <Pressable
            accessibilityLabel={t("common.send")}
            onPress={onSend}
            style={styles.composerIconButton}
          >
            <LinearGradient
              colors={[colors.accent, "#764BA2"]}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={styles.sendCircle}
            >
              <SymbolView name="arrow.up" size={15} weight="bold" tintColor="#FFFFFF" />
            </LinearGradient>
          </Pressable>
        ) : !isVoiceMode ? (
          <ChatComposerPanelToggleButton
            accessibilityLabel={t("accessibility.moreActions")}
            activeSystemName="xmark.circle.fill"
            inactiveSystemName="plus.circle.fill"
            isActive={activePanel === "plus"}
            onPress={() => {
              const next = activePanel === "plus" ? null : "plus";
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
        panel={activePanel}
        plusItemCount={isSelfChat ? 1 : 6}
        plusPanel={
          <PlusPanel
            isSelfChat={isSelfChat}
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
  isSelfChat,
  onChooseMedia,
  onChooseGift,
  onChooseMoney,
  onChooseCall,
}: {
  isSelfChat: boolean;
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
  }[] = [{ title: t("chat.album"), symbol: "photo", action: onChooseMedia }];
  if (!isSelfChat) {
    items.push(
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
    );
  }
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
          <View style={styles.plusIconBox}>
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

function directChatSessionKey(ownerId: string, contactId: string | undefined): string {
  const owner = ownerId.trim();
  const contact = contactId?.trim() ?? "";
  return owner && contact ? `${encodeURIComponent(owner)}:${encodeURIComponent(contact)}` : "";
}

function makeTimeline(messages: Message[]): TimelineRow[] {
  const sorted = [...messages].sort(compareMessages);
  return sorted.map((message, index) => ({
    message,
    showsTime: shouldShowTime(message.timestamp, sorted[index - 1]?.timestamp),
  }));
}

function mergeMessages(current: Message[], ...incoming: Message[]): Message[] {
  const next = [...current];
  for (const message of incoming) {
    const identity = timelineIdentity(message);
    const index = next.findIndex(
      (candidate) =>
        timelineIdentity(candidate) === identity ||
        (candidate.id > 0 && message.id > 0 && candidate.id === message.id),
    );
    if (index >= 0) {
      const existing = next[index]!;
      next[index] = {
        ...message,
        ...(message.client_message_id
          ? {}
          : existing.client_message_id
            ? { client_message_id: existing.client_message_id }
            : {}),
      };
    } else next.push(message);
  }
  return next.sort(compareMessages);
}

function timelineIdentity(message: Message): string {
  return message.client_message_id ? `client:${message.client_message_id}` : `server:${message.id}`;
}

function compareMessages(left: Message, right: Message): number {
  const timeDifference = timestampValue(left.timestamp) - timestampValue(right.timestamp);
  return timeDifference !== 0 ? timeDifference : left.id - right.id;
}

function shouldShowTime(current: string, previous?: string): boolean {
  if (!previous) return true;
  const currentTime = timestampValue(current);
  const previousTime = timestampValue(previous);
  return Number.isFinite(currentTime) && Number.isFinite(previousTime)
    ? currentTime - previousTime >= 120_000
    : false;
}

function timestampValue(value: string): number {
  return Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

function formatSeparator(value: string, yesterdayLabel: string): string {
  const date = new Date(timestampValue(value));
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (isToday) return time;
  if (date.toDateString() === yesterday.toDateString()) return `${yesterdayLabel} ${time}`;
  return date.toLocaleString([], {
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" as const }),
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

function directLocalPreviewText(
  message: Message,
  viewerId: string,
  peerName: string | undefined,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  if (isRecalledChatMessage(message))
    return chatRecallNotice(message.sender_id, viewerId, peerName, t);
  switch (message.msg_type.toLocaleLowerCase()) {
    case "image":
      return t("message.image");
    case "video":
      return t("message.video");
    case "voice":
      return t("message.voice");
    case "sticker":
      return t("message.sticker");
    default:
      return message.content;
  }
}

function isImageMessage(message: Message): boolean {
  return message.msg_type.toLocaleLowerCase() === "image" && message.content.trim().length > 0;
}

function isVideoMessage(message: Message): boolean {
  return message.msg_type.toLocaleLowerCase() === "video" && message.content.trim().length > 0;
}

function isVoiceMessage(message: Message): boolean {
  return message.msg_type.toLocaleLowerCase() === "voice" && message.content.trim().length > 0;
}

function directDraftQuote(
  message: Message,
  viewerId: string | undefined,
  peerName: string | undefined,
  selfName: string,
): ChatDraftQuote {
  return {
    message_id: message.id,
    sender_id: message.sender_id,
    sender_name: message.sender_id === viewerId ? selfName : (peerName ?? message.sender_id),
    msg_type: message.msg_type,
    content: message.content,
    timestamp: message.timestamp,
  };
}

function messageFromDraftQuote(quote: ChatDraftQuote, peerId: string): Message {
  return {
    id: quote.message_id,
    sender_id: quote.sender_id,
    receiver_id: peerId,
    msg_type: quote.msg_type,
    content: quote.content,
    timestamp: quote.timestamp,
    version: 1,
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  chatContent: { flex: 1 },
  timelineSurface: { flex: 1 },
  backgroundLayer: { position: "absolute", inset: 0 },
  list: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
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
  retryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
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
  messageSeparator: { height: 4 },
  timelineLocatorHost: { bottom: 14, position: "absolute", right: 12 },
  rowSpacer: { flex: 1, minWidth: 40 },
  messageColumn: { maxWidth: "72%", alignItems: "flex-start", rowGap: 2 },
  mineColumn: { alignItems: "flex-end" },
  messageContentRow: { alignItems: "center", columnGap: 6, flexDirection: "row" },
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
  otherBubble: { backgroundColor: colors.card, borderBottomLeftRadius: 0 },
  mineText: { color: "#FFFFFF", fontSize: 16, lineHeight: 21 },
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
  recalledText: {
    width: "100%",
    paddingVertical: 7,
    color: colors.secondaryText,
    fontSize: 12,
    textAlign: "center",
  },
  systemRow: { width: "100%", paddingVertical: 4, alignItems: "center" },
  systemText: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    overflow: "hidden",
    borderRadius: 4,
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
    shadowColor: "#000000",
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
  composerIconButton: { width: 42, height: 54, alignItems: "center", justifyContent: "center" },
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
  plusIconBox: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5E5EA",
  },
  plusTitle: { color: colors.secondaryText, fontSize: 11 },
});
