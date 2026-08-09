import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
  createIdempotencyKey,
  createAgentConversation,
  createAgentTurn,
  getAgent,
  getAgentMessages,
  getAgentRuntimeConfig,
  getAgentTurn,
  unlockAgentMedia,
  uploadAgentChatImage,
} from "@/api/bwchat";
import type { AgentTurnInputPart } from "@/api/bwchat";
import { APIError } from "@/api/client";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { AgentMessageView } from "@/components/agents/AgentMessageView";
import { AgentVideoRoleMatchDialog } from "@/components/agents/AgentVideoRoleMatchDialog";
import {
  ImageGallery,
  type GalleryFrame,
  type ImageGallerySelection,
} from "@/components/media/ImageGallery";
import { VideoPlayerOverlay } from "@/components/media/VideoPlayerOverlay";
import { chatComposerInputHeight } from "@/components/messages/ChatComposerInputHeight";
import { ChatKeyboardAvoidingView } from "@/components/messages/ChatKeyboardAvoidingView";
import { ChatMessageActionOverlay } from "@/components/messages/ChatReplyViews";
import { TopToast } from "@/components/TopToast";
import { env } from "@/config/env";
import type { AgentConversation, AgentMessage, AgentRuntimeConfig, AgentTurn } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { usePropInventory } from "@/providers/PropInventoryProvider";
import { useWallet } from "@/providers/WalletProvider";
import {
  rememberAgentForEditing,
  subscribeAgentUpdates,
} from "@/services/agents/AgentEditNavigationStore";
import {
  discardAgentComposerImage,
  prepareAgentComposerImage,
} from "@/services/agents/AgentComposerImageService";
import { loadAgentChatPage, saveAgentChatPage } from "@/services/agents/AgentChatCache";
import { upsertCachedAgentConversation } from "@/services/agents/AgentCatalogRepository";
import {
  agentGeneratedMediaPollingDecision,
  agentTerminalTurnNotice,
  agentTurnExpectsGeneratedMedia,
  agentTurnPollingPolicy,
  agentTurnProgressStatus,
  agentTurnResponseMessages,
  isAgentTurnTerminal,
  isRenderableAgentMessage,
  mergeAgentTimeline,
  newestAgentTurnIds,
  shouldWaitForAgentTerminalResponse,
  type AgentGeneratedMediaPollingDecision,
  type AgentTurnNotice,
} from "@/services/agents/AgentChatTurnPolicy";
import { getAgentConversation } from "@/services/agents/AgentConversationRepository";
import {
  agentGalleryImagePaths,
  agentImageGenerationBlockReason,
  agentImageReplySenderLabel,
  agentTransformOutboundText,
  type AgentImageReplyTarget,
} from "@/services/agents/AgentImageReplyPolicy";
import {
  agentMessageLayout,
  agentMessageScope,
  isCurrentAgentMessageScope,
} from "@/services/agents/AgentMessagePresentationPolicy";
import type { ChatMessageAnchor } from "@/services/messages/chatReplyPolicy";
import { saveImageToLibrary, saveVideoToLibrary } from "@/services/media/MediaLibrarySaver";
import {
  applyAgentMediaUnlockToMessages,
  isAgentMediaUnlocked,
  settleAgentMediaUnlock,
} from "@/services/props/AgentMediaUnlockState";
import type { MediaUnlockKind } from "@/services/props/PropInventoryModels";
import { agentVideoDefaultRole } from "@/services/live/AgentLiveMatchPresentation";
import { getCurrentLiveSlot } from "@/services/live/LiveLobbyRepository";
import { useAgentLiveVideoMatch } from "@/services/live/useAgentLiveVideoMatch";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

interface AgentPendingSubmission {
  text: string;
  imageUri: string | null;
  imageFilename: string | null;
  replyToId: string | null;
  uploadIdempotencyKey: string | null;
  clientMessageId: string;
  turnIdempotencyKey: string;
}

interface AgentImageMenuTarget {
  target: AgentImageReplyTarget;
  anchor: ChatMessageAnchor;
}

export default function AgentChatScreen() {
  const {
    conversationId = "",
    agentId = "",
    name: initialName = "智能体",
    avatarId: initialAvatarId = "",
  } = useLocalSearchParams<{
    conversationId?: string;
    agentId?: string;
    name?: string;
    avatarId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialName);
  const [displayAvatarId, setDisplayAvatarId] = useState(initialAvatarId);
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const conversationRef = useRef<AgentConversation | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<AgentRuntimeConfig | null>(null);
  const runtimeConfigRef = useRef<AgentRuntimeConfig | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const messagesRef = useRef<AgentMessage[]>([]);
  const listRef = useRef<FlatList<AgentMessage>>(null);
  const timelineScopeRef = useRef(`pending:${conversationId}`);
  const scopeGenerationRef = useRef(0);
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const [draft, setDraft] = useState("");
  const initialInputHeight = chatComposerInputHeight(draft);
  const [composerImage, setComposerImage] = useState<{ uri: string; filename: string } | null>(
    null,
  );
  const composerImageRef = useRef<{ uri: string; filename: string } | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [imageReplyTarget, setImageReplyTarget] = useState<AgentImageReplyTarget | null>(null);
  const [isLoadingReplyImage, setLoadingReplyImage] = useState(false);
  const [imageMenuTarget, setImageMenuTarget] = useState<AgentImageMenuTarget | null>(null);
  const imageMenuOwnsTouchRef = useRef(false);
  const imageMenuReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imagePreparationGenerationRef = useRef(0);
  const [imageSelection, setImageSelection] = useState<ImageGallerySelection | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isPreparingImage, setPreparingImage] = useState(false);
  const [isFocused, setFocused] = useState(false);
  const [isLoading, setLoading] = useState(true);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [hasMore, setHasMore] = useState(false);
  const hasMoreRef = useRef(false);
  const [isSending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [isOpeningSettings, setOpeningSettings] = useState(false);
  const openingSettingsRef = useRef(false);
  const [needsWalletTopUp, setNeedsWalletTopUp] = useState(false);
  const [requiresLatestVersionConversation, setRequiresLatestVersionConversation] = useState(false);
  const [isCreatingLatestVersionConversation, setCreatingLatestVersionConversation] =
    useState(false);
  const creatingLatestVersionConversationRef = useRef(false);
  const [optimisticText, setOptimisticText] = useState<string | null>(null);
  const [turnStatus, setTurnStatus] = useState<string | null>(null);
  const [turnMediaDecision, setTurnMediaDecision] =
    useState<AgentGeneratedMediaPollingDecision | null>(null);
  const [isAwaitingGeneratedMedia, setAwaitingGeneratedMedia] = useState(false);
  const [isAwaitingTerminalResponse, setAwaitingTerminalResponse] = useState(false);
  const [turnNotice, setTurnNotice] = useState<AgentTurnNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedSubmission, setLastFailedSubmission] = useState<AgentPendingSubmission | null>(
    null,
  );
  const lastSubmissionRef = useRef<AgentPendingSubmission | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [videoRoleDialog, setVideoRoleDialog] = useState<{ initialRole: string } | null>(null);
  const [isLoadingVideoRoleDialog, setLoadingVideoRoleDialog] = useState(false);
  const [unlockingMediaIds, setUnlockingMediaIds] = useState<Set<string>>(() => new Set());
  const pollGenerationRef = useRef(0);
  const expectedMediaTurnIdsRef = useRef(new Set<string>());
  const hasResumedTurnsRef = useRef(false);
  const unlockLifecycleRef = useRef(0);
  const unlockingMediaIdsRef = useRef(new Set<string>());
  const unlockIdempotencyKeysRef = useRef(new Map<string, string>());
  const unlockOperationTokensRef = useRef(new Map<string, string>());
  const videoRoleDialogGenerationRef = useRef(0);
  const videoRoleDialogLoadingRef = useRef(false);
  const latestVersionConversationIdempotencyRef = useRef(createIdempotencyKey());
  const { applyBalance, balance, refreshBalance } = useWallet();
  const { user } = useAuth();
  const { t } = useLocalization();
  const ownerId = user?.user_id ?? "";
  const { applyMediaConsumption, load: loadPropInventory } = usePropInventory();
  const dismissVideoRoleDialog = useCallback(() => setVideoRoleDialog(null), []);
  const videoMatch = useAgentLiveVideoMatch({ onConnected: dismissVideoRoleDialog });
  const cancelVideoMatch = videoMatch.cancel;

  useEffect(() => {
    composerImageRef.current = composerImage;
  }, [composerImage]);

  useEffect(
    () => () => {
      scopeGenerationRef.current += 1;
      imagePreparationGenerationRef.current += 1;
      pollGenerationRef.current += 1;
      unlockLifecycleRef.current += 1;
      videoRoleDialogGenerationRef.current += 1;
      sendingRef.current = false;
      openingSettingsRef.current = false;
      creatingLatestVersionConversationRef.current = false;
      cancelVideoMatch();
      const composerUri = composerImageRef.current?.uri;
      const submissionUri = lastSubmissionRef.current?.imageUri;
      discardAgentComposerImage(composerUri);
      if (submissionUri !== composerUri) discardAgentComposerImage(submissionUri);
      if (imageMenuReleaseTimerRef.current) clearTimeout(imageMenuReleaseTimerRef.current);
    },
    [cancelVideoMatch],
  );

  const avatarUrl = displayAvatarId
    ? resolveMediaUrl(`/agent-assets/${encodeURIComponent(displayAvatarId)}`, env.apiBaseUrl)
    : null;

  useEffect(
    () =>
      subscribeAgentUpdates((agent) => {
        if (agent.id !== agentId) return;
        setDisplayName(agent.profile?.name?.trim() || initialName);
        setDisplayAvatarId(
          agent.avatar_asset_id ?? agent.profile?.avatar_asset_id ?? initialAvatarId,
        );
        setRequiresLatestVersionConversation(true);
      }),
    [agentId, initialAvatarId, initialName],
  );

  const setTimeline = useCallback(
    (next: AgentMessage[]) => {
      const previousLatest = messagesRef.current.at(-1);
      messagesRef.current = next;
      setMessages(next);
      const nextLatest = next.at(-1);
      let cachedConversation = conversationRef.current;
      if (
        cachedConversation &&
        nextLatest &&
        (previousLatest?.id !== nextLatest.id ||
          previousLatest.updated_at !== nextLatest.updated_at)
      ) {
        cachedConversation = {
          ...cachedConversation,
          latest_message: nextLatest,
          updated_at: nextLatest.updated_at || cachedConversation.updated_at,
        };
        conversationRef.current = cachedConversation;
        setConversation(cachedConversation);
        if (ownerId) {
          void upsertCachedAgentConversation(ownerId, cachedConversation).catch(() => false);
        }
      }
      if (ownerId && conversationId) {
        void saveAgentChatPage(
          ownerId,
          conversationId,
          next,
          hasMoreRef.current,
          cachedConversation,
        ).catch(() => {});
      }
    },
    [conversationId, ownerId],
  );

  const updateHasMore = useCallback((next: boolean) => {
    hasMoreRef.current = next;
    setHasMore(next);
  }, []);

  useEffect(() => {
    const scope = agentMessageScope(ownerId, conversationId);
    if (timelineScopeRef.current === scope) return;
    timelineScopeRef.current = scope;
    scopeGenerationRef.current += 1;
    imagePreparationGenerationRef.current += 1;
    unlockLifecycleRef.current += 1;
    unlockingMediaIdsRef.current.clear();
    unlockIdempotencyKeysRef.current.clear();
    unlockOperationTokensRef.current.clear();
    expectedMediaTurnIdsRef.current.clear();
    const composerUri = composerImageRef.current?.uri;
    const submissionUri = lastSubmissionRef.current?.imageUri;
    discardAgentComposerImage(composerUri);
    if (submissionUri !== composerUri) discardAgentComposerImage(submissionUri);
    composerImageRef.current = null;
    lastSubmissionRef.current = null;
    sendingRef.current = false;
    openingSettingsRef.current = false;
    creatingLatestVersionConversationRef.current = false;
    latestVersionConversationIdempotencyRef.current = createIdempotencyKey();
    videoRoleDialogGenerationRef.current += 1;
    videoRoleDialogLoadingRef.current = false;
    cancelVideoMatch();
    loadPromiseRef.current = null;
    messagesRef.current = [];
    hasMoreRef.current = false;
    setMessages([]);
    setHasMore(false);
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setDraft("");
    setComposerImage(null);
    setImageReplyTarget(null);
    setLoadingReplyImage(false);
    setPreparingImage(false);
    setFocused(false);
    setImageMenuTarget(null);
    imageMenuOwnsTouchRef.current = false;
    if (imageMenuReleaseTimerRef.current) clearTimeout(imageMenuReleaseTimerRef.current);
    imageMenuReleaseTimerRef.current = null;
    setImageSelection(null);
    setToastMessage(null);
    setSending(false);
    setOpeningSettings(false);
    setCreatingLatestVersionConversation(false);
    setRequiresLatestVersionConversation(false);
    setOptimisticText(null);
    setLastFailedSubmission(null);
    setPreviewVideoUrl(null);
    setVideoRoleDialog(null);
    setLoadingVideoRoleDialog(false);
    setUnlockingMediaIds(new Set());
    setNeedsWalletTopUp(false);
    setLoading(true);
    hasResumedTurnsRef.current = false;
    pollGenerationRef.current += 1;
    conversationRef.current = null;
    setConversation(null);
    runtimeConfigRef.current = null;
    setRuntimeConfig(null);
    setTurnStatus(null);
    setTurnNotice(null);
    setAwaitingGeneratedMedia(false);
    setAwaitingTerminalResponse(false);
    setTurnMediaDecision(null);
    setError(null);
    setDisplayName(initialName);
    setDisplayAvatarId(initialAvatarId);
  }, [cancelVideoMatch, conversationId, initialAvatarId, initialName, ownerId]);

  const replaceComposerImage = useCallback(
    (
      next: { uri: string; filename: string } | null,
      replyTarget: AgentImageReplyTarget | null = null,
    ) => {
      const previous = composerImageRef.current;
      if (previous && previous.uri !== next?.uri) discardAgentComposerImage(previous.uri);
      composerImageRef.current = next;
      setComposerImage(next);
      setImageReplyTarget(replyTarget);
    },
    [],
  );

  const clearComposerImage = useCallback(() => {
    if (lastSubmissionRef.current?.imageUri === composerImageRef.current?.uri) {
      lastSubmissionRef.current = null;
    }
    replaceComposerImage(null);
    setLastFailedSubmission(null);
  }, [replaceComposerImage]);

  const detachComposerImage = useCallback(() => {
    composerImageRef.current = null;
    setComposerImage(null);
    setImageReplyTarget(null);
  }, []);

  const performLoad = useCallback(async () => {
    const requestedScope = agentMessageScope(ownerId, conversationId);
    const scopeGeneration = scopeGenerationRef.current;
    const isCurrentLoad = () =>
      isCurrentAgentChatOperation(
        timelineScopeRef.current,
        requestedScope,
        scopeGenerationRef.current,
        scopeGeneration,
      );
    if (!conversationId) {
      setError("智能体会话无效");
      setLoading(false);
      return;
    }
    if (messagesRef.current.length === 0 && ownerId) {
      const cached = await loadAgentChatPage(ownerId, conversationId);
      if (!isCurrentLoad()) return;
      if (cached && messagesRef.current.length === 0) {
        if (cached.conversation) {
          conversationRef.current = cached.conversation;
          setConversation(cached.conversation);
          setDisplayName(cached.conversation.agent_profile.name || initialName);
          setDisplayAvatarId(cached.conversation.agent_profile.avatar_asset_id || initialAvatarId);
        }
        updateHasMore(cached.hasMore);
        messagesRef.current = cached.messages;
        setMessages(cached.messages);
        setLoading(false);
      }
    }
    setLoading(messagesRef.current.length === 0);
    try {
      const [page, nextConversation, nextRuntimeConfig] = await Promise.all([
        getAgentMessages(conversationId, { limit: 30 }),
        conversationRef.current
          ? Promise.resolve(conversationRef.current)
          : getAgentConversation(conversationId).catch(() => null),
        runtimeConfigRef.current
          ? Promise.resolve(runtimeConfigRef.current)
          : getAgentRuntimeConfig().catch(() => null),
      ]);
      if (!isCurrentLoad()) return;
      if (nextConversation) {
        conversationRef.current = nextConversation;
        setConversation(nextConversation);
        setDisplayName(nextConversation.agent_profile.name || initialName);
        setDisplayAvatarId(nextConversation.agent_profile.avatar_asset_id || initialAvatarId);
      }
      if (nextRuntimeConfig) {
        runtimeConfigRef.current = nextRuntimeConfig;
        setRuntimeConfig(nextRuntimeConfig);
      }
      updateHasMore(page.has_more);
      setTimeline(mergeAgentMessages(messagesRef.current, page.messages));
      setError(null);
    } catch (nextError) {
      if (isCurrentLoad() && messagesRef.current.length === 0) {
        setError(errorMessage(nextError));
      }
    } finally {
      if (isCurrentLoad()) setLoading(false);
    }
  }, [conversationId, initialAvatarId, initialName, ownerId, setTimeline, updateHasMore]);

  const load = useCallback(async () => {
    if (loadPromiseRef.current) return loadPromiseRef.current;
    const pending = performLoad().finally(() => {
      if (loadPromiseRef.current === pending) loadPromiseRef.current = null;
    });
    loadPromiseRef.current = pending;
    return pending;
  }, [performLoad]);

  useEffect(() => {
    if (ownerId && balance === null) void refreshBalance(true);
  }, [balance, ownerId, refreshBalance]);

  useFocusEffect(
    useCallback(() => {
      hasResumedTurnsRef.current = false;
      setUnlockingMediaIds(new Set(unlockingMediaIdsRef.current));
      void load();
      return () => {
        Keyboard.dismiss();
        pollGenerationRef.current += 1;
        unlockLifecycleRef.current += 1;
        unlockingMediaIdsRef.current.clear();
        unlockIdempotencyKeysRef.current.clear();
        unlockOperationTokensRef.current.clear();
      };
    }, [load]),
  );

  useFocusEffect(
    useCallback(
      () => () => {
        videoRoleDialogGenerationRef.current += 1;
        videoRoleDialogLoadingRef.current = false;
        cancelVideoMatch();
        setVideoRoleDialog(null);
        setLoadingVideoRoleDialog(false);
      },
      [cancelVideoMatch],
    ),
  );

  useEffect(
    () => () => {
      pollGenerationRef.current += 1;
      unlockLifecycleRef.current += 1;
    },
    [],
  );

  const loadMore = async () => {
    if (!conversationId || !hasMore || loadingMoreRef.current) return;
    const sequences = messagesRef.current.map((message) => message.sequence_no);
    if (sequences.length === 0) return;
    const firstSequence = Math.min(...sequences);
    const requestedScope = agentMessageScope(ownerId, conversationId);
    const scopeGeneration = scopeGenerationRef.current;
    const isCurrentPage = () =>
      isCurrentAgentChatOperation(
        timelineScopeRef.current,
        requestedScope,
        scopeGenerationRef.current,
        scopeGeneration,
      );
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await getAgentMessages(conversationId, {
        beforeSequence: firstSequence,
        limit: 30,
      });
      if (!isCurrentPage()) return;
      updateHasMore(page.has_more);
      setTimeline(mergeAgentMessages(messagesRef.current, page.messages));
    } catch (nextError) {
      if (isCurrentPage()) setError(errorMessage(nextError));
    } finally {
      if (isCurrentPage()) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  };

  const refreshUntilMediaUnlockIsVisible = useCallback(
    async (mediaId: string, generation: number, requestedScope: string, operationToken: string) => {
      const isCurrentUnlock = () =>
        unlockLifecycleRef.current === generation &&
        isCurrentAgentMessageScope(timelineScopeRef.current, requestedScope) &&
        unlockOperationTokensRef.current.get(mediaId) === operationToken;
      const startedAt = Date.now();
      do {
        try {
          const page = await getAgentMessages(conversationId, { limit: 30 });
          if (!isCurrentUnlock()) return;
          updateHasMore(page.has_more);
          setTimeline(mergeAgentMessages(messagesRef.current, page.messages));
          if (isAgentMediaUnlocked(page.messages, mediaId)) return;
        } catch {
          // Native keeps polling through transient reload failures.
        }
        await delay(750);
      } while (isCurrentUnlock() && Date.now() - startedAt < 30_000);
    },
    [conversationId, setTimeline, updateHasMore],
  );

  const unlockMedia = useCallback(
    async (mediaId: string, mediaType: string | undefined) => {
      if (!mediaId || unlockingMediaIdsRef.current.has(mediaId)) return;
      const requestedScope = agentMessageScope(ownerId, conversationId);
      if (!isCurrentAgentMessageScope(timelineScopeRef.current, requestedScope)) return;
      const kind: MediaUnlockKind = mediaType?.trim().toLowerCase() === "video" ? "video" : "image";
      const scope = `${mediaId}|auto:media_unlock_card_${kind}`;
      const idempotencyKey = unlockIdempotencyKeysRef.current.get(scope) ?? createIdempotencyKey();
      const operationToken = `${requestedScope}\u0000${scope}\u0000${idempotencyKey}`;
      unlockIdempotencyKeysRef.current.set(scope, idempotencyKey);
      unlockOperationTokensRef.current.set(mediaId, operationToken);
      unlockingMediaIdsRef.current.add(mediaId);
      setUnlockingMediaIds(new Set(unlockingMediaIdsRef.current));
      const generation = unlockLifecycleRef.current;
      const isCurrentUnlock = () =>
        unlockLifecycleRef.current === generation &&
        isCurrentAgentMessageScope(timelineScopeRef.current, requestedScope) &&
        unlockOperationTokensRef.current.get(mediaId) === operationToken;
      setError(null);
      try {
        const result = await unlockAgentMedia(
          mediaId,
          { type: "automatic", mediaType: kind },
          idempotencyKey,
        );
        if (!isCurrentUnlock()) return;
        unlockIdempotencyKeysRef.current.delete(scope);
        setNeedsWalletTopUp(false);
        const settlement = settleAgentMediaUnlock(result);
        if (settlement.consumption) {
          applyMediaConsumption(settlement.consumption, kind);
        }
        await Promise.all([
          settlement.balance
            ? applyBalance(settlement.balance)
            : settlement.refreshBalance
              ? refreshBalance(true)
              : Promise.resolve(),
          settlement.refreshInventory ? loadPropInventory(true) : Promise.resolve(),
        ]);
        if (!isCurrentUnlock()) return;
        setTimeline(applyAgentMediaUnlockToMessages(messagesRef.current, mediaId, result));
        await refreshUntilMediaUnlockIsVisible(mediaId, generation, requestedScope, operationToken);
      } catch (nextError) {
        if (isCurrentUnlock()) {
          const code = agentAPIErrorCode(nextError);
          if (code === 6303) setNeedsWalletTopUp(true);
          if (code !== null && code >= 6000 && code <= 6399) {
            const refreshed = await getAgentRuntimeConfig().catch(() => null);
            if (refreshed && isCurrentUnlock()) {
              runtimeConfigRef.current = refreshed;
              setRuntimeConfig(refreshed);
            }
          }
          if (isCurrentUnlock()) setError(errorMessage(nextError));
        }
      } finally {
        if (unlockOperationTokensRef.current.get(mediaId) === operationToken) {
          unlockOperationTokensRef.current.delete(mediaId);
          unlockingMediaIdsRef.current.delete(mediaId);
        }
        if (
          unlockLifecycleRef.current === generation &&
          isCurrentAgentMessageScope(timelineScopeRef.current, requestedScope)
        ) {
          setUnlockingMediaIds(new Set(unlockingMediaIdsRef.current));
        }
      }
    },
    [
      applyBalance,
      applyMediaConsumption,
      loadPropInventory,
      conversationId,
      ownerId,
      refreshBalance,
      refreshUntilMediaUnlockIsVisible,
      setTimeline,
    ],
  );

  const pollTurn = useCallback(
    async (turnId: string, generation: number, requestedScope: string, scopeGeneration: number) => {
      const isCurrentPoll = () =>
        pollGenerationRef.current === generation &&
        isCurrentAgentChatOperation(
          timelineScopeRef.current,
          requestedScope,
          scopeGenerationRef.current,
          scopeGeneration,
        );
      const startedAt = Date.now();
      let terminalWithoutMediaSince: number | null = null;
      let terminalWithoutResponseSince: number | null = null;
      while (
        isCurrentPoll() &&
        Date.now() - startedAt < agentTurnPollingPolicy.maximumDurationMilliseconds
      ) {
        try {
          const result = await getAgentTurn(turnId);
          if (!isCurrentPoll()) return;
          setTurnStatus(result.turn.status);
          let timeline = messagesRef.current;
          if (result.response_message) {
            timeline = mergeAgentMessages(timeline, [result.response_message]);
            setTimeline(timeline);
          }

          const page = await getAgentMessages(conversationId, { limit: 30 });
          if (!isCurrentPoll()) return;
          updateHasMore(page.has_more);
          timeline = mergeAgentMessages(messagesRef.current, page.messages);
          setTimeline(timeline);

          if (isAgentTurnTerminal(result.turn.status)) {
            const responses = agentTurnResponseMessages(result.turn, timeline);
            const hasRenderableResponse = responses.some(isRenderableAgentMessage);
            if (shouldWaitForAgentTerminalResponse(result.turn.status, hasRenderableResponse)) {
              setAwaitingTerminalResponse(true);
              terminalWithoutResponseSince ??= Date.now();
              if (
                Date.now() - terminalWithoutResponseSince <
                agentTurnPollingPolicy.terminalResponseAppearanceGraceMilliseconds
              ) {
                await delay(agentTurnPollingPolicy.intervalMilliseconds);
                continue;
              }
            } else {
              setAwaitingTerminalResponse(false);
              terminalWithoutResponseSince = null;
            }

            setAwaitingTerminalResponse(false);
            const expectsMedia = agentTurnExpectsGeneratedMedia(
              result.turn,
              timeline,
              expectedMediaTurnIdsRef.current,
            );
            const mediaParts = responses
              .flatMap((message) => message.parts)
              .filter(
                (part) =>
                  part.type === "paid_media" &&
                  part.metadata.media_type?.trim().toLowerCase() !== "video",
              );
            const decision = agentGeneratedMediaPollingDecision(expectsMedia, mediaParts);
            setTurnMediaDecision(decision);
            if (decision === "stop") {
              setAwaitingGeneratedMedia(false);
              expectedMediaTurnIdsRef.current.delete(result.turn.id);
              const notice = agentTerminalTurnNotice(
                result.turn,
                responses,
                expectsMedia,
                lastSubmissionRef.current !== null,
              );
              setTurnNotice(notice);
              if (!notice?.allowsRetry) releaseAgentSubmission(lastSubmissionRef);
              return;
            }
            if (decision === "waitForMediaPart") {
              setAwaitingGeneratedMedia(true);
              terminalWithoutMediaSince ??= Date.now();
              if (
                Date.now() - terminalWithoutMediaSince >=
                agentTurnPollingPolicy.terminalMediaAppearanceGraceMilliseconds
              ) {
                setAwaitingGeneratedMedia(false);
                expectedMediaTurnIdsRef.current.delete(result.turn.id);
                const notice = agentTerminalTurnNotice(
                  result.turn,
                  responses,
                  expectsMedia,
                  lastSubmissionRef.current !== null,
                );
                setTurnNotice(notice);
                if (!notice?.allowsRetry) releaseAgentSubmission(lastSubmissionRef);
                return;
              }
            } else {
              setAwaitingGeneratedMedia(true);
              terminalWithoutMediaSince = null;
            }
          } else {
            setAwaitingGeneratedMedia(expectedMediaTurnIdsRef.current.has(result.turn.id));
            setAwaitingTerminalResponse(false);
            if (!expectedMediaTurnIdsRef.current.has(result.turn.id)) setTurnMediaDecision(null);
            terminalWithoutMediaSince = null;
            terminalWithoutResponseSince = null;
          }
        } catch (nextError) {
          if (isCurrentPoll()) {
            setError(errorMessage(nextError));
          }
        }
        await delay(agentTurnPollingPolicy.intervalMilliseconds);
      }
      if (isCurrentPoll()) {
        setAwaitingGeneratedMedia(false);
        setAwaitingTerminalResponse(false);
        setTurnNotice({
          message: "智能体仍在处理，可稍后返回继续查看",
          allowsRetry: false,
          isFailure: false,
        });
      }
    },
    [conversationId, setTimeline, updateHasMore],
  );

  const resumeUnfinishedTurnIfNeeded = useCallback(async () => {
    if (hasResumedTurnsRef.current || messagesRef.current.length === 0) return;
    const requestedScope = agentMessageScope(ownerId, conversationId);
    const scopeGeneration = scopeGenerationRef.current;
    const pollGeneration = pollGenerationRef.current;
    const isCurrentResume = () =>
      pollGenerationRef.current === pollGeneration &&
      isCurrentAgentChatOperation(
        timelineScopeRef.current,
        requestedScope,
        scopeGenerationRef.current,
        scopeGeneration,
      );
    if (!isCurrentResume()) return;
    hasResumedTurnsRef.current = true;
    let newestSettledTurn: AgentTurn | null = null;
    let newestSettledResponses: AgentMessage[] = [];
    let newestSettledExpectsMedia = false;

    for (const turnId of newestAgentTurnIds(messagesRef.current)) {
      try {
        const result = await getAgentTurn(turnId);
        if (!isCurrentResume()) return;
        if (result.response_message) {
          setTimeline(mergeAgentMessages(messagesRef.current, [result.response_message]));
        }
        const timeline = messagesRef.current;
        const responses = agentTurnResponseMessages(result.turn, timeline);
        const hasRenderableResponse = responses.some(isRenderableAgentMessage);
        const expectsMedia = agentTurnExpectsGeneratedMedia(result.turn, timeline);
        const mediaParts = responses
          .flatMap((message) => message.parts)
          .filter(
            (part) =>
              part.type === "paid_media" &&
              part.metadata.media_type?.trim().toLowerCase() !== "video",
          );
        const mediaDecision = agentGeneratedMediaPollingDecision(expectsMedia, mediaParts);
        const needsPolling =
          !isAgentTurnTerminal(result.turn.status) ||
          shouldWaitForAgentTerminalResponse(result.turn.status, hasRenderableResponse) ||
          mediaDecision !== "stop";
        if (needsPolling) {
          setTurnStatus(result.turn.status);
          setAwaitingTerminalResponse(
            shouldWaitForAgentTerminalResponse(result.turn.status, hasRenderableResponse),
          );
          setAwaitingGeneratedMedia(mediaDecision !== "stop");
          setTurnMediaDecision(mediaDecision);
          const generation = pollGenerationRef.current + 1;
          pollGenerationRef.current = generation;
          void pollTurn(result.turn.id, generation, requestedScope, scopeGeneration);
          return;
        }
        if (!newestSettledTurn) {
          newestSettledTurn = result.turn;
          newestSettledResponses = responses;
          newestSettledExpectsMedia = expectsMedia;
        }
      } catch {
        // Native resumes up to five newest turns and skips individual lookup failures.
      }
    }

    if (newestSettledTurn) {
      if (!isCurrentResume()) return;
      setTurnStatus(newestSettledTurn.status);
      setTurnNotice(
        agentTerminalTurnNotice(
          newestSettledTurn,
          newestSettledResponses,
          newestSettledExpectsMedia,
          false,
        ),
      );
    }
  }, [conversationId, ownerId, pollTurn, setTimeline]);

  useEffect(() => {
    if (!isLoading && messages.length > 0) void resumeUnfinishedTurnIfNeeded();
  }, [isLoading, messages, resumeUnfinishedTurnIfNeeded]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        hasResumedTurnsRef.current = false;
        void load().finally(() => void resumeUnfinishedTurnIfNeeded());
      } else {
        pollGenerationRef.current += 1;
      }
    });
    return () => subscription.remove();
  }, [load, resumeUnfinishedTurnIfNeeded]);

  const isTurnInteractionBlocked =
    isAwaitingGeneratedMedia ||
    isAwaitingTerminalResponse ||
    (turnStatus !== null && !isAgentTurnTerminal(turnStatus));

  const chooseImage = async () => {
    if (isPreparingImage || isLoadingReplyImage || isSending || isTurnInteractionBlocked) return;
    const requestedScope = agentMessageScope(ownerId, conversationId);
    const scopeGeneration = scopeGenerationRef.current;
    const preparationGeneration = imagePreparationGenerationRef.current + 1;
    imagePreparationGenerationRef.current = preparationGeneration;
    const isCurrentPreparation = () =>
      imagePreparationGenerationRef.current === preparationGeneration &&
      isCurrentAgentChatOperation(
        timelineScopeRef.current,
        requestedScope,
        scopeGenerationRef.current,
        scopeGeneration,
      );
    setPreparingImage(true);
    setError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!isCurrentPreparation()) return;
      if (!permission.granted) {
        Alert.alert("无法访问照片", "请在系统设置中允许 BWChat 访问照片后重试。");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (!isCurrentPreparation()) return;
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      const prepared = await prepareAgentComposerImage(asset.uri);
      if (!isCurrentPreparation()) {
        discardAgentComposerImage(prepared.uri);
        return;
      }
      replaceComposerImage(prepared);
    } catch (nextError) {
      if (isCurrentPreparation()) setError(errorMessage(nextError));
    } finally {
      if (isCurrentPreparation()) setPreparingImage(false);
    }
  };

  const beginImageReply = useCallback(
    async (target: AgentImageReplyTarget) => {
      if (isLoadingReplyImage || isSending || isTurnInteractionBlocked) {
        return;
      }
      const requestedScope = agentMessageScope(ownerId, conversationId);
      const scopeGeneration = scopeGenerationRef.current;
      const preparationGeneration = imagePreparationGenerationRef.current + 1;
      imagePreparationGenerationRef.current = preparationGeneration;
      const isCurrentPreparation = () =>
        imagePreparationGenerationRef.current === preparationGeneration &&
        isCurrentAgentChatOperation(
          timelineScopeRef.current,
          requestedScope,
          scopeGenerationRef.current,
          scopeGeneration,
        );
      setLoadingReplyImage(true);
      setError(null);
      try {
        const prepared = await prepareAgentComposerImage(target.imagePath);
        if (!isCurrentPreparation()) {
          discardAgentComposerImage(prepared.uri);
          return;
        }
        replaceComposerImage(prepared, target);
        requestAnimationFrame(() => inputRef.current?.focus());
      } catch {
        if (isCurrentPreparation()) {
          setError("无法读取这张图片，请确认图片已解锁后重试");
        }
      } finally {
        if (isCurrentPreparation()) setLoadingReplyImage(false);
      }
    },
    [
      conversationId,
      isLoadingReplyImage,
      isSending,
      isTurnInteractionBlocked,
      ownerId,
      replaceComposerImage,
    ],
  );

  const releaseImageMenuTouchOwnership = useCallback(() => {
    if (imageMenuReleaseTimerRef.current) clearTimeout(imageMenuReleaseTimerRef.current);
    imageMenuReleaseTimerRef.current = setTimeout(() => {
      imageMenuOwnsTouchRef.current = false;
      imageMenuReleaseTimerRef.current = null;
    }, 150);
  }, []);

  const claimImageMenuTouchOwnership = useCallback(() => {
    if (imageMenuReleaseTimerRef.current) clearTimeout(imageMenuReleaseTimerRef.current);
    imageMenuOwnsTouchRef.current = true;
  }, []);

  const requestImageMenu = useCallback(
    (target: AgentImageReplyTarget, anchor: ChatMessageAnchor) => {
      claimImageMenuTouchOwnership();
      setImageMenuTarget((current) => current ?? { target, anchor });
    },
    [claimImageMenuTouchOwnership],
  );

  const openImageSelection = useCallback((selection: ImageGallerySelection) => {
    if (imageMenuOwnsTouchRef.current) return;
    Keyboard.dismiss();
    setFocused(false);
    setImageSelection(selection);
  }, []);

  const openAgentImage = useCallback(
    (imagePath: string, sourceId: string, sourceFrame?: GalleryFrame) => {
      if (imageMenuOwnsTouchRef.current) return;
      Keyboard.dismiss();
      setFocused(false);
      const paths = agentGalleryImagePaths(messagesRef.current);
      const images = paths.includes(imagePath) ? paths : [imagePath];
      setImageSelection({
        media: { id: sourceId, type: "image", url: imagePath },
        images,
        index: Math.max(0, images.indexOf(imagePath)),
        sourceId,
        ...(sourceFrame
          ? { sourceFrame, sourceContentMode: "fill" as const, sourceCornerRadius: 10 }
          : {}),
      });
    },
    [],
  );

  const saveAgentMedia = useCallback(
    async (mediaPath: string, isVideo: boolean) => {
      const requestedScope = agentMessageScope(ownerId, conversationId);
      const scopeGeneration = scopeGenerationRef.current;
      const result = isVideo
        ? await saveVideoToLibrary(mediaPath)
        : await saveImageToLibrary(mediaPath);
      if (
        !isCurrentAgentChatOperation(
          timelineScopeRef.current,
          requestedScope,
          scopeGenerationRef.current,
          scopeGeneration,
        )
      ) {
        return;
      }
      setToastMessage(
        result === "saved"
          ? isVideo
            ? t("media.videoSavedToAlbum")
            : t("media.savedToAlbum")
          : result === "permissionDenied"
            ? t(isVideo ? "media.videoPermissionRequired" : "media.photoPermissionRequired")
            : result === "invalidImage"
              ? t("media.invalidImageData")
              : result === "downloadFailed"
                ? t("media.videoDownloadFailed")
                : t(isVideo ? "media.videoSaveFailed" : "media.saveFailed"),
      );
    },
    [conversationId, ownerId, t],
  );

  const openAgentSettings = async () => {
    if (!agentId || openingSettingsRef.current) return;
    const requestedScope = agentMessageScope(ownerId, conversationId);
    const scopeGeneration = scopeGenerationRef.current;
    const isCurrentSettings = () =>
      isCurrentAgentChatOperation(
        timelineScopeRef.current,
        requestedScope,
        scopeGenerationRef.current,
        scopeGeneration,
      );
    openingSettingsRef.current = true;
    Keyboard.dismiss();
    setOpeningSettings(true);
    setError(null);
    try {
      const agent = await getAgent(agentId);
      if (!isCurrentSettings()) return;
      if (agent.is_owner === false) {
        setError("只能调整自己创建的智能体");
        return;
      }
      rememberAgentForEditing(agent, ownerId);
      router.push({ pathname: "/agent-creator", params: { agentId: agent.id } });
    } catch (nextError) {
      if (isCurrentSettings()) setError(errorMessage(nextError));
    } finally {
      if (isCurrentSettings()) {
        openingSettingsRef.current = false;
        setOpeningSettings(false);
      }
    }
  };

  const startLatestAgentConversation = async () => {
    if (!agentId || creatingLatestVersionConversationRef.current) return;
    const requestedScope = agentMessageScope(ownerId, conversationId);
    const scopeGeneration = scopeGenerationRef.current;
    const isCurrentCreation = () =>
      isCurrentAgentChatOperation(
        timelineScopeRef.current,
        requestedScope,
        scopeGenerationRef.current,
        scopeGeneration,
      );
    creatingLatestVersionConversationRef.current = true;
    setCreatingLatestVersionConversation(true);
    setError(null);
    try {
      const latest = await createAgentConversation(
        agentId,
        "default",
        latestVersionConversationIdempotencyRef.current,
      );
      if (!isCurrentCreation()) return;
      if (
        latest.id === conversationId &&
        latest.agent_version_id === conversationRef.current?.agent_version_id
      ) {
        throw new Error("服务端仍返回当前旧版本会话，请稍后重新进入智能体后再试");
      }
      latestVersionConversationIdempotencyRef.current = createIdempotencyKey();
      setRequiresLatestVersionConversation(false);
      if (ownerId) await upsertCachedAgentConversation(ownerId, latest).catch(() => false);
      if (!isCurrentCreation()) return;
      router.push({
        pathname: "/agent-chat",
        params: {
          conversationId: latest.id,
          agentId: latest.agent_id,
          name: latest.agent_profile.name,
          avatarId: latest.agent_profile.avatar_asset_id ?? "",
        },
      });
    } catch (nextError) {
      if (isCurrentCreation()) setError(errorMessage(nextError));
    } finally {
      if (isCurrentCreation()) {
        creatingLatestVersionConversationRef.current = false;
        setCreatingLatestVersionConversation(false);
      }
    }
  };

  const presentVideoRoleDialog = async () => {
    if (!agentId || videoRoleDialogLoadingRef.current || videoRoleDialog) return;
    const requestedScope = agentMessageScope(ownerId, conversationId);
    const scopeGeneration = scopeGenerationRef.current;
    const isCurrentRoleLoad = (generation: number) =>
      videoRoleDialogGenerationRef.current === generation &&
      isCurrentAgentChatOperation(
        timelineScopeRef.current,
        requestedScope,
        scopeGenerationRef.current,
        scopeGeneration,
      );
    videoRoleDialogLoadingRef.current = true;
    setLoadingVideoRoleDialog(true);
    setError(null);
    const generation = videoRoleDialogGenerationRef.current + 1;
    videoRoleDialogGenerationRef.current = generation;
    try {
      const currentSlot = await getCurrentLiveSlot();
      if (!isCurrentRoleLoad(generation)) return;
      if (currentSlot && currentSlot.status.trim().toLocaleLowerCase() !== "ended") {
        setError("正在直播，无法与其他在直播的人视频");
        return;
      }

      inputRef.current?.blur();
      setFocused(false);
      const profile = conversationRef.current?.agent_profile;
      const fallbackRole =
        [profile?.description, profile?.tagline, profile?.name, displayName, "智能体"]
          .map((value) => value?.trim() ?? "")
          .find((value) => value.length > 0) ?? "智能体";
      let role = fallbackRole;
      try {
        role = agentVideoDefaultRole(await getAgent(agentId), fallbackRole);
      } catch {
        // Native behavior keeps the conversation role when the optional identity refresh fails.
      }
      if (!isCurrentRoleLoad(generation)) return;
      videoMatch.reset();
      setVideoRoleDialog({ initialRole: role });
    } catch {
      if (isCurrentRoleLoad(generation)) {
        setError("暂时无法确认直播状态，请稍后重试");
      }
    } finally {
      if (isCurrentRoleLoad(generation)) {
        videoRoleDialogLoadingRef.current = false;
        setLoadingVideoRoleDialog(false);
      }
    }
  };

  const send = async (retrySubmission?: AgentPendingSubmission) => {
    const requestedScope = agentMessageScope(ownerId, conversationId);
    const scopeGeneration = scopeGenerationRef.current;
    const isCurrentSend = () =>
      isCurrentAgentChatOperation(
        timelineScopeRef.current,
        requestedScope,
        scopeGenerationRef.current,
        scopeGeneration,
      );
    const text = (retrySubmission?.text ?? draft).trim();
    const selectedImage = retrySubmission
      ? retrySubmission.imageUri && retrySubmission.imageFilename
        ? { uri: retrySubmission.imageUri, filename: retrySubmission.imageFilename }
        : null
      : composerImage;
    if (
      !conversationId ||
      (!text && !selectedImage) ||
      sendingRef.current ||
      isTurnInteractionBlocked
    ) {
      return;
    }
    if (selectedImage) {
      const blockReason = agentImageGenerationBlockReason(
        runtimeConfig,
        conversation?.agent_capabilities ?? null,
        messagesRef.current,
      );
      if (blockReason) {
        setError(blockReason);
        return;
      }
    }
    sendingRef.current = true;
    const submission: AgentPendingSubmission = retrySubmission ?? {
      text,
      imageUri: selectedImage?.uri ?? null,
      imageFilename: selectedImage?.filename ?? null,
      replyToId: imageReplyTarget?.messageId ?? null,
      uploadIdempotencyKey: selectedImage ? createIdempotencyKey() : null,
      clientMessageId: createIdempotencyKey(),
      turnIdempotencyKey: createIdempotencyKey(),
    };
    const previousSubmission = lastSubmissionRef.current;
    if (previousSubmission !== submission && previousSubmission?.imageUri !== submission.imageUri) {
      discardAgentComposerImage(previousSubmission?.imageUri);
    }
    lastSubmissionRef.current = submission;
    setSending(true);
    setError(null);
    setTurnNotice(null);
    setAwaitingGeneratedMedia(false);
    setAwaitingTerminalResponse(false);
    setTurnMediaDecision(null);
    setLastFailedSubmission(null);
    setOptimisticText(text || null);
    try {
      const parts: AgentTurnInputPart[] = [];
      if (selectedImage && submission.uploadIdempotencyKey) {
        const assetId = await uploadAgentChatImage(
          selectedImage.uri,
          submission.uploadIdempotencyKey,
          selectedImage.filename,
        );
        if (!isCurrentSend()) return;
        parts.push({
          type: "text",
          text: agentTransformOutboundText(text),
        });
        parts.push({ type: "input_image", asset_id: assetId });
      } else if (text) {
        parts.push({ type: "text", text });
      }
      const accepted = await createAgentTurn(conversationId, parts, {
        clientMessageId: submission.clientMessageId,
        ...(submission.replyToId ? { replyToId: submission.replyToId } : {}),
        idempotencyKey: submission.turnIdempotencyKey,
      });
      if (!isCurrentSend()) return;
      setTimeline(mergeAgentMessages(messagesRef.current, [accepted.message]));
      setOptimisticText(null);
      setDraft("");
      detachComposerImage();
      setTurnStatus(accepted.turn.status);
      if (selectedImage) {
        expectedMediaTurnIdsRef.current.add(accepted.turn.id);
        setAwaitingGeneratedMedia(true);
        setTurnMediaDecision("waitForMediaPart");
      }
      const generation = pollGenerationRef.current + 1;
      pollGenerationRef.current = generation;
      void pollTurn(accepted.turn.id, generation, requestedScope, scopeGeneration);
    } catch (nextError) {
      if (!isCurrentSend()) return;
      setOptimisticText(null);
      setLastFailedSubmission(submission);
      setError(errorMessage(nextError));
      setTurnNotice({
        message: "发送失败，点击重试",
        allowsRetry: true,
        isFailure: true,
      });
      setDraft((current) => current || text);
      const code = agentAPIErrorCode(nextError);
      if (code !== null && code >= 6000 && code <= 6399) {
        const refreshed = await getAgentRuntimeConfig().catch(() => null);
        if (refreshed && isCurrentSend()) {
          runtimeConfigRef.current = refreshed;
          setRuntimeConfig(refreshed);
        }
      }
    } finally {
      if (isCurrentSend()) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  };

  const orderedMessages = useMemo(
    () => [...messages].sort(compareAgentMessages).reverse(),
    [messages],
  );
  const galleryImagePaths = useMemo(() => agentGalleryImagePaths(messages), [messages]);
  const imageAdjustmentBlockReason = composerImage
    ? agentImageGenerationBlockReason(
        runtimeConfig,
        conversation?.agent_capabilities ?? null,
        messages,
      )
    : null;
  const presentedTurnStatus = agentTurnProgressStatus({
    turnStatus,
    isAwaitingGeneratedMedia,
    isAwaitingTerminalResponse,
    mediaDecision: turnMediaDecision,
  });
  const canSubmit =
    (draft.trim().length > 0 || composerImage !== null) &&
    !isSending &&
    !isPreparingImage &&
    !isLoadingReplyImage &&
    imageAdjustmentBlockReason === null &&
    !isTurnInteractionBlocked;
  const latestMessageIdentity = messages.at(-1)
    ? `${messages.at(-1)?.id}:${messages.at(-1)?.updated_at}`
    : "";

  useEffect(() => {
    if (!messages.length && !presentedTurnStatus && !error && !turnNotice) return;
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
  }, [error, latestMessageIdentity, messages.length, presentedTurnStatus, turnNotice, turnStatus]);

  return (
    <ChatKeyboardAvoidingView style={styles.screen}>
      <Stack.Screen
        options={{
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <AgentAvatar name={displayName} size={28} uri={avatarUrl} />
              <Text numberOfLines={1} style={styles.headerName}>
                {displayName}
              </Text>
            </View>
          ),
          headerRight: () => (
            <Pressable
              accessibilityLabel="调整智能体配置"
              disabled={isOpeningSettings || !agentId}
              hitSlop={10}
              onPress={() => void openAgentSettings()}
            >
              {isOpeningSettings ? (
                <ActivityIndicator color={colors.secondaryText} size="small" />
              ) : (
                <SymbolView
                  name="slider.horizontal.3"
                  size={16}
                  weight="semibold"
                  tintColor={colors.text}
                />
              )}
            </Pressable>
          ),
        }}
      />

      <View style={styles.timelineSurface}>
        <FlatList
          contentContainerStyle={styles.list}
          data={orderedMessages}
          inverted
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          keyExtractor={(message) => message.id}
          onScrollBeginDrag={() => Keyboard.dismiss()}
          onTouchStart={() => {
            Keyboard.dismiss();
            setFocused(false);
            setImageMenuTarget(null);
          }}
          ref={listRef}
          ListFooterComponent={
            hasMore || isLoadingMore ? (
              <Pressable
                disabled={isLoadingMore}
                onPress={() => void loadMore()}
                style={styles.loadMore}
              >
                {isLoadingMore ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Text style={styles.loadMoreText}>加载更早消息</Text>
                )}
              </Pressable>
            ) : null
          }
          ItemSeparatorComponent={AgentMessageTimelineSeparator}
          ListHeaderComponent={
            <View style={styles.headerTail}>
              <ConversationTail
                isSending={isSending}
                notice={turnNotice}
                optimisticText={optimisticText}
                onRetry={() => {
                  if (lastFailedSubmission) {
                    void send(lastFailedSubmission);
                    return;
                  }
                  const payload = lastSubmissionRef.current;
                  if (turnNotice?.allowsRetry && payload) {
                    setTurnNotice(null);
                    void send({
                      ...payload,
                      uploadIdempotencyKey: payload.imageUri ? createIdempotencyKey() : null,
                      clientMessageId: createIdempotencyKey(),
                      turnIdempotencyKey: createIdempotencyKey(),
                    });
                  }
                }}
                turnStatus={presentedTurnStatus}
              />
              {requiresLatestVersionConversation ? (
                <AgentVersionNotice
                  isWorking={isCreatingLatestVersionConversation}
                  onStart={() => void startLatestAgentConversation()}
                />
              ) : null}
              {needsWalletTopUp ? (
                <Pressable onPress={() => router.push("/wallet")} style={styles.walletTopUpNotice}>
                  <SymbolView
                    name="wallet.pass"
                    size={13}
                    weight="semibold"
                    tintColor={colors.accent}
                  />
                  <Text style={styles.walletTopUpText}>点数不足，前往充值</Text>
                </Pressable>
              ) : null}
              {error ? <AgentErrorNotice error={error} onDismiss={() => setError(null)} /> : null}
            </View>
          }
          renderItem={({ item }) => (
            <AgentMessageView
              allMessages={messages}
              avatarUrl={avatarUrl}
              galleryImagePaths={galleryImagePaths}
              isUnlockingMedia={(mediaId) => unlockingMediaIds.has(mediaId)}
              message={item}
              name={displayName}
              onImagePress={openAgentImage}
              onImageOpen={openImageSelection}
              onImageMenuRequested={requestImageMenu}
              onImageMenuTouchSequenceStarted={claimImageMenuTouchOwnership}
              onImageMenuTouchSequenceEnded={releaseImageMenuTouchOwnership}
              onSaveMedia={(mediaPath, isVideo) => void saveAgentMedia(mediaPath, isVideo)}
              onVideoPress={setPreviewVideoUrl}
              onUnlockMedia={(mediaId, mediaType) => void unlockMedia(mediaId, mediaType)}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      </View>

      <View style={styles.composerSurface}>
        {isLoadingReplyImage ? (
          <View style={styles.loadingReplyImage}>
            <ActivityIndicator color={colors.secondaryText} size="small" />
            <Text style={styles.loadingReplyImageText}>正在载入回复图片…</Text>
          </View>
        ) : null}
        {composerImage ? (
          <View style={styles.composerImagePanel}>
            {imageReplyTarget ? (
              <AgentComposerImageReplyReference
                onCancel={clearComposerImage}
                target={imageReplyTarget}
              />
            ) : (
              <>
                <View style={styles.composerModeLabel}>
                  <SymbolView name="wand.and.stars" size={12} tintColor={colors.white} />
                  <Text style={styles.composerModeText}>调整图片</Text>
                </View>
                <View style={styles.composerImageWrap}>
                  <Image
                    contentFit="cover"
                    source={{ uri: composerImage.uri }}
                    style={styles.composerImage}
                  />
                  <Pressable
                    accessibilityLabel="移除图片"
                    hitSlop={8}
                    onPress={clearComposerImage}
                    style={styles.composerImageRemove}
                  >
                    <SymbolView name="xmark.circle.fill" size={22} tintColor={colors.text} />
                  </Pressable>
                </View>
              </>
            )}
            {imageAdjustmentBlockReason ? (
              <View style={styles.composerImageBlockReason}>
                <SymbolView
                  name="exclamationmark.circle.fill"
                  size={12}
                  tintColor={colors.danger}
                />
                <Text style={styles.composerImageBlockText}>{imageAdjustmentBlockReason}</Text>
              </View>
            ) : imageReplyTarget ? null : (
              <Text style={styles.composerImageHint}>
                调整图片模式：描述你希望修改的内容，智能体会基于原图生成调整后的图片
              </Text>
            )}
          </View>
        ) : null}
        <View style={[styles.composerRow, { paddingBottom: isFocused ? 5 : 12 + insets.bottom }]}>
          <View style={styles.inputChrome}>
            <TextInput
              maxLength={4_000}
              multiline
              onBlur={() => setFocused(false)}
              onChangeText={setDraft}
              onFocus={() => setFocused(true)}
              onSubmitEditing={() => void send()}
              placeholder="输入消息..."
              placeholderTextColor={colors.tertiaryText}
              returnKeyType="send"
              ref={inputRef}
              style={[
                styles.input,
                initialInputHeight !== undefined && { height: initialInputHeight },
              ]}
              submitBehavior="submit"
              value={draft}
            />
          </View>
          <View style={[styles.composerActions, isFocused && styles.focusedActions]}>
            {!isFocused ? (
              <>
                <Pressable
                  accessibilityLabel="发送图片"
                  disabled={
                    isPreparingImage || isLoadingReplyImage || isSending || isTurnInteractionBlocked
                  }
                  onPress={() => void chooseImage()}
                  style={styles.actionButton}
                >
                  {isPreparingImage ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <SymbolView
                      name="photo.on.rectangle.angled"
                      size={25}
                      tintColor={colors.accent}
                    />
                  )}
                </Pressable>
                <Pressable
                  accessibilityLabel="发送视频"
                  disabled={
                    isPreparingImage ||
                    isLoadingReplyImage ||
                    isLoadingVideoRoleDialog ||
                    isSending ||
                    isTurnInteractionBlocked ||
                    !agentId
                  }
                  onPress={() => void presentVideoRoleDialog()}
                  style={styles.actionButton}
                >
                  {isLoadingVideoRoleDialog ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <SymbolView name="video.fill" size={23} tintColor={colors.accent} />
                  )}
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityLabel="发送"
                disabled={!canSubmit}
                onPress={() => void send()}
                style={styles.actionButton}
              >
                <LinearGradient
                  colors={
                    canSubmit
                      ? [colors.accent, colors.accentDark]
                      : [colors.separator, colors.separator]
                  }
                  end={{ x: 1, y: 1 }}
                  start={{ x: 0, y: 0 }}
                  style={styles.sendCircle}
                >
                  {isSending ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <SymbolView
                      name="arrow.up"
                      size={15}
                      weight="bold"
                      tintColor={canSubmit ? colors.white : colors.tertiaryText}
                    />
                  )}
                </LinearGradient>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <ImageGallery onClose={() => setImageSelection(null)} selection={imageSelection} />
      <VideoPlayerOverlay onClose={() => setPreviewVideoUrl(null)} videoUrl={previewVideoUrl} />
      <ChatMessageActionOverlay
        actions={imageMenuTarget ? ["quote"] : []}
        anchor={imageMenuTarget?.anchor ?? null}
        onDismiss={() => setImageMenuTarget(null)}
        onSelect={() => {
          const target = imageMenuTarget?.target;
          setImageMenuTarget(null);
          if (target) void beginImageReply(target);
        }}
      />
      {videoRoleDialog ? (
        <AgentVideoRoleMatchDialog
          controller={videoMatch}
          initialRole={videoRoleDialog.initialRole}
          onDismiss={dismissVideoRoleDialog}
          sourceAgentId={agentId}
        />
      ) : null}
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </ChatKeyboardAvoidingView>
  );
}

function AgentComposerImageReplyReference({
  target,
  onCancel,
}: {
  target: AgentImageReplyTarget;
  onCancel: () => void;
}) {
  const imageUrl = resolveMediaUrl(target.imagePath, env.apiBaseUrl) ?? target.imagePath;
  return (
    <View style={styles.composerReplyReference}>
      <View style={styles.composerReplyIndicator} />
      <View style={styles.composerReplyText}>
        <Text numberOfLines={1} style={styles.composerReplyTitle}>
          回复 {agentImageReplySenderLabel(target)}
        </Text>
        <View style={styles.composerReplyDetailRow}>
          <SymbolView name="photo" size={11} weight="medium" tintColor={colors.text} />
          <Text numberOfLines={1} style={styles.composerReplyDetail}>
            输入调整要求
          </Text>
        </View>
      </View>
      <AuthenticatedImage
        contentFit="cover"
        style={styles.composerReplyThumbnail}
        transition={0}
        uri={imageUrl}
      />
      <Pressable
        accessibilityLabel="取消"
        hitSlop={8}
        onPress={onCancel}
        style={styles.composerReplyCancel}
      >
        <SymbolView name="xmark" size={11} weight="semibold" tintColor={colors.secondaryText} />
      </Pressable>
    </View>
  );
}

function AgentVersionNotice({ isWorking, onStart }: { isWorking: boolean; onStart: () => void }) {
  return (
    <View style={styles.versionNotice}>
      <View style={styles.versionNoticeTitleRow}>
        <SymbolView
          name="arrow.triangle.2.circlepath"
          size={13}
          weight="semibold"
          tintColor={colors.text}
        />
        <Text style={styles.versionNoticeTitle}>智能体新版本已发布</Text>
      </View>
      <Text style={styles.versionNoticeDetail}>
        当前对话仍使用旧版本。新配置和图片能力需要在新会话中生效。
      </Text>
      <Pressable disabled={isWorking} onPress={onStart} style={styles.versionNoticeActionRow}>
        {isWorking ? <ActivityIndicator color={colors.accent} size="small" /> : null}
        <Text style={styles.versionNoticeAction}>
          {isWorking ? "正在创建…" : "使用新版本开始对话"}
        </Text>
      </Pressable>
    </View>
  );
}

function ConversationTail({
  optimisticText,
  turnStatus,
  notice,
  isSending,
  onRetry,
}: {
  optimisticText: string | null;
  turnStatus: string | null;
  notice: AgentTurnNotice | null;
  isSending: boolean;
  onRetry: () => void;
}) {
  const isWorking = turnStatus !== null;
  if (!optimisticText && !isWorking && !notice) return null;
  return (
    <View style={styles.tail}>
      {optimisticText ? (
        <View style={styles.optimisticRow}>
          <View style={styles.optimisticColumn}>
            <LinearGradient
              colors={[colors.accent, colors.accentDark]}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={[styles.textBubble, styles.mineBubble]}
            >
              <Text style={styles.mineText}>{optimisticText}</Text>
            </LinearGradient>
            <ActivityIndicator color={colors.secondaryText} size="small" />
          </View>
        </View>
      ) : null}
      {isWorking ? (
        <View style={styles.turnProgress}>
          <ActivityIndicator color={colors.secondaryText} size="small" />
          <Text style={styles.turnProgressText}>{turnProgressMessage(turnStatus)}</Text>
        </View>
      ) : null}
      {notice ? (
        <View style={notice.isFailure ? styles.failureTurnNotice : styles.turnNotice}>
          <SymbolView
            name={notice.isFailure ? "exclamationmark.triangle.fill" : "info.circle.fill"}
            size={15}
            tintColor={notice.isFailure ? colors.danger : colors.warning}
          />
          <Text
            numberOfLines={4}
            style={notice.isFailure ? styles.failureTurnNoticeText : styles.turnNoticeText}
          >
            {notice.message}
          </Text>
          {notice.allowsRetry && !isSending ? (
            <Pressable onPress={onRetry}>
              <Text
                style={notice.isFailure ? styles.failureTurnNoticeAction : styles.turnNoticeAction}
              >
                重试
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function AgentMessageTimelineSeparator() {
  return <View style={styles.messageSeparator} />;
}

function AgentErrorNotice({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <View style={styles.errorNotice}>
      <SymbolView name="exclamationmark.circle" size={15} tintColor={colors.danger} />
      <Text numberOfLines={3} style={styles.errorNoticeText}>
        {error}
      </Text>
      <Pressable onPress={onDismiss}>
        <Text style={styles.errorAction}>关闭</Text>
      </Pressable>
    </View>
  );
}

function AgentAvatar({ name, size, uri }: { name: string; size: number; uri: string | null }) {
  const fallback = (
    <LinearGradient
      colors={[colors.accent, colors.accentDark]}
      style={[styles.agentAvatarFallback, { width: size, height: size, borderRadius: size * 0.22 }]}
    >
      <SymbolView name="sparkles" size={size * 0.34} weight="semibold" tintColor={colors.white} />
      <Text style={styles.hiddenLabel}>{name}</Text>
    </LinearGradient>
  );
  return uri ? (
    <AuthenticatedImage
      contentFit="cover"
      fallback={fallback}
      uri={uri}
      style={{ width: size, height: size, borderRadius: size * 0.22 }}
      transition={0}
    />
  ) : (
    fallback
  );
}

export function mergeAgentMessages(
  current: readonly AgentMessage[],
  incoming: readonly AgentMessage[],
): AgentMessage[] {
  return mergeAgentTimeline(current, incoming);
}

export function isCurrentAgentChatOperation(
  currentScope: string,
  requestedScope: string,
  currentGeneration: number,
  requestedGeneration: number,
): boolean {
  return (
    currentGeneration === requestedGeneration &&
    isCurrentAgentMessageScope(currentScope, requestedScope)
  );
}

function compareAgentMessages(left: AgentMessage, right: AgentMessage) {
  return left.sequence_no - right.sequence_no || left.id.localeCompare(right.id);
}

function turnProgressMessage(status: string | null): string {
  if (status === "waiting_tools") return "文字回复已到达，图片仍在生成…";
  if (status === "waiting_image") return "正在处理图片，请稍候…";
  if (status === "waiting_response") return "正在同步智能体回复…";
  return "智能体正在回复…";
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "操作失败，请稍后重试";
}

function agentAPIErrorCode(error: unknown): number | null {
  if (!(error instanceof APIError)) return null;
  const payload = isUnknownRecord(error.payload) ? error.payload : null;
  const nestedError = payload && isUnknownRecord(payload.error) ? payload.error : null;
  const nestedData = payload && isUnknownRecord(payload.data) ? payload.data : null;
  for (const value of [error.code, payload?.code, nestedError?.code, nestedData?.code]) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function releaseAgentSubmission(ref: { current: AgentPendingSubmission | null }): void {
  discardAgentComposerImage(ref.current?.imageUri);
  ref.current = null;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  headerTitle: { maxWidth: 230, flexDirection: "row", alignItems: "center", columnGap: 8 },
  headerName: { flexShrink: 1, color: colors.text, fontSize: 16, fontWeight: "600" },
  agentAvatarFallback: { alignItems: "center", justifyContent: "center" },
  hiddenLabel: { position: "absolute", opacity: 0 },
  timelineSurface: { flex: 1 },
  initialLoading: { marginTop: 54 },
  blockingState: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: "center",
    justifyContent: "center",
    rowGap: 14,
  },
  blockingText: { color: colors.secondaryText, fontSize: 14, textAlign: "center" },
  retryButton: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
  },
  retryText: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  list: { paddingHorizontal: 12, paddingVertical: 14 },
  loadMore: {
    minHeight: 38,
    marginTop: agentMessageLayout.timelineItemSpacing,
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreText: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  textBubble: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16 },
  mineBubble: { alignSelf: "flex-end" },
  mineText: { color: colors.white, fontSize: 15, lineHeight: 20 },
  headerTail: { rowGap: 10, marginBottom: agentMessageLayout.timelineItemSpacing },
  messageSeparator: { height: agentMessageLayout.timelineItemSpacing },
  versionNotice: {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    alignItems: "flex-start",
    rowGap: 9,
    backgroundColor: colors.accentSoft,
  },
  versionNoticeTitleRow: { flexDirection: "row", alignItems: "center", columnGap: 6 },
  versionNoticeTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  versionNoticeDetail: { color: colors.secondaryText, fontSize: 12 },
  versionNoticeActionRow: { flexDirection: "row", alignItems: "center", columnGap: 7 },
  versionNoticeAction: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  walletTopUpNotice: {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 7,
    backgroundColor: colors.accentSoft,
  },
  walletTopUpText: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  tail: { rowGap: 10 },
  optimisticRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingLeft: 48,
  },
  optimisticColumn: { maxWidth: 290, alignItems: "flex-end", rowGap: 4 },
  turnProgress: {
    padding: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 9,
    backgroundColor: colors.card,
  },
  turnProgressText: { color: colors.secondaryText, fontSize: 13 },
  turnNotice: {
    padding: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 9,
    backgroundColor: "rgba(255,149,0,0.08)",
  },
  turnNoticeText: { flex: 1, color: colors.warning, fontSize: 13 },
  turnNoticeAction: { color: colors.warning, fontSize: 13, fontWeight: "600" },
  failureTurnNotice: {
    padding: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 9,
    backgroundColor: "rgba(255,59,48,0.08)",
  },
  failureTurnNoticeText: { flex: 1, color: colors.danger, fontSize: 13 },
  failureTurnNoticeAction: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  errorNotice: {
    padding: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
    backgroundColor: "rgba(255,59,48,0.08)",
  },
  errorNoticeText: { flex: 1, color: colors.danger, fontSize: 12 },
  errorAction: { color: colors.danger, fontSize: 12, fontWeight: "600" },
  composerSurface: {
    backgroundColor: "rgba(255,255,255,0.94)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(240,240,245,0.8)",
  },
  loadingReplyImage: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
  },
  loadingReplyImageText: { color: colors.secondaryText, fontSize: 12, fontWeight: "500" },
  composerImagePanel: { paddingHorizontal: 12, paddingTop: 9, rowGap: 8 },
  composerReplyReference: {
    minHeight: 58,
    paddingLeft: 9,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 9,
    backgroundColor: colors.background,
  },
  composerReplyIndicator: {
    width: 2,
    height: 44,
    borderRadius: 1,
    backgroundColor: "rgba(158,158,184,0.75)",
  },
  composerReplyText: { flex: 1, rowGap: 3 },
  composerReplyTitle: { color: colors.secondaryText, fontSize: 12, fontWeight: "500" },
  composerReplyDetailRow: { flexDirection: "row", alignItems: "center", columnGap: 4 },
  composerReplyDetail: { color: "rgba(26,26,46,0.78)", fontSize: 13 },
  composerReplyThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
  },
  composerReplyCancel: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(240,240,245,0.72)",
  },
  composerModeLabel: {
    alignSelf: "flex-start",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 5,
    backgroundColor: colors.accent,
  },
  composerModeText: { color: colors.white, fontSize: 12, fontWeight: "600" },
  composerImageWrap: { alignSelf: "flex-start" },
  composerImage: { width: 62, height: 62, borderRadius: 10, backgroundColor: colors.separator },
  composerImageRemove: {
    position: "absolute",
    top: -7,
    right: -7,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
  },
  composerImageBlockReason: {
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 5,
  },
  composerImageBlockText: { flex: 1, color: colors.danger, fontSize: 12 },
  composerImageHint: { paddingBottom: 4, color: colors.accent, fontSize: 12 },
  composerRow: {
    paddingHorizontal: 10,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
  },
  inputChrome: {
    minHeight: 54,
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.85)",
    backgroundColor: "rgba(255,255,255,0.92)",
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    justifyContent: "center",
  },
  input: {
    minHeight: 38,
    maxHeight: 120,
    paddingHorizontal: 0,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "center",
  },
  composerActions: {
    width: 86,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 2,
  },
  focusedActions: { width: 42 },
  actionButton: { width: 42, height: 54, alignItems: "center", justifyContent: "center" },
  sendCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
