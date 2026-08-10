import { LinearGradient } from "expo-linear-gradient";
import { router, Stack, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";

import { getMyShortDramaSeries, getShortDramaSeriesDetail } from "@/api/bwchat";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { Avatar } from "@/components/Avatar";
import { TopToast } from "@/components/TopToast";
import { env } from "@/config/env";
import type { ShortDramaPublishStatus, ShortDramaSeries, ShortDramaVideo } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  readNavigationSnapshot,
  writeNavigationSnapshot,
} from "@/services/navigation/NavigationSnapshotCache";
import { rememberShortDramaSeriesForEditing } from "@/services/short-drama/ShortDramaEditorNavigationStore";
import { subscribeShortDramaLibrary } from "@/services/short-drama/ShortDramaLibraryStore";
import {
  readShortDramaUploadJobs,
  subscribeShortDramaUploads,
  type ShortDramaUploadJob,
} from "@/services/short-drama/ShortDramaUploadQueue";
import {
  appendUniqueShortDramaStudioSeries,
  mergeShortDramaStudioInitial,
  shortDramaSeriesFromUploadJob,
  shortDramaStatusLocalizationKey,
  shortDramaStatusTone,
  shortDramaStudioMetrics,
  upsertShortDramaStudioSeries,
} from "@/services/short-drama/shortDramaStudioPolicy";
import {
  mergeShortDramaEpisodes,
  shortDramaEpisodePageCount,
  shortDramaEpisodeSlots,
  shortDramaRangeTitle,
  shortDramaSeriesMetrics,
  sortedShortDramaEpisodes,
  type ShortDramaEpisodeSlot,
} from "@/services/short-drama/shortDramaSeriesPolicy";
import { palette } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

type Translate = (key: string, ...args: (string | number)[]) => string;

interface ShortDramaStudioNavigationSnapshot {
  series: ShortDramaSeries[];
  hasMore: boolean;
  nextCursor?: string | undefined;
}

export default function ShortDramaStudioScreen() {
  const { user } = useAuth();
  const { t } = useLocalization();
  const ownerId = user?.user_id ?? "";
  const scheme = useColorScheme();
  const theme = palette(scheme);
  const styles = useMemo(() => makeStyles(scheme), [scheme]);
  const [navigationSnapshot] = useState(() =>
    readNavigationSnapshot<ShortDramaStudioNavigationSnapshot>("short-drama-studio", ownerId),
  );
  const [series, setSeries] = useState<ShortDramaSeries[]>(navigationSnapshot?.series ?? []);
  const [isLoading, setLoading] = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(navigationSnapshot?.hasMore ?? true);
  const [nextCursor, setNextCursor] = useState<string | undefined>(navigationSnapshot?.nextCursor);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const jobsRef = useRef<ShortDramaUploadJob[]>([]);
  const busyRef = useRef(false);
  const didLoadRef = useRef(false);
  const requestRef = useRef(0);
  const ownerRef = useRef(ownerId);

  useEffect(() => {
    if (ownerRef.current !== ownerId) return;
    writeNavigationSnapshot<ShortDramaStudioNavigationSnapshot>("short-drama-studio", ownerId, {
      series,
      hasMore,
      ...(nextCursor ? { nextCursor } : {}),
    });
  }, [hasMore, nextCursor, ownerId, series]);

  const load = useCallback(
    async (reset: boolean) => {
      if (!ownerId || busyRef.current || (!reset && !hasMore)) return;
      busyRef.current = true;
      const request = ++requestRef.current;
      if (reset) {
        setLoading(true);
        setHasMore(true);
        setNextCursor(undefined);
      } else {
        setLoadingMore(true);
      }
      setErrorMessage(null);
      try {
        const page = await getMyShortDramaSeries({
          limit: shortDramaStudioMetrics.pageLimit,
          ...(!reset && nextCursor ? { cursor: nextCursor } : {}),
        });
        if (requestRef.current !== request) return;
        if (reset) {
          const jobs = await readShortDramaUploadJobs(ownerId);
          if (requestRef.current !== request) return;
          jobsRef.current = jobs;
          setSeries(mergeShortDramaStudioInitial(jobs, page.series, t("common.retry")));
        } else {
          setSeries((current) => appendUniqueShortDramaStudioSeries(current, page.series));
        }
        setHasMore(page.has_more);
        setNextCursor(page.next_cursor);
      } catch (error) {
        if (requestRef.current === request) {
          setErrorMessage(readableError(error, t("common.operationFailed")));
        }
      } finally {
        if (requestRef.current === request) {
          setLoading(false);
          setLoadingMore(false);
          didLoadRef.current = true;
        }
        busyRef.current = false;
      }
    },
    [hasMore, nextCursor, ownerId, t],
  );

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (ownerRef.current === ownerId) return;
    ownerRef.current = ownerId;
    requestRef.current += 1;
    busyRef.current = false;
    didLoadRef.current = false;
    jobsRef.current = [];
    queueMicrotask(() => {
      setSeries([]);
      setHasMore(true);
      setNextCursor(undefined);
      setErrorMessage(null);
      void loadRef.current(true);
    });
  }, [ownerId]);

  useFocusEffect(
    useCallback(() => {
      if (!didLoadRef.current) void load(true);
    }, [load]),
  );

  useEffect(
    () =>
      subscribeShortDramaUploads((event) => {
        if (event.job.owner_id !== ownerId) return;
        const otherJobs = jobsRef.current.filter((job) => job.id !== event.job.id);
        if (event.kind === "submitted") {
          jobsRef.current = otherJobs;
          setSeries((current) =>
            upsertShortDramaStudioSeries(
              current.filter((item) => item.series_id !== `local:${event.job.id}`),
              event.series,
              [event.job],
            ),
          );
          return;
        }
        jobsRef.current = [event.job, ...otherJobs];
        if (event.kind === "saved") {
          setSeries((current) =>
            upsertShortDramaStudioSeries(current, event.series, jobsRef.current),
          );
          return;
        }
        setSeries((current) => {
          if (
            event.job.server_id &&
            current.some((item) => item.series_id === event.job.server_id)
          ) {
            return current.filter((item) => item.series_id !== `local:${event.job.id}`);
          }
          return upsertShortDramaStudioSeries(
            current,
            shortDramaSeriesFromUploadJob(event.job, t("common.retry")),
          );
        });
      }),
    [ownerId, t],
  );

  useEffect(
    () =>
      subscribeShortDramaLibrary((event) => {
        if (event.owner_id !== ownerId) return;
        if (event.kind === "refresh") {
          void load(true);
          return;
        }
        setSeries((current) =>
          upsertShortDramaStudioSeries(current, event.series, jobsRef.current),
        );
      }),
    [load, ownerId],
  );

  const openEditor = useCallback((item: ShortDramaSeries) => {
    if (item.series_id.startsWith("local:")) {
      router.push({
        pathname: "/short-drama-editor",
        params: { resumeJobId: item.series_id.slice("local:".length) },
      });
      return;
    }
    rememberShortDramaSeriesForEditing(item);
    router.push({ pathname: "/short-drama-editor", params: { seriesId: item.series_id } });
  }, []);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: t("shortDrama.studio.title"),
          headerBackVisible: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTitleAlign: "center",
          headerLeft: () => (
            <Pressable
              accessibilityLabel={t("common.back")}
              hitSlop={8}
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <SymbolView name="chevron.left" size={17} weight="semibold" tintColor={theme.text} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              accessibilityLabel={t("shortDrama.series.create")}
              hitSlop={8}
              onPress={() => router.push("/short-drama-editor")}
              style={styles.createButton}
            >
              <SymbolView name="plus" size={18} weight="semibold" tintColor={theme.text} />
            </Pressable>
          ),
        }}
      />

      <FlatList
        contentContainerStyle={[styles.list, series.length === 0 && styles.emptyList]}
        data={series}
        ItemSeparatorComponent={() => <View style={styles.cardGap} />}
        keyExtractor={(item) => item.series_id}
        ListEmptyComponent={
          isLoading ? (
            <StudioLoadingState styles={styles} t={t} />
          ) : (
            <StudioEmptyState
              onCreate={() => router.push("/short-drama-editor")}
              styles={styles}
              t={t}
            />
          )
        }
        ListFooterComponent={
          series.length > 0 && isLoadingMore ? (
            <ActivityIndicator color={theme.accent} style={styles.loadingMore} />
          ) : null
        }
        onEndReached={() => {
          if (series.length > 0) void load(false);
        }}
        onEndReachedThreshold={0.1}
        refreshControl={
          <RefreshControl
            onRefresh={() => void load(true)}
            refreshing={isLoading && series.length > 0}
            tintColor={theme.accent}
          />
        }
        renderItem={({ item }) => (
          <StudioSeriesCard onOpen={() => openEditor(item)} series={item} styles={styles} t={t} />
        )}
        showsVerticalScrollIndicator={false}
      />
      <TopToast message={errorMessage} onDismiss={() => setErrorMessage(null)} />
    </View>
  );
}

type StudioStyles = ReturnType<typeof makeStyles>;

function StudioSeriesCard({
  onOpen,
  series,
  styles,
  t,
}: {
  onOpen(): void;
  series: ShortDramaSeries;
  styles: StudioStyles;
  t: Translate;
}) {
  const { width } = useWindowDimensions();
  const [loadedEpisodes, setLoadedEpisodes] = useState(series.episodes);
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoadingEpisodes, setLoadingEpisodes] = useState(false);
  const loadingRef = useRef(false);
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

  useEffect(
    () => () => {
      activeRef.current = false;
    },
    [],
  );
  useEffect(() => {
    queueMicrotask(() => {
      setLoadedEpisodes((current) => mergeShortDramaEpisodes(current, series.episodes));
    });
  }, [series.episodes]);

  const loadFullEpisodeList = useCallback(async (): Promise<ShortDramaVideo[]> => {
    if (
      loadingRef.current ||
      expectedEpisodeCount <= loadedEpisodes.length ||
      series.series_id.startsWith("local:")
    )
      return loadedEpisodes;
    loadingRef.current = true;
    setLoadingEpisodes(true);
    try {
      const detail = await getShortDramaSeriesDetail(series.series_id);
      const merged = mergeShortDramaEpisodes(loadedEpisodes, detail.episodes);
      if (activeRef.current) {
        setLoadedEpisodes(merged);
        setCurrentPage((page) =>
          Math.min(
            page,
            shortDramaEpisodePageCount(Math.max(series.episode_count, merged.length)) - 1,
          ),
        );
      }
      return merged;
    } catch {
      return loadedEpisodes;
    } finally {
      loadingRef.current = false;
      if (activeRef.current) setLoadingEpisodes(false);
    }
  }, [expectedEpisodeCount, loadedEpisodes, series.episode_count, series.series_id]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadFullEpisodeList();
    });
    return () => {
      active = false;
    };
  }, [loadFullEpisodeList]);

  const openSlot = useCallback(
    async (slot: ShortDramaEpisodeSlot) => {
      if (slot.episode) {
        onOpen();
        return;
      }
      const complete = sortedShortDramaEpisodes(await loadFullEpisodeList());
      if (complete[slot.number - 1]) onOpen();
    },
    [loadFullEpisodeList, onOpen],
  );

  return (
    <View style={styles.card}>
      <Pressable onPress={onOpen} style={styles.seriesSummary}>
        <View style={styles.titleRow}>
          <Text numberOfLines={2} style={styles.seriesTitle}>
            {series.title}
          </Text>
          <StatusPill status={series.status} styles={styles} t={t} />
        </View>
        <StudioPoster styles={styles} url={series.cover_url} />
        <Text numberOfLines={3} style={styles.seriesIntro}>
          <Text style={styles.introLabel}>{t("shortDrama.series.introLabel")}</Text>
          {series.intro.trim() || t("shortDrama.series.noIntro")}
        </Text>
      </Pressable>

      <View style={styles.episodesSection}>
        {expectedEpisodeCount > 0 ? (
          <EpisodeRangePicker
            count={expectedEpisodeCount}
            currentPage={currentPage}
            onSelect={(page) => {
              if (page < 0 || page >= pageCount) return;
              LayoutAnimation.configureNext({
                duration: 180,
                update: { type: LayoutAnimation.Types.easeInEaseOut },
              });
              setCurrentPage(page);
            }}
            pageCount={pageCount}
            styles={styles}
          />
        ) : null}
        <View style={styles.episodeGrid}>
          {slots.map((slot) => (
            <Pressable
              accessibilityLabel={t("shortDrama.episode", slot.number)}
              key={slot.number}
              onPress={() => void openSlot(slot)}
              style={[styles.episodeSquare, { width: episodeWidth }]}
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
              {slot.episode?.publish_status ? (
                <View style={styles.statusDotSlot}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: statusColor(slot.episode.publish_status, styles) },
                    ]}
                  />
                </View>
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
        <Pressable
          accessibilityLabel={series.creator.nickname}
          onPress={() => {
            if (series.creator.user_id) {
              router.push({ pathname: "/user-profile", params: { id: series.creator.user_id } });
            }
          }}
        >
          <Avatar
            name={series.creator.nickname}
            size={shortDramaSeriesMetrics.creatorAvatarSize}
            uri={series.creator.avatar_url}
          />
        </Pressable>
        <Text numberOfLines={1} style={styles.creatorCopy}>
          {t("shortDrama.series.uploadedBy", series.creator.nickname)}
        </Text>
      </View>
      <View pointerEvents="none" style={styles.cardBorder} />
    </View>
  );
}

function StatusPill({
  status,
  styles,
  t,
}: {
  status: ShortDramaPublishStatus;
  styles: StudioStyles;
  t: Translate;
}) {
  const color = statusColor(status, styles);
  return (
    <Text style={[styles.statusPill, { color, backgroundColor: `${color}1F` }]}>
      {t(shortDramaStatusLocalizationKey(status))}
    </Text>
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
  styles: StudioStyles;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.rangeContent}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.rangeScroller}
    >
      {Array.from({ length: pageCount }, (_, page) => (
        <Pressable key={page} onPress={() => onSelect(page)} style={styles.rangeButton}>
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

function StudioPoster({ styles, url }: { styles: StudioStyles; url: string }) {
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

function StudioLoadingState({ styles, t }: { styles: StudioStyles; t: Translate }) {
  return (
    <View style={styles.loadingState}>
      <ActivityIndicator color={styles.accent.color} />
      <Text style={styles.loadingText}>{t("common.loading")}</Text>
    </View>
  );
}

function StudioEmptyState({
  onCreate,
  styles,
  t,
}: {
  onCreate(): void;
  styles: StudioStyles;
  t: Translate;
}) {
  return (
    <View style={styles.emptyState}>
      <SymbolView
        name={"play.rectangle.stack" as never}
        size={44}
        weight="semibold"
        tintColor={styles.accent.color}
      />
      <View style={styles.emptyCopy}>
        <Text style={styles.emptyTitle}>{t("shortDrama.studio.empty")}</Text>
        <Text style={styles.emptyHint}>{t("shortDrama.studio.emptyHint")}</Text>
      </View>
      <Pressable onPress={onCreate} style={styles.emptyButton}>
        <SymbolView name="plus" size={15} weight="bold" tintColor="#FFFFFF" />
        <Text style={styles.emptyButtonText}>{t("shortDrama.series.create")}</Text>
      </Pressable>
    </View>
  );
}

function statusColor(status: ShortDramaPublishStatus, styles: StudioStyles): string {
  switch (shortDramaStatusTone(status)) {
    case "success":
      return styles.success.color;
    case "accent":
      return styles.accent.color;
    case "danger":
      return styles.danger.color;
    case "secondary":
      return styles.secondary.color;
  }
}

function requiresUnlock(video: ShortDramaVideo): boolean {
  return (
    (video.unlock_price_gold_coins ?? 0) > 0 &&
    !video.is_unlocked &&
    !video.is_owned_by_current_user
  );
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function makeStyles(scheme: ReturnType<typeof useColorScheme>) {
  const theme = palette(scheme);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    accent: { color: theme.accent },
    success: { color: theme.success },
    danger: { color: theme.danger },
    secondary: { color: theme.secondaryText },
    backButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
    createButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
    list: {
      paddingHorizontal: shortDramaStudioMetrics.horizontalInset,
      paddingTop: shortDramaStudioMetrics.topInset,
      paddingBottom: shortDramaStudioMetrics.bottomInset,
    },
    emptyList: { flexGrow: 1 },
    cardGap: { height: shortDramaStudioMetrics.cardGap },
    loadingMore: { paddingVertical: 16 },
    loadingState: {
      alignItems: "center",
      gap: shortDramaStudioMetrics.loadingGap,
      paddingTop: shortDramaStudioMetrics.loadingTopInset,
    },
    loadingText: {
      color: theme.secondaryText,
      fontSize: shortDramaStudioMetrics.loadingTextSize,
      fontWeight: "600",
    },
    emptyState: {
      alignItems: "center",
      gap: shortDramaStudioMetrics.emptyCardGap,
      marginTop: shortDramaStudioMetrics.emptyTopInset,
      padding: shortDramaStudioMetrics.emptyCardInset,
      borderRadius: shortDramaStudioMetrics.emptyCardRadius,
      backgroundColor: theme.card,
    },
    emptyCopy: { alignItems: "center", gap: shortDramaStudioMetrics.emptyCopyGap },
    emptyTitle: {
      color: theme.text,
      fontSize: shortDramaStudioMetrics.emptyTitleSize,
      fontWeight: "700",
    },
    emptyHint: {
      color: theme.secondaryText,
      fontSize: shortDramaStudioMetrics.emptyHintSize,
      textAlign: "center",
    },
    emptyButton: {
      height: shortDramaStudioMetrics.emptyButtonHeight,
      paddingHorizontal: shortDramaStudioMetrics.emptyButtonHorizontalInset,
      borderRadius: 999,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: theme.accent,
    },
    emptyButtonText: {
      color: "#FFFFFF",
      fontSize: shortDramaStudioMetrics.emptyButtonTextSize,
      fontWeight: "700",
    },
    card: {
      padding: shortDramaSeriesMetrics.cardInset,
      borderRadius: shortDramaSeriesMetrics.cardRadius,
      backgroundColor: theme.card,
    },
    cardBorder: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderRadius: shortDramaSeriesMetrics.cardRadius,
      borderWidth: shortDramaSeriesMetrics.cardBorderWidth,
      borderColor: `${theme.separator}B3`,
    },
    seriesSummary: { alignItems: "stretch", gap: shortDramaSeriesMetrics.headerGap },
    titleRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: shortDramaSeriesMetrics.titleStatusGap,
    },
    seriesTitle: {
      flexShrink: 1,
      color: theme.text,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "700",
    },
    statusPill: {
      overflow: "hidden",
      paddingHorizontal: shortDramaStudioMetrics.statusPillHorizontalInset,
      paddingVertical: shortDramaStudioMetrics.statusPillVerticalInset,
      borderRadius: 999,
      fontSize: shortDramaStudioMetrics.statusPillTextSize,
      lineHeight: 13,
      fontWeight: "700",
    },
    poster: {
      height: shortDramaSeriesMetrics.posterHeight,
      overflow: "hidden",
      borderRadius: shortDramaSeriesMetrics.posterRadius,
    },
    posterFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
    seriesIntro: { color: theme.secondaryText, fontSize: 15, lineHeight: 20 },
    introLabel: { fontWeight: "600" },
    episodesSection: {
      gap: shortDramaSeriesMetrics.episodesGap,
      paddingTop: shortDramaSeriesMetrics.episodesTopInset,
    },
    rangeScroller: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: `${theme.separator}80`,
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
      color: theme.secondaryText,
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
      backgroundColor: theme.background,
    },
    episodeNumber: { color: theme.text, fontSize: 15, fontWeight: "700" },
    episodeNumberUnavailable: { color: theme.tertiaryText },
    episodeLock: {
      position: "absolute",
      top: shortDramaSeriesMetrics.lockInset,
      right: shortDramaSeriesMetrics.lockInset,
    },
    statusDotSlot: {
      position: "absolute",
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: "center",
      padding: shortDramaSeriesMetrics.statusDotInset,
    },
    statusDot: {
      width: shortDramaSeriesMetrics.statusDotSize,
      height: shortDramaSeriesMetrics.statusDotSize,
      borderRadius: shortDramaSeriesMetrics.statusDotSize / 2,
    },
    episodeLoading: { position: "absolute", transform: [{ scale: 0.65 }] },
    creatorDivider: {
      height: StyleSheet.hairlineWidth,
      marginTop: shortDramaSeriesMetrics.creatorDividerTopInset,
      backgroundColor: `${theme.separator}80`,
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
      color: theme.secondaryText,
      fontSize: shortDramaSeriesMetrics.creatorCopySize,
      fontWeight: "500",
    },
  });
}
