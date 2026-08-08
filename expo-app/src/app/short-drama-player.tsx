import { useEvent, useEventListener } from "expo";
import { LinearGradient } from "expo-linear-gradient";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createIdempotencyKey,
  followUser,
  getShortDramaFeed,
  getShortDramaSeriesDetail,
  getWalletBalance,
  reportShortDramaProgress,
  setShortDramaLiked,
  unfollowUser,
  unlockShortDramaEpisode,
} from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { ShortDramaActionRail } from "@/components/short-drama/ShortDramaActionRail";
import { ShortDramaCommentsSheet } from "@/components/short-drama/ShortDramaCommentsSheet";
import { TopToast } from "@/components/TopToast";
import { env } from "@/config/env";
import type { ShortDramaFeedPage, ShortDramaVideo } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useWallet } from "@/providers/WalletProvider";
import { cancelScheduledMediaCache, scheduleMediaCache } from "@/services/cache/MediaCacheService";
import {
  publishFollowRelationship,
  subscribeFollowRelationship,
} from "@/services/friends/FollowRelationshipStore";
import {
  loadShortDramaFeed,
  loadShortDramaFeedCache,
  saveShortDramaFeedCache,
} from "@/services/short-drama/ShortDramaFeedRepository";
import { saveShortDramaHistory } from "@/services/short-drama/ShortDramaHistoryRepository";
import {
  appendShortDramaFeedVideos,
  normalizeInitialShortDramaVideos,
  shortDramaFeedMetrics,
  shortDramaFeedScopeIdentity,
  shortDramaRequiresUnlock,
  shortDramaUpcomingPageIndex,
  shouldAuthorizeShortDramaMedia,
  shouldLoadMoreShortDramaFeed,
  shouldReportShortDramaProgress,
} from "@/services/short-drama/shortDramaFeedPolicy";
import {
  optimisticShortDramaLike,
  reconcileShortDramaLike,
  updateShortDramaCreatorFollow,
} from "@/services/short-drama/shortDramaInteractionPolicy";
import {
  prepareShortDramaPlaybackSource,
  shortDramaMediaCacheId,
  shortDramaMediaCandidates,
  shouldLoopShortDramaPlayback,
} from "@/services/short-drama/ShortDramaPlaybackSource";
import {
  readShortDramaVideoPlayerSnapshot,
  runShortDramaVideoPlayerCall,
} from "@/services/short-drama/ShortDramaVideoPlayerGuard";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

interface PlaybackSnapshot {
  position: number;
  duration?: number | undefined;
}

export default function ShortDramaPlayerScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    seriesId?: string;
    episodeId?: string;
    initialPosition?: string;
  }>();
  const routeScope = {
    seriesId: params.seriesId,
    requestedEpisodeId: params.episodeId,
    requestedPosition: finiteNonnegativeNumber(params.initialPosition),
  };
  const scopeIdentity = shortDramaFeedScopeIdentity(
    user?.user_id ?? "",
    routeScope.seriesId,
    routeScope.requestedEpisodeId,
    routeScope.requestedPosition,
  );
  return <ShortDramaPlayerScope key={scopeIdentity} routeScope={routeScope} />;
}

function ShortDramaPlayerScope({
  routeScope: { seriesId, requestedEpisodeId, requestedPosition },
}: {
  routeScope: {
    seriesId: string | undefined;
    requestedEpisodeId: string | undefined;
    requestedPosition: number;
  };
}) {
  const { t } = useLocalization();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ShortDramaVideo>>(null);
  const didLoadRef = useRef(false);
  const initialLoadPromiseRef = useRef<Promise<boolean> | null>(null);
  const didPositionListRef = useRef(false);
  const mountedRef = useRef(true);
  const playbackRef = useRef(new Map<string, PlaybackSnapshot>());
  const lastReportedRef = useRef(new Map<string, number>());
  const reportTokensRef = useRef(new Map<string, symbol>());
  const progressAbortControllersRef = useRef(new Map<string, AbortController>());
  const unlockKeysRef = useRef(new Map<string, string>());
  const unlockingVideoIdRef = useRef<string | null>(null);
  const isLoadingMoreRef = useRef(false);
  const alertVideoIdRef = useRef<string | null>(null);
  const loadMoreActivationIndexRef = useRef<number | null>(null);
  const playbackTargetIndexRef = useRef(0);
  const [videos, setVideos] = useState<ShortDramaVideo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [playbackTargetIndex, setPlaybackTargetIndex] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [isLoading, setLoading] = useState(true);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [isSceneActive, setSceneActive] = useState(AppState.currentState === "active");
  const [isFocused, setFocused] = useState(true);
  const [manuallyPausedVideoId, setManuallyPausedVideoId] = useState<string | null>(null);
  const [commentTarget, setCommentTarget] = useState<ShortDramaVideo | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const videosRef = useRef<ShortDramaVideo[]>([]);

  const ownerId = trimFoundationWhitespacesAndNewlines(user?.user_id ?? "");
  const wallet = useWallet();
  const selectedVideo = videos[selectedIndex] ?? null;

  const replaceVideos = useCallback((next: ShortDramaVideo[]) => {
    videosRef.current = next;
    setVideos(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchInitialPage = useCallback(async (): Promise<ShortDramaFeedPage> => {
    const page =
      seriesId !== undefined
        ? { videos: (await getShortDramaSeriesDetail(seriesId)).episodes, has_more: false }
        : await getShortDramaFeed({ limit: shortDramaFeedMetrics.pageLimit });
    return { ...page, videos: normalizeInitialShortDramaVideos(page.videos) };
  }, [seriesId]);

  const applyInitialPage = useCallback(
    (page: ShortDramaFeedPage) => {
      const normalized = normalizeInitialShortDramaVideos(page.videos);
      if (requestedEpisodeId !== undefined) {
        const requestedIndex = normalized.findIndex((video) => video.id === requestedEpisodeId);
        if (requestedIndex >= 0) {
          normalized[requestedIndex] = {
            ...normalized[requestedIndex]!,
            playback_position_seconds: requestedPosition,
          };
        }
      }
      const initialIndex =
        requestedEpisodeId !== undefined
          ? Math.max(
              0,
              normalized.findIndex((video) => video.id === requestedEpisodeId),
            )
          : 0;
      replaceVideos(normalized);
      setHasMore(page.has_more);
      setNextCursor(page.next_cursor);
      setSelectedIndex(initialIndex);
      playbackTargetIndexRef.current = initialIndex;
      setPlaybackTargetIndex(initialIndex);
      didPositionListRef.current = false;
    },
    [replaceVideos, requestedEpisodeId, requestedPosition],
  );

  const recordFocusedVideoHistory = useCallback(
    (video: Pick<ShortDramaVideo, "id" | "drama_id" | "playback_position_seconds">) => {
      if (!ownerId) return;
      const historySeriesId = trimFoundationWhitespacesAndNewlines(video.drama_id)
        ? video.drama_id
        : (seriesId ?? "");
      void saveShortDramaHistory(
        ownerId,
        historySeriesId,
        video.id,
        video.playback_position_seconds,
      );
    },
    [ownerId, seriesId],
  );

  const performInitialLoad = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    try {
      const cached = ownerId ? await loadShortDramaFeedCache(ownerId, seriesId) : null;
      if (!mountedRef.current) return false;
      if (cached) applyInitialPage(cached.value);
      const page = ownerId
        ? await loadShortDramaFeed(ownerId, seriesId, fetchInitialPage)
        : await fetchInitialPage();
      if (!mountedRef.current) return false;
      const normalizedPage = { ...page, videos: normalizeInitialShortDramaVideos(page.videos) };
      applyInitialPage(normalizedPage);
      const focusedVideo = videosRef.current[playbackTargetIndexRef.current];
      if (focusedVideo) recordFocusedVideoHistory(focusedVideo);
      if (ownerId) void saveShortDramaFeedCache(ownerId, seriesId, normalizedPage);
      didLoadRef.current = true;
      return true;
    } catch (error) {
      if (mountedRef.current) setToastMessage(readableError(error, t("common.operationFailed")));
      return false;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [applyInitialPage, fetchInitialPage, ownerId, recordFocusedVideoHistory, seriesId, t]);

  const loadInitial = useCallback((): Promise<boolean> => {
    if (initialLoadPromiseRef.current) return initialLoadPromiseRef.current;
    const task = performInitialLoad();
    initialLoadPromiseRef.current = task;
    void task.finally(() => {
      if (initialLoadPromiseRef.current === task) initialLoadPromiseRef.current = null;
    });
    return task;
  }, [performInitialLoad]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      if (!didLoadRef.current) {
        void loadInitial();
      }
      return () => {
        setFocused(false);
        for (const video of videosRef.current) {
          cancelScheduledMediaCache(ownerId, shortDramaMediaCacheId(video.id));
        }
      };
    }, [loadInitial, ownerId]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setSceneActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  useEffect(
    () =>
      subscribeFollowRelationship(ownerId, (event) => {
        const nextVideos = updateShortDramaCreatorFollow(
          videosRef.current,
          event.relationship.user_id,
          event.relationship.followed_by_me,
        );
        replaceVideos(nextVideos);
        if (ownerId && nextVideos.length > 0) {
          void saveShortDramaFeedCache(ownerId, seriesId, {
            videos: nextVideos,
            has_more: hasMore,
            ...(nextCursor !== undefined ? { next_cursor: nextCursor } : {}),
          });
        }
      }),
    [hasMore, nextCursor, ownerId, replaceVideos, seriesId],
  );

  useEffect(() => {
    if (didPositionListRef.current || pageHeight <= 0 || videos.length === 0) return;
    didPositionListRef.current = true;
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: selectedIndex * pageHeight, animated: false });
    });
  }, [pageHeight, selectedIndex, videos.length]);

  const updateSnapshot = useCallback((videoId: string, position: number, duration: number) => {
    if (!Number.isFinite(position) || position < 0) return;
    playbackRef.current.set(videoId, {
      position,
      ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    });
  }, []);

  const reportProgress = useCallback(
    (video: Pick<ShortDramaVideo, "id" | "drama_id">, snapshot?: PlaybackSnapshot) => {
      const resolved = snapshot ?? playbackRef.current.get(video.id);
      if (!resolved) return;
      const historySeriesId = trimFoundationWhitespacesAndNewlines(video.drama_id)
        ? video.drama_id
        : (seriesId ?? "");
      if (ownerId) {
        void saveShortDramaHistory(ownerId, historySeriesId, video.id, resolved.position);
      }
      if (!shouldReportShortDramaProgress(resolved.position, lastReportedRef.current.get(video.id)))
        return;
      lastReportedRef.current.set(video.id, resolved.position);
      progressAbortControllersRef.current.get(video.id)?.abort();
      const controller = new AbortController();
      progressAbortControllersRef.current.set(video.id, controller);
      const token = Symbol(video.id);
      reportTokensRef.current.set(video.id, token);
      void reportShortDramaProgress(
        video.id,
        resolved.position,
        resolved.duration,
        controller.signal,
      )
        .catch(() => undefined)
        .finally(() => {
          if (reportTokensRef.current.get(video.id) === token) {
            reportTokensRef.current.delete(video.id);
          }
          if (progressAbortControllersRef.current.get(video.id) === controller) {
            progressAbortControllersRef.current.delete(video.id);
          }
        });
    },
    [ownerId, seriesId],
  );

  const deactivateVideo = useCallback(
    (videoId: string, videoSeriesId: string, position: number, duration: number) => {
      const snapshot = {
        position: Number.isFinite(position) && position >= 0 ? position : 0,
        ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
      };
      playbackRef.current.set(videoId, snapshot);
      replaceVideos(
        videosRef.current.map((item) =>
          item.id === videoId ? { ...item, playback_position_seconds: snapshot.position } : item,
        ),
      );
      reportProgress({ id: videoId, drama_id: videoSeriesId }, snapshot);
    },
    [replaceVideos, reportProgress],
  );

  const loadMore = useCallback(async () => {
    if (seriesId !== undefined || !hasMore || isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await getShortDramaFeed({
        cursor: nextCursor,
        limit: shortDramaFeedMetrics.pageLimit,
      });
      if (!mountedRef.current) return;
      const nextVideos = appendShortDramaFeedVideos(videosRef.current, page.videos);
      replaceVideos(nextVideos);
      setHasMore(page.has_more);
      setNextCursor(page.next_cursor);
      if (ownerId) {
        void saveShortDramaFeedCache(ownerId, undefined, {
          videos: nextVideos,
          has_more: page.has_more,
          ...(page.next_cursor !== undefined ? { next_cursor: page.next_cursor } : {}),
        });
      }
    } catch (error) {
      if (mountedRef.current) setToastMessage(readableError(error, t("common.operationFailed")));
    } finally {
      isLoadingMoreRef.current = false;
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [hasMore, nextCursor, ownerId, replaceVideos, seriesId, t]);

  useEffect(() => {
    if (
      !isLoading &&
      videos.length > 0 &&
      loadMoreActivationIndexRef.current !== playbackTargetIndex &&
      shouldLoadMoreShortDramaFeed(playbackTargetIndex, videos.length)
    ) {
      loadMoreActivationIndexRef.current = playbackTargetIndex;
      void loadMore();
    }
  }, [isLoading, loadMore, playbackTargetIndex, videos.length]);

  const prepareUpcomingPage = useCallback(
    (index: number) => {
      if (!videos[index] || index === playbackTargetIndexRef.current) return;
      playbackTargetIndexRef.current = index;
      setPlaybackTargetIndex(index);
      setManuallyPausedVideoId(null);
      recordFocusedVideoHistory(videos[index]!);
      loadMoreActivationIndexRef.current = index;
      if (shouldLoadMoreShortDramaFeed(index, videos.length)) void loadMore();
    },
    [loadMore, recordFocusedVideoHistory, videos],
  );

  const commitPage = useCallback(
    (index: number) => {
      if (!videos[index]) return;
      prepareUpcomingPage(index);
      if (index !== selectedIndex) setSelectedIndex(index);
    },
    [prepareUpcomingPage, selectedIndex, videos],
  );

  const confirmUnlock = useCallback(
    async (video: ShortDramaVideo) => {
      if (unlockingVideoIdRef.current) return;
      unlockingVideoIdRef.current = video.id;
      const price = video.unlock_price_gold_coins ?? 0;
      try {
        let balance = wallet.balance;
        if (!balance) {
          try {
            balance = await getWalletBalance();
            try {
              await wallet.applyBalance(balance);
            } catch {
              // The server snapshot still authorizes the unlock; local wallet persistence is best-effort.
            }
          } catch {
            balance = null;
          }
        }
        if (balance && balance.spendable_balance < price) {
          router.push("/wallet");
          return;
        }
        const idempotencyKey = unlockKeysRef.current.get(video.id) ?? createIdempotencyKey();
        unlockKeysRef.current.set(video.id, idempotencyKey);
        const result = await unlockShortDramaEpisode(video.id, idempotencyKey);
        unlockKeysRef.current.delete(video.id);
        if (result.charge) {
          try {
            await wallet.applyBalance(result.charge.wallet_balance);
          } catch {
            // Native balance application cannot block the already successful episode unlock.
          }
        }
        const unlockedVideo = result.video ?? { ...video, is_unlocked: true };
        replaceVideos(
          videosRef.current.map((item) =>
            item.id === video.id ? (result.video ?? { ...item, is_unlocked: true }) : item,
          ),
        );
        recordFocusedVideoHistory(unlockedVideo);
        alertVideoIdRef.current = null;
      } catch (error) {
        setToastMessage(readableError(error, t("common.operationFailed")));
      } finally {
        unlockingVideoIdRef.current = null;
      }
    },
    [recordFocusedVideoHistory, replaceVideos, t, wallet],
  );

  useEffect(() => {
    if (!isFocused) return;
    if (!selectedVideo || !shortDramaRequiresUnlock(selectedVideo)) {
      alertVideoIdRef.current = null;
      return;
    }
    if (alertVideoIdRef.current === selectedVideo.id) return;
    alertVideoIdRef.current = selectedVideo.id;
    Alert.alert(
      t("shortDrama.unlock.confirmTitle"),
      t("shortDrama.unlock.confirmMessage", selectedVideo.unlock_price_gold_coins ?? 0),
      [
        {
          text: t("shortDrama.unlock.pay"),
          onPress: () => void confirmUnlock(selectedVideo),
        },
        {
          style: "cancel",
          text: t("common.cancel"),
          onPress: () => {
            alertVideoIdRef.current = null;
          },
        },
      ],
    );
  }, [confirmUnlock, isFocused, selectedVideo, t]);

  const toggleLike = useCallback(
    (selected: ShortDramaVideo) => {
      const previous = videosRef.current.find((video) => video.id === selected.id);
      if (!previous) return;
      const optimistic = optimisticShortDramaLike(previous);
      replaceVideos(
        videosRef.current.map((video) => (video.id === selected.id ? optimistic.next : video)),
      );
      void setShortDramaLiked(selected.id, optimistic.target)
        .then((result) => {
          const current = videosRef.current.find((video) => video.id === selected.id);
          if (!current) return;
          replaceVideos(
            videosRef.current.map((video) =>
              video.id === selected.id ? reconcileShortDramaLike(current, result) : video,
            ),
          );
        })
        .catch(() => {
          if (!videosRef.current.some((video) => video.id === selected.id)) return;
          replaceVideos(
            videosRef.current.map((video) => (video.id === selected.id ? previous : video)),
          );
        });
    },
    [replaceVideos],
  );

  const toggleFollow = useCallback(
    (selected: ShortDramaVideo) => {
      const userId = selected.creator.user_id;
      const previousVideos = videosRef.current;
      const current = previousVideos.find((video) => video.creator.user_id === userId);
      if (!current) return;
      const target = !current.creator.followed_by_me;
      replaceVideos(updateShortDramaCreatorFollow(previousVideos, userId, target));
      void (target ? followUser(userId) : unfollowUser(userId))
        .then((relationship) => {
          publishFollowRelationship({ relationship }, ownerId);
          replaceVideos(
            updateShortDramaCreatorFollow(videosRef.current, userId, relationship.followed_by_me),
          );
        })
        .catch(() => replaceVideos(previousVideos));
    },
    [ownerId, replaceVideos],
  );

  const togglePlayback = useCallback(
    (video: ShortDramaVideo) => {
      if (shortDramaRequiresUnlock(video) || videos[playbackTargetIndex]?.id !== video.id) return;
      setManuallyPausedVideoId((current) => (current === video.id ? null : video.id));
    },
    [playbackTargetIndex, videos],
  );

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageHeight <= 0) return;
      const nextIndex = Math.max(
        0,
        Math.min(videos.length - 1, Math.round(event.nativeEvent.contentOffset.y / pageHeight)),
      );
      commitPage(nextIndex);
    },
    [commitPage, pageHeight, videos.length],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageHeight <= 0 || videos.length === 0) return;
      prepareUpcomingPage(
        shortDramaUpcomingPageIndex(
          event.nativeEvent.contentOffset.y,
          pageHeight,
          selectedIndex,
          videos.length,
        ),
      );
    },
    [pageHeight, prepareUpcomingPage, selectedIndex, videos.length],
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextHeight = event.nativeEvent.layout.height;
      if (nextHeight > 0 && Math.abs(nextHeight - pageHeight) > 0.5) {
        setPageHeight(nextHeight);
        didPositionListRef.current = false;
      }
    },
    [pageHeight],
  );

  return (
    <View onLayout={handleLayout} style={styles.screen} testID="short-drama-feed">
      <Stack.Screen options={{ animation: "fade", headerShown: false }} />
      <StatusBar style="light" />
      {videos.length > 0 && pageHeight > 0 ? (
        <FlatList
          bounces={false}
          data={videos}
          decelerationRate="fast"
          disableIntervalMomentum
          getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
          initialNumToRender={Math.min(3, videos.length)}
          keyExtractor={(video) => video.id}
          maxToRenderPerBatch={3}
          onMomentumScrollEnd={handleMomentumEnd}
          onScroll={handleScroll}
          pagingEnabled
          ref={listRef}
          removeClippedSubviews
          renderItem={({ item, index }) => (
            <ShortDramaVideoPage
              currentUserId={user?.user_id}
              height={pageHeight}
              isActive={!isLoading && isFocused && isSceneActive && playbackTargetIndex === index}
              isManuallyPaused={manuallyPausedVideoId === item.id}
              isPlaybackTarget={playbackTargetIndex === index}
              onDeactivate={deactivateVideo}
              onOpenComments={() => setCommentTarget(item)}
              onOpenCreator={() => {
                if (item.creator.user_id) {
                  router.push({ pathname: "/user-profile", params: { id: item.creator.user_id } });
                }
              }}
              onProgress={updateSnapshot}
              onToggleFollow={() => toggleFollow(item)}
              onToggleLike={() => toggleLike(item)}
              onTogglePlayback={() => togglePlayback(item)}
              ownerId={ownerId}
              shouldPrepare={
                !isLoading &&
                Math.abs(index - playbackTargetIndex) <= shortDramaFeedMetrics.pageWindowRadius
              }
              t={t}
              video={item}
            />
          )}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          style={styles.pager}
          windowSize={3}
        />
      ) : (
        <View style={styles.emptyState}>
          {isLoading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <SymbolView
                name="play.slash"
                size={shortDramaFeedMetrics.emptySymbolSize}
                weight="semibold"
                tintColor="rgba(255,255,255,0.72)"
              />
              <Text style={styles.emptyText}>{t("shortDrama.empty")}</Text>
            </>
          )}
        </View>
      )}

      <View
        pointerEvents="box-none"
        style={[styles.topBar, { paddingTop: insets.top + shortDramaFeedMetrics.topBarTopInset }]}
      >
        <Pressable
          accessibilityLabel={t("common.back")}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.topBarButton}
        >
          <SymbolView
            name="chevron.left"
            size={shortDramaFeedMetrics.topBarSymbolSize}
            weight="bold"
            tintColor={colors.white}
          />
        </Pressable>
        <Text accessibilityRole="header" style={styles.topBarTitle}>
          {t("shortDrama.title")}
        </Text>
        <View style={styles.topBarSpacer} />
      </View>

      {isLoadingMore ? <ActivityIndicator color={colors.white} style={styles.moreLoading} /> : null}
      {commentTarget ? (
        <ShortDramaCommentsSheet
          key={commentTarget.id}
          currentUser={user}
          onClose={() => setCommentTarget(null)}
          onCommentSent={() => {
            replaceVideos(incrementCommentCount(videosRef.current, commentTarget.id));
          }}
          ownerId={ownerId}
          t={t}
          video={videos.find((video) => video.id === commentTarget.id) ?? commentTarget}
        />
      ) : null}
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </View>
  );
}

function ShortDramaVideoPage({
  currentUserId,
  height,
  isActive,
  isManuallyPaused,
  isPlaybackTarget,
  onDeactivate,
  onOpenComments,
  onOpenCreator,
  onProgress,
  onToggleFollow,
  onToggleLike,
  onTogglePlayback,
  ownerId,
  shouldPrepare,
  t,
  video,
}: {
  currentUserId?: string | undefined;
  height: number;
  isActive: boolean;
  isManuallyPaused: boolean;
  isPlaybackTarget: boolean;
  onDeactivate(videoId: string, videoSeriesId: string, position: number, duration: number): void;
  onOpenComments(): void;
  onOpenCreator(): void;
  onProgress(videoId: string, position: number, duration: number): void;
  onToggleFollow(): void;
  onToggleLike(): void;
  onTogglePlayback(): void;
  ownerId: string;
  shouldPrepare: boolean;
  t(key: string, ...args: (string | number)[]): string;
  video: ShortDramaVideo;
}) {
  const locked = shortDramaRequiresUnlock(video);
  const candidates = shortDramaMediaCandidates(video, env.apiBaseUrl);
  const candidateSignature = candidates.map((candidate) => candidate.url).join("\u0000");
  const selectionIdentity = `${video.id}\u0000${candidateSignature}`;
  const [candidateSelection, setCandidateSelection] = useState({
    identity: selectionIdentity,
    index: 0,
  });
  const candidateIndex =
    candidateSelection.identity === selectionIdentity ? candidateSelection.index : 0;
  const candidate = candidates[candidateIndex];
  const candidateLabel = candidate?.label;
  const candidateUrl = candidate?.url;
  const sourceIdentity =
    shouldPrepare && !locked && candidate
      ? `${video.id}\u0000${candidateIndex}\u0000${candidate.url}`
      : "";
  const [preparedSource, setPreparedSource] = useState<{
    identity: string;
    source: VideoSource;
  } | null>(null);
  const fallbackPositionRef = useRef(0);
  const loopInFlightRef = useRef(false);
  const isUnmountedRef = useRef(false);
  const lastPlayerSnapshotRef = useRef({
    position: Math.max(0, video.playback_position_seconds),
    duration: Math.max(0, video.duration_seconds ?? 0),
  });

  useEffect(() => {
    let isCurrent = true;
    if (!sourceIdentity || !candidateLabel || !candidateUrl) {
      return () => {
        isCurrent = false;
      };
    }
    void prepareShortDramaPlaybackSource({
      apiBaseUrl: env.apiBaseUrl,
      candidate: { label: candidateLabel, url: candidateUrl },
      ownerId,
      videoId: video.id,
      useLocalPrimary: candidateIndex === 0,
    })
      .then((source) => {
        if (isCurrent) setPreparedSource({ identity: sourceIdentity, source });
      })
      .catch(() => {
        if (isCurrent) setPreparedSource(null);
      });
    return () => {
      isCurrent = false;
    };
  }, [candidateIndex, candidateLabel, candidateUrl, ownerId, sourceIdentity, video.id]);

  const source = preparedSource?.identity === sourceIdentity ? preparedSource.source : null;
  const [coverOpacity] = useState(() => new Animated.Value(1));
  const [playButtonOpacity] = useState(
    () => new Animated.Value(isPlaybackTarget && isManuallyPaused ? 1 : 0),
  );
  const [renderedSourceKey, setRenderedSourceKey] = useState("");
  const sourceUri =
    typeof source === "object" && source && "uri" in source ? (source.uri ?? "") : "";
  const sourceKey = source ? `${sourceIdentity}\u0000${sourceUri}` : "";
  const hasFirstFrame = Boolean(sourceKey) && renderedSourceKey === sourceKey;
  const resumePosition =
    candidateIndex > 0 ? fallbackPositionRef.current : video.playback_position_seconds;
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    instance.muted = false;
    instance.volume = 1;
    instance.audioMixingMode = "doNotMix";
    instance.allowsExternalPlayback = true;
    instance.staysActiveInBackground = false;
    instance.timeUpdateEventInterval = shortDramaFeedMetrics.progressIntervalSeconds;
    instance.bufferOptions = {
      preferredForwardBufferDuration: 3,
      waitsToMinimizeStalling: true,
    };
    if (
      resumePosition > (candidateIndex > 0 ? 0 : shortDramaFeedMetrics.resumeSeekMinimumSeconds)
    ) {
      runShortDramaVideoPlayerCall(() => {
        instance.currentTime = resumePosition;
      }, undefined);
    }
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: runShortDramaVideoPlayerCall(() => player.playing, false),
  });
  const activeStateRef = useRef(isActive);
  const manuallyPausedRef = useRef(isManuallyPaused);
  const sourceKeyRef = useRef(sourceKey);
  const sourceReadyRef = useRef(Boolean(source));
  const deactivateRef = useRef(onDeactivate);
  const playerRef = useRef(player);
  const videoIdentityRef = useRef({ id: video.id, dramaId: video.drama_id });
  useEffect(() => {
    activeStateRef.current = isActive;
    manuallyPausedRef.current = isManuallyPaused;
    sourceKeyRef.current = sourceKey;
    sourceReadyRef.current = Boolean(source);
    deactivateRef.current = onDeactivate;
    playerRef.current = player;
    videoIdentityRef.current = { id: video.id, dramaId: video.drama_id };
  }, [
    isActive,
    isManuallyPaused,
    onDeactivate,
    player,
    source,
    sourceKey,
    video.drama_id,
    video.id,
  ]);

  const loopPlayback = useCallback(
    (requireNearEnd: boolean, currentTime?: number) => {
      if (isUnmountedRef.current) return;
      const snapshot = readShortDramaVideoPlayerSnapshot(player, lastPlayerSnapshotRef.current);
      const resolvedCurrentTime = currentTime ?? snapshot.position;
      if (
        loopInFlightRef.current ||
        !shouldLoopShortDramaPlayback({
          currentTime: resolvedCurrentTime,
          duration: snapshot.duration,
          isActive: activeStateRef.current,
          isManuallyPaused: manuallyPausedRef.current,
          isPlaying,
          requireNearEnd,
        })
      )
        return;
      const loopingSourceKey = sourceKeyRef.current;
      loopInFlightRef.current = true;
      runShortDramaVideoPlayerCall(() => {
        player.muted = false;
        player.volume = 1;
        player.currentTime = 0;
      }, undefined);
      requestAnimationFrame(() => {
        loopInFlightRef.current = false;
        if (
          !isUnmountedRef.current &&
          activeStateRef.current &&
          !manuallyPausedRef.current &&
          loopingSourceKey &&
          sourceKeyRef.current === loopingSourceKey
        ) {
          runShortDramaVideoPlayerCall(() => {
            player.muted = false;
            player.volume = 1;
            player.play();
          }, undefined);
        }
      });
    },
    [isPlaying, player],
  );

  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    if (isUnmountedRef.current) return;
    const snapshot = readShortDramaVideoPlayerSnapshot(player, lastPlayerSnapshotRef.current);
    lastPlayerSnapshotRef.current = { position: currentTime, duration: snapshot.duration };
    onProgress(video.id, currentTime, snapshot.duration);
    loopPlayback(true, currentTime);
  });

  useEventListener(player, "playToEnd", () => {
    loopPlayback(false);
  });

  useEventListener(player, "sourceLoad", ({ availableAudioTracks }) => {
    if (isUnmountedRef.current) return;
    const fallback = candidates[1];
    if (candidateIndex !== 0 || !fallback || availableAudioTracks.length > 0) return;
    const currentTime = readShortDramaVideoPlayerSnapshot(
      player,
      lastPlayerSnapshotRef.current,
    ).position;
    fallbackPositionRef.current = Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;
    setCandidateSelection({ identity: selectionIdentity, index: 1 });
  });

  useEffect(() => {
    if (isActive && !isManuallyPaused && !locked && source) {
      runShortDramaVideoPlayerCall(() => player.play(), undefined);
    } else {
      runShortDramaVideoPlayerCall(() => player.pause(), undefined);
    }
  }, [isActive, isManuallyPaused, locked, player, source]);

  const previousPlaybackStateRef = useRef({ isActive, isManuallyPaused });
  useEffect(() => {
    const previous = previousPlaybackStateRef.current;
    if (
      previous.isActive &&
      (!isActive || (!previous.isManuallyPaused && isManuallyPaused)) &&
      sourceReadyRef.current
    ) {
      const snapshot = readShortDramaVideoPlayerSnapshot(player, lastPlayerSnapshotRef.current);
      lastPlayerSnapshotRef.current = snapshot;
      runShortDramaVideoPlayerCall(() => player.pause(), undefined);
      deactivateRef.current(video.id, video.drama_id, snapshot.position, snapshot.duration);
    }
    previousPlaybackStateRef.current = { isActive, isManuallyPaused };
  }, [isActive, isManuallyPaused, player, video.drama_id, video.id]);

  useEffect(
    () => () => {
      isUnmountedRef.current = true;
      if (!activeStateRef.current || !sourceReadyRef.current) return;
      const currentPlayer = playerRef.current;
      const identity = videoIdentityRef.current;
      const snapshot = readShortDramaVideoPlayerSnapshot(
        currentPlayer,
        lastPlayerSnapshotRef.current,
      );
      runShortDramaVideoPlayerCall(() => currentPlayer.pause(), undefined);
      deactivateRef.current(identity.id, identity.dramaId, snapshot.position, snapshot.duration);
    },
    [],
  );

  const primaryRemoteUrl = candidates[0]?.url ?? "";
  const sourceReady = Boolean(source);
  useEffect(() => {
    if (!isActive || !sourceReady || locked || !ownerId || !primaryRemoteUrl) return;
    scheduleMediaCache({
      ownerId,
      mediaId: shortDramaMediaCacheId(video.id),
      remoteUrl: primaryRemoteUrl,
      authorizationPolicy: shouldAuthorizeShortDramaMedia(primaryRemoteUrl, env.apiBaseUrl)
        ? "required"
        : "none",
    });
  }, [isActive, locked, ownerId, primaryRemoteUrl, sourceReady, video.id]);

  useEffect(() => {
    Animated.timing(playButtonOpacity, {
      duration: shortDramaFeedMetrics.firstFrameFadeMilliseconds,
      easing: Easing.inOut(Easing.ease),
      toValue: isPlaybackTarget && isManuallyPaused ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [isManuallyPaused, isPlaybackTarget, playButtonOpacity]);

  const markFirstFrame = useCallback(() => {
    if (!sourceKey || hasFirstFrame) return;
    coverOpacity.setValue(1);
    setRenderedSourceKey(sourceKey);
    requestAnimationFrame(() => {
      Animated.timing(coverOpacity, {
        duration: shortDramaFeedMetrics.firstFrameFadeMilliseconds,
        easing: Easing.out(Easing.ease),
        toValue: 0,
        useNativeDriver: true,
      }).start();
    });
  }, [coverOpacity, hasFirstFrame, sourceKey]);

  const coverUrl = resolveMediaUrl(video.cover_url, env.apiBaseUrl);
  const displayTitle =
    trimFoundationWhitespacesAndNewlines(video.title) ||
    trimFoundationWhitespacesAndNewlines(video.drama_title) ||
    t("shortDrama.video");
  const dramaTitle = trimFoundationWhitespacesAndNewlines(video.drama_title) || displayTitle;
  const displayIntro = trimFoundationWhitespacesAndNewlines(video.intro) || t("shortDrama.noIntro");
  const episodeText =
    video.episode_number && video.episode_number > 0
      ? t("shortDrama.episode", video.episode_number)
      : t("shortDrama.episodeUnknown");
  const showLoading = !locked && (!source || (isPlaybackTarget && !hasFirstFrame));

  return (
    <View
      accessibilityElementsHidden={!isPlaybackTarget}
      importantForAccessibility={isPlaybackTarget ? "auto" : "no-hide-descendants"}
      style={[styles.videoPage, { height }]}
    >
      {source ? (
        <VideoView
          accessible={false}
          allowsVideoFrameAnalysis={false}
          contentFit="cover"
          nativeControls={false}
          onFirstFrameRender={markFirstFrame}
          player={player}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity: hasFirstFrame ? coverOpacity : 1 }]}
      >
        <LinearGradient colors={["#171725", "#000000"]} style={StyleSheet.absoluteFill} />
        {coverUrl ? (
          <AuthenticatedImage
            contentFit="cover"
            errorFallback={<View style={styles.transparentFill} />}
            loadingFallback={<View style={styles.transparentFill} />}
            style={StyleSheet.absoluteFill}
            transition={0}
            uri={coverUrl}
          />
        ) : null}
      </Animated.View>
      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.66)"]}
        locations={[0.5, 1]}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      <Pressable
        accessibilityLabel={t(isManuallyPaused ? "common.play" : "common.pause")}
        accessibilityRole="button"
        accessibilityState={{ disabled: !isPlaybackTarget || locked }}
        disabled={!isPlaybackTarget || locked}
        onPress={onTogglePlayback}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View
        pointerEvents={isPlaybackTarget && isManuallyPaused ? "auto" : "none"}
        style={[styles.playButton, { opacity: playButtonOpacity }]}
      >
        <Pressable
          accessibilityLabel={t("common.play")}
          accessibilityRole="button"
          onPress={onTogglePlayback}
          style={styles.playButtonTarget}
        >
          <SymbolView
            name="play.fill"
            size={shortDramaFeedMetrics.playButtonSymbolSize}
            weight="bold"
            tintColor={colors.white}
          />
        </Pressable>
      </Animated.View>

      {locked ? (
        <View pointerEvents="none" style={styles.lockedContainer}>
          <View
            accessibilityLabel={t(
              "shortDrama.unlock.confirmMessage",
              video.unlock_price_gold_coins ?? 0,
            )}
            accessibilityLiveRegion="polite"
            accessible
            style={styles.lockedOverlay}
          >
            <SymbolView
              name="lock.fill"
              size={shortDramaFeedMetrics.lockedSymbolSize}
              weight="bold"
              tintColor={colors.white}
            />
            <Text style={styles.lockedText}>
              {t("shortDrama.unlock.confirmMessage", video.unlock_price_gold_coins ?? 0)}
            </Text>
          </View>
        </View>
      ) : null}

      <View pointerEvents="box-none" style={styles.bottomOverlay}>
        <View pointerEvents="none" style={styles.metadata}>
          <Text numberOfLines={1} style={styles.creatorName}>
            @{video.creator.nickname}
          </Text>
          <Text numberOfLines={2} style={styles.dramaTitle}>
            {dramaTitle}
          </Text>
          <Text numberOfLines={3} style={styles.intro}>
            {displayIntro}
          </Text>
          <View style={styles.episodeRow}>
            <Text style={styles.episodePill}>{episodeText}</Text>
            {trimFoundationWhitespacesAndNewlines(video.title) &&
            video.title !== video.drama_title ? (
              <Text numberOfLines={1} style={styles.secondaryTitle}>
                {video.title}
              </Text>
            ) : null}
          </View>
        </View>
        <ShortDramaActionRail
          currentUserId={currentUserId}
          onOpenComments={onOpenComments}
          onOpenCreator={onOpenCreator}
          onToggleFollow={onToggleFollow}
          onToggleLike={onToggleLike}
          text={(key) => t(key)}
          video={video}
        />
      </View>

      {showLoading ? <ActivityIndicator color={colors.white} style={styles.videoLoading} /> : null}
    </View>
  );
}

function incrementCommentCount(
  videos: readonly ShortDramaVideo[],
  videoId: string,
): ShortDramaVideo[] {
  return videos.map((video) =>
    video.id === videoId ? { ...video, comment_count: video.comment_count + 1 } : video,
  );
}

function finiteNonnegativeNumber(value: string | undefined): number {
  const decoded = Number(value);
  return Number.isFinite(decoded) ? Math.max(0, decoded) : 0;
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && trimFoundationWhitespacesAndNewlines(error.message)
    ? error.message
    : fallback;
}

const textShadow = {
  textShadowColor: "rgba(0,0,0,0.50)",
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 8,
} as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  pager: { flex: 1, backgroundColor: "#000000" },
  videoPage: { width: "100%", overflow: "hidden", backgroundColor: "#000000" },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: shortDramaFeedMetrics.emptyGap,
  },
  emptyText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: shortDramaFeedMetrics.emptyTitleSize,
    fontWeight: "600",
  },
  topBar: {
    position: "absolute",
    zIndex: 5,
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: shortDramaFeedMetrics.topBarHorizontalInset,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topBarButton: {
    width: shortDramaFeedMetrics.topBarButtonSize,
    height: shortDramaFeedMetrics.topBarButtonSize,
    borderRadius: shortDramaFeedMetrics.topBarButtonSize / 2,
    backgroundColor: "rgba(0,0,0,0.32)",
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: {
    flex: 1,
    color: colors.white,
    fontSize: shortDramaFeedMetrics.topBarTitleSize,
    fontWeight: "700",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  topBarSpacer: {
    width: shortDramaFeedMetrics.topBarButtonSize,
    height: shortDramaFeedMetrics.topBarButtonSize,
  },
  transparentFill: { flex: 1, backgroundColor: "transparent" },
  moreLoading: { position: "absolute", right: 16, bottom: 14 },
  playButton: {
    position: "absolute",
    alignSelf: "center",
    top: "50%",
    marginTop: -shortDramaFeedMetrics.playButtonSize / 2,
    width: shortDramaFeedMetrics.playButtonSize,
    height: shortDramaFeedMetrics.playButtonSize,
    borderRadius: shortDramaFeedMetrics.playButtonSize / 2,
    borderWidth: shortDramaFeedMetrics.playButtonBorderWidth,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(0,0,0,0.42)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.45,
    shadowRadius: shortDramaFeedMetrics.playButtonShadowRadius,
    shadowOffset: { width: 0, height: shortDramaFeedMetrics.playButtonShadowOffsetY },
  },
  playButtonTarget: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  lockedContainer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: shortDramaFeedMetrics.lockedOuterHorizontalInset,
    alignItems: "center",
    justifyContent: "center",
  },
  lockedOverlay: {
    gap: shortDramaFeedMetrics.lockedGap,
    alignItems: "center",
    paddingHorizontal: shortDramaFeedMetrics.lockedHorizontalInset,
    paddingVertical: shortDramaFeedMetrics.lockedVerticalInset,
    borderRadius: shortDramaFeedMetrics.lockedRadius,
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  lockedText: {
    color: colors.white,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  bottomOverlay: {
    position: "absolute",
    left: shortDramaFeedMetrics.bottomHorizontalInset,
    right: shortDramaFeedMetrics.bottomHorizontalInset,
    bottom: shortDramaFeedMetrics.bottomInset,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: shortDramaFeedMetrics.bottomGap,
  },
  metadata: {
    flex: 1,
    alignItems: "flex-start",
    gap: shortDramaFeedMetrics.metadataGap,
  },
  creatorName: {
    ...textShadow,
    color: colors.white,
    fontSize: shortDramaFeedMetrics.creatorNameSize,
    fontWeight: "700",
  },
  dramaTitle: {
    ...textShadow,
    color: colors.white,
    fontSize: shortDramaFeedMetrics.dramaTitleSize,
    fontWeight: "700",
  },
  intro: {
    ...textShadow,
    color: "rgba(255,255,255,0.88)",
    fontSize: shortDramaFeedMetrics.introSize,
    lineHeight: 19,
    fontWeight: "500",
  },
  episodeRow: { flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "100%" },
  episodePill: {
    ...textShadow,
    flexShrink: 0,
    overflow: "hidden",
    color: colors.white,
    fontSize: shortDramaFeedMetrics.episodePillSize,
    fontWeight: "700",
    paddingHorizontal: shortDramaFeedMetrics.episodePillHorizontalInset,
    paddingVertical: shortDramaFeedMetrics.episodePillVerticalInset,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  secondaryTitle: {
    ...textShadow,
    flex: 1,
    color: "rgba(255,255,255,0.84)",
    fontSize: shortDramaFeedMetrics.secondaryTitleSize,
    fontWeight: "600",
  },
  videoLoading: {
    position: "absolute",
    alignSelf: "center",
    top: "50%",
    transform: [{ scale: 1.1 }],
  },
});
