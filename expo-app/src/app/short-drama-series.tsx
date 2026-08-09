import { LinearGradient } from "expo-linear-gradient";
import { router, Stack, useFocusEffect, type NativeStackNavigationOptions } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  LayoutAnimation,
  PlatformColor,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  getShortDramaFeed,
  getShortDramaSeriesDetail,
  getShortDramaSeriesFeed,
} from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { UserAvatarButton } from "@/components/Avatar";
import { SystemSegmentedTabs } from "@/components/SystemSegmentedTabs";
import { env } from "@/config/env";
import type {
  ShortDramaSeries,
  ShortDramaSeriesFilter,
  ShortDramaSeriesPage,
  ShortDramaVideo,
} from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  coalesceShortDramaSeriesInitialLoad,
  isShortDramaSeriesRepositoryResetError,
  loadCachedShortDramaSeriesPage,
  saveCachedShortDramaSeriesPage,
} from "@/services/short-drama/ShortDramaSeriesRepository";
import {
  readShortDramaHistory,
  subscribeShortDramaHistory,
} from "@/services/short-drama/ShortDramaHistoryRepository";
import { subscribeShortDramaLibrary } from "@/services/short-drama/ShortDramaLibraryStore";
import {
  applyShortDramaHistory,
  groupLegacyShortDramaVideos,
  mergeShortDramaEpisodes,
  mergeUniqueShortDramaSeries,
  shortDramaEpisodePageCount,
  shortDramaEpisodeSlots,
  shortDramaRangeTitle,
  shortDramaSeriesMetrics,
  shortDramaSeriesIsBlank,
  sortedShortDramaEpisodes,
  type ShortDramaEpisodeSlot,
} from "@/services/short-drama/shortDramaSeriesPolicy";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";
import { runAfterNavigationInteractions } from "@/services/navigation/NavigationWorkScheduler";

interface FilterState {
  series: ShortDramaSeries[];
  hasMore: boolean;
  nextCursor?: string | undefined;
  isLoading: boolean;
  isLoadingMore: boolean;
  error?: string | undefined;
}

type FilterStates = Record<ShortDramaSeriesFilter, FilterState>;

const initialFilterStates: FilterStates = {
  recommended: { series: [], hasMore: true, isLoading: false, isLoadingMore: false },
  watched: { series: [], hasMore: true, isLoading: false, isLoadingMore: false },
};

const secondarySystemBackground = PlatformColor("secondarySystemBackgroundColor");
const systemBackground = PlatformColor("systemBackgroundColor");

export default function ShortDramaSeriesScreen() {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  return <ShortDramaSeriesContent key={`owner:${ownerId || "guest"}`} ownerId={ownerId} />;
}

function ShortDramaSeriesContent({ ownerId }: { ownerId: string }) {
  const { t } = useLocalization();
  const styles = useMemo(() => makeStyles(), []);
  const [filter, setFilter] = useState<ShortDramaSeriesFilter>("recommended");
  const [states, setStates] = useState<FilterStates>(initialFilterStates);
  const statesRef = useRef(states);
  const loadedRef = useRef(new Set<ShortDramaSeriesFilter>());
  const busyRef = useRef(new Set<ShortDramaSeriesFilter>());
  const requestTokensRef = useRef<Record<ShortDramaSeriesFilter, number>>({
    recommended: 0,
    watched: 0,
  });
  const mountedRef = useRef(true);
  const historyTokenRef = useRef(0);
  const loadMoreActivationRef = useRef<Partial<Record<ShortDramaSeriesFilter, string>>>({});
  const current = states[filter];

  const isRequestActive = useCallback(
    (target: ShortDramaSeriesFilter, token: number) =>
      mountedRef.current && requestTokensRef.current[target] === token,
    [],
  );

  const commit = useCallback(
    (target: ShortDramaSeriesFilter, update: (state: FilterState) => FilterState) => {
      if (!mountedRef.current) return;
      const nextState = update(statesRef.current[target]);
      const next = { ...statesRef.current, [target]: nextState };
      statesRef.current = next;
      setStates(next);
    },
    [],
  );

  const applyPage = useCallback(
    async (
      target: ShortDramaSeriesFilter,
      page: ShortDramaSeriesPage,
      reset: boolean,
      requestToken: number,
      persist: boolean,
    ): Promise<boolean> => {
      const history = await readShortDramaHistory(ownerId);
      if (!isRequestActive(target, requestToken)) return false;
      const incoming = page.series.map((series) => applyShortDramaHistory(series, history));
      const merged = mergeUniqueShortDramaSeries(
        reset ? [] : statesRef.current[target].series,
        incoming,
      );
      commit(target, (state) => ({
        ...state,
        series: merged,
        hasMore: page.has_more,
        nextCursor: page.next_cursor,
      }));
      loadedRef.current.add(target);
      if (persist) {
        await saveCachedShortDramaSeriesPage(ownerId, target, {
          series: merged,
          has_more: page.has_more,
          ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}),
        });
      }
      return isRequestActive(target, requestToken);
    },
    [commit, isRequestActive, ownerId],
  );

  const applyHistory = useCallback(async () => {
    const token = ++historyTokenRef.current;
    const history = await readShortDramaHistory(ownerId);
    if (!mountedRef.current || historyTokenRef.current !== token) return;
    for (const target of ["recommended", "watched"] as const) {
      commit(target, (state) => {
        const next = state.series.map((series) => applyShortDramaHistory(series, history));
        if (target === "watched") {
          next.sort((left, right) =>
            (right.last_watched_at ?? "").localeCompare(left.last_watched_at ?? ""),
          );
        }
        return { ...state, series: next };
      });
    }
  }, [commit, ownerId]);

  const loadLegacyFallback = useCallback(
    async (target: ShortDramaSeriesFilter, originalError: unknown, requestToken: number) => {
      try {
        const [page, history] = await Promise.all([
          getShortDramaFeed({ limit: shortDramaSeriesMetrics.legacyPageLimit }),
          readShortDramaHistory(ownerId),
        ]);
        let grouped = groupLegacyShortDramaVideos(page.videos, t("shortDrama.video")).map(
          (series) => applyShortDramaHistory(series, history),
        );
        if (target === "watched") {
          grouped = grouped
            .filter((series) => history[series.series_id] !== undefined)
            .sort((left, right) =>
              (right.last_watched_at ?? "").localeCompare(left.last_watched_at ?? ""),
            );
        }
        await applyPage(target, { series: grouped, has_more: false }, true, requestToken, true);
      } catch {
        if (!isRequestActive(target, requestToken)) return;
        commit(target, (state) => ({
          ...state,
          error: readableError(originalError, t("common.operationFailed"), t),
        }));
      }
    },
    [applyPage, commit, isRequestActive, ownerId, t],
  );

  const load = useCallback(
    async (target: ShortDramaSeriesFilter, reset: boolean, force: boolean) => {
      if (!ownerId || busyRef.current.has(target)) return;
      if (reset && !force && loadedRef.current.has(target)) {
        await applyHistory();
        return;
      }
      busyRef.current.add(target);
      if (reset) {
        delete loadMoreActivationRef.current[target];
      } else {
        const state = statesRef.current[target];
        const activation = state.series.at(-1)?.series_id;
        if (!state.hasMore || !activation || loadMoreActivationRef.current[target] === activation) {
          busyRef.current.delete(target);
          return;
        }
        loadMoreActivationRef.current[target] = activation;
      }
      const token = ++requestTokensRef.current[target];
      commit(target, (state) => ({
        ...state,
        ...(reset
          ? { isLoading: true, hasMore: true, nextCursor: undefined }
          : { isLoadingMore: true }),
        error: undefined,
      }));
      let cached: Awaited<ReturnType<typeof loadCachedShortDramaSeriesPage>> = null;
      try {
        if (reset) {
          cached = await loadCachedShortDramaSeriesPage(ownerId, target);
          if (!isRequestActive(target, token)) return;
          if (cached && !(await applyPage(target, cached.value, true, token, false))) return;
          if (cached && !cached.isStale && !force) return;
        }
        try {
          const cursor = reset ? undefined : statesRef.current[target].nextCursor;
          const fetch = () =>
            getShortDramaSeriesFeed(target, {
              ...(cursor ? { cursor } : {}),
              limit: shortDramaSeriesMetrics.pageLimit,
            });
          const page = reset
            ? await coalesceShortDramaSeriesInitialLoad(ownerId, target, fetch)
            : await fetch();
          if (!isRequestActive(target, token)) return;
          await applyPage(target, page, reset, token, true);
        } catch (error) {
          if (!isRequestActive(target, token)) return;
          if (isShortDramaSeriesRepositoryResetError(error)) return;
          if (cached) return;
          if (reset) await loadLegacyFallback(target, error, token);
          else
            commit(target, (state) => ({
              ...state,
              error: readableError(error, t("common.operationFailed"), t),
            }));
        }
      } finally {
        busyRef.current.delete(target);
        if (isRequestActive(target, token)) {
          commit(target, (state) => ({
            ...state,
            isLoading: false,
            isLoadingMore: false,
          }));
        }
      }
    },
    [applyHistory, applyPage, commit, isRequestActive, loadLegacyFallback, ownerId, t],
  );

  useEffect(() => {
    const requestTokens = requestTokensRef.current;
    const busyFilters = busyRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      historyTokenRef.current += 1;
      requestTokens.recommended += 1;
      requestTokens.watched += 1;
      busyFilters.clear();
    };
  }, []);

  useEffect(() => {
    return runAfterNavigationInteractions(() => void load(filter, true, false));
  }, [filter, load, ownerId]);

  useEffect(
    () =>
      subscribeShortDramaHistory((changedOwnerId) => {
        if (changedOwnerId !== ownerId) return;
        void applyHistory();
      }),
    [applyHistory, ownerId],
  );

  useEffect(
    () =>
      subscribeShortDramaLibrary((event) => {
        if (event.owner_id !== ownerId) return;
        loadedRef.current.delete(filter);
        void load(filter, true, true);
      }),
    [filter, load, ownerId],
  );

  useFocusEffect(
    useCallback(() => {
      return runAfterNavigationInteractions(() => void applyHistory());
    }, [applyHistory]),
  );

  const openSeries = useCallback((series: ShortDramaSeries, episode?: ShortDramaVideo) => {
    router.push({
      pathname: "/short-drama-player",
      params: {
        seriesId: series.series_id,
        ...(episode?.id || series.resume_episode_id
          ? { episodeId: episode?.id ?? series.resume_episode_id }
          : {}),
        initialPosition: String(episode ? 0 : series.resume_position_seconds),
      },
    });
  }, []);
  const headerOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      title: "",
      headerBackVisible: false,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: secondarySystemBackground },
      headerTintColor: colors.text,
      headerTitleAlign: "center",
      headerLeft: () => (
        <Pressable
          accessibilityLabel={t("common.back")}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <SymbolView name="chevron.left" size={17} weight="semibold" tintColor={colors.text} />
        </Pressable>
      ),
      headerTitle: () => (
        <SystemSegmentedTabs<ShortDramaSeriesFilter>
          accessibilityIdentifier="shortDrama.top.tabs"
          colorScheme="light"
          items={[
            { value: "recommended", title: t("shortDrama.tab.recommended") },
            { value: "watched", title: t("shortDrama.tab.watched") },
          ]}
          onSelectionChange={setFilter}
          selection={filter}
          width={shortDramaSeriesMetrics.segmentedWidth}
        />
      ),
      headerRight: () => (
        <Pressable
          accessibilityLabel={t("shortDrama.series.create")}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push("/short-drama-editor")}
          style={styles.createButton}
        >
          <SymbolView
            name="plus"
            size={shortDramaSeriesMetrics.createSymbolSize}
            weight="semibold"
            tintColor={colors.text}
          />
        </Pressable>
      ),
    }),
    [filter, styles.backButton, styles.createButton, t],
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={headerOptions} />

      <FlatList
        contentContainerStyle={[styles.list, current.series.length === 0 && styles.emptyList]}
        data={current.series}
        ItemSeparatorComponent={() => <View style={styles.cardGap} />}
        keyExtractor={(series) => series.series_id}
        ListEmptyComponent={
          current.isLoading ? (
            <ActivityIndicator color={colors.accent} style={styles.initialLoading} />
          ) : (
            <ShortDramaSeriesEmpty error={current.error} styles={styles} t={t} />
          )
        }
        ListFooterComponent={
          current.series.length > 0 && (current.isLoading || current.isLoadingMore) ? (
            <ActivityIndicator color={colors.accent} style={styles.loadingMore} />
          ) : null
        }
        onEndReached={() => {
          if (current.hasMore) void load(filter, false, false);
        }}
        onEndReachedThreshold={0.1}
        refreshControl={
          <RefreshControl
            onRefresh={() => void load(filter, true, true)}
            refreshing={current.isLoading && current.series.length > 0}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <ShortDramaSeriesCard
            onOpenEpisode={(episode) => openSeries(item, episode)}
            onOpenSeries={() => openSeries(item)}
            series={item}
            setParentSeries={(update) => {
              commit(filter, (state) => ({
                ...state,
                series: state.series.map((series) =>
                  series.series_id === item.series_id ? update(series) : series,
                ),
              }));
            }}
            styles={styles}
            t={t}
          />
        )}
        showsVerticalScrollIndicator={false}
        testID="short-drama-series-list"
      />

      {current.error && current.series.length > 0 ? (
        <Text style={styles.errorBanner}>{current.error}</Text>
      ) : null}
    </View>
  );
}

function ShortDramaSeriesCard({
  onOpenEpisode,
  onOpenSeries,
  series,
  setParentSeries,
  styles,
  t,
}: {
  onOpenEpisode(episode: ShortDramaVideo): void;
  onOpenSeries(): void;
  series: ShortDramaSeries;
  setParentSeries(update: (series: ShortDramaSeries) => ShortDramaSeries): void;
  styles: ReturnType<typeof makeStyles>;
  t(key: string, ...args: (string | number)[]): string;
}) {
  const { width } = useWindowDimensions();
  const [loadedEpisodes, setLoadedEpisodes] = useState(series.episodes);
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoadingEpisodes, setLoadingEpisodes] = useState(false);
  const loadedEpisodesRef = useRef(series.episodes);
  const detailLoadRef = useRef<Promise<ShortDramaVideo[]> | null>(null);
  const initialLoadSeriesIdRef = useRef<string | null>(null);
  const activeRef = useRef(true);
  const episodes = useMemo(() => sortedShortDramaEpisodes(loadedEpisodes), [loadedEpisodes]);
  const expectedEpisodeCount = Math.max(series.episode_count, episodes.length);
  const pageCount = shortDramaEpisodePageCount(expectedEpisodeCount);
  const slots = shortDramaEpisodeSlots(episodes, expectedEpisodeCount, currentPage);
  const episodeWidth = Math.max(
    1,
    (width -
      shortDramaSeriesMetrics.listInset * 2 -
      shortDramaSeriesMetrics.cardInset * 2 -
      shortDramaSeriesMetrics.episodeGap * 4) /
      shortDramaSeriesMetrics.episodeColumns,
  );

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLoadedEpisodes((current) => {
        const merged = mergeShortDramaEpisodes(current, series.episodes);
        loadedEpisodesRef.current = merged;
        return merged;
      });
    });
    return () => {
      active = false;
    };
  }, [series.episodes]);

  const loadFullEpisodeList = useCallback((): Promise<ShortDramaVideo[]> => {
    const currentEpisodes = loadedEpisodesRef.current;
    if (Math.max(series.episode_count, currentEpisodes.length) <= currentEpisodes.length) {
      return Promise.resolve(currentEpisodes);
    }
    if (detailLoadRef.current) return detailLoadRef.current;
    setLoadingEpisodes(true);
    let request!: Promise<ShortDramaVideo[]>;
    request = getShortDramaSeriesDetail(series.series_id)
      .then((detail) => {
        const merged = mergeShortDramaEpisodes(loadedEpisodesRef.current, detail.episodes);
        loadedEpisodesRef.current = merged;
        if (activeRef.current) {
          setLoadedEpisodes(merged);
          setCurrentPage((page) =>
            Math.min(
              page,
              shortDramaEpisodePageCount(Math.max(series.episode_count, merged.length)) - 1,
            ),
          );
          setParentSeries((current) => ({
            ...current,
            episodes: mergeShortDramaEpisodes(current.episodes, detail.episodes),
          }));
        }
        return merged;
      })
      .catch(() => loadedEpisodesRef.current)
      .finally(() => {
        if (detailLoadRef.current === request) detailLoadRef.current = null;
        if (activeRef.current) setLoadingEpisodes(false);
      });
    detailLoadRef.current = request;
    return request;
  }, [series.episode_count, series.series_id, setParentSeries]);

  useEffect(() => {
    if (initialLoadSeriesIdRef.current === series.series_id) return;
    let active = true;
    queueMicrotask(() => {
      if (!active || initialLoadSeriesIdRef.current === series.series_id) return;
      initialLoadSeriesIdRef.current = series.series_id;
      void loadFullEpisodeList();
    });
    return () => {
      active = false;
    };
  }, [loadFullEpisodeList, series.series_id]);

  const openSlot = useCallback(
    async (slot: ShortDramaEpisodeSlot) => {
      if (slot.episode) {
        onOpenEpisode(slot.episode);
        return;
      }
      const complete = sortedShortDramaEpisodes(await loadFullEpisodeList());
      const episode = complete[slot.number - 1];
      if (episode) onOpenEpisode(episode);
    },
    [loadFullEpisodeList, onOpenEpisode],
  );

  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" onPress={onOpenSeries} style={styles.seriesSummary}>
        <Text numberOfLines={2} style={styles.seriesTitle}>
          {series.title}
        </Text>
        <ShortDramaPoster styles={styles} url={series.cover_url} />
        <Text numberOfLines={3} style={styles.seriesIntro}>
          <Text style={styles.introLabel}>{t("shortDrama.series.introLabel")}</Text>
          {shortDramaSeriesIsBlank(series.intro) ? t("shortDrama.series.noIntro") : series.intro}
        </Text>
      </Pressable>

      <View style={styles.episodesSection}>
        {expectedEpisodeCount > 0 ? (
          <EpisodeRangePicker
            count={expectedEpisodeCount}
            currentPage={currentPage}
            onSelect={(page) => {
              if (page >= 0 && page < pageCount) {
                LayoutAnimation.configureNext({
                  duration: 180,
                  update: { type: LayoutAnimation.Types.easeInEaseOut },
                });
                setCurrentPage(page);
              }
            }}
            pageCount={pageCount}
            styles={styles}
          />
        ) : null}
        <View style={styles.episodeGrid}>
          {slots.map((slot) => (
            <Pressable
              accessibilityLabel={t("shortDrama.episode", slot.number)}
              accessibilityRole="button"
              key={slot.number}
              onPress={() => void openSlot(slot)}
              style={[styles.episodeSquare, { width: episodeWidth }]}
              testID={`short-drama-episode-${slot.number}`}
            >
              <Text
                style={[styles.episodeNumber, !slot.episode && styles.episodeNumberUnavailable]}
              >
                {slot.number}
              </Text>
              {slot.episode && requiresUnlock(slot.episode) ? (
                <SymbolView
                  name="lock.fill"
                  size={shortDramaSeriesMetrics.lockSymbolSize}
                  weight="bold"
                  tintColor={styles.accent.color}
                  style={styles.episodeLock}
                />
              ) : null}
              {isLoadingEpisodes && !slot.episode ? (
                <ActivityIndicator
                  color={styles.accent.color}
                  size="small"
                  style={styles.episodeLoading}
                />
              ) : null}
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.creatorDivider} />
      <View style={styles.creatorRow}>
        <UserAvatarButton
          accessibilityName={series.creator.nickname}
          avatarUrl={series.creator.avatar_url}
          size={shortDramaSeriesMetrics.creatorAvatarSize}
          userId={series.creator.user_id}
        />
        <Text numberOfLines={1} style={styles.creatorCopy}>
          {t("shortDrama.series.uploadedBy", series.creator.nickname)}
        </Text>
      </View>
      <View pointerEvents="none" style={styles.cardBorder} />
    </View>
  );
}

function EpisodeRangePicker({
  count,
  currentPage,
  onSelect,
  pageCount,
  styles,
}: {
  count: number;
  currentPage: number;
  onSelect(page: number): void;
  pageCount: number;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.rangeContent}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.rangeScroller}
    >
      {Array.from({ length: pageCount }, (_, page) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: page === currentPage }}
          key={page}
          onPress={() => onSelect(page)}
          style={styles.rangeButton}
        >
          <Text style={[styles.rangeTitle, page === currentPage && styles.rangeTitleSelected]}>
            {shortDramaRangeTitle(page, count)}
          </Text>
          <View
            style={[styles.rangeUnderline, page === currentPage && styles.rangeUnderlineSelected]}
          />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ShortDramaPoster({ styles, url }: { styles: ReturnType<typeof makeStyles>; url: string }) {
  const resolved = resolveMediaUrl(url, env.apiBaseUrl);
  const fallback = (
    <LinearGradient
      colors={["#2B2D42", "#7C3AED", "#FF4D8D"]}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={styles.posterFallback}
    >
      <SymbolView
        name="play.rectangle.fill"
        size={22}
        weight="semibold"
        tintColor="rgba(255,255,255,0.90)"
      />
    </LinearGradient>
  );
  return (
    <View style={styles.poster}>
      {resolved ? (
        <AuthenticatedImage
          contentFit="cover"
          errorFallback={fallback}
          fallback={fallback}
          loadingFallback={fallback}
          style={StyleSheet.absoluteFill}
          transition={0}
          uri={resolved}
        />
      ) : (
        fallback
      )}
    </View>
  );
}

function ShortDramaSeriesEmpty({
  error,
  styles,
  t,
}: {
  error?: string | undefined;
  styles: ReturnType<typeof makeStyles>;
  t(key: string): string;
}) {
  return (
    <View style={styles.emptyState}>
      <SymbolView
        name={(error ? "exclamationmark.triangle" : "play.rectangle.stack") as never}
        size={34}
        weight="semibold"
        tintColor={styles.accent.color}
      />
      <Text style={styles.emptyText}>{error ?? t("shortDrama.empty")}</Text>
    </View>
  );
}

function requiresUnlock(video: ShortDramaVideo): boolean {
  return (
    (video.unlock_price_gold_coins ?? 0) > 0 &&
    !video.is_unlocked &&
    !video.is_owned_by_current_user
  );
}

function readableError(
  error: unknown,
  fallback: string,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  if (!(error instanceof Error) || !trimFoundationWhitespacesAndNewlines(error.message))
    return fallback;
  return t(error.message);
}

function makeStyles() {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: secondarySystemBackground },
    accent: { color: colors.accent },
    backButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
    createButton: {
      width: shortDramaSeriesMetrics.createButtonSize,
      height: shortDramaSeriesMetrics.createButtonSize,
      alignItems: "center",
      justifyContent: "center",
    },
    list: { padding: shortDramaSeriesMetrics.listInset },
    emptyList: { flexGrow: 1 },
    cardGap: { height: shortDramaSeriesMetrics.listGap },
    card: {
      padding: shortDramaSeriesMetrics.cardInset,
      borderRadius: shortDramaSeriesMetrics.cardRadius,
      backgroundColor: systemBackground,
    },
    cardBorder: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderRadius: shortDramaSeriesMetrics.cardRadius,
      borderWidth: shortDramaSeriesMetrics.cardBorderWidth,
      borderColor: `${colors.separator}B3`,
    },
    seriesSummary: { alignItems: "stretch", gap: shortDramaSeriesMetrics.headerGap },
    seriesTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: "700" },
    poster: {
      height: shortDramaSeriesMetrics.posterHeight,
      overflow: "hidden",
      borderRadius: shortDramaSeriesMetrics.posterRadius,
    },
    posterFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
    seriesIntro: { color: colors.secondaryText, fontSize: 15, lineHeight: 20 },
    introLabel: { fontWeight: "600" },
    episodesSection: {
      gap: shortDramaSeriesMetrics.episodesGap,
      paddingTop: shortDramaSeriesMetrics.episodesTopInset,
    },
    rangeScroller: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: `${colors.separator}80`,
    },
    rangeContent: {
      gap: shortDramaSeriesMetrics.rangeGap,
      paddingBottom: shortDramaSeriesMetrics.rangeBottomInset,
    },
    rangeButton: {
      minWidth: shortDramaSeriesMetrics.rangeMinimumWidth,
      alignItems: "flex-start",
      gap: shortDramaSeriesMetrics.rangeCopyGap,
    },
    rangeTitle: {
      color: colors.secondaryText,
      fontSize: shortDramaSeriesMetrics.rangeTitleSize,
      fontWeight: "600",
    },
    rangeTitleSelected: { color: "#000000" },
    rangeUnderline: {
      width: shortDramaSeriesMetrics.rangeUnderlineWidth,
      height: shortDramaSeriesMetrics.rangeUnderlineHeight,
      borderRadius: shortDramaSeriesMetrics.rangeUnderlineHeight / 2,
      backgroundColor: "transparent",
    },
    rangeUnderlineSelected: { backgroundColor: "#000000" },
    episodeGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: shortDramaSeriesMetrics.episodeGap,
    },
    episodeSquare: {
      height: shortDramaSeriesMetrics.episodeHeight,
      overflow: "hidden",
      borderRadius: shortDramaSeriesMetrics.episodeRadius,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: secondarySystemBackground,
    },
    episodeNumber: { color: colors.text, fontSize: 15, fontWeight: "700" },
    episodeNumberUnavailable: { color: colors.tertiaryText },
    episodeLock: {
      position: "absolute",
      top: shortDramaSeriesMetrics.lockInset,
      right: shortDramaSeriesMetrics.lockInset,
    },
    episodeLoading: { position: "absolute", transform: [{ scale: 0.65 }] },
    creatorDivider: {
      height: StyleSheet.hairlineWidth,
      marginTop: shortDramaSeriesMetrics.creatorDividerTopInset,
      backgroundColor: `${colors.separator}80`,
    },
    creatorRow: {
      minHeight: shortDramaSeriesMetrics.creatorAvatarSize,
      paddingTop: shortDramaSeriesMetrics.creatorTopInset,
      flexDirection: "row",
      alignItems: "center",
      gap: shortDramaSeriesMetrics.creatorGap,
    },
    creatorCopy: {
      flex: 1,
      color: colors.secondaryText,
      fontSize: shortDramaSeriesMetrics.creatorCopySize,
      fontWeight: "500",
    },
    initialLoading: { padding: shortDramaSeriesMetrics.loadingInset },
    loadingMore: { padding: shortDramaSeriesMetrics.loadingInset },
    emptyState: {
      alignItems: "center",
      gap: shortDramaSeriesMetrics.emptyGap,
      paddingTop: shortDramaSeriesMetrics.emptyTopInset,
    },
    emptyText: {
      color: colors.secondaryText,
      fontSize: 15,
      fontWeight: "600",
      textAlign: "center",
    },
    errorBanner: {
      position: "absolute",
      top: shortDramaSeriesMetrics.errorTopInset,
      alignSelf: "center",
      overflow: "hidden",
      color: "#FFFFFF",
      fontSize: 12,
      fontWeight: "600",
      paddingHorizontal: shortDramaSeriesMetrics.errorHorizontalInset,
      paddingVertical: shortDramaSeriesMetrics.errorVerticalInset,
      borderRadius: 999,
      backgroundColor: "#FF3B30",
    },
  });
}
