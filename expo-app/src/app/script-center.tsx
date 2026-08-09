import { LinearGradient } from "expo-linear-gradient";
import type { ImageLoadEventData } from "expo-image";
import { router, Stack, useFocusEffect, type NativeStackNavigationOptions } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";

import { getScriptCategories, getScripts } from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { SystemSegmentedTabs } from "@/components/SystemSegmentedTabs";
import { env } from "@/config/env";
import type { InteractiveScript, ScriptCategory, ScriptPage, ScriptScope } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  loadCachedScriptCategories,
  loadCachedScriptPage,
  saveCachedScriptCategories,
  saveCachedScriptPage,
  scriptCatalogGeneration,
  subscribeScriptLibraryChanges,
} from "@/services/scripts/ScriptCatalogRepository";
import {
  appendUniqueScripts,
  scriptBadgeText,
  scriptCenterMetrics,
  scriptCoverAspectRatio,
  scriptText,
} from "@/services/scripts/scriptCenterPolicy";
import { palette } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";
import { rememberScriptForNavigation } from "@/services/scripts/ScriptNavigationStore";
import { runAfterNavigationInteractions } from "@/services/navigation/NavigationWorkScheduler";
import {
  readNavigationSnapshot,
  writeNavigationSnapshot,
} from "@/services/navigation/NavigationSnapshotCache";

const skeletons = Array.from({ length: scriptCenterMetrics.skeletonCount }, (_, index) => ({
  script_id: `placeholder-${index}`,
  title: "Placeholder",
  synopsis: "Placeholder synopsis for loading state.",
  cover_url: "",
  category_ids: [],
  visibility: "public" as const,
  status: "ready" as const,
  creator: { user_id: "", nickname: "Creator", avatar_url: "" },
  roles: [],
  is_admin_hidden: false,
}));

interface ScriptCenterNavigationSnapshot {
  scope: ScriptScope;
  selectedCategoryId?: string | undefined;
  categories: ScriptCategory[];
  scripts: InteractiveScript[];
  nextCursor?: string | undefined;
  hasMore: boolean;
}

export default function ScriptCenterScreen() {
  const { user } = useAuth();
  const ownerId = trimFoundationWhitespacesAndNewlines(user?.user_id ?? "");
  return <ScriptCenterOwner key={ownerId || "anonymous"} ownerId={ownerId} />;
}

export function ScriptCenterOwner({ ownerId }: { ownerId: string }) {
  const { selectedLanguage, t } = useLocalization();
  const scheme = useColorScheme();
  const theme = palette(scheme);
  const styles = useMemo(() => makeStyles(scheme), [scheme]);
  const [navigationSnapshot] = useState(() =>
    readNavigationSnapshot<ScriptCenterNavigationSnapshot>("script-center", ownerId),
  );
  const [scope, setScope] = useState<ScriptScope>(navigationSnapshot?.scope ?? "public");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(
    navigationSnapshot?.selectedCategoryId,
  );
  const [categories, setCategories] = useState<ScriptCategory[]>(
    navigationSnapshot?.categories ?? [],
  );
  const [scripts, setScripts] = useState<InteractiveScript[]>(navigationSnapshot?.scripts ?? []);
  const [nextCursor, setNextCursor] = useState<string | undefined>(navigationSnapshot?.nextCursor);
  const [hasMore, setHasMore] = useState(navigationSnapshot?.hasMore ?? false);
  const [isLoading, setLoading] = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [isManualRefreshing, setManualRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectionRef = useRef({ ownerId, scope, categoryId: selectedCategoryId });
  const categoriesRef = useRef(categories);
  const scriptsRef = useRef(scripts);
  const loadTokenRef = useRef(0);
  const paginationGenerationRef = useRef(0);
  const paginationInFlightRef = useRef(false);
  const selectionLoadInFlightRef = useRef(false);
  const queuedSelectionLoadRef = useRef<(() => Promise<void>) | null>(null);
  const manualRefreshInFlightRef = useRef(false);
  const activeRef = useRef(true);
  const hasFocusedRef = useRef(false);
  const skipNextSelectionEffectRef = useRef(false);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      loadTokenRef.current += 1;
      paginationGenerationRef.current += 1;
      paginationInFlightRef.current = false;
      queuedSelectionLoadRef.current = null;
      manualRefreshInFlightRef.current = false;
    };
  }, []);
  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);
  useEffect(() => {
    scriptsRef.current = scripts;
  }, [scripts]);
  useEffect(() => {
    selectionRef.current = { ownerId, scope, categoryId: selectedCategoryId };
  }, [ownerId, scope, selectedCategoryId]);
  useEffect(() => {
    writeNavigationSnapshot<ScriptCenterNavigationSnapshot>("script-center", ownerId, {
      scope,
      selectedCategoryId,
      categories,
      scripts,
      nextCursor,
      hasMore,
    });
  }, [categories, hasMore, nextCursor, ownerId, scope, scripts, selectedCategoryId]);

  const text = useCallback(
    (chinese: string, english: string) => scriptText(selectedLanguage, chinese, english),
    [selectedLanguage],
  );

  const selectScope = useCallback(
    (value: ScriptScope) => {
      if (value === scope) return;
      loadTokenRef.current += 1;
      paginationGenerationRef.current += 1;
      paginationInFlightRef.current = false;
      selectionRef.current = { ownerId, scope: value, categoryId: selectedCategoryId };
      scriptsRef.current = [];
      setScripts([]);
      setHasMore(false);
      setNextCursor(undefined);
      setErrorMessage(null);
      setLoading(true);
      setScope(value);
    },
    [ownerId, scope, selectedCategoryId],
  );

  const selectCategory = useCallback(
    (categoryId: string | undefined) => {
      if (categoryId === selectedCategoryId) return;
      loadTokenRef.current += 1;
      paginationGenerationRef.current += 1;
      paginationInFlightRef.current = false;
      selectionRef.current = { ownerId, scope, categoryId };
      scriptsRef.current = [];
      setScripts([]);
      setHasMore(false);
      setNextCursor(undefined);
      setErrorMessage(null);
      setLoading(true);
      setSelectedCategoryId(categoryId);
    },
    [ownerId, scope, selectedCategoryId],
  );

  const loadCategories = useCallback(
    async (force: boolean, token: number, cacheGeneration: number): Promise<ScriptCategory[]> => {
      const cached = await loadCachedScriptCategories(ownerId).catch(() => null);
      if (!activeRef.current || token !== loadTokenRef.current) return [];
      if (cached) {
        categoriesRef.current = cached.value;
        setCategories(cached.value);
      }
      if (cached && !cached.isStale && !force) return cached.value;
      try {
        const remote = await getScriptCategories();
        if (!activeRef.current || token !== loadTokenRef.current) return cached?.value ?? [];
        categoriesRef.current = remote;
        setCategories(remote);
        await saveCachedScriptCategories(ownerId, remote, Date.now(), cacheGeneration).catch(
          () => undefined,
        );
        return remote;
      } catch (error) {
        if (
          activeRef.current &&
          token === loadTokenRef.current &&
          !cached &&
          categoriesRef.current.length === 0
        ) {
          setErrorMessage(readableError(error, text("请求失败，请稍后重试", "Request failed")));
        }
        return cached?.value ?? categoriesRef.current;
      }
    },
    [ownerId, text],
  );

  const runSelectionLoad = useCallback(
    async (
      options: {
        force?: boolean;
        reloadCategories?: boolean;
      } = {},
    ) => {
      if (!ownerId || !activeRef.current) return;
      const token = ++loadTokenRef.current;
      const cacheGeneration = scriptCatalogGeneration(ownerId);
      paginationGenerationRef.current += 1;
      paginationInFlightRef.current = false;
      const requestedScope = scope;
      let requestedCategoryId = selectedCategoryId;
      setLoading(true);
      setErrorMessage(null);
      try {
        if (options.reloadCategories) {
          const loadedCategories = await loadCategories(
            Boolean(options.force),
            token,
            cacheGeneration,
          );
          if (!activeRef.current || token !== loadTokenRef.current) return;
          if (
            requestedCategoryId !== undefined &&
            !loadedCategories.some((category) => category.id === requestedCategoryId)
          ) {
            requestedCategoryId = undefined;
            selectionRef.current = {
              ownerId,
              scope: requestedScope,
              categoryId: undefined,
            };
            skipNextSelectionEffectRef.current = true;
            setSelectedCategoryId(undefined);
          }
        }
        const cached = await loadCachedScriptPage(
          ownerId,
          requestedScope,
          requestedCategoryId,
        ).catch(() => null);
        if (
          !activeRef.current ||
          token !== loadTokenRef.current ||
          !sameSelection(selectionRef.current, ownerId, requestedScope, requestedCategoryId)
        )
          return;
        if (cached) {
          const page = cached.value;
          scriptsRef.current = page.scripts;
          setScripts(page.scripts);
          setHasMore(page.has_more);
          setNextCursor(page.next_cursor);
        } else if (!options.force) {
          scriptsRef.current = [];
          setScripts([]);
          setHasMore(false);
          setNextCursor(undefined);
        }
        if (cached && !cached.isStale && !options.force) return;
        try {
          const remote = await getScripts(requestedScope, {
            ...(requestedCategoryId ? { categoryId: requestedCategoryId } : {}),
            limit: scriptCenterMetrics.pageLimit,
          });
          if (
            !activeRef.current ||
            token !== loadTokenRef.current ||
            !sameSelection(selectionRef.current, ownerId, requestedScope, requestedCategoryId)
          )
            return;
          scriptsRef.current = remote.scripts;
          setScripts(remote.scripts);
          setHasMore(remote.has_more);
          setNextCursor(remote.next_cursor);
          await saveCachedScriptPage(
            ownerId,
            requestedScope,
            requestedCategoryId,
            remote,
            Date.now(),
            cacheGeneration,
          ).catch(() => undefined);
        } catch (error) {
          if (
            activeRef.current &&
            token === loadTokenRef.current &&
            sameSelection(selectionRef.current, ownerId, requestedScope, requestedCategoryId) &&
            !cached
          ) {
            setErrorMessage(readableError(error, text("请求失败，请稍后重试", "Request failed")));
          }
        }
      } finally {
        if (activeRef.current && token === loadTokenRef.current) setLoading(false);
      }
    },
    [loadCategories, ownerId, scope, selectedCategoryId, text],
  );

  const loadSelection = useCallback(
    async (
      options: {
        force?: boolean;
        reloadCategories?: boolean;
      } = {},
    ) => {
      const run = () => runSelectionLoad(options);
      if (selectionLoadInFlightRef.current) {
        // Swift serializes reset loads with isLoading and, after a selection
        // changes, schedules only the latest scope/category once the old load exits.
        queuedSelectionLoadRef.current = run;
        return;
      }
      selectionLoadInFlightRef.current = true;
      let next: (() => Promise<void>) | null = run;
      try {
        while (next && activeRef.current) {
          queuedSelectionLoadRef.current = null;
          await next();
          next = queuedSelectionLoadRef.current;
        }
      } finally {
        selectionLoadInFlightRef.current = false;
        queuedSelectionLoadRef.current = null;
      }
    },
    [runSelectionLoad],
  );

  const loadMore = useCallback(async () => {
    if (!ownerId || !activeRef.current || !hasMore || isLoading || paginationInFlightRef.current)
      return;
    const requestedScope = scope;
    const requestedCategoryId = selectedCategoryId;
    const cursor = nextCursor;
    const generation = ++paginationGenerationRef.current;
    const cacheGeneration = scriptCatalogGeneration(ownerId);
    paginationInFlightRef.current = true;
    setLoadingMore(true);
    setErrorMessage(null);
    try {
      const page = await getScripts(requestedScope, {
        ...(requestedCategoryId ? { categoryId: requestedCategoryId } : {}),
        ...(cursor ? { cursor } : {}),
        limit: scriptCenterMetrics.pageLimit,
      });
      if (
        !activeRef.current ||
        generation !== paginationGenerationRef.current ||
        !sameSelection(selectionRef.current, ownerId, requestedScope, requestedCategoryId)
      )
        return;
      const merged = appendUniqueScripts(scriptsRef.current, page.scripts);
      scriptsRef.current = merged;
      setScripts(merged);
      setHasMore(page.has_more);
      setNextCursor(page.next_cursor);
      const combined: ScriptPage = { ...page, scripts: merged };
      await saveCachedScriptPage(
        ownerId,
        requestedScope,
        requestedCategoryId,
        combined,
        Date.now(),
        cacheGeneration,
      ).catch(() => undefined);
    } catch {
      // Native pagination keeps the already visible page and does not surface
      // an inline error. A later appearance or pull-to-refresh can retry.
    } finally {
      if (generation === paginationGenerationRef.current) {
        paginationInFlightRef.current = false;
        if (activeRef.current) setLoadingMore(false);
      }
    }
  }, [hasMore, isLoading, nextCursor, ownerId, scope, selectedCategoryId]);

  const manualRefresh = useCallback(async () => {
    if (manualRefreshInFlightRef.current) return;
    manualRefreshInFlightRef.current = true;
    setManualRefreshing(true);
    try {
      await loadSelection({ force: true, reloadCategories: true });
    } finally {
      manualRefreshInFlightRef.current = false;
      if (activeRef.current) setManualRefreshing(false);
    }
  }, [loadSelection]);

  useEffect(() => {
    if (skipNextSelectionEffectRef.current) {
      skipNextSelectionEffectRef.current = false;
      return;
    }
    const cancel = runAfterNavigationInteractions(
      () => void loadSelection({ reloadCategories: categories.length === 0 }),
    );
    // Categories are intentionally not a dependency: a cache/remote category write
    // must not restart the selected-page request.
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, scope, selectedCategoryId]);

  useEffect(
    () =>
      subscribeScriptLibraryChanges(ownerId, () => {
        void loadSelection({ force: true, reloadCategories: true });
      }),
    [loadSelection, ownerId],
  );

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return;
      }
      // The source listens for explicit library changes, so ordinary focus does not
      // force a request when a fresh cache already owns the current selection.
    }, []),
  );

  const displayedScripts = isLoading && scripts.length === 0 ? skeletons : scripts;
  const showSkeletons = isLoading && scripts.length === 0;
  const headerOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      title: "",
      headerShadowVisible: false,
      headerStyle: { backgroundColor: theme.background },
      headerBackTitle: t("common.back"),
      headerBackButtonDisplayMode: "minimal",
      headerTintColor: "#1A1A2E",
      headerTitle: () => (
        <SystemSegmentedTabs<ScriptScope>
          accessibilityIdentifier="script.center.top.tabs"
          colorScheme="light"
          items={[
            { value: "public", title: text("公开剧本", "Public") },
            { value: "mine", title: text("我的剧本", "Mine") },
          ]}
          onSelectionChange={selectScope}
          selection={scope}
        />
      ),
      headerRight: () => (
        <Pressable
          accessibilityLabel={text("创建剧本", "Create script")}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push("/script-editor")}
          style={styles.createButton}
        >
          <SymbolView name="plus" size={18} weight="semibold" tintColor={theme.text} />
        </Pressable>
      ),
    }),
    [scope, selectScope, styles.createButton, t, text, theme.background, theme.text],
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={headerOptions} />

      <ScrollView
        contentContainerStyle={styles.categories}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <CategoryPill
          selected={selectedCategoryId === undefined}
          styles={styles}
          title={text("全部", "All")}
          onPress={() => selectCategory(undefined)}
        />
        {categories.map((category) => (
          <CategoryPill
            key={category.id}
            selected={selectedCategoryId === category.id}
            styles={styles}
            title={category.name}
            onPress={() => selectCategory(category.id)}
          />
        ))}
      </ScrollView>

      <FlatList
        testID="script-center-list"
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[styles.grid, displayedScripts.length === 0 && styles.emptyGrid]}
        data={displayedScripts}
        keyExtractor={(script) => script.script_id}
        numColumns={scriptCenterMetrics.gridColumns}
        ListEmptyComponent={
          <ScriptCenterEmpty
            error={errorMessage}
            onRetry={() => void manualRefresh()}
            scope={scope}
            styles={styles}
            text={text}
          />
        }
        ListFooterComponent={
          isLoadingMore ? <ActivityIndicator color={theme.accent} style={styles.loadMore} /> : null
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.3}
        refreshControl={
          showSkeletons || scripts.length === 0 ? undefined : (
            <RefreshControl
              refreshing={isManualRefreshing}
              tintColor={theme.accent}
              onRefresh={() => void manualRefresh()}
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityLabel={scriptCardAccessibilityLabel(item, selectedLanguage)}
            accessibilityRole="button"
            accessibilityState={{ disabled: showSkeletons }}
            accessibilityElementsHidden={showSkeletons}
            disabled={showSkeletons}
            importantForAccessibility={showSkeletons ? "no-hide-descendants" : "auto"}
            onPress={() => {
              rememberScriptForNavigation(item, ownerId);
              router.push({ pathname: "/script-detail", params: { scriptId: item.script_id } });
            }}
            style={styles.cardCell}
          >
            <ScriptCard
              placeholder={showSkeletons}
              script={item}
              selectedLanguage={selectedLanguage}
              styles={styles}
            />
          </Pressable>
        )}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

function CategoryPill({
  onPress,
  selected,
  styles,
  title,
}: {
  onPress(): void;
  selected: boolean;
  styles: ReturnType<typeof makeStyles>;
  title: string;
}) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.categoryPill, selected && styles.categoryPillSelected]}
    >
      <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>{title}</Text>
    </Pressable>
  );
}

function ScriptCard({
  placeholder,
  script,
  selectedLanguage,
  styles,
}: {
  placeholder: boolean;
  script: InteractiveScript;
  selectedLanguage: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  const badge = scriptBadgeText(script, selectedLanguage);
  return (
    <View style={[styles.card, placeholder && styles.placeholderCard]}>
      <ScriptCover key={script.cover_url} badge={badge} styles={styles} url={script.cover_url} />
      <Text numberOfLines={1} style={styles.cardTitle}>
        {script.title}
      </Text>
      <Text numberOfLines={2} style={styles.cardSynopsis}>
        {script.synopsis}
      </Text>
      <View style={styles.cardFooter}>
        <View style={styles.roleAvatars}>
          {script.roles.slice(0, 4).map((role, index) => (
            <View
              key={role.role_id || role.client_role_id || role.name}
              style={[styles.roleAvatarFrame, index > 0 && styles.overlapAvatar]}
            >
              <ScriptCatalogImage
                fallback="person.fill"
                radius={11}
                size={22}
                styles={styles}
                url={role.avatar_url}
              />
            </View>
          ))}
        </View>
        <Text numberOfLines={1} style={styles.creator}>
          {script.creator.nickname}
        </Text>
      </View>
    </View>
  );
}

function ScriptCover({
  badge,
  styles,
  url,
}: {
  badge: string | null;
  styles: ReturnType<typeof makeStyles>;
  url: string;
}) {
  const [aspectRatio, setAspectRatio] = useState<number>(scriptCenterMetrics.coverAspectRatio);
  return (
    <View style={[styles.coverWrap, { aspectRatio }]}>
      <ScriptCatalogImage
        fallback="book.closed.fill"
        onLoad={(event) =>
          setAspectRatio(scriptCoverAspectRatio(event.source.width, event.source.height))
        }
        radius={scriptCenterMetrics.coverRadius}
        styles={styles}
        url={url}
      />
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
    </View>
  );
}

function ScriptCenterEmpty({
  error,
  onRetry,
  scope,
  styles,
  text,
}: {
  error: string | null;
  onRetry(): void;
  scope: ScriptScope;
  styles: ReturnType<typeof makeStyles>;
  text: (chinese: string, english: string) => string;
}) {
  const icon = error
    ? "exclamationmark.triangle"
    : scope === "mine"
      ? "square.and.pencil"
      : "book.closed";
  const title = error
    ? text("无法加载公开剧本", "Unable to load scripts")
    : scope === "mine"
      ? text("还没有创建剧本", "No scripts yet")
      : text("暂无公开剧本", "No public scripts");
  const subtitle =
    error ??
    (scope === "mine"
      ? text("创建角色和世界设定，开始你的故事", "Create roles and a world to begin")
      : text("稍后再来看看新的故事", "Check back for new stories"));
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      <View style={styles.emptyIconGradient}>
        <SymbolView
          name={icon as never}
          size={36}
          weight="semibold"
          tintColor={styles.accent.color}
        />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
      {error ? (
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={styles.retryText}>{text("重试", "Retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ScriptCatalogImage({
  fallback,
  onLoad,
  radius,
  size,
  styles,
  url,
}: {
  fallback: string;
  onLoad?: ((event: ImageLoadEventData) => void) | undefined;
  radius: number;
  size?: number;
  styles: ReturnType<typeof makeStyles>;
  url: string;
}) {
  const resolved = resolveMediaUrl(url, env.apiBaseUrl);
  const imageStyle = size
    ? { width: size, height: size, borderRadius: radius }
    : { width: "100%" as const, height: "100%" as const, borderRadius: radius };
  const fallbackView = (
    <LinearGradient
      colors={["rgba(102,126,234,0.12)", "#F2E8FF"]}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={[imageStyle, styles.imageFallback]}
    >
      <SymbolView
        name={fallback as never}
        size={size ? Math.min(16, size) : 24}
        weight="semibold"
        tintColor="rgba(102,126,234,0.70)"
      />
    </LinearGradient>
  );
  return resolved ? (
    <AuthenticatedImage
      contentFit="cover"
      errorFallback={fallbackView}
      fallback={fallbackView}
      loadingFallback={
        <View style={[imageStyle, styles.imageLoading]}>
          <ActivityIndicator color="#667EEA" size="small" />
        </View>
      }
      {...(onLoad ? { onLoad } : {})}
      style={imageStyle}
      transition={0}
      uri={resolved}
    />
  ) : (
    fallbackView
  );
}

function sameSelection(
  current: { ownerId: string; scope: ScriptScope; categoryId: string | undefined },
  ownerId: string,
  scope: ScriptScope,
  categoryId: string | undefined,
): boolean {
  return (
    current.ownerId === ownerId && current.scope === scope && current.categoryId === categoryId
  );
}

function makeStyles(scheme: ReturnType<typeof useColorScheme>) {
  const theme = palette(scheme);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    accent: { color: theme.accent },
    accentDark: { color: theme.accentDark },
    createButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
    categories: { flexGrow: 0, gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },
    categoryPill: {
      paddingHorizontal: 13,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.card,
    },
    categoryPillSelected: { backgroundColor: theme.accentSoft },
    categoryText: {
      color: theme.secondaryText,
      fontSize: 13,
      fontWeight: "400",
      lineHeight: 16,
    },
    categoryTextSelected: { color: theme.accent, fontWeight: "600" },
    grid: { paddingHorizontal: 16, paddingBottom: 24 },
    emptyGrid: { flexGrow: 1 },
    gridRow: { alignItems: "center", gap: 12, marginBottom: 12 },
    cardCell: { flex: 1 },
    card: { gap: 9, padding: 10, borderRadius: 15, backgroundColor: theme.card },
    placeholderCard: { opacity: 0.36 },
    coverWrap: { width: "100%" },
    badge: {
      position: "absolute",
      top: 7,
      right: 7,
      overflow: "hidden",
      color: "#FFFFFF",
      fontSize: 10,
      fontWeight: "700",
      paddingHorizontal: 7,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: "rgba(0,0,0,0.62)",
    },
    cardTitle: { color: theme.text, fontSize: 15, fontWeight: "600" },
    cardSynopsis: { minHeight: 32, color: theme.secondaryText, fontSize: 12, lineHeight: 16 },
    cardFooter: { flexDirection: "row", alignItems: "center" },
    roleAvatars: { flexDirection: "row", alignItems: "center" },
    roleAvatarFrame: {
      width: 22,
      height: 22,
      overflow: "hidden",
      borderRadius: 11,
      borderColor: theme.card,
      borderWidth: 1.5,
    },
    overlapAvatar: { marginLeft: -5 },
    creator: {
      flex: 1,
      marginLeft: 4,
      color: theme.tertiaryText,
      fontSize: 10,
      textAlign: "right",
    },
    imageFallback: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
    imageLoading: {
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
    },
    emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 30 },
    emptyIconGradient: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
    emptyTitle: { color: theme.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
    emptySubtitle: {
      color: theme.secondaryText,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
    },
    retryText: { color: theme.accent, fontSize: 15, fontWeight: "600", paddingBottom: 28 },
    loadMore: { paddingBottom: 20 },
  });
}

function scriptCardAccessibilityLabel(script: InteractiveScript, selectedLanguage: string): string {
  return [
    script.title,
    scriptBadgeText(script, selectedLanguage),
    script.synopsis,
    script.creator.nickname,
  ]
    .filter((value): value is string => Boolean(value))
    .join(", ");
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
