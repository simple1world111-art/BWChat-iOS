import { MenuView } from "@expo/ui/community/menu";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  InteractionManager,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  getPublicAgentsPage,
  getUserMoments,
  getUserShortDramaSeries,
  toggleMomentLike,
} from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import {
  ImageGallery,
  ImageGallerySource,
  type ImageGallerySelection,
} from "@/components/media/ImageGallery";
import { VideoPlayerOverlay } from "@/components/media/VideoPlayerOverlay";
import { env } from "@/config/env";
import type {
  AgentSummary,
  Moment,
  MomentComment,
  MomentMedia,
  ShortDramaSeries,
  ShortDramaVideo,
} from "@/models";
import { useLocalization } from "@/providers/LocalizationProvider";
import { subscribeMomentMutation } from "@/services/moments/MomentMutationStore";
import {
  momentCommentContextActions,
  momentCommentContextUserId,
} from "@/services/moments/MomentCommentContextPolicy";
import { momentMediaFeedDisplayUrl } from "@/services/moments/MomentMediaPolicy";
import {
  readNavigationSnapshot,
  writeNavigationSnapshot,
} from "@/services/navigation/NavigationSnapshotCache";
import {
  mergeMoments,
  mergeProfileAgents,
  mergeShortDramaSeries,
  readCachedProfileAgentsSnapshot,
  readCachedProfileMomentsSnapshot,
  readCachedProfileShortDramasSnapshot,
  saveCachedProfileAgents,
  saveCachedProfileMoments,
  saveCachedProfileShortDramas,
  shouldAcceptMomentFirstPage,
  visibleProfileShortDramas,
} from "@/services/profile/PublicProfileContentRepository";
import { UserProfileGenerationBusySet } from "@/services/profile/UserProfilePolicy";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export type PublicProfileContentTab = "moments" | "agents" | "shortDramas";

const emptyPaneHeights: Record<PublicProfileContentTab, number> = {
  moments: 0,
  agents: 0,
  shortDramas: 0,
};

export interface PublicProfileContentHandle {
  loadMore: () => void;
  refresh: () => Promise<void>;
}

interface ViewerIdentity {
  user_id: string;
  nickname: string;
  avatar_url: string;
}

interface PublicProfileContentProps {
  ownerId: string;
  targetId: string;
  tab: PublicProfileContentTab;
  isVisible: boolean;
  viewer: ViewerIdentity;
  onOpenAgent: (agent: AgentSummary) => Promise<void> | void;
  onOpenShortDrama: (series: ShortDramaSeries, episode?: ShortDramaVideo) => void;
  onMomentCountChange: (count: number) => void;
  onToast: (message: string) => void;
}

interface PublicProfileContentNavigationSnapshot {
  moments: Moment[];
  momentsHasMore: boolean;
  agents: AgentSummary[];
  agentsCursor: string | null;
  agentsHasMore: boolean;
  agentsLoaded: boolean;
  shortDramas: ShortDramaSeries[];
  shortDramasCursor: string | null;
  shortDramasHasMore: boolean;
  shortDramasLoaded: boolean;
}

export const PublicProfileContent = forwardRef<
  PublicProfileContentHandle,
  PublicProfileContentProps
>(function PublicProfileContent(
  {
    ownerId,
    targetId,
    tab,
    isVisible,
    viewer,
    onOpenAgent,
    onOpenShortDrama,
    onMomentCountChange,
    onToast,
  },
  ref,
) {
  const [navigationSnapshot] = useState(() =>
    readNavigationSnapshot<PublicProfileContentNavigationSnapshot>(
      "public-profile-content",
      ownerId,
      targetId,
    ),
  );
  const initialMoments = navigationSnapshot?.moments ?? [];
  const initialAgents = navigationSnapshot?.agents ?? [];
  const initialShortDramas = navigationSnapshot?.shortDramas ?? [];
  const [moments, setMomentsState] = useState<Moment[]>(initialMoments);
  const momentsRef = useRef<Moment[]>(initialMoments);
  const [, setMomentsHasMore] = useState(navigationSnapshot?.momentsHasMore ?? true);
  const momentsHasMoreRef = useRef(navigationSnapshot?.momentsHasMore ?? true);
  const [momentsLoading, setMomentsLoading] = useState(!navigationSnapshot);
  const [momentsLoadingMore, setMomentsLoadingMore] = useState(false);
  const momentsBusyGenerationsRef = useRef(new UserProfileGenerationBusySet());
  const [momentsError, setMomentsError] = useState<string | null>(null);

  const [agents, setAgentsState] = useState<AgentSummary[]>(initialAgents);
  const agentsRef = useRef<AgentSummary[]>(initialAgents);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsLoadingMore, setAgentsLoadingMore] = useState(false);
  const [openingAgentIds, setOpeningAgentIds] = useState<Set<string>>(() => new Set());
  const openingAgentIdsRef = useRef<Set<string>>(new Set());
  const agentsBusyGenerationsRef = useRef(new UserProfileGenerationBusySet());
  const agentsLoadedRef = useRef(navigationSnapshot?.agentsLoaded ?? false);
  const agentsCursorRef = useRef<string | null>(navigationSnapshot?.agentsCursor ?? null);
  const agentsHasMoreRef = useRef(navigationSnapshot?.agentsHasMore ?? true);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [shortDramas, setShortDramasState] = useState<ShortDramaSeries[]>(initialShortDramas);
  const shortDramasRef = useRef<ShortDramaSeries[]>(initialShortDramas);
  const [shortDramasLoading, setShortDramasLoading] = useState(false);
  const [shortDramasLoadingMore, setShortDramasLoadingMore] = useState(false);
  const shortDramasBusyGenerationsRef = useRef(new UserProfileGenerationBusySet());
  const shortDramasLoadedRef = useRef(navigationSnapshot?.shortDramasLoaded ?? false);
  const shortDramasCursorRef = useRef<string | null>(navigationSnapshot?.shortDramasCursor ?? null);
  const shortDramasHasMoreRef = useRef(navigationSnapshot?.shortDramasHasMore ?? true);
  const [shortDramasError, setShortDramasError] = useState<string | null>(null);
  const [mediaSelection, setMediaSelection] = useState<MediaSelection | null>(null);
  const paneHeightsRef = useRef<Record<PublicProfileContentTab, number>>(emptyPaneHeights);
  const [paneHeights, setPaneHeights] =
    useState<Record<PublicProfileContentTab, number>>(emptyPaneHeights);
  const [presentedPaneHeight, setPresentedPaneHeight] = useState(0);
  const presentedPaneHeightRef = useRef(0);
  const presentedTabRef = useRef(tab);
  const lifecycleGenerationRef = useRef(0);

  useEffect(() => {
    const generation = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = generation;
    return () => {
      if (lifecycleGenerationRef.current === generation) {
        lifecycleGenerationRef.current += 1;
      }
    };
  }, []);

  useEffect(() => {
    if (!ownerId || !targetId) return;
    if (
      !navigationSnapshot &&
      momentsLoading &&
      !agentsLoadedRef.current &&
      !shortDramasLoadedRef.current
    )
      return;
    writeNavigationSnapshot<PublicProfileContentNavigationSnapshot>(
      "public-profile-content",
      ownerId,
      {
        moments,
        momentsHasMore: momentsHasMoreRef.current,
        agents,
        agentsCursor: agentsCursorRef.current,
        agentsHasMore: agentsHasMoreRef.current,
        agentsLoaded: agentsLoadedRef.current,
        shortDramas,
        shortDramasCursor: shortDramasCursorRef.current,
        shortDramasHasMore: shortDramasHasMoreRef.current,
        shortDramasLoaded: shortDramasLoadedRef.current,
      },
      targetId,
    );
  }, [
    agents,
    agentsLoading,
    moments,
    momentsLoading,
    navigationSnapshot,
    ownerId,
    shortDramas,
    shortDramasLoading,
    targetId,
  ]);

  const setMoments = useCallback(
    (next: Moment[]) => {
      momentsRef.current = next;
      setMomentsState(next);
      onMomentCountChange(next.length);
    },
    [onMomentCountChange],
  );
  const setAgents = useCallback((next: AgentSummary[]) => {
    agentsRef.current = next;
    setAgentsState(next);
  }, []);
  const setShortDramas = useCallback((next: ShortDramaSeries[]) => {
    shortDramasRef.current = next;
    setShortDramasState(next);
  }, []);

  useEffect(
    () =>
      subscribeMomentMutation(ownerId, (mutation) => {
        const current = momentsRef.current;
        if (mutation.kind === "delete") {
          if (!current.some((item) => item.id === mutation.momentId)) return;
          const next = current.filter((item) => item.id !== mutation.momentId);
          setMoments(next);
          void saveCachedProfileMoments(ownerId, targetId, {
            moments: next,
            has_more: momentsHasMoreRef.current,
          }).catch(() => undefined);
          return;
        }
        const exists = current.some((item) => item.id === mutation.moment.id);
        if (!exists && (mutation.kind !== "created" || mutation.moment.author.user_id !== targetId))
          return;
        const next = exists
          ? current.map((item) => (item.id === mutation.moment.id ? mutation.moment : item))
          : [mutation.moment, ...current];
        setMoments(next);
        void saveCachedProfileMoments(ownerId, targetId, {
          moments: next,
          has_more: momentsHasMoreRef.current,
        }).catch(() => undefined);
      }),
    [ownerId, setMoments, targetId],
  );

  const loadMoments = useCallback(
    async (reset: boolean, forceRefresh = false) => {
      if (!ownerId || !targetId) return;
      if (!reset && !momentsHasMoreRef.current) return;
      const generation = lifecycleGenerationRef.current;
      if (!momentsBusyGenerationsRef.current.tryEnter(generation)) return;
      if (reset) setMomentsLoading(momentsRef.current.length === 0 || forceRefresh);
      else setMomentsLoadingMore(true);
      setMomentsError(null);
      try {
        if (reset && !forceRefresh) {
          const cached = await readCachedProfileMomentsSnapshot(ownerId, targetId);
          if (generation !== lifecycleGenerationRef.current) return;
          if (cached?.isRetained && momentsRef.current.length === 0) {
            setMoments(cached.page.moments);
            momentsHasMoreRef.current = cached.page.has_more;
            setMomentsHasMore(cached.page.has_more);
          }
          if (cached && !cached.isStale) return;
        }
        const beforeId = reset ? undefined : momentsRef.current.at(-1)?.id;
        const page = await getUserMoments(targetId, {
          limit: 24,
          ...(beforeId !== undefined ? { beforeId } : {}),
        });
        if (generation !== lifecycleGenerationRef.current) return;
        if (reset && !shouldAcceptMomentFirstPage(page, momentsRef.current.length)) return;
        const next = reset ? page.moments : mergeMoments(momentsRef.current, page.moments);
        setMoments(next);
        momentsHasMoreRef.current = page.has_more;
        setMomentsHasMore(page.has_more);
        await saveCachedProfileMoments(ownerId, targetId, {
          ...page,
          moments: next,
        }).catch(() => undefined);
      } catch (error) {
        if (generation === lifecycleGenerationRef.current && momentsRef.current.length === 0) {
          setMomentsError(errorMessage(error));
        }
      } finally {
        momentsBusyGenerationsRef.current.leave(generation);
        if (generation === lifecycleGenerationRef.current) {
          setMomentsLoading(false);
          setMomentsLoadingMore(false);
        }
      }
    },
    [ownerId, setMoments, targetId],
  );

  const loadAgents = useCallback(
    async (reset: boolean, forceRefresh = false) => {
      if (!ownerId || !targetId) return;
      if (!reset && !agentsHasMoreRef.current) return;
      const generation = lifecycleGenerationRef.current;
      if (!agentsBusyGenerationsRef.current.tryEnter(generation)) return;
      if (reset) {
        setAgentsLoading(agentsRef.current.length === 0 || forceRefresh);
        agentsCursorRef.current = null;
        agentsHasMoreRef.current = true;
      } else setAgentsLoadingMore(true);
      setAgentsError(null);
      try {
        if (reset && !forceRefresh) {
          const cached = await readCachedProfileAgentsSnapshot(ownerId, targetId);
          if (generation !== lifecycleGenerationRef.current) return;
          if (cached?.isRetained && agentsRef.current.length === 0) {
            setAgents(cached.page.agents);
            agentsCursorRef.current = cached.page.next_cursor ?? null;
            agentsHasMoreRef.current = cached.page.has_more;
            agentsLoadedRef.current = true;
          }
          if (cached && !cached.isStale) return;
        }
        const page = await getPublicAgentsPage(targetId, {
          limit: 20,
          ...(reset || !agentsCursorRef.current ? {} : { cursor: agentsCursorRef.current }),
        });
        if (generation !== lifecycleGenerationRef.current) return;
        const next = mergeProfileAgents(reset ? [] : agentsRef.current, page.agents);
        setAgents(next);
        agentsCursorRef.current = page.next_cursor ?? null;
        agentsHasMoreRef.current = page.has_more;
        agentsLoadedRef.current = true;
        await saveCachedProfileAgents(ownerId, targetId, {
          ...page,
          agents: next,
        }).catch(() => undefined);
      } catch (error) {
        if (generation === lifecycleGenerationRef.current && agentsRef.current.length === 0) {
          setAgentsError(errorMessage(error));
        }
      } finally {
        agentsBusyGenerationsRef.current.leave(generation);
        if (generation === lifecycleGenerationRef.current) {
          setAgentsLoading(false);
          setAgentsLoadingMore(false);
        }
      }
    },
    [ownerId, setAgents, targetId],
  );

  const loadShortDramas = useCallback(
    async (reset: boolean, forceRefresh = false) => {
      if (!ownerId || !targetId) return;
      if (!reset && !shortDramasHasMoreRef.current) return;
      const generation = lifecycleGenerationRef.current;
      if (!shortDramasBusyGenerationsRef.current.tryEnter(generation)) return;
      if (reset) {
        setShortDramasLoading(shortDramasRef.current.length === 0 || forceRefresh);
        shortDramasCursorRef.current = null;
        shortDramasHasMoreRef.current = true;
      } else setShortDramasLoadingMore(true);
      setShortDramasError(null);
      try {
        if (reset && !forceRefresh) {
          const cached = await readCachedProfileShortDramasSnapshot(ownerId, targetId);
          if (generation !== lifecycleGenerationRef.current) return;
          if (cached?.isRetained && shortDramasRef.current.length === 0) {
            const visible = visibleProfileShortDramas(cached.page.series, targetId);
            setShortDramas(visible);
            shortDramasCursorRef.current = cached.page.next_cursor ?? null;
            shortDramasHasMoreRef.current = cached.page.has_more;
          }
          if (cached && !cached.isStale) {
            shortDramasLoadedRef.current = true;
            return;
          }
        }
        const page = await getUserShortDramaSeries(targetId, {
          limit: 12,
          ...(reset || !shortDramasCursorRef.current
            ? {}
            : { cursor: shortDramasCursorRef.current }),
        });
        if (generation !== lifecycleGenerationRef.current) return;
        const visible = visibleProfileShortDramas(page.series, targetId);
        const next = mergeShortDramaSeries(reset ? [] : shortDramasRef.current, visible);
        setShortDramas(next);
        shortDramasCursorRef.current = page.next_cursor ?? null;
        shortDramasHasMoreRef.current = page.has_more;
        shortDramasLoadedRef.current = true;
        await saveCachedProfileShortDramas(ownerId, targetId, {
          ...page,
          series: next,
        }).catch(() => undefined);
      } catch (error) {
        if (generation === lifecycleGenerationRef.current) {
          setShortDramasError(errorMessage(error));
        }
      } finally {
        shortDramasBusyGenerationsRef.current.leave(generation);
        if (generation === lifecycleGenerationRef.current) {
          setShortDramasLoading(false);
          setShortDramasLoadingMore(false);
        }
      }
    },
    [ownerId, setShortDramas, targetId],
  );

  useEffect(() => {
    void loadMoments(true);
  }, [loadMoments]);

  useEffect(() => {
    if (tab === "agents" && !agentsLoadedRef.current) void loadAgents(true);
    if (tab === "shortDramas" && !shortDramasLoadedRef.current) {
      void loadShortDramas(true);
    }
  }, [loadAgents, loadShortDramas, tab]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      if (!agentsLoadedRef.current) void loadAgents(true);
      if (!shortDramasLoadedRef.current) void loadShortDramas(true);
    });
    return () => task.cancel();
  }, [loadAgents, loadShortDramas]);

  useImperativeHandle(
    ref,
    () => ({
      loadMore: () => {
        if (tab === "moments") void loadMoments(false);
        else if (tab === "agents") void loadAgents(false);
        else void loadShortDramas(false);
      },
      refresh: async () => {
        if (tab === "moments") await loadMoments(true, true);
        else if (tab === "agents") await loadAgents(true, true);
        else await loadShortDramas(true, true);
      },
    }),
    [loadAgents, loadMoments, loadShortDramas, tab],
  );

  const handleLike = useCallback(
    async (moment: Moment) => {
      const generation = lifecycleGenerationRef.current;
      try {
        const liked = await toggleMomentLike(moment.id);
        if (generation !== lifecycleGenerationRef.current) return;
        const next = momentsRef.current.map((item) => {
          if (item.id !== moment.id) return item;
          const likes = item.likes.filter((author) => author.user_id !== viewer.user_id);
          if (liked) likes.push(viewer);
          return { ...item, liked_by_me: liked, likes };
        });
        setMoments(next);
        await saveCachedProfileMoments(ownerId, targetId, {
          moments: next,
          has_more: momentsHasMoreRef.current,
        }).catch(() => undefined);
      } catch (error) {
        if (generation === lifecycleGenerationRef.current) onToast(errorMessage(error));
      }
    },
    [onToast, ownerId, setMoments, targetId, viewer],
  );

  const handleOpenAgent = useCallback(
    async (agent: AgentSummary) => {
      if (openingAgentIdsRef.current.has(agent.id)) return;
      const generation = lifecycleGenerationRef.current;
      const opening = new Set(openingAgentIdsRef.current).add(agent.id);
      openingAgentIdsRef.current = opening;
      setOpeningAgentIds(opening);
      try {
        await onOpenAgent(agent);
      } catch (error) {
        if (generation === lifecycleGenerationRef.current) onToast(errorMessage(error));
      } finally {
        if (generation === lifecycleGenerationRef.current) {
          setOpeningAgentIds((current) => {
            const next = new Set(current);
            next.delete(agent.id);
            openingAgentIdsRef.current = next;
            return next;
          });
        }
      }
    },
    [onOpenAgent, onToast],
  );

  const closeMedia = useCallback(() => setMediaSelection(null), []);
  const openMedia = useCallback((selection: MediaSelection) => setMediaSelection(selection), []);
  const likeMoment = useCallback((moment: Moment) => void handleLike(moment), [handleLike]);
  const openAgent = useCallback(
    (agent: AgentSummary) => void handleOpenAgent(agent),
    [handleOpenAgent],
  );
  const retryMoments = useCallback(() => void loadMoments(true, true), [loadMoments]);
  const retryAgents = useCallback(() => void loadAgents(true, true), [loadAgents]);
  const retryShortDramas = useCallback(() => void loadShortDramas(true, true), [loadShortDramas]);
  const updatePaneHeight = useCallback((candidate: PublicProfileContentTab, height: number) => {
    const nextHeight = Math.ceil(height);
    if (nextHeight <= 0 || paneHeightsRef.current[candidate] === nextHeight) return;
    const next = { ...paneHeightsRef.current, [candidate]: nextHeight };
    paneHeightsRef.current = next;
    setPaneHeights(next);
  }, []);
  const onMomentsLayout = useCallback(
    (event: LayoutChangeEvent) => updatePaneHeight("moments", event.nativeEvent.layout.height),
    [updatePaneHeight],
  );
  const onAgentsLayout = useCallback(
    (event: LayoutChangeEvent) => updatePaneHeight("agents", event.nativeEvent.layout.height),
    [updatePaneHeight],
  );
  const onShortDramasLayout = useCallback(
    (event: LayoutChangeEvent) => updatePaneHeight("shortDramas", event.nativeEvent.layout.height),
    [updatePaneHeight],
  );
  const paneStyle = useCallback(
    (candidate: PublicProfileContentTab) => {
      const active = isVisible && tab === candidate;
      if (candidate === "moments") {
        return active ? styles.activePersistentTab : styles.inactivePersistentTab;
      }
      return active ? styles.activeTab : styles.inactiveTab;
    },
    [isVisible, tab],
  );

  useEffect(() => {
    const targetHeight = isVisible ? paneHeights[tab] : 0;
    const publishHeight = () => {
      if (presentedPaneHeightRef.current === targetHeight) return;
      presentedPaneHeightRef.current = targetHeight;
      setPresentedPaneHeight(targetHeight);
    };
    if (!isVisible || presentedTabRef.current === tab) {
      presentedTabRef.current = tab;
      publishHeight();
      return;
    }

    let frame: number | null = null;
    const requestedTab = tab;
    const task = InteractionManager.runAfterInteractions(() => {
      frame = requestAnimationFrame(() => {
        presentedTabRef.current = requestedTab;
        publishHeight();
      });
    });
    return () => {
      task.cancel();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [isVisible, paneHeights, tab]);

  return (
    <>
      <View
        style={[styles.paneHost, { height: presentedPaneHeight }]}
        testID="public-profile-pane-host"
      >
        {isVisible && tab !== "moments" ? (
          <View pointerEvents="none" style={styles.momentOcclusion} testID="moment-pane-cover" />
        ) : null}
        <View
          accessibilityElementsHidden={!isVisible || tab !== "moments"}
          importantForAccessibility={
            isVisible && tab === "moments" ? "auto" : "no-hide-descendants"
          }
          onLayout={onMomentsLayout}
          pointerEvents={isVisible && tab === "moments" ? "auto" : "none"}
          style={[styles.tabPane, paneStyle("moments")]}
          testID="public-profile-pane-moments"
        >
          <MomentList
            error={momentsError}
            isLoading={momentsLoading}
            isLoadingMore={momentsLoadingMore}
            moments={moments}
            onLike={likeMoment}
            onMedia={openMedia}
            onRetry={retryMoments}
            viewerId={viewer.user_id}
          />
        </View>
        <View
          accessibilityElementsHidden={!isVisible || tab !== "agents"}
          importantForAccessibility={isVisible && tab === "agents" ? "auto" : "no-hide-descendants"}
          onLayout={onAgentsLayout}
          pointerEvents={isVisible && tab === "agents" ? "auto" : "none"}
          style={[styles.tabPane, paneStyle("agents")]}
          testID="public-profile-pane-agents"
        >
          <AgentList
            agents={agents}
            error={agentsError}
            isLoading={agentsLoading}
            isLoadingMore={agentsLoadingMore}
            onOpen={openAgent}
            openingAgentIds={openingAgentIds}
            onRetry={retryAgents}
          />
        </View>
        <View
          accessibilityElementsHidden={!isVisible || tab !== "shortDramas"}
          importantForAccessibility={
            isVisible && tab === "shortDramas" ? "auto" : "no-hide-descendants"
          }
          onLayout={onShortDramasLayout}
          pointerEvents={isVisible && tab === "shortDramas" ? "auto" : "none"}
          style={[styles.tabPane, paneStyle("shortDramas")]}
          testID="public-profile-pane-short-dramas"
        >
          <ShortDramaList
            error={shortDramasError}
            isLoading={shortDramasLoading}
            isLoadingMore={shortDramasLoadingMore}
            onOpen={onOpenShortDrama}
            onRetry={retryShortDramas}
            series={shortDramas}
          />
        </View>
      </View>
      {isVisible && tab === "moments" ? (
        <MediaViewer onClose={closeMedia} selection={mediaSelection} />
      ) : null}
    </>
  );
});

export type MediaSelection = ImageGallerySelection;

export interface MomentCommentTarget {
  replyToUserId?: string | undefined;
  replyToName?: string | undefined;
  replyContent?: string | undefined;
}

const MomentList = memo(function MomentList({
  moments,
  isLoading,
  isLoadingMore,
  error,
  viewerId,
  onLike,
  onMedia,
  onRetry,
}: {
  moments: Moment[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  viewerId: string;
  onLike: (moment: Moment) => void;
  onMedia: (selection: MediaSelection) => void;
  onRetry: () => void;
}) {
  const { t } = useLocalization();
  if (isLoading && moments.length === 0) return <ContentLoading />;
  if (moments.length === 0 && error) return <ContentError message={error} onRetry={onRetry} />;
  if (moments.length === 0)
    return <ContentEmpty symbol="photo.on.rectangle.angled" title={t("moments.empty")} />;
  return (
    <View>
      {moments.map((moment) => (
        <MomentListItem
          key={moment.id}
          moment={moment}
          onLike={onLike}
          onMedia={onMedia}
          viewerId={viewerId}
        />
      ))}
      {isLoadingMore ? <View style={styles.moreLoading} /> : null}
    </View>
  );
});

const MomentListItem = memo(function MomentListItem({
  moment,
  onLike,
  onMedia,
  viewerId,
}: {
  moment: Moment;
  onLike: (moment: Moment) => void;
  onMedia: (selection: MediaSelection) => void;
  viewerId: string;
}) {
  const openDetail = () =>
    router.push({ pathname: "/moment-detail", params: { momentId: String(moment.id) } });
  return (
    <View>
      <MomentRow
        moment={moment}
        onComment={openDetail}
        onDelete={() => {}}
        onLike={() => onLike(moment)}
        onMedia={onMedia}
        onUnlock={openDetail}
        viewerId={viewerId}
      />
      <View style={styles.momentDivider} />
    </View>
  );
});

export function MomentRow({
  moment,
  viewerId,
  onLike,
  onMedia,
  onComment,
  onDelete,
  onUnlock,
  showsAllComments = false,
}: {
  moment: Moment;
  viewerId: string;
  onLike: () => void;
  onMedia: (selection: MediaSelection) => void;
  onComment: (target: MomentCommentTarget) => void;
  onDelete?: (() => void) | undefined;
  onUnlock: () => void;
  showsAllComments?: boolean | undefined;
}) {
  const { t } = useLocalization();
  const [showsActions, setShowsActions] = useState(false);
  const imageUrls = moment.media
    .filter((item) => item.type === "image" && item.url)
    .map((item) => item.url);
  const isPaid =
    (moment.unlock_price_gold_coins ?? 0) > 0 &&
    (moment.media.length > 0 || moment.images.length > 0);
  return (
    <View style={styles.momentRow}>
      <Pressable
        onPress={() =>
          router.push({ pathname: "/user-profile", params: { id: moment.author.user_id } })
        }
      >
        <Avatar
          cornerRadius={11}
          name={moment.author.nickname}
          size={44}
          uri={moment.author.avatar_url}
        />
      </Pressable>
      <View style={styles.momentBody}>
        <Pressable
          onPress={() =>
            router.push({ pathname: "/user-profile", params: { id: moment.author.user_id } })
          }
        >
          <Text numberOfLines={1} style={styles.momentAuthor}>
            {moment.author.nickname}
          </Text>
        </Pressable>
        {moment.content ? <Text style={styles.momentText}>{moment.content}</Text> : null}
        {moment.media.length > 0 ? (
          <MomentMediaGrid
            imageUrls={imageUrls}
            media={moment.media}
            moment={moment}
            onLocked={onUnlock}
            onOpen={onMedia}
            viewerId={viewerId}
          />
        ) : null}
        <View style={styles.momentMeta}>
          <View style={styles.timeLine}>
            <Text style={styles.momentTime}>{formatMomentTime(moment.created_at, t)}</Text>
            {isPaid && (moment.is_unlocked || moment.author.user_id === viewerId) ? (
              <Text style={styles.momentTime}>{t("moment.unlock.unlockedLabel")}</Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => setShowsActions((current) => !current)}
            style={styles.momentMore}
          >
            <SymbolView name="ellipsis" size={15} weight="bold" tintColor={colors.tertiaryText} />
          </Pressable>
        </View>
        {showsActions ? (
          <View style={styles.actionAlignment}>
            <View style={styles.momentActions}>
              <Pressable
                onPress={() => {
                  setShowsActions(false);
                  onLike();
                }}
                style={styles.momentAction}
              >
                <SymbolView
                  name={moment.liked_by_me ? "heart.fill" : "heart"}
                  size={13}
                  tintColor={colors.white}
                />
                <Text style={styles.momentActionText}>
                  {t(moment.liked_by_me ? "moments.unlike" : "moments.like")}
                </Text>
              </Pressable>
              <View style={styles.actionDivider} />
              <Pressable
                onPress={() => {
                  setShowsActions(false);
                  onComment({});
                }}
                style={styles.momentAction}
              >
                <SymbolView name="bubble.left" size={13} tintColor={colors.white} />
                <Text style={styles.momentActionText}>{t("moments.comment")}</Text>
              </Pressable>
              {moment.author.user_id === viewerId && onDelete ? (
                <>
                  <View style={styles.actionDivider} />
                  <Pressable
                    onPress={() => {
                      setShowsActions(false);
                      onDelete();
                    }}
                    style={styles.momentAction}
                  >
                    <SymbolView name="trash" size={13} tintColor={colors.white} />
                    <Text style={styles.momentActionText}>{t("common.delete")}</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          </View>
        ) : null}
        <MomentSocial
          moment={moment}
          onComment={onComment}
          onMedia={onMedia}
          showsAllComments={showsAllComments}
        />
      </View>
    </View>
  );
}

function MomentMediaGrid({
  media,
  moment,
  imageUrls,
  viewerId,
  onOpen,
  onLocked,
}: {
  media: MomentMedia[];
  moment: Moment;
  imageUrls: string[];
  viewerId: string;
  onOpen: (selection: MediaSelection) => void;
  onLocked: () => void;
}) {
  const { width } = useWindowDimensions();
  const available = Math.max(width - 88, 1);
  const columns = media.length <= 1 ? 1 : media.length === 2 || media.length === 4 ? 2 : 3;
  const cell =
    columns === 1
      ? Math.min(available, 208)
      : Math.floor((Math.min(available, 284) - 4 * (columns - 1)) / columns);
  const locked =
    (moment.unlock_price_gold_coins ?? 0) > 0 &&
    !moment.is_unlocked &&
    moment.author.user_id !== viewerId;
  return (
    <View
      style={[
        styles.mediaGrid,
        columns === 1 && styles.singleMediaGrid,
        { width: cell * columns + 4 * (columns - 1) },
      ]}
    >
      {media.map((item, index) => (
        <MomentMediaTile
          cell={cell}
          columns={columns}
          imageUrls={imageUrls}
          index={index}
          item={item}
          key={`${item.id}-${index}`}
          locked={locked}
          mediaCount={media.length}
          moment={moment}
          onLocked={onLocked}
          onOpen={onOpen}
        />
      ))}
    </View>
  );
}

function MomentMediaTile({
  cell,
  columns,
  imageUrls,
  index,
  item,
  locked,
  mediaCount,
  moment,
  onLocked,
  onOpen,
}: {
  cell: number;
  columns: number;
  imageUrls: string[];
  index: number;
  item: MomentMedia;
  locked: boolean;
  mediaCount: number;
  moment: Moment;
  onLocked: () => void;
  onOpen: (selection: MediaSelection) => void;
}) {
  const { t } = useLocalization();
  const displayUrl = momentMediaFeedDisplayUrl(item, locked);
  const resolvedUrl = resolveMediaUrl(displayUrl, env.apiBaseUrl);
  const cornerRadius = columns === 1 ? 6 : 8;
  const containerStyle = { width: cell, height: cell };
  const imageStyle = [
    styles.momentMedia,
    { width: cell, height: cell, borderRadius: cornerRadius },
  ];
  const overlays = (
    <>
      {item.type === "video" ? (
        <View style={styles.playOverlay}>
          <SymbolView
            name="play.circle.fill"
            size={cell > 120 ? 42 : 28}
            tintColor={colors.white}
          />
        </View>
      ) : null}
      {locked ? (
        <View style={styles.lockOverlay}>
          <View style={[styles.lockBadge, mediaCount > 4 && styles.lockBadgeDense]}>
            <SymbolView
              name="lock.fill"
              size={mediaCount > 4 ? 9 : mediaCount > 1 ? 10 : 12}
              weight="semibold"
              tintColor={colors.white}
            />
            <Text
              numberOfLines={1}
              style={[styles.lockText, mediaCount > 4 && styles.lockTextDense]}
            >
              {t("moment.unlock.badge", moment.unlock_price_gold_coins ?? 0)}
            </Text>
          </View>
        </View>
      ) : null}
    </>
  );
  const selection = {
    media: item,
    images: imageUrls,
    index: Math.max(0, imageUrls.indexOf(item.url)),
    ...(item.type === "video" && resolvedUrl ? { sourceUri: resolvedUrl } : {}),
  } satisfies MediaSelection;
  if (resolvedUrl && item.type === "image" && !locked) {
    return (
      <ImageGallerySource
        contentFit="cover"
        cornerRadius={cornerRadius}
        fallback={<View style={imageStyle} />}
        imageStyle={imageStyle}
        onOpen={onOpen}
        selection={selection}
        sourceId={`moment-${moment.id}-media-${item.id}-${index}`}
        style={containerStyle}
        uri={resolvedUrl}
      >
        {overlays}
      </ImageGallerySource>
    );
  }
  return (
    <Pressable onPress={() => (locked ? onLocked() : onOpen(selection))} style={containerStyle}>
      {resolvedUrl ? (
        <AuthenticatedImage
          contentFit="cover"
          loadingFallback={<View style={imageStyle} />}
          uri={resolvedUrl}
          style={imageStyle}
          transition={0}
        />
      ) : (
        <View style={imageStyle} />
      )}
      {overlays}
    </Pressable>
  );
}

function MomentSocial({
  moment,
  onComment,
  onMedia,
  showsAllComments,
}: {
  moment: Moment;
  onComment: (target: MomentCommentTarget) => void;
  onMedia: (selection: MediaSelection) => void;
  showsAllComments: boolean;
}) {
  const { t } = useLocalization();
  if (moment.likes.length === 0 && moment.comments.length === 0) return null;
  const visibleLikes = moment.likes.slice(0, 8);
  const remainingLikes = moment.likes.length - visibleLikes.length;
  const visibleComments = showsAllComments ? moment.comments : moment.comments.slice(-2);
  return (
    <View style={styles.socialBox}>
      {moment.likes.length > 0 ? (
        <View style={styles.likesRow}>
          <SymbolView name="heart.fill" size={11} tintColor="#576B95" />
          <Text numberOfLines={2} style={styles.likesText}>
            {visibleLikes.map((item) => item.nickname).join(", ")}
            {remainingLikes > 0 ? ` +${remainingLikes}` : ""}
          </Text>
        </View>
      ) : null}
      {moment.likes.length > 0 && moment.comments.length > 0 ? (
        <View style={styles.socialDivider} />
      ) : null}
      {!showsAllComments && moment.comments.length > visibleComments.length ? (
        <Pressable
          onPress={() =>
            router.push({ pathname: "/moment-detail", params: { momentId: String(moment.id) } })
          }
          style={styles.moreComments}
        >
          <Text style={styles.moreCommentsText}>
            {t("moments.comment")} · {moment.comments.length}
          </Text>
        </Pressable>
      ) : null}
      {visibleComments.map((comment) => (
        <View key={comment.id} style={styles.commentRow}>
          <MenuView
            actions={momentCommentContextActions(comment, t)}
            onPressAction={(event) => {
              const userId = momentCommentContextUserId(comment, event.nativeEvent.event);
              if (!userId?.trim()) return;
              router.push({ pathname: "/user-profile", params: { id: userId } });
            }}
            shouldOpenOnLongPress
          >
            <Pressable
              onPress={() =>
                onComment({
                  replyToUserId: comment.user_id,
                  replyToName: comment.nickname,
                  replyContent: comment.content,
                })
              }
            >
              <CommentText comment={comment} />
            </Pressable>
          </MenuView>
          {comment.image_url ? <CommentImage comment={comment} onMedia={onMedia} /> : null}
          {comment.created_at ? (
            <Text style={styles.commentTime}>{formatMomentTime(comment.created_at, t)}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function CommentImage({
  comment,
  onMedia,
}: {
  comment: MomentComment;
  onMedia: (selection: MediaSelection) => void;
}) {
  const uri = comment.image_url ?? "";
  const resolved = resolveMediaUrl(uri, env.apiBaseUrl) ?? uri;
  const media = {
    id: `comment-${comment.id}`,
    type: "image",
    url: uri,
    is_locked: false,
  } satisfies MomentMedia;
  return (
    <ImageGallerySource
      contentFit="cover"
      cornerRadius={4}
      fallback={<View style={styles.commentImage} />}
      imageStyle={styles.commentImage}
      onOpen={onMedia}
      selection={{ media, images: [uri], index: 0 }}
      sourceId={`comment-${comment.id}-image`}
      style={styles.commentImage}
      uri={resolved}
    />
  );
}

function CommentText({ comment }: { comment: MomentComment }) {
  const { t } = useLocalization();
  return (
    <Text style={styles.commentText}>
      <Text style={styles.commentName}>{comment.nickname}</Text>
      {comment.reply_to ? (
        <>
          <Text style={styles.commentSeparator}>{t("reply.separator")}</Text>
          <Text style={styles.commentName}>{comment.reply_to.nickname}</Text>
        </>
      ) : null}
      {comment.content ? `: ${comment.content}` : ""}
    </Text>
  );
}

const AgentList = memo(function AgentList({
  agents,
  isLoading,
  isLoadingMore,
  error,
  onRetry,
  onOpen,
  openingAgentIds,
}: {
  agents: AgentSummary[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (agent: AgentSummary) => void;
  openingAgentIds: ReadonlySet<string>;
}) {
  const { t } = useLocalization();
  if (isLoading && agents.length === 0) return <ContentLoading />;
  if (agents.length === 0 && error) return <ContentError message={error} onRetry={onRetry} />;
  if (agents.length === 0)
    return (
      <ContentEmpty
        symbol="sparkles.rectangle.stack"
        title={t("contacts.aiCompanions.emptyTitle")}
      />
    );
  return (
    <View style={styles.agentList}>
      {agents.map((agent) => (
        <AgentCard
          agent={agent}
          isOpening={openingAgentIds.has(agent.id)}
          key={agent.id}
          onOpen={() => onOpen(agent)}
        />
      ))}
      {isLoadingMore ? <View style={styles.moreLoading} /> : null}
    </View>
  );
});

function AgentCard({
  agent,
  onOpen,
  isOpening,
}: {
  agent: AgentSummary;
  onOpen: () => void;
  isOpening: boolean;
}) {
  const profile = agent.profile;
  const avatarId = agent.avatar_asset_id || profile?.avatar_asset_id;
  const avatar = avatarId
    ? resolveMediaUrl(`/agent-assets/${encodeURIComponent(avatarId)}`, env.apiBaseUrl)
    : null;
  const subtitle = profile?.tagline || profile?.description;
  return (
    <Pressable
      disabled={isOpening}
      onPress={onOpen}
      style={({ pressed }) => [styles.agentCard, (pressed || isOpening) && styles.agentCardPressed]}
    >
      <AgentAvatar name={profile?.name || "智能体"} size={58} uri={avatar} />
      <View style={styles.agentCopy}>
        <Text numberOfLines={1} style={styles.agentName}>
          {profile?.name || "智能体"}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} style={styles.agentSubtitle}>
            {subtitle}
          </Text>
        ) : null}
        {profile?.tags?.length ? (
          <Text numberOfLines={1} style={styles.agentTags}>
            {profile.tags.slice(0, 3).join(" · ")}
          </Text>
        ) : null}
      </View>
      <View style={styles.agentChatIcon}>
        {isOpening ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : (
          <SymbolView
            name="bubble.left.and.bubble.right.fill"
            size={14}
            weight="semibold"
            tintColor={colors.accent}
          />
        )}
      </View>
    </Pressable>
  );
}

function AgentAvatar({ uri, name, size }: { uri: string | null; name: string; size: number }) {
  if (uri)
    return (
      <AuthenticatedImage
        contentFit="cover"
        fallback={
          <LinearGradient
            colors={[colors.accent, colors.accentDark]}
            style={[
              styles.agentAvatarFallback,
              { width: size, height: size, borderRadius: size * 0.22 },
            ]}
          >
            <SymbolView
              name="sparkles"
              size={size * 0.34}
              weight="semibold"
              tintColor={colors.white}
            />
            <Text style={styles.hidden}>{name}</Text>
          </LinearGradient>
        }
        uri={uri}
        style={{ width: size, height: size, borderRadius: size * 0.22 }}
        transition={0}
      />
    );
  return (
    <LinearGradient
      colors={[colors.accent, colors.accentDark]}
      style={[styles.agentAvatarFallback, { width: size, height: size, borderRadius: size * 0.22 }]}
    >
      <SymbolView name="sparkles" size={size * 0.34} weight="semibold" tintColor={colors.white} />
      <Text style={styles.hidden}>{name}</Text>
    </LinearGradient>
  );
}

const ShortDramaList = memo(function ShortDramaList({
  series,
  isLoading,
  isLoadingMore,
  error,
  onRetry,
  onOpen,
}: {
  series: ShortDramaSeries[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (series: ShortDramaSeries, episode?: ShortDramaVideo) => void;
}) {
  const { t } = useLocalization();
  if (isLoading && series.length === 0) return <ContentLoading />;
  if (series.length === 0 && error) return <ContentError message={error} onRetry={onRetry} />;
  if (series.length === 0)
    return <ContentEmpty symbol="play.rectangle" title={t("shortDrama.empty")} />;
  return (
    <View style={styles.shortDramaList}>
      {series.map((item) => (
        <ShortDramaCard
          key={item.series_id}
          onOpen={(episode) => onOpen(item, episode)}
          series={item}
        />
      ))}
      {isLoadingMore ? <View style={styles.moreLoading} /> : null}
    </View>
  );
});

function ShortDramaCard({
  series,
  onOpen,
}: {
  series: ShortDramaSeries;
  onOpen: (episode?: ShortDramaVideo) => void;
}) {
  const { t } = useLocalization();
  const [page, setPage] = useState(0);
  const episodes = useMemo(
    () =>
      [...series.episodes].sort(
        (left, right) =>
          (left.episode_number ?? Number.MAX_SAFE_INTEGER) -
            (right.episode_number ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id),
      ),
    [series.episodes],
  );
  const expected = Math.max(series.episode_count, episodes.length);
  const pageCount = Math.max(1, Math.ceil(expected / 15));
  const start = page * 15 + 1;
  const end = Math.min(expected, start + 14);
  const slots =
    expected > 0
      ? Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => {
          const number = start + index;
          return { number, episode: episodes[number - 1] };
        })
      : [];
  const coverURL = resolveMediaUrl(series.cover_url, env.apiBaseUrl);
  return (
    <View style={styles.shortDramaCard}>
      <Pressable onPress={() => onOpen()}>
        <Text numberOfLines={2} style={styles.shortDramaTitle}>
          {series.title}
        </Text>
        <View style={styles.poster}>
          <LinearGradient
            colors={["#2B2D42", "#7C3AED", "#FF4D8D"]}
            style={StyleSheet.absoluteFill}
          >
            {coverURL ? (
              <AuthenticatedImage
                contentFit="cover"
                sourceCacheKey={`${coverURL}?profile-short-drama=1`}
                uri={coverURL}
                style={StyleSheet.absoluteFill}
                transition={0}
              />
            ) : (
              <View style={styles.posterPlaceholder}>
                <SymbolView
                  name="play.rectangle.fill"
                  size={24}
                  weight="semibold"
                  tintColor="rgba(255,255,255,0.9)"
                />
              </View>
            )}
          </LinearGradient>
        </View>
        <Text numberOfLines={3} style={styles.shortDramaIntro}>
          <Text style={styles.introLabel}>{t("shortDrama.series.introLabel")}</Text>
          {series.intro || t("shortDrama.series.noIntro")}
        </Text>
      </Pressable>
      {expected > 0 ? (
        <View style={styles.episodesSection}>
          {pageCount > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.rangeRow}>
                {Array.from({ length: pageCount }, (_, index) => {
                  const rangeStart = index * 15 + 1;
                  const rangeEnd = Math.min(expected, rangeStart + 14);
                  return (
                    <Pressable
                      key={index}
                      onPress={() => setPage(index)}
                      style={styles.rangeButton}
                    >
                      <Text
                        style={[styles.rangeTitle, page === index && styles.rangeTitleSelected]}
                      >
                        {rangeStart} – {rangeEnd}
                      </Text>
                      <View
                        style={[
                          styles.rangeUnderline,
                          page === index && styles.rangeUnderlineSelected,
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}
          <View style={styles.episodeGrid}>
            {slots.map(({ number, episode }) => (
              <Pressable
                disabled={!episode}
                key={number}
                onPress={() => episode && onOpen(episode)}
                style={styles.episodeSquare}
              >
                <Text style={[styles.episodeNumber, !episode && styles.episodeUnavailable]}>
                  {number}
                </Text>
                {episode &&
                (episode.unlock_price_gold_coins ?? 0) > 0 &&
                !episode.is_unlocked &&
                !episode.is_owned_by_current_user ? (
                  <SymbolView
                    name="lock.fill"
                    size={9}
                    weight="bold"
                    tintColor={colors.accent}
                    style={styles.episodeLock}
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ContentLoading() {
  return <View style={styles.contentLoading} />;
}
function ContentEmpty({ symbol, title }: { symbol: SFSymbol; title: string }) {
  return (
    <View style={styles.contentEmpty}>
      <SymbolView name={symbol} size={34} weight="semibold" tintColor={colors.tertiaryText} />
      <Text style={styles.emptyTitle}>{title}</Text>
    </View>
  );
}
function ContentError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useLocalization();
  return (
    <View style={styles.contentError}>
      <SymbolView
        name="exclamationmark.triangle"
        size={30}
        weight="semibold"
        tintColor={colors.warning}
      />
      <Text style={styles.errorText}>{message}</Text>
      <Pressable onPress={onRetry}>
        <Text style={styles.retry}>{t("common.retry")}</Text>
      </Pressable>
    </View>
  );
}

export function MediaViewer({
  selection,
  onClose,
}: {
  selection: MediaSelection | null;
  onClose: () => void;
}) {
  if (selection?.media.type === "video") {
    return (
      <VideoPlayerOverlay
        onClose={onClose}
        posterUrl={selection.sourceUri}
        videoUrl={selection.media.url}
      />
    );
  }
  return <ImageGallery onClose={onClose} selection={selection} />;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "操作失败，请稍后重试";
}
function formatMomentTime(
  value: string,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (seconds < 60) return t("time.justNow");
  if (seconds < 3600) return t("time.minutesAgo", Math.floor(seconds / 60));
  if (seconds < 86400) return t("time.hoursAgo", Math.floor(seconds / 3600));
  if (seconds < 172800) return t("time.yesterday");
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

const styles = StyleSheet.create({
  paneHost: { position: "relative", width: "100%", overflow: "hidden" },
  tabPane: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    backgroundColor: colors.card,
  },
  activeTab: { opacity: 1, zIndex: 3 },
  inactiveTab: { opacity: 0, zIndex: 2 },
  activePersistentTab: { opacity: 1, zIndex: 3 },
  inactivePersistentTab: { opacity: 1, zIndex: 0 },
  momentOcclusion: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    backgroundColor: colors.card,
  },
  contentLoading: { height: 104 },
  moreLoading: { height: 32 },
  contentEmpty: { paddingTop: 54, alignItems: "center", rowGap: 12 },
  emptyTitle: { color: colors.secondaryText, fontSize: 15, fontWeight: "600" },
  contentError: { paddingTop: 42, paddingHorizontal: 24, alignItems: "center", rowGap: 12 },
  errorText: { color: colors.secondaryText, fontSize: 14, fontWeight: "500", textAlign: "center" },
  retry: { color: colors.accent, fontSize: 14, fontWeight: "700" },
  momentRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 12,
  },
  momentBody: { flex: 1, minWidth: 0, alignItems: "stretch", rowGap: 8 },
  momentAuthor: { color: "#576B95", fontSize: 15, fontWeight: "700" },
  momentText: { color: colors.text, fontSize: 15 },
  momentDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  mediaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    alignSelf: "flex-start",
  },
  singleMediaGrid: { paddingTop: 1 },
  momentMedia: { backgroundColor: colors.separator },
  playOverlay: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
  lockOverlay: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
  lockBadge: {
    maxWidth: "90%",
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(0,0,0,0.46)",
    flexDirection: "row",
    alignItems: "center",
    columnGap: 7,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
  },
  lockBadgeDense: { paddingHorizontal: 6, paddingVertical: 5, columnGap: 3, shadowRadius: 4 },
  lockText: { flexShrink: 1, color: colors.white, fontSize: 13, fontWeight: "600" },
  lockTextDense: { fontSize: 9.5 },
  momentMeta: { flexDirection: "row", alignItems: "center" },
  timeLine: { flex: 1, flexDirection: "row", columnGap: 6 },
  momentTime: { color: colors.tertiaryText, fontSize: 12 },
  momentMore: {
    width: 30,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(240,240,245,0.75)",
  },
  actionAlignment: { flexDirection: "row", justifyContent: "flex-end" },
  momentActions: {
    height: 34,
    borderRadius: 17,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#252B3A",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  momentAction: {
    height: 34,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 4,
  },
  momentActionText: { color: colors.white, fontSize: 13 },
  actionDivider: { width: 1, height: 16, backgroundColor: "rgba(255,255,255,0.16)" },
  socialBox: {
    maxWidth: "100%",
    alignSelf: "flex-start",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#F5F6FA",
  },
  likesRow: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 4,
  },
  likesText: { flexShrink: 1, color: "#576B95", fontSize: 13 },
  socialDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 8,
    backgroundColor: colors.separator,
  },
  commentRow: { paddingHorizontal: 9, paddingVertical: 6, rowGap: 2 },
  moreComments: { paddingHorizontal: 9, paddingTop: 7, paddingBottom: 3 },
  moreCommentsText: { color: colors.secondaryText, fontSize: 12, fontWeight: "500" },
  commentText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  commentName: { color: "#576B95", fontSize: 13, fontWeight: "600" },
  commentSeparator: { color: colors.secondaryText, fontSize: 13 },
  commentImage: { width: 50, height: 50, borderRadius: 4 },
  commentTime: { color: colors.tertiaryText, fontSize: 11 },
  agentList: { padding: 16, rowGap: 12 },
  agentCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 13,
  },
  agentCardPressed: { opacity: 0.64 },
  agentCopy: { flex: 1, minWidth: 0, rowGap: 5 },
  agentName: { color: colors.text, fontSize: 16, fontWeight: "600" },
  agentSubtitle: { color: colors.secondaryText, fontSize: 13, lineHeight: 18 },
  agentTags: { color: colors.accent, fontSize: 11, fontWeight: "500" },
  agentChatIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(102,126,234,0.12)",
  },
  agentAvatarFallback: { alignItems: "center", justifyContent: "center" },
  hidden: { position: "absolute", opacity: 0 },
  shortDramaList: { padding: 16, rowGap: 14 },
  shortDramaCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(240,240,245,0.7)",
    backgroundColor: colors.card,
  },
  shortDramaTitle: {
    marginBottom: 10,
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 22,
  },
  poster: { height: 131, borderRadius: 12, overflow: "hidden" },
  posterPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  shortDramaIntro: { marginTop: 10, color: colors.secondaryText, fontSize: 14, lineHeight: 20 },
  introLabel: { fontWeight: "600" },
  episodesSection: { paddingTop: 14, rowGap: 12 },
  rangeRow: {
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(240,240,245,0.5)",
    flexDirection: "row",
    columnGap: 20,
  },
  rangeButton: { minWidth: 76, rowGap: 5 },
  rangeTitle: { color: colors.secondaryText, fontSize: 16, fontWeight: "600" },
  rangeTitleSelected: { color: "#000000" },
  rangeUnderline: { width: 38, height: 3, borderRadius: 2, backgroundColor: "transparent" },
  rangeUnderlineSelected: { backgroundColor: "#000000" },
  episodeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  episodeSquare: {
    width: "17.8%",
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  episodeNumber: { color: colors.text, fontSize: 14, fontWeight: "700" },
  episodeUnavailable: { color: colors.tertiaryText },
  episodeLock: { position: "absolute", top: 6, right: 6 },
});
